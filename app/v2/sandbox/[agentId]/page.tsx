'use client'

import React, { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/v2/ui/card'
import { V2Logo, V2Controls } from '@/components/v2/V2Header'
import { HelpBot } from '@/components/v2/HelpBot'
import InputHelpButton from '@/components/v2/InputHelpButton'
import { getPricingConfig } from '@/lib/utils/pricingConfig'
import {
  Play,
  Pause,
  SkipForward,
  Square,
  Bot,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  ChevronRight,
  Database,
  Zap,
  ArrowLeft,
  Loader2,
  Coins,
  Timer,
  Sparkles,
} from 'lucide-react'
import { PageLoading } from '@/components/v2/ui/loading'

interface WorkflowStep {
  id: string
  name: string
  type: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  startTime?: number
  endTime?: number
  data?: any
}

interface DebugState {
  isRunning: boolean
  isPaused: boolean
  currentStepIndex: number
  steps: WorkflowStep[]
  totalTokens?: number
  executionTime?: number
}

export default function AgentSandboxPage() {
  const router = useRouter()
  const params = useParams()
  const { user, loading: authLoading } = useAuth()
  const agentId = params?.agentId as string

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirect=/v2/sandbox')
    }
  }, [user, authLoading, router])

  const [agent, setAgent] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [eventSource, setEventSource] = useState<EventSource | null>(null)
  const [inputValues, setInputValues] = useState<Record<string, any>>({})
  const [tokensPerCredit, setTokensPerCredit] = useState<number>(10) // Default: 10 tokens = 1 credit

  // HelpBot state
  const [helpBotOpen, setHelpBotOpen] = useState(false)
  const [helpBotContext, setHelpBotContext] = useState<any>(null)

  // Debug state (in-memory only for MVP)
  const [debugState, setDebugState] = useState<DebugState>({
    isRunning: false,
    isPaused: false,
    currentStepIndex: -1,
    steps: [],
  })

  // Log debug state changes for troubleshooting
  useEffect(() => {
    console.log('🔵 Debug state changed:', {
      isRunning: debugState.isRunning,
      isPaused: debugState.isPaused,
      isPausing: (debugState as any).isPausing,
      steps: debugState.steps.length
    })
  }, [debugState])

  // Fetch agent data
  useEffect(() => {
    const fetchAgent = async () => {
      if (!user || !agentId) return

      try {
        const { data, error } = await supabase
          .from('agents')
          .select('*')
          .eq('id', agentId)
          .single()

        if (error) throw error

        setAgent(data)

        // Initialize steps from workflow_steps or pilot_steps (only if steps are empty)
        setDebugState((prev) => {
          // Don't reset if we already have steps (preserve state on refresh)
          if (prev.steps.length > 0) {
            return prev
          }

          // Initial load: populate steps from agent config
          const workflowSteps = (data.pilot_steps || data.workflow_steps || []) as any[]
          const initialSteps: WorkflowStep[] = workflowSteps.map((step: any, index: number) => ({
            id: step.id || `step-${index}`,
            name: step.name || step.step_name || `Step ${index + 1}`,
            type: step.type || 'action',
            status: 'pending',
          }))

          return { ...prev, steps: initialSteps }
        })
      } catch (error) {
        console.error('Error fetching agent:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchAgent()
  }, [user, agentId])

  // Fetch pricing config for token-to-credit conversion
  useEffect(() => {
    const fetchPricingConfig = async () => {
      try {
        const config = await getPricingConfig(supabase)
        setTokensPerCredit(config.tokens_per_pilot_credit)
      } catch (error) {
        console.error('Error fetching pricing config:', error)
        // Keep default value of 10
      }
    }

    fetchPricingConfig()
  }, [])

  // Control handlers
  const handleRun = async () => {
    if (!agent) return

    // Close any existing EventSource connection
    if (eventSource) {
      eventSource.close()
      setEventSource(null)
    }

    // Reset debug state completely for fresh start - reinitialize steps from agent config
    const workflowSteps = (agent.pilot_steps || agent.workflow_steps || []) as any[]
    const initialSteps: WorkflowStep[] = workflowSteps.map((step: any, index: number) => ({
      id: step.id || `step-${index}`,
      name: step.name || step.step_name || `Step ${index + 1}`,
      type: step.type || 'action',
      status: 'pending',
    }))

    setDebugState((prev) => ({
      ...prev,
      steps: initialSteps,
      currentStepIndex: 0,
      isRunning: true,
      isPaused: false,
      totalTokens: undefined,
      executionTime: undefined,
    }))

    try {
      // Generate a debug run ID upfront
      const debugRunId = crypto.randomUUID()
      setRunId(debugRunId)

      // Connect to SSE stream BEFORE starting execution
      console.log('Connecting to debug stream:', debugRunId)
      connectToDebugStream(debugRunId)

      // Longer delay to ensure SSE connection is waiting (backend takes time to start)
      await new Promise(resolve => setTimeout(resolve, 500))

      // Start agent execution with debug mode enabled and our pre-generated ID
      console.log('Starting agent execution with debugRunId:', debugRunId)
      const response = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          debugMode: true,
          debugRunId: debugRunId, // Pass our pre-generated ID
          execution_type: 'test',
          input_variables: inputValues,
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const result = await response.json()
      console.log('Run agent response:', result)

      if (!result.success && result.error) {
        console.error('Execution error:', result.error)
        setDebugState((prev) => ({ ...prev, isRunning: false }))
        alert(`Execution failed: ${result.error}`)
      } else if (result.success && result.data) {
        // Capture execution metrics when complete
        console.log('Execution complete, tokens:', result.data.tokens_used, 'time:', result.data.execution_time_ms)
        setDebugState((prev) => ({
          ...prev,
          totalTokens: result.data.tokens_used,
          executionTime: result.data.execution_time_ms,
          isRunning: false,
        }))
      }
    } catch (error) {
      console.error('Failed to start debug execution:', error)
      setDebugState((prev) => ({ ...prev, isRunning: false }))
      if (eventSource) {
        eventSource.close()
        setEventSource(null)
      }
    }
  }

  // Connect to debug SSE stream
  const connectToDebugStream = (debugRunId: string) => {
    // Close existing connection if any
    if (eventSource) {
      eventSource.close()
    }

    const es = new EventSource(`/api/debug/stream?runId=${debugRunId}`)

    es.onmessage = (event) => {
      try {
        const debugEvent = JSON.parse(event.data)

        if (debugEvent.type === 'connected') {
          console.log('Connected to debug stream:', debugRunId)
          return
        }

        if (debugEvent.type === 'step_start') {
          setDebugState((prev) => ({
            ...prev,
            steps: prev.steps.map((step) =>
              step.id === debugEvent.stepId
                ? { ...step, status: 'running', startTime: debugEvent.timestamp }
                : step
            ),
          }))
        }

        if (debugEvent.type === 'step_complete') {
          setDebugState((prev) => ({
            ...prev,
            steps: prev.steps.map((step) =>
              step.id === debugEvent.stepId
                ? {
                    ...step,
                    status: 'completed',
                    endTime: debugEvent.timestamp,
                    data: debugEvent.data,
                  }
                : step
            ),
          }))
        }

        if (debugEvent.type === 'step_failed') {
          setDebugState((prev) => ({
            ...prev,
            steps: prev.steps.map((step) =>
              step.id === debugEvent.stepId
                ? {
                    ...step,
                    status: 'failed',
                    endTime: debugEvent.timestamp,
                    data: { error: debugEvent.error, ...debugEvent.data },
                  }
                : step
            ),
          }))
        }

        if (debugEvent.type === 'paused') {
          console.log('🟡 Execution paused by backend - updating state to: isPaused=true, isRunning=false, isPausing=false')
          setDebugState((prev) => {
            const newState = {
              ...prev,
              isPaused: true,
              isRunning: false,
              isPausing: false
            } as any
            console.log('🟡 New debug state:', { isPaused: newState.isPaused, isRunning: newState.isRunning, isPausing: newState.isPausing })
            return newState
          })
        }

        if (debugEvent.type === 'resumed') {
          console.log('Execution resumed by backend')
          setDebugState((prev) => ({
            ...prev,
            isPaused: false,
            isRunning: true
          }))
        }
      } catch (error) {
        console.error('Error parsing debug event:', error)
      }
    }

    es.onerror = () => {
      console.log('Debug stream closed')
      es.close()
      setDebugState((prev) => ({ ...prev, isRunning: false }))
      setEventSource(null)
    }

    setEventSource(es)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSource) {
        eventSource.close()
      }
    }
  }, [eventSource])

  const handlePause = async () => {
    if (!runId) {
      console.error('Cannot pause: No runId available')
      return
    }

    console.log('🔴 PAUSE BUTTON CLICKED - Sending pause request for runId:', runId)

    // Immediate UI feedback: Show "pausing..." state
    setDebugState((prev) => ({ ...prev, isPausing: true } as any))

    try {
      const response = await fetch('/api/debug/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, action: 'pause' }),
      })

      if (!response.ok) {
        console.error('Pause request failed with status:', response.status)
        const errorText = await response.text()
        console.error('Error response:', errorText)
        // Clear pausing state on error
        setDebugState((prev) => ({ ...prev, isPausing: false } as any))
        return
      }

      const result = await response.json()
      console.log('✅ Pause response:', result)

      // SSE 'paused' event will update isPaused and clear isPausing
      // This ensures state updates are driven by actual backend pause checkpoint
    } catch (error) {
      console.error('❌ Pause request error:', error)
      // Clear pausing state on error
      setDebugState((prev) => ({ ...prev, isPausing: false } as any))
    }
  }

  const handleResume = async () => {
    if (!runId) return

    console.log('Resuming execution:', runId)
    const response = await fetch('/api/debug/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, action: 'resume' }),
    })

    const result = await response.json()
    console.log('Resume response:', result)

    if (result.success) {
      setDebugState((prev) => ({ ...prev, isPaused: false, isRunning: true }))
    }
  }

  const handleStep = async () => {
    if (!runId) return

    console.log('Stepping execution:', runId)
    const response = await fetch('/api/debug/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, action: 'step' }),
    })

    const result = await response.json()
    console.log('Step response:', result)
  }

  const handleStop = async () => {
    if (!runId) return

    await fetch('/api/debug/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, action: 'stop' }),
    })

    // Close SSE connection
    if (eventSource) {
      eventSource.close()
      setEventSource(null)
    }

    setDebugState((prev) => ({
      ...prev,
      isRunning: false,
      isPaused: false,
    }))
  }

  // HelpBot handlers
  const openChatbot = (context?: any) => {
    setHelpBotContext(context || null)
    setHelpBotOpen(true)
  }

  const toggleChatbot = () => {
    if (helpBotOpen) {
      setHelpBotOpen(false)
      setHelpBotContext(null)
    } else {
      openChatbot()
    }
  }

  const handleChatbotFill = (value: string) => {
    if (helpBotContext?.fieldName) {
      setInputValues(prev => ({ ...prev, [helpBotContext.fieldName]: value }))
    }
  }

  // Infer plugin from field name (same as run page)
  const inferPluginFromFieldName = (fieldName: string): string | undefined => {
    const fieldLower = fieldName.toLowerCase()

    if (
      fieldLower.includes('sheet') ||
      fieldLower.includes('spreadsheet') ||
      fieldLower.includes('range') ||
      fieldLower.includes('cell') ||
      fieldLower.includes('row') ||
      fieldLower.includes('column') ||
      fieldLower.includes('tab') ||
      fieldLower.includes('worksheet')
    ) {
      return 'google-sheets'
    }

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

    if (
      fieldLower.includes('drive') ||
      fieldLower.includes('file') ||
      fieldLower.includes('folder') ||
      fieldLower.includes('document') ||
      fieldLower.includes('doc')
    ) {
      return 'google-drive'
    }

    if (
      fieldLower.includes('notion') ||
      fieldLower.includes('database') ||
      fieldLower.includes('page') ||
      fieldLower.includes('block')
    ) {
      return 'notion'
    }

    if (
      fieldLower.includes('slack') ||
      fieldLower.includes('channel') ||
      fieldLower.includes('workspace')
    ) {
      return 'slack'
    }

    return agent?.plugins_required?.[0]
  }

  // Format field name helper
  const formatFieldName = (name: string): string => {
    return name
      .replace(/[_-]/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
  }

  // Render data intelligently based on type
  const renderData = (data: any): JSX.Element => {
    if (!data) {
      return <p className="text-sm text-[var(--v2-text-muted)] italic">No data available</p>
    }

    // Handle error data specially
    if (data.error) {
      return (
        <div className="space-y-2">
          <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h5 className="text-sm font-semibold text-red-900 dark:text-red-100 mb-1">Error</h5>
              <p className="text-sm text-red-800 dark:text-red-200">{data.error}</p>
            </div>
          </div>
          {data.errorCode && (
            <div className="flex justify-between items-center text-xs px-3 py-2 bg-gray-50 dark:bg-gray-800/50 rounded">
              <span className="text-[var(--v2-text-muted)]">Error Code:</span>
              <code className="text-[var(--v2-text-primary)] font-mono bg-gray-100 dark:bg-gray-900 px-2 py-1 rounded">
                {data.errorCode}
              </code>
            </div>
          )}
        </div>
      )
    }

    // Handle output data
    if (data.output) {
      return renderData(data.output)
    }

    // Handle string data
    if (typeof data === 'string') {
      return (
        <div className="p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-[var(--v2-text-primary)] whitespace-pre-wrap">{data}</p>
        </div>
      )
    }

    // Handle array data
    if (Array.isArray(data)) {
      return (
        <div className="space-y-2">
          <div className="text-xs text-[var(--v2-text-muted)] mb-2">
            Array ({data.length} items)
          </div>
          {data.map((item, index) => (
            <div key={index} className="p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="text-xs text-[var(--v2-text-muted)] mb-1">Item {index + 1}</div>
              {typeof item === 'object' ? (
                <div className="space-y-1">
                  {Object.entries(item).map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <span className="text-sm font-medium text-[var(--v2-text-secondary)] min-w-[80px]">
                        {key}:
                      </span>
                      <span className="text-sm text-[var(--v2-text-primary)] flex-1">
                        {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--v2-text-primary)]">{String(item)}</p>
              )}
            </div>
          ))}
        </div>
      )
    }

    // Handle object data - show key-value pairs
    if (typeof data === 'object') {
      const entries = Object.entries(data).filter(([key]) => {
        // Skip internal metadata fields
        return !['duration', 'plugin', 'action', 'metadata', 'errorCode'].includes(key)
      })

      if (entries.length === 0) {
        return <p className="text-sm text-[var(--v2-text-muted)] italic">No displayable data</p>
      }

      return (
        <div className="space-y-2">
          {entries.map(([key, value]) => (
            <div key={key} className="p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="flex items-start gap-2">
                <span className="text-sm font-semibold text-[var(--v2-primary)] min-w-[100px]">
                  {key.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}:
                </span>
                <div className="flex-1">
                  {typeof value === 'object' && value !== null ? (
                    Array.isArray(value) ? (
                      <div className="space-y-1">
                        {value.map((item, idx) => (
                          <div key={idx} className="text-sm text-[var(--v2-text-primary)] p-2 bg-gray-50 dark:bg-gray-800/50 rounded">
                            {typeof item === 'object' ? JSON.stringify(item) : String(item)}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <pre className="text-sm text-[var(--v2-text-primary)] overflow-x-auto">
                        {JSON.stringify(value, null, 2)}
                      </pre>
                    )
                  ) : (
                    <p className="text-sm text-[var(--v2-text-primary)] whitespace-pre-wrap">
                      {String(value)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )
    }

    // Fallback to string representation
    return (
      <div className="p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
        <p className="text-sm text-[var(--v2-text-primary)]">{String(data)}</p>
      </div>
    )
  }

  // Get status badge styling
  const getStatusStyle = (status: WorkflowStep['status']) => {
    switch (status) {
      case 'completed':
        return {
          bg: 'bg-[var(--v2-status-success-bg)]',
          border: 'border-[var(--v2-status-success-border)]',
          text: 'text-[var(--v2-status-success-text)]',
          icon: CheckCircle,
        }
      case 'running':
        return {
          bg: 'bg-[var(--v2-status-executing-bg)]',
          border: 'border-[var(--v2-status-executing-border)]',
          text: 'text-[var(--v2-status-executing-text)]',
          icon: Zap,
        }
      case 'failed':
        return {
          bg: 'bg-[var(--v2-status-error-bg)]',
          border: 'border-[var(--v2-status-error-border)]',
          text: 'text-[var(--v2-status-error-text)]',
          icon: XCircle,
        }
      default:
        return {
          bg: 'bg-gray-50 dark:bg-gray-800/50',
          border: 'border-gray-200 dark:border-gray-700',
          text: 'text-gray-500 dark:text-gray-400',
          icon: Clock,
        }
    }
  }

  if (loading) {
    return <PageLoading message="Loading debugger..." />
  }

  if (!agent) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-[var(--v2-text-primary)] mb-2">Agent not found</h2>
        <button
          onClick={() => router.push('/v2/agent-list')}
          className="text-[var(--v2-primary)] hover:underline"
        >
          Back to agents
        </button>
      </div>
    )
  }

  const selectedStep = debugState.steps.find((s) => s.id === selectedStepId)

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

      {/* Control Panel */}
      <Card className="!p-4 sm:!p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
          {/* Left: Title */}
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-[var(--v2-primary)]" />
            <div>
              <h2 className="text-base font-semibold text-[var(--v2-text-primary)]">
                {agent.agent_name} - Debugger
              </h2>
              <p className="text-xs text-[var(--v2-text-muted)]">
                Configure inputs and step through execution
              </p>
            </div>
          </div>

          {/* Middle: Control Buttons */}
          <div className="flex items-center justify-center gap-3">
            {/* Play Button - Show when idle (not running, not paused) */}
            {!debugState.isRunning && !debugState.isPaused && (
              <div className="relative group">
                <button
                  onClick={handleRun}
                  disabled={debugState.steps.length === 0}
                  className="flex items-center justify-center w-10 h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 hover:border-green-200 dark:hover:border-green-800 hover:scale-110 transition-all duration-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <Play className="w-4 h-4" />
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                  Run Debug
                </div>
              </div>
            )}

            {/* Resume Button - Show when paused */}
            {debugState.isPaused && (
              <div className="relative group">
                <button
                  onClick={handleResume}
                  className="flex items-center justify-center w-10 h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 hover:border-green-200 dark:hover:border-green-800 hover:scale-110 transition-all duration-200 shadow-sm"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <Play className="w-4 h-4" />
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                  Resume
                </div>
              </div>
            )}

            {/* Pause Button - Only when running (replaces spinner) */}
            {debugState.isRunning && !debugState.isPaused && (
              <div className="relative group">
                <button
                  onClick={handlePause}
                  disabled={(debugState as any).isPausing}
                  className="flex items-center justify-center w-10 h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 hover:border-orange-200 dark:hover:border-orange-800 hover:scale-110 transition-all duration-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {(debugState as any).isPausing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Pause className="w-4 h-4" />
                  )}
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                  {(debugState as any).isPausing ? 'Pausing...' : 'Pause'}
                </div>
              </div>
            )}

            {/* Stop Button */}
            <div className="relative group">
              <button
                onClick={handleStop}
                disabled={!debugState.isRunning && !debugState.isPaused}
                className="flex items-center justify-center w-10 h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-200 dark:hover:border-red-800 hover:scale-110 transition-all duration-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Square className="w-4 h-4" />
              </button>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                Stop
              </div>
            </div>
          </div>

          {/* Right: Token Usage and Execution Time */}
          <div className="flex items-center justify-end gap-3">
            {/* Pilot Credits */}
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-500 rounded-lg">
              <Coins className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <div className="flex flex-col">
                <span className="text-xs font-medium text-blue-900 dark:text-white">
                  {debugState.totalTokens !== undefined
                    ? Math.floor(debugState.totalTokens / tokensPerCredit).toLocaleString()
                    : '0'
                  }
                </span>
                <span className="text-[10px] text-blue-700 dark:text-blue-200">
                  Pilot Credits
                </span>
              </div>
            </div>

            {/* Execution Time */}
            <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/40 border border-green-200 dark:border-green-500 rounded-lg">
              <Timer className="w-4 h-4 text-green-600 dark:text-green-400" />
              <div className="flex flex-col">
                <span className="text-xs font-medium text-green-900 dark:text-white">
                  {debugState.executionTime
                    ? `${(debugState.executionTime / 1000).toFixed(2)}s`
                    : '0.00s'
                  }
                </span>
                <span className="text-[10px] text-green-700 dark:text-green-200">
                  Execution Time
                </span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* 3-Column Layout: Inputs + Timeline + Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
        {/* Left Column - Input Variables (3 cols) */}
        <Card className="!p-4 lg:!h-[600px] overflow-hidden !box-border lg:col-span-3">
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-5 h-5 text-[var(--v2-primary)]" />
              <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">Input Variables</h3>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 scrollbar-thin">
              {agent.input_schema && Array.isArray(agent.input_schema) && agent.input_schema.length > 0 ? (
                agent.input_schema.map((field: any) => (
                  <div key={field.name}>
                    <label className="block">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                          {field.label || field.name.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                        </span>
                        {field.required && (
                          <span className="text-red-500 dark:text-red-400 text-sm">*</span>
                        )}
                      </div>

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
                              value={inputValues[field.name] || ''}
                              onChange={(e) => setInputValues(prev => ({ ...prev, [field.name]: e.target.value }))}
                              className="w-full px-3 py-2 border text-sm focus:outline-none focus:ring-1 bg-[var(--v2-surface)] border-[var(--v2-border)] focus:ring-[var(--v2-primary)] focus:border-[var(--v2-primary)] text-[var(--v2-text-primary)]"
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                              required={field.required}
                            >
                              <option value="">
                                {field.placeholder || 'Select an option...'}
                              </option>
                              {(field.options || field.enum || []).map((option: string) => (
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
                              value={inputValues[field.name] || ''}
                              onChange={(e) => setInputValues(prev => ({ ...prev, [field.name]: e.target.value }))}
                              placeholder={field.placeholder || `Enter ${field.name.replace(/_/g, ' ').toLowerCase()}...`}
                              required={field.required}
                              className="w-full px-3 py-2 border text-sm focus:outline-none focus:ring-1 bg-[var(--v2-surface)] border-[var(--v2-border)] focus:ring-[var(--v2-primary)] focus:border-[var(--v2-primary)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)]"
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            />
                          )}
                        </div>

                        {/* InputHelpButton aligned to the right */}
                        <div className="ml-2">
                          <InputHelpButton
                            agentId={agentId}
                            fieldName={field.name}
                            plugin={inferPluginFromFieldName(field.name)}
                            expectedType={field.type}
                            onClick={() => openChatbot({
                              mode: 'input_help',
                              agentId: agentId,
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
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <Database className="w-12 h-12 opacity-20 mb-2" />
                  <p className="text-sm text-[var(--v2-text-muted)]">No input variables required</p>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Middle Column - Timeline View (3 cols) */}
        <Card className="!p-3 lg:!h-[600px] overflow-hidden !box-border lg:col-span-3 relative">
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 mb-3">
              <div className="relative">
                <Zap className="w-4 h-4 text-[var(--v2-primary)]" />
                {debugState.isRunning && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full animate-ping"></span>
                )}
              </div>
              <h3 className="text-base font-semibold text-[var(--v2-text-primary)]">Timeline</h3>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin px-0.5 py-0.5">
              {debugState.steps.length > 0 ? (
                <div className="relative pl-6">
                  {/* Animated vertical line */}
                  <div className="absolute left-[11px] top-0 bottom-0 w-0.5 bg-gradient-to-b from-transparent via-gray-300 to-transparent dark:via-gray-600"></div>

                  <div className="space-y-3">
                    {debugState.steps.map((step, index) => {
                      const statusStyle = getStatusStyle(step.status)
                      const StatusIcon = statusStyle.icon
                      const isActive = selectedStepId === step.id

                      return (
                        <div
                          key={step.id}
                          onClick={() => setSelectedStepId(step.id)}
                          className="relative group cursor-pointer"
                        >
                          {/* Timeline dot with glow effect */}
                          <div className="absolute -left-6 top-2 z-10">
                            <div className={`
                              w-4 h-4 rounded-full flex items-center justify-center transition-all duration-300
                              ${step.status === 'completed' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : ''}
                              ${step.status === 'running' ? 'bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.8)] animate-pulse' : ''}
                              ${step.status === 'failed' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]' : ''}
                              ${step.status === 'pending' ? 'bg-gray-400 dark:bg-gray-600' : ''}
                              ${isActive ? 'scale-125' : 'scale-100'}
                            `}>
                              {step.status === 'running' && (
                                <div className="absolute inset-0 rounded-full bg-blue-500 animate-ping opacity-75"></div>
                              )}
                            </div>
                          </div>

                          {/* Step card with gradient border for active */}
                          <div className={`
                            relative p-2.5 rounded-lg transition-all duration-300
                            ${statusStyle.bg}
                            ${isActive
                              ? 'border-2 border-[var(--v2-primary)] shadow-lg shadow-[var(--v2-primary)]/20'
                              : `border ${statusStyle.border} hover:shadow-md hover:-translate-y-0.5`
                            }
                          `}>
                            {/* Animated gradient overlay for running state */}
                            {step.status === 'running' && (
                              <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-transparent via-blue-500/5 to-transparent animate-[shimmer_2s_infinite]"></div>
                            )}

                            <div className="relative">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <span className={`
                                    text-[10px] font-bold px-1.5 py-0.5 rounded
                                    ${step.status === 'completed' ? 'bg-green-500/20 text-green-700 dark:text-green-300' : ''}
                                    ${step.status === 'running' ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300' : ''}
                                    ${step.status === 'failed' ? 'bg-red-500/20 text-red-700 dark:text-red-300' : ''}
                                    ${step.status === 'pending' ? 'bg-gray-500/20 text-gray-600 dark:text-gray-400' : ''}
                                  `}>
                                    {index + 1}
                                  </span>
                                  <h4 className={`text-xs font-semibold truncate ${statusStyle.text}`}>
                                    {step.name}
                                  </h4>
                                </div>

                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  {step.status === 'running' && (
                                    <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
                                  )}
                                  <StatusIcon className={`w-3 h-3 ${statusStyle.text}`} />
                                </div>
                              </div>

                              <div className="flex items-center gap-2 text-[9px] text-[var(--v2-text-muted)]">
                                <span className="capitalize">
                                  {step.type === 'ai_processing' ? 'Processing' : step.type.replace(/_/g, ' ')}
                                </span>
                                {step.endTime && step.startTime && (
                                  <>
                                    <span>•</span>
                                    <span className="font-mono">{step.endTime - step.startTime}ms</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center py-8">
                  <div className="relative">
                    <Clock className="w-10 h-10 opacity-20 mb-2" />
                    <Sparkles className="w-4 h-4 text-[var(--v2-primary)] absolute -top-1 -right-1 animate-pulse" />
                  </div>
                  <p className="text-xs font-medium text-[var(--v2-text-primary)]">Ready to debug</p>
                  <p className="text-[10px] text-[var(--v2-text-muted)] mt-1">Press play to start</p>
                </div>
              )}
            </div>
          </div>

          {/* Add shimmer animation */}
          <style jsx>{`
            @keyframes shimmer {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(100%); }
            }
          `}</style>
        </Card>

        {/* Data Inspector (6 cols - wider) */}
        <Card className="!p-4 lg:!h-[600px] overflow-hidden !box-border lg:col-span-6">
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-5 h-5 text-[var(--v2-secondary)]" />
              <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">Data Inspector</h3>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {selectedStep ? (
                <div className="space-y-4">
                  {/* Step Info */}
                  <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <h4 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-2">
                      Step Information
                    </h4>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-[var(--v2-text-muted)]">Name:</span>
                        <span className="text-[var(--v2-text-primary)] font-medium">
                          {selectedStep.name}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--v2-text-muted)]">Type:</span>
                        <span className="text-[var(--v2-text-primary)] font-medium capitalize">
                          {selectedStep.type === 'ai_processing' ? 'Processing' : selectedStep.type.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--v2-text-muted)]">Status:</span>
                        <span className="text-[var(--v2-text-primary)] font-medium capitalize">
                          {selectedStep.status}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Step Data */}
                  {selectedStep.data && (
                    <div>
                      <h4 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3">
                        Output Data
                      </h4>
                      {renderData(selectedStep.data)}

                      {/* Metadata Row (Plugin, Action, Duration) */}
                      {(selectedStep.data.plugin || selectedStep.data.action || selectedStep.data.duration) && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {selectedStep.data.plugin && (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-full">
                              <Zap className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                              <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
                                {selectedStep.data.plugin}
                              </span>
                            </div>
                          )}
                          {selectedStep.data.action && (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-full">
                              <span className="text-xs font-medium text-purple-700 dark:text-purple-300">
                                {selectedStep.data.action}
                              </span>
                            </div>
                          )}
                          {selectedStep.data.duration !== undefined && (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full">
                              <Clock className="w-3 h-3 text-gray-600 dark:text-gray-400" />
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                {selectedStep.data.duration}ms
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Timing */}
                  {selectedStep.startTime && (
                    <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                      <h4 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-2">
                        Timing
                      </h4>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-[var(--v2-text-muted)]">Started:</span>
                          <span className="text-[var(--v2-text-primary)] font-medium">
                            {new Date(selectedStep.startTime).toLocaleTimeString()}
                          </span>
                        </div>
                        {selectedStep.endTime && (
                          <>
                            <div className="flex justify-between">
                              <span className="text-[var(--v2-text-muted)]">Completed:</span>
                              <span className="text-[var(--v2-text-primary)] font-medium">
                                {new Date(selectedStep.endTime).toLocaleTimeString()}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[var(--v2-text-muted)]">Duration:</span>
                              <span className="text-[var(--v2-text-primary)] font-medium">
                                {selectedStep.endTime - selectedStep.startTime}ms
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <Database className="w-12 h-12 opacity-20 mb-2" />
                  <p className="text-sm text-[var(--v2-text-muted)]">Select a step to inspect its data</p>
                </div>
              )}
            </div>
          </div>
        </Card>
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
  )
}
