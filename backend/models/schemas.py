"""Pydantic v2 and SQLModel schemas for the MLOps platform.

Defines database tables (SQLModel) and request/response DTOs (BaseModel).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, field_validator, model_validator
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
    #: A GitHub sign-up has no password until the user sets one.
    needs_password: bool = SQLField(default=False)


class AuthProvider(SQLModel, table=True):
    """A way of signing in. A new method is a new row, not a new column."""

    __tablename__ = "auth_providers"

    id: int | None = SQLField(default=None, primary_key=True)
    code: str = SQLField(index=True, unique=True)  # "github" | "token"
    name: str
    username_suffix: str  # "@g" | "@t"


class UserIdentity(SQLModel, table=True):
    """How a user signed up, and the GitHub token that identity carries."""

    __tablename__ = "user_identities"

    id: int | None = SQLField(default=None, primary_key=True)
    user_id: int = SQLField(foreign_key="users.id", index=True)
    provider_id: int = SQLField(foreign_key="auth_providers.id")
    #: GitHub's numeric user id; empty for the manual-token provider.
    provider_user_id: str | None = SQLField(default=None, index=True)
    github_token_encrypted: str = SQLField(default="")
    github_token_masked: str = SQLField(default="")
    created_at: datetime = SQLField(default_factory=_utcnow)
    updated_at: datetime = SQLField(default_factory=_utcnow)


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


class Project(SQLModel, table=True):
    """A piece of work: its data, and optionally the code that trains on it.

    The container the platform was missing. Everything used to hang off a
    *repository*, which forced an order of events the work does not have — you
    had to have a GitHub URL before you could connect a database, even though
    getting the data right is usually the part that comes first and takes
    longest.

    A project owns its data factory: the sources, the layers, the gold table.
    A repository is something it may later link, and holds only the code —
    which is why a project can exist, ingest and be explored with no repository
    at all, and why deleting the link does not touch the data.

    Ownership lives here. A project may only link a notebook from a repository
    of the same owner, so the repository's own column — which the multi-tenancy
    rules for pipelines still read — always agrees with it.
    """

    __tablename__ = "projects"

    id: int | None = SQLField(default=None, primary_key=True)
    name: str = SQLField(index=True)
    description: str = SQLField(default="")
    #: Members see only their own projects and everything under them; admins
    #: see all. Nullable for the same reason the repository's is: a row that
    #: predates ownership, or one inserted out of band, is visible to admins
    #: only rather than to everybody.
    owner_id: int | None = SQLField(default=None, foreign_key="users.id", index=True)
    created_at: datetime = SQLField(default_factory=_utcnow)
    is_active: bool = SQLField(default=True)
    #: The notebook this project trains with: one file on one branch of one
    #: repository. The unit is the notebook, not the repository, so several
    #: projects may share a repository — but a notebook runs in one project.
    repo_id: int | None = SQLField(default=None, foreign_key="repositories.id", index=True)
    branch: str = SQLField(default="main")
    notebook_path: str = SQLField(default="")
    #: What the pipeline trains on: ``{"layer": "gold"}`` for the newest gold
    #: build, ``{"layer": "gold", "version": 3}`` for a particular one,
    #: ``{"layer": "silver", "source_id": 2}`` for one source's silver. Empty
    #: means the project's active dataset. See :mod:`core.pipeline_input`.
    pipeline_input: dict[str, Any] = SQLField(default_factory=dict, sa_column=Column(JSON))
    #: When this project's model deploys: on or off, the metric that decides,
    #: its bar and direction, whether it must beat the version serving. Empty
    #: means the platform's defaults. See :mod:`core.deploy_policy`.
    deploy_policy: dict[str, Any] = SQLField(default_factory=dict, sa_column=Column(JSON))


class Repository(SQLModel, table=True):
    """A registered GitHub repository: code that projects pick notebooks from."""

    __tablename__ = "repositories"

    id: int | None = SQLField(default=None, primary_key=True)
    # Owner of the repository. Members only see and manage their own
    # repositories (and everything derived from them: pipelines, datasets,
    # deployments, insights); admins see all of them. A notebook may only be
    # linked to a project of the same owner, so the two never disagree.
    owner_id: int | None = SQLField(default=None, foreign_key="users.id", index=True)
    github_url: str = SQLField(index=True)
    github_token_masked: str = SQLField(
        default="",
        description="Masked token stored for display only (last 4 chars).",
    )
    github_token_encrypted: str = SQLField(default="")
    webhook_id: int | None = SQLField(default=None)
    webhook_url: str | None = SQLField(default=None)
    created_at: datetime = SQLField(default_factory=_utcnow)
    is_active: bool = SQLField(default=True)
    #: False for every repository registered before sign-in identities: those
    #: keep the token they were created with. True means "use my owner's token".
    uses_owner_token: bool = SQLField(default=False)


class Pipeline(SQLModel, table=True):
    """A single pipeline execution record."""

    __tablename__ = "pipelines"

    id: str = SQLField(default_factory=_new_uuid, primary_key=True)
    repo_id: int = SQLField(foreign_key="repositories.id")
    #: The project and notebook the run executed, fixed at launch so a later
    #: re-link does not rewrite what an old run was.
    project_id: int | None = SQLField(default=None, foreign_key="projects.id", index=True)
    notebook_path: str = SQLField(default="")
    status: str = SQLField(default="queued")  # queued | running | success | failed
    commit_sha: str = SQLField(default="")
    branch: str = SQLField(default="")  # branch the run was launched from
    started_at: datetime | None = SQLField(default=None)
    finished_at: datetime | None = SQLField(default=None)
    phases: list[dict[str, Any]] = SQLField(default_factory=list, sa_column=Column(JSON))
    metrics: dict[str, Any] = SQLField(default_factory=dict, sa_column=Column(JSON))
    #: Model name chosen in "Run pipeline". ``None`` for webhook runs, which
    #: use the notebook's ``MODEL_NAME``.
    requested_model_name: str | None = SQLField(default=None)
    #: What was actually mounted as DATASET_PATH: the layer, the objects and a
    #: label. The repository holds the choice; this holds what the choice
    #: meant on the day, so "follow the newest gold" still leaves each run
    #: naming its build.
    mounted_input: dict[str, Any] = SQLField(default_factory=dict, sa_column=Column(JSON))
    #: The notebook's code as this run had it, cell by cell with its phase, and
    #: after execution what each cell printed. Stored rather than re-read from
    #: GitHub, because the branch moves and the code that ran does not.
    cells: list[dict[str, Any]] = SQLField(default_factory=list, sa_column=Column(JSON))
    #: What the trained model expects and how it answers across that: its
    #: inputs in order with their training ranges, and one sweep per input.
    #: Built by the worker from the features the notebook wrote; empty when it
    #: wrote none. See :mod:`core.model_card`.
    model_card: dict[str, Any] = SQLField(default_factory=dict, sa_column=Column(JSON))
    #: The model this run trained and the version it was given, fixed at
    #: validation; and the MLflow run holding its artifact, once registered.
    #: Together they make every registered run a version that can be deployed,
    #: whether or not it cleared the auto-deploy bar.
    model_name: str = SQLField(default="", index=True)
    model_version: str = SQLField(default="")
    mlflow_run_id: str = SQLField(default="")
    #: Training parameters this run was launched with, injected into the
    #: notebook alongside the platform's own.
    parameters: dict[str, Any] = SQLField(default_factory=dict, sa_column=Column(JSON))


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


class ModelShareLink(SQLModel, table=True):
    """The public link to a model: anyone holding it can ask for predictions.

    One per model *name*, so the link survives new versions and rollbacks: it
    always answers with whichever version is serving. The URL carries a random
    token rather than the name, because names are short words anyone can guess
    and walk through; a token can only be had from someone who shared it.
    """

    __tablename__ = "model_share_links"

    id: int | None = SQLField(default=None, primary_key=True)
    model_name: str = SQLField(index=True, unique=True)
    #: 32 bytes from ``secrets.token_urlsafe``: unguessable, and URL-safe as is.
    token: str = SQLField(index=True, unique=True)
    #: Off stops the link answering without forgetting it; turning it back on
    #: restores the same URL. Regenerating the token is how a leaked one dies.
    enabled: bool = SQLField(default=True)
    created_at: datetime = SQLField(default_factory=_utcnow)
    created_by: int | None = SQLField(default=None, foreign_key="users.id")


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
    project_id: int = SQLField(foreign_key="projects.id", index=True)
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
    project_id: int = SQLField(foreign_key="projects.id", index=True)
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
    #: Or the password itself, Fernet-encrypted, for a user connecting their
    #: own database (e.g. Supabase) without an operator. Wins over password_env.
    password_encrypted: str = SQLField(default="")

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

    #: How the cleaning standard is applied to this source: rules turned off,
    #: its own placeholders, forced types, and so on. ``{}`` is the standard.
    #: See :class:`core.cleaning.CleaningRecipe`.
    cleaning_recipe: dict[str, Any] = SQLField(default_factory=dict, sa_column=Column(JSON))

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
    project_id: int = SQLField(foreign_key="projects.id", index=True)
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

class ProjectCreateRequest(BaseModel):
    """Payload to start a project. Deliberately asks for almost nothing.

    A project exists so work can begin before there is a repository to point
    at; requiring anything more than a name here would put the old ordering
    back by the front door.
    """

    model_config = ConfigDict(strict=True)

    name: str = Field(..., min_length=1, max_length=120)
    description: str = Field(default="", max_length=2_000)


class ProjectUpdateRequest(BaseModel):
    model_config = ConfigDict(strict=True)

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2_000)


class ProjectRepositoryResponse(BaseModel):
    """The code a project has linked, when it has linked any."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    github_url: str
    branch: str
    notebook_path: str


