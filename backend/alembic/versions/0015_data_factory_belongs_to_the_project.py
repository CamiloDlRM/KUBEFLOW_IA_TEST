"""Move the data factory from the repository to the project.

0014 gave the work a container but left the data where it was, so a project
still borrowed its sources from whatever repository it had linked — and a
project with no repository had nowhere to put data at all, which is the one
thing the container was introduced to allow.

Sources, datasets and the gold table now belong to the project. The repository
keeps what is actually its own: the URL, the branch, the notebook, and the
pipeline runs that execute it.

Every row is moved through the link 0014 established, so nothing is orphaned:
a source that belonged to repository 3 now belongs to whichever project
repository 3 was adopted into. That mapping is one-to-one by construction,
which is why this can be a rename rather than a decision.

The old column is dropped rather than left nullable. A ``repo_id`` the models
no longer set would fail every insert on its NOT NULL constraint, and one made
nullable would sit there as a second, silently diverging answer to the question
of what a dataset belongs to.

Revision ID: 0015
Revises: 0014
Create Date: 2026-09-12
"""
import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

#: The three tables that make up a project's data factory.
_TABLES = ("data_sources", "datasets", "gold_tables")


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _indexes(table: str) -> set[str]:
    bind = op.get_bind()
    return {i["name"] for i in sa.inspect(bind).get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()

    for table in _TABLES:
        if "project_id" in _columns(table):
            continue

        op.add_column(table, sa.Column("project_id", sa.Integer(), nullable=True))

        # Follow the link 0014 made. A repository with no project would leave
        # its rows unowned, which cannot happen — 0014 adopts every one — but
        # the UPDATE says so rather than assuming it.
        op.execute(
            sa.text(
                f"UPDATE {table} SET project_id = ("
                "  SELECT r.project_id FROM repositories r WHERE r.id = "
                f"  {table}.repo_id"
                ")"
            )
        )

    # Dropping a column means rebuilding the table on SQLite, which is what
    # batch mode does. On Postgres it is a plain ALTER. Indexes on the old
    # column go first, because a rebuild that carries them forward would
    # recreate an index on a column that is about to stop existing.
    for table in _TABLES:
        if "repo_id" not in _columns(table):
            continue
        for index in _indexes(table):
            if index.endswith("repo_id"):
                op.drop_index(index, table_name=table)
        with op.batch_alter_table(table) as batch:
            batch.drop_column("repo_id")

    for table in _TABLES:
        if f"ix_{table}_project_id" not in _indexes(table):
            op.create_index(f"ix_{table}_project_id", table, ["project_id"])

    if bind.dialect.name == "postgresql":
        for table in _TABLES:
            op.create_foreign_key(
                f"fk_{table}_project_id", table, "projects", ["project_id"], ["id"]
            )


def downgrade() -> None:
    bind = op.get_bind()

    for table in _TABLES:
        if "repo_id" in _columns(table):
            continue
        op.add_column(table, sa.Column("repo_id", sa.Integer(), nullable=True))
        op.execute(
            sa.text(
                f"UPDATE {table} SET repo_id = ("
                "  SELECT r.id FROM repositories r WHERE r.project_id = "
                f"  {table}.project_id"
                ")"
            )
        )

    for table in _TABLES:
        if "project_id" not in _columns(table):
            continue
        if bind.dialect.name == "postgresql":
            op.drop_constraint(f"fk_{table}_project_id", table, type_="foreignkey")
        if f"ix_{table}_project_id" in _indexes(table):
            op.drop_index(f"ix_{table}_project_id", table_name=table)
        with op.batch_alter_table(table) as batch:
            batch.drop_column("project_id")
