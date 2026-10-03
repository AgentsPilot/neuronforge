'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, User, LogOut } from 'lucide-react';
import { useAuth } from '@/components/UserProvider';
import { signOutUser } from '@/lib/client/auth-actions';
import { clientLogger } from '@/lib/logger/client';
import { marketingLogoutUrl } from '@/lib/utils/marketingUrl';

const logger = clientLogger.child({ module: 'AdminHeader' });

interface AdminHeaderProps {
  onMenuClick: () => void;
  /**
   * The signed-in admin's display name (profile name, else email), resolved on
   * the server by `app/admin/layout.tsx`. A string only — no id crosses here.
   */
  adminName: string;
}

/*
 * The right-hand side used to be a search box with no handler and a profile
 * dropdown whose two items were a duplicate of the sidebar's Admin users link
 * and a Sign Out button with no onClick. Both removed at the user's request
 * (2026-10-02); what is left is the admin's name and a Sign out that works.
 */
export default function AdminHeader({ onMenuClick, adminName }: AdminHeaderProps) {
  const pathname = usePathname();
  // The browser's own session, used only to attribute the USER_LOGOUT audit entry.
  const { user } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const getPageTitle = () => {
    switch (pathname) {
      case '/admin': return 'Health';
      case '/admin/platform-dashboard': return 'Platform dashboard (legacy)';
      case '/admin/messages': return 'Contact Messages';
      case '/admin/queues': return 'Agent execution queue';
      case '/admin/jobs-queues': return 'Scheduled jobs & queues';
      default: return 'Admin Console';
    }
  };

  /*
   * The shared sign-out, with the same scope and landing as the app's other
   * sign-out controls (`UserMenu`, Business OS settings): global scope, then a
   * `replace` to the marketing site's sign-out route so its copy of the session
   * is cleared too and Back does not return to the admin page.
   */
  const handleSignOut = async () => {
    setSigningOut(true);
    const result = await signOutUser({ scope: 'global', user, method: 'admin-header' });
    if (!result.ok) {
      logger.error({ err: result.error }, 'Global sign-out failed — cleared locally regardless');
    }
    window.location.replace(marketingLogoutUrl());
  };

  return (
    <header className="h-16 bg-slate-800/50 backdrop-blur-xl border-b border-white/10 flex items-center justify-between px-6">
      {/* Left side */}
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div>
          <h1 className="text-xl font-semibold text-white">{getPageTitle()}</h1>
          <p className="text-sm text-slate-400">
            {new Date().toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </p>
        </div>
      </div>

      {/* Right side: who is signed in, and the way out */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 text-slate-300 min-w-0">
          <div className="w-8 h-8 flex-shrink-0 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
            <User className="w-4 h-4 text-white" />
          </div>
          <span
            data-testid="admin-header-name"
            className="hidden md:block text-sm font-medium truncate max-w-[16rem]"
            title={adminName}
          >
            {adminName}
          </span>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          aria-label="Sign out"
          className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-60"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:inline">{signingOut ? 'Signing out…' : 'Sign out'}</span>
        </button>
      </div>
    </header>
  );
}
