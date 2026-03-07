import { motion } from 'framer-motion';
import { GitBranch, Activity, Rocket } from 'lucide-react';
import { GlowingEffect } from '@/components/ui/glowing-effect';

const features = [
  {
    title: 'Integración con GitHub',
    description:
      'Webhook automático al hacer push. Detecta cambios en tu repositorio y lanza el pipeline completo sin intervención manual.',
    icon: GitBranch,
  },
  {
    title: 'Monitoreo en Tiempo Real',
    description:
      'Logs en vivo via WebSocket. Observa cada fase del pipeline mientras se ejecuta con actualizaciones instantáneas.',
    icon: Activity,
  },
  {
    title: 'Auto-Deploy Inteligente',
    description:
      'Deploy automático si accuracy >= 0.70. Solo los modelos que superan el umbral llegan a producción.',
    icon: Rocket,
  },
];

export function FeatureCards() {
  return (
    <section
      className="w-full flex justify-center bg-[#09090b]"
      id="caracteristicas"
    >
      <div className="max-w-[1200px] w-full px-6 py-24">
        <h2 className="text-3xl font-bold mb-12 text-center text-white">
          Características Principales
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{
                duration: 0.5,
                delay: i * 0.12,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="relative rounded-[1.25rem]"
            >
              <GlowingEffect
                spread={40}
                glow
                disabled={false}
                proximity={64}
                inactiveZone={0.01}
                borderWidth={3}
              />

              <div className="relative rounded-[1.25rem] border p-8 flex flex-col gap-4 h-full bg-[#0f0f11] border-[#27272a]">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-white/5">
                  <feature.icon
                    className="w-6 h-6 text-white"
                    strokeWidth={1.5}
                  />
                </div>

                <h3 className="text-xl font-bold text-white">
                  {feature.title}
                </h3>

                <p className="leading-relaxed text-[#a1a1aa]">
                  {feature.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
