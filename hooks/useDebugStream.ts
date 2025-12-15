'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface DebugEvent {
  id: string
  runId: string
  timestamp: number
  type: 'connected' | 'step_start' | 'step_complete' | 'step_failed' | 'plugin_call' | 'llm_call' | 'llm_response' | 'handoff' | 'paused' | 'resumed' | 'execution_complete' | 'execution_error'
  stepId?: string
  stepName?: string
  data?: any
  error?: string
}

export interface StepStatus {
  stepId: string
  stepName: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused'
  input?: any
  output?: any
  error?: string
  startTime?: number
  endTime?: number
  duration?: number
}

interface UseDebugStreamOptions {
  onEvent?: (event: DebugEvent) => void
  onStepUpdate?: (stepId: string, status: StepStatus) => void
  onStateChange?: (state: DebugState) => void
  onComplete?: (result: any) => void
  onError?: (error: string) => void
}

export type DebugState = 'idle' | 'connecting' | 'running' | 'paused' | 'stepping' | 'stopped' | 'completed' | 'error'

export function useDebugStream(options: UseDebugStreamOptions = {}) {
  const [debugRunId, setDebugRunId] = useState<string | null>(null)
  const [debugState, setDebugState] = useState<DebugState>('idle')
  const [events, setEvents] = useState<DebugEvent[]>([])
  const [stepStatuses, setStepStatuses] = useState<Map<string, StepStatus>>(new Map())
  const [currentStepId, setCurrentStepId] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const eventSourceRef = useRef<EventSource | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  // Use refs to avoid stale closure issues in event handlers
  const currentStepIdRef = useRef<string | null>(null)
  const debugStateRef = useRef<DebugState>('idle')

  // Keep refs in sync with state
  useEffect(() => {
    currentStepIdRef.current = currentStepId
  }, [currentStepId])

  useEffect(() => {
    debugStateRef.current = debugState
  }, [debugState])

  // Update debug state and notify
  const updateDebugState = useCallback((newState: DebugState) => {
    setDebugState(newState)
    optionsRef.current.onStateChange?.(newState)
  }, [])

  // Update step status
  const updateStepStatus = useCallback((stepId: string, update: Partial<StepStatus>) => {
    setStepStatuses(prev => {
      const newMap = new Map(prev)
      const existing = newMap.get(stepId) || { stepId, stepName: '', status: 'pending' as const }
      const updated = { ...existing, ...update }
      newMap.set(stepId, updated)
      optionsRef.current.onStepUpdate?.(stepId, updated)
      return newMap
    })
  }, [])

  // Handle incoming debug events
  // Note: Using refs for currentStepId to avoid stale closure issues
  const handleEvent = useCallback((event: DebugEvent) => {
    setEvents(prev => [...prev, event])
    optionsRef.current.onEvent?.(event)

    switch (event.type) {
      case 'connected':
        setIsConnected(true)
        break

      case 'step_start':
        if (event.stepId) {
          setCurrentStepId(event.stepId)
          currentStepIdRef.current = event.stepId // Update ref immediately
          updateStepStatus(event.stepId, {
            stepId: event.stepId,
            stepName: event.stepName || event.stepId,
            status: 'running',
            input: event.data?.input,
            startTime: event.timestamp
          })
        }
        break

      case 'step_complete':
        if (event.stepId) {
          updateStepStatus(event.stepId, {
            status: 'completed',
            output: event.data?.output,
            endTime: event.timestamp,
            duration: event.data?.duration
          })
        }
        break

      case 'step_failed':
        if (event.stepId) {
          updateStepStatus(event.stepId, {
            status: 'failed',
            error: event.error || event.data?.error,
            endTime: event.timestamp
          })
        }
        break

      case 'paused':
        updateDebugState('paused')
        // Use ref to get current step ID (avoids stale closure)
        if (currentStepIdRef.current) {
          updateStepStatus(currentStepIdRef.current, { status: 'paused' })
        }
        break

      case 'resumed':
        updateDebugState('running')
        // Use ref to get current step ID (avoids stale closure)
        if (currentStepIdRef.current) {
          updateStepStatus(currentStepIdRef.current, { status: 'running' })
        }
        break

      case 'execution_complete':
        updateDebugState('completed')
        optionsRef.current.onComplete?.(event.data)
        break

      case 'execution_error':
        updateDebugState('error')
        setError(event.error || 'Execution failed')
        optionsRef.current.onError?.(event.error || 'Execution failed')
        break
    }
  }, [updateDebugState, updateStepStatus]) // Removed currentStepId from deps - using ref instead

  // Connect to SSE stream
  // Note: Does NOT reset stepStatuses - call initializeSteps separately if needed
  const connect = useCallback((runId: string) => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    setDebugRunId(runId)
    updateDebugState('connecting')
    setEvents([])
    // Don't reset stepStatuses here - let initializeSteps handle it
    setCurrentStepId(null)
    currentStepIdRef.current = null
    setError(null)

    const eventSource = new EventSource(`/api/debug/stream?runId=${runId}`)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      console.log('[useDebugStream] Connected to debug stream')
      updateDebugState('running')
    }

    eventSource.onmessage = (e) => {
      try {
        const event: DebugEvent = JSON.parse(e.data)
        handleEvent(event)
      } catch (err) {
        console.error('[useDebugStream] Failed to parse event:', err)
      }
    }

    eventSource.onerror = (e) => {
      console.error('[useDebugStream] SSE error:', e)
      // Use ref to check current state (avoids stale closure)
      const currentState = debugStateRef.current
      if (currentState !== 'completed' && currentState !== 'stopped') {
        // Don't set error state on normal close
        if (eventSource.readyState === EventSource.CLOSED) {
          console.log('[useDebugStream] Connection closed')
        }
      }
    }

    return () => {
      eventSource.close()
    }
  }, [handleEvent, updateDebugState]) // Removed debugState from deps - using ref instead

  // Disconnect from SSE stream
  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setIsConnected(false)
  }, [])

  // Send control command
  const sendControl = useCallback(async (action: 'pause' | 'resume' | 'step' | 'stop') => {
    if (!debugRunId) {
      console.warn('[useDebugStream] No active debug session')
      return false
    }

    try {
      const response = await fetch('/api/debug/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: debugRunId, action })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Control command failed')
      }

      // Optimistically update state
      switch (action) {
        case 'pause':
          updateDebugState('paused')
          break
        case 'resume':
          updateDebugState('running')
          break
        case 'step':
          updateDebugState('stepping')
          break
        case 'stop':
          updateDebugState('stopped')
          disconnect()
          break
      }

      return true
    } catch (err: any) {
      console.error('[useDebugStream] Control command failed:', err)
      setError(err.message)
      return false
    }
  }, [debugRunId, disconnect, updateDebugState])

  // Convenience methods
  const pause = useCallback(() => sendControl('pause'), [sendControl])
  const resume = useCallback(() => sendControl('resume'), [sendControl])
  const step = useCallback(() => sendControl('step'), [sendControl])
  const stop = useCallback(() => sendControl('stop'), [sendControl])

  // Reset state
  const reset = useCallback(() => {
    disconnect()
    setDebugRunId(null)
    updateDebugState('idle')
    setEvents([])
    setStepStatuses(new Map())
    setCurrentStepId(null)
    currentStepIdRef.current = null
    setError(null)
  }, [disconnect, updateDebugState])

  // Initialize step statuses from workflow steps
  const initializeSteps = useCallback((steps: Array<{ id: string; name: string }>) => {
    const newMap = new Map<string, StepStatus>()
    steps.forEach(step => {
      newMap.set(step.id, {
        stepId: step.id,
        stepName: step.name,
        status: 'pending'
      })
    })
    setStepStatuses(newMap)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  return {
    // State
    debugRunId,
    debugState,
    events,
    stepStatuses,
    currentStepId,
    isConnected,
    error,

    // Actions
    connect,
    disconnect,
    pause,
    resume,
    step,
    stop,
    reset,
    initializeSteps,

    // Helpers
    getStepStatus: (stepId: string) => stepStatuses.get(stepId),
    getStepStatusArray: () => Array.from(stepStatuses.values())
  }
}