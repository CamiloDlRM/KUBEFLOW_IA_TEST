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

export async function createInvite(payload: InviteCreatePayload): Promise<InviteTokenResponse> {
  const { data } = await apiClient.post<InviteTokenResponse>('/auth/invite', payload);
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
