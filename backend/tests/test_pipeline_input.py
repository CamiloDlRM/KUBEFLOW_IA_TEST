"""Tests for choosing what a pipeline trains on.

Three things are pinned. That a choice resolves to exactly the objects it names
and refuses loudly when it names nothing — a repository that asked for gold
must never be quietly handed something else. That a source's history is
mounted as one file stacked by column name, because the notebook reads one
file and a source's schema can widen between extractions. And that each run's
code is recorded cell by cell with its phase, which is what the pipeline view
draws its cards from.
"""
from __future__ import annotations

from unittest.mock import patch

import pyarrow.parquet as pq
import pytest

from core import medallion
from core.medallion import write_typed
from core.notebook_parser import notebook_cells
from core.pipeline_input import InputChoice, InputError, mount, options, resolve
from models.schemas import DataSource, GoldTable
from tests.conftest import OTHER_USER_ID, seed_pipeline, seed_project, seed_repo
from tests.test_ingestion_task import FakeObjectStore


@pytest.fixture()
def store():
    return FakeObjectStore()


@pytest.fixture()
def storage_patched(store):
    with (
        patch("core.storage.upload_fileobj", side_effect=store.upload_fileobj),
        patch("core.storage.download_to_path", side_effect=store.download_to_path),
        patch("core.storage.get_s3_client", side_effect=store.get_s3_client),
    ):
        yield store


@pytest.fixture()
def project(db_session):
    return seed_project(db_session)


def seed_source(db_session, project_id: int, name: str = "Hospital HIS") -> DataSource:
    source = DataSource(project_id=project_id, name=name, extraction_sql="SELECT 1")
    db_session.add(source)
    db_session.commit()
    db_session.refresh(source)
    return source


def seed_gold(db_session, project_id: int, version: int = 2) -> GoldTable:
    table = GoldTable(
        project_id=project_id,
        name="gold",
        version=version,
        bucket=medallion.bucket_for("gold"),
        object_key=medallion.gold_key(project_id, "gold", version),
        rows=3,
    )
    db_session.add(table)
    db_session.commit()
    db_session.refresh(table)
    return table


def put_parquet(store, tmp_path, layer: str, key: str, columns: dict[str, list]) -> None:
    path = tmp_path / key.replace("/", "_")
    types = {name: "integer" if isinstance(values[0], int) else "string" for name, values in columns.items()}
    write_typed(list(columns), columns, types, path)
    with path.open("rb") as handle:
        store.upload_fileobj(medallion.bucket_for(layer), key, handle)


# ---------------------------------------------------------------------------
# The choice
# ---------------------------------------------------------------------------


class TestChoice:
    def test_nothing_chosen_is_the_active_dataset(self):
        assert InputChoice.parse(None).layer == ""
        assert InputChoice.parse({}).as_dict() == {}

    def test_an_unknown_layer_is_refused(self):
        with pytest.raises(InputError, match="unknown layer"):
            InputChoice.parse({"layer": "platinum"})

    def test_silver_has_to_say_which_source(self):
        """Each source is its own table; stacking them would be mostly nulls."""
        with pytest.raises(InputError, match="which source"):
            InputChoice.parse({"layer": "silver"})

    def test_gold_keeps_its_version_and_drops_a_source(self):
        choice = InputChoice.parse({"layer": "gold", "version": 3, "source_id": 9})
        assert choice.as_dict() == {"layer": "gold", "version": 3}


# ---------------------------------------------------------------------------
# Resolving it
# ---------------------------------------------------------------------------


