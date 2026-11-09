import { useState, type ReactNode } from 'react';
import { ChevronDown, Info } from 'lucide-react';

/**
 * How to connect an external source, shown at the top of the form.
 *
 * Only Supabase is supported for now: the worker connects with the Postgres
 * driver on port 5432 (the form has no port field), which is Supabase's direct
 * connection and its session pooler. The guide says where each value is found
 * in Supabase, what the password variable needs, and how the source table must
 * look for incremental extraction to work.
 */

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h5 className="font-display text-xs font-semibold uppercase tracking-wider text-sky-300">{title}</h5>
      <div className="space-y-2 text-sm text-slate-300">{children}</div>
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200">
      {children}
    </pre>
  );
}

const FIELDS: [string, ReactNode][] = [
  ['Host', <code key="host">aws-0-&lt;region&gt;.pooler.supabase.com</code>],
  ['Database', <code key="db">postgres</code>],
  ['Username', <code key="user">postgres.&lt;project-ref&gt;</code>],
  ['Password', 'Your database password (not your Supabase account password).'],
];

export default function SupabaseGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-sky-500/30 bg-sky-500/5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="supabase-guide"
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <Info size={18} className="shrink-0 text-sky-300" aria-hidden="true" />
        <span className="flex-1 text-sm text-slate-200">
          <span className="font-semibold text-sky-200">Only Supabase is supported for now.</span>{' '}
          <span className="text-slate-400">How to connect it and how your table must look.</span>
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div id="supabase-guide" className="space-y-5 border-t border-sky-500/20 px-4 py-4">
          <Step title="1 · Where to find the connection details">
            <p>
              In Supabase, open your project and press <strong>Connect</strong>. Pick the{' '}
              <strong>Session pooler</strong> connection: the direct connection only answers over IPv6, which
              Docker usually cannot reach. Do not use the transaction pooler: it listens on port 6543, and this
              connects on 5432.
            </p>
            <dl className="grid gap-x-4 gap-y-1.5 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 sm:grid-cols-[7rem_1fr]">
              {FIELDS.map(([name, value]) => (
                <div key={name} className="contents">
                  <dt className="text-slate-500">{name}</dt>
                  <dd className="text-slate-200 [&_code]:text-sky-200">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-slate-500">
              The region and project ref come straight from the pooler string Supabase shows you. The connection is
              encrypted (SSL) automatically.
            </p>
          </Step>

          <Step title="2 · The password">
            <p>
              Either type it in the <strong>Password</strong> field (it is stored encrypted), or keep it out of the
              app: add it to the platform's <code className="text-sky-200">.env</code> file, restart the backend
              and worker, and pick it in <strong>Password environment variable</strong>. Only variables named{' '}
              <code className="text-sky-200">&lt;NAME&gt;_DB_PASSWORD</code> are offered.
            </p>
            <Code>{`# .env
SUPABASE_DB_PASSWORD=your-database-password`}</Code>
            <Code>{`docker compose up -d backend worker`}</Code>
          </Step>

          <Step title="3 · How your table must look">
            <p>
              Each run only brings rows recorded since the last one, so the table needs a column with{' '}
              <strong>when each row was inserted</strong>: a timestamp set on insert and never changed afterwards.
              It is the <strong>Watermark column</strong>. An index on it keeps every run fast.
            </p>
            <Code>{`create table encounters (
  id            bigint generated always as identity primary key,
  patient_id    text not null,
  procedure_text text,           -- optional: free text to fill codes from
  procedure_code text,           -- optional: the code, when it is known
  total_cost    numeric,
  recorded_at   timestamptz not null default now()  -- the watermark
);
create index on encounters (recorded_at);`}</Code>
          </Step>

          <Step title="4 · The extraction query">
            <p>
              It must filter on <code className="text-sky-200">:watermark</code> and return the watermark column.
              The first run reads everything (it starts from 1900), and later runs only what is new.
            </p>
            <Code>{`SELECT *
FROM encounters
WHERE recorded_at > :watermark
ORDER BY recorded_at`}</Code>
          </Step>

          <Step title="5 · Recommended: a read-only user">
            <p>
              The platform only reads. A user that can do nothing else keeps a mistake from ever changing your
              data. Run this in Supabase's SQL editor, then sign in as <code className="text-sky-200">maia_reader</code>{' '}
              (through the pooler: <code className="text-sky-200">maia_reader.&lt;project-ref&gt;</code>).
            </p>
            <Code>{`create role maia_reader with login password 'choose-a-password';
grant usage on schema public to maia_reader;
grant select on encounters to maia_reader;`}</Code>
          </Step>
        </div>
      )}
    </div>
  );
}
