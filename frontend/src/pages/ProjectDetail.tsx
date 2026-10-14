import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getProject,
  getRepos,
  getRepoBranches,
  getRepoNotebooks,
  linkRepository,
  unlinkRepository,
} from '../api/client';
import type { Project } from '../types';
import Spinner from '../components/Spinner';
import { repoNameFromUrl } from '../utils/format';
import { ChevronDown } from 'lucide-react';

/**
 * One project: its data factory, and the code it trains with.
 *
 * The order on the page is the argument. Data comes first because it comes
 * first in the work — and because a project can have all of it with no
 * repository at all. The repository is below, presented as something to attach
 * when there is something to train.
 */
export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);

  const { data: project, isLoading, error } = useQuery({
    queryKey: ['project', id],
    queryFn: () => getProject(id),
    enabled: Number.isFinite(id),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }
  if (error != null || !project) {
    return (
      <p className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
        {(error as Error)?.message ?? 'Project not found.'}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/projects"
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-400 hover:text-brand-300"
        >
          ← All projects
        </Link>
        <h2 className="mt-2 text-2xl font-bold text-slate-100">{project.name}</h2>
        {project.description && (
          <p className="mt-1 max-w-2xl text-sm text-slate-400">{project.description}</p>
        )}
      </div>

      <Link
        to={`/projects/${project.id}/data`}
        className="block rounded-lg border border-slate-700 bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/20 px-5 py-5 transition hover:border-amber-700/60"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Data Factory</h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Where the data comes in, gets cleaned, and becomes the table this project
              trains on. Six stages, and you can jump to any you have reached.
            </p>
          </div>
          <div className="flex gap-6 text-right">
            <div>
              <p className="text-xs text-slate-500">Sources</p>
              <p className="text-xl font-semibold tabular-nums text-slate-100">
                {project.sources}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Rows in gold</p>
              <p className="text-xl font-semibold tabular-nums text-yellow-200">
                {project.gold_rows.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </Link>

      <RepositorySection project={project} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  The code half                                                      */
/* ------------------------------------------------------------------ */

function RepositorySection({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['project', project.id] });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
  };

  const link = useMutation({
    mutationFn: ({ repoId, branch, notebookPath }: { repoId: number; branch: string; notebookPath: string }) =>
      linkRepository(project.id, repoId, branch, notebookPath),
    onSuccess: () => {
      setPicking(false);
      invalidate();
    },
  });

  const unlink = useMutation({
    mutationFn: () => unlinkRepository(project.id),
    onSuccess: invalidate,
  });

  const { data: repos } = useQuery({
    queryKey: ['repos'],
    queryFn: getRepos,
    enabled: picking,
  });

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/40">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
        <div>
          <h3 className="text-base font-semibold text-slate-100">Repository</h3>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            The notebook that trains on this project's data. Linking it is optional and
            reversible — unlinking leaves the data exactly where it is.
          </p>
        </div>
        {project.repository ? (
          <button
            onClick={() => unlink.mutate()}
            disabled={unlink.isPending}
            className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
          >
            {unlink.isPending ? 'Unlinking…' : 'Unlink'}
          </button>
        ) : (
          <button
            onClick={() => setPicking((open) => !open)}
            className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-500"
          >
            {picking ? 'Cancel' : 'Link a repository'}
          </button>
        )}
      </header>

      <div className="px-5 py-4">
        {project.repository ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-100">
                {repoNameFromUrl(project.repository.github_url)}
              </p>
              <p className="truncate font-mono text-xs text-slate-500">
                {project.repository.branch} · {project.repository.notebook_path}
              </p>
            </div>
          </div>
        ) : picking ? (
          <RepoPicker
            repos={repos}
            onPick={(repoId, branch, notebookPath) => link.mutate({ repoId, branch, notebookPath })}
            busy={link.isPending}
            error={link.isError ? (link.error as Error).message : null}
          />
        ) : (
          <p className="py-2 text-sm text-slate-500">
            No repository linked. The data factory works without one — link code when there
            is something to train.
          </p>
        )}

        {unlink.isError && (
          <p className="mt-2 text-xs text-red-300">{(unlink.error as Error).message}</p>
        )}
      </div>
    </section>
  );
}

