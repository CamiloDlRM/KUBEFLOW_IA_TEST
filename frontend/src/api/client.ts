import axios from 'axios';
import type {
  Repository,
  CreateRepoPayload,
  Pipeline,
  PaginatedPipelines,
  PipelineLogsResponse,
  ModelDeployment,
  PredictionResult,
  HealthResponse,
  ReadyResponse,
  LoginPayload,
  RegisterPayload,
  TokenResponse,
  UserResponse,
  InviteCreatePayload,
  InviteTokenResponse,
  ChangePasswordPayload,
  ChangeUsernamePayload,
  ChangeRequestedResponse,
  Insight,
  BranchInfo,
  TriggerAccepted,
  Dataset,
  DatasetPreview,
} from '../types';

/* ------------------------------------------------------------------ */
/*  Axios instance                                                     */
/* ------------------------------------------------------------------ */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const TOKEN_KEY = 'mlops_token';

const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor - attach JWT if present
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor - normalize errors + redirect on 401
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response) {
      if (error.response.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        window.location.href = '/login';
      }
      const detail = error.response.data?.detail;
      const message = typeof detail === 'string' ? detail : error.message;
      return Promise.reject(new Error(message));
    }
    return Promise.reject(error);
  },
);

/* ------------------------------------------------------------------ */
/*  Auth                                                               */
/* ------------------------------------------------------------------ */

