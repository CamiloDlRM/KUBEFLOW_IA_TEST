import { motion } from 'framer-motion';
import { SplineScene } from './ui/splite';
import { Spotlight } from './ui/spotlight';

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.7,
      delay: i * 0.15,
      ease: [0.16, 1, 0.3, 1],
    },
  }),
};

export function HeroSection() {
  return (
    <section className="relative w-full min-h-[500px] md:min-h-[600px] bg-[#09090b] overflow-hidden">
      <Spotlight
        className="from-zinc-50 via-zinc-100 to-zinc-200"
        size={300}
      />

      <div className="max-w-[1200px] w-full mx-auto px-6 flex flex-col-reverse md:flex-row items-center">
        {/* Left column - Text */}
        <div className="flex-1 z-10 py-12 md:py-20">
          <motion.h1
            className="text-4xl md:text-5xl font-bold leading-tight tracking-tight mb-4 bg-clip-text text-transparent bg-gradient-to-b from-neutral-50 to-neutral-400"
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={0}
          >
            Automatiza tus Pipelines de Machine Learning
          </motion.h1>

          <motion.p
            className="text-lg md:text-xl text-neutral-300 font-medium mb-4"
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={1}
          >
            Del Notebook a Producción en un solo push a GitHub
          </motion.p>

          <motion.p
            className="text-[#a1a1aa] text-base md:text-lg max-w-lg mb-8 leading-relaxed"
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={2}
          >
            Plataforma end-to-end que ejecuta, valida, registra y despliega tus
            modelos automáticamente cuando haces push a GitHub
          </motion.p>

          <motion.div
            className="flex flex-col sm:flex-row gap-4"
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={3}
          >
            <a
              href="#comenzar"
              className="bg-[#fafafa] text-[#09090b] px-8 py-4 rounded-xl font-bold text-base hover:bg-[#e5e7eb] transition-colors text-center"
            >
              Comenzar Ahora
            </a>
            <a
              href="#docs"
              className="bg-transparent text-white border border-white/20 px-8 py-4 rounded-xl font-bold text-base hover:bg-white/10 transition-colors text-center"
            >
              Ver Documentación
            </a>
          </motion.div>
        </div>

        {/* Right column - 3D Robot */}
        <div className="flex-1 relative h-[300px] md:h-[500px] w-full">
          <SplineScene
            scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
            className="w-full h-full"
          />
        </div>
      </div>
    </section>
  );
}
