'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type Agent = {
  id: string
  agent_name: string
  description?: string
  status: string
}

export default function AgentList() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchAgents() {
      const { data, error } = await supabase
        .from('agents')
        .select('id, agent_name, description, status')
        .eq('is_archived', false)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('❌ Error fetching agents:', error)
      } else {
        setAgents(data || [])
      }

      setLoading(false)
    }

    fetchAgents()
  }, [])

  if (loading) {
    return <p className="text-center text-gray-500">Loading agents...</p>
  }

  if (agents.length === 0) {
    return <p className="text-center text-gray-500">You have no agents yet.</p>
  }

  return (
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
  )
}