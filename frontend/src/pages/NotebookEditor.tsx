import { useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BACK_BUTTON_CLASS } from '../components/BackLink';
import { ArrowLeft, ExternalLink, GitBranch, NotebookText, Pencil, RotateCcw, TriangleAlert, Upload } from 'lucide-react';
import { getRepoNotebook, getRepos, saveRepoNotebook } from '../api/client';
import type { EditorCell, NotebookSaved } from '../types';
import { usePipeline } from '../hooks/usePipelines';
import CodeInput from '../components/notebook/CodeInput';
import { failedCell, type CellFailure } from '../components/notebook/failedCell';
import MaiaReview from '../components/notebook/MaiaReview';
import Markdown from '../components/Markdown';
import Spinner from '../components/Spinner';

/**
 * A small notebook editor: the cells of one notebook on one branch, to change
 * their text and push the result back to that branch.
 *
 * Deliberately write-only and narrow: no outputs, no running, and no adding,
 * removing or moving cells — so the mlops tags the pipeline validates cannot be
 * broken from here. Code cells are typed in directly; text cells read rendered,
 * as in Colab, and open side by side with their source when clicked.
 */

/** What Colab and Jupyter set a text cell in, so a notebook reads here as it does there. */
const TEXT_CELL_FONT = { fontFamily: 'Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif' };

function githubBase(repoUrl: string) {
  return repoUrl.replace(/\/+$/, '').replace(/\.git$/, '');
}

