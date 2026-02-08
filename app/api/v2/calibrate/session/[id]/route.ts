/**
 * Session Status API - Get calibration session status and results
 *
 * This endpoint allows polling for calibration session status during execution
 * and retrieval of final results after completion.
 *
 * @endpoint GET /api/v2/calibrate/session/[id]
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { CalibrationSessionRepository } from '@/lib/repositories/CalibrationSessionRepository';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'SessionStatusAPI', service: 'api' });

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const sessionId = params.id;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Missing session ID' },
        { status: 400 }
      );
    }

    // 1. Authenticate user
    const supabase = await createAuthenticatedServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      logger.warn({ error: authError, sessionId }, 'Unauthorized session status request');
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You must be logged in to view session status' },
        { status: 401 }
      );
    }

    // 2. Load session
    const sessionRepo = new CalibrationSessionRepository(supabase);
    const { data: session, error: sessionError } = await sessionRepo.findById(sessionId);

    if (sessionError || !session) {
      logger.error({ sessionId, error: sessionError }, 'Session not found');
      return NextResponse.json(
        { error: 'Session not found', message: 'The requested calibration session does not exist' },
        { status: 404 }
      );
    }

    // 3. Authorization check
    if (session.user_id !== user.id) {
      logger.warn({ sessionId, userId: user.id, ownerId: session.user_id }, 'Unauthorized session access');
      return NextResponse.json(
        { error: 'Forbidden', message: 'You do not have permission to view this session' },
        { status: 403 }
      );
    }

    // 4. Return session data
    logger.debug({ sessionId, status: session.status }, 'Session status retrieved');

    return NextResponse.json({
      success: true,
      session: {
        id: session.id,
        agentId: session.agent_id,
        status: session.status,
        executionId: session.execution_id,

        // Progress metrics
        totalSteps: session.total_steps,
        completedSteps: session.completed_steps,
        failedSteps: session.failed_steps,
        skippedSteps: session.skipped_steps,

        // Issues
        issues: session.issues || [],
        issueSummary: session.issue_summary || {
          critical: 0,
          warnings: 0,
          autoRepairs: 0
        },

        // Fixes
        autoRepairsProposed: session.auto_repairs_proposed || [],
        userFixes: session.user_fixes || {},

        // Timestamps
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        completedAt: session.completed_at
      }
    });

  } catch (error: any) {
    logger.error({
      error: error.message,
      stack: error.stack
    }, 'Session status retrieval failed');

    return NextResponse.json(
      {
        error: 'Failed to retrieve session status',
        message: error.message || 'An unexpected error occurred',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

/**
 * Delete a calibration session
 *
 * @endpoint DELETE /api/v2/calibrate/session/[id]
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const sessionId = params.id;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Missing session ID' },
        { status: 400 }
      );
    }

    // 1. Authenticate user
    const supabase = await createAuthenticatedServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      logger.warn({ error: authError, sessionId }, 'Unauthorized session deletion attempt');
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You must be logged in to delete sessions' },
        { status: 401 }
      );
    }

    // 2. Load session for authorization check
    const sessionRepo = new CalibrationSessionRepository(supabase);
    const { data: session, error: sessionError } = await sessionRepo.findById(sessionId);

    if (sessionError || !session) {
      logger.error({ sessionId, error: sessionError }, 'Session not found for deletion');
      return NextResponse.json(
        { error: 'Session not found', message: 'The requested calibration session does not exist' },
        { status: 404 }
      );
    }

    // 3. Authorization check
    if (session.user_id !== user.id) {
      logger.warn({ sessionId, userId: user.id, ownerId: session.user_id }, 'Unauthorized session deletion');
      return NextResponse.json(
        { error: 'Forbidden', message: 'You do not have permission to delete this session' },
        { status: 403 }
      );
    }

    // 4. Delete session
    const { error: deleteError } = await sessionRepo.delete(sessionId);

    if (deleteError) {
      logger.error({ sessionId, error: deleteError }, 'Failed to delete session');
      return NextResponse.json(
        { error: 'Deletion failed', message: 'Failed to delete calibration session' },
        { status: 500 }
      );
    }

    logger.info({ sessionId, userId: user.id }, 'Session deleted successfully');

    return NextResponse.json({
      success: true,
      message: 'Session deleted successfully'
    });

  } catch (error: any) {
    logger.error({
      error: error.message,
      stack: error.stack
    }, 'Session deletion failed');

    return NextResponse.json(
      {
        error: 'Failed to delete session',
        message: error.message || 'An unexpected error occurred',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
