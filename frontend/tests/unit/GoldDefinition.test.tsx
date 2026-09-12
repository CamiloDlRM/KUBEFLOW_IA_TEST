import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import GoldDefinition from '../../src/components/GoldDefinition';
import type { LayerSummary } from '../../src/types';

const getGoldRelations = vi.fn();
const previewGold = vi.fn();
const setGoldDefinition = vi.fn();
const suggestGold = vi.fn();

vi.mock('../../src/api/client', () => ({
  getGoldRelations: (...args: unknown[]) => getGoldRelations(...args),
  previewGold: (...args: unknown[]) => previewGold(...args),
  setGoldDefinition: (...args: unknown[]) => setGoldDefinition(...args),
  suggestGold: (...args: unknown[]) => suggestGold(...args),
}));

const SUMMARY: LayerSummary = {
  layer: 'gold',
  bucket: 'gold',
  objects: 1,
  rows: 100,
  size_bytes: 1024,
  last_updated: null,
  streams: [],
  sql: '',
  is_default_definition: true,
  version: 1,
  build_error: '',
};

const RELATIONS = {
  relations: {
    patients_1: {
      rows: 3,
      columns: [
        { name: 'patient_id', type: 'VARCHAR' },
        { name: 'age', type: 'BIGINT' },
      ],
    },
  },
  default_sql: 'SELECT * FROM patients_1',
};

function renderPanel(summary: LayerSummary = SUMMARY) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GoldDefinition repoId={4} summary={summary} />
    </QueryClientProvider>,
  );
}

