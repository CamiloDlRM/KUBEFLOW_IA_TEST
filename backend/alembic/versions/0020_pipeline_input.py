"""Let a repository choose what its pipeline trains on, and runs record it.

Until now a run mounted the project's active dataset — whatever had last been
uploaded or built — and kept no note of which that was. Three columns:

- ``repositories.pipeline_input``: the choice (a layer, and a source or a gold
  version). Empty keeps the old behaviour.
- ``pipelines.mounted_input``: what the choice resolved to for that run.
- ``pipelines.cells``: the notebook's code as the run had it, with each cell's
  phase and output, so the pipeline view can show what ran in each phase.

The defaults are written into the existing rows rather than left NULL, because
the API reads these as a dict and a list, and a NULL from a row made before
this migration would fail a response that has nothing wrong with it.

Revision ID: 0020
Revises: 0019
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def _json_type():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.JSONB(astext_type=sa.Text())
    return sa.JSON()


_COLUMNS = (
    ("repositories", "pipeline_input", "'{}'"),
    ("pipelines", "mounted_input", "'{}'"),
    ("pipelines", "cells", "'[]'"),
)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table, column, default in _COLUMNS:
        if column in {existing["name"] for existing in inspector.get_columns(table)}:
            continue
        op.add_column(
            table,
            sa.Column(column, _json_type(), nullable=True, server_default=sa.text(default)),
        )


def downgrade() -> None:
    for table, column, _default in reversed(_COLUMNS):
        op.drop_column(table, column)
