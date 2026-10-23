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

# Two drivers, because since 4.1.0 the image ships none: they were dropped to
# keep it lean and every one is now the operator's to add.
#
#   psycopg2-binary  Superset's own metadata database. Without it the container
#                    does not start at all — `superset db upgrade` cannot open
#                    the connection. The `-binary` build ships wheels, so this
#                    does not need a compiler in the image.
#   duckdb           how it reads the gold layer, which is the point of all this.
#
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
RUN uv pip install --no-cache --python /app/.venv/bin/python \
      psycopg2-binary duckdb duckdb-engine \
 && /app/.venv/bin/python -c "\
import duckdb, duckdb_engine, psycopg2; \
print('duckdb', duckdb.__version__, '| psycopg2', psycopg2.__version__)"

# The MCP service itself, which the image does not ship either: it lives behind
# an optional extra, and without it `superset mcp run` prints "fastmcp is not
# installed, skipping MCP initialization" and exits.
#
# Asked for as the extra of the version already installed, not as a bare
# `fastmcp`. The extra carries Superset's own constraint on which fastmcp its
# MCP code was written against; a bare install takes the newest, which is how
# you get a server that starts and then disagrees with its own host about a
# schema. Naming the installed version means the resolver sees apache-superset
# as already satisfied and adds only what the extra pulls in.
# The requirement is written to a file rather than interpolated through a
# shell variable. `VERSION="$(python -c '...')"` needs double quotes inside
# single quotes inside double quotes, and the layer Docker adds on top makes
# that a quoting puzzle rather than a command — the first attempt reached
# Python as `m.version(\"apache-superset\")` and died on the backslash.
RUN /app/.venv/bin/python -c "import importlib.metadata as m; open('/tmp/mcp-req.txt', 'w').write('apache-superset[fastmcp]==' + m.version('apache-superset'))" \
 && cat /tmp/mcp-req.txt \
 && uv pip install --no-cache --python /app/.venv/bin/python -r /tmp/mcp-req.txt \
 && rm /tmp/mcp-req.txt \
 && /app/.venv/bin/python -c "import fastmcp, uvicorn; print('fastmcp', fastmcp.__version__, '| uvicorn', uvicorn.__version__)"

# Owned by the user that will write into it during the build and read from it
# at runtime.
RUN mkdir -p /app/duckdb_extensions && chown superset:superset /app/duckdb_extensions

COPY bootstrap.sh /app/bootstrap.sh
COPY install_extensions.py /app/install_extensions.py
RUN chmod +x /app/bootstrap.sh

USER superset

RUN python /app/install_extensions.py
