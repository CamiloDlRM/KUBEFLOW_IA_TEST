import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { embedDashboard } from '@superset-ui/embedded-sdk';
import { getDashboardEmbed } from '../api/client';
import Spinner from './Spinner';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * Why this browser will refuse to frame Superset at `domain`, if it will.
 *
 * Both refusals below look identical on screen — a grey frame with a broken
 * page icon — and give their reason only in the console. Naming them here is
 * the difference between a configuration fix and an afternoon of guessing.
 */
export function unframeableReason(
  domain: string,
  page: Pick<Location, 'protocol' | 'hostname'> = window.location,
): string | null {
  let superset: URL;
  try {
    superset = new URL(domain);
  } catch {
    return `Superset's address is not a URL: "${domain}". Set SUPERSET_PUBLIC_URL.`;
  }
  if (page.protocol === 'https:' && superset.protocol === 'http:') {
    return (
      `Superset is at ${superset.origin}, over plain HTTP, and a browser will not ` +
      'show an HTTP page inside an HTTPS one. Publish Superset over HTTPS and set ' +
      'SUPERSET_PUBLIC_URL to that address.'
    );
  }
  if (LOCAL_HOSTS.includes(superset.hostname) && !LOCAL_HOSTS.includes(page.hostname)) {
    return (
      `Superset is at ${superset.origin}, which only exists on the machine running ` +
      'it. Set SUPERSET_PUBLIC_URL to an address this browser can reach.'
    );
  }
  return null;
}

/**
 * The dashboard the KPI maker built, shown where it was asked for.
 *
 * Superset's own embedding SDK, not a bare iframe. A bare iframe would need the
 * user signed in to Superset in the same browser, and would show them all of
 * Superset rather than one dashboard. The SDK instead takes a guest token the
 * backend signs for exactly this dashboard, so the browser never holds a
 * Superset credential and cannot wander off to anything else.
 *
 * `version` is the latest exchange's id. A new exchange may have changed the
 * dashboard, so it is embedded afresh rather than left showing the old one.
 *
 * Two things made it go missing on a first visit, and both are guarded here:
 *
 * - **The first request is the slow one.** The backend logs in to Superset and
 *   may create the dashboard's embedded configuration, and a Superset that has
 *   been idle takes its time. That used to outlast the client's 15 s timeout,
 *   and the failure was hidden as if nothing had been built. Now the request
 *   waits longer, is retried, and a real failure is shown with a way to retry —
 *   only "nothing built yet" (a 404) shows nothing.
 * - **An embed that is still loading can be replaced.** The SDK resolves only
 *   once the iframe has loaded, and its `unmount` empties the node it was
 *   given. Sharing one node, a superseded embed finishing late emptied the node
 *   under the embed that replaced it, leaving a blank frame. Each embed now gets
 *   a node of its own, so tearing one down cannot touch another.
 */
export default function EmbeddedDashboard({
  projectId,
  version,
}: {
  projectId: number;
  version: number;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [framing, setFraming] = useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['dashboard-embed', projectId, version],
    queryFn: () => getDashboardEmbed(projectId),
    // A 404 is not an error here (it comes back as null), so a retry is only
    // ever spent on a slow or unreachable Superset.
    retry: 2,
  });

  useEffect(() => {
    const container = mount.current;
    if (!data || !container) return;
    // Refused up front rather than handed to the SDK, which would build an
    // iframe the browser then blanks without saying why.
    const refusal = unframeableReason(data.superset_domain);
    setFailure(refusal);
    if (refusal) return;

    // This embed's own node. A superseded embed can only ever empty this one.
    const host = document.createElement('div');
    host.className = 'h-full w-full';
    container.replaceChildren(host);
    setFraming(true);

    // The first token is the one that came with the coordinates, so the page
    // does not ask for a second before it has shown anything. Every token
    // after that is a fresh request: the SDK calls this again shortly before
    // the current one expires.
    let firstToken: string | null = data.token;
    let embedded: { unmount: () => void } | undefined;
    let gone = false;

    embedDashboard({
      id: data.uuid,
      supersetDomain: data.superset_domain,
      mountPoint: host,
      fetchGuestToken: async () => {
        if (firstToken) {
          const token = firstToken;
          firstToken = null;
          return token;
        }
        const fresh = await getDashboardEmbed(projectId);
        if (!fresh) throw new Error('The dashboard is no longer there.');
        return fresh.token;
      },
      dashboardUiConfig: { hideTitle: true, filters: { expanded: false } },
      iframeTitle: 'KPI dashboard',
    })
      .then((dashboard) => {
        // Replaced or unmounted while the SDK was still setting up: tear this
        // one down. It only empties its own node, never the one now in use.
        if (gone) dashboard.unmount();
        else embedded = dashboard;
      })
      .catch((reason: Error) => {
        if (!gone) setFailure(reason.message);
      })
      .finally(() => {
        if (!gone) setFraming(false);
      });

    return () => {
      gone = true;
      embedded?.unmount();
      host.remove();
    };
  }, [data, projectId]);

  // Nothing built yet is the ordinary state before the first prompt.
  if (data === null) return null;

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/40">
      <header className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
        <h3 className="text-sm font-semibold text-slate-100">Your dashboard</h3>
        {data && (
          <span className="text-xs text-slate-500">dashboard #{data.dashboard_id}</span>
        )}
      </header>

      {(isLoading || (framing && !failure)) && (
        <div className="flex h-40 items-center justify-center gap-3 text-sm text-slate-400">
          <Spinner />
          {isLoading ? 'Asking Superset for the dashboard…' : 'Loading the dashboard…'}
        </div>
      )}

      {isError && (
        <div className="m-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          <span>The dashboard could not be loaded: {(error as Error).message}</span>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-lg border border-red-700 px-3 py-1 text-xs font-medium text-red-200 hover:bg-red-900/40 disabled:opacity-50"
          >
            {isFetching ? 'Trying…' : 'Try again'}
          </button>
        </div>
      )}

      {failure && (
        <p className="m-5 rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          The dashboard exists but could not be shown here: {failure}
        </p>
      )}

      {/* Each embed gets a node of its own inside this one; the SDK sizes
          nothing itself, so the iframe is stretched from here. */}
      <div
        ref={mount}
        data-testid="dashboard-mount"
        className={`h-[70vh] min-h-[420px] w-full [&_iframe]:h-full [&_iframe]:w-full [&_iframe]:border-0 ${
          data && !failure ? '' : 'hidden'
        }`}
      />
    </section>
  );
}