describe('GoldDefinition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGoldRelations.mockResolvedValue(RELATIONS);
    previewGold.mockResolvedValue({
      columns: ['patient_id'],
      rows: [['p1'], ['p2']],
      total_rows: 2,
      relations: { patients_1: 3 },
      sql: 'SELECT patient_id FROM patients_1',
    });
    setGoldDefinition.mockResolvedValue(SUMMARY);
  });

  it('shows the schema a definition can be written against', async () => {
    renderPanel();
    expect(await screen.findByText(/patients_1/)).toBeInTheDocument();
    expect(screen.getByText('patient_id')).toBeInTheDocument();
  });

  it('says the project is on the default when it has written no definition', async () => {
    renderPanel();
    expect(await screen.findByText(/no definition of its own yet/)).toBeInTheDocument();
  });

  it('warns that the default stacks several sources rather than joining them', async () => {
    // The nulls a user finds in the gold preview are structural: each row
    // carries one source's columns and nothing in the other's. Letting them
    // discover that by scrolling is how somebody trains on a half-empty table.
    getGoldRelations.mockResolvedValue({
      relations: {
        patients_1: RELATIONS.relations.patients_1,
        encounters_2: { rows: 5, columns: [{ name: 'encounter_id', type: 'VARCHAR' }] },
      },
      default_sql: 'SELECT * FROM patients_1\nUNION ALL BY NAME\nSELECT * FROM encounters_2',
    });
    renderPanel();

    const warning = await screen.findByRole('alert');
    expect(warning).toHaveTextContent(/2 sources are stacked, not joined/);
    expect(warning).toHaveTextContent(/rarely a table worth training on/);
  });

  it('does not warn when a single source is the whole project', async () => {
    renderPanel();
    await screen.findByText(/no definition of its own yet/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not warn once the project has written its own query', async () => {
    getGoldRelations.mockResolvedValue({
      relations: {
        patients_1: RELATIONS.relations.patients_1,
        encounters_2: { rows: 5, columns: [{ name: 'encounter_id', type: 'VARCHAR' }] },
      },
      default_sql: 'x',
    });
    renderPanel({ ...SUMMARY, sql: 'SELECT 1', is_default_definition: false });

    await screen.findByText(/on every extraction/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('asks the model for a query and puts it in an editable box', async () => {
    suggestGold.mockResolvedValue({
      sql: 'SELECT patient_id, age FROM patients_1',
      explanation: 'One row per patient.',
      error: '',
    });
    renderPanel();

    await userEvent.type(
      screen.getByPlaceholderText(/one row per patient/),
      'one row per patient',
    );
    await userEvent.click(screen.getByRole('button', { name: /write the query/i }));

    const editor = await screen.findByDisplayValue('SELECT patient_id, age FROM patients_1');
    // Editable on purpose: what the model wrote is a draft, not an answer.
    expect(editor.tagName).toBe('TEXTAREA');
    expect(screen.getByText('One row per patient.')).toBeInTheDocument();
  });

  it('reports why no suggestion came back rather than leaving an empty box', async () => {
    suggestGold.mockResolvedValue({
      sql: '',
      explanation: '',
      error: 'No AI provider is configured on this deployment.',
    });
    renderPanel();

    await userEvent.type(screen.getByPlaceholderText(/one row per patient/), 'anything');
    await userEvent.click(screen.getByRole('button', { name: /write the query/i }));

    expect(await screen.findByText(/No AI provider is configured/)).toBeInTheDocument();
  });

  it('says so when the call for a suggestion fails outright', async () => {
    // The failure this was written for: the client aborted the request at 15
    // seconds, the button went back to its resting label, and nothing at all
    // appeared — indistinguishable from a feature that does nothing.
    suggestGold.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));
    renderPanel();

    await userEvent.type(screen.getByPlaceholderText(/one row per patient/), 'anything');
    await userEvent.click(screen.getByRole('button', { name: /write the query/i }));

    expect(await screen.findByText(/took too long to answer/)).toBeInTheDocument();
  });

  it('says so when saving fails', async () => {
    setGoldDefinition.mockRejectedValue({
      response: { data: { detail: 'a gold definition must start with SELECT or WITH' } },
    });
    renderPanel();
    await userEvent.type(screen.getByLabelText(/the query that builds gold/i), 'SELECT 1');
    await userEvent.click(screen.getByRole('button', { name: /run it/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /use this definition/i })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole('button', { name: /use this definition/i }));

    expect(await screen.findByText(/must start with SELECT/)).toBeInTheDocument();
  });

  it('will not save a definition that has never been run', async () => {
    // This becomes the table every model trains on; an unexecuted query is
    // exactly the one that silently returns nothing.
    renderPanel();
    await userEvent.type(screen.getByLabelText(/the query that builds gold/i), 'SELECT 1');

    expect(screen.getByRole('button', { name: /use this definition/i })).toBeDisabled();
  });

  it('enables saving once the query has been run', async () => {
    renderPanel();
    await userEvent.type(
      screen.getByLabelText(/the query that builds gold/i),
      'SELECT patient_id FROM patients_1',
    );
    await userEvent.click(screen.getByRole('button', { name: /run it/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /use this definition/i })).toBeEnabled(),
    );
  });

  it('shows the row count and the first rows of what the query returns', async () => {
    renderPanel();
    await userEvent.type(screen.getByLabelText(/the query that builds gold/i), 'SELECT 1');
    await userEvent.click(screen.getByRole('button', { name: /run it/i }));

    expect(await screen.findByText(/2 rows, 1 columns/)).toBeInTheDocument();
    expect(screen.getByText('p1')).toBeInTheDocument();
  });

  it('separates a query that returned nothing from inputs that were empty', async () => {
    previewGold.mockResolvedValue({
      columns: ['patient_id'],
      rows: [],
      total_rows: 0,
      relations: { patients_1: 3 },
      sql: 'x',
    });
    renderPanel();
    await userEvent.type(screen.getByLabelText(/the query that builds gold/i), 'SELECT 1');
    await userEvent.click(screen.getByRole('button', { name: /run it/i }));

    expect(await screen.findByText(/the inputs were not empty/)).toBeInTheDocument();
  });

  it('shows why a query was refused', async () => {
    previewGold.mockRejectedValue({
      response: { data: { detail: 'a gold definition may only read: DROP is not allowed' } },
    });
    renderPanel();
    await userEvent.type(screen.getByLabelText(/the query that builds gold/i), 'DROP TABLE x');
    await userEvent.click(screen.getByRole('button', { name: /run it/i }));

    expect(await screen.findByText(/may only read/)).toBeInTheDocument();
  });

  it('re-running is required after the query is edited', async () => {
    renderPanel();
    const editor = screen.getByLabelText(/the query that builds gold/i);
    await userEvent.type(editor, 'SELECT 1');
    await userEvent.click(screen.getByRole('button', { name: /run it/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /use this definition/i })).toBeEnabled(),
    );

    await userEvent.type(editor, ' WHERE false');

    expect(screen.getByRole('button', { name: /use this definition/i })).toBeDisabled();
  });

  it('saves the definition and says when it takes effect', async () => {
    renderPanel();
    await userEvent.type(
      screen.getByLabelText(/the query that builds gold/i),
      'SELECT patient_id FROM patients_1',
    );
    await userEvent.click(screen.getByRole('button', { name: /run it/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /use this definition/i })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole('button', { name: /use this definition/i }));

    await waitFor(() =>
      expect(setGoldDefinition).toHaveBeenCalledWith(4, 'SELECT patient_id FROM patients_1'),
    );
    expect(await screen.findByText(/Gold is rebuilding now/)).toBeInTheDocument();
  });

  it('can go back to the default, which is stored as emptiness', async () => {
    renderPanel({ ...SUMMARY, sql: 'SELECT 1', is_default_definition: false });
    await userEvent.click(screen.getByRole('button', { name: /back to the default/i }));

    await waitFor(() => expect(setGoldDefinition).toHaveBeenCalledWith(4, ''));
  });
});