class TestResolve:
    def test_the_empty_choice_resolves_to_nothing(self, db_session, project):
        assert resolve(db_session, project.id, InputChoice()) is None

    def test_gold_without_a_version_follows_the_newest_build(
        self, db_session, project, storage_patched
    ):
        table = seed_gold(db_session, project.id, version=2)

        resolved = resolve(db_session, project.id, InputChoice(layer="gold"))

        assert resolved.keys == [table.object_key]
        assert resolved.version == 2
        assert resolved.label == "gold v2"

    def test_an_older_gold_build_can_be_pinned(
        self, db_session, project, storage_patched, tmp_path
    ):
        """Pinning is how last month's result is reproduced."""
        seed_gold(db_session, project.id, version=2)
        old_key = medallion.gold_key(project.id, "gold", 1)
        put_parquet(storage_patched, tmp_path, "gold", old_key, {"x": [1]})

        resolved = resolve(db_session, project.id, InputChoice(layer="gold", version=1))

        assert resolved.keys == [old_key]
        assert resolved.label == "gold v1"

    def test_a_pinned_build_that_is_gone_is_refused(
        self, db_session, project, storage_patched
    ):
        seed_gold(db_session, project.id, version=2)

        with pytest.raises(InputError, match="v1 is not in object storage"):
            resolve(db_session, project.id, InputChoice(layer="gold", version=1))

    def test_gold_that_was_never_built_is_refused(self, db_session, project):
        with pytest.raises(InputError, match="not been built"):
            resolve(db_session, project.id, InputChoice(layer="gold"))

    def test_another_projects_source_does_not_exist_here(
        self, db_session, project, storage_patched
    ):
        theirs = seed_source(db_session, seed_project(db_session, owner_id=OTHER_USER_ID).id)

        with pytest.raises(InputError, match="does not exist in this project"):
            resolve(db_session, project.id, InputChoice(layer="silver", source_id=theirs.id))

    def test_a_source_with_nothing_landed_is_refused(
        self, db_session, project, storage_patched
    ):
        source = seed_source(db_session, project.id)

        with pytest.raises(InputError, match="nothing in silver"):
            resolve(db_session, project.id, InputChoice(layer="silver", source_id=source.id))

    def test_silver_is_the_sources_whole_history(
        self, db_session, project, storage_patched, tmp_path
    ):
        source = seed_source(db_session, project.id)
        prefix = medallion.stream_prefix(project.id, source.id)
        for run in ("a", "b"):
            put_parquet(storage_patched, tmp_path, "silver", f"{prefix}run-{run}.parquet", {"x": [1]})
        # Another source's objects are not this source's history.
        other = seed_source(db_session, project.id, name="Lab")
        put_parquet(
            storage_patched, tmp_path, "silver",
            f"{medallion.stream_prefix(project.id, other.id)}run-c.parquet", {"x": [1]},
        )

        resolved = resolve(db_session, project.id, InputChoice(layer="silver", source_id=source.id))

        assert resolved.keys == [f"{prefix}run-a.parquet", f"{prefix}run-b.parquet"]
        assert resolved.label == "silver · Hospital HIS (2 objects)"


# ---------------------------------------------------------------------------
# Mounting it
# ---------------------------------------------------------------------------


class TestMount:
    def test_one_object_is_downloaded_as_it_is(
        self, db_session, project, storage_patched, tmp_path
    ):
        table = seed_gold(db_session, project.id, version=2)
        put_parquet(storage_patched, tmp_path, "gold", table.object_key, {"x": [1, 2, 3]})
        resolved = resolve(db_session, project.id, InputChoice(layer="gold"))

        path = mount(resolved, tmp_path / "mounted")

        assert path.name == "gold-v0002.parquet"
        assert pq.read_table(path).num_rows == 3

    def test_a_history_is_stacked_into_one_file_by_column_name(
        self, db_session, project, storage_patched, tmp_path
    ):
        """A column added last month must not shift the older rows left."""
        source = seed_source(db_session, project.id)
        prefix = medallion.stream_prefix(project.id, source.id)
        put_parquet(storage_patched, tmp_path, "silver", f"{prefix}run-a.parquet",
                    {"patient_id": ["p1", "p2"], "age": [44, 39]})
        put_parquet(storage_patched, tmp_path, "silver", f"{prefix}run-b.parquet",
                    {"patient_id": ["p3"], "ward": ["B"], "age": [71]})
        resolved = resolve(db_session, project.id, InputChoice(layer="silver", source_id=source.id))

        path = mount(resolved, tmp_path / "mounted")

        stacked = pq.read_table(path).to_pydict()
        assert sorted(stacked) == ["age", "patient_id", "ward"]
        rows = sorted(zip(stacked["patient_id"], stacked["age"], stacked["ward"]))
        assert rows == [("p1", 44, None), ("p2", 39, None), ("p3", 71, "B")]
        assert not (tmp_path / "mounted" / "parts").exists()


