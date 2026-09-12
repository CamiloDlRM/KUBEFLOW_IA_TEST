"""The cleaning standard: what turns bronze into silver.

One standard, applied to every source, in three tiers. The tiers are ordered by
how much they assume about the data, and each tier is only allowed to assume
what the one before it has established.

**Tier 1 — structural.** True of any tabular data whatever it describes.
Column names, whitespace, the strings that mean "no value", types, exact
duplicate rows. Nothing here knows what a column *means*.

**Tier 2 — categorical.** True of any data with categories. Booleans written
eleven different ways, and low-cardinality columns where ``"Cardiología"``,
``"CARDIOLOGIA"`` and ``"cardiologia "`` are one category recorded by three
people.

**Tier 3 — domain.** Health data specifically: sex recorded in two languages
with a collision between them, and measurements with a physically plausible
range. Everything in this tier is either a rename to a standard vocabulary or a
*flag* — never a deletion.

Three rules hold across all of it, and they are what make the silver layer
something a reviewer can trust rather than a folder called "clean".

**Only exact duplicate rows are ever removed.** Every other problem is either
corrected in place or reported. A cleaning step that drops rows it dislikes
destroys the evidence that it was wrong to dislike them.

**A type is claimed only when every value supports it.** A column that is 99%
numeric and 1% ``"pending"`` is not a numeric column. Casting it would turn
that 1% into nulls — deleting data in order to make a type claim true, and the
1% is usually the interesting part.

**Everything that changed is counted, with examples.** The report is not a log;
it is the deliverable. A silver layer whose difference from bronze cannot be
stated is indistinguishable from a copy.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Final, Sequence

import structlog

logger = structlog.get_logger(__name__)

__all__ = [
    "Table",
    "RuleOutcome",
    "CleaningReport",
    "clean",
    "TIERS",
]

TIERS: Final[tuple[str, str, str]] = ("structural", "categorical", "domain")

#: Kept per rule so the report can show what a change looked like without
#: carrying the data itself.
_MAX_EXAMPLES: Final[int] = 3

#: How many removed row numbers the report carries. Enough to line up the two
#: layers for any preview a person will read, bounded so the report cannot grow
#: with the extraction.
_MAX_REMOVED_TRACKED: Final[int] = 2_000


# ---------------------------------------------------------------------------
# The table being cleaned
# ---------------------------------------------------------------------------


@dataclass
class Table:
    """A columnar table. Cleaning rewrites it in place.

    Columnar because almost every rule is a decision about a whole column —
    what type it is, which spellings it uses — taken once and then applied to
    its values. Row-wise, each rule would re-derive that decision per row.
    """

    columns: list[str]
    data: dict[str, list[Any]]

    @property
    def rows(self) -> int:
        if not self.columns:
            return 0
        return len(self.data[self.columns[0]])

    def drop(self, column: str) -> None:
        self.columns.remove(column)
        del self.data[column]

    def rename(self, old: str, new: str) -> None:
        self.columns[self.columns.index(old)] = new
        self.data[new] = self.data.pop(old)

    @classmethod
    def from_rows(cls, rows: Sequence[dict[str, Any]], columns: Sequence[str]) -> "Table":
        data = {name: [row.get(name) for row in rows] for name in columns}
        return cls(columns=list(columns), data=data)

    def to_rows(self) -> list[dict[str, Any]]:
        return [
            {name: self.data[name][index] for name in self.columns}
            for index in range(self.rows)
        ]


# ---------------------------------------------------------------------------
# The report
# ---------------------------------------------------------------------------


@dataclass
class RuleOutcome:
    """What one rule did. A rule that did nothing still appears, saying zero."""

    tier: str
    rule: str
    title: str
    columns: list[str] = field(default_factory=list)
    cells_changed: int = 0
    rows_removed: int = 0
    columns_removed: int = 0
    flagged: int = 0
    note: str = ""
    examples: list[dict[str, Any]] = field(default_factory=list)
    #: Bronze row numbers this rule removed, so a later reader can line the two
    #: layers up again. Only deduplication fills it — it is the one rule that
    #: removes rows — and it is capped: past the cap the two layers can only be
    #: aligned approximately, which the diff says out loud rather than
    #: pretending otherwise.
    removed_rows: list[int] = field(default_factory=list)
    removed_rows_truncated: bool = False

    def record(self, column: str, before: Any, after: Any) -> None:
        """Keep a distinct example of what this rule did.

        Distinct matters: the first three changes a rule makes are usually the
        same change three times, because the value that needed correcting is
        the one that repeats. Three copies of it teach a reader nothing that
        one does, and crowd out the second and third *kinds* of change.
        """
        if len(self.examples) >= _MAX_EXAMPLES:
            return
        if any(
            example["before"] == before and example["after"] == after
            for example in self.examples
        ):
            return
        self.examples.append({"column": column, "before": before, "after": after})

    @property
    def changed(self) -> bool:
        """Whether this rule did anything worth showing.

        ``columns`` counts because a rule can act on a column without changing
        a cell: giving a column a type is a change to the data's shape, and
        reporting it as sixty thousand changed values buried the two thousand
        that were genuinely corrected.
        """
        return bool(
            self.cells_changed
            or self.rows_removed
            or self.columns_removed
            or self.flagged
            or self.columns
        )

    def summary(self) -> dict[str, Any]:
        return {
            "tier": self.tier,
            "rule": self.rule,
            "title": self.title,
            "columns": self.columns,
            "cells_changed": self.cells_changed,
            "rows_removed": self.rows_removed,
            "columns_removed": self.columns_removed,
            "flagged": self.flagged,
            "note": self.note,
            "examples": self.examples,
            "removed_rows": self.removed_rows,
            "removed_rows_truncated": self.removed_rows_truncated,
        }


@dataclass
class CleaningReport:
    """The difference between a bronze object and the silver one built from it."""

    rows_in: int = 0
    rows_out: int = 0
    columns_in: int = 0
    columns_out: int = 0
    outcomes: list[RuleOutcome] = field(default_factory=list)
    types: dict[str, str] = field(default_factory=dict)
    renamed: dict[str, str] = field(default_factory=dict)

    def add(self, outcome: RuleOutcome) -> RuleOutcome:
        self.outcomes.append(outcome)
        return outcome

    @property
    def cells_changed(self) -> int:
        return sum(outcome.cells_changed for outcome in self.outcomes)

    @property
    def flagged(self) -> int:
        return sum(outcome.flagged for outcome in self.outcomes)

    def summary(self) -> dict[str, Any]:
        return {
            "rows_in": self.rows_in,
            "rows_out": self.rows_out,
            "columns_in": self.columns_in,
            "columns_out": self.columns_out,
            "cells_changed": self.cells_changed,
            "flagged": self.flagged,
            "types": self.types,
            "renamed": self.renamed,
            # Rules that did nothing are dropped here, not above: the caller
            # wants to read what happened, and twenty "0 changes" lines bury
            # the three that matter. The full list stays available in memory
            # for tests and for anyone asking whether a rule ran at all.
            "rules": [outcome.summary() for outcome in self.outcomes if outcome.changed],
            "rules_applied": len(self.outcomes),
        }


# ---------------------------------------------------------------------------
# Tier 1 — structural
# ---------------------------------------------------------------------------

_NON_NAME = re.compile(r"[^a-z0-9]+")


def _snake(name: str) -> str:
    """Return a column name as lowercase snake_case ASCII."""
    # Split camelCase before folding case, or "patientId" becomes "patientid".
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", name.strip())
    folded = unicodedata.normalize("NFKD", spaced).encode("ascii", "ignore").decode()
    return _NON_NAME.sub("_", folded.lower()).strip("_") or "column"


def normalise_column_names(table: Table, report: CleaningReport) -> None:
    """Rename columns to snake_case ASCII.

    Downstream this is the difference between a query someone can type and one
    they have to quote. A collision (two columns differing only in case) is
    resolved by suffixing rather than by dropping one of them.
    """
    outcome = report.add(
        RuleOutcome("structural", "normalise_column_names", "Column names standardised")
    )
    # Every target is worked out before anything is renamed. Renaming as we go
    # would let "Code" land on the key "code" that the *next* column still
    # occupies, silently replacing its values with the other column's.
    targets: list[str] = []
    seen: set[str] = set()
    for original in table.columns:
        target = _snake(original)
        if target in seen:
            index = 2
            while f"{target}_{index}" in seen:
                index += 1
            target = f"{target}_{index}"
        seen.add(target)
        targets.append(target)

    rebuilt = {target: table.data[original] for original, target in zip(table.columns, targets)}
    for original, target in zip(table.columns, targets):
        if target != original:
            report.renamed[original] = target
            # Counted as a column, not as a changed value: renaming a header
            # touches no data, and adding it to the cell total would inflate
            # the one number a reader uses to judge how much was corrected.
            outcome.columns.append(target)
            outcome.record(original, original, target)
    table.columns = targets
    table.data = rebuilt

    if outcome.columns:
        outcome.note = f"{len(outcome.columns)} column name(s) rewritten"


_WHITESPACE = re.compile(r"\s+")


def trim_whitespace(table: Table, report: CleaningReport) -> None:
    """Strip surrounding whitespace and collapse internal runs.

    Collapsing the internal runs matters as much as the strip: ``"HEART
    FAILURE"`` typed with two spaces is a different string from the same term
    typed with one, and every later comparison — grouping, coding, joining —
    treats them as different categories.
    """
    outcome = report.add(RuleOutcome("structural", "trim_whitespace", "Whitespace normalised"))
    for name in table.columns:
        values = table.data[name]
        touched = 0
        for index, value in enumerate(values):
            if not isinstance(value, str):
                continue
            cleaned = _WHITESPACE.sub(" ", value).strip()
            if cleaned != value:
                outcome.record(name, value, cleaned)
                values[index] = cleaned
                touched += 1
        if touched:
            outcome.cells_changed += touched
            outcome.columns.append(name)


#: Strings that mean "there is no value here". Conservative on purpose.
#:
#: ``"unknown"``, ``"other"`` and ``"not recorded"`` are deliberately absent.
#: In a clinical extract those are answers: "smoking status: unknown" is a
#: recorded observation, and turning it into a null loses the distinction
#: between a question that was asked and got no useful answer and one that was
#: never asked. The rule only removes strings that are placeholders in every
#: context.
_SENTINEL_NULLS: Final[frozenset[str]] = frozenset(
    {"", "-", "--", "---", "?", "??", "n/a", "na", "n.a.", "n/d", "nd", "null", "nil", "#n/a", "\\n"}
)


def resolve_sentinel_nulls(table: Table, report: CleaningReport) -> None:
    """Turn placeholder strings into real nulls."""
    outcome = report.add(
        RuleOutcome("structural", "sentinel_nulls", "Placeholder values resolved to null")
    )
    outcome.note = (
        "'unknown', 'other' and 'not recorded' are left alone: in a clinical "
        "record those are answers, not missing values"
    )
    for name in table.columns:
        values = table.data[name]
        touched = 0
        for index, value in enumerate(values):
            if isinstance(value, str) and value.strip().lower() in _SENTINEL_NULLS:
                outcome.record(name, value, None)
                values[index] = None
                touched += 1
        if touched:
            outcome.cells_changed += touched
            outcome.columns.append(name)


def drop_empty_columns(table: Table, report: CleaningReport) -> None:
    """Remove columns with no value in any row.

    Safe in a way no other deletion is: an all-null column carries no
    information, and keeping it would put a field in the silver schema that a
    reader can only discover is useless by querying it.
    """
    outcome = report.add(RuleOutcome("structural", "drop_empty_columns", "Empty columns removed"))
    for name in list(table.columns):
        if all(value is None for value in table.data[name]):
            table.drop(name)
            outcome.columns.append(name)
            outcome.columns_removed += 1
    if outcome.columns_removed:
        outcome.note = f"no row carried a value in {', '.join(outcome.columns)}"


#: Columns whose values identify rather than measure, recognised by name and
#: never type-cast.
#:
#: The decisive argument is not tidiness, it is that silver *accumulates*. A
#: code column is inferred per extraction: a slice whose ICD-10 codes all happen
#: to look numeric casts to integer, and the next slice containing ``E11.9``
#: stays text. Silver would then hold the same column as two different types in
#: two files, and the gold union has to reconcile them — a schema that changes
#: depending on which rows arrived that day.
#:
#: Leading zeros and meaningless arithmetic are the familiar reasons, and they
#: apply too: ``80146002 + 1`` is not a procedure.
#:
#: Surrogate keys (``id``, ``*_id``) are deliberately absent. A database's own
#: integer primary key is always digits, so it is subject to neither failure
#: mode, and turning it into text would make every join downstream a string
#: comparison for no gain.
_IDENTIFIER_COLUMNS: Final[re.Pattern] = re.compile(
    r"(^|_)(code|codigo|cie10|icd10|snomed|ssn|nss|dni|nif|nit|mrn|nhs|zip|"
    r"postcode|postal_code|phone|telefono|account|cuenta|iban)$"
)

_INTEGER = re.compile(r"^[+-]?\d+$")
_DECIMAL = re.compile(r"^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$")
_DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")

_TRUE = frozenset({"true", "t", "yes", "y", "si", "sí", "s", "1", "verdadero"})
_FALSE = frozenset({"false", "f", "no", "n", "0", "falso"})


def _parse_timestamp(text: str) -> datetime | date | None:
    """Parse an ISO-8601 timestamp or date, or return None."""
    candidate = text.strip().replace(" ", "T", 1) if " " in text.strip() else text.strip()
    if _DATE_ONLY.match(candidate):
        try:
            return date.fromisoformat(candidate)
        except ValueError:
            return None
    try:
        # Python accepts a trailing Z from 3.11 on, but be explicit anyway.
        return datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    except ValueError:
        return None


def cast_types(table: Table, report: CleaningReport, keep_as_text: frozenset[str] = frozenset()) -> None:
    """Give each column the narrowest type every one of its values supports.

    The order tried is integer, decimal, boolean, date, timestamp, text. A
    column is cast only when *every* non-null value parses — see the module
    docstring for why a majority is not enough.

    Integers are tried before decimals so a column of counts does not arrive
    downstream as a float, which is how a patient ends up with 3.0 admissions.

    Identifier columns are never cast — those named by ``keep_as_text``, and
    those recognised by name (see :data:`_IDENTIFIER_COLUMNS`). The caller's
    list exists for one specific and instructive failure: a code column that
    happens to hold only digits infers as an integer, and the coding step then
    writes a *string* code into it, producing a column of mixed types that
    Parquet cannot store. The name-based list exists because that column is an
    identifier whether or not anybody configured coding for it.

    The count reported is *columns typed*, not cells converted. Rendering
    ``"12261"`` as ``12261`` is not a correction, and counting it as one buried
    the two thousand values that genuinely were corrected under sixty thousand
    that were merely read properly. What each column became is in
    ``report.types``.
    """
    outcome = report.add(RuleOutcome("structural", "cast_types", "Types inferred and applied"))
    protected = {_snake(name) for name in keep_as_text if name}
    for name in table.columns:
        if name in protected or _IDENTIFIER_COLUMNS.search(name):
            report.types[name] = "string"
            continue
        values = table.data[name]
        present = [value for value in values if value is not None and value != ""]
        if not present:
            report.types[name] = "string"
            continue
        if not all(isinstance(value, str) for value in present):
            report.types[name] = type(present[0]).__name__
            continue

        kind, converted = _best_cast(present)
        report.types[name] = kind
        if kind == "string":
            continue

        # No examples. A cast changes the type, not the value: rendered side by
        # side, "12261" and 12261 are the same three glyphs, so a before/after
        # pair here shows a reader nothing and reads like a rule that ran and
        # did nothing. What the column became is in the note and in
        # ``report.types``, which is the actual information.
        mapping = dict(zip(present, converted))
        for index, value in enumerate(values):
            values[index] = None if value is None or value == "" else mapping[value]
        outcome.columns.append(name)

    if outcome.columns:
        outcome.note = (
            f"{len(outcome.columns)} column(s) typed: "
            + ", ".join(f"{name} → {report.types[name]}" for name in outcome.columns)
            + ". A type is claimed only when every value in the column supports it."
        )


def _best_cast(present: list[str]) -> tuple[str, list[Any]]:
    """Return ``(type name, converted values)`` for a column of strings."""
    stripped = [value.strip() for value in present]

    if all(_INTEGER.match(value) for value in stripped):
        # A run of digits is not automatically a number. A leading zero is part
        # of the value — a postcode, a national ID, an account number — and
        # casting turns "007" into 7, which cannot be turned back. A value too
        # wide for a 64-bit integer is the same story with a different cause.
        # Either way the column stays text rather than being quietly mangled,
        # and it does *not* fall through to the decimal branch, which would
        # produce 7.0 and lose the leading zero just as completely.
        converted = [int(value) for value in stripped]
        digits_are_meaningful = any(
            len(value.lstrip("+-")) > 1 and value.lstrip("+-").startswith("0")
            for value in stripped
        )
        too_wide = any(abs(number) >= 2**63 for number in converted)
        if digits_are_meaningful or too_wide:
            return "string", present
        return "integer", converted

    if all(_DECIMAL.match(value) for value in stripped):
        try:
            return "decimal", [float(value) for value in stripped]
        except ValueError:
            pass

    lowered = [value.lower() for value in stripped]
    if all(value in _TRUE or value in _FALSE for value in lowered):
        # Two distinct values, or it is a constant flag that happens to look
        # boolean — either way the cast is honest.
        return "boolean", [value in _TRUE for value in lowered]

    parsed = [_parse_timestamp(value) for value in stripped]
    if all(value is not None for value in parsed):
        kind = "date" if all(isinstance(value, date) and not isinstance(value, datetime) for value in parsed) else "timestamp"
        return kind, parsed

    return "string", present


def _displayable(value: Any) -> Any:
    """Render a converted value for the report's examples."""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def deduplicate_rows(table: Table, report: CleaningReport) -> None:
    """Remove rows identical in every column.

    The only deletion the standard allows. A row repeated in full carries no
    information the first copy did not, and duplicates inflate every count a
    model is later trained to predict.
    """
    outcome = report.add(RuleOutcome("structural", "deduplicate_rows", "Exact duplicate rows removed"))
    seen: set[tuple] = set()
    keep: list[int] = []
    for index in range(table.rows):
        signature = tuple(
            _displayable(table.data[name][index]) for name in table.columns
        )
        if signature in seen:
            outcome.rows_removed += 1
            if len(outcome.removed_rows) < _MAX_REMOVED_TRACKED:
                outcome.removed_rows.append(index)
            else:
                outcome.removed_rows_truncated = True
            continue
        seen.add(signature)
        keep.append(index)

    if outcome.rows_removed:
        for name in table.columns:
            values = table.data[name]
            table.data[name] = [values[index] for index in keep]
        outcome.note = f"{outcome.rows_removed} row(s) were byte-for-byte repeats"


