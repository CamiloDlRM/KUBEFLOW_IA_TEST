"""Initial schema: users, repositories, pipelines, model_deployments.

Revision ID: 0001
Revises:
Create Date: 2026-04-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("username", sa.String, nullable=False, unique=True, index=True),
        sa.Column("hashed_password", sa.String, nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "repositories",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("github_url", sa.String, nullable=False, index=True),
        sa.Column("github_token_masked", sa.String, nullable=False, server_default=""),
        sa.Column("branch", sa.String, nullable=False, server_default="main"),
        sa.Column("notebook_path", sa.String, nullable=False),
        sa.Column("webhook_id", sa.Integer, nullable=True),
        sa.Column("webhook_url", sa.String, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
    )

    op.create_table(
        "pipelines",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("repo_id", sa.Integer, sa.ForeignKey("repositories.id"), nullable=False),
        sa.Column("status", sa.String, nullable=False, server_default="queued"),
        sa.Column("commit_sha", sa.String, nullable=False, server_default=""),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("phases", sa.JSON, nullable=False),
        sa.Column("metrics", sa.JSON, nullable=False),
    )

    op.create_table(
        "model_deployments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("model_name", sa.String, nullable=False, index=True),
        sa.Column("version", sa.String, nullable=False, server_default="1"),
        sa.Column("accuracy", sa.Float, nullable=False, server_default="0.0"),
        sa.Column("endpoint_url", sa.String, nullable=False, server_default=""),
        sa.Column("deployed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("pipeline_id", sa.String, sa.ForeignKey("pipelines.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("model_deployments")
    op.drop_table("pipelines")
    op.drop_table("repositories")
    op.drop_table("users")
