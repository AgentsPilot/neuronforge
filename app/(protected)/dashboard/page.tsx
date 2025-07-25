'use client'

import React, { useEffect, useState } from 'react'
import LogoutButton from '@/components/LogoutButton'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import AgentStatsChart from '@/components/dashboard/AgentStatsChart'
import AgentStatsTable from '@/components/dashboard/AgentStatsTable'
import ScheduledAgentsCard from '@/components/dashboard/ScheduledAgentsCard'

export default function DashboardPage() {
  const { user } = useAuth()
  const [agentStats, setAgentStats] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const fetchDashboardData = async () => {
    if (!user) return

    const { data: stats, error: statsError } = await supabase
      .from('agent_stats')
      .select('agent_id, run_count, last_run_at, agents (agent_name)')
      .eq('user_id', user.id)

    if (statsError) {
      console.error('❌ Failed to fetch agent stats:', statsError.message)
    } else {
      const parsedStats = stats.map((s) => ({
        name: s.agents?.agent_name ?? 'Unknown Agent',
        count: s.run_count,
        lastRun: s.last_run_at,
      }))
      setAgentStats(parsedStats)
    }

    setLoading(false)
  }

  useEffect(() => {
    fetchDashboardData()
  }, [user])

  return (
    <div className="min-h-screen relative px-6 py-10 bg-gray-50">
      <div className="absolute top-4 right-4">
        <LogoutButton />
      </div>

      <h1 className="text-3xl font-bold mb-10 text-center text-gray-800">
        Welcome to your Dashboard
      </h1>

      {/* 📊 Agent Stats Table + Chart */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
        <AgentStatsTable />
        
        <AgentStatsChart />
      </div>

      {/* ⏰ Scheduled Agents Placeholder */}
      <div className="mb-12">
        <ScheduledAgentsCard />
      </div>

      {loading && (
        <p className="text-center text-gray-500">Loading agent stats...</p>
      )}
    </div>
  )
}