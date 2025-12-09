// app/v2/agent-list/page.tsx
// V2 Agent List - Shows all user agents with filtering, search, and pagination

'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { Card } from '@/components/v2/ui/card'
import { V2Logo, V2Controls } from '@/components/v2/V2Header'
import {
  ArrowLeft,
  Bot,
  Search,
  Clock,
  Play,
  Pause,
  CheckCircle,
  AlertCircle,
  Calendar,
  Activity,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
  ArrowUpDown,
  ChevronDown
} from 'lucide-react'
import { formatScheduleDisplay } from '@/lib/utils/scheduleFormatter'

type Agent = {
  id: string
  agent_name: string
  description?: string
  status: string
  mode?: string
  schedule_cron?: string
  timezone?: string
  next_run?: string
  created_at?: string
  memory_count?: number
}

type FilterType = 'all' | 'active' | 'inactive' | 'draft'
type SortType = 'created_desc' | 'created_asc' | 'name_asc' | 'name_desc'

type Toast = {
  id: string
  message: string
  type: 'success' | 'error' | 'warning' | 'info'
}

const ITEMS_PER_PAGE = 5

// Toast Notification Component
const ToastNotification = ({
  message,
  type,
  onClose
}: {
  message: string
  type: 'success' | 'error' | 'warning' | 'info'
  onClose: () => void
}) => {
  const config = {
    success: {
      icon: CheckCircle,
      bg: 'bg-green-100 dark:bg-green-900/30',
      border: 'border-green-300 dark:border-green-700',
      text: 'text-green-900 dark:text-green-100',
      iconColor: 'text-green-600 dark:text-green-400'
    },
    error: {
      icon: AlertCircle,
      bg: 'bg-red-100 dark:bg-red-900/30',
      border: 'border-red-300 dark:border-red-700',
      text: 'text-red-900 dark:text-red-100',
      iconColor: 'text-red-600 dark:text-red-400'
    },
    warning: {
      icon: AlertCircle,
      bg: 'bg-yellow-100 dark:bg-yellow-900/30',
      border: 'border-yellow-300 dark:border-yellow-700',
      text: 'text-yellow-900 dark:text-yellow-100',
      iconColor: 'text-yellow-600 dark:text-yellow-400'
    },
    info: {
      icon: Clock,
      bg: 'bg-blue-100 dark:bg-blue-900/30',
      border: 'border-blue-300 dark:border-blue-700',
      text: 'text-blue-900 dark:text-blue-100',
      iconColor: 'text-blue-600 dark:text-blue-400'
    }
  }[type]

  const Icon = config.icon

  useEffect(() => {
    const timer = setTimeout(() => {
      onClose()
    }, 5000)
    return () => clearTimeout(timer)
  }, [onClose])

  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border-2 ${config.border} ${config.bg} shadow-xl animate-slide-in-right`}>
      <Icon className={`w-6 h-6 ${config.iconColor} flex-shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${config.text} whitespace-pre-line leading-relaxed`}>{message}</p>
      </div>
      <button
        onClick={onClose}
        className={`${config.text} hover:opacity-70 transition-opacity flex-shrink-0 p-1`}
        aria-label="Close notification"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  )
}

export default function V2AgentListPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [sortType, setSortType] = useState<SortType>('created_desc')
  const [currentPage, setCurrentPage] = useState(1)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [executingAgents, setExecutingAgents] = useState<Set<string>>(new Set())
  const [pausingAgents, setPausingAgents] = useState<Set<string>>(new Set())
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [sortButtonRect, setSortButtonRect] = useState<DOMRect | null>(null)
  const sortButtonRef = React.useRef<HTMLButtonElement>(null)
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (user) {
      fetchAgents()
    }
  }, [user, filterType])

  const fetchAgents = async () => {
    if (!user) return

    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterType !== 'all') {
        params.set('status', filterType)
      }
      params.set('includeInactive', 'true')

      const response = await fetch(`/api/agents?${params.toString()}`, {
        headers: {
          'x-user-id': user.id,
        },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch agents')
      }

      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch agents')
      }

      setAgents(result.agents || [])
    } catch (error) {
      console.error('Error fetching agents:', error)
      addToast('Failed to load agents', 'error')
    } finally {
      setLoading(false)
    }
  }

  const addToast = useCallback((message: string, type: Toast['type']) => {
    const id = Date.now().toString()
    setToasts(prev => {
      const newToasts = [...prev, { id, message, type }]
      if (newToasts.length > 3) {
        newToasts.shift()
      }
      return newToasts
    })
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id))
  }, [])

  const handleExecuteAgent = async (e: React.MouseEvent, agentId: string, agentName: string) => {
    e.stopPropagation()

    if (executingAgents.has(agentId)) return

    setExecutingAgents(prev => new Set(prev).add(agentId))

    try {
      const response = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          input_variables: {},
          use_queue: true,
          execution_type: 'manual'
        }),
      })

      if (response.status === 409) {
        addToast(`${agentName} is already running\n\nPlease wait for it to complete.`, 'warning')
        setExecutingAgents(prev => {
          const newSet = new Set(prev)
          newSet.delete(agentId)
          return newSet
        })
        return
      }

      if (!response.ok) {
        const errorText = await response.text()
        let errorMessage = 'Failed to start agent'
        try {
          const errorJson = JSON.parse(errorText)
          errorMessage = errorJson.error || errorJson.message || errorMessage
        } catch {
          errorMessage = errorText || errorMessage
        }
        addToast(`Failed to start ${agentName}\n\n${errorMessage}`, 'error')
        setExecutingAgents(prev => {
          const newSet = new Set(prev)
          newSet.delete(agentId)
          return newSet
        })
        return
      }

      const result = await response.json()

      if (result.success) {
        addToast(`${agentName} started successfully!\n\nYour agent is now processing.`, 'success')
        setTimeout(() => {
          setExecutingAgents(prev => {
            const newSet = new Set(prev)
            newSet.delete(agentId)
            return newSet
          })
        }, 2000)
      } else {
        addToast(`Failed to start ${agentName}\n\n${result.error}`, 'error')
        setExecutingAgents(prev => {
          const newSet = new Set(prev)
          newSet.delete(agentId)
          return newSet
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      addToast(`Error\n\n${errorMessage}`, 'error')
      setExecutingAgents(prev => {
        const newSet = new Set(prev)
        newSet.delete(agentId)
        return newSet
      })
    }
  }

  const handleToggleAgentStatus = async (e: React.MouseEvent, agentId: string, currentStatus: string, agentName: string) => {
    e.stopPropagation()

    if (pausingAgents.has(agentId) || !user) return

    setPausingAgents(prev => new Set(prev).add(agentId))

    const newStatus = currentStatus === 'active' ? 'inactive' : 'active'

    try {
      const response = await fetch(`/api/agents/${agentId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ status: newStatus }),
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to update status')
      }

      setAgents(prev => prev.map(agent =>
        agent.id === agentId ? { ...agent, status: newStatus } : agent
      ))

      addToast(
        `${agentName} ${newStatus === 'active' ? 'activated' : 'paused'} successfully`,
        'success'
      )
    } catch (error) {
      console.error('Error updating agent status:', error)
      addToast(`Failed to ${newStatus === 'active' ? 'activate' : 'pause'} ${agentName}`, 'error')
    } finally {
      setPausingAgents(prev => {
        const newSet = new Set(prev)
        newSet.delete(agentId)
        return newSet
      })
    }
  }

  // Filter and sort agents
  const filteredAgents = agents
    .filter(agent =>
      agent.agent_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.description?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      switch (sortType) {
        case 'created_desc':
          return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        case 'created_asc':
          return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
        case 'name_asc':
          return a.agent_name.localeCompare(b.agent_name)
        case 'name_desc':
          return b.agent_name.localeCompare(a.agent_name)
        default:
          return 0
      }
    })

  const sortOptions = [
    { value: 'created_desc' as SortType, label: 'Newest first' },
    { value: 'created_asc' as SortType, label: 'Oldest first' },
    { value: 'name_asc' as SortType, label: 'A to Z' },
    { value: 'name_desc' as SortType, label: 'Z to A' }
  ]

  // Pagination
  const totalPages = Math.ceil(filteredAgents.length / ITEMS_PER_PAGE)
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = startIndex + ITEMS_PER_PAGE
  const paginatedAgents = filteredAgents.slice(startIndex, endIndex)

  useEffect(() => {
    // Reset to page 1 when filters change
    setCurrentPage(1)
  }, [searchQuery, filterType])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500'
      case 'inactive':
        return 'bg-gray-400'
      case 'draft':
        return 'bg-yellow-500'
      default:
        return 'bg-gray-300'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
      case 'inactive':
        return <Pause className="w-4 h-4 text-gray-600 dark:text-gray-400" />
      case 'draft':
        return <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
      default:
        return null
    }
  }

  const formatNextRun = (nextRunString?: string) => {
    if (!nextRunString) return null

    try {
      const nextRun = new Date(nextRunString)
      const now = new Date()
      const diffInMs = nextRun.getTime() - now.getTime()
      const diffInMinutes = Math.floor(diffInMs / (1000 * 60))
      const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60))
      const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24))

      if (diffInMinutes < 0) return 'Overdue'
      if (diffInMinutes < 60) return `In ${diffInMinutes}m`
      if (diffInHours < 24) return `In ${diffInHours}h`
      if (diffInDays === 1) return 'Tomorrow'
      return `In ${diffInDays}d`
    } catch {
      return null
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      {/* Toast Container */}
      <div className="fixed top-4 right-4 z-50 space-y-2 max-w-md">
        {toasts.map((toast) => (
          <ToastNotification
            key={toast.id}
            message={toast.message}
            type={toast.type}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </div>

      {/* Logo - First Line */}
      <div className="mb-3">
        <V2Logo />
      </div>

      {/* Back Button + Controls */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push('/v2/dashboard')}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:scale-105 transition-all duration-200 text-sm font-medium shadow-[var(--v2-shadow-card)]"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
        <V2Controls />
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-[var(--v2-text-primary)] mb-2">
          Your Agents
        </h1>
        <p className="text-base sm:text-lg text-[var(--v2-text-secondary)]">
          Manage and monitor all your automation agents
        </p>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 overflow-visible">
        {/* Search Bar */}
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--v2-text-muted)]" />
          <input
            type="text"
            placeholder="Search agents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-[var(--v2-surface)] border border-gray-200 dark:border-slate-700 text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] transition-all"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          />
        </div>

        {/* Filter and Sort Buttons */}
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ overflowY: 'visible' }}>
          {(['all', 'active', 'inactive', 'draft'] as FilterType[]).map((filter) => {
            const count = filter === 'all'
              ? agents.length
              : agents.filter(a => a.status === filter).length

            return (
              <button
                key={filter}
                onClick={() => setFilterType(filter)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all ${
                  filterType === filter
                    ? 'bg-[var(--v2-primary)] text-white'
                    : 'bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-gray-200 dark:border-slate-700'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {filter.charAt(0).toUpperCase() + filter.slice(1)}
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  filterType === filter
                    ? 'bg-white/20'
                    : 'bg-gray-100 dark:bg-gray-800 text-[var(--v2-text-muted)]'
                }`}>
                  {count}
                </span>
              </button>
            )
          })}

          {/* Sort Dropdown */}
          <div className="relative">
            <button
              ref={sortButtonRef}
              onClick={(e) => {
                e.stopPropagation()
                if (sortButtonRef.current) {
                  setSortButtonRect(sortButtonRef.current.getBoundingClientRect())
                }
                setShowSortMenu(!showSortMenu)
              }}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-gray-200 dark:border-slate-700 transition-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              Sort
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSortMenu ? 'rotate-180' : ''}`} />
            </button>

            {showSortMenu && sortButtonRect && (
              <>
                <div
                  className="fixed inset-0 z-[100]"
                  onClick={() => setShowSortMenu(false)}
                />
                <div
                  className="fixed w-48 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 shadow-xl z-[101]"
                  style={{
                    borderRadius: 'var(--v2-radius-button)',
                    top: `${sortButtonRect.bottom + 8}px`,
                    right: `${window.innerWidth - sortButtonRect.right}px`
                  }}
                >
                  {sortOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setSortType(option.value)
                        setShowSortMenu(false)
                      }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                        sortType === option.value
                          ? 'bg-[var(--v2-primary)] text-white'
                          : 'text-[var(--v2-text-secondary)] hover:bg-gray-50 dark:hover:bg-gray-800/50'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Agents List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--v2-primary)]"></div>
        </div>
      ) : filteredAgents.length === 0 ? (
        <Card className="!p-8 sm:!p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <Bot className="w-12 h-12 sm:w-16 sm:h-16 text-[var(--v2-text-muted)] opacity-20 mb-4" />
            <h3 className="text-base sm:text-lg font-semibold text-[var(--v2-text-primary)] mb-2">
              {searchQuery ? 'No agents found' : 'No agents yet'}
            </h3>
            <p className="text-sm text-[var(--v2-text-muted)] mb-6">
              {searchQuery
                ? 'Try adjusting your search or filters'
                : 'Create your first agent to get started with automation'
              }
            </p>
            {!searchQuery && (
              <button
                onClick={() => router.push('/agents/new/chat')}
                className="px-6 py-3 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white font-semibold text-sm hover:opacity-90 transition-opacity"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                Create Your First Agent
              </button>
            )}
          </div>
        </Card>
      ) : (
        <>
          <div className="space-y-3 sm:space-y-4">
            {paginatedAgents.map((agent) => (
              <Card
                key={agent.id}
                hoverable
                onClick={() => router.push(`/v2/agents/${agent.id}`)}
                onMouseEnter={(e) => {
                  if (agent.description) {
                    setHoveredAgent(agent.id)
                    const rect = e.currentTarget.getBoundingClientRect()
                    setTooltipPosition({ x: rect.left, y: rect.top })
                  }
                }}
                onMouseLeave={() => {
                  setHoveredAgent(null)
                  setTooltipPosition(null)
                }}
                className="!p-3 relative"
              >
                <div className="flex items-center justify-between gap-3">
                  {/* Left side - Agent info */}
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className={`w-1.5 h-1.5 rounded-full ${getStatusColor(agent.status)} flex-shrink-0`} />

                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] truncate">
                        {agent.agent_name}
                      </h3>

                      {/* Metadata */}
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-[var(--v2-text-muted)]">
                        {/* Mode */}
                        {agent.mode && (
                          <div className="flex items-center gap-1">
                            {agent.mode === 'scheduled' ? (
                              <Calendar className="w-3 h-3" />
                            ) : (
                              <Activity className="w-3 h-3" />
                            )}
                            <span className="capitalize">{agent.mode}</span>
                          </div>
                        )}

                        {/* Next Run */}
                        {agent.mode === 'scheduled' && agent.next_run && (
                          <>
                            <span>•</span>
                            <span>{formatNextRun(agent.next_run)}</span>
                          </>
                        )}

                        {/* Memory Count */}
                        {agent.memory_count !== undefined && agent.memory_count > 0 && (
                          <>
                            <span>•</span>
                            <span>{agent.memory_count} memories</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right side - Status icon and action buttons */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {getStatusIcon(agent.status)}

                    <div className="flex gap-1.5">
                      <button
                        onClick={(e) => handleExecuteAgent(e, agent.id, agent.agent_name)}
                        disabled={executingAgents.has(agent.id) || agent.status !== 'active'}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        {executingAgents.has(agent.id) ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span className="hidden sm:inline">Running...</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3" />
                            <span className="hidden sm:inline">Run</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={(e) => handleToggleAgentStatus(e, agent.id, agent.status, agent.agent_name)}
                        disabled={pausingAgents.has(agent.id)}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] text-xs font-medium border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        {pausingAgents.has(agent.id) ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : agent.status === 'active' ? (
                          <>
                            <Pause className="w-3 h-3" />
                            <span className="hidden sm:inline">Pause</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3" />
                            <span className="hidden sm:inline">Activate</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <div className="text-sm text-[var(--v2-text-muted)]">
                Showing {startIndex + 1}-{Math.min(endIndex, filteredAgents.length)} of {filteredAgents.length} agents
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-colors border border-gray-200 dark:border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>

                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`px-3 py-2 text-sm font-medium transition-all ${
                        currentPage === page
                          ? 'bg-[var(--v2-primary)] text-white'
                          : 'bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-gray-200 dark:border-slate-700'
                      }`}
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      {page}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-colors border border-gray-200 dark:border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Tooltip for Agent Description */}
      {hoveredAgent && tooltipPosition && (
        <div
          className="fixed z-[200] max-w-xs bg-gray-900 dark:bg-gray-800 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none"
          style={{
            top: `${tooltipPosition.y - 10}px`,
            left: `${tooltipPosition.x}px`,
            transform: 'translateY(-100%)'
          }}
        >
          {agents.find(a => a.id === hoveredAgent)?.description}
        </div>
      )}

      <style jsx>{`
        @keyframes slide-in-right {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }

        .animate-slide-in-right {
          animation: slide-in-right 0.3s ease-out;
        }
      `}</style>
    </div>
  )
}
