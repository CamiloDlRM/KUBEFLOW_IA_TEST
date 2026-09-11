-- =============================================================================
-- "Hospital" — a simulated Hospital Information System (HIS).
-- =============================================================================
--
-- This is NOT part of the MLOps platform. It stands in for the transactional
-- system a hospital already runs, and exists so the platform has a realistic
-- *external* source to extract from, rather than starting from a CSV somebody
-- uploaded by hand.
--
-- The data comes from Synthea (MITRE), a synthetic patient generator: no real
-- patient is represented, so there is nothing to anonymise and no data-use
-- agreement to sign.
--
-- Two schemas:
--
--   public  the operational tables, as the hospital's own staff would see them
--   eval    the answer key, used only to score the normalisation step
--
-- The platform's ingestion is only ever pointed at `public`. `eval` exists so
-- an experiment can be scored without a human labelling anything by hand; see
-- hospital/README.md for why the two are kept apart.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS eval;

-- -----------------------------------------------------------------------------
-- Reference data
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS organizations (
    id              UUID PRIMARY KEY,
    name            TEXT,
    address         TEXT,
    city            TEXT,
    state           TEXT,
    zip             TEXT,
    phone           TEXT,
    revenue         NUMERIC,
    utilization     INTEGER
);

CREATE TABLE IF NOT EXISTS providers (
    id              UUID PRIMARY KEY,
    organization_id UUID REFERENCES organizations (id),
    name            TEXT,
    gender          TEXT,
    -- Free text in the source system: "GENERAL PRACTICE", "general practice",
    -- "Gen. Practice"… one of the columns the normalisation step has to fix.
    speciality      TEXT,
    city            TEXT,
    state           TEXT
);

CREATE TABLE IF NOT EXISTS payers (
    id              UUID PRIMARY KEY,
    name            TEXT,
    ownership       TEXT
);

-- -----------------------------------------------------------------------------
-- Patients and their episodes
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS patients (
    id                   UUID PRIMARY KEY,
    birthdate            DATE,
    deathdate            DATE,
    -- Direct identifiers are deliberately kept: they are synthetic, and a
    -- realistic source has them. Whether the ingestion is allowed to carry
    -- them downstream is exactly the kind of question the governance layer
    -- should answer, so the pipeline has to make that choice explicitly
    -- rather than never facing it.
    ssn                  TEXT,
    first_name           TEXT,
    last_name            TEXT,
    marital_status       TEXT,
    race                 TEXT,
    ethnicity            TEXT,
    gender               TEXT,
    birthplace           TEXT,
    address              TEXT,
    city                 TEXT,
    state                TEXT,
    county               TEXT,
    zip                  TEXT,
    healthcare_expenses  NUMERIC,
    healthcare_coverage  NUMERIC,
    income               NUMERIC
);

CREATE TABLE IF NOT EXISTS encounters (
    id                  UUID PRIMARY KEY,
    started_at          TIMESTAMPTZ,
    stopped_at          TIMESTAMPTZ,
    patient_id          UUID REFERENCES patients (id),
    organization_id     UUID,
    provider_id         UUID,
    payer_id            UUID,
    encounter_class     TEXT,
    encounter_code      TEXT,
    encounter_text      TEXT,
    base_cost           NUMERIC,
    total_claim_cost    NUMERIC,
    payer_coverage      NUMERIC,
    reason_code         TEXT,
    reason_text         TEXT
);

CREATE INDEX IF NOT EXISTS idx_encounters_patient ON encounters (patient_id);
CREATE INDEX IF NOT EXISTS idx_encounters_started ON encounters (started_at);

-- -----------------------------------------------------------------------------
-- Clinical events
--
-- `*_code` is NULL on a deliberate fraction of rows. That is not a data defect
-- to be fixed at load time — it is the problem the platform is meant to solve.
-- Coding in real systems is incomplete: the clinician types what they did, and
-- the coded value is filled in later, by somebody else, or never.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conditions (
    id              BIGSERIAL PRIMARY KEY,
    started_on      DATE,
    stopped_on      DATE,
    patient_id      UUID REFERENCES patients (id),
    encounter_id    UUID,
    condition_code  TEXT,          -- SNOMED CT, NULL when never coded
    condition_text  TEXT NOT NULL  -- what was actually typed
);

