export function Footer() {
  return (
    <footer className="w-full flex justify-center bg-white dark:bg-[#09090b] border-t border-zinc-200 dark:border-[#27272a] transition-colors duration-300">
      <div className="max-w-[1200px] w-full px-6 py-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-zinc-400 dark:text-[#a1a1aa]"
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
          <span className="text-zinc-500 dark:text-[#a1a1aa] text-sm">
            © 2026 MLOps Platform. Todos los derechos reservados.
          </span>
        </div>
        <div className="flex gap-6">
          <a href="#" className="text-zinc-500 dark:text-[#a1a1aa] hover:text-zinc-900 dark:hover:text-white text-sm transition-colors">
            Privacidad
          </a>
          <a href="#" className="text-zinc-500 dark:text-[#a1a1aa] hover:text-zinc-900 dark:hover:text-white text-sm transition-colors">
            Términos
          </a>
          <a href="#" className="text-zinc-500 dark:text-[#a1a1aa] hover:text-zinc-900 dark:hover:text-white text-sm transition-colors">
            Contacto
          </a>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-500 dark:text-[#a1a1aa] hover:text-zinc-900 dark:hover:text-white text-sm transition-colors"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
