"""Tests for the cleaning standard that turns bronze into silver.

These pin the three promises the standard makes, because those are what a
reviewer is entitled to rely on and what a well-meaning edit is most likely to
break:

1. Nothing is deleted except exact duplicate rows and all-null columns.
2. A type is claimed only when every value in the column supports it.
3. Every change is counted, with examples.

The rest of the suite covers the individual rules, with particular attention to
the two places where being clever would be worse than being careful: the
``H``/``M`` sex collision between English and Spanish records, and numeric
strings whose leading zeros are part of the value.
"""
from __future__ import annotations

from datetime import date, datetime

import pytest

from core.cleaning import (
    CleaningReport,
    Table,
    clean,
    cast_types,
    deduplicate_rows,
    drop_empty_columns,
    flag_implausible_measurements,
    fold_categories,
    normalise_column_names,
    resolve_sentinel_nulls,
    standardise_sex,
    trim_whitespace,
)


def table(**columns: list) -> Table:
    return Table(columns=list(columns), data={name: list(values) for name, values in columns.items()})


def run(rule, tbl: Table) -> tuple[CleaningReport, Table]:
    report = CleaningReport(rows_in=tbl.rows, columns_in=len(tbl.columns))
    rule(tbl, report)
    return report, tbl


def outcome_of(report: CleaningReport, rule: str):
    return next(item for item in report.outcomes if item.rule == rule)


# ---------------------------------------------------------------------------
# Column names
# ---------------------------------------------------------------------------


def test_column_names_become_snake_case_ascii():
    _, tbl = run(normalise_column_names, table(**{"Patient ID": [1], "Días Estancia": [2]}))
    assert tbl.columns == ["patient_id", "dias_estancia"]


def test_camel_case_is_split_rather_than_flattened():
    _, tbl = run(normalise_column_names, table(**{"patientId": [1]}))
    assert tbl.columns == ["patient_id"]


def test_colliding_names_are_both_kept():
    """Two columns that differ only in case are two columns, not one."""
    _, tbl = run(normalise_column_names, table(**{"Code": [1], "code": [2]}))
    assert tbl.columns == ["code", "code_2"]
    assert tbl.data["code"] == [1] and tbl.data["code_2"] == [2]


def test_the_rename_is_recorded_so_a_reader_can_follow_it():
    report, _ = run(normalise_column_names, table(**{"Patient ID": [1]}))
    assert report.renamed == {"Patient ID": "patient_id"}


# ---------------------------------------------------------------------------
# Whitespace and sentinel nulls
# ---------------------------------------------------------------------------


def test_internal_whitespace_runs_are_collapsed_not_only_trimmed():
    _, tbl = run(trim_whitespace, table(term=["  HEART   FAILURE "]))
    assert tbl.data["term"] == ["HEART FAILURE"]


def test_whitespace_counts_only_the_cells_it_changed():
    report, _ = run(trim_whitespace, table(term=[" a ", "b", "c"]))
    assert outcome_of(report, "trim_whitespace").cells_changed == 1


def test_placeholder_strings_become_nulls():
    _, tbl = run(resolve_sentinel_nulls, table(code=["N/A", "-", "null", "80146002"]))
    assert tbl.data["code"] == [None, None, None, "80146002"]


def test_unknown_is_an_answer_and_is_left_alone():
    """'unknown' in a clinical record means the question was asked."""
    _, tbl = run(resolve_sentinel_nulls, table(smoking=["unknown", "other", "not recorded"]))
    assert tbl.data["smoking"] == ["unknown", "other", "not recorded"]


def test_an_all_null_column_is_dropped():
    _, tbl = run(drop_empty_columns, table(kept=[1, None], empty=[None, None]))
    assert tbl.columns == ["kept"]


def test_a_column_with_one_value_is_not_dropped():
    _, tbl = run(drop_empty_columns, table(sparse=[None, None, "x"]))
    assert tbl.columns == ["sparse"]


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


def test_a_column_of_counts_becomes_integer_not_float():
    """3.0 admissions is not a number of admissions."""
    report, tbl = run(cast_types, table(admissions=["1", "2", "13"]))
    assert tbl.data["admissions"] == [1, 2, 13]
    assert report.types["admissions"] == "integer"


