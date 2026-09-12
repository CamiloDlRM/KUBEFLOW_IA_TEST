"""Pydantic v2 and SQLModel schemas for the MLOps platform.

Defines database tables (SQLModel) and request/response DTOs (BaseModel).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlmodel import Column, Field as SQLField, JSON, SQLModel


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_uuid() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Database tables (SQLModel with table=True)
# ---------------------------------------------------------------------------

class User(SQLModel, table=True):
    """Application user for authentication."""

    __tablename__ = "users"

    id: int | None = SQLField(default=None, primary_key=True)
    username: str = SQLField(index=True, unique=True)
    hashed_password: str
    role: str = SQLField(default="member")  # "admin" | "member"
    email: str | None = SQLField(default=None)
    is_active: bool = SQLField(default=True)
    created_at: datetime = SQLField(default_factory=_utcnow)


class ChangeToken(SQLModel, table=True):
    """Pending credential change awaiting email confirmation."""

    __tablename__ = "change_tokens"

    id: int | None = SQLField(default=None, primary_key=True)
    token: str = SQLField(index=True, unique=True)
    user_id: int = SQLField(foreign_key="users.id")
    change_type: str = SQLField()  # "password" | "username"
    new_value: str = SQLField()    # hashed password OR new username
    expires_at: datetime
    used_at: datetime | None = SQLField(default=None)


class InviteToken(SQLModel, table=True):
    """Single-use invitation token created by admins."""

    __tablename__ = "invite_tokens"

    id: int | None = SQLField(default=None, primary_key=True)
    token: str = SQLField(index=True, unique=True)
    email: str | None = SQLField(default=None, description="Email address the invite was sent to.")
    created_by: int = SQLField(foreign_key="users.id")
    used_by: int | None = SQLField(default=None, foreign_key="users.id")
    expires_at: datetime
    used_at: datetime | None = SQLField(default=None)


class Repository(SQLModel, table=True):
    """Registered GitHub repository."""

    __tablename__ = "repositories"

    id: int | None = SQLField(default=None, primary_key=True)
    # Owner of the repository. Members only see and manage their own
    # repositories (and everything derived from them: pipelines, datasets,
    # deployments, insights); admins see all of them.
    owner_id: int | None = SQLField(default=None, foreign_key="users.id", index=True)
    github_url: str = SQLField(index=True)
    github_token_masked: str = SQLField(
        default="",
        description="Masked token stored for display only (last 4 chars).",
    )
    branch: str = SQLField(default="main")
    notebook_path: str = SQLField(description="Path to the notebook file within the repository.")
    webhook_id: int | None = SQLField(default=None)
    webhook_url: str | None = SQLField(default=None)
    created_at: datetime = SQLField(default_factory=_utcnow)
    is_active: bool = SQLField(default=True)


class Pipeline(SQLModel, table=True):
    """A single pipeline execution record."""

    __tablename__ = "pipelines"

    id: str = SQLField(default_factory=_new_uuid, primary_key=True)
    repo_id: int = SQLField(foreign_key="repositories.id")
    status: str = SQLField(default="queued")  # queued | running | success | failed
    commit_sha: str = SQLField(default="")
    branch: str = SQLField(default="")  # branch the run was launched from ("" = repo default)
    started_at: datetime | None = SQLField(default=None)
    finished_at: datetime | None = SQLField(default=None)
    phases: list[dict[str, Any]] = SQLField(default_factory=list, sa_column=Column(JSON))
    metrics: dict[str, Any] = SQLField(default_factory=dict, sa_column=Column(JSON))


class ModelDeployment(SQLModel, table=True):
    """A deployed model version."""

    __tablename__ = "model_deployments"

    id: int | None = SQLField(default=None, primary_key=True)
    model_name: str = SQLField(index=True)
    version: str = SQLField(default="1")
    accuracy: float = SQLField(default=0.0)
    endpoint_url: str = SQLField(default="")
    mlflow_run_id: str = SQLField(default="")  # needed to (re)load the model artifact
    deployed_at: datetime = SQLField(default_factory=_utcnow)
    is_active: bool = SQLField(default=True)
    pipeline_id: str | None = SQLField(default=None, foreign_key="pipelines.id")


class PipelineInsight(SQLModel, table=True):
    """AI-generated feedback report for a pipeline run."""

    __tablename__ = "pipeline_insights"

    id: int | None = SQLField(default=None, primary_key=True)
    pipeline_id: str = SQLField(foreign_key="pipelines.id", index=True)
    status: str = SQLField(default="pending")  # pending | generating | ready | failed
    content: str = SQLField(default="")  # Markdown report
    model: str = SQLField(default="")
    error: str = SQLField(default="")
    created_at: datetime = SQLField(default_factory=_utcnow)
    finished_at: datetime | None = SQLField(default=None)
    # State of "apply suggestions and push to a branch"
    apply_status: str = SQLField(default="none")  # none | queued | applying | pushed | failed
    apply_error: str = SQLField(default="")
    apply_branch: str = SQLField(default="")
    apply_commit_sha: str = SQLField(default="")


class Dataset(SQLModel, table=True):
    """A training dataset uploaded by a user and stored in MinIO.

    Datasets belong to a repository. The pipeline downloads the repository's
    active dataset before executing the notebook and injects its local path as
    the ``DATASET_PATH`` papermill parameter.
    """

    __tablename__ = "datasets"

    id: int | None = SQLField(default=None, primary_key=True)
    repo_id: int = SQLField(foreign_key="repositories.id", index=True)
    name: str = SQLField(default="")  # original filename, e.g. "train.csv"
    description: str = SQLField(default="")
    bucket: str = SQLField(default="")
    object_key: str = SQLField(default="")  # e.g. "repo-3/7ac1.../train.csv"
    content_type: str = SQLField(default="application/octet-stream")
    size_bytes: int = SQLField(default=0)
    checksum: str = SQLField(default="")  # sha256 of the uploaded bytes
    uploaded_by: int | None = SQLField(default=None, foreign_key="users.id")
    created_at: datetime = SQLField(default_factory=_utcnow)
    # Exactly one dataset per repository is active; it is the one the pipeline uses.
    is_active: bool = SQLField(default=True)

    #: How this dataset came to exist: ``upload`` when a person sent the file,
    #: ``ingestion`` when it was extracted from a registered source. Both paths
    #: are profiled the same way, so downstream code never has to ask which one
    #: produced a dataset in order to know what it can rely on.
    origin: str = SQLField(default="upload")
    #: The extraction that produced it, when there was one. This is the near
    #: end of the lineage chain — model, pipeline, dataset, ingestion run,
    #: watermark range, source — which is what lets a deployed model say which
    #: rows of which system it was trained on.
    ingestion_run_id: str | None = SQLField(default=None, index=True)
    #: Per-column profile: inferred type, null rate, cardinality, top values.
    #: Computed on a bounded sample, so ``profiled_rows`` says what it covers
    #: rather than leaving a reader to assume it describes the whole file.
    profile: dict[str, Any] = SQLField(default_factory=dict, sa_column=Column(JSON))
    profiled_rows: int = SQLField(default=0)


class DataSource(SQLModel, table=True):
    """An external system the platform extracts data from.

    This is the head of the pipeline. Before it existed, the platform began
    where a data pipeline should already be halfway through — with a CSV
    somebody had uploaded by hand. A ``DataSource`` points at the system that
    CSV would have come from, so extraction, transformation and normalisation
    become part of the run rather than something done beforehand in a notebook
    nobody kept.

    A source belongs to a repository, and so inherits its owner: the ownership
    chain is ``DataSource -> Repository -> owner``, the same as everything else.
    """

    __tablename__ = "data_sources"

    id: int | None = SQLField(default=None, primary_key=True)
    repo_id: int = SQLField(foreign_key="repositories.id", index=True)
    name: str = SQLField(default="", description="Human label, e.g. 'Hospital HIS'.")
    kind: str = SQLField(default="postgres")  # only postgres today

    # --- Connection ---
    host: str = SQLField(default="")
    port: int = SQLField(default=5432)
    database: str = SQLField(default="")
    username: str = SQLField(default="")
    #: The *name of the environment variable* holding the password — never the
    #: password. The platform stores a pointer to a credential, not a
    #: credential, so a database dump of this table discloses nothing and
    #: rotating the secret needs no write here. It also means a source can only
    #: be created against a credential an operator has already provisioned,
    #: which is the behaviour you want: registering a source is not the same
    #: authority as minting access to one.
    password_env: str = SQLField(default="")

    # --- Extraction ---
    #: SQL to run, containing the literal token ``:watermark``. It is bound as
    #: a query parameter, never interpolated — see ``core.ingestion``.
    extraction_sql: str = SQLField(default="")
    #: Column the watermark tracks. Must be the *entry* timestamp, not a
    #: business date: rows entered after the pipeline has passed their business
    #: date would otherwise be skipped silently.
    watermark_column: str = SQLField(default="")
    #: High-water mark reached so far, as an ISO timestamp. Empty means the
    #: next run is a full backfill.
    watermark_value: str = SQLField(default="")

    # --- Normalisation (optional) ---
    #: Free-text column to code, and the column holding the code. Leave both
    #: empty to extract without normalising.
    #:
    #: The vocabulary is not configured anywhere, and that is the point: it is
    #: derived from the extracted rows that *already* carry a code. A source
    #: where 60% of rows were coded teaches the platform the 60%, which is then
    #: applied to the other 40%. No terminology licence, no separate file to
    #: keep in step with the data, and nothing is read that the evaluation
    #: harness also reads.
    normalize_text_column: str = SQLField(default="")
    normalize_code_column: str = SQLField(default="")

    created_at: datetime = SQLField(default_factory=_utcnow)
    is_active: bool = SQLField(default=True)


class IngestionRun(SQLModel, table=True):
    """One execution of a :class:`DataSource`'s extraction.

    Records what the watermark was before and after, so a run is auditable
    after the fact: which slice of the source produced which dataset. That
    lineage is what stops a trained model being a black box — you can walk
    from a deployed model back to the exact rows it came from.
    """

    __tablename__ = "ingestion_runs"

    id: str = SQLField(default_factory=_new_uuid, primary_key=True)
    source_id: int = SQLField(foreign_key="data_sources.id", index=True)
    status: str = SQLField(default="queued")  # queued | running | success | failed

    watermark_before: str = SQLField(default="")
    watermark_after: str = SQLField(default="")
    rows_extracted: int = SQLField(default=0)

    #: The dataset this run produced, if any. A run that extracted zero rows
    #: produces none — which is the correct outcome for an incremental run with
    #: nothing new, not a failure.
    dataset_id: int | None = SQLField(default=None, foreign_key="datasets.id")

    #: Pre-medallion name for what is now the bronze key, kept so the archives
    #: of runs made before the layers existed remain addressable — those sit in
    #: the datasets bucket, not in bronze. Nothing writes it any more.
    raw_object_key: str = SQLField(default="")

    #: Where this run landed in each layer. Bronze is the extract exactly as it
    #: left the source; silver is that same slice after the cleaning standard.
    #: Both are Parquet, and the two keys are identical strings in different
    #: buckets, so the lineage of a row is readable from its path alone.
    #:
    #: Neither is registered as a dataset by itself. Silver *accumulates* — a
    #: source's whole history is every object under its prefix — which is what
    #: makes an incremental run add to the table rather than replace it.
    bronze_key: str = SQLField(default="")
    silver_key: str = SQLField(default="")

    #: What the cleaning standard changed between those two objects: which
    #: rules fired, how many cells each touched, with examples, and the type
    #: every column was given. This is the difference between a silver layer
    #: and a folder called "clean" — without it, the claim that the data was
    #: cleaned is unverifiable.
    quality_report: dict[str, Any] = SQLField(default_factory=dict, sa_column=Column(JSON))

    #: Per-column profile of what was extracted: types, null rates, cardinality
    #: and the distribution summary. Kept on the run rather than recomputed so
    #: the AI advisor can reason about the data *as it was on that day*.
    profile: dict[str, Any] = SQLField(default_factory=dict, sa_column=Column(JSON))

    #: What normalisation did: how many rows arrived already coded, how many
    #: were filled in, how many could not be placed, and by which strategy.
    #: Empty when the source does not ask for normalisation.
    #:
    #: Kept per run rather than aggregated, because the answer changes as the
    #: vocabulary grows: an early extraction has fewer coded rows to learn
    #: from, so it places less. That trend is worth being able to see.
    normalization: dict[str, Any] = SQLField(default_factory=dict, sa_column=Column(JSON))

    started_at: datetime | None = SQLField(default=None)
    finished_at: datetime | None = SQLField(default=None)
    error: str = SQLField(default="")


class GoldTable(SQLModel, table=True):
    """The modelled table a project publishes, defined by a query over silver.

    One row per project, for now. The table it describes is rebuilt in full on
    every extraction rather than appended to, because the interesting gold
    definitions are not appendable: a table that is one row per patient changes
    an existing row when a new encounter arrives.

    The definition is SQL and nothing else. When the AI helps write one it
    produces this string; the platform reads it, runs it and reports on it. A
    model that returns rows has to be trusted. A model that returns a query can
    be read, run twice, and diffed.
    """

    __tablename__ = "gold_tables"

    id: int | None = SQLField(default=None, primary_key=True)
    repo_id: int = SQLField(foreign_key="repositories.id", index=True)
    name: str = SQLField(default="gold")

    #: The definition. Empty means the project has not written one and is using
    #: the default — everything its sources have ever landed, stacked by column
    #: name. The default is stored as emptiness rather than as generated SQL so
    #: that adding a source changes the table without anyone editing anything.
    sql: str = SQLField(default="")

    #: Incremented on every build. A model trained last month was trained on a
    #: particular version; a gold table overwritten in place could not say
    #: which, which is exactly the black box this project exists to avoid.
    version: int = SQLField(default=0)
    bucket: str = SQLField(default="")
    object_key: str = SQLField(default="")
    rows: int = SQLField(default=0)
    columns: list[str] = SQLField(default_factory=list, sa_column=Column(JSON))
    #: Row count per silver relation the build read, so a gold table that
    #: returns nothing can be told apart from one whose inputs were empty.
    relations: dict[str, Any] = SQLField(default_factory=dict, sa_column=Column(JSON))

    built_at: datetime | None = SQLField(default=None)
    build_error: str = SQLField(default="")
    created_at: datetime = SQLField(default_factory=_utcnow)


# ---------------------------------------------------------------------------
# Pipeline phase (embedded, not a table)
# ---------------------------------------------------------------------------

class PipelinePhase(BaseModel):
    """A single phase inside a pipeline run."""

    model_config = ConfigDict(from_attributes=True)

    name: str
    status: str = "pending"  # pending | running | success | failed
    started_at: datetime | None = None
    finished_at: datetime | None = None
    logs: str = ""


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class RepoCreateRequest(BaseModel):
    """Payload to register a new repository."""

    model_config = ConfigDict(strict=True)

    github_url: str = Field(..., examples=["https://github.com/user/repo"])
    github_token: str = Field(default="", description="Optional override token.")
    branch: str = Field(default="main")
    notebook_path: str = Field(..., description="Path to the notebook file within the repository (e.g. 'train.ipynb' or 'notebooks/train.ipynb').")


class PredictRequest(BaseModel):
    """Payload for model inference."""

    model_config = ConfigDict(strict=True)

    data: list[list[float]] = Field(
        ...,
        description="2-D array of feature vectors.",
        examples=[[[5.1, 3.5, 1.4, 0.2]]],
    )


class LoadModelRequest(BaseModel):
    """Internal request to load a model into the model-server."""

    model_config = ConfigDict(strict=True)

    mlflow_run_id: str
    version: str


class RollbackRequest(BaseModel):
    """Request to rollback a model to a previous version."""

    model_config = ConfigDict(strict=True)

    version: str = Field(..., description="MLflow model version to rollback to.")


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class RepoResponse(BaseModel):
    """Repository read representation."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int | None
    github_url: str
    github_token_masked: str
    branch: str
    notebook_path: str
    webhook_id: int | None
    webhook_url: str | None
    created_at: datetime
    is_active: bool


