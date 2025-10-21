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
          'group flex items-center justify-center w-12 h-12 rounded-xl transition-all duration-200 relative mx-auto',
          isActive 
            ? 'text-blue-600' 
            : 'text-slate-500 hover:text-blue-500'
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
        'group flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200',
        isActive 
          ? 'text-blue-600' 
          : 'text-slate-700 hover:text-blue-500'
      )}
    >
      <Icon className={clsx(
        'h-5 w-5 transition-colors duration-200',
        isActive ? 'text-blue-600' : 'text-slate-500 group-hover:text-blue-500'
      )} />
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge !== null && badge !== 0 && (
        <span className={clsx(
          'text-xs px-2 py-0.5 rounded-full font-medium transition-colors duration-200',
          isActive 
            ? 'bg-blue-100 text-blue-700'
            : 'bg-slate-100 text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-700'
        )}>
          {badge}
        </span>
      )}
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
      <div className="space-y-2">
        {children}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest px-4">
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
  const [templateCount, setTemplateCount] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [profile, setProfile] = useState<any>(null)
  
  // Use refs to prevent race conditions
  const fetchAgentCountRef = useRef<AbortController | null>(null)
  const fetchTemplateCountRef = useRef<AbortController | null>(null)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Fetch user profile data
  const fetchProfile = useCallback(async () => {
    if (!user?.id) {
      setProfile(null)
      return
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, avatar_url, company, job_title')
        .eq('id', user.id)
        .single()

      if (error) {
        console.error('Error fetching profile:', error)
        setProfile(null)
      } else {
        setProfile(data)
      }
    } catch (err) {
      console.error('Profile fetch error:', err)
      setProfile(null)
    }
  }, [user?.id])

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

  // Template count fetching with proper cleanup
  const fetchTemplateCount = useCallback(async () => {
    // Cancel any existing request
    if (fetchTemplateCountRef.current) {
      fetchTemplateCountRef.current.abort()
    }

    // Create new abort controller
    const controller = new AbortController()
    fetchTemplateCountRef.current = controller

    try {
      const { count, error } = await supabase
        .from('shared_agents')
        .select('*', { count: 'exact', head: true })

      // Check if request was aborted
      if (controller.signal.aborted) return

      if (error) {
        console.error('Error fetching template count:', error)
        setTemplateCount(null)
      } else {
        setTemplateCount(count ?? 0)
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error('Template count fetch error:', err)
        setTemplateCount(null)
      }
    } finally {
      if (fetchTemplateCountRef.current === controller) {
        fetchTemplateCountRef.current = null
      }
    }
  }, [])

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

  // Function to refresh counts - can be called from other parts of the app
  const refreshCounts = useCallback(() => {
    fetchAgentCount()
    fetchTemplateCount()
  }, [fetchAgentCount, fetchTemplateCount])

  // Individual refresh functions
  const refreshAgentCount = useCallback(() => {
    fetchAgentCount()
  }, [fetchAgentCount])

  const refreshTemplateCount = useCallback(() => {
    fetchTemplateCount()
  }, [fetchTemplateCount])

  // Improved logout function
  const handleLogout = useCallback(async () => {
    try {
      // Sign out from Supabase
      const { error } = await supabase.auth.signOut()
      
      if (error) {
        console.error('Logout error:', error)
        // Still continue with logout process even if there's an error
      }
      
      // Clear any cached data
      setAgentCount(null)
      setTemplateCount(null)
      setSearchQuery('')
      setSearchResults([])
      setShowSearchResults(false)
      setIsMobileOpen(false)
      setProfile(null)
      
      // Use window.location.href for a clean redirect
      window.location.href = '/login'
      
    } catch (error) {
      console.error('Unexpected logout error:', error)
      // Force redirect even if there's an error
      window.location.href = '/login'
    }
  }, [])

  const handleSearchResultClick = useCallback((agentId: string) => {
    setShowSearchResults(false)
    setSearchQuery('')
    setIsMobileOpen(false)
    router.push(`/agents/${agentId}`)
  }, [router])

  // Effect for fetching counts and profile
  useEffect(() => {
    fetchAgentCount()
    fetchTemplateCount()
    fetchProfile()
    
    // Cleanup on unmount
    return () => {
      if (fetchAgentCountRef.current) {
        fetchAgentCountRef.current.abort()
        fetchAgentCountRef.current = null
      }
      if (fetchTemplateCountRef.current) {
        fetchTemplateCountRef.current.abort()
        fetchTemplateCountRef.current = null
      }
    }
  }, [fetchAgentCount, fetchTemplateCount, fetchProfile])

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

  // Show loading spinner while auth state is being determined
