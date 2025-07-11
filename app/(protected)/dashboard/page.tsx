'use client'

import React, { useEffect, useState } from 'react'
import LogoutButton from '@/components/LogoutButton'
import Link from 'next/link'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'

type Agent = {
  id: string
  title: string
  prompt: string
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
        .select('id, title, prompt')
        .eq('user_id', user.id)

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
    <div className="min-h-screen relative px-6 py-10">
      {/* Top-right Logout Button */}
      <div className="absolute top-4 right-4">
        <LogoutButton />
      </div>

      {/* Welcome Message */}
      <h1 className="text-3xl font-bold mb-6 text-center">Welcome to your Dashboard!</h1>

      {/* Create Agent Button */}
      <div className="flex justify-center mb-6">
        <Link
          href="/agents/new"
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
        >
          Create New Agent
        </Link>
      </div>

      {/* Agent List */}
      {loading ? (
        <p className="text-center text-gray-500">Loading agents...</p>
      ) : agents.length === 0 ? (
        <p className="text-center text-gray-500">You have no agents yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {agents.map((agent) => (
            <div key={agent.id} className="bg-white p-4 rounded shadow">
              <h2 className="text-xl font-semibold mb-2">{agent.title}</h2>
              <p className="text-gray-700 text-sm whitespace-pre-line">{agent.prompt}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}