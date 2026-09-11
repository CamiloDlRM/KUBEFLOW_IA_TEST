"""Score the normalisation strategies against the hospital's answer key.

Produces the comparison that makes "the agent codes clinical text" a claim
with a number attached: how much of the corpus each strategy places, how much
of what it places is right, and which kinds of damage defeat it.

Run it against the simulated HIS:

    docker compose exec backend python -m experiments.normalization_benchmark

or, with the LLM stage included (costs provider calls):

    docker compose exec backend python -m experiments.normalization_benchmark --llm

Why the answer key is legitimate
--------------------------------

``hospital/`` loads clean Synthea records, degrades the free text and drops the
code on 40% of rows, keeping the original code and the name of the degradation
in a separate ``eval`` schema. The platform's ingestion has no access to that
schema; this script does. So the reference was never labelled by hand, and the
noise is known per row — which is what makes the per-degradation breakdown
possible at all.

The corresponding limitation, which belongs in any write-up next to the
numbers: the noise is *our model* of real messiness, not a sample of it.
Results state how each strategy handles the damage we injected. They do not
establish how a real hospital extract would behave.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from typing import Iterable

from sqlalchemy import create_engine, text

from core.normalization import (
    CascadeMatcher,
    ExactMatcher,
    FuzzyMatcher,
    LLMMatcher,
    Matcher,
    Term,
    Vocabulary,
    score,
)

DEFAULT_DB_URL = "postgresql+psycopg2://hospital:hospital@hospital-db:5432/hospital"

DOMAINS = {
    "procedure": ("procedures", "procedure_text", "eval.procedure_truth", "procedure_id"),
    "condition": ("conditions", "condition_text", "eval.condition_truth", "condition_id"),
}


@dataclass
class Case:
    """One row of the corpus with its known answer."""

    text: str
    true_code: str
    degradation: str | None


def load_vocabulary(engine, domain: str) -> Vocabulary:
    with engine.connect() as connection:
        rows = connection.execute(
            text("SELECT code, term FROM eval.vocabulary WHERE domain = :domain"),
            {"domain": domain},
        ).all()
    return Vocabulary(Term(code, term) for code, term in rows)


def load_cases(engine, domain: str, only_uncoded: bool, limit: int | None) -> list[Case]:
    """Read the corpus with its answer key.

    ``only_uncoded`` restricts to the rows the source never coded, which is the
    population the platform actually has to solve. The full corpus is the
    better measurement — it includes the rows a real system would have had a
    code for — so it is the default, and the difference between the two is
    itself worth reporting.
    """
    table, text_column, truth_table, truth_key = DOMAINS[domain]
    code_column = f"{domain}_code"

    query = (
        f"SELECT t.{text_column} AS dirty, e.true_code, e.degradation "
        f"FROM {table} t JOIN {truth_table} e ON e.{truth_key} = t.id"
    )
    if only_uncoded:
        query += f" WHERE t.{code_column} IS NULL"
    query += f" ORDER BY t.id"
    if limit:
        query += f" LIMIT {int(limit)}"

    with engine.connect() as connection:
        rows = connection.execute(text(query)).all()
    return [Case(dirty, true_code, degradation) for dirty, true_code, degradation in rows]


def as_triples(cases: Iterable[Case]):
    return [(case.text, case.true_code, case.degradation) for case in cases]


def render(reports: list[dict]) -> str:
    """Render the comparison as Markdown, ready to paste into the write-up."""
    lines = [
        "| Strategy | Coverage | Precision | Accuracy | Refused | Wrong |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for report in reports:
        lines.append(
            f"| {report['matcher']} "
            f"| {report['coverage'] * 100:.1f}% "
            f"| {report['precision'] * 100:.2f}% "
            f"| {report['accuracy'] * 100:.1f}% "
            f"| {report['unmatched']:,} "
            f"| {report['incorrect']:,} |"
        )

    lines.append("")
    lines.append("Accuracy by kind of damage:")
    lines.append("")
    kinds = sorted(
        {kind for report in reports for kind in report["by_degradation"]},
        key=lambda kind: -max(
            report["by_degradation"].get(kind, {}).get("total", 0) for report in reports
        ),
    )
    header = "| Damage | n | " + " | ".join(r["matcher"] for r in reports) + " |"
    lines.append(header)
    lines.append("|---|---:|" + "---:|" * len(reports))
    for kind in kinds:
        counts = next(
            (r["by_degradation"][kind] for r in reports if kind in r["by_degradation"]), None
        )
        if not counts:
            continue
        row = f"| `{kind}` | {counts['total']:,} |"
        for report in reports:
            bucket = report["by_degradation"].get(kind)
            if not bucket or not bucket["total"]:
                row += " — |"
            else:
                row += f" {bucket['correct'] * 100 / bucket['total']:.1f}% |"
        lines.append(row)
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--domain", choices=sorted(DOMAINS), default="procedure")
    parser.add_argument(
        "--database-url", default=os.getenv("HOSPITAL_DB_URL", DEFAULT_DB_URL)
    )
    parser.add_argument(
        "--only-uncoded",
        action="store_true",
        help="restrict to rows the source never coded — the population the platform must solve",
    )
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--llm",
        action="store_true",
        help="include the model stage; costs provider calls, so it is off by default",
    )
    parser.add_argument("--json", dest="json_path", default=None, help="also write raw results")
    args = parser.parse_args(argv)

    url = args.database_url.replace("postgresql://", "postgresql+psycopg2://", 1)
    engine = create_engine(url, pool_pre_ping=True)

    vocabulary = load_vocabulary(engine, args.domain)
    if not len(vocabulary):
        print(
            "The eval.vocabulary table is empty. Has hospital-init run?",
            file=sys.stderr,
        )
        return 1

    cases = load_cases(engine, args.domain, args.only_uncoded, args.limit)
    if not cases:
        print("No cases to score.", file=sys.stderr)
        return 1

    print(
        f"{args.domain}: {len(cases):,} rows against {len(vocabulary):,} vocabulary terms"
        + (" (uncoded only)" if args.only_uncoded else "")
    )
    if vocabulary.ambiguous_forms:
        print(
            f"  note: {len(vocabulary.ambiguous_forms)} canonical forms map to more "
            "than one code and can never be matched"
        )
    print()

    matchers: list[Matcher] = [ExactMatcher(vocabulary), FuzzyMatcher(vocabulary)]
    if args.llm:
        matchers.append(LLMMatcher(vocabulary))
        matchers.append(CascadeMatcher(*matchers[:2], matchers[2]))
    else:
        matchers.append(CascadeMatcher(*matchers))

    triples = as_triples(cases)
    reports = [score(matcher, triples).summary() for matcher in matchers]

    print(render(reports))

    if args.json_path:
        with open(args.json_path, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "domain": args.domain,
                    "only_uncoded": args.only_uncoded,
                    "cases": len(cases),
                    "vocabulary": len(vocabulary),
                    "reports": reports,
                },
                handle,
                indent=2,
            )
        print(f"\nRaw results written to {args.json_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
