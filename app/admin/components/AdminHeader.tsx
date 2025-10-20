'use client';

import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { 
  Menu, 
  Bell, 
  Search, 
  User, 
  Settings, 
  LogOut,
  ChevronDown
} from 'lucide-react';
import { useState } from 'react';

interface AdminHeaderProps {
  onMenuClick: () => void;
}

export default function AdminHeader({ onMenuClick }: AdminHeaderProps) {
  const pathname = usePathname();
  const [showProfile, setShowProfile] = useState(false);

  const getPageTitle = () => {
    switch (pathname) {
      case '/admin': return 'Dashboard Overview';
      case '/admin/messages': return 'Contact Messages';
      case '/admin/queues': return 'Queue Monitor';
      default: return 'Admin Console';
    }
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

      {/* Right side */}
      <div className="flex items-center gap-4">
        {/* Search */}
        <div className="hidden md:flex items-center gap-2 bg-slate-700/50 rounded-lg px-3 py-2 w-64">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search admin..."
            className="bg-transparent text-white placeholder-slate-400 text-sm focus:outline-none flex-1"
          />
        </div>

        {/* Profile */}
        <div className="relative">
          <button
            onClick={() => setShowProfile(!showProfile)}
            className="flex items-center gap-2 p-2 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <User className="w-4 h-4 text-white" />
            </div>
            <span className="hidden md:block text-sm font-medium">Admin User</span>
            <ChevronDown className="w-4 h-4" />
          </button>

          {showProfile && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute right-0 top-full mt-2 w-48 bg-slate-800/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-xl z-50"
            >
              <div className="p-2">
                <button className="w-full flex items-center gap-3 p-3 text-slate-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors">
                  <Settings className="w-4 h-4" />
                  <span className="text-sm">Settings</span>
                </button>
                <hr className="my-2 border-white/10" />
                <button className="w-full flex items-center gap-3 p-3 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors">
                  <LogOut className="w-4 h-4" />
                  <span className="text-sm">Sign Out</span>
                </button>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </header>
  );
}