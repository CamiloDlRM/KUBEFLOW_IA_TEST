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
