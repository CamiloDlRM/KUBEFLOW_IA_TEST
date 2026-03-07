import { Outlet } from 'react-router-dom';
import DashboardSidebar from './dashboard/DashboardSidebar';

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-[#09090b]">
      <DashboardSidebar />

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6 pt-16 md:p-8 md:pt-8">
        <Outlet />
      </main>
    </div>
  );
}
