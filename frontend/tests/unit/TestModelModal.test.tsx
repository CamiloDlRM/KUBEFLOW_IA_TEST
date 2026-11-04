import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TestModelModal from '../../src/components/models/TestModelModal';
import type { ModelCard, ModelDeployment } from '../../src/types';

const predict = vi.fn();

vi.mock('../../src/api/client', () => ({
  API_BASE: 'https://api.example.test',
  predict: (...args: unknown[]) => predict(...args),
}));

const CARD: ModelCard = {
  kind: 'classifier',
  rows: 1840,
  classes: ['ambulatory', 'emergency', 'inpatient', 'virtual'],
  inputs: [
    { name: 'duration_minutes', type: 'number', min: 1, p05: 4, median: 30, p95: 2000, max: 6596, missing: 0 },
    { name: 'base_cost', type: 'number', min: 12, p05: 40, median: 130, p95: 6000, max: 14650, missing: 0.02 },
  ],
  baseline: { values: [30, 130], prediction: 'ambulatory', probabilities: { ambulatory: 0.9 } },
  effects: [
    {
      input: 'duration_minutes',
      segments: [
        { from: 1, to: 13, prediction: 'virtual', share: 0.94, rows: 300 },
        { from: 13, to: 70, prediction: 'ambulatory', share: 0.94, rows: 900 },
        { from: 70, to: 1651, prediction: 'emergency', share: 0.99, rows: 500 },
        { from: 1651, to: 6596, prediction: 'inpatient', share: 1, rows: 140 },
      ],
    },
  ],
  note: '',
};

function model(card: ModelCard | undefined = CARD): ModelDeployment {
  return {
    model_name: 'encounter-class-classifier',
    version: '1',
    accuracy: 0.91,
    endpoint_url: 'http://model-server:8001/predict/encounter-class-classifier',
    deployed_at: '2026-10-23T10:00:00Z',
    is_active: true,
    pipeline_id: 'run-1',
    model_card: card,
  };
}

function renderModal(deployment = model()) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TestModelModal model={deployment} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe('TestModelModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    predict.mockResolvedValue({
      prediction: ['emergency'],
      model_name: 'encounter-class-classifier',
      version: '1',
      probabilities: [{ ambulatory: 0.1, emergency: 0.85, inpatient: 0.05 }],
    });
  });

  it('lists the inputs in the order the model takes them, with their training range', () => {
    renderModal();

    const inputs = within(screen.getByRole('region', { name: 'Inputs' }));
    const fields = inputs.getAllByRole('spinbutton');
    expect(fields.map((field) => field.id)).toEqual(['model-input-0', 'model-input-1']);
    expect(inputs.getByRole('spinbutton', { name: 'duration_minutes' })).toHaveValue(30);
    expect(inputs.getByText(/trained on 1 – 6,596 · typical 30/)).toBeInTheDocument();
    expect(inputs.getByText(/2% missing in training/)).toBeInTheDocument();
  });

  it('says what the training rows around a value were answered', async () => {
    renderModal();

    const field = screen.getByRole('spinbutton', { name: 'duration_minutes' });
    await userEvent.clear(field);
    await userEvent.type(field, '400');

    // The line under the strip, not the same words in the closed "All ranges" list.
    expect(screen.getByText('70 – 1,651: emergency for 99% of 500 training rows', { selector: 'p' })).toBeInTheDocument();
  });

  it('flags a value the model never saw', async () => {
    renderModal();

    const field = screen.getByRole('spinbutton', { name: 'duration_minutes' });
    await userEvent.clear(field);
    await userEvent.type(field, '9000');

    expect(screen.getByText(/Outside what the model saw in training/)).toBeInTheDocument();
  });

  it('sends the form as one row in input order and shows how sure the model is', async () => {
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));

    await waitFor(() =>
      expect(predict).toHaveBeenCalledWith('encounter-class-classifier', { data: [[30, 130]] }),
    );
    const answer = await screen.findByRole('region', { name: 'Answer' });
    expect(within(answer).getByText('emergency', { selector: 'span.text-base' })).toBeInTheDocument();
    expect(within(answer).getByText('85% sure')).toBeInTheDocument();
    expect(within(answer).getByRole('list', { name: 'Probability per class' })).toHaveTextContent('85.0%');
  });

  it('will not send a form with an empty input', async () => {
    renderModal();

    await userEvent.clear(screen.getByRole('spinbutton', { name: 'base_cost' }));

    expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled();
  });

  it('says what each input is, what the model predicts and what the answers mean', () => {
    renderModal(
      model({
        ...CARD,
        inputs: [
          { ...CARD.inputs![0], description: 'How long the encounter lasted', unit: 'min' },
          CARD.inputs![1],
        ],
        target: { name: 'encounter_class', description: 'The kind of encounter' },
        class_notes: { inpatient: 'Admitted overnight' },
      }),
    );

    expect(screen.getByText('How long the encounter lasted')).toBeInTheDocument();
    expect(screen.getByText('min')).toBeInTheDocument();
    expect(screen.getByText(/The kind of encounter/)).toBeInTheDocument();
    expect(screen.getByText('Admitted overnight')).toBeInTheDocument();
  });

  it('spells out the request, position by position, for calling it from code', () => {
    renderModal();

    const api = screen.getByRole('group', { name: 'API' });
    const rows = within(api).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      '0duration_minutesnumber1 – 6,596',
      '1base_costnumber12 – 14,650',
    ]);
    expect(api).toHaveTextContent('/models/encounter-class-classifier/predict');
    expect(api).toHaveTextContent('one of ambulatory, emergency, inpatient, virtual');
    expect(api).toHaveTextContent(`-d '{"data":[[30,130]]}'`);
  });

  it('falls back to raw JSON, and says how to get the guide, for a model without a card', () => {
    renderModal(model({}));

    expect(screen.queryByRole('region', { name: 'Inputs' })).not.toBeInTheDocument();
    expect(screen.getByText(/TRAINING_FEATURES_PATH/)).toBeInTheDocument();
    expect(screen.getByLabelText('JSON payload')).toBeInTheDocument();
  });
});