class ProjectDatasetResponse(BaseModel):
    """The active dataset of a project, as shown before a run."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    size_bytes: int


class ProjectRunRequest(BaseModel):
    """Payload of "Run pipeline" on a project."""

    model_config = ConfigDict(strict=True, protected_namespaces=())

    model_name: str = Field(
        ..., description="Name of the model this run produces (letters, digits, _ . -)."
    )
    #: Injected into the notebook as variables, e.g. ``{"N_ESTIMATORS": 300}``.
    parameters: dict[str, int | float | str | bool] = Field(default_factory=dict)


class ProjectResponse(BaseModel):
    """A project and what it currently holds."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    owner_id: int | None
    created_at: datetime
    #: ``None`` until a repository is linked. A project with no repository is a
    #: normal state, not an incomplete one: its data factory works regardless.
    repository: ProjectRepositoryResponse | None = None
    sources: int = 0
    #: Rows currently in the project's gold table, or 0 before its first build.
    gold_rows: int = 0
    #: The dataset a pipeline of this project is handed (``None`` until the
    #: gold layer has been built). "Run pipeline" requires it.
    active_dataset: ProjectDatasetResponse | None = None
    #: The model the linked notebook already deployed. When set, every run is a
    #: new version of it and "Run pipeline" does not ask for a name.
    deployed_model: str | None = None


