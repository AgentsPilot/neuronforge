'use client'

import React, { useEffect, useState } from 'react'
import { runAgent } from '@/lib/agentRunner'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'
import { interpolatePrompt } from '@/lib/utils/interpolatePrompt'

type Field = {
  name: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum'
  enum?: string[]
  description?: string
  required?: boolean
}

type AgentSandboxProps = {
  agentId: string
  inputSchema?: Field[]
  userPrompt: string
  pluginsRequired?: string[]
}

const BLOCKED_FIELDS_BY_PLUGIN: Record<string, string[]> = {
  'google-mail': ['email', 'emailaccount'],
  'notion': ['workspace', 'workspacename'],
}

export default function AgentSandbox({
  agentId,
  inputSchema = [],
  userPrompt,
  pluginsRequired = [],
}: AgentSandboxProps) {
  const [formData, setFormData] = useState<Record<string, any>>({})
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

  const handleInputChange = (name: string, value: any) => {
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

      const interpolatedPrompt = await interpolatePrompt(userPrompt, formData, undefined, user?.id)

      console.log('🧠 Prompt Sent:', interpolatedPrompt)
      console.log('📤 Submitting run with:', {
        agent_id: agentId,
        input_variables: formData,
        override_user_prompt: interpolatedPrompt,
      })

      const res = await runAgent(agentId, formData, interpolatedPrompt)

      setResult(res?.result?.message || res?.output || 'No output returned.')
    } catch (err: any) {
      setResult(`❌ Error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  // 🔒 Filter input fields based on connected plugins
  const filteredInputSchema = inputSchema.filter((field) => {
    const fieldName = field.name?.toLowerCase()
    return !connectedPluginKeys.some((plugin) =>
      (BLOCKED_FIELDS_BY_PLUGIN[plugin] || []).includes(fieldName)
    )
  })

  return (
    <div className="bg-white border rounded-xl p-6 space-y-6">
      <h2 className="text-xl font-semibold text-gray-800">🧪 Agent Sandbox</h2>

      {filteredInputSchema.length === 0 ? (
        <p className="text-sm text-gray-500">No input fields to fill — plugin handles the required data.</p>
      ) : (
        <form className="space-y-4">
          {filteredInputSchema.map((field, index) => (
            <div key={index} className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                {field.name}{' '}
                <span className="text-gray-400 text-xs">({field.type})</span>{' '}
                {field.required && <span className="text-red-500">*</span>}
              </label>
              {field.description && (
                <p className="text-xs text-gray-500">{field.description}</p>
              )}
              {field.type === 'enum' && Array.isArray(field.enum) ? (
                <select
                  className="w-full border px-3 py-2 rounded"
                  onChange={(e) => handleInputChange(field.name, e.target.value)}
                >
                  <option value="">Select one</option>
                  {field.enum.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={
                    field.type === 'number'
                      ? 'number'
                      : field.type === 'date'
                      ? 'date'
                      : 'text'
                  }
                  className="w-full border px-3 py-2 rounded"
                  onChange={(e) => handleInputChange(field.name, e.target.value)}
                />
              )}
            </div>
          ))}
        </form>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Final Prompt (System Generated)
        </label>
        <textarea
          className="w-full border px-3 py-2 rounded min-h-[100px] bg-gray-100"
          value={userPrompt}
          readOnly
        />
      </div>

      <button
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        onClick={handleRun}
        disabled={loading}
      >
        {loading ? 'Running...' : 'Run Agent'}
      </button>

      {result && (
        <div className="bg-gray-50 border border-gray-200 p-4 rounded text-sm text-gray-800 whitespace-pre-wrap">
          <strong>Result:</strong>
          <div>{result}</div>
        </div>
      )}
    </div>
  )
}