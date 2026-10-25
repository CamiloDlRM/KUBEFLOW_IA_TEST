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

  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard-embed', projectId, version],
    queryFn: () => getDashboardEmbed(projectId),
    retry: false,
  });

  useEffect(() => {
    if (!data || !mount.current) return;
    // Refused up front rather than handed to the SDK, which would build an
    // iframe the browser then blanks without saying why.
    const refusal = unframeableReason(data.superset_domain);
    setFailure(refusal);
    if (refusal) return;

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
      mountPoint: mount.current,
      fetchGuestToken: async () => {
        if (firstToken) {
          const token = firstToken;
          firstToken = null;
          return token;
        }
        return (await getDashboardEmbed(projectId)).token;
      },
      dashboardUiConfig: { hideTitle: true, filters: { expanded: false } },
      iframeTitle: 'KPI dashboard',
    })
      .then((dashboard) => {
        // Unmounted while the SDK was still setting up: tear it down rather
        // than leave an iframe attached to a node nobody is looking at.
        if (gone) dashboard.unmount();
        else embedded = dashboard;
      })
      .catch((error: Error) => setFailure(error.message));

    return () => {
      gone = true;
      embedded?.unmount();
    };
  }, [data, projectId]);

  // Not built yet is the ordinary state before the first prompt, not an error.
  if (isError) return null;

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/40">
      <header className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
        <h3 className="text-sm font-semibold text-slate-100">Your dashboard</h3>
        {data && (
          <span className="text-xs text-slate-500">dashboard #{data.dashboard_id}</span>
        )}
      </header>

      {isLoading && (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      )}

      {failure && (
        <p className="m-5 rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          The dashboard exists but could not be shown here: {failure}
        </p>
      )}

      {/* The SDK puts its iframe inside this node, and sizes nothing itself. */}
      <div
        ref={mount}
        data-testid="dashboard-mount"
        className={`h-[70vh] min-h-[420px] w-full [&>iframe]:h-full [&>iframe]:w-full [&>iframe]:border-0 ${
          data && !failure ? '' : 'hidden'
        }`}
      />
    </section>
  );
}
