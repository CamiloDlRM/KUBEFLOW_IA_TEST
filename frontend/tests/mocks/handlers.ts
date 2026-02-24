import { http, HttpResponse } from 'msw';

// --- Mock data ---

export const mockRepos = [
  {
    id: 1,
    github_url: 'https://github.com/testuser/ml-project',
    github_token_masked: '****abcd',
    branch: 'main',
    notebook_path: 'notebooks/train.ipynb',
    webhook_id: 12345,
    webhook_url: 'http://localhost:3000/api/webhook/github',
    created_at: '2026-02-23T10:00:00Z',
    is_active: true,
  },
  {
    id: 2,
    github_url: 'https://github.com/testuser/data-pipeline',
    github_token_masked: '****efgh',
    branch: 'develop',
    notebook_path: 'notebooks/model.ipynb',
    webhook_id: 12346,
    webhook_url: 'http://localhost:3000/api/webhook/github',
    created_at: '2026-02-23T11:00:00Z',
    is_active: true,
  },
];

export const mockPipelines = {
  items: [
    {
      id: 'pipeline-uuid-001',
      repo_id: 1,
      status: 'success' as const,
      commit_sha: 'abc123def456',
      started_at: '2026-02-23T10:05:00Z',
      finished_at: '2026-02-23T10:10:00Z',
      phases: [
        { name: 'download', status: 'success', timestamp: '2026-02-23T10:05:00Z', logs: '' },
        { name: 'validate', status: 'success', timestamp: '2026-02-23T10:06:00Z', logs: '' },
        { name: 'execute', status: 'success', timestamp: '2026-02-23T10:07:00Z', logs: '' },
        { name: 'register', status: 'success', timestamp: '2026-02-23T10:09:00Z', logs: '' },
        { name: 'deploy', status: 'success', timestamp: '2026-02-23T10:10:00Z', logs: '' },
      ],
      metrics: { accuracy: 0.95, deployed: true },
    },
    {
      id: 'pipeline-uuid-002',
      repo_id: 2,
      status: 'running' as const,
      commit_sha: 'def456abc789',
      started_at: '2026-02-23T11:05:00Z',
      finished_at: null,
      phases: [
        { name: 'download', status: 'success', timestamp: '2026-02-23T11:05:00Z', logs: '' },
        { name: 'validate', status: 'running', timestamp: '2026-02-23T11:06:00Z', logs: '' },
      ],
      metrics: {},
    },
  ],
  total: 2,
  page: 1,
  size: 20,
};

export const mockModels = [
  {
    model_name: 'iris-classifier',
    version: '1',
    accuracy: 0.95,
    endpoint_url: 'http://model-server:8001/predict/iris-classifier',
    deployed_at: '2026-02-23T10:10:00Z',
    is_active: true,
    pipeline_id: 'pipeline-uuid-001',
  },
  {
    model_name: 'fraud-detector',
    version: '3',
    accuracy: 0.88,
    endpoint_url: 'http://model-server:8001/predict/fraud-detector',
    deployed_at: '2026-02-22T15:30:00Z',
    is_active: true,
    pipeline_id: 'pipeline-uuid-003',
  },
];

export const mockPredictionResult = {
  prediction: [0, 1, 2],
  model_name: 'iris-classifier',
  version: '1',
};

export const mockHealth = { status: 'ok' };

export const mockReady = {
  status: 'ok',
  redis: true,
  mlflow: true,
  model_server: true,
};

// --- MSW Handlers ---

const API_BASE = 'http://localhost:8000';

export const handlers = [
  // Repositories
  http.get(`${API_BASE}/repos`, () => {
    return HttpResponse.json(mockRepos);
  }),

  http.post(`${API_BASE}/repos`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(
      {
        repo_id: 3,
        webhook_url: 'http://localhost:3000/api/webhook/github',
        status: 'webhook_created',
      },
      { status: 201 },
    );
  }),

  http.delete(`${API_BASE}/repos/:id`, () => {
    return HttpResponse.json({ message: 'Repository deleted.' });
  }),

  // Pipelines
  http.get(`${API_BASE}/pipelines`, ({ request }) => {
    const url = new URL(request.url);
    const size = Number(url.searchParams.get('size') || '20');
    return HttpResponse.json({
      ...mockPipelines,
      size,
    });
  }),

  http.get(`${API_BASE}/pipelines/:id`, ({ params }) => {
    const pipeline = mockPipelines.items.find((p) => p.id === params.id);
    if (!pipeline) {
      return HttpResponse.json({ detail: 'Pipeline not found.' }, { status: 404 });
    }
    return HttpResponse.json(pipeline);
  }),

  http.get(`${API_BASE}/pipelines/:id/logs`, ({ params }) => {
    return HttpResponse.json({
      pipeline_id: params.id,
      logs: [
        { pipeline_id: params.id, phase: 'download', status: 'success', logs: 'Downloaded notebook', timestamp: '2026-02-23T10:05:00Z' },
      ],
    });
  }),

  // Models
  http.get(`${API_BASE}/models`, () => {
    return HttpResponse.json(mockModels);
  }),

  http.post(`${API_BASE}/models/:name/predict`, () => {
    return HttpResponse.json(mockPredictionResult);
  }),

  http.post(`${API_BASE}/models/:name/rollback`, () => {
    return HttpResponse.json({ message: 'Rolled back.' });
  }),

  http.delete(`${API_BASE}/models/:name`, () => {
    return HttpResponse.json({ message: 'Model deleted.' });
  }),

  // Health
  http.get(`${API_BASE}/health`, () => {
    return HttpResponse.json(mockHealth);
  }),

  http.get(`${API_BASE}/ready`, () => {
    return HttpResponse.json(mockReady);
  }),
];
