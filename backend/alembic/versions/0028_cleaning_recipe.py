"""Let each source choose how the cleaning standard is applied to it.

``data_sources.cleaning_recipe``: rules turned off, its own placeholder
strings, columns kept as text, forced types, duplicate keys, folding and sex
columns, plausible ranges. ``{}`` means the standard, written into existing
rows so every source keeps being cleaned exactly as it was. See
``core.cleaning.CleaningRecipe``.

Revision ID: 0028
Revises: 0027
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def _json_type():
    if op.get_bind().dialect.name == "postgresql":
        return postgresql.JSONB(astext_type=sa.Text())
    return sa.JSON()


def upgrade() -> None:
    if "cleaning_recipe" in {c["name"] for c in sa.inspect(op.get_bind()).get_columns("data_sources")}:
        return
    op.add_column(
        "data_sources",
        sa.Column("cleaning_recipe", _json_type(), nullable=True, server_default=sa.text("'{}'")),
    )


def downgrade() -> None:
    op.drop_column("data_sources", "cleaning_recipe")
