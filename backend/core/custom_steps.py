"""A source's own silver rules, run after the standard.

The standard is deliberately conservative: it fixes how values are written and
flags what it cannot decide. What it will not do is anything that needs to
know what a column *means* — that ``peso_lb`` is in pounds, that ``M.`` is how
this hospital writes "male", that a discharge before the admission is an error.
Those are the source owner's to say, and these steps are how they say it.

Each step is a block with a few parameters, not code: rename, drop, replace
values, fill empties, convert units, read dates in a format, split a column,
check a condition, compute a column. Two of them take an *expression* — a
condition or a calculation in DuckDB's SQL — because "BMI from weight and
height" and "discharge after admission" are not expressible as a fixed form.

Expressions run in an in-memory DuckDB that can see the table and nothing
else: no files, no network, no extensions, and its configuration is locked
before the expression is read. Arbitrary Python is not offered at all; it would
run with the worker's credentials, and the notebook is where code belongs.

A step reports like a rule of the standard — what it changed, with examples,
and the rows it acted on — so it appears in the step-by-step view and in every
quality report. A step that cannot run (a column that is not there, an
expression that does not parse) changes nothing and says why, rather than
failing the extraction: the rows are real either way, and the report is where
the problem is noticed.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Final

from core.cleaning import (
    _IDENTIFIER_COLUMNS,
    _MAX_REMOVED_TRACKED,
    CleaningReport,
    RecipeError,
    RuleOutcome,
    Table,
    _best_cast,
    _displayable,
    _snake,
)

#: Every kind of step, in the order an editor offers them.
STEP_KINDS: Final[tuple[str, ...]] = (
    "rename",
    "drop_columns",
    "replace_values",
    "fill_nulls",
    "convert_units",
    "parse_dates",
    "split_column",
    "validate",
    "compute",
)

MAX_STEPS: Final[int] = 50
_MAX_NAME: Final[int] = 200
_MAX_EXPRESSION: Final[int] = 2_000
_MAX_MAPPING: Final[int] = 500

#: Words that have no place in an expression over one row. The sandbox already
#: refuses files and configuration; refusing these too means a mistake is
#: answered with a sentence when the step is saved, not with an engine error
#: on the next extraction.
_FORBIDDEN_WORDS: Final[tuple[str, ...]] = (
    "select", "from", "with", "union", "attach", "detach", "copy", "pragma", "install",
    "load", "set", "reset", "create", "insert", "update", "delete", "drop", "alter",
    "export", "import", "call", "checkpoint", "vacuum", "summarize", "describe",
)
_FORBIDDEN_FUNCTIONS = re.compile(
    r"\b(read_\w+|\w+_scan|glob|getenv|sniff_csv|query|query_table)\s*\(", re.IGNORECASE
)


class StepError(Exception):
    """A step that could not run on this table, and why."""


# ---------------------------------------------------------------------------
# The step, as stored in a recipe
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CustomStep:
    """One of a source's own rules: a kind and its parameters."""

    kind: str
    #: What the person called it. Empty means a title is made from the step.
    label: str = ""
    params: dict[str, Any] = field(default_factory=dict, hash=False)

    def as_dict(self) -> dict[str, Any]:
        return {"kind": self.kind, "label": self.label, **self.params}

    @property
    def title(self) -> str:
        if self.label:
            return self.label
        p = self.params
        if self.kind == "rename":
            return f"Rename {p['column']} → {p['to']}"
        if self.kind == "drop_columns":
            return f"Drop {', '.join(p['columns'])}"
        if self.kind == "replace_values":
            return f"Replace values in {p['column']}"
        if self.kind == "fill_nulls":
            return f"Fill empty {p['column']} with {p['value']!r}"
        if self.kind == "convert_units":
            units = f" from {p['from_unit']} to {p['to_unit']}" if p.get("from_unit") and p.get("to_unit") else ""
            return f"Convert {p['column']}{units}"
        if self.kind == "parse_dates":
            return f"Read {p['column']} as {p['as']}s ({p['format']})"
        if self.kind == "split_column":
            return f"Split {p['column']} into {', '.join(p['into'])}"
        if self.kind == "validate":
            return f"Check {p['condition']}" + (" — failing rows removed" if p["action"] == "drop" else "")
        return f"Compute {p['column']} = {p['expression']}"

    @property
    def lossy(self) -> str | None:
        """What this step can lose, in words, or ``None``."""
        p = self.params
        if self.kind == "drop_columns":
            return f"Your rule “{self.title}”: the column(s) are removed from silver."
        if self.kind == "replace_values" and any(entry["to"] is None for entry in p["mapping"]):
            return f"Your rule “{self.title}”: some values are replaced by null."
        if self.kind == "validate" and p["action"] == "drop":
            return f"Your rule “{self.title}”: rows that fail the condition are removed."
        return None

    @classmethod
    def from_dict(cls, raw: Any) -> CustomStep:
        if not isinstance(raw, dict):
            raise RecipeError("each of your rules is an object with a kind and its options")
        kind = raw.get("kind")
        if kind not in STEP_KINDS:
            raise RecipeError(f"a rule's kind is one of {', '.join(STEP_KINDS)}")
        label = _text(raw.get("label", ""), "a rule's name", required=False)
        unknown = set(raw) - {"kind", "label", *_OPTIONS[kind]}
        if unknown:
            raise RecipeError(f"a {kind} rule has no option(s) {', '.join(sorted(unknown))}")
        return cls(kind=kind, label=label, params=_READERS[kind](raw))


