import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login } from '../api/client';
import { setSession } from '../auth';
import Spinner from '../components/Spinner';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(email.trim(), password);
      setSession(res.access_token, res.email);
      navigate('/dashboard');
    } catch (err) {
      setError((err as Error).message || 'Login failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4">
      {/* Background decoration */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/3 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-72 w-72 rounded-full bg-fuchsia-600/10 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30">
            <svg className="h-5 w-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M13 2L4.09 12.11a.6.6 0 00.45 1h5.05l-1.54 7.94a.3.3 0 00.53.25L19.91 11.9a.6.6 0 00-.45-1h-5.05l1.54-7.94a.3.3 0 00-.53-.25z" />
            </svg>
          </div>
          <span className="text-xl font-bold text-slate-100">MLOps Platform</span>
        </Link>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-8 shadow-2xl backdrop-blur">
          <h1 className="text-xl font-bold text-slate-100">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-400">Sign in to access your dashboard.</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {error && (
              <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-300">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@mlops.local"
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-300">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:opacity-90 disabled:opacity-50"
            >
              {loading && <Spinner size="sm" />}
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3 text-xs text-slate-500">
            Default credentials: <code className="text-slate-400">admin@mlops.local</code> /{' '}
            <code className="text-slate-400">admin123</code> — configurable via{' '}
            <code className="text-slate-400">ADMIN_EMAIL</code> and{' '}
            <code className="text-slate-400">ADMIN_PASSWORD</code>.
          </p>
        </div>

        <p className="mt-6 text-center text-sm text-slate-500">
          <Link to="/" className="text-indigo-400 hover:underline">
            &larr; Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
