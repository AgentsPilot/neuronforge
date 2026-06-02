'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/v2/ui/card'
import { V2Logo, V2Controls } from '@/components/v2/V2Header'
import { ModernHelpDialog } from '@/components/v2/ModernHelpDialog'
import { getPricingConfig } from '@/lib/utils/pricingConfig'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import {
  Search,
  Mail,
  FileText,
  AlertCircle,
  TrendingUp,
  Activity,
  Coins,
  CheckCircle2,
  XCircle,
  Bot,
  Mic,
  MicOff,
  ArrowRight,
  ChevronDown,
  Calendar
} from 'lucide-react'

interface AgentStat {
  id: string
  name: string
  count: number
  lastRun: string | null
}

interface RecentRun {
  id: string
  agent_name: string
  status: string
  created_at: string
}

interface DashboardStats {
  creditBalance: number
  totalSpent: number
  scheduledCount: number
  alertsCount: number
  totalMemories: number
  agentStats: AgentStat[]
  recentRuns: RecentRun[]
  tokensPerCredit: number
  maxCredits: number
  // Cross-agent metrics
  totalRuns30d: number
  successfulRuns30d: number
  successRate: number
  totalTimeSavedSeconds: number
  moneySavedTotal: number
  activeInsightsCount: number
  // Execution quota
  executionsQuota: number | null
  executionsUsed: number
  executionsAlertThreshold: number
}

