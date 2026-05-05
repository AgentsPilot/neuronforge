'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { V2Logo, V2Controls } from '@/components/v2/V2Header'
import { HelpBot } from '@/components/v2/HelpBot'
import { PilotDiagram } from '@/components/v2/WorkflowDiagram'
import {
  ArrowLeft,
  Loader2,
  Play,
  CheckCircle,
  XCircle,
  Clock,
  Bot,
  CreditCard,
  Copy,
  Check,
  TrendingUp
} from 'lucide-react'

// Helper function to format complex data for non-technical users
function formatUserFriendlyValue(value: any, depth = 0, isArrayItem = false): React.ReactNode {
  // Null/undefined/empty
  if (value === null || value === undefined || value === '') {
    return <span className="text-[var(--v2-text-muted)] italic text-sm">No data</span>
  }

  // Simple values
  if (typeof value === 'string') {
    // Truncate very long strings
    if (value.length > 200) {
      return <span className="text-[var(--v2-text-primary)] text-sm whitespace-pre-wrap leading-relaxed">{value.substring(0, 200)}...</span>
    }
    return <span className="text-[var(--v2-text-primary)] text-sm whitespace-pre-wrap leading-relaxed">{value}</span>
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="text-[var(--v2-text-primary)] font-semibold text-sm">{String(value)}</span>
  }

  // Arrays
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-[var(--v2-text-muted)] italic text-sm">Empty list</span>
    }

    // Small array of simple values - show inline
    if (value.length <= 3 && value.every(item => typeof item === 'string' || typeof item === 'number')) {
      return <span className="text-[var(--v2-text-primary)] text-sm">{value.join(', ')}</span>
    }

    // Larger arrays or complex items - show as list with limit
    const displayLimit = 5
    const hasMore = value.length > displayLimit
    const itemsToShow = hasMore ? value.slice(0, displayLimit) : value

    return (
      <div className="space-y-1.5">
        {itemsToShow.map((item, idx) => (
          <div key={idx} className="flex items-start gap-2">
            <span className="text-[var(--v2-text-muted)] text-xs mt-0.5">•</span>
            <div className="flex-1">{formatUserFriendlyValue(item, depth, true)}</div>
          </div>
        ))}
        {hasMore && (
          <div className="text-[var(--v2-text-muted)] text-xs italic pl-4">
            ...and {value.length - displayLimit} more items
          </div>
        )}
      </div>
    )
  }

  // Objects
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) {
      return <span className="text-[var(--v2-text-muted)] italic text-sm">Empty</span>
    }

    // For objects in arrays (like email items), show key fields only
    if (isArrayItem && entries.length > 8) {
      // Show only the most important/first few fields
      const importantKeys = ['id', 'subject', 'from', 'to', 'name', 'title', 'status', 'date', 'email']
      const filteredEntries = entries.filter(([key]) => importantKeys.includes(key.toLowerCase()))
      const displayEntries = filteredEntries.length > 0 ? filteredEntries.slice(0, 4) : entries.slice(0, 4)

      return (
        <div className="space-y-1">
          {displayEntries.map(([key, val]) => (
            <div key={key} className="flex gap-2">
              <span className="text-[var(--v2-text-muted)] text-xs font-medium capitalize">
                {key.replace(/_/g, ' ')}:
              </span>
              <span className="text-[var(--v2-text-primary)] text-sm flex-1">
                {typeof val === 'string' && val.length > 50
                  ? `${val.substring(0, 50)}...`
                  : typeof val === 'object'
                    ? JSON.stringify(val).substring(0, 50) + '...'
                    : String(val)
                }
              </span>
            </div>
          ))}
          {entries.length > displayEntries.length && (
            <span className="text-[var(--v2-text-muted)] text-xs italic">
              ...and {entries.length - displayEntries.length} more fields
            </span>
          )}
        </div>
      )
    }

    // Regular objects - show all fields with reasonable depth
    if (depth >= 3) {
      return <span className="text-[var(--v2-text-muted)] text-xs italic">Complex data...</span>
    }

    return (
      <div className="space-y-2">
        {entries.map(([key, val]) => (
          <div key={key} className="flex gap-2">
            <span className="text-[var(--v2-text-muted)] text-xs font-medium min-w-[80px] capitalize">
              {key.replace(/_/g, ' ')}:
            </span>
            <div className="flex-1">{formatUserFriendlyValue(val, depth + 1, false)}</div>
          </div>
        ))}
      </div>
    )
  }

  // Fallback
  return <span className="text-[var(--v2-text-primary)] text-sm">{String(value)}</span>
}

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
  pilot_steps?: any[]
}

