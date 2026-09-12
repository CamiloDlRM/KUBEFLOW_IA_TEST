"""Turning a description of a wanted table into a gold definition.

The model is given a schema and a question. It returns SQL. It is never given
the data and it never returns rows.

That distinction is the entire design and it is worth being explicit about,
because the tempting version — hand the model the rows, ask it to tidy them,
store what comes back — produces data whose only provenance is that a model
said so. Nothing about it can be checked: run it again and it differs, ask why
a row looks like that and there is no answer, and a value that was quietly
invented is indistinguishable from one that was read.

A query has none of those problems. It is short enough to read, it runs the
same way twice, the platform executes it rather than the model, and when it is
wrong it is wrong visibly — a row count of zero, a join that multiplied, a
column that is all null.

The model is also constrained twice over: what it writes must pass
:func:`core.gold.validate_sql` before it is shown, and it must run and be
previewed before the user can save it. Neither check trusts the model, and the
second one does not trust the first.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import structlog

from core.ai_advisor import _BACKENDS, _extract_json, advisor_configured, resolve_model
from core.config import AppSettings, get_settings
from core.gold import GoldError, validate_sql

logger = structlog.get_logger(__name__)

__all__ = ["GoldSuggestionError", "GoldSuggestion", "build_prompt", "suggest_definition"]


class GoldSuggestionError(RuntimeError):
    """A definition could not be suggested."""


SYSTEM_PROMPT = """You write DuckDB SQL that builds a single analytical table \
from cleaned Parquet relations.

Rules you must follow:
- Return ONE query. No DDL, no DML, no PRAGMA, no INSTALL, no COPY, no semicolons \
separating statements.
- Use only the relations and columns given to you. If something the user asked for \
is not in the schema, say so in the explanation and build the closest table that \
the schema does support — never invent a column.
- Prefer explicit joins and explicit column lists over SELECT *.
- When the user asks for one row per something, make that grain obvious: group by \
it, and say in the explanation what the grain is.
- A LEFT JOIN is usually right when the user asks about entities that may have no \
related rows, because an INNER JOIN silently drops them.

Answer with a JSON object and nothing else:
{"sql": "<the query>", "explanation": "<two or three sentences: what the table \
contains, what its grain is, and anything you had to assume>"}"""


@dataclass
class GoldSuggestion:
    """SQL the model wrote, with its own account of what it does."""

    sql: str
    explanation: str


def build_prompt(relations: dict[str, Any], question: str) -> str:
    """Compose the prompt from the silver schema and the user's question.

    Row counts are included as well as columns. Without them the model has no
    way to tell a lookup table from a fact table, and picks the join direction
    by guessing at the names.
    """
    lines = ["## Available relations (cleaned silver layer, DuckDB)\n"]
    for name, described in sorted(relations.items()):
        lines.append(f"### {name}  ({described.get('rows', 0):,} rows)")
        for column in described.get("columns", []):
            lines.append(f"- {column['name']}: {column['type']}")
        lines.append("")

    lines.append("## The table the user wants\n")
    lines.append(question.strip())
    return "\n".join(lines)


def suggest_definition(
    relations: dict[str, Any],
    question: str,
    *,
    settings: AppSettings | None = None,
) -> GoldSuggestion:
    """Ask the configured provider for a gold definition.

    Raises:
        GoldSuggestionError: No provider is configured, the call failed, the
            reply was not the expected shape, or the SQL did not survive
            validation. All four are reported to the user as a reason rather
            than an empty editor: a suggestion that silently does not appear is
            indistinguishable from a feature that does not work.
    """
    settings = settings or get_settings()
    if not advisor_configured(settings):
        raise GoldSuggestionError(
            "No AI provider is configured on this deployment, so the definition "
            "has to be written by hand. The schema above is what it can use."
        )
    if not relations:
        raise GoldSuggestionError("There is no silver data to write a query against yet.")

    backend = _BACKENDS.get(settings.ai_advisor_provider)
    if backend is None:
        raise GoldSuggestionError(
            f"Unknown AI provider {settings.ai_advisor_provider!r}."
        )

    model = resolve_model(settings)
    prompt = build_prompt(relations, question)
    log = logger.bind(provider=settings.ai_advisor_provider, model=model)

    try:
        raw = backend(settings, model, prompt, SYSTEM_PROMPT)
    except Exception as exc:  # noqa: BLE001 — reported, never raised as a 500
        log.warning("gold.suggestion_call_failed", error=str(exc))
        raise GoldSuggestionError(f"The model could not be reached: {exc}") from exc

    try:
        payload = _extract_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        log.warning("gold.suggestion_unparseable", error=str(exc))
        raise GoldSuggestionError(
            "The model did not answer with a query in the expected format."
        ) from exc

    sql = str(payload.get("sql") or "").strip()
    explanation = str(payload.get("explanation") or "").strip()
    if not sql:
        raise GoldSuggestionError("The model returned no query.")

    try:
        validate_sql(sql)
    except GoldError as exc:
        # Surfaced rather than silently repaired. A model that wrote something
        # outside the rules may have misread the schema too, and quietly
        # trimming its answer would hide that.
        log.warning("gold.suggestion_refused", reason=str(exc))
        raise GoldSuggestionError(f"The suggested query was refused: {exc}") from exc

    log.info("gold.suggested", length=len(sql))
    return GoldSuggestion(sql=sql, explanation=explanation)