# ---------------------------------------------------------------------------
# Tier 2 — categorical
# ---------------------------------------------------------------------------

#: A column is treated as categorical when it has few distinct values. An
#: absolute cap rather than a ratio of the row count: a ratio makes the rule
#: behave differently on the same column depending on how many rows happened to
#: arrive in that extraction, so a department list folds on a full backfill and
#: stops folding on the incremental run after it.
#:
#: Free text is excluded by this on its own, because free text has roughly as
#: many distinct values as rows.
_CATEGORICAL_MAX_DISTINCT: Final[int] = 60


def _fold(value: str) -> str:
    """Return the comparison key for a category: lowercase, unaccented."""
    folded = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return _WHITESPACE.sub(" ", folded).strip().lower()


def fold_categories(table: Table, report: CleaningReport) -> None:
    """Fold spelling variants of a category onto its most common spelling.

    ``"Cardiología"``, ``"CARDIOLOGIA"`` and ``"cardiologia"`` are one
    department recorded by three people, and every group-by downstream reports
    them as three.

    The surviving spelling is the *modal* one, not the first seen and not a
    lowercased canonical form. The first is arbitrary, and a canonical form
    would rewrite a correctly accented value into an unaccented one — fixing
    consistency by making every value slightly wrong.
    """
    outcome = report.add(RuleOutcome("categorical", "fold_categories", "Category spellings unified"))
    for name in table.columns:
        values = table.data[name]
        strings = [value for value in values if isinstance(value, str)]
        if not strings:
            continue
        if len(set(strings)) > _CATEGORICAL_MAX_DISTINCT:
            continue

        groups: dict[str, Counter] = {}
        for value in strings:
            groups.setdefault(_fold(value), Counter())[value] += 1

        winners = {
            key: spellings.most_common(1)[0][0]
            for key, spellings in groups.items()
            if len(spellings) > 1
        }
        if not winners:
            continue

        touched = 0
        for index, value in enumerate(values):
            if not isinstance(value, str):
                continue
            winner = winners.get(_fold(value))
            if winner is not None and winner != value:
                outcome.record(name, value, winner)
                values[index] = winner
                touched += 1
        if touched:
            outcome.cells_changed += touched
            outcome.columns.append(name)
    if outcome.cells_changed:
        outcome.note = "the most frequent spelling wins, so accents and case survive where they were meant"


