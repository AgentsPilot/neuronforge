'use client'

import { useState } from 'react'

interface AgentRunFormProps {
  agentId: string
  inputSchema: Record<string, any> // assuming { name: { type: 'string' }, ... }
  defaultUserPrompt: string
}

export default function AgentRunForm({
  agentId,
  inputSchema,
  defaultUserPrompt,
}: AgentRunFormProps) {
  const [inputVars, setInputVars] = useState<Record<string, string>>({})
  const [userPrompt, setUserPrompt] = useState(defaultUserPrompt)
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleChange = (key: string, value: string) => {
    setInputVars((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setResult(null)

    try {
      const res = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          input_variables: inputVars,
          user_prompt: userPrompt,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setResult(`❌ Error: ${data.error || 'Unknown error'}`)
      } else {
        setResult(data.result.message)
      }
    } catch (err) {
      setResult(`❌ Error: ${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 p-4 bg-white border rounded-xl shadow">
      <h3 className="text-lg font-semibold">Run Agent</h3>

      {Object.entries(inputSchema || {}).map(([key, def]) => (
        <div key={key} className="flex flex-col">
          <label className="text-sm text-gray-600 mb-1">{key}</label>
          <input
            type="text"
            value={inputVars[key] || ''}
            onChange={(e) => handleChange(key, e.target.value)}
            className="border px-3 py-2 rounded"
            placeholder={`Enter ${key}`}
            required
          />
        </div>
      ))}

      <div className="flex flex-col">
        <label className="text-sm text-gray-600 mb-1">User Prompt (Optional Override)</label>
        <textarea
          value={userPrompt}
          onChange={(e) => setUserPrompt(e.target.value)}
          className="border px-3 py-2 rounded"
          rows={3}
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
      >
        {loading ? 'Running...' : 'Run Agent'}
      </button>

      {result && (
        <div className="mt-4 p-3 border rounded bg-gray-50 text-sm">
          <strong>Result:</strong>
          <pre className="whitespace-pre-wrap mt-2">{result}</pre>
        </div>
      )}
    </form>
  )
}