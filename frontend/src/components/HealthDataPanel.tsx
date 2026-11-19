import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { getProjectPrivacy, protectProjectData, setProjectPrivacy } from '../api/client';
import type { LegalBasis, PrivacyAction, PrivacyPolicy, ProjectPrivacy } from '../types';
import Spinner from './Spinner';
import ChipsInput from './cleaning/ChipsInput';

/**
 * Whether a project holds health data, on what basis, and what is done to it.
 *
 * Health data is sensitive data (Ley 1581 de 2012, art. 5): holding it needs
 * the subjects' authorisation, or a scientific purpose with identity
 * suppressed and an ethics approval (art. 6; Resolución 8430 de 1993). The
 * panel records which, and from then on the platform suppresses identity in
 * everything the project lands, before it is stored.
 */

const ACTION_LABEL: Record<PrivacyAction, string> = {
  pseudonymize: 'pseudonymised',
  suppress: 'removed',
  year: 'year only',
  zip3: 'first 3 characters',
};

const IN_PROGRESS = new Set(['queued', 'running']);

const FIELD =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none';

const EMPTY_BASIS: LegalBasis = { kind: 'scientific', purpose: '', reference: '', responsible: '' };

export default function HealthDataPanel({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['project-privacy', projectId],
    queryFn: () => getProjectPrivacy(projectId),
    refetchInterval: (query) => (IN_PROGRESS.has(query.state.data?.protection?.status ?? '') ? 3000 : false),
  });
  const [editing, setEditing] = useState(false);
  const [basis, setBasis] = useState<LegalBasis>(EMPTY_BASIS);
  const [policy, setPolicy] = useState<PrivacyPolicy>({ pseudonymize: [], suppress: [], keep: [] });

  const saved = data?.legal_basis;
  const savedPolicy = data?.policy;
  useEffect(() => {
    setBasis(saved ? { ...saved } : EMPTY_BASIS);
  }, [saved]);
  useEffect(() => {
    if (savedPolicy) setPolicy(savedPolicy);
  }, [savedPolicy]);

  // When protection finishes, every layer view of this project has changed.
  const status = data?.protection?.status;
  const last = useRef(status);
  useEffect(() => {
    if (last.current && IN_PROGRESS.has(last.current) && status && !IN_PROGRESS.has(status)) {
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'project-privacy' });
    }
    last.current = status;
  }, [status, queryClient]);

  const save = useMutation({
    mutationFn: () => setProjectPrivacy(projectId, { classification: 'health', legal_basis: basis, policy }),
    onSuccess: (next) => {
      queryClient.setQueryData(['project-privacy', projectId], next);
      setEditing(false);
    },
  });
  const protect = useMutation({
    mutationFn: () => protectProjectData(projectId),
    onSuccess: (next) => queryClient.setQueryData(['project-privacy', projectId], next),
  });

  if (isLoading || !data) {
    return (
      <section className="rounded-lg border border-slate-700 bg-slate-900/40 px-5 py-4">
        {error ? <p className="text-sm text-red-300">{(error as Error).message}</p> : <Spinner />}
      </section>
    );
  }

  const health = data.classification === 'health';
  const kind = data.legal_bases.find((entry) => entry.kind === basis.kind);
  const complete = Boolean(basis.purpose.trim() && basis.reference.trim() && basis.responsible.trim());
  const showForm = !health || editing;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (complete) save.mutate();
  }

  return (
    <section aria-label="Health data" className="rounded-lg border border-slate-700 bg-slate-900/40">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
            {health ? (
              <ShieldCheck size={16} className="text-emerald-300" aria-hidden="true" />
            ) : (
              <ShieldAlert size={16} className="text-slate-400" aria-hidden="true" />
            )}
            Health data
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Health data is sensitive data (Ley 1581 de 2012). A project that holds it records the legal basis for
            doing so, and the platform suppresses identity in everything it lands — before it is stored, in every
            layer.
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs ${
            health ? 'bg-emerald-900/40 text-emerald-200' : 'bg-slate-800 text-slate-300'
          }`}
        >
          {health ? 'Health data · protected' : 'General data'}
        </span>
      </header>

      <div className="space-y-5 px-5 py-4">
        {health && data.legal_basis && !editing && (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="text-slate-500">Legal basis</dt>
            <dd className="text-slate-200">
              {data.legal_bases.find((entry) => entry.kind === data.legal_basis?.kind)?.title}{' '}
              <span className="text-slate-500">
                ({data.legal_bases.find((entry) => entry.kind === data.legal_basis?.kind)?.law})
              </span>
            </dd>
            <dt className="text-slate-500">Purpose</dt>
            <dd className="text-slate-200">{data.legal_basis.purpose}</dd>
            <dt className="text-slate-500">Reference</dt>
            <dd className="text-slate-200">{data.legal_basis.reference}</dd>
            <dt className="text-slate-500">Responsible</dt>
            <dd className="text-slate-200">{data.legal_basis.responsible}</dd>
            <dt className="text-slate-500">Recorded</dt>
            <dd className="text-slate-400">
              by {data.legal_basis.recorded_by || '—'}
              {data.legal_basis.recorded_at && ` on ${new Date(data.legal_basis.recorded_at).toLocaleString()}`}
            </dd>
            <dd className="sm:col-span-2">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-xs text-brand-300 hover:text-brand-200"
              >
                Update the legal basis or the protected columns
              </button>
            </dd>
          </dl>
        )}

        {showForm && (
          <form onSubmit={submit} className="space-y-4" aria-label="Legal basis">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium text-slate-200">On what basis does this project hold it?</legend>
              {data.legal_bases.map((entry) => (
                <label key={entry.kind} className="flex items-start gap-2 text-sm text-slate-300">
                  <input
                    type="radio"
                    className="mt-1"
                    checked={basis.kind === entry.kind}
                    onChange={() => setBasis({ ...basis, kind: entry.kind })}
                  />
                  <span>
                    {entry.title} <span className="text-xs text-slate-500">— {entry.law}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-slate-400 sm:col-span-2">
                Purpose of the processing
                <input
                  value={basis.purpose}
                  onChange={(event) => setBasis({ ...basis, purpose: event.target.value })}
                  placeholder="Train and validate a readmission model for the thesis"
                  className={FIELD}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Reference
                <input
                  value={basis.reference}
                  onChange={(event) => setBasis({ ...basis, reference: event.target.value })}
                  placeholder={kind?.reference_hint}
                  className={FIELD}
                />
                <span className="text-slate-500">{kind?.reference_hint}</span>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Responsible for the processing
                <input
                  value={basis.responsible}
                  onChange={(event) => setBasis({ ...basis, responsible: event.target.value })}
                  placeholder="Institution or person"
                  className={FIELD}
                />
              </label>
            </div>

            <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <p className="text-xs text-slate-400">
                Identifiers (ids, document numbers, record numbers) are pseudonymised so tables still join; names,
                addresses, phones and e-mails are removed; dates of birth keep the year and postal codes their first
                three characters. Adjust it here:
              </p>
              <ChipsInput
                label="Also pseudonymise"
                values={policy.pseudonymize}
                onChange={(pseudonymize) => setPolicy({ ...policy, pseudonymize })}
                placeholder="column name"
              />
              <ChipsInput
                label="Also remove"
                values={policy.suppress}
                onChange={(suppress) => setPolicy({ ...policy, suppress })}
                placeholder="column name"
              />
              <ChipsInput
                label="Leave as is although detected"
                values={policy.keep}
                onChange={(keep) => setPolicy({ ...policy, keep })}
                placeholder="column name"
              />
            </div>

            <p className="text-xs text-amber-300">
              {health
                ? 'A stricter policy is applied to what is already stored; a looser one only to what lands from now on — what was removed is gone.'
                : 'Once data has landed, the project stays classified as health data. What it already stores is protected, and what cannot be protected — original uploads, earlier gold builds — is deleted.'}
            </p>

            {save.isError && <p className="text-xs text-red-300">{(save.error as Error).message}</p>}

            <div className="flex justify-end gap-3">
              {editing && (
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={!complete || save.isPending}
                className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-40"
              >
                {save.isPending && <Spinner size="sm" />}
                {health ? 'Save' : 'Mark as health data'}
              </button>
            </div>
          </form>
        )}

        {health && <Protection data={data} pending={protect.isPending} onProtect={() => protect.mutate()} />}

        {data.sources.some((source) => source.columns.length > 0) && (
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {health ? 'What is done to each source' : 'What would be done if marked'}
            </h3>
            <ul className="space-y-2">
              {data.sources
                .filter((source) => source.columns.length > 0)
                .map((source) => (
                  <li key={source.source_id} className="rounded-lg border border-slate-800 px-3 py-2 text-xs">
                    <p className="mb-1 text-slate-300">{source.source_name}</p>
                    <p className="flex flex-wrap gap-1.5">
                      {source.columns.map((column) => (
                        <span
                          key={column.column}
                          className="rounded bg-slate-800 px-1.5 py-0.5 font-display text-slate-300"
                        >
                          {column.column} <span className="text-slate-500">→ {ACTION_LABEL[column.action]}</span>
                        </span>
                      ))}
                    </p>
                  </li>
                ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-slate-500">
          This is pseudonymisation: the platform keeps the key, encrypted, so the data is still personal data and access
          stays restricted. Authorisations, the ethics approval and the data-processing policy are the institution's;
          the platform records which applies.
        </p>
      </div>
    </section>
  );
}

function Protection({
  data,
  pending,
  onProtect,
}: {
  data: ProjectPrivacy;
  pending: boolean;
  onProtect: () => void;
}) {
  const protection = data.protection ?? {};
  if (protection.status && IN_PROGRESS.has(protection.status)) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-brand-200">
        <Spinner size="sm" /> Protecting what the project had already stored, then rebuilding silver and gold…
      </p>
    );
  }
  return (
    <div className="space-y-2 text-sm">
      {protection.status === 'failed' && (
        <p className="text-red-300">Protecting the stored data failed: {protection.error}</p>
      )}
      {protection.status === 'success' && data.unprotected_runs === 0 && (
        <p className="text-emerald-300">
          Everything stored is protected: {protection.runs ?? 0} landed file(s) rewritten, {protection.purged ?? 0}{' '}
          object(s) that could not be protected deleted
          {protection.gold_version ? `, gold rebuilt as v${protection.gold_version}` : ''}.
        </p>
      )}
      {data.unprotected_runs > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-700/60 bg-amber-950/30 px-3 py-2.5">
          <p className="text-amber-200">
            {data.unprotected_runs} stored file(s) landed before the project was marked and still hold identifiers.
          </p>
          <button
            type="button"
            onClick={onProtect}
            disabled={pending}
            className="flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40"
          >
            {pending && <Spinner size="sm" />}
            Protect stored data
          </button>
        </div>
      )}
    </div>
  );
}
