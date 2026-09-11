"""Tests for mapping free clinical text onto a controlled vocabulary.

These pin *properties*, not percentages. The measured accuracy on the corpus
belongs in the experiment write-up, where it can be reported with its
conditions; asserting it here would make the suite fail every time the
vocabulary or the noise model is adjusted, which is not a defect.

What must not regress is the shape of the result: the exact matcher never
guesses, the fuzzy matcher never does worse than the exact one, and neither
asserts a code it cannot justify.
"""
from __future__ import annotations

import pytest

from core.normalization import (
    ExactMatcher,
    FuzzyMatcher,
    Term,
    Vocabulary,
    canonicalise,
    score,
)

TERMS = [
    Term("80146002", "Appendectomy (procedure)"),
    Term("73761001", "Colonoscopy (procedure)"),
    Term("430193006", "Medication reconciliation (procedure)"),
    Term("710841007", "Assessment of anxiety (procedure)"),
    Term("171207006", "Depression screening (procedure)"),
]


@pytest.fixture()
def vocabulary() -> Vocabulary:
    return Vocabulary(TERMS)


class TestCanonicalise:
    @pytest.mark.parametrize(
        "text",
        [
            "Appendectomy (procedure)",
            "APPENDECTOMY",
            "  appendectomy  ",
            "appendectomy (procedure)",
            "Appendectomy.",
            "Appendectomy (procedure) .",
        ],
    )
    def test_structural_variants_reduce_to_one_form(self, text):
        assert canonicalise(text) == "appendectomy"

    def test_accents_are_folded(self):
        assert canonicalise("Cirugía") == canonicalise("Cirugia")

    def test_internal_spacing_is_collapsed(self):
        assert canonicalise("Medication   reconciliation") == "medication reconciliation"

    def test_meaning_is_not_invented(self):
        """Canonicalisation removes noise; it does not expand abbreviations.

        Doing so is where a rule stops being obviously correct, and the value
        of this function is that nobody has to argue about it.
        """
        assert canonicalise("Appendect.") != canonicalise("Appendectomy")


class TestVocabulary:
    def test_terms_are_indexed(self, vocabulary):
        assert len(vocabulary) == len(TERMS)
        assert vocabulary.exact("appendectomy").code == "80146002"

    def test_unknown_form_returns_nothing(self, vocabulary):
        assert vocabulary.exact("craniotomy") is None

    def test_two_codes_sharing_a_canonical_form_are_refused(self):
        """Neither can be chosen from the text alone, so neither is chosen.

        Picking whichever was loaded first would produce a confident answer
        that is right half the time and indistinguishable from one that is
        right always.
        """
        clashing = Vocabulary([Term("111", "Biopsy (procedure)"), Term("222", "BIOPSY")])
        assert "biopsy" in clashing.ambiguous_forms
        assert clashing.exact("biopsy") is None

    def test_the_same_code_twice_is_not_ambiguous(self):
        repeated = Vocabulary([Term("111", "Biopsy (procedure)"), Term("111", "BIOPSY")])
        assert repeated.ambiguous_forms == set()
        assert repeated.exact("biopsy").code == "111"


class TestExactMatcher:
    @pytest.mark.parametrize(
        "text",
        ["Appendectomy (procedure)", "APPENDECTOMY", "  appendectomy  ", "Appendectomy."],
    )
    def test_structural_noise_is_recovered(self, vocabulary, text):
        result = ExactMatcher(vocabulary).match(text)
        assert result.code == "80146002"
        assert result.confidence == 1.0

    def test_it_never_guesses(self, vocabulary):
        """The property that makes it a baseline: it cannot be wrong."""
        result = ExactMatcher(vocabulary).match("Appendect.")
        assert result.code is None
        assert result.confidence == 0.0

    def test_unknown_text_is_reported_as_unmatched_not_as_an_error(self, vocabulary):
        result = ExactMatcher(vocabulary).match("something entirely different")
        assert not result.matched
        assert result.reason

    def test_every_result_carries_its_reason(self, vocabulary):
        assert ExactMatcher(vocabulary).match("APPENDECTOMY").reason