class RepoCreatedResponse(BaseModel):
    """Response after creating a repo."""

    repo_id: int
    webhook_url: str
    status: str = "webhook_created"


class PipelineResponse(BaseModel):
    """Pipeline read representation."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    repo_id: int
    status: str
    commit_sha: str
    branch: str = ""
    started_at: datetime | None
    finished_at: datetime | None
    phases: list[dict[str, Any]]
    metrics: dict[str, Any]


class PipelineListResponse(BaseModel):
    """Paginated list of pipelines."""

    items: list[PipelineResponse]
    total: int
    page: int
    size: int


class PipelineLogsResponse(BaseModel):
    """Aggregated logs for a pipeline."""

    pipeline_id: str
    logs: list[dict[str, Any]]


class WebhookAccepted(BaseModel):
    """Response when a webhook event is accepted."""

    status: str = "queued"
    pipeline_id: str


class ModelDeploymentResponse(BaseModel):
    """Deployed model read representation."""

    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    model_name: str
    version: str
    accuracy: float
    endpoint_url: str
    deployed_at: datetime
    is_active: bool
    pipeline_id: str | None


class PredictResponse(BaseModel):
    """Model prediction response."""

    prediction: list[Any]
    model_name: str
    version: str


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = "ok"


class ReadyResponse(BaseModel):
    """Readiness check response."""

    model_config = ConfigDict(protected_namespaces=())

    status: str
    redis: str
    mlflow: str
    model_server: str


class MessageResponse(BaseModel):
    """Generic message response."""

    message: str


# ---------------------------------------------------------------------------
# Auth schemas
# ---------------------------------------------------------------------------

#: Characters allowed in a username.
#:
#: Grafana identifies the signed-in user to the dashboards through the
#: ``${__user.login}`` global variable, which it interpolates *verbatim* into
#: the panel SQL — there is no parameter binding on that path. A username
#: containing a quote would therefore break out of the string literal and let
#: its owner read every tenant's rows. Constraining the character set at the
#: only two places a username can be set keeps that interpolation safe by
#: construction.
#:
#: The set is chosen to be the widest one that is still safe rather than the
#: narrowest one that works: usernames here are commonly email addresses, so
#: ``@`` and ``+`` must be accepted. What matters is excluding the characters
#: that can terminate or escape a SQL string literal — the single quote and the
#: backslash — plus whitespace and control characters, which would also make
#: the value unusable as an HTTP header.
#:
#: See ``grafana/dashboards/*.json`` and the Dashboards section of the README.
USERNAME_PATTERN = r"^[A-Za-z0-9_.+@-]{3,64}$"


class UserRegisterRequest(BaseModel):
    """Payload to register a new user."""

    model_config = ConfigDict(strict=True)

    username: str = Field(..., min_length=3, max_length=64, pattern=USERNAME_PATTERN)
    password: str = Field(..., min_length=8, max_length=72)
    invite_token: str = Field(..., description="Single-use invite token issued by an admin.")


class InviteCreateRequest(BaseModel):
    """Request body to generate an invite token."""

    model_config = ConfigDict(strict=True)

    email: str = Field(..., description="Email address to send the invite to.")
    expires_in_hours: int = Field(default=48, ge=1, le=720)


class InviteTokenResponse(BaseModel):
    """Invite token response returned to the admin."""

    token: str
    expires_at: datetime
    email: str
    email_sent: bool


class TokenResponse(BaseModel):
    """JWT access token response."""

    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    """Public user representation (no password)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: str
    email: str | None
    is_active: bool
    created_at: datetime


