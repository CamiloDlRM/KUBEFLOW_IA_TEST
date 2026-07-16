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
  started_at: string;
  finished_at: string | null;
  phases: PipelinePhase[];
  metrics: PipelineMetrics;
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
/*  AI Insights                                                        */
/* ------------------------------------------------------------------ */

export type InsightStatus = 'pending' | 'generating' | 'ready' | 'failed';

export interface Insight {
  id: number;
  pipeline_id: string;
  status: InsightStatus;
  content: string;
  model: string;
  error: string;
  created_at: string;
  finished_at: string | null;
}

/* ------------------------------------------------------------------ */
/*  Authentication                                                     */
/* ------------------------------------------------------------------ */

export interface TokenResponse {
  access_token: string;
  token_type: string;
  email: string;
  full_name: string;
}
