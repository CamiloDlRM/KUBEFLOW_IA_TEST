"""Tests for encryption at rest and for deleting a source's data in every layer.

What is pinned: with encryption off the storage layer behaves exactly as
before; with it on, every upload and every new bucket asks MinIO to encrypt,
and a MinIO that refuses is reported rather than fatal. The panel's numbers
are MinIO's own. Deleting a source removes its objects from every layer and
every gold build, rebuilds gold from what remains, and keeps the record of
who asked and why.
"""
from __future__ import annotations

import io
from unittest.mock import MagicMock, patch

import pyarrow.parquet as pq
import pytest
from botocore.exceptions import ClientError
from sqlmodel import select

from core import storage
from core.config import get_settings
from models.schemas import Dataset, DataSource, GoldTable, IngestionRun
from tests.test_cleaning_recipe import land_upload
from tests.test_ingestion_task import FakeObjectStore
from tests.test_medallion_api import own_project  # noqa: F401
from tests.test_privacy import PATIENTS, mark_health, worker

VISITS = "visit,patient_id,reason\nV1,P1,checkup\nV2,P2,fever\n"


@pytest.fixture()
def encrypting(monkeypatch):
    monkeypatch.setattr(get_settings(), "storage_encryption", True)


def client() -> MagicMock:
    mock = MagicMock()
    mock.head_bucket.return_value = {}
    return mock


# ---------------------------------------------------------------------------
# The storage layer
# ---------------------------------------------------------------------------


