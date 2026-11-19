"""Tests for health data: legal basis, and identity suppressed before bronze.

What is pinned: the detection finds the hospital's identifiers and leaves its
clinical data alone; pseudonyms are keyed, stable and never pseudonymised
twice; a health project refuses to exist without a legal basis and cannot go
back to general once data has landed; an upload to it is protected before
anything is stored; and what landed before it was marked is protected, with
what cannot be protected deleted.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from unittest.mock import patch

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from sqlmodel import select

from core.privacy import (
    LegalBasis,
    PrivacyError,
    PrivacyPolicy,
    ProjectPrivacy,
    classify,
    key_id,
    new_key,
    plan,
    protect_parquet,
    pseudonym,
    redact_profile,
)
from models.schemas import Dataset, DataSource, IngestionRun, Project
from tests.test_cleaning_recipe import land_upload, silver_rows
from tests.test_cleaning_recipe import worker as _worker
from tests.test_ingestion_task import FakeObjectStore
from tests.test_medallion_api import own_project, storage_patched, store  # noqa: F401


def worker(db_engine, store_):
    """The task patches, plus deleting from the fake store and the upload route's own import."""
    stack = _worker(db_engine, store_)
    stack.enter_context(
        patch("core.storage.delete_object", side_effect=lambda bucket, key: store_.objects.pop((bucket, key), None))
    )
    stack.enter_context(patch("routers.datasets.upload_fileobj", side_effect=store_.upload_fileobj))
    return stack

BASIS = {
    "kind": "synthetic",
    "purpose": "Validar la plataforma con un caso clínico",
    "reference": "Synthea sample, seed 20260911",
    "responsible": "Universidad del Norte",
}

PATIENTS = (
    "id,birthdate,ssn,first_name,last_name,address,zip,gender,income\n"
    "P1,1985-03-12,999-12-3456,Ana,Diaz,Calle 1,08001,F,1000\n"
    "P2,1990-07-01,999-65-4321,Luis,Gomez,Calle 2,08002,M,2000\n"
)


def mark_health(db_session, project, policy=None):
    project.privacy = {
        "classification": "health",
        "legal_basis": BASIS,
        "policy": policy or {"pseudonymize": [], "suppress": [], "keep": []},
    }
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)
    return project


def write_bronze(path, **columns):
    pq.write_table(pa.table({name: pa.array(values, type=pa.string()) for name, values in columns.items()}), path)
    return path


# ---------------------------------------------------------------------------
# What is detected
# ---------------------------------------------------------------------------


class TestDetection:
    @pytest.mark.parametrize(
        "column, action",
        [
            # The simulated hospital's identifiers.
            ("id", "pseudonymize"),
            ("patient_id", "pseudonymize"),
            ("encounter_id", "pseudonymize"),
            ("PATIENT", "pseudonymize"),
            ("ssn", "pseudonymize"),
            ("numero_documento", "pseudonymize"),
            ("cedula", "pseudonymize"),
            ("first_name", "suppress"),
            ("LAST", "suppress"),
            ("name", "suppress"),
            ("nombre_paciente", "suppress"),
            ("address", "suppress"),
            ("telefono", "suppress"),
            ("email", "suppress"),
            ("birthplace", "suppress"),
            ("LAT", "suppress"),
            ("birthdate", "year"),
            ("fecha_nacimiento", "year"),
            ("deathdate", "year"),
            ("zip", "zip3"),
            ("codigo_postal", "zip3"),
            # Clinical data, which is what the research is for.
            ("procedure_text", None),
            ("condition_code", None),
            ("drug_name", None),
            ("first_dose", None),
            ("recorded_at", None),
            ("started_at", None),
            ("gender", None),
            ("tipo_documento", None),
        ],
    )
    def test_identifiers_are_found_and_clinical_data_is_left(self, column, action):
        assert classify(column) == action

    def test_the_policy_adds_and_exempts(self):
        policy = PrivacyPolicy(pseudonymize=("Historia",), suppress=("city",), keep=("zip",))

        assert plan(["historia", "City", "zip", "ssn"], policy) == {
            "historia": "pseudonymize",
            "City": "suppress",
            "ssn": "pseudonymize",
        }

    def test_a_column_cannot_be_both_kept_and_protected(self):
        with pytest.raises(PrivacyError, match="both kept and protected"):
            PrivacyPolicy.from_dict({"keep": ["zip"], "suppress": ["ZIP"]})

    @pytest.mark.parametrize("missing", ["purpose", "reference", "responsible"])
    def test_a_legal_basis_says_all_of_what_backs_it(self, missing):
        with pytest.raises(PrivacyError, match="required"):
            LegalBasis.from_dict({**BASIS, missing: " "})

    def test_an_unreadable_classification_fails_safe(self):
        assert ProjectPrivacy.from_stored({"classification": "health-ish"}).health


