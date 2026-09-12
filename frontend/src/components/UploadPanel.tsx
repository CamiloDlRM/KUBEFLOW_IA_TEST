import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uploadDataset } from '../api/client';
import Spinner from './Spinner';
import { formatBytes } from '../utils/format';

const ACCEPTED = '.csv,.parquet,.json,.jsonl,.xlsx';

/**
 * The other door into the platform: a file somebody has on their machine.
 *
 * It goes through exactly the same layers as a connected database — bronze,
 * the cleaning standard, silver, gold — so the two are not two kinds of data
 * once they are in. The difference is only in how they arrive, and this one
 * arrives once rather than incrementally.
 */
export default function UploadPanel({ projectId }: { projectId: number }) {
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

function UploadIcon() {
  return (
    <svg className="h-8 w-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.9A5 5 0 1115.9 6H16a5 5 0 011 9.9M12 12v9m0-9l-3 3m3-3l3 3" />
    </svg>
  );
}
