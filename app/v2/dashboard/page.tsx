'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { V2Logo, V2Controls } from '@/components/v2/V2Header'
import { ModernHelpDialog } from '@/components/v2/ModernHelpDialog'
import { getPricingConfig } from '@/lib/utils/pricingConfig'
import {
  CheckCircle2,
  Sparkles,
  Bot,
  Mic,
  MicOff,
  ArrowRight
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
  const [searchQuery, setSearchQuery] = useState('')
  const [userName, setUserName] = useState<string>('')
  const [promptIdeas, setPromptIdeas] = useState<any[]>([])
  const [showIdeas, setShowIdeas] = useState(false)
  const [accountFrozen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const [systemStatusTimeFilter] = useState<7 | 30 | 90 | 'all'>(30)
  const [recentActivityTimeFilter] = useState<7 | 30 | 90 | 'all'>(30)

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
        // Use eq('run_mode', 'production') to match AI Advisor's query
        supabase
          .from('agent_executions')
          .select('agent_id, started_at, agents!inner (agent_name, status)')
          .eq('user_id', user.id)
          .eq('agents.status', 'active')
          .eq('run_mode', 'production')
          .gte('started_at', recentActivityFilterDate)
          .order('started_at', { ascending: false }),
        // Get ALL TIME execution counts from agent_executions table for Agent List (no time filter)
        supabase
          .from('agent_executions')
          .select('agent_id, started_at, agents!inner (agent_name, status)')
          .eq('user_id', user.id)
          .eq('agents.status', 'active')
          .eq('run_mode', 'production')
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
        // Use eq('run_mode', 'production') to match AI Advisor's query (not neq calibration)
        supabase
          .from('agent_executions')
          .select('id, agent_id, status, logs')
          .eq('user_id', user.id)
          .eq('run_mode', 'production')
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
        </div>
        {/* Token Display + User Menu */}
        <div className="flex-shrink-0">
          <V2Controls
            showHelpLink={true}
            onHelpClick={() => setHelpOpen(true)}
          />
        </div>
      </div>

      {/* HERO: Chat Input - Command Center Style */}
      <div
        className={`bg-gradient-to-br from-[var(--v2-primary)]/10 via-[var(--v2-secondary)]/10 to-[var(--v2-primary)]/5 border border-[var(--v2-primary)]/20 transition-all duration-300 ${accountFrozen || stats.creditBalance < 2000 ? 'opacity-50' : 'hover:border-[var(--v2-primary)]/40 focus-within:border-[var(--v2-primary)]/50 focus-within:shadow-lg focus-within:shadow-[var(--v2-primary)]/10'}`}
        style={{ borderRadius: 'var(--v2-radius-card)' }}
      >
        <div className="p-4 sm:p-6">
          {/* Main Input Row with AI Avatar */}
          <div className="flex items-start gap-3 sm:gap-4">
            {/* AI Icon - No background */}
            <Sparkles className="w-6 h-6 sm:w-7 sm:h-7 text-[var(--v2-primary)] flex-shrink-0" />
            <div className="flex-1">
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
                placeholder={accountFrozen ? "Account frozen - Purchase tokens to continue" : stats.creditBalance < 2000 ? "Insufficient balance - Need 2000 tokens to create agent" : "Tell me what you want to automate... I'll build it for you."}
                className="w-full bg-transparent border-none outline-none text-base sm:text-lg text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] resize-none max-h-64 overflow-y-auto scroll-smooth scrollbar-thin"
                style={{
                  height: '56px',
                  minHeight: '56px',
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'rgba(209, 213, 219, 0.5) transparent'
                }}
                disabled={accountFrozen || stats.creditBalance < 2000}
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && searchQuery.trim().length >= 20 && !accountFrozen && stats.creditBalance >= 2000) {
                    e.preventDefault()
                    router.push(`/v2/agents/new?prompt=${encodeURIComponent(searchQuery)}`)
                    setShowIdeas(false)
                  }
                }}
              />
            </div>
          </div>

          {/* Bottom Action Bar */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--v2-border)]/50">
            {/* Left Side: Voice + Character Counter */}
            <div className="flex items-center gap-3">
              {/* Microphone Button */}
              {isVoiceSupported && !accountFrozen && stats.creditBalance >= 2000 && (
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`p-2 rounded-lg transition-all ${
                    isListening
                      ? 'bg-gradient-to-r from-red-500 to-pink-500 shadow-sm animate-pulse'
                      : 'hover:bg-[var(--v2-surface-hover)] text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                  }`}
                  title={isListening ? 'Stop recording' : 'Start voice input'}
                >
                  {isListening ? (
                    <MicOff className="w-5 h-5 text-white" />
                  ) : (
                    <Mic className="w-5 h-5" />
                  )}
                </button>
              )}

              {/* Character Counter */}
              <div className="text-xs text-[var(--v2-text-muted)]">
                {searchQuery.length > 0 ? (
                  <span className={`font-medium ${searchQuery.trim().length < 20 ? 'text-red-500' : 'text-green-600'}`}>
                    {searchQuery.length} / 20 min
                  </span>
                ) : (
                  <span>20 characters minimum</span>
                )}
              </div>
            </div>

            {/* Right Side: Ideas + Create Button */}
            <div className="flex items-center gap-3">
              {/* Show Ideas Button */}
              {promptIdeas.length > 0 && !accountFrozen && stats.creditBalance >= 2000 && (
                <button
                  onClick={() => setShowIdeas(!showIdeas)}
                  className="px-3 py-1.5 text-sm font-medium text-[var(--v2-primary)] hover:text-[var(--v2-secondary)] transition-colors"
                >
                  {showIdeas ? 'Hide' : 'Show'} Ideas
                </button>
              )}

              {/* Create Button */}
              <button
                onClick={() => {
                  if (accountFrozen || stats.creditBalance < 2000 || searchQuery.trim().length < 20) return
                  router.push(`/v2/agents/new?prompt=${encodeURIComponent(searchQuery)}`)
                  setShowIdeas(false)
                }}
                disabled={accountFrozen || stats.creditBalance < 2000 || searchQuery.trim().length < 20}
                className={`px-5 py-2.5 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white font-medium hover:opacity-90 transition-all flex items-center gap-2 ${accountFrozen || stats.creditBalance < 2000 || searchQuery.trim().length < 20 ? 'opacity-50 cursor-not-allowed' : 'shadow-md hover:shadow-lg'}`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
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
                <span>Create</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Idea Chips - Show user's personalized ideas from onboarding */}
      {showIdeas && promptIdeas.length > 0 && !accountFrozen && stats.creditBalance >= 2000 && (
        <div className="flex flex-wrap gap-2 mt-4">
          {promptIdeas.map((idea: any, index: number) => (
            <button
              key={index}
              onClick={() => {
                setSearchQuery(idea.prompt || idea.label || idea)
                setShowIdeas(false)
                if (textareaRef.current) {
                  textareaRef.current.focus()
                }
              }}
              className="px-4 py-2 rounded-full bg-[var(--v2-surface)] border border-[var(--v2-border)] text-sm text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)] hover:border-[var(--v2-primary)]/30 transition-all"
            >
              {idea.emoji || '💡'} {idea.label || idea.prompt || idea}
            </button>
          ))}
        </div>
      )}

      {/* Today's Impact + Credits Row */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 mt-4">
        {/* Today's Impact Section */}
        <div className="bg-gradient-to-br from-emerald-500/5 via-green-500/5 to-teal-500/5 border border-emerald-500/20 p-4 sm:p-6" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400 mb-2">Today so far</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-[var(--v2-text-primary)] mb-2">
                {stats.totalTimeSavedSeconds > 0
                  ? `You saved ${(stats.totalTimeSavedSeconds / 3600).toFixed(1)} hours`
                  : 'No automation runs yet'
                }
              </h2>
              <p className="text-base sm:text-lg text-[var(--v2-text-secondary)]">
                {stats.moneySavedTotal > 0 ? (
                  <>
                    That's <span className="font-semibold text-emerald-600 dark:text-emerald-400">${stats.moneySavedTotal.toLocaleString()}</span> worth of your time
                  </>
                ) : (
                  'Run your automations to start saving time'
                )}
              </p>
            </div>
            <div className="relative hidden sm:block">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 sm:w-8 sm:h-8 text-emerald-500" />
              </div>
            </div>
          </div>

          {/* What happened breakdown */}
          {stats.totalRuns30d > 0 && (
            <div className="mt-6 pt-6 border-t border-emerald-500/20">
              <p className="text-sm font-medium text-[var(--v2-text-muted)] mb-4">What your automations did:</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                <div
                  className="bg-[var(--v2-surface)] rounded-xl p-3 sm:p-4 text-center border border-[var(--v2-border)] cursor-pointer hover:border-[var(--v2-primary)]/30 transition-all"
                  onClick={() => router.push('/v2/analytics')}
                >
                  <p className="text-xl sm:text-2xl font-bold text-[var(--v2-text-primary)]">{stats.totalRuns30d}</p>
                  <p className="text-xs sm:text-sm text-[var(--v2-text-muted)]">tasks completed</p>
                </div>
                <div
                  className="bg-[var(--v2-surface)] rounded-xl p-3 sm:p-4 text-center border border-[var(--v2-border)] cursor-pointer hover:border-[var(--v2-primary)]/30 transition-all"
                  onClick={() => router.push('/v2/analytics')}
                >
                  <p className={`text-xl sm:text-2xl font-bold ${
                    stats.successRate >= 95 ? 'text-emerald-600 dark:text-emerald-400' :
                    stats.successRate >= 90 ? 'text-amber-600 dark:text-amber-400' :
                    'text-red-600 dark:text-red-400'
                  }`}>{stats.successRate}%</p>
                  <p className="text-xs sm:text-sm text-[var(--v2-text-muted)]">success rate</p>
                </div>
                <div
                  className="bg-[var(--v2-surface)] rounded-xl p-3 sm:p-4 text-center border border-[var(--v2-border)] cursor-pointer hover:border-[var(--v2-primary)]/30 transition-all"
                  onClick={() => router.push('/v2/analytics')}
                >
                  <p className="text-xl sm:text-2xl font-bold text-[var(--v2-text-primary)]">{stats.agentStats.length}</p>
                  <p className="text-xs sm:text-sm text-[var(--v2-text-muted)]">automations</p>
                </div>
                <div
                  className="bg-[var(--v2-surface)] rounded-xl p-3 sm:p-4 text-center border border-[var(--v2-border)] cursor-pointer hover:border-[var(--v2-primary)]/30 transition-all"
                  onClick={() => router.push('/v2/analytics')}
                >
                  <p className="text-xl sm:text-2xl font-bold text-[var(--v2-text-primary)]">
                    {stats.totalTimeSavedSeconds > 0
                      ? `${Math.round(stats.totalTimeSavedSeconds / 3600)}h`
                      : '—'
                    }
                  </p>
                  <p className="text-xs sm:text-sm text-[var(--v2-text-muted)]">time saved this month</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Credits Card - Side by side */}
        <div
          className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4 sm:p-6 hover:border-amber-500/30 transition-all cursor-pointer flex flex-col justify-center lg:w-48"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
          onClick={() => router.push('/v2/billing')}
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-[var(--v2-text-muted)]">Pilot Credits</p>
            <ArrowRight className="w-4 h-4 text-[var(--v2-text-muted)]" />
          </div>
          {/* Circular Gauge - Centered */}
          <div className="flex flex-col items-center">
            <div className="relative w-20 h-20 sm:w-24 sm:h-24">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                {/* Background circle */}
                <circle cx="18" cy="18" r="14" fill="none" stroke="var(--v2-border)" strokeWidth="3"/>
                {/* Progress circle */}
                <circle
                  cx="18"
                  cy="18"
                  r="14"
                  fill="none"
                  stroke="url(#creditGradientV2)"
                  strokeWidth="3"
                  strokeDasharray="87.96"
                  strokeDashoffset={(() => {
                    const totalCredits = stats.creditBalance + stats.totalSpent
                    const remainingPercent = totalCredits > 0 ? (stats.creditBalance / totalCredits) : 1
                    return 87.96 * (1 - remainingPercent)
                  })()}
                  strokeLinecap="round"
                />
                <defs>
                  <linearGradient id="creditGradientV2" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#10b981"/>
                    <stop offset="50%" stopColor="#f59e0b"/>
                    <stop offset="100%" stopColor="#ef4444"/>
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm sm:text-base font-bold text-[var(--v2-text-primary)]">
                  {(() => {
                    const totalCredits = stats.creditBalance + stats.totalSpent
                    return Math.round(totalCredits > 0 ? (stats.creditBalance / totalCredits) * 100 : 100)
                  })()}%
                </span>
              </div>
            </div>
            <div className="text-center mt-3">
              <p className="text-xl sm:text-2xl font-bold text-[var(--v2-text-primary)]">
                {stats.creditBalance >= 1000
                  ? `${(stats.creditBalance / 1000).toFixed(1)}K`
                  : stats.creditBalance.toLocaleString()}
              </p>
              <p className="text-xs text-[var(--v2-text-muted)]">available</p>
            </div>
          </div>
        </div>
      </div>

      {/* Active Automations List */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">Active Automations</h2>
          <button
            onClick={() => router.push('/v2/agent-list')}
            className="text-sm text-[var(--v2-primary)] hover:text-[var(--v2-secondary)] transition-colors flex items-center gap-1"
          >
            View all <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {stats.agentStats.length > 0 ? (
          <div className="space-y-2">
            {(() => {
              const visibleAgents = stats.agentStats.slice(0, 4)
              const maxCount = Math.max(...visibleAgents.map(a => a.count), 1)

              return visibleAgents.map((agent, index) => {
                // Color palette for status bars and progress bars
                const colors = [
                  { bar: 'bg-blue-500', dot: 'bg-blue-500' },
                  { bar: 'bg-purple-500', dot: 'bg-purple-500' },
                  { bar: 'bg-amber-500', dot: 'bg-amber-500' },
                  { bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
                ]
                const color = colors[index % colors.length]
                const barWidth = agent.count > 0 ? Math.max((agent.count / maxCount) * 100, 5) : 0

                return (
                  <div
                    key={agent.id}
                    onClick={() => router.push(`/v2/agents/${agent.id}`)}
                    className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4 cursor-pointer hover:bg-[var(--v2-surface-hover)] hover:border-[var(--v2-border-hover)] transition-all active:scale-[0.99]"
                    style={{ borderRadius: 'var(--v2-radius-card)' }}
                  >
                    <div className="flex items-center gap-4">
                      {/* Status Bar - matches agent-list style */}
                      <div className={`w-1.5 h-12 rounded-full ${color.dot} flex-shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-[var(--v2-text-primary)] truncate">{agent.name}</p>
                        <p className="text-xs text-[var(--v2-text-muted)]">
                          {agent.lastRun ? `Last: ${getTimeAgo(new Date(agent.lastRun))}` : 'No runs yet'}
                        </p>
                      </div>
                      {/* Execution Progress Bar - Centered */}
                      <div className="flex-1 max-w-32 sm:max-w-48">
                        <div className="h-2 bg-[var(--v2-border)] rounded-full overflow-hidden">
                          <div
                            className={`h-full ${color.bar} rounded-full transition-all duration-500`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-medium text-[var(--v2-text-primary)]">{agent.count.toLocaleString()} runs</p>
                      </div>
                      <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0"></span>
                    </div>
                  </div>
                )
              })
            })()}
          </div>
        ) : (
          <div
            className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-8 text-center"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <Bot className="w-12 h-12 text-[var(--v2-text-muted)] opacity-30 mx-auto mb-3" />
            <p className="text-[var(--v2-text-muted)]">No active automations yet</p>
            <p className="text-sm text-[var(--v2-text-muted)] mt-1">Create your first automation above to get started</p>
          </div>
        )}
      </div>

      {/* Help Dialog */}
      <ModernHelpDialog
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
    </div>
  )
}
