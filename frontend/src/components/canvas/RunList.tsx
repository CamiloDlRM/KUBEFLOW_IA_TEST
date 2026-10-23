import { Link } from 'react-router-dom';
import type { Pipeline } from '../../types';
import PipelineStatusBadge from '../PipelineStatus';
import { formatDate, truncate } from '../../utils/format';
import { mountedOf } from './phases';

/** The view's history: pick a run to see the row as that run left it. */
export const BRANCH_CODE = 'branch';

export default function RunList({
  runs,
  selected,
  branch,
  onSelect,
}: {
  runs: Pipeline[];
  selected: string;
  branch: string;
  onSelect: (id: string) => void;
}) {
  const item = (active: boolean) =>
    `w-full rounded-lg border px-3 py-2 text-left transition ${
      active
        ? 'border-brand-500/70 bg-brand-600/15'
        : 'border-slate-800 bg-slate-900/40 hover:border-slate-600'
    }`;

  return (
    <ul className="space-y-1.5">
      <li>
        <button
          type="button"
          onClick={() => onSelect(BRANCH_CODE)}
          aria-pressed={selected === BRANCH_CODE}
          className={item(selected === BRANCH_CODE)}
        >
          <span className="block text-xs font-medium text-slate-200">Code on {branch}</span>
          <span className="block text-[10px] text-slate-500">what the next run executes</span>
        </button>
      </li>
      {runs.map((run) => (
        <li key={run.id}>
          <button
            type="button"
            onClick={() => onSelect(run.id)}
            aria-pressed={selected === run.id}
            className={item(selected === run.id)}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-slate-300">{truncate(run.id, 8)}</span>
              <PipelineStatusBadge status={run.status} />
            </span>
            <span className="mt-0.5 block truncate text-[10px] text-slate-500">
              {[formatDate(run.started_at), mountedOf(run)?.label].filter(Boolean).join(' · ')}
            </span>
          </button>
        </li>
      ))}
      {runs.length === 0 && (
        <li className="px-1 py-2 text-xs text-slate-500">No runs yet. Press Run to start one.</li>
      )}
      {runs.length > 0 && selected !== BRANCH_CODE && (
        <li className="px-1 pt-1">
          <Link to={`/pipelines/${selected}`} className="text-[11px] text-brand-400 hover:underline">
            Logs, metrics and AI advice for this run →
          </Link>
        </li>
      )}
    </ul>
  );
}
