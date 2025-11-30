'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { V2Logo, V2Controls } from '@/components/v2/V2Header'
import { Card } from '@/components/v2/ui/card'
import InputHelpButton from '@/components/v2/InputHelpButton'
import { HelpBot } from '@/components/v2/HelpBot'
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
  GitBranch,
  CreditCard
} from 'lucide-react'

type Field = {
  name: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'file' | 'email' | 'time' | 'select'
  label?: string
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

  // Track if config has been loaded - initialize based on whether we loaded from sessionStorage
  const [configLoaded, setConfigLoaded] = useState(() => {
    if (typeof window !== 'undefined' && agentId) {
      const isPageActive = sessionStorage.getItem(`runPage_active_${agentId}`)
      if (isPageActive === 'true') {
        const saved = sessionStorage.getItem(`runPage_formData_${agentId}`)
        if (saved) {
          const parsed = JSON.parse(saved)
          // Check if there's actual data (non-empty values)
          const hasData = Object.values(parsed).some(val => val !== '' && val !== null && val !== undefined)
          // If we loaded data from sessionStorage, mark config as loaded
          return hasData
        }
      }
    }
    return false
  })

  // Persist formData across page refreshes only (clear on navigation to reload from DB)
  const [formData, setFormData] = useState<Record<string, any>>(() => {
    if (typeof window !== 'undefined' && agentId) {
      // Check if we're coming from a refresh or a new navigation
      // IMPORTANT: Check BEFORE setting the flag in useEffect
      const isPageActive = sessionStorage.getItem(`runPage_active_${agentId}`)

      console.log('[Run Page INIT] formData initialization - isPageActive:', isPageActive)

      if (isPageActive === 'true') {
        // Page was already active, this is a refresh
        const saved = sessionStorage.getItem(`runPage_formData_${agentId}`)
        if (saved) {
          const parsed = JSON.parse(saved)
          // Check if there's actual data (non-empty values)
          const hasData = Object.values(parsed).some(val => val !== '' && val !== null && val !== undefined)
          console.log('[Run Page INIT] Loading formData from sessionStorage:', hasData ? Object.keys(parsed) : 'empty values - will load from DB')

          // Only use sessionStorage data if it has actual non-empty values
          // If all values are empty, we'll load from DB instead
          if (hasData) {
            return parsed
          }
        }
        // Fall through to return {} and load from DB
      } else {
        // New navigation, clear any old form data to reload fresh from DB
        console.log('[Run Page INIT] New navigation - clearing old formData')
        sessionStorage.removeItem(`runPage_formData_${agentId}`)
      }
      return {}
    }
    return {}
  })

  // Persist execution result across page refreshes only (clear on navigation)
  const [result, setResult] = useState<any>(() => {
    if (typeof window !== 'undefined') {
      // Check if we're coming from a refresh or a new navigation
      const isPageActive = sessionStorage.getItem(`runPage_active_${agentId}`)

      if (isPageActive === 'true') {
        // Page was already active, this is a refresh - keep the result
        const saved = sessionStorage.getItem(`runPage_result_${agentId}`)
        return saved ? JSON.parse(saved) : null
      } else {
        // New navigation, clear any old results
        sessionStorage.removeItem(`runPage_result_${agentId}`)
        return null
      }
    }
    return null
  })

  // Persist error state across page refreshes only (clear on navigation)
  const [error, setError] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      // Check if we're coming from a refresh or a new navigation
      const isPageActive = sessionStorage.getItem(`runPage_active_${agentId}`)

      if (isPageActive === 'true') {
        // Page was already active, this is a refresh - keep the error
        const saved = sessionStorage.getItem(`runPage_error_${agentId}`)
        if (saved) {
          // Clean up malformed error messages (from before the fix)
          if (saved.includes('{"success":false')) {
            try {
              const jsonStart = saved.indexOf('{')
              const jsonStr = saved.substring(jsonStart)
              const parsed = JSON.parse(jsonStr)
              return parsed.error || saved
            } catch {
              return saved
            }
          }
          return saved
        }
      } else {
        // New navigation, clear any old errors
        sessionStorage.removeItem(`runPage_error_${agentId}`)
      }
      return null
    }
    return null
  })

  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // HelpBot state - persist across page refreshes
  const [helpBotOpen, setHelpBotOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('helpBotOpen')
      console.log('[Parent INIT] Loading helpBotOpen from sessionStorage:', saved)
      return saved === 'true'
    }
    return false
  })
  const [helpBotContext, setHelpBotContext] = useState<any>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('helpBotContext')
      console.log('[Parent INIT] Loading helpBotContext from sessionStorage:', saved)
      return saved ? JSON.parse(saved) : null
    }
    return null
  })

  // Save to sessionStorage when state changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('helpBotOpen', String(helpBotOpen))
      if (helpBotContext) {
        sessionStorage.setItem('helpBotContext', JSON.stringify(helpBotContext))
      } else {
        sessionStorage.removeItem('helpBotContext')
      }
    }
  }, [helpBotOpen, helpBotContext])

  // Save formData to sessionStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined' && agentId) {
      sessionStorage.setItem(`runPage_formData_${agentId}`, JSON.stringify(formData))
    }
  }, [formData, agentId])

  // Mark page as active on mount, clear on unmount (for navigation detection)
  useEffect(() => {
    if (typeof window !== 'undefined' && agentId) {
      // Set the flag when component mounts
      sessionStorage.setItem(`runPage_active_${agentId}`, 'true')

      // Clear the flag when user navigates away
      return () => {
        sessionStorage.removeItem(`runPage_active_${agentId}`)
      }
    }
  }, [agentId])

  // Save result to sessionStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined' && agentId) {
      if (result) {
        sessionStorage.setItem(`runPage_result_${agentId}`, JSON.stringify(result))
      } else {
        sessionStorage.removeItem(`runPage_result_${agentId}`)
      }
    }
  }, [result, agentId])

  // Save error to sessionStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined' && agentId) {
      if (error) {
        sessionStorage.setItem(`runPage_error_${agentId}`, error)
      } else {
        sessionStorage.removeItem(`runPage_error_${agentId}`)
      }
    }
  }, [error, agentId])

  // Real-time step tracking for SSE
  const [executingSteps, setExecutingSteps] = useState<Set<string>>(new Set())
  const [completedStepsLive, setCompletedStepsLive] = useState<Set<string>>(new Set())
  const [failedStepsLive, setFailedStepsLive] = useState<Set<string>>(new Set())

  // Clear stale execution limit errors when user has credits
  useEffect(() => {
    if (!user || !error) return

    const checkAndClearStaleErrors = async () => {
      // Only check if the error is about execution limits or quota
      if (error.includes('execution limit') || error.includes('quota') || error.includes('Upgrade your plan')) {
        try {
          const { data: subscription } = await supabase
            .from('user_subscriptions')
            .select('account_frozen, balance, executions_quota, executions_used')
            .eq('user_id', user.id)
            .single()

          if (subscription) {
            // If account is not frozen and has credits, clear the error
            const hasCredits = (subscription.balance || 0) > 0
            const notFrozen = !subscription.account_frozen
            const hasExecutionQuota = !subscription.executions_quota ||
              (subscription.executions_used || 0) < subscription.executions_quota

            if (notFrozen && hasCredits && hasExecutionQuota) {
              console.log('[Run Page] Clearing stale execution limit error - user now has credits')
              setError(null)
            }
          }
        } catch (err) {
          console.error('[Run Page] Error checking subscription status:', err)
        }
      }
    }

    checkAndClearStaleErrors()
  }, [user, error])

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

      // Load saved configuration (most recent 'configured' entry)
      // Always query the database
      const { data: configData, error: configError } = await supabase
        .from('agent_configurations')
        .select('input_values')
        .eq('agent_id', agentId)
        .eq('user_id', user.id)
        .eq('status', 'configured')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      console.log('[Run Page] Config query result:', {
        hasConfigData: !!configData,
        inputValuesKeys: configData?.input_values ? Object.keys(configData.input_values) : [],
        configError,
        currentFormDataKeys: Object.keys(formData)
      })

      // Load configuration if found and not already loaded
      if (configData?.input_values && !configLoaded) {
        // Use functional update to get current state
        setFormData(current => {
          const currentKeys = Object.keys(current).length
          if (currentKeys === 0) {
            console.log('[Run Page] Loading input values from configuration:', configData.input_values)
            setConfigLoaded(true) // Mark as loaded
            return configData.input_values
          } else {
            console.log('[Run Page] NOT loading config because formData already has', currentKeys, 'fields')
            return current
          }
        })
      } else if (!configData?.input_values) {
        console.log('[Run Page] No configuration data found in database for this agent')
      } else {
        console.log('[Run Page] Config already loaded, skipping')
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

  const handleSaveInputs = async () => {
    if (!agent || !user) return

    setSaving(true)
    setSaveMessage(null)

    try {
      const response = await fetch('/api/agent-configurations/save-inputs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agent.id,
          input_values: formData,
          input_schema: agent.input_schema
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save input values')
      }

      setSaveMessage({ type: 'success', text: 'Input values saved successfully!' })

      // Clear success message after 3 seconds
      setTimeout(() => setSaveMessage(null), 3000)
    } catch (err: any) {
      console.error('Error saving input values:', err)
      setSaveMessage({ type: 'error', text: err.message || 'Failed to save input values' })

      // Clear error message after 5 seconds
      setTimeout(() => setSaveMessage(null), 5000)
    } finally {
      setSaving(false)
    }
  }

  // Open chatbot for field help OR general help
  const openChatbot = (context?: any) => {
    console.log('[Parent] openChatbot called with context:', context?.fieldName || 'general')
    console.log('[Parent] Current helpBotContext:', helpBotContext?.fieldName || 'none')
    console.log('[Parent] helpBotOpen:', helpBotOpen)

    // If chatbot is already open with a different context, update it
    if (helpBotOpen && context && helpBotContext?.fieldName !== context?.fieldName) {
      console.log('[Parent] Switching context from', helpBotContext?.fieldName, 'to', context.fieldName)
    }

    setHelpBotContext(context || null) // null = general help mode
    setHelpBotOpen(true)
  }

  // Toggle chatbot (for general help button)
  const toggleChatbot = () => {
    if (helpBotOpen) {
      setHelpBotOpen(false)
      setHelpBotContext(null)
    } else {
      openChatbot() // Open in general help mode
    }
  }

  // Handle chatbot filling a field
  const handleChatbotFill = (value: string) => {
    if (helpBotContext?.fieldName) {
      handleInputChange(helpBotContext.fieldName, value)
    }
  }

  // Infer plugin from field name
  const inferPluginFromFieldName = (fieldName: string): string | undefined => {
    const fieldLower = fieldName.toLowerCase()

    // Special case: "range" field is for manual text input (e.g., "A1:B10"), not URL extraction
    // So we still detect it as Sheets but with special handling in the parser

    // Google Sheets patterns (includes fields that need URL extraction)
    if (
      fieldLower.includes('sheet') ||
      fieldLower.includes('spreadsheet') ||
      fieldLower.includes('range') ||       // Cell range field (manual input, but Sheets-related)
      fieldLower.includes('cell') ||
      fieldLower.includes('row') ||
      fieldLower.includes('column') ||
      fieldLower.includes('tab') ||
      fieldLower.includes('worksheet')
    ) {
      return 'google-sheets'
    }

    // Gmail patterns
    if (
      fieldLower.includes('email') ||
      fieldLower.includes('gmail') ||
      fieldLower.includes('message') ||
      fieldLower.includes('inbox') ||
      fieldLower.includes('subject') ||
      fieldLower.includes('recipient')
    ) {
      return 'google-mail'
    }

    // Google Drive patterns
    if (
      fieldLower.includes('drive') ||
      fieldLower.includes('file') ||
      fieldLower.includes('folder') ||
      fieldLower.includes('document') ||
      fieldLower.includes('doc')
    ) {
      return 'google-drive'
    }

    // Notion patterns
    if (
      fieldLower.includes('notion') ||
      fieldLower.includes('database') ||
      fieldLower.includes('page') ||
      fieldLower.includes('block')
    ) {
      return 'notion'
    }

    // Slack patterns
    if (
      fieldLower.includes('slack') ||
      fieldLower.includes('channel') ||
      fieldLower.includes('workspace')
    ) {
      return 'slack'
    }

    // Fallback to first plugin in agent's requirements
    return agent?.plugins_required?.[0]
  }

  const handleRun = async () => {
    if (!agent || !user) return

    setExecuting(true)
    // Clear previous results before starting new execution
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

      const endTime = Date.now()
      const executionTime = endTime - startTime

      // Parse response - could be error or success
      let res
      if (!response.ok) {
        const errorText = await response.text()
        console.log('[DEBUG] Error response text:', errorText)

        let parsedError
        try {
          parsedError = JSON.parse(errorText)
          console.log('[DEBUG] Parsed error:', parsedError)
        } catch (parseError) {
          console.error('[DEBUG] JSON parse failed:', parseError)
          // If JSON parsing fails, show the raw error
          throw new Error(`Execution failed: ${response.statusText} - ${errorText}`)
        }

        // Extract user-friendly error message from parsed JSON
        const errorMessage = parsedError.error || parsedError.message || `Execution failed: ${response.statusText}`
        console.log('[DEBUG] Extracted error message:', errorMessage)
        console.error('Execution failed with error:', errorMessage)
        console.error('Full response:', parsedError)
        throw new Error(errorMessage)
      }

      res = await response.json()
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
      {/* Logo - First Line */}
      <div className="mb-3">
        <V2Logo />
      </div>

      {/* Back Button + Controls */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push(`/v2/agents/${agentId}`)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:scale-105 transition-all duration-200 text-sm font-medium shadow-[var(--v2-shadow-card)]"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Agent
        </button>
        <V2Controls />
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
                        {field.label || formatFieldName(field.name)}
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
                          plugin={inferPluginFromFieldName(field.name)}
                          expectedType={field.type}
                          onClick={() => openChatbot({
                            mode: 'input_help',
                            agentId: agent.id,
                            fieldName: field.name,
                            fieldLabel: field.label || formatFieldName(field.name),
                            plugin: inferPluginFromFieldName(field.name),
                            expectedType: field.type
                          })}
                        />
                      </div>
                    </div>
                  </label>
                </div>
              ))
            )}

            {/* Save Message */}
            {saveMessage && (
              <div
                className={`p-3 border ${
                  saveMessage.type === 'success'
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <div className="flex items-center gap-2">
                  {saveMessage.type === 'success' ? (
                    <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                  )}
                  <p className={`text-sm ${
                    saveMessage.type === 'success'
                      ? 'text-green-700 dark:text-green-300'
                      : 'text-red-700 dark:text-red-300'
                  }`}>
                    {saveMessage.text}
                  </p>
                </div>
              </div>
            )}

            {/* Save and Run Buttons */}
            <div className="flex flex-col gap-2">
              <div className="flex gap-3">
                {/* Save Inputs Button */}
                <button
                  onClick={handleSaveInputs}
                  disabled={saving || !isFormValid()}
                  className="flex-1 px-6 py-3 bg-[var(--v2-surface)] border-2 border-[var(--v2-primary)] text-[var(--v2-primary)] font-semibold hover:bg-[var(--v2-primary)] hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Settings className="w-5 h-5" />
                      Save Inputs
                    </>
                  )}
                </button>

                {/* Run Button */}
                <button
                  onClick={handleRun}
                  disabled={executing || agent.status !== 'active' || !isFormValid()}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white font-semibold hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

              {/* Reload Configuration Button - for debugging */}
              <button
                onClick={async () => {
                  // Clear sessionStorage and reload from DB
                  sessionStorage.removeItem(`runPage_formData_${agentId}`)
                  setConfigLoaded(false) // Reset the flag
                  setFormData({}) // Clear current form data
                  await fetchAgentData()
                }}
                className="text-xs px-3 py-1.5 text-[var(--v2-text-secondary)] hover:text-[var(--v2-primary)] transition-colors"
              >
                Reload saved configuration
              </button>
            </div>
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
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-red-900 dark:text-red-100 mb-1">
                    Execution Failed
                  </h4>
                  <p className="text-sm text-red-700 dark:text-red-300 mb-3">
                    {error}
                  </p>
                  {(error.includes('execution limit') || error.includes('Upgrade your plan') || error.includes('insufficient') || error.includes('quota')) && (
                    <button
                      onClick={() => router.push('/v2/billing')}
                      className="px-4 py-2 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white text-sm font-semibold hover:scale-105 transition-all shadow-[var(--v2-shadow-button)] flex items-center gap-2"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <CreditCard className="w-4 h-4" />
                      Go to Billing
                    </button>
                  )}
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

      {/* HelpBot - handles both floating button and window */}
      <HelpBot
        isOpen={helpBotOpen}
        context={helpBotContext}
        onFill={handleChatbotFill}
        onOpen={() => {
          setHelpBotOpen(true)
          setHelpBotContext(null) // Open in general help mode
        }}
        onClose={() => {
          setHelpBotOpen(false)
          setHelpBotContext(null)
        }}
      />
    </div>
  )
}

