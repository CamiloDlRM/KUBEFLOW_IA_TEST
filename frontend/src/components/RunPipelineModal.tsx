import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getPipelineInput, getRunSettings, runProject } from '../api/client';
import type { Project, TrainingParameter } from '../types';
import { describePolicy } from './DeployPolicyPanel';
import { formatBytes, repoNameFromUrl } from '../utils/format';
import { runLink } from '../utils/links';
import Spinner from './Spinner';

/** Same rule the backend enforces (core/notebook_parser.MODEL_NAME_PATTERN). */
const MODEL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,200}$/;

/** Same rules the backend enforces (core/deploy_policy.clean_parameters). */
const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const RESERVED = new Set([
  'DATASET_PATH',
  'MODEL_OUTPUT_PATH',
  'PIPELINE_ID',
  'MLFLOW_TRACKING_URI',
  'MLFLOW_RUN_ID',
  'TRAINING_FEATURES_PATH',
  'MODEL_NOTES_PATH',
]);

interface ParameterRow {
  name: string;
  value: string;
}

/** "300" is a number, "true" a flag, anything else text — as typed in a notebook. */
export function parseParameterValue(value: string): TrainingParameter {
  const trimmed = value.trim();
  if (trimmed === 'true' || trimmed === 'false') return trimmed === 'true';
  if (trimmed !== '' && /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(trimmed)) return Number(trimmed);
  return value;
}

export function parameterProblem(rows: ParameterRow[]): string | null {
  const seen = new Set<string>();
  for (const { name } of rows) {
    if (!name.trim()) return 'Every parameter needs a name.';
    if (!PARAMETER_NAME.test(name)) return `${name} is not a usable name: letters, digits and _, not starting with a digit.`;
    if (RESERVED.has(name)) return `${name} is set by the platform.`;
    if (seen.has(name)) return `${name} appears twice.`;
    seen.add(name);
  }
  return null;
}

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
  /** Called with the new run instead of navigating to its page. */
  onStarted?: (pipelineId: string) => void;
}

/**
 * Confirms a run of the project's notebook on its gold data and names the
 * model it will produce. The version is assigned by the worker.
 */
export default function RunPipelineModal({ project, onClose, onStarted }: RunPipelineModalProps) {
  const navigate = useNavigate();
  // Once the notebook has deployed, every run is a new version of that model.
  const existing = project.deployed_model;
  const [modelName, setModelName] = useState(() => suggestedModelName(project.name));
  const nameValid = Boolean(existing) || MODEL_NAME_PATTERN.test(modelName.trim());

  // What the run will be given, starting from what the last one was, and the
  // rule that decides whether its model deploys.
  const { data: runSettings } = useQuery({
    queryKey: ['run-settings', project.id],
    queryFn: () => getRunSettings(project.id),
  });
  const [rows, setRows] = useState<ParameterRow[] | null>(null);
  useEffect(() => {
    if (runSettings && rows === null) {
      setRows(
        Object.entries(runSettings.last_parameters).map(([name, value]) => ({ name, value: String(value) })),
      );
    }
  }, [runSettings, rows]);
  const parameterRows = rows ?? [];
  const problem = parameterProblem(parameterRows);

  const mutation = useMutation({
    mutationFn: () =>
      runProject(
        project.id,
        existing || modelName.trim(),
        Object.fromEntries(parameterRows.map(({ name, value }) => [name, parseParameterValue(value)])),
      ),
    onSuccess: ({ pipeline_id }) =>
      onStarted ? onStarted(pipeline_id) : navigate(runLink(pipeline_id, project.id)),
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
    if (nameValid && !problem) mutation.mutate();
  }

  const repository = project.repository;
  const dataset = project.active_dataset;
  // What the run will mount: the chosen layer, else the active gold build.
  const { data: input } = useQuery({
    queryKey: ['pipeline-input', project.id],
    queryFn: () => getPipelineInput(project.id),
  });
  const chosen = input?.choice.layer ? input.resolved?.label : undefined;

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
          {existing ? (
            <p className="text-sm text-slate-300">
              Model: <span className="font-display text-slate-100">{existing}</span>. This run deploys a
              new version of it.
            </p>
          ) : (
            <div>
              <label htmlFor="model-name" className="mb-1 block text-xs font-medium text-slate-400">
                Model name
              </label>
              <input
                id="model-name"
                value={modelName}
                onChange={(event) => setModelName(event.target.value)}
                autoFocus
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-display text-sm text-slate-100 placeholder-slate-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <p className={`mt-1 text-xs ${nameValid ? 'text-slate-500' : 'text-red-400'}`}>
                Letters, digits, <code>_</code> <code>.</code> <code>-</code>. Later runs of this
                notebook deploy new versions of this model.
              </p>
            </div>
          )}

          <dl className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs">
            <SummaryRow label="Repository">
              {repository ? repoNameFromUrl(repository.github_url) : '--'}
            </SummaryRow>
            <SummaryRow label="Branch">{repository?.branch || '--'}</SummaryRow>
            <SummaryRow label="Notebook">
              <span className="font-display">{repository?.notebook_path || '--'}</span>
            </SummaryRow>
            <SummaryRow label="Data">
              {chosen ?? (dataset ? `${dataset.name} (${formatBytes(dataset.size_bytes)})` : '--')}
            </SummaryRow>
          </dl>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-slate-400">Training parameters</legend>
            {parameterRows.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  aria-label={`Parameter ${index + 1} name`}
                  value={row.name}
                  placeholder="N_ESTIMATORS"
                  onChange={(event) =>
                    setRows(parameterRows.map((r, i) => (i === index ? { ...r, name: event.target.value } : r)))
                  }
                  className="w-40 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-display text-xs text-slate-100 focus:border-brand-500 focus:outline-none"
                />
                <span className="text-slate-500">=</span>
                <input
                  aria-label={`Parameter ${index + 1} value`}
                  value={row.value}
                  placeholder="300"
                  onChange={(event) =>
                    setRows(parameterRows.map((r, i) => (i === index ? { ...r, value: event.target.value } : r)))
                  }
                  className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-display text-xs text-slate-100 focus:border-brand-500 focus:outline-none"
                />
                <button
                  type="button"
                  aria-label={`Remove parameter ${index + 1}`}
                  onClick={() => setRows(parameterRows.filter((_, i) => i !== index))}
                  className="rounded px-1.5 text-slate-500 hover:bg-slate-700 hover:text-slate-200"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows([...parameterRows, { name: '', value: '' }])}
              className="text-xs text-brand-400 hover:text-brand-300"
            >
              + Add a parameter
            </button>
            <p className={`text-xs ${problem ? 'text-red-400' : 'text-slate-500'}`}>
              {problem ??
                'Each becomes a variable in the notebook, set after its parameters cell: numbers, true/false or text.'}
            </p>
          </fieldset>

          {runSettings && (
            <p className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
              {describePolicy(runSettings.policy)}{' '}
              <span className="text-slate-500">Change it in the project’s deployment rules.</span>
            </p>
          )}

          <p className="text-xs text-slate-500">
            The version is assigned automatically. If the notebook does not declare{' '}
            <code className="rounded bg-slate-900 px-1 py-0.5 font-display text-slate-300">DATASET_PATH</code>{' '}
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
              disabled={!nameValid || Boolean(problem) || mutation.isPending}
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
