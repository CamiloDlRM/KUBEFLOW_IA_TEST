"""Add role to users and create invite_tokens table.

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-14
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns(table)]
    return column in cols


def _table_exists(name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(name)


def upgrade() -> None:
    if not _column_exists("users", "role"):
        op.add_column(
            "users",
            sa.Column("role", sa.String, nullable=False, server_default="member"),
        )

    if not _table_exists("invite_tokens"):
        op.create_table(
            "invite_tokens",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("token", sa.String, nullable=False, unique=True, index=True),
            sa.Column("email", sa.String, nullable=True),
            sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
            sa.Column("used_by", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    op.drop_table("invite_tokens")
    op.drop_column("users", "role")
