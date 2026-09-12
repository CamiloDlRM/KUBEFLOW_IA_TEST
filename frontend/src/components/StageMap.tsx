/**
 * The six stages of the data factory, as a map rather than a wizard.
 *
 * A wizard would be easier to build and worse to use here. The work is not
 * linear — you connect a second source after you have gold, you go back to
 * bronze to check what the source actually said, you re-read the cleaning
 * report a week later — and a flow that only moves forward makes all of that a
 * fight. So every stage that has been *reached* stays reachable.
 *
 * What the map must do, and a list of links would not, is answer "where am I
 * and what happens next" without being read. Hence one line, left to right,
 * with the stages that cannot be reached yet visibly inert and saying why —
 * a disabled control with no explanation is the worst of both.
 */
export interface Stage {
  id: string;
  label: string;
  /** One short line: what this stage is for. */
  caption: string;
  /** False while the data needed to show anything does not exist yet. */
  reached: boolean;
  /** Shown when it is not reached — what would make it reachable. */
  blocked?: string;
  /** A number worth seeing at a glance, e.g. rows landed. */
  badge?: string;
  /** Stages that belong to a medallion layer take that layer's metal. */
  tone?: 'default' | 'bronze' | 'silver' | 'gold';
}

const TONES: Record<NonNullable<Stage['tone']>, { on: string; ring: string; text: string }> = {
  default: {
    on: 'bg-brand-600/20 border-brand-500/70',
    ring: 'ring-brand-400',
    text: 'text-brand-200',
  },
  bronze: {
    on: 'bg-gradient-to-br from-amber-900/50 to-orange-950/30 border-amber-700/70',
    ring: 'ring-amber-400',
    text: 'text-amber-200',
  },
  silver: {
    on: 'bg-gradient-to-br from-slate-300/20 to-slate-600/15 border-slate-400/60',
    ring: 'ring-slate-300',
    text: 'text-slate-100',
  },
  gold: {
    on: 'bg-gradient-to-br from-yellow-700/45 to-yellow-950/30 border-yellow-600/70',
    ring: 'ring-yellow-400',
    text: 'text-yellow-100',
  },
};

export default function StageMap({
  stages,
  current,
  onSelect,
}: {
  stages: Stage[];
  current: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-label="Data factory stages" className="overflow-x-auto">
      <ol className="flex min-w-max items-stretch gap-2">
        {stages.map((stage, index) => (
          <li key={stage.id} className="flex items-stretch">
            {index > 0 && (
              <span
                aria-hidden="true"
                className={`mx-1 self-center text-lg ${
                  stage.reached ? 'text-slate-600' : 'text-slate-800'
                }`}
              >
                →
              </span>
            )}
            <StageButton
              stage={stage}
              index={index}
              selected={current === stage.id}
              onSelect={() => onSelect(stage.id)}
            />
          </li>
        ))}
      </ol>
    </nav>
  );
}

function StageButton({
  stage,
  index,
  selected,
  onSelect,
}: {
  stage: Stage;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const tone = TONES[stage.tone ?? 'default'];

  return (
    <button
      type="button"
      onClick={stage.reached ? onSelect : undefined}
      disabled={!stage.reached}
      aria-current={selected ? 'step' : undefined}
      // Named by the stage alone. Without this the accessible name is the
      // whole card — "3 Extract Connect a source first" — so a step reads as
      // the instruction belonging to a different step, and two of them end up
      // answering to the same words.
      aria-label={stage.label}
      // The reason is on the control itself rather than in a footnote: a
      // disabled step that does not say what would unlock it is a dead end.
      title={stage.reached ? stage.caption : stage.blocked}
      className={`w-44 rounded-lg border px-3 py-2.5 text-left transition ${
        stage.reached
          ? `${tone.on} ${tone.text} hover:brightness-125`
          : 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600'
      } ${selected ? `ring-2 ring-offset-2 ring-offset-slate-950 ${tone.ring}` : ''}`}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide opacity-70">
          {index + 1}
        </span>
        {stage.badge && stage.reached && (
          <span className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] tabular-nums">
            {stage.badge}
          </span>
        )}
      </span>
      <span className="mt-0.5 block text-sm font-semibold">{stage.label}</span>
      <span className="mt-0.5 block text-[11px] leading-snug opacity-70">
        {stage.reached ? stage.caption : stage.blocked}
      </span>
    </button>
  );
}
