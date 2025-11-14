// lib/hooks/useDashboardData.ts
// Shared hook for dashboard data fetching - used by both V1 and V2

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'

export interface AgentStat {
  name: string
  count: number
  lastRun: string | null
}

export interface DashboardData {
  agentStats: AgentStat[]
  scheduledCount: number
  alertsCount: number
  totalMemories: number
  loading: boolean
  lastUpdated: Date
  totalRuns: number
  activeAgents: number
}

export interface UseDashboardDataOptions {
  userId: string | undefined
  autoRefresh?: boolean
  refreshInterval?: number // in milliseconds
}

export function useDashboardData({
  userId,
  autoRefresh = true,
  refreshInterval = 5 * 60 * 1000, // 5 minutes default
}: UseDashboardDataOptions) {
  const [agentStats, setAgentStats] = useState<AgentStat[]>([])
  const [scheduledCount, setScheduledCount] = useState(0)
  const [alertsCount, setAlertsCount] = useState(0)
  const [totalMemories, setTotalMemories] = useState(0)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  const fetchDashboardData = async () => {
    if (!userId) return

    // Don't set loading true on refresh - only on initial load
    // This prevents flickering by keeping old data visible
    if (agentStats.length === 0) {
      setLoading(true)
    }

    try {
      // Fetch agent stats
      const { data: stats, error: statsError } = await supabase
        .from('agent_stats')
        .select('agent_id, run_count, last_run_at, agents (agent_name)')
        .eq('user_id', userId)

      if (statsError) {
        console.error('❌ Failed to fetch agent stats:', statsError.message)
      } else {
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
      const { count: scheduledAgentsCount, error: scheduledError } = await supabase
        .from('agents')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('mode', 'scheduled')
        .eq('status', 'active')

      if (scheduledError) {
        console.error('❌ Failed to fetch scheduled agents:', scheduledError.message)
      } else {
        setScheduledCount(scheduledAgentsCount || 0)
      }

      // Fetch failed executions (alerts) from last 24 hours
      const oneDayAgo = new Date()
      oneDayAgo.setDate(oneDayAgo.getDate() - 1)

      const { count: failedCount, error: alertsError } = await supabase
        .from('agent_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'failed')
        .gte('created_at', oneDayAgo.toISOString())

      if (alertsError) {
        console.error('❌ Failed to fetch alerts:', alertsError.message)
      } else {
        setAlertsCount(failedCount || 0)
      }

      // Fetch total memories count
      const { count: memoriesCount, error: memoriesError } = await supabase
        .from('run_memories')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)

      if (memoriesError) {
        console.error('❌ Failed to fetch memories count:', memoriesError.message)
      } else {
        setTotalMemories(memoriesCount || 0)
      }

      setLastUpdated(new Date())
    } catch (error) {
      console.error('❌ Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDashboardData()

    // Auto-refresh if enabled
    if (autoRefresh && refreshInterval > 0) {
      const interval = setInterval(fetchDashboardData, refreshInterval)
      return () => clearInterval(interval)
    }
  }, [userId, autoRefresh, refreshInterval])

  // Derived stats
  const totalRuns = agentStats.reduce((sum, stat) => sum + stat.count, 0)
  const activeAgents = agentStats.filter((stat) => stat.count > 0).length

  return {
    agentStats,
    scheduledCount,
    alertsCount,
    totalMemories,
    loading,
    lastUpdated,
    totalRuns,
    activeAgents,
    refresh: fetchDashboardData,
  }
}
