import type { DashboardToolCall } from '../../types';

/**
 * A Superset tool call, said the way a person would say what was done.
 *
 * The agent's calls are the honest account of how a dashboard was built, but
 * as raw names and JSON they read as noise — "generate_chart {…}" twelve times.
 * Here each becomes an action ("Created a chart"), the thing it acted on (the
 * chart's title) and whether it worked, with the raw call one click away.
 */

export type StepKind = 'lookup' | 'dataset' | 'chart' | 'edit' | 'dashboard' | 'schema' | 'other';

export interface Step {
  kind: StepKind;
  label: string;
  /** What it acted on, when the arguments say: a chart title, a dataset name. */
  subject: string;
  failed: boolean;
}

const LABELS: Record<string, [StepKind, string]> = {
  list_databases: ['lookup', 'Looked up the databases'],
  list_datasets: ['lookup', 'Looked up the datasets'],
  get_dataset_info: ['lookup', 'Read a dataset’s columns'],
  list_charts: ['lookup', 'Looked up the charts'],
  list_dashboards: ['lookup', 'Looked up the dashboards'],
  get_dashboard_info: ['lookup', 'Read the dashboard'],
  create_virtual_dataset: ['dataset', 'Defined a dataset over gold'],
  generate_chart: ['chart', 'Created a chart'],
  create_chart: ['chart', 'Created a chart'],
  update_chart: ['edit', 'Changed a chart'],
  get_chart_type_schema: ['schema', 'Read how a chart type works'],
  generate_dashboard: ['dashboard', 'Built the dashboard'],
  add_chart_to_existing_dashboard: ['dashboard', 'Added a chart to the dashboard'],
};

const SUBJECT_KEYS = [
  'chart_name',
  'slice_name',
  'title',
  'dashboard_title',
  'dataset_name',
  'table_name',
  'name',
  'viz_type',
  'chart_type',
];

/** A result that reports an error rather than an outcome. */
const FAILURE = /"error"\s*:|^\s*error\b|traceback|validation_system_error|"success"\s*:\s*false/i;

function humanize(name: string): string {
  const words = name.replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Called a tool';
}

function subjectOf(args: Record<string, unknown>): string {
  // Arguments may come nested under a "request" or "params" object.
  const flat: Record<string, unknown> = { ...args };
  for (const key of ['request', 'params', 'config']) {
    const nested = args[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) Object.assign(flat, nested);
  }
  for (const key of SUBJECT_KEYS) {
    const value = flat[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function describeStep(call: DashboardToolCall): Step {
  const [kind, label] = LABELS[call.name] ?? ['other', humanize(call.name)];
  return {
    kind,
    label,
    subject: subjectOf(call.arguments ?? {}),
    failed: FAILURE.test((call.result ?? '').slice(0, 400)),
  };
}

/** "3 charts, 1 dataset, the dashboard" — the shape of an exchange at a glance. */
export function summarizeSteps(calls: DashboardToolCall[]): string {
  const steps = calls.map(describeStep).filter((step) => !step.failed);
  const count = (kind: StepKind) => steps.filter((step) => step.kind === kind).length;
  const parts: string[] = [];
  const charts = count('chart');
  const edits = count('edit');
  const datasets = count('dataset');
  if (datasets) parts.push(`${datasets} dataset${datasets === 1 ? '' : 's'}`);
  if (charts) parts.push(`${charts} chart${charts === 1 ? '' : 's'}`);
  if (edits) parts.push(`${edits} change${edits === 1 ? '' : 's'}`);
  if (count('dashboard')) parts.push('the dashboard');
  return parts.join(', ');
}
