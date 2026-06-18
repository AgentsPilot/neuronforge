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
import { ModernHelpDialog } from '@/components/v2/ModernHelpDialog'
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
import { Mail, Phone, Cloud, Database, Globe, Puzzle, RefreshCw, DollarSign, Timer, Filter, Layers, Cpu, Lightbulb, TrendingDown, Wrench } from 'lucide-react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts'
import { PluginIcon } from '@/components/PluginIcon'
import { AgentIntensityCardV2 } from '@/components/v2/agents/AgentIntensityCardV2'
import { formatScheduleDisplay, formatNextRun } from '@/lib/utils/scheduleFormatter'
import { InlineLoading } from '@/components/v2/ui/loading'
import { clientLogger } from '@/lib/logger/client'
import { MiniInsightCard, HealthStatus, NoIssuesState } from '@/components/v2/execution/MiniInsightCard'
import { InsightsList } from '@/components/v2/insights/InsightsList'
import { AgentInputFields } from '@/components/v2/AgentInputFields'
import { motion, AnimatePresence } from 'framer-motion'

// Import new redesigned components
import {
  AgentHeader,
  PerformanceTrends,
  LatestRunCard,
  RunHistoryTable,
  ExecutionDetailPanel,
  InsightPreview,
  normalizeInsights,
  ExecutionModal,
  type TimePeriod
} from '@/components/v2/agent'