class DataSourceCreateRequest(BaseModel):
    """Payload to register an external system to extract from."""

    model_config = ConfigDict(strict=True)

    repo_id: int
    name: str = Field(..., min_length=1, max_length=120)
    kind: str = Field(default="postgres", pattern=r"^postgres$")
    host: str = Field(..., min_length=1, max_length=255)
    port: int = Field(default=5432, ge=1, le=65535)
    database: str = Field(..., min_length=1, max_length=128)
    username: str = Field(..., min_length=1, max_length=128)
    #: The *name* of the environment variable holding the password. Constrained
    #: to the shape of a variable name so it cannot be mistaken for one.
    password_env: str = Field(default="", max_length=128, pattern=r"^[A-Z0-9_]*$")
    extraction_sql: str = Field(..., min_length=1, max_length=20_000)
    watermark_column: str = Field(..., min_length=1, max_length=128)
    #: Set both to have missing codes filled in during extraction. Leaving
    #: them empty extracts without normalising, which is the default because
    #: not every source has a code column to complete.
    normalize_text_column: str = Field(default="", max_length=128)
    normalize_code_column: str = Field(default="", max_length=128)


class DataSourcePreviewRequest(BaseModel):
    """Ask what an extraction would return, without running one.

    Deliberately does not require the source to exist: the point is to check
    the query while writing it, not after committing to it. ``name`` is absent
    for the same reason — you are testing a connection, not registering one.
    """

    model_config = ConfigDict(strict=True)

    repo_id: int
    kind: str = Field(default="postgres", pattern=r"^postgres$")
    host: str = Field(..., min_length=1, max_length=255)
    port: int = Field(default=5432, ge=1, le=65535)
    database: str = Field(..., min_length=1, max_length=128)
    username: str = Field(..., min_length=1, max_length=128)
    password_env: str = Field(default="", max_length=128, pattern=r"^[A-Z0-9_]*$")
    extraction_sql: str = Field(..., min_length=1, max_length=20_000)
    limit: int = Field(default=10, ge=1, le=50)


