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
   */
  public emitExecutionEvent(event: ExecutionEvent): void {
    const eventKey = `execution:${event.execution_id}`
    this.emit(eventKey, event)
    console.log(`[ExecutionEventEmitter] Emitted ${event.type} for execution ${event.execution_id}`)
  }

  /**
   * Listen to execution events for a specific execution
   */
  public onExecutionEvent(
    execution_id: string,
    callback: (event: ExecutionEvent) => void
  ): () => void {
    const eventKey = `execution:${execution_id}`
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
    console.log(`[ExecutionEventEmitter] Cleaned up listeners for execution ${execution_id}`)
  }
}

export const ExecutionEventEmitter = ExecutionEventEmitterService.getInstance()
