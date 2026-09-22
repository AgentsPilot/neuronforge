'use client';

/*
 * The admin shell — sidebar, header, background, content slot.
 *
 * This is the previous contents of `app/admin/layout.tsx`, MOVED VERBATIM. The
 * only change is the component name. It was split out so that
 * `app/admin/layout.tsx` could become an async Server Component that awaits the
 * admin check before any of this renders.
 *
 * Keep the split: the chrome needs `useState` for the mobile sidebar, so it has
 * to be a client component, and a client component cannot perform a
 * server-side authorization check. Merging them back would mean the decision
 * runs after the admin bundle has already shipped to the browser.
 */

import { useState } from 'react';
import AdminSidebar from './AdminSidebar';
import AdminHeader from './AdminHeader';

export default function AdminChrome({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-gray-900 to-slate-800 text-white">
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-blue-900/20 via-purple-900/10 to-pink-900/20" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-indigo-900/20 via-transparent to-fuchsia-900/20" />
      </div>

      <div className="relative z-10 flex h-screen overflow-hidden">
        {/* Sidebar - Sticky within flex container */}
        <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <AdminHeader onMenuClick={() => setSidebarOpen(true)} />

          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
