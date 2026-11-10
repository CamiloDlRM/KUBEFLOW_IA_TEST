import { Download, Info } from 'lucide-react';

/**
 * The official Maia notebook template, served from public/templates. It is a copy of
 * notebooks/maia_notebook_template.ipynb (the frontend image only sees frontend/), so
 * update both when the template changes.
 */
export const NOTEBOOK_TEMPLATE_URL = '/templates/maia_notebook_template.ipynb';

/** A small info chip that downloads the template, styled like the Supabase guide. */
export default function NotebookTemplateLink({ className = '' }: { className?: string }) {
  return (
    <a
      href={NOTEBOOK_TEMPLATE_URL}
      download="maia_notebook_template.ipynb"
      title="The notebook layout Maia expects: tagged cells, data path and metrics"
      className={`inline-flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-1.5 text-xs transition hover:bg-sky-500/15 ${className}`}
    >
      <Info size={14} className="shrink-0 text-sky-300" aria-hidden="true" />
      <span className="font-semibold text-sky-200">Click to download the notebook template</span>
      <Download size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
    </a>
  );
}
