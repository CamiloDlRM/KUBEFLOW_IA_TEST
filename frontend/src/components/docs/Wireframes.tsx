import { Pin, WfFrame, WfLabel, WfLines, WfStatus } from './Wireframe';

/* Each drawing is a schematic of one screen. Labels are the real labels in
   the product; everything else is rules and boxes, because the point is to
   locate a control, not to reproduce a screenshot. */

export function LoginScreen() {
  return (
    <WfFrame path="maia / sign in">
      <div className="mx-auto w-full max-w-[250px] space-y-2 py-1">
        <div className="text-center">
          <p className="font-display text-[15px] font-semibold leading-tight">Sign in to Maia</p>
          <p className="wf-text">From code to deployment</p>
        </div>

        <div className="space-y-2 rounded border border-[var(--rule)] bg-white p-3">
          <div className="relative">
            <WfLabel>Username</WfLabel>
            <div className="wf-box mt-1">
              <WfLines count={1} />
            </div>
            <Pin n={1} />
          </div>

          <div className="relative">
            <WfLabel>Password</WfLabel>
            <div className="wf-box mt-1">
              <WfLines count={1} />
            </div>
            <Pin n={2} />
          </div>

          <div className="relative">
            <span className="wf-btn w-full">Sign in</span>
            <Pin n={3} />
          </div>

          <p className="relative text-center wf-text">
            Don&rsquo;t have an account? Ask an administrator.
            <Pin n={4} className="-left-2 -top-2" />
          </p>
        </div>
      </div>
    </WfFrame>
  );
}

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

export function DashboardScreen() {
  return (
    <WfFrame path="maia / dashboard">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-display text-[12px] font-semibold">Dashboard</p>
            <p className="wf-text">Recent pipeline runs and service health.</p>
          </div>
          <div className="relative shrink-0">
            <span className="wf-btn">Projects</span>
            <Pin n={2} />
          </div>
        </div>

        <div className="relative wf-box wf-box--deep">
          <WfLabel>Service health</WfLabel>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <WfStatus tone="ok">Backend</WfStatus>
            <WfStatus tone="ok">Redis</WfStatus>
            <WfStatus tone="ok">MLflow</WfStatus>
            <WfStatus tone="ok">Model Server</WfStatus>
          </div>
          <Pin n={1} />
        </div>

        <div className="relative wf-box">
          <WfLabel>Recent pipelines</WfLabel>
          <table className="wf-table mt-1">
            <thead>
              <tr>
                <th>Pipeline</th>
                <th>Repository</th>
                <th>Commit</th>
                <th>Status</th>
                <th>Started</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-display">4f2a9c1b</td>
                <td>hospital-ml</td>
                <td className="font-display">9c1a</td>
                <td>
                  <WfStatus tone="ok">success</WfStatus>
                </td>
                <td>Oct 31, 09:12</td>
                <td>4m 12s</td>
              </tr>
              <tr>
                <td className="font-display">8b71d2e0</td>
                <td>claims-model</td>
                <td className="font-display">2f80</td>
                <td>
                  <WfStatus tone="bad">failed</WfStatus>
                </td>
                <td>Oct 30, 17:40</td>
                <td>1m 03s</td>
              </tr>
              <tr>
                <td className="font-display">1d3c7a44</td>
                <td>hospital-ml</td>
                <td className="font-display">77be</td>
                <td>
                  <WfStatus tone="idle">running</WfStatus>
                </td>
                <td>Oct 31, 10:02</td>
                <td>—</td>
              </tr>
            </tbody>
          </table>
          <Pin n={3} />
        </div>

        <div className="relative wf-box wf-box--dashed">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <WfLabel>Model metrics</WfLabel>
            <div className="flex gap-1">
              <span className="wf-pill">My Models</span>
              <span className="wf-pill">Platform</span>
            </div>
          </div>
          <div className="mt-2 h-[44px] w-full bg-[var(--paper-deep)]" />
          <Pin n={4} />
        </div>
      </div>
    </WfFrame>
  );
}

