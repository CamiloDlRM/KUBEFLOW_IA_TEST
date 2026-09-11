# The `hospital` source system

A simulated Hospital Information System. **It is not part of the MLOps
platform** — it stands in for the transactional system a hospital already runs,
so the platform has a realistic *external* source to extract from instead of
starting from a CSV somebody uploaded by hand.

Everything the platform does upstream of training — extraction, transformation,
normalisation — needs something to extract *from*. This is that something.

## Where the data comes from

[Synthea](https://github.com/synthetichealth/synthea) (MITRE), a synthetic
patient generator. No real patient is represented, so there is nothing to
anonymise and no data-use agreement to sign — which is also why it is used here
instead of MIMIC, whose access requires credentialing that takes weeks.

The loader downloads Synthea's published sample extract on first run. Roughly
100 patients with their full longitudinal record: encounters, conditions,
procedures, medications and observations.

## What the loader changes, and why

Synthea emits **clean** data. Every procedure carries its canonical SNOMED CT
description, spelled identically every time, and every row is coded. Loaded
verbatim, there would be nothing to normalise, and any normalisation step would
score 100% for the wrong reason.

Real hospital systems do not look like that, so the loader introduces two kinds
of realism:

**Free text is degraded.** The same procedure ends up as `APPENDECTOMY`,
`Appendectomy `, `Appendect.`, `appendectomy (procedure`. Nine named
transformations — case, whitespace, truncation to a legacy field width,
abbreviation, dropped SNOMED qualifier, typos — are applied with fixed weights
and a fixed seed. See [`degradation.py`](degradation.py), where each one is
documented with the field practice it imitates.

**Coding is incomplete.** 40% of clinical rows have no code at all. This is not
a defect to repair at load time: it is the problem the platform exists to solve.
Coding in real systems is done later, by somebody else, or never.

The result, measured on the sample extract: **265 canonical procedure terms
become 2,181 distinct surface forms**, and no surface form is ambiguous — each
maps back to exactly one code.

> This is controlled noise injection and must be described as such in any
> write-up. The transformations are *our model* of real messiness, not a sample
> of it. Their realism is an assumption of the method, which is why each one is
> justified individually rather than tuned until the numbers looked good.

## The answer key

Two schemas:

| Schema | Contents | Who reads it |
|---|---|---|
| `public` | The operational tables, as hospital staff would see them | The platform's ingestion |
| `eval` | The canonical code and description of every row, before degradation | Only the scoring harness |

Keeping them apart is what makes the experiment honest. The ingestion pipeline
is pointed at `public` and has no way to reach `eval`, so it cannot accidentally
read the answer. Scoring then joins the normalised output back to
`eval.procedure_truth` and reports accuracy — **without anybody labelling a
corpus by hand**, which is what usually makes this kind of evaluation
impractical at project scale.

`eval.*_truth.degradation` records *which* transformation each row received, so
results can be broken down by noise type. "The mapping holds up against case and
whitespace but falls over on truncation" is a far more useful finding than a
single aggregate percentage.

`eval.vocabulary` holds the controlled vocabulary to map onto. It is derived
from the corpus, so it is complete by construction; a real deployment would load
SNOMED CT or CIE-10 instead.

## Deliberate design choices worth knowing

**Direct identifiers are kept.** `patients` carries SSN, names and addresses.
They are synthetic, and a realistic source has them. Whether the ingestion is
allowed to carry them downstream is exactly the question the governance layer
should answer, so the pipeline has to make that choice explicitly rather than
never facing it.

**Measurements are stored as text.** `observations.value_raw` is `TEXT` because
real systems put `"128"`, `"7.2"`, `"Negative"` and `"120/80"` in the same
column. Casting it is a transformation step, not a given.

**The text is in English.** Synthea's terms are English SNOMED. A deployment in
Colombia would carry Spanish text and CIE-10 codes; the degradations are
structural — whitespace, case, truncation — so they apply unchanged to either.

## Running it

Comes up with the rest of the stack:

```bash
docker compose up -d hospital-db hospital-init
```

It is idempotent: on an already-populated database it logs `already populated`
and exits. To rebuild from scratch:

```bash
docker compose run --rm -e HOSPITAL_FORCE_RELOAD=true hospital-init
```

| Variable | Default | Purpose |
|---|---|---|
| `HOSPITAL_DB_URL` | `postgresql://hospital:hospital@hospital-db:5432/hospital` | Target database |
| `SYNTHEA_SEED` | `20260911` | Seed for the degradation — change it for an independent sample |
| `UNCODED_FRACTION` | `0.40` | Share of clinical rows left without a code |
| `SYNTHEA_LOCAL_ZIP` | — | Load a local extract instead of downloading |
| `SYNTHEA_URL` | Synthea's latest sample | Override the download |
| `HOSPITAL_FORCE_RELOAD` | `false` | Wipe and reload |

Changing `SYNTHEA_SEED` produces a different degraded corpus from the same
underlying records — useful for checking that a result is not an artefact of one
particular draw.