class RepoCreateRequest(BaseModel):
    """Payload to register a new repository."""

    model_config = ConfigDict(strict=True)

    github_url: str = Field(..., examples=["https://github.com/user/repo"])
    github_token: str = Field(default="", description="Optional override token.")


class PredictRequest(BaseModel):
    """Payload for model inference.

    Shaped here, before any of it reaches a model: numbers only and finite
    (NaN and Infinity parse as JSON but mean nothing to a model), at least one
    row, and every row the same length. How many rows, and how long a row must
    be for *this* model, are checked by the endpoint (core.predict_input).
    """

    model_config = ConfigDict(strict=True)

    data: list[list[FiniteFloat]] = Field(
        ...,
        min_length=1,
        description="2-D array of feature vectors.",
        examples=[[[5.1, 3.5, 1.4, 0.2]]],
    )

    @field_validator("data")
    @classmethod
    def _rows_are_rectangular(cls, data: list[list[float]]) -> list[list[float]]:
        if any(len(row) == 0 for row in data):
            raise ValueError("every row needs at least one number")
        if len({len(row) for row in data}) > 1:
            raise ValueError("every row must have the same number of values")
        return data


class LoadModelRequest(BaseModel):
    """Internal request to load a model into the model-server."""

    model_config = ConfigDict(strict=True)

    mlflow_run_id: str
    version: str