export function RecentRunsScreen() {
  const columns = ['Pipeline', 'Repository', 'Commit', 'Status', 'Started', 'Duration'];

  return (
    <WfFrame path="maia / dashboard / recent pipelines">
      <div className="wf-box overflow-x-auto">
        <div className="flex items-center justify-between">
          <WfLabel>Recent pipelines</WfLabel>
          <span className="wf-text">newest first · 5 rows</span>
        </div>
        <table className="wf-table mt-1 min-w-[430px]">
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={column} className="relative">
                  {column}
                  <Pin n={index + 1} className="-right-1 -top-2" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="font-display">4f2a9c1b</td>
              <td>hospital-ml</td>
              <td className="font-display">9c1a</td>
              <td>
                <WfStatus tone="ok">success</WfStatus>
              </td>
              <td>Oct 31, 09:12</td>
              <td>4m 12s</td>
            </tr>
            <tr>
              <td className="font-display">8b71d2e0</td>
              <td>claims-model</td>
              <td className="font-display">2f80</td>
              <td>
                <WfStatus tone="bad">failed</WfStatus>
              </td>
              <td>Oct 30, 17:40</td>
              <td>1m 03s</td>
            </tr>
            <tr>
              <td className="font-display">1d3c7a44</td>
              <td>hospital-ml</td>
              <td className="font-display">77be</td>
              <td>
                <WfStatus tone="idle">queued</WfStatus>
              </td>
              <td>Oct 31, 10:02</td>
              <td>—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </WfFrame>
  );
}

export function MetricsScreen() {
  return (
    <WfFrame path="maia / dashboard / model metrics">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <WfLabel>Model metrics</WfLabel>
            <p className="wf-text">Training runs, accuracy over time and inference traffic.</p>
          </div>
          <div className="relative shrink-0">
            <span className="wf-pill">Open in Grafana ↗</span>
            <Pin n={4} />
          </div>
        </div>

        <div className="relative flex flex-wrap items-center gap-1.5 border-b border-[var(--rule)] pb-1.5">
          <span className="wf-pill border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]">
            My Models
          </span>
          <span className="wf-pill">Platform</span>
          <span className="wf-text ml-1">Training runs, accuracy and inference traffic.</span>
          <Pin n={1} className="-left-1.5 -top-2" />
        </div>

        <div className="relative border border-[var(--rule)] bg-white">
          <div className="flex items-center justify-between px-2 py-1">
            <WfLabel>Accuracy over time</WfLabel>
            <span className="wf-text">last 30 days · 30s refresh</span>
          </div>
          <svg viewBox="0 0 320 62" className="h-[62px] w-full" role="img" aria-label="Schematic line chart">
            <g stroke="var(--rule)" strokeWidth="0.5">
              <line x1="0" y1="15" x2="320" y2="15" />
              <line x1="0" y1="31" x2="320" y2="31" />
              <line x1="0" y1="47" x2="320" y2="47" />
            </g>
            <polyline
              points="4,50 40,44 76,47 112,33 148,36 184,24 220,27 256,16 292,19 316,12"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.4"
            />
          </svg>
          <Pin n={2} />
        </div>

        <p className="relative wf-text">
          <span className="mr-1 inline-block h-[5px] w-[5px] rounded-full bg-[var(--ok)] align-middle" />
          Refreshes itself every 30 seconds.
          <Pin n={3} className="-left-2 -top-2" />
        </p>
      </div>
    </WfFrame>
  );
}

