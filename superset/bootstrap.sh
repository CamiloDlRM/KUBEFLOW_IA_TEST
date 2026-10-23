#!/usr/bin/env bash
#
# One entrypoint for both Superset containers.
#
#   bootstrap.sh web   migrate, seed the admin, then serve the UI
#   bootstrap.sh mcp   wait for the migration, then serve MCP
#
# Only the web container migrates. Two processes running `superset db upgrade`
# against one database at the same time is how you get a half-applied schema,
# and compose starts them together.
set -euo pipefail

ROLE="${1:-web}"

wait_for_db() {
  echo "superset/$ROLE: waiting for the metadata database..."
  until superset db current >/dev/null 2>&1; do
    sleep 2
  done
}

case "$ROLE" in
  web)
    echo "superset/web: applying migrations"
    superset db upgrade

    # Idempotent: a second run fails with "user already exists", which is not
    # an error worth stopping a restart for.
    superset fab create-admin \
      --username "${SUPERSET_ADMIN_USERNAME:-admin}" \
      --firstname Superset \
      --lastname Admin \
      --email "${SUPERSET_ADMIN_EMAIL:-admin@example.com}" \
      --password "${SUPERSET_ADMIN_PASSWORD:-admin}" || true

    echo "superset/web: initialising roles and permissions"
    superset init

    # The gold connection. Not fatal: Superset is still worth having up if
    # this fails, but the agent will have nothing to chart, so it is said.
    if ! python /app/provision.py; then
      echo "superset/web: WARNING could not register the gold database;" >&2
      echo "superset/web: the KPI maker will find nothing to build on." >&2
    fi

    exec gunicorn \
      --bind "0.0.0.0:8088" \
      --workers 4 \
      --worker-class gthread \
      --threads 4 \
      --timeout "${SUPERSET_WEBSERVER_TIMEOUT:-120}" \
      "superset.app:create_app()"
    ;;

  mcp)
    wait_for_db

    # The dependency, not the subcommand. `superset mcp` exists in the CLI
    # whether or not the service behind it can run: without the `fastmcp`
    # extra it prints "skipping MCP initialization" and exits 1, which reaches
    # the caller as nothing but a refused connection.
    if ! python -c "import fastmcp, uvicorn" 2>/dev/null; then
      echo "superset/mcp: the fastmcp extra is not installed in this image." >&2
      echo "superset/mcp: the MCP service cannot start without it — see the" >&2
      echo "superset/mcp: install line in superset/Dockerfile." >&2
      exit 78
    fi

    echo "superset/mcp: serving on 0.0.0.0:5008"
    # If this restart-loops on "No application found. Either work inside a view
    # function or push an application context", that is the known Docker
    # failure mode of the MCP service: it starts outside Flask's normal
    # lifecycle. The fix is a wrapper that creates the app and pushes its
    # context first. See superset/README.md.
    exec superset mcp run --host 0.0.0.0 --port 5008
    ;;

  *)
    echo "usage: bootstrap.sh [web|mcp]" >&2
    exit 64
    ;;
esac
