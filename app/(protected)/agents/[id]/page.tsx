// page.tsx under [id] — Edit Existing Agent

'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'
import SchemaBuilder from '@/components/SchemaBuilder'
import RequireAuth from '@/components/RequireAuth'

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

  useEffect(() => {
    if (!id || !user) return

    const fetchAgent = async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

      if (error || !data) {
        setError('Agent not found.')
      } else {
        setAgentName(data.agent_name)
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

    const { error } = await supabase
      .from('agents')
      .update({
        agent_name: agentName,
        description,
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
        input_schema: inputSchema,
        output_schema: outputSchema,
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
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <h1 className="text-2xl font-bold mb-4">Edit Agent</h1>
        <form onSubmit={handleUpdate} className="w-full max-w-xl bg-white p-6 rounded shadow space-y-6">
          {error && <p className="text-red-500">{error}</p>}

          <input
            type="text"
            placeholder="Agent Name"
            className="w-full px-4 py-2 border rounded"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            required
          />

          <textarea
            placeholder="Description"
            className="w-full px-4 py-2 border rounded"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <textarea
            placeholder="System Prompt"
            className="w-full px-4 py-2 border rounded"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
          />

          <textarea
            placeholder="User Prompt"
            className="w-full px-4 py-2 border rounded"
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            required
          />

          <div>
            <label className="block font-semibold mb-1">Input Schema</label>
            <SchemaBuilder schema={inputSchema} setSchema={setInputSchema} />
          </div>

          <div>
            <label className="block font-semibold mb-1">Output Schema</label>
            <SchemaBuilder schema={outputSchema} setSchema={setOutputSchema} />
          </div>

          <button
            type="submit"
            className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 transition"
          >
            Update Agent
          </button>
        </form>
      </div>
    </RequireAuth>
  )
}