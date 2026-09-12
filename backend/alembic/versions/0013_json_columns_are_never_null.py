"""Give the runs' JSON columns the default every other one already had.

``0011`` added ``quality_report`` as ``nullable=True`` with no server default,
breaking the pattern ``0008`` and ``0009`` set for every other JSON column in
the schema — ``nullable=False, server_default='{}'``. Every run recorded before
the medallion existed therefore holds NULL, and the layer summary called
``.get`` on it. The deployment answered 500 for exactly one project: the only
one with a source old enough to have history.

It survived the test suite because every test that seeds a run seeds a report
alongside it. The rows that break this are the ones no test creates — the ones
that were already there.

This backfills the NULLs and applies the constraint, so the defence added in
the router and the response model is a belt to this braces rather than the only
thing standing between an old row and a 500.

``profile`` and ``normalization`` are included. ``profile`` was declared
correctly in ``0008`` and ``normalization`` was added by SQLModel's own
create_all on deployments that never ran ``0008``, so their state varies by how
a given database came to exist; making all three the same shape costs one
statement each and removes the question.

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-11
"""
import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

#: Every JSON column on ``ingestion_runs``. All mean "nothing recorded" when
#: empty, so none of them has any use for the difference between NULL and {}.
_COLUMNS = ("profile", "normalization", "quality_report")


def _existing() -> dict[str, dict]:
    bind = op.get_bind()
    return {c["name"]: c for c in sa.inspect(bind).get_columns("ingestion_runs")}


def upgrade() -> None:
    bind = op.get_bind()
    columns = _existing()

    for name in _COLUMNS:
        if name not in columns:
            continue
        op.execute(
            sa.text(f"UPDATE ingestion_runs SET {name} = '{{}}' WHERE {name} IS NULL")
        )
        # SQLite cannot ALTER a column's nullability, and the test suite runs on
        # it. The backfill above is the part that matters there; the constraint
        # is what stops the next NULL appearing, and only Postgres carries rows
        # old enough for that to be worth enforcing.
        if bind.dialect.name != "postgresql":
            continue
        op.alter_column(
            "ingestion_runs",
            name,
            nullable=False,
            server_default=sa.text("'{}'"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    columns = _existing()
    for name in _COLUMNS:
        if name in columns:
            op.alter_column("ingestion_runs", name, nullable=True, server_default=None)
