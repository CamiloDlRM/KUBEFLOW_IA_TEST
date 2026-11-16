import { Pin, WfFrame, WfLabel, WfLines, WfStatus } from './Wireframe';

/* Each drawing is a schematic of one screen. Labels are the real labels in
   the product; everything else is rules and boxes, because the point is to
   locate a control, not to reproduce a screenshot. */

export function ShellScreen() {
  const nav = [
    { label: 'Dashboard', pin: 1, active: true },
    { label: 'Projects', pin: 2 },
    { label: 'Models', pin: 3 },
    { label: 'My Repos', pin: 4 },
    { label: 'Settings', pin: 5 },
    { label: 'Admin', pin: 6 },
  ];

  return (
    <WfFrame path="maia / dashboard">
      <div className="flex min-h-[262px]">
        <div className="wf-side flex flex-col">
          <p className="px-1 pb-2 font-display text-[13px] font-semibold">Maia</p>
          <div className="space-y-1">
            {nav.map((item) => (
              <div
                key={item.label}
                className={`relative wf-navitem ${item.active ? 'wf-navitem--active' : ''}`}
              >
                {item.label}
                <Pin n={item.pin} className="-right-1.5 -top-1.5" />
              </div>
            ))}
          </div>
          <div className="mt-auto space-y-1 pt-4">
            <p className="wf-text px-1">Hello, samuel</p>
            <div className="relative wf-navitem">
              Sign out
              <Pin n={7} className="-right-1.5 -top-1.5" />
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2 p-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-display text-[12px] font-semibold">Dashboard</p>
              <p className="wf-text">Recent pipeline runs and service health.</p>
            </div>
            <span className="wf-btn shrink-0">Projects</span>
          </div>
          <div className="wf-box wf-box--deep">
            <WfLabel>Service health</WfLabel>
            <div className="mt-1 flex flex-wrap gap-1">
              <WfStatus tone="ok">Backend</WfStatus>
              <WfStatus tone="ok">Redis</WfStatus>
              <WfStatus tone="ok">MLflow</WfStatus>
              <WfStatus tone="bad">Model Server</WfStatus>
            </div>
          </div>
          <div className="wf-box">
            <WfLabel>Recent pipelines</WfLabel>
            <table className="wf-table mt-1">
              <thead>
                <tr>
                  <th>Pipeline</th>
                  <th>Repository</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-display">4f2a9c1b</td>
                  <td>hospital-ml</td>
                  <td>
                    <WfStatus tone="ok">success</WfStatus>
                  </td>
                </tr>
                <tr>
                  <td className="font-display">8b71d2e0</td>
                  <td>hospital-ml</td>
                  <td>
                    <WfStatus tone="bad">failed</WfStatus>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </WfFrame>
  );
}

export function StagesScreen() {
  const stages = [
    { label: 'Connect', caption: 'A database, or files you upload', on: true, badge: '3' },
    { label: 'Preview', caption: 'Check each source loaded', on: true },
    { label: 'Extract', caption: 'Bring its rows in', on: true },
    { label: 'Bronze', caption: 'Exactly what the source said', on: true, badge: '18.2k rows' },
    { label: 'Silver', caption: 'Cleaned, typed, and what changed', on: true, badge: '18.1k rows' },
    { label: 'Gold', caption: 'The table this project trains on', on: true, badge: 'v4' },
    { label: 'KPI maker', caption: 'Ask for a dashboard over gold', on: false },
  ];

  return (
    <WfFrame path="maia / projects / 4 / data">
      <div className="overflow-x-auto">
        <div className="flex min-w-[560px] items-stretch gap-1.5 pb-1 pt-2">
          {stages.map((stage, index) => (
            <div
              key={stage.label}
              className={`relative flex-1 rounded border p-1.5 ${
                stage.on
                  ? 'border-[var(--rule-strong)] bg-[var(--paper-soft)]'
                  : 'border-dashed border-[var(--rule)] bg-transparent'
              }`}
            >
              <span className="wf-label block">{String(index + 1).padStart(2, '0')}</span>
              <span className={`block wf-strong ${stage.on ? '' : 'text-[var(--ink-3)]'}`}>{stage.label}</span>
              <span className="mt-0.5 block wf-text">{stage.caption}</span>
              {stage.badge && <span className="wf-pill mt-1">{stage.badge}</span>}
              {!stage.on && <span className="mt-1 block wf-text">Build silver first</span>}
              <Pin n={index + 1} />
            </div>
          ))}
        </div>
      </div>
    </WfFrame>
  );
}

