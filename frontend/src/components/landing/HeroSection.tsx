export function HeroSection() {
  return (
    <section
      className="w-full flex justify-center"
      style={{
        backgroundImage: "linear-gradient(180deg, #09090b 0%, #18181b 100%)",
      }}
    >
      <div className="max-w-[1200px] w-full px-6 py-20 md:py-32 flex flex-col items-center text-center">
        <h1 className="text-4xl md:text-6xl font-black text-white max-w-4xl leading-tight tracking-tight mb-4">
          Automatiza tus Pipelines de Machine Learning
        </h1>
        <p className="text-lg md:text-xl text-[#a1a1aa] font-medium mb-6">
          Del Notebook a Producción en un solo push a GitHub
        </p>
        <p className="text-[#a1a1aa] text-base md:text-lg max-w-2xl mb-10 leading-relaxed">
          Plataforma end-to-end que ejecuta, valida, registra y despliega tus
          modelos automáticamente cuando haces push a GitHub
        </p>
        <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
          <a
            href="#comenzar"
            className="bg-[#fafafa] text-[#09090b] px-8 py-4 rounded-xl font-bold text-base hover:bg-[#e5e7eb] transition-colors text-center"
          >
            Comenzar Ahora
          </a>
          <a
            href="#docs"
            className="bg-transparent text-white border border-white px-8 py-4 rounded-xl font-bold text-base hover:bg-white/10 transition-colors text-center"
          >
            Ver Documentación
          </a>
        </div>
      </div>
    </section>
  );
}
