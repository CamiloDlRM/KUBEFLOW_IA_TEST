import { useLocation } from 'react-router-dom';
import BackLink from '../components/BackLink';
import { MaiaAvatar } from '../components/flow/Maia';

/** Any address the app does not know: Maia, sad, and a way back. */
export default function NotFound() {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 text-center">
      <MaiaAvatar size={140} mood="sad" />
      <div className="max-w-md space-y-2">
        <h2 className="font-display text-2xl font-bold text-slate-100">I could not find this page</h2>
        <p className="text-sm text-slate-400">
          There is nothing at <code className="break-all text-slate-300">{pathname}</code>. The link may be old, or
          the address mistyped.
        </p>
      </div>
      <BackLink to="/">Back to Dashboard</BackLink>
    </div>
  );
}