export function ProjectsScreen() {
  return (
    <WfFrame path="maia / projects">
      <div className="space-y-2">
        <div>
          <p className="font-display text-[12px] font-semibold">Projects</p>
          <p className="wf-text">A project holds its data and, when you have one, the repository that trains on it.</p>
        </div>

        <div className="relative flex flex-wrap items-end gap-2 wf-box wf-box--deep">
          <div className="min-w-[130px] flex-1">
            <WfLabel>Name your project</WfLabel>
            <div className="wf-box mt-1 bg-white">
              <span className="wf-text">Hospital readmissions</span>
            </div>
          </div>
          <div className="relative shrink-0">
            <span className="wf-btn">New project</span>
            <Pin n={2} />
          </div>
          <Pin n={1} className="-left-2 -top-2" />
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className={`relative wf-box ${index === 0 ? 'border-[var(--rule-strong)]' : ''}`}>
              <p className="wf-strong truncate">
                {index === 0 ? 'Hospital readmissions' : index === 1 ? 'Claims triage' : 'Bed occupancy'}
              </p>
              <p className="wf-text">Created Oct 28, 2026</p>
              <div className="mt-1 flex gap-2">
                <span className="relative">
                  <WfLabel>Sources</WfLabel>
                  <p className="wf-strong">3</p>
                  {index === 0 && <Pin n={4} />}
                </span>
                <span className="relative">
                  <WfLabel>Rows in gold</WfLabel>
                  <p className="wf-strong">12,480</p>
                  {index === 0 && <Pin n={5} />}
                </span>
              </div>
              <p className="mt-1 wf-text">{index === 0 ? '⌁ hospital-ml' : 'No repository linked yet'}</p>
              {index === 0 && <Pin n={3} />}
            </div>
          ))}
        </div>
      </div>
    </WfFrame>
  );
}

export function ProjectScreen() {
  return (
    <WfFrame path="maia / projects / 4">
      <div className="space-y-2">
        <p className="wf-text">← All projects</p>
        <p className="font-display text-[13px] font-semibold">Hospital readmissions</p>

        <div className="relative rounded border border-[var(--rule-strong)] bg-[var(--paper-deep)] p-2.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="wf-strong">Data Factory</p>
              <p className="wf-text">Where the data comes in, gets cleaned, and becomes the table this project trains on.</p>
            </div>
            <div className="flex gap-3 text-right">
              <span className="relative">
                <WfLabel>Sources</WfLabel>
                <p className="font-display text-[14px] font-semibold leading-tight">3</p>
                <Pin n={2} />
              </span>
              <span className="relative">
                <WfLabel>Rows in gold</WfLabel>
                <p className="font-display text-[14px] font-semibold leading-tight">12,480</p>
                <Pin n={3} />
              </span>
            </div>
          </div>
          <Pin n={1} className="-left-2 -top-2" />
        </div>

        <div className="relative wf-box">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="wf-strong">Repository</p>
              <p className="wf-text">The notebook that trains on this project&rsquo;s data.</p>
            </div>
            <span className="wf-btn">Link a repository</span>
          </div>
          <p className="mt-2 wf-text">No repository linked. The data factory works without one.</p>
          <Pin n={4} />
        </div>
      </div>
    </WfFrame>
  );
}

