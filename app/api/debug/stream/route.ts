/**
 * Debug Stream API - Server-Sent Events (SSE)
 * Streams debug events in real-time to the frontend
 *
 * Used only by the /test-plugins-v2 debugger. Gated in production (PROD-1c
 * A-1); logs through Pino with a correlation id (CLAUDE.md § Logging).
 */

import { NextRequest } from 'next/server'
import { DebugSessionManager } from '@/lib/debug/DebugSessionManager'
import { createLogger } from '@/lib/logger'
import { testSurfaceRouteGate } from '@/lib/security/testSurfaceGate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const logger = createLogger({ module: 'API', route: '/api/debug/stream' })

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })

  // PROD-1c A-1: first. A 404 in production for anyone but an admin
  // (lib/security/testSurfaceGate.ts); a no-op elsewhere.
  const gate = await testSurfaceRouteGate(requestLogger)
  if (gate) return gate

  const { searchParams } = new URL(request.url)
  const runId = searchParams.get('runId')

  if (!runId) {
    return new Response('Missing runId parameter', { status: 400 })
  }

  // Wait for session to be created (event-driven, no polling)
  requestLogger.debug({ runId }, 'Waiting for the debug session')
  const session = await DebugSessionManager.waitForSession(runId, 10000)

  if (!session) {
    requestLogger.warn({ runId }, 'Debug session not created within the timeout')
    return new Response('Debug session not found', { status: 404 })
  }

  requestLogger.debug({ runId }, 'Debug session ready')

  // Create SSE stream
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      requestLogger.info({ runId }, 'Debug stream client connected')

      // Send initial connection event
      const initialEvent = `data: ${JSON.stringify({ type: 'connected', runId })}\n\n`
      controller.enqueue(encoder.encode(initialEvent))

      // Send all existing events
      const existingEvents = DebugSessionManager.getEvents(runId)
      for (const event of existingEvents) {
        const data = `data: ${JSON.stringify(event)}\n\n`
        controller.enqueue(encoder.encode(data))
      }

      // Subscribe to new events
      const unsubscribe = DebugSessionManager.subscribe(runId, (event) => {
        try {
          const data = `data: ${JSON.stringify(event)}\n\n`
          controller.enqueue(encoder.encode(data))
        } catch (err) {
          requestLogger.error({ err, runId }, 'Failed to send a debug event')
        }
      })

      // Cleanup on disconnect
      request.signal.addEventListener('abort', () => {
        requestLogger.info({ runId }, 'Debug stream client disconnected')
        unsubscribe()
      })

      // Keep connection alive with heartbeat
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch (error) {
          clearInterval(heartbeat)
        }
      }, 30000) // Every 30 seconds

      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat)
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  })
}