function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export default function NotebookEditor() {
  const { repoId: repoParam } = useParams<{ repoId: string }>();
  const [searchParams] = useSearchParams();
  const repoId = Number(repoParam);
  const branch = searchParams.get('branch') ?? '';
  const path = searchParams.get('path') ?? '';
  const file = path.split('/').pop() || 'notebook.ipynb';

  const notebook = useQuery({
    queryKey: ['repo-notebook', repoId, branch, path],
    queryFn: () => getRepoNotebook(repoId, branch, path),
    enabled: Number.isFinite(repoId) && Boolean(branch) && Boolean(path),
    // What is on screen is being edited: never swap it for a refetch behind the user's back.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  // Only for the links out to GitHub.
  const repos = useQuery({ queryKey: ['repos'], queryFn: getRepos });
  const repoUrl = repos.data?.find((repo) => repo.id === repoId)?.github_url;

  // `saved` is the text GitHub has; `drafts` holds only the cells that differ from it.
  const [saved, setSaved] = useState<Record<number, string>>({});
  const [sha, setSha] = useState('');
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!notebook.data) return;
    setSaved(Object.fromEntries(notebook.data.cells.map((cell) => [cell.index, cell.source])));
    setSha(notebook.data.sha);
    setDrafts({});
  }, [notebook.data]);

  // Opened from a failed run (`run` in the link): the cell it broke on, and the error it raised.
  const runId = searchParams.get('run') ?? undefined;
  const run = usePipeline(runId).data;
  const failure = useMemo(() => {
    if (!notebook.data) return null;
    // Against what GitHub has now, so a pushed fix reads as no longer the code that ran.
    const cells = notebook.data.cells.map((cell) => ({ ...cell, source: saved[cell.index] ?? cell.source }));
    return failedCell(cells, run?.cells);
  }, [notebook.data, saved, run]);
  // What Maia reviews: the code cell last worked in (the failed one, coming from a run),
  // and every cell as it reads on screen.
  const [selected, setSelected] = useState<number | null>(null);
  const onScreen = useMemo(
    () =>
      (notebook.data?.cells ?? []).map((cell) => ({
        ...cell,
        source: drafts[cell.index] ?? saved[cell.index] ?? cell.source,
      })),
    [notebook.data, drafts, saved],
  );
  // Back to where the editor was opened from: the run's canvas, or the list of repos.
  const back = run?.project_id
    ? { to: `/pipelines/canvas/${run.project_id}`, label: 'Pipeline' }
    : { to: '/repos/new', label: 'My repos' };

  function edit(index: number, source: string) {
    setDrafts((current) => {
      const next = { ...current };
      if (source === saved[index]) delete next[index];
      else next[index] = source;
      return next;
    });
  }

  const changed = useMemo(() => Object.keys(drafts).map(Number).sort((a, b) => a - b), [drafts]);
  const dirty = changed.length > 0;

  const [confirming, setConfirming] = useState(false);
  const [lastCommit, setLastCommit] = useState<NotebookSaved | null>(null);
  const save = useMutation({
    mutationFn: (message: string) =>
      saveRepoNotebook(repoId, {
        branch,
        notebook_path: path,
        sha,
        message,
        cells: changed.map((index) => ({ index, source: drafts[index] })),
      }),
    onSuccess: (result) => {
      setSaved((current) => ({ ...current, ...drafts }));
      setDrafts({});
      setSha(result.sha);
      setLastCommit(result);
      setConfirming(false);
    },
  });

  // Back to what GitHub has. Nothing was sent, so there is nothing to undo there.
  function discardAll() {
    const count = changed.length;
    if (!window.confirm(`Discard the changes to ${count} cell${count === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setDrafts({});
  }

  function openConfirm() {
    if (!dirty) return;
    save.reset();
    setConfirming(true);
  }

  // Leaving with unsaved cells asks first; Ctrl/Cmd+S opens the push dialog.
  const openConfirmRef = useRef(openConfirm);
  openConfirmRef.current = openConfirm;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        openConfirmRef.current();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  // The tab is named after the notebook only while the editor is open.
  useEffect(() => {
    const previous = document.title;
    document.title = `${dirty ? '● ' : ''}${file} · Maia`;
    return () => {
      document.title = previous;
    };
  }, [dirty, file]);

  const linkedProjects = notebook.data?.linked_projects ?? [];

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 font-body text-slate-200">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Link
              to={back.to}
              // An in-app move does not fire beforeunload, so unsaved cells are asked about here.
              onClick={(event) => {
                if (dirty && !window.confirm('Leave the editor? Your unsaved changes will be lost.')) {
                  event.preventDefault();
                }
              }}
              className={`${BACK_BUTTON_CLASS} shrink-0 !px-3 !py-1.5`}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {back.label}
            </Link>
            <NotebookText size={22} className="shrink-0 text-brand-400" aria-hidden="true" />
            <div className="min-w-0">
              <h1 title={path} className="truncate font-display text-base font-semibold text-slate-100">{file}</h1>
              <p className="flex min-w-0 items-center gap-2 font-display text-xs text-slate-500">
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-brand-500/30 bg-brand-600/15 px-2 py-0.5 text-brand-400">
                  <GitBranch size={11} aria-hidden="true" />
                  {branch || 'no branch'}
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs ${dirty ? 'text-amber-300' : 'text-slate-500'}`} aria-live="polite">
              {dirty
                ? `${changed.length} cell${changed.length === 1 ? '' : 's'} edited`
                : lastCommit
                  ? 'All changes pushed'
                  : 'No changes'}
            </span>
            {repoUrl && (
              <a
                href={`${githubBase(repoUrl)}/blob/${encodeURIComponent(branch)}/${encodePath(path)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800"
              >
                <ExternalLink size={14} aria-hidden="true" />
                GitHub
              </a>
            )}
            {dirty && (
              <button
                type="button"
                onClick={discardAll}
                title="Throw away every unsaved change and go back to what is on GitHub"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-red-500/50 hover:bg-red-950/40 hover:text-red-200"
              >
                <RotateCcw size={14} aria-hidden="true" />
                Discard changes
              </button>
            )}
            <button
              type="button"
              onClick={openConfirm}
              disabled={!dirty}
              title={dirty ? 'Commit and push to this branch (Ctrl+S)' : 'Edit a cell to enable'}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Upload size={14} aria-hidden="true" />
              Save &amp; push
            </button>
          </div>
        </div>
      </header>

      {/* Room at the bottom so Maia, floating there, never covers the last cell. */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-6">
        {lastCommit && !dirty && (
          <p className="mb-4 rounded-lg border border-emerald-700 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-300">
            Pushed {lastCommit.changed_cells} cell{lastCommit.changed_cells === 1 ? '' : 's'} to{' '}
            <span className="font-display">{branch}</span> in commit{' '}
            {repoUrl ? (
              <a
                href={`${githubBase(repoUrl)}/commit/${lastCommit.commit_sha}`}
                target="_blank"
                rel="noreferrer"
                className="font-display underline underline-offset-2 hover:text-emerald-200"
              >
                {lastCommit.commit_sha.slice(0, 7)}
              </a>
            ) : (
              <span className="font-display">{lastCommit.commit_sha.slice(0, 7)}</span>
            )}
            .
          </p>
        )}

        {(!branch || !path) && (
          <p className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
            This link is missing the notebook's branch or path. Open the editor from My repos.
          </p>
        )}
        {notebook.isLoading && (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <Spinner size="sm" /> Loading the notebook from GitHub…
          </p>
        )}
        {notebook.isError && (
          <p className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
            {(notebook.error as Error).message}
          </p>
        )}
        {notebook.data && notebook.data.cells.length === 0 && (
          <p className="text-sm text-slate-400">This notebook has no cells.</p>
        )}

        <div className="space-y-3">
          {notebook.data?.cells.map((cell) => (
            <CellRow
              key={cell.index}
              cell={cell}
              value={drafts[cell.index] ?? saved[cell.index] ?? cell.source}
              edited={cell.index in drafts}
              failure={failure?.index === cell.index ? failure : undefined}
              onSelect={() => setSelected(cell.index)}
              onChange={(source) => edit(cell.index, source)}
              onRevert={() => edit(cell.index, saved[cell.index])}
            />
          ))}
        </div>
      </main>

      {notebook.data && notebook.data.cells.length > 0 && (
        <MaiaReview
          repoId={repoId}
          cells={onScreen}
          selected={selected ?? failure?.index ?? null}
          failure={failure}
          onApply={edit}
        />
      )}

      {confirming && (
        <PushDialog
          file={file}
          path={path}
          branch={branch}
          changed={changed}
          linkedProjects={linkedProjects}
          busy={save.isPending}
          error={save.isError ? (save.error as Error).message : null}
          onCancel={() => setConfirming(false)}
          onConfirm={(message) => save.mutate(message)}
        />
      )}
    </div>
  );
}

function CellRow({
  cell,
  value,
  edited,
  failure,
  onSelect,
  onChange,
  onRevert,
}: {
  cell: EditorCell;
  value: string;
  edited: boolean;
  /** Set on the cell a failed run broke on, when the editor was opened from that run. */
  failure?: CellFailure;
  /** A code cell was focused: it becomes the one Maia is offered to review alone. */
  onSelect: () => void;
  onChange: (source: string) => void;
  onRevert: () => void;
}) {
  const number = cell.index + 1;
  // The failed cell is what the editor was opened for: bring it into view once it is known.
  const rowRef = useRef<HTMLElement>(null);
  const failed = Boolean(failure);
  useEffect(() => {
    if (failed) rowRef.current?.scrollIntoView?.({ block: 'center' });
  }, [failed]);
  return (
    <article ref={rowRef} aria-label={`${cell.cell_type} cell ${number}`} className="flex gap-2">
      {/* The gutter: the cell's number, and what is unsaved about it. */}
      <div className="flex w-12 shrink-0 flex-col items-end gap-1 pt-2.5 font-display text-[11px] text-slate-500">
        <span>[{number}]</span>
        {edited && (
          <button
            type="button"
            onClick={onRevert}
            aria-label={`Discard the changes to cell ${number}`}
            title="Discard this cell's changes"
            className="rounded p-0.5 text-amber-300 transition hover:bg-slate-800 hover:text-amber-200"
          >
            <RotateCcw size={13} aria-hidden="true" />
          </button>
        )}
      </div>
      <div
        className={`min-w-0 flex-1 border-l-2 pl-2 ${edited ? 'border-amber-400' : 'border-transparent'}`}
      >
        {cell.cell_type === 'markdown' ? (
          <TextCell value={value} onChange={onChange} number={number} />
        ) : cell.cell_type === 'code' ? (
          <div
            onFocus={onSelect}
            className={`overflow-hidden rounded-lg border bg-slate-900 transition focus-within:border-brand-500 ${
              failure ? 'border-red-500/70' : 'border-slate-700'
            }`}
          >
            {cell.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 border-b border-slate-800 px-3 py-1.5">
                {cell.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded border border-brand-500/30 bg-brand-600/15 px-1.5 py-px font-display text-[10px] text-brand-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <CodeInput value={value} onChange={onChange} label={`Code of cell ${number}`} />
          </div>
        ) : (
          // Raw cells are rare and not rendered by anything: shown, not edited.
          <pre className="overflow-x-auto rounded-lg border border-dashed border-slate-700 px-3 py-2.5 font-display text-[13px] text-slate-500">
            {value}
          </pre>
        )}
        {failure && (
          <div className="mt-1 rounded-md border-l-2 border-red-500 bg-red-950/40 px-3 py-2 text-xs">
            <p className="font-semibold text-red-300">The run failed on this cell</p>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-display text-[12px] text-red-200">
              {failure.error || 'No error message was recorded.'}
            </pre>
            {failure.stale && (
              <p className="mt-1 text-amber-300">
                This cell has changed since that run: the code here is not the code that raised the error.
              </p>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/** A markdown cell: rendered until clicked, then its source beside a live preview, as in Colab. */
function TextCell({ value, onChange, number }: { value: string; onChange: (source: string) => void; number: number }) {
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The source box is as tall as its text, so the page scrolls rather than the cell.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!editing || !textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [editing, value]);

  function closeWhenFocusLeaves(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setEditing(false);
  }

  if (!editing) {
    return (
      <div className="group relative rounded-lg border border-transparent px-3 py-2 transition hover:border-slate-700 focus-within:border-slate-700">
        <div style={TEXT_CELL_FONT} onDoubleClick={() => setEditing(true)}>
          {value.trim() ? (
            <Markdown content={value} notebook />
          ) : (
            <p className="text-sm italic text-slate-600">Empty text cell</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit text cell ${number}`}
          title="Edit this text cell (or double-click it)"
          className="absolute right-2 top-2 rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-400 opacity-0 transition hover:text-slate-100 focus:opacity-100 group-hover:opacity-100"
        >
          <Pencil size={13} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div
      onBlur={closeWhenFocusLeaves}
      className="grid overflow-hidden rounded-lg border border-brand-500 bg-slate-900 md:grid-cols-2"
    >
      <textarea
        ref={textareaRef}
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setEditing(false);
        }}
        aria-label={`Markdown source of cell ${number}`}
        spellCheck={false}
        className="min-h-[5rem] w-full resize-none overflow-hidden border-0 bg-transparent px-3 py-2.5 font-display text-[13px] leading-[1.6] text-slate-200 outline-none focus:ring-0"
      />
      <div
        style={TEXT_CELL_FONT}
        aria-label="Preview"
        className="border-t border-slate-800 px-4 py-2.5 md:border-l md:border-t-0"
      >
        <Markdown content={value} notebook />
      </div>
    </div>
  );
}

