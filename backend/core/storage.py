"""S3/MinIO object storage client used for user-uploaded training datasets.

All helpers here are **synchronous** on purpose: they are called both from the
FastAPI routers (which run sync endpoints in a threadpool) and from the Celery
worker, which has no event loop.

boto3's ``ClientError`` is translated into the small domain exception hierarchy
defined below (:class:`StorageError` / :class:`ObjectNotFoundError`) so callers
never have to import botocore.
"""
from __future__ import annotations

import os
import re
import uuid
from functools import lru_cache
from typing import IO, Any

import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)

__all__ = [
    "StorageError",
    "ObjectNotFoundError",
    "get_s3_client",
    "ensure_bucket",
    "upload_fileobj",
    "download_to_path",
    "delete_object",
    "object_exists",
    "build_dataset_key",
    "sanitize_filename",
]


# ---------------------------------------------------------------------------
# Domain exceptions
# ---------------------------------------------------------------------------

class StorageError(RuntimeError):
    """Raised when an object-storage operation fails."""


class ObjectNotFoundError(StorageError):
    """Raised when the requested bucket/key does not exist."""


# Botocore error codes that mean "the thing is simply not there".
_NOT_FOUND_CODES = {"404", "NoSuchKey", "NoSuchBucket", "NotFound"}


def _error_code(exc: Any) -> str:
    """Extract the botocore error code from a ClientError, if any."""
    response = getattr(exc, "response", None) or {}
    return str(response.get("Error", {}).get("Code", ""))


def _is_not_found(exc: Any) -> bool:
    """Return True when a ClientError means the object/bucket is missing."""
    if _error_code(exc) in _NOT_FOUND_CODES:
        return True
    response = getattr(exc, "response", None) or {}
    status_code = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    return status_code == 404


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def get_s3_client() -> Any:
    """Return a cached boto3 S3 client pointed at the configured MinIO endpoint.

    Returns:
        A ``boto3`` S3 client using path-style addressing (required by MinIO).

    Raises:
        StorageError: If the client cannot be created.
    """
    import boto3
    from botocore.client import Config
    from botocore.exceptions import BotoCoreError

    settings = get_settings()
    try:
        return boto3.client(
            "s3",
            endpoint_url=settings.minio_endpoint,
            aws_access_key_id=settings.minio_access_key,
            aws_secret_access_key=settings.minio_secret_key,
            region_name=settings.minio_region,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )
    except BotoCoreError as exc:  # pragma: no cover - configuration failure
        logger.error("storage.client_init_failed", error=str(exc))
        raise StorageError(f"Could not create the S3/MinIO client: {exc}") from exc


# ---------------------------------------------------------------------------
# Bucket / object operations
# ---------------------------------------------------------------------------

def ensure_bucket(bucket: str) -> None:
    """Create ``bucket`` if it does not exist yet. Idempotent.

    Args:
        bucket: Bucket name.

    Raises:
        StorageError: If the bucket cannot be inspected or created.
    """
    from botocore.exceptions import BotoCoreError, ClientError

    client = get_s3_client()
    try:
        client.head_bucket(Bucket=bucket)
        return
    except ClientError as exc:
        if not _is_not_found(exc):
            logger.error(
                "storage.head_bucket_failed", bucket=bucket, error=str(exc)
            )
            raise StorageError(
                f"Could not access bucket '{bucket}': {exc}"
            ) from exc
    except BotoCoreError as exc:
        logger.error("storage.head_bucket_failed", bucket=bucket, error=str(exc))
        raise StorageError(f"Could not access bucket '{bucket}': {exc}") from exc

    try:
        client.create_bucket(Bucket=bucket)
        logger.info("storage.bucket_created", bucket=bucket)
    except ClientError as exc:
        # Another worker may have created it in the meantime — that is fine.
        if _error_code(exc) in {"BucketAlreadyOwnedByYou", "BucketAlreadyExists"}:
            logger.info("storage.bucket_already_exists", bucket=bucket)
            return
        logger.error("storage.create_bucket_failed", bucket=bucket, error=str(exc))
        raise StorageError(f"Could not create bucket '{bucket}': {exc}") from exc
    except BotoCoreError as exc:
        logger.error("storage.create_bucket_failed", bucket=bucket, error=str(exc))
        raise StorageError(f"Could not create bucket '{bucket}': {exc}") from exc


def upload_fileobj(
    bucket: str,
    key: str,
    fileobj: IO[bytes],
    content_type: str = "application/octet-stream",
) -> None:
    """Upload a file-like object to ``bucket/key``.

    The bucket is created on demand so a fresh MinIO deployment works without
    any manual bootstrap step.

    Args:
        bucket: Target bucket.
        key: Object key.
        fileobj: Readable binary stream positioned at the first byte to upload.
        content_type: MIME type stored alongside the object.

    Raises:
        StorageError: If the upload fails.
    """
    from botocore.exceptions import BotoCoreError, ClientError

    ensure_bucket(bucket)
    client = get_s3_client()
    try:
        client.upload_fileobj(
            fileobj,
            bucket,
            key,
            ExtraArgs={"ContentType": content_type},
        )
    except (BotoCoreError, ClientError) as exc:
        logger.error(
            "storage.upload_failed", bucket=bucket, key=key, error=str(exc)
        )
        raise StorageError(
            f"Could not upload object '{key}' to bucket '{bucket}': {exc}"
        ) from exc

    logger.info(
        "storage.uploaded", bucket=bucket, key=key, content_type=content_type
    )


