import { Link } from 'react-router-dom';
import type { Pipeline, Repository } from '../../types';
import { repoNameFromUrl, truncate, formatDate, formatDuration } from '../../utils/format';
import Spinner from '../Spinner';

interface PipelinesTableProps {
  pipelines: Pipeline[];
  repos: Repository[];
  isLoading?: boolean;
}

const statusConfig: Record<string, { bg: string; text: string; dot: string; pulse?: boolean }> = {
  queued: {
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-500',
    dot: 'bg-yellow-500',
  },
  running: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    dot: 'bg-blue-400',
    pulse: true,
  },
  success: {
    bg: 'bg-green-500/10',
    text: 'text-green-400',
    dot: 'bg-green-500',
  },
  failed: {
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    dot: 'bg-red-500',
  },
};

function getRepoName(repoId: number, repos: Repository[]): string {
  const repo = repos.find((r) => r.id === repoId);
  if (!repo) return `repo #${repoId}`;
  const name = repoNameFromUrl(repo.github_url);
  return name.includes('/') ? name.split('/').pop()! : name;
}

function getAccuracy(pipeline: Pipeline): string {
  if (pipeline.status === 'failed' || pipeline.status === 'queued') return '--';
  if (pipeline.status === 'running') return '--';
  const acc = pipeline.metrics?.accuracy;
  if (acc === undefined || acc === null) return '--';
  return `${(acc * 100).toFixed(1)}%`;
}

export default function PipelinesTable({ pipelines, repos, isLoading }: PipelinesTableProps) {
  if (isLoading) {
    return (
      <section>
        <h3 className="mb-4 text-lg font-semibold text-white">Pipelines Recientes</h3>
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" />
        </div>
      </section>
    );
  }

  if (pipelines.length === 0) {
    return (
      <section>
        <h3 className="mb-4 text-lg font-semibold text-white">Pipelines Recientes</h3>
        <p className="py-12 text-center text-sm text-[#52525b]">
          Sin pipelines aun. Haz push a un repositorio registrado para iniciar uno.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h3 className="mb-4 text-lg font-semibold text-white">Pipelines Recientes</h3>
      <div className="w-full overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[#27272a] text-xs uppercase tracking-wider text-[#52525b]">
              <th className="px-4 pb-3 font-medium">Status</th>
              <th className="px-4 pb-3 font-medium">Pipeline ID</th>
              <th className="px-4 pb-3 font-medium">Repositorio</th>
              <th className="px-4 pb-3 font-medium">Commit</th>
              <th className="px-4 pb-3 font-medium">Duracion</th>
              <th className="px-4 pb-3 font-medium text-right">Accuracy</th>
              <th className="px-4 pb-3 font-medium text-right">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {pipelines.map((p) => {
              const config = statusConfig[p.status] ?? statusConfig.queued;

              return (
                <tr
                  key={p.id}
                  className="border-b border-[#27272a]/50 transition-colors hover:bg-[#18181b]/30"
                >
                  <td className="px-4 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${config.bg} ${config.text} border-current/20`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${config.dot} ${
                          config.pulse ? 'animate-pulse' : ''
                        }`}
                      />
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <Link
                      to={`/pipelines/${p.id}`}
                      className="font-mono text-sm font-medium text-white hover:underline"
                    >
                      {truncate(p.id, 12)}
                    </Link>
                  </td>
                  <td className="px-4 py-4 text-[#a1a1aa]">
                    {getRepoName(p.repo_id, repos)}
                  </td>
                  <td className="px-4 py-4 font-mono text-xs text-[#52525b]">
                    {truncate(p.commit_sha)}
                  </td>
                  <td className="px-4 py-4 text-[#a1a1aa]">
                    {formatDuration(p.started_at, p.finished_at)}
                  </td>
                  <td className="px-4 py-4 text-right font-semibold text-white">
                    {getAccuracy(p)}
                  </td>
                  <td className="px-4 py-4 text-right text-[#52525b]">
                    {formatDate(p.started_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