# ---------------------------------------------------------------------------
# What is done
# ---------------------------------------------------------------------------


class TestProtection:
    def test_a_pseudonym_is_keyed_and_stable(self):
        key, other = new_key(), new_key()

        assert pseudonym("999-12-3456", key) == pseudonym(" 999-12-3456 ", key)
        assert pseudonym("999-12-3456", key) != pseudonym("999-12-3456", other)
        assert pseudonym("999-12-3456", key).startswith("ps_")
        assert key_id(key) != key_id(other)

    def test_bronze_is_rewritten_without_identity(self, tmp_path):
        key = new_key()
        path = write_bronze(
            tmp_path / "patients.parquet",
            id=["P1", "P2"], birthdate=["1985-03-12", None], first_name=["Ana", "Luis"],
            zip=["08001", "08002"], gender=["F", "M"],
        )

        report = protect_parquet(path, key)

        rows = pq.read_table(path).to_pylist()
        assert set(rows[0]) == {"id", "birthdate", "zip", "gender"}
        assert rows[0]["id"] == pseudonym("P1", key)
        assert [row["birthdate"] for row in rows] == ["1985", None]
        assert rows[0]["zip"] == "080"
        assert rows[0]["gender"] == "F"
        assert report.suppressed == ["first_name"]
        assert report.generalized == {"birthdate": "year", "zip": "zip3"}

    def test_tables_still_join_after_protection(self, tmp_path):
        key = new_key()
        patients = protect_parquet(write_bronze(tmp_path / "p.parquet", id=["P1"]), key)
        encounters = write_bronze(tmp_path / "e.parquet", patient_id=["P1", "P1"], encounter_text=["a", "b"])
        protect_parquet(encounters, key)

        assert patients.pseudonymized == ["id"]
        assert pq.read_table(tmp_path / "p.parquet").column("id")[0].as_py() == (
            pq.read_table(encounters).column("patient_id")[0].as_py()
        )

    def test_protecting_twice_changes_nothing(self, tmp_path):
        key = new_key()
        path = write_bronze(tmp_path / "x.parquet", ssn=["1"], birthdate=["1985-03-12"], zip=["08001"])
        protect_parquet(path, key)
        once = pq.read_table(path).to_pylist()

        protect_parquet(path, key)

        assert pq.read_table(path).to_pylist() == once

    def test_a_profile_keeps_no_values_of_a_protected_column(self):
        profile = {
            "ssn": {"count": 2, "top_values": [{"value": "999-12-3456", "count": 1}]},
            "first_name": {"count": 2, "top_values": [{"value": "Ana", "count": 1}]},
            "gender": {"count": 2, "top_values": [{"value": "F", "count": 1}]},
        }

        redacted = redact_profile(profile, {"ssn": "pseudonymize", "first_name": "suppress"})

        assert "first_name" not in redacted
        assert "top_values" not in redacted["ssn"] and redacted["ssn"]["protected"] == "pseudonymize"
        assert redacted["gender"] == profile["gender"]


# ---------------------------------------------------------------------------
# The API
# ---------------------------------------------------------------------------


