import type { ReactNode } from 'react';
import { CodeSample, LayersBlock } from '../components/docs/ManualBlocks';
import {
  ArchitectureDiagram,
  GrafanaProxyDiagram,
  LocalBootDiagram,
  MlopsLoopDiagram,
  TechTable,
} from '../components/docs/TechWireframes';

export type TechChapterId =
  | 'deployment'
  | 'architecture'
  | 'core-stack'
  | 'ml-ai-stack'
  | 'ops-testing';

export interface TechChapter {
  id: TechChapterId;
  number: string;
  title: string;
  blurb: string;
}

export interface TechSection {
  id: string;
  chapter: TechChapterId;
  nav: string;
  title: string;
  lede: string;
  keywords: string[];
  wireframe?: ReactNode;
  anatomy?: { n: number; label: string; text: ReactNode }[];
  steps?: { title: string; body: ReactNode }[];
  fields?: { term: string; text: ReactNode }[];
  notes?: { tone?: 'tip' | 'watch'; title?: string; body: ReactNode }[];
  qa?: { q: string; a: ReactNode }[];
  extra?: ReactNode;
}

export const TECH_CHAPTERS: TechChapter[] = [
  {
    id: 'deployment',
    number: '01',
    title: 'Local deployment',
    blurb: 'Prerequisites, .env setup, Docker Compose startup, published ports, and health verification.',
  },
  {
    id: 'architecture',
    number: '02',
    title: 'System architecture',
    blurb: 'How containers communicate over mlops-network, the self-improving MLOps loop, and Medallion data flow.',
  },
  {
    id: 'core-stack',
    number: '03',
    title: 'Core application stack',
    blurb: 'Frontend SPA, FastAPI control plane, Celery + Papermill worker, and PostgreSQL + Alembic persistence.',
  },
  {
    id: 'ml-ai-stack',
    number: '04',
    title: 'Data, ML & AI stack',
    blurb: 'MinIO S3 storage, DuckDB & PyArrow, MLflow tracking, self-healing Model Server, AI Advisor, and Superset MCP.',
  },
  {
    id: 'ops-testing',
    number: '05',
    title: 'Observability & testing',
    blurb: 'Prometheus exporters, the Grafana Auth-Proxy & SQL allow-list, automated test suites, and version pins.',
  },
];

