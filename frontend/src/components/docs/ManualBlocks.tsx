import type { ReactNode } from 'react';

/**
 * The manual is built out of six kinds of block, and each one does one job:
 * a sequence, a note, a legend for a drawing, a glossary, an answer, or code.
 * Keeping them separate is what lets every section be written by filling in
 * the same slots, so two chapters cannot drift into two different manuals.
 */

/* ---- Sequence ------------------------------------------------------ */

export function Steps({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <ol className="manual-steps mt-4 border-t border-[var(--rule)]">
      {items.map((item, index) => (
        <li
          key={item.title}
          className="flex gap-3 border-b border-[var(--rule)] py-3"
        >
          <span className="mt-[3px] font-display text-[11px] tabular-nums text-[var(--ink-3)]">
            {String(index + 1).padStart(2, '0')}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug text-[var(--ink)]">
              {item.title}
            </p>
            <div className="manual-body-text mt-1 text-[13.5px]">{item.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ---- Margin note --------------------------------------------------- */

export function Callout({
  tone = 'tip',
  title,
  children,
}: {
  tone?: 'tip' | 'watch';
  title?: string;
  children: ReactNode;
}) {
  const watch = tone === 'watch';
  return (
    <aside className={`manual-note ${watch ? 'manual-note--watch' : ''} mt-5 px-4 py-3`}>
      <p
        className="manual-note__label"
        style={{ color: watch ? 'var(--warn)' : 'var(--accent)' }}
      >
        {watch ? 'Watch out' : 'Tip'}
        {title ? ` · ${title}` : ''}
      </p>
      <div className="manual-body-text mt-1 text-[13.5px]">{children}</div>
    </aside>
  );
}

/* ---- Legend for a drawing ----------------------------------------- */

export function Anatomy({
  items,
}: {
  items: { n: number; label: string; text: ReactNode }[];
}) {
  return (
    <dl className="mt-4 grid gap-x-8 border-t border-[var(--rule)] sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.n} className="border-b border-[var(--rule)] py-2.5">
          <dt className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-[var(--accent)] font-display text-[9.5px] font-semibold leading-none text-[var(--accent)]"
            >
              {item.n}
            </span>
            <span className="text-[13px] font-semibold leading-snug text-[var(--ink)]">
              {item.label}
            </span>
          </dt>
          <dd className="manual-body-text mt-1 pl-[28px] text-[12.5px] leading-snug">
            {item.text}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ---- Glossary ------------------------------------------------------ */

export function FieldList({ items }: { items: { term: string; text: ReactNode }[] }) {
  return (
    <dl className="mt-4 grid gap-x-8 border-t border-[var(--rule)] sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.term} className="border-b border-[var(--rule)] py-2.5">
          <dt className="font-display text-[10.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
            {item.term}
          </dt>
          <dd className="manual-body-text mt-1 text-[13px]">{item.text}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---- Questions ----------------------------------------------------- */

export function QaList({ items }: { items: { q: string; a: ReactNode }[] }) {
  return (
    <div className="mt-4 border-t border-[var(--rule)]">
      {items.map((item) => (
        <details key={item.q} className="group border-b border-[var(--rule)] py-3">
          <summary className="flex cursor-pointer list-none items-start gap-3 [&::-webkit-details-marker]:hidden">
            <span className="mt-[1px] font-display text-[10px] font-semibold text-[var(--accent)]">
              Q
            </span>
            <span className="flex-1 text-sm font-medium leading-snug text-[var(--ink)]">
              {item.q}
            </span>
            <span className="font-display text-[13px] leading-none text-[var(--ink-3)] group-open:hidden">
              +
            </span>
            <span className="hidden font-display text-[13px] leading-none text-[var(--ink-3)] group-open:inline">
              −
            </span>
          </summary>
          <div className="manual-body-text mt-2 pl-6 text-[13.5px]">{item.a}</div>
        </details>
      ))}
    </div>
  );
}

/* ---- Code ---------------------------------------------------------- */

export function CodeSample({
  title,
  code,
  language = 'python',
}: {
  title: string;
  code: string;
  language?: string;
}) {
  return (
    <figure className="manual-code mt-4 overflow-hidden rounded">
      <figcaption className="flex items-center justify-between border-b border-[var(--rule)] px-3 py-1.5">
        <span className="manual-eyebrow">{title}</span>
        <span className="manual-eyebrow">{language}</span>
      </figcaption>
      <pre className="overflow-x-auto px-3 py-2.5">
        <code>{code}</code>
      </pre>
    </figure>
  );
}

/* ---- The three metals ---------------------------------------------- */

const METALS = [
  {
    name: 'Bronze',
    colour: 'var(--bronze)',
    promise: 'What the source said',
    body: 'Every extracted row, with the source’s own names and types. Nothing is dropped, renamed, or repaired.',
    points: [
      'One landing per extraction, appended rather than overwritten.',
      'The place to look when a number is wrong upstream.',
    ],
  },
  {
    name: 'Silver',
    colour: 'var(--silver)',
    promise: 'What the data means',
    body: 'The same rows, cleaned and typed. Duplicates are removed, blank values handled, and text and codes normalised.',
    points: [
      'A quality report states what changed and by how many rows.',
      'The place to check before trusting a column.',
    ],
  },
  {
    name: 'Gold',
    colour: 'var(--gold)',
    promise: 'What the project answers',
    body: 'A query over silver that produces the table training reads: one row per thing you are modelling.',
    points: [
      'Versioned — every rebuild becomes v2, v3, and so on.',
      'Row count here is the “Rows in gold” figure on the project.',
    ],
  },
];

export function LayersBlock() {
  return (
    <div className="mt-5 grid gap-3 md:grid-cols-3">
      {METALS.map((metal) => (
        <article
          key={metal.name}
          className="manual-layer flex flex-col border border-[var(--rule)] bg-[var(--paper-soft)] px-4 pb-4 pt-3"
          style={{ borderTopColor: metal.colour, borderTopWidth: 3 }}
        >
          <p className="manual-eyebrow" style={{ color: metal.colour }}>
            {metal.name}
          </p>
          <h4 className="mt-1 font-display text-[17px] font-semibold leading-tight text-[var(--ink)]">
            {metal.promise}
          </h4>
          <p className="manual-body-text mt-2 text-[13px]">{metal.body}</p>
          <ul className="mt-3 space-y-1.5 border-t border-[var(--rule)] pt-2.5">
            {metal.points.map((point) => (
              <li key={point} className="flex gap-2 text-[12px] leading-snug text-[var(--ink-2)]">
                <span aria-hidden="true" className="mt-[7px] h-px w-2.5 shrink-0 bg-[var(--rule-strong)]" />
                {point}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

/* ---- Notebook contract --------------------------------------------- */

const TAGS = [
  {
    tag: 'mlops:config',
    required: true,
    text: 'Sets MODEL_NAME and VERSION as quoted strings. The model name becomes the deployment’s name.',
  },
  {
    tag: 'mlops:data',
    required: false,
    text: 'Reads DATASET_PATH. Optional, but the right place to load and sanity-check the input.',
  },
  {
    tag: 'mlops:preprocessing',
    required: true,
    text: 'Cleaning and feature preparation. Runs after data and before training.',
  },
  {
    tag: 'mlops:training',
    required: true,
    text: 'Fits the model. Anything logged with mlflow.log_metric appears on the run and in the advisor’s input.',
  },
  {
    tag: 'mlops:evaluation',
    required: false,
    text: 'Extra measurements and plots. Optional; a good place to log metrics the report should see.',
  },
  {
    tag: 'mlops:export',
    required: true,
    text: 'Must write the fitted model with joblib.dump(model, MODEL_OUTPUT_PATH).',
  },
];

const INJECTED = [
  {
    name: 'DATASET_PATH',
    text: 'Where the chosen input is mounted: the active dataset, or the bronze/silver/gold build picked on the canvas.',
  },
  {
    name: 'MODEL_OUTPUT_PATH',
    text: 'The file the export cell must write. Maia registers this artifact; a model left in memory is lost.',
  },
  {
    name: 'PIPELINE_ID',
    text: 'The run identifier. Useful in logs, file names, and anything you want to trace back to a run.',
  },
  {
    name: 'MLFLOW_TRACKING_URI',
    text: 'Where metrics and artifacts are recorded. Already configured — read it, do not hard-code it.',
  },
];

export function NotebookBlock() {
  return (
    <div>
      <div className="mt-4 overflow-x-auto border-y border-[var(--rule)]">
        <table className="w-full min-w-[420px] border-collapse text-left">
          <thead>
            <tr>
              {['Tag', 'Required', 'What the cell does'].map((heading) => (
                <th
                  key={heading}
                  className="manual-eyebrow border-b border-[var(--rule-strong)] py-2 pr-3 font-medium"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TAGS.map((tag) => (
              <tr key={tag.tag}>
                <td className="border-b border-[var(--rule)] py-2 pr-3 align-top font-display text-[11.5px] text-[var(--ink)]">
                  {tag.tag}
                </td>
                <td className="border-b border-[var(--rule)] py-2 pr-3 align-top">
                  <span
                    className={`font-display text-[10px] uppercase tracking-[0.1em] ${
                      tag.required ? 'text-[var(--accent)]' : 'text-[var(--ink-3)]'
                    }`}
                  >
                    {tag.required ? 'required' : 'optional'}
                  </span>
                </td>
                <td className="manual-body-text border-b border-[var(--rule)] py-2 align-top text-[12.5px]">
                  {tag.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CodeSample
        title="The two cells Maia cannot run without"
        code={`# cell tagged mlops:config
MODEL_NAME = "readmission-risk"
VERSION = "1.0.0"

# cell tagged mlops:export
import joblib
joblib.dump(model, MODEL_OUTPUT_PATH)`}
      />

      <h4 className="manual-eyebrow mb-3 mt-7">Values Maia injects</h4>
      <div className="overflow-x-auto border-y border-[var(--rule)]">
        <table className="w-full min-w-[420px] border-collapse text-left">
          <tbody>
            {INJECTED.map((item) => (
              <tr key={item.name}>
                <td className="w-[180px] border-b border-[var(--rule)] py-2 pr-3 align-top font-display text-[11.5px] text-[var(--ink)]">
                  {item.name}
                </td>
                <td className="manual-body-text border-b border-[var(--rule)] py-2 align-top text-[12.5px]">
                  {item.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---- Symptom / cause / action -------------------------------------- */

const ISSUES = [
  {
    symptom: 'The page spins or loads empty',
    cause: 'The Backend is not answering. No other dot on the Dashboard can be trusted until it is green.',
    fix: 'Reload once. If it stays down, tell your administrator; nothing in the app will fix it.',
  },
  {
    symptom: 'Run pipeline is greyed out',
    cause: 'A run of this repository is already queued or running, or the linked repository has no notebook path.',
    fix: 'Wait for the active run to finish. If nothing is running, check the linked notebook on the project page.',
  },
  {
    symptom: 'The run failed before any phase ran',
    cause: 'Maia could not reach the repository, branch, or notebook, or the notebook is not valid JSON.',
    fix: 'Read the red banner on the run page. Check the branch still exists and the file is a .ipynb.',
  },
  {
    symptom: 'A run failed during execute',
    cause: 'The notebook raised an exception. Maia reports the failing cell and its output.',
    fix: 'Open that phase, read the traceback, fix the code, push, and run again.',
  },
  {
    symptom: '“Notebook is missing required MLOps tags”',
    cause: 'One of config, preprocessing, training, or export is absent.',
    fix: 'Add the tag to the cell’s metadata in Jupyter, then re-commit. Tags are case-sensitive.',
  },
  {
    symptom: 'A successful run deployed no model',
    cause: 'Deployment needs auto-deploy enabled and accuracy at or above the platform threshold.',
    fix: 'Open the deploy phase; it records the reason. Improve the model, or ask about the threshold.',
  },
  {
    symptom: 'The model endpoint returns an error',
    cause: 'The Model Server dot is red, or the request is not a POST with the expected JSON shape.',
    fix: 'Try the Models page’s Test action first. If that also fails, the server needs attention.',
  },
  {
    symptom: 'The metrics panel says it could not load',
    cause: 'The embedded Grafana session has expired.',
    fix: 'Reload the Dashboard, or use Open in Grafana. The run itself is unaffected.',
  },
  {
    symptom: 'The invite never arrived',
    cause: 'The email went to spam, or the address was mistyped.',
    fix: 'Copy the link shown once after sending. If it is gone, create a new invite.',
  },
  {
    symptom: 'An email or password change did nothing',
    cause: 'Credential changes need a confirmation link, and the link expires.',
    fix: 'Open the link in the email. If it expired, request the change again.',
  },
];

export function IssuesTable() {
  return (
    <div className="mt-4 overflow-x-auto border-y border-[var(--rule)]">
      <table className="w-full min-w-[560px] border-collapse text-left align-top">
        <thead>
          <tr>
            {['What you see', 'Why', 'What to do'].map((heading) => (
              <th
                key={heading}
                className="manual-eyebrow border-b border-[var(--rule-strong)] py-2 pr-4 font-medium"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ISSUES.map((issue) => (
            <tr key={issue.symptom}>
              <td className="w-[30%] border-b border-[var(--rule)] py-2.5 pr-4 align-top text-[12.5px] font-semibold leading-snug text-[var(--ink)]">
                {issue.symptom}
              </td>
              <td className="manual-body-text w-[32%] border-b border-[var(--rule)] py-2.5 pr-4 align-top text-[12px]">
                {issue.cause}
              </td>
              <td className="manual-body-text border-b border-[var(--rule)] py-2.5 align-top text-[12px]">
                {issue.fix}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
