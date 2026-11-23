/**
 * Response builders for the mock backend.
 *
 * Every builder returns a complete, typed object with plausible defaults and
 * takes a partial override, so a spec only states what it is about. Types come
 * from `src/types`, so a backend schema change that the frontend adopts breaks
 * these at compile time (`npm run typecheck:e2e`) instead of at run time.
 */
import type {
  CleaningRecipe,
  CleaningRecipeState,
  CleaningSteps,
  DashboardConversation,
  DataSource,
  Dataset,
  DatasetPreview,
  EditorNotebook,
  GoldRelations,
  IngestionRun,
  Insight,
  LayerSummary,
  Medallion,
  ModelDeployment,
  ModelVersion,
  NotebookCell,
  Pipeline,
  PipelineInputOptions,
  PipelineInputState,
  PipelinePhase,
  PipelineStats,
  Project,
  ProjectPrivacy,
  ReadyResponse,
  Repository,
  RepoNotebook,
  RunSettings,
  ShareLink,
  UploadStatus,
  UserResponse,
} from '../../../src/types';

export const NOW = '2026-11-18T10:00:00Z';
export const EARLIER = '2026-11-18T09:55:00Z';

export function user(overrides: Partial<UserResponse> = {}): UserResponse {
  return {
    id: 2,
    username: 'ana@t',
    role: 'member',
    email: 'ana@example.com',
    is_active: true,
    created_at: '2026-01-10T08:00:00Z',
    needs_password: false,
    auth_provider: 'token',
    has_github_token: true,
    github_token_masked: '****abcd',
    ...overrides,
  };
}

export function admin(overrides: Partial<UserResponse> = {}): UserResponse {
  return user({ id: 1, username: 'admin', role: 'admin', email: 'admin@example.com', ...overrides });
}

export function repository(overrides: Partial<Repository> = {}): Repository {
  return {
    id: 1,
    github_url: 'https://github.com/testuser/ml-project',
    github_token_masked: '****abcd',
    webhook_id: 12345,
    webhook_url: 'http://localhost:8000/webhook/github',
    created_at: '2026-02-23T10:00:00Z',
    is_active: true,
    notebooks: [],
    ...overrides,
  };
}

export function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: 'Iris',
    description: 'Clasificador de flores',
    owner_id: 1,
    created_at: '2026-02-23T10:00:00Z',
    repository: {
      id: 1,
      github_url: 'https://github.com/testuser/ml-project',
      branch: 'main',
      notebook_path: 'notebooks/train.ipynb',
    },
    sources: 0,
    gold_rows: 0,
    active_dataset: null,
    deployed_model: null,
    ...overrides,
  };
}

export function projectPrivacy(overrides: Partial<ProjectPrivacy> = {}): ProjectPrivacy {
  return {
    project_id: 1,
    classification: 'general',
    legal_basis: null,
    policy: { pseudonymize: [], suppress: [], keep: [] },
    protection: {},
    unprotected_runs: 0,
    sources: [],
    legal_bases: [
      {
        kind: 'authorization',
        title: 'Authorisation of the data subjects',
        law: 'Ley 1581 de 2012, arts. 6(a) and 9',
        reference_hint: 'Where the authorisations are kept.',
      },
      {
        kind: 'scientific',
        title: 'Scientific or statistical purpose, with ethics approval',
        law: 'Ley 1581 de 2012, art. 6(e); Resolución 8430 de 1993',
        reference_hint: 'Ethics committee approval.',
      },
      {
        kind: 'synthetic',
        title: 'Synthetic data, no real data subjects',
        law: 'Outside Ley 1581',
        reference_hint: 'Generator and version.',
      },
    ],
    egress: [],
    egress_total: 0,
    access: [],
    access_total: 0,
    purges: [],
    ...overrides,
  };
}

export function phase(name: string, status: PipelinePhase['status'] = 'success', logs = ''): PipelinePhase {
  return { name, status, timestamp: NOW, logs };
}

export function cell(overrides: Partial<NotebookCell> = {}): NotebookCell {
  return {
    index: 0,
    phase: 'training',
    tags: ['mlops:training'],
    source: 'model.fit(X, y)',
    output: '',
    error: '',
    status: 'completed',
    ...overrides,
  };
}

export function pipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'pipeline-001',
    repo_id: 1,
    project_id: 1,
    notebook_path: 'notebooks/train.ipynb',
    status: 'success',
    commit_sha: 'abc1234def5678',
    branch: 'main',
    started_at: EARLIER,
    finished_at: NOW,
    phases: [
      phase('download'),
      phase('validate'),
      phase('execute'),
      phase('log_mlflow'),
      phase('deploy'),
    ],
    metrics: { accuracy: 0.95, deployed: true },
    owner_username: 'admin',
    mounted_input: {},
    model_name: 'iris-classifier',
    model_version: '1',
    cells: [],
    ...overrides,
  };
}

