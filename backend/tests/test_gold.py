"""Tests for the gold layer: a query over silver, materialised as one table.

The part worth being strict about is :func:`validate_sql`. A gold definition is
written once — increasingly by a model — and then executed on every extraction
for as long as the project lives. Something that gets in only because nobody
checked that day runs unattended thereafter.
"""
from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

from core import gold
from core.gold import (
    GoldError,
    build,
    default_sql,
    describe_relations,
    validate_sql,
)
from core.medallion import iter_rows, write_typed


@pytest.fixture()
def patients(tmp_path) -> Path:
    path = tmp_path / "patients.parquet"
    write_typed(
        ["patient_id", "age"],
        {"patient_id": ["p1", "p2", "p3"], "age": [44, 39, 71]},
        {"patient_id": "string", "age": "integer"},
        path,
    )
    return path


@pytest.fixture()
def encounters(tmp_path) -> Path:
    path = tmp_path / "encounters.parquet"
    write_typed(
        ["patient_id", "cost"],
        {"patient_id": ["p1", "p1", "p2"], "cost": [100.0, 250.0, 75.0]},
        {"patient_id": "string", "cost": "decimal"},
        path,
    )
    return path


# ---------------------------------------------------------------------------
# What a definition is allowed to be
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "sql",
    [
        "DROP TABLE patients",
        "SELECT 1; DROP TABLE patients",
        "CREATE TABLE x AS SELECT 1",
        "COPY patients TO 'out.csv'",
        "INSTALL httpfs",
        "SELECT * FROM patients; DELETE FROM patients",
        "-- harmless\nDROP TABLE patients",
        "/* nothing to see */ DROP TABLE patients",
    ],
)
def test_a_definition_that_is_not_a_read_is_refused(sql):
    with pytest.raises(GoldError):
        validate_sql(sql)


def test_a_comment_cannot_hide_a_second_statement():
    with pytest.raises(GoldError):
        validate_sql("SELECT 1 /* ; DROP TABLE patients */ ; DROP TABLE patients")


def test_an_empty_definition_is_refused():
    with pytest.raises(GoldError, match="empty"):
        validate_sql("   ")


def test_a_plain_select_is_accepted():
    validate_sql("SELECT patient_id, age FROM patients WHERE age > 40")


def test_a_cte_is_accepted():
    validate_sql("WITH recent AS (SELECT * FROM patients) SELECT * FROM recent")


def test_a_trailing_semicolon_is_not_a_second_statement():
    validate_sql("SELECT * FROM patients;")


# ---------------------------------------------------------------------------
# The default
# ---------------------------------------------------------------------------


def test_one_source_means_everything_that_source_landed():
    assert default_sql(["patients"]) == "SELECT * FROM patients"


def test_several_sources_are_stacked_by_name_not_by_position():
    """Two sources agreeing on a column count is a coincidence, not a schema."""
    assert "UNION ALL BY NAME" in default_sql(["patients", "encounters"])


def test_a_project_with_no_silver_cannot_have_a_default():
    with pytest.raises(GoldError, match="no silver data"):
        default_sql([])


# ---------------------------------------------------------------------------
# Building
# ---------------------------------------------------------------------------


def test_the_default_returns_every_row(tmp_path, patients):
    result, _ = build({"patients": [patients]}, default_sql(["patients"]), tmp_path / "gold.parquet")
    assert result.rows == 3


def test_several_objects_of_one_source_are_read_as_one_table(tmp_path, patients):
    """Silver accumulates; a build that read only the newest object would lose history."""
    second = tmp_path / "patients-2.parquet"
    write_typed(
        ["patient_id", "age"], {"patient_id": ["p4"], "age": [58]},
        {"patient_id": "string", "age": "integer"}, second,
    )
    result, _ = build({"patients": [patients, second]}, "SELECT * FROM patients", tmp_path / "g.parquet")
    assert result.rows == 4


def test_a_schema_that_widened_between_runs_does_not_shift_the_columns(tmp_path, patients):
    """A column added last month is absent from older objects; union by name."""
    widened = tmp_path / "patients-wide.parquet"
    write_typed(
        ["patient_id", "age", "ward"],
        {"patient_id": ["p9"], "age": [30], "ward": ["ICU"]},
        {"patient_id": "string", "age": "integer", "ward": "string"},
        widened,
    )
    result, _ = build({"patients": [patients, widened]}, "SELECT * FROM patients", tmp_path / "g.parquet")

    rows = {row["patient_id"]: row for row in iter_rows(result.path)}
    assert rows["p9"]["ward"] == "ICU"
    assert rows["p1"]["ward"] is None
    assert rows["p1"]["age"] == 44, "the older rows keep their own values"


