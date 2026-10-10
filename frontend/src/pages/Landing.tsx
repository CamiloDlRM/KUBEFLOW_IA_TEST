import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import githubLogo from '../assets/github_icon.webp'
import signInIcon from '../assets/opendoor_icon.svg'
import MicroSlats from '@/components/MicroSlats';
import { useMediaQuery } from 'react-responsive';
import righarrow_icon from '../assets/rightarrow_icon.svg';
import { PipelineTimeline, type PipelineStep } from '@/components/PipelineTimeline';
import { Database, GitBranch, Cpu, Rocket } from "lucide-react";


const steps: PipelineStep[] = [
  { title: "Ingesta", description: "Descripción del paso.", icon: <Database /> },
  { title: "Entrenamiento", description: "Descripción del paso.", icon: <Cpu /> },
  { title: "Versionado", description: "Descripción del paso.", icon: <GitBranch /> },
  { title: "Despliegue", description: "Descripción del paso.", icon: <Rocket /> },
];

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
  const [isScrolled, setIsScrolled] = useState(false);
  const isMobile = useMediaQuery({maxWidth:768})
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 24);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);
  return (
    <div className="min-h-screen overflow-x-clip text-slate-100">
      {/* Background decoration */}

      <div className='fixed inset-0 pointer-events-none'>
        <MicroSlats
          preset="swell"
          color="#0f172a"
          glintColor="#818cf8"
          backgroundColor="#020617"
          slatWidth={10}
          slatHeight={25}
          gap={3}
          roundness={0.75}
          interactive={!isMobile}
          cursorStrength={1}
          cursorSize={40}
          swirl={0}
          trail={1.4}
          lean={0}
          intro
          scale={1.5}
          speed={0.6}
          direction={250}
          chop={0.55}
          stretch={0}
          glint={0.7}
          contrast={1.25}
          perspective={0.55}
          fog={0.55}
          introDuration={1.5}
          paused={false}
      />
      </div>

      {/* Nav */}
      <header className={`sticky top-2 z-20 mx-auto w-[calc(100%-1rem)] rounded-2xl flex items-center justify-between transition-all duration-300 ease-out ${isScrolled ? 'max-w-4xl  bg-slate-900/90 px-4 py-3 shadow-lg backdrop-blur-sm':'max-w-6xl px-6 py-6'}`}>
        <div className={`gap-2 inline-flex rounded-lg items-center py-2 text-sm font-medium text-slate-200 transition-[padding] duration-300 hover:border-indigo-500 hover:text-white ${isScrolled ? 'px-2': 'px-4'}`}>
          <div className={`flex items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30 transition-all duration-300 ${isScrolled ? 'h-8 w-8': 'h-9 w-8'}`}>
            <BoltIcon />
          </div>
          <span className={`text-xl font-bold font-display inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ease-out ${!isScrolled ? 'max-w-0 -translate-x-1 opacity-0' : 'max-w-[5rem] translate-x-0 opacity-100'}`}>Maia</span>
        </div>

        <div className='flex items-center gap-3'>
          <a href='https://github.com/CamiloDlRM/KUBEFLOW_IA_TEST' target='_blank' rel='noreferrer' aria-label='Ver repositorio en GitHub' className={`inline-flex items-center rounded-lg border border-slate-700 bg-slate-900/60 py-2 text-sm font-medium text-slate-200 hover:border-slate-500 hover:text-white transition-[gap,padding] duration-300 ${isScrolled ? 'gap-0 px-2': 'gap-2 px-3'} `}>
            <img src={githubLogo} className='object-contain h-5 w-5' />
            <span aria-hidden='true' className={`font-body inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ease-out ${isScrolled ? 'max-w-0 -translate-x-1 opacity-0' : 'max-w-[5rem] translate-x-0 opacity-100'}`}>GitHub</span>
          </a>
          <Link to="/login" className={`inline-flex rounded-lg items-center border border-slate-700 bg-slate-900/60 py-2 text-sm font-medium text-slate-200 transition-[padding] duration-300 hover:border-indigo-500 hover:text-white ${isScrolled ? 'gap-0 px-2': 'gap-1 px-4'}`}>
            <img src={signInIcon} className='object-contain h-5 w-5'/>
            <span className={`font-body inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ease-out ${isScrolled ? 'max-w-0 -translate-x-1 opacity-0' : 'max-w-[5rem] translate-x-0 opacity-100'}`}>Sign In</span>
          </Link>
        </div>


      </header>


      {/* Hero */}
      <main className="font-body relative z-10 mx-auto max-w-6xl px-6">

        <section className="flex flex-col items-center pt-16 pb-20 text-center sm:pt-24">
          <h1 className="max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">
            Welcome to {' '}
            <span className="font-display bg-gradient-to-r from-indigo-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
              Maia
            </span>
            !
          </h1>
          <h2 className="max-w-2xl text-2xl font-semibold leading-tight tracking-tight sm:text-5xl"> From code to deployment</h2>
          <p className="font-body2 mt-8 max-w-2xl text-lg text-slate-300">
            The platform that automatically extracts, trains, evaluates, and deploys your models, and then tells you how to improve them.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/login"
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-8 py-3.5 text-sm font-semibold text-white shadow-xl shadow-indigo-600/30 transition-all duration-300 ease-in hover:scale-[1.02] hover:shadow-indigo-500/40"
            >
              Get started
              <img className='h-4 w-4' src={righarrow_icon} />
            </Link>
          </div>

          <section className="px-6 py-24">
            <PipelineTimeline steps={steps} />
          </section>

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
