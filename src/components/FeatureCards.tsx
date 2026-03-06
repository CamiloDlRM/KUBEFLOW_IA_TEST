const features = [
  {
    title: "Integración con GitHub",
    description:
      "Webhook automático al hacer push. Detecta cambios en tu repositorio y lanza el pipeline completo sin intervención manual.",
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
      </svg>
    ),
  },
  {
    title: "Monitoreo en Tiempo Real",
    description:
      "Logs en vivo via WebSocket. Observa cada fase del pipeline mientras se ejecuta con actualizaciones instantáneas.",
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    title: "Auto-Deploy Inteligente",
    description:
      "Deploy automático si accuracy >= 0.70. Solo los modelos que superan el umbral llegan a producción.",
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
      </svg>
    ),
  },
];

export function FeatureCards() {
  return (
    <section className="w-full flex justify-center bg-[#09090b]" id="caracteristicas">
      <div className="max-w-[1200px] w-full px-6 py-24">
        <h2 className="text-3xl font-bold text-white mb-12 text-center">
          Características Principales
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="bg-[rgba(28,28,30,0.8)] backdrop-blur-xl border border-[#2a2a2e] rounded-2xl p-8 flex flex-col gap-4 hover:border-[#52525b] transition-colors"
            >
              <div className="text-white">{feature.icon}</div>
              <h3 className="text-xl font-bold text-white">{feature.title}</h3>
              <p className="text-[#a1a1aa] leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
