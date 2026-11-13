"""Tests for a source's own silver rules (core.custom_steps).

What is pinned: each kind of rule does what it says and reports it like a
rule of the standard; a rule that cannot run changes nothing and says why;
expressions can read the row and nothing else; and row and column identity
survive rules that add columns and remove rows, so the step view and the
bronze/silver diff still line up.
"""
from __future__ import annotations

from datetime import date

import pytest

from core.cleaning import CleaningRecipe, RecipeError, Table, clean
from core.custom_steps import CustomStep, read_steps
from models.schemas import DataSource

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


def run(data: Table, *steps: dict, **options):
    """Clean ``data`` with the standard and these rules; return the report and the last outcome."""
    recipe = CleaningRecipe.from_dict({"steps": list(steps), **options})
    report, _ = clean(data, recipe=recipe)
    return report, report.outcomes[-1]


# ---------------------------------------------------------------------------
# Saving a rule
# ---------------------------------------------------------------------------


class TestValidation:
    def test_every_kind_survives_the_round_trip(self):
        steps = [
            {"kind": "rename", "column": "peso", "to": "weight_kg"},
            {"kind": "drop_columns", "columns": ["notes"]},
            {"kind": "replace_values", "column": "sex", "mapping": [{"from": "M.", "to": "male"}]},
            {"kind": "fill_nulls", "column": "ward", "value": "unknown"},
            {"kind": "convert_units", "column": "weight", "factor": 0.453592, "when": "unit = 'lb'",
             "from_unit": "lb", "to_unit": "kg"},
            {"kind": "parse_dates", "column": "admitted", "format": "%d/%m/%Y"},
            {"kind": "split_column", "column": "bp", "separator": "/", "into": ["systolic", "diastolic"]},
            {"kind": "validate", "condition": "discharged >= admitted", "action": "drop", "label": "Stay"},
            {"kind": "compute", "column": "bmi", "expression": "weight / (height / 100) ^ 2"},
        ]
        recipe = CleaningRecipe.from_dict({"steps": steps})

        assert CleaningRecipe.from_dict(recipe.as_dict()) == recipe
        assert [step.kind for step in recipe.steps] == [step["kind"] for step in steps]
        assert recipe.steps[7].title == "Stay"

    @pytest.mark.parametrize(
        "step, message",
        [
            ({"kind": "teleport"}, "kind is one of"),
            ({"kind": "rename", "column": "a", "to": "b", "colour": 1}, "no option"),
            ({"kind": "rename", "column": "a"}, "new name is missing"),
            ({"kind": "drop_columns", "columns": []}, "between 1 and"),
            ({"kind": "replace_values", "column": "a", "mapping": [{"from": "x", "to": "1"}, {"from": "x", "to": "2"}]},
             "replaced twice"),
            ({"kind": "convert_units", "column": "a", "factor": 0}, "factor of 0"),
            ({"kind": "parse_dates", "column": "a", "format": "dd/mm/yyyy"}, "% codes"),
            ({"kind": "split_column", "column": "a", "separator": "/", "into": ["only"]}, "between 2 and"),
            ({"kind": "validate", "condition": "a > 1", "action": "explode"}, "flagged or dropped"),
            ({"kind": "compute", "column": "x", "expression": "(SELECT 1)"}, "SELECT is not allowed"),
            ({"kind": "compute", "column": "x", "expression": "1; DROP TABLE t"}, "no ';'"),
            ({"kind": "compute", "column": "x", "expression": "read_text('/etc/passwd')"}, "not read anything else"),
            ({"kind": "validate", "condition": "a > 1 -- sneaky"}, "no comments"),
        ],
    )
    def test_nonsense_is_refused_with_a_reason(self, step, message):
        with pytest.raises(RecipeError, match=message):
            CleaningRecipe.from_dict({"steps": [step]})

    def test_a_refusal_says_which_rule(self):
        with pytest.raises(RecipeError, match="rule 2:"):
            read_steps([{"kind": "drop_columns", "columns": ["a"]}, {"kind": "rename", "column": "a"}])

    def test_words_inside_quotes_are_data(self):
        step = CustomStep.from_dict({"kind": "validate", "condition": "status <> 'drop from list'"})

        assert step.params["condition"] == "status <> 'drop from list'"

    def test_the_rules_that_can_lose_data_say_so(self):
        recipe = CleaningRecipe.from_dict({"steps": [
            {"kind": "drop_columns", "columns": ["notes"]},
            {"kind": "replace_values", "column": "a", "mapping": [{"from": "x", "to": None}]},
            {"kind": "validate", "condition": "a > 1", "action": "drop"},
            {"kind": "validate", "condition": "a > 1", "action": "flag"},
            {"kind": "rename", "column": "a", "to": "b"},
        ]})

        assert len(recipe.lossy) == 3


