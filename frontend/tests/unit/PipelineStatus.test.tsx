import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PipelineStatus from '../../src/components/PipelineStatus';

describe('PipelineStatus', () => {
  it('renders queued badge with correct gray styling', () => {
    render(<PipelineStatus status="queued" />);

    const badge = screen.getByText('queued');
    expect(badge).toBeInTheDocument();
    // The parent span should have the gray/slate styling
    expect(badge.className).toContain('bg-slate-700');
    expect(badge.className).toContain('text-slate-300');
  });

  it('renders running badge with blue animated styling', () => {
    render(<PipelineStatus status="running" />);

    const badge = screen.getByText('running');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-blue-900');
    expect(badge.className).toContain('text-blue-300');

    // The dot inside should have the pulse animation
    const dot = badge.querySelector('span');
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain('animate-pulse');
  });

  it('renders success badge with green styling', () => {
    render(<PipelineStatus status="success" />);

    const badge = screen.getByText('success');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-emerald-900');
    expect(badge.className).toContain('text-emerald-300');
  });

  it('renders failed badge with red styling', () => {
    render(<PipelineStatus status="failed" />);

    const badge = screen.getByText('failed');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-red-900');
    expect(badge.className).toContain('text-red-300');
  });

  it('renders unknown status with fallback queued styling', () => {
    render(<PipelineStatus status="unknown" />);

    const badge = screen.getByText('unknown');
    expect(badge).toBeInTheDocument();
    // Falls back to queued styling
    expect(badge.className).toContain('bg-slate-700');
  });

  it('applies additional className when provided', () => {
    render(<PipelineStatus status="success" className="extra-class" />);

    const badge = screen.getByText('success');
    expect(badge.className).toContain('extra-class');
  });
});
