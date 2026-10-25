import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import EmbeddedDashboard, { unframeableReason } from '../../src/components/EmbeddedDashboard';
import type { DashboardEmbed } from '../../src/types';

const getDashboardEmbed = vi.fn();
const embedDashboard = vi.fn();
const unmount = vi.fn();

vi.mock('../../src/api/client', () => ({
  getDashboardEmbed: (...args: unknown[]) => getDashboardEmbed(...args),
}));

vi.mock('@superset-ui/embedded-sdk', () => ({
  embedDashboard: (...args: unknown[]) => embedDashboard(...args),
}));

const EMBED: DashboardEmbed = {
  dashboard_id: 7,
  uuid: 'emb-uuid',
  superset_domain: 'http://localhost:8088',
  token: 'first-token',
};

function renderEmbed(version = 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EmbeddedDashboard projectId={4} version={version} />
    </QueryClientProvider>,
  );
}

/** The options the component handed the SDK on its most recent call. */
function lastOptions() {
  return embedDashboard.mock.calls.at(-1)![0] as {
    id: string;
    supersetDomain: string;
    mountPoint: HTMLElement;
    fetchGuestToken: () => Promise<string>;
  };
}

describe('EmbeddedDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDashboardEmbed.mockResolvedValue(EMBED);
    embedDashboard.mockResolvedValue({ unmount });
  });

  it('hands the SDK the embedded uuid, not the dashboard id', async () => {
    // The embedded configuration has an id of its own. Passing the dashboard
    // id is the mistake that frames an error page instead of a dashboard.
    renderEmbed();
    await waitFor(() => expect(embedDashboard).toHaveBeenCalled());

    expect(lastOptions().id).toBe('emb-uuid');
    expect(lastOptions().supersetDomain).toBe('http://localhost:8088');
  });

  it('mounts into its own node', async () => {
    renderEmbed();
    await waitFor(() => expect(embedDashboard).toHaveBeenCalled());

    expect(lastOptions().mountPoint).toBe(screen.getByTestId('dashboard-mount'));
  });

  it('uses the token it already has before asking for another', async () => {
    renderEmbed();
    await waitFor(() => expect(embedDashboard).toHaveBeenCalled());
    const fetchGuestToken = lastOptions().fetchGuestToken;

    expect(await fetchGuestToken()).toBe('first-token');
    expect(getDashboardEmbed).toHaveBeenCalledTimes(1);
  });

  it('asks for a fresh token when the SDK wants to refresh', async () => {
    // The SDK calls this again shortly before the token expires.
    renderEmbed();
    await waitFor(() => expect(embedDashboard).toHaveBeenCalled());
    const fetchGuestToken = lastOptions().fetchGuestToken;
    await fetchGuestToken();

    getDashboardEmbed.mockResolvedValue({ ...EMBED, token: 'fresh-token' });
    expect(await fetchGuestToken()).toBe('fresh-token');
  });

  it('shows nothing before a dashboard has been built', async () => {
    // Not built yet is the ordinary state before the first prompt.
    getDashboardEmbed.mockRejectedValue(new Error('404'));
    const { container } = renderEmbed();

    await waitFor(() => expect(getDashboardEmbed).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(embedDashboard).not.toHaveBeenCalled();
  });

  it('says so when the dashboard exists but could not be shown', async () => {
    embedDashboard.mockRejectedValue(new Error('refused to frame'));
    renderEmbed();

    expect(await screen.findByText(/could not be shown here: refused to frame/)).toBeInTheDocument();
  });

  it('takes the iframe down when it goes away', async () => {
    const { unmount: unmountComponent } = renderEmbed();
    await waitFor(() => expect(embedDashboard).toHaveBeenCalled());
    await Promise.resolve();

    unmountComponent();
    await waitFor(() => expect(unmount).toHaveBeenCalled());
  });

  it('names the refusal instead of framing a page the browser will blank', async () => {
    getDashboardEmbed.mockResolvedValue({ ...EMBED, superset_domain: 'superset' });
    renderEmbed();

    expect(await screen.findByText(/address is not a URL/)).toBeInTheDocument();
    expect(embedDashboard).not.toHaveBeenCalled();
  });

  it('embeds afresh when a later exchange may have changed it', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <EmbeddedDashboard projectId={4} version={1} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(embedDashboard).toHaveBeenCalledTimes(1));

    rerender(
      <QueryClientProvider client={client}>
        <EmbeddedDashboard projectId={4} version={2} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(embedDashboard).toHaveBeenCalledTimes(2));
  });
});

describe('unframeableReason', () => {
  const app = { protocol: 'https:', hostname: 'app.kubeflowia.site' };

  it('refuses plain HTTP inside an HTTPS page', () => {
    // The production failure: the default address, framed by the real site.
    expect(unframeableReason('http://localhost:8088', app)).toMatch(/over plain HTTP/);
  });

  it('refuses localhost when the page is not on that machine', () => {
    const remote = { protocol: 'http:', hostname: 'app.kubeflowia.site' };
    expect(unframeableReason('http://localhost:8088', remote)).toMatch(/only exists on the machine/);
  });

  it('lets a published HTTPS Superset through', () => {
    expect(unframeableReason('https://superset.kubeflowia.site', app)).toBeNull();
  });

  it('lets localhost through when the page is local too', () => {
    // Compose on one machine: both ends really are on localhost.
    const local = { protocol: 'http:', hostname: 'localhost' };
    expect(unframeableReason('http://localhost:8088', local)).toBeNull();
  });
});
