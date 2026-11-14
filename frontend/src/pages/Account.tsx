import { useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { getGithubTokenStatus, requestChangePassword, updateEmail, updateGithubToken } from '../api/client';
import AuthProviderIcon from '../components/AuthProviderIcon';
import type { ChangeRequestedResponse, GithubTokenStatus } from '../types';

/**
 * The user's account: who they are, read-only, and the few things they may
 * change. The username and email are not among them: the username is their identity across the
 * platform (Grafana signs them in by it, and the dashboards filter on it), and the email,
 * once set, is where changes are confirmed.
 */

type Tab = 'password' | 'email' | 'github';

function SuccessBanner({ res }: { res: ChangeRequestedResponse }) {
  return (
    <div className="rounded-lg bg-emerald-500/10 px-4 py-3">
      <p className="text-sm font-medium text-emerald-400">Check your email</p>
      <p className="mt-0.5 text-xs text-emerald-400/70">
        We sent a confirmation link to <strong>{res.email}</strong>.
        Click it to apply the change.
      </p>
    </div>
  );
}

const TOKEN_STATUS: Record<GithubTokenStatus, { label: string; pill: string }> = {
  ok: { label: 'Valid', pill: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30' },
  expiring: { label: 'Expires in under 7 days', pill: 'bg-amber-500/10 text-amber-300 ring-amber-500/30' },
  invalid: { label: 'Expired or invalid', pill: 'bg-red-500/10 text-red-300 ring-red-500/30' },
  missing: { label: 'No token', pill: 'bg-slate-500/10 text-slate-300 ring-slate-500/30' },
  unknown: { label: 'Could not check', pill: 'bg-slate-500/10 text-slate-400 ring-slate-600/30' },
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-body2 text-[11px] uppercase tracking-wider text-slate-500">{label}</dt>
      {/* Wraps rather than cutting off: this is where people come to read their details in full. */}
      <dd className="mt-1 break-words text-sm text-slate-100">{children}</dd>
    </div>
  );
}

/** Who is signed in, and whether their GitHub token still works. */
function AccountSummary() {
  const { currentUser } = useAuth();
  const viaGithub = currentUser?.auth_provider === 'github';
  // Asked of GitHub on every visit: the token can expire or be revoked at any time.
  const tokenStatus = useQuery({
    queryKey: ['github-token-status', currentUser?.id],
    queryFn: getGithubTokenStatus,
    enabled: Boolean(currentUser),
    staleTime: 60_000,
  });
  const status = TOKEN_STATUS[tokenStatus.data ?? 'unknown'];

  return (
    <dl className="grid gap-5 rounded-xl border border-slate-800 bg-slate-900 p-6 sm:grid-cols-2">
      <Fact label="Username">
        <span className="font-display">{currentUser?.username ?? '…'}</span>
        {currentUser?.role === 'admin' && (
          <span className="ml-2 rounded-full bg-brand-600/20 px-1.5 py-0.5 text-xs text-brand-400">admin</span>
        )}
      </Fact>
      <Fact label="Email">
        {currentUser?.email ?? <span className="text-slate-500">Not set</span>}
      </Fact>
      <Fact label="Signs in with">
        <span className="inline-flex items-center gap-1.5">
          <AuthProviderIcon provider={currentUser?.auth_provider} />
          {viaGithub ? 'GitHub' : 'Username and password'}
        </span>
      </Fact>
      <Fact label="GitHub token">
        <span className="flex flex-wrap items-center gap-2">
          {currentUser?.github_token_masked && (
            <span className="font-display text-slate-300">{currentUser.github_token_masked}</span>
          )}
          {tokenStatus.isLoading ? (
            <span className="text-xs text-slate-500">Checking…</span>
          ) : (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${status.pill}`}>{status.label}</span>
          )}
        </span>
        {viaGithub && (tokenStatus.data === 'invalid' || tokenStatus.data === 'expiring') && (
          <p className="mt-1 whitespace-normal text-xs text-slate-400">Sign in again with GitHub to renew it.</p>
        )}
      </Fact>
    </dl>
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

/**
 * Sets the account's email, once: it is shown only while there is none, since
 * password changes are confirmed by email. After that the email does not change.
 */
function EmailForm() {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handle(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await updateEmail(email);
      setSentTo(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handle} className="space-y-4">
      <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
        No email on this account. Set one to enable password change confirmations. It cannot be changed afterwards.
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Email address</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => { setEmail(e.target.value); setSentTo(''); }}
          placeholder="you@example.com"
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      </div>
      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
      {sentTo && (
        <div className="rounded-lg bg-blue-500/10 px-3 py-2 text-sm text-blue-400">
          Confirmation sent to <strong>{sentTo}</strong>. Check your inbox and click the link to verify this address.
        </div>
      )}
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

function GithubTokenForm() {
  const { currentUser, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handle(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSaved(false);
    setLoading(true);
    try {
      await updateGithubToken(token.trim());
      await refreshUser();
      void queryClient.invalidateQueries({ queryKey: ['github-token-status'] });
      setToken('');
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handle} className="space-y-4">
      <p className="text-xs text-slate-400">
        Current token:{' '}
        <span className="font-display text-slate-300">{currentUser?.github_token_masked || 'none'}</span>.
        Repositories added with your account use it.
      </p>
      <div>
        <label htmlFor="new-github-token" className="mb-1 block text-xs font-medium text-slate-400">New GitHub token</label>
        <input
          id="new-github-token"
          type="password"
          autoComplete="off"
          required
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ghp_..."
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      </div>
      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
      {saved && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">GitHub token updated.</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
      >
        {loading ? 'Checking…' : 'Update GitHub token'}
      </button>
    </form>
  );
}

export default function Account() {
  const { currentUser } = useAuth();
  // GitHub accounts renew their token by signing in again, so there is nothing to paste here.
  // The email is set once and then fixed, so its tab is there only while it is missing.
  const tabs: Tab[] = [
    ...(currentUser?.email ? [] : ['email' as const]),
    'password',
    ...(currentUser?.auth_provider === 'github' ? [] : ['github' as const]),
  ];
  const [tab, setTab] = useState<Tab>(() => (currentUser?.email ? 'password' : 'email'));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="font-display text-xl font-semibold text-slate-100">Account</h2>
        <p className="mt-1 text-sm text-slate-400">
          Your details on the platform. A new password is applied after you confirm it by email
          {currentUser?.email && (
            <> (<span className="text-slate-300">{currentUser.email}</span>)</>
          )}.
        </p>
      </div>

      <AccountSummary />

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        {/* Tabs */}
        <div className="mb-6 flex rounded-lg bg-slate-800 p-1">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium transition ${
                tab === t
                  ? 'bg-slate-700 text-slate-100 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t === 'email' ? 'Email' : t === 'password' ? 'Password' : 'GitHub token'}
            </button>
          ))}
        </div>

        {tab === 'email' && <EmailForm />}
        {tab === 'password' && <PasswordForm />}
        {tab === 'github' && <GithubTokenForm />}
      </div>
    </div>
  );
}
