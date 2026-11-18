import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useRepos, usePipelines, useServiceHealth } from '../hooks/usePipelines';
import PipelineStatus from '../components/PipelineStatus';
import MetricsPanels from '../components/MetricsPanels';
import DeployedModels from '../components/DeployedModels';
import DashboardKpis from '../components/DashboardKpis';
import { useProjects } from '../hooks/useDashboard';
import type { Pipeline } from '../types';
import Spinner from '../components/Spinner';
import { formatDate, formatDuration, repoNameFromUrl, truncate } from '../utils/format';
import { runLink } from '../utils/links';
import MaiaEmptyState from '../components/MaiaEmptyState';

/**
 * One dashboard: is it up, what has run, and how is it doing.
 *
 * The Grafana panels used to be a separate page called "Dashboards", sitting
 * one nav item below this one called "Dashboard". Nobody can tell those apart
 * from the sidebar, and there was no difference worth a second page: both
 * answer "how is it going". They are a section here now.
 *
 * The panels go last despite being the thing worth looking at longest, because
 * they are also seventy percent of the viewport tall. Above them, the two
 * things you read in a glance and leave: whether the services are up, and what
 * ran recently.
 *
 * Not a list of repositories.
 *
 * A repository is no longer something you own at the top level: it is
 * something a project links to, alongside its data. Listing repositories here
 * put the code back in front of the data and gave the dashboard a second,
 * competing answer to "where does my work live" — the projects page being the
 * first. Each pipeline below is named by its project; only a run older than
 * projects falls back to the repository it ran on.
 */
export default function Dashboard() {
  const { data: repos } = useRepos();
  const { data: pipelinesPage, isLoading: pipelinesLoading, error: pipelinesError } = usePipelines(1, 5);
  // Members only ever see their own runs, so the User column would say nothing; and the
  // platform's services are the admins' to look after, so only they see their health.
  const { isAdmin } = useAuth();
  const { data: health } = useServiceHealth(isAdmin);

  const { data: projects } = useProjects();

  const pipelines = pipelinesPage?.items ?? [];

  // A run is named by its project, with the branch beneath. Runs older than
  // projects have none, so they keep the repository they ran on.
  const runSource = (p: Pipeline): string => {
    const project = projects?.find((pr) => pr.id === p.project_id);
    if (project) return project.name;
    const repo = repos?.find((r) => r.id === p.repo_id);
    return repo ? repoNameFromUrl(repo.github_url) : `repo #${p.repo_id}`;
  };

  return (
    <div className="space-y-8">
      {/* Page header. Service health sits beside the title: four dots read at a
          glance and did not earn a full-width card of their own. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-100">Dashboard</h2>
          <p className="mt-1 text-sm text-slate-400">
            Recent pipeline runs, {isAdmin ? 'the most requested models and service health' : 'your deployed models'}.
          </p>
        </div>

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Service Health
            </h3>
            <HealthDot label="Backend" ok={Boolean(health)} />
            <HealthDot label="Redis" ok={health?.redis ?? false} />
            <HealthDot label="MLflow" ok={health?.mlflow ?? false} />
            <HealthDot label="Model Server" ok={health?.model_server ?? false} />
          </div>
        )}
      </div>

      <DashboardKpis isAdmin={isAdmin} lastRun={pipelines[0]} />

      {/* What ran and what serves, side by side on a wide screen: both are
          short lists, and stacked they left most of the width empty. */}
      <div className="grid gap-6 xl:grid-cols-5">
        {/* Recent pipelines */}
        <section className="min-w-0 xl:col-span-3">
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
            <MaiaEmptyState action={{ to: '/projects', label: 'Go to projects' }}>
              No pipeline runs yet. Give a project a repository and push to it, and the runs will appear here.
            </MaiaEmptyState>
          )}
  
          {pipelines.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-800/80 text-left text-xs uppercase tracking-wider text-slate-400">
                    <th className="px-4 py-3">Run</th>
                    <th className="px-4 py-3">Project</th>
                    {isAdmin && <th className="px-4 py-3">User</th>}
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Started</th>
                    <th className="px-4 py-3 text-right">Duration</th>
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
                          to={runLink(p.id, p.project_id)}
                          className="font-display text-xs text-brand-400 hover:underline"
                        >
                          {truncate(p.id, 8)}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="block text-slate-200">{runSource(p)}</span>
                        {p.branch && (
                          <span className="block text-xs text-slate-400">{p.branch}</span>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-slate-300">{p.owner_username ?? '--'}</td>
                      )}
                      <td className="px-4 py-3">
                        <PipelineStatus status={p.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">
                        {formatDate(p.started_at)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs tabular-nums text-slate-400">
                        {formatDuration(p.started_at, p.finished_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="min-w-0 xl:col-span-2">
          <DeployedModels isAdmin={isAdmin} />
        </div>
      </div>

      <MetricsPanels />
    </div>
  );
}

/* ---- Helper components ---- */

function HealthDot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2" data-testid="service-health" data-ok={ok}>
      <span
        role="img"
        aria-label={ok ? 'up' : 'down'}
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
