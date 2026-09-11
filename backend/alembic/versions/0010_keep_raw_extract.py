"""Record where the pre-normalisation extract was archived.

Until now only the normalised copy was kept. Improving the normaliser then
meant re-extracting from the source — except the watermark had already moved
past those rows, so it meant winding it back by hand.

The raw extract is now stored alongside, and this column records where. It is
deliberately not a dataset: nothing should train on the un-normalised copy by
accident. Bronze to the normalised copy's silver.

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-11
"""
import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    if "raw_object_key" not in _columns("ingestion_runs"):
        op.add_column(
            "ingestion_runs",
            sa.Column("raw_object_key", sa.String(), nullable=False, server_default=""),
        )


def downgrade() -> None:
    if "raw_object_key" in _columns("ingestion_runs"):
        op.drop_column("ingestion_runs", "raw_object_key")
