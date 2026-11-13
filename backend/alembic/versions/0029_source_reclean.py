"""Record when a source's silver was cleaned again with its current recipe.

``data_sources.reclean``: status, when, how many extractions and the gold
version produced, or the error. ``{}`` until a source is first re-cleaned.
See ``tasks.celery_tasks.reclean_source``.

Revision ID: 0029
Revises: 0028
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def _json_type():
    if op.get_bind().dialect.name == "postgresql":
        return postgresql.JSONB(astext_type=sa.Text())
    return sa.JSON()


def upgrade() -> None:
    if "reclean" in {c["name"] for c in sa.inspect(op.get_bind()).get_columns("data_sources")}:
        return
    op.add_column(
        "data_sources",
        sa.Column("reclean", _json_type(), nullable=True, server_default=sa.text("'{}'")),
    )


def downgrade() -> None:
    op.drop_column("data_sources", "reclean")
