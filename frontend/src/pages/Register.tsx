import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const inviteToken = searchParams.get('token') ?? '';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [usernameFocused, setUsernameFocused] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register({
        username,
        password,
        email,
        github_token: githubToken.trim(),
        invite_token: inviteToken || undefined,
      });
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-100">MLOps Platform</h1>
          <p className="mt-1 text-sm text-slate-400">Create your account</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="mb-1 block text-xs font-medium text-slate-400">
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                required
                minLength={3}
                maxLength={64}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onFocus={() => setUsernameFocused(true)}
                onBlur={() => setUsernameFocused(false)}
                aria-describedby="username-hint"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                placeholder="choose-a-username"
              />
              {usernameFocused && (
                <p id="username-hint" className="mt-2 rounded-lg bg-brand-500/10 px-3 py-2 text-xs text-brand-300">
                  Your username will be saved as <strong>{username.replace(/@[gt]$/, '') || 'name'}@t</strong>.
                  You can sign in with or without the <strong>@t</strong>.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-medium text-slate-400">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="github-token" className="mb-1 block text-xs font-medium text-slate-400">
                GitHub token
              </label>
              <input
                id="github-token"
                type="password"
                required
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                placeholder="ghp_..."
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-xs font-medium text-slate-400">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={72}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                placeholder="min. 8 characters"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-slate-500">
            Already have an account?{' '}
            <Link to="/login" className="text-brand-400 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