def download_to_path(bucket: str, key: str, dest_path: str) -> str:
    """Download ``bucket/key`` to ``dest_path`` on the local filesystem.

    Args:
        bucket: Source bucket.
        key: Object key.
        dest_path: Absolute or relative destination file path. Parent
            directories are created when missing.

    Returns:
        The destination path, for convenience.

    Raises:
        ObjectNotFoundError: If the object does not exist.
        StorageError: If the download fails for any other reason.
    """
    from botocore.exceptions import BotoCoreError, ClientError

    parent = os.path.dirname(os.path.abspath(dest_path))
    os.makedirs(parent, exist_ok=True)

    client = get_s3_client()
    try:
        client.download_file(bucket, key, dest_path)
    except ClientError as exc:
        if _is_not_found(exc):
            logger.warning("storage.object_not_found", bucket=bucket, key=key)
            raise ObjectNotFoundError(
                f"Object '{key}' not found in bucket '{bucket}'."
            ) from exc
        logger.error(
            "storage.download_failed", bucket=bucket, key=key, error=str(exc)
        )
        raise StorageError(
            f"Could not download object '{key}' from bucket '{bucket}': {exc}"
        ) from exc
    except BotoCoreError as exc:
        logger.error(
            "storage.download_failed", bucket=bucket, key=key, error=str(exc)
        )
        raise StorageError(
            f"Could not download object '{key}' from bucket '{bucket}': {exc}"
        ) from exc

    logger.info("storage.downloaded", bucket=bucket, key=key, dest_path=dest_path)
    return dest_path


def delete_object(bucket: str, key: str) -> None:
    """Delete ``bucket/key``. Deleting a missing object is not an error.

    Args:
        bucket: Bucket name.
        key: Object key.

    Raises:
        StorageError: If the delete call fails.
    """
    from botocore.exceptions import BotoCoreError, ClientError

    client = get_s3_client()
    try:
        client.delete_object(Bucket=bucket, Key=key)
    except ClientError as exc:
        if _is_not_found(exc):
            logger.info("storage.delete_noop", bucket=bucket, key=key)
            return
        logger.error(
            "storage.delete_failed", bucket=bucket, key=key, error=str(exc)
        )
        raise StorageError(
            f"Could not delete object '{key}' from bucket '{bucket}': {exc}"
        ) from exc
    except BotoCoreError as exc:
        logger.error(
            "storage.delete_failed", bucket=bucket, key=key, error=str(exc)
        )
        raise StorageError(
            f"Could not delete object '{key}' from bucket '{bucket}': {exc}"
        ) from exc

    logger.info("storage.deleted", bucket=bucket, key=key)


def object_exists(bucket: str, key: str) -> bool:
    """Return True when ``bucket/key`` exists.

    Args:
        bucket: Bucket name.
        key: Object key.

    Raises:
        StorageError: If the existence check fails for a reason other than the
            object being absent.
    """
    from botocore.exceptions import BotoCoreError, ClientError

    client = get_s3_client()
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as exc:
        if _is_not_found(exc):
            return False
        logger.error(
            "storage.head_object_failed", bucket=bucket, key=key, error=str(exc)
        )
        raise StorageError(
            f"Could not check object '{key}' in bucket '{bucket}': {exc}"
        ) from exc
    except BotoCoreError as exc:
        logger.error(
            "storage.head_object_failed", bucket=bucket, key=key, error=str(exc)
        )
        raise StorageError(
            f"Could not check object '{key}' in bucket '{bucket}': {exc}"
        ) from exc


# ---------------------------------------------------------------------------
# Key building
# ---------------------------------------------------------------------------

# Anything that is not alphanumeric, dot, dash or underscore is replaced.
_UNSAFE_CHARS = re.compile(r"[^A-Za-z0-9._-]+")

DEFAULT_DATASET_FILENAME = "dataset"


def sanitize_filename(filename: str) -> str:
    """Return a filesystem/S3-safe basename derived from ``filename``.

    Strips any directory component (``/`` and ``\\``), removes ``..`` traversal
    segments and replaces every other unsafe character with ``_``.

    Args:
        filename: The user-supplied filename.

    Returns:
        A safe, non-empty basename.
    """
    candidate = (filename or "").strip()
    # Drop any path component, whatever separator the client used.
    candidate = candidate.replace("\\", "/").split("/")[-1]
    # Neutralise traversal attempts before the generic replacement.
    candidate = candidate.replace("..", "_")
    candidate = _UNSAFE_CHARS.sub("_", candidate)
    candidate = candidate.strip("._") or DEFAULT_DATASET_FILENAME
    # Keep keys reasonable; S3 allows 1024 bytes but there is no need for more.
    return candidate[:180]


def build_dataset_key(repo_id: int, filename: str) -> str:
    """Build the object key for a dataset uploaded to ``repo_id``.

    The key has the shape ``repo-{repo_id}/{uuid4}/{sanitized filename}`` so
    every upload lands in its own prefix and re-uploading the same filename
    never overwrites a previous dataset.

    Args:
        repo_id: Owning repository ID.
        filename: Original filename as sent by the client.

    Returns:
        The object key.
    """
    return f"repo-{repo_id}/{uuid.uuid4()}/{sanitize_filename(filename)}"
