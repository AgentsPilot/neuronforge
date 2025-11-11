'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { V2Header } from '@/components/v2/V2Header'
import { Card } from '@/components/v2/ui/card'
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Play,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Sparkles,
  Settings,
  Bot,
  GitBranch
} from 'lucide-react'

type Field = {
  name: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'file' | 'email' | 'time' | 'select'
  enum?: string[]
  options?: string[]
  description?: string
  required?: boolean
  placeholder?: string
}

type Agent = {
  id: string
  agent_name: string
  description?: string
  status: string
  input_schema?: Field[]
  output_schema?: any[]
  user_prompt?: string
  plugins_required?: string[]
  connected_plugins?: Record<string, any>
  workflow_steps?: any[]
}

export default function V2RunAgentPage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const agentId = params.id as string

  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [executing, setExecuting] = useState(false)
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (user && agentId) {
      fetchAgentData()
    }
  }, [user, agentId])

  const fetchAgentData = async () => {
    if (!user || !agentId) return

    setLoading(true)
    try {
      const { data: agentData, error: agentError } = await supabase
        .from('agents')
        .select('*, workflow_steps')
        .eq('id', agentId)
        .eq('user_id', user.id)
        .single()

      if (agentError) throw agentError
      setAgent(agentData)

      // Load saved configuration
      const { data: configData } = await supabase
        .from('agent_configurations')
        .select('input_values')
        .eq('agent_id', agentId)
        .eq('user_id', user.id)
        .single()

      if (configData?.input_values) {
        setFormData(configData.input_values)
      }
    } catch (error) {
      console.error('Error fetching agent data:', error)
      router.push('/v2/agent-list')
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (name: string, value: any) => {
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleRun = async () => {
    if (!agent || !user) return

    setExecuting(true)
    setError(null)
    setResult(null)

    try {
      const startTime = Date.now()

      // Use the unified run-agent API endpoint (same as V1)
      const requestBody = {
        agent_id: agent.id,
        input_variables: formData, // Send form data as input_variables
        execution_type: 'test', // Mark as test execution
        use_queue: true // Use queue-based execution for tracking in Agent Activity dashboard
      }

      console.log('Sending request to run-agent:', {
        agentId: agent.id,
        requestBody,
        note: 'Will use Pilot if pilot_enabled=true and agent has pilot_steps, otherwise AgentKit'
      })

      const response = await fetch('/api/run-agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Execution failed: ${response.statusText} - ${errorText}`)
      }

      const res = await response.json()
      const endTime = Date.now()
      const executionTime = endTime - startTime

      console.log('AgentKit/Pilot response:', res)

      // Handle both AgentKit and Pilot execution results
      // Pilot returns success:false with message "Workflow completed" which is actually a success
      const isPilotSuccess = res.pilot && res.message === 'Workflow completed'

      if (res.success || isPilotSuccess) {
        // Build result object compatible with V1 sandbox UI
        const resultData = {
          message: res.message,
          agentkit: res.pilot ? false : true, // Use agentkit flag for AgentKit, not for Pilot
          pilot: res.pilot || false,
          data: res.data,
          execution_duration_ms: executionTime,
          output: res.data // Include data as output for display
        }

        setResult(resultData)
      } else {
        // Handle actual execution failure - provide detailed error message
        const errorMessage = res.error || res.message || 'Execution failed'
        console.error('Execution failed with error:', errorMessage)
        console.error('Full response:', res)
        throw new Error(errorMessage)
      }
    } catch (err: any) {
      console.error('Error executing agent:', err)
      setError(err.message || 'Failed to execute agent')
    } finally {
      setExecuting(false)
    }
  }

  const isFormValid = () => {
    if (!agent?.input_schema) return true

    const requiredFields = agent.input_schema.filter(field => field.required)
    return requiredFields.every(field => {
      const value = formData[field.name]
      return value !== undefined && value !== null && value !== ''
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--v2-primary)]" />
      </div>
    )
  }

  if (!agent) {
    return null
  }

  const safeInputSchema = Array.isArray(agent.input_schema) ? agent.input_schema : []

  // Transform field name to Title Case
  const formatFieldName = (name: string): string => {
    return name
      .replace(/[_-]/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
  }

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      {/* Top Bar: Back Button + User Menu */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push(`/v2/agents/${agentId}`)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:scale-105 transition-all duration-200 text-sm font-medium shadow-[var(--v2-shadow-card)]"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Agent
        </button>
        <V2Header />
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4 sm:gap-5 lg:gap-6 items-center">
        {/* Left Column - Input Form */}
        <Card className="!p-4 sm:!p-6">
          <div className="flex items-center gap-2 mb-6">
            <Play className="w-5 h-5 text-[var(--v2-primary)]" />
            <div>
              <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                Run {agent.agent_name}
              </h2>
              <p className="text-xs text-[var(--v2-text-muted)]">
                Configure inputs and execute agent
              </p>
            </div>
          </div>

          {/* Agent Status Warning */}
          {agent.status !== 'active' && (
            <div className="mb-6 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  This agent is not active. Activate it from the agent details page.
                </p>
              </div>
            </div>
          )}

          {/* Input Form */}
          <div className="space-y-4">
            {safeInputSchema.length === 0 ? (
              <div className="text-center py-8">
                <Sparkles className="w-12 h-12 text-[var(--v2-primary)] opacity-20 mx-auto mb-3" />
                <p className="text-sm text-[var(--v2-text-muted)]">
                  No inputs required. Just click Run!
                </p>
              </div>
            ) : (
              safeInputSchema.map((field) => (
                <div key={field.name}>
                  <label className="block">
                    {/* Label */}
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                        {formatFieldName(field.name)}
                      </span>
                      {field.required && (
                        <span className="text-red-500 dark:text-red-400 text-sm">*</span>
                      )}
                    </div>

                    {/* Description */}
                    {field.description && (
                      <p className="text-xs text-[var(--v2-text-muted)] mb-2">
                        {field.description}
                      </p>
                    )}

                    {/* Input Field */}
                    {field.type === 'select' || field.type === 'enum' ? (
                      <select
                        value={formData[field.name] || ''}
                        onChange={(e) => handleInputChange(field.name, e.target.value)}
                        className="w-full px-3 py-2 border text-sm focus:outline-none focus:ring-1 bg-[var(--v2-surface)] border-[var(--v2-border)] focus:ring-[var(--v2-primary)] focus:border-[var(--v2-primary)] text-[var(--v2-text-primary)]"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                        required={field.required}
                      >
                        <option value="">
                          {field.placeholder || 'Select an option...'}
                        </option>
                        {(field.options || field.enum || []).map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : field.type === 'boolean' ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`field-${field.name}`}
                          checked={formData[field.name] || false}
                          onChange={(e) => handleInputChange(field.name, e.target.checked)}
                          className="rounded border-[var(--v2-border)] h-4 w-4 text-[var(--v2-primary)] focus:ring-1 focus:ring-[var(--v2-primary)]"
                        />
                        <label htmlFor={`field-${field.name}`} className="text-sm text-[var(--v2-text-secondary)] cursor-pointer">
                          {field.placeholder || `Enable ${formatFieldName(field.name)}`}
                        </label>
                      </div>
                    ) : (
                      <input
                        type={
                          field.type === 'number' ? 'number' :
                          field.type === 'date' ? 'date' :
                          field.type === 'email' ? 'email' :
                          field.type === 'time' ? 'time' :
                          'text'
                        }
                        value={formData[field.name] || ''}
                        onChange={(e) => handleInputChange(field.name, e.target.value)}
                        placeholder={
                          field.type === 'time' ? 'HH:MM' :
                          field.placeholder || `Enter ${formatFieldName(field.name).toLowerCase()}...`
                        }
                        required={field.required}
                        className="w-full px-3 py-2 border text-sm focus:outline-none focus:ring-1 bg-[var(--v2-surface)] border-[var(--v2-border)] focus:ring-[var(--v2-primary)] focus:border-[var(--v2-primary)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)]"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      />
                    )}
                  </label>
                </div>
              ))
            )}

            {/* Run Button */}
            <button
              onClick={handleRun}
              disabled={executing || agent.status !== 'active' || !isFormValid()}
              className="w-full px-6 py-3 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white font-semibold hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {executing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Running Agent...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  Run Agent
                </>
              )}
            </button>
          </div>
        </Card>

        {/* Arrow between cards - hidden on mobile */}
        <div className="hidden lg:flex items-center justify-center">
          <ArrowRight className="w-6 h-6 text-[var(--v2-primary)]" />
        </div>

        {/* Right Column - Results */}
        <Card className="!p-4 sm:!p-6">
          <div className="flex items-center gap-2 mb-6">
            <Sparkles className="w-5 h-5 text-[var(--v2-primary)]" />
            <div>
              <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                Results
              </h2>
              <p className="text-xs text-[var(--v2-text-muted)]">
                Execution output and status
              </p>
            </div>
          </div>

          {/* Results Section */}
          {error ? (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800" style={{ borderRadius: 'var(--v2-radius-button)' }}>
              <div className="flex items-start gap-3">
                <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-red-900 dark:text-red-100 mb-1">
                    Execution Failed
                  </h4>
                  <p className="text-sm text-red-700 dark:text-red-300">
                    {error}
                  </p>
                </div>
              </div>
            </div>
          ) : result ? (
            <div className="space-y-4">
              {/* Success Banner */}
              <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                  <h4 className="text-sm font-semibold text-green-900 dark:text-green-100">
                    Execution Completed Successfully
                  </h4>
                </div>
              </div>

              {result.agentkit || result.pilot ? (
                // AgentKit or Pilot execution - display the message and metrics
                <>
                  {/* Message Display */}
                  {result.message && (
                    <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                      <div className="prose prose-sm max-w-none">
                        <div className="whitespace-pre-wrap text-[var(--v2-text-primary)] text-sm leading-relaxed">
                          {(() => {
                            const message = result.message || 'Execution completed successfully';
                            // Clean up message - remove detailed lists after summary
                            const summaryMarkers = [
                              'Here are the main points included in the summary:',
                              'Here are the key points:',
                              'Here\'s what was included:',
                              '\n\n-',
                              '\n\n*',
                              '\n\n1.',
                              '\n\n#'
                            ];

                            let cleanedMessage = message;
                            for (const marker of summaryMarkers) {
                              const idx = message.indexOf(marker);
                              if (idx > 0) {
                                cleanedMessage = message.substring(0, idx).trim();
                                break;
                              }
                            }

                            return cleanedMessage;
                          })()}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Execution Metrics */}
                  {result.data && (
                    <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                      <div className="text-xs font-semibold text-[var(--v2-text-muted)] mb-3 uppercase tracking-wide">
                        Execution Metrics
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {result.data.iterations !== undefined && (
                          <div className="bg-[var(--v2-background)] border border-[var(--v2-border)] p-3" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                            <div className="text-xs text-[var(--v2-text-muted)] mb-1">Steps</div>
                            <div className="font-semibold text-[var(--v2-text-primary)]">{result.data.iterations}</div>
                          </div>
                        )}
                        {result.data.tool_calls_count !== undefined && (
                          <div className="bg-[var(--v2-background)] border border-[var(--v2-border)] p-3" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                            <div className="text-xs text-[var(--v2-text-muted)] mb-1">Actions</div>
                            <div className="font-semibold text-[var(--v2-text-primary)]">{result.data.tool_calls_count}</div>
                          </div>
                        )}
                        {result.data.tokens_used !== undefined && (
                          <div className="bg-[var(--v2-background)] border border-[var(--v2-border)] p-3" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                            <div className="text-xs text-[var(--v2-text-muted)] mb-1">Pilot Credits</div>
                            <div className="font-semibold text-[var(--v2-text-primary)]">{Math.round(result.data.tokens_used / 10).toLocaleString()}</div>
                          </div>
                        )}
                        {result.data.execution_time_ms !== undefined && (
                          <div className="bg-[var(--v2-background)] border border-[var(--v2-border)] p-3" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                            <div className="text-xs text-[var(--v2-text-muted)] mb-1">Duration</div>
                            <div className="font-semibold text-[var(--v2-text-primary)]">{(result.data.execution_time_ms / 1000).toFixed(1)}s</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                // Legacy execution or other structured results
                <div className="space-y-3">
                  {Object.entries(result)
                    .filter(([key]) => key !== 'send_status' && key !== 'agentkit' && key !== 'execution_duration_ms')
                    .map(([key, value]) => (
                      <div key={key} className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-3" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-semibold text-[var(--v2-text-primary)] text-sm capitalize">
                            {key.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <div className="text-[var(--v2-text-primary)]">
                          {value !== null && value !== undefined && value !== '' ? (
                            typeof value === 'object' ? (
                              <pre className="text-xs bg-[var(--v2-background)] border border-[var(--v2-border)] p-3 overflow-x-auto font-mono" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                                {JSON.stringify(value, null, 2)}
                              </pre>
                            ) : (
                              <p className="text-sm whitespace-pre-wrap">{String(value)}</p>
                            )
                          ) : (
                            <p className="text-xs text-[var(--v2-text-muted)] italic">No data</p>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Clock className="w-16 h-16 text-[var(--v2-text-muted)] opacity-20 mb-4" />
              <p className="text-sm text-[var(--v2-text-muted)]">
                Run the agent to see results here
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* Workflow Steps Visualization Card */}
      {agent.workflow_steps && agent.workflow_steps.length > 0 && (() => {
        const steps = agent.workflow_steps!
        return (
          <Card className="!p-4 sm:!p-6">
            {/* Header */}
            <div className="flex items-center gap-2 mb-4">
              <GitBranch className="w-5 h-5 text-[var(--v2-primary)]" />
              <div>
                <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">Workflow Steps</h3>
                <p className="text-xs text-[var(--v2-text-muted)]">{steps.length} steps</p>
              </div>
            </div>

            {/* Workflow Steps - Wrapping Grid */}
            <div className="flex flex-wrap gap-2">
              {steps.map((step: any, idx: number) => (
                <div key={idx} className="flex items-center gap-2">
                  {/* Step Card */}
                  <div className="relative group">
                    <div className="px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:border-[var(--v2-primary)] hover:shadow-sm transition-all duration-200 flex items-center gap-2" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                      {/* Step Number Badge */}
                      <div className="relative flex-shrink-0">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[var(--v2-primary)] to-[var(--v2-secondary)] flex items-center justify-center text-white text-xs font-bold">
                          {idx + 1}
                        </div>
                        {step.validated && (
                          <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full flex items-center justify-center border border-white dark:border-slate-800">
                            <CheckCircle className="h-2 w-2 text-white fill-current" />
                          </div>
                        )}
                      </div>

                      {/* Step Content */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-[var(--v2-text-primary)] max-w-[150px] truncate">
                          {step.action || step.operation}
                        </span>

                        {/* Step Type Badge */}
                        {step.plugin && step.plugin_action ? (
                          <div className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded">
                            <Settings className="h-2.5 w-2.5 text-orange-600 dark:text-orange-400" />
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded">
                            <Bot className="h-2.5 w-2.5 text-purple-600 dark:text-purple-400" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Arrow between steps */}
                  {idx < steps.length - 1 && (
                    <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] border-l-[var(--v2-primary)]" />
                  )}
                </div>
              ))}
            </div>
          </Card>
        )
      })()}
    </div>
  )
}