// PERFORMANCE: Lazy load heavy components that may not be used immediately
const DraftAgentTour = lazy(() => import('@/components/agents/DraftAgentTour'))

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
  const [executionDetails, setExecutionDetails] = useState<{
    metrics: {
      total_items: number;
      duration_ms: number;
      has_empty_results: boolean;
      failed_step_count: number;
      field_names: string[];
      items_by_field: Record<string, number>;
      step_metrics: Array<{
        plugin: string;
        action: string;
        step_name: string;
        count: number;
        fields?: string[];
        step_type?: string;
        metadata?: {
          filter_criteria?: string;
          items_filtered_out?: number;
          percentage_kept?: number;
          categories?: Record<string, number>;
        };
      }>;
    } | null;
    insightRuns?: Array<{
      id: string;
      insight_id: string;
      execution_id: string;
      title: string;
      description: string;
      business_impact: string;
      recommendation: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      confidence: string;
      this_run_count: number;
      last_run_count: number;
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      model: string;
      latency_ms: number;
      llm_called: boolean;
      cache_hit: boolean;
      time_saved_hours_per_week: string;
      cost_saved_usd_per_week: string;
      pattern_data: any;
      created_at: string;
    }>;
    executionInsights?: Array<{
      id: string;
      user_id: string;
      agent_id: string;
      execution_ids: string[];
      insight_type: string;
      category: string;
      severity: string;
      confidence: string | number;
      title: string;
      description: string;
      business_impact: string;
      recommendation: string;
      pattern_data: any;
      metrics: {
        total_executions: number;
        affected_executions: number;
        pattern_frequency: number;
        avg_duration_ms?: number;
        avg_token_usage?: number;
        avg_cost?: number;
        first_occurrence?: string;
        last_occurrence?: string;
      };
      status: string;
      snoozed_until?: string;
      created_at: string;
      updated_at: string;
      viewed_at?: string;
      applied_at?: string;
    }>;
    roi: {
      items_processed: number;
      time_saved_seconds: number;
      time_saved_hours: number;
      cost_saved_usd: number;
      manual_time_per_item_seconds: number;
    } | null;
    agent: {
      manual_time_per_item_seconds?: number | null;
      workflow_purpose?: string | null;
    } | null;
  } | null>(null)
  const [loadingExecutionDetails, setLoadingExecutionDetails] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshingExecutions, setRefreshingExecutions] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [insights, setInsights] = useState<any[]>([]) // Business + technical insights

  // UI state
  const [copiedId, setCopiedId] = useState(false)
  const [executionPage, setExecutionPage] = useState(1)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // NEW: Advanced mode and slide-out panel for redesigned layout
  const [advancedMode, setAdvancedMode] = useState(false)
  const [showDetailPanel, setShowDetailPanel] = useState(false)
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('all')

  // Drawer and modal state
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false)
  const [showInsightsModal, setShowInsightsModal] = useState(false)
  const [insightsTab, setInsightsTab] = useState<'business' | 'technical' | 'data'>('business')
  const [helpOpen, setHelpOpen] = useState(false)
  const [metricsData, setMetricsData] = useState<any>(null)
  const [loadingMetrics, setLoadingMetrics] = useState(false)
  const [metricsRange, setMetricsRange] = useState<'7d' | '30d' | '90d'>('7d')

  // Modals
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showShareConfirm, setShowShareConfirm] = useState(false)
  const [showShareSuccess, setShowShareSuccess] = useState(false)
  const [showHourlyRateDialog, setShowHourlyRateDialog] = useState(false)

  // Execution Modal state (Run Now)
  const [showExecutionModal, setShowExecutionModal] = useState(false)
  const [executionResult, setExecutionResult] = useState<any>(null)
  const [executionError, setExecutionError] = useState<string | null>(null)
  const [hourlyRateInput, setHourlyRateInput] = useState<string>('50')
  const [savingHourlyRate, setSavingHourlyRate] = useState(false)
  const [userHourlyRate, setUserHourlyRate] = useState<number | null>(null) // null = not fetched yet
  const [pendingInsightsToggle, setPendingInsightsToggle] = useState(false) // True when waiting to enable insights after hourly rate dialog

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
  const [isEditingDetails, setIsEditingDetails] = useState(false)
  const [isEditingSchedule, setIsEditingSchedule] = useState(false)
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

  // Input configuration state
  const [inputConfigExpanded, setInputConfigExpanded] = useState(false)
  const [inputConfigValues, setInputConfigValues] = useState<Record<string, any>>({})
  const [inputConfigSaving, setInputConfigSaving] = useState(false)
  const [inputConfigDirty, setInputConfigDirty] = useState(false)
  const [inputConfigMetadata, setInputConfigMetadata] = useState<Record<string, any[]> | null>(null)
  const [inputConfigLoading, setInputConfigLoading] = useState(false)

  const EXECUTIONS_PER_PAGE = 5
  const [executionTimeFilter, setExecutionTimeFilter] = useState<'7days' | '30days' | 'all'>('all')
  const [showTimeFilterDropdown, setShowTimeFilterDropdown] = useState(false)

  // Load advanced mode from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('agent-detail-advanced-mode')
    if (stored === 'true') {
      setAdvancedMode(true)
    }
  }, [])

  // Persist advanced mode to localStorage
  const handleAdvancedModeToggle = useCallback(() => {
    setAdvancedMode(prev => {
      const newValue = !prev
      localStorage.setItem('agent-detail-advanced-mode', String(newValue))
      return newValue
    })
  }, [])

  // Handle execution selection for slide-out panel (new design)
  const handleSelectExecutionForPanel = useCallback((execution: Execution) => {
    setSelectedExecution(execution)
    setShowDetailPanel(true)

    if (execution.logs?.pilot) {
      fetchExecutionResults(execution.id)
      fetchExecutionDetails(execution.id)
    } else {
      setExecutionResults(null)
      setExecutionDetails(null)
    }
  }, [])

  // IMPROVED: Batched data fetch wrapped in useCallback to prevent unnecessary re-fetches
  const fetchAllData = useCallback(async () => {
    if (!user || !agentId) return

    setLoading(true)
    try {
      // Parallel fetch all data
      // PERFORMANCE: Skip token enrichment for faster load
      // Also pre-fetch form metadata and global schema metadata for input config drawer
      const [agentResult, executionsResult, configResult, rewardStatus, insightsResult, formMetadataResult, globalSchemaResult, profileResult] = await Promise.all([
        agentApi.getById(agentId, user.id),
        agentApi.getExecutions(agentId, user.id, { includeTokens: false }),
        systemConfigApi.getByKeys(['tokens_per_pilot_credit', 'agent_sharing_reward_amount']),
        fetch('/api/admin/reward-config').then(r => r.json()).catch(() => ({ success: false })),
        fetch(`/api/v6/insights?agentId=${agentId}&status=new,viewed`).then(r => r.json()).catch(() => ({ success: false, data: [] })),
        fetch(`/api/v2/agents/${agentId}/form-metadata`).then(r => r.json()).catch(() => ({ metadata: [] })),
        fetch('/api/plugins/schema-metadata').then(r => r.json()).catch(() => ({ data: { metadata: {} } })),
        supabase.from('profiles').select('hourly_rate_usd').eq('id', user.id).single()
      ])

      // Process agent
      if (!agentResult.success || !agentResult.data) {
        throw new Error(agentResult.error || 'Failed to fetch agent')
      }
      setAgent(agentResult.data.agent as Agent)

      // Process executions
      console.log('[AgentPage] Executions result:', executionsResult)
      if (executionsResult.success && executionsResult.data) {
        const enrichedExecutions = executionsResult.data as Execution[]
        console.log('[AgentPage] Setting executions:', enrichedExecutions.length, 'executions')
        setAllExecutions(enrichedExecutions)
        setExecutions(enrichedExecutions)
        // Don't set selectedExecution here - let the useEffect handle it based on time filter
      } else {
        console.log('[AgentPage] No executions found or error:', executionsResult.error)
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

      // Process pre-fetched form metadata and global schema metadata for input config drawer
      // This ensures the drawer opens instantly when clicked
      let metadataMap: Record<string, any[]> = {}

      // Load global schema metadata first (as base)
      const globalMetadata = globalSchemaResult.data?.metadata || globalSchemaResult.metadata
      if (globalMetadata) {
        metadataMap = { ...globalMetadata }
        console.log('[AgentPage] Pre-loaded global schema metadata:', Object.keys(metadataMap).length, 'parameters')
      }

      // Merge form field metadata (takes precedence)
      if (formMetadataResult.metadata && Array.isArray(formMetadataResult.metadata)) {
        for (const field of formMetadataResult.metadata) {
          if (field.name) {
            metadataMap[field.name] = [{
              plugin: field.plugin,
              action: field.action,
              parameter: field.parameter,
              depends_on: field.depends_on,
              description: field.description,
              queryComponents: field.queryComponents
            }]
          }
        }
        console.log('[AgentPage] Pre-loaded form field metadata:', formMetadataResult.metadata.length, 'fields')
      }

      if (Object.keys(metadataMap).length > 0) {
        setInputConfigMetadata(metadataMap)
      }

      // Process user's hourly rate for ROI calculations
      if (profileResult.data?.hourly_rate_usd) {
        setUserHourlyRate(profileResult.data.hourly_rate_usd)
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

    setRefreshingExecutions(true)
    try {
      // Clear cache for this agent's executions
      requestDeduplicator.clear(`executions-${agentId}-false-all`)

      // Fetch only executions (not all data)
      const executionsResult = await agentApi.getExecutions(agentId, user.id, { includeTokens: false })

      if (executionsResult.success && executionsResult.data) {
        const enrichedExecutions = executionsResult.data as Execution[]
        setAllExecutions(enrichedExecutions)
        setExecutions(enrichedExecutions)
        // The useEffect will handle selecting the first execution
      }
    } catch (error) {
      clientLogger.error('Error refreshing executions', error as Error)
    } finally {
      setRefreshingExecutions(false)
    }
  }, [user?.id, agentId])

  // Handle "Run Now" - Execute agent and show modal with results
  // Open the execution modal (confirmation step)
  const handleRunNow = useCallback(() => {
    setExecutionResult(null)
    setExecutionError(null)
    setShowExecutionModal(true)
  }, [])

  // Execute the agent after confirmation
  const handleConfirmExecution = useCallback(async () => {
    if (!agent || !user) return

    // Use inputConfigValues if available, otherwise fall back to agent.input_config
    const configToUse = Object.keys(inputConfigValues).length > 0
      ? inputConfigValues
      : (agent.input_config || {})

    // Start execution
    setExecuting(true)

    try {
      const sessionId = crypto.randomUUID()
      const response = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agent.id,
          input_variables: configToUse,
          execution_type: 'run',
          session_id: sessionId,
        }),
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error || result.message || 'Execution failed')
      }

      setExecutionResult(result)
    } catch (error: any) {
      setExecutionError(error.message || 'Execution failed')
    } finally {
      setExecuting(false)
    }
  }, [agent, user, inputConfigValues])

  // Handle closing execution modal and refreshing data
  const handleCloseExecutionModal = useCallback(() => {
    setShowExecutionModal(false)
    setExecutionResult(null)
    setExecutionError(null)
    // Refresh page data to show latest execution
    handleRefresh()
  }, [handleRefresh])

  // Batched data fetching - IMPROVEMENT
  useEffect(() => {
    if (user && agentId) {
      const pageLogger = clientLogger.child({ component: 'V2AgentDetailPage', agentId, userId: user.id })
      pageLogger.info({ agentId }, 'Agent detail page mounted')

      // Check if returning from calibration on initial mount
      const calibrationFlag = localStorage.getItem(`calibration-completed-${agentId}`)
      if (calibrationFlag === 'true') {
        console.log('[Agent Page] Detected calibration completion on mount, clearing flag')
        localStorage.removeItem(`calibration-completed-${agentId}`)
      }

      fetchAllData()

      return () => {
        pageLogger.debug('Agent detail page unmounted')
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
        fetchExecutionDetails(firstExec.id) // Also fetch detailed metrics
      } else {
        setExecutionResults(null)
        setExecutionDetails(null)
      }
    }
  }, [executions, executionTimeFilter]) // Remove selectedExecution?.id from deps to avoid infinite loop

  // Auto-refresh executions when page becomes visible after being away for a while
  // OR when returning from calibration (indicated by localStorage flag)
  useEffect(() => {
    let lastVisibleTime = Date.now()
    const REFRESH_THRESHOLD = 60000 // Only refresh if away for more than 60 seconds

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Page is being hidden, record the time
        lastVisibleTime = Date.now()
      } else if (agentId) {
        // Page is becoming visible
        const timeAway = Date.now() - lastVisibleTime

        // Check if returning from calibration (always refresh in this case)
        const calibrationFlag = localStorage.getItem(`calibration-completed-${agentId}`)
        if (calibrationFlag === 'true') {
          console.log('[Agent Page] Detected calibration completion, refreshing data')
          localStorage.removeItem(`calibration-completed-${agentId}`)
          requestDeduplicator.clear(`executions-${agentId}-false-50`)
          fetchAllData()
          return
        }

        // Only refresh if user was away for more than the threshold
        if (timeAway > REFRESH_THRESHOLD) {
          requestDeduplicator.clear(`executions-${agentId}-false-50`)
          fetchAllData()
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [agentId, fetchAllData])

  // Check for calibration completion flag when window receives focus
  // This catches the case when user navigates back from calibration via router.push
  useEffect(() => {
    const handleFocus = () => {
      if (!agentId) return

      const calibrationFlag = localStorage.getItem(`calibration-completed-${agentId}`)
      if (calibrationFlag === 'true') {
        console.log('[Agent Page] Detected calibration completion on focus, refreshing data')
        localStorage.removeItem(`calibration-completed-${agentId}`)
        requestDeduplicator.clear(`executions-${agentId}-false-50`)
        fetchAllData()
      }
    }

    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
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
        .from('agent_executions')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', agentId)
        .neq('run_mode', 'calibration')

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

  // Fetch detailed execution metrics, insights, and ROI data
  const fetchExecutionDetails = async (executionId: string) => {
    if (!agentId) return

    setLoadingExecutionDetails(true)
    try {
      const response = await fetch(`/api/v6/agents/${agentId}/executions/${executionId}`)
      const data = await response.json()

      if (data.success && data.data) {
        console.log('[fetchExecutionDetails] ✅ Loaded execution details:', {
          hasMetrics: !!data.data.metrics,
          stepMetricsCount: data.data.metrics?.step_metrics?.length || 0,
          insightRunsCount: data.data.insightRuns?.length || 0,
          executionInsightsCount: data.data.executionInsights?.length || 0,
          hasRoi: !!data.data.roi,
        })
        setExecutionDetails({
          metrics: data.data.metrics,
          insightRuns: data.data.insightRuns || [],
          executionInsights: data.data.executionInsights || [],
          roi: data.data.roi,
          agent: data.data.agent,
        })
      } else {
        console.log('[fetchExecutionDetails] ⚠️ No execution details found')
        setExecutionDetails(null)
      }
    } catch (error) {
      console.error('[fetchExecutionDetails] ❌ Exception:', error)
      setExecutionDetails(null)
    } finally {
      setLoadingExecutionDetails(false)
    }
  }

  const fetchMetrics = async (range: '7d' | '30d' | '90d' = '7d') => {
    if (!agentId || !user?.id) return

    setLoadingMetrics(true)
    try {
      // Calculate date range using UTC (same pattern as SystemAnalyticsService)
      const now = new Date()
      const daysAgo = range === '7d' ? 7 : range === '30d' ? 30 : 90

      // Get today's date at end of day UTC
      const endDate = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        23, 59, 59, 999
      ))

      // Start date: (daysAgo - 1) days before today to get exactly daysAgo days including today
      const startDate = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - (daysAgo - 1),
        0, 0, 0, 0
      ))

      // Filter executions by date range
      const rangeExecutions = executions.filter(e => {
        const execDate = new Date(e.created_at)
        return execDate >= startDate && execDate <= endDate
      })

      // Build chart data from executions
      const chartDataMap = new Map<string, { items: number; duration: number; count: number }>()

      rangeExecutions.forEach(exec => {
        // Extract UTC date to match the date range we're querying (avoid timezone issues)
        const executionDate = new Date(exec.created_at)
        const year = executionDate.getUTCFullYear()
        const month = String(executionDate.getUTCMonth() + 1).padStart(2, '0')
        const day = String(executionDate.getUTCDate()).padStart(2, '0')
        const date = `${year}-${month}-${day}` // YYYY-MM-DD in UTC

        const existing = chartDataMap.get(date) || { items: 0, duration: 0, count: 0 }

        // Count items processed (from logs if available)
        const itemsProcessed = exec.logs?.metrics?.total_items || 1

        // Sum duration
        const duration = exec.execution_duration_ms || 0

        chartDataMap.set(date, {
          items: existing.items + itemsProcessed,
          duration: existing.duration + duration,
          count: existing.count + 1
        })
      })

      // Fill in missing dates with zero values (including today)
      // Helper function to format date as YYYY-MM-DD in UTC
      const formatUTCDate = (date: Date) => {
        const year = date.getUTCFullYear()
        const month = String(date.getUTCMonth() + 1).padStart(2, '0')
        const day = String(date.getUTCDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
      }

      // Get today's date string in UTC to ensure we always include it
      const todayStr = formatUTCDate(endDate)

      // Generate dates from startDate to today (inclusive)
      const chartData: any[] = []
      const currentDate = new Date(startDate)

      // Keep looping until we've included today
      while (true) {
        const dateStr = formatUTCDate(currentDate)
        const data = chartDataMap.get(dateStr)

        chartData.push({
          date: dateStr,
          items: data?.items || 0,
          avgDuration: data && data.count > 0 ? Math.round(data.duration / data.count) : 0
        })

        // If we just added today, we're done
        if (dateStr === todayStr) {
          break
        }

        // Move to next day in UTC
        currentDate.setUTCDate(currentDate.getUTCDate() + 1)
      }

      setMetricsData({ chartData })
    } catch (error) {
      clientLogger.error('Error fetching metrics', error as Error)
    } finally {
      setLoadingMetrics(false)
    }
  }

  // Handle opening insights modal - directly open the modal
  const handleOpenInsights = (insight?: any) => {
    setShowInsightsModal(true)

    // Set the appropriate tab based on the insight category
    if (insight?.category === 'business_insight') {
      setInsightsTab('business')
    } else if (insight?.category === 'technical_insight' || insight?.category === 'data_insight') {
      setInsightsTab('technical')
    } else if (insight === undefined) {
      // When no insight is passed (e.g., "View All" button), default to business tab
      setInsightsTab('business')
    }
    // Otherwise keep the current tab
  }

  // Save hourly rate and continue to insights (or enable insights if pending)
  const saveHourlyRateAndContinue = async () => {
    if (!user?.id) return

    const rate = parseFloat(hourlyRateInput)
    if (isNaN(rate) || rate <= 0) {
      alert('Please enter a valid hourly rate')
      return
    }

    setSavingHourlyRate(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ hourly_rate_usd: rate })
        .eq('id', user.id)

      if (error) throw error

      setUserHourlyRate(rate)
      setShowHourlyRateDialog(false)

      // If we're enabling insights via the toggle, complete that action
      if (pendingInsightsToggle && agent) {
        console.log('[saveHourlyRateAndContinue] Completing pending insights toggle')
        setPendingInsightsToggle(false)

        // Enable insights on the agent
        setAgent({ ...agent, insights_enabled: true })

        const result = await agentApi.update(agent.id, user.id, {
          insights_enabled: true
        })

        if (result.success && result.data) {
          setAgent(result.data as Agent)
          clientLogger.info('Insights enabled after hourly rate confirmation', { agentId: agent.id })
          console.log('✅ Insights enabled successfully')
        } else {
          // Revert on failure
          setAgent({ ...agent, insights_enabled: false })
          clientLogger.error('Failed to enable insights', new Error(result.error || 'Unknown error'))
          console.error('❌ Failed to enable insights:', result.error)
        }
      } else {
        // Normal flow: open the insights modal
        setShowInsightsModal(true)
      }
    } catch (error) {
      console.error('Error saving hourly rate:', error)
      alert('Failed to save hourly rate. Please try again.')
    } finally {
      setSavingHourlyRate(false)
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

  // Load input configuration from saved agent_configuration
  // Note: Metadata is pre-loaded in fetchAllData, so we only need to fetch saved config values
  const loadInputConfiguration = useCallback(async () => {
    if (!agent?.id) return

    setInputConfigLoading(true)
    try {
      // Only fetch saved configuration values - metadata is already pre-loaded
      const configResponse = await fetch(`/api/v2/calibrate/load-configuration?agentId=${agent.id}`)

      // Load saved configuration values
      if (configResponse.ok) {
        const result = await configResponse.json()
        if (result.inputValues && Object.keys(result.inputValues).length > 0) {
          console.log('[AgentPage] Loaded saved input configuration:', result.inputValues)
          setInputConfigValues(result.inputValues)
          setInputConfigLoading(false)
          return
        }
      }

      // Fallback: Initialize from input_schema default values if no saved config
      if (agent.input_schema && Array.isArray(agent.input_schema)) {
        const defaultValues: Record<string, any> = {}
        for (const field of agent.input_schema as any[]) {
          const fieldName = field.name || field.key
          if (field.default_value !== undefined) {
            defaultValues[fieldName] = field.default_value
          }
        }
        if (Object.keys(defaultValues).length > 0) {
          console.log('[AgentPage] Initialized from input_schema defaults:', defaultValues)
          setInputConfigValues(defaultValues)
        }
      }
    } catch (error) {
      clientLogger.error('Error loading input configuration', error as Error)
    } finally {
      setInputConfigLoading(false)
    }
  }, [agent?.id, agent?.input_schema])

  // Load input configuration when the input config drawer opens
  useEffect(() => {
    if (inputConfigExpanded && agent?.id) {
      loadInputConfiguration()
    }
  }, [inputConfigExpanded, agent?.id, loadInputConfiguration])

  // Fetch metrics when insights modal opens
  useEffect(() => {
    if (showInsightsModal && agentId) {
      fetchMetrics(metricsRange)
    }
  }, [showInsightsModal, metricsRange, agentId])

  // Save input configuration
  const saveInputConfiguration = async () => {
    if (!agent?.id || !user?.id) return

    setInputConfigSaving(true)
    try {
      const response = await fetch('/api/v2/calibrate/save-configuration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.id,
          inputValues: inputConfigValues
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Failed to save configuration')
      }

      setInputConfigDirty(false)
      console.log('[AgentPage] Input configuration saved successfully')
    } catch (error) {
      clientLogger.error('Error saving input configuration', error as Error)
    } finally {
      setInputConfigSaving(false)
    }
  }

  // Handle input configuration field change
  const handleInputConfigChange = (name: string, value: any) => {
    setInputConfigValues(prev => ({ ...prev, [name]: value }))
    setInputConfigDirty(true)
  }

  // Get dynamic options for dropdown fields (for AgentInputFields component)
  // Uses same matching logic as CalibrationSetup for consistency
  const getInputConfigDynamicOptions = useCallback((fieldName: string): { plugin: string; action: string; parameter: string; depends_on?: string[]; paramToFieldMap?: Record<string, string>; queryComponents?: any } | null => {
    console.log('[AgentPage] getInputConfigDynamicOptions called for:', fieldName)
    console.log('[AgentPage] inputConfigMetadata available:', !!inputConfigMetadata, 'keys:', inputConfigMetadata ? Object.keys(inputConfigMetadata) : [])

    if (!inputConfigMetadata) {
      console.log('[AgentPage] No inputConfigMetadata, returning null')
      return null
    }

    // Try exact match first
    let matchingParams = inputConfigMetadata[fieldName]
    console.log('[AgentPage] Exact match for', fieldName, ':', matchingParams, '| All keys:', Object.keys(inputConfigMetadata))

    // If no exact match, try stripping common prefixes (including step ID prefixes)
    if (!matchingParams || matchingParams.length === 0) {
      const prefixes = [/^step\d+_/, 'source_', 'target_', 'input_', 'output_', 'from_', 'to_']
      for (const prefix of prefixes) {
        let baseFieldName: string
        if (prefix instanceof RegExp) {
          const match = fieldName.match(prefix)
          if (match) {
            baseFieldName = fieldName.substring(match[0].length)
          } else {
            continue
          }
        } else {
          if (fieldName.startsWith(prefix)) {
            baseFieldName = fieldName.substring(prefix.length)
          } else {
            continue
          }
        }
        matchingParams = inputConfigMetadata[baseFieldName]
        if (matchingParams && matchingParams.length > 0) {
          console.log('[AgentPage] Matched prefixed field:', fieldName, '->', baseFieldName)
          break
        }
      }
    }

    // If still no match, try fuzzy matching based on token overlap
    if (!matchingParams || matchingParams.length === 0) {
      const tokenizeKey = (key: string): string[] => {
        return key
          .replace(/([a-z])([A-Z])/g, '$1_$2')
          .toLowerCase()
          .split(/[_-]/)
          .filter((t) => t.length > 0)
      }

      const calculateOverlap = (key1: string, key2: string): number => {
        const tokens1 = new Set(tokenizeKey(key1))
        const tokens2 = new Set(tokenizeKey(key2))
        const commonTokens = [...tokens1].filter((t) => tokens2.has(t))
        const allTokens = new Set([...tokens1, ...tokens2])
        if (allTokens.size === 0) return 0
        return commonTokens.length / allTokens.size
      }

      let bestMatch: { key: string; score: number; params: any } | null = null
      for (const [metadataKey, params] of Object.entries(inputConfigMetadata)) {
        const score = calculateOverlap(fieldName, metadataKey)
        if (score >= 0.4 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { key: metadataKey, score, params }
        }
      }

      if (bestMatch && bestMatch.params.length > 0) {
        console.log('[AgentPage] Fuzzy matched:', fieldName, '->', bestMatch.key, 'score:', bestMatch.score.toFixed(2))
        matchingParams = bestMatch.params
      }
    }

    if (!matchingParams || matchingParams.length === 0) {
      console.log('[AgentPage] No match found for', fieldName)
      return null
    }

    const param = matchingParams[0]
    if (!param.plugin || !param.action || !param.parameter) {
      console.log('[AgentPage] Missing plugin/action/parameter in match:', param)
      return null
    }

    // Build depends_on and paramToFieldMap if available
    let depends_on: string[] | undefined
    let paramToFieldMap: Record<string, string> | undefined

    if (param.depends_on && Array.isArray(param.depends_on)) {
      depends_on = param.depends_on
      paramToFieldMap = {}

      // For each dependency, find the corresponding field in input_schema
      // Handle both array and object format input_schema
      let inputSchemaArray: any[] = []
      if (agent?.input_schema) {
        if (Array.isArray(agent.input_schema)) {
          inputSchemaArray = agent.input_schema as any[]
        } else if (typeof agent.input_schema === 'object') {
          // Convert object format to array format for lookup
          inputSchemaArray = Object.keys(agent.input_schema).map(key => ({
            name: key,
            type: typeof (agent.input_schema as any)[key] === 'number' ? 'number' : 'string'
          }))
        }
      }

      for (const depParam of param.depends_on) {
        const matchingField = inputSchemaArray.find(field => {
          const fName = field.name || field.key
          // Exact match
          if (fName === depParam) return true
          // Try without step prefix
          const baseFieldName = fName.replace(/^step\d+_/, '')
          if (baseFieldName === depParam) return true
          // Try fuzzy match
          const tokens1 = depParam.toLowerCase().split(/[_-]/)
          const tokens2 = baseFieldName.toLowerCase().split(/[_-]/)
          const commonTokens = tokens1.filter((t: string) => tokens2.includes(t))
          return commonTokens.length >= 1 && commonTokens.length / Math.max(tokens1.length, tokens2.length) >= 0.5
        })

        if (matchingField) {
          paramToFieldMap[depParam] = matchingField.name || matchingField.key
          console.log('[AgentPage] Mapped dependency:', depParam, '→', matchingField.name || matchingField.key)
        } else {
          paramToFieldMap[depParam] = depParam
        }
      }
    }

    const result = {
      plugin: param.plugin,
      action: param.action,
      parameter: param.parameter,
      depends_on,
      paramToFieldMap,
      queryComponents: param.queryComponents
    }
    console.log('[AgentPage] Returning dynamic options for', fieldName, ':', result)
    return result
  }, [inputConfigMetadata, agent?.input_schema])

  // Enrich input_schema with descriptions from metadata
  // Also clean up legacy technical descriptions like "Configuration value for {{config.X}}"
  const enrichedInputSchema = useMemo(() => {
    if (!agent?.input_schema) {
      return []
    }

    // Handle both array and object format input_schema
    let schemaArray: any[]
    if (Array.isArray(agent.input_schema)) {
      schemaArray = agent.input_schema as any[]
    } else if (typeof agent.input_schema === 'object') {
      // Convert object format to array format
      schemaArray = Object.keys(agent.input_schema).map(key => ({
        name: key,
        type: typeof (agent.input_schema as any)[key] === 'number' ? 'number' : 'string',
        default_value: (agent.input_schema as any)[key]
      }))
    } else {
      return []
    }

    return schemaArray.map(field => {
      let description = field.description

      // Check if current description is a legacy technical description that should be replaced
      const isLegacyTechnicalDesc = description && (
        description.includes('{{config.') ||
        description.includes('{{input.') ||
        description.includes('Configuration value for')
      )

      // Try to get better description from inputConfigMetadata
      if (inputConfigMetadata) {
        const metadata = inputConfigMetadata[field.name]
        if (metadata && metadata.length > 0 && metadata[0].description) {
          description = metadata[0].description
        }
      }

      // If we still have a legacy technical description, clean it up or remove it
      if (isLegacyTechnicalDesc && description === field.description) {
        // Extract step context if present (e.g., "For step: Send email" -> keep meaningful part)
        const stepMatch = description.match(/For step:\s*(.+?)(?:\s*Configuration value for|\s*$)/i)
        if (stepMatch && stepMatch[1] && !stepMatch[1].includes('{{')) {
          description = `For step: ${stepMatch[1].trim()}`
        } else {
          // Remove the technical description entirely
          description = undefined
        }
      }

      return description !== field.description ? { ...field, description } : field
    })
  }, [agent?.input_schema, inputConfigMetadata])

  const handleToggleStatus = async () => {
    if (!agent || !user) return

    // Toggle logic:
    // - active -> inactive
    // - draft -> active (activate draft agent)
    // - inactive -> active
    const newStatus = agent.status === 'active' ? 'inactive' : 'active'
    const pageLogger = clientLogger.child({ agentId: agent.id })
    pageLogger.info({ currentStatus: agent.status, newStatus }, 'Toggling agent status')

    // Optimistic update
    const previousAgent = { ...agent }
    setAgent({ ...agent, status: newStatus })

    try {
      const result = await agentApi.updateStatus(agent.id, user.id, newStatus)

      if (result.success && result.data) {
        setAgent(result.data as Agent)
        pageLogger.info({ newStatus: result.data.status }, 'Agent status toggled')
      } else {
        // Revert on failure
        setAgent(previousAgent)
        pageLogger.error({ error: result.error }, 'Failed to toggle status')
      }
    } catch (error) {
      // Revert on error
      setAgent(previousAgent)
      pageLogger.error({ err: error }, 'Error toggling status')
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

    // If enabling insights, show hourly rate dialog first
    if (newInsightsEnabled) {
      console.log('[handleToggleInsights] Enabling insights - showing hourly rate dialog')
      // Store the pending toggle so we can complete it after dialog
      setPendingInsightsToggle(true)

      // Fetch current hourly rate and show dialog
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('hourly_rate_usd')
          .eq('id', user.id)
          .single()

        console.log('[handleToggleInsights] Profile response:', { data, error })
        const rate = data?.hourly_rate_usd ?? 50
        setUserHourlyRate(rate)
        setHourlyRateInput(rate.toString())
        setShowHourlyRateDialog(true)
      } catch (error) {
        console.error('[handleToggleInsights] Error fetching hourly rate:', error)
        setHourlyRateInput('50')
        setShowHourlyRateDialog(true)
      }
      return // Don't toggle yet - will be done after dialog
    }

    // If disabling, just toggle directly
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

    setIsEditingDetails(true)
  }

  const handleEditScheduleClick = () => {
    if (!agent) return

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

    setIsEditingSchedule(true)
  }

  const handleCancelEditDetails = () => {
    setIsEditingDetails(false)
    setEditedName('')
    setEditedDescription('')
  }

  const handleCancelEditSchedule = () => {
    setIsEditingSchedule(false)
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

  const handleSaveEditDetails = async () => {
    if (!agent || !user) return

    setIsSaving(true)
    try {
      const result = await agentApi.update(agent.id, user.id, {
        agent_name: editedName,
        description: editedDescription
      })

      if (!result.success) {
        clientLogger.error('Error updating agent details', new Error(result.error))
        return
      }

      if (result.data) {
        setAgent(result.data as Agent)
        clientLogger.info('Agent details saved', { agentId: agent.id })
      } else {
        setAgent({
          ...agent,
          agent_name: editedName,
          description: editedDescription
        })
      }

      setIsEditingDetails(false)
    } catch (error) {
      clientLogger.error('Error saving agent details', error as Error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveEditSchedule = async () => {
    if (!agent || !user) return

    setIsSaving(true)
    try {
      const cronExpression = buildCronExpression()
      const mode = scheduleMode === 'manual' ? 'on_demand' : 'scheduled'

      const result = await agentApi.update(agent.id, user.id, {
        schedule_cron: cronExpression,
        mode: mode,
        timezone: editedTimezone || null
      })

      if (!result.success) {
        clientLogger.error('Error updating agent schedule', new Error(result.error))
        return
      }

      if (result.data) {
        setAgent(result.data as Agent)
        clientLogger.info('Agent schedule saved', { agentId: agent.id })
      } else {
        setAgent({
          ...agent,
          schedule_cron: cronExpression,
          mode: mode,
          timezone: editedTimezone || null
        })
      }

      setIsEditingSchedule(false)
    } catch (error) {
      clientLogger.error('Error saving agent schedule', error as Error)
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

  // Memoized filtered executions based on time period
  const filteredExecutions = useMemo(() => {
    if (timePeriod === 'all') return allExecutions

    const now = new Date()
    let cutoffDate: Date

    switch (timePeriod) {
      case '24h':
        cutoffDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
        break
      case '7d':
        cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case '30d':
        cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      default:
        return allExecutions
    }

    return allExecutions.filter(e => {
      const execDate = new Date(e.created_at)
      return execDate >= cutoffDate
    })
  }, [allExecutions, timePeriod])

  // Memoized health calculation (now uses filtered executions)
  const health = useMemo(() => {
    if (filteredExecutions.length === 0) return { score: 0, maxScore: 0, percentage: 0, recentScore: 0, recentMaxScore: 0, failedCount: 0 }

    const totalSuccessCount = filteredExecutions.filter(e =>
      e.status === 'completed' || e.status === 'success'
    ).length
    const totalPercentage = (totalSuccessCount / filteredExecutions.length) * 100

    const failedCount = filteredExecutions.filter(e =>
      e.status === 'failed' || e.status === 'error'
    ).length

    const recentExecutions = filteredExecutions.slice(0, 5)
    const recentSuccessCount = recentExecutions.filter(e =>
      e.status === 'completed' || e.status === 'success'
    ).length

    return {
      score: totalSuccessCount,
      maxScore: filteredExecutions.length,
      percentage: totalPercentage,
      recentScore: recentSuccessCount,
      recentMaxScore: recentExecutions.length,
      failedCount
    }
  }, [filteredExecutions])

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

  // Separate business and technical insights (for logging only - dialog has its own filtering)
  const allBusinessInsights = insights.filter((i: any) => i.category === 'business_insight')
  const allTechnicalInsights = insights.filter((i: any) =>
    i.category === 'technical_insight' || i.category === 'data_insight'
  )

  console.log('[AgentPage] Total insights:', insights.length)
  console.log('[AgentPage] Business insights:', allBusinessInsights.length)
  console.log('[AgentPage] Technical insights:', allTechnicalInsights.length)

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

      {/* NEW SINGLE-COLUMN LAYOUT */}
      <div className="max-w-[1000px] mx-auto p-4">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-3"
        >
          <V2Logo />
        </motion.div>

        {/* Top Bar: Back Button + Controls */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="flex items-center justify-between mb-4"
        >
          <button
            onClick={() => router.push('/v2/agent-list')}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-all duration-200 text-sm font-medium shadow-[var(--v2-shadow-card)]"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Agents
          </button>
          <V2Controls
            showHelpLink={true}
            onHelpClick={() => setHelpOpen(true)}
          />
        </motion.div>

        {/* NEW: Redesigned Agent Header */}
        <AgentHeader
          agent={agent}
          stats={{
            runCount: filteredExecutions.length, // Use filtered count based on selected time period
            successRate: health.percentage
          }}
          isExecuting={executing}
          advancedMode={advancedMode}
          timePeriodLabel={
            timePeriod === '24h' ? 'Last 24 Hours' :
            timePeriod === '7d' ? 'Last 7 Days' :
            timePeriod === '30d' ? 'Last 30 Days' :
            'All Time'
          }
          onRun={handleRunNow}
          onSettingsClick={() => {
            setInputConfigExpanded(false)
            setShowSettingsDrawer(true)
          }}
          onAnalyticsClick={handleOpenInsights}
          onAdvancedModeToggle={handleAdvancedModeToggle}
        />

        {/* Performance Trends + Latest Run - Side by Side (Advanced Mode Only) */}
        {advancedMode && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mt-4">
            <div className="lg:col-span-3">
              <PerformanceTrends
                executions={filteredExecutions}
                hourlyRate={userHourlyRate ?? undefined}
                timePeriod={timePeriod}
                onTimePeriodChange={setTimePeriod}
                manualTimePerItemSeconds={agent?.manual_time_per_item_seconds}
              />
            </div>
            <div className="lg:col-span-2">
              <LatestRunCard
                execution={selectedExecution}
                isRunning={executing}
                advancedMode={advancedMode}
                hourlyRate={userHourlyRate ?? undefined}
              />
            </div>
          </div>
        )}

        {/* Insight Preview */}
        {insights.length > 0 && (
          <InsightPreview
            insights={normalizeInsights(insights)}
            onViewAll={handleOpenInsights}
            className="mt-4"
          />
        )}

        {/* Run History Table */}
        <RunHistoryTable
          executions={filteredExecutions}
          onSelectExecution={handleSelectExecutionForPanel}
          selectedExecutionId={selectedExecution?.id}
          className="mt-4"
          hourlyRate={userHourlyRate ?? undefined}
        />
      </div>

      {/* Execution Detail Slide-out Panel */}
      <ExecutionDetailPanel
        execution={selectedExecution}
        isOpen={showDetailPanel}
        onClose={() => setShowDetailPanel(false)}
        advancedMode={advancedMode}
        executionDetails={executionDetails}
        hourlyRate={userHourlyRate ?? undefined}
        insights={insights}
        manualTimePerItemSeconds={agent?.manual_time_per_item_seconds}
      />

      {/* Settings Drawer Overlay */}
      {showSettingsDrawer && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={() => {
            setInputConfigExpanded(false)
            setShowSettingsDrawer(false)
          }}
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
            onClick={() => {
              setInputConfigExpanded(false)
              setShowSettingsDrawer(false)
            }}
            className="text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-8">
          {/* AIS Complexity - Only visible in Advanced Mode */}
          {advancedMode && (
            <div className="rounded-xl p-5 border-l-4 border-indigo-500 dark:border-indigo-400 bg-[var(--v2-surface)]">
              <AgentIntensityCardV2
                agentId={agentId}
                latestExecutionTime={executions[0]?.started_at ? new Date(executions[0].started_at).getTime() : undefined}
              />
            </div>
          )}

          {/* Agent Details Section */}
          <div>
            <h3 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-4">
              Agent Details
            </h3>
            {!isEditingDetails ? (
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
                      className="p-1.5 hover:bg-[var(--v2-border)] transition-colors"
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
                <button
                  onClick={handleEditClick}
                  className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--v2-primary)] hover:bg-[var(--v2-border)] rounded-lg transition-colors border border-[var(--v2-border)]"
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
                    className="w-full text-sm text-[var(--v2-text-primary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)]"
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
                    className="w-full text-sm text-[var(--v2-text-primary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] resize-none"
                    placeholder="Agent description"
                    rows={3}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveEditDetails}
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
                    onClick={handleCancelEditDetails}
                    disabled={isSaving}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-border)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-[var(--v2-border)]"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Input Configuration Section - Opens nested drawer */}
          {agent?.input_schema && Array.isArray(agent.input_schema) && agent.input_schema.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-4">
                Input Configuration
              </h3>
              <button
                onClick={() => setInputConfigExpanded(true)}
                className="w-full flex items-center justify-between p-4 bg-[var(--v2-surface-hover)] rounded-lg border border-[var(--v2-border)] hover:border-[var(--v2-primary)] transition-colors group"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[var(--v2-primary)]/10 flex items-center justify-center">
                    <Settings className="w-4 h-4 text-[var(--v2-primary)]" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium text-[var(--v2-text-primary)]">
                      {(agent.input_schema as any[]).length} Input {(agent.input_schema as any[]).length === 1 ? 'Field' : 'Fields'}
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)]">
                      {inputConfigDirty ? 'Unsaved changes' : 'Configure values for next run'}
                    </p>
                  </div>
                </div>
                <ChevronLeft className="w-4 h-4 text-[var(--v2-text-muted)] group-hover:text-[var(--v2-primary)] transition-colors" />
              </button>
            </div>
          )}

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
                    {agent.status === 'active' ? 'Active' : agent.status === 'draft' ? 'Not Active (Draft)' : 'Inactive'}
                  </h4>
                  <p className="text-xs text-[var(--v2-text-muted)]">
                    {agent.status === 'active'
                      ? 'Agent is running and will execute on schedule'
                      : agent.status === 'draft'
                      ? 'Agent is in draft mode. Activate to start running.'
                      : 'Agent is inactive and will not execute'}
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
                    className={`w-4 h-4 bg-white dark:bg-white rounded-full absolute top-1 transition-transform ${
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
              {!isEditingSchedule ? (
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
                      onClick={handleEditScheduleClick}
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
                            : 'border-[var(--v2-border)] hover:border-[var(--v2-primary)] hover:bg-[var(--v2-border)]'
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
                            : 'border-[var(--v2-border)] hover:border-[var(--v2-primary)] hover:bg-[var(--v2-border)]'
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
                      onClick={handleSaveEditSchedule}
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
                      onClick={handleCancelEditSchedule}
                      disabled={isSaving}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:bg-[var(--v2-border)] transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
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
                    className={`w-4 h-4 bg-white dark:bg-white rounded-full absolute top-1 transition-transform ${
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
              {/* Show "Run Calibration" only until the agent has passed calibration.
                  Visibility is tied to agent state (is_calibrated) rather than a
                  global flag — see workplan R7. */}
              {!agent.is_calibrated && (
                <button
                  onClick={handleSandboxClick}
                  className="w-full flex items-center gap-3 p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg hover:bg-[var(--v2-border)] transition-all"
                >
                  <Wrench className="w-5 h-5 text-[var(--v2-text-secondary)]" />
                  <div className="text-left flex-1">
                    <h5 className="text-sm font-semibold text-[var(--v2-text-primary)]">Run Calibration</h5>
                    <p className="text-xs text-[var(--v2-text-muted)]">Validate &amp; repair this agent before production</p>
                  </div>
                </button>
              )}

              <button
                onClick={handleDuplicateAgent}
                disabled={actionLoading === 'duplicate'}
                className="w-full flex items-center gap-3 p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg hover:bg-[var(--v2-border)] transition-all disabled:opacity-50"
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
                className="w-full flex items-center gap-3 p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg hover:bg-[var(--v2-border)] transition-all disabled:opacity-50"
              >
                {actionLoading === 'share' ? <Loader2 className="w-5 h-5 animate-spin text-[var(--v2-text-secondary)]" /> : <Share2 className="w-5 h-5 text-[var(--v2-text-secondary)]" />}
                <div className="text-left flex-1">
                  <h5 className="text-sm font-semibold text-[var(--v2-text-primary)]">Share to Templates</h5>
                  <p className="text-xs text-[var(--v2-text-muted)]">Share with community and earn credits</p>
                </div>
              </button>

              <button
                onClick={handleExportConfiguration}
                className="w-full flex items-center gap-3 p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg hover:bg-[var(--v2-border)] transition-all"
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
              className="w-full flex items-center gap-3 p-4 bg-[var(--v2-surface)] border border-red-200 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/40 transition-all"
            >
              <Trash2 className="w-5 h-5 text-red-600 dark:text-red-300" />
              <div className="text-left flex-1">
                <h5 className="text-sm font-semibold text-red-600 dark:text-red-300">Delete Agent</h5>
                <p className="text-xs text-red-600 dark:text-red-400">Permanently remove this agent</p>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Input Configuration Drawer - Side panel that slides in from the left of settings drawer */}
      {/* Only render when expanded to prevent stuck state after refresh */}
      {showSettingsDrawer && inputConfigExpanded && (
        <div
          className="fixed top-0 right-[500px] h-screen w-[500px] bg-[var(--v2-surface)] shadow-2xl z-[55] overflow-visible flex flex-col border-r border-[var(--v2-border)]"
        >
          {/* Header */}
          <div className="sticky top-0 bg-[var(--v2-surface)] border-b border-[var(--v2-border)] px-5 py-4 flex items-center justify-between z-10">
            <div>
              <h2 className="text-base font-semibold text-[var(--v2-text-primary)]">Input Configuration</h2>
              <p className="text-xs text-[var(--v2-text-muted)]">
                {agent?.input_schema && Array.isArray(agent.input_schema)
                  ? `${agent.input_schema.length} ${agent.input_schema.length === 1 ? 'field' : 'fields'}`
                  : 'Configure input values'
                }
              </p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setInputConfigExpanded(false)
              }}
              className="p-1.5 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-border)] rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {inputConfigLoading || !inputConfigMetadata ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--v2-primary)]" />
                <span className="ml-2 text-sm text-[var(--v2-text-muted)]">Loading configuration...</span>
              </div>
            ) : enrichedInputSchema.length > 0 ? (
              <AgentInputFields
                schema={enrichedInputSchema}
                values={inputConfigValues}
                onChange={handleInputConfigChange}
                getDynamicOptions={getInputConfigDynamicOptions}
                wrapperClassName="space-y-4"
              />
            ) : (
              <div className="text-center py-8 text-sm text-[var(--v2-text-muted)]">
                No input parameters configured for this agent
              </div>
            )}
          </div>

          {/* Footer with Save Button */}
          <div className="sticky bottom-0 bg-[var(--v2-surface)] border-t border-[var(--v2-border)] px-5 py-4">
            <div className="flex items-center gap-3">
              <button
                onClick={saveInputConfiguration}
                disabled={inputConfigSaving || !inputConfigDirty}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {inputConfigSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    {inputConfigDirty ? 'Save Changes' : 'Saved'}
                  </>
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setInputConfigExpanded(false)
                }}
                className="px-4 py-2.5 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-border)] transition-colors border border-[var(--v2-border)]"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                Close
              </button>
            </div>
            <p className="text-xs text-[var(--v2-text-muted)] mt-3 text-center">
              These values will be used when running the agent
            </p>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--v2-surface)] rounded-2xl shadow-2xl max-w-md w-full p-6 border border-[var(--v2-border)]">
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
                className="flex-1 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:bg-[var(--v2-border)] transition-colors font-medium text-sm"
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
                className="flex-1 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:bg-[var(--v2-border)] transition-colors font-medium text-sm"
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

      {/* Hourly Rate Dialog */}
      {showHourlyRateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">Confirm Your Hourly Rate</h2>
                  <p className="text-sm text-[var(--v2-text-secondary)]">
                    For accurate cost savings calculations
                  </p>
                </div>
              </div>

              <p className="text-sm text-[var(--v2-text-secondary)] mb-4">
                Your hourly rate is used to calculate the business value of your automations.
                Confirm or update it below to see accurate cost savings in your insights.
              </p>

              <div className="mb-6">
                <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                  Your hourly rate (USD)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]">$</span>
                  <input
                    type="number"
                    value={hourlyRateInput}
                    onChange={(e) => setHourlyRateInput(e.target.value)}
                    placeholder="50"
                    min="1"
                    step="1"
                    className="w-full pl-8 pr-4 py-2.5 text-lg font-semibold bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-[var(--v2-text-primary)]"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--v2-text-muted)]">/hour</span>
                </div>
                <p className="text-xs text-[var(--v2-text-muted)] mt-2">
                  This is used to calculate cost savings (e.g., 2 hours saved × $50/hr = $100 value)
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    setShowHourlyRateDialog(false)

                    // If we're enabling insights via the toggle, complete that action
                    if (pendingInsightsToggle && agent && user) {
                      console.log('[Use Current] Completing pending insights toggle')
                      setPendingInsightsToggle(false)

                      // Enable insights on the agent
                      setAgent({ ...agent, insights_enabled: true })

                      const result = await agentApi.update(agent.id, user.id, {
                        insights_enabled: true
                      })

                      if (result.success && result.data) {
                        setAgent(result.data as Agent)
                        console.log('✅ Insights enabled successfully')
                      } else {
                        setAgent({ ...agent, insights_enabled: false })
                        console.error('❌ Failed to enable insights:', result.error)
                      }
                    } else {
                      // Normal flow: open the insights modal
                      setShowInsightsModal(true)
                    }
                  }}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-colors"
                >
                  Use Current (${hourlyRateInput}/hr)
                </button>
                <button
                  onClick={saveHourlyRateAndContinue}
                  disabled={savingHourlyRate}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-green-600 rounded-lg hover:from-emerald-600 hover:to-green-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {savingHourlyRate ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Update & Continue'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Insights Modal */}
      {showInsightsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-[var(--v2-border)]">
              <div>
                <h2 className="text-xl font-semibold text-[var(--v2-text-primary)]">Agent Analytics & Insights</h2>
                <p className="text-sm text-[var(--v2-text-secondary)] mt-1">
                  Performance metrics, trends, and recommendations
                </p>
              </div>
              <button
                onClick={() => setShowInsightsModal(false)}
                className="text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors p-2 rounded-lg hover:bg-[var(--v2-border)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-[var(--v2-border)] px-6">
              <button
                onClick={() => setInsightsTab('business')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  insightsTab === 'business'
                    ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                    : 'border-transparent text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                }`}
              >
                <span className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Business Insights
                </span>
              </button>
              <button
                onClick={() => setInsightsTab('technical')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  insightsTab === 'technical'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Wrench className="w-4 h-4" />
                  Technical Issues
                </span>
              </button>
              <button
                onClick={() => setInsightsTab('data')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  insightsTab === 'data'
                    ? 'border-purple-500 text-purple-600 dark:text-purple-400'
                    : 'border-transparent text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Database className="w-4 h-4" />
                  Data Issues
                </span>
              </button>
            </div>

            {/* Content */}
            <div className="overflow-y-auto flex-1 p-6">
              {insightsTab === 'business' ? (
                (() => {
                  // Show only the latest business insight (API returns ordered by created_at DESC)
                  const latestBusinessInsight = insights.find((i: any) => i.category === 'business_insight')
                  const businessInsights = latestBusinessInsight ? [latestBusinessInsight] : []
                  return (
                    <div className="space-y-6">
                      {/* Business Metrics Charts */}
                      {businessInsights.length > 0 && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                          {/* Volume Trend Chart */}
                          <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl p-4">
                            <h3 className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mb-3 flex items-center gap-2">
                              <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              Volume Trend (Last 7 Days)
                            </h3>
                            <div className="h-48">
                              {loadingMetrics ? (
                                <div className="flex items-center justify-center h-full">
                                  <div className="text-sm text-[var(--v2-text-muted)]">Loading metrics...</div>
                                </div>
                              ) : metricsData?.chartData ? (
                                <ResponsiveContainer width="100%" height="100%">
                                  <AreaChart data={metricsData.chartData.map((d: any) => {
                                    // Parse YYYY-MM-DD and format without timezone conversion
                                    const [year, month, day] = d.date.split('-')
                                    const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                    return {
                                      date: dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                                      items: d.items
                                    }
                                  })}>
                                    <defs>
                                      <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.6}/>
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.1}/>
                                      </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--v2-border)" />
                                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--v2-text-muted)' }} stroke="var(--v2-border)" />
                                    <YAxis tick={{ fontSize: 12, fill: 'var(--v2-text-muted)' }} stroke="var(--v2-border)" />
                                    <Tooltip
                                      contentStyle={{
                                        backgroundColor: 'var(--v2-surface)',
                                        border: '1px solid var(--v2-border)',
                                        borderRadius: '8px',
                                        fontSize: '12px',
                                        color: 'var(--v2-text-primary)'
                                      }}
                                      labelStyle={{
                                        color: 'var(--v2-text-primary)'
                                      }}
                                      labelFormatter={(value) => `Date: ${value}`}
                                      formatter={(value: any) => [`${value} items`, 'Volume']}
                                    />
                                    <Area
                                      type="monotone"
                                      dataKey="items"
                                      stroke="#10b981"
                                      fillOpacity={1}
                                      fill="url(#volumeGradient)"
                                      strokeWidth={2}
                                    />
                                  </AreaChart>
                                </ResponsiveContainer>
                              ) : (
                                <div className="flex items-center justify-center h-full">
                                  <div className="text-sm text-[var(--v2-text-muted)]">No metrics data available</div>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* ROI Metrics */}
                          <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl p-4">
                            <h3 className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mb-3 flex items-center gap-2">
                              <Gauge className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              ROI Metrics
                            </h3>
                            <div className="space-y-3">
                              {businessInsights[0]?.time_saved_hours_per_week && (
                                <div className="bg-[var(--v2-bg)] rounded-lg p-3">
                                  <div className="text-xs text-[var(--v2-success)] font-medium mb-1">Time Saved</div>
                                  <div className="text-2xl font-bold text-[var(--v2-success)]">
                                    {businessInsights[0].time_saved_hours_per_week.toFixed(1)} hrs/week
                                  </div>
                                </div>
                              )}
                              {businessInsights[0]?.cost_saved_usd_per_week && (
                                <div className="bg-[var(--v2-bg)] rounded-lg p-3">
                                  <div className="text-xs text-[var(--v2-success)] font-medium mb-1">Cost Saved</div>
                                  <div className="text-2xl font-bold text-[var(--v2-success)]">
                                    ${businessInsights[0].cost_saved_usd_per_week.toFixed(2)}/week
                                  </div>
                                </div>
                              )}
                              {businessInsights[0]?.automation_potential_percentage && (
                                <div className="bg-[var(--v2-bg)] rounded-lg p-3">
                                  <div className="text-xs text-[var(--v2-success)] font-medium mb-1">Automation Potential</div>
                                  <div className="text-2xl font-bold text-[var(--v2-success)]">
                                    {businessInsights[0].automation_potential_percentage.toFixed(0)}%
                                  </div>
                                </div>
                              )}
                              {/* Pilot Credits (LLM usage for insight generation) */}
                              {(() => {
                                const patternData = (businessInsights[0]?.pattern_data || {}) as any
                                const tokenUsage = patternData.llm_token_usage
                                if (tokenUsage?.total_tokens) {
                                  const pilotCredits = Math.ceil(tokenUsage.total_tokens / tokensPerPilotCredit)
                                  return (
                                    <div className="bg-[var(--v2-bg)] rounded-lg p-3">
                                      <div className="text-xs text-[var(--v2-success)] font-medium mb-1 flex items-center gap-1.5">
                                        <Cpu className="w-3 h-3" />
                                        Pilot Credits
                                      </div>
                                      <div className="text-lg font-bold text-[var(--v2-success)]">
                                        {pilotCredits.toLocaleString()}
                                      </div>
                                      <div className="text-xs text-[var(--v2-text-muted)] mt-1">
                                        {tokenUsage.total_tokens.toLocaleString()} tokens
                                        {tokenUsage.latency_ms && ` • ${(tokenUsage.latency_ms / 1000).toFixed(1)}s`}
                                      </div>
                                    </div>
                                  )
                                }
                                return null
                              })()}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Business Insights List */}
                      {businessInsights.length > 0 ? (
                        <div>
                          <InsightsList
                            insights={businessInsights}
                            onDismiss={async (id) => {
                              try {
                                await fetch(`/api/v6/insights/${id}`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ status: 'dismissed' })
                                })
                                const result = await fetch(`/api/v6/insights?agentId=${agentId}&status=new,viewed`)
                                const data = await result.json()
                                if (data.success) setInsights(data.data)
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
                                const result = await fetch(`/api/v6/insights?agentId=${agentId}&status=new,viewed`)
                                const data = await result.json()
                                if (data.success) setInsights(data.data)
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
                                  body: JSON.stringify({ status: 'snoozed', snoozed_until: snoozedUntil.toISOString() })
                                })
                                const result = await fetch(`/api/v6/insights?agentId=${agentId}&status=new,viewed`)
                                const data = await result.json()
                                if (data.success) setInsights(data.data)
                              } catch (error) {
                                clientLogger.error('Error snoozing insight', error as Error)
                              }
                            }}
                            showFilters={false}
                            tokensPerPilotCredit={tokensPerPilotCredit}
                          />
                        </div>
                      ) : (
                        <div className="text-center py-12">
                          <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <TrendingUp className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                          </div>
                          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)] mb-2">No Business Insights Yet</h3>
                          <p className="text-sm text-[var(--v2-text-secondary)]">
                            Run your agent a few more times to generate business intelligence and ROI metrics.
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })()
              ) : insightsTab === 'technical' ? (
                (() => {
                  // Deduplicate technical insights by insight_type (keep only the most recent per type)
                  const allTechnicalInsights = insights.filter((i: any) =>
                    i.category === 'technical_insight'
                  )
                  const seenTypes = new Set<string>()
                  const technicalInsights = allTechnicalInsights.filter((i: any) => {
                    if (seenTypes.has(i.insight_type)) return false
                    seenTypes.add(i.insight_type)
                    return true
                  })
                  return (
                    <div className="space-y-6">
                      {/* Technical Performance Charts */}
                      {technicalInsights.length > 0 && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                          {/* Performance Trend */}
                          <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl p-4">
                            <h3 className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-3 flex items-center gap-2">
                              <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                              Performance Trend
                            </h3>
                            <div className="h-48">
                              {loadingMetrics ? (
                                <div className="flex items-center justify-center h-full">
                                  <div className="text-sm text-[var(--v2-text-muted)]">Loading metrics...</div>
                                </div>
                              ) : metricsData?.chartData ? (
                                <ResponsiveContainer width="100%" height="100%">
                                  <LineChart data={metricsData.chartData.map((d: any) => {
                                    // Parse YYYY-MM-DD and format without timezone conversion
                                    const [year, month, day] = d.date.split('-')
                                    const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                    return {
                                      date: dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                                      duration: d.avgDuration
                                    }
                                  })}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--v2-border)" />
                                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--v2-text-muted)' }} stroke="var(--v2-border)" />
                                    <YAxis tick={{ fontSize: 12, fill: 'var(--v2-text-muted)' }} stroke="var(--v2-border)" />
                                    <Tooltip
                                      contentStyle={{
                                        backgroundColor: 'var(--v2-surface)',
                                        border: '1px solid var(--v2-border)',
                                        borderRadius: '8px',
                                        fontSize: '12px',
                                        color: 'var(--v2-text-primary)'
                                      }}
                                      labelStyle={{
                                        color: 'var(--v2-text-primary)'
                                      }}
                                      labelFormatter={(value) => `Date: ${value}`}
                                      formatter={(value: any) => [`${value}ms`, 'Duration']}
                                    />
                                    <Line
                                      type="monotone"
                                      dataKey="duration"
                                      stroke="#2563eb"
                                      strokeWidth={2}
                                      dot={{ fill: '#2563eb', r: 4 }}
                                    />
                                  </LineChart>
                                </ResponsiveContainer>
                              ) : (
                                <div className="flex items-center justify-center h-full">
                                  <div className="text-sm text-[var(--v2-text-muted)]">No metrics data available</div>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Success/Failure Stats */}
                          <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl p-4">
                            <h3 className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-3 flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                              Reliability Metrics
                            </h3>
                            <div className="space-y-3">
                              <div className="bg-[var(--v2-bg)] rounded-lg p-3">
                                <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mb-1">Success Rate</div>
                                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                                  {executions.length > 0
                                    ? ((executions.filter(e => e.status === 'success').length / executions.length) * 100).toFixed(1)
                                    : '0'
                                  }%
                                </div>
                              </div>
                              <div className="bg-[var(--v2-bg)] rounded-lg p-3">
                                <div className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-1">Total Executions</div>
                                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                                  {executions.length}
                                </div>
                              </div>
                              <div className="bg-[var(--v2-bg)] rounded-lg p-3">
                                <div className="text-xs text-red-600 dark:text-red-400 font-medium mb-1">Failures</div>
                                <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                                  {executions.filter(e => e.status === 'failed' || e.status === 'error').length}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Technical Insights List */}
                      {technicalInsights.length > 0 ? (
                        <div>
                          <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3">Technical Recommendations</h3>
                          <InsightsList
                            insights={technicalInsights}
                            onDismiss={async (id) => {
                              try {
                                await fetch(`/api/v6/insights/${id}`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ status: 'dismissed' })
                                })
                                const result = await fetch(`/api/v6/insights?agentId=${agentId}&status=new,viewed`)
                                const data = await result.json()
                                if (data.success) setInsights(data.data)
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
                                const result = await fetch(`/api/v6/insights?agentId=${agentId}&status=new,viewed`)
                                const data = await result.json()
                                if (data.success) setInsights(data.data)
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
                                  body: JSON.stringify({ status: 'snoozed', snoozed_until: snoozedUntil.toISOString() })
                                })
                                const result = await fetch(`/api/v6/insights?agentId=${agentId}&status=new,viewed`)
                                const data = await result.json()
                                if (data.success) setInsights(data.data)
                              } catch (error) {
                                clientLogger.error('Error snoozing insight', error as Error)
                              }
                            }}
                            showFilters={false}
                            tokensPerPilotCredit={tokensPerPilotCredit}
                          />
                        </div>
                      ) : (
                        <div className="text-center py-12">
                          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                          </div>
                          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)] mb-2">No Technical Issues</h3>
                          <p className="text-sm text-[var(--v2-text-secondary)]">
                            Your workflow is running smoothly with no technical issues detected.
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })()
              ) : (
                (() => {
                  // Data Insights tab - show only data_insight category
                  const allDataInsights = insights.filter((i: any) =>
                    i.category === 'data_insight'
                  )
                  const seenTypes = new Set<string>()
                  const dataInsights = allDataInsights.filter((i: any) => {
                    if (seenTypes.has(i.insight_type)) return false
                    seenTypes.add(i.insight_type)
                    return true
                  })
                  return (
                    <div className="space-y-6">
                      {/* Data Performance Charts - Always show */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                          {/* Data Issues Trend */}
                          <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl p-4">
                            <h3 className="text-sm font-semibold text-purple-600 dark:text-purple-400 mb-3 flex items-center gap-2">
                              <Activity className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                              Data Issues Trend
                            </h3>
                            <div className="h-48">
                              {loadingMetrics ? (
                                <div className="flex items-center justify-center h-full">
                                  <div className="text-sm text-[var(--v2-text-muted)]">Loading metrics...</div>
                                </div>
                              ) : metricsData?.chartData ? (
                                <ResponsiveContainer width="100%" height="100%">
                                  <LineChart data={metricsData.chartData.map((d: any) => {
                                    // Parse YYYY-MM-DD and format without timezone conversion
                                    const [year, month, day] = d.date.split('-')
                                    const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                    return {
                                      date: dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                                      issues: 0  // Always 0 for data issues
                                    }
                                  })}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--v2-border)" />
                                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--v2-text-muted)' }} stroke="var(--v2-border)" />
                                    <YAxis tick={{ fontSize: 12, fill: 'var(--v2-text-muted)' }} stroke="var(--v2-border)" />
                                    <Tooltip
                                      contentStyle={{
                                        backgroundColor: 'var(--v2-surface)',
                                        border: '1px solid var(--v2-border)',
                                        borderRadius: '8px',
                                        fontSize: '12px',
                                        color: 'var(--v2-text-primary)'
                                      }}
                                      labelStyle={{
                                        color: 'var(--v2-text-primary)'
                                      }}
                                      labelFormatter={(value) => `Date: ${value}`}
                                      formatter={(value: any) => [`${value}`, 'Data Issues']}
                                    />
                                    <Line
                                      type="monotone"
                                      dataKey="issues"
                                      stroke="#9333ea"
                                      strokeWidth={2}
                                      dot={{ fill: '#9333ea', r: 4 }}
                                    />
                                  </LineChart>
                                </ResponsiveContainer>
                              ) : (
                                <div className="flex items-center justify-center h-full">
                                  <div className="text-sm text-[var(--v2-text-muted)]">No metrics data available</div>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Data Quality Metrics */}
                          <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl p-4">
                            <h3 className="text-sm font-semibold text-purple-600 dark:text-purple-400 mb-3 flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                              Data Quality Metrics
                            </h3>
                            <div className="space-y-3">
                              <div className="bg-[var(--v2-bg)] rounded-lg p-3">
                                <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mb-1">Data Quality Score</div>
                                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                                  100%
                                </div>
                              </div>
                              <div className="bg-[var(--v2-bg)] rounded-lg p-3">
                                <div className="text-xs text-purple-600 dark:text-purple-400 font-medium mb-1">Total Issues</div>
                                <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                                  {dataInsights.length}
                                </div>
                              </div>
                              <div className="bg-[var(--v2-bg)] rounded-lg p-3">
                                <div className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-1">Resolved Issues</div>
                                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                                  0
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                      {/* Data Insights List */}
                      {dataInsights.length > 0 ? (
                        <div>
                          <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3">Data Quality Issues</h3>
                          <InsightsList
                            insights={dataInsights}
                            onDismiss={async (id) => {
                              try {
                                await fetch(`/api/v6/insights/${id}`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ status: 'dismissed' })
                                })
                                const result = await fetch(`/api/v6/insights?agentId=${agentId}&status=new,viewed`)
                                const data = await result.json()
                                if (data.success) setInsights(data.data)
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
                                const result = await fetch(`/api/v6/insights?agentId=${agentId}&status=new,viewed`)
                                const data = await result.json()
                                if (data.success) setInsights(data.data)
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
                                  body: JSON.stringify({ status: 'snoozed', snoozed_until: snoozedUntil.toISOString() })
                                })
                                const result = await fetch(`/api/v6/insights?agentId=${agentId}&status=new,viewed`)
                                const data = await result.json()
                                if (data.success) setInsights(data.data)
                              } catch (error) {
                                clientLogger.error('Error snoozing insight', error as Error)
                              }
                            }}
                            showFilters={false}
                            tokensPerPilotCredit={tokensPerPilotCredit}
                          />
                        </div>
                      ) : (
                        <div className="text-center py-12">
                          <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="w-8 h-8 text-purple-600 dark:text-purple-400" />
                          </div>
                          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)] mb-2">No Data Issues</h3>
                          <p className="text-sm text-[var(--v2-text-secondary)]">
                            Your workflow data quality is excellent with no issues detected.
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })()
              )}
            </div>
          </div>
        </div>
      )}

      {/* Execution Modal - Run Now */}
      {/* Execution Modal - Run Now */}
      <ExecutionModal
        isOpen={showExecutionModal}
        onClose={handleCloseExecutionModal}
        onConfirm={handleConfirmExecution}
        executing={executing}
        result={executionResult}
        error={executionError}
        agentName={agent?.agent_name}
        onGoToBilling={() => router.push('/v2/settings?tab=billing')}
      />

      {/* Help Dialog */}
      <ModernHelpDialog
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
      />

    </div>
  )
}
