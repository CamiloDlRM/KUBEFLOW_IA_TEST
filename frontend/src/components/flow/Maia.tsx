import { useEffect, useId, useRef, type ReactNode } from 'react';
import './maia.css';
import AIInsights from '../AIInsights';
import type { PipelineView } from './usePipelineView';

/** Maia's panel is opened like a node's, under an id no node has. */
export const MAIA_PANEL = 'maia';

/**
 * How Maia feels about what is on screen:
 * - `calm`: her usual violet.
 * - `sad`: red, brows up in the middle, drooping slowly — a step failed.
 * - `alert`: amber, brows raised and her right tentacle up, waving — the run worked but
 *   its model was not deployed, and she has something to say about it.
 * - `happy`: green, eyes closed in a smile, swaying from side to side — the run worked and its
 *   model is deployed.
 */
export type MaiaMood = 'calm' | 'sad' | 'alert' | 'happy';

interface MoodPalette {
  head: [string, string, string, string];
  tentacle: [string, string, string];
  aura: string;
  pupil: string;
}

const PALETTES: Record<MaiaMood, MoodPalette> = {
  calm: {
    head: ['#EEEBFF', '#B9AEFF', '#7C68F0', '#4433B0'],
    tentacle: ['#5E4BD6', '#8E7DF7', '#D9D2FF'],
    aura: '#8B7CF6',
    pupil: '#5A47D4',
  },
  sad: {
    head: ['#FFE4E6', '#FCA5A5', '#E5484D', '#8F1D22'],
    tentacle: ['#B42328', '#EF5A5F', '#FECACA'],
    aura: '#F87171',
    pupil: '#7F1D1D',
  },
  alert: {
    head: ['#FFF7D6', '#FDE68A', '#F2A90C', '#A15C07'],
    tentacle: ['#B76E05', '#F5B529', '#FEF3C7'],
    aura: '#FBBF24',
    pupil: '#7A3E06',
  },
  happy: {
    head: ['#ECFDF5', '#A7F3D0', '#2FBF84', '#06704A'],
    tentacle: ['#058A5B', '#34D399', '#D1FAE5'],
    aura: '#34D399',
    pupil: '#065F46',
  },
};

/**
 * Maia's mood for the node the user has open. She reacts to the node, not just the
 * run, so the reaction says "this is the one": sad on the node where a failed run
 * broke, alert on Model when a run worked but its model was not deployed, happy on
 * Model when it worked and its model is deployed.
 */
export function maiaMoodFor(
  view: Pick<PipelineView, 'shownRun' | 'errorNode' | 'deployed'>,
  openNode: string | null,
): MaiaMood {
  const status = view.shownRun?.status;
  if (status === 'failed' && openNode === view.errorNode) return 'sad';
  if (status === 'success' && openNode === 'model') return view.deployed ? 'happy' : 'alert';
  return 'calm';
}

/** Colours as style, not attributes, so CSS can fade them from one mood to the next. */
const fill = (color: string) => ({ stopColor: color, transition: 'stop-color 500ms ease' });

/**
 * Maia, the face of the app's AI: the character from assets/maia.svg, drawn
 * inline so her parts can move. She bobs in the air, her tentacles sway and she
 * blinks (index.css, `.maia-*`; still under prefers-reduced-motion). With
 * `followCursor` she turns her head and eyes toward the pointer, and inside an
 * element marked `maia-hover` she closes her eyes while it is hovered.
 */
