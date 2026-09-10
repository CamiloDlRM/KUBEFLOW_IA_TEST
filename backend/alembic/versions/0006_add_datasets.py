"""Create the datasets table (MinIO-backed training datasets).

A dataset belongs to a repository; the pipeline downloads the repository's
active dataset and injects its local path as the DATASET_PATH papermill
parameter.

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-10
"""
import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def _table_exists(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def upgrade() -> None:
    if _table_exists("datasets"):
        return

    op.create_table(
        "datasets",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "repo_id",
            sa.Integer,
            sa.ForeignKey("repositories.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String, nullable=False, server_default=""),
        sa.Column("description", sa.String, nullable=False, server_default=""),
        sa.Column("bucket", sa.String, nullable=False, server_default=""),
        sa.Column("object_key", sa.String, nullable=False, server_default=""),
        sa.Column(
            "content_type",
            sa.String,
            nullable=False,
            server_default="application/octet-stream",
        ),
        sa.Column("size_bytes", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("checksum", sa.String, nullable=False, server_default=""),
        sa.Column(
            "uploaded_by", sa.Integer, sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "is_active", sa.Boolean, nullable=False, server_default=sa.true()
        ),
    )


def downgrade() -> None:
    op.drop_table("datasets")
