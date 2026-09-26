'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  MessageSquare,
  Server,
  X,
  TrendingUp,
  Users,
  Settings,
  Gift,
  FileText,
  Brain,
  Activity,
  Palette,
  BarChart3,
  DollarSign,
  MessageCircle,
  HardDrive,
  UserCheck,
  Sparkles,
  Bot,
  Layers,
  Archive
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface AdminSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  description: string;
}

interface NavSection {
  title: string;
  /**
   * Kept in the data but not rendered. The routes still work by URL; the
   * section just takes no sidebar space. Flip to false to bring it back.
   */
  hidden?: boolean;
  items: NavItem[];
}

/**
 * Sidebar IA, slice 1 of ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md (§4, §7).
 *
 * Sections follow the job, not the system: Monitor, then Businesses, then
 * Settings, with the parked AgentsPilot product last. Only labels and
 * descriptions were changed; every href is the route it always was, so no
 * bookmark breaks. Labels are honest about which product a page serves: a
 * page that only configures or shows AgentsPilot says so.
 *
 * Exchange Rates is deliberately NOT listed (requirement §4.3): it writes to
 * the database straight from the browser, so surfacing it would widen exposure.
 *
 * Pinned by `app/admin/components/__tests__/AdminSidebar.nav.test.ts` (section
 * order, one entry per admin page) and by the per-page nav tests next to the
 * Business OS pages.
 */
const navigationSections: NavSection[] = [
  {
    title: 'Monitor',
    items: [
      {
        name: 'Dashboard',
        href: '/admin',
        icon: LayoutDashboard,
        // Still today's dashboard until the Health landing ships (slice 4).
        // Its totals are mostly agents, AIS and memory, hence the wording.
        description: 'Totals, mostly AgentsPilot'
      },
      {
        name: 'AI cost & usage',
        href: '/admin/analytics',
        icon: TrendingUp,
        description: 'Token spend, both products'
      },
      {
        name: 'Audit trail',
        href: '/admin/audit-trail',
        icon: FileText,
        description: 'System event history'
      },
      {
        name: 'Archiving',
        href: '/admin/archiving',
        icon: Archive,
        description: 'Move old audit records out'
      },
    ]
  },
  {
    title: 'Businesses',
    items: [
      {
        // Renamed in slice 2b, once each row shows its business and the detail
        // opens on a Business OS panel. The list still holds every login
        // (one login = one business); a login with no business says so.
        name: 'Businesses',
        href: '/admin/users',
        icon: Users,
        description: 'Every login and its Business OS business'
      },
      {
        name: 'Plans & entitlements',
        href: '/admin/business-os-tiers',
        icon: Layers,
        // Names the product so it is never mistaken for the AgentsPilot free
        // tier on the onboarding page.
        description: 'Business OS plans, read-only'
      },
      {
        name: 'Messages',
        href: '/admin/messages',
        icon: MessageSquare,
        description: 'Contact inquiries'
      },
    ]
  },
  {
    title: 'Settings',
    items: [
      {
        name: 'Business OS AI',
        href: '/admin/business-os-llm',
        icon: Bot,
        // FR-12: the page no longer mirrors the on/off switch (runbook §4 is
        // the switch's door), so the previous description named a surface that
        // is not there. Pinned by `business-os-llm/__tests__/nav.test.ts`,
        // scoped to THIS entry, so it cannot drift back unnoticed.
        description: 'Models & temperatures'
      },
      {
        name: 'Model pricing & billing',
        href: '/admin/system-config',
        icon: DollarSign,
        description: 'Pricing, grace period, boosts'
      },
      {
        name: 'Free tier & onboarding',
        href: '/admin/onboarding',
        icon: UserCheck,
        description: 'Free-tier grant & signups'
      },
      {
        name: 'Admin users',
        href: '/admin/settings',
        icon: Settings,
        description: 'Who can open admin'
      },
    ]
  },
  {
    // Parked, not retired (decision D-3): every page still works at its old
    // URL. Hidden from the sidebar (user decision after slice 1 review,
    // 2026-09-25): twelve always-open items forced a scrollbar for pages
    // nobody operates day to day.
    title: 'AgentsPilot (parked)',
    hidden: true,
    items: [
      {
        name: 'Agent execution queue',
        href: '/admin/queues',
        icon: Server,
        description: 'AgentsPilot agent runs'
      },
      {
        name: 'System flow',
        href: '/admin/system-flow',
        icon: Activity,
        description: 'AgentsPilot pipeline explainer'
      },
      {
        name: 'Agent generation',
        href: '/admin/agent-generation-config',
        icon: Sparkles,
        description: 'AgentsPilot workflow models'
      },
      {
        name: 'Orchestration',
        href: '/admin/orchestration-config',
        icon: Brain,
        description: 'AgentsPilot model routing'
      },
      {
        name: 'AIS config',
        href: '/admin/ais-config',
        icon: Settings,
        description: 'AgentsPilot agent intensity'
      },
      {
        // Not Business OS Insights: this is agent memory, hence the rename.
        name: 'Agent memory config',
        href: '/admin/memory-config',
        icon: Brain,
        description: 'AgentsPilot memory settings'
      },
      {
        name: 'Agent memory dashboard',
        href: '/admin/learning-system',
        icon: BarChart3,
        description: 'AgentsPilot memory & ROI'
      },
      {
        name: 'Reward config',
        href: '/admin/reward-config',
        icon: Gift,
        description: 'AgentsPilot sharing rewards'
      },
      {
        name: 'Storage config',
        href: '/admin/storage-config',
        icon: HardDrive,
        description: 'AgentsPilot storage tiers'
      },
      {
        name: 'Executions config',
        href: '/admin/executions-config',
        icon: BarChart3,
        description: 'AgentsPilot execution quotas'
      },
      {
        name: 'UI config',
        href: '/admin/ui-config',
        icon: Palette,
        description: 'AgentsPilot app UI version'
      },
      {
        name: 'HelpBot config',
        href: '/admin/helpbot-config',
        icon: MessageCircle,
        description: 'AgentsPilot help assistant'
      },
    ]
  },
];

const visibleSections = navigationSections.filter((section) => !section.hidden);

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
        lg:relative lg:z-auto lg:translate-x-0 lg:flex-shrink-0
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        transition-transform duration-300 ease-in-out
      `}>
        <div className="h-full bg-slate-900/95 backdrop-blur-xl border-r border-white/10 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b border-white/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Image
                  src="/images/AgentPilot_Logo.png"
                  alt="AgentPilot"
                  width={100}
                  height={100}
                  className="transition-transform duration-200"
                  priority
                />
                <span className="text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-400 font-medium">
                  Admin
                </span>
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
          <nav className="flex-1 min-h-0 p-3 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
            {visibleSections.map((section, sectionIndex) => (
              <div key={section.title} className={sectionIndex > 0 ? 'mt-6' : ''}>
                {/* Section Title */}
                <div className="px-3 mb-2">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {section.title}
                  </h3>
                </div>

                {/* Section Items */}
                <div className="space-y-1">
                  {section.items.map((item, itemIndex) => {
                    const isActive = pathname === item.href;
                    const Icon = item.icon;
                    const globalIndex = sectionIndex * 10 + itemIndex;

                    return (
                      <motion.div
                        key={item.name}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, delay: globalIndex * 0.02 }}
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
                </div>

                {/* Separator between sections (except last one) */}
                {sectionIndex < visibleSections.length - 1 && (
                  <div className="mt-4 px-3">
                    <div className="h-px bg-white/5" />
                  </div>
                )}
              </div>
            ))}
          </nav>
        </div>
      </div>
    </>
  );
}