export function paginated(items: Pipeline[], page = 1, size = 20) {
  return { items, total: items.length, page, size };
}

export function stats(overrides: Partial<PipelineStats> = {}): PipelineStats {
  return {
    window_days: 7,
    finished: 4,
    succeeded: 3,
    success_rate: 0.75,
    previous_success_rate: 0.5,
    ...overrides,
  };
}

export function model(overrides: Partial<ModelDeployment> = {}): ModelDeployment {
  return {
    model_name: 'iris-classifier',
    version: '1',
    accuracy: 0.95,
    metric: 'accuracy',
    metric_value: 0.95,
    endpoint_url: 'http://model-server:8001/predict/iris-classifier',
    deployed_at: '2026-02-23T10:10:00Z',
    is_active: true,
    pipeline_id: 'pipeline-001',
    project_id: 1,
    owner_username: 'admin',
    model_card: {},
    share_url: null,
    ...overrides,
  };
}

export function modelVersion(overrides: Partial<ModelVersion> = {}): ModelVersion {
  return {
    version: '1',
    pipeline_id: 'pipeline-001',
    mlflow_run_id: 'run-1',
    trained_at: NOW,
    metrics: { accuracy: 0.95 },
    accuracy: 0.95,
    branch: 'main',
    commit_sha: 'abc1234def5678',
    input_label: 'iris.csv',
    deployed_at: NOW,
    is_active: true,
    deployable: true,
    parameters: {},
    ...overrides,
  };
}

export function shareLink(overrides: Partial<ShareLink> = {}): ShareLink {
  return {
    model_name: 'iris-classifier',
    enabled: true,
    url: 'http://localhost:8000/share/abc123/predict',
    per_ip_per_minute: 30,
    per_link_per_minute: 300,
    max_rows: 100,
    ...overrides,
  };
}

export function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: 1,
    project_id: 1,
    name: 'iris.csv',
    description: '',
    bucket: 'datasets',
    object_key: 'projects/1/iris.csv',
    content_type: 'text/csv',
    size_bytes: 4_550,
    checksum: 'sha256:0',
    uploaded_by: 1,
    created_at: NOW,
    is_active: true,
    origin: 'upload',
    ingestion_run_id: null,
    profile: {},
    profiled_rows: 150,
    ...overrides,
  };
}

export function datasetPreview(overrides: Partial<DatasetPreview> = {}): DatasetPreview {
  return {
    dataset_id: 1,
    columns: ['sepal_length', 'species'],
    rows: [
      [5.1, 'setosa'],
      [6.2, 'versicolor'],
    ],
    truncated: false,
    ...overrides,
  };
}

export function upload(overrides: Partial<UploadStatus> = {}): UploadStatus {
  return {
    dataset_id: 1,
    name: 'iris.csv',
    size_bytes: 4_550,
    created_at: NOW,
    status: 'success',
    error: '',
    rows_in: 150,
    rows_kept: 150,
    source_id: 1,
    source_name: 'iris.csv',
    ...overrides,
  };
}

export function source(overrides: Partial<DataSource> = {}): DataSource {
  return {
    id: 1,
    project_id: 1,
    name: 'Hospital HIS',
    kind: 'postgres',
    host: 'hospital-db',
    port: 5432,
    database: 'his',
    username: 'reader',
    password_env: 'HOSPITAL_DB_PASSWORD',
    extraction_sql: 'SELECT * FROM admissions',
    watermark_column: 'updated_at',
    watermark_value: '',
    normalize_text_column: '',
    normalize_code_column: '',
    created_at: NOW,
    is_active: true,
    ...overrides,
  };
}

export function ingestionRun(overrides: Partial<IngestionRun> = {}): IngestionRun {
  return {
    id: 'run-001',
    source_id: 1,
    status: 'success',
    watermark_before: '',
    watermark_after: NOW,
    rows_extracted: 120,
    dataset_id: null,
    raw_object_key: '',
    bronze_key: 'bronze/1/run-001.txt',
    silver_key: 'silver/1/run-001.parquet',
    profile: {},
    normalization: {},
    quality_report: {},
    started_at: EARLIER,
    finished_at: NOW,
    error: '',
    ...overrides,
  };
}

