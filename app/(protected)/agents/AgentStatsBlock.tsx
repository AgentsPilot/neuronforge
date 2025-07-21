'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type Props = {
  agentId: string
}

export default function AgentStatsBlock({ agentId }: Props) {
  const [stats, setStats] = useState<{
    run_count: number
    success_count: number
    last_run_at: string | null
  } | null>(null)

  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      const { data, error } = await supabase
        .from('agent_stats')
        .select('run_count, success_count, last_run_at')
        .eq('agent_id', agentId)
        .single()

      if (error) {
        console.error('❌ Error loading agent stats:', error.message)
      } else {
        setStats(data)
      }

      setLoading(false)
    }

    fetchStats()
  }, [agentId])

  if (loading) {
    return <div className="text-sm text-gray-500">Loading stats...</div>
  }

  if (!stats) {
    return <div className="text-sm text-gray-500">No stats available.</div>
  }

  return (
    <div className="bg-white rounded-xl p-6 shadow border border-gray-100">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">Agent Stats</h3>
      <div className="space-y-2 text-sm text-gray-700">
        <div>
          <strong>Total Runs:</strong> {stats.run_count}
        </div>
        <div>
          <strong>Successful Runs:</strong> {stats.success_count}
        </div>
        <div>
          <strong>Last Run:</strong>{' '}
          {stats.last_run_at ? new Date(stats.last_run_at).toLocaleString() : 'Never'}
        </div>
      </div>
    </div>
  )
}