export async function login(payload: LoginPayload): Promise<TokenResponse> {
  // Backend uses OAuth2PasswordRequestForm (application/x-www-form-urlencoded)
  const params = new URLSearchParams();
  params.append('username', payload.username);
  params.append('password', payload.password);
  const { data } = await apiClient.post<TokenResponse>('/auth/login', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return data;
}

export async function register(payload: RegisterPayload): Promise<UserResponse> {
  const { data } = await apiClient.post<UserResponse>('/auth/register', payload);
  return data;
}

export async function getMe(): Promise<UserResponse> {
  const { data } = await apiClient.get<UserResponse>('/auth/me');
  return data;
}

export async function updateEmail(email: string): Promise<UserResponse> {
  const { data } = await apiClient.patch<UserResponse>('/auth/me', { email });
  return data;
}

export async function createInvite(payload: InviteCreatePayload): Promise<InviteTokenResponse> {
  const { data } = await apiClient.post<InviteTokenResponse>('/auth/invite', payload);
  return data;
}

export async function requestChangePassword(payload: ChangePasswordPayload): Promise<ChangeRequestedResponse> {
  const { data } = await apiClient.post<ChangeRequestedResponse>('/auth/me/change-password', payload);
  return data;
}

export async function requestChangeUsername(payload: ChangeUsernamePayload): Promise<ChangeRequestedResponse> {
  const { data } = await apiClient.post<ChangeRequestedResponse>('/auth/me/change-username', payload);
  return data;
}

export async function confirmChange(token: string): Promise<UserResponse> {
  const { data } = await apiClient.post<UserResponse>('/auth/confirm-change', { token });
  return data;
}

/* ------------------------------------------------------------------ */
/*  Repositories                                                       */
/* ------------------------------------------------------------------ */

export async function getRepos(): Promise<Repository[]> {
  const { data } = await apiClient.get<Repository[]>('/repos');
  return data;
}

export async function createRepo(payload: CreateRepoPayload): Promise<Repository> {
  const { data } = await apiClient.post<Repository>('/repos', payload);
  return data;
}

export async function deleteRepo(repoId: number): Promise<void> {
  await apiClient.delete(`/repos/${repoId}`);
}

export async function getRepoBranches(repoId: number): Promise<BranchInfo[]> {
  const { data } = await apiClient.get<BranchInfo[]>(`/repos/${repoId}/branches`);
  return data;
}

export async function triggerPipeline(
  repoId: number,
  branch = '',
): Promise<TriggerAccepted> {
  const { data } = await apiClient.post<TriggerAccepted>(
    `/repos/${repoId}/trigger`,
    { branch },
  );
  return data;
}

/* ------------------------------------------------------------------ */
/*  Datasets                                                           */
/* ------------------------------------------------------------------ */

export async function getDatasets(repoId: number): Promise<Dataset[]> {
  const { data } = await apiClient.get<Dataset[]>(`/repos/${repoId}/datasets`);
  return data;
}

export async function uploadDataset(
  repoId: number,
  file: File,
  description = '',
): Promise<Dataset> {
  const form = new FormData();
  form.append('file', file);
  if (description) form.append('description', description);

  const { data } = await apiClient.post<Dataset>(
    `/repos/${repoId}/datasets`,
    form,
    {
      // The axios instance defaults to application/json; unsetting it here lets
      // the browser build the multipart/form-data header with its own boundary.
      headers: { 'Content-Type': undefined },
      // Dataset files can be large - allow more than the default 15s.
      timeout: 120_000,
    },
  );
  return data;
}

export async function activateDataset(datasetId: number): Promise<Dataset> {
  const { data } = await apiClient.post<Dataset>(
    `/datasets/${datasetId}/activate`,
  );
  return data;
}

export async function deleteDataset(datasetId: number): Promise<void> {
  await apiClient.delete(`/datasets/${datasetId}`);
}

export async function getDatasetPreview(datasetId: number): Promise<DatasetPreview> {
  const { data } = await apiClient.get<DatasetPreview>(
    `/datasets/${datasetId}/preview`,
  );
  return data;
}

/* ------------------------------------------------------------------ */
/*  Pipelines                                                          */
/* ------------------------------------------------------------------ */

export async function getPipelines(
  page = 1,
  size = 20,
): Promise<PaginatedPipelines> {
  const { data } = await apiClient.get<PaginatedPipelines>('/pipelines', {
    params: { page, size },
  });
  return data;
}

export async function getPipeline(pipelineId: string): Promise<Pipeline> {
  const { data } = await apiClient.get<Pipeline>(`/pipelines/${pipelineId}`);
  return data;
}

export async function getPipelineLogs(pipelineId: string): Promise<PipelineLogsResponse> {
  const { data } = await apiClient.get<PipelineLogsResponse>(
    `/pipelines/${pipelineId}/logs`,
  );
  return data;
}

/* ------------------------------------------------------------------ */
/*  AI Insights                                                        */
/* ------------------------------------------------------------------ */

export async function getInsights(pipelineId: string): Promise<Insight[]> {
  const { data } = await apiClient.get<Insight[]>(
    `/pipelines/${pipelineId}/insights`,
  );
  return data;
}

export async function generateInsight(pipelineId: string): Promise<Insight> {
  const { data } = await apiClient.post<Insight>(
    `/pipelines/${pipelineId}/insights`,
  );
  return data;
}

export async function applyInsight(
  pipelineId: string,
  insightId: number,
): Promise<Insight> {
  const { data } = await apiClient.post<Insight>(
    `/pipelines/${pipelineId}/insights/${insightId}/apply`,
  );
  return data;
}

/* ------------------------------------------------------------------ */
/*  Models                                                             */
/* ------------------------------------------------------------------ */

export async function getModels(): Promise<ModelDeployment[]> {
  const { data } = await apiClient.get<ModelDeployment[]>('/models');
  return data;
}

export async function predict(
  modelName: string,
  payload: unknown,
): Promise<PredictionResult> {
  const { data } = await apiClient.post<PredictionResult>(
    `/models/${modelName}/predict`,
    payload,
  );
  return data;
}

export async function rollbackModel(modelName: string): Promise<ModelDeployment> {
  const { data } = await apiClient.post<ModelDeployment>(
    `/models/${modelName}/rollback`,
  );
  return data;
}

export async function deleteModel(modelName: string): Promise<void> {
  await apiClient.delete(`/models/${modelName}`);
}

/* ------------------------------------------------------------------ */
/*  Health                                                             */
/* ------------------------------------------------------------------ */

export async function getHealth(): Promise<HealthResponse> {
  const { data } = await apiClient.get<HealthResponse>('/health');
  return data;
}

export async function getReady(): Promise<ReadyResponse> {
  const { data } = await apiClient.get<ReadyResponse>('/ready');
  return data;
}

/* ------------------------------------------------------------------ */
/*  WebSocket URL builder                                              */
/* ------------------------------------------------------------------ */

export function getWsUrl(pipelineId: string): string {
  const base = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';
  return `${base}/pipelines/${pipelineId}/ws`;
}

export default apiClient;
