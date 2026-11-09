"""Link a notebook to a project, not a whole repository.

The unit a project trains with is one notebook on one branch. Hanging the link
off the repository meant a repository could serve one project only, and that
project's notebook choice was written onto the repository itself.

The link moves to the project (``repo_id``, ``branch``, ``notebook_path``), so
several projects can each pick their own notebook from the same repository.
Each pipeline also records the project and notebook it ran, fixed at launch.

The repository's old columns are dropped rather than left behind, for the same
reason 0015 dropped ``repo_id``: a second answer to "which notebook does this
project run" would silently diverge from the first.

Revision ID: 0019
Revises: 0018
"""
import sqlalchemy as sa
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()

    if "repo_id" not in _columns("projects"):
        op.add_column("projects", sa.Column("repo_id", sa.Integer(), nullable=True))
        op.add_column(
            "projects", sa.Column("branch", sa.String(), nullable=False, server_default="main")
        )
        op.add_column(
            "projects", sa.Column("notebook_path", sa.String(), nullable=False, server_default="")
        )
        op.create_index("ix_projects_repo_id", "projects", ["repo_id"])
        # Same trade as 0014: SQLite cannot add a constraint without a rebuild.
        if bind.dialect.name == "postgresql":
            op.create_foreign_key(
                "fk_projects_repo_id", "projects", "repositories", ["repo_id"], ["id"]
            )

    if "project_id" not in _columns("pipelines"):
        op.add_column("pipelines", sa.Column("project_id", sa.Integer(), nullable=True))
        op.add_column(
            "pipelines", sa.Column("notebook_path", sa.String(), nullable=False, server_default="")
        )
        op.create_index("ix_pipelines_project_id", "pipelines", ["project_id"])
        if bind.dialect.name == "postgresql":
            op.create_foreign_key(
                "fk_pipelines_project_id", "pipelines", "projects", ["project_id"], ["id"]
            )

    if "project_id" not in _columns("repositories"):
        return

    # Until now a repository sat in at most one project, so each project has
    # at most one repository to take its link from.
    op.execute(
        "UPDATE projects SET "
        "repo_id = (SELECT r.id FROM repositories r WHERE r.project_id = projects.id), "
        "branch = COALESCE((SELECT r.branch FROM repositories r "
        "  WHERE r.project_id = projects.id), 'main'), "
        "notebook_path = COALESCE((SELECT r.notebook_path FROM repositories r "
        "  WHERE r.project_id = projects.id), '') "
        "WHERE EXISTS (SELECT 1 FROM repositories r WHERE r.project_id = projects.id)"
    )
    # Old runs did not record their notebook; the repository's current one is
    # the best answer there is, and the one the worker would have used.
    op.execute(
        "UPDATE pipelines SET "
        "project_id = (SELECT r.project_id FROM repositories r WHERE r.id = pipelines.repo_id), "
        "notebook_path = COALESCE((SELECT r.notebook_path FROM repositories r "
        "  WHERE r.id = pipelines.repo_id), '')"
    )

    if "ix_repositories_project_id" in _indexes("repositories"):
        op.drop_index("ix_repositories_project_id", table_name="repositories")
    with op.batch_alter_table("repositories") as batch:
        batch.drop_column("project_id")
        batch.drop_column("branch")
        batch.drop_column("notebook_path")


def downgrade() -> None:
    op.add_column("repositories", sa.Column("project_id", sa.Integer(), nullable=True))
    op.add_column(
        "repositories", sa.Column("branch", sa.String(), nullable=False, server_default="main")
    )
    op.add_column(
        "repositories", sa.Column("notebook_path", sa.String(), nullable=False, server_default="")
    )
    op.create_index("ix_repositories_project_id", "repositories", ["project_id"])
    # Lossy by nature: a repository holds one link, so where several projects
    # share it the lowest project id wins.
    op.execute(
        "UPDATE repositories SET "
        "project_id = (SELECT MIN(p.id) FROM projects p WHERE p.repo_id = repositories.id), "
        "branch = COALESCE((SELECT p.branch FROM projects p WHERE p.id = "
        "  (SELECT MIN(q.id) FROM projects q WHERE q.repo_id = repositories.id)), 'main'), "
        "notebook_path = COALESCE((SELECT p.notebook_path FROM projects p WHERE p.id = "
        "  (SELECT MIN(q.id) FROM projects q WHERE q.repo_id = repositories.id)), '')"
    )

    op.drop_index("ix_pipelines_project_id", table_name="pipelines")
    with op.batch_alter_table("pipelines") as batch:
        batch.drop_column("project_id")
        batch.drop_column("notebook_path")
    op.drop_index("ix_projects_repo_id", table_name="projects")
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("repo_id")
        batch.drop_column("branch")
        batch.drop_column("notebook_path")
