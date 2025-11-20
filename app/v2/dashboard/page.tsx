'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/v2/ui/card'
import { V2Header } from '@/components/v2/V2Header'
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
  BarChart3,
  Sparkles,
  MessageCircle,
  Database,
  Clock,
  ArrowRight,
  Mic,
  MicOff
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

interface SystemAlert {
  type: 'critical' | 'warning' | 'caution' | 'info'
  icon: string
  message: string
  severity: number // Higher = more critical
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
  systemAlerts: SystemAlert[]
}

export default function V2DashboardPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  //console.log('🔍 V2Dashboard - Auth State:', { user: !!user, authLoading })

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirect=/v2/dashboard')
    }
  }, [user, authLoading, router])

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
    systemAlerts: []
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

  // Calculate system alerts based on quota usage and failures
  const calculateSystemAlerts = (
    failedCount: number,
    storageUsedMB: number,
    storageQuotaMB: number,
    executionsUsed: number,
    executionsQuota: number | null,
    pilotCredits: number
  ): SystemAlert[] => {
    const alerts: SystemAlert[] = []

    // 1. Agent Failures (last 24h)
    if (failedCount > 0) {
      alerts.push({
        type: failedCount >= 10 ? 'critical' : failedCount >= 5 ? 'warning' : 'caution',
        icon: failedCount >= 10 ? '🔴' : failedCount >= 5 ? '🟠' : '🟡',
        message: `${failedCount} agent failure${failedCount > 1 ? 's' : ''} in last 24h`,
        severity: failedCount >= 10 ? 100 : failedCount >= 5 ? 80 : 60
      })
    }

    // 2. Storage Quota Warnings
    const storagePercent = storageQuotaMB > 0 ? (storageUsedMB / storageQuotaMB) * 100 : 0
    if (storagePercent >= 95) {
      alerts.push({
        type: 'critical',
        icon: '🔴',
        message: `Storage ${storagePercent.toFixed(0)}% full (${storageUsedMB} / ${storageQuotaMB} MB)`,
        severity: 95
      })
    } else if (storagePercent >= 80) {
      alerts.push({
        type: 'warning',
        icon: '🟠',
        message: `Storage ${storagePercent.toFixed(0)}% full (${storageUsedMB} / ${storageQuotaMB} MB)`,
        severity: 85
      })
    }

    // 3. Execution Quota Warnings (only if quota is not unlimited)
    if (executionsQuota !== null && executionsQuota > 0) {
      const executionPercent = (executionsUsed / executionsQuota) * 100
      if (executionPercent >= 95) {
        alerts.push({
          type: 'critical',
          icon: '🔴',
          message: `Executions ${executionPercent.toFixed(0)}% used (${executionsUsed} / ${executionsQuota})`,
          severity: 90
        })
      } else if (executionPercent >= 80) {
        alerts.push({
          type: 'warning',
          icon: '🟠',
          message: `Executions ${executionPercent.toFixed(0)}% used (${executionsUsed} / ${executionsQuota})`,
          severity: 82
        })
      }
    }

    // 4. Low Credit Balance Warnings
    if (pilotCredits < 100) {
      alerts.push({
        type: 'critical',
        icon: '🔴',
        message: `Low credits: ${pilotCredits} remaining`,
        severity: 98
      })
    } else if (pilotCredits <= 10000) {
      alerts.push({
        type: 'warning',
        icon: '🟠',
        message: `Low credits: ${pilotCredits.toLocaleString()} remaining`,
        severity: 75
      })
    }

    // Sort by severity (highest first) and return top 3
    return alerts.sort((a, b) => b.severity - a.severity).slice(0, 3)
  }

  const calculateFreeTierAlerts = (
    freeTierExpiresAt: string | null,
    accountFrozen: boolean,
    hasSubscription: boolean
  ): SystemAlert[] => {
    const alerts: SystemAlert[] = []

    // Only show free tier alerts if user doesn't have a paid subscription
    if (!hasSubscription && freeTierExpiresAt) {
      const expiresAt = new Date(freeTierExpiresAt)
      const now = new Date()
      const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

      if (accountFrozen || daysRemaining <= 0) {
        alerts.push({
          type: 'critical',
          icon: '🔴',
          message: 'Free tier expired - Purchase tokens to continue',
          severity: 999
        })
      } else if (daysRemaining <= 3) {
        alerts.push({
          type: 'critical',
          icon: '🔴',
          message: `Free tier expires in ${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'}!`,
          severity: 150
        })
      } else if (daysRemaining <= 7) {
        alerts.push({
          type: 'warning',
          icon: '🟠',
          message: `Free tier expires in ${daysRemaining} days`,
          severity: 120
        })
      } else if (daysRemaining <= 14) {
        alerts.push({
          type: 'caution',
          icon: '🟡',
          message: `Free tier expires in ${daysRemaining} days`,
          severity: 70
        })
      }
    }

    return alerts
  }

  const fetchDashboardData = async () => {
    if (!user) return

    try {
      // Fetch pricing config first
      const pricingConfig = await getPricingConfig(supabase)
      const tokensPerCredit = pricingConfig.tokens_per_pilot_credit

      // Calculate dynamic max credits based on subscription tier
      const maxCredits = 100000 // This could be fetched from subscription tier settings

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
        { data: promptIdeasData }
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
          .select('balance, total_spent, storage_quota_mb, storage_used_mb, executions_quota, executions_used, free_tier_expires_at, account_frozen, stripe_subscription_id')
          .eq('user_id', user.id)
          .single(),
        supabase
          .from('agent_logs')
          .select('id, agent_id, status, created_at, agents (agent_name)')
          .eq('user_id', user.id)
          .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .order('created_at', { ascending: false })
          .limit(200),
        // Get actual execution counts from agent_executions table
        supabase
          .from('agent_executions')
          .select('agent_id, started_at, agents!inner (agent_name, status)')
          .eq('agents.status', 'active')
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
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
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

      // Calculate system alerts
      const regularAlerts = calculateSystemAlerts(
        failedCount || 0,
        subscriptionData?.storage_used_mb || 0,
        subscriptionData?.storage_quota_mb || 1000,
        subscriptionData?.executions_used || 0,
        subscriptionData?.executions_quota ?? null,
        pilotCredits
      )

      // Calculate free tier alerts
      const freeTierAlerts = calculateFreeTierAlerts(
        subscriptionData?.free_tier_expires_at || null,
        subscriptionData?.account_frozen || false,
        !!subscriptionData?.stripe_subscription_id
      )

      // Merge alerts: free tier alerts first (higher priority), then regular alerts
      const systemAlerts = [...freeTierAlerts, ...regularAlerts]
        .sort((a, b) => b.severity - a.severity)
        .slice(0, 3)

      // Update all stats at once
      setStats({
        creditBalance: pilotCredits,
        totalSpent: totalSpentCredits,
        scheduledCount: scheduledAgentsCount || 0,
        alertsCount: failedCount || 0,
        totalMemories: memoriesCount || 0,
        agentStats: parsedStats,
        recentRuns: parsedRecentRuns,
        tokensPerCredit,
        maxCredits,
        systemAlerts
      })

      // Set account frozen status
      setAccountFrozen(subscriptionData?.account_frozen || false)

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
  }, [user])

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
          <V2Header />
        </div>
      </div>

      {/* Search Box */}
      <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)]" style={{ borderRadius: 'var(--v2-radius-card)' }}>
        <div className={`p-2.5 sm:p-3 ${accountFrozen || stats.creditBalance < 2000 ? 'opacity-50 cursor-not-allowed' : ''}`}>
          {/* Main Input Row */}
          <div className="flex items-start gap-2 sm:gap-3">
            <Search className="w-4 h-4 sm:w-5 sm:h-5 text-[var(--v2-text-muted)] flex-shrink-0 mt-1" />
            <textarea
              value={searchQuery}
              onChange={(e) => {
                if (!(accountFrozen || stats.creditBalance < 2000)) {
                  setSearchQuery(e.target.value)
                  // Auto-resize
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px'
                }
              }}
              placeholder={accountFrozen ? "Account frozen - Purchase tokens to continue" : stats.creditBalance < 2000 ? "Insufficient balance - Need 2000 tokens to create agent" : "Describe what you want to automate..."}
              className="flex-1 bg-transparent border-none outline-none text-sm sm:text-base text-[var(--v2-text-secondary)] placeholder:text-[var(--v2-text-muted)] resize-none min-h-[40px] max-h-32"
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

      {/* Prompt Ideas Suggestions */}
      {showIdeas && promptIdeas.length > 0 && (
        <div className="bg-[var(--v2-surface)] p-3 sm:p-4 shadow-[var(--v2-shadow-card)] space-y-2" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">Your Personalized Agent Ideas</h3>
            <button
              onClick={() => setShowIdeas(false)}
              className="text-xs text-[var(--v2-text-muted)] hover:text-[var(--v2-text-secondary)]"
            >
              ×
            </button>
          </div>
          <p className="text-xs text-[var(--v2-text-muted)] mb-3">
            Click any idea to fill the search box above, then press Enter to create your agent
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {promptIdeas.slice(0, 6).map((idea: any, index: number) => {
              // Get category icon
              const getCategoryIcon = () => {
                switch (idea.category) {
                  case 'analytics':
                    return <BarChart3 className="w-4 h-4" />
                  case 'automation':
                    return <Sparkles className="w-4 h-4" />
                  case 'communication':
                    return <MessageCircle className="w-4 h-4" />
                  case 'data':
                    return <Database className="w-4 h-4" />
                  case 'scheduling':
                    return <Clock className="w-4 h-4" />
                  default:
                    return <Sparkles className="w-4 h-4" />
                }
              }

              // Get category icon color - using V2 design system colors
              const getCategoryColor = () => {
                switch (idea.category) {
                  case 'analytics':
                    return '#06B6D4' // Cyan (like System Alerts card)
                  case 'automation':
                    return '#8B5CF6' // Purple (like Activity card)
                  case 'communication':
                    return '#10B981' // Green (like Active Agents card)
                  case 'data':
                    return '#F59E0B' // Orange/Amber (like Credits card)
                  case 'scheduling':
                    return '#6366F1' // Indigo
                  default:
                    return '#64748B' // Slate
                }
              }

              // Get complexity badge
              const getComplexityBadge = () => {
                switch (idea.complexity) {
                  case 'simple':
                    return (
                      <span className="text-[10px] px-1.5 py-0.5 bg-green-500/20 rounded-full text-green-500 font-medium">
                        Simple
                      </span>
                    )
                  case 'moderate':
                    return (
                      <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500/20 rounded-full text-yellow-500 font-medium">
                        Moderate
                      </span>
                    )
                  case 'advanced':
                    return (
                      <span className="text-[10px] px-1.5 py-0.5 bg-red-500/20 rounded-full text-red-500 font-medium">
                        Advanced
                      </span>
                    )
                  default:
                    return null
                }
              }

              const categoryColor = getCategoryColor()

              return (
                <button
                  key={index}
                  onClick={() => {
                    setSearchQuery(idea.prompt)
                    setShowIdeas(false)
                    // Focus the search input after a brief delay
                    setTimeout(() => {
                      const searchInput = document.querySelector('input[type="text"]') as HTMLInputElement
                      if (searchInput) {
                        searchInput.focus()
                        searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      }
                    }, 100)
                  }}
                  className="text-left p-3 bg-[var(--v2-surface-secondary)] hover:bg-[var(--v2-surface-hover)] border border-[var(--v2-border)] rounded-lg transition-all duration-200 group relative"
                >
                  {/* Header with icon and title */}
                  <div className="flex items-start gap-2 mb-2">
                    <div
                      className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${categoryColor}20`, color: categoryColor }}
                    >
                      {getCategoryIcon()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-[var(--v2-text-primary)] line-clamp-1">
                        {idea.title}
                      </h4>
                      <p className="text-xs text-[var(--v2-text-muted)] capitalize mt-0.5">
                        {idea.category}
                      </p>
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-[var(--v2-text-secondary)] line-clamp-3 mb-3">
                    {idea.description}
                  </p>

                  {/* Metadata footer */}
                  <div className="flex items-center justify-between pt-2 border-t border-[var(--v2-border)]">
                    <div className="flex items-center gap-2">
                      {getComplexityBadge()}
                      <div className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3 text-[var(--v2-text-muted)]" />
                        <span className="text-[10px] text-[var(--v2-text-muted)]">
                          ~{(idea.estimatedTokens / 1000).toFixed(1)}k
                        </span>
                      </div>
                    </div>
                    <span
                      className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity font-medium"
                      style={{ color: categoryColor }}
                    >
                      Use this →
                    </span>
                  </div>

                  {/* Number badge */}
                  <div
                    className="absolute -top-2 -left-2 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-lg border-2 border-[var(--v2-surface)]"
                    style={{ backgroundColor: categoryColor }}
                  >
                    {index + 1}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

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
                  {/* Total Executions */}
                  <div className="flex items-center justify-between pb-2 border-b border-gray-200 dark:border-gray-700">
                    <div className="text-xs text-[var(--v2-text-muted)]">Total Executions</div>
                    <div className="text-2xl font-bold text-[var(--v2-text-primary)]">
                      {totalRuns.toLocaleString()}
                    </div>
                  </div>

                  {/* Agent List */}
                  <div className="space-y-2">
                    {stats.agentStats.slice(0, 3).map((agent, index) => (
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
                    {stats.agentStats.length > 3 && (
                      <div className="text-center pt-1">
                        <span className="text-xs text-[var(--v2-text-muted)]">
                          +{stats.agentStats.length - 3} more
                        </span>
                      </div>
                    )}
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

          {/* System Alerts Card */}
          <Card
            hoverable
            className="!p-3 sm:!p-4 !h-[280px] overflow-hidden !box-border"
          >
              <div className="space-y-2 h-full flex flex-col">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-6 h-6 sm:w-7 sm:h-7 text-[#06B6D4]" />
                <h3 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
                  Client Risk Alert
                </h3>
              </div>
              <p className="text-sm text-[var(--v2-text-secondary)]">
                Monitor potential issues and failures
              </p>

              {/* Alert List */}
              <div className="flex-1 overflow-y-auto pt-1">
                {stats.systemAlerts.length > 0 ? (
                  <div className="space-y-2.5">
                    {stats.systemAlerts.map((alert, index) => (
                      <div
                        key={index}
                        className={`flex items-start gap-3 p-3 transition-all duration-200 ${
                          alert.type === 'critical'
                            ? 'bg-gradient-to-r from-red-50 to-red-50/50 dark:from-red-950/30 dark:to-red-950/10 border-l-4 border-red-500'
                            : alert.type === 'warning'
                            ? 'bg-gradient-to-r from-orange-50 to-orange-50/50 dark:from-orange-950/30 dark:to-orange-950/10 border-l-4 border-orange-500'
                            : 'bg-gradient-to-r from-yellow-50 to-yellow-50/50 dark:from-yellow-950/30 dark:to-yellow-950/10 border-l-4 border-yellow-500'
                        }`}
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        <div className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full ${
                          alert.type === 'critical'
                            ? 'bg-red-100 dark:bg-red-900/40'
                            : alert.type === 'warning'
                            ? 'bg-orange-100 dark:bg-orange-900/40'
                            : 'bg-yellow-100 dark:bg-yellow-900/40'
                        }`}>
                          <span className="text-base">{alert.icon}</span>
                        </div>
                        <div className="flex-1 min-w-0 pt-1">
                          <p className={`text-xs font-medium leading-relaxed ${
                            alert.type === 'critical'
                              ? 'text-red-800 dark:text-red-200'
                              : alert.type === 'warning'
                              ? 'text-orange-800 dark:text-orange-200'
                              : 'text-yellow-800 dark:text-yellow-200'
                          }`}>
                            {alert.message}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center py-6">
                    <div className="w-16 h-16 rounded-full bg-green-50 dark:bg-green-950/30 flex items-center justify-center mb-3">
                      <CheckCircle2 className="w-8 h-8 text-green-500" />
                    </div>
                    <p className="text-sm font-semibold text-green-600 dark:text-green-400">All systems operational</p>
                    <p className="text-xs text-[var(--v2-text-muted)] mt-1">No issues detected</p>
                  </div>
                )}
              </div>
              </div>
            </Card>

          {/* Recent Activity Card - Horizontal Bar List */}
          <Card
            hoverable
            className="!p-3 sm:!p-4 !h-[280px] overflow-hidden !box-border"
          >
              <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Activity className="w-6 h-6 sm:w-7 sm:h-7 text-[#8B5CF6]" />
                <h3 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
                  Recent Activity
                </h3>
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

                {/* Right side - Speedometer Gauge - Responsive sizing */}
                <div className="flex-shrink-0 w-full sm:w-[240px] md:w-[260px] max-w-[280px]">
                  <div className="relative" style={{ height: '165px' }}>
                    {/* Recharts Gauge Arc */}
                    <ResponsiveContainer width="100%" height={165}>
                      <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                        <Pie
                          data={[
                            { value: 33.33 },
                            { value: 33.33 },
                            { value: 33.34 }
                          ]}
                          cx="50%"
                          cy="70%"
                          startAngle={180}
                          endAngle={0}
                          innerRadius="85%"
                          outerRadius="100%"
                          dataKey="value"
                          stroke="none"
                        >
                          <Cell fill="#10B981" />
                          <Cell fill="#F59E0B" />
                          <Cell fill="#EF4444" />
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>

                    {/* Needle pointer - Correctly points to usage % */}
                    <div
                      className="absolute"
                      style={{
                        left: '50%',
                        bottom: '30%',
                        width: '2px',
                        height: '70px',
                        backgroundColor: '#DC2626',
                        transformOrigin: 'bottom center',
                        transform: (() => {
                          const totalCredits = stats.creditBalance + stats.totalSpent
                          const percentage = totalCredits > 0 ? (stats.totalSpent / totalCredits) * 100 : 0
                          // Correct angle: 0% = -90deg (left/9 o'clock), 100% = 90deg (right/3 o'clock)
                          const angle = -90 + (percentage * 1.8)
                          return `translateX(-50%) rotate(${angle}deg)`
                        })(),
                        transition: 'transform 0.8s cubic-bezier(0.4, 0.0, 0.2, 1)',
                        filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.4))',
                        zIndex: 10
                      }}
                    >
                      {/* Needle tip - pointing upward */}
                      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-r-[4px] border-b-[6px] border-l-transparent border-r-transparent border-b-[#DC2626]" />
                    </div>

                    {/* Center dot */}
                    <div
                      className="absolute w-[16px] h-[16px] bg-[#DC2626] rounded-full border-2 border-white dark:border-slate-800"
                      style={{
                        left: '50%',
                        bottom: '30%',
                        transform: 'translate(-50%, 50%)',
                        zIndex: 12,
                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                      }}
                    />

                    {/* Percentage Display */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ top: '0' }}>
                      <div className="text-2xl font-bold text-[var(--v2-text-primary)]">
                        {(() => {
                          const totalCredits = stats.creditBalance + stats.totalSpent
                          return Math.round(totalCredits > 0 ? (stats.totalSpent / totalCredits) * 100 : 0)
                        })()}%
                      </div>
                      <div className="text-[10px] text-[var(--v2-text-muted)] mt-0.5">used</div>
                    </div>

                    {/* 0% and 100% Labels - Below gauge arc */}
                    <div className="absolute bottom-1 left-0 right-0 flex justify-between text-xs text-[var(--v2-text-muted)] px-3">
                      <span>0%</span>
                      <span>100%</span>
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
