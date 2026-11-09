import type { PipelinePhase, WebSocketLogMessage } from '../../types';
import type { PhaseCard } from '../canvas/phases';

/**
 * Which node of the canvas each log line belongs to, so a failed run's error
 * sits on the node that broke rather than at the end of one long log.
 *
 * - Input: what happens before the notebook — download, validation, mounting
 *   the data, and papermill starting.
 * - A phase: what its own cells printed and raised. Taken from the run's
 *   cells, which know their phase; the execute log numbers cells differently
 *   (markdown and the injected parameters count there), so it cannot be split.
 * - Model: registration, deployment and the end of the run.
 *
 * The run's final error goes to whichever node broke.
 */

const BEFORE_NOTEBOOK = new Set(['download', 'validate', 'dataset']);
const AFTER_NOTEBOOK = new Set(['register', 'deploy', 'complete']);
const ENDINGS = new Set(['error', 'shutdown']);

/** The execute step's dump of every cell's output, as one JSON message. */
function isCellDump(msg: WebSocketLogMessage): boolean {
  if (msg.phase !== 'execute') return false;
  try {
    const parsed = JSON.parse(msg.logs);
    return Array.isArray(parsed) && (parsed.length === 0 || 'cell' in parsed[0]);
  } catch {
    return false;
  }
}

export interface ErrorPlace {
  cards: PhaseCard[] | undefined;
  modelStatus: string;
  /** The backend step that failed, when known. */
  stage?: string;
}

/** The node a failed run's error belongs on: the one that broke. */
export function errorNodeOf({ cards, modelStatus, stage }: ErrorPlace): string {
  const failedPhase = cards?.find((card) => card.status === 'failed');
  if (failedPhase) return failedPhase.id;
  if (modelStatus === 'failed' || (stage && AFTER_NOTEBOOK.has(stage))) return 'model';
  return 'input';
}

/** The run's log lines that belong to `nodeId`. */
export function logsForNode(nodeId: string, messages: WebSocketLogMessage[], errorNode: string): WebSocketLogMessage[] {
  return messages.filter((msg) => {
    if (ENDINGS.has(msg.phase)) return nodeId === errorNode;
    if (nodeId === 'input') return BEFORE_NOTEBOOK.has(msg.phase) || (msg.phase === 'execute' && !isCellDump(msg));
    if (nodeId === 'model') return AFTER_NOTEBOOK.has(msg.phase);
    return false;
  });
}

/**
 * Every log line of a run. The run's phases are the record — kept in the
 * database for good, where Redis drops its copy after a day — and while the
 * run is in flight the WebSocket adds whatever came after the last saved one.
 */
export function runLogLines(
  pipelineId: string,
  phases: PipelinePhase[],
  live: WebSocketLogMessage[] = [],
): WebSocketLogMessage[] {
  const saved = phases.map((phase) => ({
    pipeline_id: pipelineId,
    phase: phase.name,
    status: phase.status,
    logs: phase.logs,
    timestamp: phase.timestamp,
  }));
  // Both sides stamp with the worker's ISO UTC clock, so the strings compare in time order.
  const last = saved[saved.length - 1]?.timestamp ?? '';
  return [...saved, ...live.filter((msg) => msg.timestamp > last)];
}

/** A phase's cells as log lines: what each printed, then any error it raised. */
export function cellLogs(card: PhaseCard | undefined, pipelineId: string, timestamp: string): WebSocketLogMessage[] {
  if (!card) return [];
  return card.cells.flatMap((cell) => {
    const line = (status: string, logs: string) => ({
      pipeline_id: pipelineId,
      phase: `cell ${cell.index + 1}`,
      status,
      logs,
      timestamp,
    });
    return [
      ...(cell.output.trim() ? [line('success', cell.output.trimEnd())] : []),
      ...(cell.error.trim() ? [line('failed', cell.error.trimEnd())] : []),
    ];
  });
}