CREATE INDEX IF NOT EXISTS idx_conditions_patient ON conditions (patient_id);
CREATE INDEX IF NOT EXISTS idx_conditions_uncoded
    ON conditions (id) WHERE condition_code IS NULL;

CREATE TABLE IF NOT EXISTS procedures (
    id              BIGSERIAL PRIMARY KEY,
    started_at      TIMESTAMPTZ,
    stopped_at      TIMESTAMPTZ,
    patient_id      UUID REFERENCES patients (id),
    encounter_id    UUID,
    procedure_code  TEXT,          -- SNOMED CT, NULL when never coded
    procedure_text  TEXT NOT NULL, -- what was actually typed
    base_cost       NUMERIC,
    reason_code     TEXT,
    reason_text     TEXT
);

CREATE INDEX IF NOT EXISTS idx_procedures_patient ON procedures (patient_id);
CREATE INDEX IF NOT EXISTS idx_procedures_uncoded
    ON procedures (id) WHERE procedure_code IS NULL;

CREATE TABLE IF NOT EXISTS medications (
    id              BIGSERIAL PRIMARY KEY,
    started_at      TIMESTAMPTZ,
    stopped_at      TIMESTAMPTZ,
    patient_id      UUID REFERENCES patients (id),
    encounter_id    UUID,
    medication_code TEXT,
    medication_text TEXT NOT NULL,
    base_cost       NUMERIC,
    dispenses       INTEGER,
    total_cost      NUMERIC,
    reason_code     TEXT,
    reason_text     TEXT
);

CREATE INDEX IF NOT EXISTS idx_medications_patient ON medications (patient_id);

-- -----------------------------------------------------------------------------
-- Observations: vitals and labs
--
-- `value_raw` is TEXT on purpose. Real systems store measurements as strings
-- because the same column holds "128", "7.2", "Negative" and "120/80". Casting
-- it is a transformation step, not a given.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS observations (
    id              BIGSERIAL PRIMARY KEY,
    observed_at     TIMESTAMPTZ,
    patient_id      UUID REFERENCES patients (id),
    encounter_id    UUID,
    category        TEXT,
    observation_code TEXT,          -- LOINC
    observation_text TEXT,
    value_raw       TEXT,
    units           TEXT,
    value_type      TEXT
);

CREATE INDEX IF NOT EXISTS idx_observations_patient ON observations (patient_id);
CREATE INDEX IF NOT EXISTS idx_observations_code ON observations (observation_code);

-- -----------------------------------------------------------------------------
-- eval: the answer key
--
-- Holds, per row, the canonical code and the canonical description Synthea
-- emitted before any degradation was applied. Nothing in the platform reads
-- these tables; they exist so the normalisation step can be scored against a
-- reference nobody had to label by hand.
-- -----------------------------------------------------------------------------

-- ``degradation`` names the transformation applied to the free text (NULL when
-- the text was left alone). Keeping the name, rather than a boolean, is what
-- lets an experiment report accuracy *per kind of noise* — "the mapping holds
-- up against case and whitespace but falls over on truncation" is a far more
-- useful result than a single aggregate percentage.
CREATE TABLE IF NOT EXISTS eval.procedure_truth (
    procedure_id    BIGINT PRIMARY KEY,
    true_code       TEXT NOT NULL,
    true_text       TEXT NOT NULL,
    degradation     TEXT,
    was_uncoded     BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS eval.condition_truth (
    condition_id    BIGINT PRIMARY KEY,
    true_code       TEXT NOT NULL,
    true_text       TEXT NOT NULL,
    degradation     TEXT,
    was_uncoded     BOOLEAN NOT NULL
);

-- The controlled vocabulary the normalisation step maps free text back onto.
-- Derived from the source data, so it is guaranteed to be complete for this
-- corpus — a real deployment would load SNOMED CT or CIE-10 here instead.
CREATE TABLE IF NOT EXISTS eval.vocabulary (
    code            TEXT NOT NULL,
    term            TEXT NOT NULL,
    domain          TEXT NOT NULL,   -- 'procedure' | 'condition'
    PRIMARY KEY (code, domain)
);
