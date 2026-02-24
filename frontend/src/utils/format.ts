/**
 * Extract the repository name from a full GitHub URL.
 * "https://github.com/user/repo" => "user/repo"
 */
export function repoNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\//, '').replace(/\.git$/, '');
  } catch {
    return url;
  }
}

/**
 * Format an ISO date string into a human-readable local format.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Compute a human-readable duration between two ISO timestamps.
 */
export function formatDuration(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start) return '--';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const diffSec = Math.max(0, Math.round((e - s) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  return `${min}m ${sec}s`;
}

/**
 * Truncate a string (e.g. commit SHA) to a given length.
 */
export function truncate(str: string, len = 7): string {
  return str.length > len ? str.slice(0, len) : str;
}
