import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { githubConfirmNew } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { GithubTokenStatus } from '../types';

/** Landing page of the GitHub OAuth redirect: adopt the JWT, or resolve an email clash. */
export default function GithubCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { acceptToken, currentUser } = useAuth();
  const conflict = params.get('conflict');
  const pending = params.get('pending') ?? '';
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = params.get('token');
    if (token) acceptToken(token, (params.get('github_token_status') as GithubTokenStatus) || 'unknown');
  }, [params, acceptToken]);

  useEffect(() => {
    if (currentUser) navigate(currentUser.needs_password ? '/set-password' : '/', { replace: true });
  }, [currentUser, navigate]);

  async function createNew() {
    setError('');
    setLoading(true);
    try {
      const res = await githubConfirmNew(pending);
      acceptToken(res.access_token, res.github_token_status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
        {conflict ? (
          <div className="space-y-4">
            <h1 className="text-lg font-semibold text-slate-100">You already have an account</h1>
            <p className="text-sm text-slate-400">
              An account with <strong className="text-slate-200">{conflict}</strong> already exists.
              Sign in with it, or create a separate account for your GitHub user.
            </p>
            {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
            <Link
              to="/login"
              className="block w-full rounded-lg bg-brand-600 px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-brand-500"
            >
              Sign in with my existing account
            </Link>
            <button
              type="button"
              onClick={createNew}
              disabled={loading}
              className="w-full rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
            >
              {loading ? 'Creating account…' : 'Create a new GitHub account (@g)'}
            </button>
          </div>
        ) : (
          <p className="text-center text-sm text-slate-400">Signing you in with GitHub…</p>
        )}
      </div>
    </div>
  );
}
