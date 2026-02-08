// app/v2/agents/[id]/page.tsx
// V2 Agent Detail Page - Redesigned with 2-column layout, settings drawer, and insights modal

'use client'

import React, { useEffect, useState, useMemo, useCallback, lazy, Suspense } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import {
  agentApi,
  systemConfigApi,
  sharedAgentApi,
  metricsApi,
} from '@/lib/client/agent-api'
import { requestDeduplicator } from '@/lib/utils/request-deduplication'
import type { Agent, Execution } from '@/lib/repositories/types'
import { Card } from '@/components/v2/ui/card'
import { V2Logo, V2Controls } from '@/components/v2/V2Header'
import {
  ArrowLeft,
  Play,
  Pause,
  Edit,
  Trash2,
  Calendar,
  Activity,
  Clock,
  CheckCircle,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Shield,
  Bot,
  Copy,
  Check,
  Loader2,
  TrendingUp,
  XCircle,
  X,
  Zap,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Download,
  Share2,
  Gauge,
  Rocket,
  Brain,
  PlayCircle,
  Settings,
  AlertOctagon
} from 'lucide-react'
import {
  SiNotion,
  SiGithub
} from 'react-icons/si'
import { Mail, Phone, Cloud, Database, Globe, Puzzle, RefreshCw } from 'lucide-react'
import { PluginIcon } from '@/components/PluginIcon'
import { AgentIntensityCardV2 } from '@/components/v2/agents/AgentIntensityCardV2'
import { formatScheduleDisplay, formatNextRun } from '@/lib/utils/scheduleFormatter'
import { InlineLoading } from '@/components/v2/ui/loading'
import { clientLogger } from '@/lib/logger/client'
import { MiniInsightCard, HealthStatus, NoIssuesState } from '@/components/v2/execution/MiniInsightCard'
import { InsightsList } from '@/components/v2/insights/InsightsList'

// PERFORMANCE: Lazy load heavy components that may not be used immediately
const DraftAgentTour = lazy(() => import('@/components/agents/DraftAgentTour').then(mod => ({ default: mod.DraftAgentTour })))

// Helper function to get plugin-specific icon
const getPluginIcon = (pluginName: string) => {
  const name = pluginName.toLowerCase()
  if (name.includes('gmail') || name.includes('google-mail')) return <PluginIcon pluginId="google-mail" className="w-4 h-4" alt="Gmail" />
  if (name.includes('calendar')) return <PluginIcon pluginId="google-calendar" className="w-4 h-4" alt="Google Calendar" />
  if (name.includes('drive')) return <PluginIcon pluginId="google-drive" className="w-4 h-4" alt="Google Drive" />
  if (name.includes('docs') || name.includes('document')) return <PluginIcon pluginId="google-docs" className="w-4 h-4" alt="Google Docs" />
  if (name.includes('sheets') || name.includes('excel')) return <PluginIcon pluginId="google-sheets" className="w-4 h-4" alt="Google Sheets" />
  if (name.includes('github')) return <SiGithub className="w-4 h-4 text-gray-900 dark:text-white" />
  if (name.includes('slack')) return <PluginIcon pluginId="slack" className="w-4 h-4" alt="Slack" />
  if (name.includes('hubspot') || name.includes('crm')) return <PluginIcon pluginId="hubspot" className="w-4 h-4" alt="HubSpot" />
  if (name.includes('notion')) return <SiNotion className="w-4 h-4 text-gray-900 dark:text-white" />
  if (name.includes('whatsapp')) return <PluginIcon pluginId="whatsapp" className="w-4 h-4" alt="WhatsApp" />
  if (name.includes('airtable')) return <PluginIcon pluginId="airtable" className="w-4 h-4" alt="Airtable" />
  if (name.includes('chatgpt') || name.includes('openai')) return <PluginIcon pluginId="chatgpt-research" className="w-4 h-4" alt="ChatGPT" />
  if (name.includes('outlook') || name.includes('microsoft')) return <Mail className="w-4 h-4 text-blue-600" />
  if (name.includes('twilio') || name.includes('phone')) return <Phone className="w-4 h-4 text-red-600" />
  if (name.includes('aws') || name.includes('cloud')) return <Cloud className="w-4 h-4 text-orange-500" />
  if (name.includes('azure')) return <Cloud className="w-4 h-4 text-blue-600" />
  if (name.includes('database') || name.includes('db')) return <Database className="w-4 h-4 text-indigo-500" />
  if (name.includes('web') || name.includes('http')) return <Globe className="w-4 h-4 text-teal-500" />
  return <Puzzle className="w-4 h-4 text-[var(--v2-primary)]" />
}