# ---------------------------------------------------------------------------
# What can be chosen
# ---------------------------------------------------------------------------


class TestOptions:
    def test_lists_each_sources_layers_and_every_stored_gold_build(
        self, db_session, project, storage_patched, tmp_path
    ):
        source = seed_source(db_session, project.id)
        prefix = medallion.stream_prefix(project.id, source.id)
        put_parquet(storage_patched, tmp_path, "bronze", f"{prefix}run-a.parquet", {"x": ["1"]})
        put_parquet(storage_patched, tmp_path, "silver", f"{prefix}run-a.parquet", {"x": [1]})
        seed_gold(db_session, project.id, version=2)
        for version in (1, 2):
            put_parquet(storage_patched, tmp_path, "gold",
                        medallion.gold_key(project.id, "gold", version), {"x": [1]})

        found = options(db_session, project.id)

        assert [s.source_name for s in found.bronze] == ["Hospital HIS"]
        assert [s.objects for s in found.silver] == [1]
        assert [(g.version, g.latest) for g in found.gold] == [(2, True), (1, False)]


# ---------------------------------------------------------------------------
# The code, by phase
# ---------------------------------------------------------------------------


def _cell(source: str, tags=(), **extra) -> dict:
    return {"cell_type": "code", "metadata": {"tags": list(tags), **extra.pop("metadata", {})},
            "source": source, "outputs": extra.pop("outputs", [])}


class TestNotebookCells:
    def test_each_code_cell_carries_its_phase_in_notebook_order(self):
        notebook = {"cells": [
            {"cell_type": "markdown", "metadata": {}, "source": "# Title"},
            _cell("import pandas as pd"),
            _cell("df = pd.read_parquet(DATASET_PATH)", tags=["mlops:data"]),
            _cell("model.fit(X, y)", tags=["mlops:training"]),
        ]}

        cells = notebook_cells(notebook)

        assert [(c["index"], c["phase"]) for c in cells] == [(0, ""), (1, "data"), (2, "training")]
        assert cells[1]["source"] == "df = pd.read_parquet(DATASET_PATH)"
        assert cells[0]["status"] == "pending"

    def test_papermills_injected_cell_is_not_the_authors_code(self):
        notebook = {"cells": [
            _cell("DATASET_PATH = ''", tags=["parameters"]),
            _cell("DATASET_PATH = '/tmp/x'", tags=["injected-parameters"]),
            _cell("X = 1", tags=["mlops:preprocessing"]),
        ]}

        assert [c["source"] for c in notebook_cells(notebook)] == ["DATASET_PATH = ''", "X = 1"]

    def test_an_executed_cell_carries_what_it_printed_and_how_it_ended(self):
        notebook = {"cells": [
            _cell("print('rows', 3)", tags=["mlops:data"],
                  metadata={"papermill": {"status": "completed"}},
                  outputs=[{"output_type": "stream", "name": "stdout", "text": ["rows 3\n"]}]),
            _cell("1 / 0", tags=["mlops:training"],
                  metadata={"papermill": {"status": "failed"}},
                  outputs=[{"output_type": "error", "ename": "ZeroDivisionError",
                            "evalue": "division by zero", "traceback": []}]),
            _cell("joblib.dump(m, p)", tags=["mlops:export"],
                  metadata={"papermill": {"status": "pending"}}),
        ]}

        data, training, export = notebook_cells(notebook)

        assert (data["output"], data["status"]) == ("rows 3\n", "completed")
        assert (training["error"], training["status"]) == (
            "ZeroDivisionError: division by zero", "failed")
        assert export["status"] == "pending"


