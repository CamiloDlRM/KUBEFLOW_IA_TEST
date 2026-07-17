# MLOps Automation Platform

End-to-end ML pipeline automation with a **self-improving loop**: push a training
notebook to GitHub and get a validated, tracked, and deployed model — then let an
**AI Training Advisor** review the run, rewrite your notebook with concrete
improvements, push them to a dedicated branch, and re-run the pipeline from there.
The advisor runs on **Claude, Google Gemini, or any local model served by Ollama**.

```
                    ┌───────────────────────────────────────────────────┐
                    │                                                   │
                    ▼                                                   │
   git push ──▶ pipeline ──▶ deploy ──▶ AI Advisor ──▶ "Apply & push"  │
   (or manual   (train +     (serve)    (diagnosis +    (rewrites the   │
    Run)         evaluate)               suggestions)    notebook →     │
                                                         testing-ia-    │
                                                         agent branch) ─┘
                    ▲                                         │
                    └──────── Run pipeline from that branch ◀─┘
                             compare metrics · merge if better
```

## Table of Contents

- [What's new](#whats-new)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [The AI Training Advisor](#the-ai-training-advisor)
  - [Choosing a provider](#choosing-a-provider)
  - [The improvement loop](#the-improvement-loop)
- [Notebook Structure](#notebook-structure)
- [Authentication](#authentication)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Services and Ports](#services-and-ports)
- [Testing](#testing)

## What's new

Recent additions on top of the base push-to-deploy platform:

- 🧠 **AI Training Advisor (multi-provider)** — after every run, an LLM reads your
  notebook source, the run's metrics and phase logs, and the metric history of
  previous runs, and returns a structured Markdown report: a diagnosis
  (overfitting, leakage, weak features, bad split…), prioritized improvements
  **with code snippets referencing your actual variables**, feature-engineering
  ideas, and pipeline risks. Failed runs get a root-cause analysis instead.
  Choose **Claude**, **Gemini**, or a **local Ollama** model per your budget and
  privacy needs.
- 🤖 **The advisor applies its own suggestions** — one click (**"Apply & push"**)
  and the LLM rewrites the affected notebook cells, preserving the `mlops:*` tags
  and the model export, then commits the result to a `testing-ia-agent` branch so
  you can review the diff on GitHub before trusting it.
- 🌿 **Run a pipeline from any branch** — trigger a run on demand from the
  Dashboard, picking any branch of the repo (e.g. `testing-ia-agent`) — no push
  event required. Each run records the branch it came from.
- ♻️ **Self-healing model serving** — the model-server keeps models in memory, so a
  restart used to break `Test`/predict with a 404 "not loaded". Now the backend
  detects that, **reloads the model from MLflow automatically**, and retries the
  prediction transparently. Rollback was also fixed to use the real MLflow run id.
- 🔐 **Landing page + authentication** — a public marketing landing at `/`, JWT
  login, user invites with email confirmation, self-service password/username
  changes, and an admin panel.
- 📡 **Real-time observability** — live pipeline log streaming over WebSockets, a
  phase-by-phase timeline, and metric charts across runs.

## Architecture

```
                          ┌──────────────┐
  GitHub  ──webhook──▶    │  Backend API │  ◀── Frontend (React SPA)
  (push /   or manual     │  (FastAPI)   │
   Run)     trigger       └──────┬───────┘
                                 │ enqueue
                                 ▼
                          ┌──────────────┐        ┌──────────────┐
                          │ Celery Worker│──────▶ │    MLflow    │  (tracking + artifacts)
                          │ (papermill)  │        └──────────────┘
                          └──────┬───────┘                │ load
                                 │ AI analysis            ▼
                                 ▼                 ┌──────────────┐
                     ┌───────────────────────┐    │ Model Server │  (dynamic serving)
                     │ AI Advisor            │    └──────────────┘
                     │ Claude / Gemini /     │
                     │ Ollama                │
                     └───────────────────────┘

  State & messaging:  PostgreSQL (records)   ·   Redis (pipeline state + pub/sub)
  Dev email:          Mailhog (SMTP capture)
```

- **Backend API** (FastAPI) — repos, pipelines, models, insights, auth; serves the
  webhook and the pipeline log WebSocket.
- **Celery Worker** — runs the pipeline (download → validate → execute with
  papermill → register in MLflow → auto-deploy) and the async AI analysis / apply.
- **Model Server** — loads model artifacts from MLflow and exposes dynamic
  `/predict/{model}` endpoints; reloadable at runtime.
- **PostgreSQL** — repositories, pipelines, deployments, insights, users
  (schema managed with **Alembic**).
- **Redis** — pipeline phase state and pub/sub for live log streaming.
- **MLflow** — experiment tracking and the artifact store models are served from.

## Requirements

- Docker and Docker Compose v2
- A GitHub account with a personal access token (repo scope)
- (Optional) A public URL for webhook delivery — use ngrok for local dev
- (Optional) An AI provider: an Anthropic or Google AI Studio API key, **or**
  a local Ollama install (free, no key)

## Quick Start

```bash
# 1. Configure
cp .env.example .env
# Edit .env: GitHub token + webhook secret, the bootstrap admin credentials,
# and (optionally) the AI advisor provider — see "Configuration" below.

# 2. Start everything
docker compose up -d --build

# 3. Verify services
curl http://localhost:8000/health   # Backend
curl http://localhost:8001/health   # Model server
curl http://localhost:5000/health   # MLflow

# 4. Open the app and sign in
#    http://localhost:3000   (log in with FIRST_ADMIN_USERNAME / FIRST_ADMIN_PASSWORD)

# 5. Add a repository from the UI (or via the API — see below), then either push a
#    notebook change or hit "Run pipeline" on the repo card to launch a run.
```

> **Database migrations run automatically** on startup (Alembic). If you deploy a
> new version, `docker compose up -d --build` applies any pending migrations before
> the API accepts traffic.

## The AI Training Advisor

The advisor is the core of the platform's self-improving loop. It never sees only
numbers — it reads your **actual notebook code** together with the run's results,
so its advice references your real variables and functions.

### Choosing a provider

Set these in `.env`:

| Provider | `AI_ADVISOR_PROVIDER` | Credentials / config | Default model | Notes |
|----------|----------------------|----------------------|---------------|-------|
| **Claude** (Anthropic) | `anthropic` | `ANTHROPIC_API_KEY` | `claude-opus-4-8` | Best reasoning; get a key at [platform.claude.com](https://platform.claude.com) |
| **Google Gemini** | `gemini` | `GEMINI_API_KEY` | `gemini-2.5-pro` | Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **Ollama** (local) | `ollama` | `OLLAMA_BASE_URL` (no key) | `llama3.1` | Free, private, runs on your machine |

Override the model with `AI_ADVISOR_MODEL` — e.g. `mistral:7b` for Ollama, or
`gemini-2.5-flash` for a cheaper/faster Gemini. Leave it empty to use the
provider default above. Set `AI_ADVISOR_ENABLED=false` to turn the advisor off
entirely.

**Running Ollama locally (free path):**

```bash
# On the Docker host:
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.1
# In .env:  AI_ADVISOR_PROVIDER=ollama
#           OLLAMA_BASE_URL=http://host.docker.internal:11434   (default; works out of the box)
```

The compose file maps `host.docker.internal` to the host gateway, so the default
URL reaches an Ollama server running on the host. Alternatively, uncomment the
`ollama` service in `docker-compose.yml`, set `OLLAMA_BASE_URL=http://ollama:11434`,
and `docker compose exec ollama ollama pull llama3.1`.

### The improvement loop

1. **A pipeline finishes** → the advisor is queued automatically (if enabled and
   configured). You can also click **"Analyze this run"** / **"Regenerate
   analysis"** on the pipeline detail page.
2. **Read the report** — the panel renders the Markdown: a training summary, a
   diagnosis, prioritized improvements with code snippets, suggested features, and
   pipeline risks.
3. **Click "Apply & push"** — the same LLM rewrites the notebook cells according to
   its recommendations (keeping the `mlops:config`/`export` cells intact) and
   commits the result to the **`testing-ia-agent`** branch of your repo.
4. **Review the diff** on GitHub. The branch is created from (or reset to) the
   branch the run came from, so the diff is exactly the advisor's changes.
5. **Run the pipeline from that branch** — on the Dashboard, open the repo card,
   choose `testing-ia-agent` in the branch selector, and hit **Run**.
6. **Compare metrics** between the original run and the AI-improved run. If it's
   better, merge the branch; if not, iterate or discard.

The report and apply status are persisted per insight, so you always see the last
analysis and whether its suggestions were pushed (`apply_status`: `none` →
`queued` → `applying` → `pushed` / `failed`).

## Notebook Structure

Your training notebook must include cells with specific tags in their metadata.
Tags are set via Jupyter: **View → Cell Toolbar → Tags**.

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

## Authentication

The app is protected by JWT auth. On first startup a bootstrap admin is created
from `FIRST_ADMIN_USERNAME` / `FIRST_ADMIN_PASSWORD` (only if no users exist).

- Public routes: the landing page (`/`), `/login`, `/register` (invite-based),
  and `/confirm-change`.
- Everything else requires a valid token; the frontend stores it and attaches it
  to every API call, redirecting to `/login` on 401.
- Admins can invite users (email delivered via SMTP — Mailhog in dev), and users
  can change their password/username with email confirmation.

```bash
# Log in (returns a bearer token)
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-password"}'

# Current user
curl http://localhost:8000/auth/me -H "Authorization: Bearer <token>"
```

## API Reference

All endpoints except `/health`, `/ready`, `/auth/login`, `/auth/register`, and the
GitHub webhook require an `Authorization: Bearer <token>` header.

### System

```bash
curl http://localhost:8000/health   # liveness
curl http://localhost:8000/ready    # readiness (Redis, MLflow, model-server)
```

### Repositories

```bash
# Register a repo (creates a GitHub push webhook automatically)
curl -X POST http://localhost:8000/repos \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{
    "github_url": "https://github.com/user/repo",
    "branch": "main",
    "notebook_path": "notebooks/train.ipynb",
    "github_token": "ghp_..."
  }'

curl http://localhost:8000/repos                     -H "Authorization: Bearer <token>"
curl -X DELETE http://localhost:8000/repos/1         -H "Authorization: Bearer <token>"

# List the repo's branches (from GitHub)
curl http://localhost:8000/repos/1/branches          -H "Authorization: Bearer <token>"

# Launch a pipeline manually from any branch (no push needed)
curl -X POST http://localhost:8000/repos/1/trigger \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"branch": "testing-ia-agent"}'
```

### Pipelines

```bash
curl "http://localhost:8000/pipelines?page=1&size=20"     -H "Authorization: Bearer <token>"
curl http://localhost:8000/pipelines/{pipeline_id}        -H "Authorization: Bearer <token>"
curl http://localhost:8000/pipelines/{pipeline_id}/logs   -H "Authorization: Bearer <token>"
# Live logs:  ws://localhost:8000/ws/pipelines/{pipeline_id}/logs
```

### AI Insights

```bash
# List AI feedback reports for a pipeline (newest first)
curl http://localhost:8000/pipelines/{pipeline_id}/insights \
  -H "Authorization: Bearer <token>"

# Request a new analysis (async; poll the GET endpoint until status is ready/failed)
curl -X POST http://localhost:8000/pipelines/{pipeline_id}/insights \
  -H "Authorization: Bearer <token>"

# Apply the suggestions: the AI rewrites the notebook and pushes it to the
# testing-ia-agent branch (poll GET for apply_status: queued → applying → pushed)
curl -X POST http://localhost:8000/pipelines/{pipeline_id}/insights/{insight_id}/apply \
  -H "Authorization: Bearer <token>"
```

Insights are generated automatically when a pipeline finishes if the configured
provider is ready and `AI_ADVISOR_ENABLED=true`.

### Models

```bash
curl http://localhost:8000/models                         -H "Authorization: Bearer <token>"

# Predict (auto-reloads the model from MLflow if the server was restarted)
curl -X POST http://localhost:8000/models/iris-classifier/predict \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"data": [[5.1, 3.5, 1.4, 0.2]]}'

curl -X POST http://localhost:8000/models/iris-classifier/rollback \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"version": "1"}'

curl -X DELETE http://localhost:8000/models/iris-classifier -H "Authorization: Bearer <token>"
```

### Webhook (called by GitHub)

```bash
# See scripts/test_pipeline.sh for a signed test request
curl -X POST http://localhost:8000/webhook/github \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=..." \
  -H "X-GitHub-Event: push" \
  -d '{ ... }'
```

## Configuration

All configuration is via environment variables (`.env`). See `.env.example` for the
full annotated list. The most relevant ones:

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_TOKEN` | — | GitHub PAT (repo scope) for webhooks, notebook download, and pushing the AI branch |
| `GITHUB_WEBHOOK_SECRET` | — | Shared secret for verifying webhook signatures |
| `BACKEND_PUBLIC_URL` | `http://localhost:8000` | Public backend URL used to register webhooks |
| `JWT_SECRET_KEY` | — | Secret for signing JWTs (set a long random string) |
| `FIRST_ADMIN_USERNAME` / `FIRST_ADMIN_PASSWORD` | — | Bootstrap admin, created on first startup |
| `AI_ADVISOR_ENABLED` | `true` | Master switch for the AI advisor |
| `AI_ADVISOR_PROVIDER` | `anthropic` | `anthropic` \| `gemini` \| `ollama` |
| `AI_ADVISOR_MODEL` | *(provider default)* | Override the model (e.g. `mistral:7b`, `gemini-2.5-flash`) |
| `ANTHROPIC_API_KEY` | — | Required when provider is `anthropic` |
| `GEMINI_API_KEY` | — | Required when provider is `gemini` |
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Ollama server URL (provider `ollama`) |
| `AUTO_DEPLOY_ON_SUCCESS` | `true` | Auto-deploy models that pass the threshold |
| `MIN_ACCURACY_THRESHOLD` | `0.70` | Minimum accuracy required for auto-deploy |
| `SMTP_*` / `EMAIL_FROM_ADDRESS` | Mailhog | Email delivery for invites/confirmations |
| `VITE_API_URL` / `VITE_WS_URL` | localhost | Frontend build-time API/WS URLs |

## Services and Ports

| Service | Port | URL |
|---------|------|-----|
| Frontend | 3000 | http://localhost:3000 |
| Backend API | 8000 | http://localhost:8000 |
| Model Server | 8001 | http://localhost:8001 |
| MLflow UI | 5000 | http://localhost:5000 |
| Mailhog (dev email UI) | 8025 | http://localhost:8025 |
| PostgreSQL | 5432 | internal |
| Redis | 6379 | redis://localhost:6379 |

## Testing

```bash
# Backend (inside the container)
docker compose run --rm backend pytest tests/ -q

# Frontend
cd frontend
npm install
npm run test          # unit tests (vitest)
npm run test:e2e      # end-to-end (playwright)

# End-to-end pipeline smoke test
GITHUB_WEBHOOK_SECRET=your_secret ./scripts/test_pipeline.sh
```
