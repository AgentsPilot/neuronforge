// lib/execution/ExecutionEventEmitter.ts
// Singleton event emitter for cross-process execution event communication
// Allows /api/run-agent to emit events that /api/run-agent-stream can listen to

import { EventEmitter } from 'events'

export interface ExecutionEvent {
  execution_id: string
  agent_id: string
  type: 'step_started' | 'step_completed' | 'step_failed' | 'execution_complete' | 'execution_error'
  timestamp: string
  data?: any
}

export interface StepStartedData {
  step_index: number
  step_name: string
  step_id: string
  operation: string
  plugin?: string
  action?: string
}

export interface StepCompletedData {
  step_index: number
  step_name: string
  step_id: string
  result: any
  duration_ms: number
}

export interface StepFailedData {
  step_index: number
  step_name: string
  step_id: string
  error: string
  duration_ms: number
}

export interface ExecutionCompleteData {
  success: boolean
  results: any
  total_duration_ms: number
}

export interface ExecutionErrorData {
  error: string
  step_index?: number
}

class ExecutionEventEmitterService extends EventEmitter {
  private static instance: ExecutionEventEmitterService

  // Event buffer for replay - stores events until a listener connects
  // This prevents event loss when SSE stream connects after execution starts
  private eventBuffer: Map<string, ExecutionEvent[]> = new Map()
  private readonly MAX_BUFFER_SIZE = 100 // Max events per execution
  private readonly BUFFER_TTL_MS = 60000 // 60 seconds TTL

  private constructor() {
    super()
    // Increase max listeners to handle multiple concurrent executions
    this.setMaxListeners(100)
  }

  public static getInstance(): ExecutionEventEmitterService {
    if (!ExecutionEventEmitterService.instance) {
      ExecutionEventEmitterService.instance = new ExecutionEventEmitterService()
    }
    return ExecutionEventEmitterService.instance
  }

  /**
   * Emit an execution event
   * Events are buffered for replay if no listener is registered yet
   */
  public emitExecutionEvent(event: ExecutionEvent): void {
    const eventKey = `execution:${event.execution_id}`

    // Check if there are active listeners
    const hasListeners = this.listenerCount(eventKey) > 0

    if (hasListeners) {
      // Emit directly to listeners
      this.emit(eventKey, event)
    } else {
      // Buffer the event for later replay
      this.bufferEvent(event.execution_id, event)
    }

    console.log(`[ExecutionEventEmitter] Emitted ${event.type} for execution ${event.execution_id} (buffered: ${!hasListeners})`)
  }

  /**
   * Buffer an event for later replay
   */
  private bufferEvent(execution_id: string, event: ExecutionEvent): void {
    if (!this.eventBuffer.has(execution_id)) {
      this.eventBuffer.set(execution_id, [])

      // Auto-cleanup buffer after TTL
      setTimeout(() => {
        this.eventBuffer.delete(execution_id)
      }, this.BUFFER_TTL_MS)
    }

    const buffer = this.eventBuffer.get(execution_id)!
    if (buffer.length < this.MAX_BUFFER_SIZE) {
      buffer.push(event)
    }
  }

