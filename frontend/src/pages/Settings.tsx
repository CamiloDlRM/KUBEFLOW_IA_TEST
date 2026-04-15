import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { requestChangePassword, requestChangeUsername, updateEmail } from '../api/client';
import type { ChangeRequestedResponse } from '../types';

type Tab = 'password' | 'username' | 'email';

function SuccessBanner({ res }: { res: ChangeRequestedResponse }) {
  return (
    <div className="rounded-lg bg-green-500/10 px-4 py-3">
      <p className="text-sm font-medium text-green-400">Check your email</p>
      <p className="mt-0.5 text-xs text-green-400/70">
        We sent a confirmation link to <strong>{res.email}</strong>.
        Click it to apply the change.
      </p>
    </div>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [result, setResult] = useState<ChangeRequestedResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handle(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await requestChangePassword({ current_password: current, new_password: next });
      setResult(res);
      setCurrent('');
      setNext('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  if (result) return (
    <div className="space-y-4">
      <SuccessBanner res={result} />
      <button
        onClick={() => setResult(null)}
        className="text-xs text-slate-400 hover:text-slate-200"
      >
        Change again
      </button>
    </div>
  );

  return (
    <form onSubmit={handle} className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Current password</label>
        <input
          type="password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">New password</label>
        <input
          type="password"
          required
          minLength={8}
          maxLength={72}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="min. 8 characters"
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      </div>
      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
      >
        {loading ? 'Sending confirmation…' : 'Change password'}
      </button>
    </form>
  );
}

function UsernameForm() {
  const { currentUser } = useAuth();
  const [newUsername, setNewUsername] = useState('');
  const [result, setResult] = useState<ChangeRequestedResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handle(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await requestChangeUsername({ new_username: newUsername });
      setResult(res);
      setNewUsername('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  if (result) return (
    <div className="space-y-4">
      <SuccessBanner res={result} />
      <button
        onClick={() => setResult(null)}
        className="text-xs text-slate-400 hover:text-slate-200"
      >
        Change again
      </button>
    </div>
  );

  return (
    <form onSubmit={handle} className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Current username</label>
        <input
          readOnly
          value={currentUser?.username ?? ''}
          className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-400 outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">New username</label>
        <input
          type="text"
          required
          minLength={3}
          maxLength={64}
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
          placeholder="choose-a-new-username"
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      </div>
      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
      >
        {loading ? 'Sending confirmation…' : 'Change username'}
      </button>
    </form>
  );
}

function EmailForm() {
  const { currentUser } = useAuth();
  const [email, setEmail] = useState(currentUser?.email ?? '');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handle(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await updateEmail(email);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handle} className="space-y-4">
      {!currentUser?.email && (
        <div className="rounded-lg bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
          Your account has no email. Set one to enable password and username change confirmations.
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Email address</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      </div>
      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
      {saved && <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-400">Email updated.</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
      >
        {loading ? 'Saving…' : 'Save email'}
      </button>
    </form>
  );
}

export default function Settings() {
  const { currentUser } = useAuth();
  const [tab, setTab] = useState<Tab>(() => (currentUser?.email ? 'password' : 'email'));

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Account settings</h2>
        <p className="mt-1 text-sm text-slate-400">
          Changes are applied after you confirm via email
          {currentUser?.email && (
            <> (<span className="text-slate-300">{currentUser.email}</span>)</>
          )}.
        </p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        {/* Tabs */}
        <div className="mb-6 flex rounded-lg bg-slate-800 p-1">
          {(['email', 'password', 'username'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium transition ${
                tab === t
                  ? 'bg-slate-700 text-slate-100 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t === 'email' ? 'Email' : t === 'password' ? 'Password' : 'Username'}
            </button>
          ))}
        </div>

        {tab === 'email' && <EmailForm />}
        {tab === 'password' && <PasswordForm />}
        {tab === 'username' && <UsernameForm />}
      </div>
    </div>
  );
}
