"""Bake DuckDB's httpfs extension into the image, at build time.

Reading a bucket on the next host over should not require the container to
reach the internet the first time somebody opens a chart.

The directory is named rather than left to default. DuckDB would otherwise put
extensions under `$HOME/.duckdb`, `$HOME` here is `/app/superset_home`, and
compose mounts a volume on exactly that path — so anything baked underneath it
at build time is hidden the moment the container starts. Whatever is set here
has to be set again by the connection that loads it; see superset/README.md.
"""

import sys

import duckdb

EXTENSION_DIRECTORY = "/app/duckdb_extensions"

connection = duckdb.connect()
connection.execute(f"SET extension_directory='{EXTENSION_DIRECTORY}'")
connection.execute("INSTALL httpfs")
connection.execute("LOAD httpfs")

installed = connection.execute(
    "SELECT extension_name, installed, loaded FROM duckdb_extensions() "
    "WHERE extension_name = 'httpfs'"
).fetchall()
connection.close()

if not installed or not installed[0][1]:
    sys.exit(f"httpfs did not install into {EXTENSION_DIRECTORY}: {installed}")

print(f"duckdb {duckdb.__version__}: httpfs installed in {EXTENSION_DIRECTORY}")
