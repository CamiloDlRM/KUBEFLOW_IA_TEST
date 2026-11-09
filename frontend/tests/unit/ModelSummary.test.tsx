import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ModelSummary } from '../../src/components/canvas/NodeDetail';
import type { Pipeline } from '../../src/types';

function run(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'run-1',
    repo_id: 9,
    project_id: 4,
    status: 'success',
    commit_sha: 'abc',
    branch: 'main',
    started_at: '2026-10-01T00:00:00Z',
    finished_at: '2026-10-01T00:05:00Z',
    phases: [
      { name: 'register', status: 'success', timestamp: 't', logs: 'Model registered in MLflow run acd8d8c223334cda8d9f4270bb4c2596. Accuracy: 0.9667' },
      { name: 'deploy', status: 'success', timestamp: 't', logs: 'Model deployed successfully. Endpoint: http://model-server:8001/predict/ejemplo2' },
    ],
    metrics: { accuracy: 0.9667, f1: 0.95, deployed: true },
    owner_username: null,
    model_name: 'ejemplo2',
    model_version: '3',
    ...overrides,
  };
}

describe('ModelSummary', () => {
  it('lays out the registration and the deployment instead of their raw log lines', () => {
    render(<ModelSummary run={run()} />);

    expect(screen.getByText('ejemplo2')).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();
    expect(screen.getByText('96.67%')).toBeInTheDocument();
    // The MLflow run id means nothing to most users, so it is not shown.
    expect(screen.queryByText('acd8d8c223334cda8d9f4270bb4c2596')).not.toBeInTheDocument();
    expect(screen.getByText('http://model-server:8001/predict/ejemplo2')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('f1')).toBeInTheDocument();
    expect(screen.queryByText(/Model registered in MLflow run/)).not.toBeInTheDocument();
  });

  it('says why a run was not deployed', () => {
    render(
      <ModelSummary
        run={run({
          phases: [run().phases[0]],
          metrics: { accuracy: 0.7, deploy_reason: 'accuracy 0.7000 is below the 0.8 threshold' },
        })}
      />,
    );

    expect(screen.getByText('Not deployed')).toBeInTheDocument();
    expect(screen.getByText(/below the 0.8 threshold/)).toBeInTheDocument();
  });
});