def test_a_join_across_two_sources_is_what_gold_is_for(tmp_path, patients, encounters):
    result, _ = build(
        {"patients": [patients], "encounters": [encounters]},
        """
        SELECT p.patient_id, p.age, count(e.cost) AS visits, coalesce(sum(e.cost), 0) AS total
        FROM patients p LEFT JOIN encounters e USING (patient_id)
        GROUP BY 1, 2
        """,
        tmp_path / "gold.parquet",
    )

    rows = {row["patient_id"]: row for row in iter_rows(result.path)}
    assert result.rows == 3
    assert rows["p1"]["visits"] == 2 and rows["p1"]["total"] == 350.0
    assert rows["p3"]["visits"] == 0, "a patient with no encounter is still a patient"


def test_the_build_reports_what_each_relation_contributed(tmp_path, patients, encounters):
    """So a gold table returning nothing can be told from one whose inputs were."""
    result, _ = build(
        {"patients": [patients], "encounters": [encounters]},
        "SELECT * FROM patients WHERE age > 200",
        tmp_path / "gold.parquet",
    )
    assert result.rows == 0
    assert result.relations == {"patients": 3, "encounters": 3}


def test_an_empty_result_still_leaves_a_readable_file(tmp_path, patients):
    """'Returned nothing' and 'did not run' are different answers."""
    result, _ = build({"patients": [patients]}, "SELECT * FROM patients WHERE false", tmp_path / "g.parquet")
    assert result.path.exists()
    assert list(iter_rows(result.path)) == []
    assert result.columns == ["patient_id", "age"]


def test_the_preview_returns_the_first_rows_without_a_second_build(tmp_path, patients):
    _, preview = build(
        {"patients": [patients]}, "SELECT * FROM patients ORDER BY age", tmp_path / "g.parquet",
        preview_rows=2,
    )
    assert preview == [["p2", 39], ["p1", 44]]


def test_a_definition_naming_a_relation_that_does_not_exist_says_so(tmp_path, patients):
    with pytest.raises(GoldError, match="the gold definition failed"):
        build({"patients": [patients]}, "SELECT * FROM encounters", tmp_path / "g.parquet")


def test_a_destructive_definition_is_refused_before_it_reaches_duckdb(tmp_path, patients):
    with pytest.raises(GoldError, match="must start with SELECT"):
        build({"patients": [patients]}, "DROP TABLE patients", tmp_path / "g.parquet")


def test_a_read_that_hides_a_write_is_refused_too(tmp_path, patients):
    """Starting with SELECT is not the same as being a read."""
    with pytest.raises(GoldError, match="may only read"):
        build(
            {"patients": [patients]},
            "SELECT * FROM patients UNION ALL SELECT * FROM (INSERT INTO patients VALUES ('x', 1))",
            tmp_path / "g.parquet",
        )


def test_a_relation_name_that_is_not_an_identifier_is_refused(tmp_path, patients):
    with pytest.raises(GoldError, match="not a usable relation name"):
        build({"patients; DROP TABLE x": [patients]}, "SELECT 1", tmp_path / "g.parquet")


# ---------------------------------------------------------------------------
# Describing, which is what a definition gets written against
# ---------------------------------------------------------------------------


def test_relations_are_described_with_their_types_and_row_counts(patients, encounters):
    described = describe_relations({"patients": [patients], "encounters": [encounters]})

    assert described["patients"]["rows"] == 3
    types = {column["name"]: column["type"] for column in described["patients"]["columns"]}
    assert types["age"] == "BIGINT"
    assert types["patient_id"] == "VARCHAR"


def test_a_source_with_no_silver_yet_is_simply_absent(patients):
    described = describe_relations({"patients": [patients], "encounters": []})
    assert "encounters" not in described


# ---------------------------------------------------------------------------
# Reading anything but silver
#
# A definition runs in the worker and the API, beside the database password,
# the encryption key and the object-store credentials. It may read the
# project's silver relations and nothing else: no file, no URL, no environment.
# ---------------------------------------------------------------------------


@pytest.fixture()
def secret(tmp_path) -> Path:
    """A file outside silver, standing in for /proc/self/environ or a .env.

    A real file the test can prove is readable, rather than /etc/hosts: a path
    that does not exist (as on Windows) would fail without any sandbox at all,
    and a test that cannot fail proves nothing.
    """
    path = tmp_path / "worker-env.csv"
    path.write_text("key,value\nFERNET_KEY,not-a-real-key\n")
    return path


