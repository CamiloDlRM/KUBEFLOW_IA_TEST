import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import Dashboards from '../../src/pages/Dashboards';

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
      <Dashboards />
    </MemoryRouter>,
  );
}

describe('Dashboards page', () => {
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

    expect(screen.getByRole('heading', { name: 'Dashboards' })).toBeInTheDocument();

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
