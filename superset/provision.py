"""Register the gold layer as a database Superset can query. Idempotent.

There is no MCP tool for creating a database connection — the agent can list
databases and build datasets on them, but not make one. So without this the
agent meets a Superset with nothing to point a chart at, and the manual step
the README used to describe in SQL Lab is the whole difference between a
dashboard and an apology.

The connection is DuckDB in memory, with httpfs reaching MinIO. It holds no
data and no views: a dataset on it is `SELECT ... FROM read_parquet('s3://gold/
...')`, which reads the built gold object directly. Re-running the gold
definition here instead would show numbers that belong to no build at all.

Run by `bootstrap.sh web` after `superset init`, inside an application context.
Safe to run on every start: it updates the row it made rather than adding one.
"""

import json
import os
from urllib.parse import urlparse

#: The name the agent is told to look for. Changing it means changing the
#: system prompt in backend/core/superset_agent.py to match.
DATABASE_NAME = "Gold (DuckDB)"

#: Where install_extensions.py baked httpfs. Not under $HOME: compose mounts a
#: volume there, and anything baked underneath would be hidden at runtime.
EXTENSION_DIRECTORY = "/app/duckdb_extensions"


def _extra() -> str:
    # DuckDB wants host:port for the endpoint, with the scheme said separately.
    endpoint = urlparse(os.environ.get("MINIO_ENDPOINT", "http://minio:9000"))
    return json.dumps(
        {
            # Superset hands `engine_params` to SQLAlchemy's create_engine, and
            # duckdb-engine reads `connect_args` from there: the extension to
            # load and the settings each new connection starts with. In memory,
            # every connection is new, so this is set every time — which is the
            # point, since nothing set on one would survive to the next.
            "engine_params": {
                "connect_args": {
                    "preload_extensions": ["httpfs"],
                    "config": {
                        "extension_directory": EXTENSION_DIRECTORY,
                        "s3_endpoint": endpoint.netloc or "minio:9000",
                        "s3_use_ssl": endpoint.scheme == "https",
                        "s3_url_style": "path",
                        "s3_access_key_id": os.environ.get("AWS_ACCESS_KEY_ID", ""),
                        "s3_secret_access_key": os.environ.get("AWS_SECRET_ACCESS_KEY", ""),
                    },
                }
            }
        }
    )


def main() -> None:
    from superset.app import create_app

    app = create_app()
    with app.app_context():
        from superset import db
        from superset.models.core import Database

        database = (
            db.session.query(Database).filter_by(database_name=DATABASE_NAME).one_or_none()
        )
        created = database is None
        if created:
            database = Database(database_name=DATABASE_NAME)
            db.session.add(database)

        database.sqlalchemy_uri = "duckdb:///:memory:"
        database.extra = _extra()
        database.expose_in_sqllab = True
        # Read-only by construction: gold is built by the platform, and a
        # dashboard is never the place to change it.
        database.allow_dml = False
        database.allow_ctas = False
        database.allow_cvas = False
        db.session.commit()

        print(
            f"superset/provision: {'created' if created else 'updated'} "
            f"{DATABASE_NAME!r} (id {database.id})"
        )


if __name__ == "__main__":
    main()
