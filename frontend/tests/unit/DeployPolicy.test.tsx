import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DeployPolicyPanel, { describePolicy } from '../../src/components/DeployPolicyPanel';
import RunPipelineModal, { parameterProblem, parseParameterValue } from '../../src/components/RunPipelineModal';
import type { Project, RunSettings } from '../../src/types';

const api = {
  getRunSettings: vi.fn(),
  setDeployPolicy: vi.fn(),
  runProject: vi.fn(),
  getPipelineInput: vi.fn(),
};

vi.mock('../../src/api/client', () => ({
  getRunSettings: (...args: unknown[]) => api.getRunSettings(...args),
  setDeployPolicy: (...args: unknown[]) => api.setDeployPolicy(...args),
  runProject: (...args: unknown[]) => api.runProject(...args),
  getPipelineInput: (...args: unknown[]) => api.getPipelineInput(...args),
}));

const SETTINGS: RunSettings = {
  policy: { auto_deploy: true, metric: 'accuracy', threshold: 0.8, direction: 'higher', must_beat_serving: false },
  is_default: true,
  metrics_available: ['accuracy', 'recall'],
  last_parameters: { N_ESTIMATORS: 300, BALANCED: true },
};

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getRunSettings.mockResolvedValue(SETTINGS);
  api.getPipelineInput.mockResolvedValue({ choice: {}, resolved: null, error: '' });
  api.runProject.mockResolvedValue({ status: 'queued', pipeline_id: 'run-9' });
});

describe('describePolicy', () => {
  it('reads as a sentence', () => {
    expect(describePolicy(SETTINGS.policy)).toBe('Deploys when accuracy ≥ 0.8.');
    expect(
      describePolicy({ ...SETTINGS.policy, metric: 'rmse', direction: 'lower', threshold: 10, must_beat_serving: true }),
    ).toBe('Deploys when rmse ≤ 10 and it beats the version serving now.');
    expect(describePolicy({ ...SETTINGS.policy, auto_deploy: false })).toMatch(/Never deploys on its own/);
  });
});

describe('DeployPolicyPanel', () => {
  it('saves only what was changed into the rules', async () => {
    api.setDeployPolicy.mockImplementation(async (_id, changes) => ({
      ...SETTINGS,
      is_default: false,
      policy: changes,
    }));
    wrap(<DeployPolicyPanel projectId={4} />);

    const metric = await screen.findByRole('combobox', { name: 'Metric' });
    await userEvent.clear(metric);
    await userEvent.type(metric, 'recall');
    await userEvent.click(screen.getByRole('checkbox', { name: /beat the version serving now/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save rules' }));

    await waitFor(() =>
      expect(api.setDeployPolicy).toHaveBeenCalledWith(4, {
        auto_deploy: true,
        metric: 'recall',
        threshold: 0.8,
        direction: 'higher',
        must_beat_serving: true,
      }),
    );
    expect(await screen.findByText('Deploys when recall ≥ 0.8 and it beats the version serving now.')).toBeInTheDocument();
  });

  it('turning auto-deploy off disables the bar it no longer uses', async () => {
    wrap(<DeployPolicyPanel projectId={4} />);

    await userEvent.click(await screen.findByRole('checkbox', { name: /Deploy automatically/ }));

    expect(screen.getByRole('spinbutton', { name: 'Bar' })).toBeDisabled();
  });

  it('says what asking to beat the serving version costs, only once it is asked', async () => {
    wrap(<DeployPolicyPanel projectId={4} />);
    const beat = await screen.findByRole('checkbox', { name: /beat the version serving now/ });
    expect(screen.queryByText(/can only beat a version it can be compared with/)).not.toBeInTheDocument();

    await userEvent.click(beat);

    expect(screen.getByText(/can only beat a version it can be compared with/)).toBeInTheDocument();
  });

  it('can go back to the platform default', async () => {
    api.getRunSettings.mockResolvedValue({ ...SETTINGS, is_default: false });
    api.setDeployPolicy.mockResolvedValue(SETTINGS);
    wrap(<DeployPolicyPanel projectId={4} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Back to platform default' }));

    expect(api.setDeployPolicy).toHaveBeenCalledWith(4, { reset: true });
  });
});

describe('training parameters', () => {
  it('are typed the way a notebook would read them', () => {
    expect(parseParameterValue('300')).toBe(300);
    expect(parseParameterValue('0.05')).toBe(0.05);
    expect(parseParameterValue('1e-3')).toBe(0.001);
    expect(parseParameterValue('true')).toBe(true);
    expect(parseParameterValue('gini')).toBe('gini');
  });

  it('are refused with the reason the backend would give', () => {
    expect(parameterProblem([{ name: 'max-depth', value: '3' }])).toMatch(/not a usable name/);
    expect(parameterProblem([{ name: 'DATASET_PATH', value: 'x' }])).toBe('DATASET_PATH is set by the platform.');
    expect(parameterProblem([{ name: 'A', value: '1' }, { name: 'A', value: '2' }])).toBe('A appears twice.');
    expect(parameterProblem([{ name: 'N', value: '1' }])).toBeNull();
  });
});

describe('RunPipelineModal', () => {
  const PROJECT = {
    id: 4,
    name: 'Encounters',
    deployed_model: 'encounters',
    repository: { id: 9, github_url: 'https://github.com/acme/train', branch: 'main', notebook_path: 'train.ipynb' },
    active_dataset: null,
  } as unknown as Project;

  it('starts from the last run’s parameters and sends them typed', async () => {
    const started = vi.fn();
    wrap(<RunPipelineModal project={PROJECT} onClose={() => {}} onStarted={started} />);

    expect(await screen.findByDisplayValue('N_ESTIMATORS')).toBeInTheDocument();
    expect(screen.getByText('Deploys when accuracy ≥ 0.8.')).toBeInTheDocument();

    await userEvent.clear(screen.getByRole('textbox', { name: 'Parameter 1 value' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Parameter 1 value' }), '500');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() =>
      expect(api.runProject).toHaveBeenCalledWith(4, 'encounters', { N_ESTIMATORS: 500, BALANCED: true }),
    );
    expect(started).toHaveBeenCalledWith('run-9');
  });

  it('will not run with a parameter the platform owns', async () => {
    wrap(<RunPipelineModal project={PROJECT} onClose={() => {}} />);
    await screen.findByDisplayValue('N_ESTIMATORS');

    await userEvent.click(screen.getByRole('button', { name: '+ Add a parameter' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Parameter 3 name' }), 'MODEL_OUTPUT_PATH');

    expect(screen.getByText('MODEL_OUTPUT_PATH is set by the platform.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });
});