# ---------------------------------------------------------------------------
# Tier 3 — domain (health)
# ---------------------------------------------------------------------------

_SEX_COLUMNS = re.compile(r"(^|_)(sex|sexo|gender|genero)(_|$)")

_SEX_UNAMBIGUOUS: Final[dict[str, str]] = {
    "male": "male",
    "masculino": "male",
    "hombre": "male",
    "varon": "male",
    "female": "female",
    "femenino": "female",
    "mujer": "female",
    "f": "female",
}


def standardise_sex(table: Table, report: CleaningReport) -> None:
    """Map sex to ``male`` / ``female``, refusing where the coding is ambiguous.

    ``"M"`` is the whole problem. In English and in most Spanish records it is
    *masculino*. But Spanish forms that offer ``H``/``M`` mean *hombre* and
    *mujer* — there, ``M`` is female. Reading it as male silently inverts the
    sex of every woman in the extract, and nothing downstream can detect it.

    So the rule looks at the column as a whole: only when it contains ``H``
    does ``M`` mean female. When a column contains ``M`` and neither ``H`` nor
    any unambiguous spelling that would settle it, the value is left exactly as
    it was found and the rule says so in its note. An honest refusal is
    recoverable; a confident inversion is not.
    """
    outcome = report.add(RuleOutcome("domain", "standardise_sex", "Sex mapped to a standard vocabulary"))
    for name in table.columns:
        if not _SEX_COLUMNS.search(name):
            continue
        values = table.data[name]
        present = {value.strip().lower() for value in values if isinstance(value, str)}
        if not present:
            continue

        mapping = dict(_SEX_UNAMBIGUOUS)
        if "h" in present:
            # Spanish hombre/mujer coding: M is a woman.
            mapping["h"] = "male"
            mapping["m"] = "female"
        elif "m" in present and present <= {"m", "f", "male", "female", "masculino", "femenino"}:
            mapping["m"] = "male"
        elif "m" in present:
            outcome.note = (
                f"{name!r} contains 'M' alongside spellings that do not settle whether "
                "it means masculino or mujer, so it was left unchanged"
            )
            continue

        touched = 0
        for index, value in enumerate(values):
            if not isinstance(value, str):
                continue
            target = mapping.get(value.strip().lower())
            if target is not None and target != value:
                outcome.record(name, value, target)
                values[index] = target
                touched += 1
        if touched:
            outcome.cells_changed += touched
            outcome.columns.append(name)


