import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearSession, getUserEmail } from '../auth';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
  { to: '/models', label: 'Models', icon: ModelsIcon },
  { to: '/repos/new', label: 'Add Repo', icon: PlusIcon },
];

function navLinkClass({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? 'bg-brand-600/20 text-brand-400'
      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
  }`;
}

export default function Layout() {
  const navigate = useNavigate();
  const email = getUserEmail();

  function handleLogout() {
    clearSession();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900 p-4 md:flex">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600">
            <BoltIcon />
          </div>
          <div>
            <h1 className="text-sm font-bold leading-tight text-slate-100">MLOps Platform</h1>
            <p className="text-[10px] text-slate-500">Automation Dashboard</p>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={navLinkClass}>
              <item.icon />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User / logout */}
        <div className="mt-auto border-t border-slate-800 pt-4">
          {email && (
            <p className="mb-2 truncate px-1 text-xs text-slate-500" title={email}>
              {email}
            </p>
          )}
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition hover:bg-slate-800 hover:text-red-300"
          >
            <LogoutIcon />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top nav */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-4 py-3 backdrop-blur md:hidden">
        <h1 className="text-sm font-bold text-slate-100">MLOps Platform</h1>
        <nav className="flex items-center gap-2">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={navLinkClass}>
              <item.icon />
            </NavLink>
          ))}
          <button
            onClick={handleLogout}
            className="rounded-lg px-3 py-2 text-slate-400 hover:bg-slate-800 hover:text-red-300"
            aria-label="Sign out"
          >
            <LogoutIcon />
          </button>
        </nav>
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6 pt-16 md:pt-6">
        <Outlet />
      </main>
    </div>
  );
}

/* ---- Inline SVG Icons ---- */

function BoltIcon() {
  return (
    <svg className="h-4 w-4 text-white" fill="currentColor" viewBox="0 0 24 24">
      <path d="M13 2L4.09 12.11a.6.6 0 00.45 1h5.05l-1.54 7.94a.3.3 0 00.53.25L19.91 11.9a.6.6 0 00-.45-1h-5.05l1.54-7.94a.3.3 0 00-.53-.25z" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  );
}

function ModelsIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );
}
