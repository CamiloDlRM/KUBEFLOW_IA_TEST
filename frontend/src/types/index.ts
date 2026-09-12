/* ------------------------------------------------------------------ */
/*  Types mirroring backend response schemas from BACKEND_DONE.md     */
/* ------------------------------------------------------------------ */

export interface Repository {
  id: number;
  github_url: string;
  github_token_masked: string;
  branch: string;
  notebook_path: string;
  webhook_id: number | null;
  webhook_url: string | null;
  created_at: string;
  is_active: boolean;
}

export interface CreateRepoPayload {
  github_url: string;
  github_token: string;
  branch: string;
  notebook_path: string;
}

export type PipelineStatus = 'queued' | 'running' | 'success' | 'failed';

export type PhaseStatus = 'pending' | 'running' | 'success' | 'failed';

export interface PipelinePhase {
  name: string;
  status: PhaseStatus;
  timestamp: string;
  logs: string;
}

export interface PipelineMetrics {
  accuracy?: number;
  deployed?: boolean;
  [key: string]: unknown;
}

export interface Pipeline {
  id: string;
  repo_id: number;
  status: PipelineStatus;
  commit_sha: string;
  branch: string;
  started_at: string;
  finished_at: string | null;
  phases: PipelinePhase[];
  metrics: PipelineMetrics;
}

export interface BranchInfo {
  name: string;
  commit_sha: string;
}

export interface TriggerAccepted {
  status: string;
  pipeline_id: string;
}

export interface PaginatedPipelines {
  items: Pipeline[];
  total: number;
  page: number;
  size: number;
}

export interface WebSocketLogMessage {
  pipeline_id: string;
  phase: string;
  status: string;
  logs: string;
  timestamp: string;
}

export interface PipelineLogsResponse {
  pipeline_id: string;
  logs: WebSocketLogMessage[];
}

export interface ModelDeployment {
  model_name: string;
  version: string;
  accuracy: number;
  endpoint_url: string;
  deployed_at: string;
  is_active: boolean;
  pipeline_id: string;
}

export interface PredictionResult {
  prediction: unknown[];
  model_name: string;
  version: string;
}

export interface HealthResponse {
  status: string;
}

