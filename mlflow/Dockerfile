# MLflow tracking server with S3 support.
#
# The upstream image ships without the S3 extra, so boto3 is baked in here
# instead of being pip-installed at container start: a runtime install needs
# egress on every boot, slows startup, and is not reproducible — all of which
# break in Kubernetes, which is where this stack is heading.
FROM ghcr.io/mlflow/mlflow:v2.9.2

# Same pin as backend/ and model-server/ so every service speaks to MinIO
# through an identical boto3.
RUN pip install --no-cache-dir boto3==1.35.76

EXPOSE 5000
