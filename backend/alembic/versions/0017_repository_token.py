"""Store repository GitHub credentials encrypted for later exploration.

Revision ID: 0017
Revises: 0016
"""
import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "github_token_encrypted" not in {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns("repositories")
    }:
        op.add_column(
            "repositories",
            sa.Column("github_token_encrypted", sa.String(), nullable=False, server_default=""),
        )


def downgrade() -> None:
    op.drop_column("repositories", "github_token_encrypted")
