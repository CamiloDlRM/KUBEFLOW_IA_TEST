import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import DataFactory from '../../src/pages/DataFactory';
import type { DataSource, LayerSummary, Medallion } from '../../src/types';

const getProject = vi.fn();
const getSources = vi.fn();
const getMedallion = vi.fn();
const previewLayer = vi.fn();
const previewSource = vi.fn();
const getLayerDiff = vi.fn();
const getGoldRelations = vi.fn();
const getIngestionRuns = vi.fn();

vi.mock('../../src/api/client', () => ({
  getProject: (...a: unknown[]) => getProject(...a),
  getSources: (...a: unknown[]) => getSources(...a),
  getMedallion: (...a: unknown[]) => getMedallion(...a),
  previewLayer: (...a: unknown[]) => previewLayer(...a),
  previewSource: (...a: unknown[]) => previewSource(...a),
  getLayerDiff: (...a: unknown[]) => getLayerDiff(...a),
  getGoldRelations: (...a: unknown[]) => getGoldRelations(...a),
  getIngestionRuns: (...a: unknown[]) => getIngestionRuns(...a),
  createSource: vi.fn(),
  deleteSource: vi.fn(),
  runIngestion: vi.fn(),
  uploadDataset: vi.fn(),
  previewGold: vi.fn(),
  setGoldDefinition: vi.fn(),
  suggestGold: vi.fn(),
}));

function layer(overrides: Partial<LayerSummary> = {}): LayerSummary {
  return {
    layer: 'bronze',
    bucket: 'bronze',
    objects: 0,
    rows: 0,
    size_bytes: 0,
    last_updated: null,
    streams: [],
    sql: '',
    is_default_definition: true,
    version: 0,
    build_error: '',
    ...overrides,
  };
}

function medallion(overrides: Partial<Medallion> = {}): Medallion {
  return {
    project_id: 4,
    bronze: layer(),
    silver: layer({ layer: 'silver', bucket: 'silver' }),
    gold: layer({ layer: 'gold', bucket: 'gold' }),
    ...overrides,
  };
}

const SOURCE: DataSource = {
  id: 1,
  project_id: 4,
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
  normalize_text_column: '',
  normalize_code_column: '',
  created_at: '2026-09-12T10:00:00Z',
  is_active: true,
};

/** Scoped to the map: "Connect" also names a button inside the connect stage. */
async function step(label: string) {
  const map = await screen.findByRole('navigation', { name: /stages/i });
  return within(map).getByRole('button', { name: label });
}

function renderFactory() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/4/data']}>
        <Routes>
          <Route path="/projects/:projectId/data" element={<DataFactory />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DataFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProject.mockResolvedValue({ id: 4, name: 'Hospital readmissions' });
    getSources.mockResolvedValue([]);
    getMedallion.mockResolvedValue(medallion());
    previewLayer.mockRejectedValue(new Error('nothing yet'));
    previewSource.mockResolvedValue({ columns: [], rows: [], profile: {}, truncated: false });
    getLayerDiff.mockRejectedValue(new Error('nothing yet'));
    getGoldRelations.mockResolvedValue({ relations: {}, default_sql: '' });
    getIngestionRuns.mockResolvedValue([]);
  });

  it('shows all six stages', async () => {
    renderFactory();
    for (const label of ['Connect', 'Preview', 'Extract', 'Bronze', 'Silver', 'Gold']) {
      expect(await step(label)).toBeInTheDocument();
    }
  });

  it('locks the stages the project has not reached, and says what unlocks them', async () => {
    // A disabled step with no explanation makes a person guess, and the guess
    // is usually that the feature is broken.
    renderFactory();
    const preview = await step('Preview');
    expect(preview).toBeDisabled();
    expect(preview).toHaveTextContent(/Connect a source first/);
  });

  it('opens on the first stage when nothing has been done', async () => {
    renderFactory();
    const connect = await step('Connect');
    expect(connect).toHaveAttribute('aria-current', 'step');
  });

  it('opens on the furthest stage reached, which is where the work is', async () => {
    // Not stage one: a returning user has finished with that.
    getSources.mockResolvedValue([SOURCE]);
    getMedallion.mockResolvedValue(
      medallion({
        bronze: layer({ objects: 1, rows: 15_884 }),
        silver: layer({ layer: 'silver', bucket: 'silver', objects: 1, rows: 15_880 }),
        gold: layer({ layer: 'gold', bucket: 'gold', version: 2, rows: 21_455, objects: 2 }),
      }),
    );
    renderFactory();

    const gold = await step('Gold');
    await waitFor(() => expect(gold).toHaveAttribute('aria-current', 'step'));
  });

  it('lets a reached stage be revisited, which a wizard would not', async () => {
    getSources.mockResolvedValue([SOURCE]);
    getMedallion.mockResolvedValue(
      medallion({ bronze: layer({ objects: 1, rows: 100 }) }),
    );
    renderFactory();

    const connect = await step('Connect');
    await waitFor(() => expect(connect).toBeEnabled());
    await userEvent.click(connect);

    expect(connect).toHaveAttribute('aria-current', 'step');
  });

  it('carries each layer stage in its own metal', async () => {
    getSources.mockResolvedValue([SOURCE]);
    getMedallion.mockResolvedValue(
      medallion({ bronze: layer({ objects: 1, rows: 100 }) }),
    );
    renderFactory();

    const bronze = await step('Bronze');
    await waitFor(() => expect(bronze).toBeEnabled());
    expect(bronze.className).toContain('amber');
  });

  it('shows how many rows a layer landed on its own step', async () => {
    getSources.mockResolvedValue([SOURCE]);
    getMedallion.mockResolvedValue(
      medallion({ bronze: layer({ objects: 1, rows: 15_884 }) }),
    );
    renderFactory();

    const bronze = await step('Bronze');
    await waitFor(() =>
      expect((bronze.textContent ?? '').replace(/[.,\s]/g, '')).toContain('15884'),
    );
  });

  it('previews each connected source before anything is extracted', async () => {
    getSources.mockResolvedValue([SOURCE]);
    renderFactory();

    await userEvent.click(await step('Preview'));

    await waitFor(() => expect(previewSource).toHaveBeenCalled());
    expect(screen.getByText(/Nothing is stored and no watermark moves/)).toBeInTheDocument();
  });

  it('offers the gold definition on the gold stage', async () => {
    getSources.mockResolvedValue([SOURCE]);
    getMedallion.mockResolvedValue(
      medallion({ gold: layer({ layer: 'gold', bucket: 'gold', version: 1, objects: 1 }) }),
    );
    renderFactory();

    expect(await screen.findByText('How gold is built')).toBeInTheDocument();
  });
});