function RepoPicker({
  repos,
  onPick,
  busy,
  error,
}: {
  repos: { id: number; github_url: string; branch: string }[] | undefined;
  onPick: (repoId: number, branch: string, notebookPath: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [branch, setBranch] = useState('main');
  const [notebookPath, setNotebookPath] = useState('');
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [notebookMenuOpen, setNotebookMenuOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const branches = useQuery({
    queryKey: ['repo-branches', selectedId],
    queryFn: () => getRepoBranches(selectedId as number),
    enabled: selectedId !== null,
  });
  const notebooks = useQuery({
    queryKey: ['repo-notebooks', selectedId, branch],
    queryFn: () => getRepoNotebooks(selectedId as number, branch),
    enabled: selectedId !== null && Boolean(branch),
  });

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setBranchMenuOpen(false);
        setNotebookMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', closeMenus);
    return () => document.removeEventListener('mousedown', closeMenus);
  }, []);
  if (!repos) {
    return <Spinner />;
  }
  if (repos.length === 0) {
    return (
      <p className="py-2 text-sm text-slate-500">
        You have no repositories registered.{' '}
        <Link to="/repos/new" className="text-brand-400 hover:text-brand-300">
          Add one
        </Link>{' '}
        and it will appear here.
      </p>
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {repos.map((repo) => (
          <li key={repo.id}>
            <button
              onClick={() => {
                setSelectedId(repo.id);
                setBranch(repo.branch || 'main');
                setNotebookPath('');
              }}
              disabled={busy}
              className="flex w-full items-center justify-between gap-3 rounded border border-slate-700 px-3 py-2 text-left transition hover:border-brand-500/60 hover:bg-slate-800/60 disabled:opacity-40"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm text-slate-100">
                  {repoNameFromUrl(repo.github_url)}
                </span>
                <span className="block truncate font-mono text-xs text-slate-500">
                  {repo.branch}
                </span>
              </span>
              <span className="shrink-0 text-xs text-brand-400">
                {selectedId === repo.id ? 'Selected' : 'Explore'}
              </span>
            </button>
            {selectedId === repo.id && (
              <div ref={pickerRef} className="space-y-2 rounded border border-slate-800 p-3">
                <BranchMenu
                  value={branch}
                  options={(branches.data ?? [{ name: branch }]).map((item) => item.name)}
                  open={branchMenuOpen}
                  onToggle={() => {
                    setBranchMenuOpen((open) => !open);
                    setNotebookMenuOpen(false);
                  }}
                  onSelect={(value) => {
                    setBranch(value);
                    setNotebookPath('');
                    setBranchMenuOpen(false);
                  }}
                  disabled={branches.isLoading || branches.isError}
                />
                <BranchMenu
                  value={notebookPath}
                  placeholder="Select a notebook"
                  options={notebooks.data ?? []}
                  open={notebookMenuOpen}
                  onToggle={() => {
                    setNotebookMenuOpen((open) => !open);
                    setBranchMenuOpen(false);
                  }}
                  onSelect={(value) => {
                    setNotebookPath(value);
                    setNotebookMenuOpen(false);
                  }}
                  disabled={notebooks.isLoading || notebooks.data?.length === 0}
                />
                <button
                  type="button"
                  onClick={() => onPick(repo.id, branch, notebookPath)}
                  disabled={!notebookPath || busy}
                  className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  {busy ? 'Linking…' : 'Link selected notebook'}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </>
  );
}

function BranchMenu({
  value,
  placeholder = 'Select a branch',
  options,
  open,
  onToggle,
  onSelect,
  disabled,
}: {
  value: string;
  placeholder?: string;
  options: string[];
  open: boolean;
  onToggle: () => void;
  onSelect: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-lg border border-brand-500/20 bg-brand-600/20 py-2 pl-3 pr-3 text-left text-sm font-medium text-brand-400 transition hover:bg-brand-600/30 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="truncate">{value || placeholder}</span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-0.5 max-h-52 overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 p-1.5 shadow-xl"
        >
          {options.map((option) => (
            <li key={option} role="option" aria-selected={option === value}>
              <button
                type="button"
                onClick={() => onSelect(option)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                  option === value
                    ? 'bg-brand-600/25 text-brand-300'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                }`}
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
