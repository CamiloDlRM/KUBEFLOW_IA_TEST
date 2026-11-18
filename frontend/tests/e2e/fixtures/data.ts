/**
 * Builders for the API's response shapes.
 *
 * Each one is typed against `src/types`, so a change to the backend contract
 * that the frontend picks up breaks `npm run typecheck:e2e` here instead of
 * leaving the mocks quietly describing an API that no longer exists.
 *
 * Every builder takes a partial override; the defaults describe one coherent
 * "happy" installation: one project, linked to one repository, with a
 * successful run that deployed a model.
 */
import type {
  BranchInfo,
  CleaningRecipe,
  CleaningRecipeState,
  CleaningSteps,
  DataSource,
  Dataset,
  DatasetPreview,
  DeployPolicy,
  EditorNotebook,
  GoldRelations,
  IngestionRun,
  Insight,
  LayerSummary,
  Medallion,
  ModelDeployment,
  ModelTraffic,
  ModelVersion,
  Pipeline,
  PipelineInputOptions,
  PipelineInputState,
  PipelineStats,
  Project,
  ReadyResponse,
  RepoNotebook,
  Repository,
  RunSettings,
  ShareLink,
  UploadStatus,
  UserResponse,
} from '../../../src/types';

export const NOW = '2026-11-18T10:00:00Z';
export const EARLIER = '2026-11-18T09:00:00Z';

export const IDS = {
  project: 1,
  repo: 1,
  pipeline: 'pl-0001-success',
  runningPipeline: 'pl-0002-running',
  failedPipeline: 'pl-0003-failed',
  model: 'churn-model',
  dataset: 11,
  source: 21,
  insight: 31,
} as const;

export function user(over: Partial<UserResponse> = {}): UserResponse {
  return {
    id: 2,
    username: 'ana@t',
    role: 'member',
    email: 'ana@example.com',
    is_active: true,
    created_at: EARLIER,
    needs_password: false,
    auth_provider: 'token',
    has_github_token: true,
    github_token_masked: '****abcd',
    ...over,
  };
}

export function admin(over: Partial<UserResponse> = {}): UserResponse {
  return user({ id: 1, username: 'admin', role: 'admin', email: 'admin@example.com', ...over });
}

export function repository(over: Partial<Repository> = {}): Repository {
  return {
    id: IDS.repo,
    github_url: 'https://github.com/acme/churn',
    github_token_masked: '****abcd',
    webhook_id: 12345,
    webhook_url: 'http://localhost:8000/webhook/github',
    created_at: EARLIER,
    is_active: true,
    notebooks: [
      {
        project_id: IDS.project,
        project_name: 'Churn',
        branch: 'main',
        notebook_path: 'notebooks/train.ipynb',
        active_pipeline_id: IDS.pipeline,
      },
    ],
    ...over,
  };
}

export function project(over: Partial<Project> = {}): Project {
  return {
    id: IDS.project,
    name: 'Churn',
    description: 'Predict which customers leave',
    owner_id: 2,
    created_at: EARLIER,
    repository: {
      id: IDS.repo,
      github_url: 'https://github.com/acme/churn',
      branch: 'main',
      notebook_path: 'notebooks/train.ipynb',
    },
    sources: 1,
    gold_rows: 1200,
    active_dataset: { id: IDS.dataset, name: 'gold-v3.parquet', size_bytes: 48_000 },
    deployed_model: IDS.model,
    ...over,
  };
}

const PHASES = ['download', 'validate', 'execute', 'register', 'deploy'] as const;

export function pipeline(over: Partial<Pipeline> = {}): Pipeline {
  return {
    id: IDS.pipeline,
    repo_id: IDS.repo,
    project_id: IDS.project,
    notebook_path: 'notebooks/train.ipynb',
    status: 'success',
    commit_sha: 'abc123def4567890',
    branch: 'main',
    started_at: EARLIER,
    finished_at: NOW,
    phases: PHASES.map((name) => ({ name, status: 'success', timestamp: EARLIER, logs: `${name} ok` })),
    metrics: { accuracy: 0.91, deployed: true },
    owner_username: 'ana@t',
    mounted_input: {
      layer: 'gold',
      label: 'gold v3',
      bucket: 'gold',
      keys: ['project-1/gold/v3.parquet'],
      version: 3,
    },
    model_name: IDS.model,
    model_version: '3',
    cells: [
      {
        index: 0,
        phase: 'config',
        tags: ['mlops:config'],
        source: "MODEL_NAME = 'churn-model'\nVERSION = '3'",
        output: '',
        error: '',
        status: 'completed',
      },
      {
        index: 1,
        phase: 'training',
        tags: ['mlops:training'],
        source: 'model.fit(X, y)',
        output: 'RandomForestClassifier()',
        error: '',
        status: 'completed',
      },
    ],
    ...over,
  };
}