def _text(raw: Any, what: str, *, required: bool = True, limit: int = _MAX_NAME) -> str:
    if raw is None:
        raw = ""
    if not isinstance(raw, str):
        raise RecipeError(f"{what} must be text")
    value = raw.strip()
    if required and not value:
        raise RecipeError(f"{what} is missing")
    if len(value) > limit:
        raise RecipeError(f"{what} is longer than {limit} characters")
    return value


def _number(raw: Any, what: str) -> float:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise RecipeError(f"{what} must be a number")
    value = float(raw)
    if value != value or value in (float("inf"), float("-inf")):
        raise RecipeError(f"{what} must be a finite number")
    return value


def _names(raw: Any, what: str, *, low: int = 1, high: int = 100) -> list[str]:
    if not isinstance(raw, list) or not all(isinstance(item, str) for item in raw):
        raise RecipeError(f"{what} must be a list of column names")
    names = [item.strip() for item in raw if item.strip()]
    if not low <= len(names) <= high:
        raise RecipeError(f"{what} needs between {low} and {high} column names")
    if len({_snake(name) for name in names}) != len(names):
        raise RecipeError(f"{what} names the same column twice")
    if any(len(name) > _MAX_NAME for name in names):
        raise RecipeError(f"{what} has a name longer than {_MAX_NAME} characters")
    return names


def check_expression(raw: Any, what: str = "the expression") -> str:
    """Refuse an expression that is not one calculation over a row."""
    expression = _text(raw, what, limit=_MAX_EXPRESSION)
    if ";" in expression or "--" in expression or "/*" in expression:
        raise RecipeError(f"{what} is one expression: no ';' and no comments")
    lowered = expression.lower()
    # Quoted text is the person's data, not SQL, so it is not searched.
    unquoted = re.sub(r"'(?:[^']|'')*'", "''", lowered)
    for word in _FORBIDDEN_WORDS:
        if re.search(rf"\b{word}\b", re.sub(r'"[^"]*"', '""', unquoted)):
            raise RecipeError(f"{what} is a calculation over one row; {word.upper()} is not allowed")
    if _FORBIDDEN_FUNCTIONS.search(unquoted):
        raise RecipeError(f"{what} may only use the row's own columns, not read anything else")
    return expression


def _read_rename(raw: dict) -> dict:
    column = _text(raw.get("column"), "the column to rename")
    to = _text(raw.get("to"), "the new name")
    if _snake(column) == _snake(to) and column == to:
        raise RecipeError("the new name is the same as the old one")
    return {"column": column, "to": to}


def _read_drop(raw: dict) -> dict:
    return {"columns": _names(raw.get("columns"), "the columns to drop")}


