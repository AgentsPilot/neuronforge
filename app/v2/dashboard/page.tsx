'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/v2/ui/card'
import { V2Logo, V2Controls } from '@/components/v2/V2Header'
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
  moneySavedPerWeek: number
  activeInsightsCount: number
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
    moneySavedPerWeek: 0,
    activeInsightsCount: 0
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
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const [systemStatusTimeFilter, setSystemStatusTimeFilter] = useState<7 | 30 | 90 | 'all'>(30)
  const [recentActivityTimeFilter, setRecentActivityTimeFilter] = useState<7 | 30 | 90 | 'all'>(30)

  const fetchDashboardData = async () => {
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
        { data: profileData },
        { data: promptIdeasData },
        { data: executions30d },
        { count: activeInsightsCount }
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
          .select('balance, total_spent')
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
          .select('id, status, logs')
          .eq('user_id', user.id)
          .neq('run_mode', 'calibration')
          .gte('started_at', systemStatusFilterDate),
        // Get active insights count (status = 'new' or 'viewed')
        supabase
          .from('execution_insights')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .in('status', ['new', 'viewed'])
      ])

      // Set user name from profile
      if (profileData?.full_name) {
        setUserName(profileData.full_name)
      }

      // Set prompt ideas if available
      if (promptIdeasData?.ideas) {
        setPromptIdeas(promptIdeasData.ideas)
      }

      // Count actual executions per agent
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

      // Parse agent stats using ACTUAL execution counts from agent_executions table
      const parsedStats: AgentStat[] = agentStatsData?.map((s) => {
        const agentData = s.agents as any
        const actualCount = executionCountMap.get(s.agent_id) || 0
        const lastRun = lastRunMap.get(s.agent_id) || s.last_run_at

        return {
          id: s.agent_id,
          name: agentData?.agent_name ?? 'Unknown Agent',
          count: actualCount, // Use actual count from agent_executions
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

      // Calculate total time saved and money saved from execution logs
      const DEFAULT_HOURLY_RATE = 50 // Default $50/hour
      const MINUTES_PER_STEP = 5 // Estimate: each workflow step saves 5 minutes of manual work
      let totalTimeSavedSeconds = 0

      executions30d?.forEach((execution: any) => {
        const logs = execution.logs as any

        // Try to get time_saved_seconds from metrics (if available)
        const timeSaved = logs?.metrics?.time_saved_seconds

        if (timeSaved !== null && timeSaved !== undefined && timeSaved > 0) {
          // Use actual metric if available
          totalTimeSavedSeconds += timeSaved
        } else {
          // Fallback estimation based on available data
          // 1. Try items processed (2 minutes per item)
          const itemsProcessed = logs?.metrics?.total_items ||
                                logs?.itemsProcessed ||
                                logs?.items_processed ||
                                0

          if (itemsProcessed > 0) {
            totalTimeSavedSeconds += itemsProcessed * 120 // 2 minutes per item
          } else {
            // 2. Estimate based on workflow steps completed
            const stepsCompleted = logs?.stepsCompleted || 0
            if (stepsCompleted > 0) {
              totalTimeSavedSeconds += stepsCompleted * (MINUTES_PER_STEP * 60) // 5 minutes per step
            }
          }
        }
      })

      // Calculate money saved per week (average from 30 days data)
      const timeSavedHours = totalTimeSavedSeconds / 3600
      const moneySaved30d = timeSavedHours * DEFAULT_HOURLY_RATE
      const moneySavedPerWeek = Math.round((moneySaved30d / 30) * 7)

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
        moneySavedPerWeek,
        activeInsightsCount: activeInsightsCount || 0
      })

      setLastUpdated(new Date())
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDashboardData()

    // Auto-refresh every 5 minutes
    const interval = setInterval(fetchDashboardData, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [user, systemStatusTimeFilter, recentActivityTimeFilter])

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
          <V2Controls />
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
          {/* Active Agents Card */}
          <Card
            hoverable
            onClick={() => router.push('/v2/agent-list')}
            className="cursor-pointer !p-3 sm:!p-4 !h-[280px] overflow-hidden !box-border active:scale-[0.98] transition-transform"
          >
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Bot className="w-6 h-6 sm:w-7 sm:h-7 text-[#10B981]" />
                  <h3 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
                    Active Agents
                  </h3>
                </div>
                <p className="text-sm text-[var(--v2-text-secondary)]">
                  Your running agents
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
                  <p className="text-xs text-[var(--v2-text-muted)]">No active agents yet</p>
                </div>
              )}
              </div>
            </Card>

          {/* System Status Card */}
          <Card
            hoverable
            onClick={() => router.push('/v2/analytics')}
            className="cursor-pointer !p-3 sm:!p-4 !h-[280px] overflow-hidden !box-border active:scale-[0.98] transition-transform"
          >
              <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-6 h-6 sm:w-7 sm:h-7 text-[#06B6D4]" />
                  <h3 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
                    System Status
                  </h3>
                </div>
                <select
                  value={systemStatusTimeFilter}
                  onChange={(e) => {
                    e.stopPropagation()
                    setSystemStatusTimeFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value) as 7 | 30 | 90)
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs px-3 py-1.5 rounded-lg bg-gradient-to-b from-[var(--v2-surface)] to-[var(--v2-surface-hover)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] font-medium cursor-pointer hover:border-[var(--v2-primary)] hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)]/20 transition-all duration-200"
                >
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="all">All time</option>
                </select>
              </div>
              <p className="text-sm text-[var(--v2-text-secondary)]">
                Overall health and performance
              </p>

              {/* Top Metrics Row */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                {/* Failures */}
                <div className="text-center p-2 rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)]">
                  <div className={`text-xl font-bold ${stats.alertsCount > 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {stats.alertsCount}
                  </div>
                  <div className="text-[10px] text-[var(--v2-text-muted)] mt-0.5">
                    Failed (24h)
                  </div>
                </div>

                {/* Success Rate */}
                <div className="text-center p-2 rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)]">
                  <div className={`text-xl font-bold ${
                    stats.successRate >= 95 ? 'text-green-500' :
                    stats.successRate >= 90 ? 'text-yellow-500' : 'text-red-500'
                  }`}>
                    {stats.successRate}%
                  </div>
                  <div className="text-[10px] text-[var(--v2-text-muted)] mt-0.5">
                    Success
                  </div>
                </div>

                {/* Money Saved */}
                <div className="text-center p-2 rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)]">
                  {stats.moneySavedPerWeek > 0 ? (
                    <>
                      <div className="text-xl font-bold text-green-500">
                        ${stats.moneySavedPerWeek.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-[var(--v2-text-muted)] mt-0.5">
                        Saved/Week
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-xl font-bold text-[var(--v2-text-muted)]">
                        —
                      </div>
                      <div className="text-[10px] text-[var(--v2-text-muted)] mt-0.5">
                        Calculating
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Summary Stats */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--v2-text-muted)]">
                    Total runs ({systemStatusTimeFilter === 'all' ? 'all time' : `${systemStatusTimeFilter}d`})
                  </span>
                  <span className="font-medium text-[var(--v2-text-primary)]">{stats.totalRuns30d.toLocaleString()}</span>
                </div>
                {stats.totalTimeSavedSeconds > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--v2-text-muted)]">Hours saved</span>
                    <span className="font-medium text-[var(--v2-text-primary)]">
                      {Math.round(stats.totalTimeSavedSeconds / 3600).toLocaleString()}
                    </span>
                  </div>
                )}
                {stats.activeInsightsCount > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--v2-text-muted)]">Active insights</span>
                    <span className="font-medium text-orange-500">{stats.activeInsightsCount}</span>
                  </div>
                )}
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
                <select
                  value={recentActivityTimeFilter}
                  onChange={(e) => {
                    setRecentActivityTimeFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value) as 7 | 30 | 90)
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-gradient-to-b from-[var(--v2-surface)] to-[var(--v2-surface-hover)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] font-medium cursor-pointer hover:border-[var(--v2-primary)] hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)]/20 transition-all duration-200"
                >
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="all">All time</option>
                </select>
              </div>
              <p className="text-sm text-[var(--v2-text-secondary)]">
                Top 3 most active agents
              </p>
              <div className="pt-2 pb-0">
                {stats.agentStats.length > 0 ? (
                  <div className="space-y-3">
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

                        return (
                          <div key={index} className="space-y-1.5">
                            {/* Agent name and count */}
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <div
                                  className="w-3 h-3 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: color }}
                                />
                                <span className="font-medium text-[var(--v2-text-primary)] truncate">
                                  {agent.name}
                                </span>
                              </div>
                              <span className="font-bold text-[var(--v2-text-primary)] ml-2">
                                {agent.count}
                              </span>
                            </div>

                            {/* Progress bar */}
                            <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-300"
                                style={{
                                  width: `${widthPercent}%`,
                                  backgroundColor: color,
                                  minWidth: agent.count > 0 ? '4px' : '0'
                                }}
                              />
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
                      <p className="text-xs">No agents created yet</p>
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
    </div>
  )
}
