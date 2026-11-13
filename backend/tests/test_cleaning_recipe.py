"""Tests for a source choosing how the cleaning standard is applied to it.

Three promises are pinned. The empty recipe *is* the standard, so nothing
changes for a source nobody configured. Each option does what it says and
nothing else — and the two that can lose data are counted and named as lossy.
And a run is replayed with the recipe it was cleaned with, not today's.
"""
from __future__ import annotations

from datetime import date
from unittest.mock import patch

import pytest

from core.cleaning import (
    RULES,
    STANDARD,
    CleaningRecipe,
    RecipeError,
    Table,
    clean,
)
from models.schemas import DataSource, Dataset, IngestionRun
from tests.conftest import seed_project
from tests.test_ingestion_task import FakeObjectStore

# Fixtures for the step-by-step replay, reused from the medallion API tests.
from tests.test_medallion_api import (  # noqa: F401
    diffed,
    other_project,
    own_project,
    storage_patched,
    store,
)


def table(**columns: list) -> Table:
    return Table(columns=list(columns), data={name: list(values) for name, values in columns.items()})


def recipe(**options) -> CleaningRecipe:
    return CleaningRecipe.from_dict(options)


def outcome(report, rule: str):
    return next(item for item in report.outcomes if item.rule == rule)


# ---------------------------------------------------------------------------
# The default
# ---------------------------------------------------------------------------


class TestTheStandardIsTheDefault:
    def test_the_empty_recipe_is_the_standard(self):
        assert CleaningRecipe.from_dict({}) is STANDARD
        assert CleaningRecipe.from_dict(None) is STANDARD

    def test_a_recipe_survives_the_round_trip_through_json(self):
        custom = recipe(disabled=["fold_categories"], null_tokens=["unknown"], force_types={"dose": "integer"})
        assert CleaningRecipe.from_dict(custom.as_dict()) == custom
        assert CleaningRecipe.from_dict(STANDARD.as_dict()) == STANDARD

    def test_no_recipe_and_the_standard_clean_identically(self):
        rows = dict(Sex=["F", " m ", "F"], Edad=["44", "N/A", "44"], Dept=["Cardio", "cardio", "Cardio"])
        plain, _ = clean(table(**rows))
        explicit, _ = clean(table(**rows), recipe=STANDARD)
        assert plain.summary() == explicit.summary()

    def test_the_report_carries_the_recipe_it_was_made_with(self):
        custom = recipe(disabled=["fold_categories"])
        report, _ = clean(table(a=["x"]), recipe=custom)
        assert report.summary()["recipe"] == custom.as_dict()


# ---------------------------------------------------------------------------
# Each option
# ---------------------------------------------------------------------------