export function ConnectScreen() {
  return (
    <WfFrame path="maia / projects / 4 / data / connect">
      <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr]">
        <div className="relative wf-box">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="wf-strong">Connect an external source</p>
              <p className="wf-text">Extract from a system that already holds the data.</p>
            </div>
            <span className="relative wf-pill shrink-0">
              Add source
              <Pin n={1} />
            </span>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {['Name', 'Host', 'Database', 'Username'].map((field) => (
              <div key={field}>
                <WfLabel>{field}</WfLabel>
                <div className="wf-box mt-0.5">
                  <WfLines count={1} />
                </div>
              </div>
            ))}
          </div>

          <div className="relative mt-1.5">
            <WfLabel>Password environment variable</WfLabel>
            <div className="wf-box mt-0.5">
              <span className="wf-text font-display">HOSPITAL_DB_PASSWORD</span>
            </div>
            <Pin n={2} />
          </div>

          <div className="relative mt-1.5">
            <WfLabel>Extraction query</WfLabel>
            <div className="wf-box mt-0.5 h-[34px]">
              <span className="wf-text font-display">SELECT … WHERE recorded_at &gt; :watermark</span>
            </div>
            <Pin n={3} />
          </div>

          <div className="relative mt-2 flex flex-wrap gap-1">
            <span className="wf-btn wf-btn--ghost">Preview data</span>
            <span className="wf-btn">Connect source</span>
            <Pin n={4} className="-right-2 -top-2" />
          </div>
        </div>

        <div className="relative flex flex-col wf-box wf-box--dashed">
          <WfLabel>Upload dataset</WfLabel>
          <div className="mt-1.5 flex flex-1 flex-col items-center justify-center gap-1 rounded border border-dashed border-[var(--rule)] py-4 text-center">
            <span className="text-[14px] leading-none text-[var(--ink-3)]">↑</span>
            <span className="wf-text">Drag &amp; drop a file, or click to browse</span>
            <span className="wf-text">CSV, Parquet, JSON, XLSX</span>
          </div>
          <div className="mt-1.5">
            <WfLabel>Description (optional)</WfLabel>
            <div className="wf-box mt-0.5">
              <span className="wf-text">Iris training set, cleaned</span>
            </div>
          </div>
          <span className="wf-btn mt-1.5 w-fit">Upload</span>
          <Pin n={5} className="-left-2 -top-2" />
        </div>
      </div>
    </WfFrame>
  );
}

export function KpiScreen() {
  return (
    <WfFrame path="maia / projects / 4 / data / kpi maker">
      <div className="space-y-2">
        <div className="relative wf-box wf-box--deep">
          <div className="flex items-center justify-between">
            <WfLabel>Dashboard over gold</WfLabel>
            <span className="wf-pill">Open Superset ↗</span>
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {[0, 1, 2].map((index) => (
              <div key={index} className="border border-[var(--rule)] bg-[var(--paper-soft)] p-1">
                <div className="h-[26px] w-full bg-[var(--paper-deep)]" />
                <WfLabel>chart {index + 1}</WfLabel>
              </div>
            ))}
          </div>
          <Pin n={1} className="-left-2 -top-2" />
        </div>

        <div className="relative wf-box">
          <div className="ml-auto w-fit max-w-[78%] rounded rounded-br-none border border-[var(--accent)] bg-[var(--accent-soft)] px-2 py-1">
            <span className="wf-text">encounters per month, split by class, with average cost alongside</span>
          </div>
          <p className="mt-1.5 wf-text">
            Built four charts over <span className="font-semibold">gold</span> and set the split by class.
          </p>
          <p className="mt-1 wf-text underline">Show what it did — 6 calls to Superset</p>
          <Pin n={2} className="-left-2 -top-2" />
        </div>

        <div className="wf-box">
          <WfLabel>What should change?</WfLabel>
          <div className="relative mt-1 wf-box wf-box--dashed">
            <span className="wf-text">Make the second chart a line</span>
            <Pin n={3} />
          </div>
          <div className="mt-1.5 flex justify-end">
            <span className="relative wf-btn">
              Send
              <Pin n={4} />
            </span>
          </div>
        </div>
      </div>
    </WfFrame>
  );
}

export function SettingsScreen() {
  return (
    <WfFrame path="maia / settings">
      <div className="mx-auto w-full max-w-[290px] space-y-2">
        <div>
          <p className="font-display text-[12px] font-semibold">Account settings</p>
          <p className="wf-text">Changes are applied after you confirm via email.</p>
        </div>

        <div className="relative wf-box">
          <div className="flex gap-1 border-b border-[var(--rule)] pb-1.5">
            <span className="wf-pill border-[var(--accent)] bg-[var(--accent-soft)]">Email</span>
            <span className="wf-pill">Password</span>
            <span className="wf-pill">Username</span>
            <Pin n={1} className="-right-1 -top-2" />
          </div>

          <div className="relative mt-2">
            <WfLabel>Email address</WfLabel>
            <div className="wf-box mt-1">
              <span className="wf-text">you@hospital.org</span>
            </div>
            <Pin n={2} />
          </div>

          <div className="relative mt-2 w-fit">
            <span className="wf-btn">Update email</span>
            <Pin n={3} />
          </div>

          <div className="relative mt-2 wf-box wf-box--dashed">
            <p className="wf-text">Check your email. Click the link to apply the change.</p>
            <Pin n={4} />
          </div>
        </div>
      </div>
    </WfFrame>
  );
}