def _read_replace(raw: dict) -> dict:
    column = _text(raw.get("column"), "the column")
    entries = raw.get("mapping")
    if not isinstance(entries, list) or not 1 <= len(entries) <= _MAX_MAPPING:
        raise RecipeError(f"replacements are a list of 1 to {_MAX_MAPPING} pairs")
    mapping = []
    seen: set[str] = set()
    ignore_case = bool(raw.get("ignore_case", False))
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) - {"from", "to"}:
            raise RecipeError("each replacement is a pair: from and to")
        source = _text(entry.get("from"), "a value to replace", limit=500)
        target = entry.get("to")
        if target is not None:
            target = _text(target, "a replacement", required=False, limit=500)
            target = target or None
        key = source.lower() if ignore_case else source
        if key in seen:
            raise RecipeError(f"{source!r} is replaced twice")
        seen.add(key)
        mapping.append({"from": source, "to": target})
    return {"column": column, "mapping": mapping, "ignore_case": ignore_case}


def _read_fill(raw: dict) -> dict:
    return {
        "column": _text(raw.get("column"), "the column"),
        "value": _text(raw.get("value"), "the value to fill with", limit=500),
    }


def _read_convert(raw: dict) -> dict:
    factor = _number(raw.get("factor"), "the factor")
    if factor == 0:
        raise RecipeError("a factor of 0 would erase the column; drop it instead")
    when = _text(raw.get("when", ""), "the condition", required=False, limit=_MAX_EXPRESSION)
    return {
        "column": _text(raw.get("column"), "the column"),
        "factor": factor,
        "offset": _number(raw.get("offset", 0), "the offset"),
        "when": check_expression(when, "the condition") if when else "",
        "from_unit": _text(raw.get("from_unit", ""), "the unit", required=False, limit=30),
        "to_unit": _text(raw.get("to_unit", ""), "the unit", required=False, limit=30),
    }


def _read_dates(raw: dict) -> dict:
    pattern = _text(raw.get("format"), "the date format", limit=100)
    if "%" not in pattern:
        raise RecipeError("the date format uses % codes, for example %d/%m/%Y")
    try:
        datetime(2001, 2, 3, 4, 5, 6).strftime(pattern)
    except ValueError as exc:
        raise RecipeError(f"the date format is not valid: {exc}") from exc
    kind = raw.get("as", "date")
    if kind not in ("date", "timestamp"):
        raise RecipeError("dates are read as date or timestamp")
    return {"column": _text(raw.get("column"), "the column"), "format": pattern, "as": kind}


def _read_split(raw: dict) -> dict:
    separator = raw.get("separator")
    if not isinstance(separator, str) or not 1 <= len(separator) <= 10:
        raise RecipeError("the separator is 1 to 10 characters")
    return {
        "column": _text(raw.get("column"), "the column"),
        "separator": separator,
        "into": _names(raw.get("into"), "the new columns", low=2, high=10),
    }


def _read_validate(raw: dict) -> dict:
    action = raw.get("action", "flag")
    if action not in ("flag", "drop"):
        raise RecipeError("a failing row is either flagged or dropped")
    return {"condition": check_expression(raw.get("condition"), "the condition"), "action": action}


def _read_compute(raw: dict) -> dict:
    return {
        "column": _text(raw.get("column"), "the column to write"),
        "expression": check_expression(raw.get("expression")),
    }


#: The options each kind of rule takes, beyond its kind and label.
_OPTIONS: Final[dict[str, frozenset[str]]] = {
    "rename": frozenset({"column", "to"}),
    "drop_columns": frozenset({"columns"}),
    "replace_values": frozenset({"column", "mapping", "ignore_case"}),
    "fill_nulls": frozenset({"column", "value"}),
    "convert_units": frozenset({"column", "factor", "offset", "when", "from_unit", "to_unit"}),
    "parse_dates": frozenset({"column", "format", "as"}),
    "split_column": frozenset({"column", "separator", "into"}),
    "validate": frozenset({"condition", "action"}),
    "compute": frozenset({"column", "expression"}),
}

_READERS = {
    "rename": _read_rename,
    "drop_columns": _read_drop,
    "replace_values": _read_replace,
    "fill_nulls": _read_fill,
    "convert_units": _read_convert,
    "parse_dates": _read_dates,
    "split_column": _read_split,
    "validate": _read_validate,
    "compute": _read_compute,
}


