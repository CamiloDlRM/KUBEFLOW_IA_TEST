"""Give repositories an owner so members only see their own resources.

Until now every authenticated user could list and manage every repository —
and therefore every pipeline, dataset, deployment and insight derived from it.
This adds repositories.owner_id and backfills existing rows to the first admin
so nothing becomes orphaned (and invisible) after the upgrade.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-10
"""
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    return column in [c["name"] for c in sa.inspect(bind).get_columns(table)]


def upgrade() -> None:
    if not _column_exists("repositories", "owner_id"):
        # The foreign key is added only where a database can add one to an
        # existing table. SQLite cannot ALTER in a constraint — it needs the
        # table rebuilt — and does not enforce foreign keys unless asked to,
        # so declaring one there buys nothing and made the whole migration
        # chain impossible to run outside Postgres. Which is why, for a long
        # time, nothing ran it: see tests/test_migrations.py.
        constraints: list[Any] = []
        if op.get_bind().dialect.name == "postgresql":
            constraints.append(sa.ForeignKey("users.id"))

        op.add_column(
            "repositories",
            sa.Column("owner_id", sa.Integer, *constraints, nullable=True),
        )
        op.create_index(
            "ix_repositories_owner_id", "repositories", ["owner_id"], unique=False
        )

    # Backfill: adopt pre-existing repositories into the first admin account.
    # Without this they would have owner_id NULL and disappear from every
    # member's view after the upgrade.
    bind = op.get_bind()
    admin_id = bind.execute(
        sa.text("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
    ).scalar()
    if admin_id is not None:
        bind.execute(
            sa.text(
                "UPDATE repositories SET owner_id = :admin_id WHERE owner_id IS NULL"
            ),
            {"admin_id": admin_id},
        )


def downgrade() -> None:
    op.drop_index("ix_repositories_owner_id", table_name="repositories")
    op.drop_column("repositories", "owner_id")
