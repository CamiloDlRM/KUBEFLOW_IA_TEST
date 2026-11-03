"""Let a project decide when its model deploys, and a run take parameters.

- ``projects.deploy_policy``: auto-deploy on or off, the metric that decides,
  its bar and direction, and whether a new version must beat the one serving.
  ``{}`` means the platform's defaults, which is how every existing project
  keeps deploying exactly as before.
- ``pipelines.parameters``: the training parameters the run was launched with,
  injected into the notebook. Kept on the run so a version can say what it
  was trained with.

Revision ID: 0026
Revises: 0025
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def _json_type():
    if op.get_bind().dialect.name == "postgresql":
        return postgresql.JSONB(astext_type=sa.Text())
    return sa.JSON()


_COLUMNS = (("projects", "deploy_policy"), ("pipelines", "parameters"))


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table, column in _COLUMNS:
        if column in {c["name"] for c in inspector.get_columns(table)}:
            continue
        op.add_column(
            table,
            sa.Column(column, _json_type(), nullable=True, server_default=sa.text("'{}'")),
        )


def downgrade() -> None:
    for table, column in reversed(_COLUMNS):
        op.drop_column(table, column)
