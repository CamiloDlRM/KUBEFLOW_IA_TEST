"""Let a data source store its own password, encrypted.

Revision ID: 0022
Revises: 0021
"""
import sqlalchemy as sa
from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "password_encrypted" not in {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns("data_sources")
    }:
        op.add_column(
            "data_sources",
            sa.Column("password_encrypted", sa.String(), nullable=False, server_default=""),
        )


def downgrade() -> None:
    op.drop_column("data_sources", "password_encrypted")
