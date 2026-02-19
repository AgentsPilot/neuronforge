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

    // 6.5. Scan and auto-fix structural issues before execution
    logger.info({ sessionId, agentId }, 'Scanning for structural issues');
    const { StructuralRepairEngine } = await import('@/lib/pilot/shadow/StructuralRepairEngine');
    const repairEngine = new StructuralRepairEngine();

    const structuralIssues = await repairEngine.scanWorkflow(agent);
    logger.info({
      sessionId,
      agentId,
      issuesFound: structuralIssues.length,
      autoFixable: structuralIssues.filter(i => i.autoFixable).length
    }, 'Structural scan complete');

    let structuralFixes: any[] = [];
    if (structuralIssues.length > 0) {
      logger.info({ sessionId, agentId }, 'Attempting to auto-fix structural issues');
      const fixResults = await repairEngine.autoFixWorkflow(agent);
      structuralFixes = fixResults.filter(r => r.fixed);

      logger.info({
        sessionId,
        agentId,
        fixedCount: structuralFixes.length,
        totalIssues: structuralIssues.length
      }, 'Structural auto-fix complete');

      // Persist structural fixes to database
      if (structuralFixes.length > 0) {
        logger.info({ sessionId, agentId }, 'Persisting structural fixes to database');

        const { error: updateError } = await supabase
          .from('agents')
          .update({
            pilot_steps: agent.pilot_steps,
            updated_at: new Date().toISOString()
          })
          .eq('id', agentId);

        if (updateError) {
          logger.error({ error: updateError, sessionId, agentId }, 'Failed to persist structural fixes');
        } else {
          logger.info({
            sessionId,
            agentId,
            fixedCount: structuralFixes.length
          }, 'Successfully persisted structural fixes to database');
        }
      }

      // If critical issues remain unfixed, warn but continue
      const criticalUnfixed = structuralIssues.filter(i =>
        i.severity === 'critical' && !i.autoFixable
      );
      if (criticalUnfixed.length > 0) {
        logger.warn({
          sessionId,
          agentId,
          criticalUnfixed: criticalUnfixed.length
        }, 'Critical structural issues could not be auto-fixed');
      }
    }

    // 7. Execute workflow in batch calibration mode
    logger.info({ sessionId, agentId, inputValues }, 'Starting workflow execution in batch calibration mode');
    console.log('[BatchCalibration] Input values received:', JSON.stringify(inputValues, null, 2));

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

    // DEBUG: Log what we received from WorkflowPilot
    logger.info({
      sessionId,
      hasCollectedIssues: !!result.collectedIssues,
      collectedIssuesLength: result.collectedIssues?.length || 0,
      allIssuesLength: allIssues.length,
      issueCategories: allIssues.map(i => i.category),
      issuesWithProposals: allIssues.filter(i => i.autoRepairProposal).length,
      dataShapeMismatches: allIssues.filter(i => i.category === 'data_shape_mismatch').length
    }, 'DEBUG: Received collected issues from WorkflowPilot');

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
      console.log('📊 [Batch Calibration] Storing execution summary:', {
        hasExecutionSummary: !!result.execution_summary,
        executionSummary: result.execution_summary
      });
      await sessionRepo.update(sessionId, {
        status: 'completed',
        execution_id: result.executionId,
        completed_steps: result.stepsCompleted,
        failed_steps: result.stepsFailed,
        skipped_steps: result.stepsSkipped,
        completed_at: new Date().toISOString(),
        execution_summary: result.execution_summary || null
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

    // 9.5. Auto-apply data_shape_mismatch repairs WITHOUT user interaction
    // Check ALL issue groups (critical, warnings, autoRepairs) for data shape mismatches
    const allIssuesForRepair = [
      ...prioritized.critical,
      ...prioritized.warnings,
      ...prioritized.autoRepairs
    ];

    // Debug: Log ALL issues to see what we're working with
    logger.info({
      sessionId,
      allIssuesCount: allIssuesForRepair.length,
      issueBreakdown: {
        categories: allIssuesForRepair.map(i => i.category),
        withProposals: allIssuesForRepair.filter(i => i.autoRepairProposal).length,
        dataShapeMismatches: allIssuesForRepair.filter(i => i.category === 'data_shape_mismatch').length
      },
      detailedIssues: allIssuesForRepair.map(i => ({
        id: i.id,
        category: i.category,
        hasProposal: !!i.autoRepairProposal,
        proposalAction: i.autoRepairProposal?.action,
        affectedSteps: i.affectedSteps?.map(s => s.stepId)
      }))
    }, 'DEBUG: All collected issues before auto-repair filter');

    const dataShapeMismatchIssues = allIssuesForRepair.filter(
      issue => issue.category === 'data_shape_mismatch' &&
               issue.autoRepairProposal &&
               issue.autoRepairProposal.action !== 'none'
    );

    logger.info({
      sessionId,
      foundDataShapeMismatches: dataShapeMismatchIssues.length,
      proposals: dataShapeMismatchIssues.map(i => ({
        action: i.autoRepairProposal?.action,
        extractField: i.autoRepairProposal?.extractField,
        targetStepId: i.autoRepairProposal?.targetStepId,
        confidence: i.autoRepairProposal?.confidence
      }))
    }, 'DEBUG: Filtered data_shape_mismatch issues ready for auto-repair');

    if (dataShapeMismatchIssues.length > 0) {
      logger.info({
        sessionId,
        count: dataShapeMismatchIssues.length,
        actions: dataShapeMismatchIssues.map(i => i.autoRepairProposal?.action),
        issues: dataShapeMismatchIssues.map(i => ({
          id: i.id,
          affectedSteps: i.affectedSteps?.map(s => s.stepId),
          proposal: {
            action: i.autoRepairProposal?.action,
            extractField: i.autoRepairProposal?.extractField,
            targetStepId: i.autoRepairProposal?.targetStepId
          }
        }))
      }, 'DEBUG: Starting auto-repair of data shape mismatches');

      // Import apply-fixes logic inline to avoid circular dependencies
      let updatedSteps = [...workflowSteps];
      let repairsApplied = 0;

      logger.info({
        sessionId,
        workflowStepsCount: updatedSteps.length,
        topLevelStepIds: updatedSteps.map(s => s.id || s.step_id)
      }, 'DEBUG: Workflow structure before repairs');

      logger.info({
        sessionId,
        arrayLength: dataShapeMismatchIssues.length,
        arrayType: typeof dataShapeMismatchIssues,
        isArray: Array.isArray(dataShapeMismatchIssues),
        firstIssueId: dataShapeMismatchIssues[0]?.id
      }, 'DEBUG: ABOUT TO START FOR LOOP');

      // Try manual iteration to debug
      logger.info({ sessionId, msg: 'DEBUG: Trying manual iteration' });
      for (let i = 0; i < dataShapeMismatchIssues.length; i++) {
        const issue = dataShapeMismatchIssues[i];
        logger.info({
          sessionId,
          index: i,
          issueId: issue?.id,
          hasProposal: !!issue?.autoRepairProposal,
          proposalAction: issue?.autoRepairProposal?.action
        }, 'DEBUG: MANUAL ITERATION - Processing issue');

        const proposal = issue.autoRepairProposal;
        if (!proposal) {
          logger.warn({ issueId: issue.id }, 'DEBUG: Issue has no proposal, skipping');
          continue;
        }

        logger.info({
          issueId: issue.id,
          proposalAction: proposal.action,
          extractField: proposal.extractField,
          targetStepId: proposal.targetStepId
        }, 'DEBUG: Processing repair for issue');

        try {
          // Apply the repair directly to updatedSteps
          if (
            proposal.action === 'extract_single_array' ||
            proposal.action === 'extract_named_array' ||
            proposal.action === 'extract_from_envelope' ||
            proposal.action === 'extract_paginated_data'
          ) {
            const failedStepId = issue.affectedSteps?.[0]?.stepId;
            if (!failedStepId) {
              logger.warn({ issueId: issue.id, action: proposal.action },
                'DEBUG: No failedStepId in issue.affectedSteps');
              continue;
            }

            logger.info({ issueId: issue.id, failedStepId, action: proposal.action },
              'DEBUG: Looking for failed step in workflow');

            const failedStep = findStepByIdRecursive(updatedSteps, failedStepId);
            if (!failedStep) {
              logger.warn({ issueId: issue.id, failedStepId, topLevelSteps: updatedSteps.map(s => s.id || s.step_id) },
                'DEBUG: Failed step not found in workflow');
              continue;
            }

            logger.info({ issueId: issue.id, failedStepId, hasInput: !!failedStep.input },
              'DEBUG: Found failed step');

            const extractField = proposal.extractField || proposal.envelopeKey;
            if (!extractField) {
              logger.warn({ issueId: issue.id, action: proposal.action },
                'DEBUG: No extractField in proposal');
              continue;
            }

            if (!failedStep.input) {
              logger.warn({ issueId: issue.id, failedStepId, stepType: failedStep.type },
                'DEBUG: Failed step has no input field');
              continue;
            }

            // Update input to navigate to array field
            const originalInput = failedStep.input;
            const varPattern = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
            failedStep.input = failedStep.input.replace(varPattern, `{{$1.${extractField}}}`);

            repairsApplied++;
            logger.info({
              issueId: issue.id,
              extractField,
              originalInput,
              newInput: failedStep.input,
              action: proposal.action
            }, 'Auto-repair applied: extract array field');
          }
        } catch (err: any) {
          logger.error({ issueId: issue.id, error: err.message },
            'Failed to auto-apply repair - will show to user');
        }
      }

      // Update agent with repaired workflow
      if (repairsApplied > 0) {
        await supabase
          .from('agents')
          .update({ pilot_steps: updatedSteps })
          .eq('id', agentId);

        logger.info({ sessionId, repairsApplied },
          'Updated agent with auto-repaired workflow');
      }
    }

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
      skipped_steps: result.stepsSkipped,
      execution_summary: result.execution_summary || null
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
      },
      structuralFixes: structuralFixes.length > 0 ? structuralFixes : undefined
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

/**
 * Recursively find step by ID (handles nested steps)
 */
function findStepByIdRecursive(steps: any[], stepId: string): any {
  for (const step of steps) {
    if (step.id === stepId || step.step_id === stepId) {
      return step;
    }

    // Search nested parallel steps
    if (step.type === 'parallel' && step.steps) {
      const found = findStepByIdRecursive(step.steps, stepId);
      if (found) return found;
    }

    // Search nested scatter_gather steps
    if (step.type === 'scatter_gather' && step.scatter?.steps) {
      const found = findStepByIdRecursive(step.scatter.steps, stepId);
      if (found) return found;
    }

    // Search conditional branches
    if (step.type === 'conditional') {
      if (step.then) {
        const found = findStepByIdRecursive(step.then, stepId);
        if (found) return found;
      }
      if (step.else) {
        const found = findStepByIdRecursive(step.else, stepId);
        if (found) return found;
      }
    }

    // Search loop steps
    if (step.type === 'loop' && step.loopSteps) {
      const found = findStepByIdRecursive(step.loopSteps, stepId);
      if (found) return found;
    }

    // Search sub_workflow steps
    if (step.type === 'sub_workflow' && step.steps) {
      const found = findStepByIdRecursive(step.steps, stepId);
      if (found) return found;
    }
  }

  return null;
}