class RollbackRequest(BaseModel):
    """Which version of a model to serve.

    ``pipeline_id`` names it exactly: the run that trained it. ``version`` is
    kept for callers from before versions were listed.
    """

    model_config = ConfigDict(strict=True)

    pipeline_id: str | None = Field(default=None, description="The run whose artifact to serve.")
    version: str | None = Field(default=None, description="The model version to serve.")

    @model_validator(mode="after")
    def _names_one(self) -> "RollbackRequest":
        if not self.pipeline_id and not self.version:
            raise ValueError("Say which version: pipeline_id or version.")
        return self


class ModelVersionResponse(BaseModel):
    """One version of a model: a run that registered an artifact."""

    version: str
    pipeline_id: str | None = None
    mlflow_run_id: str = ""
    trained_at: datetime | None = None
    #: Every numeric metric the notebook logged, accuracy included.
    metrics: dict[str, float] = Field(default_factory=dict)
    accuracy: float | None = None
    branch: str = ""
    commit_sha: str = ""
    #: What it trained on, e.g. "gold v3".
    input_label: str = ""
    #: The last time it was put in service, if it ever was.
    deployed_at: datetime | None = None
    #: Serving now.
    is_active: bool = False
    #: Has an artifact to load. A version without one is listed, not offered.
    deployable: bool = True
    #: The training parameters it was launched with.
    parameters: dict[str, Any] = Field(default_factory=dict)


class DeployPolicyRequest(BaseModel):
    """A project's deployment policy. Fields left out keep their value."""

    auto_deploy: bool | None = None
    metric: str | None = None
    threshold: float | None = None
    direction: str | None = None
    must_beat_serving: bool | None = None
    #: True puts the project back on the platform's defaults.
    reset: bool = False


class RunSettingsResponse(BaseModel):
    """What a run of this project will do with its model, and how to tune it."""

    policy: dict[str, Any]
    #: The project has not set a policy and uses the platform's.
    is_default: bool
    #: Metrics the project's runs have logged, for choosing the deciding one.
    metrics_available: list[str] = Field(default_factory=list)
    #: The parameters of the latest run, to start the next one from.
    last_parameters: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class LinkedNotebookResponse(BaseModel):
    """One notebook of a repository, as an active project has linked it."""

    project_id: int
    project_name: str
    branch: str
    notebook_path: str
    #: The run that makes the notebook "live": the newest one still queued or
    #: running, else the newest behind a deployed model. ``None`` when neither.
    active_pipeline_id: str | None = None


