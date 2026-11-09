import { useEffect, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotion, useScroll, useSpring, useTransform, useVelocity } from 'motion/react';
import { MaiaAvatar, type MaiaMood } from './flow/Maia';

/**
 * Maia walking a visitor through the landing page. She floats in the page's
 * margin, outside the content, and as each section reaches the middle of the
 * screen she swims to her spot for it and says one thing about it. Scrolling
 * tilts her with the speed of the scroll, so she is never a still picture.
 *
 * On screens with no margin to spare she stays small in the bottom corner
 * instead, so she never covers what the visitor is reading.
 */

export interface LandingStop {
  /** The section she talks about while it is in the middle of the screen. */
  ref: RefObject<HTMLElement | null>;
  /** Which margin she floats in, and how far down the screen (0 top, 1 bottom). */
  side: 'left' | 'right';
  height: number;
  mood: MaiaMood;
  says: string;
}

/** The page's content is max-w-6xl (72rem = 1152px). */
const CONTENT_WIDTH = 1152;
const SIZE = 104;
const COMPACT_SIZE = 72;
/** A margin narrower than this cannot hold her without covering the content. */
const MIN_GUTTER = 140;
const EDGE = 20;
/** How long what she says stays on screen after she arrives somewhere. */
const BUBBLE_MS = 6000;
/** Matches the swim animation in maia.css. */
const SWIM_MS = 800;

function useViewport() {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

/** The stop whose section crosses the middle of the screen. */
function useActiveStop(stops: LandingStop[]) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = stops.findIndex((stop) => stop.ref.current === entry.target);
          if (index >= 0) setActive(index);
        }
      },
      // A thin band across the middle of the screen: whichever section is in it is "here".
      { rootMargin: '-45% 0px -45% 0px' },
    );
    for (const stop of stops) if (stop.ref.current) observer.observe(stop.ref.current);

    // The last stop's section may sit near the bottom and never reach the middle of
    // the screen: reaching the end of the page counts as getting there.
    const onScroll = () => {
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) setActive(stops.length - 1);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, [stops]);
  return active;
}

export default function LandingMaia({ stops }: { stops: LandingStop[] }) {
  const { width, height } = useViewport();
  const active = useActiveStop(stops);
  const stop = stops[active];
  const reduceMotion = useReducedMotion();

  const gutter = (width - CONTENT_WIDTH) / 2;
  const compact = gutter < MIN_GUTTER;
  const size = compact ? COMPACT_SIZE : SIZE;

  // Where she floats: the middle of the margin for this stop, or the bottom corner.
  const x = compact
    ? width - size - EDGE
    : stop.side === 'left'
      ? gutter / 2 - size / 2
      : width - gutter / 2 - size / 2;
  const y = compact ? height - size - EDGE : height * stop.height - size / 2;

  // Swimming: leaning into a move to the other margin, tentacles beating fast.
  const [swimming, setSwimming] = useState<'left' | 'right' | null>(null);
  const lastX = useRef(x);
  useEffect(() => {
    const dx = x - lastX.current;
    lastX.current = x;
    if (Math.abs(dx) < 40) return;
    setSwimming(dx < 0 ? 'left' : 'right');
    const timer = window.setTimeout(() => setSwimming(null), SWIM_MS);
    return () => window.clearTimeout(timer);
  }, [x]);

  // What she says shows when she reaches a stop, then fades; hovering her brings it back.
  const [talking, setTalking] = useState(true);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    setTalking(true);
    const timer = window.setTimeout(() => setTalking(false), BUBBLE_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

  // Tilted by the speed of the scroll, springing back upright when it stops.
  const { scrollY } = useScroll();
  const velocity = useVelocity(scrollY);
  const tilt = useSpring(useTransform(velocity, [-2500, 0, 2500], [-12, 0, 12]), { stiffness: 180, damping: 22 });

  const bubbleOnLeft = compact || stop.side === 'right';

  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[15]"
      initial={false}
      animate={{ x, y }}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 45, damping: 14 }}
    >
      <motion.div
        className="maia-hover pointer-events-auto"
        style={{ rotate: reduceMotion ? 0 : tilt }}
        onHoverStart={() => setHovered(true)}
        onHoverEnd={() => setHovered(false)}
      >
        <MaiaAvatar size={size} mood={stop.mood} swimming={swimming} followCursor={!compact} />
      </motion.div>

      <AnimatePresence>
        {(talking || hovered) && (
          <motion.p
            key={active}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.3 }}
            className={`font-body2 absolute w-56 rounded-2xl border border-violet-500/30 bg-slate-900/95 px-4 py-3 text-sm text-slate-200 shadow-xl backdrop-blur ${
              compact ? 'bottom-full mb-2' : 'top-full mt-2'
            } ${bubbleOnLeft ? 'right-0 rounded-tr-sm' : 'left-0 rounded-tl-sm'}`}
          >
            {stop.says}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
