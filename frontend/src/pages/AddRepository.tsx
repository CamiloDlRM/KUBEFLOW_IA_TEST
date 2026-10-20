import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRepo, getRepoBranches, getRepoNotebooks, getRepos } from '../api/client';
import type { Repository } from '../types';
import Spinner from '../components/Spinner';
import { ChevronDown } from 'lucide-react';

const GITHUB_URL_REGEX = /^https:\/\/github\.com\/[\w.\-]+\/[\w.\-]+\/?$/;

export default function AddRepository() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const repos = useQuery({
    queryKey: ['repos'],
    queryFn: getRepos,
  });

  const mutation = useMutation({
    mutationFn: createRepo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repos'] });
      setUrl('');
      setToken('');
      setValidationError(null);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);

    if (!GITHUB_URL_REGEX.test(url.trim())) {
      setValidationError('Please enter a valid GitHub repository URL (e.g. https://github.com/user/repo)');
      return;
    }

    if (!token.trim()) {
      setValidationError('A GitHub Personal Access Token is required.');
      return;
    }

    mutation.mutate({
      github_url: url.trim(),
      github_token: token.trim(),
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-slate-100">My Repos</h2>
            <p className="mt-1 text-sm text-slate-400">
              Register a GitHub repository to monitor for notebook changes. A webhook will be
              created to trigger pipelines on push events.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFormOpen((open) => !open)}
            aria-expanded={formOpen}
            aria-controls="add-repository-form"
            aria-label={formOpen ? 'Collapse repository form' : 'Expand repository form'}
            title={formOpen ? 'Collapse form' : 'Expand form'}
            className="rounded-lg border border-slate-700 p-2 text-slate-300 transition hover:border-brand-500/60 hover:bg-slate-800"
          >
            <ChevronDown
              size={18}
              aria-hidden="true"
              className={`transition-transform ${formOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {mutation.isSuccess && (
        <p className="rounded-lg border border-emerald-700 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-300">
          Repository registered. Explore its branches and notebooks below.
        </p>
      )}

      {/* Form */}
      {formOpen && (
        <form id="add-repository-form" onSubmit={handleSubmit} className="mx-auto max-w-lg space-y-5 rounded-lg border border-slate-700 bg-slate-900/40 p-5">
          {/* Validation / mutation errors */}
          {(validationError || mutation.isError) && (
            <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
              {validationError ?? (mutation.error as Error).message}
            </div>
          )}

          {/* GitHub URL */}
          <div>
            <label htmlFor="repo-url" className="mb-1 block text-sm font-medium text-slate-300">
              GitHub Repository URL
            </label>
            <input
              id="repo-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/user/repo"
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Token */}
          <div>
            <label htmlFor="token" className="mb-1 block text-sm font-medium text-slate-300">
              GitHub Personal Access Token
            </label>
            <div className="relative">
              <input
                id="token"
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_..."
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 pr-16 text-sm text-slate-100 placeholder-slate-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                type="button"
                onClick={() => setShowToken((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
              >
                {showToken ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-50"
            >
              {mutation.isPending && <Spinner size="sm" />}
              {mutation.isPending ? 'Registering...' : 'Register Repository'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="rounded-lg border border-slate-700 px-5 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <section className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-100">Your repositories</h3>
          <p className="mt-1 text-sm text-slate-400">
            Each repository is registered once per account. Explore its current branches and notebooks here.
            Link a repository to a project to run pipelines.
          </p>
        </div>
        {repos.isLoading && <Spinner />}
        {repos.isError && (
          <p className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
            {(repos.error as Error).message}
          </p>
        )}
        {repos.data?.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-500">
            No repositories registered yet.
          </p>
        )}
        {repos.data && repos.data.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {repos.data.map((repo) => <RepositoryCard key={repo.id} repo={repo} />)}
          </div>
        )}
      </section>
    </div>
  );
}

const TAG_CLASS =
  'inline-flex rounded-full border border-brand-500/30 bg-brand-600/15 px-2.5 py-1 text-xs font-medium text-brand-400 transition hover:border-brand-400/60 hover:bg-brand-600/30 hover:text-brand-300';

function RepositoryCard({ repo }: { repo: Repository }) {
  const [branch, setBranch] = useState(repo.branch || 'main');

  return (
    <article className="rounded-lg border border-slate-700 bg-slate-900 p-3 transition hover:border-brand-500/60 hover:bg-slate-800/60">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-base font-semibold text-slate-100">
            {repoName(repo.github_url)}
          </h4>
          <div className="mt-2 flex flex-wrap gap-2">
            <a
              href={repo.github_url}
              target="_blank"
              rel="noreferrer"
              className={TAG_CLASS}
            >
              Link
            </a>
            {repo.project_id !== null ? (
              <Link
                to={`/projects/${repo.project_id}`}
                title="Open project"
                className={`${TAG_CLASS} max-w-[12rem] truncate`}
              >
                {repo.project_name}
              </Link>
            ) : (
              <span
                title="Link this repository to a project to run pipelines"
                className="inline-flex rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-400"
              >
                No project
              </span>
            )}
          </div>
        </div>
        {repo.webhook_enabled ? (
          <span className="shrink-0 rounded-full bg-emerald-900/50 px-2 py-0.5 text-xs text-emerald-300">
            webhook active
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-400">
            webhook inactive
          </span>
        )}
      </div>
      <RepositoryExplorer
        repoId={repo.id}
        repoUrl={repo.github_url}
        branch={branch}
        onBranchChange={setBranch}
      />
    </article>
  );
}

function repoName(url: string): string {
  return url.replace(/\/+$/, '').split('/').pop()?.replace(/\.git$/, '') || 'Repository';
}

function RepositoryExplorer({
  repoId,
  repoUrl,
  branch,
  onBranchChange,
}: {
  repoId: number;
  repoUrl: string;
  branch: string;
  onBranchChange: (branch: string) => void;
}) {
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const branchMenuRef = useRef<HTMLDivElement>(null);
  const branches = useQuery({
    queryKey: ['repo-branches', repoId],
    queryFn: () => getRepoBranches(repoId),
  });
  const notebooks = useQuery({
    queryKey: ['repo-notebooks', repoId, branch],
    queryFn: () => getRepoNotebooks(repoId, branch),
    enabled: Boolean(branch),
  });

  useEffect(() => {
    function closeBranchMenu(event: MouseEvent) {
      if (
        branchMenuRef.current &&
        !branchMenuRef.current.contains(event.target as Node)
      ) {
        setBranchMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', closeBranchMenu);
    return () => document.removeEventListener('mousedown', closeBranchMenu);
  }, []);

  return (
    <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Repository explorer</p>
      <label className="mt-3 block text-xs text-slate-400">
        Branch
        <div ref={branchMenuRef} className="relative mt-1">
          <button
            type="button"
            onClick={() => setBranchMenuOpen((open) => !open)}
            disabled={branches.isLoading || branches.isError}
            aria-haspopup="listbox"
            aria-expanded={branchMenuOpen}
            className="flex w-full items-center justify-between rounded-lg border border-brand-500/20 bg-brand-600/20 py-2 pl-3 pr-3 text-left text-sm font-medium text-brand-400 transition hover:bg-brand-600/30 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="truncate">{branch || 'Select a branch'}</span>
            <ChevronDown
              size={16}
              aria-hidden="true"
              className={`shrink-0 transition-transform ${branchMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {branchMenuOpen && (
            <ul
              role="listbox"
              aria-label="Repository branches"
              className="absolute left-0 right-0 z-20 mt-0.5 max-h-52 overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 p-1.5 shadow-xl"
            >
              {branches.data?.map((item) => (
                <li key={item.name} role="option" aria-selected={item.name === branch}>
                  <button
                    type="button"
                    onClick={() => {
                      onBranchChange(item.name);
                      setBranchMenuOpen(false);
                    }}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                      item.name === branch
                        ? 'bg-brand-600/25 text-brand-300'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                    }`}
                  >
                    {item.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </label>
      <p className="mt-3 text-xs text-slate-400">Notebooks found in this branch</p>
      {notebooks.isLoading && <p className="mt-1 text-sm text-slate-500">Exploring…</p>}
      {notebooks.isError && <p className="mt-1 text-sm text-red-300">{(notebooks.error as Error).message}</p>}
      {notebooks.data && notebooks.data.length === 0 && (
        <p className="mt-1 text-sm text-slate-500">No .ipynb files found.</p>
      )}
      {notebooks.data && notebooks.data.length > 0 && (
        <ul className="mt-1 space-y-1 text-sm text-slate-200">
          {notebooks.data.map((path) => (
            <li key={path} className="font-mono">
              <a
                href={notebookUrl(repoUrl, branch, path)}
                target="_blank"
                rel="noreferrer"
                className="text-brand-400 underline-offset-2 hover:text-brand-300 hover:underline"
              >
                {path}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function notebookUrl(repoUrl: string, branch: string, path: string): string {
  const baseUrl = repoUrl.replace(/\/+$/, '').replace(/\.git$/, '');
  const encodedBranch = encodeURIComponent(branch);
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `${baseUrl}/blob/${encodedBranch}/${encodedPath}`;
}