class RepoResponse(BaseModel):
    """Repository read representation."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int | None
    github_url: str
    github_token_masked: str
    webhook_id: int | None
    webhook_url: str | None
    created_at: datetime
    is_active: bool
    #: The notebooks of this repository that active projects have linked.
    #: Empty means pushes are ignored and the manual trigger is refused.
    notebooks: list[LinkedNotebookResponse] = []


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
    #: The project the run belongs to; ``None`` for runs older than projects.
    project_id: int | None = None
    notebook_path: str = ""
    status: str
    commit_sha: str
    branch: str = ""
    started_at: datetime | None
    finished_at: datetime | None
    phases: list[dict[str, Any]]
    metrics: dict[str, Any]
    parameters: dict[str, Any] = Field(default_factory=dict)
    #: Whose run this is: the owner of its project (and repository).
    owner_username: str | None = None
    mounted_input: dict[str, Any] = Field(default_factory=dict)
    #: The model this run trained, its version and the MLflow run holding it.
    #: Empty until validation (name, version) and registration (MLflow run).
    model_name: str = ""
    model_version: str = ""
    mlflow_run_id: str = ""


class PipelineDetailResponse(PipelineResponse):
    """One run, with the code it ran. Kept off the list, where it would be
    every notebook of every run on the page."""
    cells: list[dict[str, Any]] = Field(default_factory=list)
    model_card: dict[str, Any] = Field(default_factory=dict)


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


class NotebookCellsResponse(BaseModel):
    """A notebook's code as a branch has it now, cell by cell with its phase.

    What the pipeline view shows before a run exists to show it, and what the
    next run will execute.
    """

    branch: str
    notebook_path: str
    cells: list[dict[str, Any]] = Field(default_factory=list)


class PipelineInputRequest(BaseModel):
    """What to train on. An empty layer goes back to the active dataset."""

    layer: str = ""
    source_id: int | None = None
    version: int | None = None


class PipelineInputResponse(BaseModel):
    """A project's choice, and what it resolves to right now.

    ``error`` is set when the choice no longer resolves — a source deleted,
    a pinned build removed — so the view can say so before a run fails on it.
    """

    choice: dict[str, Any] = Field(default_factory=dict)
    resolved: dict[str, Any] | None = None
    error: str = ""


class InputStreamResponse(BaseModel):
    source_id: int
    source_name: str
    objects: int
    size_bytes: int


class InputGoldVersionResponse(BaseModel):
    version: int
    key: str
    size_bytes: int
    built_at: datetime | None = None
    latest: bool = False


class PipelineInputOptionsResponse(BaseModel):
    """What in a project a pipeline can be pointed at."""

    bronze: list[InputStreamResponse] = Field(default_factory=list)
    silver: list[InputStreamResponse] = Field(default_factory=list)
    gold: list[InputGoldVersionResponse] = Field(default_factory=list)


class WebhookAccepted(BaseModel):
    """Response when a webhook event is accepted."""

    status: str = "queued"
    pipeline_id: str
    #: Every run the event started: a push may change several linked notebooks.
    pipeline_ids: list[str] = []


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
    #: Whose model this is: the owner of the pipeline that trained it.
    owner_username: str | None = None
    #: Project of the run that trained it, so the UI can open that run on its canvas.
    project_id: int | None = None
    #: The card of the run that produced it — what to send it, in what range,
    #: and what it answers across that. Empty for models trained before cards.
    model_card: dict[str, Any] = Field(default_factory=dict)
    #: The model's public link: where anyone can ask it for predictions without
    #: signing in. None when it has never been shared or is switched off.
    share_url: str | None = None


class ShareLinkResponse(BaseModel):
    """A model's public link, as its owner sees it."""

    model_config = ConfigDict(protected_namespaces=())

    model_name: str
    enabled: bool
    #: The full URL to share. None until the link is first switched on.
    url: str | None = None
    #: Requests one client may make per minute, and the link may answer in all.
    per_ip_per_minute: int
    per_link_per_minute: int
    max_rows: int


class ShareLinkUpdate(BaseModel):
    """Switch a model's public link on or off."""

    enabled: bool


class PublicModelInfo(BaseModel):
    """What a public link answers to GET: enough to call it correctly, nothing more."""

    model_config = ConfigDict(protected_namespaces=())

    model_name: str
    version: str
    #: Each input in the order a row must list them: name and, when known, type.
    inputs: list[dict[str, Any]] = Field(default_factory=list)
    #: The classes a classifier answers with, when it says.
    classes: list[Any] = Field(default_factory=list)
    max_rows: int
    per_ip_per_minute: int


class PredictResponse(BaseModel):
    """Model prediction response."""

    prediction: list[Any]
    model_name: str
    version: str
    #: Per row, the probability of each class, when the model can say. A
    #: classifier's answer without its confidence reads the same at 34% as at 99%.
    probabilities: list[dict[str, float]] | None = None


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
    email: str = Field(..., min_length=3, max_length=254)
    github_token: str = Field(..., min_length=4)
    invite_token: str | None = Field(default=None, description="Optional invite token.")


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
    #: "ok" | "expiring" | "invalid" | "missing" | "unknown"
    github_token_status: str = "unknown"


