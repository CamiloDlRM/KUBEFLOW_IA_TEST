"""Record where each run landed in bronze and silver, and what changed between.

Before this, an extraction produced one file: a normalised CSV, plus an archive
of the same rows before normalisation. That is the shape of the medallion
already, without the guarantees — the two files lived in the same bucket as
uploaded datasets, the "clean" one had no report saying what cleaning meant,
and both were CSV, so the types silver claims to have inferred survived only as
an assertion nobody could check.

Three columns, one per missing guarantee: where bronze is, where silver is, and
what the cleaning standard did between them.

``raw_object_key`` is left in place rather than renamed to ``bronze_key``. The
values are not the same thing: a pre-medallion archive sits in the datasets
bucket and a bronze object sits in the bronze bucket, so renaming the column
would leave old rows pointing confidently at a key that does not exist there.
Nothing writes it any more.

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-11
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _json_type():
    """JSONB on Postgres, JSON elsewhere (the test suite runs on SQLite)."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.JSONB(astext_type=sa.Text())
    return sa.JSON()


def upgrade() -> None:
    existing = _columns("ingestion_runs")
    for name in ("bronze_key", "silver_key"):
        if name not in existing:
            op.add_column(
                "ingestion_runs",
                sa.Column(name, sa.String(), nullable=False, server_default=""),
            )
    if "quality_report" not in existing:
        op.add_column(
            "ingestion_runs",
            sa.Column("quality_report", _json_type(), nullable=True),
        )


def downgrade() -> None:
    existing = _columns("ingestion_runs")
    for name in ("quality_report", "silver_key", "bronze_key"):
        if name in existing:
            op.drop_column("ingestion_runs", name)