export function MaiaAvatar({
  size = 40,
  className = '',
  followCursor = false,
  swimming = null,
  mood = 'calm',
  reviewer = false,
}: {
  size?: number;
  className?: string;
  followCursor?: boolean;
  /** While she is being moved: she leans that way and her tentacles beat faster. */
  swimming?: 'left' | 'right' | null;
  mood?: MaiaMood;
  /** As she is in the notebook editor: glasses on and a pencil in her right tentacle. */
  reviewer?: boolean;
}) {
  // Gradient and filter ids are global in the page, and Maia can be on it more than once.
  const id = useId().replace(/:/g, '');
  const ref = (name: string) => `url(#${id}-${name})`;
  const svgRef = useRef<SVGSVGElement>(null);
  const headRef = useRef<SVGGElement>(null);
  const pupilsRef = useRef<SVGGElement>(null);
  const palette = PALETTES[mood];

  useEffect(() => {
    if (!followCursor) return;
    let frame = 0;
    function look(event: PointerEvent) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = svgRef.current?.getBoundingClientRect();
        if (!box) return;
        const dx = event.clientX - (box.left + box.width / 2);
        const dy = event.clientY - (box.top + box.height / 2);
        const distance = Math.hypot(dx, dy) || 1;
        // Far away she looks fully that way; close by, only a little.
        const reach = Math.min(distance / 200, 1);
        const x = (dx / distance) * reach;
        const y = (dy / distance) * reach;
        // Set as attributes, not React state: this runs on every pointer move.
        pupilsRef.current?.setAttribute('transform', `translate(${x * 6} ${y * 7})`);
        headRef.current?.setAttribute('transform', `rotate(${x * 8} 200 200) translate(${x * 4} ${y * 3})`);
      });
    }
    window.addEventListener('pointermove', look);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', look);
    };
  }, [followCursor]);

  // One tentacle: its thick stroke, the highlight along it, and anything it holds.
  const tentacle = (body: string, shine: string, extraClass = '', held: ReactNode = null) => (
    <g className={extraClass}>
      <path d={body} fill="none" stroke={ref('tent')} strokeWidth="30" strokeLinecap="round" />
      <path d={shine} fill="none" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" opacity="0.45" />
      {held}
    </g>
  );

  // Gripped at the tip of her right tentacle and leaning out, point down, as if about to write.
  const pencil = (
    <g transform="translate(294 270) rotate(25) translate(0 22)" stroke="#1E1B4B" strokeWidth="2" strokeLinejoin="round">
      <rect x="-7" y="-62" width="14" height="9" rx="3" fill="#F9A8D4" />
      <rect x="-7" y="-53" width="14" height="6" fill="#CBD5E1" />
      <rect x="-7" y="-47" width="14" height="40" fill="#FBBF24" />
      <path d="M-7 -7 L7 -7 L0 10 Z" fill="#FDE68A" />
      <path d="M-2.5 4 L2.5 4 L0 10 Z" fill="#1E1B4B" />
    </g>
  );

  return (
    <svg
      ref={svgRef}
      viewBox="65 65 270 270"
      width={size}
      height={size}
      aria-hidden="true"
      className={`maia maia-${mood} shrink-0 overflow-visible ${swimming ? `maia-swim-${swimming}` : ''} ${className}`}
    >
      <defs>
        <radialGradient id={`${id}-head`} cx="38%" cy="30%" r="75%">
          <stop offset="0" style={fill(palette.head[0])} />
          <stop offset="0.22" style={fill(palette.head[1])} />
          <stop offset="0.6" style={fill(palette.head[2])} />
          <stop offset="1" style={fill(palette.head[3])} />
        </radialGradient>
        <linearGradient id={`${id}-tent`} gradientUnits="userSpaceOnUse" x1="0" y1="230" x2="0" y2="320">
          <stop offset="0" style={fill(palette.tentacle[0])} />
          <stop offset="0.6" style={fill(palette.tentacle[1])} />
          <stop offset="1" style={fill(palette.tentacle[2])} />
        </linearGradient>
        <filter id={`${id}-blur-lg`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="22" />
        </filter>
        <filter id={`${id}-blur-sm`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <filter id={`${id}-glow`} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g className="maia-body">
        {/* Its own group, so swaying when happy does not fight the float on maia-body. */}
        <g className="maia-spin">
        {/* aura */}
        <circle
          cx="200"
          cy="200"
          r="120"
          opacity="0.3"
          filter={ref('blur-lg')}
          style={{ fill: palette.aura, transition: 'fill 500ms ease' }}
        />

        <g className="maia-tentacles">
          {tentacle('M160 232 C148 272 118 292 106 270', 'M152 248 C142 272 124 284 114 274')}
          {tentacle('M200 242 C200 282 196 304 216 312', 'M193 262 C193 286 192 298 204 306')}
          {/* The tentacle on the viewer's right is the one she raises when alert. */}
          {tentacle(
            'M240 232 C252 272 282 292 294 270',
            'M233 248 C243 272 262 286 280 276',
            'maia-tentacle-right',
            reviewer ? pencil : null,
          )}
        </g>

        {/* The head turns toward the cursor (headRef); the tentacles stay below it. */}
        <g ref={headRef} className="maia-head">
          <ellipse cx="200" cy="168" rx="82" ry="90" fill={ref('head')} />
          <ellipse cx="200" cy="168" rx="80" ry="88" fill="none" stroke="#FFFFFF" strokeWidth="2" opacity="0.25" />
          <path d="M132 210 Q150 250 200 256" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" opacity="0.4" />
          {/* shine */}
          <ellipse cx="163" cy="112" rx="24" ry="12" transform="rotate(-32 163 112)" fill="#FFFFFF" opacity="0.85" filter={ref('blur-sm')} />
          <circle cx="190" cy="96" r="4" fill="#FFFFFF" opacity="0.9" />

          <g className="maia-eyes">
            <g filter={ref('glow')}>
              <ellipse cx="170" cy="182" rx="14" ry="18" fill="#FFFFFF" />
              <ellipse cx="230" cy="182" rx="14" ry="18" fill="#FFFFFF" />
            </g>
            {/* The pupils follow the cursor (pupilsRef), inside the whites; sad, she looks down. */}
            <g className="maia-gaze">
              <g ref={pupilsRef}>
                <ellipse cx="174" cy="187" rx="7" ry="10" style={{ fill: palette.pupil, transition: 'fill 500ms ease' }} />
                <ellipse cx="226" cy="187" rx="7" ry="10" style={{ fill: palette.pupil, transition: 'fill 500ms ease' }} />
                <circle cx="176" cy="182" r="3" fill="#FFFFFF" />
                <circle cx="228" cy="182" r="3" fill="#FFFFFF" />
              </g>
            </g>
          </g>
          {/* Closed eyes, shown while hovered: two content arcs. */}
          <g className="maia-eyes-closed" fill="none" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" filter={ref('glow')}>
            <path d="M157 188 Q170 176 183 188" />
            <path d="M217 188 Q230 176 243 188" />
          </g>

          {/* Round glasses over her eyes; inside the head, so they turn with it. */}
          {reviewer && (
            <g fill="none" stroke="#1E1B4B" strokeWidth="5" strokeLinecap="round">
              <circle cx="170" cy="183" r="25" fill="#FFFFFF" fillOpacity="0.14" />
              <circle cx="230" cy="183" r="25" fill="#FFFFFF" fillOpacity="0.14" />
              <path d="M195 180 Q200 175 205 180" />
              <path d="M145 180 L124 172" />
              <path d="M255 180 L276 172" />
            </g>
          )}

          {/* What her face says beyond calm: her brows. */}
          <g fill="none" stroke="#FFFFFF" strokeLinecap="round" filter={ref('glow')}>
            <g className="maia-face-sad" strokeWidth="5">
              <path d="M154 160 L182 151" />
              <path d="M218 151 L246 160" />
            </g>
            <g className="maia-face-alert" strokeWidth="5">
              <path d="M155 152 Q170 140 185 150" />
              <path d="M215 150 Q230 140 245 152" />
            </g>
          </g>
        </g>
        </g>
      </g>
    </svg>
  );
}

/** What Maia has to say about the run on screen: the AI training advisor. */
export function MaiaPanelContent({ view, autoAnalyze = false }: { view: PipelineView; autoAnalyze?: boolean }) {
  const run = view.shownRun;
  if (!run) {
    return (
      <p className="text-sm text-slate-400">
        {view.runs.length
          ? 'Pick a run and I will tell you how its training went and what to try next.'
          : 'Nothing has run yet. Run the pipeline and I will review how the training went.'}
      </p>
    );
  }
  return <AIInsights pipelineId={run.id} pipelineStatus={run.status} hideTitle autoAnalyze={autoAnalyze} />;
}
