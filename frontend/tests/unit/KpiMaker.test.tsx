import { render, screen, waitFor, within } from '@testing-library/react';
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
  getDashboardEmbed: () => Promise.reject(new Error('not under test here')),
}));

// The embedded dashboard has its own tests; here it is only a marker for
// whether the KPI maker decided there was something to show.
vi.mock('../../src/components/EmbeddedDashboard', () => ({
  default: ({ version }: { version: number }) => (
    <div data-testid="embedded-dashboard">embedded v{version}</div>
  ),
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
    // Said in words, with what it acted on; the raw call one click further.
    const step = screen.getByRole('button', { name: /Created a chart/ });
    expect(step).toHaveTextContent('“By class”');
    expect(step).toHaveTextContent('create_chart');
    expect(screen.queryByText(/chart 3/)).toBeNull();

    await userEvent.click(step);
    expect(screen.getByText(/chart 3/)).toBeInTheDocument();
  });

  it('marks a step that failed, and counts the failures', async () => {
    renderMaker(
      conversation({
        turns: [
          turn({
            calls: [
              { name: 'generate_chart', arguments: { chart_name: 'Cost' }, result: '{"error": "validation_system_error"}' },
              { name: 'generate_chart', arguments: { chart_name: 'Count' }, result: '{"chart_id": 5}' },
            ],
          }),
        ],
      }),
    );

    const toggle = await screen.findByRole('button', { name: /2 calls to Superset/ });
    expect(toggle).toHaveTextContent('1 failed');
    expect(toggle).toHaveTextContent('made 1 chart');

    await userEvent.click(toggle);
    expect(within(screen.getByRole('button', { name: /“Cost”/ })).getByLabelText('failed')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /“Count”/ })).getByLabelText('done')).toBeInTheDocument();
  });

  it('renders the answer’s formatting instead of showing its markup', async () => {
    renderMaker(conversation({ turns: [turn({ summary: 'Built **two** charts:\n\n- by class\n- by month' })] }));

    expect(await screen.findByText('two', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('by month')).toBeInTheDocument();
    expect(screen.queryByText(/\*\*two\*\*/)).toBeNull();
  });

  it('sends on Enter and keeps Shift+Enter for a new line', async () => {
    renderMaker();
    askForDashboard.mockResolvedValue(conversation({ turns: [turn({ prompt: 'cost', summary: 'Done.' })] }));

    const box = await screen.findByLabelText(/What should the dashboard show/);
    await userEvent.type(box, 'cost{Shift>}{Enter}{/Shift}per month');
    expect(askForDashboard).not.toHaveBeenCalled();
    expect(box).toHaveValue('cost\nper month');

    await userEvent.type(box, '{Enter}');
    expect(askForDashboard).toHaveBeenCalledWith(4, 'cost\nper month');
  });

  it('shows what was asked at once, before the answer arrives', async () => {
    renderMaker();
    askForDashboard.mockReturnValue(new Promise(() => {}));

    await userEvent.type(await screen.findByRole('textbox'), 'margin by ward{Enter}');

    expect(await screen.findByText('margin by ward')).toBeInTheDocument();
    expect(screen.getByText(/Working in Superset/)).toBeInTheDocument();
  });

  it('offers a first prompt to start from, without sending it', async () => {
    renderMaker();

    await userEvent.click(await screen.findByRole('button', { name: 'Encounters per month, split by class' }));

    expect(screen.getByLabelText(/What should the dashboard show/)).toHaveValue('Encounters per month, split by class');
    expect(askForDashboard).not.toHaveBeenCalled();
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
    // What was typed comes back, so it can be sent again.
    expect(screen.getByRole('textbox')).toHaveValue('anything');
  });

  it('shows the dashboard once an exchange has built something', async () => {
    renderMaker(
      conversation({
        turns: [
          turn({ id: 3, calls: [{ name: 'generate_dashboard', arguments: {}, result: '{}' }] }),
        ],
      }),
    );

    expect(await screen.findByTestId('embedded-dashboard')).toHaveTextContent('embedded v3');
  });

  it('shows no dashboard while nothing has called Superset', async () => {
    // An exchange that made no calls built nothing; there is nothing to frame.
    renderMaker(conversation({ turns: [turn({ calls: [] })] }));

    await screen.findByText('encounters by class');
    expect(screen.queryByTestId('embedded-dashboard')).toBeNull();
  });

  it('frames the dashboard from the latest exchange that built something', async () => {
    renderMaker(
      conversation({
        turns: [
          turn({ id: 1, calls: [{ name: 'generate_dashboard', arguments: {}, result: '{}' }] }),
          turn({ id: 2, prompt: 'make it a line', calls: [{ name: 'update_chart', arguments: {}, result: '{}' }] }),
          turn({ id: 3, prompt: 'thanks', calls: [] }),
        ],
      }),
    );

    expect(await screen.findByTestId('embedded-dashboard')).toHaveTextContent('embedded v2');
  });
});