#: Physically plausible ranges for measurements, keyed by a pattern matched
#: against the column name. These are *implausibility* bounds, not reference
#: ranges: the point is to catch a unit mix-up or a keying slip, not to flag a
#: patient for being unwell. A systolic pressure of 200 is a medical emergency
#: and a perfectly valid recording; 2000 is a typo.
_PLAUSIBLE: Final[tuple[tuple[str, str, float, float], ...]] = (
    (r"(^|_)(age|edad)(_|$)", "years", 0, 130),
    (r"(^|_)(heart_rate|pulse|hr|frecuencia_cardiaca)(_|$)", "bpm", 10, 300),
    (r"(^|_)(systolic|presion_sistolica|sbp)(_|$)", "mmHg", 40, 300),
    (r"(^|_)(diastolic|presion_diastolica|dbp)(_|$)", "mmHg", 20, 200),
    (r"(^|_)(temperature|temperatura|temp_c)(_|$)", "°C", 25, 45),
    (r"(^|_)(weight|peso|weight_kg)(_|$)", "kg", 0.3, 500),
    (r"(^|_)(height|talla|altura|height_cm)(_|$)", "cm", 20, 260),
    (r"(^|_)(bmi|imc)(_|$)", "kg/m²", 8, 100),
    (r"(^|_)(spo2|saturacion|oxygen_saturation)(_|$)", "%", 40, 100),
    (r"(^|_)(respiratory_rate|frecuencia_respiratoria|rr)(_|$)", "breaths/min", 4, 80),
)


