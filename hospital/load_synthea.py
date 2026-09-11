"""Populate the simulated Hospital Information System from Synthea data.

Runs once, on an empty database, and is a no-op afterwards — so it is safe to
leave wired into ``docker compose up``.

What it does, in order:

1. Fetches Synthea's published sample extract (or reads a local copy).
2. Applies ``schema.sql``.
3. Loads the operational tables.
4. Degrades the clinical free text and drops the code on a fraction of rows,
   recording the truth in ``eval.*`` — see ``degradation.py`` for why.

The result is a source that looks like a hospital's own system: incomplete
coding, inconsistent free text, measurements stored as strings.

Configuration (all optional, all via environment):

    HOSPITAL_DB_URL       postgresql://user:pass@host:5432/hospital
    SYNTHEA_URL           override the sample-data download
    SYNTHEA_LOCAL_ZIP     load this zip instead of downloading
    SYNTHEA_SEED          seed for the degradation (default 20260911)
    UNCODED_FRACTION      share of clinical rows with no code (default 0.40)
    HOSPITAL_FORCE_RELOAD truthy to wipe and reload an already-populated DB
"""
from __future__ import annotations

import csv
import io
import os
import random
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Callable, Iterator, Sequence

import psycopg2

from degradation import degrade

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_SYNTHEA_URL = (
    "https://synthetichealth.github.io/synthea-sample-data/downloads/latest/"
    "synthea_sample_data_csv_latest.zip"
)

