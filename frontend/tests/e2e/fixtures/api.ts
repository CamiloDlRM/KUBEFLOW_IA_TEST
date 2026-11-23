/**
 * A fake backend for the mock e2e suite.
 *
 * It intercepts every request to `http://localhost:8000/**` (the API and the
 * Grafana proxy) and the pipeline WebSocket. Handlers are registered per
 * method and path; the last one registered for a route wins, so a spec
 * overrides a default by registering its own. Because of that, a specific
 * path (`/pipelines/stats`) must be registered after a generic one
 * (`/pipelines/:id`) that also matches it. A request no handler matches is
 * answered with 501 and recorded, and the `test` fixture fails the test on it:
 * the suite never passes because the UI quietly swallowed a missing endpoint.
 */
import type { Page, Request, WebSocketRoute } from '@playwright/test';
import type { UserResponse, WebSocketLogMessage } from '../../../src/types';
import * as data from './data';

export const API_ORIGIN = 'http://localhost:8000';
const WS_PATTERN = /^ws:\/\/localhost:8000\/pipelines\/([^/]+)\/ws/;

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface MockRequest {
  method: Method;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Parsed JSON when the body is JSON, else the raw text (form data, multipart). */
  body: unknown;
  request: Request;
}

/** A response with an explicit status; a handler returning anything else answers 200 with it as JSON. */
export class MockReply {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly contentType = 'application/json',
  ) {}
}

export const reply = (status: number, body: unknown = {}) => new MockReply(status, body);
export const fail = (status: number, detail: string) => new MockReply(status, { detail });
export const html = (body: string) => new MockReply(200, body, 'text/html');

export type Handler = (req: MockRequest) => unknown | Promise<unknown>;

interface Route {
  method: Method;
  pattern: string;
  regex: RegExp;
  keys: string[];
  handler: Handler;
}

export interface RecordedCall {
  method: Method;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

function compile(pattern: string): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      if (segment === '*') return '.*';
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${source}/?$`), keys };
}

function parseBody(request: Request): unknown {
  const text = request.postData();
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class MockApi {
  private routes: Route[] = [];
  private sockets = new Map<string, WebSocketRoute[]>();
  readonly unhandled: string[] = [];
  readonly log: RecordedCall[] = [];

  constructor(private readonly page: Page) {}

  /** Start intercepting. Called once by the `test` fixture, before any navigation. */
  async install(): Promise<void> {
    await this.page.route(`${API_ORIGIN}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method() as Method;
      const path = decodeURIComponent(url.pathname);
      const body = parseBody(request);

      if (method === ('OPTIONS' as Method)) {
        await route.fulfill({ status: 204 });
        return;
      }

      this.log.push({ method, path, query: url.searchParams, body });
      const match = this.match(method, path);
      if (!match) {
        this.unhandled.push(`${method} ${path}`);
        await route.fulfill({ status: 501, json: { detail: `No mock for ${method} ${path}` } });
        return;
      }

