"""Record who viewed the rows of projects that hold health data.

``data_access_log``: user, whether as an administrator of someone else's
project, action, resource, rows shown. Append-only. See ``core.access_log``.

Revision ID: 0032
Revises: 0031
"""
import sqlalchemy as sa
from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "data_access_log" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "data_access_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("username", sa.String(), nullable=False, server_default=""),
        sa.Column("as_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("action", sa.String(), nullable=False, server_default=""),
        sa.Column("resource", sa.String(), nullable=False, server_default=""),
        sa.Column("rows", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_data_access_log_project_id", "data_access_log", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_data_access_log_project_id", table_name="data_access_log")
    op.drop_table("data_access_log")
