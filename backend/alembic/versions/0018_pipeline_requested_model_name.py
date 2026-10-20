"""Record the model name a user asked for when launching a run by hand.

Revision ID: 0018
Revises: 0017
"""
import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "requested_model_name" not in {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns("pipelines")
    }:
        op.add_column(
            "pipelines",
            sa.Column("requested_model_name", sa.String(), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("pipelines", "requested_model_name")
