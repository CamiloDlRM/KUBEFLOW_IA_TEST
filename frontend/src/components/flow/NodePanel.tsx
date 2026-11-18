import type { ReactNode } from 'react';
import { X } from 'lucide-react';

/** One width for every node, so the panel does not jump as you move between them.
 *  Half the canvas, within these bounds, so it stays proportional on smaller screens. */
const PANEL_MAX_WIDTH = 860;
const PANEL_MIN_WIDTH = 360;
const PANEL_SHARE = 0.5;
export function panelWidthFor(canvasWidth: number) {
    if (!canvasWidth) return PANEL_MAX_WIDTH;
    return Math.round(Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, canvasWidth * PANEL_SHARE)));
}
/** Gap between the panel and the right edge of the canvas. */
export const PANEL_MARGIN = 40;
/** Starts below the Run button and the project picker, so it never covers them. */
const PANEL_TOP = 80;
const PANEL_BOTTOM = 40;

interface NodePanelProps {
    title: string;
    caption: string;
    onClose: () => void;
    children: ReactNode;
    /** Replaces the title's colour, e.g. Maia's name in the app's gradient. */
    titleClassName?: string;
    /** From panelWidthFor, so the canvas can keep Maia and the focused node clear of it. */
    width: number;
}

export default function NodePanel({ title, caption, onClose, children, titleClassName = 'text-slate-100', width }: NodePanelProps) {
    return (
        <aside className="absolute z-10 flex flex-col overflow-hidden rounded-2xl font-body border border-slate-700 bg-slate-900/95 shadow-2xl backdrop-blur"
            style={{ top: PANEL_TOP, right: PANEL_MARGIN, bottom: PANEL_BOTTOM, width, maxWidth: `calc(100% - ${PANEL_MARGIN * 2}px)` }}>
            <header className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
                <div className="min-w-0 flex-1">
                    <h3 className={`font-display text-base font-semibold ${titleClassName}`}>{title}</h3>
                    <p className="mt-0.5 font-body2 text-xs text-slate-500">{caption}</p>
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