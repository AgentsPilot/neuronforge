// app/v2/agent-list/page.tsx
// V2 Agent List - Shows all user agents with filtering, search, and pagination

'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { V2Logo, V2Controls } from '@/components/v2/V2Header'
import { ModernHelpDialog } from '@/components/v2/ModernHelpDialog'
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
  ChevronDown,
  Database,
  Power
} from 'lucide-react'

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
  total_runs?: number
}

type FilterType = 'all' | 'active' | 'inactive' | 'draft'
type SortType = 'created_desc' | 'created_asc' | 'name_asc' | 'name_desc' | 'runs_desc' | 'runs_asc'

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
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    if (user) {
      fetchAgents()
    }
  }, [user, filterType])

  const fetchAgents = async () => {
    if (!user) return

    setLoading(true)
    try {
      let query = supabase
        .from('agents')
        .select(`
          *,
          agent_executions(run_mode)
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (filterType !== 'all') {
        query = query.eq('status', filterType)
      }

      const { data, error } = await query

      if (error) throw error

      // Process the data to count non-calibration runs
      const agentsWithRuns = (data || []).map(agent => {
        // Count executions excluding calibration runs
        const executions = agent.agent_executions || []
        const runCount = executions.filter((exec: any) =>
          exec.run_mode !== 'calibration'
        ).length

        // Debug logging for first agent
        if (data && data.length > 0 && agent.id === data[0].id) {
          console.log('First agent execution data:', {
            agentName: agent.agent_name,
            totalExecutions: executions.length,
            runModes: executions.map((e: any) => e.run_mode),
            calibrationCount: executions.filter((e: any) => e.run_mode === 'calibration').length,
            nonCalibrationCount: runCount
          })
        }

        return {
          ...agent,
          total_runs: runCount
        }
      })

      setAgents(agentsWithRuns)
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

    if (pausingAgents.has(agentId)) return

    setPausingAgents(prev => new Set(prev).add(agentId))

    const newStatus = currentStatus === 'active' ? 'inactive' : 'active'

    try {
      const { error } = await supabase
        .from('agents')
        .update({ status: newStatus })
        .eq('id', agentId)

      if (error) throw error

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
        case 'runs_desc':
          return (b.total_runs || 0) - (a.total_runs || 0)
        case 'runs_asc':
          return (a.total_runs || 0) - (b.total_runs || 0)
        default:
          return 0
      }
    })

  const sortOptions = [
    { value: 'created_desc' as SortType, label: 'Newest first' },
    { value: 'created_asc' as SortType, label: 'Oldest first' },
    { value: 'name_asc' as SortType, label: 'A to Z' },
    { value: 'name_desc' as SortType, label: 'Z to A' },
    { value: 'runs_desc' as SortType, label: 'Most runs' },
    { value: 'runs_asc' as SortType, label: 'Least runs' }
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

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'active':
        return {
          color: 'bg-[var(--v2-status-success-bg)]',
          dotColor: 'bg-green-500',
          textColor: 'text-[var(--v2-status-success-text)]',
          borderColor: 'border-[var(--v2-status-success-border)]',
          icon: <CheckCircle className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />,
          label: 'Active'
        }
      case 'inactive':
        return {
          color: 'bg-gray-50 dark:bg-gray-900/30',
          dotColor: 'bg-gray-400',
          textColor: 'text-gray-600 dark:text-gray-400',
          borderColor: 'border-gray-200 dark:border-gray-700',
          icon: <Pause className="w-3.5 h-3.5 text-gray-600 dark:text-gray-400" />,
          label: 'Paused'
        }
      case 'draft':
        return {
          color: 'bg-[var(--v2-status-warning-bg)]',
          dotColor: 'bg-yellow-500',
          textColor: 'text-[var(--v2-status-warning-text)]',
          borderColor: 'border-[var(--v2-status-warning-border)]',
          icon: <AlertCircle className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400" />,
          label: 'Draft'
        }
      default:
        return {
          color: 'bg-gray-50 dark:bg-gray-900/30',
          dotColor: 'bg-gray-300',
          textColor: 'text-gray-600 dark:text-gray-400',
          borderColor: 'border-gray-200 dark:border-gray-700',
          icon: null,
          label: 'Unknown'
        }
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

      {/* Logo */}
      <div className="mb-3">
        <V2Logo />
      </div>

      {/* Top Bar: Back Button + Token Display + User Menu */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push('/v2/dashboard')}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:scale-105 transition-all duration-200 text-sm font-medium shadow-[var(--v2-shadow-card)]"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
        <V2Controls
          showHelpLink={true}
          onHelpClick={() => setHelpOpen(true)}
        />
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-[var(--v2-text-primary)] mb-2">
          Your Automations
        </h1>
        <p className="text-base sm:text-lg text-[var(--v2-text-secondary)]">
          Manage and monitor all your automations
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
                    ? 'bg-white/20 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
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
        <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] p-8 sm:p-12" style={{ borderRadius: 'var(--v2-radius-card)' }}>
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
        </div>
      ) : (
        <>
          {/* Table Container */}
          <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] overflow-x-auto border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-card)' }}>
            <table className="w-full min-w-[800px]">
              {/* Table Header */}
              <thead className="bg-[var(--v2-surface-hover)] border-b border-[var(--v2-border)]">
                <tr>
                  <th className="px-4 sm:px-6 py-3 sm:py-4 text-left text-xs font-bold text-[var(--v2-text-muted)] uppercase tracking-wider">
                    Agent
                  </th>
                  <th className="px-4 sm:px-6 py-3 sm:py-4 text-left text-xs font-bold text-[var(--v2-text-muted)] uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 sm:px-6 py-3 sm:py-4 text-left text-xs font-bold text-[var(--v2-text-muted)] uppercase tracking-wider">
                    Runs
                  </th>
                  <th className="px-4 sm:px-6 py-3 sm:py-4 text-left text-xs font-bold text-[var(--v2-text-muted)] uppercase tracking-wider">
                    Mode
                  </th>
                  <th className="px-4 sm:px-6 py-3 sm:py-4 text-left text-xs font-bold text-[var(--v2-text-muted)] uppercase tracking-wider">
                    Next / Memory
                  </th>
                  <th className="px-4 sm:px-6 py-3 sm:py-4 text-right text-xs font-bold text-[var(--v2-text-muted)] uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>

              {/* Table Body */}
              <tbody className="divide-y divide-[var(--v2-border)]">
                {paginatedAgents.map((agent) => {
                  const statusConfig = getStatusConfig(agent.status)
                  const isExecuting = executingAgents.has(agent.id)
                  const isPausing = pausingAgents.has(agent.id)

                  return (
                    <tr
                      key={agent.id}
                      className="hover:bg-[var(--v2-surface-hover)] transition-colors cursor-pointer group relative"
                      onClick={() => router.push(`/v2/agents/${agent.id}`)}
                      onMouseEnter={() => setHoveredAgent(agent.id)}
                      onMouseLeave={() => setHoveredAgent(null)}
                    >
                      {/* Agent Name */}
                      <td className="px-4 sm:px-6 py-3 sm:py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-1.5 h-12 rounded-full ${statusConfig.dotColor} flex-shrink-0`} />
                          <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] truncate group-hover:text-[var(--v2-primary)] transition-colors">
                              {agent.agent_name}
                            </h3>
                          </div>
                        </div>

                        {/* Tooltip */}
                        {hoveredAgent === agent.id && agent.description && (
                          <div className="absolute left-0 top-full mt-1 z-50 px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg text-xs text-[var(--v2-text-secondary)] max-w-xs pointer-events-none"
                            style={{ borderRadius: 'var(--v2-radius-card)' }}
                          >
                            {agent.description}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 sm:px-6 py-3 sm:py-4">
                        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 border ${statusConfig.borderColor} ${statusConfig.color}`} style={{ borderRadius: 'var(--v2-radius-button)' }}>
                          {statusConfig.icon}
                          <span className={`text-xs font-semibold ${statusConfig.textColor}`}>
                            {statusConfig.label}
                          </span>
                        </div>
                      </td>

                      {/* Runs */}
                      <td className="px-4 sm:px-6 py-3 sm:py-4">
                        <div className="flex items-center gap-1.5">
                          <Activity className="w-4 h-4 text-[var(--v2-text-muted)]" />
                          <span className="text-sm font-bold text-[var(--v2-text-primary)]">
                            {agent.total_runs !== undefined ? agent.total_runs.toLocaleString() : '0'}
                          </span>
                        </div>
                      </td>

                      {/* Mode */}
                      <td className="px-4 sm:px-6 py-3 sm:py-4">
                        <div className="flex items-center gap-2">
                          {agent.mode === 'scheduled' ? (
                            <>
                              <Calendar className="w-4 h-4 text-[var(--v2-primary)]" />
                              <span className="text-sm font-medium text-[var(--v2-text-secondary)]">Scheduled</span>
                            </>
                          ) : (
                            <>
                              <Clock className="w-4 h-4 text-[var(--v2-text-muted)]" />
                              <span className="text-sm font-medium text-[var(--v2-text-secondary)]">Manual</span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Next Run / Memory */}
                      <td className="px-4 sm:px-6 py-3 sm:py-4">
                        {agent.mode === 'scheduled' && agent.next_run ? (
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-orange-500" />
                            <span className="text-sm font-medium text-[var(--v2-text-secondary)]">
                              {formatNextRun(agent.next_run)}
                            </span>
                          </div>
                        ) : agent.memory_count !== undefined && agent.memory_count > 0 ? (
                          <div className="flex items-center gap-2">
                            <Database className="w-4 h-4 text-purple-500" />
                            <span className="text-sm font-medium text-[var(--v2-text-secondary)]">
                              {agent.memory_count}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-[var(--v2-text-muted)]">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 sm:px-6 py-3 sm:py-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          <div className="relative group/tooltip">
                            <button
                              onClick={(e) => handleExecuteAgent(e, agent.id, agent.agent_name)}
                              disabled={isExecuting || agent.status !== 'active'}
                              className="p-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed group/btn border-2 bg-transparent border-[var(--v2-primary)] dark:border-[var(--v2-primary)] text-[var(--v2-primary)] dark:text-[var(--v2-primary)] hover:border-[var(--v2-primary-dark)] dark:hover:border-[var(--v2-secondary)]"
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              {isExecuting ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Play className="w-4 h-4 group-hover/btn:scale-110 transition-transform" />
                              )}
                            </button>
                            <div className="absolute bottom-full right-0 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                              {agent.status !== 'active' ? 'Activate agent to run' : 'Run agent now'}
                            </div>
                          </div>

                          <div className="relative group/tooltip">
                            <button
                              onClick={(e) => handleToggleAgentStatus(e, agent.id, agent.status, agent.agent_name)}
                              disabled={isPausing}
                              className={`p-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed group/btn border-2 bg-transparent ${
                                agent.status === 'active'
                                  ? 'border-red-500 dark:border-red-400 text-red-600 dark:text-red-400 hover:border-red-600 dark:hover:border-red-300'
                                  : 'border-green-500 dark:border-green-400 text-green-600 dark:text-green-400 hover:border-green-600 dark:hover:border-green-300'
                              }`}
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              {isPausing ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Power className="w-4 h-4 group-hover/btn:scale-110 transition-transform" />
                              )}
                            </button>
                            <div className="absolute bottom-full right-0 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                              {agent.status === 'active' ? 'Deactivate agent' : 'Activate agent'}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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

      {/* Help Dialog */}
      <ModernHelpDialog
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
    </div>
  )
}
