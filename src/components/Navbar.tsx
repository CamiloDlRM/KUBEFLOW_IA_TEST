"use client";

import { useState } from "react";

const navLinks = [
  { label: "Características", href: "#caracteristicas" },
  { label: "Arquitectura", href: "#arquitectura" },
  { label: "Tech Stack", href: "#tech-stack" },
  { label: "Contacto", href: "#contacto" },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed top-0 w-full z-50 bg-[#09090b]/80 backdrop-blur-md border-b border-[#27272a]">
      <div className="max-w-[1200px] mx-auto w-full px-6 py-4 flex items-center justify-between">
        {/* Logo */}
        <a href="#" className="flex items-center gap-2.5 shrink-0">
          <svg
            className="w-6 h-6 text-white"
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
          <span className="text-white font-bold text-xl tracking-tight">
            MLOps Platform
          </span>
        </a>

        {/* Desktop Nav Links - Centered */}
        <nav className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[#a1a1aa] hover:text-white transition-colors text-sm font-medium"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* CTA Button - Right */}
        <div className="hidden md:block">
          <a
            href="#comenzar"
            className="bg-[#fafafa] text-[#09090b] px-6 py-2 rounded-xl font-semibold text-sm hover:bg-[#e5e7eb] transition-colors"
          >
            Comenzar
          </a>
        </div>

        {/* Mobile Hamburger */}
        <button
          className="md:hidden flex flex-col gap-1.5 p-2"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Menú de navegación"
        >
          <span
            className={`block w-6 h-0.5 bg-white transition-transform duration-300 ${
              mobileOpen ? "rotate-45 translate-y-2" : ""
            }`}
          />
          <span
            className={`block w-6 h-0.5 bg-white transition-opacity duration-300 ${
              mobileOpen ? "opacity-0" : ""
            }`}
          />
          <span
            className={`block w-6 h-0.5 bg-white transition-transform duration-300 ${
              mobileOpen ? "-rotate-45 -translate-y-2" : ""
            }`}
          />
        </button>
      </div>

      {/* Mobile Menu */}
      <div
        className={`md:hidden overflow-hidden transition-all duration-300 ${
          mobileOpen ? "max-h-80" : "max-h-0"
        }`}
      >
        <nav className="flex flex-col gap-1 px-6 pb-6 bg-[#09090b]/95 backdrop-blur-md border-t border-[#27272a]">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="text-[#a1a1aa] hover:text-white transition-colors text-sm font-medium py-3 border-b border-[#27272a]/50"
            >
              {link.label}
            </a>
          ))}
          <a
            href="#comenzar"
            onClick={() => setMobileOpen(false)}
            className="mt-3 bg-[#fafafa] text-[#09090b] px-6 py-2.5 rounded-xl font-semibold text-sm text-center hover:bg-[#e5e7eb] transition-colors"
          >
            Comenzar
          </a>
        </nav>
      </div>
    </header>
  );
}
