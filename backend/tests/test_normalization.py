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


class TestLLMMatcher:
    """The model is mocked: what is under test is our handling of its reply.

    Its answers are the one thing here we do not control, so every path is
    driven from a stub — a good reply, a malformed one, a refusal, an invented
    code, and a provider that raises.
    """

    @staticmethod
    def _replying(payload: str):
        """A stand-in provider that always returns ``payload``."""
        return lambda _prompt: payload

    def test_a_valid_reply_is_applied(self, vocabulary):
        from core.normalization import LLMMatcher

        matcher = LLMMatcher(
            vocabulary,
            generate=self._replying('{"results": [{"id": 0, "code": "80146002"}]}'),
        )
        result = matcher.match("Appendect.")
        assert result.code == "80146002"
        assert result.method == "llm"

    def test_an_invented_code_is_refused(self, vocabulary):
        """The failure this matcher exists to guard against.

        A well-formed code that is not in the vocabulary must never be taken
        on trust, because it looks exactly like a correct answer downstream.
        """
        from core.normalization import LLMMatcher

        matcher = LLMMatcher(
            vocabulary,
            generate=self._replying('{"results": [{"id": 0, "code": "99999999"}]}'),
        )
        result = matcher.match("Appendect.")
        assert result.code is None
        assert "not in the vocabulary" in result.reason

    def test_a_declined_entry_stays_unmatched(self, vocabulary):
        from core.normalization import LLMMatcher

        matcher = LLMMatcher(
            vocabulary, generate=self._replying('{"results": [{"id": 0, "code": null}]}')
        )
        assert matcher.match("something unrelated").code is None

    def test_json_wrapped_in_prose_is_still_read(self, vocabulary):
        from core.normalization import LLMMatcher

        matcher = LLMMatcher(
            vocabulary,
            generate=self._replying(
                'Sure — here is the mapping:\n```json\n'
                '{"results": [{"id": 0, "code": "73761001"}]}\n```'
            ),
        )
        assert matcher.match("colonoscpy").code == "73761001"

    def test_an_unparseable_reply_is_unmatched_not_an_exception(self, vocabulary):
        from core.normalization import LLMMatcher

        matcher = LLMMatcher(vocabulary, generate=self._replying("I could not do that"))
        result = matcher.match("Appendect.")
        assert result.code is None
        assert "failed" in result.reason

    def test_a_provider_error_is_unmatched_not_an_exception(self, vocabulary):
        from core.normalization import LLMMatcher

        def _raise(_prompt):
            raise RuntimeError("provider is down")

        result = LLMMatcher(vocabulary, generate=_raise).match("Appendect.")
        assert result.code is None
        assert "provider is down" in result.reason

    def test_repeated_text_costs_one_call(self, vocabulary):
        """The residue repeats: 300 rows of the sample are 119 distinct forms."""
        from core.normalization import LLMMatcher

        calls = []

        def _count(prompt):
            calls.append(prompt)
            return '{"results": [{"id": 0, "code": "80146002"}]}'

        matcher = LLMMatcher(vocabulary, generate=_count)
        matcher.match_many(["Appendect.", "APPENDECT.", "  appendect.  "])
        assert len(calls) == 1, "canonically identical texts must not be asked twice"

    def test_the_prompt_offers_only_vocabulary_terms(self, vocabulary):
        """The model must choose from the vocabulary, so it must only be shown it."""
        import json

        from core.normalization import LLMMatcher

        prompt = LLMMatcher(vocabulary, candidates=3).build_prompt(["Appendect."])
        # The entries are nested JSON, so scan from the first bracket rather
        # than trying to match balanced braces with a regex.
        entries, _ = json.JSONDecoder().raw_decode(prompt, prompt.index("["))

        assert len(entries) == 1
        offered = {c["code"] for c in entries[0]["candidates"]}
        assert len(offered) <= 3, "the shortlist must respect the candidate limit"
        assert offered <= {term.code for term in vocabulary.terms}
        assert "80146002" in offered, "the correct answer has to be reachable"

    def test_batching_splits_large_inputs(self, vocabulary):
        from core.normalization import LLMMatcher

        calls = []

        def _count(prompt):
            calls.append(prompt)
            return '{"results": []}'

        matcher = LLMMatcher(vocabulary, batch_size=2, generate=_count)
        matcher.match_many([f"unmatched text {i}" for i in range(5)])
        assert len(calls) == 3


class TestCascadeMatcher:
    def test_the_first_stage_that_places_it_wins(self, vocabulary):
        from core.normalization import CascadeMatcher

        cascade = CascadeMatcher(ExactMatcher(vocabulary), FuzzyMatcher(vocabulary))
        result = cascade.match("APPENDECTOMY")
        assert result.code == "80146002"
        assert result.method == "cascade:exact", "the stage that settled it must survive"

    def test_a_later_stage_picks_up_what_an_earlier_one_refused(self, vocabulary):
        from core.normalization import CascadeMatcher

        cascade = CascadeMatcher(ExactMatcher(vocabulary), FuzzyMatcher(vocabulary))
        result = cascade.match("Colonoscpy")
        assert result.code == "73761001"
        assert result.method == "cascade:fuzzy"

    def test_text_no_stage_can_place_is_unmatched(self, vocabulary):
        from core.normalization import CascadeMatcher

        cascade = CascadeMatcher(ExactMatcher(vocabulary), FuzzyMatcher(vocabulary))
        assert cascade.match("patient transported by ambulance").code is None

    def test_an_empty_cascade_is_refused_at_construction(self):
        from core.normalization import CascadeMatcher

        with pytest.raises(ValueError):
            CascadeMatcher()


