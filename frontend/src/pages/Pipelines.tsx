import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, ListFilter } from 'lucide-react';
import { getProjects } from '../api/client';
import { usePipelines, useRepos } from '../hooks/usePipelines';
import { useAuth } from '../context/AuthContext';
import type { Pipeline } from '../types';
import PipelineStatus from '../components/PipelineStatus';
import Spinner from '../components/Spinner';
import { formatDate, formatDuration, repoNameFromUrl, truncate } from '../utils/format';

type Sort = 'newest' | 'oldest';
type Group = 'none' | 'project' | 'notebook';

const SORTS: { value: Sort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
];
const GROUPS: { value: Group; label: string }[] = [
  { value: 'none', label: 'No grouping' },
  { value: 'project', label: 'Project' },
  { value: 'notebook', label: 'Notebook' },
];

/** Every run the user can see: searchable, sortable by date and groupable. */
export default function Pipelines() {
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [group, setGroup] = useState<Group>('none');
  const [menuOpen, setMenuOpen] = useState(false);

  // shortcut: works on the 100 newest runs client-side; move search/sort to the API if users need older ones.
  const { data: page, isLoading, error } = usePipelines(1, 100);
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: getProjects });
  const { data: repos } = useRepos();

  const projectName = (id?: number | null) => projects?.find((p) => p.id === id)?.name;
  const repoUrl = (id: number) => repos?.find((r) => r.id === id)?.github_url;
  const repoName = (id: number) => {
    const url = repoUrl(id);
    return url ? repoNameFromUrl(url) : undefined;
  };

  const term = search.trim().toLowerCase();
  const pipelines = (page?.items ?? [])
    .filter(
      (p) =>
        !term ||
        [p.notebook_path, projectName(p.project_id), repoName(p.repo_id)].some((text) =>
          (text ?? '').toLowerCase().includes(term),
        ),
    )
    .sort((a, b) => {
      const diff = Date.parse(b.started_at ?? '') - Date.parse(a.started_at ?? '');
      // Runs not started yet have no date; keep them last either way.
      if (Number.isNaN(diff)) return a.started_at ? -1 : b.started_at ? 1 : 0;
      return sort === 'newest' ? diff : -diff;
    });

  // Group keys alphabetically; runs keep the chosen date order inside each group.
  const groups: [string, Pipeline[]][] =
    group === 'none'
      ? [['', pipelines]]
      : Object.entries(
          pipelines.reduce<Record<string, Pipeline[]>>((acc, p) => {
            const key =
              group === 'project'
                ? projectName(p.project_id) ?? 'No project'
                : p.notebook_path || 'No notebook';
            (acc[key] ??= []).push(p);
            return acc;
          }, {}),
        ).sort(([a], [b]) => a.localeCompare(b));

  const custom = sort !== 'newest' || group !== 'none';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-100">Pipelines</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">Every run of your notebooks.</p>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by notebook, project or repository"
          aria-label="Search pipelines"
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
        />
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Sort and group"
            aria-expanded={menuOpen}
            className={`relative rounded-lg border px-3 py-2 transition hover:bg-slate-800 ${
              custom ? 'border-brand-500 text-brand-400' : 'border-slate-700 text-slate-300'
            }`}
          >
            <ListFilter className="h-5 w-5" aria-hidden="true" />
          </button>
          {menuOpen && (
            <>
              {/* Click anywhere else to close. */}
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-20 mt-2 w-56 rounded-lg border border-slate-700 bg-slate-900 py-2 shadow-xl">
                <MenuSection title="Sort by date" options={SORTS} value={sort} onChange={setSort} />
                <div className="my-2 border-t border-slate-700" />
                <MenuSection title="Group by" options={GROUPS} value={group} onChange={setGroup} />
              </div>
            </>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      )}

      {error != null && (
        <p className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          {(error as Error).message}
        </p>
      )}

      {page && pipelines.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-700 py-16 text-center text-slate-400">
          {page.items.length === 0 ? 'No pipelines yet.' : 'No pipelines match this search.'}
        </p>
      )}

      {pipelines.length > 0 &&
        groups.map(([key, items]) => (
          <section key={key} className="space-y-3">
            {key && (
              <h3 className="text-sm font-semibold text-slate-300">
                {key} <span className="font-normal text-slate-500">({items.length})</span>
              </h3>
            )}
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((p) => (
                <PipelineCard
                  key={p.id}
                  pipeline={p}
                  project={projectName(p.project_id)}
                  repo={repoUrl(p.repo_id)}
                  showOwner={isAdmin}
                />
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

function MenuSection<T extends string>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <p className="px-3 pb-1 text-xs uppercase tracking-wider text-slate-500">{title}</p>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
        >
          {option.label}
          {value === option.value && <Check className="h-4 w-4 text-brand-400" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

function PipelineCard({
  pipeline: p,
  project,
  repo,
  showOwner,
}: {
  pipeline: Pipeline;
  project?: string;
  repo?: string;
  showOwner: boolean;
}) {
  return (
    <li>
      <Link
        to={`/pipelines/${p.id}`}
        className="block h-full rounded-lg border border-slate-700 bg-slate-900 p-4 transition hover:border-brand-500/60 hover:bg-slate-800/60"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="truncate font-mono text-sm font-semibold text-slate-100">
            {p.notebook_path || truncate(p.id, 8)}
          </p>
          <PipelineStatus status={p.status} />
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-500">{project ?? 'No project'}</p>

        <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs">
          <Fact label="Commit" value={truncate(p.commit_sha)} mono />
          <Fact label="Branch" value={p.branch || '--'} />
          <Fact label="Started" value={formatDate(p.started_at)} />
          <Fact label="Duration" value={formatDuration(p.started_at, p.finished_at)} />
          {showOwner && <Fact label="User" value={p.owner_username ?? '--'} />}
        </dl>

        <p className="mt-4 truncate text-xs text-slate-400">
          {repo ? repoNameFromUrl(repo) : `repo #${p.repo_id}`}
        </p>
      </Link>
    </li>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-slate-200 ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}
