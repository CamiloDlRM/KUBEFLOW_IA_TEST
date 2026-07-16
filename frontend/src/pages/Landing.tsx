import { Link } from 'react-router-dom';

const FEATURES = [
  {
    title: 'Push-to-Deploy Pipelines',
    description:
      'Push a training notebook to GitHub and watch it get validated, executed, registered in MLflow, and deployed automatically.',
    icon: RocketIcon,
    accent: 'from-indigo-500 to-violet-500',
  },
  {
    title: 'AI Training Advisor',
    description:
      'After every run, Claude analyzes your notebook code, metrics, and history — and tells you exactly which features and code changes will improve your next model.',
    icon: SparklesIcon,
    accent: 'from-fuchsia-500 to-pink-500',
  },
  {
    title: 'Real-time Observability',
    description:
      'Live log streaming over WebSockets, phase-by-phase timelines, and metric charts across runs — no terminal required.',
    icon: PulseIcon,
    accent: 'from-emerald-500 to-teal-500',
  },
  {
    title: 'Instant Model Serving',
    description:
      'Models that pass the accuracy threshold are served behind a REST endpoint immediately, with one-click rollback to previous versions.',
    icon: ServerIcon,
    accent: 'from-amber-500 to-orange-500',
  },
];

const PIPELINE_STEPS = ['git push', 'validate', 'train', 'register', 'deploy', 'AI feedback'];

export default function Landing() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Background decoration */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="absolute top-1/3 -right-20 h-96 w-96 rounded-full bg-fuchsia-600/10 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-72 w-72 rounded-full bg-emerald-600/10 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #94a3b8 1px, transparent 1px), linear-gradient(to bottom, #94a3b8 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
      </div>

      {/* Nav */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30">
            <BoltIcon />
          </div>
          <span className="text-lg font-bold tracking-tight">MLOps Platform</span>
        </div>
        <Link
          to="/login"
          className="rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-2 text-sm font-medium text-slate-200 backdrop-blur transition hover:border-indigo-500 hover:text-white"
        >
          Sign in
        </Link>
      </header>

      {/* Hero */}
      <main className="relative z-10 mx-auto max-w-6xl px-6">
        <section className="flex flex-col items-center pt-16 pb-20 text-center sm:pt-24">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-1.5 text-xs font-medium text-indigo-300">
            <SparklesIcon className="h-3.5 w-3.5" />
            Now with an AI advisor powered by Claude
          </span>
          <h1 className="max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">
            From notebook to{' '}
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
              deployed model
            </span>{' '}
            in one push
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-slate-400">
            The MLOps platform that trains, evaluates, and deploys your models automatically —
            then tells you how to make them better.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/login"
              className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-8 py-3.5 text-sm font-semibold text-white shadow-xl shadow-indigo-600/30 transition hover:scale-[1.02] hover:shadow-indigo-500/40"
            >
              Get started &rarr;
            </Link>
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-slate-700 bg-slate-900/60 px-8 py-3.5 text-sm font-semibold text-slate-300 backdrop-blur transition hover:border-slate-500"
            >
              View docs
            </a>
          </div>

          {/* Pipeline flow strip */}
          <div className="mt-16 flex w-full flex-wrap items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/50 px-6 py-5 backdrop-blur sm:gap-0">
            {PIPELINE_STEPS.map((step, i) => (
              <div key={step} className="flex items-center">
                <span
                  className={`rounded-lg px-3 py-1.5 font-mono text-xs sm:text-sm ${
                    i === 0
                      ? 'bg-slate-800 text-emerald-300'
                      : i === PIPELINE_STEPS.length - 1
                        ? 'bg-fuchsia-500/15 text-fuchsia-300 ring-1 ring-fuchsia-500/30'
                        : 'bg-slate-800/70 text-slate-300'
                  }`}
                >
                  {step}
                </span>
                {i < PIPELINE_STEPS.length - 1 && (
                  <span className="mx-2 hidden text-slate-600 sm:inline">&rarr;</span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="pb-24">
          <div className="grid gap-6 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur transition hover:border-slate-600"
              >
                <div
                  className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${f.accent} shadow-lg`}
                >
                  <f.icon className="h-5 w-5 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-slate-100">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* AI advisor spotlight */}
        <section className="pb-24">
          <div className="overflow-hidden rounded-3xl border border-fuchsia-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-fuchsia-950/40 p-8 sm:p-12">
            <div className="grid items-center gap-10 lg:grid-cols-2">
              <div>
                <span className="text-xs font-semibold uppercase tracking-widest text-fuchsia-400">
                  AI Training Advisor
                </span>
                <h2 className="mt-3 text-3xl font-bold leading-snug">
                  Every run reviewed by an expert — automatically
                </h2>
                <p className="mt-4 text-slate-400">
                  The advisor reads your actual notebook code, compares this run&apos;s metrics
                  against your history, and returns a prioritized action plan: features to
                  engineer, hyperparameters to tune, and code snippets ready to paste.
                </p>
                <ul className="mt-6 space-y-2 text-sm text-slate-300">
                  {[
                    'Diagnosis: overfitting, leakage, weak features',
                    'Recommendations with code targeting your variables',
                    'Failure runs get root-cause analysis',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-fuchsia-400" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/80 p-5 font-mono text-xs leading-relaxed text-slate-300 shadow-2xl">
                <p className="text-fuchsia-400"># Mejoras recomendadas</p>
                <p className="mt-2 text-slate-400">
                  1. La accuracy bajó de <span className="text-emerald-400">0.94</span> a{' '}
                  <span className="text-red-400">0.87</span> — el nuevo split no está
                  estratificado:
                </p>
                <pre className="mt-2 rounded bg-slate-900 p-3 text-[11px] text-indigo-300">
{`X_train, X_test = train_test_split(
    X, y, stratify=y, random_state=42
)`}
                </pre>
                <p className="mt-2 text-slate-400">
                  2. Añade la feature <span className="text-amber-300">petal_ratio</span> —
                  correlaciona con la clase minoritaria...
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Footer CTA */}
        <section className="pb-20 text-center">
          <h2 className="text-2xl font-bold">Ready to ship better models, faster?</h2>
          <Link
            to="/login"
            className="mt-6 inline-block rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-8 py-3.5 text-sm font-semibold text-white shadow-xl shadow-indigo-600/30 transition hover:scale-[1.02]"
          >
            Sign in to your dashboard
          </Link>
          <p className="mt-10 text-xs text-slate-600">
            MLOps Automation Platform &middot; FastAPI &middot; Celery &middot; MLflow &middot; Claude
          </p>
        </section>
      </main>
    </div>
  );
}

/* ---- Icons ---- */

function BoltIcon() {
  return (
    <svg className="h-5 w-5 text-white" fill="currentColor" viewBox="0 0 24 24">
      <path d="M13 2L4.09 12.11a.6.6 0 00.45 1h5.05l-1.54 7.94a.3.3 0 00.53.25L19.91 11.9a.6.6 0 00-.45-1h-5.05l1.54-7.94a.3.3 0 00-.53-.25z" />
    </svg>
  );
}

function RocketIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.63 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84" />
    </svg>
  );
}

function SparklesIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.29 6.86L21 12l-5.71 2.14L13 21l-2.29-6.86L5 12l5.71-2.14L13 3z" />
    </svg>
  );
}

function PulseIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h4l3-9 4 18 3-9h4" />
    </svg>
  );
}

function ServerIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12H3l9-9 9 9h-2M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 21v-6a1 1 0 011-1h4a1 1 0 011 1v6" />
    </svg>
  );
}

function CheckIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