class TestVocabularyFromRows:
    """Learning the vocabulary from the rows that already carry a code."""

    def test_codes_and_terms_are_learned(self):
        from core.normalization import vocabulary_from_rows

        rows = [
            {"text": "Appendectomy (procedure)", "code": "111"},
            {"text": "Colonoscopy (procedure)", "code": "222"},
            {"text": "APPENDECT.", "code": ""},
        ]
        vocabulary = vocabulary_from_rows(rows, "text", "code")
        assert len(vocabulary) == 2
        assert vocabulary.exact("appendectomy").code == "111"

    def test_the_modal_spelling_wins(self):
        """The coded rows are as dirty as the uncoded ones.

        A vocabulary built from an arbitrary example inherits that damage and
        propagates it to every row matched against it. Taking the most frequent
        spelling picks the undamaged form, because untouched rows are the
        single largest group for any one code.
        """
        from core.normalization import vocabulary_from_rows

        rows = (
            [{"text": "APPENDECT.", "code": "111"}]
            + [{"text": "Appendectomy (procedure)", "code": "111"}] * 5
            + [{"text": "appendectomy", "code": "111"}] * 2
        )
        vocabulary = vocabulary_from_rows(rows, "text", "code")
        assert vocabulary.terms[0].term == "Appendectomy (procedure)"

    def test_rows_without_a_code_teach_nothing(self):
        from core.normalization import vocabulary_from_rows

        rows = [{"text": "Appendectomy", "code": ""}, {"text": "", "code": "111"}]
        assert len(vocabulary_from_rows(rows, "text", "code")) == 0

    def test_a_wholly_uncoded_source_yields_an_empty_vocabulary(self):
        """The cold start, visible rather than hidden behind a poor fill rate."""
        from core.normalization import vocabulary_from_rows

        rows = [{"text": f"procedure {i}", "code": ""} for i in range(50)]
        assert len(vocabulary_from_rows(rows, "text", "code")) == 0


class TestNormalizeFile:
    HEADER = ["id", "text", "code"]

    def _write(self, path, rows):
        import csv

        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(self.HEADER)
            writer.writerows(rows)

    def _read(self, path):
        import csv

        with path.open(encoding="utf-8") as handle:
            return list(csv.DictReader(handle))

    def test_missing_codes_are_filled_from_the_coded_rows(self, tmp_path):
        from core.normalization import normalize_file

        source, destination = tmp_path / "in.csv", tmp_path / "out.csv"
        self._write(
            source,
            [
                [1, "Appendectomy (procedure)", "111"],
                [2, "Appendectomy (procedure)", "111"],
                [3, "APPENDECTOMY", ""],
                [4, "  appendectomy  ", ""],
            ],
        )
        summary = normalize_file(source, destination, text_column="text", code_column="code")

        assert summary.already_coded == 2
        assert summary.filled == 2
        assert summary.unresolved == 0
        assert all(row["code"] == "111" for row in self._read(destination))

    def test_the_method_and_confidence_of_each_fill_are_recorded(self, tmp_path):
        """The audit trail: a row coded by a model is not the same claim as a
        row coded by exact match, and a reader must be able to tell."""
        from core.normalization import normalize_file

        source, destination = tmp_path / "in.csv", tmp_path / "out.csv"
        self._write(
            source, [[1, "Appendectomy (procedure)", "111"], [2, "APPENDECTOMY", ""]]
        )
        normalize_file(source, destination, text_column="text", code_column="code")

        rows = self._read(destination)
        assert rows[0]["code_method"] == "source"
        assert rows[1]["code_method"].startswith("cascade:")
        assert float(rows[1]["code_confidence"]) > 0

    def test_unplaceable_rows_keep_an_empty_code(self, tmp_path):
        """Guessing to raise the fill rate would put a wrong code in a record."""
        from core.normalization import normalize_file

        source, destination = tmp_path / "in.csv", tmp_path / "out.csv"
        self._write(
            source,
            [[1, "Appendectomy (procedure)", "111"], [2, "patient sent home", ""]],
        )
        summary = normalize_file(source, destination, text_column="text", code_column="code")

        assert summary.unresolved == 1
        assert self._read(destination)[1]["code"] == ""

    def test_an_absent_column_is_a_clear_error(self, tmp_path):
        from core.normalization import normalize_file

        source, destination = tmp_path / "in.csv", tmp_path / "out.csv"
        self._write(source, [[1, "Appendectomy", "111"]])
        with pytest.raises(ValueError, match="does not return a column"):
            normalize_file(source, destination, text_column="missing", code_column="code")

    def test_an_empty_file_is_not_an_error(self, tmp_path):
        from core.normalization import normalize_file

        source, destination = tmp_path / "in.csv", tmp_path / "out.csv"
        self._write(source, [])
        summary = normalize_file(source, destination, text_column="text", code_column="code")
        assert summary.rows == 0

    def test_fill_rate_is_measured_against_the_rows_that_needed_filling(self, tmp_path):
        from core.normalization import normalize_file

        source, destination = tmp_path / "in.csv", tmp_path / "out.csv"
        self._write(
            source,
            [
                [1, "Appendectomy (procedure)", "111"],
                [2, "APPENDECTOMY", ""],
                [3, "patient sent home", ""],
            ],
        )
        summary = normalize_file(source, destination, text_column="text", code_column="code")
        assert summary.fill_rate == 0.5, "one of the two missing codes was placed"

    def test_original_columns_survive(self, tmp_path):
        from core.normalization import normalize_file

        source, destination = tmp_path / "in.csv", tmp_path / "out.csv"
        self._write(source, [[7, "Appendectomy (procedure)", "111"]])
        normalize_file(source, destination, text_column="text", code_column="code")
        assert self._read(destination)[0]["id"] == "7"
