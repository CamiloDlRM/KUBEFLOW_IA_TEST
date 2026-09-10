import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE, TOKEN_KEY } from '../api/client';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';

/* ------------------------------------------------------------------ */
/*  Grafana embed configuration                                        */
/* ------------------------------------------------------------------ */

/**
 * Grafana is *not* reached directly: the backend exposes it under `/grafana`
 * and acts as an authenticated reverse proxy (it validates the JWT / session
 * and tells Grafana which user is browsing). So the embed URL is built from
 * the very same base URL the API client uses.
 */
const GRAFANA_BASE = `${API_BASE.replace(/\/+$/, '')}/grafana`;

/** How long we wait for the iframe to load before assuming Grafana is down. */
const LOAD_TIMEOUT_MS = 20_000;

interface DashboardTab {
  uid: string;
  label: string;
  blurb: string;
  /** Operational dashboards are only meaningful (and visible) for admins. */
  adminOnly: boolean;
}

const DASHBOARD_TABS: DashboardTab[] = [
  {
    uid: 'mlops-ml',
    label: 'My Models',
    blurb: 'Training runs, accuracy and inference traffic for the models you own.',
    adminOnly: false,
  },
  {
    uid: 'mlops-ops',
    label: 'Platform',
    blurb: 'Cluster-wide health of the MLOps platform services.',
    adminOnly: true,
  },
];

/**
 * Builds the embeddable dashboard URL.
 *
 * `kiosk` hides Grafana's own chrome (nav bar, side menu) so the panel blends
 * into the app, `theme=dark` matches our slate palette and `refresh=30s` is
 * what makes the metrics update in near real time.
 *
 * The query string is assembled by hand instead of with `URLSearchParams`
 * because `kiosk` is a valueless flag (`?kiosk`, not `?kiosk=`).
 */
export function buildGrafanaEmbedUrl(uid: string): string {
  const query = ['kiosk', 'theme=dark', 'refresh=30s', 'from=now-30d', 'to=now'].join('&');
  return `${GRAFANA_BASE}/d/${uid}/?${query}`;
}

/**
 * Fallback entry point: instead of loading the dashboard directly, the iframe
 * hits the backend's `/grafana/embed` bootstrap with a single-use ticket. The
 * backend then sets the session cookie *inside the frame* and redirects to the
 * dashboard, which is what makes the embed work when the SPA and the API are
 * on different sites (a `SameSite=Lax` cookie primed by `fetch` would not be
 * sent with the iframe request there).
 *
 * The redirect only carries `kiosk`/`theme`, so the time range and refresh
 * interval fall back to whatever the dashboard has saved - that is why this is
 * used as a retry, not as the primary URL.
 */
export function buildGrafanaBootstrapUrl(uid: string, ticket: string): string {
  const query = new URLSearchParams({ ticket, uid, kiosk: '1', theme: 'dark' });
  return `${GRAFANA_BASE}/embed?${query.toString()}`;
}

/* ------------------------------------------------------------------ */
/*  Iframe authentication                                              */
/* ------------------------------------------------------------------ */

/**
 * An <iframe> cannot carry the `Authorization` header the axios client adds,
 * so the JWT can't travel with the embed request. The backend proxy therefore
 * issues a short-lived **session cookie** for `/grafana`, and the browser
 * sends that cookie with every iframe / panel / datasource request.
 *
 * This helper "primes" that cookie before the iframe is mounted: it POSTs to
 * the proxy with the bearer token we do have and asks it to set the cookie
 * (`credentials: 'include'` so the Set-Cookie is stored). The response also
 * carries a single-use `embed_url` ticket, kept here for the retry path in
 * `buildGrafanaBootstrapUrl`.
 *
 * It is deliberately tiny and forgiving so it is easy to keep aligned with the
 * backend proxy:
 *   - change `SESSION_ENDPOINT` if the route moves;
 *   - any non-2xx (endpoint missing, integration disabled, proxy
 *     authenticating some other way) is NOT fatal - we still render the iframe
 *     and let the load/timeout handling below decide what the user sees.
 *
 * NOTE: when the SPA and the API are on different sites the cookie must be
 * issued as `SameSite=None; Secure`, otherwise only the ticket bootstrap works.
 */
const SESSION_ENDPOINT = `${GRAFANA_BASE}/session`;

interface GrafanaSession {
  /** Single-use ticket parsed out of the backend's `embed_url`, if any. */
  ticket: string | null;
}

