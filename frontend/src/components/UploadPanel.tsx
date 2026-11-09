import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, Clock, FileSpreadsheet } from 'lucide-react';
import { getUploads, uploadDataset } from '../api/client';
import type { UploadStatus } from '../types';
import Spinner from './Spinner';
import { formatBytes, formatDate } from '../utils/format';

export type LayerStageId = 'bronze' | 'silver' | 'gold';

const ACCEPTED = '.csv,.parquet,.json,.jsonl,.xlsx';

/**
 * The other door into the platform: a file somebody has on their machine.
 *
 * It goes through exactly the same layers as a connected database — bronze,
 * the cleaning standard, silver, gold — so the two are not two kinds of data
 * once they are in. The difference is only in how they arrive, and this one
 * arrives once rather than incrementally.
 *
 * The request returns as soon as the file is stored; the worker then carries
 * it through the layers. "Uploaded successfully" and then nothing used to be
 * all a person saw, with the file nowhere on the page. The list under the form
 * follows each upload from queued to in-the-layers (or why it failed), and
 * refreshes the rest of the page when the layers change, so the stage map
 * lights up without a reload.
 */
export default function UploadPanel({
  projectId,
  onOpenStage,
}: {
  projectId: number;
  /** Jump to a layer's stage; offered once an upload has landed there. */
  onOpenStage?: (stage: LayerStageId) => void;
}) {
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
      queryClient.invalidateQueries({ queryKey: ['uploads', projectId] });
    },
  });

  const { data: uploads } = useQuery({
    queryKey: ['uploads', projectId],
    queryFn: () => getUploads(projectId),
    // Poll only while the worker has something of ours in hand.
    refetchInterval: (query) =>
      query.state.data?.some((upload) => upload.status === 'queued' || upload.status === 'running')
        ? 3_000
        : false,
  });

  // When an upload finishes, the layers it landed in have changed: refresh
  // what the rest of the page shows of them.
  const settled = (uploads ?? []).filter((u) => u.status === 'success' || u.status === 'failed').length;
  const previous = useRef<number | null>(null);
  useEffect(() => {
    if (previous.current !== null && settled > previous.current) {
      for (const key of ['medallion', 'project', 'datasets', 'sources']) {
        queryClient.invalidateQueries({ queryKey: key === 'sources' ? [key] : [key, projectId] });
      }
    }
    previous.current = settled;
  }, [settled, projectId, queryClient]);

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
          Uploaded. It is now going through bronze, silver and gold — follow it below.
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

      {uploads && uploads.length > 0 && (
        <section aria-label="Your uploads" className="mt-6 border-t border-slate-700 pt-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Your uploads</h4>
          <ul className="space-y-2">
            {uploads.map((upload) => (
              <UploadRow key={upload.dataset_id} upload={upload} onOpenStage={onOpenStage} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg className="h-8 w-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.9A5 5 0 1115.9 6H16a5 5 0 011 9.9M12 12v9m0-9l-3 3m3-3l3 3" />
    </svg>
  );
}

function UploadRow({
  upload,
  onOpenStage,
}: {
  upload: UploadStatus;
  onOpenStage?: (stage: LayerStageId) => void;
}) {
  return (
    <li className="rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <FileSpreadsheet size={16} aria-hidden="true" className="shrink-0 text-slate-400" />
        <span className="min-w-0 truncate text-sm font-medium text-slate-100">{upload.name}</span>
        <span className="text-xs text-slate-500">
          {formatBytes(upload.size_bytes)} · {formatDate(upload.created_at)}
        </span>
        <span className="ml-auto">
          <UploadState upload={upload} />
        </span>
      </div>

      {upload.status === 'success' && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs text-slate-400">
          <span>
            {upload.rows_in?.toLocaleString() ?? '?'} rows in bronze
            {upload.rows_kept !== null && `, ${upload.rows_kept.toLocaleString()} kept in silver`}
            {upload.source_name && (
              <>
                {' '}as <span className="font-display text-slate-300">{upload.source_name}</span>
              </>
            )}
            , and gold rebuilt.
          </span>
          {onOpenStage && (
            <span className="flex gap-2">
              {(['bronze', 'silver', 'gold'] as const).map((stage) => (
                <button
                  key={stage}
                  type="button"
                  onClick={() => onOpenStage(stage)}
                  className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 transition hover:bg-slate-800"
                >
                  View {stage}
                </button>
              ))}
            </span>
          )}
        </div>
      )}

      {upload.status === 'failed' && (
        <p className="mt-1.5 pl-7 text-xs text-red-300">
          Could not be cleaned into the layers: {upload.error || 'the worker gave no reason'}. The file is stored,
          and the project can still train on it as uploaded.
        </p>
      )}
    </li>
  );
}

function UploadState({ upload }: { upload: UploadStatus }) {
  if (upload.status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
        <CircleCheck size={14} aria-hidden="true" /> In the layers
      </span>
    );
  }
  if (upload.status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-300">
        <CircleX size={14} aria-hidden="true" /> Failed
      </span>
    );
  }
  if (upload.status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-blue-300">
        <Spinner size="sm" /> Cleaning into the layers…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
      <Clock size={14} aria-hidden="true" /> Waiting for the worker
    </span>
  );
}
