"""Branch-aware pipeline runs, insight apply tracking, and mlflow_run_id.

- pipelines.branch: branch the run was launched from (empty = repo default)
- model_deployments.mlflow_run_id: real MLflow run id, needed to reload the
  model into the model-server after a restart (and for rollback)
- pipeline_insights.apply_*: state of "push AI suggestions to a branch"

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-16
"""
import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns(table)]
    return column in cols


def upgrade() -> None:
    if not _column_exists("pipelines", "branch"):
        op.add_column(
            "pipelines",
            sa.Column("branch", sa.String, nullable=False, server_default=""),
        )

    if not _column_exists("model_deployments", "mlflow_run_id"):
        op.add_column(
            "model_deployments",
            sa.Column("mlflow_run_id", sa.String, nullable=False, server_default=""),
        )

    for column in ("apply_status", "apply_error", "apply_branch", "apply_commit_sha"):
        if not _column_exists("pipeline_insights", column):
            default = "none" if column == "apply_status" else ""
            op.add_column(
                "pipeline_insights",
                sa.Column(column, sa.String, nullable=False, server_default=default),
            )


def downgrade() -> None:
    op.drop_column("pipelines", "branch")
    op.drop_column("model_deployments", "mlflow_run_id")
    for column in ("apply_status", "apply_error", "apply_branch", "apply_commit_sha"):
        op.drop_column("pipeline_insights", column)
