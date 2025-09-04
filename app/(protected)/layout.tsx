'use client'

import { useAuth } from '@/components/UserProvider'
import { redirect, usePathname } from 'next/navigation'
import { useEffect, useState, useCallback, useRef } from 'react'
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
  onClick,
  isCollapsed
}: {
  href: string
  label: string
  icon: any
  badge?: string | number
  isActive?: boolean
  onClick?: () => void
  isCollapsed?: boolean
}) => {
  if (isCollapsed) {
    return (
      <Link
        href={href}
        onClick={onClick}
        className={clsx(
          'group flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-200 relative mx-auto',
          isActive 
            ? 'bg-blue-100 text-blue-600' 
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
        )}
        title={label}
      >
        <Icon className="h-5 w-5" />
        {badge !== undefined && badge !== null && badge !== 0 && (
          <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center font-medium min-w-[16px]">
            {badge}
          </span>
        )}
      </Link>
    )
  }

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
  children,
  isCollapsed
}: { 
  title: string
  children: React.ReactNode
  isCollapsed?: boolean
}) => {
  if (isCollapsed) {
    return (
      <div className="space-y-1">
        {children}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-3">
        {title}
      </h3>
      <div className="space-y-1">
        {children}
      </div>
    </div>
  )
}

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  
  // All hooks must be called before any conditional returns
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [agentCount, setAgentCount] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showSearchResults, setShowSearchResults] = useState(false)
  
  // Use refs to prevent race conditions
  const fetchAgentCountRef = useRef<AbortController | null>(null)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Improved agent count fetching with proper cleanup
  const fetchAgentCount = useCallback(async () => {
    if (!user?.id) {
      setAgentCount(null)
      return
    }

    // Cancel any existing request
    if (fetchAgentCountRef.current) {
      fetchAgentCountRef.current.abort()
    }

    // Create new abort controller
    const controller = new AbortController()
    fetchAgentCountRef.current = controller

    try {
      const { count, error } = await supabase
        .from('agents')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_archived', false) // Only count non-archived agents for consistency

      // Check if request was aborted
      if (controller.signal.aborted) return

      if (error) {
        console.error('Error fetching agent count:', error)
        setAgentCount(null)
      } else {
        setAgentCount(count ?? 0)
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error('Agent count fetch error:', err)
        setAgentCount(null)
      }
    } finally {
      if (fetchAgentCountRef.current === controller) {
        fetchAgentCountRef.current = null
      }
    }
  }, [user?.id])

  // Improved search functionality
  const handleSearch = useCallback(async (query: string) => {
    if (!user?.id) return

    if (!query.trim()) {
      setSearchResults([])
      setShowSearchResults(false)
      return
    }

    setIsSearching(true)
    setShowSearchResults(true)

    try {
      const searchTerm = `%${query.toLowerCase()}%`
      
      const { data, error } = await supabase
        .from('agents')
        .select('id, agent_name, description, status')
        .eq('user_id', user.id)
        .eq('is_archived', false)
        .or(`agent_name.ilike.${searchTerm},description.ilike.${searchTerm}`)
        .limit(5)

      if (error) {
        console.error('Supabase search error:', error)
        // Fallback: get all agents and filter client-side
        const { data: allAgents, error: fallbackError } = await supabase
          .from('agents')
          .select('id, agent_name, description, status')
          .eq('user_id', user.id)
          .eq('is_archived', false)

        if (!fallbackError && allAgents) {
          const filtered = allAgents.filter(agent => 
            agent.agent_name?.toLowerCase().includes(query.toLowerCase()) ||
            agent.description?.toLowerCase().includes(query.toLowerCase())
          ).slice(0, 5)
          setSearchResults(filtered)
        } else {
          setSearchResults([])
        }
      } else if (data) {
        setSearchResults(data)
      }
    } catch (err) {
      console.error('Search error:', err)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }, [user?.id])

  // Function to refresh agent count - can be called from other parts of the app
  const refreshAgentCount = useCallback(() => {
    fetchAgentCount()
  }, [fetchAgentCount])

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }, [router])

  const handleSearchResultClick = useCallback((agentId: string) => {
    setShowSearchResults(false)
    setSearchQuery('')
    setIsMobileOpen(false)
    router.push(`/agents/${agentId}`)
  }, [router])

  // Effect for fetching agent count
  useEffect(() => {
    fetchAgentCount()
    
    // Cleanup on unmount
    return () => {
      if (fetchAgentCountRef.current) {
        fetchAgentCountRef.current.abort()
        fetchAgentCountRef.current = null
      }
    }
  }, [fetchAgentCount])

  // Debounced search effect
  useEffect(() => {
    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    // Set new timeout
    searchTimeoutRef.current = setTimeout(() => {
      handleSearch(searchQuery)
    }, 300)

    // Cleanup function
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [searchQuery, handleSearch])

  // Expose refreshAgentCount function globally (optional)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).refreshAgentCount = refreshAgentCount
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).refreshAgentCount
      }
    }
  }, [refreshAgentCount])

  // Show loading spinner while auth state is being determined
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  // Only redirect after loading is complete and we know user is not authenticated
  if (!user) {
    redirect('/login')
    return null
  }

  const sidebarContent = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        {!isCollapsed ? (
          <>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                <Zap className="h-4 w-4 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">AgentPilot</h1>
                <p className="text-xs text-gray-500">AI Automation Platform</p>
              </div>
            </div>
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="hidden lg:flex p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              title="Collapse sidebar"
            >
              <Menu className="h-4 w-4 text-gray-500" />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-4 w-full">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="hidden lg:flex p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              title="Expand sidebar"
            >
              <Menu className="h-4 w-4 text-gray-500" />
            </button>
          </div>
        )}
      </div>

      {/* Search */}
      {!isCollapsed && (
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search agents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => searchQuery && setShowSearchResults(true)}
            onBlur={() => setTimeout(() => setShowSearchResults(false), 150)}
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          
          {/* Search Results Dropdown */}
          {showSearchResults && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-64 overflow-y-auto">
              {isSearching ? (
                <div className="p-3 text-center text-gray-500 text-sm">
                  <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                  Searching...
                </div>
              ) : searchResults.length > 0 ? (
                <div className="py-1">
                  {searchResults.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => handleSearchResultClick(agent.id)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Bot className="h-4 w-4 text-blue-500" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{agent.agent_name}</p>
                          {agent.description && (
                            <p className="text-xs text-gray-500 truncate">{agent.description}</p>
                          )}
                        </div>
                        <div className={clsx(
                          'w-2 h-2 rounded-full',
                          agent.status === 'active' ? 'bg-green-400' : 
                          agent.status === 'draft' ? 'bg-yellow-400' : 'bg-gray-300'
                        )} />
                      </div>
                    </button>
                  ))}
                </div>
              ) : searchQuery ? (
                <div className="p-3 text-center text-gray-500 text-sm">
                  No agents found for "{searchQuery}"
                </div>
              ) : null}
              
              {searchQuery && searchResults.length > 0 && (
                <div className="border-t border-gray-100 p-2">
                  <button 
                    onClick={() => {
                      router.push(`/agents?search=${encodeURIComponent(searchQuery)}`)
                      setShowSearchResults(false)
                      setIsMobileOpen(false)
                    }}
                    className="w-full text-left px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
                  >
                    View all results for "{searchQuery}"
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Quick Actions */}
      {!isCollapsed ? (
        <div className="mb-6">
          <button
            className="w-full flex items-center gap-3 px-3 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all duration-200 shadow-sm"
            onClick={() => router.push('/agents/new')}
          >
            <Plus className="h-5 w-5" />
            <span className="font-medium">New Agent</span>
          </button>
        </div>
      ) : (
        <div className="mb-6 flex justify-center">
          <button
            className="flex items-center justify-center w-10 h-10 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all duration-200 shadow-sm"
            onClick={() => router.push('/agents/new')}
            title="New Agent"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 space-y-4">
        <SidebarSection title="Main" isCollapsed={isCollapsed}>
          <SidebarLink 
            href="/dashboard" 
            label="Dashboard" 
            icon={LayoutDashboard}
            isActive={pathname === '/dashboard'}
            onClick={() => setIsMobileOpen(false)}
            isCollapsed={isCollapsed}
          />
          <SidebarLink 
            href="/agents" 
            label="Agents" 
            icon={Bot}
            badge={agentCount !== null ? agentCount : undefined}
            isActive={pathname === '/agents'}
            onClick={() => setIsMobileOpen(false)}
            isCollapsed={isCollapsed}
          />
          <SidebarLink 
            href="/analytics" 
            label="Analytics" 
            icon={BarChart3}
            isActive={pathname === '/analytics'}
            onClick={() => setIsMobileOpen(false)}
            isCollapsed={isCollapsed}
          />
        </SidebarSection>

        <SidebarSection title="Automation" isCollapsed={isCollapsed}>
          <SidebarLink 
            href="/orchestration" 
            label="Agent Orchestration" 
            icon={Workflow}
            isActive={pathname === '/orchestration'}
            onClick={() => setIsMobileOpen(false)}
            isCollapsed={isCollapsed}
          />          
          <SidebarLink 
            href="/monitoring" 
            label="Monitoring" 
            icon={Activity}
            badge="2"
            isActive={pathname === '/monitoring'}
            onClick={() => setIsMobileOpen(false)}
            isCollapsed={isCollapsed}
          />
        </SidebarSection>

        <SidebarSection title="Settings" isCollapsed={isCollapsed}>
          <SidebarLink 
            href="/settings/connections" 
            label="Connections" 
            icon={Link2}
            isActive={pathname === '/settings/connections'}
            onClick={() => setIsMobileOpen(false)}
            isCollapsed={isCollapsed}
          />
          <SidebarLink 
            href="/settings" 
            label="Settings" 
            icon={Settings}
            isActive={pathname === '/settings'}
            onClick={() => setIsMobileOpen(false)}
            isCollapsed={isCollapsed}
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
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-green-400 to-blue-500 rounded-full flex items-center justify-center">
              <User className="h-4 w-4 text-white" />
            </div>
            <button 
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              title="Notifications"
            >
              <Bell className="h-4 w-4 text-gray-500" />
            </button>
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

        <div className="p-4 flex-1 flex flex-col">
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