export function LinkRepoScreen() {
  return (
    <WfFrame path="maia / projects / 4 / link repository">
      <div className="space-y-2">
        <p className="wf-label">Repository</p>

        <div className="relative wf-box border-[var(--accent)] bg-[var(--accent-soft)]">
          <div className="flex items-center justify-between gap-2">
            <span>
              <span className="wf-strong block">hospital-ml</span>
              <span className="wf-text font-display">main</span>
            </span>
            <span className="wf-text">Selected</span>
          </div>
          <Pin n={1} />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="relative">
            <WfLabel>Branch</WfLabel>
            <div className="wf-box mt-1 flex items-center justify-between">
              <span className="wf-text font-display">main</span>
              <span className="wf-text">▾</span>
            </div>
            <Pin n={2} />
          </div>
          <div className="relative">
            <WfLabel>Notebook</WfLabel>
            <div className="wf-box mt-1 flex items-center justify-between">
              <span className="wf-text font-display">notebooks/train.ipynb</span>
              <span className="wf-text">▾</span>
            </div>
            <Pin n={3} />
          </div>
        </div>

        <div className="relative w-fit">
          <span className="wf-btn">Link selected notebook</span>
          <Pin n={4} />
        </div>

        <div className="wf-box wf-box--dashed">
          <div className="flex items-center justify-between gap-2">
            <span>
              <span className="wf-strong block">claims-model</span>
              <span className="wf-text font-display">main</span>
            </span>
            <span className="wf-text">Explore</span>
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
                  ? 'border-[var(--rule-strong)] bg-white'
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
              <div key={index} className="border border-[var(--rule)] bg-white p-1">
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

export function CanvasScreen() {
  const phases = ['config', 'preprocessing', 'training', 'export'];

  return (
    <WfFrame path="maia / projects / 4 / pipeline">
      <div className="space-y-2">
        <div className="relative flex flex-wrap items-center justify-between gap-2 wf-box wf-box--deep">
          <div className="min-w-0">
            <p className="wf-strong">hospital-ml</p>
            <p className="wf-text truncate font-display">main · notebooks/train.ipynb</p>
          </div>
          <span className="wf-btn">▶ Run pipeline</span>
          <Pin n={1} className="-left-2 -top-2" />
        </div>

        <div className="grid gap-2 sm:grid-cols-[96px_1fr]">
          <div className="space-y-1.5">
            <div className="relative wf-box">
              <WfLabel>Data</WfLabel>
              <p className="wf-text">Click to preview, drag onto Input.</p>
              <WfLines count={3} className="mt-1" />
              <Pin n={5} />
            </div>
            <div className="relative wf-box">
              <WfLabel>Runs</WfLabel>
              <WfLines count={3} className="mt-1" />
              <Pin n={6} />
            </div>
          </div>

          <div className="relative overflow-x-auto rounded border border-[var(--rule)] bg-[var(--paper-soft)] p-2">
            <div className="flex min-w-[430px] items-center gap-1">
              <div className="relative wf-box wf-box--accent min-w-[62px]">
                <WfLabel>Input</WfLabel>
                <p className="wf-text">gold v4</p>
                <Pin n={2} />
              </div>
              {phases.map((phase) => (
                <div key={phase} className="flex items-center gap-1">
                  <span className="wf-text">→</span>
                  <div className="wf-box min-w-[58px]">
                    <WfLabel>{phase}</WfLabel>
                    <div className="mt-1 flex items-center gap-1">
                      <span className="inline-block h-[5px] w-[5px] rounded-full bg-[var(--ok)]" />
                      <span className="wf-text">ran</span>
                    </div>
                    {phase === 'training' && <Pin n={3} />}
                  </div>
                </div>
              ))}
              <span className="wf-text">→</span>
              <div className="relative wf-box min-w-[54px]">
                <WfLabel>Model</WfLabel>
                <p className="wf-text">ready</p>
                <Pin n={4} />
              </div>
            </div>
            <p className="wf-text mt-2">Click a card to see its code and what it printed.</p>
          </div>
        </div>
      </div>
    </WfFrame>
  );
}

export function RunScreen() {
  const phases = ['download', 'validate', 'execute', 'register', 'deploy'];

  return (
    <WfFrame path="maia / pipelines / 4f2a9c1b">
      <div className="space-y-2">
        <div className="relative flex flex-wrap items-start justify-between gap-2 wf-box wf-box--deep">
          <div>
            <p className="wf-strong">
              Pipeline <span className="font-display">4f2a9c1b</span>
            </p>
            <p className="wf-text">Repo: hospital-ml · Branch: main · Commit: 9c1a</p>
          </div>
          <div className="text-right">
            <WfStatus tone="ok">success</WfStatus>
            <p className="wf-text">Oct 31, 09:12 · 4m 12s</p>
          </div>
          <Pin n={1} className="-left-2 -top-2" />
        </div>

        <div className="relative wf-box">
          <WfLabel>Pipeline phases</WfLabel>
          <div className="mt-1.5 flex items-center">
            {phases.map((phase, index) => (
              <div key={phase} className="flex flex-1 items-center">
                <div className="flex flex-col items-center">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--ok)] text-[8px] text-white">
                    ✓
                  </span>
                  <span className="wf-text">{phase}</span>
                </div>
                {index < phases.length - 1 && <span className="mb-3 h-px flex-1 bg-[var(--ok)]" />}
              </div>
            ))}
          </div>
          <Pin n={2} />
        </div>

        <div className="relative wf-box wf-box--deep">
          <WfLabel>Logs</WfLabel>
          <pre className="mt-1 overflow-hidden font-display text-[8.5px] leading-relaxed text-[var(--ink-2)]">
{`[execute] training model readmission-risk v1.0.0
[execute] accuracy=0.871 f1=0.842
[register] registered version 3`}
          </pre>
          <Pin n={3} />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="relative wf-box">
            <WfLabel>AI Training Advisor</WfLabel>
            <WfLines count={3} className="mt-1" />
            <Pin n={4} />
          </div>
          <div className="relative wf-box">
            <WfLabel>Metrics</WfLabel>
            <div className="mt-1 h-[36px] w-full bg-[var(--paper-deep)]" />
            <Pin n={5} />
          </div>
        </div>

        <div className="relative wf-box border-[var(--ok)]">
          <WfLabel>Deployed model</WfLabel>
          <p className="wf-text font-display">POST /models/readmission-risk/predict</p>
          <Pin n={6} />
        </div>
      </div>
    </WfFrame>
  );
}

