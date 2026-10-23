import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { previewLayer } from '../../api/client';
import type { Layer, PipelineInputChoice } from '../../types';
import Spinner from '../Spinner';

/**
 * A look at a layer before it becomes the input.
 *
 * Choosing what a model trains on is not something to do by accident, so a
 * click on the palette only opens this; dragging is what chooses. The button
 * at the bottom is the same choice for anyone who cannot drag.
 */
export default function DataPeek({
  projectId,
  choice,
  label,
  onUse,
  onClose,
}: {
  projectId: number;
  choice: PipelineInputChoice;
  label: string;
  onUse: () => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const layer = choice.layer as Layer;

  const { data, isLoading, error } = useQuery({
    queryKey: ['layer-peek', projectId, layer, choice.source_id ?? null, choice.version ?? null],
    queryFn: () =>
      previewLayer(projectId, layer, {
        sourceId: choice.source_id,
        version: choice.version,
        limit: 25,
      }),
    staleTime: 60_000,
  });

  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={`Preview of ${label}`}
      tabIndex={-1}
      className="fixed inset-x-4 bottom-4 z-30 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-slate-600 bg-slate-950/95 shadow-2xl shadow-black/60 backdrop-blur focus:outline-none lg:absolute lg:inset-x-auto lg:bottom-auto lg:left-full lg:top-0 lg:ml-3 lg:w-[44rem]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-100">{label}</h3>
          <p className="truncate font-mono text-[11px] text-slate-500">
            {data
              ? `${data.object_rows.toLocaleString()} rows × ${data.columns.length} columns · ${data.key}`
              : ' '}
          </p>
          {choice.layer !== 'gold' && data && (
            // Bronze and silver are one object per extraction. The preview
            // reads the newest; the pipeline mounts all of them stacked.
            <p className="text-[11px] text-slate-500">Newest extraction shown; a run mounts all of them.</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
        >
          <X size={16} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading && (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        )}
        {error != null && <p className="px-4 py-6 text-sm text-red-300">{(error as Error).message}</p>}
        {data && (
          <table className="min-w-full border-separate border-spacing-0 font-mono text-[11px]">
            <thead className="sticky top-0 bg-slate-900">
              <tr>
                {data.columns.map((column) => (
                  <th
                    key={column.name}
                    scope="col"
                    className="whitespace-nowrap border-b border-slate-800 px-3 py-1.5 text-left font-semibold text-slate-200"
                  >
                    {column.name}
                    <span className="ml-1.5 font-normal text-sky-400/80">{column.type}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr key={index} className="odd:bg-slate-900/40">
                  {row.map((value, column) => (
                    <td key={column} className="max-w-[16rem] truncate whitespace-nowrap px-3 py-1 text-slate-300">
                      {value === null || value === undefined ? (
                        <span className="italic text-slate-600">null</span>
                      ) : (
                        String(value)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-slate-800 px-4 py-2.5">
        <p className="text-[11px] text-slate-500">Drag it onto Input to use it.</p>
        <button
          type="button"
          onClick={onUse}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-500"
        >
          Use as input
        </button>
      </footer>
    </div>
  );
}