class UserResponse(BaseModel):
    """Public user representation (no password)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: str
    email: str | None
    is_active: bool
    created_at: datetime
    needs_password: bool = False
    auth_provider: str = "token"  # "github" | "token"
    has_github_token: bool = False
    github_token_masked: str = ""


class GithubTokenUpdateRequest(BaseModel):
    model_config = ConfigDict(strict=True)

    github_token: str = Field(..., min_length=4)


class SetPasswordRequest(BaseModel):
    model_config = ConfigDict(strict=True)

    password: str = Field(..., min_length=8, max_length=72)


class GithubConfirmNewRequest(BaseModel):
    model_config = ConfigDict(strict=True)

    pending: str


class CleaningRuleResponse(BaseModel):
    """One rule of the standard, for a person choosing a recipe."""

    name: str
    tier: str
    title: str
    summary: str


class CleaningRecipeRequest(BaseModel):
    """A source's recipe, or ``reset`` to go back to the standard."""

    recipe: dict[str, Any] = Field(default_factory=dict)
    reset: bool = False


class CleaningRecipeResponse(BaseModel):
    """How a source is cleaned, against the standard it departs from."""

    source_id: int
    #: ``standard`` while the source has not set a recipe, ``custom`` after.
    mode: str
    #: The recipe in force, every option spelled out.
    recipe: dict[str, Any]
    #: The standard, so an editor can show what each option would be by default.
    standard: dict[str, Any]
    rules: list[CleaningRuleResponse]
    forceable_types: list[str]
    #: The lossy options this recipe turns on, in words.
    lossy: list[str] = Field(default_factory=list)


class DataSourceCreateRequest(BaseModel):
    """Payload to register an external system to extract from."""

    model_config = ConfigDict(strict=True)

    project_id: int
    name: str = Field(..., min_length=1, max_length=120)
    kind: str = Field(default="postgres", pattern=r"^postgres$")
    host: str = Field(..., min_length=1, max_length=255)
    port: int = Field(default=5432, ge=1, le=65535)
    database: str = Field(..., min_length=1, max_length=128)
    username: str = Field(..., min_length=1, max_length=128)
    #: The *name* of the environment variable holding the password. Constrained
    #: to the shape of a variable name so it cannot be mistaken for one.
    password_env: str = Field(default="", max_length=128, pattern=r"^[A-Z0-9_]*$")
    #: Stored encrypted, never returned. Takes precedence over password_env.
    password: str = Field(default="", max_length=256)
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

    project_id: int
    kind: str = Field(default="postgres", pattern=r"^postgres$")
    host: str = Field(..., min_length=1, max_length=255)
    port: int = Field(default=5432, ge=1, le=65535)
    database: str = Field(..., min_length=1, max_length=128)
    username: str = Field(..., min_length=1, max_length=128)
    password_env: str = Field(default="", max_length=128, pattern=r"^[A-Z0-9_]*$")
    #: Stored encrypted, never returned. Takes precedence over password_env.
    password: str = Field(default="", max_length=256)
    extraction_sql: str = Field(..., min_length=1, max_length=20_000)
    limit: int = Field(default=10, ge=1, le=50)
    #: Preview a saved source with its stored (encrypted) password.
    source_id: int | None = None


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
    project_id: int
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

    project_id: int
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


class DiffColumnResponse(BaseModel):
    """One column, as it appears on each side of the cleaning."""

    #: ``None`` on a side means the column is not there: dropped because it was
    #: empty, or added by the coding step.
    bronze: str | None = None
    silver: str | None = None
    bronze_type: str = ""
    silver_type: str = ""
    #: kept | renamed | dropped | added | retyped
    change: str = "kept"


class DiffRowResponse(BaseModel):
    """One row on both sides, with what happened to each cell."""

    #: Row number in the bronze object, so the pairing is checkable.
    row: int
    bronze: list[Any] = Field(default_factory=list)
    silver: list[Any] = Field(default_factory=list)
    #: Per cell: same | value | type | null | absent
    cells: list[str] = Field(default_factory=list)
    #: True when the cleaning removed this row — it has no silver side.
    removed: bool = False


class LayerDiffResponse(BaseModel):
    """Bronze and silver side by side, for one extraction."""

    run_id: str
    source_id: int
    key: str
    columns: list[DiffColumnResponse] = Field(default_factory=list)
    rows: list[DiffRowResponse] = Field(default_factory=list)
    bronze_rows: int = 0
    silver_rows: int = 0
    #: Set when deduplication removed more rows than the report tracks, so the
    #: pairing past that point is by position rather than known. Said out loud
    #: rather than left for a reader to discover.
    approximate: bool = False