def test_one_unparseable_value_keeps_the_whole_column_as_text():
    """The exception is usually the interesting row; casting would null it."""
    report, tbl = run(cast_types, table(dose=["10", "20", "pending"]))
    assert tbl.data["dose"] == ["10", "20", "pending"]
    assert report.types["dose"] == "string"


def test_a_code_column_stays_text_however_numeric_this_extraction_looks():
    """Silver accumulates, so the type has to be stable across extractions.

    A slice whose ICD-10 codes all happen to be digits would cast to integer,
    and the next slice containing "E11.9" would not — the same column stored as
    two types in one layer.
    """
    report, tbl = run(cast_types, table(encounter_code=["410620009", "162673000"]))
    assert report.types["encounter_code"] == "string"
    assert tbl.data["encounter_code"] == ["410620009", "162673000"]


def test_an_alphanumeric_code_in_a_later_slice_gets_the_same_type():
    report, _ = run(cast_types, table(encounter_code=["410620009", "E11.9"]))
    assert report.types["encounter_code"] == "string"


def test_a_surrogate_key_is_still_an_integer():
    """It is always digits, so it is subject to neither failure mode — and
    making it text would turn every join downstream into a string compare."""
    report, _ = run(cast_types, table(id=["1", "2", "3"], patient_id=["10", "11", "12"]))
    assert report.types["id"] == "integer"
    assert report.types["patient_id"] == "integer"


def test_the_same_change_is_not_shown_three_times():
    """The first three changes a rule makes are usually one change repeated —
    the value that needed correcting is the one that recurs."""
    report, _ = run(trim_whitespace, table(term=["  a b  ", "  a b  ", "  a b  ", " c  d "]))
    examples = outcome_of(report, "trim_whitespace").examples
    assert len(examples) == 2
    assert examples[0]["after"] == "a b" and examples[1]["after"] == "c d"


def test_a_cast_shows_no_example_because_the_value_did_not_change():
    """"12261" and 12261 render as the same three glyphs; a before/after pair
    there reads as a rule that ran and did nothing."""
    report, _ = run(cast_types, table(n=["12261", "12262"]))
    assert outcome_of(report, "cast_types").examples == []


def test_the_cast_reports_columns_typed_not_values_converted():
    """Rendering "12261" as 12261 is not a correction, and counting it as one
    buries the values that genuinely were corrected."""
    report, _ = run(cast_types, table(n=["1", "2", "3"]))
    outcome = outcome_of(report, "cast_types")
    assert outcome.cells_changed == 0
    assert outcome.columns == ["n"]
    assert "n → integer" in outcome.note


def test_leading_zeros_are_part_of_the_value_so_the_column_stays_text():
    report, tbl = run(cast_types, table(postcode=["05001", "11001"]))
    assert tbl.data["postcode"] == ["05001", "11001"]
    assert report.types["postcode"] == "string"


def test_a_number_too_wide_for_an_integer_stays_text():
    report, tbl = run(cast_types, table(account=["123456789012345678901234"]))
    assert report.types["account"] == "string"


def test_decimals_are_recognised():
    report, tbl = run(cast_types, table(weight=["70.5", "82", "61.25"]))
    assert tbl.data["weight"] == [70.5, 82.0, 61.25]
    assert report.types["weight"] == "decimal"


@pytest.mark.parametrize(
    "values,expected",
    [
        (["true", "false"], [True, False]),
        (["yes", "no"], [True, False]),
        (["si", "no"], [True, False]),
        (["1", "0"], None),  # digits are numbers first; see the next test
    ],
)
def test_booleans_are_recognised_in_both_languages(values, expected):
    _, tbl = run(cast_types, table(flag=values))
    if expected is not None:
        assert tbl.data["flag"] == expected


def test_digits_are_read_as_numbers_before_booleans():
    """'1'/'0' is far more often a count than a flag, and int is recoverable."""
    report, _ = run(cast_types, table(flag=["1", "0"]))
    assert report.types["flag"] == "integer"


