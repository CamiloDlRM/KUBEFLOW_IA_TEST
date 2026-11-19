"""Health data: legal basis, pseudonymisation key, and what was protected.

``projects.privacy`` (classification, legal basis, policy, protection state),
``projects.pseudonym_key`` (Fernet-encrypted), and ``datasets.privacy`` /
``ingestion_runs.privacy`` recording what was suppressed before a file landed.
Every existing project stays general. See ``core.privacy``.

Revision ID: 0030
Revises: 0029
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def _json_type():
    if op.get_bind().dialect.name == "postgresql":
        return postgresql.JSONB(astext_type=sa.Text())
    return sa.JSON()


def _has(table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    for table in ("projects", "datasets", "ingestion_runs"):
        if not _has(table, "privacy"):
            op.add_column(table, sa.Column("privacy", _json_type(), nullable=True, server_default=sa.text("'{}'")))
    if not _has("projects", "pseudonym_key"):
        op.add_column("projects", sa.Column("pseudonym_key", sa.String(), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("projects", "pseudonym_key")
    for table in ("ingestion_runs", "datasets", "projects"):
        op.drop_column(table, "privacy")
