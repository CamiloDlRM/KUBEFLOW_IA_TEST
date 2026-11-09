"""Public share links for models.

- ``model_share_links``: one per model name, with the random token that makes
  up its public URL and whether it currently answers. No row means the model
  has no public link, which is how every existing model starts.

Revision ID: 0027
Revises: 0026
"""
import sqlalchemy as sa
from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "model_share_links" in inspector.get_table_names():
        return
    op.create_table(
        "model_share_links",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("model_name", sa.String(), nullable=False),
        sa.Column("token", sa.String(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_model_share_links_model_name", "model_share_links", ["model_name"], unique=True)
    op.create_index("ix_model_share_links_token", "model_share_links", ["token"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_model_share_links_token", table_name="model_share_links")
    op.drop_index("ix_model_share_links_model_name", table_name="model_share_links")
    op.drop_table("model_share_links")