export function runningPipeline(over: Partial<Pipeline> = {}): Pipeline {
  return pipeline({
    id: IDS.runningPipeline,
    status: 'running',
    finished_at: null,
    commit_sha: 'fedcba9876543210',
    phases: [
      { name: 'download', status: 'success', timestamp: NOW, logs: '' },
      { name: 'validate', status: 'running', timestamp: NOW, logs: '' },
    ],
    metrics: {},
    model_name: '',
    model_version: '',
    ...over,
  });
}

export function failedPipeline(over: Partial<Pipeline> = {}): Pipeline {
  return pipeline({
    id: IDS.failedPipeline,
    status: 'failed',
    commit_sha: '0011223344556677',
    phases: [
      { name: 'download', status: 'success', timestamp: EARLIER, logs: '' },
      { name: 'validate', status: 'failed', timestamp: EARLIER, logs: 'Missing tag mlops:export' },
    ],
    metrics: {},
    model_name: '',
    model_version: '',
    ...over,
  });
}

export function model(over: Partial<ModelDeployment> = {}): ModelDeployment {
  return {
    model_name: IDS.model,
    version: '3',
    accuracy: 0.91,
    metric: 'accuracy',
    metric_value: 0.91,
    endpoint_url: `http://localhost:8001/predict/${IDS.model}`,
    deployed_at: NOW,
    is_active: true,
    pipeline_id: IDS.pipeline,
    project_id: IDS.project,
    owner_username: 'ana@t',
    model_card: {
      kind: 'classifier',
      rows: 1200,
      inputs: [
        { name: 'tenure', type: 'number', min: 0, p05: 1, median: 24, p95: 70, max: 72 },
        { name: 'monthly_charges', type: 'number', min: 18, p05: 20, median: 70, p95: 110, max: 120 },
      ],
      classes: [0, 1],
      baseline: { values: [24, 70], prediction: 0, probabilities: { '0': 0.8, '1': 0.2 } },
    },
    share_url: null,
    ...over,
  };
}

export function modelVersion(over: Partial<ModelVersion> = {}): ModelVersion {
  return {
    version: '3',
    pipeline_id: IDS.pipeline,
    mlflow_run_id: 'mlflowrun0003',
    trained_at: NOW,
    metrics: { accuracy: 0.91, f1: 0.88 },
    accuracy: 0.91,
    branch: 'main',
    commit_sha: 'abc123def4567890',
    input_label: 'gold v3',
    deployed_at: NOW,
    is_active: true,
    deployable: true,
    parameters: { n_estimators: 200 },
    ...over,
  };
}

export function shareLink(over: Partial<ShareLink> = {}): ShareLink {
  return {
    model_name: IDS.model,
    enabled: true,
    url: `http://localhost:8000/public/predict/sharetoken123`,
    per_ip_per_minute: 30,
    per_link_per_minute: 120,
    max_rows: 100,
    ...over,
  };
}

export function stats(over: Partial<PipelineStats> = {}): PipelineStats {
  return {
    window_days: 30,
    finished: 10,
    succeeded: 8,
    success_rate: 0.8,
    previous_success_rate: 0.7,
    ...over,
  };
}

export function traffic(over: Partial<ModelTraffic> = {}): ModelTraffic {
  return { window: '30d', available: true, requests: { [IDS.model]: 42 }, ...over };
}

export function ready(over: Partial<ReadyResponse> = {}): ReadyResponse {
  return { status: 'ok', redis: true, mlflow: true, model_server: true, ...over };
}

