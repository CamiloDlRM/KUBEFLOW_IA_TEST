/**
 * A fake backend for the mock suite.
 *
 * One `page.route()` is installed on the API's origin — never a glob like
 * `** /models`, which would also swallow the browser's navigation to the SPA's
 * own `/models` page. Requests are matched against a table of
 * `METHOD /path/:param` handlers; the defaults describe the happy installation
 * from `data.ts`, and a test swaps any of them with `mockApi.on(...)`.
 *
 * A request nobody handles answers 501 and is recorded. The fixture fails the
 * test on any, so an endpoint the UI starts calling cannot slip past the suite
 * as a silent network error.
 */
import type { Page, Request, Route, WebSocketRoute } from '@playwright/test';
import * as d from './data';

export const API_ORIGIN = process.env.E2E_API_URL ?? 'http://localhost:8000';
export const WS_ORIGIN = API_ORIGIN.replace(/^http/, 'ws');

export interface MockRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  /** JSON body when there is one, else the raw text (form posts, multipart). */
  body: unknown;
  headers: Record<string, string>;
  request: Request;
}

/** What a handler returns: a JSON body (200), or a full response. */
export type MockResponse =
  | { status?: number; json?: unknown; body?: string; contentType?: string; delayMs?: number }
  | undefined;

export type Handler = (req: MockRequest) => MockResponse | Promise<MockResponse>;

interface Entry {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const RESPONSE = Symbol('mock-response');
type Branded = NonNullable<MockResponse> & { [RESPONSE]: true };
const brand = (res: NonNullable<MockResponse>): Branded => ({ ...res, [RESPONSE]: true });
const isResponse = (value: unknown): value is Branded =>
  typeof value === 'object' && value !== null && RESPONSE in value;

/** JSON helper: `json(data)` or `json(data, 201)`. */
export const json = (data: unknown, status = 200): MockResponse => brand({ status, json: data });
export const error = (status: number, detail: string): MockResponse => brand({ status, json: { detail } });
export const noContent = (): MockResponse => brand({ status: 204, body: '' });
export const html = (markup: string): MockResponse => brand({ status: 200, body: markup, contentType: 'text/html' });

function compile(spec: string): { method: string; pattern: RegExp; keys: string[] } {
  const [method, path] = spec.trim().split(/\s+/, 2);
  const keys: string[] = [];
  const source = path
    .split('/')
    .map((part) => {
      if (part.startsWith(':')) {
        keys.push(part.slice(1));
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { method: method.toUpperCase(), pattern: new RegExp(`^${source}/?$`), keys };
}

export class MockApi {
  /** The happy installation, matched in registration order (specific routes first). */
  private defaults: Entry[] = [];
  /** A test's own handlers, matched before the defaults, newest first. */
  private overrides: Entry[] = [];
  private installingDefaults = true;
  /** Every request the page made to the API, in order. */
  readonly calls: MockRequest[] = [];
  /** Requests no handler matched. The fixture fails the test on any. */
  readonly unhandled: string[] = [];
  /** Messages pushed to pipeline log sockets, keyed by pipeline id. */
  readonly sockets = new Map<string, WebSocketRoute>();

  constructor() {
    installDefaults(this);
    this.installingDefaults = false;
  }

  /**
   * Register a handler. Later registrations win, so a test's `on()` replaces
   * the default for the same route. Takes a handler function, a response built
   * with `json()`/`error()`/`noContent()`/`html()`, or plain data (sent as a
   * 200 JSON body).
   */
  on(spec: string, handler: Handler): this;
  on(spec: string, response: MockResponse | object | string | number | boolean | null): this;
  on(spec: string, handler: unknown): this {
    const fn: Handler =
      typeof handler === 'function'
        ? (handler as Handler)
        : isResponse(handler)
          ? () => handler
          : () => json(handler);
    const entry = { ...compile(spec), handler: fn };
    if (this.installingDefaults) this.defaults.push(entry);
    else this.overrides.unshift(entry);
    return this;
  }

  /** The requests made to `METHOD /path` (with `:params`), in order. */
  callsTo(spec: string): MockRequest[] {
    const { method, pattern } = compile(spec);
    return this.calls.filter((c) => c.method === method && pattern.test(c.path));
  }

  /** Wait until the page has made a request matching `spec`. */
  async waitForCall(page: Page, spec: string, timeout = 5_000): Promise<MockRequest> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const hits = this.callsTo(spec);
      if (hits.length) return hits[hits.length - 1];
      await page.waitForTimeout(50);
    }
    throw new Error(`No ${spec} request within ${timeout}ms. Calls so far:\n${this.describeCalls()}`);
  }

  describeCalls(): string {
    return this.calls.map((c) => `  ${c.method} ${c.path}`).join('\n');
  }

  async install(page: Page): Promise<void> {
    await page.route(`${API_ORIGIN}/**`, (route) => this.handle(route));
    await page.routeWebSocket(`${WS_ORIGIN}/**`, (ws) => {
      const match = /\/pipelines\/([^/]+)\/ws/.exec(new URL(ws.url()).pathname);
      if (match) this.sockets.set(match[1], ws);
      // Accept the connection; the test pushes messages with `ws.send()`.
    });
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders() });
      return;
    }
    const path = url.pathname;
    let body: unknown = request.postData();
    try {
      body = request.postDataJSON();
    } catch {
      // Not JSON: keep the raw text.
    }
    for (const entry of [...this.overrides, ...this.defaults]) {
      if (entry.method !== method) continue;
      const m = entry.pattern.exec(path);
      if (!m) continue;
      const params = Object.fromEntries(entry.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const req: MockRequest = {
        method,
        path,
        params,
        query: url.searchParams,
        body,
        headers: request.headers(),
        request,
      };
      this.calls.push(req);
      const res = (await entry.handler(req)) ?? { status: 200, json: {} };
      if (res.delayMs) await new Promise((r) => setTimeout(r, res.delayMs));
      const status = res.status ?? 200;
      if (res.json !== undefined) {
        await route.fulfill({
          status,
          headers: corsHeaders(),
          contentType: 'application/json',
          body: JSON.stringify(res.json),
        });
      } else {
        await route.fulfill({
          status,
          headers: corsHeaders(),
          contentType: res.contentType ?? 'text/plain',
          body: res.body ?? '',
        });
      }
      return;
    }
    this.calls.push({ method, path, params: {}, query: url.searchParams, body, headers: request.headers(), request });
    this.unhandled.push(`${method} ${path}${url.search}`);
    await route.fulfill({
      status: 501,
      headers: corsHeaders(),
      contentType: 'application/json',
      body: JSON.stringify({ detail: `e2e mock: no handler for ${method} ${path}` }),
    });
  }
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
  };
}