DB_URL = os.getenv(
    "HOSPITAL_DB_URL", "postgresql://hospital:hospital@hospital-db:5432/hospital"
)
SEED = int(os.getenv("SYNTHEA_SEED", "20260911"))
UNCODED_FRACTION = float(os.getenv("UNCODED_FRACTION", "0.40"))
FORCE_RELOAD = os.getenv("HOSPITAL_FORCE_RELOAD", "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

HERE = Path(__file__).resolve().parent


def log(message: str) -> None:
    """Print immediately: this runs as a container entrypoint, unbuffered."""
    print(f"[hospital] {message}", flush=True)


# ---------------------------------------------------------------------------
# Source data
# ---------------------------------------------------------------------------


def fetch_synthea(destination: Path) -> Path:
    """Return a directory holding Synthea's CSV extract."""
    local = os.getenv("SYNTHEA_LOCAL_ZIP", "").strip()
    if local:
        archive = Path(local)
        if not archive.is_file():
            raise SystemExit(f"SYNTHEA_LOCAL_ZIP does not exist: {archive}")
        log(f"using local extract {archive}")
    else:
        url = os.getenv("SYNTHEA_URL", DEFAULT_SYNTHEA_URL)
        archive = destination / "synthea.zip"
        log(f"downloading {url}")
        with urllib.request.urlopen(url, timeout=300) as response:
            archive.write_bytes(response.read())
        log(f"downloaded {archive.stat().st_size / 1_048_576:.1f} MiB")

    extracted = destination / "csv"
    extracted.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as zf:
        zf.extractall(extracted)

    # The archive has carried its CSVs at the root and under a directory in
    # different releases; find them wherever they landed.
    candidates = list(extracted.rglob("patients.csv"))
    if not candidates:
        raise SystemExit("no patients.csv in the Synthea extract")
    return candidates[0].parent


def read_csv(directory: Path, name: str) -> Iterator[dict[str, str]]:
    """Yield rows of one Synthea CSV."""
    path = directory / f"{name}.csv"
    if not path.is_file():
        log(f"  {name}.csv absent, skipping")
        return
    with path.open(encoding="utf-8-sig", newline="") as handle:
        yield from csv.DictReader(handle)


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def copy_rows(cursor: Any, table: str, columns: Sequence[str], rows: list[list[Any]]) -> int:
    """Bulk-insert ``rows`` with COPY.

    COPY rather than executemany because observations alone run to tens of
    thousands of rows and this script is on the critical path of a cold start.
    """
    if not rows:
        return 0
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    for row in rows:
        writer.writerow(["" if value is None else value for value in row])
    buffer.seek(0)
    cursor.copy_expert(
        f"COPY {table} ({', '.join(columns)}) FROM STDIN WITH (FORMAT csv, NULL '')",
        buffer,
    )
    return len(rows)


def blank_to_none(value: str | None) -> str | None:
    """Synthea writes an empty field where there is no value."""
    if value is None:
        return None
    value = value.strip()
    return value or None


def load_table(
    cursor: Any,
    directory: Path,
    source: str,
    table: str,
    columns: Sequence[str],
    build: Callable[[dict[str, str]], list[Any] | None],
) -> None:
    """Load one Synthea CSV into one table via ``build``.

    ``build`` returns the column values for a row, or ``None`` to skip it.
    """
    rows = [built for row in read_csv(directory, source) if (built := build(row)) is not None]
    count = copy_rows(cursor, table, columns, rows)
    log(f"  {table}: {count:,} rows")


# ---------------------------------------------------------------------------
# Clinical tables: degradation happens here
# ---------------------------------------------------------------------------


def load_clinical(
    cursor: Any,
    directory: Path,
    source: str,
    table: str,
    code_column: str,
    text_column: str,
    extra_columns: Sequence[str],
    build_extra: Callable[[dict[str, str]], list[Any]],
    truth_table: str,
    truth_key: str,
    rng: random.Random,
) -> dict[str, str]:
    """Load a clinical table, degrading its free text.

    Every row keeps its canonical code and description in ``eval``; the
    operational table gets the degraded text and, for a share of rows, no code
    at all.

    Returns ``{code: canonical_term}`` for the vocabulary. One term per code:
    in the current sample each code has exactly one description, but a future
    Synthea release with two would otherwise violate ``eval.vocabulary``'s
    primary key and fail the whole load with an error that says nothing about
    the cause. The first term wins and the collision is logged.
    """
    operational: list[list[Any]] = []
    truth: list[list[Any]] = []
    vocabulary: dict[str, str] = {}
    ambiguous_codes: set[str] = set()

    row_id = 0
    for row in read_csv(directory, source):
        canonical_text = (row.get("DESCRIPTION") or "").strip()
        canonical_code = (row.get("CODE") or "").strip()
        if not canonical_text or not canonical_code:
            continue

        row_id += 1
        existing = vocabulary.setdefault(canonical_code, canonical_text)
        if existing != canonical_text:
            ambiguous_codes.add(canonical_code)

        degraded_text, degradation = degrade(canonical_text, rng)
        uncoded = rng.random() < UNCODED_FRACTION

        operational.append(
            [row_id, None if uncoded else canonical_code, degraded_text, *build_extra(row)]
        )
        truth.append([row_id, canonical_code, canonical_text, degradation, uncoded])

    columns = ["id", code_column, text_column, *extra_columns]
    count = copy_rows(cursor, table, columns, operational)
    copy_rows(
        cursor,
        truth_table,
        [truth_key, "true_code", "true_text", "degradation", "was_uncoded"],
        truth,
    )
    # BIGSERIAL does not advance when ids arrive through COPY.
    cursor.execute(
        f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), GREATEST(%s, 1))",
        (row_id,),
    )

    dirty = sum(1 for t in truth if t[3] is not None)
    missing = sum(1 for t in truth if t[4])
    log(
        f"  {table}: {count:,} rows "
        f"({dirty:,} with degraded text, {missing:,} with no code)"
    )
    if ambiguous_codes:
        log(
            f"    note: {len(ambiguous_codes)} code(s) carried more than one "
            "description; kept the first as the canonical term"
        )
    return vocabulary


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def already_loaded(cursor: Any) -> bool:
    cursor.execute(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = 'public' AND table_name = 'patients')"
    )
    if not cursor.fetchone()[0]:
        return False
    cursor.execute("SELECT COUNT(*) FROM patients")
    return cursor.fetchone()[0] > 0