class TestEncryptionAtRest:
    def test_off_uploads_exactly_as_before(self):
        mock = client()
        with patch("core.storage.get_s3_client", return_value=mock):
            storage.upload_fileobj("bronze", "k", io.BytesIO(b"x"), "text/csv")

        assert mock.upload_fileobj.call_args.kwargs["ExtraArgs"] == {"ContentType": "text/csv"}

    def test_on_every_upload_asks_for_encryption(self, encrypting):
        mock = client()
        with patch("core.storage.get_s3_client", return_value=mock):
            storage.upload_fileobj("bronze", "k", io.BytesIO(b"x"), "text/csv")

        assert mock.upload_fileobj.call_args.kwargs["ExtraArgs"]["ServerSideEncryption"] == "AES256"

    def test_on_a_new_bucket_encrypts_by_default(self, encrypting):
        mock = client()
        mock.head_bucket.side_effect = ClientError({"Error": {"Code": "404"}}, "HeadBucket")
        with patch("core.storage.get_s3_client", return_value=mock):
            storage.ensure_bucket("gold")

        rules = mock.put_bucket_encryption.call_args.kwargs["ServerSideEncryptionConfiguration"]["Rules"]
        assert rules[0]["ApplyServerSideEncryptionByDefault"]["SSEAlgorithm"] == "AES256"

    def test_a_minio_without_a_key_is_reported_not_fatal(self, encrypting):
        mock = client()
        mock.put_bucket_encryption.side_effect = [None, ClientError({"Error": {"Code": "NotImplemented"}}, "Put")]
        with patch("core.storage.get_s3_client", return_value=mock):
            outcome = storage.encrypt_platform_buckets(["bronze", "silver"])

        assert outcome["bronze"] == "encrypted"
        assert outcome["silver"].startswith("failed")

    def test_minio_says_what_is_encrypted(self):
        mock = client()
        mock.get_bucket_encryption.side_effect = [
            {"ServerSideEncryptionConfiguration": {"Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]}},
            ClientError({"Error": {"Code": "ServerSideEncryptionConfigurationNotFoundError"}}, "Get"),
        ]
        mock.head_object.side_effect = [{"ServerSideEncryption": "AES256"}, {}, ClientError({"Error": {"Code": "500"}}, "Head")]
        with patch("core.storage.get_s3_client", return_value=mock):
            assert storage.bucket_encryption("bronze") == "AES256"
            assert storage.bucket_encryption("silver") == "none"
            assert [storage.object_encrypted("b", key) for key in "xyz"] == [True, False, None]


class TestEncryptionApi:
    def test_it_applies_to_health_projects(self, test_app, own_project):
        assert test_app.get(f"/projects/{own_project.id}/privacy/encryption").status_code == 409

    def test_the_numbers_are_minios(self, test_app, db_session, own_project):
        mark_health(db_session, own_project)
        objects = [("bronze", "a"), ("silver", "b"), ("gold", "c")]

        with patch("core.privacy.project_objects", return_value=objects), \
             patch("core.storage.bucket_encryption", return_value="AES256"), \
             patch("core.storage.object_encrypted", side_effect=[True, False, None]):
            body = test_app.get(f"/projects/{own_project.id}/privacy/encryption").json()

        assert (body["objects"], body["encrypted"], body["unknown"]) == (3, 1, 1)
        assert body["buckets"]["bronze"] == "AES256"
        assert body["enabled"] is False

    def test_encrypting_needs_the_deployment_to_support_it(self, test_app, db_session, own_project):
        mark_health(db_session, own_project)

        response = test_app.post(f"/projects/{own_project.id}/privacy/encrypt")

        assert response.status_code == 409
        assert "docker-compose.encryption.yml" in response.json()["detail"]

    def test_encrypting_is_queued(self, test_app, db_session, own_project, encrypting):
        mark_health(db_session, own_project)

        with patch("tasks.celery_tasks.encrypt_project.apply_async") as queued:
            response = test_app.post(f"/projects/{own_project.id}/privacy/encrypt")

        assert response.status_code == 202
        queued.assert_called_once_with(args=[own_project.id])

    def test_only_what_is_not_encrypted_is_rewritten(self, db_session, db_engine, own_project):
        from tasks.celery_tasks import encrypt_project

        mark_health(db_session, own_project)
        objects = [("bronze", "a"), ("silver", "b"), ("gold", "c")]

        with patch("sqlmodel.create_engine", return_value=db_engine), \
             patch("core.privacy.project_objects", return_value=objects), \
             patch("core.storage.object_encrypted", side_effect=[True, False, None]), \
             patch("core.storage.encrypt_object") as rewrite:
            result = encrypt_project(own_project.id)

        assert result == {"status": "success", "objects": 3, "encrypted": 1}
        rewrite.assert_called_once_with("silver", "b")
        db_session.refresh(own_project)
        assert own_project.privacy["encryption"]["status"] == "success"


# ---------------------------------------------------------------------------
# Deleting a source's data
# ---------------------------------------------------------------------------


def two_sources(db_engine, db_session, project, tmp_path):
    store = FakeObjectStore()
    mark_health(db_session, project)
    patients = land_upload(db_engine, db_session, project, store, tmp_path, "patients.csv", PATIENTS)
    visits = land_upload(db_engine, db_session, project, store, tmp_path, "visits.csv", VISITS)
    return store, patients, visits


class TestPurgeApi:
    def test_it_applies_to_health_projects(self, test_app, db_session, own_project):
        source = DataSource(project_id=own_project.id, name="patients", kind="upload")
        db_session.add(source)
        db_session.commit()

        response = test_app.post(
            f"/projects/{own_project.id}/privacy/sources/{source.id}/purge",
            json={"reason": "Subject asked", "confirm": "patients"},
        )

        assert response.status_code == 409

    def test_the_name_must_be_typed(self, test_app, db_session, own_project):
        mark_health(db_session, own_project)
        source = DataSource(project_id=own_project.id, name="patients", kind="upload")
        db_session.add(source)
        db_session.commit()

        response = test_app.post(
            f"/projects/{own_project.id}/privacy/sources/{source.id}/purge",
            json={"reason": "Subject asked", "confirm": "patient"},
        )

        assert response.status_code == 422
        assert "'patients'" in response.json()["detail"]

    def test_a_request_is_recorded_and_queued(self, test_app, db_session, own_project):
        mark_health(db_session, own_project)
        source = DataSource(project_id=own_project.id, name="patients", kind="upload")
        db_session.add(source)
        db_session.commit()

        with patch("tasks.celery_tasks.purge_source.apply_async") as queued:
            body = test_app.post(
                f"/projects/{own_project.id}/privacy/sources/{source.id}/purge",
                json={"reason": "The data subjects withdrew consent", "confirm": "patients"},
            ).json()

        entry = body["purges"][0]
        assert entry["status"] == "queued" and entry["reason"] == "The data subjects withdrew consent"
        assert entry["requested_by"]
        queued.assert_called_once_with(args=[own_project.id, source.id, entry["id"]])

    def test_another_members_project_is_not_found(self, other_member_app, db_session, own_project):
        mark_health(db_session, own_project)

        response = other_member_app.post(
            f"/projects/{own_project.id}/privacy/sources/1/purge", json={"reason": "why not", "confirm": "x"}
        )

        assert response.status_code == 404


class TestPurge:
    def test_a_source_is_gone_from_every_layer_and_gold_is_rebuilt_without_it(
        self, db_session, db_engine, own_project, tmp_path
    ):
        from core import medallion
        from tasks.celery_tasks import purge_source

        store, patients, visits = two_sources(db_engine, db_session, own_project, tmp_path)
        old_gold = {key for bucket, key in store.objects if bucket == medallion.bucket_for("gold")}
        own_project.privacy = {**own_project.privacy, "purges": [{"id": "p1", "source_id": patients.source_id}]}
        db_session.add(own_project)
        db_session.commit()

        with worker(db_engine, store):
            result = purge_source(own_project.id, patients.source_id, "p1")

        assert result["status"] == "success", result
        prefix = medallion.stream_prefix(own_project.id, patients.source_id)
        assert not [key for _, key in store.objects if key.startswith(prefix)]
        assert not [key for _, key in store.objects if "patients" in key], "the original upload is deleted"
        gold = [key for bucket, key in store.objects if bucket == medallion.bucket_for("gold")]
        assert len(gold) == 1 and gold[0] not in old_gold
        rebuilt = pq.read_table(io.BytesIO(store.objects[(medallion.bucket_for("gold"), gold[0])]))
        assert "ssn" not in rebuilt.column_names and rebuilt.num_rows == 2
        db_session.refresh(patients)
        assert (patients.bronze_key, patients.silver_key, patients.quality_report) == ("", "", {"purged": True})
        assert db_session.get(DataSource, patients.source_id).is_active is False
        db_session.refresh(visits)
        assert visits.silver_key, "the other source is untouched"
        db_session.refresh(own_project)
        entry = own_project.privacy["purges"][0]
        assert entry["status"] == "success" and entry["deleted_objects"] > 0

    def test_deleting_the_last_source_leaves_no_gold(self, db_session, db_engine, own_project, tmp_path):
        from core import medallion
        from tasks.celery_tasks import purge_source

        store = FakeObjectStore()
        mark_health(db_session, own_project)
        patients = land_upload(db_engine, db_session, own_project, store, tmp_path, "patients.csv", PATIENTS)
        own_project.privacy = {**own_project.privacy, "purges": [{"id": "p1", "source_id": patients.source_id}]}
        db_session.add(own_project)
        db_session.commit()

        with worker(db_engine, store):
            result = purge_source(own_project.id, patients.source_id, "p1")

        assert result["status"] == "success", result
        assert not [key for bucket, key in store.objects if bucket == medallion.bucket_for("gold")]
        table = db_session.exec(select(GoldTable).where(GoldTable.project_id == own_project.id)).one()
        db_session.refresh(table)
        assert table.object_key == ""
        active = db_session.exec(
            select(Dataset).where(Dataset.project_id == own_project.id, Dataset.is_active == True)  # noqa: E712
        ).all()
        assert active == []
