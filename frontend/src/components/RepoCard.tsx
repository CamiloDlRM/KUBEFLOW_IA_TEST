import { Link } from 'react-router-dom';
import type { Repository, Pipeline } from '../types';
import PipelineStatus from './PipelineStatus';
import { repoNameFromUrl, formatDate } from '../utils/format';

interface RepoCardProps {
  repo: Repository;
  latestPipeline?: Pipeline;
  onDelete: (repoId: number) => void;
}

export default function RepoCard({ repo, latestPipeline, onDelete }: RepoCardProps) {
  const name = repoNameFromUrl(repo.github_url);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-5 transition hover:border-slate-600">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-100">{name}</h3>
          <p className="mt-1 text-xs text-slate-400">
            branch: <span className="text-slate-300">{repo.branch}</span>
          </p>
          <p className="text-xs text-slate-400">
            notebook: <span className="text-slate-300">{repo.notebook_path}</span>
          </p>
        </div>
        <button
          onClick={() => onDelete(repo.id)}
          className="ml-2 rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-red-400"
          title="Delete repository"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between">
        {latestPipeline ? (
          <>
            <PipelineStatus status={latestPipeline.status} />
            <span className="text-xs text-slate-500">
              {formatDate(latestPipeline.started_at)}
            </span>
          </>
        ) : (
          <span className="text-xs text-slate-500">No pipelines yet</span>
        )}
      </div>

      {latestPipeline && (
        <Link
          to={`/pipelines/${latestPipeline.id}`}
          className="mt-3 block text-center text-xs font-medium text-brand-400 hover:text-brand-300"
        >
          View latest pipeline
        </Link>
      )}
    </div>
  );
}
