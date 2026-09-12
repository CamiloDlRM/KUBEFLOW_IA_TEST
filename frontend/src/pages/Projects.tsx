import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createProject, getProjects } from '../api/client';
import type { Project } from '../types';
import Spinner from '../components/Spinner';
import { formatDate, repoNameFromUrl } from '../utils/format';

/**
 * The projects a user has, and the way to start another.
 *
 * A project is created with a name and nothing else, which is the whole point:
 * before this you needed a GitHub URL before you could connect a database, and
 * getting the data right is usually what comes first and takes longest. The
 * form asks for one field for the same reason.
 */
export default function Projects() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const { data: projects, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
  });

  const create = useMutation({
    mutationFn: () => createProject({ name }),
    onSuccess: () => {
      setName('');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-100">Projects</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          A project holds its data and, when you have one, the repository that trains on it.
          You can start with either.
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) create.mutate();
        }}
        className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-700 bg-slate-900/40 px-5 py-4"
      >
        <label className="min-w-[16rem] flex-1 text-xs text-slate-400">
          Name your project
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Hospital readmissions"
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
          />
        </label>
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-40"
        >
          {create.isPending ? 'Creating…' : 'New project'}
        </button>
        {create.isError && (
          <p className="w-full text-xs text-red-300">{(create.error as Error).message}</p>
        )}
      </form>

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

      {projects && projects.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-700 py-16 text-center text-slate-400">
          No projects yet. Name one above — you can connect data to it straight away.
        </p>
      )}

      {projects && projects.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <li>
      <Link
        to={`/projects/${project.id}`}
        className="block h-full rounded-lg border border-slate-700 bg-slate-900 p-4 transition hover:border-brand-500/60 hover:bg-slate-800/60"
      >
        <p className="truncate text-base font-semibold text-slate-100">{project.name}</p>
        <p className="mt-0.5 text-xs text-slate-500">Created {formatDate(project.created_at)}</p>

        <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs">
          <div>
            <dt className="text-slate-500">Sources</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-slate-200">
              {project.sources}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Rows in gold</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-yellow-200">
              {project.gold_rows.toLocaleString()}
            </dd>
          </div>
        </dl>

        <p className="mt-4 truncate text-xs">
          {project.repository ? (
            <span className="text-slate-400">
              <RepoIcon /> {repoNameFromUrl(project.repository.github_url)}
            </span>
          ) : (
            // Not an error state and not styled as one: a project without code
            // is a project whose data work has started first.
            <span className="text-slate-600">No repository linked yet</span>
          )}
        </p>
      </Link>
    </li>
  );
}

function RepoIcon() {
  return (
    <svg
      className="mr-1 inline-block h-3 w-3"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 5a2 2 0 012-2h10a2 2 0 012 2v14l-7-3-7 3V5z"
      />
    </svg>
  );
}
