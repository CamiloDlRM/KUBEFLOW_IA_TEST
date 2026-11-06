"""Every registered run is a version of its model, deployed or not.

Until now a model's versions were its deployment rows, and a run only got
one by clearing the auto-deploy bar. A run that trained and registered a
perfectly good artifact at 0.79 accuracy, under a 0.80 threshold, existed in
MLflow and nowhere a person could pick it from. Three columns on the run make
it a version in its own right:

- ``model_name`` and ``model_version``: what the run trained, numbered at
  validation;
- ``mlflow_run_id``: where its artifact is, once registered.

Existing runs that were deployed are backfilled from their deployment row, so
the history a model already has stays pickable. Runs that never deployed have
no record of which model they were, and stay out.

Revision ID: 0025
Revises: 0024
"""
import sqlalchemy as sa
from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None

_COLUMNS = ("model_name", "model_version", "mlflow_run_id")


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("pipelines")}
    for column in _COLUMNS:
        if column not in existing:
            op.add_column(
                "pipelines",
                sa.Column(column, sa.String(), nullable=False, server_default=""),
            )
    if "ix_pipelines_model_name" not in {
        i["name"] for i in sa.inspect(op.get_bind()).get_indexes("pipelines")
    }:
        op.create_index("ix_pipelines_model_name", "pipelines", ["model_name"])

    # Portable on purpose (no UPDATE ... FROM): the same statement runs on
    # Postgres and on the SQLite the tests migrate.
    for column, source in (
        ("model_name", "model_name"),
        ("model_version", "version"),
        ("mlflow_run_id", "mlflow_run_id"),
    ):
        op.execute(
            f"""
            UPDATE pipelines SET {column} = COALESCE((
                SELECT md.{source} FROM model_deployments md
                WHERE md.pipeline_id = pipelines.id
                ORDER BY md.deployed_at DESC LIMIT 1
            ), '')
            WHERE {column} = ''
              AND EXISTS (SELECT 1 FROM model_deployments md WHERE md.pipeline_id = pipelines.id)
            """
        )


def downgrade() -> None:
    op.drop_index("ix_pipelines_model_name", table_name="pipelines")
    for column in reversed(_COLUMNS):
        op.drop_column("pipelines", column)
