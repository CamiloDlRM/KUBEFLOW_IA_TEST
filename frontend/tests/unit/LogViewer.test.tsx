import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LogViewer from '../../src/components/LogViewer';
import type { WebSocketLogMessage, ConnectionStatus } from '../../src/types';

const createMessage = (
  phase: string,
  status: string,
  logs: string,
  timestamp = '2026-02-23T10:00:00Z',
): WebSocketLogMessage => ({
  pipeline_id: 'test-pipeline',
  phase,
  status,
  logs,
  timestamp,
});

describe('LogViewer', () => {
  it('renders empty state when no messages', () => {
    render(<LogViewer messages={[]} status="connected" />);

    expect(screen.getByText(/Waiting for log output/i)).toBeInTheDocument();
  });

  it('renders log messages with timestamps', () => {
    const messages = [
      createMessage('download', 'success', 'Downloaded notebook', '2026-02-23T10:00:00Z'),
      createMessage('validate', 'running', 'Validating tags', '2026-02-23T10:00:01Z'),
    ];

    render(<LogViewer messages={messages} status="connected" />);

    expect(screen.getByText('Downloaded notebook')).toBeInTheDocument();
    expect(screen.getByText('Validating tags')).toBeInTheDocument();
    // Phase labels should be displayed
    expect(screen.getByText('[download]')).toBeInTheDocument();
    expect(screen.getByText('[validate]')).toBeInTheDocument();
  });

  it('shows connected status when websocket is connected', () => {
    render(<LogViewer messages={[]} status="connected" />);

    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('shows reconnecting status when websocket is reconnecting', () => {
    render(<LogViewer messages={[]} status="reconnecting" />);

    expect(screen.getByText('Reconnecting...')).toBeInTheDocument();
  });

  it('shows disconnected status', () => {
    render(<LogViewer messages={[]} status="disconnected" />);

    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('shows connecting status', () => {
    render(<LogViewer messages={[]} status="connecting" />);

    expect(screen.getByText('Connecting...')).toBeInTheDocument();
  });

  it('applies error color to failed log entries', () => {
    const messages = [
      createMessage('execute', 'failed', 'Execution error: OOM'),
    ];

    render(<LogViewer messages={messages} status="connected" />);

    const logText = screen.getByText('Execution error: OOM');
    expect(logText.className).toContain('text-red-400');
  });

  it('applies success color to complete phase entries', () => {
    const messages = [
      createMessage('complete', 'success', 'Pipeline finished'),
    ];

    render(<LogViewer messages={messages} status="connected" />);

    const logText = screen.getByText('Pipeline finished');
    expect(logText.className).toContain('text-emerald-400');
  });

  it('renders Pipeline Logs header', () => {
    render(<LogViewer messages={[]} status="connected" />);

    expect(screen.getByText('Pipeline Logs')).toBeInTheDocument();
  });
});
