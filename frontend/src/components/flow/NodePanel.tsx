import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export const PANEL_WIDTH = 480;
export const PANEL_MARGIN = 16;

interface NodePanelProps {
    title: string;
    caption: string;
    onClose: () => void;
    children: ReactNode;
}

export default function NodePanel({ title, caption, onClose, children }: NodePanelProps) {
    return (
        <aside className="absolute z-10 flex flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/95 shadow-2xl backdrop-blur"
            style={{ top: PANEL_MARGIN, right: PANEL_MARGIN, bottom: PANEL_MARGIN, width: PANEL_WIDTH, maxWidth: `calc(100% - ${PANEL_MARGIN * 2}px)` }}>
            <header className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
                <div className="min-w-0">
                    <h3 className="font-display text-base font-semibold text-slate-100">{title}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">{caption}</p>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close panel"
                    className="rounded-md p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
                >
                    <X size={16} aria-hidden="true" />
                </button>
            </header>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </aside>
    )
}