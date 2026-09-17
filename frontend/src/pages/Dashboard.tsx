import { Link } from 'react-router-dom';
import { useRepos, usePipelines, useServiceHealth } from '../hooks/usePipelines';
import PipelineStatus from '../components/PipelineStatus';
import Spinner from '../components/Spinner';
import { formatDate, formatDuration, repoNameFromUrl, truncate } from '../utils/format';

/**
 * Health and the last few runs. Not a list of repositories.
 *
 * A repository is no longer something you own at the top level: it is
 * something a project links to, alongside its data. Listing repositories here
 * put the code back in front of the data and gave the dashboard a second,
 * competing answer to "where does my work live" — the projects page being the
 * first. The repository still names each pipeline below, because that is what
 * a pipeline runs on.
 */
export default function Dashboard() {
  const { data: repos } = useRepos();
  const { data: pipelinesPage, isLoading: pipelinesLoading, error: pipelinesError } = usePipelines(1, 5);
  const { data: health } = useServiceHealth();

  const pipelines = pipelinesPage?.items ?? [];

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">Dashboard</h2>
          <p className="mt-1 text-sm text-slate-400">
            Recent pipeline runs and service health.
          </p>
        </div>
        <Link
          to="/projects"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500"
        >
          Projects
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

        {pipelinesError && (
          <ErrorBox message={(pipelinesError as Error).message} />
        )}

        {pipelines.length === 0 && !pipelinesLoading && !pipelinesError && (
          <p className="py-8 text-center text-sm text-slate-500">
            No pipeline runs yet. Give a{' '}
            <Link to="/projects" className="text-brand-400 hover:text-brand-300">
              project
            </Link>{' '}
            a repository and push to it, and the runs will appear here.
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
