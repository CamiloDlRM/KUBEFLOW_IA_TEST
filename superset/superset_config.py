"""Superset configuration, shared by the web server and the MCP server.

Both containers mount this same file. The MCP server resolves users against
Superset's own `ab_user` table and reads the same metadata database, so a
config that drifted between the two would give the agent a different Superset
from the one a person sees — same dashboards, different permissions.
"""

import os

# ---------------------------------------------------------------------------
# Identity and storage
# ---------------------------------------------------------------------------

SECRET_KEY = os.environ["SUPERSET_SECRET_KEY"]

#: Superset's own metadata: dashboards, charts, users, saved queries. Kept in
#: its own database rather than the platform's, because it is Superset's
#: bookkeeping and nothing of ours should ever join against it.
SQLALCHEMY_DATABASE_URI = os.environ["SUPERSET_DATABASE_URI"]

# ---------------------------------------------------------------------------
# The MCP server
# ---------------------------------------------------------------------------

#: What the agent talks to. Served over HTTP JSON-RPC at /mcp by the
#: `superset-mcp` container; this flag is what makes the command exist.
ENABLE_MCP_SERVICE = True

#: Development authentication: every MCP call acts as this user.
#:
#: This is the documented dev-only mode and it is a real hole — anything that
#: can reach port 5008 gets that user's permissions with no token at all. It is
#: acceptable here because the port is not published outside the compose
#: network. Before this is reachable from anywhere else it has to become the
#: JWT mode, which is why the variable is read rather than hardcoded: an empty
#: value turns the shortcut off.
MCP_DEV_USERNAME = os.environ.get("SUPERSET_MCP_DEV_USERNAME") or None

#: Every tool under its real name, rather than behind a search.
#:
#: The default "compatibility mode" lists four tools — health_check,
#: get_instance_info, search_tools, call_tool — and hides the ~45 real ones
#: behind the search. That is built for chat clients juggling many servers in
#: a small context. Our agent is the opposite case: one server, and a model
#: that has to see `generate_chart` to think of calling it. In compatibility
#: mode the first model to try this read the four names, concluded nothing
#: could build a chart, and said so politely instead of searching.
MCP_TOOL_SEARCH_CONFIG = {"enabled": False}

#: Every tool's schema goes into every model call, a dozen calls per prompt.
#: Compact keeps that affordable on a free tier's tokens-per-minute.
MCP_NATIVE_TOOL_LIST_CONFIG = {"compact": True, "max_description_length": 300}

# ---------------------------------------------------------------------------
# Connecting to gold
# ---------------------------------------------------------------------------

#: Superset blocks connections to local-file databases by default, which is a
#: good default aimed at SQLite on the server's own disk. DuckDB is caught by
#: it too, and DuckDB is the whole point here: it is the engine that reads the
#: gold Parquet. The objects themselves live in MinIO, not on this disk.
PREVENT_UNSAFE_DB_CONNECTIONS = False

FEATURE_FLAGS = {
    # Lets a dataset be defined as SQL with parameters, which is how a chart
    # points at one project's gold object without a dataset per project.
    "ENABLE_TEMPLATE_PROCESSING": True,
}

# ---------------------------------------------------------------------------
# Serving
# ---------------------------------------------------------------------------

#: Off because the platform terminates TLS in front of everything and this
#: container is reached over plain HTTP inside the compose network. Turning it
#: on here makes Superset issue https-only cookies that never come back.
TALISMAN_ENABLED = False

SUPERSET_WEBSERVER_TIMEOUT = 120
ROW_LIMIT = 50_000
