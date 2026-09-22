# Superset, with the one driver it does not ship: DuckDB.
#
# The gold layer is Parquet in MinIO, and DuckDB is already how the platform
# reads it (core/gold.py). Giving Superset the same engine means the dashboard
# and the platform answer a question the same way, with the same SQL dialect,
# instead of two engines that disagree at the edges.
#
# The same image runs the web server and the MCP server. They are one codebase
# and must share a config and a metadata database; a second image would only
# be a second thing to keep in step.
FROM apache/superset:6.1.0

USER root

# Unpinned on purpose, for now: these have never been resolved against this
# base image here, and a pin invented without running it is a broken build
# rather than a reproducible one. Pin them from `pip freeze` after the first
# successful bring-up.
RUN pip install --no-cache-dir duckdb duckdb-engine

COPY bootstrap.sh /app/bootstrap.sh
RUN chmod +x /app/bootstrap.sh

USER superset

# Bake the httpfs extension in, as the user that will load it: DuckDB installs
# extensions under $HOME, and the first query would otherwise have to reach the
# internet from inside the container to read a bucket on the next host over.
RUN python -c "import duckdb; duckdb.connect().execute('INSTALL httpfs')"
