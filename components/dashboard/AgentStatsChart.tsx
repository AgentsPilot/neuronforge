'use client'

import React, { useEffect, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'

export default function AgentStatsChart() {
  const { user } = useAuth()
  const [chartData, setChartData] = useState([])

  useEffect(() => {
    const fetchChartData = async () => {
      if (!user) return

      const { data, error } = await supabase
        .from('agent_stats')
        .select('agent_id, run_count, agents(agent_name)')
        .eq('user_id', user.id)

      if (error) {
        console.error('Error fetching agent stats for chart:', error.message)
        return
      }

      const formatted = data.map((row) => ({
        name: row.agents?.agent_name ?? 'Unknown Agent',
        runs: row.run_count ?? 0,
      }))

      setChartData(formatted)
    }

    fetchChartData()
  }, [user])

  return (
    <div className="bg-white p-6 rounded-2xl shadow border border-zinc-200">
      <h2 className="text-lg font-semibold text-zinc-800 mb-4">
        Agent Runs Overview
      </h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="runs" fill="#3B82F6" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}