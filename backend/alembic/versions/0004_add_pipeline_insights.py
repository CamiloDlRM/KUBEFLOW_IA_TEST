"""Create pipeline_insights table for AI advisor reports.

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-16
"""
import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def _table_exists(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def upgrade() -> None:
    if not _table_exists("pipeline_insights"):
        op.create_table(
            "pipeline_insights",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column(
                "pipeline_id",
                sa.String,
                sa.ForeignKey("pipelines.id"),
                nullable=False,
                index=True,
            ),
            sa.Column("status", sa.String, nullable=False, server_default="pending"),
            sa.Column("content", sa.Text, nullable=False, server_default=""),
            sa.Column("model", sa.String, nullable=False, server_default=""),
            sa.Column("error", sa.String, nullable=False, server_default=""),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    op.drop_table("pipeline_insights")
