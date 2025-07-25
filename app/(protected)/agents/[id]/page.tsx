'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import AgentStatsBlock from '@/components/dashboard/AgentStatsTable'
import AgentHistoryBlock from '@/components/dashboard/AgentHistoryBlock'
import AgentSandbox from '@/components/dashboard/AgentSandbox'

type Agent = {
  id: string
  agent_name: string
  description?: string
  system_prompt?: string
  user_prompt: string
  status: string
  input_schema?: any
  connected_plugins?: Record<string, any>
  plugins_required?: string[]
}

export default function AgentPage() {
  const { user } = useAuth()
  const router = useRouter()
  const params = useParams()
  const agentId = params.id as string

  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchAgent = async () => {
const { data, error } = await supabase
  .from('agents')
  .select('*, connected_plugins, plugins_required')
  .eq('id', agentId)
  .eq('user_id', user?.id)
  .maybeSingle()


    if (error) {
      console.error('❌ Failed to fetch agent:', error.message)
      return
    }

    setAgent(data)
    setLoading(false)
  }

  useEffect(() => {
    if (user && agentId) {
      fetchAgent()
    }
  }, [user, agentId])

  const handleDelete = async () => {
    await supabase.from('agents').update({ is_archived: true }).eq('id', agentId)
    router.push('/dashboard')
  }

  const handleToggleStatus = async () => {
    const newStatus = agent?.status === 'active' ? 'draft' : 'active'
    await supabase.from('agents').update({ status: newStatus }).eq('id', agentId)
    fetchAgent()
  }

  if (loading || !agent) {
    return null
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

          {/* Show stats and history only if agent is not draft */}
          {agent.status !== 'draft' ? (
            <>
              <AgentStatsBlock agentId={agent.id} />
              <AgentHistoryBlock agentId={agent.id} />
            </>
          ) : (
            <p className="text-yellow-600 italic">⚠️ This agent is in draft mode. Stats and history will appear after activation.</p>
          )}

          <div className="bg-white border rounded-xl p-6">
          <AgentSandbox
            agentId={agent.id}
            inputSchema={agent.input_schema}
            userPrompt={agent.user_prompt}
            connectedPlugins={agent.connected_plugins}
            pluginsRequired={agent.plugins_required}
          />          
          </div>
        </div>
      </div>
    </div>
  )
}