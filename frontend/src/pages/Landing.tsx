import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import githubLogo from '../assets/github_icon.webp'
import signInIcon from '../assets/opendoor_icon.svg'
import MicroSlats from '@/components/MicroSlats';
import { ScrollVelocity } from '@/components/ScrollVelocity';
import { useMediaQuery } from 'react-responsive';
import righarrow_icon from '../assets/rightarrow_icon.svg';
import { PipelineTimeline, type PipelineStep } from '@/components/PipelineTimeline';
import { Database, GitBranch, Cpu, Rocket, LineChart, ShieldCheck, Sparkles, ChevronDown, BookOpen } from "lucide-react";
import AboutUs from "@/components/AboutUs/AboutUs";


const steps: PipelineStep[] = [
  {
    title: "Git extraction",
    description:
      "Push a training notebook to GitHub. Maia's webhook extracts it from the repo and kicks off the pipeline.",
    icon: <GitBranch />,
  },
  {
    title: "Ingest",
    description:
      "Connect MySQL, Postgres, CSV or Excel sources. Data flows repeatable through bronze, silver and gold layers.",
    icon: <Database />,
  },
  {
    title: "Train",
    description:
      "Push a notebook to GitHub. Maia validates it and executes it with papermill in an isolated container — live logs included.",
    icon: <Cpu />,
  },
  {
    title: "Track",
    description:
      "Every run logs params, metrics and artifacts to MLflow, so nothing is lost between experiments.",
    icon: <LineChart />,
  },
  {
    title: "Quality gate",
    description:
      "Models below the accuracy threshold are never deployed. The gate decides, not you.",
    icon: <ShieldCheck />,
  },
  {
    title: "Deploy",
    description:
      "Approved models are served behind a REST endpoint — with one-click rollback to any previous version.",
    icon: <Rocket />,
  },
  {
    title: "Improve",
    description:
      "After every run, the AI advisor reads your code and metrics and tells you what to change next.",
    icon: <Sparkles />,
  },
];

const HEADER_SCROLL_DOWN_THRESHOLD = 320;
const HEADER_SCROLL_UP_THRESHOLD = 280;

