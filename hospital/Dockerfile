# One-shot loader for the simulated Hospital Information System.
#
# Runs to completion and exits; docker-compose treats it like minio-init.
FROM python:3.11-slim

WORKDIR /app

# psycopg2-binary ships wheels, so no build toolchain is needed here.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY schema.sql degradation.py load_synthea.py ./

# Unbuffered: this container's only output is its progress log, and a crash
# with the log still in a buffer is a crash nobody can diagnose.
ENV PYTHONUNBUFFERED=1

CMD ["python", "load_synthea.py"]
