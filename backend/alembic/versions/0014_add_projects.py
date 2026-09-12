"""Give the work a container that does not require a GitHub URL first.

Everything hung off a repository, which imposed an order the work does not
have: you needed a repository before you could connect a database, even though
getting the data right is usually what comes first and takes longest. A project
owns the data; a repository is code it may later link.

Every existing repository gets a project of its own, named from its URL and
carrying its owner, so nothing that exists changes hands or becomes invisible.
One project per repository rather than one shared project: merging them would
be a guess about which repositories belonged together, and an unmergeable one.

``repositories.owner_id`` stays. The project is where ownership is decided from
here, but that column is the form every existing route reads, and rewriting the
multi-tenancy rules in the same migration that introduces the table they now
depend on is not a trade worth making. They are kept equal.

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-12
"""
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _as_datetime(value: object) -> datetime:
    """Return a timestamp read back from any driver as a datetime.

    Postgres hands back a ``datetime``; SQLite hands back the text it stored.
    The project inherits its repository's creation time so a migrated list
    sorts the way its owner remembers, and that is worth one coercion.
    """
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _name_from_url(url: str) -> str:
    """Turn a GitHub URL into something a person would recognise in a list."""
    cleaned = (url or "").rstrip("/").removesuffix(".git")
    tail = cleaned.rsplit("/", 1)[-1] if "/" in cleaned else cleaned
    return tail or "Project"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "projects" not in inspector.get_table_names():
        op.create_table(
            "projects",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("owner_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        )
        op.create_index("ix_projects_owner_id", "projects", ["owner_id"])
        op.create_index("ix_projects_name", "projects", ["name"])

    if "project_id" not in _columns("repositories"):
        op.add_column(
            "repositories", sa.Column("project_id", sa.Integer(), nullable=True)
        )
        op.create_index(
            "ix_repositories_project_id", "repositories", ["project_id"]
        )
        # SQLite cannot ALTER a table to add a constraint — it would need the
        # copy-and-move dance, and rebuilding the repositories table to gain a
        # constraint SQLite does not enforce unless asked is a poor trade. The
        # column and its index are what the application reads; the declared
        # relationship is enforced where enforcement happens.
        if bind.dialect.name == "postgresql":
            op.create_foreign_key(
                "fk_repositories_project_id",
                "repositories",
                "projects",
                ["project_id"],
                ["id"],
            )

    # Adopt every existing repository into a project of its own.
    #
    # Reflected rather than addressed with raw SQL: the new row's id is needed
    # to point the repository at it, and only an insert() construct over a
    # table that knows its primary key can report one. A text() INSERT cannot,
    # whatever the database — which is how the first version of this got as far
    # as a deployment before failing.
    projects = sa.Table("projects", sa.MetaData(), autoload_with=bind)

    rows = bind.execute(
        sa.text(
            "SELECT id, github_url, owner_id, created_at FROM repositories "
            "WHERE project_id IS NULL"
        )
    ).fetchall()
    for repo_id, github_url, owner_id, created_at in rows:
        result = bind.execute(
            projects.insert().values(
                name=_name_from_url(github_url),
                description="",
                owner_id=owner_id,
                created_at=_as_datetime(created_at),
                is_active=True,
            )
        )
        bind.execute(
            sa.text("UPDATE repositories SET project_id = :pid WHERE id = :rid"),
            {"pid": result.inserted_primary_key[0], "rid": repo_id},
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "project_id" in _columns("repositories"):
        if bind.dialect.name == "postgresql":
            op.drop_constraint(
                "fk_repositories_project_id", "repositories", type_="foreignkey"
            )
        op.drop_index("ix_repositories_project_id", table_name="repositories")
        op.drop_column("repositories", "project_id")

    if "projects" in inspector.get_table_names():
        op.drop_index("ix_projects_name", table_name="projects")
        op.drop_index("ix_projects_owner_id", table_name="projects")
        op.drop_table("projects")
