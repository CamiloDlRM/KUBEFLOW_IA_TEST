const steps = [
  {
    name: "Push",
    description: "Push a GitHub",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <line x1="3" y1="12" x2="9" y2="12" />
        <line x1="15" y1="12" x2="21" y2="12" />
      </svg>
    ),
    active: false,
  },
  {
    name: "Descarga",
    description: "Clona el repositorio",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
    active: false,
  },
  {
    name: "Validación",
    description: "Valida estructura",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
    active: false,
  },
  {
    name: "Ejecución",
    description: "Entrena el modelo",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
    active: true,
  },
  {
    name: "Registro",
    description: "Registra en MLflow",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
    active: false,
  },
  {
    name: "Deploy",
    description: "Despliega a producción",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
      </svg>
    ),
    active: false,
  },
];

export function PipelineFlow() {
  return (
    <section className="w-full flex justify-center bg-white dark:bg-[#09090b] transition-colors duration-300" id="arquitectura">
      <div className="max-w-[1200px] w-full px-6 py-24 flex flex-col items-center">
        <h2 className="text-3xl font-bold text-zinc-900 dark:text-white mb-16">
          ¿Cómo Funciona?
        </h2>

        <div className="flex flex-col md:flex-row items-center justify-between w-full max-w-5xl relative">
          {/* Connecting line - Desktop */}
          <div className="hidden md:block absolute top-8 left-8 right-8 h-0.5 bg-zinc-200 dark:bg-[#27272a]" />
          {/* Connecting line - Mobile */}
          <div className="md:hidden absolute left-1/2 top-8 bottom-8 w-0.5 bg-zinc-200 dark:bg-[#27272a] -translate-x-1/2" />

          {steps.map((step, i) => (
            <div
              key={step.name}
              className={`flex flex-col items-center gap-3 relative z-10 ${
                i < steps.length - 1 ? "mb-10 md:mb-0" : ""
              }`}
            >
              <div className="bg-white dark:bg-[#09090b] p-1">
                <div
                  className={`w-16 h-16 rounded-full flex items-center justify-center ${
                    step.active
                      ? "bg-zinc-900 dark:bg-white text-white dark:text-[#09090b] shadow-[0_0_30px_rgba(0,0,0,0.15)] dark:shadow-[0_0_30px_rgba(255,255,255,0.3)]"
                      : "bg-zinc-100 dark:bg-[#18181b] text-zinc-700 dark:text-white border border-zinc-200 dark:border-[#27272a]"
                  }`}
                >
                  {step.icon}
                </div>
              </div>
              <span
                className={`text-sm font-medium ${
                  step.active ? "text-zinc-900 dark:text-white font-bold" : "text-zinc-500 dark:text-[#a1a1aa]"
                }`}
              >
                {step.name}
              </span>
              <span className="text-xs text-zinc-400 dark:text-[#52525b] max-w-[100px] text-center">
                {step.description}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
