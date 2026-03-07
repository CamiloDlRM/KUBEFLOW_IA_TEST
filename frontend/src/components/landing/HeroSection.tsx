import { motion, type Variants } from 'framer-motion';
import { Suspense, lazy, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const SplineScene = lazy(() =>
  import('@/components/ui/splite').then((mod) => ({ default: mod.SplineScene }))
);

function RobotSkeleton() {
  return (
    <div className="absolute inset-0">
      <div
        className="absolute inset-0 bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900"
        style={{
          backgroundSize: '200% 100%',
          animation: 'heroShimmer 2s ease-in-out infinite',
        }}
      />
      <style>{`
        @keyframes heroShimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.7,
      delay: i * 0.15,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  }),
};

const bg = '#09090b';

export function HeroSection() {
  const [shouldLoadRobot, setShouldLoadRobot] = useState(false);

  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(() => setShouldLoadRobot(true), { timeout: 1500 });
      return () => cancelIdleCallback(id);
    } else {
      const timer = setTimeout(() => setShouldLoadRobot(true), 500);
      return () => clearTimeout(timer);
    }
  }, []);

  return (
    <section
      className="relative w-full min-h-[500px] md:min-h-[600px] overflow-hidden"
      style={{ backgroundColor: bg }}
    >
      {/* Spline scene */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ backgroundColor: bg }}
      >
        <div
          className="absolute inset-x-0 bottom-0 h-full"
          style={{
            left: '25%',
            right: '-25%',
            transform: 'translateY(30%)',
          }}
        >
          {shouldLoadRobot ? (
            <Suspense fallback={<RobotSkeleton />}>
              <SplineScene
                scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
                className="w-full h-full"
              />
            </Suspense>
          ) : (
            <RobotSkeleton />
          )}
        </div>
      </div>

      {/* Left gradient */}
      <div
        className="absolute inset-0 z-[1] pointer-events-none"
        style={{
          background: `linear-gradient(to right, ${bg}, ${bg}e6 40%, transparent)`,
        }}
      />

      {/* Top edge gradient */}
      <div
        className="absolute inset-x-0 top-0 h-24 z-[1] pointer-events-none"
        style={{ background: `linear-gradient(to bottom, ${bg}, transparent)` }}
      />

      {/* Bottom edge gradient */}
      <div
        className="absolute inset-x-0 bottom-0 h-24 z-[1] pointer-events-none"
        style={{ background: `linear-gradient(to top, ${bg}, transparent)` }}
      />

      {/* Right edge gradient */}
      <div
        className="absolute inset-y-0 right-0 w-24 z-[1] pointer-events-none"
        style={{ background: `linear-gradient(to left, ${bg}, transparent)` }}
      />

      {/* Text content */}
      <div className="relative z-[2] max-w-[1200px] w-full mx-auto px-6 pointer-events-none">
        <div className="max-w-xl py-16 md:py-24">
          <motion.h1
            className="text-4xl md:text-5xl font-bold leading-snug tracking-tight mb-4 pb-1 bg-clip-text text-transparent bg-gradient-to-b from-neutral-50 to-neutral-400"
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={0}
          >
            Automatiza tus Pipelines de Machine Learning
          </motion.h1>

          <motion.p
            className="text-lg md:text-xl font-medium mb-4 text-neutral-300"
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={1}
          >
            Del Notebook a Producción de forma automatizada
          </motion.p>

          <motion.p
            className="text-base md:text-lg max-w-lg mb-8 leading-relaxed text-[#a1a1aa]"
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={2}
          >
            Plataforma end-to-end que ejecuta, valida, registra y despliega tus
            modelos de Machine Learning de forma continua y escalable
          </motion.p>

          <motion.div
            className="flex flex-col sm:flex-row gap-4 pointer-events-auto"
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={3}
          >
            <Link
              to="/dashboard"
              className="bg-transparent px-8 py-4 rounded-xl font-bold text-base transition-colors text-center border text-white border-white/20 hover:bg-white/10"
            >
              Ir al Dashboard
            </Link>
            <Link
              to="/login"
              className="px-8 py-4 rounded-xl font-bold text-base transition-colors text-center bg-[#fafafa] text-[#09090b] hover:bg-[#e5e7eb]"
            >
              Comenzar Ahora
            </Link>
            <Link
              to="/docs"
              className="bg-transparent px-8 py-4 rounded-xl font-bold text-base transition-colors text-center border text-white border-white/20 hover:bg-white/10"
            >
              Ver Documentación
            </Link>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
