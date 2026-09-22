"""The conversation with the dashboard agent.

A dashboard is not made in one prompt. The first asks for something, the second
moves a chart, the third says the split is wrong — and each of those only means
anything if the model knows what it already built. Without somewhere to keep
the exchange, every request starts from nothing and "edit the dashboard" is not
a thing the user can ask for.

What is kept is the exchange, not the model's internal conversation: the
request in the user's words and the account it gave of what it did, plus the
tool calls so a dashboard that came out wrong can be read as the sequence that
produced it.

Revision ID: 0016
Revises: 0015
Create Date: 2026-09-22
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def _json_type():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.JSONB(astext_type=sa.Text())
    return sa.JSON()


def upgrade() -> None:
    bind = op.get_bind()
    if "kpi_turns" in sa.inspect(bind).get_table_names():
        return

    columns = [
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False, server_default=""),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("calls", _json_type(), nullable=False, server_default="[]"),
        sa.Column("turns", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "exhausted", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    ]
    # SQLite cannot add a foreign key after the fact, and the tests run on it,
    # so the constraint is declared inline where it is supported and left off
    # where it is not — the same shape the earlier migrations settled on.
    if bind.dialect.name == "postgresql":
        columns.append(
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE")
        )

    op.create_table("kpi_turns", *columns)
    op.create_index("ix_kpi_turns_project_id", "kpi_turns", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_kpi_turns_project_id", table_name="kpi_turns")
    op.drop_table("kpi_turns")
