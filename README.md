# MLOps Automation Platform

End-to-end ML pipeline automation: push a notebook to GitHub, get a deployed model —
plus an **AI Training Advisor** that reviews every run and tells you how to improve
the next one. Works with Claude, Gemini, or any local model served by Ollama.

## Architecture

```
GitHub Push  -->  Backend API  -->  Celery Worker  -->  MLflow  -->  Model Server
                     |                    |
                 PostgreSQL          Redis (state + pub/sub)
                                          |
                            AI Advisor (Claude / Gemini / Ollama)
```

## Key Features

- **Push-to-deploy pipelines** — download, validate, execute (papermill), register (MLflow), auto-deploy
- **AI Training Advisor** — after every run, an LLM analyzes the notebook source code,
  the run's metrics/logs, and the metric history of previous runs, and produces a
  Markdown report with a diagnosis, prioritized improvements with code snippets,
  suggested features, and pipeline risks. Failed runs get root-cause analysis.
  Pick the provider with `AI_ADVISOR_PROVIDER` (see below).
- **AI applies its own suggestions** — one click ("Apply & push") makes the advisor
  rewrite the notebook per its recommendations and push it to the
  `testing-ia-agent` branch, ready to review as a diff on GitHub.
- **Run from any branch** — launch a pipeline manually from the Dashboard picking
  any branch of the repo (e.g. `testing-ia-agent`), without needing a push event.
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
# Edit .env with your GitHub token, webhook secret, and (optionally) the AI
# advisor provider credentials (ANTHROPIC_API_KEY / GEMINI_API_KEY / OLLAMA_BASE_URL)

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

Insights are generated automatically when a pipeline finishes if the configured
provider is ready and `AI_ADVISOR_ENABLED=true`.

```bash
# Apply the insight's suggestions: the AI rewrites the notebook and pushes it
# to the testing-ia-agent branch (poll the GET endpoint for apply_status)
curl -X POST http://localhost:8000/pipelines/{pipeline_id}/insights/{insight_id}/apply \
  -H "Authorization: Bearer <token>"

# List repo branches / launch a pipeline manually from any branch
curl http://localhost:8000/repos/{repo_id}/branches -H "Authorization: Bearer <token>"
curl -X POST http://localhost:8000/repos/{repo_id}/trigger \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"branch": "testing-ia-agent"}'
```

#### Choosing the AI provider

Set these in `.env` (see `.env.example` for details):

| Provider | `AI_ADVISOR_PROVIDER` | Credentials / config | Default model |
|----------|----------------------|----------------------|---------------|
| Claude (Anthropic) | `anthropic` | `ANTHROPIC_API_KEY` | `claude-opus-4-8` |
| Google Gemini | `gemini` | `GEMINI_API_KEY` | `gemini-2.5-pro` |
| Ollama (local, free) | `ollama` | `OLLAMA_BASE_URL` (no API key) | `llama3.1` |

Override the model with `AI_ADVISOR_MODEL` (e.g. `AI_ADVISOR_MODEL=mistral:7b` for
Ollama, or `AI_ADVISOR_MODEL=gemini-2.5-flash` for a faster/cheaper Gemini).

For Ollama running on the Docker host, the default
`OLLAMA_BASE_URL=http://host.docker.internal:11434` works out of the box (the
compose file maps `host.docker.internal` to the host gateway). To run Ollama as
a container instead, uncomment the `ollama` service in `docker-compose.yml`,
set `OLLAMA_BASE_URL=http://ollama:11434`, and pull a model once:

```bash
docker compose exec ollama ollama pull llama3.1
```

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
