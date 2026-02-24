import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import RepoCard from '../../src/components/RepoCard';
import type { Repository, Pipeline } from '../../src/types';

const mockRepo: Repository = {
  id: 1,
  github_url: 'https://github.com/testuser/ml-project',
  github_token_masked: '****abcd',
  branch: 'main',
  notebook_path: 'notebooks/train.ipynb',
  webhook_id: 12345,
  webhook_url: 'http://localhost:3000/api/webhook/github',
  created_at: '2026-02-23T10:00:00Z',
  is_active: true,
};

const mockPipeline: Pipeline = {
  id: 'pipeline-uuid-001',
  repo_id: 1,
  status: 'success',
  commit_sha: 'abc123def456',
  started_at: '2026-02-23T10:05:00Z',
  finished_at: '2026-02-23T10:10:00Z',
  phases: [],
  metrics: { accuracy: 0.95 },
};

function renderCard(
  repo = mockRepo,
  latestPipeline?: Pipeline,
  onDelete = vi.fn(),
) {
  return render(
    <MemoryRouter>
      <RepoCard repo={repo} latestPipeline={latestPipeline} onDelete={onDelete} />
    </MemoryRouter>,
  );
}

describe('RepoCard', () => {
  it('extracts and displays repo name from github url', () => {
    renderCard();

    // repoNameFromUrl("https://github.com/testuser/ml-project") => "testuser/ml-project"
    expect(screen.getByText('testuser/ml-project')).toBeInTheDocument();
  });

  it('shows pipeline status badge when pipeline exists', () => {
    renderCard(mockRepo, mockPipeline);

    expect(screen.getByText('success')).toBeInTheDocument();
  });

  it('shows no pipelines message when no pipeline provided', () => {
    renderCard(mockRepo, undefined);

    expect(screen.getByText('No pipelines yet')).toBeInTheDocument();
  });

  it('calls onDelete when delete button is clicked', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();

    renderCard(mockRepo, undefined, onDelete);

    const deleteBtn = screen.getByTitle('Delete repository');
    await user.click(deleteBtn);

    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it('displays branch and notebook path', () => {
    renderCard();

    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('notebooks/train.ipynb')).toBeInTheDocument();
  });

  it('shows view latest pipeline link when pipeline exists', () => {
    renderCard(mockRepo, mockPipeline);

    const link = screen.getByText('View latest pipeline');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/pipelines/pipeline-uuid-001');
  });

  it('does not show view latest pipeline link when no pipeline', () => {
    renderCard(mockRepo, undefined);

    expect(screen.queryByText('View latest pipeline')).not.toBeInTheDocument();
  });
});
