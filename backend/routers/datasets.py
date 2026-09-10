"""Training dataset endpoints (MinIO-backed).

Users upload a dataset from the UI; the backend stores the bytes in MinIO and
keeps the metadata in the ``datasets`` table. A repository has at most one
*active* dataset, which the Celery worker downloads and injects into the
notebook as the ``DATASET_PATH`` papermill parameter.
"""
from __future__ import annotations

import hashlib
import os
import tempfile
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from sqlmodel import Session, select

from core.config import AppSettings, get_settings
from core.ownership import can_access_repo, get_visible_repo_or_404
from core.security import get_current_user
from core.storage import (
    ObjectNotFoundError,
    StorageError,
    build_dataset_key,
    delete_object,
    download_to_path,
    upload_fileobj,
)
from db import get_session
from models.schemas import (
    Dataset,
    DatasetPreviewResponse,
    DatasetResponse,
    MessageResponse,
    Repository,
    User,
)

logger = structlog.get_logger(__name__)
router = APIRouter(tags=["datasets"])

# Accepted upload extensions mapped to the MIME type stored in MinIO.
ALLOWED_EXTENSIONS: dict[str, str] = {
    ".csv": "text/csv",
    ".parquet": "application/vnd.apache.parquet",
    ".json": "application/json",
    ".jsonl": "application/x-ndjson",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

# Read the upload in 1 MiB chunks; spool to disk past 8 MiB to bound memory.
_CHUNK_SIZE = 1024 * 1024
_SPOOL_MAX_BYTES = 8 * 1024 * 1024

#: Number of rows returned by the preview endpoint.
PREVIEW_ROWS = 20


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _file_extension(filename: str) -> str:
    """Return the lower-cased extension of ``filename`` (including the dot)."""
    return os.path.splitext(filename or "")[1].lower()


def _get_repo_or_404(session: Session, repo_id: int, user: User) -> Repository:
    """Return the repository if ``user`` may see it, or raise a 404.

    A repository owned by another member is indistinguishable from a missing
    one (see ``core.ownership`` for why this is a 404 and not a 403).
    """
    return get_visible_repo_or_404(session, repo_id, user)


def _get_dataset_or_404(session: Session, dataset_id: int, user: User) -> Dataset:
    """Return the dataset if its repository is visible to ``user``, else 404.

    Datasets inherit their visibility from the repository they belong to, so a
    dataset of somebody else's repository is reported as non-existent.
    """
    dataset = session.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset {dataset_id} not found.",
        )

    repo = session.get(Repository, dataset.repo_id)
    if not can_access_repo(repo, user):
        logger.info(
            "ownership.dataset_access_denied",
            dataset_id=dataset_id,
            repo_id=dataset.repo_id,
            user_id=user.id,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset {dataset_id} not found.",
        )
    return dataset


def _deactivate_others(session: Session, repo_id: int, keep_id: int | None) -> None:
    """Mark every dataset of ``repo_id`` inactive except ``keep_id``."""
    others = session.exec(
        select(Dataset).where(
            Dataset.repo_id == repo_id,
            Dataset.is_active == True,  # noqa: E712 — SQLModel needs the operator
        )
    ).all()
    for other in others:
        if keep_id is not None and other.id == keep_id:
            continue
        other.is_active = False
        session.add(other)