/**
 * The happy installation. Every endpoint the client in `src/api/client.ts`
 * calls has a default here, so any page renders with data and no test has to
 * mock what it does not care about.
 */
function installDefaults(api: MockApi): void {
  const { IDS } = d;

  // ── Health ────────────────────────────────────────────────────────────
  api.on('GET /health', { status: 'ok' });
  api.on('GET /ready', d.ready());

  // ── Auth ──────────────────────────────────────────────────────────────
  // `/auth/me` is installed by the auth fixture, which knows who is signed in.
  api.on('POST /auth/login', () => error(401, 'Incorrect username or password'));
  api.on('POST /auth/refresh', { access_token: 'e2e-token-refreshed', token_type: 'bearer', github_token_status: 'ok' });
  api.on('GET /auth/github-token/status', { status: 'ok' });
  api.on('PUT /auth/github-token', d.user());
  api.on('PATCH /auth/me', (r: MockRequest) => json(d.user({ email: (r.body as { email: string }).email })));
  api.on('POST /auth/me/change-password', { message: 'Check your email to confirm the change', email: 'ana@example.com' });
  api.on('POST /auth/me/change-username', { message: 'Check your email to confirm the change', email: 'ana@example.com' });
  api.on('POST /auth/confirm-change', d.user());
  api.on('POST /auth/set-password', d.user({ needs_password: false }));
  api.on('POST /auth/invite', (r: MockRequest) =>
    json({
      token: 'invite-token-123',
      expires_at: '2026-11-25T10:00:00Z',
      email: (r.body as { email: string }).email,
      email_sent: true,
    }, 201),
  );
  api.on('POST /auth/github/confirm-new', { access_token: 'e2e-token', token_type: 'bearer', github_token_status: 'ok' });

  // ── Repositories ──────────────────────────────────────────────────────
  api.on('GET /repos', [d.repository()]);
  api.on('POST /repos', json({ repo_id: 2, webhook_url: 'http://localhost:8000/webhook/github', status: 'created' }, 201));
  api.on('DELETE /repos/:id', noContent());
  api.on('GET /repos/:id/branches', d.branches());
  api.on('GET /repos/:id/notebooks', ['notebooks/train.ipynb', 'notebooks/eda.ipynb']);
  api.on('GET /repos/:id/notebook', d.editorNotebook());
  api.on('PUT /repos/:id/notebook', { commit_sha: 'newcommit0001', sha: 'blobsha0002', changed_cells: 1 });
  api.on('POST /repos/:id/trigger', json({ status: 'queued', pipeline_id: IDS.runningPipeline }, 202));

  // ── Projects ──────────────────────────────────────────────────────────
  api.on('GET /projects', [d.project()]);
  api.on('POST /projects', (r: MockRequest) => {
    const body = r.body as { name: string; description?: string };
    return json(d.project({ id: 2, name: body.name, description: body.description ?? '', repository: null, sources: 0, gold_rows: 0, active_dataset: null, deployed_model: null }), 201);
  });
  api.on('GET /projects/:id', (r: MockRequest) => json(d.project({ id: Number(r.params.id) })));
  api.on('PATCH /projects/:id', (r: MockRequest) => json(d.project({ id: Number(r.params.id), ...(r.body as object) })));
  api.on('DELETE /projects/:id', noContent());
  api.on('PUT /projects/:id/repository', (r: MockRequest) => json(d.project({ id: Number(r.params.id) })));
  api.on('DELETE /projects/:id/repository', (r: MockRequest) => json(d.project({ id: Number(r.params.id), repository: null })));
  api.on('POST /projects/:id/run', json({ status: 'queued', pipeline_id: IDS.runningPipeline }, 202));
  api.on('GET /projects/:id/run-settings', d.runSettings());
  api.on('PUT /projects/:id/deploy-policy', (r: MockRequest) =>
    json(d.runSettings({ policy: d.deployPolicy(r.body as object), is_default: false })),
  );
  api.on('GET /projects/:id/notebook', d.repoNotebook());
  api.on('GET /projects/:id/pipeline-input', d.pipelineInput());
  api.on('PUT /projects/:id/pipeline-input', d.pipelineInput());

  // ── Datasets ──────────────────────────────────────────────────────────
  api.on('GET /projects/:id/datasets', [d.dataset(), d.dataset({ id: 10, name: 'gold-v2.parquet', is_active: false, created_at: d.EARLIER })]);
  api.on('GET /projects/:id/uploads', [d.upload()]);
  api.on('POST /projects/:id/datasets', json(d.dataset({ id: 13, name: 'uploaded.csv', origin: 'upload' }), 201));
  api.on('POST /datasets/:id/activate', (r: MockRequest) => json(d.dataset({ id: Number(r.params.id), is_active: true })));
  api.on('DELETE /datasets/:id', noContent());
  api.on('GET /datasets/:id/preview', d.datasetPreview());

  // ── Medallion ─────────────────────────────────────────────────────────
  api.on('GET /projects/:id/medallion', d.medallion());
  api.on('GET /projects/:id/medallion/inputs', d.pipelineInputOptions());
  api.on('GET /projects/:id/medallion/:layer/preview', (r: MockRequest) =>
    json({
      layer: r.params.layer,
      key: `project-1/${r.params.layer}/latest.parquet`,
      columns: [
        { name: 'tenure', type: 'BIGINT' },
        { name: 'churn', type: 'BIGINT' },
      ],
      rows: [
        [1, 0],
        [34, 1],
      ],
      object_rows: 1200,
      truncated: true,
    }),
  );
  api.on('GET /projects/:id/medallion/diff', {
    run_id: 'run-0001',
    source_id: IDS.source,
    key: 'project-1/crm/run-0001.parquet',
    columns: [{ bronze: 'Tenure ', silver: 'tenure', bronze_type: 'VARCHAR', silver_type: 'BIGINT', change: 'renamed' }],
    rows: [{ row: 0, bronze: [' 1'], silver: [1], cells: ['type'], removed: false }],
    bronze_rows: 1200,
    silver_rows: 1198,
    approximate: false,
  });
  api.on('GET /projects/:id/medallion/steps', d.cleaningSteps());
  api.on('GET /projects/:id/medallion/gold/relations', d.goldRelations());
  api.on('POST /projects/:id/medallion/gold/preview', (r: MockRequest) =>
    json({
      columns: ['tenure', 'churn'],
      rows: [
        [1, 0],
        [34, 1],
      ],
      total_rows: 1200,
      relations: { crm: 1200 },
      sql: (r.body as { sql: string }).sql,
    }),
  );
  api.on('PUT /projects/:id/medallion/gold', d.medallion().gold);
  api.on('POST /projects/:id/medallion/gold/suggest', {
    sql: 'SELECT tenure, churn FROM crm',
    explanation: 'One row per customer.',
    error: '',
  });
  api.on('GET /projects/:id/dashboard', { turns: [], superset_url: '' });
  api.on('POST /projects/:id/dashboard', { turns: [], superset_url: '' });
  api.on('GET /projects/:id/dashboard/embed', error(404, 'No dashboard yet'));

  // ── Sources ───────────────────────────────────────────────────────────
  api.on('GET /sources', [d.source()]);
  api.on('POST /sources', (r: MockRequest) => json(d.source({ id: 22, ...(r.body as object) }), 201));
  api.on('DELETE /sources/:id', noContent());
  api.on('GET /sources/password-envs', { names: ['CRM_DB_PASSWORD', 'HOSPITAL_DB_PASSWORD'] });
  api.on('POST /sources/preview', {
    columns: ['tenure', 'churn'],
    rows: [
      [1, 0],
      [34, 1],
    ],
    profile: {},
    truncated: false,
  });
  api.on('POST /sources/:id/ingest', json(d.ingestionRun({ id: 'run-0002', status: 'queued', finished_at: null }), 202));
  api.on('GET /sources/:id/runs', [d.ingestionRun()]);
  api.on('GET /sources/:id/cleaning-recipe', d.cleaningRecipe());
  api.on('PUT /sources/:id/cleaning-recipe', d.cleaningRecipe({ mode: 'custom' }));
  api.on('POST /sources/:id/reclean', d.cleaningRecipe({ reclean: { status: 'queued', queued_at: d.NOW } }));
  api.on('POST /projects/:id/medallion/steps/preview', d.cleaningSteps({ preview: true }));

  // ── Pipelines ─────────────────────────────────────────────────────────
  api.on('GET /pipelines', d.page([d.runningPipeline(), d.pipeline(), d.failedPipeline()]));
  api.on('GET /pipelines/stats', d.stats());
  api.on('GET /pipelines/:id', (r: MockRequest) => {
    const all = [d.pipeline(), d.runningPipeline(), d.failedPipeline()];
    const found = all.find((p) => p.id === r.params.id);
    return found ? json(found) : error(404, 'Pipeline not found');
  });
  api.on('GET /pipelines/:id/logs', (r: MockRequest) =>
    json({
      pipeline_id: r.params.id,
      logs: [
        { pipeline_id: r.params.id, phase: 'download', status: 'success', logs: 'Cloned notebook', timestamp: d.EARLIER },
        { pipeline_id: r.params.id, phase: 'execute', status: 'success', logs: 'Executed 6 cells', timestamp: d.NOW },
      ],
    }),
  );
  api.on('GET /pipelines/:id/insights', [d.insight()]);
  api.on('POST /pipelines/:id/insights', json(d.insight({ id: 32, status: 'pending', content: '' }), 202));
  api.on('POST /pipelines/:id/insights/:insightId/apply', d.insight({ apply_status: 'queued' }));

  // ── Models ────────────────────────────────────────────────────────────
  api.on('GET /models', [d.model()]);
  api.on('GET /models/traffic', d.traffic());
  api.on('GET /models/:name/versions', [
    d.modelVersion(),
    d.modelVersion({
      version: '2',
      pipeline_id: 'pl-older',
      mlflow_run_id: 'mlflowrun0002',
      accuracy: 0.86,
      metrics: { accuracy: 0.86 },
      is_active: false,
      deployed_at: d.EARLIER,
    }),
  ]);
  api.on('POST /models/:name/predict', (r: MockRequest) =>
    json({ prediction: [1], model_name: r.params.name, version: '3', probabilities: [{ '0': 0.25, '1': 0.75 }] }),
  );
  api.on('POST /models/:name/rollback', { message: 'Now serving version 2' });
  api.on('DELETE /models/:name', noContent());
  api.on('PUT /models/:name/share', (r: MockRequest) =>
    json(d.shareLink({ enabled: (r.body as { enabled: boolean }).enabled, url: (r.body as { enabled: boolean }).enabled ? d.shareLink().url : null })),
  );
  api.on('POST /models/:name/share/rotate', d.shareLink({ url: 'http://localhost:8000/public/predict/rotated456' }));

  // ── Grafana (behind the backend's proxy) ──────────────────────────────
  api.on('GET /grafana/status', { enabled: false });
  api.on('POST /grafana/session', error(503, 'Grafana disabled in e2e'));
  api.on('GET /grafana/api/dashboards/uid/:uid', error(404, 'Not found'));
  // The iframes themselves: an empty document is enough.
  api.on('GET /grafana/embed', html('<html><body>grafana</body></html>'));
  api.on('GET /grafana/d/:uid', html('<html><body>grafana</body></html>'));
}
