'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { RefreshCw } from 'lucide-react'

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

  const fetchStats = async () => {
    setLoading(true)

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

  useEffect(() => {
    fetchStats()
  }, [agentId])

  if (loading) {
    return <div className="text-sm text-gray-500">Loading stats...</div>
  }

  if (!stats) {
    return <div className="text-sm text-gray-500">No stats available.</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            Performance Statistics
          </h2>
          <p className="text-gray-600 text-sm mt-1">
            Agent execution metrics and performance
          </p>
        </div>

        <button
          onClick={fetchStats}
          disabled={loading}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

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