def _read_dataframe(path: str, extension: str) -> Any:
    """Load ``path`` into a pandas DataFrame based on its extension.

    Raises:
        ValueError: If the extension is unsupported or the file cannot be read.
    """
    import pandas as pd

    try:
        if extension == ".csv":
            return pd.read_csv(path)
        if extension == ".parquet":
            return pd.read_parquet(path)
        if extension == ".jsonl":
            return pd.read_json(path, lines=True)
        if extension == ".json":
            return pd.read_json(path)
        if extension == ".xlsx":
            return pd.read_excel(path)
    except ImportError as exc:
        raise ValueError(
            f"Missing engine required to read '{extension}' files: {exc}"
        ) from exc
    except Exception as exc:
        raise ValueError(f"Could not parse the dataset ({extension}): {exc}") from exc

    raise ValueError(f"Preview is not supported for '{extension}' files.")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/repos/{repo_id}/datasets",
    response_model=DatasetResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a training dataset for a repository",
)
async def upload_dataset(
    repo_id: int,
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    file: Annotated[UploadFile, File(description="Dataset file to upload.")],
    description: Annotated[str, Form()] = "",
) -> DatasetResponse:
    """Store an uploaded dataset in MinIO and make it the repository's active one.

    The bytes are streamed (never fully buffered in memory), hashed with
    SHA-256 and uploaded to the datasets bucket. Any previously active dataset
    of the repository is deactivated. Only the repository's owner (or an
    admin) may upload to it.

    Args:
        repo_id: Owning repository ID.
        file: The multipart upload.
        description: Optional free-text description.

    Raises:
        HTTPException: 404 unknown or non-visible repo, 413 too large,
            415 bad extension, 422 empty file, 502 if MinIO rejects the upload.
    """
    _get_repo_or_404(session, repo_id, current_user)

    filename = file.filename or ""
    extension = _file_extension(filename)
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"Unsupported file type '{extension or filename}'. "
                f"Allowed extensions: {', '.join(sorted(ALLOWED_EXTENSIONS))}."
            ),
        )

    bucket = settings.minio_bucket_datasets
    object_key = build_dataset_key(repo_id, filename)
    content_type = file.content_type or ALLOWED_EXTENSIONS[extension]

    max_bytes = settings.dataset_max_size_mb * 1024 * 1024
    digest = hashlib.sha256()
    size_bytes = 0
    buffer = tempfile.SpooledTemporaryFile(max_size=_SPOOL_MAX_BYTES)

    try:
        while True:
            chunk = await file.read(_CHUNK_SIZE)
            if not chunk:
                break
            size_bytes += len(chunk)
            if size_bytes > max_bytes:
                logger.warning(
                    "dataset.upload_too_large",
                    repo_id=repo_id,
                    filename=filename,
                    limit_mb=settings.dataset_max_size_mb,
                )
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=(
                        f"Dataset exceeds the maximum allowed size of "
                        f"{settings.dataset_max_size_mb} MB."
                    ),
                )
            digest.update(chunk)
            buffer.write(chunk)

        if size_bytes == 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="The uploaded dataset is empty.",
            )

        buffer.seek(0)
        try:
            await run_in_threadpool(
                upload_fileobj, bucket, object_key, buffer, content_type
            )
        except StorageError as exc:
            logger.error("dataset.upload_failed", repo_id=repo_id, error=str(exc))
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to store the dataset in object storage: {exc}",
            )
    finally:
        buffer.close()
        await file.close()

    dataset = Dataset(
        repo_id=repo_id,
        name=os.path.basename(filename.replace("\\", "/")),
        description=description or "",
        bucket=bucket,
        object_key=object_key,
        content_type=content_type,
        size_bytes=size_bytes,
        checksum=digest.hexdigest(),
        uploaded_by=current_user.id,
        is_active=True,
    )
    _deactivate_others(session, repo_id, keep_id=None)
    session.add(dataset)
    session.commit()
    session.refresh(dataset)

    logger.info(
        "dataset.uploaded",
        dataset_id=dataset.id,
        repo_id=repo_id,
        object_key=object_key,
        size_bytes=size_bytes,
    )
    return DatasetResponse.model_validate(dataset)


