"""Tests for the normalisation benchmark's reporting.

The database-facing parts need the simulated hospital and are exercised by
running the script; what is tested here is the rendering, because a comparison
table that silently drops a strategy or mislabels a column would be copied
straight into the write-up.
"""
from __future__ import annotations

from experiments.normalization_benchmark import render


def _report(name: str, **overrides) -> dict:
    report = {
        "matcher": name,
        "total": 100,
        "matched": 80,
        "correct": 78,
        "incorrect": 2,
        "unmatched": 20,
        "coverage": 0.8,
        "precision": 0.975,
        "accuracy": 0.78,
        "by_degradation": {
            "(none)": {"total": 40, "correct": 40, "incorrect": 0, "unmatched": 0},
            "truncate": {"total": 60, "correct": 38, "incorrect": 2, "unmatched": 20},
        },
    }
    report.update(overrides)
    return report


class TestRender:
    def test_every_strategy_gets_a_row(self):
        output = render([_report("exact"), _report("fuzzy")])
        assert "| exact " in output
        assert "| fuzzy " in output

    def test_percentages_are_rendered(self):
        output = render([_report("exact")])
        assert "80.0%" in output   # coverage
        assert "97.50%" in output  # precision, two decimals
        assert "78.0%" in output   # accuracy

    def test_degradation_breakdown_is_included(self):
        output = render([_report("exact")])
        assert "`truncate`" in output
        assert "`(none)`" in output

    def test_a_strategy_missing_a_degradation_shows_a_dash(self):
        """Strategies are compared column-wise; a gap must not shift the row."""
        partial = _report("fuzzy", by_degradation={"(none)": {"total": 40, "correct": 40, "incorrect": 0, "unmatched": 0}})
        output = render([_report("exact"), partial])
        truncate_row = next(line for line in output.splitlines() if "`truncate`" in line)
        assert truncate_row.endswith("— |")

    def test_empty_buckets_do_not_divide_by_zero(self):
        empty = _report(
            "exact",
            by_degradation={"typo": {"total": 0, "correct": 0, "incorrect": 0, "unmatched": 0}},
        )
        render([empty])
