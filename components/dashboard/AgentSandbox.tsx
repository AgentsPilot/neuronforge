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
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'file'
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
  const [executionTime, setExecutionTime] = useState<number | null>(null)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  const { user } = useAuth()

  // Ensure arrays are properly defaulted
  const safeInputSchema = Array.isArray(inputSchema) ? inputSchema : []
  const safeOutputSchema = Array.isArray(outputSchema) ? outputSchema : []
  const safePluginsRequired = Array.isArray(pluginsRequired) ? pluginsRequired : []

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

  const filteredInputSchema = safeInputSchema.filter((field) => {
    const name = field.name.toLowerCase()
    return !connectedPluginKeys.some((plugin) =>
      (BLOCKED_FIELDS_BY_PLUGIN[plugin] || []).includes(name)
    )
  })

  // Helper function to check if a plugin is connected
  const getPluginStatus = (plugin: string) => {
    if (plugin === 'chatgpt-research') {
      return true // Always connected since it uses platform API key
    }
    return connectedPluginKeys.includes(plugin)
  }

  // Validation function
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {}
    
    filteredInputSchema.forEach(field => {
      if (field.required) {
        const value = formData[field.name]
        
        if (value === undefined || value === null || value === '') {
          errors[field.name] = `${field.name} is required`
        } else if (field.type === 'number' && isNaN(Number(value))) {
          errors[field.name] = `${field.name} must be a valid number`
        } else if (field.type === 'boolean' && typeof value !== 'boolean') {
          // Boolean validation - checkboxes handle this automatically
        }
      }
    })
    
    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  // Check if form is valid (for button state)
  const isFormValid = (): boolean => {
    const requiredFields = filteredInputSchema.filter(field => field.required)
    
    return requiredFields.every(field => {
      const value = formData[field.name]
      if (value === undefined || value === null || value === '') return false
      if (field.type === 'number' && isNaN(Number(value))) return false
      return true
    })
  }

  // Check for missing plugins - exclude ChatGPT Research since it doesn't need user connections
  const missingPlugins = safePluginsRequired.filter(
    (key) => !getPluginStatus(key)
  )

  const canRun = isFormValid() && missingPlugins.length === 0

  const handleInputChange = (name: string, value: any) => {
    setFormData((prev) => ({ ...prev, [name]: value }))
    
    // Clear validation error for this field when user starts typing
    if (validationErrors[name]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[name]
        return newErrors
      })
    }
  }

  const handleRun = async () => {
    // Final validation before running
    if (!validateForm()) {
      return
    }

    try {
      setLoading(true)
      setSendStatus(null)
      setResult(null)
      setExecutionTime(null)
      
      const startTime = Date.now()

      if (missingPlugins.length > 0) {
        setResult({ error: `Missing required plugin(s): ${missingPlugins.join(', ')}` })
        return
      }

      const interpolatedPrompt = await interpolatePrompt(userPrompt, formData, undefined, user?.id)
      const res = await runAgent(agentId, formData, interpolatedPrompt)
      
      const endTime = Date.now()
      setExecutionTime(endTime - startTime)

      const finalResult = res?.result || res?.output || 'No output returned.'
      setResult(finalResult)

      if (finalResult?.send_status) {
        setSendStatus(finalResult.send_status)
      } else {
        const usedOutputType = safeOutputSchema.find((f) =>
          ['SummaryBlock', 'EmailDraft'].includes(f.type)
        )?.type

        if (usedOutputType === 'SummaryBlock') {
          setSendStatus('SummaryBlock was generated and logged.')
        } else if (usedOutputType === 'EmailDraft') {
          setSendStatus('Email draft was generated. Ready to send.')
        }
      }
    } catch (err: any) {
      setResult({ error: err.message })
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadPDF = () => {
    if (result && safeOutputSchema.length > 0) {
      generatePDF(result, safeOutputSchema)
    }
  }

  const handleSendEmail = async () => {
    if (result && result.to && result.subject && result.body) {
      try {
        await sendEmailDraft(user?.id!, result)
        setSendStatus('Email sent successfully via Gmail.')
      } catch (error) {
        setSendStatus('Failed to send email.')
      }
    } else {
      alert('Missing required email fields.')
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, name: string) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result?.toString()
      handleInputChange(name, base64)
    }
    reader.readAsDataURL(file)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="bg-white border rounded-xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-800">Agent Sandbox</h2>
        {safePluginsRequired.length > 0 && (
          <div className="text-sm text-gray-500">
            {safePluginsRequired.length} plugin{safePluginsRequired.length > 1 ? 's' : ''} required
          </div>
        )}
      </div>

      {/* Plugin Status */}
      {safePluginsRequired.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-medium text-blue-900 mb-2">Required Plugins:</h3>
          <div className="flex flex-wrap gap-2">
            {safePluginsRequired.map(plugin => {
              const isConnected = getPluginStatus(plugin)
              return (
                <span
                  key={plugin}
                  className={`px-2 py-1 text-xs rounded-full ${
                    isConnected 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {isConnected ? '✅' : '❌'} {plugin}
                </span>
              )
            })}
          </div>
          {missingPlugins.length > 0 && (
            <p className="text-red-700 text-sm mt-2">
              Connect the missing plugins before running the agent.
            </p>
          )}
        </div>
      )}

      {/* Input Form */}
      {filteredInputSchema.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
          <p className="text-sm text-gray-500">No input fields to fill — plugin handles the required data.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <h3 className="font-medium text-gray-700">Input Parameters:</h3>
          <form className="space-y-4">
            {filteredInputSchema.map((field, index) => (
              <div key={index} className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  {field.name} 
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                  <span className="text-gray-400 text-xs ml-1">({field.type})</span>
                </label>
                {field.description && (
                  <p className="text-xs text-gray-500">{field.description}</p>
                )}
                
                {/* Form Input */}
                {field.type === 'enum' ? (
                  <select
                    className={`w-full border px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      validationErrors[field.name] ? 'border-red-500' : 'border-gray-300'
                    }`}
                    onChange={(e) => handleInputChange(field.name, e.target.value)}
                    value={formData[field.name] || ''}
                  >
                    <option value="">Select an option</option>
                    {field.enum?.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : field.type === 'file' ? (
                  <div>
                    <input
                      type="file"
                      accept="application/pdf,image/*,.txt,.csv"
                      className={`w-full border px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        validationErrors[field.name] ? 'border-red-500' : 'border-gray-300'
                      }`}
                      onChange={(e) => handleFileUpload(e, field.name)}
                    />
                    {formData[field.name] && (
                      <p className="text-xs text-green-600 mt-1">File uploaded</p>
                    )}
                  </div>
                ) : field.type === 'boolean' ? (
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      onChange={(e) => handleInputChange(field.name, e.target.checked)}
                      checked={formData[field.name] || false}
                    />
                    <span className="text-sm text-gray-600">Enable</span>
                  </div>
                ) : (
                  <input
                    type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                    className={`w-full border px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      validationErrors[field.name] ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder={`Enter ${field.name.toLowerCase()}`}
                    onChange={(e) => handleInputChange(field.name, e.target.value)}
                    value={formData[field.name] || ''}
                  />
                )}
                
                {/* Validation Error */}
                {validationErrors[field.name] && (
                  <p className="text-red-500 text-xs mt-1">{validationErrors[field.name]}</p>
                )}
              </div>
            ))}
          </form>
        </div>
      )}

      {/* Run Button */}
      <div className="flex items-center gap-4">
        <button
          className={`px-6 py-2 rounded-lg flex items-center gap-2 transition-colors ${
            canRun && !loading
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
          onClick={handleRun}
          disabled={!canRun || loading}
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              Running...
            </>
          ) : (
            'Run Agent'
          )}
        </button>
        
        {/* Validation Summary */}
        {!canRun && !loading && (
          <div className="text-sm text-gray-500">
            {missingPlugins.length > 0 
              ? 'Missing required plugins'
              : !isFormValid() 
              ? 'Fill all required fields to run'
              : ''
            }
          </div>
        )}
        
        {executionTime && (
          <span className="text-sm text-gray-500">
            Executed in {executionTime}ms
          </span>
        )}
      </div>

      {/* Status Messages */}
      {sendStatus && (
        <div className={`p-3 rounded-lg border ${
          sendStatus.includes('successfully') 
            ? 'bg-green-50 border-green-200 text-green-800' 
            : sendStatus.includes('Failed')
            ? 'bg-red-50 border-red-200 text-red-800'
            : 'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          <p className="text-sm font-medium">{sendStatus}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className={`border p-4 rounded-lg text-sm space-y-4 ${
          result.error 
            ? 'bg-red-50 border-red-200 text-red-800' 
            : 'bg-gray-50 border-gray-200 text-gray-800'
        }`}>
          <div className="flex items-center justify-between">
            <strong>{result.error ? 'Error:' : 'Result:'}</strong>
            {!result.error && (
              <button
                onClick={() => copyToClipboard(JSON.stringify(result, null, 2))}
                className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded"
                title="Copy result"
              >
                Copy
              </button>
            )}
          </div>

          {result.error ? (
            <div className="bg-white border border-red-200 rounded p-3">
              <code className="text-red-700">{result.error}</code>
            </div>
          ) : typeof result === 'object' ? (
            <div className="space-y-2">
              {safeOutputSchema.map((field) => (
                <div key={field.name} className="bg-white border border-gray-200 rounded p-3">
                  <strong className="text-gray-700">{field.name}:</strong>
                  <div className="mt-1 text-gray-900">
                    {result[field.name] ? (
                      typeof result[field.name] === 'object' ? (
                        <pre className="text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                          {JSON.stringify(result[field.name], null, 2)}
                        </pre>
                      ) : (
                        <span className="break-words">{result[field.name]}</span>
                      )
                    ) : (
                      <span className="text-gray-400 italic">No data</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded p-3">
              <p className="break-words">{result}</p>
            </div>
          )}

          {/* Action Buttons */}
          {!result.error && (
            <div className="flex gap-3 pt-2 border-t border-gray-300">
              {(connectedPluginKeys.includes('google-mail') && result?.to && result?.subject && result?.body) && (
                <button
                  className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center gap-2"
                  onClick={handleSendEmail}
                >
                  Send Email via Gmail
                </button>
              )}

              {(safeOutputSchema.some((f) => ['SummaryBlock', 'EmailDraft'].includes(f.type))) && (
                <button
                  className="bg-gray-700 text-white px-4 py-2 rounded-lg hover:bg-gray-800 flex items-center gap-2"
                  onClick={handleDownloadPDF}
                >
                  Download PDF
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}