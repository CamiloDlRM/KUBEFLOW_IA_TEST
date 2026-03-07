import { Link } from 'react-router-dom';
import { BookOpen, Upload, Play, BarChart3, ArrowLeft, X, Menu } from 'lucide-react';

export type DocSection = 'intro' | 'upload' | 'test' | 'metrics';

interface DocsSidebarProps {
  active: DocSection;
  onNavigate: (section: DocSection) => void;
  mobileOpen: boolean;
  onMobileToggle: () => void;
}

const navItems: { id: DocSection; label: string; icon: typeof BookOpen }[] = [
  { id: 'intro', label: 'Introduccion', icon: BookOpen },
  { id: 'upload', label: 'Cargar un Modelo', icon: Upload },
  { id: 'test', label: 'Testear el Modelo', icon: Play },
  { id: 'metrics', label: 'Metricas y Resultados', icon: BarChart3 },
];

export function DocsSidebar({ active, onNavigate, mobileOpen, onMobileToggle }: DocsSidebarProps) {
  const sidebar = (
    <div className="flex flex-col h-full w-60 bg-[#18181b] border-r border-[#27272a]">
      {/* Logo */}
      <div className="flex items-center justify-between px-5 py-5 border-b border-[#27272a]">
        <div className="flex items-center gap-2.5">
          <BookOpen size={20} className="text-white" />
          <span className="text-lg font-bold text-white">MLOps Docs</span>
        </div>
        <button
          onClick={onMobileToggle}
          className="lg:hidden text-[#a1a1aa] hover:text-white transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1">
        {navItems.map((item) => {
          const isActive = active === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => {
                onNavigate(item.id);
                onMobileToggle();
              }}
              className={`
                w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left
                ${
                  isActive
                    ? 'bg-[#27272a] text-white border-l-[3px] border-white pl-[13px]'
                    : 'text-[#a1a1aa] hover:bg-[#27272a]/50 hover:text-white border-l-[3px] border-transparent pl-[13px]'
                }
              `}
            >
              <Icon size={16} className="shrink-0" />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Back link */}
      <div className="px-5 py-4 border-t border-[#27272a]">
        <Link
          to="/"
          className="flex items-center gap-2 text-sm text-[#52525b] hover:text-[#a1a1aa] transition-colors"
        >
          <ArrowLeft size={14} />
          Volver al inicio
        </Link>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={onMobileToggle}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-[#18181b] border border-[#27272a] text-[#a1a1aa] hover:text-white transition-colors"
      >
        <Menu size={20} />
      </button>

      {/* Desktop sidebar */}
      <div className="hidden lg:block fixed inset-y-0 left-0 z-40">
        {sidebar}
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={onMobileToggle}
          />
          <div className="relative z-10 h-full">
            {sidebar}
          </div>
        </div>
      )}
    </>
  );
}

export function getSectionTitle(section: DocSection): string {
  switch (section) {
    case 'intro': return 'Introduccion';
    case 'upload': return 'Cargar un Modelo';
    case 'test': return 'Testear el Modelo';
    case 'metrics': return 'Metricas y Resultados';
  }
}