class DataSourcePreviewResponse(BaseModel):
    """The first rows an extraction would return."""

    columns: list[str]
    rows: list[list[Any]]
    #: Per-column profile of the sample. Says what each column looks like, so
    #: the text and code fields can be chosen from what is there rather than
    #: from memory.
    profile: dict[str, Any]
    #: Whether the source holds more than the sample shown.
    truncated: bool


class DataSourceResponse(BaseModel):
    """Public view of a data source.

    Carries no credential — not even the masked shape of one — because there
    is none to carry: the source stores the name of an environment variable.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    repo_id: int
    name: str
    kind: str
    host: str
    port: int
    database: str
    username: str
    password_env: str
    extraction_sql: str
    watermark_column: str
    watermark_value: str
    normalize_text_column: str
    normalize_code_column: str
    created_at: datetime
    is_active: bool


class IngestionRunResponse(BaseModel):
    """One extraction, and what it produced."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    source_id: int
    status: str
    watermark_before: str
    watermark_after: str
    rows_extracted: int
    dataset_id: int | None
    raw_object_key: str
    bronze_key: str
    silver_key: str
    profile: dict[str, Any]
    normalization: dict[str, Any]
    #: What the cleaning standard changed on the way from bronze to silver.
    quality_report: dict[str, Any]
    started_at: datetime | None
    finished_at: datetime | None
    error: str

    @field_validator("profile", "normalization", "quality_report", mode="before")
    @classmethod
    def _absent_is_empty(cls, value: Any) -> Any:
        """Read a NULL JSON column as an empty one.

        Every JSON column here arrived with a migration, and the rows recorded
        before it hold NULL. Insisting on a dict turns the whole history into a
        500 — losing the runs that do have the data along with the ones that do
        not, which is a poor trade for a field that means "nothing recorded"
        either way.
        """
        return {} if value is None else value