export function layer(name: LayerSummary['layer'], overrides: Partial<LayerSummary> = {}): LayerSummary {
  return {
    layer: name,
    bucket: name,
    objects: 0,
    rows: 0,
    size_bytes: 0,
    last_updated: null,
    streams: [],
    sql: '',
    is_default_definition: true,
    version: 0,
    build_error: '',
    ...overrides,
  };
}

export function medallion(overrides: Partial<Medallion> = {}): Medallion {
  return {
    project_id: 1,
    bronze: layer('bronze'),
    silver: layer('silver'),
    gold: layer('gold'),
    ...overrides,
  };
}

export function pipelineInput(overrides: Partial<PipelineInputState> = {}): PipelineInputState {
  return { choice: {}, resolved: null, error: '', ...overrides };
}

export function pipelineInputOptions(overrides: Partial<PipelineInputOptions> = {}): PipelineInputOptions {
  return { bronze: [], silver: [], gold: [], ...overrides };
}

export function runSettings(overrides: Partial<RunSettings> = {}): RunSettings {
  return {
    policy: {
      auto_deploy: true,
      metric: 'accuracy',
      threshold: 0.8,
      direction: 'higher',
      must_beat_serving: false,
    },
    is_default: true,
    metrics_available: ['accuracy'],
    last_parameters: {},
    ...overrides,
  };
}

export function repoNotebook(overrides: Partial<RepoNotebook> = {}): RepoNotebook {
  return {
    branch: 'main',
    notebook_path: 'notebooks/train.ipynb',
    cells: [
      cell({ index: 0, phase: 'config', tags: ['mlops:config'], source: "MODEL_NAME = 'iris-classifier'", status: 'pending' }),
      cell({ index: 1, phase: 'training', tags: ['mlops:training'], source: 'model.fit(X, y)', status: 'pending' }),
      cell({ index: 2, phase: 'export', tags: ['mlops:export'], source: 'joblib.dump(model, MODEL_OUTPUT_PATH)', status: 'pending' }),
    ],
    ...overrides,
  };
}

export function editorNotebook(overrides: Partial<EditorNotebook> = {}): EditorNotebook {
  return {
    branch: 'main',
    notebook_path: 'notebooks/train.ipynb',
    sha: 'sha-1',
    cells: [
      { index: 0, cell_type: 'markdown', source: '# Iris training', tags: [] },
      { index: 1, cell_type: 'code', source: "MODEL_NAME = 'iris-classifier'", tags: ['mlops:config'] },
      { index: 2, cell_type: 'code', source: 'model.fit(X, y)', tags: ['mlops:training'] },
    ],
    linked_projects: ['Iris'],
    ...overrides,
  };
}

export function insight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: 1,
    pipeline_id: 'pipeline-001',
    status: 'ready',
    content: '## Recomendaciones\n\nAumenta `n_estimators` a 200.',
    model: 'claude-sonnet-5-5',
    error: '',
    created_at: NOW,
    finished_at: NOW,
    apply_status: 'none',
    apply_error: '',
    apply_branch: '',
    apply_commit_sha: '',
    ...overrides,
  };
}

export function ready(overrides: Partial<ReadyResponse> = {}): ReadyResponse {
  return { status: 'ok', redis: true, mlflow: true, model_server: true, ...overrides };
}

export function dashboardConversation(overrides: Partial<DashboardConversation> = {}): DashboardConversation {
  return { turns: [], superset_url: '', ...overrides };
}

export function goldRelations(overrides: Partial<GoldRelations> = {}): GoldRelations {
  return { relations: {}, default_sql: '', ...overrides };
}

const EMPTY_RECIPE: CleaningRecipe = {
  disabled: [],
  null_tokens: [],
  keep_as_text: [],
  force_types: {},
  dedupe_on: [],
  categorical_max_distinct: 20,
  fold_skip: [],
  sex_columns: null,
  ranges: [],
  normalize: null,
  steps: [],
};

export function cleaningRecipeState(overrides: Partial<CleaningRecipeState> = {}): CleaningRecipeState {
  return {
    source_id: 1,
    mode: 'standard',
    recipe: EMPTY_RECIPE,
    standard: EMPTY_RECIPE,
    rules: [],
    forceable_types: ['integer', 'double', 'text'],
    lossy: [],
    normalize_default: { mode: 'off', text_column: '', code_column: '', min_confidence: 0.9 },
    normalize_modes: ['off', 'suggest', 'fill'],
    runs: 0,
    stale_runs: 0,
    reclean: {},
    ...overrides,
  };
}

export function cleaningSteps(overrides: Partial<CleaningSteps> = {}): CleaningSteps {
  return { run_id: 'run-001', source_id: 1, rows_in: 0, rows_out: 0, sample: 0, steps: [], ...overrides };
}
