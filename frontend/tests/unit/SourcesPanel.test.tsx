import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import SourcesPanel from '../../src/components/SourcesPanel';
import type { DataSource, IngestionRun } from '../../src/types';

const getSources = vi.fn();
const createSource = vi.fn();
const deleteSource = vi.fn();
const runIngestion = vi.fn();
const getIngestionRuns = vi.fn();
const previewSource = vi.fn();

vi.mock('../../src/api/client', () => ({
  getSources: (...args: unknown[]) => getSources(...args),
  createSource: (...args: unknown[]) => createSource(...args),
  deleteSource: (...args: unknown[]) => deleteSource(...args),
  runIngestion: (...args: unknown[]) => runIngestion(...args),
  getIngestionRuns: (...args: unknown[]) => getIngestionRuns(...args),
  previewSource: (...args: unknown[]) => previewSource(...args),
}));

const SOURCE: DataSource = {
  id: 1,
  repo_id: 7,
  name: 'Hospital HIS',
  kind: 'postgres',
  host: 'hospital-db',
  port: 5432,
  database: 'hospital',
  username: 'hospital',
  password_env: 'HOSPITAL_DB_PASSWORD',
  extraction_sql: 'SELECT 1 WHERE x > :watermark',
  watermark_column: 'recorded_at',
  watermark_value: '',
  normalize_text_column: 'procedure_text',
  normalize_code_column: 'procedure_code',
  created_at: '2026-09-11T10:00:00Z',
  is_active: true,
};

const RUN: IngestionRun = {
  id: 'run-1',
  source_id: 1,
  status: 'success',
  watermark_before: '1900-01-01T00:00:00+00:00',
  watermark_after: '2024-06-14T09:00:00+00:00',
  rows_extracted: 15884,
  dataset_id: 3,
  profile: {},
  normalization: {
    rows: 15884,
    already_coded: 9436,
    filled: 6308,
    unresolved: 140,
    fill_rate: 0.978,
    vocabulary_size: 246,
    by_method: { 'cascade:exact': 5213, 'cascade:fuzzy': 1095 },
  },
  started_at: '2026-09-11T10:05:00Z',
  finished_at: '2026-09-11T10:06:00Z',
  error: '',
};

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SourcesPanel repoId={7} />
    </QueryClientProvider>,
  );
}

