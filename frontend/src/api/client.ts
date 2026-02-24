import axios from 'axios';
import type {
  Repository,
  CreateRepoPayload,
  Pipeline,
  PaginatedPipelines,
  ModelDeployment,
  PredictionResult,
  HealthResponse,
  ReadyResponse,
} from '../types';

/* ------------------------------------------------------------------ */
/*  Axios instance                                                     */
/* ------------------------------------------------------------------ */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// Response interceptor - normalize errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response) {
      const detail = error.response.data?.detail;
      const message = typeof detail === 'string' ? detail : error.message;
      return Promise.reject(new Error(message));
    }
    return Promise.reject(error);
  },
);

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

export async function getPipelineLogs(pipelineId: string): Promise<string[]> {
  const { data } = await apiClient.get<string[]>(
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
  return `${base}/ws/pipelines/${pipelineId}/logs`;
}

export default apiClient;