class KpiTurn(SQLModel, table=True):
    """One exchange with the dashboard agent, kept so the next one can build on it.

    A dashboard is not made in one prompt. The first asks for something, the
    second moves a chart, the third says the split is wrong — and each of those
    only means anything if the model knows what it already built. Storing the
    exchange is what turns a series of one-shot requests into editing.

    What is stored is the *exchange*, not the model's internal conversation:
    the request in the user's words and the account it gave of what it did.
    Replaying a full tool transcript into the next prompt would grow without
    bound and mostly repeat what Superset can be asked directly.
    """

    __tablename__ = "kpi_turns"

    id: int | None = SQLField(default=None, primary_key=True)
    project_id: int = SQLField(foreign_key="projects.id", index=True)
    prompt: str = SQLField(default="")
    summary: str = SQLField(default="")
    #: Every tool the agent called, so a dashboard that came out wrong can be
    #: read as the sequence that produced it.
    calls: list[Any] = SQLField(default_factory=list, sa_column=Column(JSON))
    turns: int = SQLField(default=0)
    exhausted: bool = SQLField(default=False)
    created_at: datetime = SQLField(default_factory=lambda: datetime.now(timezone.utc))


class DashboardRequest(BaseModel):
    """What the user wants a dashboard to show, in their own words."""

    prompt: str = Field(min_length=1, max_length=4000)


class DashboardToolCallResponse(BaseModel):
    """One thing the agent did to Superset.

    Returned rather than summarised, because a dashboard that came out wrong
    should be readable as the sequence of calls that produced it — the model's
    own account of itself is the least reliable record of what it did.
    """

    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    result: str = ""


class DashboardTurnResponse(BaseModel):
    """One exchange: what was asked, and what the agent did about it."""

    id: int
    prompt: str = ""
    summary: str = ""
    calls: list[DashboardToolCallResponse] = Field(default_factory=list)
    turns: int = 0
    #: The loop was cut off rather than the model finishing. Whatever is in
    #: Superset is then half-built, and the summary may be mid-thought.
    exhausted: bool = False
    created_at: datetime | None = None


class DashboardEmbedResponse(BaseModel):
    """What the browser needs to show the KPI maker's dashboard in place.

    No Superset credential is in here. The token names one dashboard and
    expires in minutes; the SDK asks for another before it does.
    """

    dashboard_id: int
    #: The dashboard's embedded configuration, which is not its id.
    uuid: str
    #: Where the browser loads the iframe from.
    superset_domain: str
    token: str


class DashboardResponse(BaseModel):
    """The conversation so far, newest last.

    The whole conversation comes back on every request rather than only the
    new turn, because the conversation *is* the feature: a dashboard is built
    by refining it, and what was asked three prompts ago is how anyone works
    out why it looks the way it does.
    """

    turns: list[DashboardTurnResponse] = Field(default_factory=list)
    #: Where to go and look at the result. Empty when Superset is not
    #: configured for this installation.
    superset_url: str = ""


class CleaningColumnResponse(BaseModel):
    """One column, named on both sides of a single rule.

    Tracked by identity rather than by name so a rename reads as a rename
    instead of as every value in the column being replaced.
    """

    #: Its name before this rule. ``None`` only on the first step, which has no
    #: "before" at all.
    before: str | None = None
    #: Its name after. ``None`` when this rule dropped the column.
    after: str | None = None
    #: ``same`` | ``renamed`` | ``dropped``.
    change: str = "same"


class CleaningRowResponse(BaseModel):
    """One row of the preview, as this rule left it — and as it found it.

    ``before`` is empty when there is nothing to compare against: the first
    step, or a row that only entered the sample because a rule above removed
    one. Claiming those rows changed would be the easiest way to make this view
    lie.
    """

    #: Its position in the data as it arrived, which is what makes the two
    #: sides line up after a rule removes a row.
    row: int
    before: list[Any] = Field(default_factory=list)
    after: list[Any] = Field(default_factory=list)
    #: Per column, ``same`` | ``changed`` | ``absent``.
    cells: list[str] = Field(default_factory=list)
    #: This rule removed the row; there is no "after".
    removed: bool = False