class TestApi:
    def test_a_project_is_general_until_marked(self, test_app, own_project):
        body = test_app.get(f"/projects/{own_project.id}/privacy").json()

        assert body["classification"] == "general"
        assert body["legal_basis"] is None
        assert {basis["kind"] for basis in body["legal_bases"]} == {"authorization", "scientific", "synthetic"}

    def test_health_data_needs_its_legal_basis(self, test_app, db_session, own_project):
        response = test_app.put(f"/projects/{own_project.id}/privacy", json={"classification": "health"})

        assert response.status_code == 422
        db_session.refresh(own_project)
        assert ProjectPrivacy.from_stored(own_project.privacy).health is False

    def test_marking_records_the_basis_and_who_recorded_it(self, test_app, db_session, own_project):
        body = test_app.put(
            f"/projects/{own_project.id}/privacy", json={"classification": "health", "legal_basis": BASIS}
        ).json()

        assert body["classification"] == "health"
        assert body["legal_basis"]["reference"] == BASIS["reference"]
        assert body["legal_basis"]["recorded_by"]
        assert body["legal_basis"]["recorded_at"]

    def test_the_key_is_never_returned(self, test_app, db_session, own_project):
        from core.config import get_settings
        from core.privacy import project_key

        mark_health(db_session, own_project)
        key = project_key(db_session, own_project, get_settings())

        text = test_app.get(f"/projects/{own_project.id}/privacy").text

        assert key not in text and "pseudonym_key" not in text

    def test_marking_a_project_with_data_queues_its_protection(
        self, test_app, db_session, own_project, db_engine, tmp_path
    ):
        land_upload(db_engine, db_session, own_project, FakeObjectStore(), tmp_path, "patients.csv", PATIENTS)

        with patch("tasks.celery_tasks.protect_project.apply_async") as queued:
            body = test_app.put(
                f"/projects/{own_project.id}/privacy", json={"classification": "health", "legal_basis": BASIS}
            ).json()

        queued.assert_called_once_with(args=[own_project.id])
        assert body["protection"]["status"] == "queued"
        assert body["unprotected_runs"] >= 1
        columns = {column["column"]: column["action"] for column in body["sources"][0]["columns"]}
        assert columns["ssn"] == "pseudonymize" and columns["first_name"] == "suppress"

    def test_health_data_stays_health_data(self, test_app, db_session, own_project, db_engine, tmp_path):
        land_upload(db_engine, db_session, own_project, FakeObjectStore(), tmp_path, "patients.csv", PATIENTS)
        mark_health(db_session, own_project)

        response = test_app.put(f"/projects/{own_project.id}/privacy", json={"classification": "general"})

        assert response.status_code == 409

    def test_protecting_a_general_project_is_refused(self, test_app, own_project):
        assert test_app.post(f"/projects/{own_project.id}/privacy/protect").status_code == 409

    def test_another_members_project_is_not_found(self, other_member_app, own_project):
        assert other_member_app.get(f"/projects/{own_project.id}/privacy").status_code == 404
        assert other_member_app.put(
            f"/projects/{own_project.id}/privacy", json={"classification": "health", "legal_basis": BASIS}
        ).status_code == 404


# ---------------------------------------------------------------------------
# Landing health data
# ---------------------------------------------------------------------------