def flag_implausible_measurements(table: Table, report: CleaningReport) -> None:
    """Count values outside the physically plausible range for their measure.

    Counted, never changed and never dropped. A value of 999 in a heart-rate
    column is a data problem that somebody has to look at; replacing it with a
    null hides that it was there, and dropping the row loses the other twenty
    fields that were fine.
    """
    outcome = report.add(
        RuleOutcome("domain", "flag_implausible_measurements", "Implausible measurements flagged")
    )
    details: list[str] = []
    for name in table.columns:
        bounds = next(
            ((unit, low, high) for pattern, unit, low, high in _PLAUSIBLE if re.search(pattern, name)),
            None,
        )
        if bounds is None:
            continue
        unit, low, high = bounds
        offenders = 0
        for value in table.data[name]:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
            if value < low or value > high:
                outcome.record(name, value, f"outside {low}–{high} {unit}")
                offenders += 1
        if offenders:
            outcome.flagged += offenders
            outcome.columns.append(name)
            details.append(f"{name}: {offenders} outside {low}–{high} {unit}")
    if details:
        outcome.note = "; ".join(details) + " — flagged only, nothing was changed or removed"


# ---------------------------------------------------------------------------
# Running the standard
# ---------------------------------------------------------------------------

#: In order. Order is load-bearing: sentinel nulls must go before types are
#: inferred, or a column of numbers containing one "N/A" stays text; types must
#: be inferred before duplicates are compared, so "1" and "01" are recognised
#: as the same row; and the domain tier reads numbers, so it runs last.
_PIPELINE = (
    normalise_column_names,
    trim_whitespace,
    resolve_sentinel_nulls,
    drop_empty_columns,
    cast_types,
    deduplicate_rows,
    fold_categories,
    standardise_sex,
    flag_implausible_measurements,
)


