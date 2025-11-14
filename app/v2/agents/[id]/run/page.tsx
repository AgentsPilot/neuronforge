'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { V2Header } from '@/components/v2/V2Header'
import { Card } from '@/components/v2/ui/card'
import InputHelpButton from '@/components/v2/InputHelpButton'
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

  // Real-time step tracking for SSE
  const [executingSteps, setExecutingSteps] = useState<Set<string>>(new Set())
  const [completedStepsLive, setCompletedStepsLive] = useState<Set<string>>(new Set())
  const [failedStepsLive, setFailedStepsLive] = useState<Set<string>>(new Set())

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

    // Reset real-time step tracking
    setExecutingSteps(new Set())
    setCompletedStepsLive(new Set())
    setFailedStepsLive(new Set())

    try {
      const startTime = Date.now()

      // ARCHITECTURE (Updated to prevent duplicate execution):
      // 1. Generate session_id upfront for execution tracking
      // 2. Connect SSE stream FIRST (if workflow agent) to catch all events
      // 3. Start /api/run-agent execution with the same session_id
      // 4. Wait for /api/run-agent to complete (single source of truth)

      console.log('Starting agent execution...')

      // STEP 1: Generate session_id upfront for tracking
      const sessionId = crypto.randomUUID()
      console.log('Generated session_id:', sessionId)

      // STEP 2: For workflow-based agents, connect SSE stream FIRST (in background)
      // SSE will wait for events from the execution we're about to start
      const hasWorkflowSteps = agent.workflow_steps && agent.workflow_steps.length > 0

      if (hasWorkflowSteps) {
        // Start SSE connection immediately (runs in parallel with execution)
        // SSE will poll the database to find the execution once it's created
        fetch('/api/run-agent-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_id: agent.id,
            session_id: sessionId, // Backend will use this to find the right execution
          }),
        })
          .then(async (response) => {
            if (!response.ok) {
              console.warn('SSE visualization unavailable:', response.status, response.statusText)
              return
            }

            const reader = response.body?.getReader()
            if (!reader) return

            const decoder = new TextDecoder()
            let buffer = ''

            const processLine = (line: string) => {
              if (!line.trim() || !line.includes(':')) return

              const colonIndex = line.indexOf(':')
              const fieldName = line.substring(0, colonIndex).trim()
              const fieldValue = line.substring(colonIndex + 1).trim()

              if (fieldName === 'event') {
                buffer = fieldValue // Store event type
              } else if (fieldName === 'data') {
                const eventType = buffer
                const data = JSON.parse(fieldValue)

                if (eventType === 'step_started') {
                  setExecutingSteps(prev => new Set(prev).add(data.stepId))
                } else if (eventType === 'step_completed') {
                  setExecutingSteps(prev => {
                    const updated = new Set(prev)
                    updated.delete(data.stepId)
                    return updated
                  })
                  setCompletedStepsLive(prev => new Set(prev).add(data.stepId))
                } else if (eventType === 'step_failed') {
                  setExecutingSteps(prev => {
                    const updated = new Set(prev)
                    updated.delete(data.stepId)
                    return updated
                  })
                  setFailedStepsLive(prev => new Set(prev).add(data.stepId))
                }
                // Ignore execution_complete and error from SSE - we get final results from /api/run-agent

                buffer = ''
              }
            }

            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                const chunk = decoder.decode(value, { stream: true })
                chunk.split('\n').forEach(processLine)
              }
            } catch (err) {
              console.warn('SSE stream error (non-critical):', err)
            }
          })
          .catch(err => {
            console.warn('SSE streaming failed (non-critical):', err)
          })

        // Don't wait - start execution immediately so SSE can find it
        console.log('SSE stream initiated, starting execution immediately...')
      }

      // STEP 3: Start main execution (with sessionId for SSE correlation)
      const requestBody = {
        agent_id: agent.id,
        input_variables: formData,
        execution_type: 'test',
        use_queue: false,
        session_id: sessionId, // Pass sessionId for SSE correlation
      }

      const response = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

      if (res.error || (res.success === false && !res.pilot)) {
        const errorMessage = res.error || res.message || 'Execution failed'
        console.error('Execution failed with error:', errorMessage)
        console.error('Full response:', res)
        throw new Error(errorMessage)
      }

      if (res.success) {
        const resultData = {
          message: res.message,
          agentkit: res.pilot ? false : true,
          pilot: res.pilot || false,
          data: res.data,
          execution_duration_ms: executionTime,
          output: res.data
        }
        setResult(resultData)
      } else {
        const errorMessage = res.error || res.message || 'Execution failed'
        console.error('Unexpected execution state:', errorMessage)
        console.error('Full response:', res)
        throw new Error(errorMessage)
      }

      setExecuting(false)
    } catch (err: any) {
      console.error('Error executing agent:', err)
      setError(err.message || 'Failed to execute agent')
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

                    {/* Input Field with Help Button */}
                    <div className="flex items-center">
                      <div className="flex-1">
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
                            placeholder={field.placeholder || `Enter ${formatFieldName(field.name).toLowerCase()}...`}
                            required={field.required}
                            className="w-full px-3 py-2 border text-sm focus:outline-none focus:ring-1 bg-[var(--v2-surface)] border-[var(--v2-border)] focus:ring-[var(--v2-primary)] focus:border-[var(--v2-primary)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)]"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          />
                        )}
                      </div>

                      {/* InputHelpButton aligned to the right */}
                      <div className="ml-2">
                        <InputHelpButton
                          agentId={agent.id}
                          fieldName={field.name}
                          plugin={agent.plugins_required?.[0]}
                          expectedType={field.type}
                          onClick={() => openChatbot({
                            mode: 'input_help',
                            agentId: agent.id,
                            fieldName: field.name,
                            plugin: agent.plugins_required?.[0],
                            expectedType: field.type
                          })}
                          onFill={(value) => handleInputChange(field.name, value)}
                        />
                      </div>
                    </div>
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
              <div
                className="p-4 border"
                style={{
                  borderRadius: 'var(--v2-radius-button)',
                  backgroundColor: 'var(--v2-status-success-bg)',
                  borderColor: 'var(--v2-status-success-border)'
                }}>
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                  <h4 className="text-sm font-semibold" style={{ color: 'var(--v2-status-success-text)' }}>
                    Execution Completed Successfully
                  </h4>
                </div>
              </div>

              {result.agentkit || result.pilot ? (
                // AgentKit or Pilot execution - display the message and metrics
                <>
                  {/* Smart Execution Output - Structured Display */}
                  {result.pilot && result.data?.output && (
                    <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                      <div className="text-xs font-semibold text-[var(--v2-text-muted)] mb-3 uppercase tracking-wide flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Execution Output
                      </div>
                      <div className="space-y-2">
                        {Object.entries(result.data.output).map(([key, value]) => (
                          <div key={key} className="bg-[var(--v2-bg)] dark:bg-slate-800 border border-[var(--v2-border)] p-3" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                            <div className="text-xs text-[var(--v2-text-muted)] mb-1.5 font-medium capitalize">
                              {key.replace(/_/g, ' ')}
                            </div>
                            <div className="text-sm text-[var(--v2-text-primary)]">
                              {typeof value === 'string' ? (
                                <p className="whitespace-pre-wrap leading-relaxed">{value}</p>
                              ) : typeof value === 'number' || typeof value === 'boolean' ? (
                                <p className="font-semibold">{String(value)}</p>
                              ) : Array.isArray(value) ? (
                                <ul className="list-disc list-inside space-y-1">
                                  {value.map((item, idx) => (
                                    <li key={idx} className="text-sm">
                                      {typeof item === 'string' ? item : JSON.stringify(item)}
                                    </li>
                                  ))}
                                </ul>
                              ) : value && typeof value === 'object' ? (
                                <div className="space-y-1">
                                  {Object.entries(value).map(([subKey, subValue]) => (
                                    <div key={subKey} className="flex gap-2">
                                      <span className="text-[var(--v2-text-muted)] text-xs font-medium">{subKey}:</span>
                                      <span className="text-sm flex-1">
                                        {Array.isArray(subValue) ? (
                                          <ul className="list-disc list-inside space-y-0.5">
                                            {subValue.map((item, idx) => (
                                              <li key={idx} className="text-xs">
                                                {typeof item === 'object' && item !== null ? JSON.stringify(item, null, 2) : String(item)}
                                              </li>
                                            ))}
                                          </ul>
                                        ) : typeof subValue === 'object' && subValue !== null ? (
                                          <div className="space-y-0.5 ml-2">
                                            {Object.entries(subValue).map(([nestedKey, nestedValue]) => (
                                              <div key={nestedKey} className="flex gap-2 text-xs">
                                                <span className="text-[var(--v2-text-muted)] font-medium">{nestedKey}:</span>
                                                <span className="text-[var(--v2-text-primary)]">
                                                  {Array.isArray(nestedValue)
                                                    ? nestedValue.join(', ')
                                                    : typeof nestedValue === 'object' && nestedValue !== null
                                                    ? JSON.stringify(nestedValue)
                                                    : String(nestedValue)
                                                  }
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          String(subValue)
                                        )}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-[var(--v2-text-muted)] italic">No data</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Message Display (for non-pilot or AgentKit) */}
                  {result.message && !result.pilot && (
                    <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                      <div className="prose prose-sm max-w-none dark:prose-invert">
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
                        {result.pilot && result.data.stepsCompleted !== undefined && (
                          <div className="bg-[var(--v2-bg)] dark:bg-slate-800 border border-[var(--v2-border)] p-3" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                            <div className="text-xs text-[var(--v2-text-muted)] mb-1">Steps Completed</div>
                            <div className="font-semibold text-green-600 dark:text-green-400">{result.data.stepsCompleted}</div>
                          </div>
                        )}
                        {result.pilot && result.data.totalSteps !== undefined && (
                          <div className="bg-[var(--v2-bg)] dark:bg-slate-800 border border-[var(--v2-border)] p-3" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                            <div className="text-xs text-[var(--v2-text-muted)] mb-1">Total Steps</div>
                            <div className="font-semibold text-[var(--v2-text-primary]">{result.data.totalSteps}</div>
                          </div>
                        )}
                        {result.pilot && result.data.executionId && (
                          <div className="bg-[var(--v2-bg)] dark:bg-slate-800 border border-[var(--v2-border)] p-3 col-span-2" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                            <div className="text-xs text-[var(--v2-text-muted)] mb-1">Execution ID</div>
                            <div className="font-mono text-xs text-[var(--v2-text-primary)] break-all">{result.data.executionId}</div>
                          </div>
                        )}
                        {result.data.iterations !== undefined && !result.pilot && (
                          <div className="bg-[var(--v2-bg)] dark:bg-slate-800 border border-[var(--v2-border)] p-3" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                            <div className="text-xs text-[var(--v2-text-muted)] mb-1">Iterations</div>
                            <div className="font-semibold text-[var(--v2-text-primary)]">{result.data.iterations}</div>
                          </div>
                        )}
                        {result.data.tool_calls_count !== undefined && (
                          <div className="bg-[var(--v2-bg)] dark:bg-slate-800 border border-[var(--v2-border)] p-3" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                            <div className="text-xs text-[var(--v2-text-muted)] mb-1">Actions</div>
                            <div className="font-semibold text-[var(--v2-text-primary)]">{result.data.tool_calls_count}</div>
                          </div>
                        )}
                        {result.data.totalTokensUsed !== undefined && (
                          <div className="bg-[var(--v2-bg)] dark:bg-slate-800 border border-[var(--v2-border)] p-3" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                            <div className="text-xs text-[var(--v2-text-muted)] mb-1">Pilot Credits</div>
                            <div className="font-semibold text-[var(--v2-text-primary)]">{Math.round(result.data.totalTokensUsed / 10).toLocaleString()}</div>
                          </div>
                        )}
                        {result.data.tokens_used !== undefined && !result.data.totalTokensUsed && (
                          <div className="bg-[var(--v2-bg)] dark:bg-slate-800 border border-[var(--v2-border)] p-3" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                            <div className="text-xs text-[var(--v2-text-muted)] mb-1">Pilot Credits</div>
                            <div className="font-semibold text-[var(--v2-text-primary)]">{Math.round(result.data.tokens_used / 10).toLocaleString()}</div>
                          </div>
                        )}
                        {(result.data.execution_time_ms !== undefined || result.execution_duration_ms !== undefined) && (
                          <div className="bg-[var(--v2-bg)] dark:bg-slate-800 border border-[var(--v2-border)] p-3" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                            <div className="text-xs text-[var(--v2-text-muted)] mb-1">Duration</div>
                            <div className="font-semibold text-[var(--v2-text-primary)]">
                              {((result.data.execution_time_ms || result.execution_duration_ms) / 1000).toFixed(1)}s
                            </div>
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
                    .filter(([key]) => key !== 'send_status' && key !== 'agentkit' && key !== 'pilot' && key !== 'execution_duration_ms')
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
                              <pre className="text-xs bg-[var(--v2-bg)] dark:bg-slate-800 border border-[var(--v2-border)] p-3 overflow-x-auto font-mono" style={{ borderRadius: 'var(--v2-radius-button)' }}>
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

      {/* Execution Steps Visualization Card */}
      {agent.workflow_steps && agent.workflow_steps.length > 0 && (() => {
        const steps = agent.workflow_steps!

        // Get step execution status from result if available (final state)
        const completedSteps = result?.data?.completed_step_ids || []
        const failedSteps = result?.data?.failed_step_ids || []
        const skippedSteps = result?.data?.skipped_step_ids || []

        // Helper to get step status (combines live and final states)
        const getStepStatus = (stepId: string) => {
          // Live states (during execution)
          if (executing) {
            if (executingSteps.has(stepId)) return 'executing'
            if (completedStepsLive.has(stepId)) return 'completed'
            if (failedStepsLive.has(stepId)) return 'failed'
            return 'pending'
          }

          // Final states (after execution)
          if (completedSteps.includes(stepId)) return 'completed'
          if (failedSteps.includes(stepId)) return 'failed'
          if (skippedSteps.includes(stepId)) return 'skipped'
          return 'pending'
        }

        return (
          <Card className="!p-4 sm:!p-6">
            {/* Header */}
            <div className="flex items-center gap-2 mb-4">
              <GitBranch className="w-5 h-5 text-[var(--v2-primary)]" />
              <div>
                <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">Execution Steps</h3>
                <p className="text-xs text-[var(--v2-text-muted)]">
                  {steps.length} steps
                  {(executing || result) && ` • ${executing ? completedStepsLive.size : completedSteps.length} completed, ${executing ? failedStepsLive.size : failedSteps.length} failed, ${skippedSteps.length} skipped`}
                </p>
              </div>
            </div>

            {/* Execution Steps - Wrapping Grid */}
            <div className="flex flex-wrap gap-2">
              {steps.map((step: any, idx: number) => {
                const stepId = step.id || `step${idx + 1}`
                const status = getStepStatus(stepId)

                // Debug logging
                if (executing && idx === 0) {
                  console.log('Step status check:', {
                    stepId,
                    status,
                    executing,
                    executingSteps: Array.from(executingSteps),
                    completedStepsLive: Array.from(completedStepsLive),
                    hasStepId: executingSteps.has(stepId)
                  })
                }

                return (
                  <div key={idx} className="flex items-center gap-2">
                    {/* Step Card */}
                    <div className="relative group">
                      <div
                        className={`px-3 py-2 border transition-all duration-200 flex items-center gap-2 ${
                          status === 'executing' ? 'animate-pulse' : ''
                        } ${
                          status === 'pending' ? 'hover:border-[var(--v2-primary)] hover:shadow-sm' : ''
                        }`}
                        style={{
                          borderRadius: 'var(--v2-radius-button)',
                          backgroundColor: status === 'executing' ? 'var(--v2-status-executing-bg)' :
                                         status === 'completed' ? 'var(--v2-status-success-bg)' :
                                         status === 'failed' ? 'var(--v2-status-error-bg)' :
                                         status === 'skipped' ? 'var(--v2-status-warning-bg)' :
                                         'var(--v2-surface)',
                          borderColor: status === 'executing' ? 'var(--v2-status-executing-border)' :
                                      status === 'completed' ? 'var(--v2-status-success-border)' :
                                      status === 'failed' ? 'var(--v2-status-error-border)' :
                                      status === 'skipped' ? 'var(--v2-status-warning-border)' :
                                      'var(--v2-border)'
                        }}>
                        {/* Step Number Badge */}
                        <div className="relative flex-shrink-0">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                            status === 'executing' ? 'bg-blue-500' :
                            status === 'completed' ? 'bg-green-500' :
                            status === 'failed' ? 'bg-red-500' :
                            status === 'skipped' ? 'bg-yellow-500' :
                            'bg-gradient-to-br from-[var(--v2-primary)] to-[var(--v2-secondary)]'
                          }`}>
                            {status === 'executing' ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              idx + 1
                            )}
                          </div>
                          {step.validated && status === 'pending' && (
                            <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full flex items-center justify-center border border-white dark:border-slate-800">
                              <CheckCircle className="h-2 w-2 text-white fill-current" />
                            </div>
                          )}
                          {status === 'completed' && (
                            <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-600 rounded-full flex items-center justify-center border border-white dark:border-slate-800">
                              <CheckCircle className="h-2 w-2 text-white fill-current" />
                            </div>
                          )}
                          {status === 'failed' && (
                            <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-600 rounded-full flex items-center justify-center border border-white dark:border-slate-800">
                              <XCircle className="h-2 w-2 text-white fill-current" />
                            </div>
                          )}
                        </div>

                        {/* Step Content */}
                        <div className="flex items-center gap-2">
                          <span
                            className="text-xs font-medium max-w-[150px] truncate"
                            style={{
                              color: status === 'executing' ? 'var(--v2-status-executing-text)' :
                                    status === 'completed' ? 'var(--v2-status-success-text)' :
                                    status === 'failed' ? 'var(--v2-status-error-text)' :
                                    status === 'skipped' ? 'var(--v2-status-warning-text)' :
                                    'var(--v2-text-primary)'
                            }}>
                            {step.action || step.operation}
                          </span>

                          {/* Step Type Badge */}
                          {step.plugin && step.plugin_action ? (
                            <div className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-orange-50 dark:bg-slate-700 border border-orange-200 dark:border-orange-700 rounded">
                              <Settings className="h-2.5 w-2.5 text-orange-600 dark:text-orange-400" />
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-purple-50 dark:bg-slate-700 border border-purple-200 dark:border-purple-600 rounded">
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
                )
              })}
            </div>
          </Card>
        )
      })()}
    </div>
  )
}

