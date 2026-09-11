"""Realistic degradation of clinical free text.

Why this module exists
----------------------

Synthea emits canonical SNOMED CT descriptions: ``"Appendectomy (procedure)"``,
spelled identically every time. Loading that verbatim would make the platform's
normalisation step meaningless — there would be nothing to normalise, and any
mapping would score 100% for the wrong reason.

Real hospital systems do not look like that. The same procedure appears as
``"APPENDECTOMY"``, ``"Appendectomy "``, ``"Appendect."``, ``"appendectomy
(procedure"`` — typed by different people, into fields of different widths,
over a decade. That variation is the actual problem the platform is meant to
solve, so it has to be present in the source.

This module introduces it deliberately and reproducibly. Every transformation
is named, seeded, and recorded per row in ``eval.*_truth``, which means an
experiment can report accuracy *per kind of noise* rather than one aggregate
number — and that nobody has to hand-label a corpus to get a reference.

This is controlled noise injection, and it must be described as such in any
write-up: the degradations below are our model of what real messiness looks
like, not a sample of it. Their realism is an assumption of the method, and
the reason each one is documented with the field practice it imitates.

A production deployment in Colombia would carry Spanish text and CIE-10 codes.
The transformations here are structural — whitespace, case, truncation,
abbreviation — so they apply unchanged to either language.
"""
from __future__ import annotations

import random
import re
import unicodedata
from typing import Callable, Final

#: Words abbreviated by hand in clinical notes, and how they get shortened.
#: Kept short and uncontroversial; the point is the *shape* of the noise.
_ABBREVIATIONS: Final[dict[str, str]] = {
    "procedure": "proc",
    "assessment": "assmt",
    "screening": "scr",
    "examination": "exam",
    "evaluation": "eval",
    "management": "mgmt",
    "administration": "admin",
    "consultation": "consult",
    "history": "hx",
    "diagnosis": "dx",
    "treatment": "tx",
    "surgery": "cx",
    "surgical": "surg",
    "injection": "inj",
    "measurement": "meas",
    "intravenous": "IV",
    "review": "rev",
}

#: Width of a legacy fixed-length description field. Anything longer is cut,
#: which is why truncated terms are so common in systems with a mainframe
#: somewhere in their history.
_LEGACY_FIELD_WIDTH: Final[int] = 30


def _strip_qualifier(text: str, rng: random.Random) -> str:
    """Drop SNOMED's trailing semantic tag: "X (procedure)" -> "X".

    Clinicians type the procedure, not the ontology's bookkeeping. This is the
    single most common difference between a coded term and what is in the free
    text field.
    """
    return re.sub(r"\s*\((procedure|disorder|finding|situation|regime/therapy)\)\s*$", "", text)


def _upper(text: str, rng: random.Random) -> str:
    """Whole field in capitals — the default in many terminal-era systems."""
    return text.upper()


def _lower(text: str, rng: random.Random) -> str:
    """Whole field in lower case — typed fast, no shift key."""
    return text.lower()


def _whitespace_noise(text: str, rng: random.Random) -> str:
    """Padding and doubled internal spaces.

    The case the professor singled out: two terms that are the same to a human
    and different to ``=``.
    """
    out = text
    if rng.random() < 0.5:
        parts = out.split(" ")
        if len(parts) > 1:
            i = rng.randrange(len(parts) - 1)
            parts[i] = parts[i] + " "
            out = " ".join(parts)
    if rng.random() < 0.6:
        out = " " * rng.randint(1, 3) + out
    if rng.random() < 0.6:
        out = out + " " * rng.randint(1, 3)
    return out


def _strip_accents(text: str, rng: random.Random) -> str:
    """Accents dropped by a non-Unicode-safe field.

    A no-op on most English terms, which is honest: it only fires where there
    is an accent to lose, and matters for the Spanish-language deployment this
    stands in for.
    """
    return "".join(
        c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn"
    )


