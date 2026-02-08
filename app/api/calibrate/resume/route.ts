// app/api/calibrate/resume/route.ts
// Resume a failed calibration execution from the point of failure

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { WorkflowPilot } from '@/lib/pilot';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { agentRepository } from '@/lib/repositories';
import { createClient } from '@supabase/supabase-js';

const logger = createLogger({ module: 'API', route: '/api/calibrate/resume' });

// Create admin client inline to avoid module initialization issues
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

export const runtime = 'nodejs';

interface ResumeRequest {
  executionId: string;
  updatedInputValues?: Record<string, any>; // Allow user to update input values before retry
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();

  const requestLogger = logger.child({ correlationId });
  requestLogger.info('Resume calibration request received');

  try {
    const supabase = await createAuthenticatedServerClient();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      requestLogger.warn('Unauthorized request - missing user');
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = (await request.json()) as ResumeRequest;
    const { executionId, updatedInputValues } = body;

    if (!executionId) {
      requestLogger.warn('Missing executionId in request');
      return NextResponse.json(
        { success: false, error: 'executionId is required' },
        { status: 400 }
      );
    }

    requestLogger.info({
      executionId,
      hasUpdatedValues: !!updatedInputValues,
      updatedValueCount: updatedInputValues ? Object.keys(updatedInputValues).length : 0
    }, 'Fetching execution details');

    // Get execution details (use admin client to bypass RLS)
    const { data: execution, error: execError } = await supabaseAdmin
      .from('workflow_executions')
      .select('id, agent_id, status, input_values, user_id')
      .eq('id', executionId)
      .single();

    // Verify user owns this execution
    if (execution && execution.user_id !== user.id) {
      requestLogger.warn('Access denied - execution belongs to different user');
      return NextResponse.json(
        { success: false, error: 'Execution not found or access denied' },
        { status: 404 }
      );
    }

    if (execError || !execution) {
      requestLogger.warn({ err: execError }, 'Execution not found or access denied');
      return NextResponse.json(
        { success: false, error: 'Execution not found or access denied' },
        { status: 404 }
      );
    }

    // Allow resuming from 'failed', 'paused', or 'running' status
    // - 'failed': standard retry flow
    // - 'paused': parameter error detected during calibration (user fixing hardcoded value)
    // - 'running': may occur if we already started clearing the failed steps
    if (execution.status !== 'failed' && execution.status !== 'paused' && execution.status !== 'running') {
      requestLogger.warn({ status: execution.status }, 'Execution is not in a resumable state');
      return NextResponse.json(
        { success: false, error: 'Can only resume failed, paused, or running executions' },
        { status: 400 }
      );
    }

    // Get agent details
    const { data: agent, error: agentError } = await agentRepository.findById(
      execution.agent_id,
      user.id
    );

    if (agentError || !agent) {
      requestLogger.warn({ err: agentError }, 'Agent not found');
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    // DEBUGGING: Log the pilot_steps loaded from database
    const pilotSteps = agent.pilot_steps as any[];
    if (pilotSteps && Array.isArray(pilotSteps)) {
      // Search for steps with 'range' parameter to verify if fix persisted
      const stepsWithRange = pilotSteps
        .map((s, idx) => ({
          index: idx,
          id: s.id,
          step_id: s.step_id,
          name: s.name,
          range_in_params: s.params?.range,
          range_in_config: s.config?.range,
          range_in_root: s.range,
        }))
        .filter(s => s.range_in_params || s.range_in_config || s.range_in_root);

      requestLogger.info({
        agentId: agent.id,
        totalSteps: pilotSteps.length,
        stepsWithRange,
        executionId,
        updatedInputValues,
      }, '🔍 [RESUME] Agent pilot_steps loaded from database - checking if fix persisted');
    } else {
      requestLogger.warn('pilot_steps is not an array or is missing');
    }

    requestLogger.info({ agentId: agent.id }, 'Resuming execution from failed step');

    // CRITICAL FIX: Before resuming, we need to clear ALL execution state
    // This ensures data flows correctly since step outputs cannot be restored from DB (privacy-first)

    // Get the current execution_trace
    const { data: executionData, error: traceError } = await supabaseAdmin
      .from('workflow_executions')
      .select('execution_trace, failed_steps_count')
      .eq('id', executionId)
      .single();

    if (traceError || !executionData) {
      requestLogger.warn({ err: traceError }, 'Could not fetch execution trace for cleanup');
    } else {
      // Get failed steps from execution_trace
      const executionTrace = executionData.execution_trace as any;
      const failedSteps = executionTrace?.failedSteps || [];

      // DEBUG: Log what we have BEFORE updating
      const cachedOutputsKeys = executionTrace?.cached_outputs
        ? Object.keys(executionTrace.cached_outputs)
        : [];
      requestLogger.info({
        executionId,
        hasCachedOutputs: !!executionTrace?.cached_outputs,
        cachedOutputsCount: cachedOutputsKeys.length,
        cachedOutputsKeys,
        failedStepsCount: failedSteps.length,
      }, '🔍 [RESUME DEBUG] BEFORE update - checking cached_outputs in database');

      if (failedSteps.length > 0) {
        requestLogger.info({
          failedSteps,
          failedCount: failedSteps.length,
          completedSteps: executionTrace?.completedSteps || []
        }, 'Clearing only failed steps - will resume from failed step (outputs cached in memory)');

        // Only clear failed steps - keep completed steps AND cached_outputs intact
        // Step outputs are cached in execution_trace.cached_outputs and will be restored on resume
        const updatedTrace = {
          ...executionTrace,
          failedSteps: [],     // ← CLEAR failed steps only
          // CRITICAL: Preserve cached_outputs from execution_trace
          cached_outputs: executionTrace.cached_outputs || {},
        };

        // DEBUG: Log what we're about to save
        const updatedCachedKeys = updatedTrace.cached_outputs
          ? Object.keys(updatedTrace.cached_outputs)
          : [];
        requestLogger.info({
          executionId,
          updatedCachedOutputsCount: updatedCachedKeys.length,
          updatedCachedOutputsKeys: updatedCachedKeys,
        }, '🔍 [RESUME DEBUG] AFTER constructing updatedTrace - what we will save to database');

        await supabaseAdmin
          .from('workflow_executions')
          .update({
            execution_trace: updatedTrace,
            failed_steps_count: 0,          // ← RESET failed count
            status: 'running',
            updated_at: new Date().toISOString(),
          })
          .eq('id', executionId);

        // DEBUG: Verify what was actually saved to the database
        const { data: verification, error: verifyError } = await supabaseAdmin
          .from('workflow_executions')
          .select('execution_trace')
          .eq('id', executionId)
          .single();

        if (verification && !verifyError) {
          const verifiedCachedKeys = verification.execution_trace?.cached_outputs
            ? Object.keys(verification.execution_trace.cached_outputs)
            : [];
          requestLogger.info({
            executionId,
            verifiedCachedOutputsCount: verifiedCachedKeys.length,
            verifiedCachedOutputsKeys: verifiedCachedKeys,
          }, '🔍 [RESUME DEBUG] AFTER database update - verification read from database');
        } else {
          requestLogger.warn({ err: verifyError }, '🔍 [RESUME DEBUG] Failed to verify database update');
        }

        requestLogger.info('Cleared only failed steps - will resume from failed step (not re-running completed steps)');
      }
    }

    // CRITICAL: Acquire distributed lock to prevent concurrent resume
    // Multiple resume requests for the same execution would cause duplicate step execution
    const { acquireLock, releaseLock } = await import('@/lib/utils/distributedLock');
    const lockKey = `execution:${executionId}:resume`;
    const lockAcquired = await acquireLock(lockKey, 60000); // 60s timeout

    if (!lockAcquired) {
      requestLogger.warn({ executionId }, 'Resume already in progress - lock acquisition failed');
      return NextResponse.json({
        success: false,
        error: 'Another resume operation is already in progress for this execution. Please wait and try again.',
      }, { status: 409 }); // 409 Conflict
    }

    try {
      // Create WorkflowPilot instance
      const pilot = new WorkflowPilot(supabase);

      requestLogger.info({ executionId }, 'Lock acquired - about to call pilot.resume()');

      let result;
      try {
        // Resume the existing execution (will now retry the failed step)
        result = await pilot.resume(executionId);

        requestLogger.info({
          success: result.success,
          executionId: result.executionId,
          stepsCompleted: result.stepsCompleted,
          stepsFailed: result.stepsFailed
        }, 'pilot.resume() completed successfully');
      } catch (resumeError: any) {
        requestLogger.error({
          err: resumeError,
          message: resumeError.message,
          stack: resumeError.stack
        }, 'pilot.resume() failed with error');

        return NextResponse.json({
          success: false,
          error: `Failed to resume execution: ${resumeError.message}`,
        }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        execution_id: result.executionId, // Same execution ID (resumed, not new)
        result: {
          success: result.success,
          stepsCompleted: result.stepsCompleted,
          stepsFailed: result.stepsFailed,
          totalTokensUsed: result.totalTokensUsed,
          totalExecutionTime: result.totalExecutionTime,
        },
      });
    } finally {
      // Always release lock, even if resume fails
      await releaseLock(lockKey);
      requestLogger.info({ executionId }, 'Lock released');
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ err: error, duration }, 'Resume request failed');

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resume execution',
      },
      { status: 500 }
    );
  }
}
