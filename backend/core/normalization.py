"""Mapping free clinical text onto a controlled vocabulary.

The source system stores what somebody typed — ``APPENDECT.``, ``Appendectomy
(procedure)``, ``  appendectomy  `` — and, on a large share of rows, no code at
all. Training on that text directly treats those three as three different
procedures. This module maps them back to one code.

Why there is more than one matcher
----------------------------------

Because "the LLM gets 85%" is not a result. It is a number without a
denominator: 85% against what?

So the same interface is implemented three ways, cheapest first:

``ExactMatcher``   canonicalise both sides and compare. Catches case,
                   whitespace, punctuation and the SNOMED qualifier — the
                   majority of real-world noise, at no cost.
``FuzzyMatcher``   nearest vocabulary term by string similarity. Catches
                   truncation and typos, and is where a naive approach starts
                   guessing confidently and wrongly.
``LLMMatcher``     asks a model, for the residue the other two cannot place.

Reporting all three is what turns the exercise into a comparison. If exact
matching already recovers most of the corpus, that is the honest finding, and
it is worth more than a large number with nothing beside it.

Every matcher returns a confidence and the reason it decided, so a run can be
audited rather than trusted — and so the governance layer can show why a row
was coded the way it was.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Final, Iterable, Protocol

import structlog

logger = structlog.get_logger(__name__)

#: Trailing punctuation and whitespace — a stray period, a comma from a bad
#: paste. Removed *before* the qualifier, because otherwise "X (procedure) ."
#: leaves the tag stranded mid-string where the anchored pattern below cannot
#: reach it, and the term canonicalises to "x procedure" instead of "x".
#: Closing parentheses are deliberately not in this set: the qualifier ends
#: with one, and stripping it here would break the pattern that follows.
_TRAILING_NOISE = re.compile(r"[\s.,;:\-]+$")

#: SNOMED's trailing semantic tag. Clinicians type the procedure, not the
#: ontology's bookkeeping, so this is the single most common difference
#: between a coded term and what is in the free-text field.
#:
#: The closing parenthesis is optional and may repeat: a field truncated
#: mid-tag leaves "X (procedure" and a careless paste leaves "X (procedure))".
#: Both are the same term.
_QUALIFIER = re.compile(
    r"\s*\(\s*(procedure|disorder|finding|situation|regime/therapy|qualifier value)"
    r"\s*\)*\s*$",
    re.IGNORECASE,
)

_PUNCTUATION = re.compile(r"[^\w\s]")
_WHITESPACE = re.compile(r"\s+")

#: Similarity below which a fuzzy match is reported as no match at all.
#: Deliberately high: a wrong code asserted confidently is worse than an
#: honest "I could not place this", because the first is invisible downstream.
DEFAULT_FUZZY_THRESHOLD: Final[float] = 0.82

#: How much better the best candidate must be than the runner-up. Without it,
#: two vocabulary terms that are near-identical would produce a coin flip
#: reported as a confident answer.
DEFAULT_MARGIN: Final[float] = 0.04


def canonicalise(text: str) -> str:
    """Reduce free text to a comparable form.

    Removes what varies without changing meaning: the SNOMED qualifier, case,
    accents, punctuation and whitespace. Deliberately does *not* attempt to
    expand abbreviations or correct spelling — that is where a rule stops being
    obviously correct, and the point of this function is to be the part nobody
    has to argue about.
    """
    trimmed = _TRAILING_NOISE.sub("", text)
    without_qualifier = _QUALIFIER.sub("", trimmed)
    folded = unicodedata.normalize("NFD", without_qualifier)
    unaccented = "".join(c for c in folded if unicodedata.category(c) != "Mn")
    depunctuated = _PUNCTUATION.sub(" ", unaccented)
    return _WHITESPACE.sub(" ", depunctuated).strip().lower()


def _tokens(text: str) -> set[str]:
    return set(canonicalise(text).split())


@dataclass(frozen=True)
class Term:
    """One entry of the controlled vocabulary."""

    code: str
    term: str

    @property
    def canonical(self) -> str:
        return canonicalise(self.term)


@dataclass
class Match:
    """What a matcher concluded about one piece of free text.

    ``code`` is ``None`` when nothing could be placed — which is a real answer
    and must stay distinguishable from a low-confidence guess.
    """

    text: str
    code: str | None
    term: str | None
    confidence: float
    method: str
    reason: str = ""

    @property
    def matched(self) -> bool:
        return self.code is not None


class Matcher(Protocol):
    """Anything that can place free text against a vocabulary."""

    name: str

    def match(self, text: str) -> Match: ...


class Vocabulary:
    """The set of codes free text is mapped onto.

    Indexed by canonical form on construction, so exact matching is a dict
    lookup rather than a scan of every term per row.
    """

    def __init__(self, terms: Iterable[Term]) -> None:
        self.terms: list[Term] = list(terms)
        self._by_canonical: dict[str, Term] = {}
        self._ambiguous: set[str] = set()

        for term in self.terms:
            key = term.canonical
            existing = self._by_canonical.get(key)
            if existing is None:
                self._by_canonical[key] = term
            elif existing.code != term.code:
                # Two different codes reduce to the same canonical string. No
                # matcher can separate them from the text alone, so record it
                # and refuse to match rather than picking whichever was loaded
                # first and calling that an answer.
                self._ambiguous.add(key)

        if self._ambiguous:
            logger.warning(
                "normalization.ambiguous_vocabulary",
                count=len(self._ambiguous),
                note="these canonical forms map to more than one code and will never match",
            )

    def __len__(self) -> int:
        return len(self.terms)

    def exact(self, canonical: str) -> Term | None:
        if canonical in self._ambiguous:
            return None
        return self._by_canonical.get(canonical)

    @property
    def ambiguous_forms(self) -> set[str]:
        return set(self._ambiguous)


class ExactMatcher:
    """Canonicalise both sides and compare.

    The cheapest thing that could possibly work, and the baseline everything
    else is measured against. It cannot be wrong: either the canonical forms
    are equal or they are not.
    """

    name = "exact"

    def __init__(self, vocabulary: Vocabulary) -> None:
        self.vocabulary = vocabulary

    def match(self, text: str) -> Match:
        canonical = canonicalise(text)
        term = self.vocabulary.exact(canonical)
        if term is None:
            return Match(text, None, None, 0.0, self.name, "no canonical equivalent")
        return Match(text, term.code, term.term, 1.0, self.name, "canonical forms are equal")


class FuzzyMatcher:
    """Nearest vocabulary term by string similarity.

    Falls back to the exact match first, so it never does worse than the
    baseline. Where it goes beyond it — truncation, typos — it is guessing, so
    it reports how confident it is and refuses when the best candidate is not
    clearly better than the next one.
    """

    name = "fuzzy"

    def __init__(
        self,
        vocabulary: Vocabulary,
        threshold: float = DEFAULT_FUZZY_THRESHOLD,
        margin: float = DEFAULT_MARGIN,
    ) -> None:
        self.vocabulary = vocabulary
        self.threshold = threshold
        self.margin = margin
        self._exact = ExactMatcher(vocabulary)

    def _similarity(self, left: str, right: str) -> float:
        """Blend sequence and token similarity.

        Sequence ratio alone punishes truncation heavily; token overlap alone
        ignores word order and rates "removal of tooth" against "tooth removal"
        as identical. Together they disagree in the right places.
        """
        sequence = SequenceMatcher(None, left, right).ratio()
        left_tokens, right_tokens = set(left.split()), set(right.split())
        if not left_tokens or not right_tokens:
            return sequence
        overlap = len(left_tokens & right_tokens) / len(left_tokens | right_tokens)

        # A truncated string is a prefix of the real term, which the ratio
        # punishes for length alone. Reward that case explicitly.
        prefix = 1.0 if right.startswith(left) or left.startswith(right) else 0.0
        return max(sequence, 0.6 * sequence + 0.4 * overlap, 0.85 * prefix if prefix else 0.0)

    def match(self, text: str) -> Match:
        direct = self._exact.match(text)
        if direct.matched:
            return direct

        canonical = canonicalise(text)
        if not canonical:
            return Match(text, None, None, 0.0, self.name, "empty after canonicalisation")

        # A truncated field is a prefix of the term it came from. When it is a
        # prefix of several terms with different codes, the characters that
        # would have separated them were destroyed by the truncation and no
        # amount of string similarity recovers them: "History and physical
        # examinati" is the start of both "…examination" and "…examination,
        # limited". Picking the closer string reliably picks the shorter term,
        # which is a confident wrong answer — the failure mode this matcher is
        # supposed to avoid. Refuse instead.
        prefixed = {
            term.code for term in self.vocabulary.terms if term.canonical.startswith(canonical)
        }
        if len(prefixed) > 1:
            return Match(
                text,
                None,
                None,
                0.0,
                self.name,
                (
                    f"looks truncated: it is the start of {len(prefixed)} terms with "
                    "different codes, and what separated them is gone"
                ),
            )

        scored = sorted(
            (
                (self._similarity(canonical, term.canonical), term)
                for term in self.vocabulary.terms
            ),
            key=lambda pair: pair[0],
            reverse=True,
        )
        best_score, best_term = scored[0]
        runner_up = scored[1][0] if len(scored) > 1 else 0.0

        if best_score < self.threshold:
            return Match(
                text,
                None,
                None,
                best_score,
                self.name,
                f"closest term scored {best_score:.2f}, below the {self.threshold:.2f} threshold",
            )
        if best_score - runner_up < self.margin:
            return Match(
                text,
                None,
                None,
                best_score,
                self.name,
                (
                    f"ambiguous: {best_score:.2f} against {runner_up:.2f} for the "
                    "next candidate, too close to call"
                ),
            )
        return Match(
            text,
            best_term.code,
            best_term.term,
            best_score,
            self.name,
            f"nearest term at {best_score:.2f}",
        )


#: Vocabulary terms offered to the model per piece of text. Enough to contain
#: the answer, few enough that the prompt stays about the decision rather than
#: about reading a dictionary.
DEFAULT_CANDIDATES: Final[int] = 12

#: Texts per request. Batched because the residue left by the cheaper matchers
#: is hundreds of rows, and one call each would be hundreds of calls.
DEFAULT_BATCH: Final[int] = 25

LLM_SYSTEM_PROMPT: Final[str] = (
    "You are a clinical terminology coder. You map free text written by "
    "clinicians onto a controlled vocabulary.\n\n"
    "The text is abbreviated, truncated, mistyped and inconsistently cased, "
    "because it was typed into a hospital system over many years.\n\n"
    "Rules you must follow:\n"
    "- Choose only from the candidate codes offered for that entry.\n"
    "- Return null when the text does not clearly correspond to one of them. "
    "An unplaced entry is visibly unfinished; a wrong code enters the patient "
    "record silently and nobody sees it again.\n"
    "- Do not invent codes, and do not return a code from a different entry.\n"
    "- Judge meaning, not spelling: 'scr' is screening, 'tx' is treatment, "
    "'cx' is surgery. That is what you are here for — string similarity was "
    "already tried and is what left these entries unresolved."
)


class LLMMatcher:
    """Ask a language model to place text the cheaper matchers could not.

    Sized to the job rather than assumed to be needed: on the sample corpus the
    exact and fuzzy matchers together leave roughly 2% unresolved, and almost
    all of it is abbreviation — little string similarity, obvious meaning. That
    is a real gap and a narrow one, which is exactly the shape of problem worth
    spending a model call on.

    Three things this does that a naive wrapper would not:

    It deduplicates by canonical form before calling. The unresolved rows of
    the sample corpus are 300 rows but only 119 distinct strings.

    It shortlists candidates per entry with the fuzzy scorer, so the prompt
    carries plausible options instead of the whole vocabulary.

    It refuses any code that is not in the vocabulary. A model returning a
    plausible-looking code that does not exist is the failure mode here, and
    checking is cheaper than trusting.
    """

    name = "llm"

    def __init__(
        self,
        vocabulary: Vocabulary,
        *,
        candidates: int = DEFAULT_CANDIDATES,
        batch_size: int = DEFAULT_BATCH,
        generate: object | None = None,
    ) -> None:
        self.vocabulary = vocabulary
        self.candidates = candidates
        self.batch_size = batch_size
        self._fuzzy = FuzzyMatcher(vocabulary)
        self._codes = {term.code: term for term in vocabulary.terms}
        self._cache: dict[str, Match] = {}
        #: Injected in tests; defaults to the configured provider.
        self._generate = generate

    # -- prompting ---------------------------------------------------------

    def _shortlist(self, canonical: str) -> list[Term]:
        scored = sorted(
            (
                (self._fuzzy._similarity(canonical, term.canonical), term)  # noqa: SLF001
                for term in self.vocabulary.terms
            ),
            key=lambda pair: pair[0],
            reverse=True,
        )
        return [term for _, term in scored[: self.candidates]]

    def build_prompt(self, texts: list[str]) -> str:
        """Render one batch as a prompt."""
        import json

        entries = []
        for index, text in enumerate(texts):
            shortlist = self._shortlist(canonicalise(text))
            entries.append(
                {
                    "id": index,
                    "text": text,
                    "candidates": [{"code": t.code, "term": t.term} for t in shortlist],
                }
            )

        return (
            "Map each entry to one of its candidate codes, or to null.\n\n"
            f"{json.dumps(entries, indent=2, ensure_ascii=False)}\n\n"
            'Reply with JSON only, of the form {"results": [{"id": 0, "code": '
            '"80146002"}, {"id": 1, "code": null}]}. Include every id exactly once.'
        )

    def _call(self, prompt: str) -> str:
        if self._generate is not None:
            return self._generate(prompt)  # type: ignore[operator]

        from core.ai_advisor import _BACKENDS, resolve_model  # noqa: PLC0415
        from core.config import get_settings

        settings = get_settings()
        backend = _BACKENDS[settings.ai_advisor_provider]
        return backend(settings, resolve_model(settings), prompt, LLM_SYSTEM_PROMPT)

    # -- matching ----------------------------------------------------------

    def _parse(self, raw: str, texts: list[str]) -> dict[int, str | None]:
        """Pull the id-to-code mapping out of the model's reply.

        Tolerant of the reply being wrapped in prose or a code fence, strict
        about what it accepts from inside it.
        """
        import json
        import re as _re

        block = _re.search(r"\{.*\}", raw, _re.S)
        if not block:
            raise ValueError("no JSON object in the reply")
        payload = json.loads(block.group(0))

        results: dict[int, str | None] = {}
        for entry in payload.get("results", []):
            if not isinstance(entry, dict):
                continue
            index = entry.get("id")
            if not isinstance(index, int) or not 0 <= index < len(texts):
                continue
            code = entry.get("code")
            results[index] = code if isinstance(code, str) and code else None
        return results

    def match_many(self, texts: list[str]) -> list[Match]:
        """Place a list of texts, batching and caching along the way."""
        outcomes: dict[str, Match] = {}
        pending: list[str] = []

        for text in texts:
            key = canonicalise(text)
            if key in self._cache:
                outcomes[text] = self._cache[key]
            elif text not in pending:
                pending.append(text)

        for start in range(0, len(pending), self.batch_size):
            batch = pending[start : start + self.batch_size]
            try:
                mapping = self._parse(self._call(self.build_prompt(batch)), batch)
            except Exception as exc:  # noqa: BLE001 — a failed call is "unmatched"
                logger.warning("normalization.llm_failed", error=str(exc), batch=len(batch))
                for text in batch:
                    outcomes[text] = Match(
                        text, None, None, 0.0, self.name, f"provider call failed: {exc}"
                    )
                continue

            for index, text in enumerate(batch):
                code = mapping.get(index)
                if code is None:
                    result = Match(text, None, None, 0.0, self.name, "model declined to place it")
                elif code not in self._codes:
                    # The failure worth guarding: a well-formed code that does
                    # not exist. Never take the model's word for the vocabulary.
                    logger.warning("normalization.llm_invented_code", code=code, text=text)
                    result = Match(
                        text, None, None, 0.0, self.name,
                        f"model returned {code!r}, which is not in the vocabulary",
                    )
                else:
                    term = self._codes[code]
                    result = Match(text, term.code, term.term, 0.75, self.name, "matched by model")

                self._cache[canonicalise(text)] = result
                outcomes[text] = result

        return [
            outcomes.get(text, Match(text, None, None, 0.0, self.name, "not returned by the model"))
            for text in texts
        ]

    def match(self, text: str) -> Match:
        """Place one text. Prefer :meth:`match_many` — this is one call."""
        return self.match_many([text])[0]


class CascadeMatcher:
    """Try matchers in order and keep the first that places the text.

    The point is not the combined number but the marginal one: how much each
    stage adds over the one before it. A cascade reporting 98% where its free
    first stage already reached 81% is a different result from one where the
    first stage reached 20%, and only the breakdown tells them apart.
    """

    name = "cascade"

    def __init__(self, *matchers: Matcher) -> None:
        if not matchers:
            raise ValueError("a cascade needs at least one matcher")
        self.matchers = matchers

    def match(self, text: str) -> Match:
        last = None
        for matcher in self.matchers:
            result = matcher.match(text)
            if result.matched:
                # Name the stage that settled it, so the breakdown survives.
                result.method = f"{self.name}:{result.method}"
                return result
            last = result
        assert last is not None
        return Match(text, None, None, 0.0, self.name, "no stage could place it")


@dataclass
class MatchReport:
    """Aggregate outcome of running one matcher over a corpus."""

    matcher: str
    total: int
    matched: int
    correct: int
    incorrect: int
    unmatched: int
    by_degradation: dict[str, dict[str, int]]

    @property
    def coverage(self) -> float:
        """Share of rows the matcher was willing to place."""
        return self.matched / self.total if self.total else 0.0

    @property
    def precision(self) -> float:
        """Share of the rows it placed that it placed correctly.

        The number that matters for a coding system: a wrong code enters the
        record silently, while an unplaced row is visibly unfinished.
        """
        return self.correct / self.matched if self.matched else 0.0

    @property
    def accuracy(self) -> float:
        """Share of the whole corpus placed correctly."""
        return self.correct / self.total if self.total else 0.0

    def summary(self) -> dict[str, object]:
        return {
            "matcher": self.matcher,
            "total": self.total,
            "matched": self.matched,
            "correct": self.correct,
            "incorrect": self.incorrect,
            "unmatched": self.unmatched,
            "coverage": round(self.coverage, 4),
            "precision": round(self.precision, 4),
            "accuracy": round(self.accuracy, 4),
            "by_degradation": self.by_degradation,
        }


def score(
    matcher: Matcher,
    cases: Iterable[tuple[str, str, str | None]],
) -> MatchReport:
    """Run ``matcher`` over labelled cases and report how it did.

    Args:
        matcher: The matcher under test.
        cases: ``(text, true_code, degradation)`` triples. ``degradation`` is
            the name of the noise applied, or ``None`` for untouched text, and
            is what lets results be broken down by kind of damage instead of
            collapsing into one average that hides where the failures are.

    Returns:
        Counts overall and per degradation.
    """
    total = matched = correct = incorrect = 0
    by_degradation: dict[str, dict[str, int]] = {}

    for text, true_code, degradation in cases:
        total += 1
        bucket = by_degradation.setdefault(
            degradation or "(none)", {"total": 0, "correct": 0, "incorrect": 0, "unmatched": 0}
        )
        bucket["total"] += 1

        result = matcher.match(text)
        if not result.matched:
            bucket["unmatched"] += 1
            continue

        matched += 1
        if result.code == true_code:
            correct += 1
            bucket["correct"] += 1
        else:
            incorrect += 1
            bucket["incorrect"] += 1

    return MatchReport(
        matcher=getattr(matcher, "name", type(matcher).__name__),
        total=total,
        matched=matched,
        correct=correct,
        incorrect=incorrect,
        unmatched=total - matched,
        by_degradation=by_degradation,
    )


# ---------------------------------------------------------------------------
# Applying normalisation to an extracted file
# ---------------------------------------------------------------------------


@dataclass
class NormalizationSummary:
    """What normalising one extracted file achieved."""

    rows: int
    already_coded: int
    filled: int
    unresolved: int
    vocabulary_size: int
    by_method: dict[str, int]

    @property
    def fill_rate(self) -> float:
        """Share of the uncoded rows that were given a code."""
        missing = self.rows - self.already_coded
        return self.filled / missing if missing else 0.0

    def summary(self) -> dict[str, object]:
        return {
            "rows": self.rows,
            "already_coded": self.already_coded,
            "filled": self.filled,
            "unresolved": self.unresolved,
            "fill_rate": round(self.fill_rate, 4),
            "vocabulary_size": self.vocabulary_size,
            "by_method": self.by_method,
        }


def vocabulary_from_rows(
    rows: Iterable[dict[str, str]], text_column: str, code_column: str
) -> Vocabulary:
    """Learn the controlled vocabulary from the rows that already carry a code.

    This is what makes normalisation self-contained. A hospital extract where
    part of the corpus was coded by hand already *contains* its own terminology:
    every coded row is one code paired with the text somebody wrote for it. The
    platform learns from those and applies the result to the rows nobody got
    round to coding.

    No terminology licence, no separate vocabulary file to keep in step with
    the data — and, for this project specifically, nothing read that the
    evaluation harness also reads, so the measurement stays honest.

    The cost is a cold start: a source whose first extraction is mostly
    uncoded has little to learn from. That is visible in the run's summary as
    a small ``vocabulary_size``, rather than hidden behind a poor fill rate
    with no explanation.

    Each code takes the *most frequent* spelling seen for it, not the first.
    That matters more than it sounds: the coded rows are as dirty as the
    uncoded ones, so a vocabulary built from arbitrary examples inherits their
    damage and then propagates it. Measured on the sample corpus, taking the
    first occurrence placed 98.0% of the missing codes at 96.6% precision —
    217 wrong codes. Taking the modal spelling placed 97.8% at 100%. Almost
    the same coverage, none of the errors, because the undamaged form is the
    single largest group for any given code and therefore usually wins the
    vote.

    Adding *every* observed spelling instead was also tried and is worse: the
    damaged forms of different codes start colliding, the vocabulary correctly
    refuses those, and coverage falls to 95.4% for no gain in precision.
    """
    counts: dict[str, Counter] = {}
    for row in rows:
        code = (row.get(code_column) or "").strip()
        text = (row.get(text_column) or "").strip()
        if code and text:
            counts.setdefault(code, Counter())[text] += 1

    return Vocabulary(
        Term(code, spellings.most_common(1)[0][0]) for code, spellings in counts.items()
    )


def normalize_rows(
    rows: list[dict[str, Any]],
    *,
    text_column: str,
    code_column: str,
    matcher_factory: object | None = None,
) -> NormalizationSummary:
    """Fill in the missing codes of ``rows``, in place.

    The same work as :func:`normalize_file` without the file, so the silver
    build can code a table it already holds instead of writing a CSV in order
    to read it back. Two columns are added to every row: how each code was
    decided and how confident that was. They are the audit trail — a row coded
    by a model and a row coded by exact match are not the same claim, and a
    reader downstream must be able to tell them apart.

    Rows that cannot be placed keep an empty code. Guessing to raise the fill
    rate would put a wrong code in a patient record silently, which is the one
    outcome worth avoiding at any cost to the metric.
    """
    if not rows:
        return NormalizationSummary(0, 0, 0, 0, 0, {})

    fieldnames = list(rows[0].keys())
    for required in (text_column, code_column):
        if required not in fieldnames:
            raise ValueError(
                f"the extraction does not return a column called {required!r}; "
                f"it returns {', '.join(fieldnames)}"
            )

    vocabulary = vocabulary_from_rows(
        ({key: "" if value is None else str(value) for key, value in row.items()} for row in rows),
        text_column,
        code_column,
    )
    build = matcher_factory or (lambda v: CascadeMatcher(ExactMatcher(v), FuzzyMatcher(v)))
    matcher = build(vocabulary)  # type: ignore[operator]

    already_coded = filled = unresolved = 0
    by_method: dict[str, int] = {}
    method_column = f"{code_column}_method"
    confidence_column = f"{code_column}_confidence"

    for row in rows:
        raw_code = row.get(code_column)
        code = "" if raw_code is None else str(raw_code).strip()
        if code:
            already_coded += 1
            row[method_column] = "source"
            row[confidence_column] = 1.0
            continue

        raw_text = row.get(text_column)
        result = matcher.match("" if raw_text is None else str(raw_text).strip())
        if result.matched:
            filled += 1
            row[code_column] = result.code or ""
            row[method_column] = result.method
            row[confidence_column] = round(result.confidence, 3)
            by_method[result.method] = by_method.get(result.method, 0) + 1
        else:
            unresolved += 1
            row[method_column] = None
            row[confidence_column] = None

    logger.info(
        "normalization.rows_completed",
        rows=len(rows),
        already_coded=already_coded,
        filled=filled,
        unresolved=unresolved,
        vocabulary=len(vocabulary),
    )
    return NormalizationSummary(
        rows=len(rows),
        already_coded=already_coded,
        filled=filled,
        unresolved=unresolved,
        vocabulary_size=len(vocabulary),
        by_method=by_method,
    )


def normalize_file(
    source_path: Path,
    destination_path: Path,
    *,
    text_column: str,
    code_column: str,
    matcher_factory: object | None = None,
) -> NormalizationSummary:
    """Fill in the missing codes of an extracted CSV.

    Reads ``source_path``, learns a vocabulary from its coded rows, codes the
    uncoded ones, and writes the result to ``destination_path`` with two extra
    columns: how each filled code was decided, and how confident that was.
    Those columns are the audit trail — a row coded by a model and a row coded
    by exact match are not the same claim, and a reader downstream must be able
    to tell them apart.

    Rows that cannot be placed keep an empty code. Guessing to raise the fill
    rate would put a wrong code in a patient record silently, which is the one
    outcome worth avoiding at any cost to the metric.

    Args:
        source_path: The extracted CSV.
        destination_path: Where to write the normalised copy.
        text_column: Free-text column to read.
        code_column: Code column to fill.
        matcher_factory: Callable taking a vocabulary and returning a matcher.
            Defaults to exact followed by fuzzy — the deterministic pair, since
            adding a model stage costs provider calls and should be a decision
            somebody made, not a default.

    Returns:
        Counts, including how many rows each strategy placed.
    """
    import csv as _csv

    with source_path.open("r", encoding="utf-8", newline="") as handle:
        rows = list(_csv.DictReader(handle))

    if not rows:
        return NormalizationSummary(0, 0, 0, 0, 0, {})

    fieldnames = list(rows[0].keys())
    for required in (text_column, code_column):
        if required not in fieldnames:
            raise ValueError(
                f"the extraction does not return a column called {required!r}; "
                f"it returns {', '.join(fieldnames)}"
            )

    vocabulary = vocabulary_from_rows(rows, text_column, code_column)
    build = matcher_factory or (lambda v: CascadeMatcher(ExactMatcher(v), FuzzyMatcher(v)))
    matcher = build(vocabulary)  # type: ignore[operator]

    already_coded = filled = unresolved = 0
    by_method: dict[str, int] = {}

    out_fields = [*fieldnames, f"{code_column}_method", f"{code_column}_confidence"]
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    with destination_path.open("w", encoding="utf-8", newline="") as handle:
        writer = _csv.DictWriter(handle, fieldnames=out_fields)
        writer.writeheader()

        for row in rows:
            code = (row.get(code_column) or "").strip()
            if code:
                already_coded += 1
                row[f"{code_column}_method"] = "source"
                row[f"{code_column}_confidence"] = "1.0"
            else:
                result = matcher.match((row.get(text_column) or "").strip())
                if result.matched:
                    filled += 1
                    row[code_column] = result.code or ""
                    row[f"{code_column}_method"] = result.method
                    row[f"{code_column}_confidence"] = f"{result.confidence:.3f}"
                    by_method[result.method] = by_method.get(result.method, 0) + 1
                else:
                    unresolved += 1
                    row[f"{code_column}_method"] = ""
                    row[f"{code_column}_confidence"] = ""
            writer.writerow(row)

    logger.info(
        "normalization.file_completed",
        rows=len(rows),
        already_coded=already_coded,
        filled=filled,
        unresolved=unresolved,
        vocabulary=len(vocabulary),
    )
    return NormalizationSummary(
        rows=len(rows),
        already_coded=already_coded,
        filled=filled,
        unresolved=unresolved,
        vocabulary_size=len(vocabulary),
        by_method=by_method,
    )
