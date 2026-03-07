import { Link } from 'react-router-dom';
import { Github, Trash2, Plus } from 'lucide-react';
import type { Repository, Pipeline } from '../../types';
import { repoNameFromUrl } from '../../utils/format';

interface RepoChipsProps {
  repos: Repository[];
  pipelines: Pipeline[];
  onDelete: (repoId: number) => void;
}

export default function RepoChips({ repos, pipelines, onDelete }: RepoChipsProps) {
  function getRepoStatus(repoId: number): 'active' | 'failed' | 'inactive' {
    const latest = pipelines.find((p) => p.repo_id === repoId);
    if (!latest) return 'inactive';
    if (latest.status === 'failed') return 'failed';
    return 'active';
  }

  const statusDot: Record<string, string> = {
    active: 'bg-emerald-500',
    failed: 'bg-red-500',
    inactive: 'bg-[#52525b]',
  };

  return (
    <div className="flex items-center gap-3 overflow-x-auto pb-1 scrollbar-none">
      {repos.map((repo) => {
        const status = getRepoStatus(repo.id);
        const name = repoNameFromUrl(repo.github_url);
        const shortName = name.includes('/') ? name.split('/').pop()! : name;

        return (
          <div
            key={repo.id}
            className="group flex shrink-0 items-center gap-2 rounded-lg border border-[#27272a] bg-[#18181b]/60 px-4 py-2.5 transition-colors hover:border-[#3f3f46]"
          >
            <Github size={14} className="text-[#a1a1aa]" />
            <span className="max-w-[160px] truncate text-sm font-medium text-white">
              {shortName}
            </span>
            <span className="rounded bg-[#27272a] px-1.5 py-0.5 text-[10px] font-medium text-[#a1a1aa]">
              {repo.branch}
            </span>
            <div className={`h-1.5 w-1.5 rounded-full ${statusDot[status]}`} />
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm('Eliminar este repositorio?')) {
                  onDelete(repo.id);
                }
              }}
              className="ml-0.5 hidden rounded p-0.5 text-[#52525b] transition-colors hover:text-red-400 group-hover:block"
              title="Eliminar repositorio"
            >
              <Trash2 size={12} />
            </button>
          </div>
        );
      })}

      {/* Add repo button */}
      <Link
        to="/repos/new"
        className="flex shrink-0 items-center gap-2 rounded-lg border border-dashed border-[#27272a] px-4 py-2.5 text-sm text-[#52525b] transition-colors hover:border-[#3f3f46] hover:text-[#a1a1aa]"
      >
        <Plus size={14} />
        <span>Agregar</span>
      </Link>
    </div>
  );
}
