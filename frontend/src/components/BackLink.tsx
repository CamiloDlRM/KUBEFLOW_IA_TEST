import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/** The app's back button: the look of the Home button on the sign-in pages. */
export const BACK_BUTTON_CLASS =
  'font-body inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-200 backdrop-blur-sm transition hover:border-indigo-500 hover:text-white';

/** A link back to a page, styled as the app's back button. */
export default function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={BACK_BUTTON_CLASS}>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {children}
    </Link>
  );
}
