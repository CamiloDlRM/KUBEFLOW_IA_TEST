"""Add external data sources and their ingestion runs.

The platform used to begin with a CSV somebody uploaded by hand. These two
tables put the step before that inside the system: a `data_sources` row names
an external database, a query and a watermark column, and each `ingestion_runs`
row records one incremental extraction from it.

Note that `data_sources` stores `password_env` — the *name* of an environment
variable — and never a password. A dump of this table discloses no credential,
and rotating one needs no write here.

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-11
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def _table_exists(name: str) -> bool:
    bind = op.get_bind()
    return name in sa.inspect(bind).get_table_names()


def upgrade() -> None:
    if not _table_exists("data_sources"):
        op.create_table(
            "data_sources",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("repo_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(), nullable=False, server_default=""),
            sa.Column("kind", sa.String(), nullable=False, server_default="postgres"),
            sa.Column("host", sa.String(), nullable=False, server_default=""),
            sa.Column("port", sa.Integer(), nullable=False, server_default="5432"),
            sa.Column("database", sa.String(), nullable=False, server_default=""),
            sa.Column("username", sa.String(), nullable=False, server_default=""),
            # The name of an environment variable, never a secret.
            sa.Column("password_env", sa.String(), nullable=False, server_default=""),
            sa.Column("extraction_sql", sa.Text(), nullable=False, server_default=""),
            sa.Column("watermark_column", sa.String(), nullable=False, server_default=""),
            sa.Column("watermark_value", sa.String(), nullable=False, server_default=""),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.ForeignKeyConstraint(["repo_id"], ["repositories.id"]),
        )
        op.create_index("ix_data_sources_repo_id", "data_sources", ["repo_id"])

    if not _table_exists("ingestion_runs"):
        op.create_table(
            "ingestion_runs",
            sa.Column("id", sa.String(), primary_key=True, nullable=False),
            sa.Column("source_id", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(), nullable=False, server_default="queued"),
            sa.Column("watermark_before", sa.String(), nullable=False, server_default=""),
            sa.Column("watermark_after", sa.String(), nullable=False, server_default=""),
            sa.Column("rows_extracted", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("dataset_id", sa.Integer(), nullable=True),
            sa.Column(
                "profile",
                postgresql.JSON(astext_type=sa.Text()),
                nullable=False,
                server_default="{}",
            ),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("error", sa.Text(), nullable=False, server_default=""),
            sa.ForeignKeyConstraint(["source_id"], ["data_sources.id"]),
            sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"]),
        )
        op.create_index("ix_ingestion_runs_source_id", "ingestion_runs", ["source_id"])


def downgrade() -> None:
    if _table_exists("ingestion_runs"):
        op.drop_index("ix_ingestion_runs_source_id", table_name="ingestion_runs")
        op.drop_table("ingestion_runs")
    if _table_exists("data_sources"):
        op.drop_index("ix_data_sources_repo_id", table_name="data_sources")
        op.drop_table("data_sources")
