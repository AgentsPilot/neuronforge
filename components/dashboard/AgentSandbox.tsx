'use client'

import React, { useEffect, useState } from 'react'
import { runAgent } from '@/lib/agentRunner'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'
import { interpolatePrompt } from '@/lib/utils/interpolatePrompt'
import { generatePDF } from '@/lib/pdf/generatePDF'
import { sendEmailDraft } from '@/lib/plugins/google-mail/sendEmailDraft'

// Types

type Field = {
  name: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum'
  enum?: string[]
  description?: string
  required?: boolean
}

interface OutputField {
  name: string
  type: string
  description?: string
}

interface AgentSandboxProps {
  agentId: string
  inputSchema?: Field[]
  outputSchema?: OutputField[]
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
  outputSchema = [],
  userPrompt,
  pluginsRequired = [],
}: AgentSandboxProps) {
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [result, setResult] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [connectedPluginKeys, setConnectedPluginKeys] = useState<string[]>([])
  const [sendStatus, setSendStatus] = useState<string | null>(null)

  const { user } = useAuth()

  useEffect(() => {
    const fetchConnectedPlugins = async () => {
      if (!user?.id) return
      const { data } = await supabase
        .from('plugin_connections')
        .select('plugin_key')
        .eq('user_id', user.id)

      if (data) setConnectedPluginKeys(data.map((row) => row.plugin_key))
    }
    fetchConnectedPlugins()
  }, [user])

  const handleInputChange = (name: string, value: any) => {
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

const handleRun = async () => {
  try {
    setLoading(true)
    setSendStatus(null)
    setResult(null)

    const missingPlugins = (pluginsRequired || []).filter(
      (key) => !connectedPluginKeys.includes(key)
    )
    if (missingPlugins.length > 0) {
      setResult({ error: `❌ Missing required plugin(s): ${missingPlugins.join(', ')}` })
      return
    }

    const interpolatedPrompt = await interpolatePrompt(userPrompt, formData, undefined, user?.id)

    const res = await runAgent(agentId, formData, interpolatedPrompt)

    const finalResult = res?.result || res?.output || 'No output returned.'
    setResult(finalResult)

    if (finalResult?.send_status) {
      setSendStatus(finalResult.send_status)
    } else {
      // Fallback if no explicit send_status
      const usedOutputType = outputSchema.find((f) =>
        ['SummaryBlock', 'EmailDraft'].includes(f.type)
      )?.type

      if (usedOutputType === 'SummaryBlock') {
        setSendStatus('📝 SummaryBlock was generated and logged.')
      } else if (usedOutputType === 'EmailDraft') {
        setSendStatus('📤 Email draft was generated. Ready to send.')
      }
    }
  } catch (err: any) {
    setResult({ error: err.message })
  } finally {
    setLoading(false)
  }
}

  const handleDownloadPDF = () => {
    if (result && outputSchema) {
      generatePDF(result, outputSchema)
    }
  }

  const handleSendEmail = async () => {
    if (result && result.to && result.subject && result.body) {
      await sendEmailDraft(user?.id!, result)
      setSendStatus('✅ Email sent successfully via Gmail.')
    } else {
      alert('Missing required email fields.')
    }
  }

  const filteredInputSchema = inputSchema.filter((field) => {
    const name = field.name.toLowerCase()
    return !connectedPluginKeys.some((plugin) =>
      (BLOCKED_FIELDS_BY_PLUGIN[plugin] || []).includes(name)
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
                {field.name} <span className="text-gray-400 text-xs">({field.type})</span>
              </label>
              {field.description && <p className="text-xs text-gray-500">{field.description}</p>}
              {field.type === 'enum' ? (
                <select
                  className="w-full border px-3 py-2 rounded"
                  onChange={(e) => handleInputChange(field.name, e.target.value)}
                >
                  <option value="">Select</option>
                  {field.enum?.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                  className="w-full border px-3 py-2 rounded"
                  onChange={(e) => handleInputChange(field.name, e.target.value)}
                />
              )}
            </div>
          ))}
        </form>
      )}

      <button
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        onClick={handleRun}
        disabled={loading}
      >
        {loading ? 'Running...' : 'Run Agent'}
      </button>

      {sendStatus && (
        <p className="text-sm text-green-700 font-medium">{sendStatus}</p>
      )}

      {result && (
        <div className="bg-gray-50 border border-gray-200 p-4 rounded text-sm text-gray-800 space-y-4">
          <strong>Result:</strong>

          {typeof result === 'object' ? (
            <ul className="list-disc pl-5">
              {outputSchema.map((field) => (
                <li key={field.name}>
                  <strong>{field.name}:</strong> {result[field.name] || '—'}
                </li>
              ))}
            </ul>
          ) : (
            <p>{result}</p>
          )}

          {(connectedPluginKeys.includes('google-mail') && result?.to && result?.subject && result?.body) && (
            <button
              className="bg-green-600 text-white px-4 py-2 rounded"
              onClick={handleSendEmail}
            >
              Send Email via Gmail
            </button>
          )}

          {(outputSchema.some((f) => ['SummaryBlock', 'EmailDraft'].includes(f.type))) && (
            <button
              className="bg-gray-700 text-white px-4 py-2 rounded"
              onClick={handleDownloadPDF}
            >
              Download PDF
            </button>
          )}
        </div>
      )}
    </div>
  )
}