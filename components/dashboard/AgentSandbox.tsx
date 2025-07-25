'use client'

import React, { useEffect, useState } from 'react'
import { runAgent } from '@/lib/agentRunner'
import { interpolatePrompt } from '@/lib/utils/interpolatePrompt'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'

type Field = {
  name: string
  type: 'string' | 'number' | 'boolean' | 'date'
  description?: string
  required?: boolean
}

type AgentSandboxProps = {
  agentId: string
  inputSchema?: Field[]
  userPrompt: string
  pluginsRequired?: string[]
}

export default function AgentSandbox({
  agentId,
  inputSchema = [],
  userPrompt,
  pluginsRequired = [],
}: AgentSandboxProps) {
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [overridePrompt, setOverridePrompt] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [connectedPluginKeys, setConnectedPluginKeys] = useState<string[]>([])

  const { user } = useAuth()

  useEffect(() => {
    const fetchConnectedPlugins = async () => {
      if (!user?.id) return

      const { data, error } = await supabase
        .from('plugin_connections')
        .select('plugin_key')
        .eq('user_id', user.id)

      if (!error && data) {
        const keys = data.map((row) => row.plugin_key)
        setConnectedPluginKeys(keys)
      }
    }

    fetchConnectedPlugins()
  }, [user])

  const handleInputChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleRun = async () => {
  try {
    setLoading(true)

    const normalizedPluginsRequired = Array.isArray(pluginsRequired) ? pluginsRequired : []

    const missingPlugins = normalizedPluginsRequired.filter(
      (key) => !connectedPluginKeys.includes(key)
    )

    if (missingPlugins.length > 0) {
      setResult(`❌ Missing required plugin(s): ${missingPlugins.join(', ')}`)
      return
    }

    const promptToUse = overridePrompt || userPrompt
    const interpolatedPrompt = interpolatePrompt(promptToUse, formData)

    console.log('🧠 Prompt Sent:', interpolatedPrompt)

    const res = await runAgent(agentId, formData, interpolatedPrompt)

    console.log('🧠 Prompt Sent:', interpolatedPrompt)
   
    console.log('📦 Raw runAgent response:', res)
    setResult(res?.result?.message || res?.output || 'No output returned.')

  } catch (err: any) {
    setResult(`❌ Error: ${err.message}`)
  } finally {
    setLoading(false)
  }
}

  return (
    <div className="bg-white border rounded-xl p-6 space-y-6">
      <h2 className="text-xl font-semibold text-gray-800">🧪 Agent Sandbox</h2>

      {/* Input Form Fields */}
      {inputSchema.length === 0 ? (
        <p className="text-sm text-gray-500">No input schema defined for this agent.</p>
      ) : (
        <form className="space-y-4">
          {inputSchema.map((field, index) => (
            <div key={index} className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                {field.name}{' '}
                <span className="text-gray-400 text-xs">({field.type})</span>{' '}
                {field.required && <span className="text-red-500">*</span>}
              </label>
              {field.description && (
                <p className="text-xs text-gray-500">{field.description}</p>
              )}
              <input
                type={field.type === 'number' ? 'number' : 'text'}
                className="w-full border px-3 py-2 rounded"
                onChange={(e) => handleInputChange(field.name, e.target.value)}
              />
            </div>
          ))}
        </form>
      )}

      {/* Prompt Override */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Override User Prompt
        </label>
        <textarea
          className="w-full border px-3 py-2 rounded min-h-[100px]"
          placeholder="Optional: Override the agent prompt here..."
          value={overridePrompt}
          onChange={(e) => setOverridePrompt(e.target.value)}
        />
      </div>

      {/* Run Button */}
      <button
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        onClick={handleRun}
        disabled={loading}
      >
        {loading ? 'Running...' : 'Run Agent'}
      </button>

      {/* Result Block */}
      {result && (
        <div className="bg-gray-50 border border-gray-200 p-4 rounded text-sm text-gray-800 whitespace-pre-wrap">
          <strong>Result:</strong>
          <div>{result}</div>
        </div>
      )}
    </div>
  )
}