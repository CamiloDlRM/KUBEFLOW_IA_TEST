"""Add role to users and create invite_tokens table.

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add role column to existing users (default everyone to 'member')
    op.add_column(
        "users",
        sa.Column("role", sa.String, nullable=False, server_default="member"),
    )

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