export default function V2DashboardPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [stats, setStats] = useState<DashboardStats>({
    creditBalance: 0,
    totalSpent: 0,
    scheduledCount: 0,
    alertsCount: 0,
    totalMemories: 0,
    agentStats: [],
    recentRuns: [],
    tokensPerCredit: 10,
    maxCredits: 100000,
    // Cross-agent metrics
    totalRuns30d: 0,
    successfulRuns30d: 0,
    successRate: 0,
    totalTimeSavedSeconds: 0,
    moneySavedTotal: 0,
    activeInsightsCount: 0,
    // Execution quota
    executionsQuota: null,
    executionsUsed: 0,
    executionsAlertThreshold: 0.90
  })
  // Voice input state
  const [isListening, setIsListening] = useState(false)
  const [isVoiceSupported, setIsVoiceSupported] = useState(false)
  const recognitionRef = React.useRef<any>(null)
  const isListeningRef = React.useRef(false)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [searchQuery, setSearchQuery] = useState('')
  const [userName, setUserName] = useState<string>('')
  const [promptIdeas, setPromptIdeas] = useState<any[]>([])
  const [showIdeas, setShowIdeas] = useState(false)
  const [accountFrozen, setAccountFrozen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const [systemStatusTimeFilter, setSystemStatusTimeFilter] = useState<7 | 30 | 90 | 'all'>(30)
  const [recentActivityTimeFilter, setRecentActivityTimeFilter] = useState<7 | 30 | 90 | 'all'>(30)
  const [showSystemStatusMenu, setShowSystemStatusMenu] = useState(false)
  const [showRecentActivityMenu, setShowRecentActivityMenu] = useState(false)

  const fetchDashboardData = React.useCallback(async () => {
    if (!user) return

    try {
      // Fetch pricing config first
      const pricingConfig = await getPricingConfig(supabase)
      const tokensPerCredit = pricingConfig.tokens_per_pilot_credit

      // Calculate dynamic max credits based on subscription tier
      const maxCredits = 100000 // This could be fetched from subscription tier settings

      // Date range based on selected time filter for System Status
      const systemStatusDaysBack = systemStatusTimeFilter === 'all' ? 365 * 10 : systemStatusTimeFilter
      const systemStatusFilterDate = new Date(Date.now() - systemStatusDaysBack * 24 * 60 * 60 * 1000).toISOString()

      // Date range based on selected time filter for Recent Activity
      const recentActivityDaysBack = recentActivityTimeFilter === 'all' ? 365 * 10 : recentActivityTimeFilter
      const recentActivityFilterDate = new Date(Date.now() - recentActivityDaysBack * 24 * 60 * 60 * 1000).toISOString()

      // Optimize: Fetch all data in parallel with a single Promise.all
      const [
        { data: agentStatsData },
        { count: scheduledAgentsCount },
        { count: failedCount },
        { count: memoriesCount },
        { data: subscriptionData },
        { data: recentRunsData },
        { data: agentExecutionCounts },
        { data: agentExecutionCountsAllTime },
        { data: profileData },
        { data: promptIdeasData },
        { data: executions30d },
        { count: activeInsightsCount },
        { data: agentsROIConfig }
      ] = await Promise.all([
        supabase
          .from('agent_stats')
          .select('agent_id, run_count, last_run_at, agents!inner (agent_name, status)')
          .eq('user_id', user.id)
          .eq('agents.status', 'active')
          .order('last_run_at', { ascending: false })
          .limit(10),
        supabase
          .from('agents')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('mode', 'scheduled')
          .eq('status', 'active'),
        supabase
          .from('agent_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('status', 'failed')
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
        supabase
          .from('run_memories')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id),
        supabase
          .from('user_subscriptions')
          .select('balance, total_spent, executions_quota, executions_used, executions_alert_threshold')
          .eq('user_id', user.id)
          .single(),
        supabase
          .from('agent_logs')
          .select('id, agent_id, status, created_at, agents (agent_name)')
          .eq('user_id', user.id)
          .gte('created_at', recentActivityFilterDate)
          .order('created_at', { ascending: false })
          .limit(200),
        // Get actual execution counts from agent_executions table (filtered by time for Recent Activity)
        supabase
          .from('agent_executions')
          .select('agent_id, started_at, agents!inner (agent_name, status)')
          .eq('user_id', user.id)
          .eq('agents.status', 'active')
          .neq('run_mode', 'calibration')
          .gte('started_at', recentActivityFilterDate)
          .order('started_at', { ascending: false }),
        // Get ALL TIME execution counts from agent_executions table for Agent List (no time filter)
        supabase
          .from('agent_executions')
          .select('agent_id, started_at, agents!inner (agent_name, status)')
          .eq('user_id', user.id)
          .eq('agents.status', 'active')
          .neq('run_mode', 'calibration')
          .order('started_at', { ascending: false }),
        // Get user profile for full name
        supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .single(),
        // Get user's onboarding prompt ideas
        supabase
          .from('onboarding_prompt_ideas')
          .select('ideas')
          .eq('user_id', user.id)
          .single(),
        // Get all executions with logs for money saved calculation (filtered by time for System Status)
        supabase
          .from('agent_executions')
          .select('id, agent_id, status, logs')
          .eq('user_id', user.id)
          .neq('run_mode', 'calibration')
          .gte('started_at', systemStatusFilterDate),
        // Get active insights count (status = 'new' or 'viewed')
        supabase
          .from('execution_insights')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .in('status', ['new', 'viewed']),
        // Get agents with ROI configuration (manual_time_per_item_seconds)
        supabase
          .from('agents')
          .select('id, manual_time_per_item_seconds')
          .eq('user_id', user.id)
          .eq('status', 'active')
      ])

      // Set user name from profile
      if (profileData?.full_name) {
        setUserName(profileData.full_name)
      }

      // Set prompt ideas if available
      if (promptIdeasData?.ideas) {
        setPromptIdeas(promptIdeasData.ideas)
      }

      // Count actual executions per agent (filtered by time for Recent Activity)
      const executionCountMap = new Map<string, number>()
      const lastRunMap = new Map<string, string>()

      if (agentExecutionCounts) {
        agentExecutionCounts.forEach((exec: any) => {
          const count = executionCountMap.get(exec.agent_id) || 0
          executionCountMap.set(exec.agent_id, count + 1)

          // Track last run (most recent execution)
          const existingLastRun = lastRunMap.get(exec.agent_id)
          if (!existingLastRun || exec.started_at > existingLastRun) {
            lastRunMap.set(exec.agent_id, exec.started_at)
          }
        })
      }

      // Count ALL TIME executions per agent (no time filter - for Agent List)
      const executionCountMapAllTime = new Map<string, number>()

      if (agentExecutionCountsAllTime) {
        agentExecutionCountsAllTime.forEach((exec: any) => {
          const count = executionCountMapAllTime.get(exec.agent_id) || 0
          executionCountMapAllTime.set(exec.agent_id, count + 1)
        })
      }

      // Parse agent stats using TIME-FILTERED execution counts from agent_executions table
      const parsedStats: AgentStat[] = agentStatsData?.map((s) => {
        const agentData = s.agents as any
        const actualCount = executionCountMap.get(s.agent_id) || 0 // Use TIME-FILTERED count for Recent Activity
        const lastRun = lastRunMap.get(s.agent_id) || s.last_run_at

        return {
          id: s.agent_id,
          name: agentData?.agent_name ?? 'Unknown Agent',
          count: actualCount, // Use TIME-FILTERED count from agent_executions (excluding calibration)
          lastRun: lastRun,
        }
      }) || []

      // Parse recent runs
      const parsedRecentRuns: RecentRun[] = recentRunsData?.map((r) => {
        const agentData = r.agents as any
        return {
          id: r.id,
          agent_name: agentData?.agent_name ?? 'Unknown Agent',
          status: r.status,
          created_at: r.created_at
        }
      }) || []

      // Convert tokens to Pilot Credits using dynamic config
      const tokens = subscriptionData?.balance || 0
      const pilotCredits = Math.floor(tokens / tokensPerCredit)

      const totalSpentTokens = subscriptionData?.total_spent || 0
      const totalSpentCredits = Math.floor(totalSpentTokens / tokensPerCredit)

      // Calculate cross-agent metrics from filtered time period
      const totalRunsFiltered = executions30d?.length || 0

      const successfulRuns = executions30d?.filter((e: any) =>
        e.status === 'completed' || e.status === 'success'
      ).length || 0

      const successRate = totalRunsFiltered > 0 ? Math.round((successfulRuns / totalRunsFiltered) * 100) : 0

      // Create map of agent_id -> manual_time_per_item_seconds for ROI calculation
      const agentROIConfigMap = new Map<string, number>()
      agentsROIConfig?.forEach((agent: any) => {
        if (agent.manual_time_per_item_seconds && agent.manual_time_per_item_seconds > 0) {
          agentROIConfigMap.set(agent.id, agent.manual_time_per_item_seconds)
        }
      })

      // Get user's hourly rate from profile (same as analytics)
      const DEFAULT_HOURLY_RATE = 50 // Default $50/hour
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('hourly_rate_usd')
        .eq('id', user.id)
        .single()

      const hourlyRate = userProfile?.hourly_rate_usd || DEFAULT_HOURLY_RATE
      console.log(`[Dashboard] Using hourly rate: $${hourlyRate}/hour (from profile: ${userProfile?.hourly_rate_usd || 'not set, using default'})`)

      // Calculate total time saved and money saved using execution_metrics table (like analytics)
      let totalTimeSavedSeconds = 0

      // Fetch execution metrics for the filtered executions
      const executionIds = executions30d?.map((e: any) => e.id) || []

      console.log(`[Dashboard] Time filter: ${systemStatusTimeFilter} days, Found ${executionIds.length} executions, ROI config for ${agentROIConfigMap.size} agents`)

      if (executionIds.length > 0) {
        const { data: executionMetrics } = await supabase
          .from('execution_metrics')
          .select('execution_id, time_saved_seconds')
          .in('execution_id', executionIds)

        console.log(`[Dashboard] Found ${executionMetrics?.length || 0} execution_metrics records`)

        // Sum up pre-calculated time_saved_seconds from execution_metrics
        // IMPORTANT: Use stored values instead of recalculating to support bulk workflows
        executionMetrics?.forEach((metric: any) => {
          if (metric.time_saved_seconds && metric.time_saved_seconds > 0) {
            totalTimeSavedSeconds += metric.time_saved_seconds
          }
        })

        console.log(`[Dashboard] Total time saved: ${totalTimeSavedSeconds}s (${Math.round(totalTimeSavedSeconds / 3600)}h)`)
      }

      // Calculate total money saved for the period (not weekly average)
      const timeSavedHours = totalTimeSavedSeconds / 3600
      const moneySavedTotal = Math.round(timeSavedHours * hourlyRate)

      console.log(`[Dashboard] Money saved calculation: ${timeSavedHours.toFixed(2)}h × $${hourlyRate}/h = $${moneySavedTotal}`)

      // Update all stats at once
      setStats({
        creditBalance: pilotCredits,
        totalSpent: totalSpentCredits,
        scheduledCount: scheduledAgentsCount || 0,
        alertsCount: failedCount || 0, // Keep using agent_logs for 24h failures (existing alerts)
        totalMemories: memoriesCount || 0,
        agentStats: parsedStats,
        recentRuns: parsedRecentRuns,
        tokensPerCredit,
        maxCredits,
        // Cross-agent metrics (filtered by time period)
        totalRuns30d: totalRunsFiltered,
        successfulRuns30d: successfulRuns,
        successRate,
        totalTimeSavedSeconds,
        moneySavedTotal,
        activeInsightsCount: activeInsightsCount || 0,
        // Execution quota
        executionsQuota: subscriptionData?.executions_quota || null,
        executionsUsed: subscriptionData?.executions_used || 0,
        executionsAlertThreshold: subscriptionData?.executions_alert_threshold || 0.90
      })

      setLastUpdated(new Date())
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }, [user, systemStatusTimeFilter, recentActivityTimeFilter])

  useEffect(() => {
    if (user) {
      fetchDashboardData()
    }
  }, [user, systemStatusTimeFilter, recentActivityTimeFilter, fetchDashboardData])

  // Separate effect for auto-refresh to avoid dependency issues
  useEffect(() => {
    if (user) {
      const interval = setInterval(fetchDashboardData, 5 * 60 * 1000)
      return () => clearInterval(interval)
    }
  }, [user, fetchDashboardData])

  // Initialize Speech Recognition
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (SpeechRecognition) {
        setIsVoiceSupported(true)
        recognitionRef.current = new SpeechRecognition()
        recognitionRef.current.continuous = false
        recognitionRef.current.interimResults = true
        recognitionRef.current.lang = 'en-US'

        recognitionRef.current.onresult = (event: any) => {
          let finalTranscript = ''
          for (let i = 0; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript + ' '
            }
          }
          if (finalTranscript) {
            setSearchQuery(prev => prev + finalTranscript)
          }
        }

        recognitionRef.current.onerror = (event: any) => {
          if (event.error === 'not-allowed') {
            alert('Microphone permission denied. Please allow microphone access.')
          }
          setIsListening(false)
          isListeningRef.current = false
        }

        recognitionRef.current.onend = () => {
          if (isListeningRef.current) {
            setTimeout(() => {
              if (isListeningRef.current && recognitionRef.current) {
                try {
                  recognitionRef.current.start()
                } catch (e) {
                  setIsListening(false)
                  isListeningRef.current = false
                }
              }
            }, 100)
          }
        }
      }
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    }
  }, [])

  // Quick stats calculation
  const totalRuns = stats.agentStats.reduce((sum, stat) => sum + stat.count, 0)
  const lastRunTime = stats.agentStats.length > 0 && stats.agentStats[0].lastRun
    ? new Date(stats.agentStats[0].lastRun)
    : null

  const getTimeAgo = (date: Date | null) => {
    if (!date) return 'Never'
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

    if (hours > 24) return `${Math.floor(hours / 24)}d ago`
    if (hours > 0) return `${hours}h ago`
    if (minutes > 0) return `${minutes}m ago`
    return 'Just now'
  }

  // Auto-resize textarea when searchQuery changes
  React.useEffect(() => {
    if (textareaRef.current) {
      // Reset height to auto first to get accurate scrollHeight
      textareaRef.current.style.height = 'auto'
      // Set height based on content, capped at 128px
      const newHeight = textareaRef.current.scrollHeight
      textareaRef.current.style.height = Math.min(newHeight, 128) + 'px'
    }
  }, [searchQuery])

  // Initialize textarea height on mount
  React.useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [])

  // Voice input toggle
  const toggleListening = async () => {
    if (!recognitionRef.current) return

    if (isListening) {
      isListeningRef.current = false
      setIsListening(false)
      recognitionRef.current.stop()
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach(track => track.stop())
        isListeningRef.current = true
        setIsListening(true)
        recognitionRef.current.start()
      } catch (error) {
        alert('Please allow microphone access to use voice input')
      }
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[600px]">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 border-4 border-[var(--v2-primary)] border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-[var(--v2-text-secondary)] font-medium">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  // Use full name from profile if available, otherwise fallback to email
  const displayName = userName || user?.email?.split('@')[0] || 'there'
  const capitalizedName = displayName.includes(' ')
    ? displayName.split(' ')[0] // Use first name if full name exists
    : displayName.charAt(0).toUpperCase() + displayName.slice(1)

  return (
    <div className="space-y-2 sm:space-y-3 lg:space-y-4">
      {/* Logo */}
      <div className="mb-3">
        <V2Logo />
      </div>

      {/* Top Bar: Header + Token Display + User Menu */}
      <div className="flex items-start justify-between gap-4">
        {/* Header */}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-[var(--v2-text-primary)] mb-1 leading-tight">
            Hi {capitalizedName},
          </h1>
          <p className="text-base sm:text-lg lg:text-xl text-[var(--v2-text-secondary)] font-normal">
            what do you want to automate today?
          </p>
        </div>
        {/* Token Display + User Menu */}
        <div className="flex-shrink-0">
          <V2Controls
            showHelpLink={true}
            onHelpClick={() => setHelpOpen(true)}
          />
        </div>
      </div>

      {/* Search Box */}
      <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)]" style={{ borderRadius: 'var(--v2-radius-card)' }}>
        <div className={`p-2.5 sm:p-3 ${accountFrozen || stats.creditBalance < 2000 ? 'opacity-50 cursor-not-allowed' : ''}`}>
          {/* Main Input Row */}
          <div className="flex items-start gap-2 sm:gap-3">
            <Search className="w-4 h-4 sm:w-5 sm:h-5 text-[var(--v2-text-muted)] flex-shrink-0 mt-1" />
            <textarea
              ref={textareaRef}
              value={searchQuery}
              onChange={(e) => {
                if (!(accountFrozen || stats.creditBalance < 2000)) {
                  setSearchQuery(e.target.value)
                  // Auto-grow textarea up to max height
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = 'auto'
                  const newHeight = Math.min(target.scrollHeight, 256)
                  target.style.height = newHeight + 'px'
                }
              }}
              placeholder={accountFrozen ? "Account frozen - Purchase tokens to continue" : stats.creditBalance < 2000 ? "Insufficient balance - Need 2000 tokens to create agent" : "Describe what you want to automate..."}
              className="flex-1 bg-transparent border-none outline-none text-sm sm:text-base text-[var(--v2-text-secondary)] placeholder:text-[var(--v2-text-muted)] resize-none max-h-64 overflow-y-auto scroll-smooth scrollbar-thin"
              style={{
                height: '48px',
                minHeight: '48px',
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(209, 213, 219, 0.5) transparent'
              }}
              disabled={accountFrozen || stats.creditBalance < 2000}
              rows={1}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && searchQuery.trim().length >= 20 && !accountFrozen && stats.creditBalance >= 2000) {
                  e.preventDefault()
                  router.push(`/v2/agents/new?prompt=${encodeURIComponent(searchQuery)}`)
                  setShowIdeas(false)
                }
              }}
            />
          </div>

          {/* Bottom Action Bar */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--v2-border)]">
            {/* Left Side: Character Counter */}
            <div className="flex items-center gap-2 text-xs text-[var(--v2-text-muted)]">
              {searchQuery.length > 0 ? (
                <>
                  <span className={`font-medium ${searchQuery.trim().length < 20 ? 'text-red-500' : 'text-green-600'}`}>
                    {searchQuery.length}
                  </span>
                  <span className="text-[var(--v2-text-muted)]">/ 20 min</span>
                </>
              ) : (
                <span className="text-[var(--v2-text-muted)]">20 characters minimum</span>
              )}
            </div>

            {/* Right Side: Action Buttons */}
            <div className="flex items-center gap-2">
              {/* Show Ideas Button */}
              {promptIdeas.length > 0 && !accountFrozen && stats.creditBalance >= 2000 && (
                <button
                  onClick={() => setShowIdeas(!showIdeas)}
                  className="px-3 py-1.5 text-xs font-medium text-[var(--v2-primary)] hover:text-[var(--v2-secondary)] transition-colors"
                >
                  {showIdeas ? 'Hide' : 'Show'} Ideas
                </button>
              )}

              {/* Microphone Button */}
              {isVoiceSupported && !accountFrozen && stats.creditBalance >= 2000 && (
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`w-8 h-8 rounded-md flex items-center justify-center transition-all ${
                    isListening
                      ? 'bg-gradient-to-r from-red-500 to-pink-500 shadow-sm animate-pulse'
                      : 'hover:bg-[var(--v2-surface-hover)] border border-transparent hover:border-[var(--v2-border)]'
                  }`}
                  title={isListening ? 'Stop recording' : 'Start voice input'}
                >
                  {isListening ? (
                    <MicOff className="w-4 h-4 text-white" />
                  ) : (
                    <Mic className={`w-4 h-4 transition-colors ${isListening ? 'text-white' : 'text-[var(--v2-text-muted)] group-hover:text-[var(--v2-primary)]'}`} />
                  )}
                </button>
              )}

              {/* Submit Arrow Button */}
              <button
                onClick={() => {
                  if (accountFrozen || stats.creditBalance < 2000 || searchQuery.trim().length < 20) return
                  router.push(`/v2/agents/new?prompt=${encodeURIComponent(searchQuery)}`)
                  setShowIdeas(false)
                }}
                disabled={accountFrozen || stats.creditBalance < 2000 || searchQuery.trim().length < 20}
                className={`w-8 h-8 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:opacity-90 transition-all rounded-md flex items-center justify-center ${accountFrozen || stats.creditBalance < 2000 || searchQuery.trim().length < 20 ? 'opacity-50 cursor-not-allowed' : 'shadow-sm'}`}
                title={
                  accountFrozen
                    ? "Account frozen - Purchase tokens to continue"
                    : stats.creditBalance < 2000
                    ? "Insufficient balance - Need 2000 tokens to create agent"
                    : searchQuery.trim().length < 20
                    ? "Enter at least 20 characters to start building"
                    : "Start Agent Builder with this prompt"
                }
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 items-start">
          {/* Active Automations Card */}
          <Card
            hoverable
            onClick={() => router.push('/v2/agent-list')}
            className="cursor-pointer !p-3 sm:!p-4 !h-[280px] overflow-hidden !box-border active:scale-[0.98] transition-transform"
          >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bot className="w-6 h-6 sm:w-7 sm:h-7 text-[#10B981]" />
                    <h3 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
                      Active Automations
                    </h3>
                  </div>
                </div>
                <p className="text-sm text-[var(--v2-text-secondary)]">
                  Your running automations
                </p>

              {stats.agentStats.length > 0 ? (
                <div className="pt-0 space-y-3">
                  {/* Agent List */}
                  <div className="space-y-2">
                    {stats.agentStats.slice(0, 4).map((agent, index) => (
                      <div
                        key={index}
                        onClick={(e) => {
                          e.stopPropagation()
                          router.push(`/v2/agents/${agent.id}`)
                        }}
                        className="flex items-center justify-between py-2.5 sm:py-2 px-3 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98] transition-all duration-200 cursor-pointer"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></div>
                          <span className="text-sm font-medium text-[var(--v2-text-primary)] truncate" title={agent.name}>
                            {agent.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                          <span className="text-sm font-bold text-[var(--v2-text-primary)]">
                            {agent.count.toLocaleString()}
                          </span>
                          <span className="text-[10px] text-[var(--v2-text-muted)]">runs</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Bot className="w-12 h-12 opacity-20 mb-2" />
                  <p className="text-xs text-[var(--v2-text-muted)]">No active automations yet</p>
                </div>
              )}
              </div>
            </Card>

          {/* Performance Overview Card */}
          <Card
            hoverable
            onClick={() => router.push('/v2/analytics')}
            className="cursor-pointer !p-3 sm:!p-4 !h-[280px] overflow-hidden !box-border active:scale-[0.98] transition-transform"
          >
              <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-6 h-6 sm:w-7 sm:h-7 text-[#06B6D4]" />
                  <h3 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
                    Performance Overview
                  </h3>
                </div>
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowSystemStatusMenu(!showSystemStatusMenu)
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap bg-[var(--v2-surface)] text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:border-[var(--v2-border-hover)] transition-all rounded-lg"
                  >
                    <Calendar className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
                    {systemStatusTimeFilter === 'all' ? 'All Time' : `Last ${systemStatusTimeFilter} Days`}
                    <ChevronDown className={`w-3.5 h-3.5 text-[var(--v2-text-muted)] transition-transform ${showSystemStatusMenu ? 'rotate-180' : ''}`} />
                  </button>

                  {showSystemStatusMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-[100]"
                        onClick={() => setShowSystemStatusMenu(false)}
                      />
                      <div
                        className="absolute top-full right-0 mt-2 w-48 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-xl z-[101] rounded-lg overflow-hidden"
                      >
                        {[
                          { value: 7 as const, label: 'Last 7 Days' },
                          { value: 30 as const, label: 'Last 30 Days' },
                          { value: 90 as const, label: 'Last 90 Days' },
                          { value: 'all' as const, label: 'All Time' }
                        ].map((option) => (
                          <button
                            key={option.value}
                            onClick={(e) => {
                              e.stopPropagation()
                              setSystemStatusTimeFilter(option.value)
                              setShowSystemStatusMenu(false)
                            }}
                            className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                              systemStatusTimeFilter === option.value
                                ? 'bg-[var(--v2-primary)] text-white'
                                : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-hover)]'
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
              <p className="text-sm text-[var(--v2-text-secondary)]">
                How your automations are performing
              </p>

              {/* Modern Executive Summary Layout */}
              <div className="space-y-4">

                {/* System Health Status Banner */}
                {(() => {
                  // Collect all system alerts
                  const alerts = []

                  if ((stats.totalRuns30d - stats.successfulRuns30d) > 0) {
                    alerts.push({
                      type: 'error',
                      label: 'Failed',
                      count: stats.totalRuns30d - stats.successfulRuns30d,
                      color: 'red'
                    })
                  }

                  if (stats.successRate < 90) {
                    alerts.push({
                      type: 'warning',
                      label: 'Low Success',
                      count: `${stats.successRate}%`,
                      color: 'yellow'
                    })
                  }

                  if (stats.activeInsightsCount > 0) {
                    alerts.push({
                      type: 'info',
                      label: 'Insights',
                      count: stats.activeInsightsCount,
                      color: 'orange'
                    })
                  }

                  // Check execution quota (if quota exists and not unlimited)
                  if (stats.executionsQuota !== null && stats.executionsQuota > 0) {
                    const usagePercent = stats.executionsUsed / stats.executionsQuota
                    if (usagePercent >= stats.executionsAlertThreshold) {
                      const remaining = stats.executionsQuota - stats.executionsUsed
                      alerts.push({
                        type: 'warning',
                        label: 'Quota',
                        count: remaining,
                        color: remaining <= 0 ? 'red' : 'yellow'
                      })
                    }
                  }

                  const isHealthy = alerts.length === 0

                  return (
                    <div className={`p-3 rounded-xl border backdrop-blur-sm transition-all ${
                      isHealthy
                        ? 'bg-gradient-to-br from-emerald-500/10 via-green-500/10 to-teal-500/10 dark:from-emerald-500/20 dark:via-green-500/20 dark:to-teal-500/20 border-emerald-300/40 dark:border-emerald-700/50'
                        : 'bg-gradient-to-br from-red-500/10 via-orange-500/10 to-amber-500/10 dark:from-red-500/20 dark:via-orange-500/20 dark:to-amber-500/20 border-red-300/40 dark:border-red-700/50'
                    }`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className={`p-2 rounded-lg flex-shrink-0 ${
                            isHealthy
                              ? 'bg-emerald-500/20 dark:bg-emerald-500/30'
                              : 'bg-red-500/20 dark:bg-red-500/30'
                          }`}>
                            {isHealthy ? (
                              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className={`text-sm font-bold ${
                              isHealthy
                                ? 'text-emerald-800 dark:text-emerald-200'
                                : 'text-red-800 dark:text-red-200'
                            }`}>
                              {isHealthy ? 'All Systems Operational' : `${alerts.length} Issue${alerts.length > 1 ? 's' : ''} Detected`}
                            </div>
                            <div className={`text-[10px] font-medium mt-0.5 ${
                              isHealthy
                                ? 'text-emerald-700/80 dark:text-emerald-300/80'
                                : 'text-red-700/80 dark:text-red-300/80'
                            }`}>
                              {isHealthy
                                ? `${stats.successRate}% success rate • ${stats.totalRuns30d} runs (30 days)`
                                : 'View Analytics page for full details'
                              }
                            </div>
                          </div>
                        </div>

                        {/* Alert Badges - Wraps if too many */}
                        {!isHealthy && alerts.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap justify-end flex-shrink-0">
                            {alerts.map((alert, index) => (
                              <div
                                key={index}
                                className={`px-2 py-1 rounded-lg border ${
                                  alert.color === 'red'
                                    ? 'bg-red-500/20 dark:bg-red-500/30 border-red-500/40'
                                    : alert.color === 'yellow'
                                    ? 'bg-yellow-500/20 dark:bg-yellow-500/30 border-yellow-500/40'
                                    : 'bg-orange-500/20 dark:bg-orange-500/30 border-orange-500/40'
                                }`}
                              >
                                <div className={`text-xs font-bold ${
                                  alert.color === 'red'
                                    ? 'text-red-700 dark:text-red-300'
                                    : alert.color === 'yellow'
                                    ? 'text-yellow-700 dark:text-yellow-300'
                                    : 'text-orange-700 dark:text-orange-300'
                                }`}>
                                  {alert.count}
                                </div>
                                <div className={`text-[8px] font-semibold uppercase tracking-wider ${
                                  alert.color === 'red'
                                    ? 'text-red-600/80 dark:text-red-400/80'
                                    : alert.color === 'yellow'
                                    ? 'text-yellow-600/80 dark:text-yellow-400/80'
                                    : 'text-orange-600/80 dark:text-orange-400/80'
                                }`}>
                                  {alert.label}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}

                {/* Key Performance Metrics - 2 row grid */}
                <div className="grid grid-cols-4 gap-2.5">

                  {/* Row 1: Core Metrics */}
                  {/* Success Rate */}
                  <div className={`group relative overflow-hidden p-3 rounded-xl border backdrop-blur-sm transition-all hover:scale-105 hover:shadow-md ${
                    stats.successRate >= 95
                      ? 'bg-gradient-to-br from-emerald-500/10 to-teal-500/10 dark:from-emerald-500/20 dark:to-teal-500/20 border-emerald-300/30 dark:border-emerald-700/40'
                      : stats.successRate >= 90
                      ? 'bg-gradient-to-br from-yellow-500/10 to-amber-500/10 dark:from-yellow-500/20 dark:to-amber-500/20 border-yellow-300/30 dark:border-yellow-700/40'
                      : 'bg-gradient-to-br from-red-500/10 to-rose-500/10 dark:from-red-500/20 dark:to-rose-500/20 border-red-300/30 dark:border-red-700/40'
                  }`}>
                    <div className={`absolute top-0 right-0 w-16 h-16 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 ${
                      stats.successRate >= 95 ? 'bg-gradient-to-br from-emerald-500/20 to-teal-500/20' :
                      stats.successRate >= 90 ? 'bg-gradient-to-br from-yellow-500/20 to-amber-500/20' :
                      'bg-gradient-to-br from-red-500/20 to-rose-500/20'
                    }`} />
                    <div className="relative text-center">
                      <div className={`text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-br mb-0.5 ${
                        stats.successRate >= 95 ? 'from-emerald-600 to-teal-600 dark:from-emerald-400 dark:to-teal-400' :
                        stats.successRate >= 90 ? 'from-yellow-600 to-amber-600 dark:from-yellow-400 dark:to-amber-400' :
                        'from-red-600 to-rose-600 dark:from-red-400 dark:to-rose-400'
                      }`}>
                        {stats.successRate}%
                      </div>
                      <div className={`text-[9px] font-semibold tracking-wider uppercase ${
                        stats.successRate >= 95 ? 'text-emerald-700/70 dark:text-emerald-300/70' :
                        stats.successRate >= 90 ? 'text-yellow-700/70 dark:text-yellow-300/70' :
                        'text-red-700/70 dark:text-red-300/70'
                      }`}>
                        Success Rate
                      </div>
                    </div>
                  </div>

                  {/* Total Runs */}
                  <div className="group relative overflow-hidden p-3 rounded-xl bg-gradient-to-br from-blue-500/10 to-indigo-500/10 dark:from-blue-500/20 dark:to-indigo-500/20 border border-blue-300/30 dark:border-blue-700/40 backdrop-blur-sm transition-all hover:scale-105 hover:shadow-md">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-blue-500/20 to-indigo-500/20 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
                    <div className="relative text-center">
                      <div className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-br from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 mb-0.5">
                        {stats.totalRuns30d.toLocaleString()}
                      </div>
                      <div className="text-[9px] text-blue-700/70 dark:text-blue-300/70 font-semibold tracking-wider uppercase">
                        Total Runs
                      </div>
                    </div>
                  </div>

                  {/* Money Saved */}
                  <div className={`group relative overflow-hidden p-3 rounded-xl border backdrop-blur-sm transition-all hover:scale-105 hover:shadow-md ${
                    stats.moneySavedTotal > 0
                      ? 'bg-gradient-to-br from-green-500/10 to-lime-500/10 dark:from-green-500/20 dark:to-lime-500/20 border-green-300/30 dark:border-green-700/40'
                      : 'bg-gradient-to-br from-gray-500/5 to-slate-500/5 dark:from-gray-700/20 dark:to-slate-700/20 border-gray-300/20 dark:border-gray-700/30'
                  }`}>
                    <div className={`absolute top-0 right-0 w-16 h-16 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 ${
                      stats.moneySavedTotal > 0
                        ? 'bg-gradient-to-br from-green-500/20 to-lime-500/20'
                        : 'bg-gradient-to-br from-gray-500/10 to-slate-500/10'
                    }`} />
                    <div className="relative text-center">
                      <div className={`text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-br mb-0.5 ${
                        stats.moneySavedTotal > 0
                          ? 'from-green-600 to-lime-600 dark:from-green-400 dark:to-lime-400'
                          : 'from-gray-400 to-slate-400 dark:from-gray-500 dark:to-slate-500'
                      }`}>
                        {stats.moneySavedTotal > 0
                          ? stats.moneySavedTotal >= 1000
                            ? `$${(stats.moneySavedTotal / 1000).toFixed(1)}K`
                            : `$${stats.moneySavedTotal}`
                          : '—'
                        }
                      </div>
                      <div className={`text-[9px] font-semibold tracking-wider uppercase ${
                        stats.moneySavedTotal > 0
                          ? 'text-green-700/70 dark:text-green-300/70'
                          : 'text-gray-500/70 dark:text-gray-400/70'
                      }`}>
                        Value Saved
                      </div>
                    </div>
                  </div>

                  {/* Time Saved */}
                  <div className="group relative overflow-hidden p-3 rounded-xl bg-gradient-to-br from-purple-500/10 to-violet-500/10 dark:from-purple-500/20 dark:to-violet-500/20 border border-purple-300/30 dark:border-purple-700/40 backdrop-blur-sm transition-all hover:scale-105 hover:shadow-md">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-purple-500/20 to-violet-500/20 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
                    <div className="relative text-center">
                      <div className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-br from-purple-600 to-violet-600 dark:from-purple-400 dark:to-violet-400 mb-0.5">
                        {stats.totalTimeSavedSeconds > 0
                          ? `${Math.round(stats.totalTimeSavedSeconds / 3600).toLocaleString()}h`
                          : '—'
                        }
                      </div>
                      <div className="text-[9px] text-purple-700/70 dark:text-purple-300/70 font-semibold tracking-wider uppercase">
                        Time Saved
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              </div>
            </Card>

          {/* Recent Activity Card - Horizontal Bar List */}
          <Card
            className="!p-3 sm:!p-4 !h-[280px] overflow-hidden !box-border"
          >
              <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-6 h-6 sm:w-7 sm:h-7 text-[#8B5CF6]" />
                  <h3 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
                    Recent Activity
                  </h3>
                </div>
                <div className="relative">
                  <button
                    onClick={() => setShowRecentActivityMenu(!showRecentActivityMenu)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap bg-[var(--v2-surface)] text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:border-[var(--v2-border-hover)] transition-all rounded-lg"
                  >
                    <Calendar className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
                    {recentActivityTimeFilter === 'all' ? 'All Time' : `Last ${recentActivityTimeFilter} Days`}
                    <ChevronDown className={`w-3.5 h-3.5 text-[var(--v2-text-muted)] transition-transform ${showRecentActivityMenu ? 'rotate-180' : ''}`} />
                  </button>

                  {showRecentActivityMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-[100]"
                        onClick={() => setShowRecentActivityMenu(false)}
                      />
                      <div
                        className="absolute top-full right-0 mt-2 w-48 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-xl z-[101] rounded-lg overflow-hidden"
                      >
                        {[
                          { value: 7 as const, label: 'Last 7 Days' },
                          { value: 30 as const, label: 'Last 30 Days' },
                          { value: 90 as const, label: 'Last 90 Days' },
                          { value: 'all' as const, label: 'All Time' }
                        ].map((option) => (
                          <button
                            key={option.value}
                            onClick={() => {
                              setRecentActivityTimeFilter(option.value)
                              setShowRecentActivityMenu(false)
                            }}
                            className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                              recentActivityTimeFilter === option.value
                                ? 'bg-[var(--v2-primary)] text-white'
                                : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-hover)]'
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
              <p className="text-sm text-[var(--v2-text-secondary)]">
                Top 3 most active automations
              </p>
              <div className="pt-3 pb-0">
                {stats.agentStats.length > 0 ? (
                  <div className="space-y-4">
                    {(() => {
                      // Take top 3 agents by execution count
                      const topAgents = [...stats.agentStats]
                        .sort((a, b) => b.count - a.count)
                        .slice(0, 3)

                      const maxCount = Math.max(...topAgents.map(a => a.count))

                      // Color palette for agents
                      const colors = ['#8B5CF6', '#06B6D4', '#10B981', '#F59E0B', '#EF4444']

                      return topAgents.map((agent, index) => {
                        const widthPercent = maxCount > 0 ? (agent.count / maxCount) * 100 : 0
                        const color = colors[index]

                        // Create gradient colors based on base color
                        const gradients = {
                          '#8B5CF6': 'from-purple-500 via-purple-400 to-purple-500', // Purple
                          '#06B6D4': 'from-cyan-500 via-cyan-400 to-cyan-500', // Cyan
                          '#10B981': 'from-emerald-500 via-emerald-400 to-emerald-500', // Emerald
                          '#F59E0B': 'from-amber-500 via-amber-400 to-amber-500', // Amber
                          '#EF4444': 'from-red-500 via-red-400 to-red-500' // Red
                        }
                        const gradient = gradients[color as keyof typeof gradients]

                        return (
                          <div key={index} className="space-y-2">
                            {/* Agent name and count */}
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                <div
                                  className="w-2.5 h-2.5 rounded-full flex-shrink-0 shadow-sm"
                                  style={{
                                    backgroundColor: color,
                                    boxShadow: `0 0 8px ${color}40`
                                  }}
                                />
                                <span className="font-semibold text-[var(--v2-text-primary)] truncate">
                                  {agent.name}
                                </span>
                              </div>
                              <span className="font-bold text-[var(--v2-text-primary)] ml-2 tabular-nums">
                                {agent.count.toLocaleString()}
                              </span>
                            </div>

                            {/* Modern progress bar with gradient and glow */}
                            <div className="relative w-full bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100 dark:from-gray-800 dark:via-gray-850 dark:to-gray-800 rounded-full h-2.5 overflow-visible shadow-inner">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ease-out bg-gradient-to-r ${gradient} relative`}
                                style={{
                                  width: `${widthPercent}%`,
                                  minWidth: agent.count > 0 ? '8px' : '0',
                                  boxShadow: `0 2px 8px ${color}30, inset 0 1px 0 rgba(255,255,255,0.3)`
                                }}
                              >
                                {/* Shimmer effect overlay */}
                                <div className="absolute inset-0 rounded-full bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"
                                     style={{
                                       backgroundSize: '200% 100%',
                                       animation: 'shimmer 2s infinite'
                                     }}
                                />
                              </div>
                            </div>
                          </div>
                        )
                      })
                    })()}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[180px] text-[var(--v2-text-muted)]">
                    <div className="text-center">
                      <Activity className="w-12 h-12 opacity-20 mx-auto mb-2" />
                      <p className="text-xs">No automations created yet</p>
                    </div>
                  </div>
                )}
              </div>
              </div>
            </Card>

          {/* Credit Balance Card - Speedometer Gauge */}
          <Card
            hoverable
            onClick={() => router.push('/v2/billing')}
            className="cursor-pointer !p-3 sm:!p-4 !h-[280px] overflow-hidden !box-border active:scale-[0.98] transition-transform"
          >
              <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Coins className="w-6 h-6 sm:w-7 sm:h-7 text-[#F59E0B]" />
                <h3 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
                  Credit Usage
                </h3>
              </div>
              <p className="text-sm text-[var(--v2-text-secondary)]">
                Monitor your credit consumption
              </p>

              {/* Content: Stack vertically on mobile, side by side on larger screens */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4 pt-0 pb-0">
                {/* Left side - Stats */}
                <div className="flex-1 w-full sm:w-auto space-y-2">
                  <div className="flex items-center justify-between sm:block">
                    <div className="text-xs text-[var(--v2-text-muted)] mb-0 sm:mb-1">Available</div>
                    <div className="text-2xl sm:text-3xl font-bold text-[var(--v2-text-primary)]">
                      {stats.creditBalance >= 1000
                        ? `${(stats.creditBalance / 1000).toFixed(1)}K`
                        : stats.creditBalance.toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center justify-between sm:block">
                    <div className="text-xs text-[var(--v2-text-muted)] mb-0 sm:mb-1">Used</div>
                    <div className="text-lg font-semibold text-[var(--v2-text-secondary)]">
                      {stats.totalSpent >= 1000
                        ? `${(stats.totalSpent / 1000).toFixed(1)}K`
                        : stats.totalSpent.toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Right side - Modern Speedometer Gauge */}
                <div className="flex-shrink-0 w-full sm:w-auto flex justify-center">
                  <div className="relative w-48">
                    {/* Gauge container */}
                    <div className="relative h-28">
                      {/* Modern SVG Gauge Arc - Three color segments */}
                      <svg className="w-full h-full" viewBox="0 0 200 110">
                        {/* Green segment (0-33%) */}
                        <path
                          d="M 20 100 A 80 80 0 0 1 73.5 36.5"
                          fill="none"
                          stroke="#10B981"
                          strokeWidth="14"
                          strokeLinecap="round"
                        />
                        {/* Yellow segment (33-66%) */}
                        <path
                          d="M 73.5 36.5 A 80 80 0 0 1 126.5 36.5"
                          fill="none"
                          stroke="#F59E0B"
                          strokeWidth="14"
                          strokeLinecap="round"
                        />
                        {/* Red segment (66-100%) */}
                        <path
                          d="M 126.5 36.5 A 80 80 0 0 1 180 100"
                          fill="none"
                          stroke="#EF4444"
                          strokeWidth="14"
                          strokeLinecap="round"
                        />
                      </svg>

                      {/* Clean Needle */}
                      <div
                        className="absolute"
                        style={{
                          left: '50%',
                          bottom: '10px',
                          width: '3px',
                          height: '60px',
                          backgroundColor: 'var(--v2-text-primary)',
                          transformOrigin: 'bottom center',
                          transform: (() => {
                            const totalCredits = stats.creditBalance + stats.totalSpent
                            const percentage = totalCredits > 0 ? (stats.totalSpent / totalCredits) * 100 : 0
                            const angle = -90 + (percentage * 1.8)
                            return `translateX(-50%) rotate(${angle}deg)`
                          })(),
                          transition: 'transform 0.8s cubic-bezier(0.4, 0.0, 0.2, 1)',
                          borderRadius: '2px',
                          zIndex: 10
                        }}
                      >
                        {/* Needle tip */}
                        <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-b-[8px] border-l-transparent border-r-transparent border-b-[var(--v2-text-primary)]" />
                      </div>

                      {/* Center pivot */}
                      <div
                        className="absolute w-4 h-4 rounded-full bg-[var(--v2-text-primary)] border-2 border-[var(--v2-surface)]"
                        style={{
                          left: '50%',
                          bottom: '10px',
                          transform: 'translate(-50%, 50%)',
                          zIndex: 12
                        }}
                      />

                      {/* Percentage Display - Clean style */}
                      <div className="absolute inset-0 flex items-center justify-center pt-8">
                        <div className="text-xl font-semibold text-[var(--v2-text-primary)]">
                          {(() => {
                            const totalCredits = stats.creditBalance + stats.totalSpent
                            return Math.round(totalCredits > 0 ? (stats.totalSpent / totalCredits) * 100 : 0)
                          })()}%
                        </div>
                      </div>
                    </div>

                    {/* Labels below chart */}
                    <div className="flex items-center justify-between px-2 mt-2">
                      <div className="text-xs text-[var(--v2-text-muted)]">0</div>
                      <div className="text-[10px] text-[var(--v2-text-muted)] uppercase tracking-wide">used</div>
                      <div className="text-xs text-[var(--v2-text-muted)]">100</div>
                    </div>
                  </div>
                </div>
              </div>
              </div>
            </Card>
        </div>

      {/* Help Dialog */}
      <ModernHelpDialog
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
    </div>
  )
}
