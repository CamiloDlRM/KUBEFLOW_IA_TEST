export function Footer() {
  return (
    <footer className="w-full flex justify-center bg-[#09090b] border-t border-[#27272a]">
      <div className="max-w-[1200px] w-full px-6 py-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-[#a1a1aa]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span className="text-[#a1a1aa] text-sm">
            © 2026 MLOps Platform. Todos los derechos reservados.
          </span>
        </div>
        <div className="flex gap-6">
          <a
            href="#"
            className="text-[#a1a1aa] hover:text-white text-sm transition-colors"
          >
            Privacidad
          </a>
          <a
            href="#"
            className="text-[#a1a1aa] hover:text-white text-sm transition-colors"
          >
            Términos
          </a>
          <a
            href="#"
            className="text-[#a1a1aa] hover:text-white text-sm transition-colors"
          >
            Contacto
          </a>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#a1a1aa] hover:text-white text-sm transition-colors"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
