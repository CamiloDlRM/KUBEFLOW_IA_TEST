import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, RefreshCw, Share2, X } from 'lucide-react';
import { rotateModelShare, setModelShare } from '../../api/client';
import type { ModelDeployment } from '../../types';

/**
 * A model's public link, in its row of the models table.
 *
 * Not shared: one button to share it. Shared: the link to copy, plus "New
 * link" (the old one stops working, for a link that went further than meant)
 * and "Stop" (it stops answering; sharing again restores the same URL).
 * Anyone holding the link can ask the model for predictions without signing
 * in, within the platform's rate limits.
 */
export default function ShareLinkCell({ model }: { model: ModelDeployment }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['models'] });

  const share = useMutation({
    mutationFn: (enabled: boolean) => setModelShare(model.model_name, enabled),
    onSuccess: refresh,
  });
  const rotate = useMutation({ mutationFn: () => rotateModelShare(model.model_name), onSuccess: refresh });
  const busy = share.isPending || rotate.isPending;
  const failed = (share.error ?? rotate.error) as Error | null;

  if (!model.share_url) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => share.mutate(true)}
          disabled={busy}
          title="Anyone with the link will be able to ask this model for predictions, without signing in"
          className="inline-flex items-center gap-1.5 rounded border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:border-brand-500 hover:text-white disabled:opacity-50"
        >
          <Share2 size={12} aria-hidden="true" />
          {share.isPending ? 'Sharing…' : 'Share'}
        </button>
        {failed && <p className="text-[11px] text-red-300">{failed.message}</p>}
      </div>
    );
  }

  const url = model.share_url;
  function copy() {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <Link2 size={12} className="shrink-0 text-emerald-400" aria-label="Shared" />
        <code className="max-w-[200px] truncate text-xs text-slate-300" title={url}>
          {url}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy public link"
          title="Copy public link"
          className="shrink-0 rounded p-1 text-slate-500 hover:text-slate-300"
        >
          {copied ? <Check size={13} className="text-emerald-400" aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        </button>
      </div>
      <div className="flex gap-3 text-[11px]">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Replace the public link of "${model.model_name}"? The current link stops working at once.`)) {
              rotate.mutate();
            }
          }}
          className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200 disabled:opacity-50"
        >
          <RefreshCw size={11} aria-hidden="true" /> New link
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => share.mutate(false)}
          className="inline-flex items-center gap-1 text-slate-400 hover:text-red-300 disabled:opacity-50"
        >
          <X size={11} aria-hidden="true" /> Stop
        </button>
      </div>
      {failed && <p className="text-[11px] text-red-300">{failed.message}</p>}
    </div>
  );
}
