import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { reviewRepoNotebook } from '../../api/client';
import type { EditorCell } from '../../types';
import { MaiaAvatar } from '../flow/Maia';
import Markdown from '../Markdown';
import Spinner from '../Spinner';
import type { CellFailure } from './failedCell';

const ASK_BUTTON =
  'rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-200 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Maia in the notebook editor: she floats at the bottom right and, when asked,
 * reviews the selected cell or the whole notebook as it is on screen.
 *
 * She only proposes. Taking a proposal makes it an unsaved edit of that cell,
 * like typing it would, so it can be reverted and nothing is pushed until the
 * user saves.
 */
export default function MaiaReview({
  repoId,
  cells,
  selected,
  failure,
  onApply,
}: {
  repoId: number;
  /** The cells with their text as it is on screen, unsaved edits included. */
  cells: EditorCell[];
  /** The code cell last worked in, if any: the one she is offered to review alone. */
  selected: number | null;
  /** The cell a failed run broke on, so its error goes with a review of that cell. */
  failure: CellFailure | null;
  onApply: (index: number, source: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState<number[]>([]);

  const review = useMutation({
    mutationFn: (focus: number | null) =>
      reviewRepoNotebook(repoId, {
        cells,
        focus_index: focus,
        // The error belongs to the code that ran: not sent once the cell has moved on from it.
        error: focus !== null && failure?.index === focus && !failure.stale ? failure.error : '',
      }),
    onMutate: () => setApplied([]),
  });
  const reviewing = review.variables ?? null;

  return (
    <div className="fixed bottom-5 right-5 z-30 flex flex-col items-end gap-3">
      {open && (
        <section
          aria-label="Maia's review"
          className="flex max-h-[70vh] w-[min(26rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-violet-500/30 bg-slate-900 shadow-2xl shadow-black/50"
        >
          <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
            <h2 className="bg-gradient-to-r from-indigo-400 via-violet-400 to-fuchsia-400 bg-clip-text font-display text-sm font-semibold text-transparent">
              Maia
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close Maia"
              className="rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </header>
          <div className="space-y-3 overflow-y-auto px-4 py-3">
            <p className="text-xs text-slate-400">
              I read the code as it is on screen. What I propose becomes an unsaved edit: nothing is pushed until
              you save.
            </p>
            <div className="flex flex-wrap gap-2">
              {selected !== null && (
                <button type="button" onClick={() => review.mutate(selected)} disabled={review.isPending} className={ASK_BUTTON}>
                  Review cell [{selected + 1}]
                </button>
              )}
              <button type="button" onClick={() => review.mutate(null)} disabled={review.isPending} className={ASK_BUTTON}>
                Review the whole notebook
              </button>
            </div>
            {selected === null && (
              <p className="text-xs text-slate-500">Click inside a code cell to have me review only that one.</p>
            )}

            {review.isPending && (
              <p className="flex items-center gap-2 text-sm text-slate-400">
                <Spinner size="sm" />
                Reading {reviewing === null ? 'the notebook' : `cell [${reviewing + 1}]`}… this can take a minute.
              </p>
            )}
            {review.isError && (
              <p className="rounded-lg border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-300">
                {(review.error as Error).message}
              </p>
            )}
            {review.data && !review.isPending && (
              <>
                <Markdown content={review.data.comment || 'I have nothing to add.'} />
                {review.data.cells.map((proposal) => {
                  const done = applied.includes(proposal.index);
                  return (
                    <div key={proposal.index} className="overflow-hidden rounded-lg border border-slate-700 bg-slate-950/60">
                      <p className="border-b border-slate-800 px-3 py-1.5 font-display text-[11px] text-slate-400">
                        Proposed code for cell [{proposal.index + 1}]
                      </p>
                      <pre className="max-h-56 overflow-auto px-3 py-2 font-display text-[12px] leading-relaxed text-slate-200">
                        {proposal.source}
                      </pre>
                      <div className="flex justify-end border-t border-slate-800 px-3 py-2">
                        <button
                          type="button"
                          disabled={done}
                          onClick={() => {
                            onApply(proposal.index, proposal.source);
                            setApplied((current) => [...current, proposal.index]);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-brand-500 disabled:bg-transparent disabled:text-emerald-300"
                        >
                          {done && <Check size={12} aria-hidden="true" />}
                          {done ? 'Applied, not saved yet' : `Apply to cell [${proposal.index + 1}]`}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </section>
      )}
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Ask Maia to review this notebook"
        aria-expanded={open}
        title="Ask Maia to review a cell or the whole notebook"
        className="maia-hover rounded-full drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)] transition duration-300 hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 motion-reduce:transition-none"
      >
        <MaiaAvatar size={64} followCursor reviewer />
      </button>
    </div>
  );
}
