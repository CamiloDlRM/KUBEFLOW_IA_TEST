import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Terminal, Layers, GitBranch, Box, LogIn } from 'lucide-react';

interface NavItem {
  id: string;
  label: string;
  icon: typeof Layers;
  target: string;
}

const navItems: NavItem[] = [
  { id: 'arquitectura', label: 'Cómo Funciona', icon: GitBranch, target: '#arquitectura' },
  { id: 'caracteristicas', label: 'Características', icon: Layers, target: '#caracteristicas' },
  { id: 'tech-stack', label: 'Tech Stack', icon: Box, target: '#tech-stack' },
];

const sectionIds = ['arquitectura', 'caracteristicas', 'tech-stack'];

const spring = { type: 'spring' as const, stiffness: 350, damping: 32 };

export function Navbar() {
  const [active, setActive] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActive(id);
        },
        { rootMargin: '-40% 0px -40% 0px', threshold: 0 }
      );

      observer.observe(el);
      observers.push(observer);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, []);

  useEffect(() => {
    function handleScroll() {
      if (window.scrollY < 200) setActive(null);
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleClick = useCallback((item: NavItem) => {
    setActive(item.id);
    const el = document.querySelector(item.target);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleLogoClick = useCallback(() => {
    setActive(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <header
      className="fixed top-4 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-10 animate-[navFadeIn_0.4s_ease-out_both]"
    >
      {/* Logo - Left */}
      <button
        onClick={handleLogoClick}
        className="flex items-center gap-2 text-white shrink-0 cursor-pointer"
      >
        <Terminal size={20} />
        <span className="font-bold text-lg tracking-tight hidden sm:block">MLOps</span>
      </button>

      {/* Nav pill - Center */}
      <nav
        className="flex items-center gap-1 h-[44px] rounded-full bg-[#18181b]/80 backdrop-blur-xl border border-[#27272a] shadow-xl px-1.5"
        onMouseLeave={() => setHovered(null)}
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          const isHovered = hovered === item.id;
          const showLabel = isActive || isHovered;

          return (
            <button
              key={item.id}
              onClick={() => handleClick(item)}
              onMouseEnter={() => setHovered(item.id)}
              className={`
                relative flex items-center h-8 rounded-full px-3 text-sm font-medium transition-colors cursor-pointer shrink-0
                ${isActive ? 'bg-white/10 text-white' : 'text-[#a1a1aa] hover:bg-[#27272a]/50 hover:text-white'}
              `}
            >
              <Icon size={15} className="shrink-0" />

              <motion.span
                className="overflow-hidden whitespace-nowrap hidden md:block"
                initial={false}
                animate={{
                  width: showLabel ? 'auto' : 0,
                  opacity: showLabel ? 1 : 0,
                  marginLeft: showLabel ? 6 : 0,
                }}
                transition={spring}
              >
                {item.label}
              </motion.span>
            </button>
          );
        })}
      </nav>

      {/* CTA - Right */}
      <Link
        to="/register"
        className="hidden md:flex items-center bg-[#fafafa] text-[#09090b] rounded-full px-5 py-2 text-sm font-semibold hover:bg-[#e5e7eb] transition-colors shrink-0"
      >
        Comenzar
      </Link>

      {/* CTA Mobile - Right */}
      <Link
        to="/register"
        className="md:hidden flex items-center justify-center w-9 h-9 bg-[#fafafa] text-[#09090b] rounded-full hover:bg-[#e5e7eb] transition-colors shrink-0"
      >
        <LogIn size={16} />
      </Link>
      <style>{`
        @keyframes navFadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </header>
  );
}