export default function V2AgentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { user, connectedPlugins } = useAuth()
  const agentId = params.id as string

  // Core data state
  const [agent, setAgent] = useState<Agent | null>(null)
  const [executions, setExecutions] = useState<Execution[]>([])
  const [allExecutions, setAllExecutions] = useState<Execution[]>([])
  const [totalExecutionCount, setTotalExecutionCount] = useState<number>(0)
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null)
  const [executionResults, setExecutionResults] = useState<any | null>(null) // Structured execution results
  const [loading, setLoading] = useState(true)
  const [executing, setExecuting] = useState(false)
  const [insights, setInsights] = useState<any[]>([]) // Business + technical insights

  // UI state
  const [copiedId, setCopiedId] = useState(false)
  const [executionPage, setExecutionPage] = useState(1)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // NEW: Drawer and modal state
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false)
  const [showInsightsModal, setShowInsightsModal] = useState(false)

  // Modals
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showShareConfirm, setShowShareConfirm] = useState(false)
  const [showShareSuccess, setShowShareSuccess] = useState(false)

  // Sharing data
  const [shareCreditsAwarded, setShareCreditsAwarded] = useState(0)
  const [shareQualityScore, setShareQualityScore] = useState(0)
  const [sharingRewardAmount, setSharingRewardAmount] = useState(500)
  const [sharingValidation, setSharingValidation] = useState<any>(null)
  const [sharingStatus, setSharingStatus] = useState<any>(null)
  const [sharingConfig, setSharingConfig] = useState<any>(null)
  const [shareRewardActive, setShareRewardActive] = useState(true)
  const [hasBeenShared, setHasBeenShared] = useState(false)

  // Other
  const [memoryCount, setMemoryCount] = useState(0)
  const [tokensPerPilotCredit, setTokensPerPilotCredit] = useState<number>(10)

  // Inline editing state (kept for compatibility)
  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState('')
  const [editedDescription, setEditedDescription] = useState('')
  const [editedScheduleCron, setEditedScheduleCron] = useState('')
  const [editedMode, setEditedMode] = useState('')
  const [editedTimezone, setEditedTimezone] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // Schedule editing state
  const [scheduleMode, setScheduleMode] = useState<'manual' | 'scheduled'>('manual')
  const [scheduleType, setScheduleType] = useState<'hourly' | 'daily' | 'weekly' | 'monthly' | ''>('')
  const [scheduleTime, setScheduleTime] = useState<string>('09:00')
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const [selectedMonthDay, setSelectedMonthDay] = useState<string>('1')
  const [hourlyInterval, setHourlyInterval] = useState<string>('1')
  const [dailyOption, setDailyOption] = useState<'everyday' | 'weekdays' | 'weekends'>('everyday')

  const EXECUTIONS_PER_PAGE = 5
  const [executionTimeFilter, setExecutionTimeFilter] = useState<'7days' | '30days' | 'all'>('7days')
  const [showTimeFilterDropdown, setShowTimeFilterDropdown] = useState(false)

  // IMPROVED: Batched data fetch wrapped in useCallback to prevent unnecessary re-fetches
  const fetchAllData = useCallback(async () => {
    if (!user || !agentId) return

    setLoading(true)
    try {
      // Parallel fetch all data
      // PERFORMANCE: Limit to 10 executions and skip token enrichment for faster load
      const [agentResult, executionsResult, configResult, rewardStatus, insightsResult] = await Promise.all([
        agentApi.getById(agentId, user.id),
        agentApi.getExecutions(agentId, user.id, { limit: 10, includeTokens: false }),
        systemConfigApi.getByKeys(['tokens_per_pilot_credit', 'agent_sharing_reward_amount']),
        fetch('/api/admin/reward-config').then(r => r.json()).catch(() => ({ success: false })),
        fetch(`/api/v6/insights?agentId=${agentId}&status=new,viewed`).then(r => r.json()).catch(() => ({ success: false, data: [] }))
      ])

      // Process agent
      if (!agentResult.success || !agentResult.data) {
        throw new Error(agentResult.error || 'Failed to fetch agent')
      }
      setAgent(agentResult.data.agent as Agent)

      // Process executions
      if (executionsResult.success && executionsResult.data) {
        const enrichedExecutions = executionsResult.data as Execution[]
        setAllExecutions(enrichedExecutions)
        setExecutions(enrichedExecutions)
        // Don't set selectedExecution here - let the useEffect handle it based on time filter
      }

      // Process config
      if (configResult.success && configResult.data) {
        const tokensValue = Number(configResult.data['tokens_per_pilot_credit'])
        if (tokensValue > 0 && tokensValue <= 1000) {
          setTokensPerPilotCredit(tokensValue)
        }
        const rewardValue = Number(configResult.data['agent_sharing_reward_amount'])
        if (rewardValue) {
          setSharingRewardAmount(rewardValue)
        }
      }

      // Process reward status
      if (rewardStatus.success && rewardStatus.rewards) {
        const shareReward = rewardStatus.rewards.find((r: any) => r.reward_key === 'agent_sharing')
        setShareRewardActive(shareReward?.is_active ?? false)
      } else {
        setShareRewardActive(false)
      }

      // Process insights
      console.log('[AgentPage] Insights result:', insightsResult)
      if (insightsResult.success && insightsResult.data) {
        console.log('[AgentPage] Setting insights:', insightsResult.data.length, 'insights')
        setInsights(insightsResult.data)
      } else {
        console.log('[AgentPage] No insights found or error:', insightsResult.error)
      }

      // PERFORMANCE: Defer non-critical data until after initial render
      // This reduces blocking time and improves perceived performance
      setTimeout(() => {
        fetchMemoryCount()
        fetchTotalExecutionCount()
      }, 500)
    } catch (error) {
      clientLogger.error('Error fetching agent data', error as Error)
      router.push('/v2/agent-list')
    } finally {
      setLoading(false)
    }
  }, [user?.id, agentId, router])

  // Manual refresh function for Recent Activity only (stable, doesn't trigger re-renders)
  const handleRefresh = useCallback(async () => {
    if (!user || !agentId) return

    setLoading(true)
    try {
      // Clear cache for this agent's executions
      requestDeduplicator.clear(`executions-${agentId}-false-10`)

      // Fetch only executions (not all data)
      const executionsResult = await agentApi.getExecutions(agentId, user.id, { limit: 10, includeTokens: false })

      if (executionsResult.success && executionsResult.data) {
        const enrichedExecutions = executionsResult.data as Execution[]
        setAllExecutions(enrichedExecutions)
        setExecutions(enrichedExecutions)
        // The useEffect will handle selecting the first execution
      }
    } catch (error) {
      clientLogger.error('Error refreshing executions', error as Error)
    } finally {
      setLoading(false)
    }
  }, [user?.id, agentId])

  // Batched data fetching - IMPROVEMENT
  useEffect(() => {
    if (user && agentId) {
      clientLogger.setContext({ component: 'V2AgentDetailPage', agentId, userId: user.id })
      clientLogger.info('Agent detail page mounted', { agentId })

      fetchAllData()

      return () => {
        clientLogger.debug('Agent detail page unmounted')
        clientLogger.clearContext()
      }
    }
  }, [user?.id, agentId])

  // Pre-fetch sharing eligibility when agent data is loaded (NON-BLOCKING)
  // PERFORMANCE: Defer this call to reduce initial load time - sharing info is not critical
  useEffect(() => {
    if (agentId && user && shareRewardActive && agent) {
      // Delay by 1 second to let page render first
      const timer = setTimeout(() => checkSharingEligibility(), 1000)
      return () => clearTimeout(timer)
    }
  }, [agentId, user?.id, shareRewardActive, agent?.id])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showTimeFilterDropdown) {
        const target = event.target as HTMLElement
        if (!target.closest('.time-filter-dropdown')) {
          setShowTimeFilterDropdown(false)
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showTimeFilterDropdown])

  // Update selected execution when executions load or time filter changes
  // Always select the first execution from the filtered list to ensure "Latest Execution" card shows the most recent
  useEffect(() => {
    if (executions.length === 0) return

    // Filter executions by current time filter
    const now = new Date()
    const filteredExecutions = executions.filter(exec => {
      if (executionTimeFilter === 'all') return true

      const executionDate = new Date(exec.started_at)
      const daysDiff = Math.floor((now.getTime() - executionDate.getTime()) / (1000 * 60 * 60 * 24))

      if (executionTimeFilter === '7days') return daysDiff <= 7
      if (executionTimeFilter === '30days') return daysDiff <= 30
      return true
    })

    // Always select the first (most recent) execution from filtered list
    if (filteredExecutions.length > 0 && filteredExecutions[0].id !== selectedExecution?.id) {
      const firstExec = filteredExecutions[0]
      console.log('[Auto-select] Updating to first filtered execution:', {
        id: firstExec.id,
        started_at: firstExec.started_at,
        status: firstExec.status,
        isPilot: !!firstExec.logs?.pilot
      })

      setSelectedExecution(firstExec)

      // Fetch results if it's a Pilot execution, otherwise clear results
      if (firstExec.logs?.pilot) {
        fetchExecutionResults(firstExec.id)
      } else {
        setExecutionResults(null)
      }
    }
  }, [executions, executionTimeFilter]) // Remove selectedExecution?.id from deps to avoid infinite loop

  // Auto-refresh executions when page becomes visible (e.g., returning from run page)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && agentId) {
        // Clear execution cache and refetch when user returns to the page
        requestDeduplicator.clear(`executions-${agentId}-false-10`)
        fetchAllData()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [agentId, fetchAllData])

  const fetchMemoryCount = async () => {
    if (!agentId || !user?.id) return

    const result = await agentApi.getMemoryCount(agentId, user.id)
    if (result.success && result.data !== undefined) {
      setMemoryCount(result.data)
    }
  }

  const fetchTotalExecutionCount = async () => {
    if (!agentId) return

    try {
      const { count, error } = await supabase
        .from('workflow_executions')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', agentId)

      if (!error && count !== null) {
        setTotalExecutionCount(count)
      }
    } catch (error) {
      console.error('[fetchTotalExecutionCount] Error:', error)
    }
  }

  const fetchExecutionResults = async (executionId: string) => {
    console.log('[fetchExecutionResults] Fetching results for execution:', executionId)

    try {
      // Fetch execution_results from workflow_executions table
      const { data, error } = await supabase
        .from('workflow_executions')
        .select('execution_results')
        .eq('id', executionId)
        .single()

      console.log('[fetchExecutionResults] Query response:', { data, error })

      if (error) {
        console.error('[fetchExecutionResults] Error fetching execution_results:', error)
        setExecutionResults(null)
        return
      }

      if (data?.execution_results) {
        console.log('[fetchExecutionResults] ✅ Found execution_results:', {
          summary: data.execution_results.summary,
          totalItems: data.execution_results.totalItems,
          totalSteps: data.execution_results.totalSteps
        })
        setExecutionResults(data.execution_results)
      } else {
        console.log('[fetchExecutionResults] ⚠️ No execution_results found for this execution')
        setExecutionResults(null)
      }
    } catch (error) {
      console.error('[fetchExecutionResults] ❌ Exception:', error)
      setExecutionResults(null)
    }
  }

  const checkSharingEligibility = async () => {
    if (!user?.id || !agent?.id) return

    try {
      const { AgentSharingValidator } = await import('@/lib/credits/agentSharingValidation')
      const validator = new AgentSharingValidator(supabase)

      const validation = await validator.validateSharing(user.id, agent.id)
      setSharingValidation(validation)

      const status = await validator.getSharingStatus(user.id)
      setSharingStatus(status)

      const config = validator.getConfig()
      setSharingConfig(config)
    } catch (error) {
      clientLogger.error('Error checking sharing eligibility', error as Error)
    }
  }

  const handleToggleStatus = async () => {
    if (!agent || !user) return

    // Toggle logic:
    // - active -> paused
    // - draft -> active (activate draft agent)
    // - paused -> active
    const newStatus = agent.status === 'active' ? 'paused' : 'active'
    clientLogger.info('Toggling agent status', { agentId: agent.id, currentStatus: agent.status, newStatus })

    try {
      const result = await agentApi.updateStatus(agent.id, user.id, newStatus)

      if (result.success && result.data) {
        setAgent(result.data as Agent)
        clientLogger.info('Agent status toggled', { agentId: agent.id, newStatus: result.data.status })
      }
    } catch (error) {
      clientLogger.error('Error toggling status', error as Error)
    }
  }

  const handleToggleInsights = async () => {
    if (!agent || !user) return

    // Default to false if undefined, then toggle
    const currentValue = agent.insights_enabled ?? false
    const newInsightsEnabled = !currentValue

    console.log('🔄 Toggling insights:', {
      agentId: agent.id,
      currentValue,
      newValue: newInsightsEnabled,
      agentHasField: 'insights_enabled' in agent,
      fullAgent: agent
    })

    // Optimistic update - update UI immediately
    setAgent({ ...agent, insights_enabled: newInsightsEnabled })

    try {
      const result = await agentApi.update(agent.id, user.id, {
        insights_enabled: newInsightsEnabled
      })

      console.log('📥 API Response:', {
        success: result.success,
        hasData: !!result.data,
        returnedValue: result.data?.insights_enabled,
        fullData: result.data,
        error: result.error
      })

      if (result.success && result.data) {
        // Confirm the update with server response
        setAgent(result.data as Agent)
        clientLogger.info('Insights toggled', { agentId: agent.id, newValue: result.data.insights_enabled })
        console.log('✅ Toggle successful, final value:', result.data.insights_enabled)
      } else {
        // Revert optimistic update on failure
        setAgent({ ...agent, insights_enabled: currentValue })
        clientLogger.error('Failed to toggle insights', new Error(result.error || 'Unknown error'))
        console.error('❌ Toggle failed, reverting. Error:', result.error)
      }
    } catch (error) {
      // Revert optimistic update on exception
      setAgent({ ...agent, insights_enabled: currentValue })
      clientLogger.error('Error toggling insights', error as Error)
      console.error('❌ Exception, reverting:', error)
    }
  }

  const handleSandboxClick = () => {
    if (!agent) return
    router.push(`/v2/sandbox/${agent.id}`)
  }

  // Schedule helpers
  const getDaySuffix = (day: number) => {
    if (day >= 11 && day <= 13) return 'th'
    switch (day % 10) {
      case 1: return 'st'
      case 2: return 'nd'
      case 3: return 'rd'
      default: return 'th'
    }
  }

  const getScheduleDescription = () => {
    if (!scheduleType) return 'No schedule set'

    if (scheduleType === 'hourly') {
      return hourlyInterval === '1' ? 'Every hour' : `Every ${hourlyInterval} hours`
    }

    if (scheduleType === 'daily') {
      if (dailyOption === 'everyday') return `Every day at ${scheduleTime}`
      if (dailyOption === 'weekdays') return `Weekdays at ${scheduleTime}`
      if (dailyOption === 'weekends') return `Weekends at ${scheduleTime}`
    }

    if (scheduleType === 'weekly') {
      if (selectedDays.length === 0) return 'Weekly - Select days'
      const dayNames = selectedDays.map(d => d.charAt(0).toUpperCase() + d.slice(0, 3))
      return `${dayNames.join(', ')} at ${scheduleTime}`
    }

    if (scheduleType === 'monthly') {
      return `${selectedMonthDay}${getDaySuffix(parseInt(selectedMonthDay))} of month at ${scheduleTime}`
    }

    return 'Configure schedule'
  }

  const buildCronExpression = (): string | null => {
    if (scheduleMode === 'manual') return null
    if (!scheduleType) return null

    const [hour, minute] = scheduleTime.split(':').map(Number)

    if (scheduleType === 'hourly') {
      const interval = parseInt(hourlyInterval) || 1
      return interval === 1 ? '0 * * * *' : `0 */${interval} * * *`
    }

    if (scheduleType === 'daily') {
      if (dailyOption === 'everyday') {
        return `${minute} ${hour} * * *`
      }
      if (dailyOption === 'weekdays') {
        return `${minute} ${hour} * * 1-5`
      }
      if (dailyOption === 'weekends') {
        return `${minute} ${hour} * * 0,6`
      }
    }

    if (scheduleType === 'weekly' && selectedDays.length > 0) {
      const dayMap: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
        thursday: 4, friday: 5, saturday: 6
      }
      const cronDays = selectedDays
        .map(d => dayMap[d.toLowerCase()])
        .sort((a, b) => a - b)
        .join(',')
      return `${minute} ${hour} * * ${cronDays}`
    }

    if (scheduleType === 'monthly') {
      const day = parseInt(selectedMonthDay) || 1
      return `${minute} ${hour} ${day} * *`
    }

    return null
  }

  const handleDayToggle = (day: string) => {
    setSelectedDays(prev => {
      if (prev.includes(day)) {
        if (prev.length === 1) return prev
        return prev.filter(d => d !== day)
      } else {
        return [...prev, day]
      }
    })
  }

  const handleOnDemand = () => {
    setScheduleMode('manual')
    setScheduleType('')
  }

  const handleEditClick = () => {
    if (!agent) return

    setEditedName(agent.agent_name)
    setEditedDescription(agent.description || '')
    setEditedScheduleCron(agent.schedule_cron || '')
    setEditedMode(agent.mode || 'on_demand')
    setEditedTimezone(agent.timezone || '')

    if (agent.mode === 'scheduled' && agent.schedule_cron) {
      setScheduleMode('scheduled')
      const parts = agent.schedule_cron.split(' ')
      if (parts.length === 5) {
        const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

        if (hour.includes('*')) {
          setScheduleType('hourly')
          const match = hour.match(/\*\/(\d+)/)
          if (match) {
            setHourlyInterval(match[1])
          } else {
            setHourlyInterval('1')
          }
        }
        else if (dayOfMonth !== '*' && !dayOfMonth.includes('-') && !dayOfMonth.includes(',')) {
          setScheduleType('monthly')
          setSelectedMonthDay(dayOfMonth)
          setScheduleTime(`${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`)
        }
        else if (dayOfWeek !== '*' && dayOfWeek.includes(',')) {
          setScheduleType('weekly')
          const dayMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
          const days = dayOfWeek.split(',').map(d => dayMap[parseInt(d)])
          setSelectedDays(days)
          setScheduleTime(`${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`)
        }
        else if (dayOfMonth === '*' && month === '*') {
          setScheduleType('daily')
          setScheduleTime(`${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`)
          if (dayOfWeek === '*') {
            setDailyOption('everyday')
          } else if (dayOfWeek === '1-5') {
            setDailyOption('weekdays')
          } else if (dayOfWeek === '0,6') {
            setDailyOption('weekends')
          }
        }
      }
    } else {
      setScheduleMode('manual')
      setScheduleType('')
    }

    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditedName('')
    setEditedDescription('')
    setEditedScheduleCron('')
    setEditedMode('')
    setEditedTimezone('')
    setScheduleMode('manual')
    setScheduleType('')
    setScheduleTime('09:00')
    setSelectedDays([])
    setSelectedMonthDay('1')
    setHourlyInterval('1')
    setDailyOption('everyday')
  }

  const handleSaveEdit = async () => {
    if (!agent || !user) return

    setIsSaving(true)
    try {
      const cronExpression = buildCronExpression()
      const mode = scheduleMode === 'manual' ? 'on_demand' : 'scheduled'

      const result = await agentApi.update(agent.id, user.id, {
        agent_name: editedName,
        description: editedDescription,
        schedule_cron: cronExpression,
        mode: mode,
        timezone: editedTimezone || null
      })

      if (!result.success) {
        clientLogger.error('Error updating agent', new Error(result.error))
        return
      }

      if (result.data) {
        setAgent(result.data as Agent)
        clientLogger.info('Agent details saved', { agentId: agent.id })
      } else {
        setAgent({
          ...agent,
          agent_name: editedName,
          description: editedDescription,
          schedule_cron: cronExpression,
          mode: mode,
          timezone: editedTimezone || null
        })
      }

      setIsEditing(false)
    } catch (error) {
      clientLogger.error('Error saving agent', error as Error)
    } finally {
      setIsSaving(false)
    }
  }

  const copyAgentId = () => {
    navigator.clipboard.writeText(agent?.id || '')
    setCopiedId(true)
    setTimeout(() => setCopiedId(false), 2000)
  }

  const getPluginStatus = (plugin: string) => {
    if (!connectedPlugins) return false
    return !!connectedPlugins[plugin]
  }

  // Memoized health calculation
  const health = useMemo(() => {
    if (allExecutions.length === 0) return { score: 0, maxScore: 0, percentage: 0, recentScore: 0, recentMaxScore: 0, failedCount: 0 }

    const totalSuccessCount = allExecutions.filter(e =>
      e.status === 'completed' || e.status === 'success'
    ).length
    const totalPercentage = (totalSuccessCount / allExecutions.length) * 100

    const failedCount = allExecutions.filter(e =>
      e.status === 'failed' || e.status === 'error'
    ).length

    const recentExecutions = allExecutions.slice(0, 5)
    const recentSuccessCount = recentExecutions.filter(e =>
      e.status === 'completed' || e.status === 'success'
    ).length

    return {
      score: totalSuccessCount,
      maxScore: allExecutions.length,
      percentage: totalPercentage,
      recentScore: recentSuccessCount,
      recentMaxScore: recentExecutions.length,
      failedCount
    }
  }, [allExecutions])

  const formatDuration = (ms?: number) => {
    if (!ms) return 'N/A'
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  const handleExportConfiguration = () => {
    if (!agent) return

    const exportData = {
      agent_name: agent.agent_name,
      description: agent.description,
      plugins_required: agent.plugins_required,
      mode: agent.mode,
      schedule_cron: agent.schedule_cron,
      timezone: agent.timezone,
      created_at: agent.created_at,
      exported_at: new Date().toISOString(),
      export_version: "2.0"
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${agent.agent_name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_config.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleDuplicateAgent = async () => {
    if (!agent || !user) return

    clientLogger.info('Duplicating agent', { agentId: agent.id })
    setActionLoading('duplicate')
    try {
      const result = await agentApi.duplicate(agentId, user.id)

      if (!result.success) {
        clientLogger.error('Error duplicating agent', new Error(result.error))
        return
      }

      if (result.data) {
        clientLogger.info('Agent duplicated', { originalId: agent.id, newId: result.data.id })
        router.push(`/v2/agents/${result.data.id}`)
      }
    } finally {
      setActionLoading(null)
    }
  }

  const handleDeleteAgent = async () => {
    if (!agent || !user) return

    clientLogger.info('Deleting agent', { agentId: agent.id })
    setActionLoading('delete')
    try {
      const result = await agentApi.delete(agentId, user.id)

      if (!result.success) {
        clientLogger.error('Error deleting agent', new Error(result.error))
        return
      }

      clientLogger.info('Agent deleted', { agentId: agent.id })
      router.push('/v2/agent-list')
    } finally {
      setActionLoading(null)
      setShowDeleteConfirm(false)
    }
  }

  const handleShareAgentClick = () => {
    if (!agent || !user || agent.status !== 'active') {
      clientLogger.debug('Share validation failed', { hasAgent: !!agent, hasUser: !!user, status: agent?.status })
      return
    }

    clientLogger.debug('Opening share modal', { agentId: agent.id })
    setShowShareConfirm(true)
  }

  const handleShareAgent = async () => {
    if (!agent || !user || agent.status !== 'active') {
      return
    }

    setShowShareConfirm(false)
    setActionLoading('share')
    try {
      const { AgentSharingValidator } = await import('@/lib/credits/agentSharingValidation')
      const { RewardService } = await import('@/lib/credits/rewardService')
      const { AgentScoreService } = await import('@/lib/services/AgentScoreService')

      const validator = new AgentSharingValidator(supabase)
      const rewardService = new RewardService(supabase)
      const scoreService = new AgentScoreService(supabase)

      const validation = await validator.validateSharing(user.id, agent.id)
      if (!validation.valid) {
        alert(validation.reason || 'This agent does not meet sharing requirements')
        return
      }

      const existsResult = await sharedAgentApi.existsByOriginalAgent(agent.id, user.id)
      if (existsResult.success && existsResult.data) {
        alert('This agent has already been shared!')
        return
      }

      const qualityScore = await scoreService.calculateQualityScore(agent.id)
      const diversityPenalty = await scoreService.getExecutionDiversityPenalty(agent.id)

      const finalScore = {
        ...qualityScore,
        overall_score: qualityScore.overall_score * diversityPenalty
      }

      const metricsResult = await metricsApi.getBasicMetrics(agent.id, user.id)
      const metrics = metricsResult.data

      const shareResult = await sharedAgentApi.share(agent.id, user.id, {
        description: agent.description || undefined,
        quality_score: finalScore.overall_score,
        reliability_score: finalScore.reliability_score,
        efficiency_score: finalScore.efficiency_score,
        adoption_score: finalScore.adoption_score,
        complexity_score: finalScore.complexity_score,
        base_executions: metrics?.total_executions || 0,
        base_success_rate: metrics?.successful_executions && metrics?.total_executions
          ? (metrics.successful_executions / metrics.total_executions) * 100
          : 0,
      })

      if (!shareResult.success) {
        clientLogger.error('Error sharing agent', new Error(shareResult.error))
        alert(`Failed to share agent: ${shareResult.error}`)
        return
      }

      const rewardResult = await rewardService.awardAgentSharingReward(
        user.id,
        agent.id,
        agent.agent_name
      )

      if (rewardResult.success) {
        setShareCreditsAwarded(rewardResult.creditsAwarded || 0)
        setShareQualityScore(Math.round(finalScore.overall_score))
        setShowShareSuccess(true)
        setHasBeenShared(true)
        clientLogger.info('Agent shared successfully', { agentId: agent.id, qualityScore: finalScore.overall_score, creditsAwarded: rewardResult.creditsAwarded })

        setTimeout(() => setShowShareSuccess(false), 5000)
      }

      await fetchAllData()
    } catch (error) {
      clientLogger.error('Error in handleShareAgent', error as Error)
      alert('Failed to share agent. Please try again.')
    } finally {
      setActionLoading(null)
      setShowShareConfirm(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
      case 'failed':
      case 'error':
        return <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
      case 'running':
        return <Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" />
      default:
        return <Clock className="w-4 h-4 text-[var(--v2-text-muted)]" />
    }
  }

  if (loading) {
    return <InlineLoading size="md" />
  }

  if (!agent) {
    return null
  }

  const safePluginsRequired = Array.isArray(agent.plugins_required) ? agent.plugins_required : []

  // Calculate execution health status from insights
  const calculateHealthStatus = (): 'healthy' | 'needs_attention' | 'critical' => {
    if (insights.length === 0) return 'healthy'

    const hasCritical = insights.some((i: any) => i.severity === 'critical')
    const hasHigh = insights.some((i: any) => i.severity === 'high')

    if (selectedExecution?.status === 'failed' || hasCritical) {
      return 'critical'
    }

    if (hasHigh) {
      return 'needs_attention'
    }

    return 'healthy'
  }

  const healthStatus = calculateHealthStatus()

  // Separate business and technical insights
  const businessInsights = insights.filter((i: any) => i.category === 'growth')
  const technicalInsights = insights.filter((i: any) => i.category === 'data_quality')

  console.log('[AgentPage] Total insights:', insights.length)
  console.log('[AgentPage] Business insights (growth):', businessInsights.length)
  console.log('[AgentPage] Technical insights (data_quality):', technicalInsights.length)

  // Get health bar color
  const getHealthColor = () => {
    if (health.percentage >= 80) return 'bg-gradient-to-r from-green-500 to-emerald-600'
    if (health.percentage >= 60) return 'bg-gradient-to-r from-yellow-500 to-orange-500'
    return 'bg-gradient-to-r from-red-500 to-red-600'
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--v2-background)' }}>
      {/* PERFORMANCE: Lazy load tour component with Suspense */}
      <Suspense fallback={null}>
        <DraftAgentTour
          agentId={agent.id}
          agentName={agent.agent_name}
          agentStatus={agent.status}
          productionReady={agent.production_ready ?? false}
        />
      </Suspense>

      <div className="max-w-[1400px] mx-auto p-4">
        {/* Logo */}
        <div className="mb-3">
          <V2Logo />
        </div>

        {/* Back Button + Controls */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => router.push('/v2/agent-list')}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-all duration-200 text-sm font-medium shadow-[var(--v2-shadow-card)]"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Agents
          </button>
          <V2Controls />
        </div>

        {/* Header Section with Health Bar */}
        <Card className="!p-5 mb-4">
          <div className="flex items-start justify-between mb-4 gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0 pr-4">
              <Bot className="w-9 h-9 text-[#10B981] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-semibold text-[var(--v2-text-primary)] mb-1">
                  {agent.agent_name}
                </h1>
                <p className="text-[var(--v2-text-secondary)] text-sm">
                  {agent.description || 'No description'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
              <div
                data-tour="status-badge"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border shadow-sm ${
                  agent.status === 'active'
                    ? 'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-green-200 dark:border-green-700'
                    : agent.status === 'draft'
                    ? 'bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 border-amber-200 dark:border-amber-700'
                    : 'bg-gradient-to-r from-gray-50 to-slate-50 dark:from-gray-900/20 dark:to-slate-900/20 border-gray-200 dark:border-gray-700'
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${
                  agent.status === 'active' ? 'bg-green-500' : agent.status === 'draft' ? 'bg-amber-500' : 'bg-gray-400'
                }`}></div>
                <span className={`font-semibold text-sm ${
                  agent.status === 'active'
                    ? 'text-green-700 dark:text-green-300'
                    : agent.status === 'draft'
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-gray-700 dark:text-gray-300'
                }`}>
                  {agent.status === 'active' ? 'Active' : agent.status === 'draft' ? 'Draft' : 'Inactive'}
                </span>
              </div>
              {memoryCount > 0 && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 border border-purple-200 dark:border-purple-700 shadow-sm">
                  <Brain className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  <span className="font-semibold text-purple-700 dark:text-purple-300 text-sm">
                    Learning Active
                  </span>
                </div>
              )}
              {(totalExecutionCount > 0 || allExecutions.length > 0) && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20 border border-blue-200 dark:border-blue-700 shadow-sm">
                  <Activity className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <span className="font-semibold text-blue-700 dark:text-blue-300 text-sm">
                    {totalExecutionCount || allExecutions.length} {(totalExecutionCount || allExecutions.length) === 1 ? 'Run' : 'Runs'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Health Bar */}
          <div className="mb-4">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs font-medium text-[var(--v2-text-secondary)]">System Health</span>
              <span className={`text-xs font-semibold ${
                health.percentage >= 80 ? 'text-green-600 dark:text-green-400' :
                health.percentage >= 60 ? 'text-yellow-600 dark:text-yellow-400' :
                'text-red-600 dark:text-red-400'
              }`}>
                {health.percentage.toFixed(0)}% Healthy
              </span>
            </div>
            <div className="w-full h-1.5 bg-[var(--v2-border)] rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${getHealthColor()}`}
                style={{ width: `${health.percentage}%` }}
              />
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => router.push(`/v2/agents/${agent.id}/run`)}
              disabled={agent.status !== 'active'}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:opacity-90 transition-opacity font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={agent.status !== 'active' ? 'Agent must be activated before running' : 'Run this agent'}
            >
              <Play className="w-4 h-4" />
              Run Now
            </button>
            <button
              data-tour="edit-button"
              onClick={() => setShowSettingsDrawer(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors font-medium text-sm"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <Settings className="w-4 h-4" />
              Settings
            </button>
            {!agent.production_ready && (
              <button
                onClick={handleSandboxClick}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors font-medium text-sm"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Gauge className="w-4 h-4" />
                Calibrate
              </button>
            )}
          </div>
        </Card>

        {/* Insights Banner - Shows when there are any insights */}
        {(() => {
          if (insights.length === 0) return null

          const highSeverityInsights = insights.filter((i: any) =>
            i.severity === 'high' || i.severity === 'critical'
          )
          const lowSeverityInsights = insights.filter((i: any) =>
            i.severity === 'low' || i.severity === 'medium'
          )

          const isCritical = highSeverityInsights.some((i: any) => i.severity === 'critical')
          const isHighSeverity = highSeverityInsights.length > 0

          // Determine banner style based on highest severity
          const bannerStyle = isCritical
            ? 'bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-900/20 dark:to-rose-900/20 border-red-500'
            : isHighSeverity
            ? 'bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 border-amber-500'
            : 'bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-blue-500'

          return (
            <div className={`rounded-lg p-3 mb-4 flex items-center justify-between shadow-sm border-l-4 ${bannerStyle}`}>
              <div className="flex items-center gap-3">
                {isCritical ? (
                  <AlertOctagon className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                ) : isHighSeverity ? (
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                ) : (
                  <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                <div>
                  <h3 className={`text-sm font-semibold mb-0.5 ${
                    isCritical
                      ? 'text-red-900 dark:text-red-200'
                      : isHighSeverity
                      ? 'text-amber-900 dark:text-amber-200'
                      : 'text-blue-900 dark:text-blue-200'
                  }`}>
                    {insights.length} {insights.length === 1 ? 'Insight Available' : 'Insights Available'}
                  </h3>
                  <p className={`text-xs ${
                    isCritical
                      ? 'text-red-800 dark:text-red-300'
                      : isHighSeverity
                      ? 'text-amber-800 dark:text-amber-300'
                      : 'text-blue-800 dark:text-blue-300'
                  }`}>
                    {isCritical
                      ? 'Critical issues detected that require immediate action'
                      : isHighSeverity
                      ? 'Issues detected that may need attention'
                      : 'Business insights and performance updates available'
                    }
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowInsightsModal(true)}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:opacity-90 transition-opacity font-medium text-xs flex-shrink-0"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                View Insights
              </button>
            </div>
          )
        })()}

        {/* Main 2-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-3">
          {/* Left Column - Execution Timeline */}
          <Card className="!p-3 flex flex-col">
            <div className="mb-2">
              <div className="flex items-center justify-between mb-1.5">
                <h2 className="text-sm font-semibold text-[var(--v2-text-primary)]">
                  Recent Activity
                </h2>
                <div className="flex items-center gap-2">
                  {/* Time filter dropdown */}
                  <div className="relative time-filter-dropdown">
                    <button
                      onClick={() => setShowTimeFilterDropdown(!showTimeFilterDropdown)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-gray-200 dark:border-slate-700 transition-all"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      {executionTimeFilter === '7days' && 'Last 7 days'}
                      {executionTimeFilter === '30days' && 'Last 30 days'}
                      {executionTimeFilter === 'all' && 'All time'}
                      <ChevronDown className="w-3 h-3" />
                    </button>

                    {/* Dropdown menu */}
                    {showTimeFilterDropdown && (
                      <div className="absolute top-full mt-1 right-0 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg z-10 min-w-[140px]"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        <button
                          onClick={() => {
                            setExecutionTimeFilter('7days')
                            setExecutionPage(1)
                            setShowTimeFilterDropdown(false)
                          }}
                          className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors ${
                            executionTimeFilter === '7days'
                              ? 'bg-[var(--v2-primary)] text-white'
                              : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)]'
                          }`}
                        >
                          Last 7 days
                        </button>
                        <button
                          onClick={() => {
                            setExecutionTimeFilter('30days')
                            setExecutionPage(1)
                            setShowTimeFilterDropdown(false)
                          }}
                          className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors ${
                            executionTimeFilter === '30days'
                              ? 'bg-[var(--v2-primary)] text-white'
                              : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)]'
                          }`}
                        >
                          Last 30 days
                        </button>
                        <button
                          onClick={() => {
                            setExecutionTimeFilter('all')
                            setExecutionPage(1)
                            setShowTimeFilterDropdown(false)
                          }}
                          className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors ${
                            executionTimeFilter === 'all'
                              ? 'bg-[var(--v2-primary)] text-white'
                              : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)]'
                          }`}
                        >
                          All time
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleRefresh}
                    disabled={loading}
                    className="p-2 hover:bg-[var(--v2-surface-hover)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Refresh executions"
                  >
                    <RefreshCw className={`w-4 h-4 text-[var(--v2-text-muted)] ${loading ? 'animate-spin' : ''}`} />
                  </button>
                  <TrendingUp className="w-5 h-5 text-[var(--v2-text-muted)]" />
                </div>
              </div>
            </div>

            <div className="space-y-2 flex-1">
              {(() => {
                // Filter executions by time range
                const now = new Date()
                const filteredExecutions = executions.filter(exec => {
                  if (executionTimeFilter === 'all') return true

                  const executionDate = new Date(exec.started_at)
                  const daysDiff = Math.floor((now.getTime() - executionDate.getTime()) / (1000 * 60 * 60 * 24))

                  if (executionTimeFilter === '7days') return daysDiff <= 7
                  if (executionTimeFilter === '30days') return daysDiff <= 30
                  return true
                })

                const totalPages = Math.ceil(filteredExecutions.length / EXECUTIONS_PER_PAGE)
                const startIndex = (executionPage - 1) * EXECUTIONS_PER_PAGE
                const endIndex = startIndex + EXECUTIONS_PER_PAGE
                const paginatedExecutions = filteredExecutions.slice(startIndex, endIndex)

                return (
                  <>
                    {paginatedExecutions.map((exec) => (
                      <button
                        key={exec.id}
                        onClick={() => {
                          console.log('[onClick] Execution selected:', {
                            id: exec.id,
                            isPilot: exec.logs?.pilot,
                            hasLogs: !!exec.logs
                          })
                          setSelectedExecution(exec)
                          // Fetch execution_results for Pilot executions
                          if (exec.logs?.pilot) {
                            console.log('[onClick] This is a Pilot execution, fetching results...')
                            fetchExecutionResults(exec.id)
                          } else {
                            console.log('[onClick] Not a Pilot execution, clearing results')
                            setExecutionResults(null)
                          }
                        }}
                        className={`w-full p-2 transition-all text-left border-2 ${
                          selectedExecution?.id === exec.id
                            ? 'border-[var(--v2-primary)]'
                            : 'bg-[var(--v2-surface)] hover:bg-[var(--v2-surface-hover)] border-transparent'
                        }`}
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        <div className="flex items-start justify-between mb-1">
                          <span className="text-xs text-[var(--v2-text-muted)]">
                            {formatDate(exec.started_at)}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                            exec.status === 'completed' || exec.status === 'success'
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          }`}>
                            {exec.status === 'completed' || exec.status === 'success' ? '✓ Success' : '✗ Failed'}
                          </span>
                        </div>
                        <div className="text-xs font-semibold text-[var(--v2-text-primary)] mb-0.5 line-clamp-1">
                          Run #{exec.id.slice(0, 8)}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-[var(--v2-text-muted)]">
                          <span>⏱ {formatDuration(exec.execution_duration_ms ?? undefined)}</span>
                        </div>
                      </button>
                    ))}

                    {filteredExecutions.length === 0 && (
                      <div className="text-center py-12 text-sm text-[var(--v2-text-muted)]">
                        No executions found for this time range
                      </div>
                    )}

                    {totalPages > 1 && (
                      <div className="pt-3 border-t border-[var(--v2-border)] space-y-2">
                        {/* Showing X-Y of Z text */}
                        <div className="text-xs text-[var(--v2-text-muted)] text-center">
                          Showing {startIndex + 1}-{Math.min(endIndex, filteredExecutions.length)} of {filteredExecutions.length} executions
                        </div>

                        {/* Pagination controls */}
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setExecutionPage(prev => Math.max(1, prev - 1))}
                            disabled={executionPage === 1}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-all bg-[var(--v2-surface)] border border-gray-200 dark:border-slate-700"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          >
                            <ChevronLeft className="w-3 h-3" />
                            Previous
                          </button>

                          {/* Page number buttons */}
                          <div className="flex items-center gap-1">
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                              <button
                                key={page}
                                onClick={() => setExecutionPage(page)}
                                className={`px-2.5 py-1.5 text-xs font-medium transition-all ${
                                  executionPage === page
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
                            onClick={() => setExecutionPage(prev => Math.min(totalPages, prev + 1))}
                            disabled={executionPage === totalPages}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-all bg-[var(--v2-surface)] border border-gray-200 dark:border-slate-700"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          >
                            Next
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          </Card>

          {/* Right Column - Execution Details */}
          <Card className="!p-3 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[var(--v2-text-primary)]">
                Latest Execution
              </h2>
              {/* Smart Pilot Badge */}
              {selectedExecution && (selectedExecution.logs?.pilot || selectedExecution.logs?.agentkit) && (
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                  selectedExecution.logs.pilot
                    ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400'
                    : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                }`}>
                  {selectedExecution.logs.pilot ? 'Smart Pilot' : 'AgentKit'}
                </span>
              )}
            </div>

            {selectedExecution ? (
              <div className="space-y-3">
                {/* Metrics Grid */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-2">
                    <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wide mb-1">Duration</div>
                    <div className="text-xl font-semibold text-[var(--v2-text-primary)]">
                      {formatDuration(selectedExecution.execution_duration_ms ?? undefined)}
                    </div>
                  </div>
                  <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-2">
                    <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wide mb-1">
                      {selectedExecution.logs?.pilot ? 'Steps' : 'Status'}
                    </div>
                    <div className="text-xl font-semibold text-[var(--v2-text-primary)] capitalize">
                      {selectedExecution.logs?.pilot
                        ? (() => {
                            const completed = selectedExecution.logs.stepsCompleted || 0
                            const failed = selectedExecution.logs.stepsFailed || 0
                            const skipped = selectedExecution.logs.stepsSkipped || 0
                            const total = selectedExecution.logs.totalSteps || (completed + failed + skipped)
                            return `${completed}/${total}`
                          })()
                        : selectedExecution.status}
                    </div>
                  </div>
                  <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-2">
                    <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wide mb-1">Pilot Credits</div>
                    <div className="text-xl font-semibold text-[var(--v2-text-primary)]">
                      {(() => {
                        const adjusted = selectedExecution.logs?.tokensUsed?.adjusted
                        const total = selectedExecution.logs?.tokensUsed?.total
                        const llmTokens = adjusted || total || 0
                        const pilotTokens = Math.ceil(llmTokens / tokensPerPilotCredit)
                        return pilotTokens.toLocaleString()
                      })()}
                    </div>
                  </div>
                </div>


                {/* Execution Details - Timeline Card */}
                <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-3">
                  {/* Timeline */}
                  <div>
                    <div className="text-xs font-medium text-[var(--v2-text-muted)] mb-2">Timeline</div>
                    <div className="relative">
                      {/* Timeline events */}
                      <div className="flex justify-between items-start relative">
                        {/* Horizontal line - positioned to connect the dots */}
                        {selectedExecution.completed_at && (
                          <div className="absolute left-[6.75px] right-[6.75px] top-[6.75px] h-0.5 bg-gradient-to-r from-blue-600 via-blue-400 to-green-600 dark:from-blue-400 dark:via-blue-300 dark:to-green-400"></div>
                        )}

                        {/* Started event */}
                        <div className="relative flex flex-col items-center gap-1 text-xs">
                          <div className="w-3.5 h-3.5 rounded-full bg-blue-600 dark:bg-blue-400 border-2 border-white dark:border-slate-900 z-10"></div>
                          <div className="text-center mt-1">
                            <div className="text-[var(--v2-text-muted)]">Started</div>
                            <div className="text-[var(--v2-text-primary)] font-medium">
                              {new Date(selectedExecution.started_at).toLocaleTimeString()}
                            </div>
                          </div>
                        </div>

                        {/* Completed event */}
                        {selectedExecution.completed_at && (
                          <div className="relative flex flex-col items-center gap-1 text-xs">
                            <div className="w-3.5 h-3.5 rounded-full bg-green-600 dark:bg-green-400 border-2 border-white dark:border-slate-900 z-10"></div>
                            <div className="text-center mt-1">
                              <div className="text-[var(--v2-text-muted)]">Completed</div>
                              <div className="text-[var(--v2-text-primary)] font-medium">
                                {new Date(selectedExecution.completed_at).toLocaleTimeString()}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Execution Summary - User-friendly metadata */}
                {((selectedExecution as any).output || (selectedExecution as any).final_output) && (
                  <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-4">
                    <h4 className="text-xs font-semibold text-[var(--v2-text-primary)] mb-2">
                      📊 Execution Summary
                    </h4>
                    <div className="space-y-2">
                      {(() => {
                        const output = ((selectedExecution as any).output || (selectedExecution as any).final_output) as Record<string, any>
                        const summaryItems: Array<{ label: string; value: string | number; icon?: string }> = []

                        // Parse output by steps
                        Object.keys(output).forEach(stepKey => {
                          const stepData = output[stepKey]

                          if (stepData && typeof stepData === 'object') {
                            // Check each field in the step data
                            Object.keys(stepData).forEach(key => {
                              const value = stepData[key]

                              // Handle sanitized metadata format (new format after privacy fix)
                              if (value && typeof value === 'object' && 'count' in value && value.type === 'array') {
                                const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')
                                summaryItems.push({
                                  label: `${label} processed`,
                                  value: value.count,
                                  icon: '📝'
                                })
                              }
                              // Legacy format: actual arrays (for backward compatibility)
                              else if (Array.isArray(value)) {
                                const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')
                                summaryItems.push({
                                  label: `${label} processed`,
                                  value: value.length,
                                  icon: '📝'
                                })
                              }
                              // Numbers
                              else if (typeof value === 'number') {
                                const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')
                                summaryItems.push({
                                  label,
                                  value,
                                  icon: '🔢'
                                })
                              }
                              // Short strings
                              else if (typeof value === 'string' && value.length < 100) {
                                const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')
                                summaryItems.push({
                                  label,
                                  value,
                                  icon: '📄'
                                })
                              }
                            })
                          }
                        })

                        if (summaryItems.length === 0) {
                          return (
                            <p className="text-xs text-[var(--v2-text-muted)]">
                              No summary data available
                            </p>
                          )
                        }

                        return summaryItems.slice(0, 5).map((item, idx) => (
                          <div key={idx} className="flex justify-between items-center text-xs">
                            <span className="text-[var(--v2-text-muted)] flex items-center gap-1.5">
                              <span>{item.icon}</span>
                              {item.label}:
                            </span>
                            <span className="text-[var(--v2-text-primary)] font-semibold">
                              {typeof item.value === 'number' ? item.value.toLocaleString() : item.value}
                            </span>
                          </div>
                        ))
                      })()}
                    </div>
                  </div>
                )}

                {/* Execution Results - Enhanced with Business Context */}
                <div>
                  <h3 className="text-xs font-semibold text-[var(--v2-text-primary)] mb-2">
                    What Happened
                  </h3>

                  {executionResults ? (
                    <div className="space-y-2">
                      {(() => {
                        // Get meaningful operations (non-system steps)
                        const meaningfulOps = executionResults.items.filter((item: any) =>
                          item.plugin !== 'system'
                        )

                        // If no meaningful operations, show generic success message
                        if (meaningfulOps.length === 0) {
                          return (
                            <div
                              className="p-2 border border-[var(--v2-border)]"
                              style={{
                                background: 'linear-gradient(135deg, var(--v2-surface) 0%, var(--v2-surface-hover) 100%)',
                                borderRadius: 'var(--v2-radius-card)'
                              }}
                            >
                              <div className="flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-green-600" />
                                <p className="text-xs text-[var(--v2-text-primary)]">
                                  Workflow completed successfully
                                </p>
                              </div>
                            </div>
                          )
                        }

                        // Get icon based on plugin type
                        const getIconComponent = (plugin: string) => {
                          if (plugin === 'google-mail') return Mail
                          if (plugin === 'google-sheets') return Database
                          if (plugin === 'google-drive') return Cloud
                          if (plugin === 'quickbooks') return Database
                          if (plugin === 'airtable') return Database
                          if (plugin === 'anthropic') return Brain
                          return Settings
                        }

                        // Enhanced description with business context
                        const getEnhancedDescription = (item: any) => {
                          // Use the friendlyMessage as base
                          const baseMessage = item.friendlyMessage ||
                            (item.itemCount > 0
                              ? `Processed ${item.itemCount} ${item.itemCount === 1 ? 'item' : 'items'}`
                              : 'Completed')

                          // Add field context if available (what kind of data)
                          if (item.sampleKeys && item.sampleKeys.length > 0) {
                            const keyHints = item.sampleKeys.slice(0, 3)
                            const hasUrgent = keyHints.some((k: string) =>
                              k.toLowerCase().includes('urgent') ||
                              k.toLowerCase().includes('priority')
                            )
                            const hasStatus = keyHints.some((k: string) =>
                              k.toLowerCase().includes('status')
                            )

                            // Add context badges
                            let context = ''
                            if (hasUrgent && item.itemCount > 0) {
                              context = ' (including priority items)'
                            } else if (hasStatus) {
                              context = ' with status tracking'
                            }

                            return baseMessage + context
                          }

                          return baseMessage
                        }

                        // Only show first (input) and last (output) operations if there are multiple
                        const opsToShow = meaningfulOps.length > 2
                          ? [meaningfulOps[0], meaningfulOps[meaningfulOps.length - 1]]
                          : meaningfulOps

                        // Calculate total items processed for context
                        const totalItems = executionResults.totalItems || 0

                        return (
                          <div className="space-y-2">
                            {/* Business Story - Step by Step Flow */}
                            {meaningfulOps.length > 0 && (
                              <div className="p-3 bg-[var(--v2-surface-hover)] border border-[var(--v2-border)] rounded-lg">
                                <div className="space-y-2.5">
                                  {/* Show complete workflow story */}
                                  {meaningfulOps.map((op: any, idx: number) => {
                                    const IconComponent = getIconComponent(op.plugin)
                                    const isLast = idx === meaningfulOps.length - 1

                                    return (
                                      <div key={idx} className="flex items-center gap-3">
                                        {/* Step number badge */}
                                        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center">
                                          <span className="text-[10px] font-semibold text-[var(--v2-text-muted)]">{idx + 1}</span>
                                        </div>

                                        {/* Plugin icon */}
                                        <div className="flex-shrink-0 w-6 h-6 rounded bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center">
                                          <IconComponent className="w-3 h-3 text-[var(--v2-text-muted)]" />
                                        </div>

                                        {/* Count and description */}
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-baseline gap-2">
                                            <span className={`font-bold ${isLast ? 'text-[var(--v2-primary)]' : 'text-[var(--v2-text-primary)]'}`}>
                                              {op.itemCount}
                                            </span>
                                            <span className="text-xs text-[var(--v2-text-secondary)] truncate">
                                              {getEnhancedDescription(op)}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  })}

                                  {/* Execution time footer */}
                                  {executionResults.metadata?.executionTime && (
                                    <div className="pt-2 mt-2 border-t border-[var(--v2-border)] flex items-center gap-2">
                                      <Clock className="w-3 h-3 text-[var(--v2-text-muted)]" />
                                      <p className="text-xs text-[var(--v2-text-muted)]">
                                        {(executionResults.metadata.executionTime / 1000).toFixed(1)}s total
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  ) : (
                    // Fallback to showing logs for non-Pilot or old executions
                    <div className="bg-slate-900 dark:bg-black rounded-lg p-3 max-h-96 overflow-y-auto font-mono text-xs">
                      {(() => {
                        const hasOutput = selectedExecution.output
                        const hasLogs = selectedExecution.logs
                        const hasError = selectedExecution.error_message

                        if (hasOutput) {
                          return (
                            <pre className="text-gray-300 whitespace-pre-wrap break-words">
                              {JSON.stringify(selectedExecution.output, null, 2)}
                            </pre>
                          )
                        }

                        if (hasLogs) {
                          return (
                            <pre className="text-gray-300 whitespace-pre-wrap break-words">
                              {JSON.stringify(selectedExecution.logs, null, 2)}
                            </pre>
                          )
                        }

                        if (hasError) {
                          return (
                            <div className="text-red-400">
                              Error: {String(selectedExecution.error_message)}
                            </div>
                          )
                        }

                        return <div className="text-gray-500">No execution results available</div>
                      })()}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Clock className="w-16 h-16 text-[var(--v2-text-muted)] opacity-20 mb-4" />
                <p className="text-[var(--v2-text-muted)]">
                  Select an execution to view details
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Settings Drawer Overlay */}
      {showSettingsDrawer && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={() => setShowSettingsDrawer(false)}
        />
      )}

      {/* Settings Drawer */}
      <div
        className={`fixed top-0 right-0 h-screen w-[500px] bg-[var(--v2-surface)] shadow-2xl z-50 transform transition-transform duration-300 overflow-y-auto ${
          showSettingsDrawer ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="sticky top-0 bg-[var(--v2-surface)] border-b border-[var(--v2-border)] px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-xl font-semibold text-[var(--v2-text-primary)]">Agent Settings</h2>
          <button
            onClick={() => setShowSettingsDrawer(false)}
            className="text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-8">
          {/* AIS Complexity */}
          <div className="rounded-xl p-5 border-l-4 border-indigo-500 dark:border-indigo-400 bg-[var(--v2-surface)]">
            <AgentIntensityCardV2
              agentId={agentId}
              latestExecutionTime={executions[0]?.started_at ? new Date(executions[0].started_at).getTime() : undefined}
            />
          </div>

          {/* Agent ID */}
          <div>
            <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-2 block">
              Agent ID
            </label>
            <div className="flex items-center gap-2 p-2 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
              <code className="text-xs text-[var(--v2-text-primary)] flex-1 truncate font-mono">
                {agent.id}
              </code>
              <button
                onClick={copyAgentId}
                className="p-1.5 hover:bg-[var(--v2-surface-hover)] transition-colors"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {copiedId ? (
                  <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
                )}
              </button>
            </div>
          </div>

          {/* Created Date */}
          {agent.created_at && (
            <div>
              <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-2 block">
                Created
              </label>
              <p className="text-sm text-[var(--v2-text-primary)] p-2 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                {new Date(agent.created_at).toLocaleString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
            </div>
          )}

          {/* Agent Name & Description */}
          <div>
            <h3 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-4">
              Agent Details
            </h3>
            {!isEditing ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-2 block">
                    Agent Name
                  </label>
                  <p className="text-sm text-[var(--v2-text-primary)] p-2 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                    {agent.agent_name}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-2 block">
                    Description
                  </label>
                  <p className="text-sm text-[var(--v2-text-primary)] p-2 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                    {agent.description || 'No description'}
                  </p>
                </div>
                <button
                  onClick={handleEditClick}
                  className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--v2-primary)] hover:bg-[var(--v2-surface-hover)] rounded-lg transition-colors border border-[var(--v2-border)]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <Edit className="w-3.5 h-3.5" />
                  Edit Details
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-2 block">
                    Agent Name
                  </label>
                  <input
                    type="text"
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    className="w-full text-sm text-[var(--v2-text-primary)] bg-white dark:bg-slate-800 border border-[var(--v2-border)] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)]"
                    placeholder="Agent name"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-2 block">
                    Description
                  </label>
                  <textarea
                    value={editedDescription}
                    onChange={(e) => setEditedDescription(e.target.value)}
                    className="w-full text-sm text-[var(--v2-text-primary)] bg-white dark:bg-slate-800 border border-[var(--v2-border)] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] resize-none"
                    placeholder="Agent description"
                    rows={3}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveEdit}
                    disabled={isSaving || !editedName.trim()}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:opacity-90 transition-opacity rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Save Changes
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    disabled={isSaving}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-[var(--v2-border)]"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Integrations */}
          <div>
            <h3 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-4">
              Integrations ({safePluginsRequired.length})
            </h3>
            {safePluginsRequired.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {safePluginsRequired.map(plugin => {
                  const isConnected = getPluginStatus(plugin)

                  return (
                    <div
                      key={plugin}
                      className="relative group"
                    >
                      {/* Plugin Icon with Status Badge */}
                      <div className="w-10 h-10 rounded-xl bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center shadow-sm transition-all duration-300 hover:scale-110 cursor-pointer">
                        {getPluginIcon(plugin)}
                      </div>
                      {/* Status Badge Overlay */}
                      <div className={`absolute -top-1 -right-1 w-4 h-4 rounded-full border-2 border-[var(--v2-surface)] shadow-md flex items-center justify-center transition-all duration-300 ${
                        isConnected ? 'bg-green-600 dark:bg-green-500' : 'bg-red-600 dark:bg-red-500'
                      }`}>
                        {isConnected && (
                          <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-[var(--v2-text-muted)] p-4 bg-[var(--v2-surface-hover)] rounded-lg">
                No integrations configured
              </p>
            )}
          </div>

          {/* Agent Status */}
          <div>
            <h3 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-4">
              Agent Status
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 bg-[var(--v2-surface-hover)] rounded-lg">
                <div>
                  <h4 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-1">
                    {agent.status === 'active' ? 'Active' : agent.status === 'draft' ? 'Not Active (Draft)' : 'Paused'}
                  </h4>
                  <p className="text-xs text-[var(--v2-text-muted)]">
                    {agent.status === 'active'
                      ? 'Agent is running and will execute on schedule'
                      : agent.status === 'draft'
                      ? 'Agent is in draft mode. Activate to start running.'
                      : 'Agent is paused and will not execute'}
                  </p>
                </div>
                <button
                  data-tour="activate-button"
                  onClick={handleToggleStatus}
                  className={`w-12 h-6 rounded-full relative transition-colors ${
                    agent.status === 'active' ? 'bg-[var(--v2-primary)]' : 'bg-[var(--v2-border)]'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <div
                    className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${
                      agent.status === 'active' ? 'translate-x-7' : 'translate-x-1'
                    }`}
                    style={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)' }}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Schedule Settings */}
          <div>
            <h3 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-4">
              Schedule
            </h3>
            <div className="space-y-3">
              {!isEditing ? (
                <div className="p-4 bg-[var(--v2-surface-hover)] rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-1">
                        {agent.mode === 'scheduled' ? 'Scheduled' : 'On-Demand'}
                      </h4>
                      <p className="text-xs text-[var(--v2-text-muted)]">
                        {agent.mode === 'scheduled'
                          ? formatScheduleDisplay(agent.mode, agent.schedule_cron ?? undefined)
                          : 'Run manually when needed'}
                      </p>
                    </div>
                    <button
                      onClick={handleEditClick}
                      className="px-3 py-1.5 text-xs font-medium bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:opacity-90 transition-opacity rounded-lg flex items-center gap-1"
                    >
                      <Edit className="w-3.5 h-3.5" />
                      Edit
                    </button>
                  </div>
                  {agent.mode === 'scheduled' && agent.next_run_at && (
                    <div className="pt-3 border-t border-[var(--v2-border)]">
                      <div className="flex items-center gap-2 text-xs text-[var(--v2-text-muted)]">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Next run: {formatNextRun(agent.next_run_at, agent.timezone ?? undefined)}</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 bg-[var(--v2-surface-hover)] rounded-lg space-y-4">
                  {/* Schedule Mode Selection */}
                  <div>
                    <label className="text-xs font-medium text-[var(--v2-text-secondary)] mb-2 block">Mode</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={handleOnDemand}
                        className={`p-3 border transition-all ${
                          scheduleMode === 'manual'
                            ? 'border-[var(--v2-primary)] bg-[var(--v2-primary)]/10'
                            : 'border-[var(--v2-border)] hover:border-[var(--v2-primary)] hover:bg-[var(--v2-surface-hover)]'
                        }`}
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        <div className="flex items-center gap-2">
                          <PlayCircle className="h-4 w-4 text-[var(--v2-primary)] flex-shrink-0" />
                          <div className="text-left">
                            <p className="font-semibold text-[var(--v2-text-primary)] text-xs">On-demand</p>
                            <p className="text-[10px] text-[var(--v2-text-muted)] leading-tight">Manual</p>
                          </div>
                        </div>
                      </button>

                      <button
                        onClick={() => setScheduleMode('scheduled')}
                        className={`p-3 border transition-all ${
                          scheduleMode === 'scheduled'
                            ? 'border-[var(--v2-primary)] bg-[var(--v2-primary)]/10'
                            : 'border-[var(--v2-border)] hover:border-[var(--v2-primary)] hover:bg-[var(--v2-surface-hover)]'
                        }`}
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-[var(--v2-primary)] flex-shrink-0" />
                          <div className="text-left">
                            <p className="font-semibold text-[var(--v2-text-primary)] text-xs">Scheduled</p>
                            <p className="text-[10px] text-[var(--v2-text-muted)] leading-tight">Auto run</p>
                          </div>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Schedule Configuration (shown when scheduled is selected) */}
                  {scheduleMode === 'scheduled' && (
                    <div className="space-y-3 pt-3 border-t border-[var(--v2-border)]">
                      {/* Frequency Selection */}
                      <div>
                        <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-2">
                          Frequency
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {(['hourly', 'daily', 'weekly', 'monthly'] as const).map((type) => (
                            <button
                              key={type}
                              onClick={() => setScheduleType(type)}
                              className={`px-3 py-2 text-xs font-medium transition-all ${
                                scheduleType === type
                                  ? 'bg-[var(--v2-primary)] text-white'
                                  : 'bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:border-[var(--v2-primary)]'
                              }`}
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              {type.charAt(0).toUpperCase() + type.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Hourly Interval */}
                      {scheduleType === 'hourly' && (
                        <div>
                          <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-2">
                            Every N hours
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="24"
                            value={hourlyInterval}
                            onChange={(e) => setHourlyInterval(e.target.value)}
                            className="w-full px-3 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:outline-none focus:border-[var(--v2-primary)]"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          />
                        </div>
                      )}

                      {/* Time Selection (for daily/weekly/monthly) */}
                      {scheduleType && scheduleType !== 'hourly' && (
                        <div>
                          <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-2">
                            Time
                          </label>
                          <input
                            type="time"
                            value={scheduleTime}
                            onChange={(e) => setScheduleTime(e.target.value)}
                            className="w-full px-3 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:outline-none focus:border-[var(--v2-primary)]"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          />
                        </div>
                      )}

                      {/* Daily Options */}
                      {scheduleType === 'daily' && (
                        <div>
                          <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-2">
                            Days
                          </label>
                          <div className="grid grid-cols-3 gap-2">
                            {(['everyday', 'weekdays', 'weekends'] as const).map((option) => (
                              <button
                                key={option}
                                onClick={() => setDailyOption(option)}
                                className={`px-3 py-2 text-xs font-medium transition-all ${
                                  dailyOption === option
                                    ? 'bg-[var(--v2-primary)] text-white'
                                    : 'bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:border-[var(--v2-primary)]'
                                }`}
                                style={{ borderRadius: 'var(--v2-radius-button)' }}
                              >
                                {option === 'everyday' ? 'Every day' : option.charAt(0).toUpperCase() + option.slice(1)}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Weekly Day Selection */}
                      {scheduleType === 'weekly' && (
                        <div>
                          <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-2">
                            Days of week
                          </label>
                          <div className="grid grid-cols-7 gap-1">
                            {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day) => (
                              <button
                                key={day}
                                onClick={() => handleDayToggle(day)}
                                className={`px-1 py-2 text-xs font-medium transition-all ${
                                  selectedDays.includes(day)
                                    ? 'bg-[var(--v2-primary)] text-white'
                                    : 'bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:border-[var(--v2-primary)]'
                                }`}
                                style={{ borderRadius: 'var(--v2-radius-button)' }}
                              >
                                {day.slice(0, 3)}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Monthly Day Selection */}
                      {scheduleType === 'monthly' && (
                        <div>
                          <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-2">
                            Day of month
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="31"
                            value={selectedMonthDay}
                            onChange={(e) => setSelectedMonthDay(e.target.value)}
                            className="w-full px-3 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:outline-none focus:border-[var(--v2-primary)]"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          />
                        </div>
                      )}

                      {/* Schedule Preview */}
                      {scheduleType && (
                        <div className="p-3 bg-[var(--v2-surface)] border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                          <p className="text-xs text-[var(--v2-text-secondary)]">
                            <span className="font-medium">Schedule: </span>
                            {getScheduleDescription()}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Save/Cancel Buttons */}
                  <div className="flex gap-2 pt-3 border-t border-[var(--v2-border)]">
                    <button
                      onClick={handleSaveEdit}
                      disabled={isSaving}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:opacity-90 transition-opacity font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          Save
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      disabled={isSaving}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Intelligence Features */}
          <div>
            <h3 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-4">
              Intelligence Features
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 bg-[var(--v2-surface-hover)] rounded-lg">
                <div>
                  <h4 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-1">Business Insights</h4>
                  <p className="text-xs text-[var(--v2-text-muted)]">AI-powered recommendations to improve reliability and efficiency</p>
                </div>
                <button
                  onClick={handleToggleInsights}
                  className={`w-12 h-6 rounded-full relative transition-colors ${
                    (agent.insights_enabled ?? false) ? 'bg-[var(--v2-primary)]' : 'bg-[var(--v2-border)]'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <div
                    className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${
                      (agent.insights_enabled ?? false) ? 'translate-x-7' : 'translate-x-1'
                    }`}
                    style={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)' }}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Agent Actions */}
          <div>
            <h3 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-4">
              Agent Actions
            </h3>
            <div className="space-y-2">
              <button
                onClick={handleDuplicateAgent}
                disabled={actionLoading === 'duplicate'}
                className="w-full flex items-center gap-3 p-4 bg-white dark:bg-slate-800 border border-[var(--v2-border)] rounded-lg hover:bg-[var(--v2-surface-hover)] transition-all disabled:opacity-50"
              >
                {actionLoading === 'duplicate' ? <Loader2 className="w-5 h-5 animate-spin text-[var(--v2-text-secondary)]" /> : <Copy className="w-5 h-5 text-[var(--v2-text-secondary)]" />}
                <div className="text-left flex-1">
                  <h5 className="text-sm font-semibold text-[var(--v2-text-primary)]">Duplicate Agent</h5>
                  <p className="text-xs text-[var(--v2-text-muted)]">Create a copy of this agent</p>
                </div>
              </button>

              <button
                onClick={handleShareAgentClick}
                disabled={agent.status !== 'active' || actionLoading === 'share'}
                className="w-full flex items-center gap-3 p-4 bg-white dark:bg-slate-800 border border-[var(--v2-border)] rounded-lg hover:bg-[var(--v2-surface-hover)] transition-all disabled:opacity-50"
              >
                {actionLoading === 'share' ? <Loader2 className="w-5 h-5 animate-spin text-[var(--v2-text-secondary)]" /> : <Share2 className="w-5 h-5 text-[var(--v2-text-secondary)]" />}
                <div className="text-left flex-1">
                  <h5 className="text-sm font-semibold text-[var(--v2-text-primary)]">Share to Templates</h5>
                  <p className="text-xs text-[var(--v2-text-muted)]">Share with community and earn credits</p>
                </div>
              </button>

              <button
                onClick={handleExportConfiguration}
                className="w-full flex items-center gap-3 p-4 bg-white dark:bg-slate-800 border border-[var(--v2-border)] rounded-lg hover:bg-[var(--v2-surface-hover)] transition-all"
              >
                <Download className="w-5 h-5 text-[var(--v2-text-secondary)]" />
                <div className="text-left flex-1">
                  <h5 className="text-sm font-semibold text-[var(--v2-text-primary)]">Export Configuration</h5>
                  <p className="text-xs text-[var(--v2-text-muted)]">Download agent setup as JSON</p>
                </div>
              </button>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="pt-6 border-t-2 border-red-200 dark:border-red-900/50">
            <h3 className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Danger Zone
            </h3>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full flex items-center gap-3 p-4 bg-white dark:bg-slate-800 border border-red-200 dark:border-red-900 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-all text-red-600 dark:text-red-400"
            >
              <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
              <div className="text-left flex-1">
                <h5 className="text-sm font-semibold">Delete Agent</h5>
                <p className="text-xs">Permanently remove this agent</p>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-[var(--v2-border)]">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">Delete Agent?</h3>
                <p className="text-sm text-[var(--v2-text-muted)]">This action cannot be undone</p>
              </div>
            </div>

            <p className="text-sm text-[var(--v2-text-secondary)] mb-6">
              Are you sure you want to delete <span className="font-semibold text-[var(--v2-text-primary)]">{agent.agent_name}</span>? All execution history and data will be permanently removed.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors font-medium text-sm"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAgent}
                disabled={actionLoading === 'delete'}
                className="flex-1 px-4 py-2.5 bg-red-600 dark:bg-red-500 text-white hover:bg-red-700 dark:hover:bg-red-600 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {actionLoading === 'delete' ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Deleting...</>
                ) : (
                  'Delete Agent'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Confirmation Modal - Keep existing implementation */}
      {showShareConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--v2-surface)] rounded-2xl shadow-2xl max-w-md w-full p-6 border border-[var(--v2-border)]">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-[var(--v2-primary)]/10 rounded-full flex items-center justify-center">
                <Share2 className="w-6 h-6 text-[var(--v2-primary)]" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">Share Agent</h3>
                <p className="text-sm text-[var(--v2-text-muted)]">Share with the community</p>
              </div>
            </div>

            {!shareRewardActive ? (
              <div className="bg-[var(--v2-surface-hover)] border border-[var(--v2-border)] rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="h-5 w-5 text-[var(--v2-text-secondary)]" />
                  <span className="font-semibold text-[var(--v2-text-primary)]">Sharing Temporarily Unavailable</span>
                </div>
                <p className="text-[var(--v2-text-secondary)] text-sm">
                  The agent sharing feature is currently disabled by the administrator.
                </p>
              </div>
            ) : hasBeenShared || (sharingValidation?.details?.alreadyShared) ? (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  <span className="font-semibold text-amber-800 dark:text-amber-200">Already Shared</span>
                </div>
                <p className="text-amber-700 dark:text-amber-300 text-sm">
                  This agent has already been shared with the community.
                </p>
              </div>
            ) : sharingValidation && !sharingValidation.valid ? (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                  <span className="font-semibold text-red-800 dark:text-red-200">Cannot Share Yet</span>
                </div>
                <p className="text-red-700 dark:text-red-300 text-sm mb-3">
                  {sharingValidation.reason}
                </p>
              </div>
            ) : (
              <div className="space-y-3 mb-4">
                {sharingValidation && sharingValidation.valid && (
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="font-semibold text-emerald-800 dark:text-emerald-200 text-sm">Quality Requirements Met ✓</span>
                    </div>
                  </div>
                )}
                <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[var(--v2-primary)]/10 rounded-full flex items-center justify-center">
                        <Zap className="w-5 h-5 text-[var(--v2-primary)]" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-[var(--v2-text-primary)]">Share Reward</div>
                        <div className="text-xs text-[var(--v2-text-muted)]">Help the community grow</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-[var(--v2-primary)]">{sharingRewardAmount}</div>
                      <div className="text-xs text-[var(--v2-text-muted)]">credits</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowShareConfirm(false)}
                className="flex-1 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors font-medium text-sm"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {(hasBeenShared || sharingValidation?.details?.alreadyShared) ? 'Close' : 'Cancel'}
              </button>
              {!hasBeenShared && !sharingValidation?.details?.alreadyShared && (sharingValidation && !sharingValidation.valid ? null : (
                <button
                  onClick={handleShareAgent}
                  disabled={actionLoading === 'share' || (sharingValidation && !sharingValidation.valid) || !shareRewardActive}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:opacity-90 transition-opacity font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {actionLoading === 'share' ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Sharing...</>
                  ) : (
                    'Share & Earn Credits'
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Share Success Notification */}
      {showShareSuccess && (
        <div className="fixed top-4 right-4 z-50 max-w-md animate-in slide-in-from-top-5">
          <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-2xl shadow-2xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-[var(--v2-text-primary)] text-lg mb-1">Agent Shared Successfully!</h3>
                <p className="text-sm text-[var(--v2-text-secondary)] mb-3">
                  Your agent is now available in the community templates.
                </p>
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                    <Zap className="w-4 h-4" />
                    <span className="font-semibold">{shareCreditsAwarded} credits earned</span>
                  </div>
                  <div className="flex items-center gap-2 text-[var(--v2-primary)]">
                    <Brain className="w-4 h-4" />
                    <span className="font-semibold">Score: {shareQualityScore}/100</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowShareSuccess(false)}
                className="text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Insights Modal */}
      {showInsightsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-[var(--v2-border)]">
              <div>
                <h2 className="text-xl font-semibold text-[var(--v2-text-primary)]">Recommendations</h2>
                <p className="text-sm text-[var(--v2-text-secondary)] mt-1">
                  Business insights and optimization opportunities
                </p>
              </div>
              <button
                onClick={() => setShowInsightsModal(false)}
                className="text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors p-2 rounded-lg hover:bg-[var(--v2-surface-hover)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="overflow-y-auto max-h-[calc(90vh-120px)] p-6">
              <InsightsList
                insights={insights}
                onDismiss={async (id) => {
                  try {
                    await fetch(`/api/v6/insights/${id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'dismissed' })
                    })
                    // Refresh insights
                    const result = await fetch(`/api/v6/insights?agentId=${agentId}&status=new,viewed`)
                    const data = await result.json()
                    if (data.success) {
                      setInsights(data.data)
                    }
                  } catch (error) {
                    clientLogger.error('Error dismissing insight', error as Error)
                  }
                }}
                onApply={async (id) => {
                  try {
                    await fetch(`/api/v6/insights/${id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'applied' })
                    })
                    // Refresh insights
                    const result = await fetch(`/api/v6/insights?agentId=${agentId}&status=new,viewed`)
                    const data = await result.json()
                    if (data.success) {
                      setInsights(data.data)
                    }
                  } catch (error) {
                    clientLogger.error('Error applying insight', error as Error)
                  }
                }}
                onSnooze={async (id, days) => {
                  try {
                    const snoozedUntil = new Date()
                    snoozedUntil.setDate(snoozedUntil.getDate() + days)

                    await fetch(`/api/v6/insights/${id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        status: 'snoozed',
                        snoozed_until: snoozedUntil.toISOString()
                      })
                    })
                    // Refresh insights
                    const result = await fetch(`/api/v6/insights?agentId=${agentId}&status=new,viewed`)
                    const data = await result.json()
                    if (data.success) {
                      setInsights(data.data)
                    }
                  } catch (error) {
                    clientLogger.error('Error snoozing insight', error as Error)
                  }
                }}
              />

              {insights.length === 0 && (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-[var(--v2-surface-hover)] rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8 text-green-500" />
                  </div>
                  <h3 className="text-lg font-semibold text-[var(--v2-text-primary)] mb-2">No Recommendations</h3>
                  <p className="text-sm text-[var(--v2-text-secondary)]">
                    Your workflow is running smoothly with no issues detected.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
