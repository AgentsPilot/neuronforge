/**
 * Batch Calibration API - Run complete workflow and collect all issues
 *
 * This endpoint executes a workflow in batch calibration mode where:
 * - All steps execute with smart continuation (continue for recoverable errors)
 * - Issues are collected during execution instead of stopping at first error
 * - Hardcoded values are detected after execution
 * - Issues are grouped and prioritized for user review
 *
 * @endpoint POST /api/v2/calibrate/batch
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { WorkflowPilot } from '@/lib/pilot/WorkflowPilot';
import { IssueGrouper } from '@/lib/pilot/shadow/IssueGrouper';
import { SmartLogicAnalyzer } from '@/lib/pilot/shadow/SmartLogicAnalyzer';
import { CalibrationSessionRepository } from '@/lib/repositories/CalibrationSessionRepository';
import { acquireLock, releaseLock } from '@/lib/utils/distributedLock';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'BatchCalibrationAPI', service: 'api' });

export async function POST(req: NextRequest) {
  let sessionId: string | null = null;
  let lockKey: string | null = null;
  let lockAcquired = false;

  try {
    // 1. Authenticate user
    const supabase = await createAuthenticatedServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      logger.warn({ error: authError }, 'Unauthorized batch calibration attempt');
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You must be logged in to run batch calibration' },
        { status: 401 }
      );
    }

    // 2. Parse request body
    const { agentId, inputValues } = await req.json();

    if (!agentId) {
      logger.warn({ userId: user.id }, 'Missing agentId in batch calibration request');
      return NextResponse.json(
        { error: 'Missing agentId', message: 'agentId is required' },
        { status: 400 }
      );
    }

    logger.info({ agentId, userId: user.id }, 'Starting batch calibration');

    // 3. Fetch agent
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .single();

    if (agentError || !agent) {
      logger.error({ agentId, error: agentError }, 'Agent not found');
      return NextResponse.json(
        { error: 'Agent not found', message: 'The requested agent does not exist' },
        { status: 404 }
      );
    }

    // 4. Authorization check
    if (agent.user_id !== user.id) {
      logger.warn({ agentId, userId: user.id, ownerId: agent.user_id }, 'Unauthorized agent access');
      return NextResponse.json(
        { error: 'Forbidden', message: 'You do not have permission to calibrate this agent' },
        { status: 403 }
      );
    }

    // 5. Validate workflow exists
    const workflowSteps = agent.pilot_steps || agent.workflow_steps || [];
    if (workflowSteps.length === 0) {
      logger.warn({ agentId }, 'Agent has no workflow steps');
      return NextResponse.json(
        { error: 'No workflow', message: 'This agent has no workflow steps to calibrate' },
        { status: 400 }
      );
    }

    // 5b. Acquire distributed lock to prevent concurrent calibrations
    lockKey = `calibration:${agentId}`;
    lockAcquired = await acquireLock(lockKey, 120000); // 2 minute timeout

    if (!lockAcquired) {
      logger.warn({ agentId, lockKey }, 'Calibration already in progress for this agent');
      return NextResponse.json(
        {
          error: 'Calibration in progress',
          message: 'A calibration is already running for this agent. Please wait for it to complete.'
        },
        { status: 409 }
      );
    }

    logger.info({ agentId, lockKey }, 'Distributed lock acquired for calibration');

    // 6. Create calibration session
    const sessionRepo = new CalibrationSessionRepository(supabase);
    const { data: session, error: sessionError } = await sessionRepo.create({
      agent_id: agentId,
      user_id: user.id,
      status: 'running',
      total_steps: workflowSteps.length,
      completed_steps: 0,
      failed_steps: 0,
      skipped_steps: 0
    });

    if (sessionError || !session) {
      logger.error({ agentId, error: sessionError }, 'Failed to create calibration session');
      return NextResponse.json(
        { error: 'Session creation failed', message: 'Could not create calibration session' },
        { status: 500 }
      );
    }

    sessionId = session.id;
    logger.info({ sessionId, agentId }, 'Calibration session created');

    // 7. Execute workflow in batch calibration mode
    logger.info({ sessionId, agentId }, 'Starting workflow execution in batch calibration mode');

    const pilot = new WorkflowPilot(supabase);
    const result = await pilot.execute(
      agent,
      user.id,
      '', // userInput not needed for batch calibration
      inputValues || {},
      crypto.randomUUID(), // Generate session ID for execution
      undefined, // stepEmitter
      false, // debugMode
      undefined, // debugRunId
      undefined, // providedExecutionId
      'batch_calibration' // runMode: batch_calibration
    );

    logger.info({
      sessionId,
      executionId: result.executionId,
      completed: result.stepsCompleted,
      failed: result.stepsFailed,
      skipped: result.stepsSkipped,
      issuesCollected: result.collectedIssues?.length || 0
    }, 'Workflow execution completed');

    // 8. Process collected issues
    const allIssues = result.collectedIssues || [];

    // 8.5. Detect logic issues (even if no execution errors)
    logger.info({ sessionId, agentId, executionId: result.executionId }, 'Running smart logic analysis');

    // Fetch execution trace to analyze data flow
    const { data: executionRecord } = await supabase
      .from('workflow_executions')
      .select('execution_trace')
      .eq('id', result.executionId)
      .single();

    const executionTrace = executionRecord?.execution_trace || {};

    const logicAnalyzer = new SmartLogicAnalyzer();
    const logicIssues = logicAnalyzer.analyze(workflowSteps, executionTrace);

    logger.info({
      sessionId,
      logicIssuesFound: logicIssues.length,
      types: logicIssues.map(i => i.type)
    }, 'Smart logic analysis complete');

    // Convert logic issues to CollectedIssue format and add to allIssues
    for (const logicIssue of logicIssues) {
      // Map LogicIssue severity to CollectedIssue severity
      let mappedSeverity: 'critical' | 'high' | 'medium' | 'low';
      if (logicIssue.severity === 'critical') {
        mappedSeverity = 'critical';
      } else if (logicIssue.severity === 'warning') {
        mappedSeverity = 'medium';
      } else {
        mappedSeverity = 'low'; // info -> low
      }

      allIssues.push({
        id: logicIssue.id,
        category: 'logic_error',
        severity: mappedSeverity,
        affectedSteps: logicIssue.affectedSteps.map(step => ({
          stepId: step.id,
          stepName: step.name,
          friendlyName: step.name
        })),
        title: logicIssue.title,
        message: logicIssue.description,
        technicalDetails: `Logic issue detected: ${logicIssue.type}. Evidence: ${JSON.stringify(logicIssue.evidence)}`,
        autoRepairAvailable: false, // Logic issues require user decision
        requiresUserInput: true, // User must choose how to handle
        estimatedImpact: logicIssue.severity === 'critical' ? 'high' : logicIssue.severity === 'warning' ? 'medium' : 'low',
        suggestedFix: {
          type: logicIssue.type, // Store the specific issue type
          description: logicIssue.description,
          userOptions: logicIssue.userOptions,
          evidence: logicIssue.evidence,
          impact: logicIssue.impact
        } as any
      });
    }

    if (allIssues.length === 0) {
      logger.info({ sessionId, agentId }, 'No issues found - workflow is ready!');

      // Mark session as completed
      await sessionRepo.update(sessionId, {
        status: 'completed',
        execution_id: result.executionId,
        completed_steps: result.stepsCompleted,
        failed_steps: result.stepsFailed,
        skipped_steps: result.stepsSkipped,
        completed_at: new Date().toISOString()
      });

      return NextResponse.json({
        success: true,
        sessionId,
        executionId: result.executionId,
        issues: {
          critical: [],
          warnings: [],
          autoRepairs: []
        },
        summary: {
          total: 0,
          critical: 0,
          warnings: 0,
          autoRepairs: 0,
          completedSteps: result.stepsCompleted,
          failedSteps: result.stepsFailed,
          skippedSteps: result.stepsSkipped,
          totalSteps: workflowSteps.length
        },
        message: 'Workflow executed successfully with no issues found!'
      });
    }

    // 9. Group and prioritize issues
    logger.info({ sessionId, issueCount: allIssues.length }, 'Grouping and prioritizing issues');

    const grouper = new IssueGrouper();
    const groupedIssues = grouper.groupIssues(allIssues);
    const prioritized = grouper.prioritizeIssues(groupedIssues);
    const summary = grouper.getIssueSummary(prioritized);

    logger.info({
      sessionId,
      original: allIssues.length,
      grouped: groupedIssues.length,
      critical: summary.critical,
      warnings: summary.warnings,
      autoRepairs: summary.autoRepairs
    }, 'Issues processed successfully');

    // 10. Update session with results
    await sessionRepo.updateWithIssues(
      sessionId,
      groupedIssues,
      {
        critical: summary.critical,
        warnings: summary.warnings,
        autoRepairs: summary.autoRepairs
      },
      prioritized.autoRepairs.map(issue => issue.autoRepairProposal).filter(Boolean)
    );

    await sessionRepo.update(sessionId, {
      execution_id: result.executionId,
      completed_steps: result.stepsCompleted,
      failed_steps: result.stepsFailed,
      skipped_steps: result.stepsSkipped
    });

    logger.info({ sessionId, agentId }, 'Batch calibration completed successfully');

    // 11. Return results
    return NextResponse.json({
      success: true,
      sessionId,
      executionId: result.executionId,
      issues: prioritized,
      summary: {
        total: summary.total,
        critical: summary.critical,
        warnings: summary.warnings,
        autoRepairs: summary.autoRepairs,
        requiresUserAction: summary.requiresUserAction,
        completedSteps: result.stepsCompleted,
        failedSteps: result.stepsFailed,
        skippedSteps: result.stepsSkipped,
        totalSteps: workflowSteps.length
      }
    });

  } catch (error: any) {
    logger.error({
      error: error.message,
      stack: error.stack,
      sessionId
    }, 'Batch calibration failed with exception');

    // Mark session as failed if it exists
    if (sessionId) {
      try {
        const supabase = await createAuthenticatedServerClient();
        const sessionRepo = new CalibrationSessionRepository(supabase);
        await sessionRepo.markFailed(sessionId, error.message);
      } catch (updateErr) {
        logger.error({ error: updateErr }, 'Failed to mark session as failed');
      }
    }

    return NextResponse.json(
      {
        error: 'Batch calibration failed',
        message: error.message || 'An unexpected error occurred during batch calibration',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  } finally {
    // Always release distributed lock
    if (lockAcquired && lockKey) {
      await releaseLock(lockKey);
      logger.info({ lockKey }, 'Distributed lock released');
    }
  }
}
