"""Add email to users and create change_tokens table.

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-14
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns(table)]
    return column in cols


def _table_exists(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def upgrade() -> None:
    if not _column_exists("users", "email"):
        op.add_column("users", sa.Column("email", sa.String, nullable=True))

    if not _table_exists("change_tokens"):
        op.create_table(
            "change_tokens",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("token", sa.String, nullable=False, unique=True, index=True),
            sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
            sa.Column("change_type", sa.String, nullable=False),  # "password" | "username"
            sa.Column("new_value", sa.String, nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    op.drop_table("change_tokens")
    op.drop_column("users", "email")