class TestLanding:
    def test_an_upload_is_protected_before_it_is_stored(
        self, test_app, db_session, db_engine, own_project, storage_patched
    ):
        from tasks.celery_tasks import ingest_upload

        mark_health(db_session, own_project)

        with patch("routers.datasets.upload_fileobj", side_effect=storage_patched.upload_fileobj):
            response = test_app.post(
                f"/projects/{own_project.id}/datasets",
                files={"file": ("patients.csv", PATIENTS.encode(), "text/csv")},
            )

        assert response.status_code == 201, response.text
        upload = db_session.get(Dataset, response.json()["id"])
        assert upload.object_key.endswith(".parquet")
        assert upload.privacy["protected"] and "first_name" in upload.privacy["suppressed"]
        stored = storage_patched.objects[(upload.bucket, upload.object_key)]
        for identifier in (b"Ana", b"999-12-3456", b"Calle 1"):
            assert identifier not in stored, "the original is never stored"
        assert "first_name" not in upload.profile
        assert "top_values" not in upload.profile["ssn"]

        with worker(db_engine, storage_patched):
            result = ingest_upload(upload.id)

        assert result["status"] == "success", result
        db_session.refresh(upload)
        run = db_session.get(IngestionRun, upload.ingestion_run_id)
        assert run.privacy["protected"]
        rows = silver_rows(storage_patched, run)
        assert rows[0]["ssn"].startswith("ps_")
        assert "first_name" not in rows[0]
        assert rows[0]["birthdate"] == 1985

    def test_an_extraction_is_protected_before_bronze(self, db_session, db_engine, own_project, tmp_path):
        import structlog

        from tasks.celery_tasks import _protect_landing

        mark_health(db_session, own_project)
        bronze = write_bronze(tmp_path / "b.parquet", patient_id=["P1"], last_name=["Diaz"], encounter_text=["x"])

        with patch("sqlmodel.create_engine", return_value=db_engine):
            report = _protect_landing(db_engine, own_project.id, bronze, structlog.get_logger())

        assert report["pseudonymized"] == ["patient_id"] and report["suppressed"] == ["last_name"]
        assert pq.read_table(bronze).column_names == ["patient_id", "encounter_text"]

    def test_a_general_project_lands_as_before(self, db_session, db_engine, own_project, tmp_path):
        import structlog

        from tasks.celery_tasks import _protect_landing

        bronze = write_bronze(tmp_path / "b.parquet", last_name=["Diaz"])

        assert _protect_landing(db_engine, own_project.id, bronze, structlog.get_logger()) == {}
        assert pq.read_table(bronze).column_names == ["last_name"]


class TestProtectingWhatLanded:
    def test_everything_stored_is_protected_and_the_rest_deleted(
        self, db_session, db_engine, own_project, tmp_path
    ):
        from core import medallion
        from tasks.celery_tasks import protect_project

        store_ = FakeObjectStore()
        first = land_upload(db_engine, db_session, own_project, store_, tmp_path, "patients.csv", PATIENTS)
        land_upload(db_engine, db_session, own_project, store_, tmp_path, "patients.csv", PATIENTS)
        old_gold = [key for bucket, key in store_.objects if bucket == medallion.bucket_for("gold")]
        assert len(old_gold) == 2
        mark_health(db_session, own_project)

        with worker(db_engine, store_):
            result = protect_project(own_project.id)

        assert result["status"] == "success", result
        everything = b"".join(store_.objects.values())
        for identifier in (b"Ana", b"Luis", b"999-12-3456", b"Calle 1"):
            assert identifier not in everything, f"{identifier!r} survived somewhere"
        db_session.refresh(first)
        assert first.privacy["protected"]
        assert silver_rows(store_, first)[0]["ssn"].startswith("ps_")
        assert "Diaz" not in str(first.quality_report)
        gold_now = [key for bucket, key in store_.objects if bucket == medallion.bucket_for("gold")]
        assert len(gold_now) == 1 and gold_now[0] not in old_gold
        uploads = db_session.exec(
            select(Dataset).where(Dataset.project_id == own_project.id, Dataset.origin == "upload")
        ).all()
        assert all(upload.privacy.get("purged") for upload in uploads)
        db_session.refresh(own_project)
        assert own_project.privacy["protection"]["status"] == "success"
        active = db_session.exec(
            select(Dataset).where(Dataset.project_id == own_project.id, Dataset.is_active == True)  # noqa: E712
        ).all()
        assert len(active) == 1 and active[0].object_key == gold_now[0]

    def test_it_refuses_a_general_project(self, db_session, db_engine, own_project):
        from tasks.celery_tasks import protect_project

        with worker(db_engine, FakeObjectStore()):
            result = protect_project(own_project.id)

        assert result["status"] == "failed"
        db_session.refresh(own_project)
        assert own_project.privacy["protection"]["status"] == "failed"