class TestOptions:
    def test_a_rule_turned_off_does_nothing_and_says_so(self):
        data = table(name=["  padded  "])
        report, _ = clean(data, recipe=recipe(disabled=["trim_whitespace"]))

        assert data.data["name"] == ["  padded  "]
        skipped = outcome(report, "trim_whitespace")
        assert skipped.skipped and "Turned off" in skipped.note
        summary = report.summary()
        assert any(rule["rule"] == "trim_whitespace" and rule["skipped"] for rule in summary["rules"])
        assert summary["rules_applied"] == len(RULES) - 1

    def test_placeholders_are_the_recipes(self):
        data = table(smoker=["unknown", "-", "yes"])
        clean(data, recipe=recipe(null_tokens=["unknown"], disabled=["cast_types"]))
        # "unknown" is now a placeholder; "-" no longer is.
        assert data.data["smoker"] == [None, "-", "yes"]

    def test_a_column_can_be_kept_as_text(self):
        data = table(ward=["01", "02"], beds=["10", "20"])
        report, _ = clean(data, recipe=recipe(keep_as_text=["beds"]))
        assert data.data["beds"] == ["10", "20"]
        assert report.types["beds"] == "string"

    def test_a_forced_type_nulls_what_does_not_fit_and_counts_it(self):
        data = table(dose=["10", "20", "pending"])
        report, _ = clean(data, recipe=recipe(force_types={"dose": "integer"}))

        assert data.data["dose"] == [10, 20, None]
        cast = outcome(report, "cast_types")
        assert cast.cells_changed == 1
        assert {"column": "dose", "before": "pending", "after": None} in cast.examples
        assert "1 value(s) that did not fit became null" in cast.note
        assert report.lossy and "dose → integer" in report.lossy[0]

    def test_a_forced_date_reads_iso_dates(self):
        data = table(admitted=["2026-01-05", "2026-02-10T08:00:00", "soon"])
        clean(data, recipe=recipe(force_types={"admitted": "date"}))
        assert data.data["admitted"] == [date(2026, 1, 5), date(2026, 2, 10), None]

    def test_without_forcing_a_mixed_column_stays_text(self):
        """The standard's own promise, unchanged."""
        data = table(dose=["10", "20", "pending"])
        clean(data)
        assert data.data["dose"] == ["10", "20", "pending"]

    def test_duplicates_by_key_keep_the_first_and_say_what_was_lost(self):
        data = table(patient_id=["p1", "p1", "p2"], visit=["a", "b", "c"])
        report, _ = clean(data, recipe=recipe(dedupe_on=["patient_id"]))

        assert data.data["visit"] == ["a", "c"]
        dedupe = outcome(report, "deduplicate_rows")
        assert dedupe.title == "Duplicate rows removed by key"
        assert "other columns may have differed" in dedupe.note
        assert any("Duplicates by key" in warning for warning in report.lossy)

    def test_a_key_that_is_not_there_falls_back_to_exact_duplicates(self):
        data = table(patient_id=["p1", "p1"], visit=["a", "b"])
        report, _ = clean(data, recipe=recipe(dedupe_on=["mrn"]))

        assert data.data["visit"] == ["a", "b"]
        assert "only exact duplicates" in outcome(report, "deduplicate_rows").note

    def test_folding_can_skip_a_column_or_tighten_its_threshold(self):
        # Distinct ids, so deduplication (which runs before folding) keeps every row.
        rows = dict(id=["1", "2", "3"], dept=["Cardio", "cardio", "Cardio"], unit=["ICU", "icu", "ICU"])
        skipped = table(**rows)
        clean(skipped, recipe=recipe(fold_skip=["dept"]))
        assert skipped.data["dept"] == ["Cardio", "cardio", "Cardio"]
        assert skipped.data["unit"] == ["ICU", "ICU", "ICU"]

        tight = table(**rows)
        clean(tight, recipe=recipe(categorical_max_distinct=2))
        # Each column has exactly two spellings, which is not above 2: still folded.
        assert tight.data["dept"] == ["Cardio", "Cardio", "Cardio"]

    def test_sex_columns_can_be_named_when_the_name_does_not_say_so(self):
        data = table(p_s=["F", "Mujer"], sex=["F", "M"])
        clean(data, recipe=recipe(sex_columns=["p_s"]))
        assert data.data["p_s"] == ["female", "female"]
        # Named columns replace recognition by name: "sex" is left alone.
        assert data.data["sex"] == ["F", "M"]

    def test_a_range_for_an_exact_column_beats_the_patterns(self):
        """A paediatric source can say an age over 18 is implausible for it."""
        data = table(age=["4", "30"])
        report, _ = clean(
            data,
            recipe=recipe(ranges=[{"column": "age", "unit": "years", "low": 0, "high": 18}]),
        )
        assert outcome(report, "flag_implausible_measurements").flagged == 1

    def test_options_name_columns_as_they_arrived_or_standardised(self):
        data = table(PatientCode=["001", "002"])
        clean(data, recipe=recipe(disabled=["normalise_column_names"], force_types={"patient_code": "integer"}))
        assert data.data["PatientCode"] == [1, 2]


# ---------------------------------------------------------------------------
# What is refused
# ---------------------------------------------------------------------------


class TestValidation:
    @pytest.mark.parametrize(
        "options, message",
        [
            ({"colour": "blue"}, "unknown recipe option"),
            ({"disabled": ["delete_everything"]}, "no rule called"),
            ({"force_types": {"dose": "currency"}}, "cannot force type"),
            ({"categorical_max_distinct": 1}, "from 2 to 100000"),
            ({"ranges": [{"column": "age", "unit": "y", "low": 10, "high": 5}]}, "must be below"),
            ({"ranges": [{"column": "age", "pattern": "age", "unit": "y", "low": 0, "high": 5}]}, "not both"),
            ({"ranges": [{"pattern": "(", "unit": "y", "low": 0, "high": 5}]}, "not a valid expression"),
            ({"null_tokens": "n/a"}, "list of strings"),
        ],
    )
    def test_nonsense_is_refused_with_a_reason(self, options, message):
        with pytest.raises(RecipeError, match=message):
            CleaningRecipe.from_dict(options)


# ---------------------------------------------------------------------------
# The API
# ---------------------------------------------------------------------------


@pytest.fixture()
def project(db_session):
    return seed_project(db_session)


def make_source(db_session, project, kind="postgres", name="Hospital HIS"):
    source = DataSource(project_id=project.id, name=name, kind=kind)
    db_session.add(source)
    db_session.commit()
    db_session.refresh(source)
    return source