# ---------------------------------------------------------------------------
# Medallion layers
# ---------------------------------------------------------------------------


class LayerStreamResponse(BaseModel):
    """One source's contribution to a layer."""

    source_id: int | None = None
    source_name: str = ""
    #: The name this stream is queried under in a gold definition.
    relation: str = ""
    objects: int = 0
    rows: int = 0
    size_bytes: int = 0


class LayerSummaryResponse(BaseModel):
    """What one layer currently holds for a project."""

    layer: str
    bucket: str
    objects: int = 0
    rows: int = 0
    size_bytes: int = 0
    last_updated: datetime | None = None
    streams: list[LayerStreamResponse] = Field(default_factory=list)
    #: Present on gold only: the definition, and whether it is the default.
    sql: str = ""
    is_default_definition: bool = True
    version: int = 0
    build_error: str = ""


class MedallionResponse(BaseModel):
    """The three layers of one project, side by side."""

    repo_id: int
    bronze: LayerSummaryResponse
    silver: LayerSummaryResponse
    gold: LayerSummaryResponse


class LayerPreviewResponse(BaseModel):
    """A look inside one layer object."""

    layer: str
    key: str
    columns: list[dict[str, str]] = Field(default_factory=list)
    rows: list[list[Any]] = Field(default_factory=list)
    object_rows: int = 0
    truncated: bool = False


