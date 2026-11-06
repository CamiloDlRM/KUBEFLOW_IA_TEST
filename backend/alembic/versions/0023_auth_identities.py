"""Sign-in identities: GitHub OAuth or a manual GitHub token.

Existing users become ``<name>@t`` with a ``token`` identity (no token yet).
Existing repositories are untouched: ``uses_owner_token`` defaults to false, so
they keep using the token they were registered with.

Revision ID: 0023
Revises: 0022
"""
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "auth_providers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(), nullable=False, unique=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("username_suffix", sa.String(), nullable=False),
    )
    op.create_table(
        "user_identities",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("provider_id", sa.Integer(), sa.ForeignKey("auth_providers.id"), nullable=False),
        sa.Column("provider_user_id", sa.String(), nullable=True, index=True),
        sa.Column("github_token_encrypted", sa.String(), nullable=False, server_default=""),
        sa.Column("github_token_masked", sa.String(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("provider_id", "provider_user_id"),
    )
    op.add_column(
        "users",
        sa.Column("needs_password", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "repositories",
        sa.Column("uses_owner_token", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    bind = op.get_bind()
    bind.execute(
        sa.text(
            "INSERT INTO auth_providers (id, code, name, username_suffix) VALUES "
            "(1, 'github', 'GitHub', '@g'), (2, 'token', 'GitHub token', '@t')"
        )
    )
    bind.execute(
        sa.text("UPDATE users SET username = username || '@t' WHERE username NOT LIKE '%@t'")
    )
    bind.execute(
        sa.text(
            "INSERT INTO user_identities (user_id, provider_id, created_at, updated_at) "
            "SELECT id, 2, :now, :now FROM users"
        ),
        {"now": datetime.now(timezone.utc)},
    )


def downgrade() -> None:
    op.drop_column("repositories", "uses_owner_token")
    op.drop_column("users", "needs_password")
    op.drop_table("user_identities")
    op.drop_table("auth_providers")
