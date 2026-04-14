import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { createInvite } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { InviteTokenResponse } from '../types';

export default function Admin() {
  const { isAdmin, currentUser } = useAuth();

  const [email, setEmail] = useState('');
  const [expiresInHours, setExpiresInHours] = useState(48);
  const [result, setResult] = useState<InviteTokenResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  if (!isAdmin) return <Navigate to="/" replace />;

  const inviteUrl = result
    ? `${window.location.origin}/register?token=${result.token}`
    : '';

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const res = await createInvite({ email, expires_in_hours: expiresInHours });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate invite');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleReset() {
    setResult(null);
    setEmail('');
    setCopied(false);
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Admin Panel</h2>
        <p className="mt-1 text-sm text-slate-400">
          Signed in as{' '}
          <span className="font-medium text-slate-300">{currentUser?.username}</span>{' '}
          <span className="rounded-full bg-brand-600/20 px-2 py-0.5 text-xs text-brand-400">
            admin
          </span>
        </p>
      </div>

      {/* Invite card */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h3 className="mb-1 text-sm font-semibold text-slate-200">Invite a member</h3>
        <p className="mb-5 text-xs text-slate-400">
          An invite link will be sent to the email address. The link is single-use and
          expires after the selected period. You can also copy the link manually as a
          fallback.
        </p>

        {!result ? (
          <form onSubmit={handleGenerate} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-medium text-slate-400">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
            </div>

            <div>
              <label htmlFor="expires" className="mb-1 block text-xs font-medium text-slate-400">
                Link expires in
              </label>
              <select
                id="expires"
                value={expiresInHours}
                onChange={(e) => setExpiresInHours(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              >
                <option value={24}>24 hours</option>
                <option value={48}>48 hours</option>
                <option value={72}>72 hours</option>
                <option value={168}>7 days</option>
              </select>
            </div>

            {error && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
            >
              {loading ? 'Sending invite…' : 'Send invite'}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            {/* Status banner */}
            {result.email_sent ? (
              <div className="flex items-start gap-3 rounded-lg bg-green-500/10 px-4 py-3">
                <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                <div>
                  <p className="text-sm font-medium text-green-400">Invite sent</p>
                  <p className="text-xs text-green-400/70">
                    Email delivered to <strong>{result.email}</strong>
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-lg bg-yellow-500/10 px-4 py-3">
                <WarnIcon className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
                <div>
                  <p className="text-sm font-medium text-yellow-400">Email not sent</p>
                  <p className="text-xs text-yellow-400/70">
                    SMTP is disabled. Copy the link below and share it manually.
                  </p>
                </div>
              </div>
            )}

            {/* Invite link */}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                Invite link (share as fallback or if email fails)
              </label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={inviteUrl}
                  className="flex-1 truncate rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-300 outline-none"
                />
                <button
                  onClick={handleCopy}
                  className="shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Expires:{' '}
              {new Date(result.expires_at).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </p>

            <button
              onClick={handleReset}
              className="w-full rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800"
            >
              Send another invite
            </button>
          </div>
        )}
      </div>

      {/* ACS migration note */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h4 className="mb-1 text-xs font-semibold text-slate-400">Email provider</h4>
        <p className="text-xs text-slate-500 leading-relaxed">
          Currently using <span className="text-slate-400">Mailhog</span> (local SMTP mock —{' '}
          <a
            href="http://localhost:8025"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-400 hover:underline"
          >
            open inbox
          </a>
          ). To switch to Azure Communication Services, set{' '}
          <code className="text-slate-300">SMTP_HOST</code>,{' '}
          <code className="text-slate-300">SMTP_PORT</code>,{' '}
          <code className="text-slate-300">SMTP_USER</code>, and{' '}
          <code className="text-slate-300">SMTP_PASSWORD</code> in your environment.
        </p>
      </div>
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function WarnIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  );
}