def test_timestamps_and_dates_are_distinguished():
    report, tbl = run(
        cast_types,
        table(recorded_at=["2024-06-14T09:00:00+00:00"], born_on=["1980-03-02"]),
    )
    assert isinstance(tbl.data["recorded_at"][0], datetime)
    assert report.types["recorded_at"] == "timestamp"
    assert tbl.data["born_on"] == [date(1980, 3, 2)]
    assert report.types["born_on"] == "date"


def test_a_space_separated_timestamp_is_still_a_timestamp():
    report, _ = run(cast_types, table(seen=["2024-06-14 09:00:00"]))
    assert report.types["seen"] == "timestamp"


def test_empty_strings_become_nulls_when_the_column_is_cast():
    _, tbl = run(cast_types, table(age=["40", "", "55"]))
    assert tbl.data["age"] == [40, None, 55]


# ---------------------------------------------------------------------------
# Duplicates
# ---------------------------------------------------------------------------


def test_rows_identical_in_every_column_are_collapsed():
    report, tbl = run(deduplicate_rows, table(a=[1, 1, 2], b=["x", "x", "x"]))
    assert tbl.rows == 2
    assert outcome_of(report, "deduplicate_rows").rows_removed == 1


def test_rows_differing_anywhere_are_both_kept():
    _, tbl = run(deduplicate_rows, table(a=[1, 1], b=["x", "y"]))
    assert tbl.rows == 2


def test_deduplication_keeps_the_columns_aligned():
    """The classic way to break this rule is to filter one column and not the rest."""
    _, tbl = run(deduplicate_rows, table(a=[1, 1, 2], b=["x", "x", "z"], c=[9, 9, 7]))
    assert tbl.data["a"] == [1, 2]
    assert tbl.data["b"] == ["x", "z"]
    assert tbl.data["c"] == [9, 7]


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


def test_spelling_variants_collapse_onto_the_most_common_spelling():
    values = ["Cardiología"] * 5 + ["CARDIOLOGIA", "cardiologia"] + ["Urgencias"] * 3
    _, tbl = run(fold_categories, table(dept=values))
    assert set(tbl.data["dept"]) == {"Cardiología", "Urgencias"}


def test_the_accented_spelling_survives_when_it_is_the_common_one():
    """A canonical form would fix consistency by making every value wrong."""
    _, tbl = run(fold_categories, table(dept=["Cardiología"] * 4 + ["cardiologia"]))
    assert tbl.data["dept"].count("Cardiología") == 5


def test_free_text_is_not_folded_as_though_it_were_a_category():
    values = [f"note number {index} about the patient" for index in range(80)]
    _, tbl = run(fold_categories, table(note=values))
    assert tbl.data["note"] == values


# ---------------------------------------------------------------------------
# Sex — the one that must refuse rather than guess
# ---------------------------------------------------------------------------


def test_english_m_and_f_map_to_male_and_female():
    _, tbl = run(standardise_sex, table(sex=["M", "F", "M"]))
    assert tbl.data["sex"] == ["male", "female", "male"]


def test_spanish_h_and_m_means_m_is_a_woman():
    """H/M is hombre/mujer. Reading M as male inverts every woman silently."""
    _, tbl = run(standardise_sex, table(sexo=["H", "M", "H"]))
    assert tbl.data["sexo"] == ["male", "female", "male"]


def test_an_ambiguous_m_is_left_exactly_as_found():
    report, tbl = run(standardise_sex, table(sexo=["M", "hombre"]))
    assert tbl.data["sexo"] == ["M", "hombre"]
    assert "do not settle" in outcome_of(report, "standardise_sex").note


def test_spelled_out_values_map_in_both_languages():
    _, tbl = run(standardise_sex, table(gender=["masculino", "femenino", "female"]))
    assert tbl.data["gender"] == ["male", "female", "female"]


def test_a_column_that_is_not_about_sex_is_untouched():
    _, tbl = run(standardise_sex, table(essex_ward=["M", "F"]))
    assert tbl.data["essex_ward"] == ["M", "F"]


# ---------------------------------------------------------------------------
# Plausibility — flagged, never changed
# ---------------------------------------------------------------------------


