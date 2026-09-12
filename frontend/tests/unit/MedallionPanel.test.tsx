import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import MedallionPanel from '../../src/components/MedallionPanel';
import type { LayerPreview, LayerSummary, Medallion } from '../../src/types';

const getMedallion = vi.fn();
const previewLayer = vi.fn();
const getGoldRelations = vi.fn();
const previewGold = vi.fn();
const setGoldDefinition = vi.fn();
const suggestGold = vi.fn();

vi.mock('../../src/api/client', () => ({
  getMedallion: (...args: unknown[]) => getMedallion(...args),
  previewLayer: (...args: unknown[]) => previewLayer(...args),
  getGoldRelations: (...args: unknown[]) => getGoldRelations(...args),
  previewGold: (...args: unknown[]) => previewGold(...args),
  setGoldDefinition: (...args: unknown[]) => setGoldDefinition(...args),
  suggestGold: (...args: unknown[]) => suggestGold(...args),
}));

function layer(overrides: Partial<LayerSummary> = {}): LayerSummary {
  return {
    layer: 'silver',
    bucket: 'silver',
    objects: 2,
    rows: 15_884,
    size_bytes: 1_048_576,
    last_updated: '2026-09-11T10:00:00Z',
    streams: [],
    sql: '',
    is_default_definition: true,
    version: 0,
    build_error: '',
    ...overrides,
  };
}

const MEDALLION: Medallion = {
  repo_id: 4,
  bronze: layer({ layer: 'bronze', bucket: 'bronze', rows: 15_890 }),
  silver: layer({
    rows: 15_884,
    streams: [
      {
        source_id: 1,
        source_name: 'Hospital HIS',
        relation: 'hospital_his_1',
        objects: 2,
        rows: 15_884,
        size_bytes: 1_048_576,
      },
    ],
  }),
  gold: layer({ layer: 'gold', bucket: 'gold', rows: 15_884, version: 3, objects: 3 }),
};

const PREVIEW: LayerPreview = {
  layer: 'silver',
  key: 'project-4/source-1/run-abc.parquet',
  columns: [
    { name: 'patient_id', type: 'string' },
    { name: 'age', type: 'int64' },
  ],
  rows: [
    ['p1', 44],
    ['p2', null],
  ],
  object_rows: 15_884,
  truncated: true,
};

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MedallionPanel repoId={4} />
    </QueryClientProvider>,
  );
}

describe('MedallionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMedallion.mockResolvedValue(MEDALLION);
    previewLayer.mockResolvedValue(PREVIEW);
    getGoldRelations.mockResolvedValue({ relations: {}, default_sql: '' });
  });

  it('shows the three layers by name', async () => {
    renderPanel();
    for (const name of ['Bronze', 'Silver', 'Gold']) {
      expect(await screen.findByText(name)).toBeInTheDocument();
    }
  });

  it('shows each layer as a separate row count', async () => {
    // Matched on the wording rather than the formatted number: toLocaleString
    // renders "15,884", "15.884" or "15 884" depending on the runtime locale.
    renderPanel();
    const cards = await screen.findAllByRole('button', { name: /rows/ });
    const counts = cards.map((card) => (card.textContent ?? '').replace(/[.,\s]/g, ''));

    expect(counts.some((text) => text.includes('15890'))).toBe(true);
    expect(counts.some((text) => text.includes('15884'))).toBe(true);
  });

  it('says what each layer promises, so the three are not just colours', async () => {
    renderPanel();
    expect(await screen.findByText('What the source said')).toBeInTheDocument();
    expect(screen.getByText('What the data means')).toBeInTheDocument();
    expect(screen.getByText('What the project answers')).toBeInTheDocument();
  });

  it('opens on silver, the layer a user most often wants', async () => {
    renderPanel();
    const silver = await screen.findByRole('button', { name: /Silver/ });
    expect(silver).toHaveAttribute('aria-pressed', 'true');
  });

  it('previews the selected layer and shows the stored types', async () => {
    renderPanel();
    // The Parquet type is the claim silver makes; a label would not be evidence.
    expect(await screen.findByText('int64')).toBeInTheDocument();
    expect(screen.getByText('patient_id')).toBeInTheDocument();
  });

  it('shows a null as null rather than as empty space', async () => {
    // Bronze keeps a null and an empty string apart; rendering both as blank
    // would throw that distinction away at the last step.
    renderPanel();
    expect(await screen.findByText('null')).toBeInTheDocument();
  });

  it('switches layer when another card is chosen', async () => {
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /Bronze/ }));

    await waitFor(() => expect(previewLayer).toHaveBeenCalledWith(4, 'bronze', expect.anything()));
  });

  it('shows the gold version, because a model was trained on one build', async () => {
    renderPanel();
    const gold = await screen.findByRole('button', { name: /Gold/ });
    expect(within(gold).getByText('v3')).toBeInTheDocument();
  });

  it('offers the gold definition only when gold is selected', async () => {
    getGoldRelations.mockResolvedValue({
      relations: { hospital_his_1: { rows: 10, columns: [{ name: 'id', type: 'VARCHAR' }] } },
      default_sql: 'SELECT * FROM hospital_his_1',
    });
    renderPanel();

    expect(screen.queryByText('How gold is built')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /Gold/ }));
    expect(await screen.findByText('How gold is built')).toBeInTheDocument();
  });

  it('names each source stream the way a gold query would address it', async () => {
    renderPanel();
    expect(await screen.findByText(/Hospital HIS: /)).toBeInTheDocument();
  });

  it('invites an extraction when nothing has landed yet', async () => {
    getMedallion.mockResolvedValue({
      repo_id: 4,
      bronze: layer({ layer: 'bronze', rows: 0, objects: 0 }),
      silver: layer({ rows: 0, objects: 0 }),
      gold: layer({ layer: 'gold', rows: 0, objects: 0 }),
    });
    renderPanel();

    expect(await screen.findByText(/Nothing has been extracted yet/)).toBeInTheDocument();
  });

  it('reports a gold build that failed instead of showing a stale count', async () => {
    getMedallion.mockResolvedValue({
      ...MEDALLION,
      gold: layer({ layer: 'gold', build_error: 'Binder Error: no such column' }),
    });
    renderPanel();

    expect(await screen.findByText(/Binder Error/)).toBeInTheDocument();
  });

  it('says a layer is empty rather than showing a broken table', async () => {
    previewLayer.mockRejectedValue(new Error('nothing yet'));
    renderPanel();

    expect(await screen.findByText(/Nothing to show in silver yet/)).toBeInTheDocument();
  });
});