class TestApi:
    def test_a_new_source_is_on_the_standard(self, test_app, db_session, project):
        source = make_source(db_session, project)

        body = test_app.get(f"/sources/{source.id}/cleaning-recipe").json()

        assert body["mode"] == "standard"
        assert body["recipe"] == body["standard"] == STANDARD.as_dict()
        assert [rule["name"] for rule in body["rules"]] == [rule.name for rule in RULES]
        assert "integer" in body["forceable_types"]

    def test_a_recipe_is_stored_in_full_and_reported_with_its_losses(self, test_app, db_session, project):
        source = make_source(db_session, project)

        body = test_app.put(
            f"/sources/{source.id}/cleaning-recipe",
            json={"recipe": {"disabled": ["fold_categories"], "dedupe_on": ["patient_id"]}},
        ).json()

        assert body["mode"] == "custom"
        assert body["recipe"]["disabled"] == ["fold_categories"]
        assert body["lossy"] and "Duplicates by key" in body["lossy"][0]
        db_session.refresh(source)
        # Every option spelled out, so a later change to a default does not move it.
        assert source.cleaning_recipe["null_tokens"] == STANDARD.as_dict()["null_tokens"]

    def test_choosing_exactly_the_standard_stores_nothing(self, test_app, db_session, project):
        source = make_source(db_session, project)

        body = test_app.put(f"/sources/{source.id}/cleaning-recipe", json={"recipe": STANDARD.as_dict()}).json()

        assert body["mode"] == "standard"
        db_session.refresh(source)
        assert source.cleaning_recipe == {}

    def test_a_bad_recipe_is_refused_and_not_stored(self, test_app, db_session, project):
        source = make_source(db_session, project)

        response = test_app.put(
            f"/sources/{source.id}/cleaning-recipe", json={"recipe": {"disabled": ["nope"]}}
        )

        assert response.status_code == 422
        assert "no rule called nope" in response.json()["detail"]
        db_session.refresh(source)
        assert source.cleaning_recipe == {}

    def test_reset_goes_back_to_the_standard(self, test_app, db_session, project):
        source = make_source(db_session, project)
        source.cleaning_recipe = recipe(disabled=["fold_categories"]).as_dict()
        db_session.add(source)
        db_session.commit()

        body = test_app.put(f"/sources/{source.id}/cleaning-recipe", json={"reset": True}).json()

        assert body["mode"] == "standard"

    def test_an_uploaded_file_has_a_recipe_too(self, test_app, db_session, project):
        source = make_source(db_session, project, kind="upload", name="admissions")

        assert test_app.get(f"/sources/{source.id}/cleaning-recipe").status_code == 200

    def test_another_members_source_is_not_found(self, other_member_app, db_session, project):
        source = make_source(db_session, project)

        assert other_member_app.get(f"/sources/{source.id}/cleaning-recipe").status_code == 404
        assert other_member_app.put(
            f"/sources/{source.id}/cleaning-recipe", json={"reset": True}
        ).status_code == 404


# ---------------------------------------------------------------------------
# The worker and the replay
# ---------------------------------------------------------------------------


class TestTheWorkerUsesTheRecipe:
    def test_an_upload_is_cleaned_with_its_sources_recipe(self, db_engine, db_session, project, tmp_path):
        from core.config import get_settings
        from tasks.celery_tasks import ingest_upload

        # The pseudo-source an upload of admissions.csv lands under, with a
        # recipe that treats "unknown" as a placeholder.
        source = make_source(db_session, project, kind="upload", name="admissions")
        source.cleaning_recipe = recipe(null_tokens=["unknown"]).as_dict()
        db_session.add(source)
        db_session.commit()

        store = FakeObjectStore()
        bucket = get_settings().minio_bucket_datasets
        csv = tmp_path / "admissions.csv"
        csv.write_text("patient_id,smoker\np1,unknown\np2,yes\n", encoding="utf-8")
        with csv.open("rb") as handle:
            store.upload_fileobj(bucket, "u/admissions.csv", handle)
        upload = Dataset(project_id=project.id, name="admissions.csv", bucket=bucket,
                         object_key="u/admissions.csv", origin="upload", is_active=True)
        db_session.add(upload)
        db_session.commit()
        db_session.refresh(upload)

        with (
            patch("sqlmodel.create_engine", return_value=db_engine),
            patch("core.storage.upload_fileobj", side_effect=store.upload_fileobj),
            patch("core.storage.download_to_path", side_effect=store.download_to_path),
            patch("core.storage.get_s3_client", side_effect=store.get_s3_client),
        ):
            outcome_ = ingest_upload(upload.id)

        assert outcome_["status"] == "success", outcome_
        db_session.refresh(upload)
        run = db_session.get(IngestionRun, upload.ingestion_run_id)
        assert run.quality_report["recipe"]["null_tokens"] == ["unknown"]
        sentinel = next(rule for rule in run.quality_report["rules"] if rule["rule"] == "sentinel_nulls")
        assert sentinel["cells_changed"] == 1


class TestReplay:
    def test_a_run_is_replayed_with_the_recipe_it_was_cleaned_with(
        self, test_app, db_session, own_project, diffed
    ):
        # The run was cleaned with trimming off; the source has since gone
        # back to the standard. The replay must follow the run.
        diffed.quality_report = {**diffed.quality_report, "recipe": recipe(disabled=["trim_whitespace"]).as_dict()}
        db_session.add(diffed)
        db_session.commit()

        steps = test_app.get(f"/projects/{own_project.id}/medallion/steps").json()["steps"]

        trim = next(step for step in steps if step["rule"] == "trim_whitespace")
        assert trim["skipped"] is True
        assert trim["changed"] is False
