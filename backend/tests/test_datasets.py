"""Tests for the dataset endpoints (/repos/{id}/datasets and /datasets/{id}).

MinIO is fully mocked: every ``core.storage`` helper used by the router is
patched, so these tests never touch the network or a real S3 endpoint.
"""
from __future__ import annotations

import io
from unittest.mock import MagicMock, patch

import pytest

from tests.conftest import seed_dataset, seed_repo


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def mock_storage():
    """Patch every storage helper imported into routers.datasets.

    Yields a namespace-like MagicMock with ``upload``, ``delete``, ``download``
    and ``build_key`` attributes.
    """
    with (
        patch("routers.datasets.upload_fileobj") as upload,
        patch("routers.datasets.delete_object") as delete,
        patch("routers.datasets.download_to_path") as download,
        patch(
            "routers.datasets.build_dataset_key",
            side_effect=lambda repo_id, filename: f"repo-{repo_id}/fixed-uuid/{filename}",
        ) as build_key,
    ):
        bundle = MagicMock()
        bundle.upload = upload
        bundle.delete = delete
        bundle.download = download
        bundle.build_key = build_key
        yield bundle


def _bucket() -> str:
    """Return the datasets bucket configured for the test environment."""
    from core.config import get_settings

    return get_settings().minio_bucket_datasets


def _upload(test_app, repo_id: int, filename: str = "train.csv", content: bytes = b"a,b\n1,2\n"):
    """POST a multipart dataset upload and return the response."""
    return test_app.post(
        f"/repos/{repo_id}/datasets",
        files={"file": (filename, io.BytesIO(content), "text/csv")},
        data={"description": "my dataset"},
    )


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

class TestUploadDataset:
    """POST /repos/{repo_id}/datasets"""

    def test_upload_when_valid_should_return_201_and_store_object(
        self, test_app, db_session, mock_storage
    ):
        repo = seed_repo(db_session)

        resp = _upload(test_app, repo.id)

        assert resp.status_code == 201
        data = resp.json()
        assert data["repo_id"] == repo.id
        assert data["name"] == "train.csv"
        assert data["description"] == "my dataset"
        assert data["is_active"] is True
        assert data["size_bytes"] == len(b"a,b\n1,2\n")
        # sha256 of the uploaded bytes
        assert len(data["checksum"]) == 64
        assert data["object_key"] == f"repo-{repo.id}/fixed-uuid/train.csv"

        mock_storage.upload.assert_called_once()
        args = mock_storage.upload.call_args.args
        assert args[0] == _bucket()
        assert args[1] == data["object_key"]

    def test_upload_when_previous_dataset_exists_should_deactivate_it(
        self, test_app, db_session, mock_storage
    ):
        repo = seed_repo(db_session)
        old_id = seed_dataset(db_session, repo.id, name="old.csv", is_active=True).id

        resp = _upload(test_app, repo.id, filename="new.csv")

        assert resp.status_code == 201
        assert resp.json()["is_active"] is True

        db_session.expunge_all()
        from sqlmodel import select

        from models.schemas import Dataset

        refreshed_old = db_session.get(Dataset, old_id)
        assert refreshed_old is not None
        assert refreshed_old.is_active is False

        actives = [d for d in db_session.exec(select(Dataset)).all() if d.is_active]
        assert len(actives) == 1
        assert actives[0].name == "new.csv"

    def test_upload_when_repo_missing_should_return_404(self, test_app, mock_storage):
        resp = _upload(test_app, 99999)

        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()
        mock_storage.upload.assert_not_called()

    def test_upload_when_extension_not_allowed_should_return_415(
        self, test_app, db_session, mock_storage
    ):
        repo = seed_repo(db_session)

        resp = test_app.post(
            f"/repos/{repo.id}/datasets",
            files={"file": ("model.exe", io.BytesIO(b"MZ"), "application/octet-stream")},
        )

        assert resp.status_code == 415
        assert ".csv" in resp.json()["detail"]
        mock_storage.upload.assert_not_called()

    def test_upload_when_too_large_should_return_413(
        self, test_app, db_session, mock_storage
    ):
        from core.config import AppSettings, get_settings
        from main import app

        repo = seed_repo(db_session)
        small_limit = AppSettings(database_url="sqlite://", dataset_max_size_mb=1)
        app.dependency_overrides[get_settings] = lambda: small_limit

        try:
            resp = _upload(
                test_app,
                repo.id,
                filename="big.csv",
                content=b"x" * (2 * 1024 * 1024),
            )
        finally:
            app.dependency_overrides.pop(get_settings, None)

        assert resp.status_code == 413
        assert "size" in resp.json()["detail"].lower()
        mock_storage.upload.assert_not_called()

    def test_upload_when_empty_file_should_return_422(
        self, test_app, db_session, mock_storage
    ):
        repo = seed_repo(db_session)

        resp = _upload(test_app, repo.id, content=b"")

        assert resp.status_code == 422
        mock_storage.upload.assert_not_called()


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