def test_an_impossible_heart_rate_is_flagged_but_left_in_place():
    report, tbl = run(flag_implausible_measurements, table(heart_rate=[72, 999, 80]))
    assert tbl.data["heart_rate"] == [72, 999, 80]
    assert outcome_of(report, "flag_implausible_measurements").flagged == 1


def test_a_dangerous_but_real_reading_is_not_flagged():
    """200 mmHg systolic is an emergency, not a data error."""
    report, _ = run(flag_implausible_measurements, table(systolic=[200, 118]))
    assert outcome_of(report, "flag_implausible_measurements").flagged == 0


def test_the_flag_note_says_what_was_found_and_that_nothing_changed():
    report, _ = run(flag_implausible_measurements, table(age=[40, 400]))
    note = outcome_of(report, "flag_implausible_measurements").note
    assert "age" in note and "nothing was changed" in note


def test_text_in_a_measurement_column_is_not_compared_to_bounds():
    report, _ = run(flag_implausible_measurements, table(age=["forty"]))
    assert outcome_of(report, "flag_implausible_measurements").flagged == 0


# ---------------------------------------------------------------------------
# The standard as a whole
# ---------------------------------------------------------------------------


def full_table() -> Table:
    return table(
        **{
            "Patient ID": ["001", "001", "002", "003"],
            "Procedure Text": ["  APPENDECTOMY ", "  APPENDECTOMY ", "Colonoscopy", "N/A"],
            "Sexo": ["H", "H", "M", "M"],
            "Edad": ["44", "44", "39", "400"],
            "Recorded At": [
                "2024-06-14T09:00:00+00:00",
                "2024-06-14T09:00:00+00:00",
                "2024-06-15T10:00:00+00:00",
                "2024-06-16T11:00:00+00:00",
            ],
            "Notes": [None, None, None, None],
        }
    )


def test_the_standard_removes_only_the_duplicate_row():
    tbl = full_table()
    report = clean(tbl)
    assert report.rows_in == 4
    assert report.rows_out == 3


def test_the_standard_drops_only_the_empty_column():
    tbl = full_table()
    report = clean(tbl)
    assert "notes" not in tbl.columns
    assert report.columns_in - report.columns_out == 1


def test_the_standard_leaves_the_flagged_row_in_the_data():
    """A 400-year-old is a problem to look at, not a row to delete."""
    tbl = full_table()
    clean(tbl)
    assert 400 in tbl.data["edad"]


def test_the_standard_keeps_an_identifier_as_text():
    tbl = full_table()
    report = clean(tbl)
    assert report.types["patient_id"] == "string"
    assert tbl.data["patient_id"] == ["001", "002", "003"]


def test_the_standard_resolves_the_spanish_sex_coding():
    tbl = full_table()
    clean(tbl)
    assert tbl.data["sexo"] == ["male", "female", "female"]


def test_the_report_states_every_change_it_made():
    tbl = full_table()
    summary = clean(tbl).summary()
    rules = {entry["rule"] for entry in summary["rules"]}
    assert {"normalise_column_names", "trim_whitespace", "sentinel_nulls", "deduplicate_rows"} <= rules
    assert summary["cells_changed"] > 0
    assert summary["flagged"] == 1


def test_rules_that_changed_nothing_are_not_listed():
    """Twenty 'no change' lines bury the three that matter."""
    summary = clean(table(a=[1, 2, 3])).summary()
    assert all(entry["rule"] != "standardise_sex" for entry in summary["rules"])
    assert summary["rules_applied"] > len(summary["rules"])


def test_every_change_carries_an_example():
    summary = clean(full_table()).summary()
    changed = [entry for entry in summary["rules"] if entry["cells_changed"]]
    assert changed
    assert all(entry["examples"] for entry in changed)


def test_cleaning_an_empty_table_is_not_an_error():
    report = clean(table(a=[], b=[]))
    assert report.rows_in == 0 and report.rows_out == 0


def test_order_matters_a_null_placeholder_does_not_block_a_numeric_cast():
    """If sentinels were resolved after casting, this column would stay text."""
    tbl = table(age=["40", "N/A", "55"])
    report = clean(tbl)
    assert report.types["age"] == "integer"
    assert tbl.data["age"] == [40, None, 55]
