import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import KpiMaker from '../../src/components/KpiMaker';
import type { DashboardConversation, DashboardTurn } from '../../src/types';

const getDashboardConversation = vi.fn();
const askForDashboard = vi.fn();

vi.mock('../../src/api/client', () => ({
  getDashboardConversation: (...args: unknown[]) => getDashboardConversation(...args),
  askForDashboard: (...args: unknown[]) => askForDashboard(...args),
}));

function turn(overrides: Partial<DashboardTurn> = {}): DashboardTurn {
  return {
    id: 1,
    prompt: 'encounters by class',
    summary: 'Built a dashboard with two charts.',
    calls: [],
    turns: 3,
    exhausted: false,
    created_at: '2026-09-22T10:00:00Z',
    ...overrides,
  };
}

function conversation(overrides: Partial<DashboardConversation> = {}): DashboardConversation {
  return { turns: [], superset_url: 'http://localhost:8088', ...overrides };
}

function renderMaker(data = conversation()) {
  getDashboardConversation.mockResolvedValue(data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <KpiMaker projectId={4} />
    </QueryClientProvider>,
  );
}

describe('KpiMaker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invites a first prompt when nothing has been asked', async () => {
    renderMaker();
    expect(await screen.findByText(/Nothing asked for yet/)).toBeInTheDocument();
  });

  it('shows what was asked and what the agent answered', async () => {
    renderMaker(conversation({ turns: [turn()] }));

    expect(await screen.findByText('encounters by class')).toBeInTheDocument();
    expect(screen.getByText('Built a dashboard with two charts.')).toBeInTheDocument();
  });

  it('sends a prompt and shows the exchange that comes back', async () => {
    renderMaker();
    askForDashboard.mockResolvedValue(
      conversation({ turns: [turn({ prompt: 'cost per month', summary: 'Done.' })] }),
    );

    await userEvent.type(
      await screen.findByLabelText(/What should the dashboard show/),
      'cost per month',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

    expect(await screen.findByText('cost per month')).toBeInTheDocument();
    expect(askForDashboard).toHaveBeenCalledWith(4, 'cost per month');
  });

  it('asks what should change once there is something to change', async () => {
    // The second prompt is an edit, not a new request, and the label is where
    // that is said.
    renderMaker(conversation({ turns: [turn()] }));

    expect(await screen.findByLabelText(/What should change/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('will not send an empty prompt', async () => {
    renderMaker();
    expect(await screen.findByRole('button', { name: 'Build it' })).toBeDisabled();
  });

  it('says it is working, because the wait is long enough to look like a hang', async () => {
    renderMaker();
    let release!: (value: DashboardConversation) => void;
    askForDashboard.mockReturnValue(
      new Promise<DashboardConversation>((resolve) => {
        release = resolve;
      }),
    );

    await userEvent.type(await screen.findByRole('textbox'), 'anything');
    await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

    expect(await screen.findByText(/Working in Superset/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Build it' })).toBeDisabled();

    release(conversation({ turns: [turn()] }));
    await waitFor(() => expect(screen.queryByText(/Working in Superset/)).toBeNull());
  });

  it('keeps what the agent did, foldable, under what it said', async () => {
    // When a dashboard comes out wrong, the sequence of calls is the only
    // account of why that does not come from the model itself.
    renderMaker(
      conversation({
        turns: [
          turn({
            calls: [
              { name: 'create_chart', arguments: { title: 'By class' }, result: 'chart 3' },
            ],
          }),
        ],
      }),
    );

    const toggle = await screen.findByRole('button', { name: /1 call to Superset/ });
    expect(screen.queryByText('create_chart')).toBeNull();

    await userEvent.click(toggle);
    expect(screen.getByText('create_chart')).toBeInTheDocument();
    expect(screen.getByText(/chart 3/)).toBeInTheDocument();
  });

  it('warns when the agent ran out of turns, because the dashboard is half-built', async () => {
    renderMaker(conversation({ turns: [turn({ exhausted: true })] }));
    expect(await screen.findByText(/ran out of turns/)).toBeInTheDocument();
  });

  it('links to Superset so the result can be looked at', async () => {
    renderMaker(conversation({ turns: [turn()] }));

    const link = await screen.findByRole('link', { name: /Open Superset/ });
    expect(link).toHaveAttribute('href', 'http://localhost:8088');
  });

  it('offers no link when Superset is not configured', async () => {
    renderMaker(conversation({ superset_url: '' }));
    await screen.findByText(/Nothing asked for yet/);
    expect(screen.queryByRole('link', { name: /Open Superset/ })).toBeNull();
  });

  it('surfaces a failure instead of swallowing it', async () => {
    renderMaker();
    askForDashboard.mockRejectedValue(new Error('Superset is not configured'));

    await userEvent.type(await screen.findByRole('textbox'), 'anything');
    await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

    expect(await screen.findByText(/Superset is not configured/)).toBeInTheDocument();
  });
});