// Show loading spinner while auth state is being determined
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50">
        <div className="text-center">
          {/* Logo */}
          <div className="mb-8 flex justify-center">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 rounded-3xl flex items-center justify-center shadow-lg">
              <Zap className="h-10 w-10 text-white" />
            </div>
          </div>

          {/* Simple spinner */}
          <div className="mb-6 flex justify-center">
            <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
          </div>

          {/* Text */}
          <h2 className="text-xl font-semibold text-slate-800 mb-2">
            Loading AgentPilot
          </h2>
          <p className="text-slate-500 text-sm">
            Please wait...
          </p>
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
      <div className="flex items-center justify-between mb-10">
        {!isCollapsed ? (
          <>
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 rounded-2xl flex items-center justify-center shadow-lg">
                  <Zap className="h-5 w-5 text-white drop-shadow-sm" />
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-gradient-to-r from-green-400 to-emerald-500 rounded-full animate-pulse shadow-lg"></div>
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
                  AgentPilot
                </h1>
                <p className="text-xs text-slate-500 font-medium">AI Automation Platform</p>
              </div>
            </div>
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="hidden lg:flex p-2 rounded-xl hover:bg-white/80 transition-all duration-300 hover:shadow-md hover:scale-105"
              title="Collapse sidebar"
            >
              <Menu className="h-4 w-4 text-slate-500" />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-6 w-full">
            <div className="relative">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 rounded-2xl flex items-center justify-center shadow-lg">
                <Zap className="h-5 w-5 text-white drop-shadow-sm" />
              </div>
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-gradient-to-r from-green-400 to-emerald-500 rounded-full animate-pulse shadow-lg"></div>
            </div>
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="hidden lg:flex p-2 rounded-xl hover:bg-white/80 transition-all duration-300 hover:shadow-md hover:scale-105"
              title="Expand sidebar"
            >
              <Menu className="h-4 w-4 text-slate-500" />
            </button>
          </div>
        )}
      </div>

      {/* Search */}
      {!isCollapsed && (
        <div className="relative mb-8">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search agents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchQuery && setShowSearchResults(true)}
              onBlur={() => setTimeout(() => setShowSearchResults(false), 150)}
              className="w-full pl-11 pr-4 py-3 bg-white/80 backdrop-blur-sm border border-slate-200/50 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-300/50 transition-all duration-300 shadow-sm hover:shadow-md"
            />
          </div>
          
          {/* Search Results Dropdown */}
          {showSearchResults && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white/95 backdrop-blur-md border border-slate-200/50 rounded-2xl shadow-xl z-10 max-h-72 overflow-y-auto">
              {isSearching ? (
                <div className="p-4 text-center text-slate-500 text-sm">
                  <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3"></div>
                  Searching...
                </div>
              ) : searchResults.length > 0 ? (
                <div className="py-2">
                  {searchResults.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => handleSearchResultClick(agent.id)}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50/80 transition-all duration-200 hover:scale-[1.01]"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-xl">
                          <Bot className="h-4 w-4 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{agent.agent_name}</p>
                          {agent.description && (
                            <p className="text-xs text-slate-500 truncate">{agent.description}</p>
                          )}
                        </div>
                        <div className={clsx(
                          'w-3 h-3 rounded-full shadow-sm',
                          agent.status === 'active' ? 'bg-gradient-to-r from-green-400 to-emerald-500 animate-pulse' : 
                          agent.status === 'draft' ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-slate-300'
                        )} />
                      </div>
                    </button>
                  ))}
                </div>
              ) : searchQuery ? (
                <div className="p-4 text-center text-slate-500 text-sm">
                  No agents found for "{searchQuery}"
                </div>
              ) : null}
              
              {searchQuery && searchResults.length > 0 && (
                <div className="border-t border-slate-100 p-3">
                  <button 
                    onClick={() => {
                      router.push(`/agents?search=${encodeURIComponent(searchQuery)}`)
                      setShowSearchResults(false)
                      setIsMobileOpen(false)
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-blue-600 hover:bg-blue-50/80 rounded-xl transition-all duration-200 font-medium"
                  >
                    View all results for "{searchQuery}"
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 space-y-6">
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
            href="/analytic" 
            label="Analytics" 
            icon={BarChart3}
            isActive={pathname === '/analytic'}
            onClick={() => setIsMobileOpen(false)}
            isCollapsed={isCollapsed}
          />
          <SidebarLink 
            href="/templates" 
            label="Templates" 
            icon={Workflow}
            badge={templateCount !== null ? templateCount : undefined}
            isActive={pathname === '/templates'}
            onClick={() => setIsMobileOpen(false)}
            isCollapsed={isCollapsed}
          />          
          <SidebarLink
            href="/monitoring"
            label="Audit Trail"
            icon={Activity}
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
      <div className="border-t border-slate-200/50 pt-6 mt-6">
        {!isCollapsed ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/50 backdrop-blur-sm border border-slate-200/50">
              <div className="relative">
                {/* Avatar Display */}
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt="Profile"
                    className="w-10 h-10 rounded-2xl object-cover shadow-lg border-2 border-white"
                    onError={(e) => {
                      // Fallback to initials if image fails
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-blue-500 rounded-2xl flex items-center justify-center shadow-lg">
                    <span className="text-white text-sm font-bold">
                      {profile?.full_name 
                        ? profile.full_name.charAt(0).toUpperCase()
                        : user.email?.charAt(0).toUpperCase() || 'U'
                      }
                    </span>
                  </div>
                )}
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-gradient-to-r from-green-400 to-emerald-500 rounded-full border-2 border-white shadow-md"></div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {profile?.full_name || user.email?.split('@')[0] || 'User'}
                </p>
                <p className="text-xs text-slate-500 truncate">{user.email}</p>
              </div>
              <button className="p-2 rounded-xl hover:bg-slate-100/80 transition-all duration-300 hover:scale-105 relative">
                <Bell className="h-4 w-4 text-slate-500" />
                <div className="absolute top-1 right-1 w-2 h-2 bg-gradient-to-r from-red-500 to-pink-500 rounded-full animate-pulse"></div>
              </button>
            </div>
            <button 
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-red-50/80 hover:text-red-600 rounded-2xl transition-all duration-300 group"
            >
              <LogOut className="h-4 w-4 group-hover:scale-110 transition-transform duration-300" />
              <span>Sign Out</span>
              <ChevronRight className="h-4 w-4 ml-auto opacity-0 group-hover:opacity-100 transition-all duration-300 group-hover:translate-x-1" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              {/* Collapsed Avatar Display */}
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt="Profile"
                  className="w-10 h-10 rounded-2xl object-cover shadow-lg border-2 border-white"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                  }}
                />
              ) : (
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-blue-500 rounded-2xl flex items-center justify-center shadow-lg">
                  <span className="text-white text-sm font-bold">
                    {profile?.full_name 
                      ? profile.full_name.charAt(0).toUpperCase()
                      : user.email?.charAt(0).toUpperCase() || 'U'
                    }
                  </span>
                </div>
              )}
              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-gradient-to-r from-green-400 to-emerald-500 rounded-full border-2 border-white shadow-md"></div>
            </div>
            <button 
              className="p-3 rounded-2xl hover:bg-white/80 transition-all duration-300 hover:scale-105 relative"
              title="Notifications"
            >
              <Bell className="h-4 w-4 text-slate-500" />
              <div className="absolute top-2 right-2 w-2 h-2 bg-gradient-to-r from-red-500 to-pink-500 rounded-full animate-pulse"></div>
            </button>
            <button 
              onClick={handleLogout}
              className="p-3 rounded-2xl hover:bg-red-50/80 hover:scale-105 transition-all duration-300 group"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4 text-slate-500 group-hover:text-red-600 group-hover:scale-110 transition-all duration-300" />
            </button>
          </div>
        )}
      </div>
    </>
  )

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-purple-50/30">
      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsMobileOpen(true)}
        className="lg:hidden fixed top-6 left-6 z-50 p-3 bg-white/90 backdrop-blur-md rounded-2xl shadow-lg border border-slate-200/50 hover:scale-105 transition-all duration-300"
      >
        <Menu className="h-5 w-5 text-slate-600" />
      </button>

      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={() => setIsMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={clsx(
        'fixed lg:static inset-y-0 left-0 z-50 bg-white/80 backdrop-blur-xl border-r border-slate-200/50 shadow-xl transition-all duration-300 flex flex-col',
        isCollapsed ? 'w-20' : 'w-72',
        isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>
        {/* Mobile Close Button */}
        <button
          onClick={() => setIsMobileOpen(false)}
          className="lg:hidden absolute top-6 right-6 p-2 rounded-xl hover:bg-slate-100/80 transition-all duration-300"
        >
          <X className="h-5 w-5 text-slate-500" />
        </button>

        <div className="p-6 flex-1 flex flex-col">
          {sidebarContent}
        </div>
      </aside>

      {/* Main content */}
      <main className={clsx(
        'flex-1 transition-all duration-300',
        'lg:ml-0 pt-20 lg:pt-0'
      )}>
        <div className="p-8 lg:p-10 h-full">
          <div className="bg-white/60 backdrop-blur-sm rounded-3xl shadow-sm border border-white/50 p-8 h-full min-h-[calc(100vh-5rem)] lg:min-h-[calc(100vh-2.5rem)]">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}