export function dataset(over: Partial<Dataset> = {}): Dataset {
  return {
    id: IDS.dataset,
    project_id: IDS.project,
    name: 'gold-v3.parquet',
    description: 'Gold build v3',
    bucket: 'datasets',
    object_key: 'project-1/gold-v3.parquet',
    content_type: 'application/octet-stream',
    size_bytes: 48_000,
    checksum: 'sha256:abc',
    uploaded_by: 2,
    created_at: NOW,
    is_active: true,
    origin: 'ingestion',
    ingestion_run_id: null,
    profile: {
      tenure: {
        count: 1200,
        nulls: 0,
        null_rate: 0,
        blanks: 0,
        inferred_type: 'numeric',
        distinct: 72,
        min: 0,
        max: 72,
        mean: 32,
        top_values: [],
      },
    },
    profiled_rows: 1200,
    ...over,
  };
}

export function datasetPreview(over: Partial<DatasetPreview> = {}): DatasetPreview {
  return {
    dataset_id: IDS.dataset,
    columns: ['tenure', 'monthly_charges', 'churn'],
    rows: [
      [1, 29.85, 0],
      [34, 56.95, 1],
    ],
    truncated: false,
    ...over,
  };
}

export function upload(over: Partial<UploadStatus> = {}): UploadStatus {
  return {
    dataset_id: 12,
    name: 'customers.csv',
    size_bytes: 2048,
    created_at: NOW,
    status: 'success',
    error: '',
    rows_in: 100,
    rows_kept: 98,
    source_id: IDS.source,
    source_name: 'customers.csv',
    ...over,
  };
}

export function source(over: Partial<DataSource> = {}): DataSource {
  return {
    id: IDS.source,
    project_id: IDS.project,
    name: 'crm',
    kind: 'postgres',
    host: 'crm-db',
    port: 5432,
    database: 'crm',
    username: 'reader',
    password_env: 'CRM_DB_PASSWORD',
    extraction_sql: 'SELECT * FROM customers',
    watermark_column: 'updated_at',
    watermark_value: EARLIER,
    normalize_text_column: '',
    normalize_code_column: '',
    created_at: EARLIER,
    is_active: true,
    ...over,
  };
}

export function ingestionRun(over: Partial<IngestionRun> = {}): IngestionRun {
  return {
    id: 'run-0001',
    source_id: IDS.source,
    status: 'success',
    watermark_before: '',
    watermark_after: EARLIER,
    rows_extracted: 1200,
    dataset_id: IDS.dataset,
    raw_object_key: 'raw/run-0001.parquet',
    bronze_key: 'project-1/crm/run-0001.parquet',
    silver_key: 'project-1/crm/run-0001.parquet',
    profile: {},
    normalization: {},
    quality_report: {},
    started_at: EARLIER,
    finished_at: NOW,
    error: '',
    ...over,
  };
}

function layer(name: 'bronze' | 'silver' | 'gold', over: Partial<LayerSummary> = {}): LayerSummary {
  return {
    layer: name,
    bucket: name,
    objects: name === 'gold' ? 1 : 2,
    rows: 1200,
    size_bytes: 48_000,
    last_updated: NOW,
    streams: [
      { source_id: IDS.source, source_name: 'crm', relation: 'crm', objects: 2, rows: 1200, size_bytes: 48_000 },
    ],
    sql: name === 'gold' ? 'SELECT * FROM crm' : '',
    is_default_definition: true,
    version: name === 'gold' ? 3 : 0,
    build_error: '',
    ...over,
  };
}

export function medallion(over: Partial<Medallion> = {}): Medallion {
  return {
    project_id: IDS.project,
    bronze: layer('bronze'),
    silver: layer('silver'),
    gold: layer('gold'),
    ...over,
  };
}

export function emptyMedallion(): Medallion {
  const empty = { objects: 0, rows: 0, size_bytes: 0, last_updated: null, streams: [], version: 0 };
  return medallion({
    bronze: layer('bronze', empty),
    silver: layer('silver', empty),
    gold: layer('gold', { ...empty, sql: '' }),
  });
}

export function goldRelations(over: Partial<GoldRelations> = {}): GoldRelations {
  return {
    relations: {
      crm: {
        columns: [
          { name: 'tenure', type: 'BIGINT' },
          { name: 'churn', type: 'BIGINT' },
        ],
        rows: 1200,
      },
    },
    default_sql: 'SELECT * FROM crm',
    ...over,
  };
}

export function cleaningSteps(over: Partial<CleaningSteps> = {}): CleaningSteps {
  return {
    run_id: 'run-0001',
    source_id: IDS.source,
    rows_in: 1200,
    rows_out: 1198,
    sample: 20,
    steps: [],
    ...over,
  };
}

