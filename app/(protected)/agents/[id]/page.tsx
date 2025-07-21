'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import AgentStatsBlock from '../AgentStatsBlock'

type Agent = {
  id: string
  agent_name: string
  description?: string
  system_prompt?: string
  user_prompt: string
  status: string
  input_schema?: any
}

export default function AgentPage({ params }: { params: { id: string } }) {
  const { user } = useAuth()
  const router = useRouter()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchAgent = async () => {
    const { data, error } = await supabase
      .from('agents')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', user?.id)
      .single()

    if (error) {
      console.error('❌ Failed to fetch agent:', error.message)
      return
    }

    setAgent(data)
    setLoading(false)
  }

  useEffect(() => {
    if (user) fetchAgent()
  }, [user])

  const handleDelete = async () => {
    await supabase.from('agents').update({ is_archived: true }).eq('id', params.id)
    router.push('/dashboard')
  }

  const handleToggleStatus = async () => {
    const newStatus = agent?.status === 'active' ? 'draft' : 'active'
    await supabase.from('agents').update({ status: newStatus }).eq('id', params.id)
    fetchAgent()
  }

  if (loading || !agent) {
    return <div className="p-6 text-gray-500">Loading agent...</div>
  }

  return (
    <div className="min-h-screen px-6 py-10 bg-gray-50">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        {/* Sidebar Menu */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3 h-fit">
          <h2 className="text-md font-bold text-gray-700 mb-2">Actions</h2>

          <Link
            href={`/agents/${agent.id}/edit`}
            className="block text-sm px-3 py-2 bg-gray-100 rounded hover:bg-gray-200"
          >
            ✏️ Edit Agent
          </Link>

          <button
            onClick={handleDelete}
            className="block text-sm px-3 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200 w-full text-left"
          >
            🗑️ Delete Agent
          </button>

          <button
            onClick={handleToggleStatus}
            className="block text-sm px-3 py-2 bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200 w-full text-left"
          >
            {agent.status === 'active' ? '🚫 Deactivate' : '✅ Activate'}
          </button>
        </div>

        {/* Main Content */}
        <div className="md:col-span-3 space-y-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">
              {agent.agent_name}
            </h1>
            <p className="text-sm text-gray-600">
              {agent.description || <em className="text-gray-400">No description provided.</em>}
            </p>
          </div>

          {/* 📊 Agent Stats */}
          <AgentStatsBlock agentId={agent.id} />

          {/* 🕓 Agent History Placeholder */}
          <div className="bg-white border rounded-xl p-6 text-sm text-gray-500">
            🕓 Agent history will appear here.
          </div>

          {/* 🧪 Agent Sandbox Placeholder */}
          <div className="bg-white border rounded-xl p-6 text-sm text-gray-500">
            🧪 Agent sandbox will appear here.
          </div>

          {/* ▶️ Agent Run Form Placeholder */}
          <div className="bg-white border rounded-xl p-6 text-sm text-gray-500">
            ▶️ Agent run form will appear here.
          </div>
        </div>
      </div>
    </div>
  )
}