# ---------------------------------------------------------------------------
# Running each kind
# ---------------------------------------------------------------------------


class TestKinds:
    def test_rename_follows_the_column_from_its_original_name(self):
        data = table(**{"Peso LB": ["150", "180"]})

        report, outcome = run(data, {"kind": "rename", "column": "peso_lb", "to": "weight_lb"})

        assert data.columns == ["weight_lb"]
        assert report.types["weight_lb"] == "integer"
        assert report.renamed["Peso LB"] == "weight_lb"
        assert outcome.changed

    def test_drop_removes_and_counts(self):
        data = table(id=["1", "2"], notes=["a", "b"])

        report, outcome = run(data, {"kind": "drop_columns", "columns": ["notes"]})

        assert data.columns == ["id"]
        assert outcome.columns_removed == 1
        assert "notes" not in report.types

    def test_replace_then_read_the_column_again(self):
        data = table(id=["1", "2", "3"], smoker=["Current", "never", "NEVER"])

        report, outcome = run(
            data,
            {"kind": "replace_values", "column": "smoker", "ignore_case": True,
             "mapping": [{"from": "current", "to": "1"}, {"from": "never", "to": "0"}]},
            disabled=["fold_categories"],
        )

        # The mapping wrote 1/0, which are integers once read again.
        assert data.data["smoker"] == [1, 0, 0]
        assert report.types["smoker"] == "integer"
        assert outcome.cells_changed == 3

    def test_a_boolean_is_matched_as_it_reads(self):
        # The standard has already read si/no as booleans by the time a rule runs.
        data = table(id=["1", "2"], smoker=["si", "no"])

        report, _ = run(
            data,
            {"kind": "replace_values", "column": "smoker",
             "mapping": [{"from": "true", "to": "smoker"}, {"from": "false", "to": "non-smoker"}]},
        )

        assert data.data["smoker"] == ["smoker", "non-smoker"]
        assert report.types["smoker"] == "string"

    def test_fill_only_touches_empties(self):
        data = table(id=["1", "2"], ward=["icu", None])

        _, outcome = run(data, {"kind": "fill_nulls", "column": "ward", "value": "unknown"})

        assert data.data["ward"] == ["icu", "unknown"]
        assert outcome.cells_changed == 1

    def test_units_convert_only_where_the_condition_holds(self):
        data = table(id=["1", "2", "3"], weight=["150", "70", None], unit=["lb", "kg", "lb"])

        report, outcome = run(
            data,
            {"kind": "convert_units", "column": "weight", "factor": 0.453592, "when": "unit = 'lb'"},
        )

        assert data.data["weight"] == [pytest.approx(68.0388), 70.0, None]
        assert report.types["weight"] == "decimal"
        assert outcome.cells_changed == 1  # 70 kg is untouched; only its type widened

    def test_units_refuse_a_text_column_and_change_nothing(self):
        data = table(id=["1"], weight=["heavy"])

        report, outcome = run(data, {"kind": "convert_units", "column": "weight", "factor": 2})

        assert data.data["weight"] == ["heavy"]
        assert "not a number column" in outcome.error
        assert outcome.changed and "changed nothing" in outcome.note

    def test_dates_are_read_in_the_given_format(self):
        data = table(admitted=["03/02/2024", "28/12/2023"])

        report, _ = run(data, {"kind": "parse_dates", "column": "admitted", "format": "%d/%m/%Y"})

        assert data.data["admitted"] == [date(2024, 2, 3), date(2023, 12, 28)]
        assert report.types["admitted"] == "date"

    def test_dates_are_all_or_nothing(self):
        data = table(admitted=["03/02/2024", "yesterday"])

        report, outcome = run(data, {"kind": "parse_dates", "column": "admitted", "format": "%d/%m/%Y"})

        assert data.data["admitted"] == ["03/02/2024", "yesterday"]
        assert outcome.flagged == 1
        assert "'yesterday'" in outcome.note

    def test_split_keeps_the_original_and_types_the_parts(self):
        data = table(bp=["120/80", "135/90", None])

        report, outcome = run(
            data, {"kind": "split_column", "column": "bp", "separator": "/", "into": ["systolic", "diastolic"]}
        )

        assert data.columns == ["bp", "systolic", "diastolic"]
        assert data.data["systolic"] == [120, 135, None]
        assert report.types["diastolic"] == "integer"
        assert outcome.columns == ["systolic", "diastolic"]

    def test_a_check_flags_and_does_not_count_nulls_against_a_row(self):
        data = table(id=["1", "2", "3"], age=["44", "-3", None])

        _, outcome = run(data, {"kind": "validate", "condition": "age >= 0"})

        assert data.rows == 3
        assert outcome.flagged == 1

    def test_a_check_can_drop_and_records_where_the_rows_arrived(self):
        # Row 1 is a byte-for-byte repeat, removed by the standard first; the
        # check then removes what arrived as row 3, not "row 2 of what is left".
        data = table(id=["1", "1", "2", "3"], age=["44", "44", "71", "-3"])

        _, outcome = run(data, {"kind": "validate", "condition": "age >= 0", "action": "drop"})

        assert data.data["id"] == [1, 2]
        assert outcome.rows_removed == 1
        assert outcome.removed_rows == [3]

    def test_compute_adds_a_typed_column(self):
        data = table(weight=["70", "90"], height=["175", "180"])

        report, outcome = run(
            data, {"kind": "compute", "column": "bmi", "expression": "round(weight / (height / 100) ^ 2, 1)"}
        )

        assert data.data["bmi"] == [22.9, 27.8]
        assert report.types["bmi"] == "decimal"
        assert outcome.cells_changed == 2

    def test_a_bad_expression_changes_nothing_and_says_why(self):
        data = table(weight=["70"])

        _, outcome = run(data, {"kind": "compute", "column": "x", "expression": "no_such_column * 2"})

        assert "x" not in data.columns
        assert "could not be evaluated" in outcome.error

    def test_a_missing_column_does_not_fail_the_cleaning(self):
        data = table(id=["1"])

        report, outcome = run(data, {"kind": "fill_nulls", "column": "ward", "value": "x"})

        assert "no column called 'ward'" in outcome.error
        assert report.summary()["rules"][-1]["error"] == outcome.error