# ---------------------------------------------------------------------------
# The API
# ---------------------------------------------------------------------------


class TestApi:
    def test_choosing_gold_is_stored_and_described(
        self, test_app, db_session, project, storage_patched
    ):
        repo = seed_repo(db_session, project_id=project.id)
        seed_gold(db_session, project.id, version=2)

        response = test_app.put(f"/repos/{repo.id}/pipeline-input", json={"layer": "gold"})

        assert response.status_code == 200
        body = response.json()
        assert body["choice"] == {"layer": "gold"}
        assert body["resolved"]["label"] == "gold v2"
        db_session.refresh(repo)
        assert repo.pipeline_input == {"layer": "gold"}

    def test_a_choice_that_names_nothing_is_refused_and_not_stored(
        self, test_app, db_session, project, storage_patched
    ):
        """Refused while someone is looking, not at the start of an unwatched run."""
        repo = seed_repo(db_session, project_id=project.id)

        response = test_app.put(f"/repos/{repo.id}/pipeline-input", json={"layer": "gold"})

        assert response.status_code == 422
        assert "not been built" in response.json()["detail"]
        db_session.refresh(repo)
        assert repo.pipeline_input == {}

    def test_an_empty_layer_goes_back_to_the_active_dataset(
        self, test_app, db_session, project, storage_patched
    ):
        repo = seed_repo(db_session, project_id=project.id, pipeline_input={"layer": "gold"})

        body = test_app.put(f"/repos/{repo.id}/pipeline-input", json={"layer": ""}).json()

        assert body == {"choice": {}, "resolved": None, "error": ""}

    def test_a_choice_that_went_stale_is_reported_not_failed(
        self, test_app, db_session, project, storage_patched
    ):
        repo = seed_repo(db_session, project_id=project.id, pipeline_input={"layer": "gold"})

        response = test_app.get(f"/repos/{repo.id}/pipeline-input")

        assert response.status_code == 200
        assert response.json()["resolved"] is None
        assert "not been built" in response.json()["error"]

    def test_another_members_repository_is_not_found(
        self, other_member_app, db_session, project, storage_patched
    ):
        repo = seed_repo(db_session, project_id=project.id)

        assert other_member_app.get(f"/repos/{repo.id}/pipeline-input").status_code == 404
        assert other_member_app.put(
            f"/repos/{repo.id}/pipeline-input", json={"layer": ""}
        ).status_code == 404

    def test_the_palette_lists_what_can_be_dragged(
        self, test_app, db_session, project, storage_patched, tmp_path
    ):
        seed_gold(db_session, project.id, version=1)
        put_parquet(storage_patched, tmp_path, "gold",
                    medallion.gold_key(project.id, "gold", 1), {"x": [1]})

        body = test_app.get(f"/projects/{project.id}/medallion/inputs").json()

        assert body["bronze"] == [] and body["silver"] == []
        assert [(g["version"], g["latest"]) for g in body["gold"]] == [(1, True)]

    def test_a_run_reports_what_it_mounted_and_the_code_it_ran(
        self, test_app, db_session, project
    ):
        repo = seed_repo(db_session, project_id=project.id)
        pipeline = seed_pipeline(
            db_session, repo.id,
            mounted_input={"layer": "gold", "label": "gold v2", "keys": ["k"]},
            cells=[{"index": 0, "phase": "data", "source": "x = 1"}],
        )

        detail = test_app.get(f"/pipelines/{pipeline.id}").json()
        listed = test_app.get("/pipelines").json()["items"][0]

        assert detail["mounted_input"]["label"] == "gold v2"
        assert detail["cells"][0]["phase"] == "data"
        # The list carries what was mounted but not every run's notebook.
        assert listed["mounted_input"]["label"] == "gold v2"
        assert "cells" not in listed