export interface ReadyResponse {
  status: string;
  redis: boolean;
  mlflow: boolean;
  model_server: boolean;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

/* ------------------------------------------------------------------ */
/*  Auth                                                               */
/* ------------------------------------------------------------------ */

export interface LoginPayload {
  username: string;
  password: string;
}

export interface RegisterPayload {
  username: string;
  password: string;
  invite_token: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface UserResponse {
  id: number;
  username: string;
  role: 'admin' | 'member';
  email: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ChangePasswordPayload {
  current_password: string;
  new_password: string;
}

export interface ChangeUsernamePayload {
  new_username: string;
}

export interface ChangeRequestedResponse {
  message: string;
  email: string;
}

export interface InviteCreatePayload {
  email: string;
  expires_in_hours: number;
}

export interface InviteTokenResponse {
  token: string;
  expires_at: string;
  email: string;
  email_sent: boolean;
}

/* ------------------------------------------------------------------ */
/*  Datasets                                                           */
/* ------------------------------------------------------------------ */

export interface Dataset {
  id: number;
  repo_id: number;
  name: string;
  description: string;
  bucket: string;
  object_key: string;
  content_type: string;
  size_bytes: number;
  checksum: string;
  uploaded_by: number | null;
  created_at: string;
  is_active: boolean;
  /** How the dataset came to exist. Both paths produce the same shape. */
  origin: 'upload' | 'ingestion';
  /** The extraction that produced it, when there was one. */
  ingestion_run_id: string | null;
  profile: Record<string, ColumnProfile>;
  profiled_rows: number;
}

/** What one column of a dataset turned out to contain. */
export interface ColumnProfile {
  count: number;
  nulls: number;
  null_rate: number;
  blanks: number;
  inferred_type: 'numeric' | 'text' | 'categorical' | 'mixed' | 'empty';
  /** Null when the profiler stopped counting; see distinct_note. */
  distinct: number | null;
  distinct_note?: string;
  uniqueness?: number;
  min?: number;
  max?: number;
  mean?: number;
  stddev?: number;
  min_length?: number;
  max_length?: number;
  top_values: { value: string; count: number }[];
}

/** What an extraction would return, fetched before committing to one. */
export interface SourcePreview {
  columns: string[];
  rows: unknown[][];
  profile: Record<string, ColumnProfile>;
  /** Whether the source holds more than the sample shown. */
  truncated: boolean;
}

/** An external system the platform extracts from. */
export interface DataSource {
  id: number;
  repo_id: number;
  name: string;
  kind: string;
  host: string;
  port: number;
  database: string;
  username: string;
  /** The NAME of an environment variable — never a secret. */
  password_env: string;
  extraction_sql: string;
  watermark_column: string;
  /** Empty until the first run; the next extraction is a full backfill. */
  watermark_value: string;
  normalize_text_column: string;
  normalize_code_column: string;
  created_at: string;
  is_active: boolean;
}

export interface NormalizationSummary {
  rows: number;
  already_coded: number;
  filled: number;
  unresolved: number;
  fill_rate: number;
  vocabulary_size: number;
  by_method: Record<string, number>;
  error?: string;
}

/** One extraction from a source. */
export interface IngestionRun {
  id: string;
  source_id: number;
  status: 'queued' | 'running' | 'success' | 'failed';
  watermark_before: string;
  watermark_after: string;
  rows_extracted: number;
  dataset_id: number | null;
  /** The extract as it left the source, before normalisation. Bronze to the
   *  dataset's silver: kept so the normaliser can be improved and re-run
   *  without going back to a source whose watermark has already moved on. */
  raw_object_key: string;
  /** Where this run landed in each layer. The same string in two buckets, so
   *  the lineage of a row is readable from its path alone. */
  bronze_key: string;
  silver_key: string;
  profile: Record<string, ColumnProfile>;
  normalization: NormalizationSummary | Record<string, never>;
  /** What the cleaning standard changed on the way from bronze to silver. */
  quality_report: QualityReport | Record<string, never>;
  started_at: string | null;
  finished_at: string | null;
  error: string;
}

/* ------------------------------------------------------------------ */
/*  The medallion layers                                               */
/* ------------------------------------------------------------------ */

export type Layer = 'bronze' | 'silver' | 'gold';

/** One rule of the cleaning standard, and what it did to this extraction. */
export interface CleaningRule {
  tier: 'structural' | 'categorical' | 'domain';
  rule: string;
  title: string;
  columns: string[];
  cells_changed: number;
  rows_removed: number;
  columns_removed: number;
  flagged: number;
  note: string;
  examples: { column: string; before: unknown; after: unknown }[];
}

/** The difference between a bronze object and the silver one built from it. */
export interface QualityReport {
  rows_in: number;
  rows_out: number;
  columns_in: number;
  columns_out: number;
  cells_changed: number;
  flagged: number;
  types: Record<string, string>;
  renamed: Record<string, string>;
  /** Only the rules that changed something; `rules_applied` counts them all. */
  rules: CleaningRule[];
  rules_applied: number;
}

/** One source's contribution to a layer. */
export interface LayerStream {
  source_id: number | null;
  source_name: string;
  /** The name this stream is queried under in a gold definition. */
  relation: string;
  objects: number;
  rows: number;
  size_bytes: number;
}

export interface LayerSummary {
  layer: Layer;
  bucket: string;
  objects: number;
  rows: number;
  size_bytes: number;
  last_updated: string | null;
  streams: LayerStream[];
  /** Gold only. */
  sql: string;
  is_default_definition: boolean;
  version: number;
  build_error: string;
}

export interface Medallion {
  repo_id: number;
  bronze: LayerSummary;
  silver: LayerSummary;
  gold: LayerSummary;
}

export interface LayerPreview {
  layer: Layer;
  key: string;
  columns: { name: string; type: string }[];
  rows: unknown[][];
  object_rows: number;
  truncated: boolean;
}

/** One column, as it appears on each side of the cleaning. */
export interface DiffColumn {
  /** `null` on a side means the column is not there. */
  bronze: string | null;
  silver: string | null;
  bronze_type: string;
  silver_type: string;
  change: 'kept' | 'renamed' | 'dropped' | 'added' | 'retyped';
}

export interface DiffRow {
  /** Row number in the bronze object, so the pairing is checkable. */
  row: number;
  bronze: unknown[];
  silver: unknown[];
  cells: ('same' | 'value' | 'type' | 'null' | 'absent')[];
  removed: boolean;
}

export interface LayerDiff {
  run_id: string;
  source_id: number;
  key: string;
  columns: DiffColumn[];
  rows: DiffRow[];
  bronze_rows: number;
  silver_rows: number;
  /** Pairing past the tracked removals is by position rather than known. */
  approximate: boolean;
}

export interface GoldRelations {
  relations: Record<string, { columns: { name: string; type: string }[]; rows: number }>;
  default_sql: string;
}

export interface GoldPreview {
  columns: string[];
  rows: unknown[][];
  total_rows: number;
  relations: Record<string, number>;
  sql: string;
}

export interface GoldSuggestion {
  sql: string;
  explanation: string;
  error: string;
}

export interface DatasetPreview {
  dataset_id: number;
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
}

/* ------------------------------------------------------------------ */
/*  AI Insights                                                        */
/* ------------------------------------------------------------------ */

export type InsightStatus = 'pending' | 'generating' | 'ready' | 'failed';

export type InsightApplyStatus = 'none' | 'queued' | 'applying' | 'pushed' | 'failed';

export interface Insight {
  id: number;
  pipeline_id: string;
  status: InsightStatus;
  content: string;
  model: string;
  error: string;
  created_at: string;
  finished_at: string | null;
  apply_status: InsightApplyStatus;
  apply_error: string;
  apply_branch: string;
  apply_commit_sha: string;
}