class TestTheSandbox:
    def test_an_expression_cannot_read_files_even_past_the_check(self):
        # Built directly, skipping the check made when a rule is saved: the
        # engine itself must still refuse.
        step = CustomStep(kind="compute", params={"column": "x", "expression": "(SELECT content FROM read_text('/etc/hosts'))"})
        data = table(id=["1"])

        report, _ = clean(data, recipe=CleaningRecipe(steps=(step,)))

        assert "could not be evaluated" in report.outcomes[-1].error
        assert "x" not in data.columns


# ---------------------------------------------------------------------------
# The step view
# ---------------------------------------------------------------------------


class TestStepView:
    def test_a_new_column_and_a_removed_row_line_up(self, test_app, db_session, own_project, diffed):
        source = db_session.get(DataSource, diffed.source_id)

        body = test_app.post(
            f"/projects/{own_project.id}/medallion/steps/preview",
            json={"source_id": source.id, "recipe": {"steps": [
                {"kind": "compute", "column": "decade", "expression": "edad // 10"},
                {"kind": "validate", "condition": "edad >= 50", "action": "drop"},
            ]}},
        ).json()

        computed, check = body["steps"][-2], body["steps"][-1]
        assert computed["tier"] == "custom"
        added = [column for column in computed["preview_columns"] if column["change"] == "added"]
        assert [column["after"] for column in added] == ["decade"]
        # p1 (44) fails; p2 has no age, which is not evidence against it.
        assert check["rows_removed"] == 1
        assert [row["row"] for row in check["preview_rows"] if row["removed"]] == [0]
        assert body["lossy"] and "removed" in body["lossy"][0]

    def test_a_rule_that_could_not_run_is_shown_with_its_reason(self, test_app, db_session, own_project, diffed):
        body = test_app.post(
            f"/projects/{own_project.id}/medallion/steps/preview",
            json={"source_id": diffed.source_id, "recipe": {"steps": [
                {"kind": "drop_columns", "columns": ["nope"]},
            ]}},
        ).json()

        assert "no column called 'nope'" in body["steps"][-1]["error"]

    def test_a_saved_recipe_with_rules_is_returned_in_full(self, test_app, db_session, own_project, diffed):
        steps = [{"kind": "rename", "column": "edad", "to": "age", "label": ""}]

        body = test_app.put(
            f"/sources/{diffed.source_id}/cleaning-recipe", json={"recipe": {"steps": steps}}
        ).json()

        assert body["recipe"]["steps"] == steps
        assert body["mode"] == "custom"