const STANDARD_RECIPE: CleaningRecipe = {
  disabled: [],
  null_tokens: ['', 'NA', 'null'],
  keep_as_text: [],
  force_types: {},
  dedupe_on: [],
  categorical_max_distinct: 50,
  fold_skip: [],
  sex_columns: null,
  ranges: [],
  normalize: null,
  steps: [],
};

export function cleaningRecipe(over: Partial<CleaningRecipeState> = {}): CleaningRecipeState {
  return {
    source_id: IDS.source,
    mode: 'standard',
    recipe: STANDARD_RECIPE,
    standard: STANDARD_RECIPE,
    rules: [],
    forceable_types: ['integer', 'float', 'text'],
    lossy: [],
    normalize_default: { mode: 'off', text_column: '', code_column: '', min_confidence: 0.85 },
    normalize_modes: ['off', 'suggest', 'fill'],
    runs: 2,
    stale_runs: 0,
    reclean: {},
    ...over,
  };
}

export function deployPolicy(over: Partial<DeployPolicy> = {}): DeployPolicy {
  return {
    auto_deploy: true,
    metric: 'accuracy',
    threshold: 0.7,
    direction: 'higher',
    must_beat_serving: false,
    ...over,
  };
}

export function runSettings(over: Partial<RunSettings> = {}): RunSettings {
  return {
    policy: deployPolicy(),
    is_default: true,
    metrics_available: ['accuracy', 'f1'],
    last_parameters: { n_estimators: 200 },
    ...over,
  };
}

export function pipelineInput(over: Partial<PipelineInputState> = {}): PipelineInputState {
  return {
    choice: { layer: 'gold', version: 3 },
    resolved: {
      layer: 'gold',
      label: 'gold v3',
      bucket: 'gold',
      keys: ['project-1/gold/v3.parquet'],
      version: 3,
    },
    error: '',
    ...over,
  };
}

export function pipelineInputOptions(over: Partial<PipelineInputOptions> = {}): PipelineInputOptions {
  return {
    bronze: [{ source_id: IDS.source, source_name: 'crm', objects: 2, size_bytes: 48_000 }],
    silver: [{ source_id: IDS.source, source_name: 'crm', objects: 2, size_bytes: 48_000 }],
    gold: [{ version: 3, key: 'project-1/gold/v3.parquet', size_bytes: 48_000, built_at: NOW, latest: true }],
    ...over,
  };
}

export function repoNotebook(over: Partial<RepoNotebook> = {}): RepoNotebook {
  return {
    branch: 'main',
    notebook_path: 'notebooks/train.ipynb',
    cells: pipeline().cells ?? [],
    ...over,
  };
}

export function editorNotebook(over: Partial<EditorNotebook> = {}): EditorNotebook {
  return {
    branch: 'main',
    notebook_path: 'notebooks/train.ipynb',
    sha: 'blobsha0001',
    cells: [
      { index: 0, cell_type: 'markdown', source: '# Churn training', tags: [] },
      { index: 1, cell_type: 'code', source: "MODEL_NAME = 'churn-model'", tags: ['mlops:config'] },
      { index: 2, cell_type: 'code', source: 'model.fit(X, y)', tags: ['mlops:training'] },
    ],
    linked_projects: ['Churn'],
    ...over,
  };
}

export function branches(): BranchInfo[] {
  return [
    { name: 'main', commit_sha: 'abc123def4567890' },
    { name: 'testing-ia-agent', commit_sha: '9988776655443322' },
  ];
}

export function insight(over: Partial<Insight> = {}): Insight {
  return {
    id: IDS.insight,
    pipeline_id: IDS.pipeline,
    status: 'ready',
    content: '## Diagnosis\n\nThe model is slightly overfitting.\n\n## Improvements\n\n1. Add regularisation.',
    model: 'claude-sonnet-5-5',
    error: '',
    created_at: NOW,
    finished_at: NOW,
    apply_status: 'none',
    apply_error: '',
    apply_branch: '',
    apply_commit_sha: '',
    ...over,
  };
}

/** A paginated `/pipelines` response. */
export function page<T>(items: T[]) {
  return { items, total: items.length, page: 1, size: 20 };
}
