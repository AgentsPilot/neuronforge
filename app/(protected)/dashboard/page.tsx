'use client'

import React, { useEffect, useState } from 'react'
import LogoutButton from '@/components/LogoutButton'
import Link from 'next/link'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'
import AgentStatsChart from '@/components/dashboard/AgentStatsChart'
import AgentStatsTable from '@/components/dashboard/AgentStatsTable'
import ScheduledAgentsCard from '@/components/dashboard/ScheduledAgentsCard'

type Agent = {
  id: string
  agent_name: string
  description?: string
  system_prompt?: string
  user_prompt: string
  status: string
  input_schema?: any
}

export default function DashboardPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentStats, setAgentStats] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const fetchDashboardData = async () => {
    if (!user) return

    const { data: agents, error: agentsError } = await supabase
      .from('agents')
      .select('id, agent_name, description, system_prompt, user_prompt, status, input_schema')
      .eq('user_id', user.id)
      .eq('is_archived', false)

    if (agentsError) {
      console.error('❌ Failed to fetch agents:', agentsError.message)
    } else {
      setAgents(agents || [])
    }

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

      <div className="flex justify-center mb-10">
        <Link
          href="/agents/new"
          className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 transition font-medium"
        >
          Create New Agent
        </Link>
      </div>

      {/* 🧠 Agent Stats Table + Chart in one row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
        <AgentStatsTable stats={agentStats} />
        <AgentStatsChart />
      </div>

      {/* ⏰ Scheduled Agents Placeholder */}
      <div className="mb-12">
        <ScheduledAgentsCard />
      </div>

      {loading ? (
        <p className="text-center text-gray-500">Loading agents...</p>
      ) : agents.length === 0 ? (
        <p className="text-center text-gray-500">You have no agents yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map((agent) => (
            <Link
              key={agent.id}
              href={`/agents/${agent.id}`}
              className="block bg-white p-6 rounded-2xl shadow border border-gray-100 hover:border-blue-200 hover:shadow-md transition space-y-4"
            >
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-2">
                  {agent.agent_name}
                </h2>

                <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                  {agent.description || <span className="italic text-gray-400">No description</span>}
                </p>

                <div className="text-xs text-gray-500">
                  <span className="font-semibold text-gray-700">Status:</span>{' '}
                  <span className={agent.status === 'draft' ? 'text-yellow-600' : 'text-green-600'}>
                    {agent.status}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}