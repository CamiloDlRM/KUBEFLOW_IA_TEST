"""Move the pipeline's input choice from the repository to the project.

0019 made the project the unit that links a notebook, so several projects may
share a repository; a choice of layer stored on the repository would then be
shared too, and each project trains on its own data. The choice is copied to
the project that links the repository's notebook, then dropped from it.

It also adds ``pipelines.requested_model_name`` when missing: a database that
came from ``dev`` has revision 0018 stamped for what is now 0020, so the
0018 that adds that column was never run on it.

Revision ID: 0021
Revises: 0020
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def _json_type():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.JSONB(astext_type=sa.Text())
    return sa.JSON()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if "requested_model_name" not in _columns("pipelines"):
        op.add_column("pipelines", sa.Column("requested_model_name", sa.String(), nullable=True))

    if "pipeline_input" not in _columns("projects"):
        op.add_column(
            "projects",
            sa.Column("pipeline_input", _json_type(), nullable=True, server_default=sa.text("'{}'")),
        )
    if "pipeline_input" in _columns("repositories"):
        op.execute(
            "UPDATE projects SET pipeline_input = (SELECT r.pipeline_input FROM repositories r "
            "WHERE r.id = projects.repo_id) "
            "WHERE repo_id IS NOT NULL AND EXISTS (SELECT 1 FROM repositories r "
            "WHERE r.id = projects.repo_id AND r.pipeline_input IS NOT NULL)"
        )
        with op.batch_alter_table("repositories") as batch:
            batch.drop_column("pipeline_input")


def downgrade() -> None:
    op.add_column(
        "repositories",
        sa.Column("pipeline_input", _json_type(), nullable=True, server_default=sa.text("'{}'")),
    )
    op.execute(
        "UPDATE repositories SET pipeline_input = (SELECT p.pipeline_input FROM projects p "
        "WHERE p.repo_id = repositories.id AND p.pipeline_input IS NOT NULL LIMIT 1) "
        "WHERE EXISTS (SELECT 1 FROM projects p WHERE p.repo_id = repositories.id "
        "AND p.pipeline_input IS NOT NULL)"
    )
    op.drop_column("projects", "pipeline_input")
