"""Idempotent provisioning of the read-only PostgreSQL role used by Grafana.

Grafana queries the application database directly through a *dedicated*
least-privilege role (``grafana_ro`` by default). That role:

* can only ``SELECT``, and only on the handful of tables the dashboards need;
* on ``users`` it is granted **column-level** ``SELECT`` that deliberately
  excludes ``hashed_password``;
* runs with ``default_transaction_read_only = on``, so even a privilege
  mistake cannot turn into a write.

This runs on **every backend startup** rather than from a ``docker-entrypoint-
initdb.d`` script, because those scripts only execute when the PostgreSQL data
volume is created — and in production that volume already exists. Every
statement here is therefore written to be safe to re-run, and to work against a
database that already has data in it.

Configuration (read straight from the environment so it matches the values
docker-compose passes to the Grafana container):

``GRAFANA_DB_USER``           role name           (default ``grafana_ro``)
``GRAFANA_DB_PASSWORD``       role password       (default ``grafana_ro``)
``GRAFANA_DB_ROLE_ENABLED``   set to ``false`` to skip provisioning entirely
"""
from __future__ import annotations

import os
import re
from typing import Final

import structlog
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

from core.config import AppSettings, get_settings

logger = structlog.get_logger(__name__)

#: Default credentials — mirror the docker-compose defaults for the Grafana
#: container so the datasource works out of the box in development.
DEFAULT_ROLE_NAME: Final[str] = "grafana_ro"
DEFAULT_ROLE_PASSWORD: Final[str] = "grafana_ro"

#: Conservative identifier pattern; anything else is rejected outright rather
#: than escaped, because these values end up in DDL that cannot be parametrised.
_IDENT_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]{0,62}$")

#: Tables Grafana may read. An empty tuple means "every column"; a non-empty
#: tuple restricts the grant to those columns.
TABLE_GRANTS: Final[dict[str, tuple[str, ...]]] = {
    # hashed_password is intentionally absent.
    "users": ("id", "username", "role", "email", "is_active", "created_at"),
    "repositories": (),
    "pipelines": (),
    "model_deployments": (),
    "pipeline_insights": (),
    "datasets": (),
}

#: Schema the application tables live in.
SCHEMA: Final[str] = "public"


# ---------------------------------------------------------------------------
# Quoting helpers
# ---------------------------------------------------------------------------


def _quote_ident(name: str) -> str:
    """Quote a SQL identifier, rejecting anything that is not plainly safe."""
    if not _IDENT_RE.match(name):
        raise ValueError(
            f"Unsafe SQL identifier {name!r}: expected [A-Za-z_][A-Za-z0-9_$]*."
        )
    return '"' + name.replace('"', '""') + '"'


def _quote_literal(value: str) -> str:
    """Quote a string literal for DDL (``standard_conforming_strings`` is on)."""
    if "\x00" in value:
        raise ValueError("SQL string literal must not contain NUL bytes.")
    escaped = value.replace("'", "''")
    return f"'{escaped}'"


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def get_grafana_db_credentials() -> tuple[str, str]:
    """Return the ``(role, password)`` pair Grafana's datasource will use."""
    role = os.getenv("GRAFANA_DB_USER", "").strip() or DEFAULT_ROLE_NAME
    password = os.getenv("GRAFANA_DB_PASSWORD", "").strip() or DEFAULT_ROLE_PASSWORD
    return role, password


def _provisioning_enabled(settings: AppSettings) -> bool:
    """Whether the role should be (re)provisioned on this startup."""
    if not settings.grafana_enabled:
        return False
    flag = os.getenv("GRAFANA_DB_ROLE_ENABLED", "true").strip().lower()
    return flag not in {"0", "false", "no", "off"}


# ---------------------------------------------------------------------------
# Provisioning
# ---------------------------------------------------------------------------


def _application_engine() -> Engine:
    """Return the shared application engine (imported lazily to avoid cycles)."""
    import db as _db

    return _db.engine


