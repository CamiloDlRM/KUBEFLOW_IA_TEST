import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool
from sqlmodel import SQLModel

# Make sure the backend package is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# Import all models so their metadata is registered
import models.schemas  # noqa: F401

config = context.config

# Override sqlalchemy.url from environment variable
database_url = os.environ.get("DATABASE_URL")
if not database_url:
    from core.config import get_settings
    database_url = get_settings().database_url
config.set_main_option("sqlalchemy.url", database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        # Serialize concurrent migration runners (backend + worker containers
        # both run `alembic upgrade head` on startup). The advisory lock is
        # released automatically when this connection closes.
        if connection.dialect.name == "postgresql":
            connection.exec_driver_sql("SELECT pg_advisory_lock(78216430)")

        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