class TestListDatasets:
    """GET /repos/{repo_id}/datasets"""

    def test_list_when_datasets_exist_should_return_newest_first(
        self, test_app, db_session
    ):
        from datetime import datetime, timezone

        repo = seed_repo(db_session)
        seed_dataset(
            db_session,
            repo.id,
            name="older.csv",
            is_active=False,
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
        seed_dataset(
            db_session,
            repo.id,
            name="newer.csv",
            is_active=True,
            created_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
        )

        resp = test_app.get(f"/repos/{repo.id}/datasets")

        assert resp.status_code == 200
        names = [d["name"] for d in resp.json()]
        assert names == ["newer.csv", "older.csv"]

    def test_list_when_repo_has_no_datasets_should_return_empty_list(
        self, test_app, db_session
    ):
        repo = seed_repo(db_session)

        resp = test_app.get(f"/repos/{repo.id}/datasets")

        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_when_repo_missing_should_return_404(self, test_app):
        resp = test_app.get("/repos/99999/datasets")

        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Activate
# ---------------------------------------------------------------------------

class TestActivateDataset:
    """POST /datasets/{dataset_id}/activate"""

    def test_activate_should_enable_target_and_disable_siblings(
        self, test_app, db_session
    ):
        repo = seed_repo(db_session)
        current_id = seed_dataset(db_session, repo.id, name="current.csv", is_active=True).id
        target_id = seed_dataset(db_session, repo.id, name="target.csv", is_active=False).id

        resp = test_app.post(f"/datasets/{target_id}/activate")

        assert resp.status_code == 200
        assert resp.json()["is_active"] is True
        assert resp.json()["id"] == target_id

        db_session.expunge_all()
        from models.schemas import Dataset

        assert db_session.get(Dataset, current_id).is_active is False
        assert db_session.get(Dataset, target_id).is_active is True

    def test_activate_should_not_touch_other_repos(self, test_app, db_session):
        repo_a = seed_repo(db_session, github_url="https://github.com/u/a")
        repo_b = seed_repo(db_session, github_url="https://github.com/u/b")
        other_id = seed_dataset(db_session, repo_b.id, name="b.csv", is_active=True).id
        target_id = seed_dataset(db_session, repo_a.id, name="a.csv", is_active=False).id

        resp = test_app.post(f"/datasets/{target_id}/activate")

        assert resp.status_code == 200
        db_session.expunge_all()
        from models.schemas import Dataset

        assert db_session.get(Dataset, other_id).is_active is True

    def test_activate_when_dataset_missing_should_return_404(self, test_app):
        resp = test_app.post("/datasets/99999/activate")

        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

class TestDeleteDataset:
    """DELETE /datasets/{dataset_id}"""

    def test_delete_should_remove_object_and_row(
        self, test_app, db_session, mock_storage
    ):
        repo = seed_repo(db_session)
        dataset = seed_dataset(db_session, repo.id)
        dataset_id, bucket, object_key = dataset.id, dataset.bucket, dataset.object_key

        resp = test_app.delete(f"/datasets/{dataset_id}")

        assert resp.status_code == 200
        assert "deleted" in resp.json()["message"].lower()
        mock_storage.delete.assert_called_once_with(bucket, object_key)

        db_session.expunge_all()
        from models.schemas import Dataset

        assert db_session.get(Dataset, dataset_id) is None

    def test_delete_when_storage_fails_should_still_remove_row(
        self, test_app, db_session, mock_storage
    ):
        from core.storage import StorageError

        repo = seed_repo(db_session)
        dataset = seed_dataset(db_session, repo.id)
        dataset_id = dataset.id
        mock_storage.delete.side_effect = StorageError("MinIO unreachable")

        resp = test_app.delete(f"/datasets/{dataset_id}")

        assert resp.status_code == 200
        db_session.expunge_all()
        from models.schemas import Dataset

        assert db_session.get(Dataset, dataset_id) is None

    def test_delete_when_dataset_missing_should_return_404(self, test_app, mock_storage):
        resp = test_app.delete("/datasets/99999")

        assert resp.status_code == 404
        mock_storage.delete.assert_not_called()


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

class TestPreviewDataset:
    """GET /datasets/{dataset_id}/preview"""

    def test_preview_when_csv_should_return_columns_and_rows(
        self, test_app, db_session, mock_storage
    ):
        repo = seed_repo(db_session)
        dataset = seed_dataset(db_session, repo.id, name="train.csv")

        def _fake_download(bucket, key, dest_path):
            with open(dest_path, "w", encoding="utf-8") as handle:
                handle.write("a,b\n1,2\n3,4\n")
            return dest_path

        mock_storage.download.side_effect = _fake_download

        resp = test_app.get(f"/datasets/{dataset.id}/preview")

        assert resp.status_code == 200
        data = resp.json()
        assert data["dataset_id"] == dataset.id
        assert data["columns"] == ["a", "b"]
        assert data["rows"] == [[1, 2], [3, 4]]
        assert data["truncated"] is False

    def test_preview_when_unparsable_should_return_422(
        self, test_app, db_session, mock_storage
    ):
        repo = seed_repo(db_session)
        dataset = seed_dataset(db_session, repo.id, name="broken.parquet")

        def _fake_download(bucket, key, dest_path):
            with open(dest_path, "wb") as handle:
                handle.write(b"not-a-parquet-file")
            return dest_path

        mock_storage.download.side_effect = _fake_download

        resp = test_app.get(f"/datasets/{dataset.id}/preview")

        assert resp.status_code == 422
        assert resp.json()["detail"]

    def test_preview_when_object_missing_should_return_404(
        self, test_app, db_session, mock_storage
    ):
        from core.storage import ObjectNotFoundError

        repo = seed_repo(db_session)
        dataset = seed_dataset(db_session, repo.id)
        mock_storage.download.side_effect = ObjectNotFoundError("gone")

        resp = test_app.get(f"/datasets/{dataset.id}/preview")

        assert resp.status_code == 404


class TestUploadProfiling:
    """An upload must describe itself the same way an extraction does.

    The UI offers both as ways of getting data in; if one produced a profile
    and the other did not, everything downstream would have to ask which door
    a dataset came through before knowing what it could rely on.
    """

    def test_a_csv_upload_is_profiled(self, test_app, db_session, mock_storage):
        from tests.conftest import DEFAULT_USER_ID, seed_repo

        repo = seed_repo(db_session, owner_id=DEFAULT_USER_ID)
        content = b"age,city\n31,Bogota\n44,Medellin\n29,Bogota\n"

        resp = test_app.post(
            f"/repos/{repo.id}/datasets",
            files={"file": ("people.csv", content, "text/csv")},
        )

        assert resp.status_code == 201
        body = resp.json()
        assert body["origin"] == "upload"
        assert body["profiled_rows"] == 3
        assert set(body["profile"]) == {"age", "city"}
        assert body["profile"]["age"]["inferred_type"] == "numeric"
        assert body["profile"]["city"]["distinct"] == 2

    def test_an_upload_has_no_ingestion_run(self, test_app, db_session, mock_storage):
        from tests.conftest import DEFAULT_USER_ID, seed_repo

        repo = seed_repo(db_session, owner_id=DEFAULT_USER_ID)
        resp = test_app.post(
            f"/repos/{repo.id}/datasets",
            files={"file": ("x.csv", b"a\n1\n", "text/csv")},
        )
        assert resp.json()["ingestion_run_id"] is None

    def test_an_unparseable_file_is_still_stored(self, test_app, db_session, mock_storage):
        """Profiling is best-effort: the notebook may read what pandas cannot."""
        from tests.conftest import DEFAULT_USER_ID, seed_repo

        repo = seed_repo(db_session, owner_id=DEFAULT_USER_ID)
        resp = test_app.post(
            f"/repos/{repo.id}/datasets",
            files={"file": ("broken.parquet", b"not really parquet", "application/octet-stream")},
        )

        assert resp.status_code == 201, "a profile failure must not reject the upload"
        assert resp.json()["profile"] == {}
        assert resp.json()["profiled_rows"] == 0
