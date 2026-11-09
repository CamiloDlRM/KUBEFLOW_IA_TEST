import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import NotFound from '../../src/pages/NotFound';
import MaiaEmptyState from '../../src/components/MaiaEmptyState';
import MaiaSays from '../../src/components/MaiaSays';

vi.mock('../../src/api/client', () => ({}));

describe('Maia around the app', () => {
  it('is sad on an address the app does not know, and offers the way back', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/no/such/page']}>
        <NotFound />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /could not find this page/i })).toBeInTheDocument();
    expect(screen.getByText('/no/such/page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Dashboard/ })).toHaveAttribute('href', '/');
    expect(container.querySelector('svg.maia')).toHaveClass('maia-sad');
  });

  it('says what is missing on an empty page, and links to the next step', () => {
    const { container } = render(
      <MemoryRouter>
        <MaiaEmptyState action={{ to: '/projects', label: 'Go to projects' }}>No pipelines have run yet.</MaiaEmptyState>
      </MemoryRouter>,
    );

    expect(screen.getByText('No pipelines have run yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to projects' })).toHaveAttribute('href', '/projects');
    expect(container.querySelector('svg.maia')).not.toBeNull();
  });

  it('speaks for the AI features in the mood of what she says', () => {
    const { container } = render(<MaiaSays mood="sad">The query could not be written.</MaiaSays>);

    expect(screen.getByText('The query could not be written.')).toBeInTheDocument();
    expect(container.querySelector('svg.maia')).toHaveClass('maia-sad');
  });
});