def read_steps(raw: Any) -> tuple[CustomStep, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list) or len(raw) > MAX_STEPS:
        raise RecipeError(f"your rules are a list of at most {MAX_STEPS}")
    steps = []
    for number, entry in enumerate(raw, start=1):
        try:
            steps.append(CustomStep.from_dict(entry))
        except RecipeError as exc:
            raise RecipeError(f"rule {number}: {exc}") from exc
    return tuple(steps)


# ---------------------------------------------------------------------------
# Running a step
# ---------------------------------------------------------------------------


@dataclass
class StepResult:
    """What a step did to the table's shape, for the caller tracking identity."""

    #: Rows removed, by their position when the step ran — every one of them,
    #: unlike the capped list the report keeps.
    removed: list[int] = field(default_factory=list)
    #: Old name → new name, for columns renamed.
    renamed: dict[str, str] = field(default_factory=dict)


def run_step(
    table: Table,
    report: CleaningReport,
    step: CustomStep,
    number: int,
    protected: frozenset[str] = frozenset(),
) -> tuple[RuleOutcome, StepResult]:
    """Apply one step in place. Never raises: a step that cannot run says so."""
    outcome = report.add(RuleOutcome("custom", f"custom_{number}", step.title))
    result = StepResult()
    try:
        _RUNNERS[step.kind](table, report, step.params, outcome, result, protected)
    except StepError as exc:
        outcome.error = str(exc)
        outcome.note = f"Could not run: {exc}. This rule changed nothing."
    return outcome, result


def _column(table: Table, name: str) -> str:
    """The column a step names: as written, or by its standardised name."""
    if name in table.data:
        return name
    wanted = _snake(name)
    for column in table.columns:
        if _snake(column) == wanted:
            return column
    raise StepError(f"there is no column called {name!r}")


