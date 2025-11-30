/**
 * DebugSessionManager - In-memory state management for debug sessions
 *
 * Manages debug sessions without database persistence.
 * Each session exists only during agent execution.
 */

export interface DebugEvent {
  id: string
  runId: string
  timestamp: number
  type: 'step_start' | 'step_complete' | 'step_failed' | 'plugin_call' | 'llm_call' | 'llm_response' | 'handoff' | 'paused' | 'resumed'
  stepId?: string
  stepName?: string
  data?: any
  error?: string
}

export interface DebugSession {
  runId: string
  agentId: string
  userId: string
  state: 'running' | 'paused' | 'stepping' | 'stopped'
  events: DebugEvent[]
  currentStepIndex: number
  pausePromise: (() => void) | null
  createdAt: number
}

class DebugSessionManagerClass {
  private sessions: Map<string, DebugSession> = new Map()
  private eventListeners: Map<string, Set<(event: DebugEvent) => void>> = new Map()
  private sessionWaiters: Map<string, ((session: DebugSession) => void)[]> = new Map()

  /**
   * Create a new debug session
   */
  createSession(runId: string, agentId: string, userId: string): DebugSession {
    const session: DebugSession = {
      runId,
      agentId,
      userId,
      state: 'running',
      events: [],
      currentStepIndex: -1,
      pausePromise: null,
      createdAt: Date.now(),
    }

    this.sessions.set(runId, session)
    this.eventListeners.set(runId, new Set())

    // Notify any waiters
    const waiters = this.sessionWaiters.get(runId)
    if (waiters) {
      waiters.forEach(resolve => resolve(session))
      this.sessionWaiters.delete(runId)
    }

    console.log(`[DebugSessionManager] Created session: ${runId}`)
    return session
  }

  /**
   * Wait for a session to be created (returns immediately if already exists)
   */
  async waitForSession(runId: string, timeoutMs: number = 10000): Promise<DebugSession | null> {
    // Check if session already exists
    const existingSession = this.sessions.get(runId)
    if (existingSession) {
      return existingSession
    }

    // Wait for session to be created
    return new Promise<DebugSession | null>((resolve) => {
      const timeout = setTimeout(() => {
        // Remove from waiters and resolve with null
        const waiters = this.sessionWaiters.get(runId)
        if (waiters) {
          const index = waiters.indexOf(resolve)
          if (index > -1) {
            waiters.splice(index, 1)
          }
          if (waiters.length === 0) {
            this.sessionWaiters.delete(runId)
          }
        }
        resolve(null)
      }, timeoutMs)

      // Add to waiters
      const waiters = this.sessionWaiters.get(runId) || []
      waiters.push((session) => {
        clearTimeout(timeout)
        resolve(session)
      })
      this.sessionWaiters.set(runId, waiters)
    })
  }

  /**
   * Get a debug session by run ID
   */
  getSession(runId: string): DebugSession | null {
    return this.sessions.get(runId) || null
  }

