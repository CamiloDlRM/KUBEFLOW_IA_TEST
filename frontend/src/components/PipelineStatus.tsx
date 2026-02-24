import type { PipelineStatus as PipelineStatusType } from '../types';

interface PipelineStatusProps {
  status: PipelineStatusType | string;
  className?: string;
}

const statusConfig: Record<string, { bg: string; text: string; dot: string; animate?: boolean }> = {
  queued: { bg: 'bg-slate-700', text: 'text-slate-300', dot: 'bg-slate-400' },
  running: { bg: 'bg-blue-900/50', text: 'text-blue-300', dot: 'bg-blue-400', animate: true },
  success: { bg: 'bg-emerald-900/50', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  failed: { bg: 'bg-red-900/50', text: 'text-red-300', dot: 'bg-red-400' },
};

export default function PipelineStatus({ status, className = '' }: PipelineStatusProps) {
  const config = statusConfig[status] ?? statusConfig.queued;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bg} ${config.text} ${className}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${config.dot} ${config.animate ? 'animate-pulse-fast' : ''}`}
      />
      {status}
    </span>
  );
}