export function ModelsScreen() {
  return (
    <WfFrame path="maia / models">
      <div className="space-y-2">
        <div>
          <p className="font-display text-[12px] font-semibold">Models</p>
          <p className="wf-text">Active model deployments and inference endpoints.</p>
        </div>

        <div className="relative wf-box overflow-x-auto">
          <table className="wf-table min-w-[520px]">
            <thead>
              <tr>
                <th>Model</th>
                <th>Version</th>
                <th>Accuracy</th>
                <th>Deployed</th>
                <th>Status</th>
                <th>Endpoint</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-semibold text-[var(--ink)]">readmission-risk</td>
                <td>v3</td>
                <td className="font-display">87.1%</td>
                <td>Oct 31, 2026</td>
                <td className="relative">
                  <WfStatus tone="ok">active</WfStatus>
                  <Pin n={2} />
                </td>
                <td className="relative">
                  <span className="font-display">/models/readmission-risk/predict</span>
                  <Pin n={3} />
                </td>
                <td className="relative">
                  <span className="flex justify-end gap-1">
                    <span className="wf-pill">Test</span>
                    <span className="wf-pill">Rollback</span>
                    <span className="wf-pill">Delete</span>
                  </span>
                  <Pin n={4} />
                </td>
              </tr>
              <tr>
                <td className="font-semibold text-[var(--ink)]">claims-triage</td>
                <td>v1</td>
                <td className="font-display">91.4%</td>
                <td>Oct 29, 2026</td>
                <td>
                  <WfStatus tone="ok">active</WfStatus>
                </td>
                <td className="font-display">/models/claims-triage/predict</td>
                <td>
                  <span className="flex justify-end gap-1">
                    <span className="wf-pill">Test</span>
                    <span className="wf-pill">Rollback</span>
                    <span className="wf-pill">Delete</span>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <Pin n={1} className="-left-2 -top-2" />
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

export function AdvisorScreen() {
  return (
    <WfFrame path="maia / pipelines / 4f2a9c1b / advisor">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <p className="wf-strong">✦ AI Training Advisor</p>
          <span className="relative wf-pill">
            Analyze this run
            <Pin n={1} />
          </span>
        </div>

        <div className="relative wf-box wf-box--deep">
          <WfLabel>Report</WfLabel>
          <WfLines count={4} className="mt-1" />
          <div className="mt-2 border-t border-[var(--rule)] pt-1.5">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="wf-text">Pushes to testing-ia-agent</span>
              <span className="relative wf-btn">
                Apply &amp; push
                <Pin n={3} />
              </span>
            </div>
          </div>
          <Pin n={2} className="-left-2 -top-2" />
        </div>

        <div className="relative wf-box wf-box--dashed">
          <p className="wf-text">Pushed to branch testing-ia-agent (commit 9c1a2f). Review the diff on GitHub, then run the pipeline from that branch.</p>
          <Pin n={4} className="-left-2 -top-2" />
        </div>
      </div>
    </WfFrame>
  );
}
