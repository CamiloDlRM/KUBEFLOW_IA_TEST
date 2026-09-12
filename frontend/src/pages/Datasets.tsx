import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getDatasets,
  uploadDataset,
  activateDataset,
  deleteDataset,
  getDatasetPreview,
} from '../api/client';
import { useRepos } from '../hooks/usePipelines';
import type { Dataset } from '../types';
import Spinner from '../components/Spinner';
import SourcesPanel from '../components/SourcesPanel';
import MedallionPanel from '../components/MedallionPanel';
import { formatDate, formatBytes, repoNameFromUrl } from '../utils/format';

const ACCEPTED = '.csv,.parquet';

export default function Datasets() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);
  const queryClient = useQueryClient();

  const { data: repos } = useRepos();
  const repo = repos?.find((r) => r.id === id);
  const repoName = repo ? repoNameFromUrl(repo.github_url) : `repo #${projectId}`;

  const {
    data: datasets,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['datasets', id],
    queryFn: () => getDatasets(id),
    enabled: Number.isFinite(id),
  });

  const [previewFor, setPreviewFor] = useState<Dataset | null>(null);

  const activateMut = useMutation({
    mutationFn: activateDataset,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['datasets', id] }),
  });

  const deleteMut = useMutation({
    mutationFn: deleteDataset,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['datasets', id] }),
  });

  function handleDelete(dataset: Dataset) {
    if (window.confirm(`Delete dataset "${dataset.name}"? This cannot be undone.`)) {
      deleteMut.mutate(dataset.id);
    }
  }

  const actionError = (activateMut.error ?? deleteMut.error) as Error | null;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-400 hover:text-brand-300"
          >
            <ArrowLeftIcon />
            Back to Dashboard
          </Link>
          <h2 className="mt-2 truncate text-2xl font-bold text-slate-100">Data</h2>
          <p className="mt-1 text-sm text-slate-400">
            Training data for <span className="text-slate-200">{repoName}</span>.
            Connect the system that holds it, or upload a file directly. The
            active dataset is the one the next pipeline run will use.
          </p>
        </div>
      </div>

      <SourcesPanel projectId={id} />

      {/* Above the upload panel, and below the sources: it reads top to bottom
          as the path the data takes — where it comes from, what happens to it,
          and only then the file-upload shortcut. */}
      <MedallionPanel projectId={id} />

      <UploadPanel projectId={id} />

      {actionError && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          {actionError.message}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          Failed to load datasets: {(error as Error).message}
        </div>
      )}

      {datasets && datasets.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-700 py-16 text-center">
          <p className="text-slate-400">
            No datasets uploaded yet. Upload a CSV or parquet file to get started.
          </p>
        </div>
      )}

      {datasets && datasets.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/80 text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Uploaded</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((d) => (
                <tr
                  key={d.id}
                  className="border-b border-slate-800 transition hover:bg-slate-800/40"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-100">{d.name}</div>
                    {d.description && (
                      <div className="mt-0.5 max-w-xs truncate text-xs text-slate-400">
                        {d.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-300">
                    {formatBytes(d.size_bytes)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {formatDate(d.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    {d.is_active ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-900/50 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        Activo
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">--</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => activateMut.mutate(d.id)}
                        disabled={d.is_active || activateMut.isPending}
                        className="rounded bg-emerald-600/20 px-2.5 py-1 text-xs font-medium text-emerald-400 transition hover:bg-emerald-600/30 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Activate
                      </button>
                      <button
                        onClick={() => setPreviewFor(d)}
                        className="rounded bg-brand-600/20 px-2.5 py-1 text-xs font-medium text-brand-400 transition hover:bg-brand-600/30"
                      >
                        Preview
                      </button>
                      <button
                        onClick={() => handleDelete(d)}
                        disabled={deleteMut.isPending}
                        className="rounded bg-red-600/20 px-2.5 py-1 text-xs font-medium text-red-400 transition hover:bg-red-600/30 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {previewFor && (
        <PreviewModal dataset={previewFor} onClose={() => setPreviewFor(null)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Upload panel                                                       */
/* ------------------------------------------------------------------ */

function UploadPanel({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [dragging, setDragging] = useState(false);

  const uploadMut = useMutation({
    mutationFn: () => uploadDataset(projectId, file!, description),
    onSuccess: () => {
      setFile(null);
      setDescription('');
      if (inputRef.current) inputRef.current.value = '';
      queryClient.invalidateQueries({ queryKey: ['datasets', projectId] });
    },
  });

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      setFile(dropped);
      uploadMut.reset();
    }
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-5">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Upload dataset
      </h3>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center transition ${
          dragging
            ? 'border-brand-500 bg-brand-600/10'
            : 'border-slate-700 hover:border-slate-600 hover:bg-slate-800/40'
        }`}
      >
        <UploadIcon />
        {file ? (
          <>
            <p className="mt-2 text-sm font-medium text-slate-100">{file.name}</p>
            <p className="text-xs text-slate-400">{formatBytes(file.size)}</p>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-300">
              Drag &amp; drop a file here, or click to browse
            </p>
            <p className="text-xs text-slate-500">CSV or parquet</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          aria-label="Dataset file"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            uploadMut.reset();
          }}
        />
      </div>

      <div className="mt-4">
        <label
          htmlFor="dataset-description"
          className="mb-1 block text-xs font-medium text-slate-400"
        >
          Description (optional)
        </label>
        <input
          id="dataset-description"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Iris training set, cleaned"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      {uploadMut.isError && (
        <div className="mt-3 rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-300">
          Upload failed: {(uploadMut.error as Error).message}
        </div>
      )}

      {uploadMut.isSuccess && (
        <div className="mt-3 rounded border border-emerald-800 bg-emerald-900/20 px-3 py-2 text-xs text-emerald-300">
          Dataset uploaded successfully.
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => uploadMut.mutate()}
          disabled={!file || uploadMut.isPending}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploadMut.isPending && <Spinner size="sm" />}
          {uploadMut.isPending ? 'Uploading...' : 'Upload'}
        </button>
        {file && !uploadMut.isPending && (
          <button
            onClick={() => {
              setFile(null);
              if (inputRef.current) inputRef.current.value = '';
              uploadMut.reset();
            }}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-400 transition hover:bg-slate-800"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Preview modal                                                      */
/* ------------------------------------------------------------------ */

function PreviewModal({
  dataset,
  onClose,
}: {
  dataset: Dataset;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dataset-preview', dataset.id],
    queryFn: () => getDatasetPreview(dataset.id),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-lg border border-slate-700 bg-slate-800 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-3">
          <h3 className="truncate text-sm font-semibold text-slate-100">
            Preview: {dataset.name}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close preview"
            className="text-slate-400 hover:text-slate-200"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <Spinner size="lg" />
            </div>
          )}

          {error && (
            <div className="rounded border border-red-800 bg-red-900/20 px-3 py-2 text-sm text-red-300">
              Failed to load preview: {(error as Error).message}
            </div>
          )}

          {data && data.rows.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-500">
              This dataset has no rows to preview.
            </p>
          )}

          {data && data.rows.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-lg border border-slate-700">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700 bg-slate-900/80 text-left uppercase tracking-wider text-slate-400">
                      {data.columns.map((c) => (
                        <th key={c} className="whitespace-nowrap px-3 py-2">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row, i) => (
                      <tr key={i} className="border-b border-slate-800">
                        {row.map((cell, j) => (
                          <td
                            key={j}
                            className="whitespace-nowrap px-3 py-2 font-mono text-slate-300"
                          >
                            {renderCell(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.truncated && (
                <p className="mt-2 text-xs text-slate-500">
                  Showing the first {data.rows.length} rows only.
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-700 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '--';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/* ---- Icons ---- */

function ArrowLeftIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg className="h-8 w-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.9A5 5 0 1115.9 6H16a5 5 0 011 9.9M12 12v9m0-9l-3 3m3-3l3 3" />
    </svg>
  );
}
