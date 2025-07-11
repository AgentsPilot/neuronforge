'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import InputSchemaBuilder from '@/components/InputSchemaBuilder'

export default function NewAgentPage() {
  const { user } = useAuth()
  const router = useRouter()

  const [agentName, setAgentName] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [userPrompt, setUserPrompt] = useState('')
  const [inputSchema, setInputSchema] = useState<any[]>([])
  const [outputSchema, setOutputSchema] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return

    setLoading(true)
    setError(null)

    const payload = {
      user_id: user.id,
      agent_name: agentName,
      description,
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      input_schema: inputSchema.length > 0 ? inputSchema : null,
      output_schema: outputSchema || null,
    }

    const { error } = await supabase.from('agents').insert([payload])

    if (error) {
      setError('Failed to create agent.')
    } else {
      router.push('/dashboard')
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-4xl font-bold text-center mb-10">🛠️ Build Your Agent</h1>

      <form onSubmit={handleSubmit} className="space-y-8 bg-white p-8 rounded-xl shadow-md">
        <div>
          <label className="block text-sm font-semibold text-gray-800 mb-1">
            Agent Name
          </label>
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
          <label className="block text-sm font-semibold text-gray-800 mb-1">
            Description
          </label>
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
          <label className="block text-sm font-semibold text-gray-800 mb-1">
            User Prompt
          </label>
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
          <label className="block text-sm font-semibold text-gray-800 mb-2">
            Input Schema
          </label>
          <InputSchemaBuilder onSchemaChange={setInputSchema} />
          <p className="text-xs text-gray-500 mt-1">
            Define structured inputs your agent expects using fields and types.
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-800 mb-1">
            Output Schema <span className="text-gray-500 font-normal">(optional)</span>
          </label>
          <textarea
            value={outputSchema}
            onChange={(e) => setOutputSchema(e.target.value)}
            rows={4}
            className="w-full px-4 py-2 border rounded-lg shadow-sm focus:ring focus:ring-blue-300"
            placeholder={`e.g. {\n  "summary": "string",\n  "confidence": "number"\n}`}
          />
          <p className="text-xs text-gray-500 mt-1">
            Describe the expected output format using JSON-like structure.
          </p>
        </div>

        {error && <p className="text-red-500 font-medium">{error}</p>}

        <div className="flex justify-center">
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition font-medium"
          >
            {loading ? 'Saving...' : 'Create Agent'}
          </button>
        </div>
      </form>
    </div>
  )
}