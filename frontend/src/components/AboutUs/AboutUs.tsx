import { motion } from 'motion/react';
import { GitBranch, Layers, Brain, BarChart3, ShieldCheck, GitCommit } from "lucide-react";

export default function AboutUs() {
  return (
    <motion.section
      id="about"
      className="mb-36"
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: false, amount: 0.2 }}
      transition={{ duration: 0.7, ease: 'easeOut' }}
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 text-center">
          <span className="font-display text-xs font-semibold uppercase tracking-widest text-indigo-400 sm:text-sm">
            About Us
          </span>
          <h2 className="font-body mt-3 text-4xl font-bold leading-tight max-[640px]:text-3xl">
            From experiment to production
          </h2>
          <p className="font-body2 mt-4 mx-auto max-w-3xl text-base leading-relaxed text-slate-300 max-[640px]:text-sm">
            Maia is an end-to-end MLOps platform that automates the path from a training notebook to a deployed, traceable model. Our goal is to reduce manual intervention while keeping full control, governance, and reproducibility throughout the ML lifecycle.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="group relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-6 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-indigo-400/40 hover:shadow-indigo-500/10">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 text-indigo-400">
              <GitBranch className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-semibold">Push-to-deploy from Git</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Connect your repository, push a notebook, and Maia orchestrates extraction, validation, and execution with live logs.
            </p>
          </div>

          <div className="group relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-6 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-indigo-400/40 hover:shadow-indigo-500/10">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 text-indigo-400">
              <Layers className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-semibold">Governed data with medallion layers</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              ELT organized in bronze, silver, and gold layers ensures traceability from source to training data with auditable transformations.
            </p>
          </div>

          <div className="group relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-6 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-indigo-400/40 hover:shadow-indigo-500/10">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 text-indigo-400">
              <BarChart3 className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-semibold">Tracked, evaluated, deployed</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Every run is tracked in MLflow with metrics and artifacts. Quality gates decide promotion; models are served with one-click rollback.
            </p>
          </div>

          <div className="group relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-6 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-indigo-400/40 hover:shadow-indigo-500/10">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 text-indigo-400">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-semibold">Governance & auditability</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              User ownership, role-based access, full traceability of code/data/models, and human-in-the-loop for AI-suggested changes.
            </p>
          </div>

          <div className="group relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-6 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-indigo-400/40 hover:shadow-indigo-500/10 sm:col-span-2 lg:col-span-1 lg:col-start-2">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 text-indigo-400">
              <GitCommit className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-semibold">Our focus</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Make MLOps reproducible, transparent, and accessible — bridging experimentation and production with a modular, open approach for teams and education.
            </p>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