export const TECH_SECTIONS: TechSection[] = [
  /* ================================================================== */
  /*  01 · Local deployment                                             */
  /* ================================================================== */
  {
    id: 'prerequisites',
    chapter: 'deployment',
    nav: 'Prerequisites',
    title: 'System requirements and credentials',
    lede:
      'Maia runs as a multi-container Docker Compose stack. Before launching the platform on your local machine, ensure your environment has the container runtime and the external credentials needed for GitHub integration and AI analysis.',
    keywords: [
      'prerequisites',
      'requirements',
      'docker',
      'docker compose',
      'github token',
      'ngrok',
      'ollama',
      'gemini',
      'anthropic',
    ],
    fields: [
      {
        term: 'Docker Engine & Compose v2',
        text: 'Required to build and orchestrate the 19 services (17 long-running containers + 2 one-shot init containers) and 10 persistent volumes on the isolated mlops-network bridge.',
      },
      {
        term: 'GitHub Personal Access Token',
        text: 'A token with repo scope (GITHUB_TOKEN) so the backend and worker can register push webhooks, download training notebooks, and push AI-improved branches.',
      },
      {
        term: 'Public Webhook Tunnel (optional)',
        text: 'Use ngrok or Cloudflare Tunnel to expose port 8000 as BACKEND_PUBLIC_URL if you want GitHub push events to trigger runs automatically on localhost. Manual runs from the UI work without a tunnel.',
      },
      {
        term: 'AI Provider (optional)',
        text: 'An Anthropic API key (Claude), a Google AI Studio key (Gemini), or a local Ollama server (free, private, reachable via host.docker.internal:11434).',
      },
    ],
    notes: [
      {
        tone: 'tip',
        title: 'Running without external API keys',
        body: 'If you want a 100% local and free setup, install Ollama on your host machine, pull llama3.1, and set AI_ADVISOR_PROVIDER=ollama in .env.',
      },
    ],
  },

  {
    id: 'quick-start',
    chapter: 'deployment',
    nav: 'Quick start',
    title: 'Booting the stack on your local machine',
    lede:
      'A single Docker Compose command builds the images, initializes the S3 buckets and synthetic hospital database, applies all Alembic database migrations, and starts every microservice.',
    keywords: [
      'quick start',
      'deploy',
      'local',
      'docker compose up',
      'alembic',
      'migrations',
      'healthcheck',
      'bootstrap admin',
    ],
    wireframe: <LocalBootDiagram />,
    anatomy: [
      {
        n: 1,
        label: 'Environment & image build',
        text: 'Copy .env.example to .env, set your secrets, and run docker compose up -d --build.',
      },
      {
        n: 2,
        label: 'Core data stores',
        text: 'PostgreSQL 16, Redis 7, and MinIO start first and must pass their healthchecks before any application service boots.',
      },
      {
        n: 3,
        label: 'Idempotent bootstrap containers',
        text: 'minio-init creates the datasets and mlflow S3 buckets; hospital-init seeds the simulated Hospital Information System from Synthea records.',
      },
      {
        n: 4,
        label: 'Automatic migrations & roles',
        text: 'backend/entrypoint.sh runs alembic upgrade head, provisions the read-only grafana_ro PostgreSQL role, and creates the initial admin user.',
      },
      {
        n: 5,
        label: 'Ready endpoints',
        text: 'Once healthchecks pass, the React SPA (:3000), FastAPI (:8000), Model Server (:8001), MLflow (:5000), and Superset (:8088) accept traffic.',
      },
    ],
    steps: [
      {
        title: 'Create your .env file',
        body: 'Copy .env.example to .env at the repository root and fill in FIRST_ADMIN_USERNAME, FIRST_ADMIN_PASSWORD (between 8 and 72 bytes), JWT_SECRET_KEY, and GITHUB_TOKEN.',
      },
      {
        title: 'Build and start all containers',
        body: 'Run docker compose up -d --build. First-time builds compile the Frontend, Backend/Worker, MLflow (with boto3), Model Server, Superset, and Hospital loader.',
      },
      {
        title: 'Verify service health',
        body: 'Query the health and readiness endpoints on the backend (:8000), model server (:8001), MLflow (:5000), and MinIO (:9000).',
      },
      {
        title: 'Sign in at http://localhost:3000',
        body: 'Open the web application and sign in with the bootstrap admin credentials defined in .env.',
      },
    ],
    extra: (
      <CodeSample
        title="Local deployment commands"
        language="bash"
        code={`# 1. Copy the template environment file
cp .env.example .env

# 2. Build images and start the entire stack in the background
docker compose up -d --build

# 3. Verify core service health and readiness
curl http://localhost:8000/health              # Backend liveness
curl http://localhost:8000/ready               # Backend readiness (Redis, MLflow, Model Server)
curl http://localhost:8001/health              # Model Server
curl http://localhost:5000/health              # MLflow tracking server
curl http://localhost:9000/minio/health/live   # MinIO S3 storage

# 4. Follow logs if debugging startup
docker compose logs -f backend worker`}
      />
    ),
    notes: [
      {
        tone: 'watch',
        title: 'Never skip entrypoint migrations',
        body: 'Database schema migrations run automatically via backend/entrypoint.sh (alembic upgrade head) before Uvicorn starts. Do not override the container entrypoint without running Alembic first.',
      },
    ],
  },

  {
    id: 'services-ports',
    chapter: 'deployment',
    nav: 'Services and ports',
    title: 'Docker Compose services, ports, and volumes',
    lede:
      'All 19 Compose services (17 long-running containers and 2 one-shot init containers) run on the internal mlops-network bridge. Only the interfaces a developer or browser needs to reach directly publish a host port; internal services like Grafana and the Superset MCP server stay private.',
    keywords: [
      'ports',
      'services',
      'containers',
      'docker-compose.yml',
      'volumes',
      'localhost',
      '3000',
      '8000',
      '8001',
      '5000',
      '9000',
      '9001',
      '8088',
      'superset-db',
      'minio-init',
      'hospital-init',
    ],
    extra: (
      <TechTable
        headers={['Service (Container)', 'Host Port / URL', 'Role in the stack']}
        rows={[
          [
            'frontend (mlops-frontend)',
            'http://localhost:3000',
            'Nginx serving the compiled React 18 + Vite SPA.',
          ],
          [
            'backend (mlops-backend)',
            'http://localhost:8000',
            'FastAPI server: REST API, GitHub webhook receiver, WebSocket log streamer, and /grafana auth-proxy.',
          ],
          [
            'worker (mlops-worker)',
            'Internal only',
            'Celery worker (concurrency=2) executing Papermill notebooks, Medallion ETL, DuckDB Gold builds, and AI Advisor tasks.',
          ],
          [
            'model-server (mlops-model-server)',
            'http://localhost:8001',
            'FastAPI inference microservice serving deployed models under /predict/{model} with auto-reload from MLflow/MinIO.',
          ],
          [
            'mlflow (mlops-mlflow)',
            'http://localhost:5000',
            'MLflow 2.9.2 tracking server using SQLite for metadata and s3://mlflow/ on MinIO for artifacts.',
          ],
          [
            'minio (mlops-minio)',
            'API :9000 · Console :9001',
            'S3-compatible object storage holding the datasets and mlflow buckets.',
          ],
          [
            'minio-init (mlops-minio-init)',
            'One-shot bootstrap',
            'Idempotent init container that runs mc mb --ignore-existing for the datasets and mlflow S3 buckets, then exits.',
          ],
          [
            'superset (mlops-superset)',
            'http://localhost:8088',
            'Apache Superset BI server querying Gold Parquet layers via DuckDB and embedding dashboards in the KPI Maker.',
          ],
          [
            'superset-mcp (mlops-superset-mcp)',
            'Internal :5008 (/mcp)',
            'Model Context Protocol server exposing Superset tools to the KPI Maker LLM agent.',
          ],
          [
            'superset-db (mlops-superset-db)',
            'Internal :5432',
            'Dedicated PostgreSQL 16 database storing Apache Superset metadata (charts, dashboards, and Superset users).',
          ],
          [
            'grafana (mlops-grafana)',
            'Proxied at :8000/grafana',
            'Grafana 11.3 embedded dashboards (My Models, Platform, Resources). No host port is published.',
          ],
          [
            'prometheus (mlops-prometheus)',
            'http://localhost:9090',
            'Time-series telemetry scraping FastAPI /metrics, cAdvisor, and node-exporter (15-day retention).',
          ],
          [
            'cadvisor (mlops-cadvisor)',
            'Internal only',
            'Exporter reading per-container cgroup CPU, memory working set, and network I/O for the Resources dashboard.',
          ],
          [
            'node-exporter (mlops-node-exporter)',
            'Internal only',
            'Exporter reading host-level CPU, RAM, filesystem usage, and load averages for the Resources dashboard.',
          ],
          [
            'postgres (mlops-postgres)',
            'Internal :5432',
            'Primary PostgreSQL 16 database storing users, projects, repositories, pipelines, deployments, and insights.',
          ],
          [
            'hospital-db (mlops-hospital-db)',
            'localhost:5433 → :5432',
            'Simulated external Hospital Information System holding Synthea clinical records.',
          ],
          [
            'hospital-init (mlops-hospital-init)',
            'One-shot bootstrap',
            'Idempotent loader container that seeds hospital-db with Synthea records and degraded clinical free text, then exits.',
          ],
          [
            'redis (mlops-redis)',
            'localhost:6379',
            'Redis 7 broker for Celery queues (pipelines, celery) and pub/sub channels for live WebSocket logs.',
          ],
          [
            'mailhog (mlops-mailhog)',
            'UI :8025 · SMTP :1025',
            'Development SMTP server capturing user invitation and credential confirmation emails.',
          ],
        ]}
      />
    ),
    fields: [
      {
        term: 'postgres-data & superset-db-data',
        text: 'Separate PostgreSQL volumes so platform migrations (Alembic) and Superset metadata never collide.',
      },
      {
        term: 'minio-data & mlflow-data',
        text: 'minio-data stores all raw datasets, Bronze/Silver/Gold Parquet files, and MLflow model artifacts; mlflow-data stores mlflow.db.',
      },
      {
        term: 'prometheus-data & grafana-data',
        text: 'Persist 15 days of Prometheus TSDB metrics and Grafana’s auto-provisioned viewer state.',
      },
      {
        term: 'hospital-data',
        text: 'Holds the synthetic Synthea clinical tables so hospital-init only needs to seed them once.',
      },
    ],
  },

  {
    id: 'env-config',
    chapter: 'deployment',
    nav: 'Environment (.env)',
    title: 'Environment variables reference',
    lede:
      'All services read their configuration from the root .env file. Below are the critical variables grouped by subsystem.',
    keywords: [
      'env',
      '.env',
      'configuration',
      'variables',
      'JWT_SECRET_KEY',
      'FIRST_ADMIN_PASSWORD',
      'AI_ADVISOR_PROVIDER',
      'MINIO_ENDPOINT',
      'GRAFANA_ENABLED',
      'SUPERSET_GUEST_TOKEN_SECRET',
    ],
    extra: (
      <TechTable
        headers={['Variable', 'Default / Example', 'Purpose']}
        rows={[
          [
            'FIRST_ADMIN_USERNAME / PASSWORD',
            'admin / 8–72 chars',
            'Bootstrap administrator created on first boot when the users table is empty. Passwords over 72 bytes are rejected by bcrypt.',
          ],
          [
            'JWT_SECRET_KEY',
            'long-random-string',
            'HMAC secret used by python-jose to sign and verify bearer tokens.',
          ],
          [
            'GITHUB_TOKEN',
            'ghp_...',
            'Personal Access Token used to register webhooks, fetch notebooks, and push the testing-ia-agent branch.',
          ],
          [
            'GITHUB_OAUTH_CLIENT_ID / SECRET',
            'Optional',
            'Enables "Sign in with GitHub" OAuth flow (callback: <BACKEND_PUBLIC_URL>/auth/github/callback).',
          ],
          [
            'GITHUB_WEBHOOK_SECRET',
            'change-me-webhook-secret',
            'Shared HMAC-SHA256 secret used to validate X-Hub-Signature-256 on incoming GitHub push events.',
          ],
          [
            'AI_ADVISOR_PROVIDER & MODEL',
            'anthropic | gemini | ollama',
            'Selects the LLM provider and optional model override (e.g. claude-opus-4-8, gemini-pro-latest, llama3.1).',
          ],
          [
            'ANTHROPIC_API_KEY / GEMINI_API_KEY',
            'Provider API key',
            'Credentials for cloud LLM providers. Not needed when AI_ADVISOR_PROVIDER=ollama.',
          ],
          [
            'OLLAMA_BASE_URL',
            'http://host.docker.internal:11434',
            'Address of the Ollama server as seen from inside the backend/worker containers.',
          ],
          [
            'MINIO_ROOT_USER / PASSWORD',
            'minioadmin / minioadmin',
            'Credentials for the MinIO S3 API (:9000) and web console (:9001).',
          ],
          [
            'MINIO_BUCKET_DATASETS / MLFLOW',
            'datasets / mlflow',
            'S3 buckets automatically created by minio-init for datasets and MLflow artifacts.',
          ],
          [
            'AUTO_DEPLOY_ON_SUCCESS & MIN_ACCURACY_THRESHOLD',
            'true / 0.70',
            'Default deployment gate when a project has not configured custom Deployment rules.',
          ],
          [
            'GRAFANA_ENABLED & GRAFANA_DB_USER',
            'true / grafana_ro',
            'Enables the /grafana reverse proxy and provisions the read-only PostgreSQL role.',
          ],
          [
            'SUPERSET_GUEST_TOKEN_SECRET',
            'shared-secret',
            'Shared secret between FastAPI and Superset used to sign embedded dashboard guest tokens.',
          ],
          [
            'DASHBOARD_AGENT_PROVIDER / MODEL',
            'gemini | openai (Groq/OpenRouter)',
            'Function-calling LLM that drives the Superset MCP server (:5008) in the KPI Maker.',
          ],
        ]}
      />
    ),
    notes: [
      {
        tone: 'tip',
        title: 'Using Ollama on the host machine',
        body: 'docker-compose.yml maps host.docker.internal:host-gateway on both backend and worker, so OLLAMA_BASE_URL=http://host.docker.internal:11434 works out of the box on Windows, macOS, and Linux.',
      },
    ],
  },

  /* ================================================================== */
  /*  02 · System architecture                                          */
  /* ================================================================== */
  {
    id: 'topology',
    chapter: 'architecture',
    nav: 'Container topology',
    title: 'Container topology and network boundaries',
    lede:
      'Maia separates synchronous API handling from heavy compute and storage. The FastAPI control plane handles auth, webhooks, and proxying, while Celery workers execute notebooks and data pipelines asynchronously.',
    keywords: [
      'architecture',
      'topology',
      'network',
      'mlops-network',
      'containers',
      'control plane',
      'execution plane',
    ],
    wireframe: <ArchitectureDiagram />,
    anatomy: [
      {
        n: 1,
        label: 'Client & edge (Frontend SPA)',
        text: 'React 18 SPA served on :3000. Communicates with FastAPI over REST (:8000) and subscribes to live pipeline logs over WebSockets (ws://localhost:8000).',
      },
      {
        n: 2,
        label: 'Control plane (Backend API)',
        text: 'Stateless FastAPI service on :8000. Enforces JWT authentication, ownership isolation, GitHub webhook verification, and the /grafana security proxy.',
      },
      {
        n: 3,
        label: 'Execution plane (Celery Worker)',
        text: 'Runs two concurrent worker processes listening on the pipelines and celery queues. Executes Papermill notebooks, Medallion extractions, DuckDB Gold queries, and LLM advisor calls.',
      },
      {
        n: 4,
        label: 'State & messaging (PostgreSQL + Redis)',
        text: 'PostgreSQL 16 stores relational state; Redis 7 acts as the Celery task broker and pub/sub bus for streaming cell-by-cell execution logs.',
      },
      {
        n: 5,
        label: 'Object & experiment store (MinIO + MLflow)',
        text: 'MinIO provides S3 storage for datasets, Medallion Parquet layers, and MLflow model artifacts. Eliminates shared local volumes so the architecture is Kubernetes-ready.',
      },
      {
        n: 6,
        label: 'Serving, BI & observability',
        text: 'Model Server (:8001) serves REST predictions; Superset (:8088) and superset-mcp (:5008) power the KPI Maker; Prometheus (:9090) and Grafana provide telemetry.',
      },
    ],
  },

  {
    id: 'mlops-loop',
    chapter: 'architecture',
    nav: 'Self-improving loop',
    title: 'The self-improving MLOps pipeline loop',
    lede:
      'Every training run follows a deterministic six-stage loop that connects GitHub version control, isolated notebook execution, automated quality gates, and LLM-driven code improvement.',
    keywords: [
      'loop',
      'pipeline',
      'papermill',
      'webhook',
      'quality gate',
      'testing-ia-agent',
      'apply and push',
      'mlflow',
    ],
    wireframe: <MlopsLoopDiagram />,
    anatomy: [
      {
        n: 1,
        label: 'Trigger (Webhook or Manual Run)',
        text: 'A git push to a linked repository fires a signed webhook to POST /webhook/github (or a user triggers a run on any branch from the UI).',
      },
      {
        n: 2,
        label: 'Input mounting (DATASET_PATH)',
        text: 'The worker downloads either the repository’s active dataset or the selected Medallion layer (Bronze, Silver, or versioned Gold Parquet) from MinIO.',
      },
      {
        n: 3,
        label: 'Papermill execution & MLflow tracking',
        text: 'The worker validates required cell tags (mlops:config, preprocessing, training, export), injects runtime parameters, executes the notebook with Papermill, and logs metrics/artifacts to MLflow.',
      },
      {
        n: 4,
        label: 'Quality gate & auto-deployment',
        text: 'The run’s deciding metric is evaluated against the project’s Deployment rules (threshold, direction, and beat-active-champion check). Qualifying models deploy immediately to Model Server (:8001).',
      },
      {
        n: 5,
        label: 'AI Training Advisor analysis',
        text: 'An LLM inspects the notebook source code, phase logs, and historical run metrics to produce a structured Markdown diagnosis and prioritized code recommendations.',
      },
      {
        n: 6,
        label: 'Apply & push (testing-ia-agent)',
        text: 'Clicking "Apply & push" has the LLM rewrite the notebook cells while preserving mlops:config and mlops:export, committing the result to the testing-ia-agent branch on GitHub.',
      },
    ],
  },

  {
    id: 'medallion-flow',
    chapter: 'architecture',
    nav: 'Medallion data flow',
    title: 'Medallion data architecture (Bronze → Silver → Gold)',
    lede:
      'Before data reaches a training notebook or a KPI dashboard, the Data Factory processes raw sources through three immutable Parquet layers stored in MinIO.',
    keywords: [
      'medallion',
      'bronze',
      'silver',
      'gold',
      'duckdb',
      'parquet',
      'pyarrow',
      'synthea',
      'hospital-db',
    ],
    extra: <LayersBlock />,
    fields: [
      {
        term: 'External connectors & Synthea HIS',
        text: 'Supports PostgreSQL, MySQL, CSV, Parquet, and Excel uploads, plus the bundled hospital-db (:5433) containing synthetic patient records with intentionally uncoded clinical free text.',
      },
      {
        term: 'PyArrow Parquet storage',
        text: 'Every extraction and transformation is persisted as columnar Parquet in MinIO using pyarrow==14.0.2, enabling fast schema inspection and zero-copy reads.',
      },
      {
        term: 'In-process DuckDB Gold engine',
        text: 'Gold tables are defined as SQL queries over Silver Parquet files and executed in-process with DuckDB 1.1.3—producing versioned builds (v1, v2, v3…) without standing up a separate warehouse cluster.',
      },
      {
        term: 'Pinning pipeline inputs',
        text: 'PUT /repos/{id}/pipeline-input binds a repository to the latest Gold build, a specific Gold version, or a source’s Silver/Bronze history. Every run records the exact mounted artifact in mounted_input.',
      },
    ],
  },

  /* ================================================================== */
  /*  03 · Core application stack                                       */
  /* ================================================================== */
  {
    id: 'frontend-stack',
    chapter: 'core-stack',
    nav: 'Frontend SPA',
    title: 'Frontend technologies (frontend/)',
    lede:
      'The user interface is a TypeScript single-page application built with React 18 and Vite 6. It combines an interactive node canvas for pipelines, real-time WebSocket log streaming, WebGL shaders on the landing page, and embedded BI dashboards.',
    keywords: [
      'frontend',
      'react',
      'vite',
      'typescript',
      'tailwind',
      'xyflow',
      'react-query',
      'recharts',
      'motion',
      'ogl',
      'superset-ui',
    ],
    extra: (
      <TechTable
        headers={['Technology', 'Version', 'How Maia uses it']}
        rows={[
          [
            'React & React DOM',
            '18.3.1',
            'Component architecture, custom hooks, and context providers (AuthContext).',
          ],
          [
            'TypeScript & Vite',
            '5.6.3 / 6.0.0',
            'Strict static typing (tsc --noEmit) and fast ES module bundling with build-time VITE_API_URL and VITE_WS_URL injection.',
          ],
          [
            'Tailwind CSS',
            '3.4.15',
            'Utility-first styling for the dark application workspace and CSS custom-property theming for the editorial manuals.',
          ],
          [
            '@xyflow/react (React Flow)',
            '12.12.0',
            'Powers the interactive Pipeline Canvas (/pipelines/canvas/:projectId) displaying the 9 stage nodes, live run edges, and stage drawers.',
          ],
          [
            '@tanstack/react-query',
            '5.62.0',
            'Declarative server-state caching, background polling for active pipeline runs, and automatic cache invalidation after mutations.',
          ],
          [
            'React Router DOM',
            '6.28.0',
            'Client-side routing, protected route guards (RequireAuth), and legacy bookmark redirects.',
          ],
          [
            'Recharts',
            '2.13.3',
            'Renders metric history charts, accuracy comparisons across branches, and model input response curves.',
          ],
          [
            'Motion & OGL',
            '14.1.0 / 1.0.11',
            'Scroll-linked animations on the Landing page and the interactive WebGL MicroSlats background shader.',
          ],
          [
            '@superset-ui/embedded-sdk',
            '0.4.0',
            'Mounts Apache Superset dashboards inside an iframe in the KPI Maker using short-lived guest tokens signed by the backend.',
          ],
          [
            'prism-react-renderer & lucide-react',
            '2.4.1 / 1.55.0',
            'Syntax highlighting for notebook cells in the stage drawer and consistent vector iconography across the UI.',
          ],
        ]}
      />
    ),
  },

  {
    id: 'backend-api',
    chapter: 'core-stack',
    nav: 'Backend API',
    title: 'Backend API and security layer (backend/)',
    lede:
      'The backend is a Python FastAPI application served by Uvicorn. It acts as the single entry point for the SPA, GitHub webhooks, live WebSocket streams, and embedded Grafana panels.',
    keywords: [
      'backend',
      'fastapi',
      'uvicorn',
      'pydantic',
      'jwt',
      'bcrypt',
      'passlib',
      'websockets',
      'httpx',
      'aiosmtplib',
      'structlog',
    ],
    extra: (
      <TechTable
        headers={['Package', 'Version', 'Role in backend/']}
        rows={[
          [
            'FastAPI & Uvicorn',
            '0.115.0 / 0.34.0',
            'ASGI web framework and server exposing modular routers (auth, repos, projects, pipelines, models, insights, grafana, webhook).',
          ],
          [
            'Pydantic & Pydantic Settings',
            '2.9.2 / 2.6.0',
            'Request/response schema validation and typed environment configuration loading.',
          ],
          [
            'python-jose & passlib[bcrypt]',
            '3.3.0 / 1.7.4 (bcrypt 3.2.2)',
            'Stateless JWT bearer authentication and password hashing, plus GitHub OAuth 2.0 callback exchange.',
          ],
          [
            'httpx',
            '0.28.0',
            'Async HTTP client used for GitHub REST API calls, Model Server health/predict proxying, Ollama requests, and the Grafana reverse proxy.',
          ],
          [
            'aiosmtplib',
            '3.0.2',
            'Asynchronous SMTP client delivering user invitations and email/password confirmation links (captured by Mailhog in dev).',
          ],
          [
            'structlog',
            '24.4.0',
            'Structured JSON/console logging across API requests and background tasks.',
          ],
        ]}
      />
    ),
    notes: [
      {
        tone: 'watch',
        title: 'Multi-tenant resource isolation returns 404',
        body: 'Every repository, project, pipeline, dataset, and model is scoped to repositories.owner_id. When a user requests a resource owned by someone else, the backend returns 404 Not Found rather than 403 Forbidden so resource IDs cannot be enumerated.',
      },
    ],
  },

  {
    id: 'worker-queue',
    chapter: 'core-stack',
    nav: 'Worker & Papermill',
    title: 'Asynchronous worker and Papermill execution',
    lede:
      'Training a model or transforming a dataset can take minutes, so the API never runs notebooks in-process. Instead, it enqueues jobs in Redis for the Celery worker.',
    keywords: [
      'celery',
      'redis',
      'worker',
      'papermill',
      'nbformat',
      'nbclient',
      'ipykernel',
      'websocket',
      'pubsub',
    ],
    extra: (
      <TechTable
        headers={['Package', 'Version', 'Responsibility']}
        rows={[
          [
            'Celery & Kombu',
            '5.4.0 / 5.4.2',
            'Distributed task queue running with --concurrency=2 on the pipelines and celery queues.',
          ],
          [
            'Redis',
            '7-alpine (client 5.2.1)',
            'Message broker for Celery tasks and low-latency pub/sub channel broadcasting live pipeline phase updates and logs to FastAPI WebSockets.',
          ],
          [
            'Papermill',
            '2.6.0',
            'Parametrizes and executes Jupyter notebooks headlessly by injecting DATASET_PATH, MODEL_OUTPUT_PATH, PIPELINE_ID, and MLFLOW_TRACKING_URI.',
          ],
          [
            'nbformat, nbclient & ipykernel',
            '5.10.4 / 0.10.1 / 6.29.5',
            'Parses .ipynb JSON, validates required mlops:* cell tags before execution, captures per-cell outputs/tracebacks, and rewrites cells when applying AI Advisor suggestions.',
          ],
          [
            'scikit-learn, pandas, numpy & joblib',
            '1.5.2 / 2.2.3 / 1.26.4 / 1.4.2',
            'Pre-installed scientific stack inside the worker and model-server so training notebooks and serialized joblib models share identical library versions.',
          ],
        ]}
      />
    ),
  },

  {
    id: 'database-migrations',
    chapter: 'core-stack',
    nav: 'Database & Alembic',
    title: 'Relational persistence and Alembic migrations',
    lede:
      'Maia uses three isolated PostgreSQL 16 instances across the stack so platform state, BI metadata, and simulated external clinical records never share credentials or schemas.',
    keywords: [
      'database',
      'postgresql',
      'sqlmodel',
      'alembic',
      'migrations',
      'schema',
      'superset-db',
      'hospital-db',
    ],
    fields: [
      {
        term: 'PostgreSQL 16 (mlops-postgres)',
        text: 'The platform database (:5432 internal). Stores users, invitations, projects, data sources, medallion builds, repositories, pipelines, deployments, and AI insights.',
      },
      {
        term: 'SQLModel 0.0.22 & psycopg2-binary',
        text: 'Combines SQLAlchemy ORM models and Pydantic validation in backend/models/ so database tables and API payloads share a single definition.',
      },
      {
        term: 'Alembic 1.13.3 (backend/alembic/)',
        text: 'Manages incremental schema migrations. Runs automatically via alembic upgrade head in backend/entrypoint.sh every time the backend container boots.',
      },
      {
        term: 'superset-db & hospital-db',
        text: 'Dedicated PostgreSQL 16 containers: superset-db holds Apache Superset charts/dashboards, while hospital-db (:5433) emulates an external hospital transactional database.',
      },
    ],
  },

  /* ================================================================== */
  /*  04 · Data, ML & AI stack                                          */
  /* ================================================================== */
  {
    id: 'object-storage-duckdb',
    chapter: 'ml-ai-stack',
    nav: 'MinIO & DuckDB',
    title: 'Object storage (MinIO) and in-process analytics (DuckDB)',
    lede:
      'All binary assets—uploaded files, Bronze/Silver/Gold Parquet tables, and trained MLflow model artifacts—live in S3-compatible object storage rather than local Docker volumes.',
    keywords: [
      'minio',
      's3',
      'boto3',
      'duckdb',
      'pyarrow',
      'openpyxl',
      'parquet',
      'buckets',
    ],
    fields: [
      {
        term: 'MinIO (sanwilmer/minio:1.0)',
        text: 'Exposes the S3 API on :9000 and the administration console on :9001. On startup, minio-init runs mc mb --ignore-existing for the datasets and mlflow buckets.',
      },
      {
        term: 'boto3 1.35.76',
        text: 'Used by the backend, worker, MLflow server, and Model Server to upload, stream, and download datasets and model artifacts over S3.',
      },
      {
        term: 'DuckDB 1.1.3',
        text: 'Embedded analytical SQL engine used in two places: inside the worker to materialize Gold Parquet builds over Silver tables, and inside Superset to query Gold buckets directly.',
      },
      {
        term: 'PyArrow 14.0.2 & OpenPyXL 3.1.5',
        text: 'Powers fast Parquet reading/writing across every Medallion stage and Excel (.xlsx) ingestion in the Data Factory.',
      },
    ],
  },

  {
    id: 'mlflow-tracking',
    chapter: 'ml-ai-stack',
    nav: 'MLflow tracking',
    title: 'Experiment tracking and artifact store (MLflow)',
    lede:
      'Every pipeline execution creates an MLflow run that records hyperparameters, evaluation metrics, training feature distributions, and the serialized model file.',
    keywords: [
      'mlflow',
      'tracking',
      'experiment',
      'artifacts',
      's3://mlflow',
      'sqlite',
      'log_metric',
    ],
    fields: [
      {
        term: 'Custom MLflow 2.9.2 image (mlflow/Dockerfile)',
        text: 'Bakes boto3 directly into the image so the server starts immediately without running pip install on every container boot.',
      },
      {
        term: 'Hybrid backend & artifact store',
        text: 'Uses --backend-store-uri sqlite:///mlflow/mlflow.db for fast run/metric indexing and --default-artifact-root s3://mlflow/ on MinIO for model binaries.',
      },
      {
        term: 'TRAINING_FEATURES_PATH & MODEL_NOTES_PATH',
        text: 'Optional artifacts a notebook can write during training so the Models page can display per-feature training ranges, units, and response curves.',
      },
    ],
  },

  {
    id: 'model-server',
    chapter: 'ml-ai-stack',
    nav: 'Model Server',
    title: 'Self-healing Model Server (model-server/)',
    lede:
      'Approved models are served by a dedicated FastAPI microservice on port 8001, keeping inference isolated from the control plane and training worker.',
    keywords: [
      'model-server',
      'inference',
      'predict',
      'rollback',
      'self-healing',
      'auto-reload',
      'joblib',
      'public link',
    ],
    steps: [
      {
        title: 'Dynamic loading from MLflow / MinIO',
        body: 'When a pipeline passes its Deployment rules (or a user clicks Deploy / Rollback), the backend instructs model-server (:8001) to download the joblib artifact from s3://mlflow/ and mount it in memory under /predict/{model_name}.',
      },
      {
        title: 'Transparent self-healing on container restart',
        body: 'Because loaded models live in RAM, restarting model-server clears its registry. If a POST /models/{name}/predict call receives a 404 "model not loaded", the backend automatically fetches the active deployment’s MLflow run ID from Postgres, reloads the artifact on model-server, and retries the prediction transparently.',
      },
      {
        title: 'Version rollback & public share links',
        body: 'Users can switch the serving version to any historical run in one click, or mint revocable public share tokens to let external testers query the model in the browser without an account.',
      },
    ],
  },

  {
    id: 'ai-agents',
    chapter: 'ml-ai-stack',
    nav: 'AI Advisor & MCP Agent',
    title: 'AI Training Advisor and Superset MCP Agent',
    lede:
      'Maia integrates generative AI in two distinct workflows: a post-run code & metrics advisor for data scientists, and a tool-calling BI agent that builds Apache Superset dashboards from natural language.',
    keywords: [
      'ai advisor',
      'claude',
      'anthropic',
      'gemini',
      'ollama',
      'superset',
      'mcp',
      'model context protocol',
      'kpi maker',
      'groq',
    ],
    extra: (
      <TechTable
        headers={['Agent', 'Supported Providers', 'How it works under the hood']}
        rows={[
          [
            'AI Training Advisor',
            'Anthropic Claude (claude-opus-4-8), Google Gemini (gemini-pro-latest), or local Ollama (llama3.1)',
            'Reads the notebook source cells, phase logs, and MLflow metric history. Generates a Markdown report with root-cause diagnosis and variable-aware code snippets. On "Apply & push", rewrites the notebook AST while preserving mlops:config and mlops:export, then commits to the testing-ia-agent branch via the GitHub API.',
          ],
          [
            'KPI Maker Agent (Superset MCP)',
            'Google Gemini or any OpenAI-compatible tool-use API (Groq, OpenRouter, OpenAI)',
            'Connects to the internal superset-mcp container (http://superset-mcp:5008/mcp). Uses function calling to inspect Gold DuckDB datasets, create charts, and assemble dashboards in Superset (:8088), which the frontend embeds via a signed guest token.',
          ],
        ]}
      />
    ),
  },

  /* ================================================================== */
  /*  05 · Observability, security & testing                            */
  /* ================================================================== */
  {
    id: 'prometheus-exporters',
    chapter: 'ops-testing',
    nav: 'Prometheus & exporters',
    title: 'Operational and resource metrics (Prometheus, cAdvisor, Node Exporter)',
    lede:
      'Prometheus scrapes three targets on the internal network to power the Platform and Resources dashboards.',
    keywords: [
      'prometheus',
      'metrics',
      'cadvisor',
      'node-exporter',
      'telemetry',
      'prefork',
      'cpu',
      'memory',
    ],
    fields: [
      {
        term: 'FastAPI /metrics (prometheus-client 0.21.1)',
        text: 'Exposes HTTP request rate, latency histograms, in-flight requests, and error ratios from the backend container.',
      },
      {
        term: 'cAdvisor (v0.49.1)',
        text: 'Reads container cgroups to report CPU, memory working set, memory limits, and network I/O for every mlops-* container.',
      },
      {
        term: 'node-exporter (v1.8.2)',
        text: 'Reads host-level CPU, RAM, filesystem usage, and load averages (or the Docker Desktop Linux VM on Windows/macOS).',
      },
      {
        term: 'Why pipeline counts come from PostgreSQL',
        text: 'Celery runs prefork with multiple child processes, which would split in-memory Prometheus counters across workers. Reading pipeline counts and durations from PostgreSQL guarantees exact figures.',
      },
    ],
  },

  {
    id: 'grafana-auth-proxy',
    chapter: 'ops-testing',
    nav: 'Grafana Auth-Proxy',
    title: 'Embedded Grafana security and SQL allow-list',
    lede:
      'Grafana is never exposed on a host port. All dashboard traffic passes through FastAPI’s authenticated reverse proxy under /grafana, combining four defense layers so non-admin users can only ever see their own models.',
    keywords: [
      'grafana',
      'auth proxy',
      'security',
      'allow-list',
      'X-WEBAUTH-USER',
      'grafana_ro',
      'grafana_queries.py',
      'sql injection',
    ],
    wireframe: <GrafanaProxyDiagram />,
    anatomy: [
      {
        n: 1,
        label: 'Unpublished container port',
        text: 'mlops-grafana has no ports: entry in docker-compose.yml; browsers can only reach it through http://localhost:8000/grafana.',
      },
      {
        n: 2,
        label: 'JWT verification & X-WEBAUTH-USER',
        text: 'FastAPI strips any client-supplied X-WEBAUTH-* headers, validates the user’s JWT token, and injects X-WEBAUTH-USER with the verified username.',
      },
      {
        n: 3,
        label: 'Provisioned JSON query allow-list',
        text: 'Because Grafana’s Viewer role still permits raw /api/ds/query calls, core/grafana_queries.py parses grafana/dashboards/*.json at startup and blocks any SQL or PromQL query not present in the provisioned JSON files (returning 403).',
      },
      {
        n: 4,
        label: 'Read-only PostgreSQL role & username regex',
        text: 'Grafana connects to PostgreSQL as grafana_ro (SELECT-only on safe tables, no access to password hashes, default_transaction_read_only=on) and filters rows by WHERE u.username = \'${__user.login}\'. Usernames are restricted to [A-Za-z0-9_.+@-] (3–64 chars) to prevent SQL literal breakout.',
      },
    ],
  },

  {
    id: 'testing-commands',
    chapter: 'ops-testing',
    nav: 'Testing & verification',
    title: 'Automated test suites and verification commands',
    lede:
      'Both the Python backend and the TypeScript frontend ship with automated unit, integration, and end-to-end test suites.',
    keywords: [
      'testing',
      'pytest',
      'vitest',
      'playwright',
      'typecheck',
      'msw',
      'test_pipeline.sh',
    ],
    extra: (
      <CodeSample
        title="Running backend, frontend, and webhook tests"
        language="bash"
        code={`# 1. Backend unit & integration tests (Pytest inside container)
docker compose run --rm backend pytest tests/ -q

# 2. Frontend unit & component tests (Vitest + Testing Library + MSW)
cd frontend && npm ci
npm run test

# 3. Frontend static type checking & production build
npm run typecheck
npm run build

# 4. Frontend end-to-end browser tests (Playwright)
npm run test:e2e

# 5. Signed GitHub webhook smoke test
GITHUB_WEBHOOK_SECRET=your_secret ./scripts/test_pipeline.sh`}
      />
    ),
  },

  {
    id: 'operational-gotchas',
    chapter: 'ops-testing',
    nav: 'Pins & gotchas',
    title: 'Version pins, constraints, and operational gotchas',
    lede:
      'When upgrading dependencies or customizing dashboards, keep these load-bearing architectural constraints in mind.',
    keywords: [
      'gotchas',
      'pins',
      'pyarrow',
      'mlflow',
      'bcrypt',
      'grafana json',
      'ollama',
      'troubleshooting',
    ],
    extra: (
      <TechTable
        headers={['Constraint / Component', 'Rule to follow', 'Why it matters']}
        rows={[
          [
            'pyarrow==14.0.2 & mlflow==2.9.2',
            'Never bump pyarrow to >=15 without upgrading MLflow at the same time.',
            'MLflow 2.9.2 caps pyarrow at <15. Both Medallion Parquet storage and MLflow artifact serialization depend on this pin.',
          ],
          [
            'bcrypt==3.2.2 & passlib[bcrypt]',
            'Keep bcrypt pinned to 3.2.2 and FIRST_ADMIN_PASSWORD between 8 and 72 bytes.',
            'Newer bcrypt 4.x releases removed __about__ attributes expected by passlib 1.7.4, and bcrypt rejects secrets longer than 72 bytes.',
          ],
          [
            'Grafana dashboards JSON (grafana/dashboards/*.json)',
            'Always edit dashboards in the JSON files on disk, never only in the Grafana UI.',
            'The backend security proxy builds its SQL/PromQL allow-list from grafana/dashboards/*.json. Queries not matching the JSON files are rejected with 403.',
          ],
          [
            'Grafana username charset',
            'Usernames must match [A-Za-z0-9_.+@-] (3–64 characters).',
            'Grafana interpolates ${__user.login} directly into SQL strings without bind parameters; the strict character allow-list prevents SQL injection.',
          ],
          [
            'Ollama host connectivity',
            'Use http://host.docker.internal:11434 when Ollama runs on the host machine.',
            'Inside a container, localhost refers to the container itself. extra_hosts maps host.docker.internal to the Docker host gateway.',
          ],
        ]}
      />
    ),
  },
];

export function techChapterOf(section: TechSection): TechChapter {
  return (
    TECH_CHAPTERS.find((chapter) => chapter.id === section.chapter) ?? TECH_CHAPTERS[0]
  );
}
