import type { ReactNode } from 'react';
import { Pin, WfFrame, WfLabel, WfStatus } from './Wireframe';

/* ---- Reusable editorial table for technical reference -------------- */

export function TechTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="mt-4 overflow-x-auto border-y border-[var(--rule)]">
      <table className="w-full min-w-[540px] border-collapse text-left align-top">
        <thead>
          <tr>
            {headers.map((heading) => (
              <th
                key={heading}
                className="manual-eyebrow border-b border-[var(--rule-strong)] py-2 pr-4 font-medium"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, rowIndex) => (
            <tr key={rowIndex}>
              {cells.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`border-b border-[var(--rule)] py-2.5 pr-4 align-top text-[12.5px] leading-snug ${
                    cellIndex === 0
                      ? 'font-display text-[11.5px] font-semibold text-[var(--ink)]'
                      : 'manual-body-text'
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---- 1. Local bootstrap sequence ----------------------------------- */

export function LocalBootDiagram() {
  return (
    <WfFrame path="docker compose up -d --build / startup sequence">
      <div className="space-y-2.5 p-2">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="relative wf-box wf-box--accent">
            <WfLabel>Phase 1 · Config & build</WfLabel>
            <p className="mt-1 font-display text-[11px] font-semibold">cp .env.example .env</p>
            <p className="wf-text mt-0.5">Builds backend, worker, frontend, mlflow, model-server, superset</p>
            <Pin n={1} />
          </div>

          <div className="relative wf-box">
            <WfLabel>Phase 2 · Core stores</WfLabel>
            <div className="mt-1 flex flex-wrap gap-1">
              <WfStatus tone="ok">postgres :5432</WfStatus>
              <WfStatus tone="ok">redis :6379</WfStatus>
              <WfStatus tone="ok">minio :9000</WfStatus>
            </div>
            <p className="wf-text mt-1">Wait for healthchecks before dependent containers start</p>
            <Pin n={2} />
          </div>

          <div className="relative wf-box wf-box--dashed">
            <WfLabel>Phase 3 · One-shot init</WfLabel>
            <p className="mt-1 font-display text-[11px] font-semibold">minio-init · hospital-init</p>
            <p className="wf-text mt-0.5">Creates S3 buckets (datasets, mlflow) & seeds Synthea HIS</p>
            <Pin n={3} />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="relative wf-box wf-box--deep">
            <WfLabel>Phase 4 · Backend entrypoint.sh</WfLabel>
            <p className="mt-1 font-display text-[11px] font-semibold">
              alembic upgrade head → ensure_grafana_role() → bootstrap admin
            </p>
            <p className="wf-text mt-0.5">
              Applies schema migrations, provisions read-only grafana_ro DB user, and creates FIRST_ADMIN_USERNAME
            </p>
            <Pin n={4} />
          </div>

          <div className="relative wf-box">
            <WfLabel>Phase 5 · Published endpoints ready</WfLabel>
            <div className="mt-1 flex flex-wrap gap-1">
              <WfStatus tone="ok">SPA :3000</WfStatus>
              <WfStatus tone="ok">API :8000</WfStatus>
              <WfStatus tone="ok">Models :8001</WfStatus>
              <WfStatus tone="ok">MLflow :5000</WfStatus>
              <WfStatus tone="ok">Superset :8088</WfStatus>
            </div>
            <Pin n={5} />
          </div>
        </div>
      </div>
    </WfFrame>
  );
}

/* ---- 2. Container & network topology ------------------------------- */

export function ArchitectureDiagram() {
  return (
    <WfFrame path="mlops-network / container topology">
      <div className="space-y-2.5 p-2">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="relative wf-box">
            <WfLabel>Client & edge</WfLabel>
            <p className="mt-1 font-display text-[11.5px] font-semibold">Frontend SPA (:3000)</p>
            <p className="wf-text mt-0.5">React 18 + Vite + Tailwind + XYFlow + Superset SDK</p>
            <Pin n={1} />
          </div>

          <div className="relative wf-box wf-box--accent">
            <WfLabel>Control plane</WfLabel>
            <p className="mt-1 font-display text-[11.5px] font-semibold">Backend API (:8000)</p>
            <p className="wf-text mt-0.5">FastAPI · JWT · GitHub webhooks · WS logs · /grafana proxy</p>
            <Pin n={2} />
          </div>

          <div className="relative wf-box">
            <WfLabel>Execution plane</WfLabel>
            <p className="mt-1 font-display text-[11.5px] font-semibold">Celery Worker (×2)</p>
            <p className="wf-text mt-0.5">Papermill runner · Medallion ETL · DuckDB · AI Advisor</p>
            <Pin n={3} />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <div className="relative wf-box wf-box--deep">
            <WfLabel>State & messaging</WfLabel>
            <p className="mt-1 font-display text-[11px] font-semibold">PostgreSQL 16 + Redis 7</p>
            <p className="wf-text mt-0.5">SQLModel records, Celery broker & WebSocket pub/sub</p>
            <Pin n={4} />
          </div>

          <div className="relative wf-box wf-box--deep">
            <WfLabel>Object & ML store</WfLabel>
            <p className="mt-1 font-display text-[11px] font-semibold">MinIO (:9000) + MLflow (:5000)</p>
            <p className="wf-text mt-0.5">Buckets s3://datasets & s3://mlflow + SQLite run metadata</p>
            <Pin n={5} />
          </div>

          <div className="relative wf-box wf-box--deep">
            <WfLabel>Serving, BI & observability</WfLabel>
            <p className="mt-1 font-display text-[11px] font-semibold">
              Model Server (:8001) · Superset (:8088) · Grafana
            </p>
            <p className="wf-text mt-0.5">REST inference, MCP KPI agent (:5008), Prometheus (:9090)</p>
            <Pin n={6} />
          </div>
        </div>
      </div>
    </WfFrame>
  );
}

/* ---- 3. Self-improving MLOps loop ---------------------------------- */

export function MlopsLoopDiagram() {
  return (
    <WfFrame path="maia / self-improving pipeline loop">
      <div className="grid gap-2 p-2 sm:grid-cols-3">
        <div className="relative wf-box">
          <WfLabel>01 · Trigger</WfLabel>
          <p className="mt-1 font-display text-[11px] font-semibold">GitHub Webhook / Manual Run</p>
          <p className="wf-text mt-0.5">Verifies HMAC-SHA256 or branch selection and enqueues Celery task</p>
          <Pin n={1} />
        </div>

        <div className="relative wf-box">
          <WfLabel>02 · Mount input</WfLabel>
          <p className="mt-1 font-display text-[11px] font-semibold">MinIO → DATASET_PATH</p>
          <p className="wf-text mt-0.5">Downloads active dataset or pinned Bronze/Silver/Gold Parquet</p>
          <Pin n={2} />
        </div>

        <div className="relative wf-box wf-box--accent">
          <WfLabel>03 · Execute & track</WfLabel>
          <p className="mt-1 font-display text-[11px] font-semibold">Papermill + MLflow</p>
          <p className="wf-text mt-0.5">Validates mlops:* tags, streams cell logs via Redis WS, uploads model to S3</p>
          <Pin n={3} />
        </div>

        <div className="relative wf-box">
          <WfLabel>04 · Quality gate & serve</WfLabel>
          <p className="mt-1 font-display text-[11px] font-semibold">Deployment Rules → :8001</p>
          <p className="wf-text mt-0.5">Checks threshold & active champion; loads artifact in Model Server</p>
          <Pin n={4} />
        </div>

        <div className="relative wf-box">
          <WfLabel>05 · AI Training Advisor</WfLabel>
          <p className="mt-1 font-display text-[11px] font-semibold">Claude · Gemini · Ollama</p>
          <p className="wf-text mt-0.5">Inspects notebook cells, metrics & history to diagnose and suggest code</p>
          <Pin n={5} />
        </div>

        <div className="relative wf-box wf-box--dashed">
          <WfLabel>06 · Apply & push</WfLabel>
          <p className="mt-1 font-display text-[11px] font-semibold">Branch testing-ia-agent</p>
          <p className="wf-text mt-0.5">Rewrites notebook preserving mlops:config/export and commits to GitHub</p>
          <Pin n={6} />
        </div>
      </div>
    </WfFrame>
  );
}

/* ---- 4. Grafana Auth-Proxy & SQL allow-list ------------------------ */

export function GrafanaProxyDiagram() {
  return (
    <WfFrame path="backend / grafana reverse proxy & query guard">
      <div className="grid gap-2 p-2 sm:grid-cols-4">
        <div className="relative wf-box">
          <WfLabel>Step 1 · Request</WfLabel>
          <p className="mt-1 font-display text-[11px] font-semibold">GET /grafana/*</p>
          <p className="wf-text mt-0.5">Grafana has no host port; all traffic enters FastAPI</p>
          <Pin n={1} />
        </div>

        <div className="relative wf-box wf-box--accent">
          <WfLabel>Step 2 · Auth proxy</WfLabel>
          <p className="mt-1 font-display text-[11px] font-semibold">X-WEBAUTH-USER</p>
          <p className="wf-text mt-0.5">Strips client headers, verifies JWT, injects validated username</p>
          <Pin n={2} />
        </div>

        <div className="relative wf-box">
          <WfLabel>Step 3 · Query guard</WfLabel>
          <p className="mt-1 font-display text-[11px] font-semibold">grafana_queries.py</p>
          <p className="wf-text mt-0.5">Matches SQL/PromQL against allow-list from grafana/dashboards/*.json</p>
          <Pin n={3} />
        </div>

        <div className="relative wf-box wf-box--deep">
          <WfLabel>Step 4 · Read-only DB</WfLabel>
          <p className="mt-1 font-display text-[11px] font-semibold">Role grafana_ro</p>
          <p className="wf-text mt-0.5">Scopes rows to u.username = &apos;$&#123;__user.login&#125;&apos;; hides password hashes</p>
          <Pin n={4} />
        </div>
      </div>
    </WfFrame>
  );
}
