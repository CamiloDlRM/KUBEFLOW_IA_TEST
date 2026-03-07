import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRepos, usePipelines, useServiceHealth } from '../hooks/usePipelines';
import { deleteRepo } from '../api/client';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import RepoChips from '../components/dashboard/RepoChips';
import PipelinesTable from '../components/dashboard/PipelinesTable';
import ActivityChart from '../components/dashboard/ActivityChart';
import type { Pipeline, Repository, ReadyResponse } from '../types';

/* ---- Mock data for offline/no-backend mode ---- */
const MOCK_HEALTH: ReadyResponse = {
  status: 'ok',
  redis: true,
  mlflow: true,
  model_server: false,
};

const MOCK_REPOS: Repository[] = [
  {
    id: 1,
    github_url: 'https://github.com/acme/iris-training',
    github_token_masked: '***',
    branch: 'main',
    notebook_path: 'notebooks/train.ipynb',
    webhook_id: null,
    webhook_url: null,
    created_at: '2025-12-01T10:00:00Z',
    is_active: true,
  },
  {
    id: 2,
    github_url: 'https://github.com/acme/sentiment-analysis',
    github_token_masked: '***',
    branch: 'develop',
    notebook_path: 'notebooks/sentiment.ipynb',
    webhook_id: null,
    webhook_url: null,
    created_at: '2025-12-15T14:30:00Z',
    is_active: true,
  },
];

const MOCK_PIPELINES: Pipeline[] = [
  {
    id: 'a1b2c3d4-success',
    repo_id: 1,
    status: 'success',
    commit_sha: 'abc1234def5678',
    started_at: '2025-12-20T08:00:00Z',
    finished_at: '2025-12-20T08:12:30Z',
    phases: [],
    metrics: { accuracy: 0.95, deployed: true },
  },
  {
    id: 'e5f6g7h8-running',
    repo_id: 2,
    status: 'running',
    commit_sha: 'def5678abc1234',
    started_at: new Date().toISOString(),
    finished_at: null,
    phases: [],
    metrics: {},
  },
  {
    id: 'i9j0k1l2-failed',
    repo_id: 1,
    status: 'failed',
    commit_sha: '9876543210abcdef',
    started_at: '2025-12-19T15:00:00Z',
    finished_at: '2025-12-19T15:03:10Z',
    phases: [],
    metrics: {},
  },
];

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { data: reposData, isLoading: reposLoading, error: reposError } = useRepos();
  const { data: pipelinesPage, isLoading: pipelinesLoading, error: pipelinesError } = usePipelines(1, 10);
  const { data: healthData } = useServiceHealth();

  const deleteMutation = useMutation({
    mutationFn: deleteRepo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['repos'] }),
  });

  // Fall back to mock data when backend is unavailable
  const repos = reposData ?? (reposError ? MOCK_REPOS : undefined);
  const pipelines = pipelinesPage?.items ?? (pipelinesError ? MOCK_PIPELINES : []);
  const health = healthData ?? (reposError || pipelinesError ? MOCK_HEALTH : undefined);
  const isMockData = Boolean(reposError || pipelinesError);

  function handleDelete(repoId: number) {
    deleteMutation.mutate(repoId);
  }

  // Compute inline metrics
  const repoCount = repos?.length ?? 0;
  const pipelineCount = pipelines.length;
  const modelCount = pipelines.filter(
    (p) => p.status === 'success' && p.metrics?.deployed,
  ).length;
  const accuracies = pipelines
    .map((p) => p.metrics?.accuracy)
    .filter((a): a is number => a !== undefined && a !== null);
  const avgAccuracy =
    accuracies.length > 0
      ? (accuracies.reduce((s, a) => s + a, 0) / accuracies.length) * 100
      : null;

  return (
    <div className="space-y-8">
      <DashboardHeader
        repoCount={repoCount}
        pipelineCount={pipelineCount}
        modelCount={modelCount}
        avgAccuracy={avgAccuracy}
        health={health}
        isMockData={isMockData}
      />

      {/* Repo chips */}
      {repos && repos.length > 0 && (
        <RepoChips
          repos={repos}
          pipelines={pipelines}
          onDelete={handleDelete}
        />
      )}

      {repos && repos.length === 0 && !reposLoading && (
        <div className="rounded-lg border border-dashed border-[#27272a] py-8 text-center">
          <p className="text-sm text-[#52525b]">Sin repositorios registrados.</p>
        </div>
      )}

      {/* Pipelines table */}
      <PipelinesTable
        pipelines={pipelines}
        repos={repos ?? []}
        isLoading={pipelinesLoading && !isMockData}
      />

      {/* Activity chart */}
      <ActivityChart pipelines={pipelines} />
    </div>
  );
}
