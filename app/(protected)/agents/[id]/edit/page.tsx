'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'
import RequireAuth from '@/components/RequireAuth'

export default function EditAgentPage() {
  const { id } = useParams()
  const router = useRouter()
  const { user } = useAuth()

  const [agent_name, setAgentname] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [userPrompt, setUserPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id || !user) return

    const fetchAgent = async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('id, agent_name, description, system_prompt, user_prompt')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

      if (error) {
        setError('Agent not found.')
      } else {
        setAgentname(data.agent_name || '')
        setDescription(data.description || '')
        setSystemPrompt(data.system_prompt || '')
        setUserPrompt(data.user_prompt || '')
      }
    }

    fetchAgent()
  }, [id, user])

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!agent_name || !userPrompt || !user) return

    const { error } = await supabase
      .from('agents')
      .update({
        agent_name,
        description,
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
      })
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      setError('Failed to update agent.')
    } else {
      router.push(`/agents/${id}`)
    }
  }

  return (
    <RequireAuth>
      <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-gray-50">
        <div className="w-full max-w-2xl bg-white p-8 rounded-xl shadow">
          <h1 className="text-2xl font-bold mb-6 text-center text-gray-800">Edit Agent</h1>

          {error && <p className="text-red-500 mb-4 text-center">{error}</p>}

          <form onSubmit={handleUpdate} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Agent Name</label>
              <input
                type="text"
                value={agent_name}
                onChange={(e) => setAgentname(e.target.value)}
                required
                className="w-full border rounded px-4 py-2 focus:outline-none focus:ring focus:border-blue-400"
                placeholder="e.g. Marketing Assistant"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full border rounded px-4 py-2 focus:outline-none focus:ring focus:border-blue-400"
                rows={3}
                placeholder="What does this agent do?"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                System Prompt <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                className="w-full border rounded px-4 py-2 focus:outline-none focus:ring focus:border-blue-400"
                rows={3}
                placeholder="System-level behavior instructions..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">User Prompt</label>
              <textarea
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                required
                className="w-full border rounded px-4 py-2 focus:outline-none focus:ring focus:border-blue-400"
                rows={5}
                placeholder="Main instructions or question to answer..."
              />
            </div>

            <div className="flex gap-4 mt-6">
              <button
                type="submit"
                className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 transition"
              >
                ✅ Update Agent
              </button>
              <button
                type="button"
                onClick={() => router.push(`/agents/${id}`)}
                className="w-full bg-gray-300 text-gray-800 py-2 rounded hover:bg-gray-400 transition"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </RequireAuth>
  )
}