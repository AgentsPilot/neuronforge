'use client'

import { useAuth } from '@/components/UserProvider'
import { redirect, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { 
  LayoutDashboard, 
  Bot, 
  Link2, 
  Settings, 
  User, 
  LogOut, 
  Bell,
  Search,
  Plus,
  ChevronRight,
  Menu,
  X,
  Zap,
  BarChart3,
  Activity,
  Workflow
} from 'lucide-react'

const SidebarLink = ({
  href,
  label,
  icon: Icon,
  badge,
  isActive,
  onClick
}: {
  href: string
  label: string
  icon: any
  badge?: string | number
  isActive?: boolean
  onClick?: () => void
}) => {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={clsx(
        'group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
        isActive 
          ? 'bg-blue-50 text-blue-700 border border-blue-200' 
          : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
      )}
    >
      <Icon className={clsx(
        'h-5 w-5 transition-colors',
        isActive ? 'text-blue-600' : 'text-gray-500 group-hover:text-gray-700'
      )} />
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge !== null && badge !== 0 && (
        <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full font-medium">
          {badge}
        </span>
      )}
      <ChevronRight className={clsx(
        'h-4 w-4 transition-transform opacity-0 group-hover:opacity-100',
        isActive && 'opacity-100 text-blue-600'
      )} />
    </Link>
  )
}

const SidebarSection = ({ 
  title, 
  children 
}: { 
  title: string
  children: React.ReactNode 
}) => (
  <div className="space-y-2">
    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-3">
      {title}
    </h3>
    <div className="space-y-1">
      {children}
    </div>
  </div>
)

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [agentCount, setAgentCount] = useState<number | null>(null)

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  useEffect(() => {
    if (!user) {
      redirect('/login')
    }
  }, [user])

  // Fetch agent count from Supabase
  useEffect(() => {
    let cancelled = false
    async function fetchAgentCount() {
      if (!user) {
        setAgentCount(null)
        return
      }
      const { count, error } = await supabase
        .from('agents')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)

      if (!cancelled) {
        setAgentCount(error ? null : (count ?? 0))
      }
    }
    fetchAgentCount()
    return () => { cancelled = true }
  }, [user])

  if (!user) return null

  const sidebarContent = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
            <Zap className="h-4 w-4 text-white" />
          </div>
          {!isCollapsed && (
            <div>
              <h1 className="text-lg font-bold text-gray-900">AgentPilot</h1>
              <p className="text-xs text-gray-500">AI Automation Platform</p>
            </div>
          )}
        </div>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="hidden lg:flex p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <Menu className="h-4 w-4 text-gray-500" />
        </button>
      </div>

      {/* Search */}
      {!isCollapsed && (
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search agents..."
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      )}

      {/* Quick Actions */}
      {!isCollapsed && (
        <div className="mb-6">
          <button
            className="w-full flex items-center gap-3 px-3 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all duration-200 shadow-sm"
            onClick={() => router.push('/agents/new')}
          >
            <Plus className="h-5 w-5" />
            <span className="font-medium">New Agent</span>
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 space-y-6">
        <SidebarSection title="Main">
          <SidebarLink 
            href="/dashboard" 
            label="Dashboard" 
            icon={LayoutDashboard}
            isActive={pathname === '/dashboard'}
            onClick={() => setIsMobileOpen(false)}
          />
          <SidebarLink 
            href="/agents" 
            label="Agents" 
            icon={Bot}
            badge={agentCount !== null ? agentCount : undefined}
            isActive={pathname === '/agents'}
            onClick={() => setIsMobileOpen(false)}
          />
          <SidebarLink 
            href="/analytics" 
            label="Analytics" 
            icon={BarChart3}
            isActive={pathname === '/analytics'}
            onClick={() => setIsMobileOpen(false)}
          />
        </SidebarSection>

        <SidebarSection title="Automation">
          <SidebarLink 
            href="/orchestration" 
            label="Agent Orchestration" 
            icon={Workflow}
            isActive={pathname === '/orchestration'}
            onClick={() => setIsMobileOpen(false)}
          />          
          <SidebarLink 
            href="/monitoring" 
            label="Monitoring" 
            icon={Activity}
            badge="2"
            isActive={pathname === '/monitoring'}
            onClick={() => setIsMobileOpen(false)}
          />
        </SidebarSection>

        <SidebarSection title="Settings">
          <SidebarLink 
            href="/settings/connections" 
            label="Connections" 
            icon={Link2}
            isActive={pathname === '/settings/connections'}
            onClick={() => setIsMobileOpen(false)}
          />
          <SidebarLink 
            href="/settings" 
            label="Settings" 
            icon={Settings}
            isActive={pathname === '/settings'}
            onClick={() => setIsMobileOpen(false)}
          />
        </SidebarSection>
      </nav>

      {/* User Profile */}
      <div className="border-t border-gray-200 pt-4 mt-6">
        {!isCollapsed ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="w-8 h-8 bg-gradient-to-br from-green-400 to-blue-500 rounded-full flex items-center justify-center">
                <User className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {user.email?.split('@')[0] || 'User'}
                </p>
                <p className="text-xs text-gray-500 truncate">{user.email}</p>
              </div>
              <button className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
                <Bell className="h-4 w-4 text-gray-500" />
              </button>
            </div>
            <button 
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-green-400 to-blue-500 rounded-full flex items-center justify-center">
              <User className="h-4 w-4 text-white" />
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4 text-gray-500" />
            </button>
          </div>
        )}
      </div>
    </>
  )

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-md border border-gray-200"
      >
        <Menu className="h-5 w-5 text-gray-600" />
      </button>

      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black bg-opacity-50" onClick={() => setIsMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={clsx(
        'fixed lg:static inset-y-0 left-0 z-50 bg-white border-r border-gray-200 shadow-sm transition-all duration-300 flex flex-col',
        isCollapsed ? 'w-16' : 'w-64',
        isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>
        {/* Mobile Close Button */}
        <button
          onClick={() => setIsMobileOpen(false)}
          className="lg:hidden absolute top-4 right-4 p-2 rounded-lg hover:bg-gray-100"
        >
          <X className="h-5 w-5 text-gray-500" />
        </button>

        <div className="p-6 flex-1 flex flex-col">
          {sidebarContent}
        </div>
      </aside>

      {/* Main content */}
      <main className={clsx(
        'flex-1 transition-all duration-300',
        'lg:ml-0 pt-16 lg:pt-0'
      )}>
        <div className="p-6 lg:p-8 h-full">
          {children}
        </div>
      </main>
    </div>
  )
}