'use client'

import React, { useEffect, useState } from 'react'
import LogoutButton from '@/components/LogoutButton'
import Link from 'next/link'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'

type Agent = {
  id: string
  agent_name: string
  description?: string
  system_prompt?: string
  user_prompt: string
  status: string
}

export default function DashboardPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAgents = async () => {
    if (!user) return
    const { data, error } = await supabase
      .from('agents')
      .select('id, agent_name, description, system_prompt, user_prompt, status')
      .eq('user_id', user.id)
      .eq('is_archived', false)

    if (error) {
      console.error('❌ Failed to fetch agents:', error.message)
    } else {
      setAgents(data || [])
    }

    setLoading(false)
  }

  useEffect(() => {
    fetchAgents()
  }, [user])

  const handleActivate = async (id: string) => {
    await supabase.from('agents').update({ status: 'active' }).eq('id', id)
    fetchAgents()
  }

  const handleDelete = async (id: string) => {
    await supabase.from('agents').update({ is_archived: true }).eq('id', id)
    fetchAgents()
  }

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

      {loading ? (
        <p className="text-center text-gray-500">Loading agents...</p>
      ) : agents.length === 0 ? (
        <p className="text-center text-gray-500">You have no agents yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="bg-white p-6 rounded-2xl shadow border border-gray-100 hover:border-blue-200"
            >
              <h2 className="text-lg font-semibold text-gray-800 mb-2">
                {agent.agent_name}
              </h2>

              <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                {agent.description || <span className="italic text-gray-400">No description</span>}
              </p>

              <div className="text-xs text-gray-500 mb-2">
                <span className="font-semibold text-gray-700">Status:</span>{' '}
                <span className={agent.status === 'draft' ? 'text-yellow-600' : 'text-green-600'}>
                  {agent.status}
                </span>
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                <Link
                  href={`/agents/${agent.id}/edit`}
                  className="text-xs bg-gray-200 px-3 py-1 rounded hover:bg-gray-300"
                >
                  Edit
                </Link>

                <button
                  onClick={() => handleDelete(agent.id)}
                  className="text-xs bg-red-100 text-red-600 px-3 py-1 rounded hover:bg-red-200"
                >
                  Delete
                </button>

                {agent.status === 'draft' && (
                  <button
                    onClick={() => handleActivate(agent.id)}
                    className="text-xs bg-yellow-200 text-yellow-800 px-3 py-1 rounded hover:bg-yellow-300"
                  >
                    Activate
                  </button>
                )}

                <Link
                  href={`/agents/${agent.id}/run`}
                  className="text-xs bg-blue-100 text-blue-800 px-3 py-1 rounded hover:bg-blue-200"
                >
                  Run
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}