def _kind_of(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "decimal"
    if isinstance(value, datetime):
        return "timestamp"
    if isinstance(value, date):
        return "date"
    return "string"


def _retype(table: Table, report: CleaningReport, name: str, protected: frozenset[str]) -> None:
    """Give a column a step wrote to the type its values now support.

    The same principle as the standard's: a type is claimed only when every
    value supports it. Text a step produced is read again — a split of
    "120/80" gives two columns of numbers — unless the column is an
    identifier. Values of several types become text rather than a column
    Parquet cannot hold.
    """
    values = table.data[name]
    present = [value for value in values if value is not None]
    if not present:
        report.types[name] = "string"
        return
    kinds = {_kind_of(value) for value in present}
    if kinds == {"string"}:
        if _snake(name) in protected or _IDENTIFIER_COLUMNS.search(name):
            report.types[name] = "string"
            return
        kind, converted = _best_cast(present)
        report.types[name] = kind
        if kind != "string":
            mapping = dict(zip(present, converted))
            table.data[name] = [None if value is None else mapping[value] for value in values]
        return
    if kinds <= {"integer", "decimal"}:
        if "decimal" in kinds:
            table.data[name] = [None if value is None else float(value) for value in values]
            report.types[name] = "decimal"
        else:
            report.types[name] = "integer"
        return
    if len(kinds) == 1:
        report.types[name] = kinds.pop()
        return
    # Several types at once — a replacement wrote text into a number column.
    # As text, the column is read again like any other: if every value now
    # supports one type, it gets it.
    table.data[name] = [None if value is None else str(_displayable(value)) for value in values]
    _retype(table, report, name, protected)


def _write(
    table: Table,
    name: str,
    new_values: list[Any],
    outcome: RuleOutcome,
) -> None:
    """Replace a column's values, counting and showing what changed."""
    old = table.data[name]
    changed = 0
    for index, (was, now) in enumerate(zip(old, new_values)):
        if was != now or type(was) is not type(now):
            changed += 1
            outcome.touch(index)
            outcome.record(name, _displayable(was), _displayable(now))
    table.data[name] = new_values
    outcome.cells_changed += changed
    if changed and name not in outcome.columns:
        outcome.columns.append(name)


def _evaluate(table: Table, report: CleaningReport, expression: str, *, boolean: bool = False) -> list[Any]:
    """Evaluate an expression over every row, in a DuckDB that sees only the table."""
    import duckdb
    import pyarrow as pa

    arrays = {}
    for name in table.columns:
        values = table.data[name]
        try:
            arrays[name] = pa.array(values)
        except (pa.ArrowInvalid, pa.ArrowTypeError, OverflowError):
            arrays[name] = pa.array([None if v is None else str(_displayable(v)) for v in values])
    frame = pa.table(arrays) if arrays else pa.table({})

    connection = duckdb.connect(
        ":memory:",
        config={
            "enable_external_access": False,
            "autoinstall_known_extensions": False,
            "autoload_known_extensions": False,
            "preserve_insertion_order": True,
            "threads": 2,
            "memory_limit": "1GB",
        },
    )
    try:
        connection.register("t", frame)
        connection.execute("SET lock_configuration = true")
        target = f"CAST(({expression}) AS BOOLEAN)" if boolean else f"({expression})"
        values = connection.execute(f"SELECT {target} AS v FROM t").arrow().column("v").to_pylist()
    except duckdb.Error as exc:
        message = str(exc).splitlines()[0]
        raise StepError(f"the expression could not be evaluated ({message})") from exc
    finally:
        connection.close()
    return [float(value) if isinstance(value, Decimal) else value for value in values]


def _rename(table, report, p, outcome, result, protected) -> None:
    column = _column(table, p["column"])
    if p["to"] in table.data and p["to"] != column:
        raise StepError(f"there is already a column called {p['to']!r}")
    table.rename(column, p["to"])
    report.types[p["to"]] = report.types.pop(column, "string")
    result.renamed[column] = p["to"]
    outcome.columns.append(p["to"])
    outcome.record(column, column, p["to"])
    outcome.note = f"{column} is now called {p['to']}."


def _drop(table, report, p, outcome, result, protected) -> None:
    columns = [_column(table, name) for name in p["columns"]]
    for column in columns:
        table.drop(column)
        report.types.pop(column, None)
    outcome.columns_removed = len(columns)
    outcome.note = f"Removed {', '.join(columns)}."


def _as_text(value: Any) -> str:
    """A typed value as the person reads it in silver, for matching."""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(_displayable(value)).strip()


def _replace(table, report, p, outcome, result, protected) -> None:
    column = _column(table, p["column"])
    fold = (lambda text: text.lower()) if p["ignore_case"] else (lambda text: text)
    mapping = {fold(entry["from"]): entry["to"] for entry in p["mapping"]}
    values = [
        mapping.get(fold(_as_text(value)), value) if value is not None else None
        for value in table.data[column]
    ]
    _write(table, column, values, outcome)
    _retype(table, report, column, protected)
    outcome.note = f"{outcome.cells_changed} value(s) replaced." if outcome.cells_changed else "No value matched."


def _fill(table, report, p, outcome, result, protected) -> None:
    column = _column(table, p["column"])
    values = [p["value"] if value is None or value == "" else value for value in table.data[column]]
    _write(table, column, values, outcome)
    _retype(table, report, column, protected)
    if outcome.cells_changed:
        outcome.note = f"{outcome.cells_changed} empty value(s) filled with {p['value']!r}."


def _convert(table, report, p, outcome, result, protected) -> None:
    column = _column(table, p["column"])
    values = table.data[column]
    wrong = next((v for v in values if v is not None and _kind_of(v) not in ("integer", "decimal")), None)
    if wrong is not None:
        raise StepError(
            f"{column} is not a number column (it holds values like {_displayable(wrong)!r}); "
            "read it as numbers first"
        )
    mask = _evaluate(table, report, p["when"], boolean=True) if p["when"] else [True] * len(values)
    converted = [
        round(value * p["factor"] + p["offset"], 6) if value is not None and applies else value
        for value, applies in zip(values, mask)
    ]
    _write(table, column, converted, outcome)
    _retype(table, report, column, protected)
    units = f" from {p['from_unit']} to {p['to_unit']}" if p["from_unit"] and p["to_unit"] else ""
    outcome.note = f"{outcome.cells_changed} value(s) converted{units} (× {p['factor']:g} + {p['offset']:g})" + (
        f", only where {p['when']}." if p["when"] else "."
    )


def _dates(table, report, p, outcome, result, protected) -> None:
    column = _column(table, p["column"])
    values = table.data[column]
    parsed: list[Any] = []
    misses: list[str] = []
    for value in values:
        if value is None or isinstance(value, (date, datetime)):
            parsed.append(value)
            continue
        try:
            moment = datetime.strptime(str(value).strip(), p["format"])
        except ValueError:
            misses.append(str(value))
            parsed.append(value)
            continue
        parsed.append(moment.date() if p["as"] == "date" else moment)
    if misses:
        # All or nothing, like every type the standard claims: a column read
        # as dates except where it was not would hold two types at once.
        for index, value in enumerate(values):
            if value is not None and str(value) in misses[:3]:
                outcome.touch(index)
        outcome.flagged = len(misses)
        outcome.note = (
            f"{len(misses)} value(s) do not match {p['format']}, for example "
            + ", ".join(repr(miss) for miss in misses[:3])
            + ". Nothing was changed; correct the format or those values."
        )
        return
    _write(table, column, parsed, outcome)
    report.types[column] = p["as"]
    outcome.note = f"{column} read as {p['as']}s with {p['format']}."


def _split(table, report, p, outcome, result, protected) -> None:
    column = _column(table, p["column"])
    taken = [name for name in p["into"] if name in table.data]
    if taken:
        raise StepError(f"there is already a column called {taken[0]!r}")
    parts_per_row = [
        None if value is None else str(_displayable(value)).split(p["separator"], len(p["into"]) - 1)
        for value in table.data[column]
    ]
    position = table.columns.index(column) + 1
    for offset, name in enumerate(p["into"]):
        values = [
            None if parts is None or offset >= len(parts) or not parts[offset].strip() else parts[offset].strip()
            for parts in parts_per_row
        ]
        table.columns.insert(position + offset, name)
        table.data[name] = values
        outcome.cells_changed += sum(value is not None for value in values)
        outcome.columns.append(name)
        _retype(table, report, name, protected)
    for index, parts in enumerate(parts_per_row):
        if parts is not None:
            outcome.touch(index)
            if len(outcome.examples) < 3:
                outcome.record(column, table.data[column][index], " | ".join(part.strip() for part in parts))
    outcome.note = f"{column} split on {p['separator']!r} into {', '.join(p['into'])}; {column} is kept."


def _validate(table, report, p, outcome, result, protected) -> None:
    verdicts = _evaluate(table, report, p["condition"], boolean=True)
    # Only an explicit false fails. A condition that cannot be answered for a
    # row — a null in a column it reads — is not evidence against the row.
    failing = [index for index, verdict in enumerate(verdicts) if verdict is False]
    for index in failing:
        outcome.touch(index)
    if not failing:
        outcome.note = "Every row satisfies the condition."
        return
    if p["action"] == "flag":
        outcome.flagged = len(failing)
        outcome.note = f"{len(failing)} row(s) do not satisfy {p['condition']}. They are left in place."
        return
    drop = set(failing)
    for name in table.columns:
        table.data[name] = [value for index, value in enumerate(table.data[name]) if index not in drop]
    outcome.rows_removed = len(failing)
    result.removed = failing
    outcome.note = f"{len(failing)} row(s) did not satisfy {p['condition']} and were removed."


def _compute(table, report, p, outcome, result, protected) -> None:
    values = _evaluate(table, report, p["expression"])
    existing = next((column for column in table.columns if column == p["column"]), None)
    if existing is None:
        table.columns.append(p["column"])
        table.data[p["column"]] = [None] * table.rows
        outcome.note = f"New column {p['column']} = {p['expression']}."
    else:
        outcome.note = f"{p['column']} rewritten as {p['expression']}."
    _write(table, p["column"], values, outcome)
    if p["column"] not in outcome.columns:
        outcome.columns.append(p["column"])
    _retype(table, report, p["column"], protected)


_RUNNERS = {
    "rename": _rename,
    "drop_columns": _drop,
    "replace_values": _replace,
    "fill_nulls": _fill,
    "convert_units": _convert,
    "parse_dates": _dates,
    "split_column": _split,
    "validate": _validate,
    "compute": _compute,
}


def cap_removed(ids: list[int], positions: list[int]) -> tuple[list[int], bool]:
    """Removed rows as the report keeps them: where they arrived, capped."""
    arrived = [ids[position] for position in positions]
    return arrived[:_MAX_REMOVED_TRACKED], len(arrived) > _MAX_REMOVED_TRACKED
