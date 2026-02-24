# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

End-to-end MLOps platform: push a notebook to GitHub → get a deployed model. The pipeline is triggered by a GitHub webhook, executed by a Celery worker, tracked in MLflow, and served by a dedicated model-server.

## Repository Layout

```
/                          ← project root (all source lives here, NOT in mlops-platform/)
├── backend/               ← FastAPI app + Celery worker
│   ├── main.py            ← app factory, mounts all routers
│   ├── core/              ← config, github client, notebook_parser, pipeline runner abstraction
│   ├── routers/           ← repos, pipelines, models, webhook
│   ├── tasks/celery_tasks.py  ← run_pipeline task (the full pipeline orchestration)
│   ├── models/schemas.py  ← all SQLModel + Pydantic schemas
│   └── tests/             ← pytest suite
├── model-server/          ← separate FastAPI process for in-memory model serving
│   └── server.py          ← single-file server, models held in _models dict
├── frontend/              ← React + Vite + TailwindCSS SPA
│   └── src/
│       ├── api/client.ts  ← axios instance + all API functions + WS URL builder
│       ├── types/         ← TypeScript interfaces matching backend schemas
│       ├── hooks/         ← useRepos, usePipelines, usePipeline, useWebSocket
│       ├── components/    ← Layout, Spinner, PipelineStatus, RepoCard, LogViewer, MetricsChart
│       └── pages/         ← Dashboard, AddRepository, PipelineDetail, Models
├── notebooks/             ← example training notebooks
├── scripts/               ← test_pipeline.sh
├── docker-compose.yml     ← all six services
└── mlops-platform/        ← legacy stub directory (only contains .env.example)
```

## Commands

### Run everything (Docker)
```bash
cp mlops-platform/.env.example .env   # edit GITHUB_WEBHOOK_SECRET, GITHUB_TOKEN
docker compose up -d --build
```

### Backend (local dev)
```bash
cd backend
pip install -r requirements.txt
python main.py                         # uvicorn with reload

# Run all tests
python -m pytest tests/ -v --cov=. --cov-report=term-missing

# Run a single test file
python -m pytest tests/test_webhook.py -v

# Run a single test
python -m pytest tests/test_webhook.py::test_receive_push_when_ping_event_should_be_ignored -v
```

> Note: `pytest.ini` sets `fail_under = 80` for coverage. `tasks/celery_tasks.py` has 0% coverage by design—it requires a live worker. Overall coverage sits at ~67%.

### Model Server (local dev)
```bash
cd model-server
pip install -r requirements.txt
python server.py

# Run tests
python -m pytest tests/ -v
```

### Frontend (local dev)
```bash
cd frontend
npm install
npm run dev        # Vite dev server on :3000, proxies /api and /ws to localhost:8000

# Unit tests
npx vitest run
npx vitest run --coverage

# E2E tests (requires docker compose running)
npx playwright install chromium
npx playwright test
```

## Architecture

### Data Flow
```
GitHub Push → POST /webhook/github (HMAC-SHA256 verified)
           → creates Pipeline record in SQLite (status=queued)
           → CeleryPipelineRunner.run() enqueues to `pipelines` queue
           → Celery worker: run_pipeline task
               1. download   – GitHub API → raw notebook bytes
               2. validate   – notebook_parser: check required mlops:* tags
               3. execute    – papermill injects MODEL_OUTPUT_PATH, PIPELINE_ID, MLFLOW_TRACKING_URI
               4. register   – mlflow.log_artifact + mlflow.start_run
               5. deploy     – POST /internal/load/{model_name} to model-server (if accuracy ≥ threshold)
```

### State Management (Dual-Write)
- **Redis**: real-time pub/sub on `pipeline:{id}:logs` channel + list for late-joining WebSocket clients. 24h TTL.
- **SQLite via SQLModel**: durable pipeline status, phases (JSON), and metrics. The Celery worker creates its own `create_engine()` and `Session` (sync) since it runs outside the async FastAPI context.

### Pipeline Runner Abstraction
`core/pipeline.py` defines a `PipelineRunner` ABC with `run()`, `get_status()`, `cancel()`. `CeleryPipelineRunner` is the only real implementation. `KubernetesPipelineRunner` raises `NotImplementedError`. Selected via `RUNNER_BACKEND` env var.

### Model Server
The model-server is a standalone FastAPI app (`model-server/server.py`). Models are loaded from MLflow artifacts into a process-level `_models: dict[str, _ModelEntry]` dict. The backend proxies `/models/{name}/predict` to the model-server's `/predict/{name}` endpoint. Loading is triggered by the Celery task via `POST /internal/load/{model_name}`.

### Notebook Contract
Notebooks must have cells tagged (via Jupyter cell metadata) with:
- `mlops:config` — defines `MODEL_NAME = "..."` and `VERSION = "..."`
- `mlops:preprocessing` — data preparation
- `mlops:training` — model training
- `mlops:export` — `joblib.dump(model, MODEL_OUTPUT_PATH)`

Optional: `mlops:data`, `mlops:evaluation`, `parameters` (papermill).

### Frontend Patterns
- All API calls go through `src/api/client.ts` (axios instance + exported functions).
- Server state via `@tanstack/react-query` (hooks in `src/hooks/usePipelines.ts`).
- Real-time logs via `src/hooks/useWebSocket.ts` (auto-reconnect, message buffering); only connects when pipeline is `running` or `queued`.
- `VITE_API_URL` and `VITE_WS_URL` control backend URLs; defaults to `localhost:8000`.

## Known Bugs

**structlog `event` keyword clash in webhook router** (`backend/routers/webhook.py:61`):
```python
# BUG: causes TypeError for non-push events (ping, PR, issues) → 500 instead of 200
logger.info("webhook.ignored_event", event=x_github_event)
# FIX:
logger.info("webhook.ignored_event", event_type=x_github_event)
```
In structlog, the first positional arg to `info()` is named `event`, so passing `event=` as a keyword conflicts.

## Services and Ports

| Service      | Port | Notes                              |
|--------------|------|------------------------------------|
| Backend API  | 8000 | FastAPI + uvicorn                  |
| Model Server | 8001 | Separate FastAPI process           |
| MLflow UI    | 5000 | `ghcr.io/mlflow/mlflow:v2.9.2`     |
| Redis        | 6379 | Celery broker + pub/sub            |
| Frontend     | 3000 | nginx in Docker, Vite dev locally  |

## Key Configuration Variables

All read from `.env` via pydantic-settings (`core/config.py`):

| Variable | Default | Purpose |
|---|---|---|
| `GITHUB_WEBHOOK_SECRET` | `changeme` | HMAC-SHA256 webhook verification |
| `GITHUB_TOKEN` | `` | GitHub API calls |
| `REDIS_URL` | `redis://redis:6379/0` | Celery broker + pub/sub |
| `DATABASE_URL` | `sqlite:///./mlops.db` | SQLModel database |
| `RUNNER_BACKEND` | `celery` | `celery` or `kubernetes` |
| `AUTO_DEPLOY_ON_SUCCESS` | `true` | Auto-deploy after pipeline |
| `MIN_ACCURACY_THRESHOLD` | `0.70` | Minimum accuracy for deployment |
| `FRONTEND_URL` | `http://localhost:3000` | CORS allowed origin |
