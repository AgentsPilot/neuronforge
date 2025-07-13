'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import RequireAuth from '@/components/RequireAuth'
import VisualSchemaBuilder from '@/components/VisualSchemaBuilder'

export default function EditAgentPage() {
  const { id } = useParams()
  const router = useRouter()
  const { user } = useAuth()

  const [agentName, setAgentName] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [userPrompt, setUserPrompt] = useState('')
  const [inputSchema, setInputSchema] = useState<any[]>([])
  const [outputSchema, setOutputSchema] = useState<any[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!id || !user) return

    const fetchAgent = async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

      if (error) {
        setError('Agent not found.')
      } else if (data) {
        setAgentName(data.agent_name || '')
        setDescription(data.description || '')
        setSystemPrompt(data.system_prompt || '')
        setUserPrompt(data.user_prompt || '')
        setInputSchema(data.input_schema || [])
        setOutputSchema(data.output_schema || [])
      }
    }

    fetchAgent()
  }, [id, user])

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!agentName || !userPrompt || !user) return

    setLoading(true)
    const { error } = await supabase
      .from('agents')
      .update({
        agent_name: agentName,
        description,
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
        input_schema: inputSchema.length > 0 ? inputSchema : null,
        output_schema: outputSchema.length > 0 ? outputSchema : null,
      })
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      setError('Failed to update agent.')
    } else {
      router.push(`/agents/${id}`)
    }
    setLoading(false)
  }

  return (
    <RequireAuth>
      <div className="min-h-screen max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-4xl font-bold text-center mb-10">✏️ Edit Agent</h1>

        <form onSubmit={handleUpdate} className="space-y-8 bg-white p-8 rounded-xl shadow-md">
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">Agent Name</label>
            <input
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              required
              className="w-full px-4 py-2 border rounded-lg shadow-sm focus:ring focus:ring-blue-300"
              placeholder="e.g., Marketing Assistant"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-4 py-2 border rounded-lg shadow-sm focus:ring focus:ring-blue-300"
              placeholder="What does this agent do?"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              System Prompt <span className="text-gray-500 font-normal">(optional)</span>
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={3}
              className="w-full px-4 py-2 border rounded-lg shadow-sm focus:ring focus:ring-blue-300"
              placeholder="Instructions that shape the agent’s behavior (e.g., speak formally, act like a travel advisor)"
            />
            <p className="text-xs text-gray-500 mt-1">
              Use this field to guide the personality or constraints of the agent.
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">User Prompt</label>
            <textarea
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              rows={5}
              required
              className="w-full px-4 py-2 border rounded-lg shadow-sm focus:ring focus:ring-blue-300"
              placeholder="Prompt that the agent will process (e.g., summarize this report...)"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">Input Schema</label>
            <VisualSchemaBuilder
              schema={inputSchema}
              onSchemaChange={setInputSchema}
            />
            <p className="text-xs text-gray-500 mt-1">
              Define structured inputs your agent expects using fields and types.
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">Output Schema</label>
            <VisualSchemaBuilder
              schema={outputSchema}
              onSchemaChange={setOutputSchema}
            />
            <p className="text-xs text-gray-500 mt-1">
              Define the expected structure of the agent's output.
            </p>
          </div>

          {error && <p className="text-red-500 font-medium">{error}</p>}

          <div className="flex justify-center gap-4">
            <button
              type="submit"
              disabled={loading}
              className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition font-medium"
            >
              {loading ? 'Saving...' : 'Update Agent'}
            </button>
            <button
              type="button"
              onClick={() => router.push(`/agents/${id}`)}
              className="bg-gray-300 text-gray-800 px-6 py-3 rounded-lg hover:bg-gray-400 transition font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </RequireAuth>
  )
}