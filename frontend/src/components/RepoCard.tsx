import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import type { Repository, Pipeline } from '../types';
import PipelineStatus from './PipelineStatus';
import Spinner from './Spinner';
import { getRepoBranches, triggerPipeline } from '../api/client';
import { repoNameFromUrl, formatDate } from '../utils/format';

interface RepoCardProps {
  repo: Repository;
  latestPipeline?: Pipeline;
  onDelete: (repoId: number) => void;
}

export default function RepoCard({ repo, latestPipeline, onDelete }: RepoCardProps) {
  const name = repoNameFromUrl(repo.github_url);
  const navigate = useNavigate();
  const [runOpen, setRunOpen] = useState(false);
  const [branch, setBranch] = useState(repo.branch);

  // Branches are only fetched when the run panel is opened
  const { data: branches, isLoading: branchesLoading, error: branchesError } = useQuery({
    queryKey: ['branches', repo.id],
    queryFn: () => getRepoBranches(repo.id),
    enabled: runOpen,
    staleTime: 60_000,
  });

  const runMutation = useMutation({
    mutationFn: () => triggerPipeline(repo.id, branch),
    onSuccess: (res) => {
      setRunOpen(false);
      navigate(`/pipelines/${res.pipeline_id}`);
    },
  });

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

      {/* Run pipeline from a chosen branch */}
      <div className="mt-3 rounded-lg border border-slate-700/70 bg-slate-900/40 p-2">
        {!runOpen ? (
          <button
            onClick={() => setRunOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/10"
          >
            <PlayIcon />
            Run pipeline...
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <BranchIcon />
              {branchesLoading ? (
                <span className="flex items-center gap-2 text-xs text-slate-400">
                  <Spinner size="sm" /> Loading branches...
                </span>
              ) : (
                <select
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100 focus:border-brand-500 focus:outline-none"
                  aria-label="Branch to run from"
                >
                  {(branches ?? [{ name: repo.branch, commit_sha: '' }]).map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                      {b.name === repo.branch ? ' (default)' : ''}
                      {b.name === 'testing-ia-agent' ? ' 🤖' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {(branchesError || runMutation.isError) && (
              <p className="text-xs text-red-400">
                {((branchesError ?? runMutation.error) as Error).message}
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending || branchesLoading}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-600 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                {runMutation.isPending ? <Spinner size="sm" /> : <PlayIcon />}
                Run
              </button>
              <button
                onClick={() => setRunOpen(false)}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-400 transition hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <Link
        to={`/repos/${repo.id}/datasets`}
        className="mt-3 flex items-center justify-center gap-1.5 rounded-md border border-slate-700 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:bg-slate-800 hover:text-slate-100"
      >
        <DatabaseIcon />
        Datasets
      </Link>

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

function PlayIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5.14v13.72a1 1 0 001.5.86l11-6.86a1 1 0 000-1.72l-11-6.86a1 1 0 00-1.5.86z" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7c0-1.657 3.582-3 8-3s8 1.343 8 3-3.582 3-8 3-8-1.343-8-3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 1.657 3.582 3 8 3s8-1.343 8-3V7" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 12c0 1.657 3.582 3 8 3s8-1.343 8-3" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg className="h-4 w-4 shrink-0 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 3a3 3 0 100 6 3 3 0 000-6zM6 9v6m0 0a3 3 0 103 3m-3-3a3 3 0 013-3h6a3 3 0 003-3V9m0 0a3 3 0 10-.001-6.001A3 3 0 0018 9z" />
    </svg>
  );
}
