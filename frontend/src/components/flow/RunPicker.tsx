import { useState } from 'react';
import { ChevronDown, History } from 'lucide-react';
import type { Pipeline } from '../../types';
import RunList, { BRANCH_CODE } from '../canvas/RunList';
import PipelineStatusBadge from '../PipelineStatus';
import { truncate } from '../../utils/format';

/**
 * Which run the canvas shows: the code on the branch, or one of the recent
 * runs as it left each phase. The list itself is the old view's RunList.
 */
export default function RunPicker({
  runs,
  selected,
  branch,
  onSelect,
}: {
  runs: Pipeline[];
  /** A run id, BRANCH_CODE, or null while the runs load. */
  selected: string | null;
  branch: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const run = runs.find((item) => item.id === selected);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 font-display text-sm text-slate-100 shadow-lg backdrop-blur transition hover:border-slate-500"
      >
        <History size={14} className="text-slate-400" aria-hidden="true" />
        {selected === null ? (
          'Loading…'
        ) : selected === BRANCH_CODE ? (
          `Code on ${branch || 'branch'}`
        ) : (
          <>
            <span className="font-mono text-xs">{truncate(selected, 8)}</span>
            {run && <PipelineStatusBadge status={run.status} />}
          </>
        )}
        <ChevronDown
          size={14}
          className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 max-h-96 w-72 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl">
          <RunList
            runs={runs}
            selected={selected ?? ''}
            branch={branch}
            onSelect={(id) => {
              onSelect(id);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