def _abbreviate(text: str, rng: random.Random) -> str:
    """Replace one long word with its ward-round abbreviation."""
    words = text.split()
    candidates = [
        i for i, w in enumerate(words) if w.strip("()").lower() in _ABBREVIATIONS
    ]
    if not candidates:
        return text
    i = rng.choice(candidates)
    bare = words[i].strip("()").lower()
    words[i] = _ABBREVIATIONS[bare]
    return " ".join(words)


def _truncate(text: str, rng: random.Random) -> str:
    """Cut to a legacy field width, mid-word if that is where it lands."""
    if len(text) <= _LEGACY_FIELD_WIDTH:
        return text
    return text[:_LEGACY_FIELD_WIDTH].rstrip()


def _typo(text: str, rng: random.Random) -> str:
    """A single transposition or dropped character."""
    if len(text) < 6:
        return text
    i = rng.randrange(1, len(text) - 2)
    if rng.random() < 0.5:
        return text[:i] + text[i + 1] + text[i] + text[i + 2 :]
    return text[:i] + text[i + 1 :]


def _trailing_punctuation(text: str, rng: random.Random) -> str:
    """A stray period, or an unbalanced parenthesis from a bad paste."""
    return text + rng.choice([".", " .", ",", ")", " -"])


#: Named transformations, in the order they are considered. The name is what
#: lands in ``eval.*_truth.degradation``.
TRANSFORMATIONS: Final[dict[str, Callable[[str, random.Random], str]]] = {
    "strip_qualifier": _strip_qualifier,
    "uppercase": _upper,
    "lowercase": _lower,
    "whitespace": _whitespace_noise,
    "strip_accents": _strip_accents,
    "abbreviate": _abbreviate,
    "truncate": _truncate,
    "typo": _typo,
    "trailing_punctuation": _trailing_punctuation,
}

#: How often each transformation is picked, relative to the others. Weighted so
#: the corpus looks like a real extract: qualifier-stripping and case changes
#: dominate, typos are rare.
_WEIGHTS: Final[dict[str, float]] = {
    "strip_qualifier": 0.30,
    "uppercase": 0.14,
    "lowercase": 0.10,
    "whitespace": 0.14,
    "strip_accents": 0.03,
    "abbreviate": 0.10,
    "truncate": 0.09,
    "typo": 0.04,
    "trailing_punctuation": 0.06,
}

#: Fraction of rows left exactly as Synthea wrote them. A corpus where every
#: row is dirty is as unrealistic as one where none is, and the clean rows are
#: the control group.
CLEAN_FRACTION: Final[float] = 0.25

#: Fraction of rows that also get a second transformation stacked on the first.
#: Real text is rarely wrong in only one way: "APPENDECT." is upper-cased *and*
#: truncated.
COMPOUND_FRACTION: Final[float] = 0.35


def degrade(text: str, rng: random.Random) -> tuple[str, str | None]:
    """Return ``(degraded_text, degradation_name)`` for one value.

    ``degradation_name`` is ``None`` when the text was left alone, and joins
    names with ``+`` when more than one transformation was applied.

    Args:
        text: The canonical description.
        rng: Seeded generator, so a given load is reproducible.
    """
    if rng.random() < CLEAN_FRACTION:
        return text, None

    names = list(_WEIGHTS)
    weights = [_WEIGHTS[n] for n in names]

    first = rng.choices(names, weights=weights, k=1)[0]
    out = TRANSFORMATIONS[first](text, rng)
    applied = [first]

    if rng.random() < COMPOUND_FRACTION:
        second = rng.choices(names, weights=weights, k=1)[0]
        if second != first:
            candidate = TRANSFORMATIONS[second](out, rng)
            # Only keep the second transformation if it actually changed
            # something — otherwise the recorded name would overstate the noise.
            if candidate != out:
                out = candidate
                applied.append(second)

    if out.strip() == text.strip() and out == text:
        return text, None

    return out, "+".join(applied)