def ensure_grafana_role(
    engine: Engine | None = None,
    *,
    settings: AppSettings | None = None,
) -> bool:
    """Create or refresh the read-only Grafana database role.

    Safe to call on every application start and against an existing database.
    Never raises: a failure is logged and reported through the return value so
    a misconfigured observability stack cannot stop the API from booting.

    Args:
        engine: SQLAlchemy engine to use. Defaults to the application engine.
        settings: Application settings. Defaults to the cached singleton.

    Returns:
        ``True`` when the role exists with the expected grants, ``False`` when
        provisioning was skipped or failed.
    """
    settings = settings or get_settings()

    if not _provisioning_enabled(settings):
        logger.info("grafana.db_role_skipped", reason="disabled by configuration")
        return False

    if not settings.database_url.startswith(("postgresql", "postgres")):
        logger.warning(
            "grafana.db_role_skipped",
            reason="database is not PostgreSQL",
            database_url=settings.database_url.split("://", 1)[0],
        )
        return False

    db_engine = engine if engine is not None else _application_engine()

    role, password = get_grafana_db_credentials()

    try:
        role_ident = _quote_ident(role)
    except ValueError as exc:
        logger.error("grafana.db_role_failed", error=str(exc), role=role)
        return False

    if password == DEFAULT_ROLE_PASSWORD:
        logger.warning(
            "grafana.db_role_default_password",
            role=role,
            hint="Set GRAFANA_DB_PASSWORD to a strong secret in production.",
        )

    try:
        # DDL such as CREATE ROLE is transactional in PostgreSQL, but running
        # in AUTOCOMMIT keeps each statement independent: one missing table
        # cannot roll back the whole provisioning.
        with db_engine.connect().execution_options(
            isolation_level="AUTOCOMMIT"
        ) as conn:
            database = conn.execute(text("SELECT current_database()")).scalar_one()
            exists = conn.execute(
                text("SELECT 1 FROM pg_roles WHERE rolname = :role"),
                {"role": role},
            ).first()

            if exists is None:
                conn.execute(
                    text(
                        f"CREATE ROLE {role_ident} LOGIN PASSWORD "
                        f"{_quote_literal(password)} "
                        "NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION"
                    )
                )
                logger.info("grafana.db_role_created", role=role)
            else:
                # Keep the password in sync so rotating GRAFANA_DB_PASSWORD
                # only requires a restart.
                conn.execute(
                    text(
                        f"ALTER ROLE {role_ident} WITH LOGIN PASSWORD "
                        f"{_quote_literal(password)} "
                        "NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION"
                    )
                )
                logger.info("grafana.db_role_refreshed", role=role)

            # Belt and braces: every transaction this role opens is read-only.
            conn.execute(
                text(f"ALTER ROLE {role_ident} SET default_transaction_read_only = on")
            )

            conn.execute(
                text(
                    f"GRANT CONNECT ON DATABASE {_quote_ident(database)} "
                    f"TO {role_ident}"
                )
            )

            schema_ident = _quote_ident(SCHEMA)
            # Reset first, so a table removed from TABLE_GRANTS actually loses
            # access on the next restart.
            conn.execute(
                text(
                    "REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "
                    f"{schema_ident} FROM {role_ident}"
                )
            )
            conn.execute(
                text(f"REVOKE ALL ON SCHEMA {schema_ident} FROM {role_ident}")
            )
            conn.execute(text(f"GRANT USAGE ON SCHEMA {schema_ident} TO {role_ident}"))

            granted: list[str] = []
            missing: list[str] = []
            for table, columns in TABLE_GRANTS.items():
                table_ident = _quote_ident(table)
                present = conn.execute(
                    text(
                        "SELECT 1 FROM information_schema.tables "
                        "WHERE table_schema = :schema AND table_name = :table"
                    ),
                    {"schema": SCHEMA, "table": table},
                ).first()
                if present is None:
                    missing.append(table)
                    continue

                if columns:
                    column_list = ", ".join(_quote_ident(col) for col in columns)
                    statement = (
                        f"GRANT SELECT ({column_list}) ON "
                        f"{schema_ident}.{table_ident} TO {role_ident}"
                    )
                else:
                    statement = (
                        f"GRANT SELECT ON {schema_ident}.{table_ident} TO {role_ident}"
                    )
                conn.execute(text(statement))
                granted.append(table)

            if missing:
                logger.warning(
                    "grafana.db_role_tables_missing",
                    role=role,
                    tables=missing,
                    hint="Run the Alembic migrations before provisioning.",
                )

            logger.info(
                "grafana.db_role_ready",
                role=role,
                database=database,
                tables=granted,
            )
            return True

    except (SQLAlchemyError, ValueError) as exc:
        logger.error(
            "grafana.db_role_failed",
            role=role,
            error=str(exc),
            hint=(
                "The application database user needs CREATEROLE (or superuser) "
                "to provision the Grafana read-only role."
            ),
        )
        return False
