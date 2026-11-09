import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MaiaAvatar } from './flow/Maia';

/**
 * What a page shows when it has nothing yet: Maia, saying what is missing and
 * what to do about it. Friendlier than a grey line where the content would be,
 * and the place a new user most needs to be told where to go next.
 */
export default function MaiaEmptyState({
  children,
  action,
}: {
  /** What is missing, in Maia's words. */
  children: ReactNode;
  /** The next step, as a link: where to go to make this page fill up. */
  action?: { to: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-slate-700 px-6 py-12 text-center">
      <MaiaAvatar size={88} />
      <p className="max-w-md text-sm text-slate-400">{children}</p>
      {action && (
        <Link
          to={action.to}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
