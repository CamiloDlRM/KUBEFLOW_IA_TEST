import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Box,
  GitBranch,
  BookOpen,
  Terminal,
  PanelLeftClose,
  PanelLeft,
  ChevronDown,
  X,
} from 'lucide-react';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/models', label: 'Models', icon: Box },
  { to: '/repos/new', label: 'Add Repo', icon: GitBranch },
  { to: '/docs', label: 'Docs', icon: BookOpen },
];

interface DashboardSidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export default function DashboardSidebar({ collapsed: controlledCollapsed, onToggle }: DashboardSidebarProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const collapsed = controlledCollapsed ?? internalCollapsed;
  const toggle = onToggle ?? (() => setInternalCollapsed((c) => !c));

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className={`flex items-center gap-3 border-b border-[#27272a] px-4 py-4 ${collapsed ? 'justify-center' : ''}`}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5">
          <Terminal size={18} className="text-white" />
        </div>
        {!collapsed && (
          <span className="text-sm font-semibold tracking-tight text-white">
            MLOps Platform
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-[#27272a] text-white'
                  : 'text-[#a1a1aa] hover:bg-[#27272a]/50 hover:text-white'
              } ${collapsed ? 'justify-center' : ''}`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-white" />
                )}
                <item.icon size={18} className="shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User profile */}
      <div className="border-t border-[#27272a] p-3">
        <div
          className={`flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-[#27272a]/50 ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#27272a] text-xs font-semibold text-white">
            JS
          </div>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">Juan S.</p>
                <p className="truncate text-xs text-[#52525b]">juan@exam...</p>
              </div>
              <ChevronDown size={16} className="shrink-0 text-[#52525b]" />
            </>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={toggle}
          className={`mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-[#52525b] transition-colors hover:bg-[#27272a]/50 hover:text-[#a1a1aa] ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && <span>Colapsar</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`hidden h-screen shrink-0 border-r border-[#27272a] bg-[#18181b] transition-all duration-300 md:block ${
          collapsed ? 'w-16' : 'w-60'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile toggle button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-40 rounded-lg border border-[#27272a] bg-[#18181b] p-2 text-white md:hidden"
      >
        <PanelLeft size={20} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative h-full w-60 bg-[#18181b] shadow-2xl">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 rounded-lg p-1 text-[#a1a1aa] hover:text-white"
            >
              <X size={18} />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