class CleaningStepResponse(BaseModel):
    """One rule of the cleaning standard, and the table right after it ran."""

    #: Empty on the first step, which is the data as it arrived.
    rule: str = ""
    title: str = ""
    tier: str = ""
    cells_changed: int = 0
    rows_removed: int = 0
    columns_removed: int = 0
    flagged: int = 0
    note: str = ""
    #: Columns this rule acted on.
    columns: list[str] = Field(default_factory=list)
    #: Whether it did anything. Steps that did nothing are still returned, so a
    #: reader can see that the rule ran and found nothing to do — which is a
    #: different statement from the rule not existing.
    changed: bool = False
    #: Turned off in the source's recipe, so it did not run at all.
    skipped: bool = False

    #: The first rows, before and after this one rule, on aligned columns. Rows
    #: are matched by their position in the data as it arrived, so a
    #: deduplication earlier in the standard does not make everything after it
    #: look changed; rows this rule removed are kept, in place.
    preview_columns: list[CleaningColumnResponse] = Field(default_factory=list)
    preview_rows: list[CleaningRowResponse] = Field(default_factory=list)


class CleaningStepsResponse(BaseModel):
    """Every step of the standard, in order, for one extraction."""

    run_id: str
    source_id: int
    rows_in: int = 0
    rows_out: int = 0
    #: How many rows each preview shows.
    sample: int = 0
    steps: list[CleaningStepResponse] = Field(default_factory=list)
    #: The lossy options of the recipe replayed, in words.
    lossy: list[str] = Field(default_factory=list)
    #: True when this is a draft recipe tried out, not what the run did.
    preview: bool = False


class CleaningPreviewRequest(BaseModel):
    """A draft recipe to try on a source's latest extraction, without saving it."""

    source_id: int
    recipe: dict[str, Any] = Field(default_factory=dict)
    limit: int = Field(default=8, ge=1, le=50)


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

    branch: str = Field(default="", description="Branch to run from (empty = the linked one).")


class BranchInfo(BaseModel):
    """A repository branch."""

    name: str
    commit_sha: str


class NotebookEditorCell(BaseModel):
    """A notebook cell as the in-app editor shows it: its text, never its outputs."""

    index: int
    cell_type: str
    source: str
    tags: list[str] = []


class NotebookEditorResponse(BaseModel):
    """A notebook opened for editing."""

    branch: str
    notebook_path: str
    #: The file's blob SHA: sent back on save so a newer commit is not overwritten.
    sha: str
    cells: list[NotebookEditorCell]
    #: Active projects that train with this notebook on this branch: a push to
    #: it starts a pipeline run in each of them.
    linked_projects: list[str] = []


class NotebookCellEdit(BaseModel):
    index: int
    source: str


class NotebookSaveRequest(BaseModel):
    """The cells whose text changed, to commit over the version ``sha``."""

    branch: str = Field(min_length=1)
    notebook_path: str = Field(min_length=1)
    sha: str = Field(min_length=1)
    message: str = Field(default="", max_length=200)
    cells: list[NotebookCellEdit]


class NotebookSaveResponse(BaseModel):
    commit_sha: str
    #: The file's new blob SHA, for the next save.
    sha: str
    changed_cells: int


# ---------------------------------------------------------------------------
# Datasets (MinIO)
# ---------------------------------------------------------------------------

class UploadStatusResponse(BaseModel):
    """An uploaded file, and how far it has got through the layers.

    The upload request returns as soon as the file is stored; the worker then
    carries it through bronze, silver and gold. This is what lets the page say
    which of those it has reached, instead of "uploaded" and then nothing.
    """

    dataset_id: int
    name: str
    size_bytes: int
    created_at: datetime
    #: ``queued`` until the worker picks it up, then ``running``, ``success`` or ``failed``.
    status: str
    error: str = ""
    #: Rows read from the file into bronze, and rows the cleaning kept in silver.
    rows_in: int | None = None
    rows_kept: int | None = None
    #: The stream it landed in — the upload's name in the layers.
    source_id: int | None = None
    source_name: str = ""


class DatasetResponse(BaseModel):
    """Dataset read representation."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
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
