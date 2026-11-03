import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { setPassword } from '../api/client';
import { useAuth } from '../context/AuthContext';

/** First password for a GitHub sign-up (GitHub never shares the user's password). */
export default function SetPassword() {
  const { currentUser, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [password, setPasswordValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await setPassword(password);
      await refreshUser();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-brand-500 focus:ring-1 focus:ring-brand-500';

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-100">Set a password</h1>
          <p className="mt-1 text-sm text-slate-400">
            So you can also sign in as <strong className="text-slate-200">{currentUser?.username}</strong> without GitHub.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <div>
            <label htmlFor="new-password" className="mb-1 block text-xs font-medium text-slate-400">Password</label>
            <input id="new-password" type="password" autoComplete="new-password" required minLength={8} maxLength={72}
              value={password} onChange={(e) => setPasswordValue(e.target.value)} placeholder="min. 8 characters" className={inputClass} />
          </div>
          <div>
            <label htmlFor="confirm-password" className="mb-1 block text-xs font-medium text-slate-400">Confirm password</label>
            <input id="confirm-password" type="password" autoComplete="new-password" required minLength={8} maxLength={72}
              value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
          </div>
          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50">
            {loading ? 'Saving…' : 'Save password'}
          </button>
        </form>
      </div>
    </div>
  );
}