      const result = await match.route.handler({
        method,
        path,
        params: match.params,
        query: url.searchParams,
        body,
        request,
      });
      const out = result instanceof MockReply ? result : new MockReply(200, result ?? {});
      if (out.status === 204) {
        await route.fulfill({ status: 204 });
      } else if (out.contentType === 'application/json') {
        await route.fulfill({ status: out.status, json: out.body });
      } else {
        await route.fulfill({ status: out.status, contentType: out.contentType, body: String(out.body) });
      }
    });

    await this.page.routeWebSocket(WS_PATTERN, (ws) => {
      const id = WS_PATTERN.exec(ws.url())?.[1] ?? '';
      const open = this.sockets.get(id) ?? [];
      open.push(ws);
      this.sockets.set(id, open);
      ws.onClose(() => {
        this.sockets.set(id, (this.sockets.get(id) ?? []).filter((s) => s !== ws));
      });
    });
  }

  private match(method: Method, path: string) {
    for (let i = this.routes.length - 1; i >= 0; i -= 1) {
      const route = this.routes[i];
      if (route.method !== method) continue;
      const found = route.regex.exec(path);
      if (!found) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((key, index) => {
        params[key] = found[index + 1];
      });
      return { route, params };
    }
    return null;
  }

  /**
   * Answer `method path` with `handler`. A plain value is sent as JSON with 200;
   * return `reply()`/`fail()` for another status. Later registrations win.
   */
  on(method: Method, pattern: string, handler: Handler): this;
  on(method: Method, pattern: string, value: unknown): this;
  on(method: Method, pattern: string, handler: unknown): this {
    const fn: Handler = typeof handler === 'function' ? (handler as Handler) : () => handler;
    this.routes.push({ method, pattern, handler: fn, ...compile(pattern) });
    return this;
  }

  /** Every recorded request to `method pattern`, oldest first. */
  calls(method: Method, pattern: string): RecordedCall[] {
    const { regex } = compile(pattern);
    return this.log.filter((call) => call.method === method && regex.test(call.path));
  }

  /** Waits until the page opened the pipeline's WebSocket, then sends `messages` on it. */
  async wsSend(pipelineId: string, ...messages: Partial<WebSocketLogMessage>[]): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!(this.sockets.get(pipelineId)?.length)) {
      if (Date.now() > deadline) throw new Error(`The page never opened the WebSocket of ${pipelineId}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    for (const socket of this.sockets.get(pipelineId) ?? []) {
      for (const message of messages) {
        socket.send(
          JSON.stringify({
            pipeline_id: pipelineId,
            phase: 'execute',
            status: 'running',
            logs: '',
            timestamp: data.NOW,
            ...message,
          }),
        );
      }
    }
  }
}

/**
 * A populated workspace as seen by `me`: one project with a linked repository,
 * one finished run and one deployed model. Every endpoint the UI calls has an
 * answer here; specs override what they are about.
 */
export function installDefaults(api: MockApi, me: UserResponse | null): void {
  const repo = data.repository();
  const project = data.project();
  const run = data.pipeline({ cells: [data.cell()] });

  // Health and auth.
  api
    .on('GET', '/health', { status: 'ok' })
    .on('GET', '/ready', data.ready())
    .on('GET', '/auth/me', () => (me ? me : reply(401, { detail: 'Not authenticated' })))
    .on('PATCH', '/auth/me', ({ body }) => ({ ...me, ...(body as object) }))
    .on('POST', '/auth/login', {
      access_token: 'e2e-token',
      token_type: 'bearer',
      github_token_status: 'ok',
    })
    .on('POST', '/auth/refresh', { access_token: 'e2e-token', token_type: 'bearer', github_token_status: 'ok' })
    .on('POST', '/auth/register', ({ body }) => data.user({ username: `${(body as { username: string }).username}@t` }))
    .on('GET', '/auth/github-token/status', { status: 'ok' })
    .on('PUT', '/auth/github-token', () => me)
    .on('POST', '/auth/set-password', () => ({ ...me, needs_password: false }))
    .on('POST', '/auth/invite', ({ body }) => ({
      token: 'invite-token-123',
      expires_at: data.NOW,
      email: (body as { email: string }).email,
      email_sent: true,
    }))
    .on('POST', '/auth/me/change-password', { message: 'Check your email', email: me?.email ?? '' })
    .on('POST', '/auth/me/change-username', { message: 'Check your email', email: me?.email ?? '' })
    .on('POST', '/auth/confirm-change', () => me ?? data.user())
    .on('POST', '/auth/github/confirm-new', {
      access_token: 'e2e-token',
      token_type: 'bearer',
      github_token_status: 'ok',
    });

  // Repositories and notebooks.
  api
    .on('GET', '/repos', [repo])
    .on('POST', '/repos', reply(201, { repo_id: 2, webhook_url: `${API_ORIGIN}/webhook/github`, status: 'webhook_created' }))
    .on('DELETE', '/repos/:id', reply(204))
    .on('GET', '/repos/:id/branches', [
      { name: 'main', commit_sha: 'abc1234def5678' },
      { name: 'dev', commit_sha: 'fed9876cba5432' },
    ])
    .on('GET', '/repos/:id/notebooks', ['notebooks/train.ipynb'])
    .on('GET', '/repos/:id/notebook', data.editorNotebook())
    .on('PUT', '/repos/:id/notebook', { commit_sha: 'new1234', sha: 'sha-2', changed_cells: 1 })
    .on('POST', '/repos/:id/trigger', reply(202, { status: 'queued', pipeline_id: 'pipeline-002' }));

  // Projects.
  api
    .on('GET', '/projects', [project])
    .on('POST', '/projects', ({ body }) => reply(201, data.project({ id: 2, repository: null, ...(body as object) })))
    .on('GET', '/projects/:id', ({ params }) => data.project({ id: Number(params.id) }))
    .on('PATCH', '/projects/:id', ({ params, body }) => data.project({ id: Number(params.id), ...(body as object) }))
    .on('DELETE', '/projects/:id', reply(204))
    .on('PUT', '/projects/:id/repository', ({ params }) => data.project({ id: Number(params.id) }))
    .on('DELETE', '/projects/:id/repository', ({ params }) => data.project({ id: Number(params.id), repository: null }))
    .on('GET', '/projects/:id/notebook', data.repoNotebook())
    .on('POST', '/projects/:id/run', reply(202, { status: 'queued', pipeline_id: 'pipeline-002' }))
    .on('GET', '/projects/:id/run-settings', data.runSettings())
    .on('GET', '/projects/:id/privacy', ({ params }) =>
      data.projectPrivacy({ project_id: Number(params.id) }),
    )
    .on('PUT', '/projects/:id/privacy', ({ params, body }) =>
      data.projectPrivacy({ project_id: Number(params.id), ...(body as object) }),
    )
    .on('POST', '/projects/:id/privacy/protect', ({ params }) =>
      data.projectPrivacy({ project_id: Number(params.id), protection: { status: 'queued' } }),
    )
    .on('POST', '/projects/:id/privacy/sources/:sourceId/purge', ({ params }) =>
      data.projectPrivacy({ project_id: Number(params.id) }),
    )
    .on('GET', '/projects/:id/privacy/encryption', {
      enabled: false,
      buckets: {},
      objects: 0,
      encrypted: 0,
      unknown: 0,
      job: {},
    })
    .on('POST', '/projects/:id/privacy/encrypt', reply(409, { detail: 'Storage encryption is not configured' }))
    .on('PUT', '/projects/:id/deploy-policy', ({ body }) =>
      data.runSettings({ is_default: false, policy: { ...data.runSettings().policy, ...(body as object) } }),
    )
    .on('GET', '/projects/:id/pipeline-input', data.pipelineInput())
    .on('PUT', '/projects/:id/pipeline-input', ({ body }) => data.pipelineInput({ choice: body as object }))
    .on('GET', '/projects/:id/medallion/inputs', data.pipelineInputOptions());

  // Datasets and uploads.
  api
    .on('GET', '/projects/:id/datasets', [])
    .on('POST', '/projects/:id/datasets', reply(201, data.dataset({ id: 9, name: 'upload.csv', is_active: false })))
    .on('GET', '/projects/:id/uploads', [])
    .on('POST', '/datasets/:id/activate', ({ params }) => data.dataset({ id: Number(params.id), is_active: true }))
    .on('DELETE', '/datasets/:id', reply(204))
    .on('GET', '/datasets/:id/preview', ({ params }) => data.datasetPreview({ dataset_id: Number(params.id) }));

  // Pipelines and the AI advisor.
  api
    .on('GET', '/pipelines', ({ query }) =>
      data.paginated([run], Number(query.get('page') ?? 1), Number(query.get('size') ?? 20)),
    )
    .on('GET', '/pipelines/:id', ({ params }) => ({ ...run, id: params.id }))
    .on('GET', '/pipelines/stats', data.stats())
    .on('GET', '/pipelines/:id/logs', ({ params }) => ({ pipeline_id: params.id, logs: [] }))
    .on('GET', '/pipelines/:id/insights', [])
    .on('POST', '/pipelines/:id/insights', ({ params }) =>
      reply(202, data.insight({ pipeline_id: params.id, status: 'generating', content: '' })),
    )
    .on('POST', '/pipelines/:id/insights/:insightId/apply', ({ params }) =>
      data.insight({ id: Number(params.insightId), pipeline_id: params.id, apply_status: 'queued' }),
    );

  // Models.
  api
    .on('GET', '/models', [data.model()])
    .on('GET', '/models/traffic', { window: '30d', available: true, requests: { 'iris-classifier': 42 } })
    .on('GET', '/models/:name/versions', [data.modelVersion()])
    .on('POST', '/models/:name/predict', ({ params }) => ({
      prediction: [0],
      model_name: params.name,
      version: '1',
      probabilities: null,
    }))
    .on('POST', '/models/:name/rollback', { message: 'Version in service' })
    .on('DELETE', '/models/:name', reply(204))
    .on('PUT', '/models/:name/share', ({ params, body }) =>
      data.shareLink({ model_name: params.name, enabled: (body as { enabled: boolean }).enabled }),
    )
    .on('POST', '/models/:name/share/rotate', ({ params }) =>
      data.shareLink({ model_name: params.name, url: `${API_ORIGIN}/share/rotated/predict` }),
    );

  // Data factory: sources, medallion, cleaning, gold, KPI maker.
  api
    .on('GET', '/sources', [])
    .on('POST', '/sources', ({ body }) => reply(201, data.source({ id: 7, ...(body as object) })))
    .on('DELETE', '/sources/:id', reply(204))
    .on('GET', '/sources/password-envs', { names: ['HOSPITAL_DB_PASSWORD'] })
    .on('POST', '/sources/preview', { columns: ['id'], rows: [[1]], profile: {}, truncated: false })
    .on('POST', '/sources/:id/ingest', ({ params }) =>
      reply(202, data.ingestionRun({ source_id: Number(params.id), status: 'queued' })),
    )
    .on('GET', '/sources/:id/runs', [])
    .on('GET', '/sources/:id/cleaning-recipe', ({ params }) => data.cleaningRecipeState({ source_id: Number(params.id) }))
    .on('PUT', '/sources/:id/cleaning-recipe', ({ params }) =>
      data.cleaningRecipeState({ source_id: Number(params.id), mode: 'custom' }),
    )
    .on('POST', '/sources/:id/reclean', ({ params }) =>
      data.cleaningRecipeState({ source_id: Number(params.id), reclean: { status: 'queued' } }),
    )
    .on('GET', '/projects/:id/medallion', ({ params }) => data.medallion({ project_id: Number(params.id) }))
    .on('GET', '/projects/:id/medallion/:layer/preview', ({ params }) => ({
      layer: params.layer,
      key: '',
      columns: [],
      rows: [],
      object_rows: 0,
      truncated: false,
    }))
    .on('GET', '/projects/:id/medallion/diff', fail(404, 'Nothing extracted yet'))
    .on('GET', '/projects/:id/medallion/steps', fail(404, 'Nothing extracted yet'))
    .on('POST', '/projects/:id/medallion/steps/preview', data.cleaningSteps())
    .on('GET', '/projects/:id/medallion/gold/relations', data.goldRelations())
    .on('POST', '/projects/:id/medallion/gold/preview', ({ body }) => ({
      columns: ['n'],
      rows: [[1]],
      total_rows: 1,
      relations: {},
      sql: (body as { sql: string }).sql,
    }))
    .on('PUT', '/projects/:id/medallion/gold', ({ body }) => data.layer('gold', { sql: (body as { sql: string }).sql, is_default_definition: false }))
    .on('POST', '/projects/:id/medallion/gold/suggest', { sql: 'SELECT 1', explanation: 'Una fila.', error: '' })
    .on('GET', '/projects/:id/dashboard', data.dashboardConversation())
    .on('POST', '/projects/:id/dashboard', data.dashboardConversation())
    .on('GET', '/projects/:id/dashboard/embed', fail(404, 'No dashboard yet'));

  // Grafana, through the backend proxy. The iframe gets a blank page. The
  // wildcard goes first: later registrations win.
  api
    .on('GET', '/grafana/*', html('<!doctype html><title>grafana</title><p>grafana stub</p>'))
    .on('POST', '/grafana/session', { embed_url: `${API_ORIGIN}/grafana/d/x?ticket=t` })
    .on('GET', '/grafana/api/dashboards/uid/:uid', { dashboard: { panels: [{ gridPos: { y: 0, h: 8 } }] } });
}