def wipe(cursor: Any) -> None:
    log("HOSPITAL_FORCE_RELOAD set: dropping existing data")
    cursor.execute("DROP SCHEMA IF EXISTS eval CASCADE")
    cursor.execute(
        "DROP TABLE IF EXISTS observations, medications, procedures, conditions, "
        "encounters, patients, providers, payers, organizations CASCADE"
    )


def main() -> int:
    log(f"connecting to {DB_URL.rsplit('@', 1)[-1]}")
    connection = psycopg2.connect(DB_URL)
    connection.autocommit = False

    try:
        with connection.cursor() as cursor:
            if already_loaded(cursor):
                if not FORCE_RELOAD:
                    log("already populated, nothing to do")
                    return 0
                wipe(cursor)

            log("applying schema")
            cursor.execute((HERE / "schema.sql").read_text(encoding="utf-8"))

            with tempfile.TemporaryDirectory() as tmp:
                directory = fetch_synthea(Path(tmp))
                log(f"loading from {directory}")
                rng = random.Random(SEED)

                load_table(
                    cursor, directory, "organizations", "organizations",
                    ["id", "name", "address", "city", "state", "zip", "phone",
                     "revenue", "utilization"],
                    lambda r: [r["Id"], blank_to_none(r["NAME"]),
                               blank_to_none(r["ADDRESS"]), blank_to_none(r["CITY"]),
                               blank_to_none(r["STATE"]), blank_to_none(r["ZIP"]),
                               blank_to_none(r["PHONE"]), blank_to_none(r["REVENUE"]),
                               blank_to_none(r["UTILIZATION"])],
                )

                load_table(
                    cursor, directory, "providers", "providers",
                    ["id", "organization_id", "name", "gender", "speciality",
                     "city", "state"],
                    lambda r: [r["Id"], blank_to_none(r["ORGANIZATION"]),
                               blank_to_none(r["NAME"]), blank_to_none(r["GENDER"]),
                               blank_to_none(r["SPECIALITY"]), blank_to_none(r["CITY"]),
                               blank_to_none(r["STATE"])],
                )

                load_table(
                    cursor, directory, "payers", "payers",
                    ["id", "name", "ownership"],
                    lambda r: [r["Id"], blank_to_none(r["NAME"]),
                               blank_to_none(r["OWNERSHIP"])],
                )

                load_table(
                    cursor, directory, "patients", "patients",
                    ["id", "birthdate", "deathdate", "ssn", "first_name", "last_name",
                     "marital_status", "race", "ethnicity", "gender", "birthplace",
                     "address", "city", "state", "county", "zip",
                     "healthcare_expenses", "healthcare_coverage", "income"],
                    lambda r: [r["Id"], blank_to_none(r["BIRTHDATE"]),
                               blank_to_none(r["DEATHDATE"]), blank_to_none(r["SSN"]),
                               blank_to_none(r["FIRST"]), blank_to_none(r["LAST"]),
                               blank_to_none(r["MARITAL"]), blank_to_none(r["RACE"]),
                               blank_to_none(r["ETHNICITY"]), blank_to_none(r["GENDER"]),
                               blank_to_none(r["BIRTHPLACE"]), blank_to_none(r["ADDRESS"]),
                               blank_to_none(r["CITY"]), blank_to_none(r["STATE"]),
                               blank_to_none(r["COUNTY"]), blank_to_none(r["ZIP"]),
                               blank_to_none(r["HEALTHCARE_EXPENSES"]),
                               blank_to_none(r["HEALTHCARE_COVERAGE"]),
                               blank_to_none(r["INCOME"])],
                )

                load_table(
                    cursor, directory, "encounters", "encounters",
                    ["id", "started_at", "stopped_at", "patient_id", "organization_id",
                     "provider_id", "payer_id", "encounter_class", "encounter_code",
                     "encounter_text", "base_cost", "total_claim_cost",
                     "payer_coverage", "reason_code", "reason_text"],
                    lambda r: [r["Id"], blank_to_none(r["START"]),
                               blank_to_none(r["STOP"]), blank_to_none(r["PATIENT"]),
                               blank_to_none(r["ORGANIZATION"]),
                               blank_to_none(r["PROVIDER"]), blank_to_none(r["PAYER"]),
                               blank_to_none(r["ENCOUNTERCLASS"]),
                               blank_to_none(r["CODE"]), blank_to_none(r["DESCRIPTION"]),
                               blank_to_none(r["BASE_ENCOUNTER_COST"]),
                               blank_to_none(r["TOTAL_CLAIM_COST"]),
                               blank_to_none(r["PAYER_COVERAGE"]),
                               blank_to_none(r["REASONCODE"]),
                               blank_to_none(r["REASONDESCRIPTION"])],
                )

                procedure_vocabulary = load_clinical(
                    cursor, directory, "procedures", "procedures",
                    code_column="procedure_code", text_column="procedure_text",
                    extra_columns=["started_at", "stopped_at", "patient_id",
                                   "encounter_id", "base_cost", "reason_code",
                                   "reason_text"],
                    build_extra=lambda r: [
                        blank_to_none(r["START"]), blank_to_none(r["STOP"]),
                        blank_to_none(r["PATIENT"]), blank_to_none(r["ENCOUNTER"]),
                        blank_to_none(r["BASE_COST"]), blank_to_none(r["REASONCODE"]),
                        blank_to_none(r["REASONDESCRIPTION"]),
                    ],
                    truth_table="eval.procedure_truth", truth_key="procedure_id",
                    rng=rng,
                )

                condition_vocabulary = load_clinical(
                    cursor, directory, "conditions", "conditions",
                    code_column="condition_code", text_column="condition_text",
                    extra_columns=["started_on", "stopped_on", "patient_id",
                                   "encounter_id"],
                    build_extra=lambda r: [
                        blank_to_none(r["START"]), blank_to_none(r["STOP"]),
                        blank_to_none(r["PATIENT"]), blank_to_none(r["ENCOUNTER"]),
                    ],
                    truth_table="eval.condition_truth", truth_key="condition_id",
                    rng=rng,
                )

                load_table(
                    cursor, directory, "medications", "medications",
                    ["started_at", "stopped_at", "patient_id", "encounter_id",
                     "medication_code", "medication_text", "base_cost", "dispenses",
                     "total_cost", "reason_code", "reason_text"],
                    lambda r: [blank_to_none(r["START"]), blank_to_none(r["STOP"]),
                               blank_to_none(r["PATIENT"]), blank_to_none(r["ENCOUNTER"]),
                               blank_to_none(r["CODE"]), blank_to_none(r["DESCRIPTION"]),
                               blank_to_none(r["BASE_COST"]), blank_to_none(r["DISPENSES"]),
                               blank_to_none(r["TOTALCOST"]), blank_to_none(r["REASONCODE"]),
                               blank_to_none(r["REASONDESCRIPTION"])],
                )

                load_table(
                    cursor, directory, "observations", "observations",
                    ["observed_at", "patient_id", "encounter_id", "category",
                     "observation_code", "observation_text", "value_raw", "units",
                     "value_type"],
                    lambda r: [blank_to_none(r["DATE"]), blank_to_none(r["PATIENT"]),
                               blank_to_none(r["ENCOUNTER"]), blank_to_none(r["CATEGORY"]),
                               blank_to_none(r["CODE"]), blank_to_none(r["DESCRIPTION"]),
                               blank_to_none(r["VALUE"]), blank_to_none(r["UNITS"]),
                               blank_to_none(r["TYPE"])],
                )

                vocabulary_rows = (
                    [[code, term, "procedure"]
                     for code, term in sorted(procedure_vocabulary.items())]
                    + [[code, term, "condition"]
                       for code, term in sorted(condition_vocabulary.items())]
                )
                copy_rows(
                    cursor, "eval.vocabulary", ["code", "term", "domain"], vocabulary_rows
                )
                log(f"  eval.vocabulary: {len(vocabulary_rows):,} terms")

        connection.commit()
        log("done")
        return 0
    except Exception as exc:  # noqa: BLE001 — report and fail the container
        connection.rollback()
        log(f"FAILED: {exc}")
        raise
    finally:
        connection.close()


if __name__ == "__main__":
    sys.exit(main())
