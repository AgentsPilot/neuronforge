'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard, 
  MessageSquare, 
  Server,
  X,
  Bot,
  TrendingUp,
  Users,
  Activity
} from 'lucide-react';

interface AdminSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const navigationItems = [
  {
    name: 'Dashboard',
    href: '/admin',
    icon: LayoutDashboard,
    description: 'Overview & Analytics'
  },
  {
    name: 'Messages',
    href: '/admin/messages',
    icon: MessageSquare,
    description: 'Contact Inquiries'
  },
  {
    name: 'Queue Monitor',
    href: '/admin/queues',
    icon: Server,
    description: 'Job Processing'
  },
  {
    name: 'Agent Analytics',
    href: '/admin/analytics',
    icon: TrendingUp,
    description: 'Usage & Performance'
  },
  {
    name: 'User Management',
    href: '/admin/users',
    icon: Users,
    description: 'Platform Users'
  },
];

export default function AdminSidebar({ isOpen, onClose }: AdminSidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* Sidebar - Always visible on desktop, toggleable on mobile */}
      <div className={`
        fixed left-0 top-0 bottom-0 w-72 z-50 
        lg:static lg:z-auto lg:translate-x-0
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        transition-transform duration-300 ease-in-out
      `}>
        <div className="h-full bg-slate-900/95 backdrop-blur-xl border-r border-white/10 flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
                  <Bot className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">AgentPilot</h2>
                  <p className="text-xs text-slate-400">Admin Console</p>
                </div>
              </div>
              
              <button
                onClick={onClose}
                className="lg:hidden p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-2">
            {navigationItems.map((item, index) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              
              return (
                <motion.div
                  key={item.name}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.1 }}
                >
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className={`relative group flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 ${
                      isActive
                        ? 'bg-gradient-to-r from-blue-500/20 to-purple-500/20 text-white border border-blue-400/30'
                        : 'text-slate-300 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {/* Active indicator */}
                    {isActive && (
                      <motion.div
                        layoutId="activeIndicator"
                        className="absolute left-0 w-1 h-8 bg-gradient-to-b from-blue-400 to-purple-400 rounded-r-full"
                        transition={{ type: "spring", duration: 0.6 }}
                      />
                    )}
                    
                    <div className={`p-2 rounded-lg transition-colors ${
                      isActive 
                        ? 'bg-blue-500/20' 
                        : 'bg-slate-800/50 group-hover:bg-slate-700/50'
                    }`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    
                    <div className="flex-1">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-slate-400 group-hover:text-slate-300">
                        {item.description}
                      </p>
                    </div>

                    {/* Hover effect */}
                    <div className={`w-2 h-2 rounded-full transition-all duration-300 ${
                      isActive 
                        ? 'bg-blue-400' 
                        : 'bg-transparent group-hover:bg-slate-400'
                    }`} />
                  </Link>
                </motion.div>
              );
            })}
          </nav>

          {/* System Status */}
          <div className="p-4 border-t border-white/10">
            <div className="bg-slate-800/50 rounded-xl p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <span className="text-sm font-medium text-white">System Status</span>
              </div>
              
              <div className="space-y-2 text-xs text-slate-400">
                <div className="flex justify-between">
                  <span>API Health</span>
                  <span className="text-green-400">Healthy</span>
                </div>
                <div className="flex justify-between">
                  <span>Queue Status</span>
                  <span className="text-green-400">Active</span>
                </div>
                <div className="flex justify-between">
                  <span>Database</span>
                  <span className="text-green-400">Connected</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}