describe('SourcesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSources.mockResolvedValue([SOURCE]);
    getIngestionRuns.mockResolvedValue([RUN]);
    runIngestion.mockResolvedValue({ ...RUN, status: 'queued' });
  });

  it('lists only the sources of this repository', async () => {
    getSources.mockResolvedValue([SOURCE, { ...SOURCE, id: 2, repo_id: 99, name: 'Other repo' }]);
    renderPanel();

    expect(await screen.findByText('Hospital HIS')).toBeInTheDocument();
    expect(screen.queryByText('Other repo')).not.toBeInTheDocument();
  });

  it('says a source has never run instead of showing an empty watermark', async () => {
    renderPanel();
    expect(await screen.findByText('never run')).toBeInTheDocument();
  });

  it('queues an extraction', async () => {
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /run extraction/i }));
    await waitFor(() => expect(runIngestion).toHaveBeenCalledWith(1));
  });

  it('shows what normalisation achieved, including what it refused', async () => {
    renderPanel();
    await userEvent.click(await screen.findByText('Hospital HIS'));

    // Matched on the wording, not the formatted numbers: toLocaleString
    // renders "6,308", "6.308" or "6 308" depending on the runtime locale,
    // and asserting one of those would make this pass or fail by accident.
    const line = await screen.findByText(/codes filled/);
    const text = line.textContent ?? '';

    // The unresolved rows are stated rather than rounded away: hiding them
    // would make a 97.8% fill rate look like completion.
    expect(text).toMatch(/left unresolved/);
    expect(text).toMatch(/terms learned from the coded rows/);
    expect(text.replace(/[.,\s]/g, '')).toContain('6308');
    expect(text.replace(/[.,\s]/g, '')).toContain('140');
  });

  it('marks an empty extraction as nothing new rather than a failure', async () => {
    getIngestionRuns.mockResolvedValue([
      { ...RUN, rows_extracted: 0, normalization: {}, watermark_after: RUN.watermark_before },
    ]);
    renderPanel();
    await userEvent.click(await screen.findByText('Hospital HIS'));

    expect(await screen.findByText('nothing new')).toBeInTheDocument();
  });

  it('reports a run that failed', async () => {
    getIngestionRuns.mockResolvedValue([
      { ...RUN, status: 'failed', rows_extracted: 0, error: 'could not connect', normalization: {} },
    ]);
    renderPanel();
    await userEvent.click(await screen.findByText('Hospital HIS'));

    expect(await screen.findByText('could not connect')).toBeInTheDocument();
  });

  it('says a run was stored without normalising when that step failed', async () => {
    getIngestionRuns.mockResolvedValue([
      { ...RUN, normalization: { error: 'column missing' } },
    ]);
    renderPanel();
    await userEvent.click(await screen.findByText('Hospital HIS'));

    expect(await screen.findByText(/stored without normalising/i)).toBeInTheDocument();
  });

  it('asks for a variable name, not a password', async () => {
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /add source/i }));

    expect(
      screen.getByText(/the name of a variable set on the worker/i),
    ).toBeInTheDocument();
    // Never a password input: there is no password to collect.
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('submits a new source', async () => {
    createSource.mockResolvedValue(SOURCE);
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /add source/i }));

    await userEvent.type(screen.getByPlaceholderText('Hospital HIS'), 'HIS');
    await userEvent.type(screen.getByPlaceholderText('hospital-db'), 'db');
    // Database and username share a placeholder, so address them by position.
    const [database, username] = screen.getAllByPlaceholderText('hospital');
    await userEvent.type(database, 'hosp');
    await userEvent.type(username, 'user');
    await userEvent.click(screen.getByRole('button', { name: /connect source/i }));

    await waitFor(() => expect(createSource).toHaveBeenCalled());
    expect(createSource.mock.calls[0][0]).toMatchObject({ repo_id: 7, name: 'HIS' });
  });

  it('previews the source before it is saved', async () => {
    previewSource.mockResolvedValue({
      columns: ['id', 'procedure_text', 'procedure_code'],
      rows: [[1, 'APPENDECTOMY', null]],
      profile: {
        id: { inferred_type: 'numeric' },
        procedure_text: { inferred_type: 'text' },
        procedure_code: { inferred_type: 'categorical' },
      },
      truncated: true,
    });
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /add source/i }));
    await userEvent.type(screen.getByPlaceholderText('hospital-db'), 'db');
    const [database, username] = screen.getAllByPlaceholderText('hospital');
    await userEvent.type(database, 'hosp');
    await userEvent.type(username, 'user');

    await userEvent.click(screen.getByRole('button', { name: /preview data/i }));

    // Scoped to the table: 'procedure_text' is also a placeholder in the form.
    expect(
      await screen.findByRole('columnheader', { name: /procedure_text/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'APPENDECTOMY' })).toBeInTheDocument();
    // The inferred type is shown so the text and code columns can be chosen
    // from what is there rather than from memory.
    expect(screen.getAllByText('categorical').length).toBeGreaterThan(0);
    expect(screen.getByText(/nothing was stored/i)).toBeInTheDocument();
  });

  it('shows a null cell as a dash rather than as empty space', async () => {
    previewSource.mockResolvedValue({
      columns: ['procedure_code'],
      rows: [[null]],
      profile: { procedure_code: { inferred_type: 'categorical' } },
      truncated: false,
    });
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /add source/i }));
    await userEvent.type(screen.getByPlaceholderText('hospital-db'), 'db');
    const [db2, user2] = screen.getAllByPlaceholderText('hospital');
    await userEvent.type(db2, 'h');
    await userEvent.type(user2, 'u');
    await userEvent.click(screen.getByRole('button', { name: /preview data/i }));

    expect(await screen.findByText('—')).toBeInTheDocument();
  });

  it('reports why a preview failed instead of saving a broken source', async () => {
    previewSource.mockRejectedValue(new Error('relation "procedures" does not exist'));
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /add source/i }));
    await userEvent.type(screen.getByPlaceholderText('hospital-db'), 'db');
    const [db3, user3] = screen.getAllByPlaceholderText('hospital');
    await userEvent.type(db3, 'h');
    await userEvent.type(user3, 'u');
    await userEvent.click(screen.getByRole('button', { name: /preview data/i }));

    expect(await screen.findByText(/does not exist/)).toBeInTheDocument();
  });

  it('cannot preview before the connection is filled in', async () => {
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /add source/i }));

    expect(screen.getByRole('button', { name: /preview data/i })).toBeDisabled();
  });

  it('invites an upload when no source is connected', async () => {
    getSources.mockResolvedValue([]);
    renderPanel();

    expect(await screen.findByText(/no source connected/i)).toBeInTheDocument();
  });
});
