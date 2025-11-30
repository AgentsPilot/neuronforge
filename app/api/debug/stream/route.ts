/**
 * Debug Stream API - Server-Sent Events (SSE)
 * Streams debug events in real-time to the frontend
 */

import { NextRequest } from 'next/server'
import { DebugSessionManager } from '@/lib/debug/DebugSessionManager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const runId = searchParams.get('runId')

  if (!runId) {
    return new Response('Missing runId parameter', { status: 400 })
  }

  // Wait for session to be created (event-driven, no polling)
  console.log(`[Debug Stream] Waiting for session: ${runId}`)
  const session = await DebugSessionManager.waitForSession(runId, 10000)

  if (!session) {
    console.error(`[Debug Stream] Session not created within timeout: ${runId}`)
    return new Response('Debug session not found', { status: 404 })
  }

  console.log(`[Debug Stream] Session ready: ${runId}`)

  // Create SSE stream
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      console.log(`[Debug Stream] Client connected: ${runId}`)

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
        } catch (error) {
          console.error('[Debug Stream] Error sending event:', error)
        }
      })

      // Cleanup on disconnect
      request.signal.addEventListener('abort', () => {
        console.log(`[Debug Stream] Client disconnected: ${runId}`)
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
