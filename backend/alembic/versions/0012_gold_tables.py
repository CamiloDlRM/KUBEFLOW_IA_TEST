"""The table a project publishes, defined by a query over silver.

Until now the dataset a pipeline trained on was whatever the last extraction
produced — which, once silver started accumulating, would have meant training
on the newest slice alone. A project's data is the whole of its silver, and
with several sources it is a *join* across them, so the trainable table has to
be something built rather than something picked.

``sql`` empty means the project has not written a definition and gets the
default: everything its sources have landed, stacked by column name. Stored as
emptiness rather than as generated SQL, so that connecting another source
changes the table without anyone having to remember to edit it.

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-11
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def _json_type():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.JSONB(astext_type=sa.Text())
    return sa.JSON()


def upgrade() -> None:
    bind = op.get_bind()
    if "gold_tables" in sa.inspect(bind).get_table_names():
        return

    op.create_table(
        "gold_tables",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("repo_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False, server_default="gold"),
        sa.Column("sql", sa.Text(), nullable=False, server_default=""),
        sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("bucket", sa.String(), nullable=False, server_default=""),
        sa.Column("object_key", sa.String(), nullable=False, server_default=""),
        sa.Column("rows", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("columns", _json_type(), nullable=True),
        sa.Column("relations", _json_type(), nullable=True),
        sa.Column("built_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("build_error", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["repo_id"], ["repositories.id"]),
    )
    op.create_index("ix_gold_tables_repo_id", "gold_tables", ["repo_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if "gold_tables" not in sa.inspect(bind).get_table_names():
        return
    op.drop_index("ix_gold_tables_repo_id", table_name="gold_tables")
    op.drop_table("gold_tables")