export default function V2RunAgentPage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const agentId = params.id as string

  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [executing, setExecuting] = useState(false)

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
        if (saved && agent?.input_schema) {
          const parsed = JSON.parse(saved)

          // Filter out fields that are not in the current agent's input_schema
          // This prevents stale fields from old agent versions
          const validFieldNames = new Set(agent.input_schema.map((f: any) => f.name))
          const filtered: Record<string, any> = {}
          for (const [key, value] of Object.entries(parsed)) {
            if (validFieldNames.has(key)) {
              filtered[key] = value
            }
          }

          // Check if there's actual data (non-empty values)
          const hasData = Object.values(filtered).some(val => val !== '' && val !== null && val !== undefined)
          console.log('[Run Page INIT] Loading formData from sessionStorage:',
            hasData ? `${Object.keys(filtered).length} valid fields (filtered from ${Object.keys(parsed).length})` : 'empty values - will load from DB')

          // Only use sessionStorage data if it has actual non-empty values
          // If all values are empty, we'll load from DB instead
          if (hasData) {
            return filtered
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

  const [copiedExecutionId, setCopiedExecutionId] = useState(false)

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
  const [liveStepOutputs, setLiveStepOutputs] = useState<Record<string, any>>({})

  // Ref for auto-scrolling execution visualization
  const executionVizRef = useRef<HTMLDivElement>(null)
  const lastExecutingStepRef = useRef<string | null>(null)
  const lastCompletedCountRef = useRef<number>(0)

  // Auto-scroll to currently executing step - smooth and targeted
  useEffect(() => {
    if (!executionVizRef.current || !executing) return

    // Find the currently executing step or the most recently completed step
    const getTargetStepId = () => {
      // Priority 1: Currently executing step
      if (executingSteps.size > 0) {
        return Array.from(executingSteps)[0]
      }
      // Priority 2: Most recently completed step
      if (completedStepsLive.size > lastCompletedCountRef.current) {
        // Find the step that was just completed by comparing with all steps
        const allStepElements = executionVizRef.current.querySelectorAll('[data-step-id]')
        for (const element of Array.from(allStepElements).reverse()) {
          const stepId = element.getAttribute('data-step-id')
          if (stepId && completedStepsLive.has(stepId)) {
            return stepId
          }
        }
      }
      return null
    }

    const targetStepId = getTargetStepId()

    if (targetStepId) {
      // Update completed count tracker
      if (completedStepsLive.size > lastCompletedCountRef.current) {
        console.log('[Auto-scroll] Step completed:', {
          previous: lastCompletedCountRef.current,
          current: completedStepsLive.size,
          diff: completedStepsLive.size - lastCompletedCountRef.current,
          targetStep: targetStepId
        })
        lastCompletedCountRef.current = completedStepsLive.size
      }

      // Small delay to ensure DOM is updated
      setTimeout(() => {
        if (executionVizRef.current) {
          const container = executionVizRef.current
          const targetElement = container.querySelector(`[data-step-id="${targetStepId}"]`)

          if (targetElement) {
            const containerRect = container.getBoundingClientRect()
            const elementRect = targetElement.getBoundingClientRect()
            const relativeTop = elementRect.top - containerRect.top + container.scrollTop

            // Scroll to center the step in view
            const scrollTo = relativeTop - (container.clientHeight / 2) + (elementRect.height / 2)

            container.scrollTo({
              top: Math.max(0, scrollTo),
              behavior: 'smooth'
            })
          }
        }
      }, 150)
    }
  }, [executingSteps, completedStepsLive.size, executing])

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

  const fetchAgentData = useCallback(async () => {
    if (!user || !agentId) return

    setLoading(true)
    try {
      const { data: agentData, error: agentError } = await supabase
        .from('agents')
        .select('*, workflow_steps, pilot_steps')
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

      // Load configuration if found and not already loaded
      if (configData?.input_values) {
        console.log('[Run Page] Found configuration data:', configData.input_values)

        // Use functional update to get current state
        setFormData(current => {
          const currentKeys = Object.keys(current).length
          if (currentKeys === 0) {
            // Filter out fields that are not in the current agent's input_schema
            // This prevents stale fields from old agent versions
            const validFieldNames = new Set(agentData.input_schema?.map((f: any) => f.name) || [])
            const filtered: Record<string, any> = {}
            for (const [key, value] of Object.entries(configData.input_values)) {
              if (validFieldNames.has(key)) {
                filtered[key] = value
              }
            }

            console.log('[Run Page] Loading input values from configuration:',
              `${Object.keys(filtered).length} valid fields (filtered from ${Object.keys(configData.input_values).length})`,
              filtered)
            return filtered
          } else {
            console.log('[Run Page] NOT loading config because formData already has', currentKeys, 'fields')
            return current
          }
        })
      } else {
        console.log('[Run Page] No configuration data found in database for this agent')
        if (configError) {
          console.error('[Run Page] Configuration fetch error:', configError)
        }
      }
    } catch (error) {
      console.error('Error fetching agent data:', error)
      router.push('/v2/agent-list')
    } finally {
      setLoading(false)
    }
  }, [user, agentId, router])

  useEffect(() => {
    if (user && agentId) {
      fetchAgentData()
    }
  }, [user, agentId, fetchAgentData])


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

  // Handle chatbot filling a field (kept for HelpBot compatibility)
  const handleChatbotFill = (value: string) => {
    if (helpBotContext?.fieldName) {
      setFormData(prev => ({ ...prev, [helpBotContext.fieldName]: value }))
    }
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
    setLiveStepOutputs({})
    lastCompletedCountRef.current = 0 // Reset counter for new execution

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
      const workflowSteps = agent.pilot_steps || agent.workflow_steps
      const hasWorkflowSteps = workflowSteps && workflowSteps.length > 0

      if (hasWorkflowSteps) {
        // Start SSE connection immediately (runs in parallel with execution)
        // SSE will poll the database to find the execution once it's created
        console.log('[SSE] Starting stream connection for agent:', agent.id, 'session:', sessionId)
        fetch('/api/run-agent-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include', // Ensure cookies are sent for auth
          body: JSON.stringify({
            agent_id: agent.id,
            session_id: sessionId, // Backend will use this to find the right execution
          }),
        })
          .then(async (response) => {
            console.log('[SSE] Response received:', response.status, response.statusText)
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
                  console.log('[SSE] step_completed event:', {
                    stepId: data.stepId,
                    hasOutput: data.output !== undefined,
                    outputType: typeof data.output,
                    outputKeys: data.output && typeof data.output === 'object' ? Object.keys(data.output) : [],
                    fullData: data
                  })

                  setExecutingSteps(prev => {
                    const updated = new Set(prev)
                    updated.delete(data.stepId)
                    return updated
                  })
                  setCompletedStepsLive(prev => new Set(prev).add(data.stepId))
                  // Store step output if available
                  // For scatter-gather, the same step runs multiple times - aggregate the results
                  if (data.output !== undefined) {
                    console.log('[SSE] Storing output for', data.stepId, ':', data.output)
                    setLiveStepOutputs(prev => {
                      const existing = prev[data.stepId]
                      // If we already have output for this step, aggregate into an array
                      if (existing !== undefined) {
                        // If existing is already an array of aggregated results, append
                        if (Array.isArray(existing) && existing._aggregated) {
                          return {
                            ...prev,
                            [data.stepId]: Object.assign([...existing, data.output], { _aggregated: true })
                          }
                        }
                        // First duplicate - convert to aggregated array
                        return {
                          ...prev,
                          [data.stepId]: Object.assign([existing, data.output], { _aggregated: true })
                        }
                      }
                      // First time seeing this step
                      return {
                        ...prev,
                        [data.stepId]: data.output
                      }
                    })
                  } else {
                    console.warn('[SSE] No output provided for step', data.stepId)
                  }
                } else if (eventType === 'step_failed') {
                  setExecutingSteps(prev => {
                    const updated = new Set(prev)
                    updated.delete(data.stepId)
                    return updated
                  })
                  setFailedStepsLive(prev => new Set(prev).add(data.stepId))
                  // Store error info if available
                  if (data.error !== undefined) {
                    setLiveStepOutputs(prev => ({
                      ...prev,
                      [data.stepId]: { error: data.error }
                    }))
                  }
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
        execution_type: 'run',
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

  // Input configuration is done in the agent page drawer
  // The run page loads saved config from DB, so we always allow running
  const isFormValid = () => true

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


  return (
    <div className="min-h-screen" style={{ background: 'var(--v2-background)' }}>
      <div className="max-w-[1400px] mx-auto p-4">
        {/* Logo */}
        <div className="mb-3">
          <V2Logo />
        </div>

        {/* Back Button + Controls */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => router.push(`/v2/agents/${agentId}`)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-all duration-200 text-sm font-medium shadow-[var(--v2-shadow-card)]"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Agent
          </button>
          <V2Controls />
        </div>

        {/* Agent Info Card */}
        <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] p-5 mb-4" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <div className="flex items-center gap-3">
            <Bot className="w-8 h-8 text-[var(--v2-primary)] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-semibold text-[var(--v2-text-primary)] mb-0.5">
                {agent.agent_name}
              </h1>
              <p className="text-sm text-[var(--v2-text-secondary)]">
                {agent.description || 'No description provided'}
              </p>
            </div>
          </div>
        </div>

        {/* Single Column Layout */}
        <div className="flex flex-col gap-4">
          {/* Live Execution View */}
          <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] flex flex-col h-[500px] overflow-hidden" style={{ borderRadius: 'var(--v2-radius-panel)' }}>
            {/* Execution Header - Fixed */}
            <div className="px-6 py-4 border-b border-[var(--v2-border)] flex-shrink-0">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                    Live Progress
                  </h2>
                  {executing && (
                    <div className="px-3 py-1.5 bg-[var(--v2-status-executing-bg)] text-[var(--v2-status-executing-text)] font-semibold text-xs flex items-center gap-1.5 rounded-full animate-pulse">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Executing</span>
                    </div>
                  )}
                  {result && !executing && (
                    <div className="px-3 py-1.5 bg-[var(--v2-status-success-bg)] text-[var(--v2-status-success-text)] font-semibold text-xs flex items-center gap-1.5 rounded-full">
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>Completed</span>
                    </div>
                  )}
                </div>
                {/* Run Button */}
                <button
                  onClick={handleRun}
                  disabled={executing || agent.status !== 'active' || !isFormValid()}
                  className="px-5 py-2.5 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white font-semibold hover:opacity-90 hover:shadow-[var(--v2-shadow-button)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {executing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Running...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      <span>Run Workflow</span>
                    </>
                  )}
                </button>
              </div>

              {/* Progress Bar */}
              {(executing || result) && (() => {
                const rawSteps = agent.pilot_steps || agent.workflow_steps || []
                const countAllSteps = (steps: any[]): number => {
                  let count = 0
                  const processStep = (step: any) => {
                    count++
                    if (step.then_steps) step.then_steps.forEach(processStep)
                    if (step.else_steps) step.else_steps.forEach(processStep)
                    if (step.steps) step.steps.forEach(processStep)
                    if (step.scatter?.steps) step.scatter.steps.forEach(processStep)
                    if (step.loopSteps) step.loopSteps.forEach(processStep)
                  }
                  steps.forEach(processStep)
                  return count
                }
                const totalSteps = countAllSteps(rawSteps)
                const completedCount = executing ? completedStepsLive.size : (result?.data?.completedStepIds || []).length
                const progress = totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0

                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--v2-text-muted)]">
                        {completedCount} of {totalSteps} steps completed
                      </span>
                      <span className="text-[var(--v2-text-primary)] font-semibold">
                        {Math.round(progress)}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-[var(--v2-surface-hover)] rounded-full overflow-hidden">
                      <div
                        className={`h-full bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] transition-all duration-300 ease-out ${
                          executing && progress === 0 ? 'w-8 animate-pulse' : ''
                        }`}
                        style={{ width: progress > 0 ? `${progress}%` : undefined }}
                      />
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* Execution Visualization - Scrollable */}
            <div ref={executionVizRef} className="flex-1 overflow-y-auto px-6 py-6">
              {(() => {
                const rawSteps = agent.pilot_steps || agent.workflow_steps
                if (!rawSteps || rawSteps.length === 0) {
                  console.warn('[AgentRunPage] No workflow steps found', { pilot_steps: agent.pilot_steps, workflow_steps: agent.workflow_steps })
                  return (
                    <div className="flex flex-col items-center justify-center h-full text-center">
                      <Clock className="w-16 h-16 text-[var(--v2-text-muted)] opacity-20 mb-4" />
                      <p className="text-sm text-[var(--v2-text-muted)]">
                        Run the workflow to see execution progress
                      </p>
                    </div>
                  )
                }

              console.log('[AgentRunPage] Raw steps:', rawSteps.length, rawSteps)

              // Get step execution status from result if available (final state)
              const completedSteps = result?.data?.completedStepIds || []
              const failedSteps = result?.data?.failedStepIds || []
              const skippedSteps = result?.data?.skippedStepIds || []

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

              // Count all steps recursively for stats
              const countAllSteps = (steps: any[]): number => {
                let count = 0
                const processStep = (step: any) => {
                  count++
                  if (step.then_steps) step.then_steps.forEach(processStep)
                  if (step.else_steps) step.else_steps.forEach(processStep)
                  if (step.steps) step.steps.forEach(processStep)
                  if (step.scatter?.steps) step.scatter.steps.forEach(processStep)
                  if (step.loopSteps) step.loopSteps.forEach(processStep)
                }
                steps.forEach(processStep)
                return count
              }

              const totalSteps = countAllSteps(rawSteps)

              return (
                <div className="space-y-3">
                  {/* Pilot Execution Diagram */}
                  <PilotDiagram
                    steps={rawSteps}
                    getStepStatus={getStepStatus}
                    getStepOutput={(stepId: string) => liveStepOutputs[stepId]}
                    executing={executing}
                  />
                </div>
              )
            })()}
            </div>
          </div>

          {/* Execution Result Card */}
          <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] p-5" style={{ borderRadius: 'var(--v2-radius-card)' }}>
            {error ? (
                <>
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-4">
                    <XCircle className="w-5 h-5 text-[var(--v2-status-error-text)]" />
                    <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">Results</h3>
                  </div>

                  {/* Error Content */}
                  <div className="bg-[var(--v2-status-error-bg)] border border-[var(--v2-status-error-border)] p-4 rounded-lg">
                        <div className="flex items-start gap-3">
                          <XCircle className="w-5 h-5 text-[var(--v2-status-error-text)] flex-shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <h4 className="text-sm font-semibold text-[var(--v2-status-error-text)] mb-1">
                              Execution Failed
                            </h4>
                            <p className="text-sm text-[var(--v2-status-error-text)] mb-3">
                              {error}
                            </p>
                            {(error.includes('execution limit') || error.includes('Upgrade your plan') || error.includes('insufficient') || error.includes('quota')) && (
                              <button
                                onClick={() => router.push('/v2/billing')}
                                className="px-4 py-2 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white text-sm font-semibold hover:opacity-90 hover:shadow-[var(--v2-shadow-button)] transition-all flex items-center gap-2"
                                style={{ borderRadius: 'var(--v2-radius-button)' }}
                              >
                                <CreditCard className="w-4 h-4" />
                                Go to Billing
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                </>
              ) : result ? (
                <>
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-4">
                    <CheckCircle className="w-5 h-5 text-[var(--v2-status-success-text)]" />
                    <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">Results</h3>
                  </div>

                  {/* Success Banner */}
                  <div className="bg-[var(--v2-status-success-bg)] border border-[var(--v2-status-success-border)] p-3 rounded-lg mb-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-[var(--v2-status-success-text)]" />
                            <span className="text-sm font-semibold text-[var(--v2-status-success-text)]">
                              Execution Completed Successfully
                            </span>
                          </div>
                          <button
                            onClick={() => router.push(`/v2/agents/${agentId}`)}
                            className="px-3 py-1.5 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white text-xs font-semibold hover:opacity-90 hover:shadow-[var(--v2-shadow-button)] transition-all flex items-center gap-1.5"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          >
                            <TrendingUp className="w-3.5 h-3.5" />
                            View in Activity
                          </button>
                        </div>
                      </div>

                      {result.agentkit || result.pilot ? (
                        // AgentKit or Pilot execution - display the message and metrics
                        <>
                          {/* Execution Summary Metrics */}
                          {result.pilot && result.data && (
                            <div className="p-3 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg">
                              <div className="grid grid-cols-4 gap-4">
                                <div>
                                  <div className="text-[10px] text-[var(--v2-text-muted)] uppercase tracking-wide mb-1">Total Time</div>
                                  <div className="text-sm font-semibold text-[var(--v2-text-primary)]">
                                    {((result.data.execution_time_ms || result.execution_duration_ms || 0) / 1000).toFixed(2)}s
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[10px] text-[var(--v2-text-muted)] uppercase tracking-wide mb-1">Completed</div>
                                  <div className="text-sm font-semibold text-[var(--v2-status-success-text)]">
                                    {result.data.stepsCompleted || 0} steps
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[10px] text-[var(--v2-text-muted)] uppercase tracking-wide mb-1">Credits Used</div>
                                  <div className="text-sm font-semibold text-[var(--v2-text-primary)]">
                                    {Math.round((result.data.totalTokensUsed || 0) / 10).toLocaleString()}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[10px] text-[var(--v2-text-muted)] uppercase tracking-wide mb-1">Execution ID</div>
                                  <div className="flex items-center gap-1.5">
                                    <div className="text-xs font-mono text-[var(--v2-text-primary)] truncate" title={result.data.executionId}>
                                      {result.data.executionId ? result.data.executionId.substring(0, 12) + '...' : 'N/A'}
                                    </div>
                                    {result.data.executionId && (
                                      <button
                                        onClick={async () => {
                                          try {
                                            await navigator.clipboard.writeText(result.data.executionId)
                                            setCopiedExecutionId(true)
                                            setTimeout(() => setCopiedExecutionId(false), 2000)
                                          } catch (err) {
                                            console.error('Failed to copy:', err)
                                          }
                                        }}
                                        className="p-1 hover:bg-[var(--v2-bg)] rounded transition-colors"
                                        title="Copy Execution ID"
                                      >
                                        {copiedExecutionId ? (
                                          <Check className="w-3 h-3 text-[var(--v2-status-success-text)]" />
                                        ) : (
                                          <Copy className="w-3 h-3 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]" />
                                        )}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                  {/* AgentKit message display */}
                  {result.agentkit && result.message && (
                    <div className="bg-[var(--v2-surface-hover)] border border-[var(--v2-border)] p-4" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                      <div className="prose prose-sm max-w-none dark:prose-invert">
                        <div className="whitespace-pre-wrap text-[var(--v2-text-primary)] text-sm leading-relaxed">
                          {result.message}
                        </div>
                      </div>
                    </div>
                  )}

                          {/* Message Display (for non-pilot AgentKit) */}
                          {result.message && !result.pilot && result.agentkit && (
                            <div className="mt-3 p-3 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg">
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
                        </>
                      ) : (
                        // Legacy execution or other structured results
                        <div className="p-3 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg">
                          <div className="space-y-3">
                            {Object.entries(result)
                              .filter(([key]) => key !== 'send_status' && key !== 'agentkit' && key !== 'pilot' && key !== 'execution_duration_ms')
                              .map(([key, value]) => (
                                <div key={key}>
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="font-semibold text-[var(--v2-text-primary)] text-sm capitalize">
                                      {key.replace(/_/g, ' ')}
                                    </span>
                                  </div>
                                  <div className="text-[var(--v2-text-primary)]">
                                    {formatUserFriendlyValue(value)}
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                </>
              ) : (
                <>
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-4">
                    <Clock className="w-5 h-5 text-[var(--v2-text-muted)]" />
                    <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">Results</h3>
                  </div>

                  {/* Waiting State */}
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Clock className="w-12 h-12 text-[var(--v2-text-muted)] opacity-20 mb-3" />
                    <p className="text-sm text-[var(--v2-text-muted)]">
                      {executing ? 'Execution in progress...' : 'No execution results yet'}
                    </p>
                    {!executing && (
                      <p className="text-xs text-[var(--v2-text-muted)] mt-1">
                        Click "Run Workflow" to start
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
        </div>

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
    </div>
  )
}

