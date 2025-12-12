'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { V2Logo, V2Controls } from '@/components/v2/V2Header'
import { Card } from '@/components/v2/ui/card'
import InputHelpButton from '@/components/v2/InputHelpButton'
import { HelpBot } from '@/components/v2/HelpBot'
import { PilotDiagram } from '@/components/v2/WorkflowDiagram'
import { DynamicSelectField } from '@/components/v2/DynamicSelectField'
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
  CreditCard,
  RefreshCw,
  Zap,
  Filter,
  Search,
  FileText,
  Send,
  CheckSquare,
  Layers,
  GitMerge,
  UserCheck,
  ChevronRight,
  Copy,
  Check,
  Type,
  Hash,
  Mail,
  Calendar,
  ToggleLeft,
  List,
  ChevronDown,
  AlignLeft
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
  const [schemaMetadata, setSchemaMetadata] = useState<Record<string, any[]> | null>(null)

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

  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
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
        // Use functional update to get current state
        setFormData(current => {
          const currentKeys = Object.keys(current).length
          if (currentKeys === 0) {
            // Filter out fields that are not in the current agent's input_schema
            // This prevents stale fields from old agent versions
            const validFieldNames = new Set(agent?.input_schema?.map((f: any) => f.name) || [])
            const filtered: Record<string, any> = {}
            for (const [key, value] of Object.entries(configData.input_values)) {
              if (validFieldNames.has(key)) {
                filtered[key] = value
              }
            }

            console.log('[Run Page] Loading input values from configuration:',
              `${Object.keys(filtered).length} valid fields (filtered from ${Object.keys(configData.input_values).length})`,
              filtered)
            setConfigLoaded(true) // Mark as loaded
            return filtered
          } else {
            console.log('[Run Page] NOT loading config because formData already has', currentKeys, 'fields')
            return current
          }
        })
      } else {
        console.log('[Run Page] No configuration data found in database for this agent')
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

  // Fetch plugin schema metadata on mount
  useEffect(() => {
    const fetchSchemaMetadata = async () => {
      try {
        const response = await fetch('/api/plugins/schema-metadata')
        if (!response.ok) {
          console.error('Failed to fetch schema metadata:', response.statusText)
          return
        }
        const data = await response.json()
        console.log('[Run Page] Schema metadata loaded:', data.metadata)
        setSchemaMetadata(data.metadata)
      } catch (error) {
        console.error('[Run Page] Error fetching schema metadata:', error)
      }
    }

    fetchSchemaMetadata()
  }, [])

  const handleInputChange = (name: string, value: any) => {
    console.log('[handleInputChange]', { name, value, type: typeof value })
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

  // Use schema metadata to determine which inputs should use dynamic dropdowns
  const getDynamicOptionsForInput = useCallback((fieldName: string): { plugin: string; action: string; parameter: string; depends_on?: string[] } | null => {
    // Wait for schema metadata to load
    if (!schemaMetadata) {
      console.log('[getDynamicOptions] Schema metadata not loaded yet')
      return null
    }

    // Check if this field name matches any parameter with x-dynamic-options
    const matchingParams = schemaMetadata[fieldName]

    if (matchingParams && matchingParams.length > 0) {
      // Found a match! Use the first one (most plugins will have unique parameter names)
      const match = matchingParams[0]
      console.log('[getDynamicOptions] Found match for', fieldName, '→', match)
      return {
        plugin: match.plugin,
        action: match.action,
        parameter: match.parameter,
        depends_on: match.depends_on
      }
    }

    console.log('[getDynamicOptions] No match found for', fieldName)
    return null
  }, [schemaMetadata])

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
                  // Store step output if available
                  if (data.output !== undefined) {
                    setLiveStepOutputs(prev => ({
                      ...prev,
                      [data.stepId]: data.output
                    }))
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

  // Debug: log the full input schema from the agent
  console.log('[Agent Run Page] Full input_schema from agent:', {
    count: safeInputSchema.length,
    fields: safeInputSchema.map((f: any) => f.name),
    full: agent.input_schema
  })

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
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        {(() => {
                          // Check if this field should use dynamic dropdown
                          const dynamicOptions = getDynamicOptionsForInput(field.name)

                          if (dynamicOptions) {
                            // Build dependent values object from formData if this field has dependencies
                            const dependentValues: Record<string, any> = {}
                            if (dynamicOptions.depends_on && Array.isArray(dynamicOptions.depends_on)) {
                              dynamicOptions.depends_on.forEach((depField: string) => {
                                if (formData[depField]) {
                                  dependentValues[depField] = formData[depField]
                                }
                              })
                            }

                            console.log('[Agent Run Page] Rendering DynamicSelectField:', {
                              field: field.name,
                              dynamicOptions,
                              dependentValues,
                              formData
                            })

                            // Use DynamicSelectField for fields with dynamic options
                            return (
                              <DynamicSelectField
                                plugin={dynamicOptions.plugin}
                                action={dynamicOptions.action}
                                parameter={dynamicOptions.parameter}
                                value={formData[field.name] || ''}
                                onChange={(value) => handleInputChange(field.name, value)}
                                required={field.required}
                                placeholder={field.placeholder || `Select ${formatFieldName(field.name).toLowerCase()}...`}
                                className="w-full px-3 py-2 border text-sm focus:outline-none focus:ring-1"
                                style={{ borderRadius: 'var(--v2-radius-button)' }}
                                dependentValues={dependentValues}
                              />
                            )
                          } else if (field.type === 'select' || field.type === 'enum') {
                            // Use regular select for static options
                            return (
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
                            )
                          } else {
                            // Use regular input for text/number/date/etc.
                            return (
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
                            )
                          }
                        })()}
                      </div>

                      {/* InputHelpButton */}
                      <div className="flex-shrink-0">
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
                  {/* Step Results - Individual Cards */}
                  {result.pilot && result.data && agent.pilot_steps && (
                    <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4 flex flex-col" style={{ borderRadius: 'var(--v2-radius-button)', maxHeight: '600px' }}>
                      {/* Static Header */}
                      <div className="text-xs font-semibold text-[var(--v2-text-muted)] mb-4 uppercase tracking-wide flex items-center gap-2 flex-shrink-0">
                        <Layers className="w-4 h-4" />
                        Step Results
                      </div>

                      {/* Static Execution Summary Bar */}
                      <div className="mb-4 p-3 bg-[var(--v2-bg)] dark:bg-slate-800 border border-[var(--v2-border)] rounded-lg flex-shrink-0">
                        <div className="grid grid-cols-4 gap-4">
                          <div>
                            <div className="text-[10px] text-[var(--v2-text-muted)] uppercase tracking-wide mb-1">Total Time</div>
                            <div className="text-sm font-semibold text-[var(--v2-text-primary)]">
                              {((result.data.execution_time_ms || result.execution_duration_ms || 0) / 1000).toFixed(2)}s
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-[var(--v2-text-muted)] uppercase tracking-wide mb-1">Completed</div>
                            <div className="text-sm font-semibold text-green-600 dark:text-green-400">
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
                                    <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
                                  ) : (
                                    <Copy className="w-3 h-3 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]" />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Scrollable Step Results Container */}
                      <div className="space-y-3 overflow-y-auto pr-2" style={{ scrollbarGutter: 'stable' }}>
                        {(() => {
                          // Flatten all steps including nested ones (conditionals, loops)
                          const flattenSteps = (steps: any[]): any[] => {
                            const flattened: any[] = []
                            for (const step of steps) {
                              flattened.push(step)
                              // Add nested steps from conditionals
                              if (step.then_steps) {
                                flattened.push(...flattenSteps(step.then_steps))
                              }
                              if (step.else_steps) {
                                flattened.push(...flattenSteps(step.else_steps))
                              }
                              // Add nested steps from loops/scatter-gather
                              if (step.steps) {
                                flattened.push(...flattenSteps(step.steps))
                              }
                              if (step.scatter?.steps) {
                                flattened.push(...flattenSteps(step.scatter.steps))
                              }
                            }
                            return flattened
                          }

                          const steps = flattenSteps(agent.pilot_steps || [])
                          const completedIds = new Set(result.data.completedStepIds || [])
                          const failedIds = new Set(result.data.failedStepIds || [])
                          const output = result.data.output || {}
                          const totalTime = result.data.execution_time_ms || result.execution_duration_ms || 0
                          const completedCount = result.data.stepsCompleted || 0
                          // Estimate time per step (rough approximation)
                          const avgTimePerStep = completedCount > 0 ? totalTime / completedCount : 0

                          // Debug: log what we have
                          console.log('[Step Results] All steps:', steps.map(s => ({ id: s.id, name: s.name || s.action, type: s.type })))
                          console.log('[Step Results] Completed IDs:', Array.from(completedIds))
                          console.log('[Step Results] Failed IDs:', Array.from(failedIds))
                          console.log('[Step Results] Output keys:', Object.keys(output))
                          console.log('[Step Results] Full output object:', JSON.stringify(output, null, 2))
                          console.log('[Step Results] Agent pilot_steps structure:', JSON.stringify(agent.pilot_steps, null, 2))

                          return steps.map((step: any) => {
                            // Check if step has output data (means it was executed)
                            let stepData = output[step.id]
                            let hasOutput = stepData !== undefined && stepData !== null

                            // For nested steps, check if their data is stored in parent step results
                            if (!hasOutput) {
                              // Find parent step (conditional or scatter-gather that contains this step)
                              const findStepInParent = (parentStep: any): boolean => {
                                // Check conditional branches (then_steps)
                                const thenStepIndex = parentStep.then_steps?.findIndex((s: any) => s.id === step.id)
                                if (thenStepIndex !== undefined && thenStepIndex >= 0) {
                                  const parentData = output[parentStep.id]
                                  if (parentData?.branchResults && Array.isArray(parentData.branchResults)) {
                                    // branchResults is an array where each element corresponds to a step in the branch
                                    // Get the result at the same index as the step in then_steps
                                    const branchResult = parentData.branchResults[thenStepIndex]
                                    if (branchResult !== undefined && branchResult !== null) {
                                      stepData = branchResult
                                      return true
                                    }
                                  }
                                }

                                // Check conditional branches (else_steps)
                                const elseStepIndex = parentStep.else_steps?.findIndex((s: any) => s.id === step.id)
                                if (elseStepIndex !== undefined && elseStepIndex >= 0) {
                                  const parentData = output[parentStep.id]
                                  if (parentData?.branchResults && Array.isArray(parentData.branchResults)) {
                                    const branchResult = parentData.branchResults[elseStepIndex]
                                    if (branchResult !== undefined && branchResult !== null) {
                                      stepData = branchResult
                                      return true
                                    }
                                  }
                                }

                                // Check scatter-gather
                                if (parentStep.type === 'scatter_gather') {
                                  const parentData = output[parentStep.id]
                                  if (Array.isArray(parentData)) {
                                    // First, check if step is directly in scatter-gather results
                                    const stepResults = parentData
                                      .filter((item: any) => typeof item === 'object' && item !== null && step.id in item)
                                      .map((item: any) => item[step.id])

                                    if (stepResults.length > 0) {
                                      // If there are multiple iterations, aggregate the results
                                      stepData = stepResults.length === 1 ? stepResults[0] : stepResults
                                      return true
                                    }

                                    // Also check for nested steps inside conditionals within scatter-gather
                                    // e.g., scatter → conditional → action steps
                                    const nestedSteps = parentStep.steps || parentStep.scatter?.steps || []
                                    console.log(`[DEBUG] Checking nested steps in scatter-gather ${parentStep.id} for step ${step.id}, found ${nestedSteps.length} nested steps`)

                                    for (const nestedStep of nestedSteps) {
                                      if (nestedStep.type === 'conditional') {
                                        console.log(`[DEBUG] Found conditional ${nestedStep.id} inside scatter-gather, checking branches for step ${step.id}`)

                                        // Check if our step is in this conditional's branches
                                        const thenIdx = nestedStep.then_steps?.findIndex((s: any) => s.id === step.id)
                                        const elseIdx = nestedStep.else_steps?.findIndex((s: any) => s.id === step.id)

                                        console.log(`[DEBUG] Step ${step.id} in then_steps? ${thenIdx >= 0 ? 'YES at index ' + thenIdx : 'NO'}, in else_steps? ${elseIdx >= 0 ? 'YES at index ' + elseIdx : 'NO'}`)

                                        if (thenIdx >= 0 || elseIdx >= 0) {
                                          // Collect results from all iterations
                                          const nestedResults = parentData
                                            .filter((item: any) => typeof item === 'object' && item !== null && nestedStep.id in item)
                                            .map((item: any) => {
                                              const conditionalResult = item[nestedStep.id]
                                              console.log(`[DEBUG] Conditional result for ${nestedStep.id}:`, conditionalResult)

                                              if (conditionalResult?.branchResults && Array.isArray(conditionalResult.branchResults)) {
                                                console.log(`[DEBUG] branchResults:`, conditionalResult.branchResults)
                                                // branchResults contains objects with stepId field - find by stepId
                                                const result = conditionalResult.branchResults.find((r: any) => r?.stepId === step.id)
                                                console.log(`[DEBUG] Found result for step ${step.id}:`, result)
                                                return result
                                              }
                                              return null
                                            })
                                            .filter((r: any) => r !== null && r !== undefined)

                                          console.log(`[DEBUG] nestedResults for step ${step.id}:`, nestedResults)

                                          if (nestedResults.length > 0) {
                                            stepData = nestedResults.length === 1 ? nestedResults[0] : nestedResults
                                            console.log(`[DEBUG] SUCCESS! Found stepData for ${step.id}:`, stepData)
                                            return true
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                                return false
                              }

                              // Recursively search all steps (including nested ones) for parent
                              const searchSteps = (stepsToSearch: any[]): boolean => {
                                for (const topStep of stepsToSearch) {
                                  if (findStepInParent(topStep)) {
                                    hasOutput = true
                                    return true
                                  }
                                  // Also search within nested steps
                                  if (topStep.steps && searchSteps(topStep.steps)) return true
                                  if (topStep.scatter?.steps && searchSteps(topStep.scatter.steps)) return true
                                  if (topStep.then_steps && searchSteps(topStep.then_steps)) return true
                                  if (topStep.else_steps && searchSteps(topStep.else_steps)) return true
                                }
                                return false
                              }

                              searchSteps(agent.pilot_steps || [])
                            }

                            // A step is completed if it's in completedIds OR has output data (and not failed)
                            const isFailed = failedIds.has(step.id)
                            const isCompleted = completedIds.has(step.id) || (hasOutput && !isFailed)

                            console.log(`[Step ${step.id} "${step.name || step.action}"] isCompleted:${isCompleted}, isFailed:${isFailed}, hasOutput:${hasOutput}, stepData:`, stepData)

                            // Don't skip ANY steps - show them all with their actual status
                            // If not completed and not failed, they'll show as pending which is accurate
                            // if (!isCompleted && !isFailed) return null

                            // Get step stats
                            const getStepStats = () => {
                              if (!stepData) return null

                              // For arrays, show count
                              if (Array.isArray(stepData)) {
                                return `${stepData.length} item${stepData.length !== 1 ? 's' : ''}`
                              }

                              // For objects, check for common fields
                              if (typeof stepData === 'object') {
                                // Check if it's a result wrapper
                                if (stepData.result !== undefined) {
                                  if (Array.isArray(stepData.result)) {
                                    return `${stepData.result.length} item${stepData.result.length !== 1 ? 's' : ''}`
                                  }
                                  if (typeof stepData.result === 'object' && stepData.result !== null) {
                                    // Check for common data fields
                                    const dataKeys = Object.keys(stepData.result)
                                    for (const key of dataKeys) {
                                      const value = stepData.result[key]
                                      if (Array.isArray(value)) {
                                        return `${value.length} ${key.replace(/_/g, ' ')}`
                                      }
                                    }
                                  }
                                }

                                // Check top-level fields
                                const keys = Object.keys(stepData)
                                for (const key of keys) {
                                  const value = stepData[key]
                                  if (Array.isArray(value)) {
                                    return `${value.length} ${key.replace(/_/g, ' ')}`
                                  }
                                }

                                // Check for success/message fields
                                if (stepData.success === true || stepData.success === 'true') {
                                  return 'Completed'
                                }
                                if (stepData.message) {
                                  return String(stepData.message).substring(0, 50)
                                }
                              }

                              // For strings or other types
                              if (typeof stepData === 'string') {
                                return stepData.substring(0, 50)
                              }

                              return 'Completed'
                            }

                            const stats = getStepStats()

                            return (
                              <div
                                key={step.id}
                                className={`p-3 border rounded-lg ${
                                  isFailed
                                    ? 'bg-[var(--v2-status-error-bg)] border-[var(--v2-status-error-border)]'
                                    : isCompleted
                                    ? 'bg-[var(--v2-status-success-bg)] border-[var(--v2-status-success-border)]'
                                    : 'bg-[var(--v2-bg)] border-[var(--v2-border)]'
                                }`}
                              >
                                {/* Main row with icon, name, and status badge */}
                                <div className="flex items-start justify-between gap-3 mb-2">
                                  <div className="flex items-start gap-2 flex-1 min-w-0">
                                    {isFailed ? (
                                      <XCircle className="w-5 h-5 text-[var(--v2-status-error-border)] flex-shrink-0 mt-0.5" />
                                    ) : isCompleted ? (
                                      <CheckCircle className="w-5 h-5 text-[var(--v2-status-success-border)] flex-shrink-0 mt-0.5" />
                                    ) : (
                                      <Clock className="w-5 h-5 text-[var(--v2-text-muted)] flex-shrink-0 mt-0.5" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <div
                                        className={`font-semibold text-sm mb-0.5 ${
                                          isFailed
                                            ? 'text-[var(--v2-status-error-text)]'
                                            : isCompleted
                                            ? 'text-[var(--v2-status-success-text)]'
                                            : 'text-[var(--v2-text-muted)]'
                                        }`}
                                      >
                                        {step.name || step.action || `Step ${step.id}`}
                                      </div>
                                      {stats && (
                                        <div className="text-xs text-[var(--v2-text-secondary)] font-medium">
                                          {stats}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  {/* Only show status badge for completed or failed steps */}
                                  {(isCompleted || isFailed) && (
                                    <div
                                      className={`text-xs font-medium px-2 py-1 rounded flex-shrink-0 ${
                                        isFailed
                                          ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                          : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                      }`}
                                    >
                                      {isFailed ? 'Failed' : 'Success'}
                                    </div>
                                  )}
                                </div>

                                {/* Step metadata row */}
                                {(isCompleted || isFailed) && (step.plugin || (step.type && step.type !== 'action')) && (
                                  <div className="flex items-center gap-4 text-[10px] text-[var(--v2-text-muted)] pl-7">
                                    {step.plugin && (
                                      <div className="flex items-center gap-1">
                                        <Zap className="w-3 h-3" />
                                        <span className="capitalize">{step.plugin.replace(/-/g, ' ')}</span>
                                      </div>
                                    )}
                                    {step.type && step.type !== 'action' && (
                                      <div className="flex items-center gap-1">
                                        <span className="capitalize">{step.type.replace(/_/g, ' ')}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })
                        })()}
                      </div>
                      {/* End Scrollable Step Results Container */}

                      <div className="mt-3 text-xs text-[var(--v2-text-muted)] flex-shrink-0">
                        View detailed data in Sandbox mode
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
                          {formatUserFriendlyValue(value)}
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

      {/* Workflow Visualization Card */}
      {(() => {
        const rawSteps = agent.pilot_steps || agent.workflow_steps
        if (!rawSteps || rawSteps.length === 0) {
          console.warn('[AgentRunPage] No workflow steps found', { pilot_steps: agent.pilot_steps, workflow_steps: agent.workflow_steps })
          return null
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
          <Card className="!p-4 sm:!p-6">
            {/* Header */}
            <div className="flex items-center gap-2 mb-4">
              <GitBranch className="w-5 h-5 text-[var(--v2-primary)]" />
              <div>
                <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">Pilot Execution Flow</h3>
                <p className="text-xs text-[var(--v2-text-muted)]">
                  {totalSteps} total steps
                  {(executing || result) && ` • ${executing ? completedStepsLive.size : completedSteps.length} completed, ${executing ? failedStepsLive.size : failedSteps.length} failed, ${skippedSteps.length} skipped`}
                </p>
              </div>
            </div>

            {/* Pilot Execution Diagram */}
            <PilotDiagram
              steps={rawSteps}
              getStepStatus={getStepStatus}
              executing={executing}
            />
          </Card>
        )
      })()}

      {/* Live Step Results - shown during execution */}
      {executing && Object.keys(liveStepOutputs).length > 0 && (() => {
        const flattenSteps = (steps: any[]): any[] => {
          const flattened: any[] = []
          for (const step of steps) {
            flattened.push(step)
            if (step.then_steps) flattened.push(...flattenSteps(step.then_steps))
            if (step.else_steps) flattened.push(...flattenSteps(step.else_steps))
            if (step.steps) flattened.push(...flattenSteps(step.steps))
            if (step.scatter?.steps) flattened.push(...flattenSteps(step.scatter.steps))
          }
          return flattened
        }

        const allSteps = flattenSteps(agent.pilot_steps || [])

        return (
          <Card className="!p-4 sm:!p-6">
            <div className="text-xs font-semibold text-[var(--v2-text-muted)] mb-4 uppercase tracking-wide flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Live Results
            </div>

            <div className="space-y-3">
              {allSteps.map((step: any) => {
                const isCompleted = completedStepsLive.has(step.id)
                const isFailed = failedStepsLive.has(step.id)
                const stepData = liveStepOutputs[step.id]

                // Only show steps that have completed or failed
                if (!isCompleted && !isFailed) return null

                // Get step stats
                const getStepStats = () => {
                  if (!stepData) return null
                  if (Array.isArray(stepData)) {
                    return `${stepData.length} item${stepData.length !== 1 ? 's' : ''}`
                  }
                  if (typeof stepData === 'object') {
                    if (stepData.result !== undefined) {
                      if (Array.isArray(stepData.result)) {
                        return `${stepData.result.length} item${stepData.result.length !== 1 ? 's' : ''}`
                      }
                    }
                    const keys = Object.keys(stepData)
                    for (const key of keys) {
                      const value = stepData[key]
                      if (Array.isArray(value)) {
                        return `${value.length} ${key.replace(/_/g, ' ')}`
                      }
                    }
                    if (stepData.success) return 'Completed'
                    if (stepData.message) return String(stepData.message).substring(0, 50)
                  }
                  return 'Completed'
                }

                const stats = getStepStats()

                return (
                  <div
                    key={step.id}
                    className={`p-3 border rounded-lg ${
                      isFailed
                        ? 'bg-[var(--v2-status-error-bg)] border-[var(--v2-status-error-border)]'
                        : 'bg-[var(--v2-status-success-bg)] border-[var(--v2-status-success-border)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        {isFailed ? (
                          <XCircle className="w-5 h-5 text-[var(--v2-status-error-border)] flex-shrink-0 mt-0.5" />
                        ) : (
                          <CheckCircle className="w-5 h-5 text-[var(--v2-status-success-border)] flex-shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div
                            className={`font-semibold text-sm mb-0.5 ${
                              isFailed
                                ? 'text-[var(--v2-status-error-text)]'
                                : 'text-[var(--v2-status-success-text)]'
                            }`}
                          >
                            {step.name || step.action || `Step ${step.id}`}
                          </div>
                          {stats && (
                            <div className="text-xs text-[var(--v2-text-secondary)] font-medium">
                              {stats}
                            </div>
                          )}
                        </div>
                      </div>
                      <div
                        className={`text-xs font-medium px-2 py-1 rounded flex-shrink-0 ${
                          isFailed
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                            : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                        }`}
                      >
                        {isFailed ? 'Failed' : 'Success'}
                      </div>
                    </div>

                    {(step.plugin || (step.type && step.type !== 'action')) && (
                      <div className="flex items-center gap-4 text-[10px] text-[var(--v2-text-muted)] pl-7">
                        {step.plugin && (
                          <div className="flex items-center gap-1">
                            <Zap className="w-3 h-3" />
                            <span className="capitalize">{step.plugin.replace(/-/g, ' ')}</span>
                          </div>
                        )}
                        {step.type && step.type !== 'action' && (
                          <div className="flex items-center gap-1">
                            <span className="capitalize">{step.type.replace(/_/g, ' ')}</span>
                          </div>
                        )}
                      </div>
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

