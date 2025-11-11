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
    maxCredits: 100000
  })
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [searchQuery, setSearchQuery] = useState('')

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
        { data: recentRunsData }
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
          .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .order('created_at', { ascending: false })
          .limit(200)
      ])

      // Parse agent stats (already filtered for active agents at query level)
      const parsedStats: AgentStat[] = agentStatsData?.map((s) => {
        const agentData = s.agents as any
        return {
          id: s.agent_id,
          name: agentData?.agent_name ?? 'Unknown Agent',
          count: s.run_count,
          lastRun: s.last_run_at,
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
        maxCredits
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

  const userName = user?.email?.split('@')[0] || 'there'
  const capitalizedName = userName.charAt(0).toUpperCase() + userName.slice(1)

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
                router.push(`/agents/new?prompt=${encodeURIComponent(searchQuery)}`)
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
            className="cursor-pointer !p-4 !h-[280px] overflow-hidden !box-border"
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
                        className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-200 cursor-pointer"
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

          {/* Client Risk Alerts Card */}
          <Card
            hoverable
            onClick={() => router.push('/v2/analytics')}
            className="cursor-pointer !p-4 !h-[280px] overflow-hidden !box-border"
          >
              <div className="space-y-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-6 h-6 sm:w-7 sm:h-7 text-[#06B6D4]" />
                <h3 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
                  System Alerts
                </h3>
              </div>
              <p className="text-sm text-[var(--v2-text-secondary)]">
                Monitor potential issues and failures
              </p>
              <div className="pt-0">
                <div className={`text-2xl sm:text-3xl font-bold ${stats.alertsCount > 0 ? 'text-red-500' : 'text-green-500'}`}>
                  {stats.alertsCount}
                </div>
                <div className="text-xs text-[var(--v2-text-muted)] mt-0.5">
                  {stats.alertsCount > 0 ? 'failures in last 24h' : 'all systems operational'}
                </div>
              </div>
              </div>
            </Card>

          {/* Recent Runs Card - Activity Graph */}
          <Card
            hoverable
            onClick={() => router.push('/agents')}
            className="cursor-pointer !p-4 !h-[280px] overflow-hidden !box-border"
          >
              <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Activity className="w-6 h-6 sm:w-7 sm:h-7 text-[#8B5CF6]" />
                <h3 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
                  Recent Activity
                </h3>
              </div>
              <p className="text-sm text-[var(--v2-text-secondary)]">
                Agent execution trends
              </p>
              <div className="pt-0 pb-0">
                {stats.agentStats.length > 0 ? (
                  <div className="h-[140px] relative">
                    {(() => {
                      // Sort active agents from low to high (already filtered for status='active' at query level)
                      const sortedAgents = [...stats.agentStats]
                        .sort((a, b) => a.count - b.count) // Low to high
                        .slice(0, 8) // Show top 8 agents

                      const maxCount = Math.max(...sortedAgents.map(a => a.count), 1)
                      const graphHeight = 105
                      const graphWidth = 100

                      // Calculate points for line graph
                      const pointSpacing = sortedAgents.length > 1 ? graphWidth / (sortedAgents.length - 1) : graphWidth / 2

                      const points = sortedAgents.map((agent, i) => {
                        const x = sortedAgents.length > 1 ? i * pointSpacing : graphWidth / 2
                        // Calculate y position: higher count = lower y value (closer to top)
                        const normalizedHeight = (agent.count / maxCount) * (graphHeight * 0.8) // Use 80% of height for better visibility
                        const y = graphHeight - normalizedHeight - (graphHeight * 0.1) // Add 10% padding at bottom

                        return {
                          x,
                          y,
                          count: agent.count,
                          name: agent.name
                        }
                      })

                      // Create smooth SVG path using cardinal splines for a truly flowing line
                      const createSmoothPath = (points: any[]) => {
                        if (points.length === 0) return ''
                        if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
                        if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`

                        const tension = 0.3 // Smoothness factor (0-1, where 0.5 is balanced)
                        let path = `M ${points[0].x} ${points[0].y}`

                        for (let i = 0; i < points.length - 1; i++) {
                          const p0 = points[Math.max(i - 1, 0)]
                          const p1 = points[i]
                          const p2 = points[i + 1]
                          const p3 = points[Math.min(i + 2, points.length - 1)]

                          // Calculate control points using Catmull-Rom to Bezier conversion
                          const cp1x = p1.x + (p2.x - p0.x) / 6 * tension
                          const cp1y = p1.y + (p2.y - p0.y) / 6 * tension
                          const cp2x = p2.x - (p3.x - p1.x) / 6 * tension
                          const cp2y = p2.y - (p3.y - p1.y) / 6 * tension

                          path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
                        }

                        return path
                      }

                      const linePath = createSmoothPath(points)

                      // Create smooth area path (filled area under the line)
                      const areaPath = points.length > 0
                        ? `${linePath} L ${points[points.length - 1].x} ${graphHeight} L ${points[0].x} ${graphHeight} Z`
                        : ''

                      return (
                        <>
                          {/* SVG Line Graph */}
                          <svg className="w-full h-[105px]" viewBox={`0 0 ${graphWidth} ${graphHeight}`} preserveAspectRatio="none">
                            {/* Gradient definition */}
                            <defs>
                              <linearGradient id="activityGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.2" />
                                <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0.02" />
                              </linearGradient>
                            </defs>

                            {/* Area under the line - subtle fill */}
                            <path
                              d={areaPath}
                              fill="url(#activityGradient)"
                            />

                            {/* Main line - smooth purple curve */}
                            <path
                              d={linePath}
                              fill="none"
                              stroke="#8B5CF6"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="dark:opacity-90"
                              style={{ filter: 'drop-shadow(0 1px 2px rgba(139, 92, 246, 0.3))' }}
                            />

                            {/* Data points - subtle */}
                            {points.map((point, i) => (
                              <g key={i}>
                                <circle
                                  cx={point.x}
                                  cy={point.y}
                                  r="3"
                                  fill="#8B5CF6"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  opacity="0.9"
                                  className="dark:stroke-slate-700"
                                  style={{ color: '#ffffff' }}
                                />
                              </g>
                            ))}
                          </svg>

                          {/* Agent names and counts below */}
                          <div className="flex justify-between mt-2 px-1 gap-0.5">
                            {sortedAgents.map((agent, index) => (
                              <div
                                key={index}
                                className="flex flex-col items-center flex-1 min-w-0 group relative"
                              >
                                <div className="text-[11px] font-bold text-[var(--v2-text-primary)] mb-0.5">
                                  {agent.count}
                                </div>
                                <div
                                  className="text-[9px] text-[var(--v2-text-muted)] truncate max-w-full w-full text-center px-0.5 cursor-help"
                                  style={{
                                    fontSize: sortedAgents.length > 5 ? '8px' : '9px',
                                    lineHeight: '1.2'
                                  }}
                                >
                                  {agent.name.length > (sortedAgents.length > 5 ? 8 : 12)
                                    ? agent.name.substring(0, sortedAgents.length > 5 ? 8 : 12) + '...'
                                    : agent.name}
                                </div>

                                {/* Tooltip - shows full agent name on hover */}
                                <div className="absolute bottom-full mb-2 hidden group-hover:block z-50 pointer-events-none">
                                  <div className="bg-gray-900 dark:bg-gray-700 text-white text-xs px-3 py-2 rounded-lg shadow-lg whitespace-nowrap">
                                    {agent.name}
                                    <div className="text-[10px] text-gray-300 mt-0.5">
                                      {agent.count} {agent.count === 1 ? 'execution' : 'executions'}
                                    </div>
                                    {/* Arrow */}
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
                                      <div className="border-4 border-transparent border-t-gray-900 dark:border-t-gray-700"></div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )
                    })()}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[140px] text-[var(--v2-text-muted)]">
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
            className="cursor-pointer !p-4 !h-[280px] overflow-hidden !box-border"
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

              {/* Content: Text on left, Gauge on right */}
              <div className="flex items-center justify-between gap-4 pt-0 pb-0">
                {/* Left side - Stats */}
                <div className="flex-1 space-y-2">
                  <div>
                    <div className="text-xs text-[var(--v2-text-muted)] mb-1">Available</div>
                    <div className="text-2xl sm:text-3xl font-bold text-[var(--v2-text-primary)]">
                      {stats.creditBalance >= 1000
                        ? `${(stats.creditBalance / 1000).toFixed(1)}K`
                        : stats.creditBalance.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-[var(--v2-text-muted)] mb-1">Used</div>
                    <div className="text-lg font-semibold text-[var(--v2-text-secondary)]">
                      {stats.totalSpent >= 1000
                        ? `${(stats.totalSpent / 1000).toFixed(1)}K`
                        : stats.totalSpent.toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Right side - Speedometer Gauge */}
                <div className="flex-shrink-0 w-[260px]">
                  <div className="relative" style={{ height: '165px' }}>
                    {/* Recharts Gauge Arc */}
                    <ResponsiveContainer width={260} height={165}>
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
