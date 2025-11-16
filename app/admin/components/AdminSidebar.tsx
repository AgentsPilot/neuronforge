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
  Settings,
  Gift,
  FileText,
  Sliders,
  Brain,
  Activity,
  Palette,
  Database,
  BarChart3,
  DollarSign,
  MessageCircle
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
    name: 'Memory System',
    href: '/admin/learning-system',
    icon: BarChart3,
    description: 'Monitoring & ROI'
  },
  {
    name: 'Memory Config',
    href: '/admin/memory-config',
    icon: Database,
    description: 'Memory Settings'
  },
  {
    name: 'User Management',
    href: '/admin/users',
    icon: Users,
    description: 'Platform Users'
  },
  {
    name: 'System Flow',
    href: '/admin/system-flow',
    icon: Activity,
    description: 'Live System Visualization'
  },
  {
    name: 'System Config',
    href: '/admin/system-config',
    icon: DollarSign,
    description: 'Pricing & Billing'
  },
  {
    name: 'Orchestration',
    href: '/admin/orchestration-config',
    icon: Brain,
    description: 'Routing & Workflows'
  },
  {
    name: 'AIS Config',
    href: '/admin/ais-config',
    icon: Settings,
    description: 'Intensity System Settings'
  },
  {
    name: 'UI Config',
    href: '/admin/ui-config',
    icon: Palette,
    description: 'Design System & Version'
  },
  {
    name: 'HelpBot Config',
    href: '/admin/helpbot-config',
    icon: MessageCircle,
    description: 'AI Assistant Settings'
  },
  {
    name: 'Reward Config',
    href: '/admin/reward-config',
    icon: Gift,
    description: 'Credit Rewards Management'
  },
  {
    name: 'Audit Trail',
    href: '/admin/audit-trail',
    icon: FileText,
    description: 'System Event History'
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
        fixed left-0 top-0 bottom-0 w-64 z-50
        lg:static lg:z-auto lg:translate-x-0
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        transition-transform duration-300 ease-in-out
      `}>
        <div className="h-full bg-slate-900/95 backdrop-blur-xl border-r border-white/10 flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-white/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">AgentPilot</h2>
                  <p className="text-xs text-slate-400">Admin</p>
                </div>
              </div>

              <button
                onClick={onClose}
                className="lg:hidden p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            {navigationItems.map((item, index) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;

              return (
                <motion.div
                  key={item.name}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.05 }}
                >
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className={`relative group flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-200 ${
                      isActive
                        ? 'bg-gradient-to-r from-blue-500/20 to-purple-500/20 text-white border border-blue-400/30'
                        : 'text-slate-300 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {/* Active indicator */}
                    {isActive && (
                      <motion.div
                        layoutId="activeIndicator"
                        className="absolute left-0 w-1 h-6 bg-gradient-to-b from-blue-400 to-purple-400 rounded-r-full"
                        transition={{ type: "spring", duration: 0.6 }}
                      />
                    )}

                    <div className={`p-1.5 rounded-md transition-colors ${
                      isActive
                        ? 'bg-blue-500/20'
                        : 'bg-slate-800/50 group-hover:bg-slate-700/50'
                    }`}>
                      <Icon className="w-4 h-4" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <p className="text-xs text-slate-400 group-hover:text-slate-300 truncate">
                        {item.description}
                      </p>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </nav>

          {/* System Status */}
          <div className="p-3 border-t border-white/10">
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                <span className="text-xs font-medium text-white">System</span>
              </div>

              <div className="space-y-1 text-xs text-slate-400">
                <div className="flex justify-between">
                  <span>API</span>
                  <span className="text-green-400">OK</span>
                </div>
                <div className="flex justify-between">
                  <span>Queue</span>
                  <span className="text-green-400">OK</span>
                </div>
                <div className="flex justify-between">
                  <span>DB</span>
                  <span className="text-green-400">OK</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}