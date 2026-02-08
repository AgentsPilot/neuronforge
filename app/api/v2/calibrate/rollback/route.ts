/**
 * Rollback API - Restore workflow from backup
 *
 * Allows users to rollback to the original workflow if fixes caused issues.
 * Uses the backup_pilot_steps stored in calibration_sessions.
 *
 * @endpoint POST /api/v2/calibrate/rollback
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { CalibrationSessionRepository } from '@/lib/repositories/CalibrationSessionRepository';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'RollbackAPI', service: 'api' });

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user
    const supabase = await createAuthenticatedServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      logger.warn({ error: authError }, 'Unauthorized rollback attempt');
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You must be logged in to rollback' },
        { status: 401 }
      );
    }

    // 2. Parse request body
    const { sessionId } = await req.json();

    if (!sessionId) {
      logger.warn({ userId: user.id }, 'Missing sessionId in rollback request');
      return NextResponse.json(
        { error: 'Missing sessionId', message: 'sessionId is required' },
        { status: 400 }
      );
    }

    logger.info({ sessionId, userId: user.id }, 'Starting rollback');

    // 3. Load calibration session
    const sessionRepo = new CalibrationSessionRepository(supabase);
    const { data: session, error: sessionError } = await sessionRepo.findById(sessionId);

    if (sessionError || !session) {
      logger.error({ sessionId, error: sessionError }, 'Session not found');
      return NextResponse.json(
        { error: 'Session not found', message: 'The requested calibration session does not exist' },
        { status: 404 }
      );
    }

    // 4. Authorization check
    if (session.user_id !== user.id) {
      logger.warn({ sessionId, userId: user.id, ownerId: session.user_id }, 'Unauthorized rollback');
      return NextResponse.json(
        { error: 'Forbidden', message: 'You do not have permission to rollback this session' },
        { status: 403 }
      );
    }

    // 5. Check if backup exists
    if (!session.backup_pilot_steps) {
      logger.warn({ sessionId }, 'No backup available for rollback');
      return NextResponse.json(
        { error: 'No backup', message: 'No backup workflow found for this session' },
        { status: 400 }
      );
    }

    // 6. Load agent
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('id, user_id')
      .eq('id', session.agent_id)
      .single();

    if (agentError || !agent) {
      logger.error({ agentId: session.agent_id, error: agentError }, 'Agent not found');
      return NextResponse.json(
        { error: 'Agent not found', message: 'The agent associated with this session does not exist' },
        { status: 404 }
      );
    }

    // 7. Restore backup workflow
    const { error: updateError } = await supabase
      .from('agents')
      .update({
        pilot_steps: session.backup_pilot_steps,
        updated_at: new Date().toISOString()
      })
      .eq('id', session.agent_id);

    if (updateError) {
      logger.error({ agentId: agent.id, error: updateError }, 'Failed to restore backup');
      return NextResponse.json(
        { error: 'Rollback failed', message: 'Failed to restore workflow from backup' },
        { status: 500 }
      );
    }

    logger.info({ sessionId, agentId: session.agent_id }, 'Workflow rolled back successfully');

    // 8. Update session status
    await sessionRepo.update(sessionId, {
      status: 'rolled_back' as any,
      completed_at: new Date().toISOString()
    });

    // 9. Return success
    return NextResponse.json({
      success: true,
      message: 'Workflow successfully rolled back to previous version',
      agentId: session.agent_id
    });

  } catch (error: any) {
    logger.error({
      error: error.message,
      stack: error.stack
    }, 'Rollback failed with exception');

    return NextResponse.json(
      {
        error: 'Rollback failed',
        message: error.message || 'An unexpected error occurred during rollback',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
