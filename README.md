# MLOps Automation Platform

End-to-end ML pipeline automation: push a notebook to GitHub, get a deployed model —
plus an **AI Training Advisor** (powered by Claude) that reviews every run and tells
you how to improve the next one.

## Architecture

```
GitHub Push  -->  Backend API  -->  Celery Worker  -->  MLflow  -->  Model Server
                     |                    |
                 PostgreSQL          Redis (state + pub/sub)
                                          |
                                   AI Advisor (Claude)
```

## Key Features

- **Push-to-deploy pipelines** — download, validate, execute (papermill), register (MLflow), auto-deploy
- **AI Training Advisor** — after every run, Claude analyzes the notebook source code,
  the run's metrics/logs, and the metric history of previous runs, and produces a
  Markdown report with a diagnosis, prioritized improvements with code snippets,
  suggested features, and pipeline risks. Failed runs get root-cause analysis.
  Enabled by setting `ANTHROPIC_API_KEY` in `.env`.
- **Landing page + authentication** — public landing at `/`, JWT login, user invites
  with email confirmation, and an admin panel
- **Real-time observability** — WebSocket log streaming, phase timeline, metric charts

## Requirements

- Docker and Docker Compose v2
- A GitHub account with a personal access token (repo scope)
- (Optional) A public URL for webhook delivery (use ngrok for local dev)

## Quick Start

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env with your GitHub token, webhook secret, and (optionally) ANTHROPIC_API_KEY

# 2. Start all services
docker compose up -d --build

# 3. Verify services
curl http://localhost:8000/health   # Backend
curl http://localhost:8001/health   # Model server
curl http://localhost:5000/health   # MLflow

# 4. Register a repository
curl -X POST http://localhost:8000/repos \
  -H "Content-Type: application/json" \
  -d '{
    "github_url": "https://github.com/your-user/your-repo",
    "branch": "main",
    "notebook_path": "notebooks/train.ipynb"
  }'

# 5. Push a notebook change and watch the pipeline run
```

## Notebook Structure

Your training notebook must include cells with specific tags in their metadata.
Tags are set via Jupyter: View > Cell Toolbar > Tags.

### Required Tags

| Tag | Purpose |
|-----|---------|
| `mlops:config` | Defines `MODEL_NAME` and `VERSION` variables |
| `mlops:preprocessing` | Data preparation and feature engineering |
| `mlops:training` | Model training logic |
| `mlops:export` | Saves model with `joblib.dump(model, MODEL_OUTPUT_PATH)` |

### Optional Tags

| Tag | Purpose |
|-----|---------|
| `mlops:data` | Data loading |
| `mlops:evaluation` | Metrics computation and `mlflow.log_metric()` calls |
| `parameters` | Papermill parameters cell (injected at runtime) |

### Injected Parameters

The pipeline injects these variables via papermill:

| Variable | Description |
|----------|-------------|
| `MODEL_OUTPUT_PATH` | Path where the model must be saved |
| `PIPELINE_ID` | UUID of the current pipeline run |
| `MLFLOW_TRACKING_URI` | MLflow server URL |

See `notebooks/example_notebook.ipynb` for a complete example.

## API Reference

### System

```bash
# Health check
curl http://localhost:8000/health

# Readiness (checks Redis, MLflow, model-server)
curl http://localhost:8000/ready
```

### Repositories

```bash
# Register a repo
curl -X POST http://localhost:8000/repos \
  -H "Content-Type: application/json" \
  -d '{
    "github_url": "https://github.com/user/repo",
    "branch": "main",
    "notebook_path": "notebooks/train.ipynb",
    "github_token": "ghp_..."
  }'

# List repos
curl http://localhost:8000/repos

# Delete a repo
curl -X DELETE http://localhost:8000/repos/1
```

### Pipelines

```bash
# List pipelines (paginated)
curl "http://localhost:8000/pipelines?page=1&size=20"

# Get pipeline details
curl http://localhost:8000/pipelines/{pipeline_id}

# Get pipeline logs
curl http://localhost:8000/pipelines/{pipeline_id}/logs

# WebSocket (real-time logs)
# ws://localhost:8000/ws/pipelines/{pipeline_id}/logs
```

### Models

```bash
# List deployed models
curl http://localhost:8000/models

# Predict
curl -X POST http://localhost:8000/models/iris-classifier/predict \
  -H "Content-Type: application/json" \
  -d '{"data": [[5.1, 3.5, 1.4, 0.2]]}'

# Rollback
curl -X POST http://localhost:8000/models/iris-classifier/rollback \
  -H "Content-Type: application/json" \
  -d '{"version": "1"}'

# Delete model
curl -X DELETE http://localhost:8000/models/iris-classifier
```

### AI Insights

```bash
# List AI feedback reports for a pipeline (newest first)
curl http://localhost:8000/pipelines/{pipeline_id}/insights \
  -H "Authorization: Bearer <token>"

# Request a new analysis (runs async in the Celery worker; poll the GET endpoint)
curl -X POST http://localhost:8000/pipelines/{pipeline_id}/insights \
  -H "Authorization: Bearer <token>"
```

Insights are generated automatically when a pipeline finishes if `ANTHROPIC_API_KEY`
is set and `AI_ADVISOR_ENABLED=true`.

### Webhook (called by GitHub)

```bash
# Manually test (see scripts/test_pipeline.sh)
curl -X POST http://localhost:8000/webhook/github \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=..." \
  -H "X-GitHub-Event: push" \
  -d '{ ... }'
```

## Testing

```bash
# Run the end-to-end test script
GITHUB_WEBHOOK_SECRET=your_secret ./scripts/test_pipeline.sh
```

## Services and Ports

| Service | Port | URL |
|---------|------|-----|
| Backend API | 8000 | http://localhost:8000 |
| Model Server | 8001 | http://localhost:8001 |
| MLflow UI | 5000 | http://localhost:5000 |
| Redis | 6379 | redis://localhost:6379 |

## Environment Variables

See `.env.example` for all configuration options with defaults.
