"""Keep what each trained model expects, for the test page.

``pipelines.model_card``: the model's inputs in order with their training
ranges, a baseline answer, and one sweep per input — built by the worker from
the features the notebook wrote. Written as ``{}`` into existing rows rather
than left NULL, so a run trained before cards reads as one without a card.

Revision ID: 0024
Revises: 0023
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def _json_type():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.JSONB(astext_type=sa.Text())
    return sa.JSON()


def upgrade() -> None:
    if "model_card" in {c["name"] for c in sa.inspect(op.get_bind()).get_columns("pipelines")}:
        return
    op.add_column(
        "pipelines",
        sa.Column("model_card", _json_type(), nullable=True, server_default=sa.text("'{}'")),
    )


def downgrade() -> None:
    op.drop_column("pipelines", "model_card")