  /**
   * Emit a debug event
   */
  emitEvent(runId: string, event: Omit<DebugEvent, 'id' | 'runId' | 'timestamp'>): void {
    const session = this.sessions.get(runId)
    if (!session) {
      console.warn(`[DebugSessionManager] Session not found: ${runId}`)
      return
    }

    const fullEvent: DebugEvent = {
      ...event,
      id: `${runId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      runId,
      timestamp: Date.now(),
    }

    session.events.push(fullEvent)

    // Notify listeners
    const listeners = this.eventListeners.get(runId)
    if (listeners) {
      listeners.forEach((listener) => listener(fullEvent))
    }

    console.log(`[DebugSessionManager] Event emitted:`, fullEvent.type, fullEvent.stepName)
  }

  /**
   * Subscribe to debug events for a session
   */
  subscribe(runId: string, listener: (event: DebugEvent) => void): () => void {
    let listeners = this.eventListeners.get(runId)
    if (!listeners) {
      listeners = new Set()
      this.eventListeners.set(runId, listeners)
    }

    listeners.add(listener)

    // Return unsubscribe function
    return () => {
      listeners?.delete(listener)
    }
  }

  /**
   * Pause execution at the next safe boundary
   */
  pause(runId: string): void {
    const session = this.sessions.get(runId)
    if (!session) return

    session.state = 'paused'
    console.log(`[DebugSessionManager] Session paused: ${runId}`)
  }

  /**
   * Resume execution
   */
  resume(runId: string): void {
    const session = this.sessions.get(runId)
    if (!session) return

    session.state = 'running'

    // Resolve the pause promise if it exists
    if (session.pausePromise) {
      session.pausePromise()
      session.pausePromise = null
    }

    console.log(`[DebugSessionManager] Session resumed: ${runId}`)
  }

  /**
   * Step to next execution point
   */
  step(runId: string): void {
    const session = this.sessions.get(runId)
    if (!session) return

    session.state = 'stepping'

    // Resume for one step
    if (session.pausePromise) {
      session.pausePromise()
      session.pausePromise = null
    }

    console.log(`[DebugSessionManager] Step over: ${runId}`)
  }

  /**
   * Stop execution
   */
  stop(runId: string): void {
    const session = this.sessions.get(runId)
    if (!session) return

    session.state = 'stopped'

    // Resolve pause promise to unblock execution
    if (session.pausePromise) {
      session.pausePromise()
      session.pausePromise = null
    }

    console.log(`[DebugSessionManager] Session stopped: ${runId}`)
  }

  /**
   * Check if execution should pause
   * This is called at each safe boundary (step start, plugin call, etc.)
   */
  async checkPause(runId: string): Promise<void> {
    const session = this.sessions.get(runId)
    if (!session) return

    // If stopped, don't pause
    if (session.state === 'stopped') {
      return
    }

    // If paused or stepping, wait for resume
    if (session.state === 'paused') {
      console.log(`[DebugSessionManager] Paused at checkpoint: ${runId}`)

      // Emit paused event so UI knows execution is actually paused
      this.emitEvent(runId, {
        type: 'paused' as any,
        data: { message: 'Execution paused at checkpoint' }
      })

      await new Promise<void>((resolve) => {
        session.pausePromise = resolve
      })

      console.log(`[DebugSessionManager] Resumed from checkpoint: ${runId}`)

      // Emit resumed event
      this.emitEvent(runId, {
        type: 'resumed' as any,
        data: { message: 'Execution resumed' }
      })
    }

    // If stepping, pause after this step
    if (session.state === 'stepping') {
      session.state = 'paused'
    }
  }

  /**
   * Get all events for a session
   */
  getEvents(runId: string): DebugEvent[] {
    const session = this.sessions.get(runId)
    return session ? session.events : []
  }

  /**
   * Cleanup a session after execution completes
   */
  cleanup(runId: string): void {
    this.sessions.delete(runId)
    this.eventListeners.delete(runId)
    console.log(`[DebugSessionManager] Cleaned up session: ${runId}`)
  }

  /**
   * Cleanup old sessions (older than 1 hour)
   */
  cleanupOldSessions(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000

    for (const [runId, session] of this.sessions.entries()) {
      if (session.createdAt < oneHourAgo) {
        this.cleanup(runId)
      }
    }
  }
}

// Global singleton instance shared across all Next.js API routes
// Use globalThis to ensure the same instance is used across all serverless function invocations
const getGlobalDebugSessionManager = () => {
  if (!(globalThis as any).__debugSessionManager__) {
    console.log('[DebugSessionManager] Creating new global singleton instance');
    (globalThis as any).__debugSessionManager__ = new DebugSessionManagerClass();

    // Auto-cleanup old sessions every 10 minutes (only set up once)
    if (typeof window === 'undefined') {
      setInterval(() => {
        (globalThis as any).__debugSessionManager__.cleanupOldSessions();
      }, 10 * 60 * 1000);
    }
  }
  return (globalThis as any).__debugSessionManager__;
};

export const DebugSessionManager = getGlobalDebugSessionManager()