async function primeGrafanaSession(): Promise<GrafanaSession> {
  const token = localStorage.getItem(TOKEN_KEY);
  try {
    const res = await fetch(`${SESSION_ENDPOINT}?kiosk=true&theme=dark`, {
      method: 'POST',
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return { ticket: null };
    const body = (await res.json()) as { embed_url?: string };
    return { ticket: extractTicket(body?.embed_url) };
  } catch {
    // Network error: swallow it here - the iframe's own error/timeout
    // handling surfaces a single, clear message to the user.
    return { ticket: null };
  }
}

function extractTicket(embedUrl?: string): string | null {
  if (!embedUrl) return null;
  const queryStart = embedUrl.indexOf('?');
  if (queryStart === -1) return null;
  return new URLSearchParams(embedUrl.slice(queryStart + 1)).get('ticket');
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

type EmbedStatus = 'loading' | 'ready' | 'error';

export default function Dashboards() {
  const { isAdmin } = useAuth();

  const tabs = useMemo(
    () => DASHBOARD_TABS.filter((tab) => !tab.adminOnly || isAdmin),
    [isAdmin],
  );

  const [activeUid, setActiveUid] = useState<string>(DASHBOARD_TABS[0].uid);
  const [status, setStatus] = useState<EmbedStatus>('loading');
  // Bumped on "Retry" to force a full remount of the iframe. Any value > 0
  // also means "the direct URL already failed once", so the ticket bootstrap
  // is used instead.
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<{ ready: boolean; ticket: string | null }>({
    ready: false,
    ticket: null,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeTab = tabs.find((tab) => tab.uid === activeUid) ?? tabs[0];
  /** Canonical, human-shareable dashboard URL (also used by "Open in Grafana"). */
  const embedUrl = buildGrafanaEmbedUrl(activeTab.uid);
  const frameSrc =
    attempt > 0 && session.ticket
      ? buildGrafanaBootstrapUrl(activeTab.uid, session.ticket)
      : embedUrl;

  // If an admin-only tab is selected and the user loses admin, fall back.
  useEffect(() => {
    if (!tabs.some((tab) => tab.uid === activeUid)) {
      setActiveUid(tabs[0].uid);
    }
  }, [tabs, activeUid]);

  /** Opens (or refreshes) the proxy session before the iframe is mounted. */
  const openSession = useCallback(async () => {
    setSession({ ready: false, ticket: null });
    const { ticket } = await primeGrafanaSession();
    setSession({ ready: true, ticket });
  }, []);

  useEffect(() => {
    void openSession();
  }, [openSession]);

  // Watchdog: an unreachable Grafana can leave the iframe hanging forever
  // without ever firing `onError`, so fall back to a timeout.
  useEffect(() => {
    if (!session.ready || status !== 'loading') return;
    timerRef.current = setTimeout(() => setStatus('error'), LOAD_TIMEOUT_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [session.ready, status, activeUid, attempt]);

  const handleSelect = useCallback((uid: string) => {
    setActiveUid(uid);
    setStatus('loading');
  }, []);

  const handleRetry = useCallback(() => {
    setStatus('loading');
    setAttempt((n) => n + 1);
    // A ticket is single-use, so ask for a fresh one on every retry.
    void openSession();
  }, [openSession]);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-slate-100">Dashboards</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Live metrics for your models - training runs, accuracy over time and
            inference traffic - rendered straight from Grafana. The view refreshes
            itself every 30 seconds.
          </p>
        </div>
        <a
          href={embedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-brand-400"
        >
          Open in Grafana
          <ExternalLinkIcon />
        </a>
      </div>

      {/* Dashboard switcher (only meaningful when more than one is available) */}
      {tabs.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
          {tabs.map((tab) => (
            <button
              key={tab.uid}
              onClick={() => handleSelect(tab.uid)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                tab.uid === activeTab.uid
                  ? 'bg-brand-600/20 text-brand-400'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <span className="ml-1 hidden text-xs text-slate-500 sm:inline">
            {activeTab.blurb}
          </span>
        </div>
      )}

      {/* Embed */}
      <div className="relative min-h-[420px] overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
        {status === 'error' ? (
          <GrafanaUnavailable url={embedUrl} onRetry={handleRetry} />
        ) : (
          <>
            {session.ready && (
              <iframe
                key={`${activeTab.uid}-${attempt}`}
                title={`Grafana dashboard: ${activeTab.label}`}
                src={frameSrc}
                onLoad={() => setStatus('ready')}
                onError={() => setStatus('error')}
                className="h-[calc(100vh-260px)] min-h-[420px] w-full border-0"
              />
            )}
            {status === 'loading' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900">
                <Spinner size="lg" />
                <p className="text-sm text-slate-400">Loading dashboard...</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ---- Sub-components ---- */

function GrafanaUnavailable({ url, onRetry }: { url: string; onRetry: () => void }) {
  return (
    <div className="flex h-[calc(100vh-260px)] min-h-[420px] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="rounded-full bg-red-900/30 p-3 text-red-400">
        <WarningIcon />
      </div>
      <div className="max-w-md space-y-2">
        <h3 className="text-base font-semibold text-slate-100">
          Could not load the Grafana dashboard
        </h3>
        <p className="text-sm text-slate-400">
          The metrics service did not respond. It is probably not running yet -
          start the monitoring stack (Grafana and Prometheus) with{' '}
          <code className="rounded bg-slate-800 px-1 py-0.5 font-mono text-xs text-slate-300">
            docker compose up -d grafana prometheus
          </code>{' '}
          and try again. If it is running, check that the dashboard exists and
          that your session has access to it.
        </p>
        <p className="break-all font-mono text-xs text-slate-600">{url}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <button
          onClick={onRetry}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500"
        >
          Retry
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
        >
          Open in Grafana
        </a>
      </div>
    </div>
  );
}

/* ---- Inline SVG Icons ---- */

function ExternalLinkIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  );
}
