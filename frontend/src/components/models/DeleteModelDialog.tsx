import { useEffect } from 'react';
import { MaiaAvatar } from '../flow/Maia';

/**
 * Asks before a model is deleted, with Maia looking sad about it.
 *
 * Replaces the browser's own confirm box, so it looks like the Test and
 * Versions dialogs next to it. Escape and a click outside both mean "no".
 */
export default function DeleteModelDialog({
  modelName,
  onConfirm,
  onCancel,
}: {
  modelName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-model-title"
        onClick={(event) => event.stopPropagation()}
        className="flex w-full max-w-sm flex-col items-center rounded-xl border border-slate-700 bg-slate-900 px-6 pb-5 pt-4 text-center shadow-2xl"
      >
        <MaiaAvatar size={96} mood="sad" />
        <h3 id="delete-model-title" className="mt-2 text-base font-semibold text-slate-100">
          Hey, you're about to delete <span className="font-display text-red-300">{modelName}</span>
        </h3>
        <p className="mt-1 text-sm text-slate-400">
          It will be unloaded from the model server. Are you sure?
        </p>
        <div className="mt-5 flex w-full gap-3">
          <button
            onClick={onCancel}
            autoFocus
            className="flex-1 rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            No, keep it
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500"
          >
            Yes, delete
          </button>
        </div>
      </div>
    </div>
  );
}