@dataclass
class Snapshot:
    """The first rows of the table at one point in the standard.

    Carries ``row_ids`` — each row's position in the table as it arrived — so
    two snapshots can be compared cell by cell even after a rule has removed
    rows. Without it, the first deduplication shifts every row after it and a
    naive comparison reports the whole table as changed.
    """

    #: Empty on the snapshot taken before any rule has run.
    rule: str
    title: str
    columns: list[str]
    rows: list[list[Any]]
    row_ids: list[int]


def _snapshot(table: Table, ids: list[int], rule: str, title: str, sample: int) -> Snapshot:
    return Snapshot(
        rule=rule,
        title=title,
        columns=list(table.columns),
        rows=[
            [table.data[name][index] for name in table.columns]
            for index in range(min(sample, table.rows))
        ],
        row_ids=ids[:sample],
    )


def clean(
    table: Table, *, keep_as_text: Sequence[str] = (), sample: int = 0
) -> tuple[CleaningReport, list[Snapshot]]:
    """Apply the standard to ``table`` in place and report what changed.

    Args:
        table: Rewritten in place.
        keep_as_text: Columns that must not be type-cast — identifiers and any
            column a later step will write text into. Matched after the column
            names are standardised, so the caller may pass either spelling.
        sample: When non-zero, capture the first ``sample`` rows before the
            first rule and after each one. The counts in the report say how
            much a rule changed; these say *what*, on the rows themselves,
            which is the only form of it a reader can check.

    Returns:
        ``(report, snapshots)``. ``snapshots`` is empty unless ``sample`` was
        given.
    """
    report = CleaningReport(rows_in=table.rows, columns_in=len(table.columns))
    protected = frozenset(keep_as_text)

    # Row identity is tracked alongside the data rather than inside it: adding
    # a column to carry it would change what every rule sees, including the
    # duplicate comparison, which reads every column.
    ids = list(range(table.rows))
    snapshots: list[Snapshot] = []
    if sample:
        snapshots.append(_snapshot(table, ids, "", "As it arrived", sample))

    for rule in _PIPELINE:
        before = table.rows
        if rule is cast_types:
            rule(table, report, protected)
        else:
            rule(table, report)

        if rule is deduplicate_rows and table.rows != before:
            outcome = report.outcomes[-1]
            removed = set(outcome.removed_rows)
            ids = [row_id for index, row_id in enumerate(ids) if index not in removed]

        if sample:
            outcome = report.outcomes[-1]
            snapshots.append(_snapshot(table, ids, outcome.rule, outcome.title, sample))

    report.rows_out = table.rows
    report.columns_out = len(table.columns)

    logger.info(
        "cleaning.completed",
        rows_in=report.rows_in,
        rows_out=report.rows_out,
        cells_changed=report.cells_changed,
        flagged=report.flagged,
    )
    return report, snapshots
