import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { runProject } from '../api/client';
import type { Project } from '../types';
import { formatBytes, repoNameFromUrl } from '../utils/format';
import Spinner from './Spinner';

/** Same rule the backend enforces (core/notebook_parser.MODEL_NAME_PATTERN). */
const MODEL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,200}$/;

function suggestedModelName(projectName: string): string {
  return (
    projectName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 200) || 'model'
  );
}

interface RunPipelineModalProps {
  /** Only opened when the project has a linked notebook and an active dataset. */
  project: Project;
  onClose: () => void;
}

/**
 * Confirms a run of the project's notebook on its gold data and names the
 * model it will produce. The version is assigned by the worker.
 */
export default function RunPipelineModal({ project, onClose }: RunPipelineModalProps) {
  const navigate = useNavigate();
  const [modelName, setModelName] = useState(() => suggestedModelName(project.name));
  const nameValid = MODEL_NAME_PATTERN.test(modelName.trim());

  const mutation = useMutation({
    mutationFn: () => runProject(project.id, modelName.trim()),
    onSuccess: ({ pipeline_id }) => navigate(`/pipelines/${pipeline_id}`),
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (nameValid) mutation.mutate();
  }

  const repository = project.repository;
  const dataset = project.active_dataset;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-pipeline-title"
        className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-800 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-3">
          <h3 id="run-pipeline-title" className="text-sm font-semibold text-slate-100">
            Run pipeline: {project.name}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-200"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label htmlFor="model-name" className="mb-1 block text-xs font-medium text-slate-400">
              Model name
            </label>
            <input
              id="model-name"
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
              autoFocus
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100 placeholder-slate-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <p className={`mt-1 text-xs ${nameValid ? 'text-slate-500' : 'text-red-400'}`}>
              Letters, digits, <code>_</code> <code>.</code> <code>-</code>. Running again with the
              same name deploys a new version of that model.
            </p>
          </div>

          <dl className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs">
            <SummaryRow label="Repository">
              {repository ? repoNameFromUrl(repository.github_url) : '--'}
            </SummaryRow>
            <SummaryRow label="Branch">{repository?.branch || '--'}</SummaryRow>
            <SummaryRow label="Notebook">
              <span className="font-mono">{repository?.notebook_path || '--'}</span>
            </SummaryRow>
            <SummaryRow label="Gold data">
              {dataset ? `${dataset.name} (${formatBytes(dataset.size_bytes)})` : '--'}
            </SummaryRow>
          </dl>

          <p className="text-xs text-slate-500">
            The version is assigned automatically. If the notebook does not declare{' '}
            <code className="rounded bg-slate-900 px-1 py-0.5 font-mono text-slate-300">DATASET_PATH</code>{' '}
            in its parameters cell, it trains with its own data and nothing is downloaded.
          </p>

          {mutation.isError && (
            <div className="rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-300">
              {(mutation.error as Error).message}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!nameValid || mutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {mutation.isPending && <Spinner size="sm" />}
              Run
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 truncate text-slate-200">{children}</dd>
    </div>
  );
}
