#!/bin/sh
set -e

echo "Running database migrations..."
alembic upgrade head

if [ "$#" -gt 0 ]; then
    # Respect the command from docker-compose (e.g. the Celery worker)
    echo "Starting: $*"
    exec "$@"
fi

echo "Starting server..."
exec uvicorn main:app --host 0.0.0.0 --port 8000
