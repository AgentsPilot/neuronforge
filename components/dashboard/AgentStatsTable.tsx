'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type AgentStat = {
  agent_id: string
  run_count: number
  success_count: number
  last_run_at: string
  agent_name: string
}

export default function AgentStatsTable({ agentId }: { agentId?: string }) {
  const [stats, setStats] = useState<AgentStat[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      let query = supabase
        .from('agent_stats')
        .select('agent_id, run_count, success_count, last_run_at, agents(agent_name)')
        .order('run_count', { ascending: false })

      // ✅ Apply agent_id filter if passed
      if (agentId) {
        query = query.eq('agent_id', agentId)
      }

      const { data, error } = await query

      if (error) {
        console.error('❌ Error fetching agent stats:', error.message)
        setStats([])
      } else {
        const parsedStats = data.map((row) => ({
          agent_id: row.agent_id,
          run_count: row.run_count,
          success_count: row.success_count,
          last_run_at: row.last_run_at,
          agent_name: row.agents?.agent_name ?? 'Unknown',
        }))
        setStats(parsedStats)
      }

      setLoading(false)
    }

    fetchStats()
  }, [agentId])

  if (loading) {
    return <p className="text-gray-500">Loading agent stats...</p>
  }

  return (
    <div className="bg-white p-6 rounded-2xl shadow border border-gray-100">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">📊 Agent Stats</h2>
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="py-2 pr-4 font-medium text-gray-600">Agent</th>
            <th className="py-2 pr-4 font-medium text-gray-600">Runs</th>
            <th className="py-2 pr-4 font-medium text-gray-600">Successes</th>
            <th className="py-2 pr-4 font-medium text-gray-600">Last Run</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.agent_id} className="border-b border-gray-100">
              <td className="py-2 pr-4 text-gray-800">{s.agent_name}</td>
              <td className="py-2 pr-4 text-gray-700">{s.run_count}</td>
              <td className="py-2 pr-4 text-gray-700">{s.success_count}</td>
              <td className="py-2 pr-4 text-gray-600">{new Date(s.last_run_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}