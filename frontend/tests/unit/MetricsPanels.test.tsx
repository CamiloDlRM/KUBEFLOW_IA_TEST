import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import MetricsPanels, { dashboardHeight } from '../../src/components/MetricsPanels';

const API_BASE = 'http://api.test';

vi.mock('../../src/api/client', () => ({
  API_BASE: 'http://api.test',
  TOKEN_KEY: 'mlops_token',
}));

const useAuthMock = vi.fn();
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

function renderPage({ isAdmin = false } = {}) {
  useAuthMock.mockReturnValue({ isAdmin });
  return render(
    <MemoryRouter>
      <MetricsPanels />
    </MemoryRouter>,
  );
}

describe('MetricsPanels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The page primes the Grafana proxy session cookie before mounting the
    // iframe - stub it so the iframe renders synchronously in tests.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          embed_url: '/grafana/embed?ticket=tkt-123&uid=mlops-ml&kiosk=1&theme=dark',
        }),
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('embeds the mlops-ml dashboard through the backend proxy', async () => {
    renderPage();

    // "Model metrics", not "Dashboards": the app has one dashboard, and this
    // is a section of it.
    expect(screen.getByRole('heading', { name: 'Model metrics' })).toBeInTheDocument();

    const frame = await screen.findByTitle('Grafana dashboard: My Models');
    expect(frame).toHaveAttribute(
      'src',
      `${API_BASE}/grafana/d/mlops-ml/?kiosk&theme=dark&refresh=30s&from=now-30d&to=now`,
    );
  });

  it('asks the backend to issue the proxy session cookie first', async () => {
    renderPage();
    await screen.findByTitle('Grafana dashboard: My Models');

    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/grafana/session?kiosk=true&theme=dark`,
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('hides the platform dashboard from non-admin users', async () => {
    renderPage({ isAdmin: false });
    await screen.findByTitle('Grafana dashboard: My Models');

    expect(screen.queryByRole('button', { name: 'Platform' })).not.toBeInTheDocument();
  });

  it('lets admins switch to the platform dashboard', async () => {
    renderPage({ isAdmin: true });
    await screen.findByTitle('Grafana dashboard: My Models');

    await userEvent.click(screen.getByRole('button', { name: 'Platform' }));

    const frame = await screen.findByTitle('Grafana dashboard: Platform');
    expect(frame).toHaveAttribute(
      'src',
      `${API_BASE}/grafana/d/mlops-ops/?kiosk&theme=dark&refresh=30s&from=now-30d&to=now`,
    );
  });

  it('hides the resources dashboard from non-admin users', async () => {
    // CPU and memory of every container is the whole platform, not a tenant's.
    renderPage({ isAdmin: false });
    await screen.findByTitle('Grafana dashboard: My Models');

    expect(screen.queryByRole('button', { name: 'Resources' })).not.toBeInTheDocument();
  });

  it('lets admins see what the server and every container are using', async () => {
    renderPage({ isAdmin: true });
    await screen.findByTitle('Grafana dashboard: My Models');

    await userEvent.click(screen.getByRole('button', { name: 'Resources' }));

    const frame = await screen.findByTitle('Grafana dashboard: Resources');
    expect(frame).toHaveAttribute(
      'src',
      `${API_BASE}/grafana/d/mlops-resources/?kiosk&theme=dark&refresh=30s&from=now-30d&to=now`,
    );
  });

  it('shows an actionable error and a retry when the embed never loads', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderPage();
    await screen.findByTitle('Grafana dashboard: My Models');

    // Grafana is unreachable: the iframe hangs and the watchdog fires.
    act(() => {
      vi.advanceTimersByTime(21_000);
    });

    expect(
      await screen.findByText(/Could not load the Grafana dashboard/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/docker compose up -d grafana prometheus/)).toBeInTheDocument();

    // Retry re-primes the session and falls back to the ticket bootstrap,
    // which sets the proxy cookie from inside the frame.
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    const retried = await screen.findByTitle('Grafana dashboard: My Models');
    expect(retried).toHaveAttribute(
      'src',
      `${API_BASE}/grafana/embed?ticket=tkt-123&uid=mlops-ml&kiosk=1&theme=dark`,
    );

    vi.useRealTimers();
  });
});

describe('dashboardHeight', () => {
  it('adds up the grid rows the lowest panel reaches, with the gaps and kiosk padding', () => {
    // Bottom at row 10: 10 rows of 30px, 9 gaps of 8px, 48px of padding.
    expect(dashboardHeight([{ gridPos: { y: 0, h: 4 } }, { gridPos: { y: 4, h: 6 } }])).toBe(300 + 72 + 48);
  });

  it('knows nothing about a dashboard with no panels', () => {
    expect(dashboardHeight([])).toBeNull();
  });
});

describe('the Grafana frame', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is as tall as the dashboard, so the page scrolls instead of the frame', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => ({
        ok: true,
        json: async () =>
          url.includes('/api/dashboards/uid/')
            ? { dashboard: { panels: [{ gridPos: { y: 0, h: 10 } }] } }
            : { embed_url: '/grafana/embed?ticket=t&uid=mlops-ml' },
      })),
    );
    renderPage();

    const frame = await screen.findByTitle('Grafana dashboard: My Models');
    await waitFor(() => expect(frame).toHaveStyle({ height: '420px' }));
    expect(frame).toHaveAttribute('scrolling', 'no');
  });
});

describe('Open in Grafana', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is offered to admins only', async () => {
    const { unmount } = renderPage({ isAdmin: false });
    await screen.findByTitle('Grafana dashboard: My Models');
    expect(screen.queryByRole('link', { name: /Open in Grafana/i })).not.toBeInTheDocument();
    unmount();

    renderPage({ isAdmin: true });
    await screen.findByTitle('Grafana dashboard: My Models');
    expect(screen.getByRole('link', { name: /Open in Grafana/i })).toBeInTheDocument();
  });
});
