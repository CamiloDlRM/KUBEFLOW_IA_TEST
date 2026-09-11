"""Give every dataset an origin and a profile, whichever path produced it.

Until now an uploaded dataset and an extracted one were different objects in
practice: the extraction produced a column profile, the upload produced
nothing. Unifying the two entry points in the UI without unifying their output
would have meant two kinds of dataset wearing the same name.

Also adds the normalisation settings a source may carry, and the summary of
what normalisation achieved on each run.

Existing rows are backfilled to origin='upload', which is what they are.

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-11
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    existing = _columns("datasets")

    if "origin" not in existing:
        op.add_column(
            "datasets",
            sa.Column("origin", sa.String(), nullable=False, server_default="upload"),
        )
    if "ingestion_run_id" not in existing:
        op.add_column("datasets", sa.Column("ingestion_run_id", sa.String(), nullable=True))
        op.create_index(
            "ix_datasets_ingestion_run_id", "datasets", ["ingestion_run_id"]
        )
    if "profile" not in existing:
        op.add_column(
            "datasets",
            sa.Column(
                "profile",
                postgresql.JSON(astext_type=sa.Text()),
                nullable=False,
                server_default="{}",
            ),
        )
    if "profiled_rows" not in existing:
        op.add_column(
            "datasets",
            sa.Column("profiled_rows", sa.Integer(), nullable=False, server_default="0"),
        )

    source_columns = _columns("data_sources")
    for column in ("normalize_text_column", "normalize_code_column"):
        if column not in source_columns:
            op.add_column(
                "data_sources",
                sa.Column(column, sa.String(), nullable=False, server_default=""),
            )

    if "normalization" not in _columns("ingestion_runs"):
        op.add_column(
            "ingestion_runs",
            sa.Column(
                "normalization",
                postgresql.JSON(astext_type=sa.Text()),
                nullable=False,
                server_default="{}",
            ),
        )


def downgrade() -> None:
    if "normalization" in _columns("ingestion_runs"):
        op.drop_column("ingestion_runs", "normalization")

    source_columns = _columns("data_sources")
    for column in ("normalize_code_column", "normalize_text_column"):
        if column in source_columns:
            op.drop_column("data_sources", column)

    existing = _columns("datasets")
    if "profiled_rows" in existing:
        op.drop_column("datasets", "profiled_rows")
    if "profile" in existing:
        op.drop_column("datasets", "profile")
    if "ingestion_run_id" in existing:
        op.drop_index("ix_datasets_ingestion_run_id", table_name="datasets")
        op.drop_column("datasets", "ingestion_run_id")
    if "origin" in existing:
        op.drop_column("datasets", "origin")