  /**
   * Listen to execution events for a specific execution
   * Replays any buffered events with staggered timing to simulate real-time progression
   * Terminal events (execution_complete, execution_error) are sent last after all step events
   */
  public onExecutionEvent(
    execution_id: string,
    callback: (event: ExecutionEvent) => void
  ): () => void {
    const eventKey = `execution:${execution_id}`

    // Replay buffered events with staggered delays
    const bufferedEvents = this.eventBuffer.get(execution_id) || []
    if (bufferedEvents.length > 0) {
      console.log(`[ExecutionEventEmitter] Replaying ${bufferedEvents.length} buffered events for execution ${execution_id}`)

      // Clear buffer immediately to prevent duplicate replay
      this.eventBuffer.delete(execution_id)

      // Separate step events from terminal events
      // Terminal events (execution_complete, execution_error) should be sent LAST
      const stepEvents: ExecutionEvent[] = []
      const terminalEvents: ExecutionEvent[] = []

      for (const event of bufferedEvents) {
        if (event.type === 'execution_complete' || event.type === 'execution_error') {
          terminalEvents.push(event)
        } else {
          stepEvents.push(event)
        }
      }

      // Replay events with delays based on original timestamps
      // Use a minimum delay between events for visual progression
      const MIN_DELAY_MS = 150 // Minimum delay between events for UI feedback
      const MAX_REPLAY_TIME_MS = 3000 // Cap total replay time at 3 seconds

      let maxStepDelay = 0 // Track when all step events will be sent

      if (stepEvents.length === 0) {
        // No step events - just send terminal events immediately
        for (const event of terminalEvents) {
          callback(event)
        }
      } else if (stepEvents.length === 1) {
        // Single step event - replay immediately, then terminal events
        callback(stepEvents[0])
        // Send terminal events after a small delay
        setTimeout(() => {
          for (const event of terminalEvents) {
            callback(event)
          }
        }, MIN_DELAY_MS)
      } else {
        // Multiple step events - calculate delays based on original timing
        const firstTimestamp = new Date(stepEvents[0].timestamp).getTime()
        const lastStepTimestamp = new Date(stepEvents[stepEvents.length - 1].timestamp).getTime()
        const originalDuration = lastStepTimestamp - firstTimestamp

        // Calculate time scale factor to compress/expand replay
        // If original took 10s but we want max 3s, scale = 0.3
        const timeScale = originalDuration > MAX_REPLAY_TIME_MS
          ? MAX_REPLAY_TIME_MS / originalDuration
          : 1

        stepEvents.forEach((event, index) => {
          if (index === 0) {
            // First event - replay immediately
            callback(event)
          } else {
            // Calculate delay from first event, scaled appropriately
            const eventTime = new Date(event.timestamp).getTime()
            const offsetFromFirst = eventTime - firstTimestamp
            const scaledDelay = Math.max(MIN_DELAY_MS * index, offsetFromFirst * timeScale)

            // Track the maximum delay for scheduling terminal events
            if (scaledDelay > maxStepDelay) {
              maxStepDelay = scaledDelay
            }

            setTimeout(() => {
              callback(event)
            }, scaledDelay)
          }
        })

        // Send terminal events AFTER all step events have been replayed
        // Add an extra delay to ensure visual completion of all steps
        const terminalDelay = maxStepDelay + MIN_DELAY_MS
        setTimeout(() => {
          for (const event of terminalEvents) {
            callback(event)
          }
        }, terminalDelay)
      }
    }

    // Register for future events
    this.on(eventKey, callback)

    // Return cleanup function
    return () => {
      this.off(eventKey, callback)
    }
  }

  /**
   * Helper: Emit step_started event
   */
  public emitStepStarted(
    execution_id: string,
    agent_id: string,
    data: StepStartedData
  ): void {
    this.emitExecutionEvent({
      execution_id,
      agent_id,
      type: 'step_started',
      timestamp: new Date().toISOString(),
      data
    })
  }

  /**
   * Helper: Emit step_completed event
   */
  public emitStepCompleted(
    execution_id: string,
    agent_id: string,
    data: StepCompletedData
  ): void {
    this.emitExecutionEvent({
      execution_id,
      agent_id,
      type: 'step_completed',
      timestamp: new Date().toISOString(),
      data
    })
  }

  /**
   * Helper: Emit step_failed event
   */
  public emitStepFailed(
    execution_id: string,
    agent_id: string,
    data: StepFailedData
  ): void {
    this.emitExecutionEvent({
      execution_id,
      agent_id,
      type: 'step_failed',
      timestamp: new Date().toISOString(),
      data
    })
  }

  /**
   * Helper: Emit execution_complete event
   */
  public emitExecutionComplete(
    execution_id: string,
    agent_id: string,
    data: ExecutionCompleteData
  ): void {
    this.emitExecutionEvent({
      execution_id,
      agent_id,
      type: 'execution_complete',
      timestamp: new Date().toISOString(),
      data
    })
  }

  /**
   * Helper: Emit execution_error event
   */
  public emitExecutionError(
    execution_id: string,
    agent_id: string,
    data: ExecutionErrorData
  ): void {
    this.emitExecutionEvent({
      execution_id,
      agent_id,
      type: 'execution_error',
      timestamp: new Date().toISOString(),
      data
    })
  }

  /**
   * Remove all listeners for a specific execution (cleanup)
   */
  public cleanupExecution(execution_id: string): void {
    const eventKey = `execution:${execution_id}`
    this.removeAllListeners(eventKey)
    // Also clear any buffered events
    this.eventBuffer.delete(execution_id)
    console.log(`[ExecutionEventEmitter] Cleaned up listeners and buffer for execution ${execution_id}`)
  }
}

export const ExecutionEventEmitter = ExecutionEventEmitterService.getInstance()
