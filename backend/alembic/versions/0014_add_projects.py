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
import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


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
        op.create_foreign_key(
            "fk_repositories_project_id", "repositories", "projects", ["project_id"], ["id"]
        )

    # Adopt every existing repository into a project of its own.
    rows = bind.execute(
        sa.text(
            "SELECT id, github_url, owner_id, created_at FROM repositories "
            "WHERE project_id IS NULL"
        )
    ).fetchall()
    for repo_id, github_url, owner_id, created_at in rows:
        result = bind.execute(
            sa.text(
                "INSERT INTO projects (name, description, owner_id, created_at, is_active) "
                "VALUES (:name, :description, :owner_id, :created_at, :is_active)"
            ),
            {
                "name": _name_from_url(github_url),
                "description": "",
                "owner_id": owner_id,
                "created_at": created_at,
                "is_active": True,
            },
        )
        project_id = result.inserted_primary_key[0] if result.inserted_primary_key else None
        if project_id is None:
            project_id = bind.execute(
                sa.text("SELECT max(id) FROM projects")
            ).scalar()
        bind.execute(
            sa.text("UPDATE repositories SET project_id = :pid WHERE id = :rid"),
            {"pid": project_id, "rid": repo_id},
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
