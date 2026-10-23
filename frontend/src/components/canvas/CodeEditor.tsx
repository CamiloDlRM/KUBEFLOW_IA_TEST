import type { ReactNode } from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import { CircleCheck, CircleDashed, CircleX, NotebookText, GitBranch, LoaderCircle } from 'lucide-react';
import type { NotebookCell } from '../../types';

/**
 * A phase's code, framed the way it would be read in an editor.
 *
 * VS Code's Dark+ colours and its notebook layout — a tab, a breadcrumb, cells
 * with a gutter of line numbers, the output under each cell, a status bar —
 * because that is where this code was written and where it will be read
 * again. Plain white text in a box made a traceback and an import look alike.
 */

const THEME = themes.vsDark;

const CELL_STATE: Record<NotebookCell['status'], { bar: string; icon: ReactNode; label: string }> = {
  pending: {
    bar: 'bg-transparent',
    icon: <CircleDashed size={13} className="text-[#858585]" />,
    label: 'not run',
  },
  running: {
    bar: 'bg-[#0078d4]',
    icon: <LoaderCircle size={13} className="animate-spin text-[#3794ff]" />,
    label: 'running',
  },
  completed: {
    bar: 'bg-[#2ea043]',
    icon: <CircleCheck size={13} className="text-[#3fb950]" />,
    label: 'completed',
  },
  failed: {
    bar: 'bg-[#f14c4c]',
    icon: <CircleX size={13} className="text-[#f14c4c]" />,
    label: 'failed',
  },
};

function Code({ source }: { source: string }) {
  // A cell's trailing newline would become an empty, numbered last line.
  const code = source.replace(/\s+$/, '') || ' ';
  return (
    <Highlight code={code} language="python" theme={THEME}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre className="overflow-x-auto py-2 font-mono text-[12.5px] leading-[1.6]" style={{ color: THEME.plain.color }}>
          {/* inline-block grows to the longest line, so every row — and its
              hover — is as wide as the widest, and the gutter keeps one width
              however long the code beside it runs. */}
          <code className="inline-block min-w-full">
            {tokens.map((line, index) => (
              <span key={index} {...getLineProps({ line, className: 'flex hover:bg-[#2a2d2e]' })}>
                <span
                  aria-hidden="true"
                  className="w-10 shrink-0 select-none pr-4 text-right text-[#6e7681]"
                >
                  {index + 1}
                </span>
                <span className="whitespace-pre pr-4">
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </span>
              </span>
            ))}
          </code>
        </pre>
      )}
    </Highlight>
  );
}

function Cell({ cell, fromRun }: { cell: NotebookCell; fromRun: boolean }) {
  const state = CELL_STATE[cell.status];
  const tags = cell.tags.filter((tag) => !tag.startsWith('mlops:'));
  return (
    <article aria-label={`cell ${cell.index + 1}`} className="relative flex">
      <span aria-hidden="true" className={`w-[3px] shrink-0 rounded-full ${fromRun ? state.bar : 'bg-transparent'}`} />
      <div className="w-14 shrink-0 pt-2.5 text-center font-mono text-[11px] text-[#858585]">
        {fromRun ? (
          <span className="inline-flex items-center gap-1" title={state.label}>
            {state.icon}
          </span>
        ) : null}
        <span className="block">[{cell.index + 1}]</span>
      </div>
      <div className="min-w-0 flex-1 pb-3 pr-3">
        <div className="overflow-hidden rounded-md border border-[#2b2b2b] bg-[#1e1e1e] focus-within:border-[#0078d4]">
          {tags.length > 0 && (
            <div className="flex gap-1 border-b border-[#2b2b2b] px-3 py-1">
              {tags.map((tag) => (
                <span key={tag} className="rounded bg-[#2d2d2d] px-1.5 py-px font-mono text-[10px] text-[#9cdcfe]">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <Code source={cell.source} />
        </div>
        {cell.output && (
          <pre className="mt-1 max-h-56 overflow-auto px-3 py-1.5 font-mono text-[12px] leading-relaxed text-[#cccccc]">
            {cell.output}
          </pre>
        )}
        {cell.error && (
          <pre className="mt-1 overflow-x-auto rounded-md border-l-2 border-[#f14c4c] bg-[#5a1d1d]/40 px-3 py-1.5 font-mono text-[12px] text-[#f48771]">
            {cell.error}
          </pre>
        )}
      </div>
    </article>
  );
}

export default function CodeEditor({
  title,
  notebookPath,
  branch,
  cells,
  fromRun,
  status,
}: {
  title: string;
  notebookPath: string;
  branch: string;
  cells: NotebookCell[];
  fromRun: boolean;
  /** One line for the status bar: how the phase ended, or where the code came from. */
  status: string;
}) {
  const file = notebookPath.split('/').pop() || 'notebook.ipynb';
  const folders = notebookPath.split('/').slice(0, -1);
  const lines = cells.reduce((total, cell) => total + cell.source.replace(/\s+$/, '').split('\n').length, 0);

  return (
    <section
      aria-label={`${title} detail`}
      className="overflow-hidden rounded-xl border border-[#2b2b2b] bg-[#1e1e1e] shadow-xl shadow-black/40"
    >
      <div className="flex items-end bg-[#252526]">
        <span className="flex items-center gap-1.5 border-t-2 border-[#0078d4] bg-[#1e1e1e] px-3 py-1.5 text-[12px] text-white">
          <NotebookText size={13} className="text-[#e8ab53]" aria-hidden="true" />
          {file}
        </span>
      </div>
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1 truncate border-b border-[#2b2b2b] px-3 py-1 text-[11px] text-[#a9a9a9]"
      >
        {[...folders, file, title].map((part, index, parts) => (
          <span key={`${part}-${index}`} className={index === parts.length - 1 ? 'text-[#cccccc]' : ''}>
            {part}
            {index < parts.length - 1 && <span className="px-1 text-[#6e7681]">›</span>}
          </span>
        ))}
      </nav>

      <div className="max-h-[32rem] overflow-y-auto py-2">
        {cells.map((cell) => (
          <Cell key={cell.index} cell={cell} fromRun={fromRun} />
        ))}
      </div>

      <footer className="flex items-center justify-between gap-3 bg-[#007acc] px-3 py-0.5 text-[11px] text-white">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <GitBranch size={12} aria-hidden="true" /> {branch}
          </span>
          <span>{status}</span>
        </span>
        <span className="flex items-center gap-3">
          <span>
            {cells.length} cell{cells.length === 1 ? '' : 's'} · {lines} line{lines === 1 ? '' : 's'}
          </span>
          <span>Python</span>
        </span>
      </footer>
    </section>
  );
}
