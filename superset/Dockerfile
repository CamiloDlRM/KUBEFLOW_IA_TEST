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

# Installed through uv, naming the interpreter, and proved in the same layer.
#
# `pip install` here is a trap. The image builds its environment with
# `uv venv /app/.venv`, and `uv venv` does not put pip inside it — so `pip`
# resolves up PATH to the system interpreter, installs into system
# site-packages, and exits 0. The venv that actually runs Superset never sees
# the package. The build then fails several steps later, or worse, succeeds and
# the driver is simply missing at runtime.
#
# Unpinned on purpose, for now: these have never been resolved against this
# base image here, and a pin invented without running it is a broken build
# rather than a reproducible one. Pin them from the versions this prints.
RUN uv pip install --no-cache --python /app/.venv/bin/python duckdb duckdb-engine \
 && /app/.venv/bin/python -c "import duckdb, duckdb_engine; print('duckdb', duckdb.__version__)"

# Owned by the user that will write into it during the build and read from it
# at runtime.
RUN mkdir -p /app/duckdb_extensions && chown superset:superset /app/duckdb_extensions

COPY bootstrap.sh /app/bootstrap.sh
COPY install_extensions.py /app/install_extensions.py
RUN chmod +x /app/bootstrap.sh

USER superset

RUN python /app/install_extensions.py
