/**
 * Debug Control API
 * Handles pause, resume, step, and stop commands
 *
 * Used only by the /test-plugins-v2 debugger. Gated in production (PROD-1c
 * A-1); logs through Pino with a correlation id (CLAUDE.md § Logging).
 */

import { NextRequest, NextResponse } from 'next/server'
import { DebugSessionManager } from '@/lib/debug/DebugSessionManager'
import { createLogger } from '@/lib/logger'
import { testSurfaceRouteGate } from '@/lib/security/testSurfaceGate'

const logger = createLogger({ module: 'API', route: '/api/debug/control' })

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })

  // PROD-1c A-1: first. A 404 in production for anyone but an admin
  // (lib/security/testSurfaceGate.ts); a no-op elsewhere.
  const gate = await testSurfaceRouteGate(requestLogger)
  if (gate) return gate

  try {
    const body = await request.json()
    const { runId, action } = body

    if (!runId || !action) {
      return NextResponse.json(
        { error: 'Missing runId or action' },
        { status: 400 }
      )
    }

    // Check if session exists
    let session = DebugSessionManager.getSession(runId)

    // If not found, try creating it (race condition handling)
    if (!session && (action === 'pause' || action === 'resume' || action === 'step' || action === 'stop')) {
      // `any`: the session map is private to DebugSessionManager; read here only for its size.
      const sessionCount = (DebugSessionManager as any).sessions?.size ?? 0
      requestLogger.info({ runId, action, sessionCount }, 'Debug session not found; creating a stub session')

      // Create a stub session that will be picked up by the actual execution
      // This handles the race condition where pause is clicked before session fully initializes
      try {
        session = DebugSessionManager.createSession(runId, 'unknown', 'unknown')
        requestLogger.info({ runId, action }, 'Created a stub debug session')
      } catch (err) {
        requestLogger.error({ err, runId, action }, 'Failed to create a stub debug session')
      }
    }

    if (!session) {
      requestLogger.warn({ runId, action }, 'Debug session still not found after the creation attempt')
      return NextResponse.json(
        { error: 'Debug session not found' },
        { status: 404 }
      )
    }

    requestLogger.info({ runId, action }, 'Debug control action requested')

    switch (action) {
      case 'pause':
        DebugSessionManager.pause(runId)
        break

      case 'resume':
        DebugSessionManager.resume(runId)
        break

      case 'step':
        DebugSessionManager.step(runId)
        break

      case 'stop':
        DebugSessionManager.stop(runId)
        break

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }

    return NextResponse.json({
      success: true,
      runId,
      action,
      state: session.state,
    })
  } catch (err) {
    requestLogger.error({ err }, 'Debug control request failed')
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' && err instanceof Error ? err.message : undefined,
      },
      { status: 500 }
    )
  }
}