class TestFuzzyMatcher:
    def test_truncation_is_recovered(self, vocabulary):
        result = FuzzyMatcher(vocabulary).match("Medication reconciliatio")
        assert result.code == "430193006"

    def test_typos_are_recovered(self, vocabulary):
        assert FuzzyMatcher(vocabulary).match("Colonoscpy").code == "73761001"

    def test_it_never_does_worse_than_exact(self, vocabulary):
        """Anything the baseline places, the fuzzy matcher places identically."""
        exact, fuzzy = ExactMatcher(vocabulary), FuzzyMatcher(vocabulary)
        for text in ["Appendectomy (procedure)", "APPENDECTOMY", "  colonoscopy  "]:
            assert fuzzy.match(text).code == exact.match(text).code

    def test_unrelated_text_is_refused(self, vocabulary):
        result = FuzzyMatcher(vocabulary).match("patient transported by ambulance")
        assert result.code is None
        assert "threshold" in result.reason

    def test_a_tie_is_refused_rather_than_guessed(self):
        """Two near-identical terms must not produce a coin flip.

        Reported as an answer, a coin flip is indistinguishable from knowledge.
        """
        confusable = Vocabulary(
            [Term("111", "Biopsy of left kidney"), Term("222", "Biopsy of right kidney")]
        )
        result = FuzzyMatcher(confusable).match("Biopsy of  kidney")
        assert result.code is None
        assert "ambiguous" in result.reason

    def test_a_truncated_prefix_of_several_terms_is_refused(self):
        """Truncation can destroy the characters that told two terms apart.

        "History and physical examinati" is the start of both the plain and the
        limited procedure. String similarity reliably prefers the shorter term
        — a confident wrong answer, which in a coding system enters the record
        silently. Refusing is the only honest outcome, because the information
        needed to decide is genuinely gone.
        """
        confusable = Vocabulary(
            [
                Term("111", "History and physical examination (procedure)"),
                Term("222", "History and physical examination, limited (procedure)"),
            ]
        )
        result = FuzzyMatcher(confusable).match("History and physical examinati")
        assert result.code is None
        assert "truncated" in result.reason

    def test_a_truncated_prefix_of_one_term_is_still_matched(self):
        """The refusal must be about ambiguity, not about truncation itself."""
        unique = Vocabulary([Term("111", "History and physical examination (procedure)")])
        assert FuzzyMatcher(unique).match("History and physical examinati").code == "111"

    def test_confidence_is_reported_even_when_refusing(self, vocabulary):
        result = FuzzyMatcher(vocabulary).match("patient transported by ambulance")
        assert 0.0 <= result.confidence < FuzzyMatcher(vocabulary).threshold

    def test_empty_text_is_refused(self, vocabulary):
        assert FuzzyMatcher(vocabulary).match("   ").code is None

    def test_a_stricter_threshold_refuses_more(self, vocabulary):
        lenient = FuzzyMatcher(vocabulary, threshold=0.5)
        strict = FuzzyMatcher(vocabulary, threshold=0.99)
        text = "Colonoscpy"
        assert lenient.match(text).matched
        assert not strict.match(text).matched


class TestScoring:
    CASES = [
        ("Appendectomy (procedure)", "80146002", None),
        ("APPENDECTOMY", "80146002", "uppercase"),
        ("Appendect.", "80146002", "truncate"),
        ("patient transported", "99999999", "typo"),
    ]

    def test_exact_matcher_reports_perfect_precision(self, vocabulary):
        report = score(ExactMatcher(vocabulary), self.CASES)
        assert report.incorrect == 0
        assert report.precision == 1.0

    def test_coverage_and_accuracy_differ_when_rows_are_refused(self, vocabulary):
        report = score(ExactMatcher(vocabulary), self.CASES)
        assert report.unmatched > 0
        assert report.accuracy < 1.0

    def test_results_are_broken_down_by_degradation(self, vocabulary):
        report = score(ExactMatcher(vocabulary), self.CASES)
        assert set(report.by_degradation) == {"(none)", "uppercase", "truncate", "typo"}
        assert report.by_degradation["uppercase"]["correct"] == 1
        assert report.by_degradation["truncate"]["unmatched"] == 1

    def test_untouched_rows_are_bucketed_separately(self, vocabulary):
        """The control group has to stay visible as one."""
        report = score(ExactMatcher(vocabulary), self.CASES)
        assert report.by_degradation["(none)"]["total"] == 1

    def test_an_empty_corpus_does_not_divide_by_zero(self, vocabulary):
        report = score(ExactMatcher(vocabulary), [])
        assert report.accuracy == 0.0
        assert report.precision == 0.0
        assert report.coverage == 0.0

    def test_fuzzy_places_at_least_as_much_as_exact(self, vocabulary):
        exact = score(ExactMatcher(vocabulary), self.CASES)
        fuzzy = score(FuzzyMatcher(vocabulary), self.CASES)
        assert fuzzy.matched >= exact.matched
        assert fuzzy.correct >= exact.correct

    def test_summary_is_serialisable(self, vocabulary):
        import json

        json.dumps(score(ExactMatcher(vocabulary), self.CASES).summary())
