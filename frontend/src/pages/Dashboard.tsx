import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRepos, usePipelines, useServiceHealth } from '../hooks/usePipelines';
import { deleteRepo } from '../api/client';
import RepoCard from '../components/RepoCard';
import PipelineStatus from '../components/PipelineStatus';
import Spinner from '../components/Spinner';
import { formatDate, formatDuration, repoNameFromUrl, truncate } from '../utils/format';
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
  const { data: pipelinesPage, isLoading: pipelinesLoading, error: pipelinesError } = usePipelines(1, 5);
  const { data: healthData } = useServiceHealth();

  const deleteMutation = useMutation({
    mutationFn: deleteRepo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['repos'] }),
  });

  // Fall back to mock data when backend is unavailable
  const repos = reposData ?? (reposError ? MOCK_REPOS : undefined);
  const pipelines = pipelinesPage?.items ?? (pipelinesError ? MOCK_PIPELINES : []);
  const health = healthData ?? (reposError || pipelinesError ? MOCK_HEALTH : undefined);

  function handleDelete(repoId: number) {
    if (window.confirm('Are you sure you want to delete this repository?')) {
      deleteMutation.mutate(repoId);
    }
  }

  /** Find latest pipeline for a given repo id */
  function latestPipelineForRepo(repoId: number): Pipeline | undefined {
    return pipelines.find((p) => p.repo_id === repoId);
  }

  return (
    <div className="space-y-8">
      {/* Mock data banner */}
      {(reposError || pipelinesError) && (
        <div className="rounded-lg border border-yellow-800 bg-yellow-900/20 px-4 py-3 text-sm text-yellow-300">
          Backend unavailable — showing mock data for preview.
        </div>
      )}

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">Dashboard</h2>
          <p className="mt-1 text-sm text-slate-400">
            Overview of repositories, pipelines, and service health.
          </p>
        </div>
        <Link
          to="/repos/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500"
        >
          + Add Repository
        </Link>
      </div>

      {/* Service health */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Service Health
        </h3>
        <div className="flex flex-wrap gap-4">
          <HealthDot label="Backend" ok={Boolean(health)} />
          <HealthDot label="Redis" ok={health?.redis ?? false} />
          <HealthDot label="MLflow" ok={health?.mlflow ?? false} />
          <HealthDot label="Model Server" ok={health?.model_server ?? false} />
        </div>
      </div>

      {/* Repositories */}
      <section>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Repositories
        </h3>

        {reposLoading && (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" />
          </div>
        )}

        {reposError && !repos && (
          <ErrorBox message={(reposError as Error).message} />
        )}

        {repos && repos.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-700 py-12 text-center">
            <p className="text-slate-400">No repositories registered yet.</p>
            <Link
              to="/repos/new"
              className="mt-3 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500"
            >
              + Add your first repository
            </Link>
          </div>
        )}

        {repos && repos.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {repos.map((repo) => (
              <RepoCard
                key={repo.id}
                repo={repo}
                latestPipeline={latestPipelineForRepo(repo.id)}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </section>

      {/* Recent pipelines */}
      <section>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Recent Pipelines
        </h3>

        {pipelinesLoading && (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" />
          </div>
        )}

        {pipelinesError && pipelines.length === 0 && (
          <ErrorBox message={(pipelinesError as Error).message} />
        )}

        {pipelines.length === 0 && !pipelinesLoading && !pipelinesError && (
          <p className="py-8 text-center text-sm text-slate-500">
            No pipeline runs yet. Push to a registered repository to trigger a pipeline.
          </p>
        )}

        {pipelines.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-800/80 text-left text-xs uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3">Pipeline</th>
                  <th className="px-4 py-3">Repository</th>
                  <th className="px-4 py-3">Commit</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Duration</th>
                </tr>
              </thead>
              <tbody>
                {pipelines.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-slate-800 hover:bg-slate-800/40 transition"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/pipelines/${p.id}`}
                        className="font-mono text-xs text-brand-400 hover:underline"
                      >
                        {truncate(p.id, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {repos?.find((r) => r.id === p.repo_id)
                        ? repoNameFromUrl(repos.find((r) => r.id === p.repo_id)!.github_url)
                        : `repo #${p.repo_id}`}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">
                      {truncate(p.commit_sha)}
                    </td>
                    <td className="px-4 py-3">
                      <PipelineStatus status={p.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {formatDate(p.started_at)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {formatDuration(p.started_at, p.finished_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ---- Helper components ---- */

function HealthDot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`}
      />
      <span className="text-sm text-slate-300">{label}</span>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
      Failed to load data: {message}
    </div>
  );
}