class GoldDefinitionRequest(BaseModel):
    """A project's gold definition."""

    model_config = ConfigDict(strict=True)

    sql: str = Field(default="", max_length=20_000)
    name: str = Field(default="gold", min_length=1, max_length=60)


class GoldPreviewRequest(BaseModel):
    """A candidate definition to run without saving."""

    model_config = ConfigDict(strict=True)

    sql: str = Field(..., min_length=1, max_length=20_000)
    limit: int = Field(default=20, ge=1, le=200)


class GoldPreviewResponse(BaseModel):
    """What a candidate definition would produce."""

    columns: list[str] = Field(default_factory=list)
    rows: list[list[Any]] = Field(default_factory=list)
    total_rows: int = 0
    relations: dict[str, int] = Field(default_factory=dict)
    sql: str = ""


class GoldSuggestRequest(BaseModel):
    """A description of the table the user wants."""

    model_config = ConfigDict(strict=True)

    question: str = Field(..., min_length=3, max_length=2_000)


class GoldSuggestResponse(BaseModel):
    """SQL the model wrote, and what it says it does.

    The model returns a query, never rows. That is the whole design: a model
    that hands back data has to be trusted, and a model that hands back a query
    can be read, run twice and diffed.
    """

    sql: str = ""
    explanation: str = ""
    #: Set when the suggestion could not be produced or did not survive
    #: validation, so the caller shows a reason instead of an empty editor.
    error: str = ""


