"""Record calls to language models from projects that hold health data.

``llm_egress``: agent, provider, model, characters sent and what was
withheld. General projects are not recorded. See ``core.llm_egress``.

Revision ID: 0031
Revises: 0030
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def _json_type():
    if op.get_bind().dialect.name == "postgresql":
        return postgresql.JSONB(astext_type=sa.Text())
    return sa.JSON()


def upgrade() -> None:
    if "llm_egress" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "llm_egress",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), nullable=True),
        sa.Column("agent", sa.String(), nullable=False, server_default=""),
        sa.Column("provider", sa.String(), nullable=False, server_default=""),
        sa.Column("model", sa.String(), nullable=False, server_default=""),
        sa.Column("sent_chars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("withheld", _json_type(), nullable=True, server_default=sa.text("'{}'")),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_llm_egress_project_id", "llm_egress", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_llm_egress_project_id", table_name="llm_egress")
    op.drop_table("llm_egress")