function PushDialog({
  file,
  path,
  branch,
  changed,
  linkedProjects,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  file: string;
  path: string;
  branch: string;
  changed: number[];
  linkedProjects: string[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (message: string) => void;
}) {
  const [message, setMessage] = useState(`Update ${file} from Maia`);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onCancel();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="push-notebook-title"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(message);
        }}
        className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-800 shadow-xl"
      >
        <div className="border-b border-slate-700 px-5 py-3">
          <h3 id="push-notebook-title" className="text-sm font-semibold text-slate-100">
            Save and push to GitHub
          </h3>
        </div>
        <div className="space-y-4 p-5">
          <dl className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Notebook</dt>
              <dd className="truncate font-display text-slate-200">{path}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Branch</dt>
              <dd className="font-display text-slate-200">{branch}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Edited cells</dt>
              <dd className="font-display text-slate-200">{changed.map((index) => `[${index + 1}]`).join(' ')}</dd>
            </div>
          </dl>

          <div>
            <label htmlFor="commit-message" className="mb-1 block text-xs font-medium text-slate-400">
              Commit message
            </label>
            <input
              id="commit-message"
              autoFocus
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={200}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-display text-sm text-slate-100 placeholder-slate-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {linkedProjects.length > 0 && (
            <p className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200">
              <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
              <span>
                This notebook is linked to <strong className="font-semibold">{linkedProjects.join(', ')}</strong>.
                Pushing it starts a new pipeline run there.
              </span>
            </p>
          )}
          <p className="text-xs text-slate-500">
            The old output of each edited code cell is removed: it no longer matches the code.
          </p>

          {error && (
            <p className="rounded-lg border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-300">{error}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-700 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-slate-700 px-4 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-50"
          >
            {busy && <Spinner size="sm" />}
            {busy ? 'Pushing…' : 'Commit & push'}
          </button>
        </div>
      </form>
    </div>
  );
}
