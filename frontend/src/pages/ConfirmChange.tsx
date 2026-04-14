import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { confirmChange } from '../api/client';
import { useAuth } from '../context/AuthContext';

type State = 'loading' | 'success' | 'error';

export default function ConfirmChange() {
  const [searchParams] = useSearchParams();
  const { logout } = useAuth();
  const token = searchParams.get('token') ?? '';

  const [state, setState] = useState<State>('loading');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('No token found in the URL.');
      return;
    }

    confirmChange(token)
      .then(() => {
        setState('success');
        logout();
      })
      .catch((err) => {
        setState('error');
        setMessage(err instanceof Error ? err.message : 'Something went wrong');
      });
  }, [token]);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-100">MLOps Platform</h1>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-center shadow-xl">
          {state === 'loading' && (
            <>
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-brand-500" />
              <p className="text-sm text-slate-400">Applying your change…</p>
            </>
          )}

          {state === 'success' && (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
                <svg className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="mb-2 text-lg font-semibold text-slate-100">Change applied</h2>
              <p className="mb-6 text-sm text-slate-400">
                Your credentials have been updated. Please sign in again with your new details.
              </p>
              <Link
                to="/login"
                className="inline-block w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500"
              >
                Go to sign in
              </Link>
            </>
          )}

          {state === 'error' && (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
                <svg className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="mb-2 text-lg font-semibold text-slate-100">Link invalid</h2>
              <p className="mb-6 text-sm text-slate-400">{message}</p>
              <Link
                to="/"
                className="inline-block w-full rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800"
              >
                Go to dashboard
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