class UpdateProfileRequest(BaseModel):
    model_config = ConfigDict(strict=True)

    email: str = Field(..., min_length=3, max_length=254)


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(strict=True)

    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8, max_length=72)


class ChangeUsernameRequest(BaseModel):
    model_config = ConfigDict(strict=True)

    new_username: str = Field(..., min_length=3, max_length=64, pattern=USERNAME_PATTERN)


class ConfirmChangeRequest(BaseModel):
    model_config = ConfigDict(strict=True)

    token: str


class ChangeRequestedResponse(BaseModel):
    message: str
    email: str


# ---------------------------------------------------------------------------
# AI Insights
# ---------------------------------------------------------------------------

class InsightResponse(BaseModel):
    """AI insight read representation."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    pipeline_id: str
    status: str
    content: str
    model: str
    error: str
    created_at: datetime
    finished_at: datetime | None
    apply_status: str = "none"
    apply_error: str = ""
    apply_branch: str = ""
    apply_commit_sha: str = ""


class TriggerPipelineRequest(BaseModel):
    """Payload to launch a pipeline manually from a chosen branch."""

    model_config = ConfigDict(strict=True)

    branch: str = Field(default="", description="Branch to run from (empty = repo default).")


class BranchInfo(BaseModel):
    """A repository branch."""

    name: str
    commit_sha: str


# ---------------------------------------------------------------------------
# Datasets (MinIO)
# ---------------------------------------------------------------------------

class DatasetResponse(BaseModel):
    """Dataset read representation."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    repo_id: int
    name: str
    description: str
    bucket: str
    object_key: str
    content_type: str
    size_bytes: int
    checksum: str
    uploaded_by: int | None
    created_at: datetime
    is_active: bool
    # Where this came from and what it contains. Both are filled whichever
    # path produced the dataset, so the UI can present uploads and extractions
    # in one list without either looking impoverished.
    origin: str
    ingestion_run_id: str | None
    profile: dict[str, Any]
    profiled_rows: int


class DatasetPreviewResponse(BaseModel):
    """First rows of a tabular dataset, for the UI preview."""

    dataset_id: int
    columns: list[str]
    rows: list[list[Any]]
    truncated: bool = False