@router.get(
    "/repos/{repo_id}/datasets",
    response_model=list[DatasetResponse],
    summary="List the datasets of a repository",
)
async def list_datasets(
    repo_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[DatasetResponse]:
    """Return the repository's datasets, most recent first.

    Restricted to repositories the caller owns (admins see any repository).
    """
    _get_repo_or_404(session, repo_id, current_user)

    datasets = session.exec(
        select(Dataset)
        .where(Dataset.repo_id == repo_id)
        .order_by(Dataset.created_at.desc(), Dataset.id.desc())  # type: ignore[union-attr]
    ).all()
    return [DatasetResponse.model_validate(d) for d in datasets]


@router.post(
    "/datasets/{dataset_id}/activate",
    response_model=DatasetResponse,
    summary="Make a dataset the active one for its repository",
)
async def activate_dataset(
    dataset_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> DatasetResponse:
    """Activate ``dataset_id`` and deactivate every other dataset of its repo.

    Restricted to datasets of repositories the caller can see.
    """
    dataset = _get_dataset_or_404(session, dataset_id, current_user)

    _deactivate_others(session, dataset.repo_id, keep_id=dataset.id)
    dataset.is_active = True
    session.add(dataset)
    session.commit()
    session.refresh(dataset)

    logger.info(
        "dataset.activated", dataset_id=dataset_id, repo_id=dataset.repo_id
    )
    return DatasetResponse.model_validate(dataset)


@router.delete(
    "/datasets/{dataset_id}",
    response_model=MessageResponse,
    summary="Delete a dataset",
)
async def delete_dataset(
    dataset_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> MessageResponse:
    """Remove the object from MinIO and delete the database row.

    A storage failure is non-fatal: the row is deleted anyway so the UI does
    not get stuck with an unusable entry, and the failure is logged.
    Restricted to datasets of repositories the caller can see.
    """
    dataset = _get_dataset_or_404(session, dataset_id, current_user)
    bucket, object_key = dataset.bucket, dataset.object_key

    try:
        await run_in_threadpool(delete_object, bucket, object_key)
    except StorageError as exc:
        logger.warning(
            "dataset.object_delete_failed",
            dataset_id=dataset_id,
            object_key=object_key,
            error=str(exc),
        )

    session.delete(dataset)
    session.commit()

    logger.info("dataset.deleted", dataset_id=dataset_id, object_key=object_key)
    return MessageResponse(message=f"Dataset {dataset_id} deleted.")


@router.get(
    "/datasets/{dataset_id}/preview",
    response_model=DatasetPreviewResponse,
    summary="Preview the first rows of a dataset",
)
async def preview_dataset(
    dataset_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> DatasetPreviewResponse:
    """Download the dataset and return its columns plus the first rows.

    Restricted to datasets of repositories the caller can see — otherwise the
    preview would leak the contents of another tenant's training data.

    Raises:
        HTTPException: 404 unknown/non-visible dataset or missing object,
            422 if the file cannot be parsed as a table, 502 on storage errors.
    """
    import json

    from core.storage import sanitize_filename

    dataset = _get_dataset_or_404(session, dataset_id, current_user)
    extension = _file_extension(dataset.name) or _file_extension(dataset.object_key)

    def _load() -> tuple[list[str], list[list[Any]], bool]:
        """Download the object into a temp dir and build the preview payload."""
        with tempfile.TemporaryDirectory() as tmpdir:
            local_path = os.path.join(
                tmpdir, sanitize_filename(dataset.name or "dataset")
            )
            download_to_path(dataset.bucket, dataset.object_key, local_path)
            frame = _read_dataframe(local_path, extension)
            head = frame.head(PREVIEW_ROWS)
            columns = [str(c) for c in frame.columns]
            # to_json normalises NaN/NaT/Timestamp into JSON-safe values.
            rows = json.loads(head.to_json(orient="values", date_format="iso"))
            return columns, rows, len(frame.index) > PREVIEW_ROWS

    try:
        columns, rows, truncated = await run_in_threadpool(_load)
    except ObjectNotFoundError as exc:
        logger.warning(
            "dataset.preview_object_missing",
            dataset_id=dataset_id,
            object_key=dataset.object_key,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"The stored object for dataset {dataset_id} no longer exists: {exc}",
        )
    except StorageError as exc:
        logger.error("dataset.preview_download_failed", dataset_id=dataset_id, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to read the dataset from object storage: {exc}",
        )
    except ValueError as exc:
        logger.warning("dataset.preview_parse_failed", dataset_id=dataset_id, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    return DatasetPreviewResponse(
        dataset_id=dataset_id,
        columns=columns,
        rows=rows,
        truncated=truncated,
    )
