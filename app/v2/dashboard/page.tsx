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
  Bot
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
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [searchQuery, setSearchQuery] = useState('')
  const [userName, setUserName] = useState<string>('')

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
    } else if (pilotCredits < 1000) {
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
        { data: profileData }
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
          .select('balance, total_spent, storage_quota_mb, storage_used_mb, executions_quota, executions_used')
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
          .single()
      ])

      // Set user name from profile
      if (profileData?.full_name) {
        setUserName(profileData.full_name)
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
      const systemAlerts = calculateSystemAlerts(
        failedCount || 0,
        subscriptionData?.storage_used_mb || 0,
        subscriptionData?.storage_quota_mb || 1000,
        subscriptionData?.executions_used || 0,
        subscriptionData?.executions_quota ?? null,
        pilotCredits
      )

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
      <div className="bg-[var(--v2-surface)] p-2.5 sm:p-3 shadow-[var(--v2-shadow-card)] flex items-center gap-2 sm:gap-3" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <Search className="w-4 h-4 sm:w-5 sm:h-5 text-[var(--v2-text-muted)] flex-shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Describe what you want to automate"
            className="flex-1 bg-transparent border-none outline-none text-sm sm:text-base text-[var(--v2-text-secondary)] placeholder:text-[var(--v2-text-muted)]"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchQuery.trim()) {
                router.push(`/v2/agents/new?prompt=${encodeURIComponent(searchQuery)}`)
              }
            }}
          />
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
                  System Alerts
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
