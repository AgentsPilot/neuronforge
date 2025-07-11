'use client'

import React, { useEffect, useState } from 'react'
import LogoutButton from '@/components/LogoutButton'
import Link from 'next/link'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'

type Agent = {
  id: string
  agent_name: string
  description?: string
  system_prompt?: string
  user_prompt: string
}

export default function DashboardPage() {
  const { user } = useAuth()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchAgents = async () => {
      if (!user) return
      const { data, error } = await supabase
        .from('agents')
        .select('id, agent_name, description, system_prompt, user_prompt')
        .eq('user_id', user.id)
        .eq('is_archived', false) // ✅ Added this line

      if (error) {
        console.error('❌ Failed to fetch agents:', error.message)
      } else {
        setAgents(data || [])
      }

      setLoading(false)
    }

    fetchAgents()
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
              className="bg-white p-6 rounded-2xl shadow hover:shadow-lg transition border border-gray-100 hover:border-blue-200"
            >
              <h2 className="text-lg font-semibold text-gray-800 mb-3">
                {agent.agent_name}
              </h2>

              <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                {agent.description || <span className="italic text-gray-400">No description</span>}
              </p>

              <hr className="my-2" />

              <div className="text-xs text-gray-500 mb-3">
                <span className="font-semibold text-gray-700 block mb-1">🧠 System Prompt</span>
                <p className="line-clamp-2">
                  {agent.system_prompt || <span className="italic text-gray-400">None provided</span>}
                </p>
              </div>

              <hr className="my-2" />

              <div className="text-xs text-gray-500">
                <span className="font-semibold text-gray-700 block mb-1">💬 User Prompt</span>
                <p className="line-clamp-2">
                  {agent.user_prompt || <span className="italic text-gray-400">None provided</span>}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}