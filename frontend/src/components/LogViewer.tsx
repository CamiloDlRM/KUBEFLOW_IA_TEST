import { useEffect, useRef } from 'react';
import type { WebSocketLogMessage, ConnectionStatus } from '../types';

interface LogViewerProps {
  messages: WebSocketLogMessage[];
  status: ConnectionStatus;
}

const statusColors: Record<ConnectionStatus, string> = {
  connecting: 'text-yellow-400',
  connected: 'text-emerald-400',
  disconnected: 'text-red-400',
  reconnecting: 'text-yellow-400',
};

const statusLabels: Record<ConnectionStatus, string> = {
  connecting: 'Connecting...',
  connected: 'Connected',
  disconnected: 'Disconnected',
  reconnecting: 'Reconnecting...',
};

function logLevelColor(phase: string, logStatus: string): string {
  if (logStatus === 'failed') return 'text-red-400';
  if (phase === 'complete') return 'text-emerald-400';
  return 'text-slate-300';
}

export default function LogViewer({ messages, status }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col rounded-lg border border-slate-700 bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-2">
        <span className="text-xs font-medium text-slate-400">Pipeline Logs</span>
        <span className={`flex items-center gap-1.5 text-xs font-medium ${statusColors[status]}`}>
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              status === 'connected' ? 'bg-emerald-400' : status === 'disconnected' ? 'bg-red-400' : 'bg-yellow-400 animate-pulse'
            }`}
          />
          {statusLabels[status]}
        </span>
      </div>

      {/* Log body */}
      <div
        ref={containerRef}
        className="h-80 overflow-y-auto p-4 font-mono text-xs leading-relaxed"
      >
        {messages.length === 0 ? (
          <p className="text-slate-500">Waiting for log output...</p>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className="flex gap-2">
              <span className="shrink-0 text-slate-600">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
              <span className="shrink-0 w-20 text-slate-500">[{msg.phase}]</span>
              <span className={logLevelColor(msg.phase, msg.status)}>
                {msg.logs}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
