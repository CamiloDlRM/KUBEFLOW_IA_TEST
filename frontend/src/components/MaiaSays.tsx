import type { ReactNode } from 'react';
import { MaiaAvatar, type MaiaMood } from './flow/Maia';

const BUBBLE: Record<MaiaMood, string> = {
  calm: 'border-violet-500/30 bg-violet-500/10 text-violet-100',
  happy: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  alert: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
  sad: 'border-red-500/30 bg-red-500/10 text-red-200',
};

/**
 * Something the app's AI says, said by Maia: her face beside a speech bubble.
 * Every AI feature talks through this, so the app has one AI, not several.
 */
export default function MaiaSays({
  mood = 'calm',
  size = 40,
  children,
}: {
  mood?: MaiaMood;
  size?: number;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <MaiaAvatar size={size} mood={mood} />
      <div className={`min-w-0 flex-1 rounded-xl rounded-tl-sm border px-3 py-2 text-sm ${BUBBLE[mood]}`}>
        {children}
      </div>
    </div>
  );
}
