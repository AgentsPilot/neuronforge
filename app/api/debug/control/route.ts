/**
 * Debug Control API
 * Handles pause, resume, step, and stop commands
 */

import { NextRequest, NextResponse } from 'next/server'
import { DebugSessionManager } from '@/lib/debug/DebugSessionManager'

export async function POST(request: NextRequest) {
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
      console.log(`[Debug Control] Session not found: ${runId}, attempting to create stub session for ${action}`)
      console.log(`[Debug Control] Available sessions: ${Array.from((DebugSessionManager as any).sessions?.keys() || []).join(', ') || 'none'}`)

      // Create a stub session that will be picked up by the actual execution
      // This handles the race condition where pause is clicked before session fully initializes
      try {
        session = DebugSessionManager.createSession(runId, 'unknown', 'unknown')
        console.log(`[Debug Control] Created stub session for ${action}`)
      } catch (error) {
        console.error(`[Debug Control] Failed to create stub session:`, error)
      }
    }

    if (!session) {
      console.log(`[Debug Control] Session still not found after creation attempt: ${runId}`)
      return NextResponse.json(
        { error: 'Debug session not found' },
        { status: 404 }
      )
    }

    console.log(`[Debug Control] ${action} requested for session ${runId}`)

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
  } catch (error: any) {
    console.error('[Debug Control] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
