'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { Panel } from '@/components/v2/ui/panel'
import { Card } from '@/components/v2/ui/card'
import { Button } from '@/components/v2/ui/button'
import { Input } from '@/components/v2/ui/input'
import { UserMenu } from '@/components/v2/UserMenu'
import {
  Search,
  Mail,
  FileText,
  AlertCircle,
  TrendingUp,
  Clock,
  Activity,
  Plus,
  Star,
  MoreHorizontal,
  Play
} from 'lucide-react'

interface AgentStat {
  name: string
  count: number
  lastRun: string | null
}

export default function V2DashboardPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [agentStats, setAgentStats] = useState<AgentStat[]>([])
  const [scheduledCount, setScheduledCount] = useState(0)
  const [alertsCount, setAlertsCount] = useState(0)
  const [totalMemories, setTotalMemories] = useState(0)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [searchQuery, setSearchQuery] = useState('')

  const fetchDashboardData = async () => {
    if (!user) return

    try {
      // Fetch agent stats
      const { data: stats, error: statsError } = await supabase
        .from('agent_stats')
        .select('agent_id, run_count, last_run_at, agents (agent_name)')
        .eq('user_id', user.id)

      if (!statsError && stats) {
        const parsedStats = stats.map((s) => {
          const agentData = s.agents as any
          return {
            name: agentData?.agent_name ?? 'Unknown Agent',
            count: s.run_count,
            lastRun: s.last_run_at,
          }
        })
        setAgentStats(parsedStats)
      }

      // Fetch scheduled agents count
      const { count: scheduledAgentsCount } = await supabase
        .from('agents')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('mode', 'scheduled')
        .eq('status', 'active')

      setScheduledCount(scheduledAgentsCount || 0)

      // Fetch failed executions (alerts) from last 24 hours
      const oneDayAgo = new Date()
      oneDayAgo.setDate(oneDayAgo.getDate() - 1)

      const { count: failedCount } = await supabase
        .from('agent_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'failed')
        .gte('created_at', oneDayAgo.toISOString())

      setAlertsCount(failedCount || 0)

      // Fetch total memories count
      const { count: memoriesCount } = await supabase
        .from('run_memories')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)

      setTotalMemories(memoriesCount || 0)

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
  const totalRuns = agentStats.reduce((sum, stat) => sum + stat.count, 0)
  const lastRunTime = agentStats.length > 0 && agentStats[0].lastRun
    ? new Date(agentStats[0].lastRun)
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
    <div className="relative">
      {/* User Menu with Settings Icon */}
      <div className="absolute top-0 right-0 z-10">
        <UserMenu triggerIcon="settings" />
      </div>

      <div className="space-y-4 sm:space-y-5 lg:space-y-6">
        {/* Header */}
        <div className="pr-12 sm:pr-14">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-[var(--v2-text-primary)] mb-1 leading-tight">
            Hi {capitalizedName},
          </h1>
          <p className="text-base sm:text-lg lg:text-xl text-[var(--v2-text-secondary)] font-normal">
            what do you want to automate today?
          </p>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          {/* Weekly Summary Card */}
          <Card
            hoverable
            onClick={() => router.push('/agents')}
            className="cursor-pointer p-4 sm:p-5"
          >
            <div className="space-y-2 sm:space-y-3">
              <h3 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
                Active Agents
              </h3>
              <div className="flex items-center gap-2">
                <Mail className="w-6 h-6 sm:w-7 sm:h-7 text-[#EA4335]" />
                <FileText className="w-6 h-6 sm:w-7 sm:h-7 text-[#00A4EF]" />
              </div>
              <p className="text-sm text-[var(--v2-text-secondary)]">
                {agentStats.length > 0
                  ? `${agentStats.length} automation${agentStats.length !== 1 ? 's' : ''} running`
                  : 'No agents created yet'}
              </p>
              {agentStats.length > 0 && (
                <div className="pt-1">
                  <div className="text-2xl sm:text-3xl font-bold text-[var(--v2-text-primary)]">
                    {totalRuns.toLocaleString()}
                  </div>
                  <div className="text-xs text-[var(--v2-text-muted)] mt-0.5">
                    total executions
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Client Risk Alerts Card */}
          <Card
            hoverable
            onClick={() => router.push('/v2/analytics')}
            className="cursor-pointer p-4 sm:p-5"
          >
            <div className="space-y-2 sm:space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-6 h-6 sm:w-7 sm:h-7 text-[#06B6D4]" />
                <h3 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
                  System Alerts
                </h3>
              </div>
              <p className="text-sm text-[var(--v2-text-secondary)]">
                Monitor potential issues and failures
              </p>
              <div className="pt-1">
                <div className={`text-2xl sm:text-3xl font-bold ${alertsCount > 0 ? 'text-red-500' : 'text-green-500'}`}>
                  {alertsCount}
                </div>
                <div className="text-xs text-[var(--v2-text-muted)] mt-0.5">
                  {alertsCount > 0 ? 'failures in last 24h' : 'all systems operational'}
                </div>
              </div>
            </div>
          </Card>

          {/* Recent Runs Card */}
          <Card
            hoverable
            onClick={() => router.push('/agents')}
            className="cursor-pointer p-4 sm:p-5"
          >
            <div className="space-y-2 sm:space-y-3">
              <h3 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
                Recent Runs
              </h3>
              <div className="h-[100px] flex items-end gap-2">
                {/* Simple bar chart visualization */}
                {agentStats.slice(0, 8).map((stat, index) => {
                  const maxCount = Math.max(...agentStats.map(s => s.count))
                  const height = (stat.count / maxCount) * 100
                  return (
                    <div
                      key={index}
                      className="flex-1 bg-gradient-to-t from-[var(--v2-primary)] to-[var(--v2-secondary)] rounded-t-lg opacity-80 hover:opacity-100 transition-opacity"
                      style={{ height: `${height}%`, minHeight: '20%' }}
                      title={`${stat.name}: ${stat.count} runs`}
                    />
                  )
                })}
                {agentStats.length === 0 && (
                  <div className="w-full h-full flex items-center justify-center text-[var(--v2-text-muted)]">
                    <Activity className="w-12 h-12 opacity-20" />
                  </div>
                )}
              </div>
              {agentStats.length > 0 && (
                <p className="text-xs sm:text-sm text-[var(--v2-text-muted)]">
                  Activity across {agentStats.length} agent{agentStats.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          </Card>

          {/* Analytics Card */}
          <Card
            hoverable
            onClick={() => router.push('/v2/analytics')}
            className="cursor-pointer p-4 sm:p-5"
          >
            <div className="space-y-2 sm:space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
                  Analytics
                </h3>
                <TrendingUp className="w-5 h-5 text-[var(--v2-text-muted)]" />
              </div>

              <div className="flex items-center justify-between gap-3">
                {/* Mini trend line */}
                <svg className="w-16 h-10 sm:w-20 sm:h-12 opacity-30" viewBox="0 0 120 60" preserveAspectRatio="none">
                  <path
                    d="M 0 45 Q 30 40, 60 42 T 120 38"
                    stroke="currentColor"
                    strokeWidth="3"
                    fill="none"
                    strokeLinecap="round"
                    className="text-[var(--v2-text-secondary)]"
                  />
                </svg>

                {/* Success rate gauge */}
                <div className="relative w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0">
                  <svg viewBox="0 0 140 140">
                    <defs>
                      <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style={{ stopColor: '#06B6D4', stopOpacity: 1 }} />
                        <stop offset="100%" style={{ stopColor: '#10B981', stopOpacity: 1 }} />
                      </linearGradient>
                    </defs>
                    {/* Background circle */}
                    <circle cx="70" cy="70" r="55" fill="none" stroke="#E5E7EB" strokeWidth="12" className="dark:stroke-gray-700"/>
                    {/* Progress arc */}
                    <circle
                      cx="70"
                      cy="70"
                      r="55"
                      fill="none"
                      stroke="url(#gaugeGradient)"
                      strokeWidth="12"
                      strokeDasharray={`${totalRuns > 0 ? ((totalRuns - alertsCount) / totalRuns) * 345 : 0} 345`}
                      strokeLinecap="round"
                      transform="rotate(-90 70 70)"
                    />
                    {/* Center text */}
                    <text
                      x="70"
                      y="75"
                      textAnchor="middle"
                      className="text-lg sm:text-xl font-bold fill-[var(--v2-text-primary)]"
                    >
                      {totalRuns > 0 ? Math.round(((totalRuns - alertsCount) / totalRuns) * 100) : 100}%
                    </text>
                  </svg>
                </div>
              </div>

              <p className="text-xs text-[var(--v2-text-muted)]">
                Success rate across all automations
              </p>
            </div>
          </Card>
        </div>

        {/* Bottom Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
          {/* Last Run */}
          <div className="flex items-center gap-2 text-sm text-[var(--v2-text-secondary)]">
            <Clock className="w-4 h-4 text-[var(--v2-text-muted)]" />
            <span>Last Run</span>
            <span className="font-medium text-[var(--v2-text-primary)]">
              {getTimeAgo(lastRunTime)}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 sm:gap-2.5 overflow-x-auto pb-2 sm:pb-0 w-full sm:w-auto">
            <button
              onClick={() => router.push('/agents')}
              className="w-9 h-9 sm:w-10 sm:h-10 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] flex items-center justify-center hover:scale-105 transition-transform duration-200 flex-shrink-0"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title="View Agents"
            >
              <Activity className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-[#3B82F6]" />
            </button>

            <button
              onClick={() => router.push('/integrations')}
              className="w-9 h-9 sm:w-10 sm:h-10 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] flex items-center justify-center hover:scale-105 transition-transform duration-200 flex-shrink-0"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title="Integrations"
            >
              <FileText className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-[#10B981]" />
            </button>

            <button
              onClick={() => router.push('/agents/new')}
              className="w-9 h-9 sm:w-10 sm:h-10 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] flex items-center justify-center hover:scale-105 transition-transform duration-200 flex-shrink-0"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title="Create New Agent"
            >
              <Plus className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-[#3B82F6]" />
            </button>

            <button
              onClick={() => router.push('/v2/monitoring')}
              className="w-9 h-9 sm:w-10 sm:h-10 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] flex items-center justify-center hover:scale-105 transition-transform duration-200 flex-shrink-0"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title="Monitoring"
            >
              <Star className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-[#06B6D4]" />
            </button>

            <button
              className="w-9 h-9 sm:w-10 sm:h-10 bg-gray-100 dark:bg-gray-800 flex items-center justify-center hover:scale-105 transition-transform duration-200 flex-shrink-0"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title="More Options"
            >
              <MoreHorizontal className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-[var(--v2-text-secondary)]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