export default function Landing() {
  const [isScrolled, setIsScrolled] = useState(false);
  const isMobile = useMediaQuery({ maxWidth: 768 })
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled((currentlyScrolled) =>
        currentlyScrolled
          ? window.scrollY > HEADER_SCROLL_UP_THRESHOLD
          : window.scrollY >= HEADER_SCROLL_DOWN_THRESHOLD
      );
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
      <header className={`sticky top-2 z-20 mx-auto w-[calc(100%-1rem)] rounded-2xl flex items-center justify-between transition-all duration-300 ease-out ${isScrolled ? 'max-w-4xl  bg-slate-900/90 px-4 py-3 shadow-lg backdrop-blur-sm' : 'max-w-6xl px-6 py-6'}`}>
        <div className={`gap-2 inline-flex rounded-lg items-center py-2 text-sm font-medium text-slate-200 transition-[padding] duration-300 hover:border-indigo-500 hover:text-white ${isScrolled ? 'px-2' : 'px-4'}`}>
          <div className={`flex items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30 transition-all duration-300 ${isScrolled ? 'h-8 w-8' : 'h-9 w-8'}`}>
            <BoltIcon />
          </div>
          <span className={`text-2xl font-bold font-display inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ease-out max-[640px]:text-xl ${!isScrolled ? 'max-w-0 -translate-x-1 opacity-0' : 'max-w-[5rem] translate-x-0 opacity-100'}`}>Maia</span>
        </div>

        <div className='flex items-center gap-2 sm:gap-3'>
          <a href='#about' aria-label='About Us' className={`inline-flex items-center rounded-lg border border-slate-700 bg-slate-900/60 py-2 text-sm max-[640px]:text-xs font-medium text-slate-200 hover:border-indigo-500 hover:text-white transition-[gap,padding] duration-300 ${isScrolled ? 'gap-0 px-2' : 'gap-2 px-3'} `}>
            <BookOpen className='h-5 w-5' />
            <span aria-hidden='true' className={`font-body inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ease-out  ${isScrolled ? 'max-w-0 -translate-x-1 opacity-0' : 'max-w-[6rem] translate-x-0 opacity-100'}`}>About Us</span>
          </a>
          <a href='https://github.com/CamiloDlRM/KUBEFLOW_IA_TEST' target='_blank' rel='noreferrer' aria-label='Ver repositorio en GitHub' className={`inline-flex items-center rounded-lg border border-slate-700 bg-slate-900/60 py-2 text-sm max-[640px]:text-xs font-medium text-slate-200 hover:border-slate-500 hover:text-white transition-[gap,padding] duration-300 ${isScrolled ? 'gap-0 px-2' : 'gap-2 px-3'} `}>
            <img src={githubLogo} className='object-contain h-5 w-5' />
            <span aria-hidden='true' className={`font-body inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ease-out  ${isScrolled ? 'max-w-0 -translate-x-1 opacity-0' : 'max-w-[5rem] translate-x-0 opacity-100'}`}>GitHub</span>
          </a>
          <Link to="/login" className={`inline-flex rounded-lg items-center border border-slate-700 bg-slate-900/60 py-2 text-sm max-[640px]:text-xs font-medium text-slate-200 transition-[padding] duration-300 hover:border-indigo-500 hover:text-white ${isScrolled ? 'gap-0 px-2' : 'gap-1 px-4'}`}>
            <img src={signInIcon} className='object-contain h-5 w-5' />
            <span className={`font-body inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ease-out ${isScrolled ? 'max-w-0 -translate-x-1 opacity-0' : 'max-w-[5rem] translate-x-0 opacity-100'}`}>Sign In</span>
          </Link>
        </div>


      </header>


      {/* Hero */}
      <main className="font-body relative z-10 mx-auto max-w-6xl px-6">

        <section className="flex min-h-[100svh] -translate-y-20 flex-col items-center justify-center px-6 text-center">
          <h1 className="max-w-2xl mt-0 text-7xl font-extrabold leading-tight tracking-tight max-[640px]:text-5xl">
            Welcome to {' '}
            <span className="font-display bg-gradient-to-r from-indigo-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
              Maia
            </span>
            !
          </h1>
          <h2 className="max-w-2xl text-5xl font-semibold leading-tight tracking-tight max-[640px]:text-3xl"> From code to deployment</h2>
          <p className="font-body2 mt-8 max-w-2xl text-lg text-slate-300 max-[640px]:text-sm">
            The platform that automatically extracts, trains, evaluates, and deploys your models, and then tells you how to improve them.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/login"
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-8 py-3.5 text-sm max-[640px]:text-xs font-semibold text-white shadow-xl shadow-indigo-600/30 transition-all duration-300 ease-in hover:scale-[1.02] hover:shadow-indigo-500/40"
            >
              Get started
              <img className='h-4 w-4' src={righarrow_icon} />
            </Link>
          </div>
          <div className="flex flex-col items-center gap-1 text-slate-400 translate-y-20">
            <span className="font-body text-xs font-semibold uppercase tracking-[0.3em]">
              Swipe down
            </span>
            <div className="flex animate-bounce flex-col items-center -space-y-3 text-indigo-400">
              <ChevronDown className="h-5 w-5" />
              <ChevronDown className="h-5 w-5" />
            </div>
          </div>
        </section>



        <motion.section
          className="mb-36 flex flex-col items-center justify-center gap-11"
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: false, amount: 0.2 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        >
          <h1 className="text-5xl font-bold max-[640px]:text-3xl">How we work?</h1>
          <PipelineTimeline steps={steps} />
        </motion.section>

        {/* About Us */}
        <AboutUs />


        {/* AI advisor spotlight */}
        <motion.section
          className="pb-24"
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: false, amount: 0.5 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        >
          <div className="overflow-hidden rounded-3xl mb-13 border border-fuchsia-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-fuchsia-950/40 p-5 shadow-xl shadow-fuchsia-950/10 transition-all duration-300 ease-out hover:-translate-y-1 hover:border-fuchsia-400/40 hover:shadow-2xl hover:shadow-fuchsia-500/15 sm:p-8 lg:p-12">
            <div className="grid min-w-0 grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-10">
              <div className="min-w-0">
                <span className="font-display text-xs font-semibold uppercase tracking-widest text-fuchsia-400 sm:text-sm">
                  AI Training Advisor
                </span>
                <h2 className="font-body mt-3 max-w-3xl text-2xl font-bold leading-snug sm:text-3xl">
                  Every run reviewed by an expert — automatically
                </h2>
                <p className="font-body2 mt-4 max-w-3xl text-sm leading-relaxed text-slate-400 sm:text-base">
                  The advisor reads your actual notebook code, compares this run&apos;s metrics
                  against your history, and returns a prioritized action plan: features to
                  engineer, hyperparameters to tune, and code snippets ready to paste.
                </p>
                <ul className="font-body2 mt-6 space-y-2 text-sm text-slate-300">
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
              <div className="min-w-0 overflow-hidden rounded-xl border border-slate-700 bg-slate-950/80 p-4 font-display text-xs leading-relaxed text-slate-300 shadow-2xl sm:p-5">
                <p className="text-fuchsia-400"># Upgrade Suggestions</p>
                <p className="mt-2 text-slate-400">
                  1. The accuracy grow down from <span className="text-emerald-400">0.94</span> to{' '}
                  <span className="text-red-400">0.87</span> — the new split is not stratified:
                </p>
                <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-3 text-[11px] text-indigo-300"> {`X_train, X_test = train_test_split(X, y, stratify=y, random_state=42)`}
                </pre>
                <p className="mt-2 text-slate-400">
                  2. Add the feature <span className="text-amber-300">petal_ratio</span> —
                  co-occurring with the minority class...
                </p>
              </div>
            </div>
          </div>
        </motion.section>

        <section className="flex flex-col gap-5 font-body pb-10 text-center">
          <h2 className="text-3xl max-[640px]:text-xl font-bold">Ready to create better models?</h2>
          <Link
            to="/login" className="inline-flex w-fit self-center items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-8 py-3.5 text-sm max-[640px]:text-xs font-semibold text-white shadow-xl shadow-indigo-600/30 transition-all duration-300 ease-in hover:scale-[1.02] hover:shadow-indigo-500/40">
            Sign in to your dashboard
          </Link>
          <div className="relative mt-8 left-1/2 w-11/12 -translate-x-1/2">
            <ScrollVelocity
              texts={['Ingest  •  Train  •  Version  •  Deploy  •  Improve  •  Repeat  •']}
              velocity={40}
              className="custom-scroll-text"
              numCopies={100}
              damping={50}
              stiffness={400}
            />
          </div>
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

function CheckIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