@pytest.fixture()
def unvalidated(monkeypatch):
    """Switch :func:`validate_sql` off, so the sealed connection stands alone."""
    monkeypatch.setattr(gold, "validate_sql", lambda sql: None)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM read_text('/etc/hosts')",
        "SELECT * FROM read_text('/proc/self/environ')",
        "SELECT * FROM read_csv('/etc/passwd')",
        "SELECT * FROM read_csv_auto('C:/app/.env')",
        "SELECT * FROM read_blob('/etc/hosts')",
        "SELECT * FROM read_json_auto('/run/secrets/db.json')",
        "SELECT * FROM read_parquet('s3://gold/other-project/gold.parquet')",
        "SELECT * FROM parquet_scan('/tmp/*/silver/*/part-*.parquet')",
        "SELECT * FROM glob('/')",
        "SELECT * FROM sniff_csv('/etc/passwd')",
        "SELECT getenv('FERNET_KEY')",
        # Spelled to slip past a naive check.
        'SELECT * FROM "read_text"(\'/etc/hosts\')',
        "SELECT * FROM main.read_text('/etc/hosts')",
        "SELECT * FROM READ_TEXT  ('/etc/hosts')",
        "SELECT * FROM read_text/* nothing here */('/etc/hosts')",
        # Hidden inside an otherwise ordinary query.
        "SELECT p.* FROM patients p CROSS JOIN read_csv('/etc/passwd') AS x",
        "WITH x AS (SELECT * FROM read_text('/etc/hosts')) SELECT * FROM patients, x",
    ],
)
def test_a_definition_that_reads_files_or_the_network_is_refused(sql):
    with pytest.raises(GoldError, match="reads files, URLs or the environment"):
        validate_sql(sql)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM '/etc/passwd.csv'",
        "SELECT * FROM 's3://bucket/x.parquet'",
        "SELECT * FROM patients JOIN '/tmp/other/part-00000.parquet' USING (patient_id)",
        'SELECT * FROM "/tmp/*/silver/*.parquet"',
    ],
)
def test_a_path_used_as_a_table_is_refused(sql):
    """DuckDB reads ``FROM 'file.csv'`` without any function being named."""
    with pytest.raises(GoldError, match="by its path"):
        validate_sql(sql)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT glob_pattern, my_read_csv_flag FROM patients",
        "SELECT * FROM patients WHERE ward GLOB 'IC*'",
        "SELECT * FROM patients WHERE status IS DISTINCT FROM 'closed'",
        "SELECT EXTRACT(year FROM '2024-01-01'::date) AS y FROM patients",
        "SELECT 'please read the text' AS note FROM \"patients\"",
    ],
)
def test_the_file_checks_do_not_refuse_ordinary_queries(sql):
    validate_sql(sql)


@pytest.mark.parametrize(
    "template",
    [
        "SELECT content FROM read_text('{path}')",
        "SELECT * FROM read_csv('{path}')",
        "SELECT * FROM read_blob('{path}')",
        "SELECT * FROM '{path}'",
        "SELECT * FROM glob('{directory}/*')",
        "SELECT p.patient_id, s.* FROM patients p CROSS JOIN read_csv('{path}') AS s",
    ],
)
def test_with_validation_bypassed_the_build_still_cannot_read_a_file(
    tmp_path, patients, secret, unvalidated, monkeypatch, template
):
    """The seal does not depend on validate_sql having caught the query."""
    sql = template.format(path=secret.as_posix(), directory=secret.parent.as_posix())
    relations = {"patients": [patients]}

    # The control: unsealed, this exact query reaches the file. So the refusal
    # below is the seal's doing, not a typo or a path that does not exist.
    with monkeypatch.context() as unsealed:
        unsealed.setattr(gold, "_seal", lambda connection: None)
        _, leaked = build(relations, sql, tmp_path / "leak.parquet", preview_rows=10)
    assert "not-a-real-key" in str(leaked) or secret.name in str(leaked)

    with pytest.raises(GoldError, match="disabled through configuration") as caught:
        build(relations, sql, tmp_path / "gold.parquet")
    assert "not-a-real-key" not in str(caught.value)


def test_the_connection_a_definition_runs_on_is_sealed_and_locked(patients):
    connection = gold._connect({"patients": [patients]})
    try:
        settings = {
            name: connection.execute(f"SELECT current_setting('{name}')").fetchone()[0]
            for name in (
                "enable_external_access",
                "lock_configuration",
                "python_enable_replacements",
            )
        }
        assert settings == {
            "enable_external_access": False,
            "lock_configuration": True,
            "python_enable_replacements": False,
        }
        # A definition cannot open the door again, whatever it is wrapped in.
        with pytest.raises(duckdb.Error, match="locked"):
            connection.execute("SET enable_external_access = true")
        with pytest.raises(duckdb.Error, match="locked"):
            connection.execute("RESET lock_configuration")
        # Silver was copied in before the seal, so it is still there to read.
        # A view over the Parquet files would fail here: it reads its files
        # when queried, and by now no file can be read.
        assert connection.execute("SELECT count(*) FROM patients").fetchone()[0] == 3
    finally:
        connection.close()


def test_the_default_over_several_sources_still_builds(tmp_path, patients, encounters):
    """The sealed build changes where silver lives, not what gold contains."""
    relations = {"encounters": [encounters], "patients": [patients]}
    result, _ = build(relations, default_sql(sorted(relations)), tmp_path / "gold.parquet")

    assert result.rows == 6
    assert set(result.columns) == {"patient_id", "age", "cost"}
    assert result.relations == {"encounters": 3, "patients": 3}
