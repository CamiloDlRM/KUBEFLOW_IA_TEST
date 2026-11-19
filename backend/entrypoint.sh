#!/bin/sh
set -e

echo "Running database migrations..."
alembic upgrade head

# Only the smoke e2e stack (docker-compose.e2e.yml) sets this. Idempotent.
if [ "${E2E_SEED:-0}" = "1" ]; then
    echo "Seeding e2e data..."
    python scripts/seed_e2e.py
fi

if [ "$#" -gt 0 ]; then
    # Respect the command from docker-compose (e.g. the Celery worker)
    echo "Starting: $*"
    exec "$@"
fi

echo "Starting server..."
exec uvicorn main:app --host 0.0.0.0 --port 8000
