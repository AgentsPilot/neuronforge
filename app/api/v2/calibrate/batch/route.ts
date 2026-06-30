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
import { WorkflowValidator } from '@/lib/pilot/WorkflowValidator';
import { CalibrationSessionRepository } from '@/lib/repositories/CalibrationSessionRepository';
import { CalibrationHistoryRepository } from '@/lib/repositories/CalibrationHistoryRepository';
import { acquireLock, releaseLock } from '@/lib/utils/distributedLock';
import { AgentRepository } from '@/lib/repositories/AgentRepository';
import { sendCalibrationResultEmail } from '@/lib/calibration/calibrationResultEmail';
import { getCalibrationEmailConfig } from '@/lib/calibration/CalibrationEmailConfigService';
import { createLogger } from '@/lib/logger';
import type { CollectedIssue } from '@/lib/pilot/types';
// NOTE: this route historically imported `Agent` from `@/types/agent`, a module
// that never existed — so the import resolved to `any`, which the rest of the
// route relies on. It accesses raw workflow-step fields (`.config`, `.scatter`,
// `.step_id`, `.operation`) and passes `agent` to both pilot-typed and
// repository-typed signatures; pinning it to either concrete `Agent` interface
// surfaces ~90+ pre-existing type-debt errors across this route and the shared
// `WorkflowStep` type. Keeping it permissive and intentional (documented) until
// that broader typing debt is addressed as its own task.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Agent = any;

const logger = createLogger({ module: 'BatchCalibrationAPI', service: 'api' });

// Calibration can run for the better part of a minute (real execution + LLM
// layers). Give it headroom — same ceiling as the queue worker. Also the budget
// for the Phase 2 background path, where the client fires this and navigates away.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let sessionId: string | null = null;
  let lockKey: string | null = null;
  let lockAcquired = false;

  // Phase 2 background-calibration tail. When the post-creation flow fires this
  // route in the background (client doesn't await), we record the gate outcome
  // and email the user at the end. Captured during the run, used in `finally`.
  // None of this affects the synchronous/manual sandbox path (background=false).
  let isBackground = false;
  let calibrationStarted = false;
  let runCtx: {
    supabase: Awaited<ReturnType<typeof createAuthenticatedServerClient>>;
    userId: string;
    userEmail: string | null;
    agentId: string;
    agentName: string;
  } | null = null;

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
    const { agentId, inputValues, background } = await req.json();
    isBackground = background === true;

    if (!agentId) {
      logger.warn({ userId: user.id }, 'Missing agentId in batch calibration request');
      return NextResponse.json(
        { error: 'Missing agentId', message: 'agentId is required' },
        { status: 400 }
      );
    }

    logger.info({ agentId, userId: user.id }, 'Starting batch calibration');

    // 3. Fetch agent
    let agent: Agent | null = null;
    const { data: fetchedAgent, error: agentError } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .single();
    agent = fetchedAgent as Agent;

    if (agentError || !agent) {
      logger.error({ agentId, error: agentError }, 'Agent not found');
      return NextResponse.json(
        { error: 'Agent not found', message: 'The requested agent does not exist' },
        { status: 404 }
      );
    }

    // Log agent input_schema for debugging config extraction
    logger.info({
      agentId,
      hasInputSchema: !!agent.input_schema,
      inputSchemaLength: agent.input_schema?.length || 0,
      inputSchemaPreview: agent.input_schema?.map((f: any) => ({
        name: f.name,
        hasDefaultValue: f.default_value !== undefined,
        defaultValue: f.default_value
      })) || []
    }, 'Agent fetched - checking input_schema for config values');

    // 4. Authorization check
    if (agent.user_id !== user.id) {
      logger.warn({ agentId, userId: user.id, ownerId: agent.user_id }, 'Unauthorized agent access');
      return NextResponse.json(
        { error: 'Forbidden', message: 'You do not have permission to calibrate this agent' },
        { status: 403 }
      );
    }

    // Capture context for the Phase 2 calibration tail (used in `finally`).
    // Captured for ALL runs (not just background) so a manual sandbox pass also
    // clears the gate; the email itself is still background-only.
    runCtx = {
      supabase,
      userId: user.id,
      userEmail: user.email ?? null,
      agentId,
      agentName: agent.agent_name || 'your agent',
    };

    // 5. Validate workflow exists
    const workflowSteps = agent.pilot_steps || agent.workflow_steps || [];
    if (workflowSteps.length === 0) {
      logger.warn({ agentId }, 'Agent has no workflow steps');
      return NextResponse.json(
        { error: 'No workflow', message: 'This agent has no workflow steps to calibrate' },
        { status: 400 }
      );
    }

    // 5a. Block calibration for production-ready workflows
    const isProductionReady = (agent as any).production_ready === true;
    if (isProductionReady) {
      logger.warn({
        agentId,
        productionReady: true
      }, 'Cannot calibrate production-ready workflow');

      return NextResponse.json({
        error: 'Production Workflow',
        message: 'This workflow is marked as production-ready and cannot be calibrated. Please unmark it from production to make changes.',
        productionReady: true
      }, { status: 403 });
    }

    // 5b. Block calibration for already-calibrated workflows
    const isCalibrated = (agent as any).is_calibrated === true;
    if (isCalibrated) {
      logger.warn({
        agentId,
        isCalibrated: true
      }, 'Workflow already calibrated - no re-calibration needed');

      return NextResponse.json({
        error: 'Already Calibrated',
        message: 'This workflow has been successfully calibrated and does not need re-calibration. The workflow is ready to use. If you need to make changes, edit the workflow first (this will reset calibration status).',
        isCalibrated: true
      }, { status: 200 }); // Use 200, not 403 - this is expected behavior, not an error
    }

    // Generate hashes for analytics tracking only (saved to calibration_history)
    const { generateWorkflowHash, generateInputSchemaHash } = await import('@/lib/utils/workflowHash');
    const currentWorkflowHash = generateWorkflowHash(workflowSteps);
    const currentInputSchemaHash = generateInputSchemaHash(agent.input_schema);

    // Check calibration history for existing successful calibration
    const calibrationHistoryRepo = new CalibrationHistoryRepository(supabase);
    const { data: lastSuccessful } = await calibrationHistoryRepo.getLastSuccessful(agentId, user.id);

    // Initialize variables used across all validation layers
    const transformationIssues: any[] = [];
    let structuralFixes: any[] = [];
    const transformationProposals: any[] = [];

    // Initialize session repository (used in both fast path and normal path)
    const sessionRepo = new CalibrationSessionRepository(supabase);

    // Initialize validation metadata (will be populated in Layers 1-2, or use defaults in fast path)
    let validationMetadata: any = {
      validatedAt: new Date().toISOString(),
      layer1Fixes: 0,
      layer2HighConfidenceFixes: 0,
      layer2MediumConfidenceFixes: 0,
      actionReplacementFixes: 0,
      multiStepStructuralFixes: 0,
      earlyMultiStepFixes: 0,
      lateMultiStepFixes: 0,
      mediumConfidenceNotifications: [],
      structuralIssuesDetected: 0
    };

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

    // From here a real calibration run is underway — the background tail (finally)
    // may record its outcome + email the user. Pre-run rejections above must NOT
    // trigger that, hence this flag is set only now.
    calibrationStarted = true;

    sessionId = session.id;
    logger.info({ sessionId, agentId }, 'Calibration session created');

    // 6.5. LAYER 1: Enhanced Schema Validation (Deterministic - 100% Safe)
    logger.info({ sessionId, agentId }, '[Layer 1] Running enhanced schema validation');
    const { EnhancedSchemaValidator } = await import('@/lib/pilot/shadow/EnhancedSchemaValidator');
    const enhancedValidator = new EnhancedSchemaValidator();

    const enhancedIssues = await enhancedValidator.validateWorkflow(agent);
    logger.info({
      sessionId,
      agentId,
      issuesFound: enhancedIssues.length,
      critical: enhancedIssues.filter(i => i.severity === 'critical').length,
      autoFixable: enhancedIssues.filter(i => i.autoFixable).length
    }, '[Layer 1] Enhanced schema validation complete');

    // Auto-fix high-confidence issues (0.95+)
    let layer1Fixes = 0;
    for (const issue of enhancedIssues.filter(i => i.autoFixable && i.confidence >= 0.95)) {
      const fixed = await enhancedValidator.autoFix(agent, issue);
      if (fixed) {
        layer1Fixes++;
        logger.info({
          sessionId,
          issueType: issue.type,
          stepId: issue.stepId,
          confidence: issue.confidence
        }, '[Layer 1] Auto-fixed high-confidence issue');
      }
    }

    // 6.5.5. LAYER 1 ENHANCED: Multi-Step Structural Detection (BEFORE StructuralRepairEngine)
    // CRITICAL: Must run BEFORE StructuralRepairEngine to see original field configuration

    // DEBUG: Log step2 config BEFORE any validation
    const step2Debug = agent.pilot_steps.find((s: any) => s.id === 'step2' || s.step_id === 'step2');
    logger.info({
      sessionId,
      agentId,
      step2ConfigKeys: step2Debug?.config ? Object.keys(step2Debug.config) : [],
      step2Field: step2Debug?.config?.field,
      step2ConfigRaw: (JSON.stringify(step2Debug?.config) || '').substring(0, 200)
    }, '[DEBUG] Step2 config BEFORE any validation');

    logger.info({ sessionId, agentId }, '[Layer 1 Enhanced] Running multi-step structural detection (pre-repair)');
    const { ConstrainedSemanticValidator } = await import('@/lib/pilot/shadow/ConstrainedSemanticValidator');
    const semanticValidatorEarly = new ConstrainedSemanticValidator();

    const earlyMultiStepIssues = await semanticValidatorEarly.detectStructuralIssues(agent);

    logger.info({
      sessionId,
      agentId,
      totalStructuralIssues: earlyMultiStepIssues.length,
      byType: earlyMultiStepIssues.reduce((acc, i) => {
        acc[i.type] = (acc[i.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    }, '[Layer 1 Enhanced] Multi-step structural detection complete (pre-repair)');

    // Generate and apply multi-step fixes EARLY (before StructuralRepairEngine modifies workflow)
    let earlyMultiStepFixesApplied = 0;
    const earlyMultiStepNotifications: any[] = [];

    for (const issue of earlyMultiStepIssues) {
      const fix = await semanticValidatorEarly.generateMultiStepFix(issue, agent);

      if (fix && fix.verified) {
        if (fix.confidence >= 0.85) {
          // High confidence: Auto-apply silently
          const applied = await semanticValidatorEarly.applyMultiStepFix(agent, fix);
          if (applied) {
            earlyMultiStepFixesApplied++;
            logger.info({
              sessionId,
              agentId,
              action: fix.action,
              affectedSteps: fix.affectedSteps,
              confidence: fix.confidence,
              reasoning: fix.reasoning
            }, '[Layer 1 Enhanced] Auto-applied high-confidence multi-step fix (early)');
          }
        } else if (fix.confidence >= 0.70) {
          // Medium confidence: Auto-apply with notification
          const applied = await semanticValidatorEarly.applyMultiStepFix(agent, fix);
          if (applied) {
            earlyMultiStepFixesApplied++;
            earlyMultiStepNotifications.push({
              type: issue.type,
              description: issue.description,
              confidence: fix.confidence,
              changes: fix.reasoning,
              affectedSteps: fix.affectedSteps
            });
            logger.warn({
              sessionId,
              agentId,
              action: fix.action,
              affectedSteps: fix.affectedSteps,
              confidence: fix.confidence,
              reasoning: fix.reasoning
            }, '[Layer 1 Enhanced] Auto-applied medium-confidence multi-step fix (early - notification required)');
          }
        } else {
          // Low confidence: Skip auto-fix
          logger.info({
            sessionId,
            issueType: issue.type,
            confidence: fix.confidence
          }, '[Layer 1 Enhanced] Skipping low-confidence multi-step fix (early)');
        }
      }
    }

    // 6.6. Original StructuralRepairEngine scan (backward compatibility)
    logger.info({ sessionId, agentId }, 'Scanning for structural issues (legacy)');
    const { StructuralRepairEngine } = await import('@/lib/pilot/shadow/StructuralRepairEngine');
    const repairEngine = new StructuralRepairEngine();

    const structuralIssues = await repairEngine.scanWorkflow(agent);
    logger.info({
      sessionId,
      agentId,
      issuesFound: structuralIssues.length,
      autoFixable: structuralIssues.filter(i => i.autoFixable).length
    }, 'Structural scan complete');

    if (structuralIssues.length > 0) {
      logger.info({ sessionId, agentId }, 'Attempting to auto-fix structural issues');
      const fixResults = await repairEngine.autoFixWorkflow(agent);
      structuralFixes = fixResults.filter(r => r.fixed);

      // CRITICAL: Extract transformation proposals that need calibration-level handling
      // These are issues that StructuralRepairEngine detected but can't fix directly
      logger.info({
        sessionId,
        agentId,
        totalStructuralIssues: structuralIssues.length,
        missingParamIssues: structuralIssues.filter(i => i.type === 'missing_required_parameter').length,
        autoFixableIssues: structuralIssues.filter(i => i.autoFixable).length,
        missingParamAutoFixable: structuralIssues.filter(i => i.type === 'missing_required_parameter' && i.autoFixable).length
      }, '[StructuralRepair] DEBUG: Analyzing structural issues for transformation proposals');

      for (const issue of structuralIssues) {
        if (issue.type === 'missing_required_parameter' && issue.autoFixable) {
          // Get the fix proposal for this issue
          const proposal = await repairEngine.proposeStructuralFix(issue, agent);

          // Check if it's a transformation proposal (fields-to-array)
          if (proposal.fix?.transformationType === 'fields_to_array') {
            transformationProposals.push({
              stepId: issue.stepId,
              paramName: proposal.fix.paramName,
              sourceParam: proposal.fix.sourceParam,
              fieldMapping: proposal.fix.fieldMapping,
              confidence: proposal.confidence,
              description: proposal.description
            });

            logger.info({
              sessionId,
              stepId: issue.stepId,
              paramName: proposal.fix.paramName,
              sourceParam: proposal.fix.sourceParam,
              confidence: proposal.confidence
            }, '[StructuralRepair] Collected transformation proposal for calibration auto-fix');
          }
        }
      }

      logger.info({
        sessionId,
        agentId,
        fixedCount: structuralFixes.length,
        totalIssues: structuralIssues.length,
        transformationProposals: transformationProposals.length
      }, 'Structural auto-fix complete');
    }

    // 6.7. LAYER 4: Scatter-Gather Flow Validation (Dedicated)
    logger.info({ sessionId, agentId }, '[Layer 4] Running scatter-gather flow validation');
    const { ScatterGatherFlowValidator } = await import('@/lib/pilot/shadow/ScatterGatherFlowValidator');
    const flowValidator = new ScatterGatherFlowValidator();

    const flowIssues = await flowValidator.validateWorkflow(agent);
    logger.info({
      sessionId,
      agentId,
      issuesFound: flowIssues.length,
      critical: flowIssues.filter(i => i.severity === 'critical').length,
      autoFixable: flowIssues.filter(i => i.autoFixable).length
    }, '[Layer 4] Scatter-gather flow validation complete');

    // Auto-fix high-confidence flow issues (0.85+)
    let layer4Fixes = 0;
    for (const issue of flowIssues.filter(i => i.autoFixable && i.confidence >= 0.85)) {
      if (issue.suggestedFix) {
        // Apply the fix based on issue type
        const allSteps = getAllStepsRecursive(agent.pilot_steps || []);
        const step = allSteps.find(s => (s.step_id || s.id) === issue.stepId);

        if (step) {
          const { field, newValue } = issue.suggestedFix;

          if (field === 'gather.from') {
            if (!step.gather) step.gather = {};
            step.gather.from = newValue;
            layer4Fixes++;
            logger.info({
              sessionId,
              issueType: issue.type,
              stepId: issue.stepId,
              oldValue: issue.suggestedFix.oldValue,
              newValue,
              confidence: issue.confidence
            }, '[Layer 4] Auto-fixed gather.from reference');
          } else if (field === 'gather.operation') {
            if (!step.gather) step.gather = {};
            step.gather.operation = newValue;
            layer4Fixes++;
            logger.info({
              sessionId,
              issueType: issue.type,
              stepId: issue.stepId,
              oldValue: issue.suggestedFix.oldValue,
              newValue,
              confidence: issue.confidence
            }, '[Layer 4] Auto-fixed gather.operation type mismatch');
          }
        }
      }
    }

    // Helper function to get all steps recursively
    function getAllStepsRecursive(steps: any[]): any[] {
      const result: any[] = [];
      for (const step of steps) {
        result.push(step);
        if (step.type === 'scatter_gather' && step.scatter?.steps) {
          result.push(...getAllStepsRecursive(step.scatter.steps));
        }
        if (step.type === 'conditional') {
          if (step.then_steps) result.push(...getAllStepsRecursive(step.then_steps));
          if (step.else_steps) result.push(...getAllStepsRecursive(step.else_steps));
        }
      }
      return result;
    }

    // CRITICAL FIX: Manual scan for Google Sheets append_rows with fields parameter
    // The StructuralRepairEngine sometimes misses nested steps in conditionals
    // This is a fallback to ensure we catch fields→values transformations
    const manualFieldsToValuesScans = (steps: any[]): void => {
      for (const step of steps) {
        // Check if this step is Google Sheets append_rows with fields
        if (step.plugin === 'google-sheets' && step.action === 'append_rows') {
          const params = step.params || step.config || {};
          const hasFields = !!params.fields && typeof params.fields === 'object';
          const hasValues = !!params.values;

          if (hasFields && !hasValues) {
            logger.info({
              sessionId,
              agentId,
              stepId: step.id || step.step_id,
              fields: Object.keys(params.fields)
            }, '[Manual Scan] Detected Google Sheets append_rows with fields parameter - creating transformation proposal');

            transformationProposals.push({
              stepId: step.id || step.step_id,
              paramName: 'values',
              sourceParam: 'fields',
              fieldMapping: params.fields,
              confidence: 0.95,
              description: 'Transform fields object to values 2D array for Google Sheets'
            });
          }
        }

        // Recursively scan nested steps
        if (step.type === 'scatter_gather' && step.scatter?.steps) {
          manualFieldsToValuesScans(step.scatter.steps);
        }
        if (step.type === 'conditional') {
          if (step.steps && Array.isArray(step.steps)) {
            manualFieldsToValuesScans(step.steps);
          }
          if (step.then && Array.isArray(step.then)) {
            manualFieldsToValuesScans(step.then);
          }
          if (step.else && Array.isArray(step.else)) {
            manualFieldsToValuesScans(step.else);
          }
          if (step.then_steps && Array.isArray(step.then_steps)) {
            manualFieldsToValuesScans(step.then_steps);
          }
          if (step.else_steps && Array.isArray(step.else_steps)) {
            manualFieldsToValuesScans(step.else_steps);
          }
        }
      }
    };

    manualFieldsToValuesScans(agent.pilot_steps || []);
    logger.info({
      sessionId,
      agentId,
      transformationProposalsAfterManualScan: transformationProposals.length
    }, '[Manual Scan] Completed Google Sheets fields→values scan');

    // 6.7. Persist all pre-flight fixes to database
    const totalPreFlightFixes = layer1Fixes + earlyMultiStepFixesApplied + structuralFixes.length;
    if (totalPreFlightFixes > 0) {
      logger.info({
        sessionId,
        agentId,
        layer1Fixes,
        earlyMultiStepFixes: earlyMultiStepFixesApplied,
        structuralFixes: structuralFixes.length,
        total: totalPreFlightFixes
      }, 'Persisting pre-flight fixes to database');

      const { error: updateError } = await supabase
        .from('agents')
        .update({
          pilot_steps: agent.pilot_steps,
          input_schema: agent.input_schema,
          updated_at: new Date().toISOString()
        })
        .eq('id', agentId);

      if (updateError) {
        logger.error({ error: updateError, sessionId, agentId }, 'Failed to persist pre-flight fixes');
      } else {
        logger.info({
          sessionId,
          agentId,
          fixedCount: totalPreFlightFixes
        }, 'Successfully persisted pre-flight fixes to database');

        // CRITICAL: Reload agent from database to get the fixed pilot_steps
        const { data: updatedAgent, error: reloadError } = await supabase
          .from('agents')
          .select('*')
          .eq('id', agentId)
          .single();

        if (reloadError) {
          logger.error({ error: reloadError, sessionId, agentId }, 'Failed to reload agent after fixes');
        } else if (updatedAgent) {
          agent = updatedAgent as Agent;
          logger.info({ sessionId, agentId }, 'Reloaded agent with fixed pilot_steps from database');
        }
      }
    }

    // CRITICAL: Convert transformation proposals into auto-repair issues for calibration loop
    // These issues will be detected during execution and auto-fixed by the calibration system
    if (transformationProposals.length > 0) {
      logger.info({
        sessionId,
        agentId,
        transformationCount: transformationProposals.length
      }, '[StructuralRepair] Creating calibration issues from transformation proposals');

      for (const proposal of transformationProposals) {
        // Create an issue that will be detected and auto-fixed by the calibration loop
        transformationIssues.push({
          id: `transformation_${proposal.stepId}_${proposal.paramName}`,
          stepId: proposal.stepId,
          type: 'missing_required_parameter',
          message: `Missing required parameter: ${proposal.paramName} (fields-to-array transformation needed)`,
          severity: 'critical',
          autoRepairAvailable: true,
          requiresUserInput: false,
          autoRepairProposal: {
            type: 'transform_fields_to_values',
            confidence: proposal.confidence,
            changes: [{
              stepId: proposal.stepId,
              path: `params.${proposal.paramName}`,
              action: 'transform_to_array',
              inputVariable: 'item',  // Will be determined during application
              missingParam: proposal.paramName,
              providedParam: proposal.sourceParam,
              fieldMapping: proposal.fieldMapping,
              reasoning: proposal.description
            }]
          },
          affectedSteps: [{ stepId: proposal.stepId }]
        });

        logger.info({
          sessionId,
          stepId: proposal.stepId,
          paramName: proposal.paramName,
          confidence: proposal.confidence
        }, '[StructuralRepair] Created transformation issue for calibration auto-fix');
      }
    }

    // Warn if critical issues remain unfixed
    const criticalUnfixed = [
      ...enhancedIssues.filter(i => i.severity === 'critical' && !i.autoFixable),
      ...structuralIssues.filter(i => i.severity === 'critical' && !i.autoFixable)
    ];
    if (criticalUnfixed.length > 0) {
      logger.warn({
        sessionId,
        agentId,
        criticalUnfixed: criticalUnfixed.length,
        issues: criticalUnfixed.map(i => ({ type: i.type, stepId: i.stepId, description: i.description }))
      }, 'Critical issues could not be auto-fixed - workflow may fail');
    }

    // 6.8. LAYER 2: Constrained Semantic Validation (LLM Detection + Deterministic Fixes)
    logger.info({ sessionId, agentId }, '[Layer 2] Running constrained semantic validation');
    // Phase 6 — Calibration audit fix (G-CAL-4): reuse the early-detection
    // validator instance from line 251 instead of constructing a second one.
    // Each `ConstrainedSemanticValidator` runs an LLM detection pass, so
    // duplicate instances doubled the token spend per calibration run.
    const semanticValidator = semanticValidatorEarly;

    // Get ONLY plugin schemas for plugins used in this workflow (token optimization)
    // Previously we loaded ALL plugin schemas which wasted 70-80% of input tokens
    const pluginSchemas = new Map();
    const PluginManagerV2 = (await import('@/lib/server/plugin-manager-v2')).default;
    const pluginManager = await PluginManagerV2.getInstance();

    const requiredPlugins = agent.plugins_required || [];
    logger.info({
      sessionId,
      agentId,
      requiredPlugins,
      pluginCount: requiredPlugins.length
    }, '[Layer 2] Loading only required plugin schemas for LLM detection');

    for (const pluginKey of requiredPlugins) {
      const pluginDef = pluginManager.getPluginDefinition(pluginKey);
      if (pluginDef) {
        pluginSchemas.set(pluginKey, {
          name: pluginDef.plugin.name,
          actions: Object.entries(pluginDef.actions).map(([actionKey, actionDef]) => ({
            name: actionKey,
            description: actionDef.description,
            parameters: actionDef.parameters,
            outputSchema: actionDef.output_schema
          }))
        });
      } else {
        logger.warn({ sessionId, pluginKey }, '[Layer 2] Plugin definition not found');
      }
    }

    const semanticFixes = await semanticValidator.validateWorkflow(agent, pluginSchemas);

    logger.info({
      sessionId,
      agentId,
      totalFixes: semanticFixes.length,
      highConfidence: semanticFixes.filter(f => f.confidence >= 0.85).length,
      mediumConfidence: semanticFixes.filter(f => f.confidence >= 0.70 && f.confidence < 0.85).length,
      lowConfidence: semanticFixes.filter(f => f.confidence < 0.70).length
    }, '[Layer 2] Semantic validation complete');

    // Apply fixes based on confidence thresholds
    let layer2HighConfidenceFixes = 0;
    let layer2MediumConfidenceFixes = 0;
    const mediumConfidenceNotifications: any[] = [];

    for (const fix of semanticFixes) {
      if (fix.confidence >= 0.85) {
        // High confidence (0.85+): Auto-fix silently
        const applied = await semanticValidator.applyFix(agent, fix);
        if (applied) {
          layer2HighConfidenceFixes++;
          logger.info({
            sessionId,
            stepId: fix.stepId,
            path: fix.path,
            oldValue: fix.oldValue,
            newValue: fix.newValue,
            confidence: fix.confidence,
            reasoning: fix.reasoning
          }, '[Layer 2] Auto-fixed high-confidence semantic issue');
        }
      } else if (fix.confidence >= 0.70) {
        // Medium confidence (0.70-0.84): Auto-fix with notification
        const applied = await semanticValidator.applyFix(agent, fix);
        if (applied) {
          layer2MediumConfidenceFixes++;
          mediumConfidenceNotifications.push({
            stepId: fix.stepId,
            description: fix.reasoning,
            confidence: fix.confidence,
            change: `${fix.path}: ${fix.oldValue} → ${fix.newValue}`
          });
          logger.warn({
            sessionId,
            stepId: fix.stepId,
            path: fix.path,
            oldValue: fix.oldValue,
            newValue: fix.newValue,
            confidence: fix.confidence,
            reasoning: fix.reasoning
          }, '[Layer 2] Auto-fixed medium-confidence issue (notification required)');
        }
      } else {
        // Low confidence (<0.70): Skip auto-fix
        logger.info({
          sessionId,
          stepId: fix.stepId,
          confidence: fix.confidence,
          reasoning: fix.reasoning
        }, '[Layer 2] Skipping low-confidence fix');
      }
    }

    // 6.8.4. LAYER 2 ACTION MISMATCH DETECTION
    logger.info({ sessionId, agentId }, '[Layer 2 Action Mismatch] Detecting wrong action selections');

    const { ActionMismatchDetector } = await import('@/lib/pilot/shadow/ActionMismatchDetector');
    const actionMismatchDetector = new ActionMismatchDetector(pluginManager);

    const actionMismatchIssues = await actionMismatchDetector.detectActionMismatches(agent);

    logger.info({
      sessionId,
      agentId,
      totalActionMismatchIssues: actionMismatchIssues.length,
      byConfidence: {
        high: actionMismatchIssues.filter(i => i.confidence >= 0.85).length,
        medium: actionMismatchIssues.filter(i => i.confidence >= 0.70 && i.confidence < 0.85).length,
        low: actionMismatchIssues.filter(i => i.confidence < 0.70).length
      }
    }, '[Layer 2 Action Mismatch] Detection complete');

    // Generate and apply action replacement fixes
    let actionReplacementFixesApplied = 0;
    const actionReplacementNotifications: any[] = [];

    for (const issue of actionMismatchIssues) {
      const fix = await actionMismatchDetector.generateActionReplacementFix(issue, agent);

      if (fix && fix.verified) {
        if (fix.confidence >= 0.85) {
          // High confidence: Auto-apply silently
          const applied = actionMismatchDetector.applyActionReplacementFix(agent, fix);
          if (applied) {
            actionReplacementFixesApplied++;
            logger.info({
              sessionId,
              agentId,
              stepId: issue.stepId,
              fromAction: issue.currentAction,
              toAction: issue.suggestedAction,
              confidence: fix.confidence,
              reasoning: fix.reasoning
            }, '[Layer 2 Action Mismatch] Auto-applied high-confidence action replacement');
          }
        } else if (fix.confidence >= 0.70) {
          // Medium confidence: Auto-apply with notification
          const applied = actionMismatchDetector.applyActionReplacementFix(agent, fix);
          if (applied) {
            actionReplacementFixesApplied++;
            actionReplacementNotifications.push({
              stepId: issue.stepId,
              description: `Wrong action: ${issue.currentAction} → ${issue.suggestedAction}`,
              confidence: fix.confidence,
              change: `Action replaced: ${issue.currentAction} → ${issue.suggestedAction}`,
              reasoning: fix.reasoning
            });
            logger.warn({
              sessionId,
              agentId,
              stepId: issue.stepId,
              fromAction: issue.currentAction,
              toAction: issue.suggestedAction,
              confidence: fix.confidence,
              reasoning: fix.reasoning
            }, '[Layer 2 Action Mismatch] Auto-applied medium-confidence action replacement (notification required)');
          }
        } else {
          // Low confidence: Skip
          logger.info({
            sessionId,
            agentId,
            stepId: issue.stepId,
            confidence: fix.confidence
          }, '[Layer 2 Action Mismatch] Skipping low-confidence action replacement');
        }
      }
    }

    // Add action replacement notifications to medium confidence notifications
    if (actionReplacementNotifications.length > 0) {
      mediumConfidenceNotifications.push(...actionReplacementNotifications);
    }

    // 6.8.5. LAYER 2 ENHANCED: Multi-Step Structural Detection
    // NOTE: Multi-Step Detection now runs EARLY (at 6.5.5, before StructuralRepairEngine)
    // This section is kept commented for potential second-pass detection after Layer 2 semantic fixes
    // Uncomment if we want to run multi-step detection twice (before and after semantic validation)

    /*
    logger.info({ sessionId, agentId }, '[Layer 2 Enhanced] Running multi-step structural detection (second pass)');

    const multiStepStructuralIssues = await semanticValidator.detectStructuralIssues(agent);

    logger.info({
      sessionId,
      agentId,
      totalStructuralIssues: multiStepStructuralIssues.length,
      byType: multiStepStructuralIssues.reduce((acc, i) => {
        acc[i.type] = (acc[i.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    }, '[Layer 2 Enhanced] Multi-step structural detection complete (second pass)');

    // Generate and apply multi-step fixes
    let multiStepFixesApplied = 0;
    const multiStepNotifications: any[] = [];

    for (const issue of multiStepStructuralIssues) {
      const fix = await semanticValidator.generateMultiStepFix(issue, agent);

      if (fix && fix.verified) {
        if (fix.confidence >= 0.85) {
          // High confidence: Auto-apply silently
          const applied = await semanticValidator.applyMultiStepFix(agent, fix);
          if (applied) {
            multiStepFixesApplied++;
            logger.info({
              sessionId,
              agentId,
              action: fix.action,
              affectedSteps: fix.affectedSteps,
              confidence: fix.confidence,
              reasoning: fix.reasoning
            }, '[Layer 2 Enhanced] Auto-applied high-confidence multi-step fix (second pass)');
          }
        } else if (fix.confidence >= 0.70) {
          // Medium confidence: Auto-apply with notification
          const applied = await semanticValidator.applyMultiStepFix(agent, fix);
          if (applied) {
            multiStepFixesApplied++;
            multiStepNotifications.push({
              type: issue.type,
              description: issue.description,
              confidence: fix.confidence,
              changes: fix.reasoning,
              affectedSteps: fix.affectedSteps
            });
            logger.warn({
              sessionId,
              agentId,
              action: fix.action,
              affectedSteps: fix.affectedSteps,
              confidence: fix.confidence,
              reasoning: fix.reasoning
            }, '[Layer 2 Enhanced] Auto-applied medium-confidence multi-step fix (second pass - notification required)');
          }
        } else {
          // Low confidence: Skip
          logger.info({
            sessionId,
            agentId,
            issueType: issue.type,
            confidence: fix.confidence
          }, '[Layer 2 Enhanced] Skipping low-confidence multi-step fix (second pass)');
        }
      }
    }

    // Add multi-step notifications to medium confidence notifications
    if (multiStepNotifications.length > 0) {
      mediumConfidenceNotifications.push(...multiStepNotifications.map(n => ({
        stepId: n.affectedSteps.join(', '),
        description: n.description,
        confidence: n.confidence,
        change: n.changes
      })));
    }
    */

    // Placeholder variables for commented-out second pass
    const multiStepFixesApplied = 0;

    // 6.8.1. CRITICAL: Propagate dependencies after all structural and semantic fixes
    // This ensures that steps with variable references in params have correct dependencies
    // Example: step16 (send_email) uses {{digest_content}} from step15 → needs dependency on step15
    logger.info({ sessionId, agentId }, '[Layer 2 Dependency Propagation] Propagating dependencies across workflow');
    semanticValidator.propagateDependencies(agent);
    logger.info({ sessionId, agentId }, '[Layer 2 Dependency Propagation] Dependency propagation complete');

    // 6.9. Persist Layer 2 fixes to database (but save validation_metadata for calibration_history)
    const totalLayer2Fixes = layer2HighConfidenceFixes + layer2MediumConfidenceFixes + multiStepFixesApplied + actionReplacementFixesApplied;

    // Update validation metadata with Layer 1-2 results for later inclusion in calibration_history
    validationMetadata = {
      validatedAt: new Date().toISOString(),
      layer1Fixes: layer1Fixes,
      layer2HighConfidenceFixes,
      layer2MediumConfidenceFixes,
      actionReplacementFixes: actionReplacementFixesApplied,
      multiStepStructuralFixes: earlyMultiStepFixesApplied + multiStepFixesApplied,
      earlyMultiStepFixes: earlyMultiStepFixesApplied,
      lateMultiStepFixes: multiStepFixesApplied,
      mediumConfidenceNotifications: [...mediumConfidenceNotifications, ...earlyMultiStepNotifications],
      structuralIssuesDetected: earlyMultiStepIssues.length
    };

    if (totalLayer2Fixes > 0) {
      logger.info({
        sessionId,
        agentId,
        highConfidenceFixes: layer2HighConfidenceFixes,
        mediumConfidenceFixes: layer2MediumConfidenceFixes,
        multiStepFixes: multiStepFixesApplied,
        actionReplacementFixes: actionReplacementFixesApplied,
        total: totalLayer2Fixes
      }, 'Persisting Layer 2 semantic, action replacement, and multi-step fixes to database');

      const { error: updateError } = await supabase
        .from('agents')
        .update({
          pilot_steps: agent.pilot_steps,
          input_schema: agent.input_schema,
          updated_at: new Date().toISOString()
        })
        .eq('id', agentId);

      if (updateError) {
        logger.error({ error: updateError, sessionId, agentId }, 'Failed to persist Layer 2 fixes');
      } else {
        logger.info({
          sessionId,
          agentId,
          fixedCount: totalLayer2Fixes
        }, 'Successfully persisted Layer 2 fixes to database');

        // CRITICAL: Reload agent from database to get the fixed pilot_steps
        const { data: updatedAgent, error: reloadError } = await supabase
          .from('agents')
          .select('*')
          .eq('id', agentId)
          .single();

        if (reloadError) {
          logger.error({ error: reloadError, sessionId, agentId }, 'Failed to reload agent after Layer 2 fixes');
        } else if (updatedAgent) {
          agent = updatedAgent as Agent;
          logger.info({ sessionId, agentId }, 'Reloaded agent with Layer 2 fixes from database');
        }
      }
    }

    // Log medium-confidence notifications for UI
    if (mediumConfidenceNotifications.length > 0) {
      logger.warn({
        sessionId,
        agentId,
        notifications: mediumConfidenceNotifications
      }, 'Medium-confidence fixes applied - user notification required');
    }

    // Ensure sessionId is set (should always be true by this point)
    if (!sessionId) {
      throw new Error('Session ID not initialized - this should never happen');
    }

    // P3 (WP-56): scatter/loop item-ref FIELD validation + high-confidence auto-repair.
    // Runs BEFORE the dry-run so a confident rewrite (e.g. {{doc_item.folder_id}} →
    // {{doc_item.id}}, verified against the PLUGIN DEFINITION — confidence ≥ 0.9)
    // takes effect and the dry-run executes the FIXED workflow. Lower-confidence
    // matches are collected and surfaced as proposals later — never silently
    // rewritten (the WP-40 hazard). Non-blocking.
    let scatterAutoFixCount = 0;
    const scatterFieldProposals: any[] = [];
    try {
      const { ScatterItemFieldValidator } = await import('@/lib/pilot/shadow/ScatterItemFieldValidator');
      const targetSteps = agent.pilot_steps || agent.workflow_steps || [];
      const scatterFieldIssues = new ScatterItemFieldValidator(
        (plugin: string, action: string) => pluginManager.getActionDefinition(plugin, action)?.output_schema ?? null
      ).validate(targetSteps);
      const SCATTER_AUTOFIX_MIN_CONFIDENCE = 0.9; // identifier-matched, plugin-def-verified
      for (const sfi of scatterFieldIssues) {
        if (sfi.confidence >= SCATTER_AUTOFIX_MIN_CONFIDENCE && ScatterItemFieldValidator.applyFix(targetSteps, sfi)) {
          scatterAutoFixCount++;
          logger.info({ sessionId, agentId, stepId: sfi.subStepId, from: sfi.oldToken, to: sfi.newToken, confidence: sfi.confidence },
            '[ScatterItemField] Auto-applied high-confidence field-ref fix');
        } else {
          scatterFieldProposals.push(sfi); // low-confidence or unapplyable → surface as a proposal
        }
      }
      if (scatterAutoFixCount > 0) {
        await supabase
          .from('agents')
          .update({ pilot_steps: agent.pilot_steps, updated_at: new Date().toISOString() })
          .eq('id', agentId);
        logger.info({ sessionId, agentId, scatterAutoFixCount },
          '[ScatterItemField] Persisted auto-applied field-ref fixes before dry-run');
      }
    } catch (err) {
      logger.error({ err, sessionId, agentId }, '[ScatterItemField] validation/auto-repair failed (non-blocking)');
    }

    // Phase 4 — monotonic "round" across every workflow execution in this
    // calibration (dry-run + each loop iteration + re-runs), so each outbound
    // message the agent sends is uniquely numbered for the recipient.
    let calibrationRound = 0;

    // 6.10. LAYER 3: Dry-Run Validation (Context-Aware with Real Data)
    logger.info({ sessionId, agentId }, '[Layer 3] Running dry-run validation with real user data');
    const { DryRunValidator } = await import('@/lib/pilot/shadow/DryRunValidator');
    const dryRunValidator = new DryRunValidator();

    const dryRunResult = await dryRunValidator.validateWithDryRun(agent, inputValues, user.id, ++calibrationRound, user.email ?? undefined);

    logger.info({
      sessionId,
      agentId,
      success: dryRunResult.success,
      isEmpty: dryRunResult.isEmpty,
      stepsCompleted: dryRunResult.stepsCompleted,
      stepsFailed: dryRunResult.stepsFailed,
      issuesFound: dryRunResult.issues.length,
      executionTime: dryRunResult.executionTime
    }, '[Layer 3] Dry-run validation complete');

    // Log critical dry-run issues
    const criticalDryRunIssues = dryRunResult.issues.filter(i => i.severity === 'critical');
    if (criticalDryRunIssues.length > 0) {
      logger.error({
        sessionId,
        agentId,
        criticalIssues: criticalDryRunIssues
      }, '[Layer 3] Critical issues detected in dry run - workflow may not work as expected');
    }

    // Warn if workflow returned empty results
    if (dryRunResult.success && dryRunResult.isEmpty && dryRunResult.workflowType === 'data-processing') {
      logger.warn({
        sessionId,
        agentId,
        finalOutput: dryRunResult.finalOutput
      }, '[Layer 3] Workflow returned empty results - may indicate type mismatch or missing field extraction');
    }

    // 7. AUTO-CALIBRATION LOOP - Fix issues before execution, then re-run until perfect
    logger.info({ sessionId, agentId, inputValues }, 'Starting auto-calibration loop');
    console.log('[BatchCalibration] Input values received:', JSON.stringify(inputValues, null, 2));

    let loopIteration = 0;
    const MAX_ITERATIONS = 10; // Increased to handle multiple fix rounds
    let finalResult: any = null;
    let autoFixesApplied = 0;
    let currentAgent = agent; // Track agent state across iterations
    let allIssuesForUI: any[] = []; // Collect all issues for final UI display

    // Phase 6 — Calibration audit fix (G-CAL-1): surface dry-run findings to the UI.
    // Previously dryRunResult.issues was only logged — critical issues silently
    // disappeared from the user-visible calibration report. Now we promote
    // critical + high severity into allIssuesForUI so the user actually sees them.
    // Also flag empty-data-processing results as a high-severity issue.
    if (dryRunResult.issues && dryRunResult.issues.length > 0) {
      for (const issue of dryRunResult.issues) {
        // Drop only the lowest severity tier to avoid noise; surface everything else.
        if (issue.severity === 'low') continue;
        allIssuesForUI.push({
          source: 'dry_run',
          type: issue.type,
          severity: issue.severity,
          description: issue.description,
          details: issue.details,
          suggested_fix: issue.suggestedFix,
        });
      }
      logger.info({
        sessionId,
        agentId,
        surfacedFromDryRun: dryRunResult.issues.filter(i => i.severity !== 'low').length,
      }, '[G-CAL-1] Dry-run issues promoted to user-visible report');
    }
    if (dryRunResult.success && dryRunResult.isEmpty && dryRunResult.workflowType === 'data-processing') {
      allIssuesForUI.push({
        source: 'dry_run',
        type: 'empty_result',
        severity: 'high',
        description: 'Workflow returned empty results in a data-processing flow — likely a type mismatch or missing field extraction.',
        details: { finalOutput: dryRunResult.finalOutput },
      });
    }
    const validator = new WorkflowValidator();
    let finalValidationRunCount = 0; // Track final validation runs to prevent infinite loops
    const MAX_FINAL_VALIDATION_RUNS = 2;

    // Surface non-autoFixable structural issues to the UI
    // These are issues that require user attention (e.g., broken variable references)
    if (structuralIssues && structuralIssues.length > 0) {
      const nonFixableStructuralIssues = structuralIssues.filter((i: any) => !i.autoFixable);
      if (nonFixableStructuralIssues.length > 0) {
        for (const issue of nonFixableStructuralIssues) {
          allIssuesForUI.push({
            source: 'structural_repair',
            type: issue.type,
            severity: issue.severity || 'medium',
            description: issue.description,
            stepId: issue.stepId,
            details: issue,
            suggested_fix: null
          });
        }
        logger.warn({
          sessionId,
          agentId,
          nonFixableCount: nonFixableStructuralIssues.length
        }, '[StructuralRepair] Non-autoFixable issues surfaced to UI');
      }
    }

    // P3 (WP-56): reconcile the scatter item-ref results computed before the dry-run.
    //  - High-confidence fixes were already auto-applied to the DSL + persisted →
    //    count them as auto-fixes here (autoFixesApplied is declared just above).
    //  - Lower-confidence / unapplyable matches are surfaced as before/after
    //    proposals for the user to confirm (never silently rewritten — WP-40).
    if (scatterAutoFixCount > 0) {
      autoFixesApplied += scatterAutoFixCount;
    }
    for (const sfi of scatterFieldProposals) {
      const description = `In "${sfi.subStepId}", each ${sfi.itemVariable} is an item from "${sfi.sourceVariable}", which has no "${sfi.brokenField}" field — so ${sfi.oldToken} is empty at run time. Change it to ${sfi.newToken}. Available fields: ${sfi.availableFields.join(', ')}.`;
      // Shape like a CollectedIssue so IssueGrouper.getGroupKey() gives it a
      // distinct key (category + id + affectedSteps); otherwise it falls into the
      // `unique:undefined` bucket and is merged away before reaching the UI.
      // `source` is retained for the userFacing translator dispatch.
      allIssuesForUI.push({
        id: crypto.randomUUID(),
        source: 'scatter_item_field',
        type: 'parameter_error',
        category: 'parameter_error',
        severity: 'critical',
        affectedSteps: [{ stepId: sfi.subStepId, stepName: sfi.subStepId, friendlyName: sfi.subStepId }],
        title: "A field name doesn't exist on these items",
        description,
        message: description,
        stepId: sfi.subStepId,
        details: {
          ...sfi,
          autoRepairProposal: {
            type: 'rewrite_scatter_item_field_reference',
            stepId: sfi.subStepId,
            oldValue: sfi.oldToken,
            newValue: sfi.newToken,
            confidence: sfi.confidence,
          },
        },
        autoRepairAvailable: false,
        requiresUserInput: true,
        estimatedImpact: 'high',
        suggested_fix: `Replace ${sfi.oldToken} with ${sfi.newToken}`,
      });
    }
    if (scatterAutoFixCount > 0 || scatterFieldProposals.length > 0) {
      logger.info({ sessionId, agentId, autoApplied: scatterAutoFixCount, surfacedProposals: scatterFieldProposals.length },
        '[ScatterItemField] Reconciled scatter item-ref results (auto-applied + surfaced)');
    }

    // Merge input_schema default values into inputValues for fields not provided
    let mergedInputValues = { ...inputValues };
    if (currentAgent.input_schema && Array.isArray(currentAgent.input_schema)) {
      for (const field of currentAgent.input_schema) {
        // If field has default_value and inputValues doesn't have this field, use default
        if (field.default_value !== undefined && mergedInputValues[field.name] === undefined) {
          mergedInputValues[field.name] = field.default_value;
          logger.info({
            sessionId,
            fieldName: field.name,
            defaultValue: field.default_value
          }, 'Populated input field from schema default_value');
        }
      }
    }
    console.log('[BatchCalibration] Merged input values (with defaults):', JSON.stringify(mergedInputValues, null, 2));

    // CONVERGENCE DETECTION: Track which fixes were applied to which steps
    // Key: stepId, Value: Set of fix types applied
    const fixHistory = new Map<string, Set<string>>();

    function trackFix(stepId: string, fixType: string): boolean {
      if (!fixHistory.has(stepId)) {
        fixHistory.set(stepId, new Set());
      }

      const fixes = fixHistory.get(stepId)!;

      // If we've seen this fix before on this step, we're in a loop
      if (fixes.has(fixType)) {
        logger.warn({
          sessionId,
          stepId,
          fixType,
          previousFixes: Array.from(fixes)
        }, 'Convergence issue detected: same fix applied multiple times to same step');
        return false; // Indicates convergence failure
      }

      fixes.add(fixType);
      return true; // Fix is new, can proceed
    }

    // CHECKPOINT/ROLLBACK MECHANISM: Save agent state before each iteration
    interface Checkpoint {
      iteration: number;
      agent: Agent;
      issueCount: number;
      timestamp: string;
    }

    const checkpoints: Checkpoint[] = [];

    function createCheckpoint(agent: Agent, iteration: number, issueCount: number): void {
      // Deep clone agent to prevent mutations
      const checkpoint: Checkpoint = {
        iteration,
        agent: JSON.parse(JSON.stringify(agent)),
        issueCount,
        timestamp: new Date().toISOString()
      };

      checkpoints.push(checkpoint);

      logger.debug({
        sessionId,
        iteration,
        issueCount,
        checkpointCount: checkpoints.length
      }, 'Checkpoint created');
    }

    function rollbackToCheckpoint(targetIteration: number): Agent | null {
      const checkpoint = checkpoints.find(c => c.iteration === targetIteration);

      if (checkpoint) {
        logger.info({
          sessionId,
          targetIteration,
          currentIteration: loopIteration,
          issueCount: checkpoint.issueCount
        }, 'Rolling back to checkpoint');
        return checkpoint.agent;
      }

      logger.warn({
        sessionId,
        targetIteration,
        availableCheckpoints: checkpoints.map(c => c.iteration)
      }, 'Checkpoint not found for rollback');
      return null;
    }

    function detectRegressionPattern(): { hasRegression: boolean; rollbackTo?: number } {
      if (checkpoints.length < 3) {
        return { hasRegression: false };
      }

      // Check if issue count is increasing over last 3 iterations
      const lastThree = checkpoints.slice(-3);
      const isIncreasing = lastThree[0].issueCount < lastThree[1].issueCount &&
                          lastThree[1].issueCount < lastThree[2].issueCount;

      if (isIncreasing) {
        logger.warn({
          sessionId,
          issueTrend: lastThree.map(c => ({ iteration: c.iteration, issues: c.issueCount }))
        }, 'Regression detected: issue count increasing over last 3 iterations');

        // Rollback to the iteration with fewest issues
        const best = lastThree.reduce((min, curr) => curr.issueCount < min.issueCount ? curr : min);
        return { hasRegression: true, rollbackTo: best.iteration };
      }

      return { hasRegression: false };
    }

    while (loopIteration < MAX_ITERATIONS) {
      loopIteration++;
      logger.info({ sessionId, agentId, loopIteration }, `Auto-calibration iteration ${loopIteration}`);

      // CHECKPOINT: Save agent state at beginning of iteration (before any validation/execution)
      // Issue count will be updated after execution
      createCheckpoint(currentAgent, loopIteration, 0);

      // REGRESSION DETECTION: Check if we're making things worse
      const regressionCheck = detectRegressionPattern();
      if (regressionCheck.hasRegression && regressionCheck.rollbackTo) {
        logger.warn({
          sessionId,
          loopIteration,
          rollbackTo: regressionCheck.rollbackTo
        }, 'Regression detected - rolling back to best checkpoint');

        const rolledBackAgent = rollbackToCheckpoint(regressionCheck.rollbackTo);
        if (rolledBackAgent) {
          currentAgent = rolledBackAgent;

          // Clear fix history for steps that were rolled back
          // This allows those fixes to be re-attempted with new context
          fixHistory.clear();

          logger.info({
            sessionId,
            loopIteration,
            rollbackTo: regressionCheck.rollbackTo
          }, 'Rollback complete - continuing from checkpoint');
        }
      }

      // PHASE 1: PRE-FLIGHT VALIDATION - Check for issues BEFORE execution
      const fieldRefIssues = validator.validateFieldReferences(
        currentAgent.pilot_steps || currentAgent.workflow_steps || []
      );
      const operationFieldIssues = validator.validateOperationFields(
        currentAgent.pilot_steps || currentAgent.workflow_steps || []
      );
      const flattenFieldIssues = validator.validateFlattenFields(
        currentAgent.pilot_steps || currentAgent.workflow_steps || []
      );

      const allPreFlightIssues = [...fieldRefIssues, ...operationFieldIssues, ...flattenFieldIssues];

      // Enhanced logging for validation results
      logger.info({
        sessionId,
        loopIteration,
        fieldRefIssues: fieldRefIssues.map(i => ({ step: i.stepId, ref: i.invalidReference })),
        operationFieldIssues: operationFieldIssues.map(i => ({ step: i.stepId, field: i.invalidField, context: i.context })),
        flattenFieldIssues: flattenFieldIssues.map(i => ({ step: i.stepId, current: i.currentField }))
      }, 'Validation scan results');

      if (allPreFlightIssues.length > 0) {
        logger.info({
          sessionId,
          agentId,
          loopIteration,
          issueCount: allPreFlightIssues.length,
          fieldRefIssues: fieldRefIssues.length,
          operationFieldIssues: operationFieldIssues.length,
          flattenFieldIssues: flattenFieldIssues.length
        }, 'Pre-flight validation found issues - applying fixes immediately');

        // Convert issues to CollectedIssue format
        const preFlightIssues: any[] = [];

        // Add field reference issues
        preFlightIssues.push(...fieldRefIssues.map(issue => ({
          id: `preflight_fieldref_${issue.stepId}_${issue.parameter}`,
          category: 'parameter_error' as const,
          severity: 'critical' as const,
          affectedSteps: [{ stepId: issue.stepId, stepName: issue.stepId, friendlyName: issue.stepId }],
          title: `Invalid field reference: ${issue.invalidReference}`,
          message: issue.reason,
          autoRepairAvailable: true,
          requiresUserInput: false,
          suggestedFix: {
            type: 'fix_parameter_reference',
            action: {
              targetStepId: issue.stepId,
              from: issue.invalidReference,
              to: issue.suggestedFix
            },
            confidence: issue.confidence
          }
        })));

        // Add operation field issues
        preFlightIssues.push(...operationFieldIssues.map(issue => ({
          id: `preflight_opfield_${issue.stepId}_${issue.context}`,
          category: 'configuration_missing' as const,
          severity: 'critical' as const,
          affectedSteps: [{ stepId: issue.stepId, stepName: issue.stepId, friendlyName: issue.stepId }],
          title: `Wrong ${issue.context} field: ${issue.invalidField} should be ${issue.suggestedField}`,
          message: issue.reason,
          autoRepairAvailable: true,
          requiresUserInput: false,
          suggestedFix: {
            type: 'fix_operation_field',
            action: {
              targetStepId: issue.stepId,
              context: issue.context,
              field: issue.invalidField,
              suggestedField: issue.suggestedField
            },
            confidence: issue.confidence
          }
        })));

        // Add flatten field issues
        preFlightIssues.push(...flattenFieldIssues.map(issue => ({
          id: `preflight_flatten_${issue.stepId}`,
          category: 'configuration_missing' as const,
          severity: 'critical' as const,
          affectedSteps: [{ stepId: issue.stepId, stepName: issue.stepId, friendlyName: issue.stepId }],
          title: `Wrong flatten field: ${issue.currentField} should be ${issue.suggestedField}`,
          message: issue.reason,
          autoRepairAvailable: true,
          requiresUserInput: false,
          suggestedFix: {
            type: 'fix_flatten_field',
            action: {
              targetStepId: issue.stepId,
              from: issue.currentField,
              to: issue.suggestedField
            },
            confidence: issue.confidence
          }
        })));

        // Apply pre-flight fixes immediately
        const currentSteps = currentAgent.pilot_steps || currentAgent.workflow_steps || [];
        let updatedSteps = [...currentSteps];
        let fixesAppliedThisRound = 0;

        // CLEANUP: Remove conflicting field configurations (custom_code takes precedence)
        // This ensures steps with custom_code don't have an explicit field set
        let cleanupCount = 0;
        updatedSteps = updatedSteps.map(step => {
          if (step.operation === 'flatten' && step.config?.custom_code && step.config?.field) {
            logger.info({
              stepId: step.step_id || step.id,
              removedField: step.config.field,
              reason: 'Step has custom_code - field not required'
            }, '[Cleanup] Removing conflicting field from flatten step with custom_code');

            const { field, ...restConfig } = step.config;
            cleanupCount++;
            return { ...step, config: restConfig };
          }
          return step;
        });

        if (cleanupCount > 0) {
          logger.info({
            sessionId,
            agentId: currentAgent.id,
            stepsCleanedUp: cleanupCount
          }, '[Cleanup] Removed conflicting field configurations from steps with custom_code');
        }

        for (const issue of preFlightIssues) {
          const fixType = issue.suggestedFix?.type;
          const action = issue.suggestedFix?.action;
          const targetStepId = action?.targetStepId;

          logger.info({ issueId: issue.id, fixType, targetStepId }, 'Attempting to apply pre-flight fix');

          if (!targetStepId) {
            logger.warn({ issueId: issue.id }, 'No targetStepId in action, skipping fix');
            continue;
          }

          const targetStep = findStepByIdRecursive(updatedSteps, targetStepId);
          if (!targetStep) {
            logger.warn({ issueId: issue.id, targetStepId }, 'Target step not found, skipping fix');
            continue;
          }

          logger.info({ issueId: issue.id, targetStepId, stepType: targetStep.type }, 'Found target step');

          if (fixType === 'fix_parameter_reference') {
            // Fix {{variable.field}} references in config/params
            const fromRef = action?.from;
            const toRef = action?.to;

            if (fromRef && toRef) {
              const replaceInValue = (obj: any): any => {
                if (typeof obj === 'string') {
                  const escapedFrom = fromRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  return obj.replace(new RegExp(escapedFrom, 'g'), toRef);
                } else if (Array.isArray(obj)) {
                  return obj.map(replaceInValue);
                } else if (typeof obj === 'object' && obj !== null) {
                  const result: any = {};
                  for (const [key, value] of Object.entries(obj)) {
                    result[key] = replaceInValue(value);
                  }
                  return result;
                }
                return obj;
              };

              if ((targetStep as any).config) {
                (targetStep as any).config = replaceInValue((targetStep as any).config);
              }
              if ((targetStep as any).params) {
                (targetStep as any).params = replaceInValue((targetStep as any).params);
              }
              fixesAppliedThisRound++;
              logger.info({ issueId: issue.id, from: fromRef, to: toRef },
                'Pre-flight auto-fix applied: fix_parameter_reference');
            }
          } else if (fixType === 'fix_flatten_field') {
            // Apply flatten field fixes from WorkflowValidator
            // BUT skip if step has custom_code - it doesn't need an explicit field
            const currentField = action?.from;
            const suggestedField = action?.to;

            // Check if step has custom_code - if so, skip the fix
            const hasCustomCode = !!(targetStep as any).config?.custom_code;

            if (hasCustomCode && currentField === '(missing)') {
              logger.info({
                issueId: issue.id,
                stepId: issue.stepId || (issue as any).context?.stepId,
                currentField,
                suggestedField,
                reason: 'Step has custom_code - field not required'
              }, 'SKIPPED: fix_flatten_field (step uses custom_code)');
            } else if (suggestedField) {
              if (!(targetStep as any).config) {
                (targetStep as any).config = {};
              }
              (targetStep as any).config.field = suggestedField;
              fixesAppliedThisRound++;
              logger.info({
                issueId: issue.id,
                stepId: issue.stepId || (issue as any).context?.stepId,
                currentField,
                suggestedField,
                reason: currentField === '(missing)' ? 'Field was missing' : 'Field was invalid'
              }, 'Pre-flight auto-fix applied: fix flatten field');
            } else {
              logger.warn({
                issueId: issue.id,
                currentField
              }, 'SKIPPED: fix_flatten_field (no suggested field provided)');
            }
          } else if (fixType === 'fix_operation_field') {
            // ✅ APPLY FILTER FIELD FIXES - execution does NOT handle item.X -> X conversion
            const context = action?.context;
            const suggestedField = action?.suggestedField;

            // APPLY: Filter field corrections (execution does NOT handle item.X prefix removal)
            if (context === 'filter') {
              // Fix filter conditions: replace "item.X" with "X"
              if (targetStep.config && targetStep.config.condition && action?.field) {
                const oldField = action.field;
                const newField = suggestedField;

                const replaceFieldInCondition = (condition: any): any => {
                  if (!condition) return condition;

                  if (condition.field === oldField) {
                    condition.field = newField;
                  }

                  // Handle complex conditions with nested conditions array
                  if (condition.conditions && Array.isArray(condition.conditions)) {
                    condition.conditions = condition.conditions.map(replaceFieldInCondition);
                  }

                  return condition;
                };

                targetStep.config.condition = replaceFieldInCondition(targetStep.config.condition);
                fixesAppliedThisRound++;
                logger.info({
                  issueId: issue.id,
                  stepId: targetStepId,
                  from: oldField,
                  to: newField,
                  context
                }, 'Pre-flight auto-fix applied: fix_operation_field (filter field correction)');
              }
            }
            // SKIP: Other field path corrections (execution handles with schema-aware resolution)
            else if (context === 'flatten' || context === 'map' || context === 'transform') {
              logger.info({
                issueId: issue.id,
                context,
                from: action?.field,
                to: suggestedField,
                reason: 'Execution uses schema-aware resolution to handle field paths automatically'
              }, 'SKIPPED: fix_operation_field (execution handles this)');
            } else if (context === 'action_param') {
              // KEEP: Parameter NAME validation (execution can't fix wrong parameter names)
              // Only fix if it's a genuine parameter name mismatch (e.g., file_url -> file_content)
              // Not field paths (those are handled by execution)
              if (suggestedField && (targetStep as any).config) {
                const config = (targetStep as any).config;
                const paramNameMismatches = ['file_url', 'file_content', 'spreadsheet_id', 'sheet_id'];

                // Only fix if it's a parameter name issue, not a field path issue
                for (const paramName of Object.keys(config)) {
                  if (paramNameMismatches.includes(paramName) && config[paramName] === action?.field) {
                    config[paramName] = suggestedField;
                    fixesAppliedThisRound++;
                    logger.info({ issueId: issue.id, context, paramName, from: action?.field, to: suggestedField },
                      'Pre-flight auto-fix applied: fix_operation_field (parameter name correction)');
                    break;
                  }
                }
              }
            }
          }
        }

        if (fixesAppliedThisRound > 0) {
          // Persist fixes to database
          await supabase
            .from('agents')
            .update({
              pilot_steps: updatedSteps,
              updated_at: new Date().toISOString()
            })
            .eq('id', agentId);

          autoFixesApplied += fixesAppliedThisRound;

          // Reload agent for next iteration
          const { data: updatedAgent } = await supabase
            .from('agents')
            .select('*')
            .eq('id', agentId)
            .single();

          if (updatedAgent) {
            currentAgent = updatedAgent;
          }

          logger.info({
            sessionId,
            loopIteration,
            fixesApplied: fixesAppliedThisRound,
            totalAutoFixes: autoFixesApplied
          }, 'Pre-flight fixes applied - skipping execution, will re-validate in next iteration');

          // SKIP EXECUTION - fixes were applied, need to re-validate
          continue;
        }
      }

      // PHASE 2: Execute workflow (only if no pre-flight fixes were needed)
      const pilot = new WorkflowPilot(supabase);
      const result = await pilot.execute(
        currentAgent,
        user.id,
        '', // userInput not needed for batch calibration
        mergedInputValues || {},
        crypto.randomUUID(), // Generate session ID for execution
        undefined, // stepEmitter
        false, // debugMode
        undefined, // debugRunId
        undefined, // providedExecutionId
        'batch_calibration', // runMode: batch_calibration
        ++calibrationRound, // monotonic round across dry-run + iterations (Phase 4)
        user.email ?? undefined // redirect outbound messages to the owner (Phase 4)
      );

      finalResult = result;

      logger.info({
        sessionId,
        loopIteration,
        executionId: result.executionId,
        completed: result.stepsCompleted,
        failed: result.stepsFailed,
        skipped: result.stepsSkipped,
        issuesCollected: result.collectedIssues?.length || 0
      }, 'Workflow execution completed');

      // CRITICAL: Check if any steps failed - if so, we MUST fix issues before continuing
      if (result.stepsFailed > 0) {
        logger.warn({
          sessionId,
          loopIteration,
          executionId: result.executionId,
          stepsFailed: result.stepsFailed,
          stepsCompleted: result.stepsCompleted
        }, 'Workflow execution had failed steps - will analyze issues and attempt fixes');

        // Don't let workflow continue to send emails or produce outputs with failed steps
        // The calibration loop will fix issues and re-run from the beginning
      }

      // PHASE 3: Analyze execution results and collect issues
      let iterationIssues = result.collectedIssues || [];

      // CRITICAL: Inject transformation issues from StructuralRepairEngine on first iteration
      // These are pre-detected issues that need calibration-level auto-fix (AI transform step insertion)
      if (loopIteration === 1 && transformationIssues.length > 0) {
        logger.info({
          sessionId,
          loopIteration,
          transformationIssuesCount: transformationIssues.length
        }, '[StructuralRepair] Injecting transformation issues into first iteration');

        iterationIssues = [...transformationIssues, ...iterationIssues];
      }

      // CRITICAL: Detect scatter-gather errors from BOTH sources:
      // 1. Already-collected issues (when scatter throws in batch calibration mode)
      // 2. Step outputs with error objects (when scatter swallows in production mode)
      const scatterGatherErrorIssues: CollectedIssue[] = [];

      // First, check if any collected issues are scatter-gather errors with parameter mismatch patterns
      for (const collectedIssue of iterationIssues) {
        const errorMessage = collectedIssue.message || collectedIssue.technicalDetails || '';

        // Expanded pattern library for parameter mismatch detection
        // Pattern 1a: "parameter X not implemented. Please pass/use Y parameter"
        // Pattern 1b: "X is not supported, use Y instead"
        // Pattern 1c: "parameter X not accepted, please provide Y"
        // Pattern 1d: "X: not implemented (use Y)"
        const paramMismatchPatterns = [
          /(\w+)\s+not implemented.*?(?:pass|use)\s+(\w+)\s+parameter/i,
          /(\w+)\s+is not supported.*?use\s+(\w+)\s+instead/i,
          /parameter\s+(\w+)\s+not accepted.*?provide\s+(\w+)/i,
          /(\w+):\s*not implemented\s*\(use\s+(\w+)\)/i,
          /(\w+)\s+parameter.*?not\s+(?:supported|implemented|available).*?(?:use|try|pass)\s+(\w+)/i,
        ];

        let paramMatch: RegExpMatchArray | null = null;
        for (const pattern of paramMismatchPatterns) {
          paramMatch = errorMessage.match(pattern);
          if (paramMatch) break;
        }

        // Pattern 2: "parameter_name is required" - indicates value resolved to null/empty
        const requiredParamPattern = /(\w+)\s+is\s+required/i;
        const requiredMatch = errorMessage.match(requiredParamPattern);

        if (paramMatch || requiredMatch) {
          const stepId = collectedIssue.affectedSteps?.[0]?.stepId;
          if (!stepId) continue;

          logger.info({
            sessionId,
            loopIteration,
            issueId: collectedIssue.id,
            stepId,
            errorPattern: paramMatch ? 'parameter_mismatch' : 'required_parameter',
            errorMessage: errorMessage.slice(0, 200)
          }, 'Found scatter-gather error in collected issues - will enhance with auto-repair proposal');

          // The issue already exists in iterationIssues, but we need to add auto-repair proposal
          // This will be handled in the scanning loop below where we add the proposals
        }
      }

      // Second, scan step outputs for error objects (production mode behavior)
      // Use result.output which contains actual step outputs, not execution_trace which is metadata
      const stepOutputs = result.output || {};

      logger.info({
        sessionId,
        loopIteration,
        outputStepIds: Object.keys(stepOutputs),
        outputStepCount: Object.keys(stepOutputs).length
      }, 'Scanning step outputs for scatter-gather errors');

      for (const [stepId, stepOutput] of Object.entries(stepOutputs)) {
        const output = stepOutput as any;

        logger.debug({
          sessionId,
          stepId,
          outputIsArray: Array.isArray(output),
          outputType: typeof output,
          outputPreview: output ? JSON.stringify(output).slice(0, 200) : 'null'
        }, 'Checking step output for errors');

        if (output && Array.isArray(output)) {
          // Check if any items in the output array have error fields
          const errorItems = output.filter((item: any) => item && typeof item === 'object' && item.error);
          if (errorItems.length > 0) {
            const totalItems = output.length;
            const errorMessages = errorItems.map((item: any) => item.error).slice(0, 3); // First 3 errors

            logger.warn({
              sessionId,
              loopIteration,
              stepId,
              totalItems,
              failedItems: errorItems.length,
              sampleErrors: errorMessages
            }, 'Detected scatter-gather items with errors');

            // Parse error messages to detect auto-fixable patterns
            const firstError = errorMessages[0] || '';
            let autoRepairAvailable = false;
            let autoRepairProposal: any = undefined;

            // Expanded pattern library for parameter mismatch detection
            // Pattern 1a: "parameter X not implemented. Please pass/use Y parameter"
            // Pattern 1b: "X is not supported, use Y instead"
            // Pattern 1c: "parameter X not accepted, please provide Y"
            // Pattern 1d: "X: not implemented (use Y)"
            // Example: "file_url not implemented. Please pass file_content parameter directly"
            const paramMismatchPatterns = [
              /(\w+)\s+not implemented.*?(?:pass|use)\s+(\w+)\s+parameter/i,
              /(\w+)\s+is not supported.*?use\s+(\w+)\s+instead/i,
              /parameter\s+(\w+)\s+not accepted.*?provide\s+(\w+)/i,
              /(\w+):\s*not implemented\s*\(use\s+(\w+)\)/i,
              /(\w+)\s+parameter.*?not\s+(?:supported|implemented|available).*?(?:use|try|pass)\s+(\w+)/i,
            ];

            let paramMatch: RegExpMatchArray | null = null;
            for (const pattern of paramMismatchPatterns) {
              paramMatch = firstError.match(pattern);
              if (paramMatch) break;
            }

            // Pattern 2: "parameter_name is required" - indicates value resolved to null/empty
            // Example: "folder_name is required"
            const requiredParamPattern = /(\w+)\s+is\s+required/i;
            const requiredMatch = firstError.match(requiredParamPattern);

            if (paramMatch) {
              const wrongParam = paramMatch[1]; // e.g., "file_url"
              const correctParam = paramMatch[2]; // e.g., "file_content"

              // Find the scatter-gather step by its output_variable (stepId is the variable name, not step id)
              const scatterStep = (currentAgent.pilot_steps || currentAgent.workflow_steps || []).find((s: any) =>
                s.output_variable === stepId || s.id === stepId || s.step_id === stepId
              );

              logger.info({
                sessionId,
                loopIteration,
                stepId,
                foundScatterStep: !!scatterStep,
                scatterStepActualId: scatterStep?.id || scatterStep?.step_id,
                hasScatter: !!scatterStep?.scatter,
                hasSteps: !!scatterStep?.scatter?.steps,
                nestedStepCount: scatterStep?.scatter?.steps?.length || 0
              }, 'Searching for scatter-gather step with parameter mismatch');

              if (scatterStep?.scatter?.steps) {
                for (const nestedStep of scatterStep.scatter.steps) {
                  logger.debug({
                    nestedStepId: nestedStep.id || nestedStep.step_id,
                    hasConfig: !!nestedStep.config,
                    configKeys: nestedStep.config ? Object.keys(nestedStep.config) : [],
                    searchingFor: wrongParam
                  }, 'Checking nested step for parameter mismatch');

                  if (nestedStep.config && wrongParam in nestedStep.config) {
                    const nestedStepId = nestedStep.id || nestedStep.step_id;
                    autoRepairAvailable = true;
                    autoRepairProposal = {
                      type: 'parameter_rename',
                      stepId: nestedStepId,
                      confidence: 0.95,
                      changes: [{
                        stepId: nestedStepId,
                        path: `config.${wrongParam}`,
                        oldValue: nestedStep.config[wrongParam],
                        newValue: nestedStep.config[wrongParam],
                        newKey: correctParam,
                        action: 'rename_key',
                        reasoning: `Error indicates "${wrongParam}" parameter is not implemented. Plugin requires "${correctParam}" parameter instead.`
                      }]
                    };

                    logger.info({
                      sessionId,
                      loopIteration,
                      stepId: nestedStepId,
                      wrongParam,
                      correctParam
                    }, 'Detected auto-fixable parameter mismatch in scatter-gather nested step');
                    break;
                  }
                }
              }
            }
            // Pattern 2 Handler: Required parameter missing (value resolved to null/empty)
            else if (requiredMatch && !autoRepairAvailable) {
              const requiredParam = requiredMatch[1]; // e.g., "folder_name"

              // Find the scatter-gather step by its output_variable (stepId is the variable name, not step id)
              const scatterStep = (currentAgent.pilot_steps || currentAgent.workflow_steps || []).find((s: any) =>
                s.output_variable === stepId || s.id === stepId || s.step_id === stepId
              );

              logger.info({
                sessionId,
                loopIteration,
                stepId,
                requiredParam,
                foundScatterStep: !!scatterStep,
                scatterStepActualId: scatterStep?.id || scatterStep?.step_id
              }, 'Searching for scatter-gather step with missing required parameter value');

              if (scatterStep?.scatter?.steps) {
                for (const nestedStep of scatterStep.scatter.steps) {
                  if (nestedStep.config && requiredParam in nestedStep.config) {
                    const paramValue = nestedStep.config[requiredParam];

                    // Check if it's a variable reference that might resolve to null/empty
                    if (typeof paramValue === 'string' && paramValue.includes('{{')) {
                      const nestedStepId = nestedStep.id || nestedStep.step_id;

                      // Extract the field name from the variable reference
                      // E.g., "{{extracted_fields.vendor}}" -> "vendor"
                      const varMatch = paramValue.match(/\{\{[^.]+\.([^}]+)\}\}/);
                      const fieldName = varMatch ? varMatch[1] : 'value';

                      // Smart fallback: suggest context-appropriate default based on field name
                      // "vendor" -> "Unknown Vendor", "category" -> "Unknown Category", etc.
                      const suggestedFallback = `Unknown ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}`;

                      logger.info({
                        sessionId,
                        loopIteration,
                        stepId: nestedStepId,
                        requiredParam,
                        currentValue: paramValue,
                        fieldName,
                        suggestedFallback
                      }, 'Detected required parameter with variable that resolved to null/empty - generating smart fallback');

                      // Now this CAN be auto-fixable by updating the upstream extraction step
                      // to include a fallback value in its instruction
                      autoRepairAvailable = true;
                      autoRepairProposal = {
                        type: 'add_extraction_fallback',
                        stepId: nestedStepId,
                        targetField: fieldName,
                        fallbackValue: suggestedFallback,
                        confidence: 0.85,
                        changes: [{
                          action: 'update_extraction_instruction',
                          field: fieldName,
                          fallback: suggestedFallback,
                          reasoning: `When extracting "${fieldName}" field, use "${suggestedFallback}" if the value is not found in the document. This prevents downstream errors when the field is required.`
                        }]
                      };
                      break;
                    }
                  }
                }
              }
            }

            scatterGatherErrorIssues.push({
              id: `scatter_error_${loopIteration}_${stepId}`,
              category: autoRepairAvailable ? 'parameter_error' : 'execution_error',
              severity: 'critical',
              title: autoRepairAvailable ? `Parameter Name Mismatch in Scatter-Gather` : `Scatter-Gather Loop Failures`,
              message: autoRepairAvailable
                ? `${errorItems.length} out of ${totalItems} items failed due to incorrect parameter name. Error: ${errorMessages[0]}`
                : `${errorItems.length} out of ${totalItems} items failed in scatter-gather loop. First error: ${errorMessages[0]}`,
              technicalDetails: `Scatter-gather step "${stepId}" completed but ${errorItems.length}/${totalItems} items have error objects. Sample errors: ${JSON.stringify(errorMessages)}`,
              autoRepairAvailable,
              autoRepairProposal,
              requiresUserInput: !autoRepairAvailable,
              estimatedImpact: 'high',
              affectedSteps: [{
                stepId,
                stepName: stepId,
                friendlyName: stepId
              }],
              suggestedFix: autoRepairAvailable ? autoRepairProposal : {
                type: 'scatter_gather_failure',
                description: `Investigate why scatter-gather items are failing. Check: 1) Field references in nested steps, 2) Missing data in loop items, 3) Plugin authentication/permissions`,
                evidence: {
                  failedItemCount: errorItems.length,
                  totalItemCount: totalItems,
                  sampleErrors: errorMessages,
                  failureRate: `${Math.round((errorItems.length / totalItems) * 100)}%`
                }
              } as any
            });
          }
        }
      }

      // Fetch execution trace for SmartLogicAnalyzer (it needs trace metadata, not outputs)
      const { data: executionRecord } = await supabase
        .from('workflow_executions')
        .select('execution_trace')
        .eq('id', result.executionId)
        .single();

      const executionTrace = executionRecord?.execution_trace || {};

      const logicAnalyzer = new SmartLogicAnalyzer();
      const logicIssues = logicAnalyzer.analyze(
        currentAgent.pilot_steps || currentAgent.workflow_steps || [],
        executionTrace
      );

      // Convert logic issues to CollectedIssue format
      for (const logicIssue of logicIssues) {
        let mappedSeverity: 'critical' | 'high' | 'medium' | 'low';
        if (logicIssue.severity === 'critical') {
          mappedSeverity = 'critical';
        } else if (logicIssue.severity === 'warning') {
          mappedSeverity = 'medium';
        } else {
          mappedSeverity = 'low';
        }

        iterationIssues.push({
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
          autoRepairAvailable: false,
          requiresUserInput: true,
          estimatedImpact: logicIssue.severity === 'critical' ? 'high' : logicIssue.severity === 'warning' ? 'medium' : 'low',
          suggestedFix: {
            type: logicIssue.type,
            description: logicIssue.description,
            userOptions: logicIssue.userOptions,
            evidence: logicIssue.evidence,
            impact: logicIssue.impact
          } as any
        });
      }

      // Add scatter-gather error issues from step output scanning
      iterationIssues.push(...scatterGatherErrorIssues);

      // CRITICAL: Enhance already-collected issues with auto-repair proposals for parameter mismatches
      // When scatter-gather throws in batch calibration mode, the error is in collectedIssues but without auto-repair
      for (const issue of iterationIssues) {
        // Skip if already has auto-repair
        if (issue.autoRepairAvailable && issue.autoRepairProposal) {
          continue;
        }

        const errorMessage = issue.message || issue.technicalDetails || '';

        // Expanded pattern library for parameter mismatch detection
        // Pattern 1a: "parameter X not implemented. Please pass/use Y parameter"
        // Pattern 1b: "X is not supported, use Y instead"
        // Pattern 1c: "parameter X not accepted, please provide Y"
        // Pattern 1d: "X: not implemented (use Y)"
        const paramMismatchPatterns = [
          /(\w+)\s+not implemented.*?(?:pass|use)\s+(\w+)\s+parameter/i,
          /(\w+)\s+is not supported.*?use\s+(\w+)\s+instead/i,
          /parameter\s+(\w+)\s+not accepted.*?provide\s+(\w+)/i,
          /(\w+):\s*not implemented\s*\(use\s+(\w+)\)/i,
          /(\w+)\s+parameter.*?not\s+(?:supported|implemented|available).*?(?:use|try|pass)\s+(\w+)/i,
        ];

        let paramMatch: RegExpMatchArray | null = null;
        for (const pattern of paramMismatchPatterns) {
          paramMatch = errorMessage.match(pattern);
          if (paramMatch) break;
        }

        if (paramMatch) {
          const wrongParam = paramMatch[1]; // e.g., "file_url"
          const correctParam = paramMatch[2]; // e.g., "file_content"
          const stepId = issue.affectedSteps?.[0]?.stepId;

          if (!stepId) continue;

          // The stepId is the SCATTER-GATHER step itself (not a nested step)
          // Find it directly in the workflow
          const scatterStep = (currentAgent.pilot_steps || currentAgent.workflow_steps || []).find((s: any) =>
            (s.id === stepId || s.step_id === stepId) && s.scatter?.steps
          );

          logger.info({
            sessionId,
            loopIteration,
            issueId: issue.id,
            stepId,
            foundScatterStep: !!scatterStep,
            hasScatterSteps: !!scatterStep?.scatter?.steps,
            nestedStepCount: scatterStep?.scatter?.steps?.length || 0,
            wrongParam,
            correctParam
          }, 'Enhancing collected issue with parameter_rename auto-repair');

          if (scatterStep?.scatter?.steps) {
            for (const nestedStep of scatterStep.scatter.steps) {
              const nestedStepId = nestedStep.id || nestedStep.step_id;

              logger.debug({
                nestedStepId,
                hasConfig: !!nestedStep.config,
                configKeys: nestedStep.config ? Object.keys(nestedStep.config) : [],
                hasWrongParam: nestedStep.config && wrongParam in nestedStep.config
              }, 'Checking nested step for parameter');

              if (nestedStep.config && wrongParam in nestedStep.config) {
                // Add auto-repair proposal
                issue.autoRepairAvailable = true;
                issue.category = 'parameter_error';
                issue.autoRepairProposal = {
                  type: 'parameter_rename',
                  stepId: nestedStepId,
                  confidence: 0.95,
                  changes: [{
                    stepId: nestedStepId,
                    path: `config.${wrongParam}`,
                    oldValue: nestedStep.config[wrongParam],
                    newValue: nestedStep.config[wrongParam],
                    newKey: correctParam,
                    action: 'rename_key',
                    reasoning: `Error indicates "${wrongParam}" parameter is not implemented. Plugin requires "${correctParam}" parameter instead.`
                  }]
                };
                issue.suggestedFix = issue.autoRepairProposal;
                issue.requiresUserInput = false;

                logger.info({
                  sessionId,
                  loopIteration,
                  issueId: issue.id,
                  stepId: nestedStepId,
                  wrongParam,
                  correctParam
                }, 'Successfully added parameter_rename auto-repair to collected issue');
                break;
              }
            }
          }
        }

        // Pattern 2: "parameter_name is required" - add extraction fallback
        const requiredParamPattern = /(\w+)\s+is\s+required/i;
        const requiredMatch = errorMessage.match(requiredParamPattern);

        if (requiredMatch && !issue.autoRepairAvailable) {
          const requiredParam = requiredMatch[1];
          const stepId = issue.affectedSteps?.[0]?.stepId;

          logger.info({
            sessionId,
            loopIteration,
            issueId: issue.id,
            issueMessage: issue.message,
            requiredParam,
            affectedSteps: issue.affectedSteps,
            stepId,
            hasStepId: !!stepId
          }, 'Pattern 2 matched: checking for stepId');

          if (!stepId) {
            logger.warn({
              sessionId,
              loopIteration,
              issueId: issue.id,
              issueMessage: issue.message
            }, 'Pattern 2: No stepId found in affectedSteps, skipping enhancement');
            continue;
          }

          // The stepId is the SCATTER-GATHER step itself (not a nested step)
          const scatterStep = (currentAgent.pilot_steps || currentAgent.workflow_steps || []).find((s: any) =>
            (s.id === stepId || s.step_id === stepId) && s.scatter?.steps
          );

          logger.info({
            sessionId,
            loopIteration,
            issueId: issue.id,
            stepId,
            requiredParam,
            foundScatterStep: !!scatterStep,
            hasScatterSteps: !!scatterStep?.scatter?.steps,
            nestedStepIds: scatterStep?.scatter?.steps?.map((s: any) => s.id || s.step_id)
          }, 'Enhancing collected issue with add_extraction_fallback auto-repair');

          if (scatterStep?.scatter?.steps) {
            for (const nestedStep of scatterStep.scatter.steps) {
              const nestedStepId = nestedStep.id || nestedStep.step_id;
              logger.debug({
                sessionId,
                loopIteration,
                nestedStepId,
                hasConfig: !!nestedStep.config,
                configKeys: nestedStep.config ? Object.keys(nestedStep.config) : [],
                hasRequiredParam: nestedStep.config && requiredParam in nestedStep.config
              }, 'Checking nested step for required param');

              if (nestedStep.config && requiredParam in nestedStep.config) {
                const paramValue = nestedStep.config[requiredParam];

                logger.debug({
                  sessionId,
                  loopIteration,
                  nestedStepId,
                  paramValue,
                  isString: typeof paramValue === 'string',
                  includesBraces: typeof paramValue === 'string' && paramValue.includes('{{')
                }, 'Found nested step with required param, checking value');

                if (typeof paramValue === 'string' && paramValue.includes('{{')) {
                  const nestedStepId = nestedStep.id || nestedStep.step_id;
                  const varMatch = paramValue.match(/\{\{[^.]+\.([^}]+)\}\}/);
                  const fieldName = varMatch ? varMatch[1] : 'value';
                  const suggestedFallback = `Unknown ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}`;

                  issue.autoRepairAvailable = true;
                  issue.category = 'parameter_error';
                  issue.autoRepairProposal = {
                    type: 'add_extraction_fallback',
                    stepId: nestedStepId,
                    targetField: fieldName,
                    fallbackValue: suggestedFallback,
                    confidence: 0.85,
                    changes: [{
                      action: 'update_extraction_instruction',
                      field: fieldName,
                      fallback: suggestedFallback,
                      reasoning: `When extracting "${fieldName}" field, use "${suggestedFallback}" if the value is not found in the document. This prevents downstream errors when the field is required.`
                    }]
                  };
                  issue.suggestedFix = issue.autoRepairProposal;
                  issue.requiresUserInput = false;

                  logger.info({
                    sessionId,
                    loopIteration,
                    issueId: issue.id,
                    stepId: nestedStepId,
                    fieldName,
                    suggestedFallback
                  }, 'Successfully added add_extraction_fallback auto-repair to collected issue');
                  break;
                }
              }
            }
          }
        }

        // Pattern 3: Object-to-field extraction - "Resource not found" with JSON object in URL
        // This handles cases where a parameter expects a string ID but receives an entire object
        // Example: file_id receives {{drive_file}} instead of {{drive_file.file_id}}
        const objectToFieldPattern = /(?:resource|file|item|record).*?not found/i;
        const objectMatch = errorMessage.match(objectToFieldPattern);

        if (objectMatch && !issue.autoRepairAvailable) {
          const stepId = issue.affectedSteps?.[0]?.stepId;

          logger.info({
            sessionId,
            loopIteration,
            issueId: issue.id,
            issueMessage: issue.message,
            affectedSteps: issue.affectedSteps,
            stepId,
            hasStepId: !!stepId
          }, 'Pattern 3 matched (object-to-field): checking for stepId');

          if (!stepId) {
            logger.warn({
              sessionId,
              loopIteration,
              issueId: issue.id,
              issueMessage: issue.message
            }, 'Pattern 3: No stepId found in affectedSteps, skipping enhancement');
            continue;
          }

          // The stepId is the SCATTER-GATHER step itself (not a nested step)
          const scatterStep = (currentAgent.pilot_steps || currentAgent.workflow_steps || []).find((s: any) =>
            (s.id === stepId || s.step_id === stepId) && s.scatter?.steps
          );

          logger.info({
            sessionId,
            loopIteration,
            issueId: issue.id,
            stepId,
            foundScatterStep: !!scatterStep,
            hasScatterSteps: !!scatterStep?.scatter?.steps,
            nestedStepIds: scatterStep?.scatter?.steps?.map((s: any) => s.id || s.step_id)
          }, 'Enhancing collected issue with extract_object_field auto-repair');

          if (scatterStep?.scatter?.steps) {
            for (const nestedStep of scatterStep.scatter.steps) {
              const nestedStepId = nestedStep.id || nestedStep.step_id;
              const nestedConfig = nestedStep.config || nestedStep.params || {};

              logger.debug({
                sessionId,
                loopIteration,
                nestedStepId,
                hasConfig: !!nestedConfig,
                configKeys: Object.keys(nestedConfig)
              }, 'Checking nested step for object parameters');

              // Check each parameter for object references that should be field extractions
              for (const [paramName, paramValue] of Object.entries(nestedConfig)) {
                // Is it a variable reference?
                if (typeof paramValue === 'string' && paramValue.startsWith('{{') && paramValue.endsWith('}}')) {
                  const varName = paramValue.slice(2, -2).trim(); // Remove {{}}

                  // Check if it's a simple variable reference (no field accessor)
                  if (!varName.includes('.')) {
                    // Suggest extracting a field that matches the parameter name
                    // e.g., file_id parameter should use {{drive_file.file_id}}
                    const suggestedField = `${varName}.${paramName}`;

                    logger.info({
                      sessionId,
                      loopIteration,
                      nestedStepId,
                      paramName,
                      currentValue: paramValue,
                      varName,
                      suggestedField
                    }, 'Detected parameter with object reference - should extract field');

                    issue.autoRepairAvailable = true;
                    issue.category = 'parameter_error';
                    issue.autoRepairProposal = {
                      type: 'extract_object_field',
                      stepId: nestedStepId,
                      confidence: 0.90,
                      changes: [{
                        stepId: nestedStepId,
                        path: `config.${paramName}`,
                        oldValue: paramValue,
                        newValue: `{{${suggestedField}}}`,
                        action: 'add_field_accessor',
                        reasoning: `Parameter "${paramName}" expects a string value but receives an object reference "{{${varName}}}". Extracting field "${suggestedField}" to get the ${paramName} value from the object.`
                      }]
                    };
                    issue.suggestedFix = issue.autoRepairProposal;
                    issue.requiresUserInput = false;

                    logger.info({
                      sessionId,
                      loopIteration,
                      issueId: issue.id,
                      stepId: nestedStepId,
                      paramName,
                      suggestedField
                    }, 'Successfully added extract_object_field auto-repair to collected issue');
                    break;
                  }
                }
              }

              if (issue.autoRepairAvailable) {
                break;
              }
            }
          }
        }

        // Pattern 4: Detect when a required parameter is missing but an alternative format exists
        // For example: append_rows needs "values" (2D array) but has "fields" (object mapping)
        if (!issue.autoRepairAvailable && issue.message?.includes('missing required parameters')) {
          const stepId = issue.affectedSteps?.[0]?.stepId;

          if (stepId) {
            const targetStep = findStepByIdRecursive(currentAgent.pilot_steps || currentAgent.workflow_steps || [], stepId);

            if (targetStep && targetStep.plugin && targetStep.action) {
              const stepConfig = targetStep.config || targetStep.params || {};
              const providedParams = Object.keys(stepConfig);

              // Get plugin definition to understand expected parameters
              const pluginDef = pluginManager.getPluginDefinition(targetStep.plugin);
              const actionDef = (pluginDef?.actions as any[] | undefined)?.find((a: any) => a.name === targetStep.action);

              if (actionDef && Array.isArray(actionDef.parameters)) {
                // Find which required parameters are missing
                const requiredParams = actionDef.parameters.filter((p: any) => p.required);
                const missingParams = requiredParams.filter((p: any) =>
                  !providedParams.includes(p.name)
                );

                // Check if any missing parameter expects an array and we have a fields/mapping object
                const arrayParamMissing = missingParams.find((p: any) =>
                  p.type === 'array' &&
                  (p.items?.type === 'array' || p.description?.toLowerCase().includes('2d array'))
                );

                const hasFieldsMapping = providedParams.includes('fields') &&
                  stepConfig.fields &&
                  typeof stepConfig.fields === 'object';

                if (arrayParamMissing && hasFieldsMapping) {
                  const fieldsMapping = stepConfig.fields;
                  const fieldNames = Object.keys(fieldsMapping);
                  const fieldValues = Object.values(fieldsMapping) as string[];

                  // Determine input variable from field value references
                  let inputVariable = targetStep.input || 'input_data';
                  const arrayVarMatch = fieldValues[0]?.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\./);
                  if (arrayVarMatch) {
                    inputVariable = arrayVarMatch[1];
                  }

                  issue.autoRepairAvailable = true;
                  issue.autoRepairProposal = {
                    type: 'transform_fields_to_values',
                    confidence: 0.92,
                    changes: [{
                      stepId,
                      path: `params.${arrayParamMissing.name}`,
                      action: 'transform_to_array',
                      inputVariable,
                      missingParam: arrayParamMissing.name,
                      providedParam: 'fields',
                      reasoning: `Step requires "${arrayParamMissing.name}" parameter (${arrayParamMissing.type}) but has "fields" object mapping. Will insert transform step to convert fields to required array format.`
                    }]
                  };

                  logger.info({
                    sessionId,
                    loopIteration,
                    issueId: issue.id,
                    stepId,
                    plugin: targetStep.plugin,
                    action: targetStep.action,
                    missingParam: arrayParamMissing.name,
                    providedParam: 'fields',
                    fieldCount: fieldNames.length,
                    confidence: 0.92
                  }, 'Pattern 4 matched: fields-to-array transformation needed');
                } else {
                  // Other missing parameter scenarios - just log
                  logger.info({
                    sessionId,
                    loopIteration,
                    issueId: issue.id,
                    stepId,
                    stepPlugin: targetStep.plugin,
                    stepAction: targetStep.action,
                    providedParams,
                    missingParams: missingParams.map((p: any) => p.name),
                    message: 'Missing required parameter - no auto-fix pattern matched'
                  }, 'Missing required parameter detected');
                }
              }
            }
          }
        }
      }

      // Pattern 5: Detect missing dependencies when a step uses variables from another step
      // This prevents steps from executing before their data dependencies are ready
      logger.info({
        sessionId,
        loopIteration,
        hasSteps: !!(currentAgent.pilot_steps || currentAgent.workflow_steps),
        stepCount: (currentAgent.pilot_steps || currentAgent.workflow_steps || []).length
      }, 'Pattern 5: Starting dependency analysis');

      if (currentAgent.pilot_steps || currentAgent.workflow_steps) {
        const allSteps = currentAgent.pilot_steps || currentAgent.workflow_steps || [];
        const variableProducers = new Map<string, string>(); // varName -> stepId

        // First pass: build map of which steps produce which variables
        for (const step of allSteps) {
          const stepId = step.id || step.step_id;
          const outputVar = step.output_variable || step.config?.output_variable || step.params?.output_variable;

          if (outputVar && stepId) {
            variableProducers.set(outputVar, stepId);
            logger.debug({
              sessionId,
              loopIteration,
              stepId,
              outputVar
            }, 'Pattern 5: Registered variable producer');
          }
        }

        // Second pass: check each step's dependencies match its variable usage
        for (const step of allSteps) {
          const stepId = step.id || step.step_id;
          const currentDeps = step.dependencies || step.depends_on || [];
          const stepConfig = step.config || step.params || {};
          const stepCondition = step.condition;

          const usedVariables = new Set<string>();

          // Extract variables from config parameters
          const extractVarsFromValue = (value: any) => {
            if (typeof value === 'string') {
              const matches = value.matchAll(/\{\{([^}]+)\}\}/g);
              for (const match of matches) {
                const varPath = match[1].trim();
                // Get the root variable name (before any dots)
                const rootVar = varPath.split('.')[0];
                usedVariables.add(rootVar);
              }
            } else if (typeof value === 'object' && value !== null) {
              for (const v of Object.values(value)) {
                extractVarsFromValue(v);
              }
            }
          };

          extractVarsFromValue(stepConfig);
          if (stepCondition) {
            extractVarsFromValue(JSON.stringify(stepCondition));

            // Also extract from condition.field for simple conditions
            if (stepCondition.field && typeof stepCondition.field === 'string') {
              const fieldName = stepCondition.field.split('.')[0];
              usedVariables.add(fieldName);
            }

            // Extract from complex conditions
            if (stepCondition.conditions && Array.isArray(stepCondition.conditions)) {
              for (const cond of stepCondition.conditions) {
                if (cond.field && typeof cond.field === 'string') {
                  const fieldName = cond.field.split('.')[0];
                  // Skip 'item' or 'input' as they're not step outputs
                  if (fieldName !== 'item' && fieldName !== 'input') {
                    usedVariables.add(fieldName);
                  }
                }
              }
            }
          }

          // Debug logging for step12
          if (stepId === 'step12') {
            logger.info({
              sessionId,
              loopIteration,
              stepId,
              hasCondition: !!stepCondition,
              conditionStr: stepCondition ? JSON.stringify(stepCondition) : null,
              usedVariables: Array.from(usedVariables),
              currentDeps
            }, 'Pattern 5: Analyzing step12');
          }

          // Find missing dependencies
          const missingDeps: string[] = [];
          for (const usedVar of usedVariables) {
            const producerStepId = variableProducers.get(usedVar);
            if (producerStepId && producerStepId !== stepId && !currentDeps.includes(producerStepId)) {
              missingDeps.push(producerStepId);

              logger.info({
                sessionId,
                loopIteration,
                stepId,
                usedVar,
                producerStepId,
                currentDeps,
                message: 'Detected missing dependency'
              }, 'Pattern 5: Step uses variable from another step but lacks dependency');
            }
          }

          // If missing dependencies found, create an auto-repair
          if (missingDeps.length > 0) {
            const newIssue: any = {
              id: `missing-dep-${stepId}-${Date.now()}`,
              severity: 'high',
              category: 'dependency_error',
              message: `Step ${stepId} uses variables from ${missingDeps.join(', ')} but doesn't depend on them`,
              affectedSteps: [{ stepId, stepType: step.type }],
              autoRepairAvailable: true,
              requiresUserInput: false,
              autoRepairProposal: {
                type: 'add_missing_dependencies',
                stepId,
                confidence: 0.95,
                changes: [{
                  stepId,
                  path: 'dependencies',
                  oldValue: currentDeps,
                  newValue: [...currentDeps, ...missingDeps],
                  action: 'add_dependencies',
                  reasoning: `Step ${stepId} references variables produced by ${missingDeps.join(', ')} and must wait for them to complete. Adding dependencies ensures correct execution order.`
                }]
              }
            };

            newIssue.suggestedFix = newIssue.autoRepairProposal;
            iterationIssues.push(newIssue);

            logger.info({
              sessionId,
              loopIteration,
              issueId: newIssue.id,
              stepId,
              missingDeps,
              confidence: 0.95
            }, 'Pattern 5: Added add_missing_dependencies auto-repair');
          }
        }
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Pattern 6: Detect conditional field references to output_variables
      // ─────────────────────────────────────────────────────────────────────────
      // Issue: When a conditional step references a field that matches an output_variable name,
      // the field won't resolve at runtime because output_variables are in context.variables,
      // not in the item object. The conditional evaluator will fall back to item variable scoping
      // and create wrong references like {{matching_emails.high_value_items}}.
      //
      // Solution: Detect when condition.field is a simple name (no dots, doesn't start with "step"/"input")
      // that matches an output_variable from a previous step. Rewrite to use step ID path.
      //
      // Example:
      //   Before: { field: "high_value_items", operator: "gt", value: 0 }
      //   After:  { field: "step11.data", operator: "gt", value: 0 }
      //
      // This ensures the conditional evaluator resolves the correct variable at runtime.
      const allSteps = currentAgent.pilot_steps || currentAgent.workflow_steps || [];
      logger.info({ sessionId, loopIteration, stepCount: allSteps.length }, 'Pattern 6: Starting conditional field reference detection');

      for (const step of allSteps) {
        const stepId = step.step_id || step.id;

        // Only apply to conditional steps
        if (step.type !== 'conditional') continue;

        logger.debug({ sessionId, stepId, hasCondition: !!step.condition }, 'Pattern 6: Found conditional step');

        const stepCondition = step.condition;
        if (!stepCondition || !stepCondition.field || typeof stepCondition.field !== 'string') {
          logger.debug({ sessionId, stepId, hasCondition: !!stepCondition, hasField: !!stepCondition?.field }, 'Pattern 6: Skipping - no valid condition.field');
          continue;
        }

        const fieldRef = stepCondition.field;
        logger.debug({ sessionId, stepId, fieldRef }, 'Pattern 6: Analyzing conditional field');

        // Check if field is a simple variable name (no dots, doesn't start with "step"/"input")
        // Examples to match: "high_value_items", "filtered_results"
        // Examples to skip: "step11.data", "input.user_id", "item.amount"
        const isSimpleVariableName =
          !fieldRef.includes('.') &&
          !fieldRef.startsWith('step') &&
          !fieldRef.startsWith('input') &&
          !fieldRef.startsWith('var') &&
          !fieldRef.startsWith('item');

        if (!isSimpleVariableName) continue;

        // Find if this field name matches an output_variable from a previous step
        let producerStepId: string | null = null;
        let producerStepIndex = -1;

        const currentStepIndex = allSteps.findIndex((s: any) => (s.step_id || s.id) === stepId);

        for (let i = 0; i < currentStepIndex; i++) {
          const prevStep = allSteps[i];
          if (prevStep.output_variable === fieldRef) {
            producerStepId = prevStep.step_id || prevStep.id;
            producerStepIndex = i;
            break;
          }
        }

        // If we found a producer step, create auto-fix to rewrite field reference
        if (producerStepId) {
          // NOTE: a dedicated `CalibrationIssue` type was never defined in the
          // codebase; this richer issue shape (sessionId/issueType/impact/…) is
          // pushed to the loosely-typed `iterationIssues` collection. Typed as
          // `any` deliberately — the consumers below read only id /
          // autoRepairAvailable / autoRepairProposal / requiresUserInput.
          const newIssue: any = {
            id: crypto.randomUUID(),
            sessionId,
            agentId,
            category: 'data_transformation',
            severity: 'high',
            issueType: 'conditional_field_references_output_variable',
            stepId,
            stepName: step.name || step.description || stepId,
            stepType: step.type,
            description: `Conditional field "${fieldRef}" references an output_variable from step "${producerStepId}". This won't resolve at runtime because output_variables are stored in context.variables, not in the item object. The conditional evaluator will fall back to item variable scoping and create wrong references.`,
            impact: 'The conditional will fail to evaluate correctly, potentially causing then/else branches to execute incorrectly or not at all.',
            suggestedFix: `Rewrite field reference from "${fieldRef}" to "${producerStepId}.data" to use the step ID path. This ensures the conditional evaluator resolves the correct variable from step outputs.`,
            autoRepairAvailable: true,
            requiresUserInput: false,
            affectedFields: ['condition.field'],
            createdAt: new Date().toISOString(),
            autoRepairProposal: {
              type: 'rewrite_conditional_field_reference',
              description: `Rewrite conditional field "${fieldRef}" to use step ID path "${producerStepId}.data"`,
              changes: [
                {
                  stepId,
                  field: 'condition.field',
                  oldValue: fieldRef,
                  newValue: `${producerStepId}.data`,
                  reasoning: `Field "${fieldRef}" matches output_variable from step "${producerStepId}". Rewriting to step ID path ensures runtime resolution works correctly.`
                }
              ],
              confidence: 0.95,
              requiresValidation: false
            }
          };

          iterationIssues.push(newIssue);

          logger.info({
            sessionId,
            loopIteration,
            issueId: newIssue.id,
            stepId,
            fieldRef,
            producerStepId,
            confidence: 0.95
          }, 'Pattern 6: Added rewrite_conditional_field_reference auto-repair');
        }
      }

      // Separate auto-fixable from requires-user-input
      const autoFixableIssues = iterationIssues.filter(issue =>
        issue.autoRepairAvailable &&
        issue.autoRepairProposal &&
        issue.autoRepairProposal.confidence >= 0.80 && // Lowered from 0.85 to include more valid fixes
        !issue.requiresUserInput
      );

      const requiresUserInputIssues = iterationIssues.filter(issue =>
        issue.requiresUserInput ||
        !issue.autoRepairAvailable ||
        (issue.autoRepairProposal && issue.autoRepairProposal.confidence < 0.80)
      );

      logger.info({
        sessionId,
        loopIteration,
        totalIssues: iterationIssues.length,
        autoFixable: autoFixableIssues.length,
        requiresUserInput: requiresUserInputIssues.length,
        autoFixableProposalTypes: autoFixableIssues.map(i => i.autoRepairProposal?.type)
      }, 'Issue classification complete');

      // UPDATE CHECKPOINT: Now that we have issue count, update the checkpoint
      if (checkpoints.length > 0) {
        const currentCheckpoint = checkpoints[checkpoints.length - 1];
        if (currentCheckpoint.iteration === loopIteration) {
          currentCheckpoint.issueCount = iterationIssues.length;
          logger.debug({
            sessionId,
            loopIteration,
            issueCount: iterationIssues.length
          }, 'Updated checkpoint with issue count');
        }
      }

      // If no issues at all, workflow is perfect!
      if (iterationIssues.length === 0) {
        logger.info({ sessionId, loopIteration, autoFixesApplied },
          'Workflow executed successfully with no issues - calibration complete!');
        break;
      }

      // If no auto-fixable issues, do ONE MORE VALIDATION PASS before exiting
      if (autoFixableIssues.length === 0) {
        logger.info({ sessionId, loopIteration, autoFixesApplied, remainingIssues: requiresUserInputIssues.length },
          'No auto-fixable runtime issues - running final structural validation pass');

        // CRITICAL FIX: Run final validation to catch structural issues that might have been missed
        const finalFieldRefIssues = validator.validateFieldReferences(currentAgent.pilot_steps);
        const finalOperationFieldIssues = validator.validateOperationFields(currentAgent.pilot_steps);
        const finalFlattenFieldIssues = validator.validateFlattenFields(currentAgent.pilot_steps);

        const allFinalValidationIssues = [
          ...finalFieldRefIssues,
          ...finalOperationFieldIssues,
          ...finalFlattenFieldIssues
        ];

        logger.info({ sessionId, loopIteration, finalValidationIssueCount: allFinalValidationIssues.length },
          'Final validation pass complete');

        // If final validation found structural issues, convert them and continue the loop
        if (allFinalValidationIssues.length > 0) {
          finalValidationRunCount++;

          // CRITICAL FIX: Prevent infinite final validation loops
          if (finalValidationRunCount > MAX_FINAL_VALIDATION_RUNS) {
            logger.warn({
              sessionId,
              loopIteration,
              finalValidationRuns: finalValidationRunCount,
              issuesFound: allFinalValidationIssues.length
            }, 'Final validation limit reached - exiting loop to prevent infinite re-validation');

            // Add remaining issues to UI for user review
            allIssuesForUI.push(...requiresUserInputIssues);
            break;
          }

          logger.info({
            sessionId,
            loopIteration,
            fieldRefCount: finalFieldRefIssues.length,
            operationFieldCount: finalOperationFieldIssues.length,
            flattenFieldCount: finalFlattenFieldIssues.length,
            finalValidationRunCount
          }, 'Final validation found fixable structural issues - continuing calibration loop');

          // Convert validation issues to CollectedIssue format
          const finalStructuralIssues: CollectedIssue[] = [];

          // Convert field reference issues
          finalFieldRefIssues.forEach((issue, index) => {
            finalStructuralIssues.push({
              id: `final_field_ref_${loopIteration}_${index}`,
              category: 'parameter_error',
              severity: 'high',
              title: `Invalid Field Reference`,
              message: issue.reason,
              technicalDetails: `Field reference ${issue.invalidReference} in step ${issue.stepId} parameter ${issue.parameter} is invalid. Suggested: ${issue.suggestedFix}`,
              affectedSteps: [{
                stepId: issue.stepId,
                stepName: issue.stepId,
                friendlyName: issue.stepId
              }],
              autoRepairAvailable: true,
              autoRepairProposal: {
                type: 'fix_parameter_reference',
                confidence: issue.confidence,
                changes: [{
                  stepId: issue.stepId,
                  parameter: issue.parameter,
                  from: issue.invalidReference,
                  to: issue.suggestedFix
                }]
              },
              requiresUserInput: false,
              estimatedImpact: 'high'
            });
          });

          // Convert operation field issues
          finalOperationFieldIssues.forEach((issue, index) => {
            finalStructuralIssues.push({
              id: `final_op_field_${loopIteration}_${index}`,
              category: 'configuration_missing',
              severity: 'high',
              title: `Invalid Operation Field`,
              message: issue.reason,
              technicalDetails: `Field ${issue.invalidField} in step ${issue.stepId} ${issue.context} operation is invalid. Suggested: ${issue.suggestedField}`,
              affectedSteps: [{
                stepId: issue.stepId,
                stepName: issue.stepId,
                friendlyName: issue.stepId
              }],
              autoRepairAvailable: true,
              autoRepairProposal: {
                type: issue.context === 'flatten' ? 'fix_flatten_field' : 'fix_operation_field',
                confidence: issue.confidence,
                changes: [{
                  stepId: issue.stepId,
                  field: issue.invalidField,
                  suggestedField: issue.suggestedField,
                  context: issue.context
                }]
              },
              requiresUserInput: false,
              estimatedImpact: 'high'
            });
          });

          // Convert flatten field issues
          finalFlattenFieldIssues.forEach((issue, index) => {
            finalStructuralIssues.push({
              id: `final_flatten_${loopIteration}_${index}`,
              category: 'configuration_missing',
              severity: 'high',
              title: `Invalid Flatten Field`,
              message: issue.reason,
              technicalDetails: `Flatten field ${issue.currentField} in step ${issue.stepId} is invalid. Suggested: ${issue.suggestedField}`,
              affectedSteps: [{
                stepId: issue.stepId,
                stepName: issue.stepId,
                friendlyName: issue.stepId
              }],
              autoRepairAvailable: true,
              autoRepairProposal: {
                type: 'fix_flatten_field',
                confidence: issue.confidence,
                changes: [{
                  stepId: issue.stepId,
                  from: issue.currentField,
                  to: issue.suggestedField
                }]
              },
              requiresUserInput: false,
              estimatedImpact: 'high'
            });
          });

          // Track these issues for UI display
          allIssuesForUI.push(...finalStructuralIssues);

          // Apply fixes immediately
          let updatedSteps = [...(currentAgent.pilot_steps || [])];
          let finalFixesApplied = 0;

          for (const issue of finalStructuralIssues) {
            if (issue.autoRepairProposal && issue.autoRepairProposal.confidence >= 0.70) {
              const proposal = issue.autoRepairProposal;
              const change = proposal.changes[0];
              const targetStep = findStepByIdRecursive(updatedSteps, change.stepId);

              if (targetStep) {
                if (proposal.type === 'fix_parameter_reference') {
                  // Replace field reference in config
                  const replaceInValue = (obj: any): any => {
                    if (typeof obj === 'string') {
                      return obj.replace(new RegExp(change.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), change.to);
                    } else if (Array.isArray(obj)) {
                      return obj.map(replaceInValue);
                    } else if (typeof obj === 'object' && obj !== null) {
                      const result: any = {};
                      for (const [k, v] of Object.entries(obj)) {
                        result[k] = replaceInValue(v);
                      }
                      return result;
                    }
                    return obj;
                  };

                  targetStep.config = replaceInValue(targetStep.config || {});
                  if (targetStep.params) {
                    targetStep.params = replaceInValue(targetStep.params);
                  }
                  finalFixesApplied++;
                  logger.info({ issueId: issue.id, stepId: change.stepId, from: change.from, to: change.to },
                    'Applied final validation fix: parameter reference');
                } else if (proposal.type === 'fix_flatten_field') {
                  // Fix flatten field: add or update the 'field' parameter
                  if (targetStep.config) {
                    targetStep.config.field = change.to;
                    finalFixesApplied++;
                    logger.info({
                      issueId: issue.id,
                      stepId: change.stepId,
                      from: change.from,
                      to: change.to
                    }, 'Applied final validation fix: flatten field');
                  }
                } else if (proposal.type === 'fix_operation_field') {
                  // Fix operation field: replace "item.X" with "X" in condition field references
                  const oldField = change.field;  // e.g., "item.amount"
                  const newField = change.suggestedField;  // e.g., "amount"

                  const replaceFieldInCondition = (condition: any): any => {
                    if (!condition) return condition;

                    if (condition.field === oldField) {
                      condition.field = newField;
                    }

                    // Handle complex conditions with nested conditions array
                    if (condition.conditions && Array.isArray(condition.conditions)) {
                      condition.conditions = condition.conditions.map(replaceFieldInCondition);
                    }

                    return condition;
                  };

                  if (targetStep.config && targetStep.config.condition) {
                    targetStep.config.condition = replaceFieldInCondition(targetStep.config.condition);
                    finalFixesApplied++;
                    logger.info({
                      issueId: issue.id,
                      stepId: change.stepId,
                      from: oldField,
                      to: newField,
                      context: change.context
                    }, 'Applied final validation fix: operation field');
                  }
                } else if (proposal.type === 'parameter_rename' && change.action === 'rename_key') {
                  // Rename parameter key in config
                  if (targetStep.config && change.path) {
                    const pathParts = change.path.split('.');
                    if (pathParts[0] === 'config' && pathParts.length === 2) {
                      const oldKey = pathParts[1];
                      const newKey = change.newKey;
                      if (oldKey in targetStep.config && newKey) {
                        // Rename the key: copy value to new key and delete old key
                        targetStep.config[newKey] = targetStep.config[oldKey];
                        delete targetStep.config[oldKey];
                        finalFixesApplied++;
                        logger.info({
                          issueId: issue.id,
                          stepId: change.stepId,
                          oldKey,
                          newKey,
                          value: targetStep.config[newKey]
                        }, 'Applied final validation fix: parameter rename');
                      }
                    }
                  }
                }
              }
            }
          }

          if (finalFixesApplied > 0) {
            // Update agent in database
            await supabase
              .from('agents')
              .update({
                pilot_steps: updatedSteps,
                updated_at: new Date().toISOString()
              })
              .eq('id', agentId);

            currentAgent.pilot_steps = updatedSteps;
            autoFixesApplied += finalFixesApplied;

            logger.info({ sessionId, loopIteration, finalFixesApplied, totalAutoFixesApplied: autoFixesApplied },
              'Applied final validation fixes - skipping execution, will re-validate in next iteration');

            // Skip execution this round - fixes were applied, need to re-validate
            continue;
          }
        }

        // No more fixable issues found - safe to exit
        logger.warn({
          sessionId,
          loopIteration,
          autoFixesApplied,
          remainingIssues: requiresUserInputIssues.length,
          issueDetails: requiresUserInputIssues.map(i => ({ id: i.id, category: i.category, message: i.message }))
        }, 'Exiting calibration loop - no auto-fixable issues remaining');

        allIssuesForUI.push(...requiresUserInputIssues);
        break;
      }

      // PHASE 4: AUTO-APPLY all high-confidence fixes and RE-RUN
      logger.info({ sessionId, loopIteration, fixCount: autoFixableIssues.length },
        'Auto-applying runtime fixes');

      const currentSteps = currentAgent.pilot_steps || currentAgent.workflow_steps || [];
      let updatedSteps = [...currentSteps];
      let fixesAppliedThisRound = 0;
      let fixesSkippedThisRound = 0; // Track skipped fixes to detect endless loops

      for (const issue of autoFixableIssues) {
        const proposal = issue.autoRepairProposal!;
        const affectedStepId = issue.affectedSteps?.[0]?.stepId || proposal.targetStepId || proposal.stepId || 'unknown';

        try {
          if (proposal.action === 'add_flatten_field') {
            // ⚠️ CRITICAL: Only add field if it's TRULY MISSING
            // If field already exists (even if wrong), execution can correct it at runtime
            const targetStep = findStepByIdRecursive(updatedSteps, proposal.targetStepId);
            const suggestedField = (issue.suggestedFix?.action as any)?.field;
            const currentField = (targetStep as any)?.config?.field;

            if (targetStep && suggestedField) {
              // Only apply fix if field is missing (not if it's just wrong)
              if (!currentField) {
                // CONVERGENCE CHECK: Ensure we haven't applied this fix before
                const canApplyFix = trackFix(proposal.targetStepId, 'add_flatten_field');
                if (!canApplyFix) {
                  logger.warn({
                    issueId: issue.id,
                    stepId: proposal.targetStepId,
                    fixType: 'add_flatten_field'
                  }, 'CONVERGENCE FAILURE: Skipping fix that was already applied in previous iteration');
                  fixesSkippedThisRound++;
                  continue;
                }

                if (!(targetStep as any).config) {
                  (targetStep as any).config = {};
                }
                (targetStep as any).config.field = suggestedField;
                fixesAppliedThisRound++;
                logger.info({
                  issueId: issue.id,
                  stepId: proposal.targetStepId,
                  field: suggestedField
                }, 'Auto-fix applied: add_flatten_field (field was missing)');
              } else {
                // Field exists but might be wrong - execution will correct at runtime
                logger.info({
                  issueId: issue.id,
                  stepId: proposal.targetStepId,
                  currentField,
                  suggestedField,
                  reason: 'Field already exists - execution will handle corrections'
                }, 'SKIPPED: add_flatten_field (field exists, execution handles corrections)');
                fixesSkippedThisRound++;
              }
            }
          }
          else if (proposal.action === 'fix_field_name') {
            // ✅ EXECUTION NOW HANDLES THIS - Skip auto-fix
            logger.info({
              issueId: issue.id,
              from: (issue.suggestedFix?.action as any)?.from,
              to: (issue.suggestedFix?.action as any)?.to,
              reason: 'Execution uses schema-aware resolution for filter fields'
            }, 'SKIPPED: fix_field_name (execution handles this)');
            fixesSkippedThisRound++;
          }
          else if (proposal.action === 'fix_parameter_reference') {
            // CONVERGENCE CHECK
            const canApplyFix = trackFix(proposal.targetStepId, `fix_parameter_reference:${(issue.suggestedFix?.action as any)?.from}`);
            if (!canApplyFix) {
              logger.warn({
                issueId: issue.id,
                stepId: proposal.targetStepId,
                fixType: 'fix_parameter_reference',
                from: (issue.suggestedFix?.action as any)?.from
              }, 'CONVERGENCE FAILURE: Skipping parameter reference fix that was already applied');
              fixesSkippedThisRound++;
              continue;
            }

            const targetStep = findStepByIdRecursive(updatedSteps, proposal.targetStepId);
            const fromRef = (issue.suggestedFix?.action as any)?.from;
            const toRef = (issue.suggestedFix?.action as any)?.to;

            if (targetStep && fromRef && toRef) {
              const replaceInValue = (obj: any): any => {
                if (typeof obj === 'string') {
                  const escapedFrom = fromRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  return obj.replace(new RegExp(escapedFrom, 'g'), toRef);
                } else if (Array.isArray(obj)) {
                  return obj.map(replaceInValue);
                } else if (typeof obj === 'object' && obj !== null) {
                  const result: any = {};
                  for (const [key, value] of Object.entries(obj)) {
                    result[key] = replaceInValue(value);
                  }
                  return result;
                }
                return obj;
              };

              if ((targetStep as any).config) {
                (targetStep as any).config = replaceInValue((targetStep as any).config);
              }
              if ((targetStep as any).params) {
                (targetStep as any).params = replaceInValue((targetStep as any).params);
              }
              fixesAppliedThisRound++;
              logger.info({ issueId: issue.id, from: fromRef, to: toRef },
                'Auto-applied: fix_parameter_reference');
            }
          }
          // Handle parameter_rename fixes (scatter-gather errors)
          else if (proposal.type === 'parameter_rename') {
            const change = proposal.changes?.[0];
            if (change && change.action === 'rename_key') {
              logger.debug({
                issueId: issue.id,
                changeStepId: change.stepId,
                hasChange: !!change,
                hasStepId: !!change.stepId,
                action: change.action
              }, 'Attempting parameter_rename fix');

              const targetStep = findStepByIdRecursive(updatedSteps, change.stepId);

              logger.debug({
                issueId: issue.id,
                changeStepId: change.stepId,
                foundStep: !!targetStep,
                hasConfig: !!targetStep?.config,
                path: change.path
              }, 'Found target step for parameter_rename');

              if (targetStep && targetStep.config && change.path) {
                const pathParts = change.path.split('.');
                if (pathParts[0] === 'config' && pathParts.length === 2) {
                  const oldKey = pathParts[1];
                  const newKey = change.newKey;

                  logger.debug({
                    issueId: issue.id,
                    oldKey,
                    newKey,
                    hasOldKey: oldKey in targetStep.config,
                    configKeys: Object.keys(targetStep.config)
                  }, 'Checking if old key exists in config');

                  if (oldKey in targetStep.config && newKey) {
                    // CONVERGENCE CHECK
                    const canApplyFix = trackFix(change.stepId, `parameter_rename:${oldKey}→${newKey}`);
                    if (!canApplyFix) {
                      logger.warn({
                        issueId: issue.id,
                        stepId: change.stepId,
                        fixType: 'parameter_rename',
                        oldKey,
                        newKey
                      }, 'CONVERGENCE FAILURE: Skipping parameter rename that was already applied');
                      continue;
                    }

                    // Rename the key: copy value to new key and delete old key
                    targetStep.config[newKey] = targetStep.config[oldKey];
                    delete targetStep.config[oldKey];
                    fixesAppliedThisRound++;
                    logger.info({
                      issueId: issue.id,
                      stepId: change.stepId,
                      oldKey,
                      newKey,
                      value: targetStep.config[newKey]
                    }, 'Auto-applied: parameter_rename');
                  } else {
                    logger.warn({
                      issueId: issue.id,
                      stepId: change.stepId,
                      oldKey,
                      newKey,
                      hasOldKey: oldKey in targetStep.config,
                      configKeys: Object.keys(targetStep.config)
                    }, 'Could not apply parameter_rename: old key not found or new key missing');
                  }
                } else {
                  logger.warn({
                    issueId: issue.id,
                    path: change.path,
                    pathParts
                  }, 'Could not apply parameter_rename: invalid path format');
                }
              } else {
                logger.warn({
                  issueId: issue.id,
                  changeStepId: change.stepId,
                  foundStep: !!targetStep,
                  hasConfig: !!targetStep?.config
                }, 'Could not apply parameter_rename: step not found or missing config');
              }
            }
          }
          // Handle add_extraction_fallback fixes (null field values)
          else if (proposal.type === 'add_extraction_fallback') {
            const change = proposal.changes?.[0];
            if (change && change.action === 'update_extraction_instruction') {
              // Find the scatter-gather step
              const scatterStep = (currentAgent.pilot_steps || currentAgent.workflow_steps || []).find((s: any) =>
                s.scatter?.steps
              );

              if (scatterStep?.scatter?.steps) {
                // Find the document-extractor step (deterministic extraction)
                const extractorStepIndex = scatterStep.scatter.steps.findIndex((step: any) =>
                  step.type === 'action' && step.plugin === 'document-extractor'
                );

                if (extractorStepIndex !== -1) {
                  const extractorStep = scatterStep.scatter.steps[extractorStepIndex];
                  const extractorOutputVar = extractorStep.output_variable || 'extracted_fields';
                  const sanitizeStepId = `${extractorStep.id || extractorStep.step_id}_sanitize`;

                  // Check if sanitize step already exists
                  const sanitizeExists = scatterStep.scatter.steps.some((s: any) =>
                    (s.id === sanitizeStepId || s.step_id === sanitizeStepId)
                  );

                  if (!sanitizeExists) {
                    // CONVERGENCE CHECK
                    const extractorStepId = extractorStep.id || extractorStep.step_id;
                    const canApplyFix = trackFix(extractorStepId, `add_extraction_fallback:${change.field}`);
                    if (!canApplyFix) {
                      logger.warn({
                        issueId: issue.id,
                        extractorStepId,
                        fixType: 'add_extraction_fallback',
                        field: change.field
                      }, 'CONVERGENCE FAILURE: Skipping extraction fallback that was already applied');
                      continue;
                    }

                    // Insert AI processing step immediately after extractor to sanitize null values
                    // Clone the output schema and mark the fallback field as REQUIRED
                    const sanitizeOutputSchema = extractorStep.output_schema ?
                      JSON.parse(JSON.stringify(extractorStep.output_schema)) :
                      {
                        type: 'object',
                        properties: {
                          [change.field]: { type: 'string' }
                        }
                      };

                    // Make the fallback field required so LLM must provide a value
                    if (sanitizeOutputSchema.properties && sanitizeOutputSchema.properties[change.field]) {
                      sanitizeOutputSchema.properties[change.field].required = true;
                      sanitizeOutputSchema.properties[change.field].description =
                        (sanitizeOutputSchema.properties[change.field].description || '') +
                        ` (REQUIRED: use "${change.fallback}" if null/empty)`;
                    }

                    const sanitizeStep = {
                      id: sanitizeStepId,
                      step_id: sanitizeStepId,
                      type: 'ai_processing',
                      description: `Sanitize extracted fields: replace null "${change.field}" with "${change.fallback}"`,
                      input: `{{${extractorOutputVar}}}`,
                      config: {
                        type: 'generate',
                        ai_type: 'generate',
                        instruction: `You MUST return a complete object with all fields from the input. The "${change.field}" field is REQUIRED and cannot be null or empty. If the input has null, empty, or missing "${change.field}", you MUST set it to "${change.fallback}". Keep all other fields exactly as they are in the input.`
                      },
                      prompt: `You MUST return a complete object with all fields from the input. The "${change.field}" field is REQUIRED and cannot be null or empty. If the input has null, empty, or missing "${change.field}", you MUST set it to "${change.fallback}". Keep all other fields exactly as they are in the input.`,
                      output_schema: sanitizeOutputSchema,
                      output_variable: extractorOutputVar  // Overwrite original variable with sanitized version
                    };

                    // Insert right after extractor step
                    scatterStep.scatter.steps.splice(extractorStepIndex + 1, 0, sanitizeStep);

                    // NO NEED to update downstream steps - they already use extracted_fields
                    // The sanitize step overwrites the variable with the cleaned version

                    fixesAppliedThisRound++;
                    logger.info({
                      issueId: issue.id,
                      extractorStepId: extractorStep.id || extractorStep.step_id,
                      sanitizeStepId,
                      field: change.field,
                      fallback: change.fallback,
                      insertedAt: extractorStepIndex + 1,
                      downstreamStepsUpdated: scatterStep.scatter.steps.length - extractorStepIndex - 2
                    }, 'Auto-applied: add_extraction_fallback (inserted sanitize step)');
                  } else {
                    logger.debug({
                      issueId: issue.id,
                      sanitizeStepId
                    }, 'Sanitize step already exists, skipping');
                  }
                }
              }
            }
          }
          else if (proposal.type === 'extract_object_field') {
            const change = proposal.changes?.[0];
            if (change && change.action === 'add_field_accessor') {
              // Find the scatter-gather step
              const scatterStep = (currentAgent.pilot_steps || currentAgent.workflow_steps || []).find((s: any) =>
                s.scatter?.steps
              );

              if (scatterStep?.scatter?.steps) {
                // Find the nested step with the parameter that needs fixing
                const nestedStepIndex = scatterStep.scatter.steps.findIndex((step: any) =>
                  (step.id === change.stepId || step.step_id === change.stepId)
                );

                if (nestedStepIndex !== -1) {
                  const nestedStep = scatterStep.scatter.steps[nestedStepIndex];
                  const nestedConfig = nestedStep.config || nestedStep.params || {};

                  // CONVERGENCE CHECK
                  const canApplyFix = trackFix(change.stepId, `extract_object_field:${change.path}`);
                  if (!canApplyFix) {
                    logger.warn({
                      issueId: issue.id,
                      stepId: change.stepId,
                      fixType: 'extract_object_field',
                      path: change.path
                    }, 'CONVERGENCE FAILURE: Skipping object field extraction that was already applied');
                    continue;
                  }

                  // Extract parameter name from path (e.g., "config.file_id" -> "file_id")
                  const paramName = change.path.split('.').pop();

                  if (paramName && paramName in nestedConfig) {
                    // Update the parameter value from {{object}} to {{object.field}}
                    nestedConfig[paramName] = change.newValue;

                    // Also update params if they exist
                    if (nestedStep.params && paramName in nestedStep.params) {
                      nestedStep.params[paramName] = change.newValue;
                    }

                    fixesAppliedThisRound++;
                    logger.info({
                      issueId: issue.id,
                      stepId: change.stepId,
                      paramName,
                      oldValue: change.oldValue,
                      newValue: change.newValue,
                      reasoning: change.reasoning
                    }, 'Auto-applied: extract_object_field (added field accessor to parameter)');
                  } else {
                    logger.warn({
                      issueId: issue.id,
                      stepId: change.stepId,
                      paramName,
                      availableParams: Object.keys(nestedConfig)
                    }, 'Could not apply extract_object_field: parameter not found in config');
                  }
                } else {
                  logger.warn({
                    issueId: issue.id,
                    targetStepId: change.stepId,
                    availableSteps: scatterStep.scatter.steps.map((s: any) => s.id || s.step_id)
                  }, 'Could not apply extract_object_field: nested step not found');
                }
              }
            }
          }
          // Pattern 5: Add missing dependencies
          else if (proposal.type === 'add_missing_dependencies') {
            const change = proposal.changes?.[0];
            if (change && change.action === 'add_dependencies') {
              // Find the step that needs dependencies added
              const targetStep = findStepByIdRecursive(
                currentAgent.pilot_steps || currentAgent.workflow_steps || [],
                change.stepId
              );

              if (targetStep) {
                // CONVERGENCE CHECK
                const canApplyFix = trackFix(change.stepId, `add_dependencies:${change.newValue.join(',')}`);
                if (!canApplyFix) {
                  logger.warn({
                    issueId: issue.id,
                    stepId: change.stepId,
                    fixType: 'add_missing_dependencies',
                    newDeps: change.newValue
                  }, 'CONVERGENCE FAILURE: Skipping dependency addition that was already applied');
                  continue;
                }

                // Add the missing dependencies
                const currentDeps = targetStep.dependencies || targetStep.depends_on || [];
                const newDeps = [...new Set([...currentDeps, ...change.newValue])]; // Deduplicate

                // Update both possible fields
                targetStep.dependencies = newDeps;
                if ('depends_on' in targetStep) {
                  targetStep.depends_on = newDeps;
                }

                fixesAppliedThisRound++;
                logger.info({
                  issueId: issue.id,
                  stepId: change.stepId,
                  oldDeps: change.oldValue,
                  newDeps,
                  reasoning: change.reasoning
                }, 'Auto-applied: add_missing_dependencies (added variable producer dependencies)');
              } else {
                logger.warn({
                  issueId: issue.id,
                  targetStepId: change.stepId
                }, 'Could not apply add_missing_dependencies: step not found');
              }
            }
          }
          // Pattern 6: Rewrite conditional field reference to step ID path
          else if (proposal.type === 'rewrite_conditional_field_reference') {
            const change = proposal.changes?.[0];
            if (change && change.stepId && change.field === 'condition.field') {
              // Find the conditional step
              const targetStep = findStepByIdRecursive(
                currentAgent.pilot_steps || currentAgent.workflow_steps || [],
                change.stepId
              );

              if (targetStep && targetStep.type === 'conditional' && targetStep.condition) {
                // CONVERGENCE CHECK
                const canApplyFix = trackFix(change.stepId, `rewrite_conditional_field:${change.oldValue}→${change.newValue}`);
                if (!canApplyFix) {
                  logger.warn({
                    issueId: issue.id,
                    stepId: change.stepId,
                    fixType: 'rewrite_conditional_field_reference',
                    oldValue: change.oldValue,
                    newValue: change.newValue
                  }, 'CONVERGENCE FAILURE: Skipping conditional field rewrite that was already applied');
                  fixesSkippedThisRound++;
                  continue;
                }

                // Rewrite the field reference from simple variable name to step ID path
                targetStep.condition.field = change.newValue;

                fixesAppliedThisRound++;
                logger.info({
                  issueId: issue.id,
                  stepId: change.stepId,
                  oldField: change.oldValue,
                  newField: change.newValue,
                  reasoning: change.reasoning
                }, 'Auto-applied: rewrite_conditional_field_reference (rewrote field to use step ID path)');
              } else {
                logger.warn({
                  issueId: issue.id,
                  targetStepId: change.stepId,
                  foundStep: !!targetStep,
                  isConditional: targetStep?.type === 'conditional',
                  hasCondition: !!targetStep?.condition
                }, 'Could not apply rewrite_conditional_field_reference: step not found or not conditional');
              }
            }
          }
          // Pattern 7: Transform fields/mapping object to required array parameter
          else if (proposal.type === 'transform_fields_to_values') {
            logger.info({ sessionId, loopIteration, issueId: issue.id }, 'TRANSFORM HANDLER: Starting transform_fields_to_values');
            const change = proposal.changes?.[0];
            if (change && change.stepId) {
              logger.info({ sessionId, stepId: change.stepId }, 'TRANSFORM HANDLER: Looking for target step');
              // Find the step that needs transformation
              const targetStep = findStepByIdRecursive(updatedSteps, change.stepId);

              if (targetStep) {
                logger.info({ sessionId, stepId: change.stepId, found: true }, 'TRANSFORM HANDLER: Target step found');
                const stepConfig = targetStep.config || targetStep.params || {};
                const missingParam = (change as any).missingParam || 'values';
                const providedParam = (change as any).providedParam || 'fields';

                // CONVERGENCE CHECK
                const canApplyFix = trackFix(change.stepId, `transform_${providedParam}_to_${missingParam}`);
                if (!canApplyFix) {
                  logger.warn({
                    issueId: issue.id,
                    stepId: change.stepId,
                    fixType: 'transform_fields_to_values',
                    from: providedParam,
                    to: missingParam
                  }, 'CONVERGENCE FAILURE: Skipping transformation that was already applied');
                  continue;
                }

                // Check if we have the source mapping/fields parameter
                if (stepConfig[providedParam] && typeof stepConfig[providedParam] === 'object') {
                  const fieldsMapping = stepConfig[providedParam];
                  const fieldNames = Object.keys(fieldsMapping);
                  const fieldValues = Object.values(fieldsMapping);

                  // Create a transform step to convert the data
                  const transformStepId = `${change.stepId}_transform`;
                  const outputVar = `${change.stepId}_transformed_data`;

                  // Find parent step (scatter-gather, conditional, or loop that contains this step)
                  let parentStep = updatedSteps.find((s: any) =>
                    s.scatter?.steps?.some((nested: any) =>
                      (nested.id === change.stepId || nested.step_id === change.stepId)
                    )
                  );

                  let parentType: 'scatter' | 'conditional' | null = parentStep ? 'scatter' : null;

                  // Also check for conditional steps
                  if (!parentStep) {
                    parentStep = updatedSteps.find((s: any) =>
                      s.type === 'conditional' &&
                      s.steps?.some((nested: any) =>
                        (nested.id === change.stepId || nested.step_id === change.stepId)
                      )
                    );
                    if (parentStep) {
                      parentType = 'conditional';
                    }
                  }

                  if (parentStep?.scatter?.steps) {
                    // This is inside a scatter-gather - transform per-item
                    const nestedStepIndex = parentStep.scatter.steps.findIndex((step: any) =>
                      (step.id === change.stepId || step.step_id === change.stepId)
                    );

                    if (nestedStepIndex !== -1) {
                      const nestedStep = parentStep.scatter.steps[nestedStepIndex];

                      // Build instruction describing the transformation
                      const fieldDescriptions = fieldNames.map((name, idx) =>
                        `"${name}": extract from ${fieldValues[idx]}`
                      ).join(', ');

                      const transformStep = {
                        id: transformStepId,
                        step_id: transformStepId,
                        type: 'ai_processing',
                        config: {
                          type: 'generate',
                          ai_type: 'generate',
                          instruction: `Convert input to array format. Extract fields in order: ${fieldNames.join(', ')}. Return JSON with key "${missingParam}" containing a 2D array with ONE row. Field mappings: ${fieldDescriptions}`,
                          output_schema: {
                            type: 'object',
                            required: [missingParam],
                            properties: {
                              [missingParam]: {
                                type: 'array',
                                items: {
                                  type: 'array',
                                  items: { type: 'string' }
                                },
                                description: '2D array with one row of field values'
                              }
                            }
                          }
                        },
                        input: (change as any).inputVariable || nestedStep.input,
                        output_variable: outputVar,
                        description: `Transform ${providedParam} to ${missingParam} array`
                      };

                      // Insert transform step before target step
                      parentStep.scatter.steps.splice(nestedStepIndex, 0, transformStep);

                      // Update target step to use transformed data
                      const targetUpdatedStep = parentStep.scatter.steps[nestedStepIndex + 1];

                      // Remove source parameter
                      delete (targetUpdatedStep.config || {})[providedParam];
                      delete (targetUpdatedStep.params || {})[providedParam];

                      // Add required parameter referencing transform output
                      // CRITICAL FIX: Transform step returns array directly, not {values: array}
                      // The output_schema declares the structure, but AI processing with generate
                      // might not always respect it. Reference the variable directly.
                      if (targetUpdatedStep.config) {
                        targetUpdatedStep.config[missingParam] = `{{${outputVar}}}`;
                      }
                      if (targetUpdatedStep.params) {
                        targetUpdatedStep.params[missingParam] = `{{${outputVar}}}`;
                      }

                      fixesAppliedThisRound++;
                      logger.info({
                        issueId: issue.id,
                        stepId: change.stepId,
                        transformStepId,
                        from: providedParam,
                        to: missingParam,
                        fieldCount: fieldNames.length,
                        insertedAt: nestedStepIndex
                      }, `Auto-applied: transform_${providedParam}_to_${missingParam} (inserted transform step)`);
                    }
                  } else if (parentType === 'conditional' && parentStep?.steps) {
                    // This is inside a conditional's nested steps array
                    const nestedStepIndex = parentStep.steps.findIndex((step: any) =>
                      (step.id === change.stepId || step.step_id === change.stepId)
                    );

                    if (nestedStepIndex !== -1) {
                      const nestedStep = parentStep.steps[nestedStepIndex];

                      // GENERIC SOLUTION: Detect input variable from parent conditional's condition field
                      // When a transformation step is inserted into a conditional's steps array,
                      // the input should be the variable that the conditional is checking
                      const inputVariable = parentStep.condition?.field || 'item';

                      // Build scalable transformation that handles any data type
                      const fieldDescriptions = fieldNames.map((name, idx) => {
                        const valueRef = fieldValues[idx] as string;
                        return `"${name}": ${valueRef}`;
                      }).join(', ');

                      // Create a transform step that converts fields object to values 2D array
                      // Build the transformation expression that maps each item to an array of values
                      const transformExpression = `[${(fieldValues as string[]).map((path) => {
                        // Extract the field path (e.g., "high_value_items.date" → "item.date")
                        const fieldPath = path.replace(`${inputVariable}.`, 'item.');
                        return fieldPath;
                      }).join(', ')}]`;

                      const transformStep = {
                        id: transformStepId,
                        step_id: transformStepId,
                        type: 'transform',
                        operation: 'map',
                        input: `{{${inputVariable}}}`,
                        expression: transformExpression,
                        output_variable: outputVar,
                        output_schema: {
                          type: 'array',
                          items: {
                            type: 'array',
                            description: `Row with values: [${fieldNames.join(', ')}]`
                          },
                          description: '2D array where each row contains field values from one input item'
                        },
                        description: `Transform ${providedParam} to ${missingParam} 2D array for Google Sheets`
                      };

                      // Insert transform step before target step
                      parentStep.steps.splice(nestedStepIndex, 0, transformStep);

                      // Update target step to use transformed data
                      const targetUpdatedStep = parentStep.steps[nestedStepIndex + 1];

                      // Remove source parameter
                      delete (targetUpdatedStep.config || {})[providedParam];
                      delete (targetUpdatedStep.params || {})[providedParam];

                      // Add required parameter referencing transform output
                      // CRITICAL FIX: Transform step returns array directly, not {values: array}
                      // The output_schema declares the structure, but map operation with custom_code
                      // ignores it and returns the mapped array. Reference the variable directly.
                      if (targetUpdatedStep.config) {
                        targetUpdatedStep.config[missingParam] = `{{${outputVar}}}`;
                      }
                      if (targetUpdatedStep.params) {
                        targetUpdatedStep.params[missingParam] = `{{${outputVar}}}`;
                      }

                      fixesAppliedThisRound++;
                      logger.info({
                        issueId: issue.id,
                        stepId: change.stepId,
                        transformStepId,
                        from: providedParam,
                        to: missingParam,
                        fieldCount: fieldNames.length,
                        insertedAt: nestedStepIndex,
                        parentType: 'conditional'
                      }, `Auto-applied: transform_${providedParam}_to_${missingParam} (inserted transform step in conditional)`);
                    }
                  } else {
                    // Step is at top level - array transformation
                    const stepIndex = updatedSteps.findIndex((s: any) =>
                      (s.id === change.stepId || s.step_id === change.stepId)
                    );

                    if (stepIndex !== -1) {
                      const fieldDescriptions = fieldNames.map((name, idx) =>
                        `"${name}": extract from ${fieldValues[idx]}`
                      ).join(', ');

                      const transformStep = {
                        id: transformStepId,
                        step_id: transformStepId,
                        type: 'ai_processing',
                        config: {
                          type: 'generate',
                          ai_type: 'generate',
                          instruction: `Convert input array to 2D array. For each item, extract fields in order: ${fieldNames.join(', ')}. Return JSON with key "${missingParam}" containing 2D array where each row is field values from one item. Field mappings: ${fieldDescriptions}`,
                          output_schema: {
                            type: 'object',
                            required: [missingParam],
                            properties: {
                              [missingParam]: {
                                type: 'array',
                                items: {
                                  type: 'array',
                                  items: { type: 'string' }
                                },
                                description: '2D array where each row contains field values from one input item'
                              }
                            }
                          }
                        },
                        input: (change as any).inputVariable || targetStep.input,
                        output_variable: outputVar,
                        description: `Transform ${providedParam} to ${missingParam} array`
                      };

                      // Insert transform step before target
                      updatedSteps.splice(stepIndex, 0, transformStep);

                      // Update target step
                      const targetUpdatedStep = updatedSteps[stepIndex + 1];

                      // Remove source parameter
                      delete (targetUpdatedStep.config || {})[providedParam];
                      delete (targetUpdatedStep.params || {})[providedParam];

                      // Add required parameter
                      if (targetUpdatedStep.config) {
                        targetUpdatedStep.config[missingParam] = `{{${outputVar}.${missingParam}}}`;
                      }
                      if (targetUpdatedStep.params) {
                        targetUpdatedStep.params[missingParam] = `{{${outputVar}.${missingParam}}}`;
                      }

                      fixesAppliedThisRound++;
                      logger.info({
                        issueId: issue.id,
                        stepId: change.stepId,
                        transformStepId,
                        from: providedParam,
                        to: missingParam,
                        fieldCount: fieldNames.length,
                        insertedAt: stepIndex
                      }, `Auto-applied: transform_${providedParam}_to_${missingParam} (inserted transform step)`);
                    }
                  }
                }
              }
            }
          }
          // Handle data_shape_mismatch fixes
          else if (proposal.action === 'extract_single_array' ||
                   proposal.action === 'extract_named_array' ||
                   proposal.action === 'extract_from_envelope' ||
                   proposal.action === 'extract_paginated_data') {
            const failedStepId = issue.affectedSteps?.[0]?.stepId;
            if (!failedStepId) continue;

            const failedStep = findStepByIdRecursive(updatedSteps, failedStepId);
            if (!failedStep || !failedStep.input) continue;

            const extractField = proposal.extractField || (proposal as any).envelopeKey;
            if (!extractField) continue;

            // Update input to navigate to array field
            const varPattern = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
            failedStep.input = failedStep.input.replace(varPattern, `{{$1.${extractField}}}`);

            fixesAppliedThisRound++;
            logger.info({
              issueId: issue.id,
              extractField,
              action: proposal.action
            }, 'Auto-applied: data shape fix');
          }

        } catch (err: any) {
          logger.error({ issueId: issue.id, error: err.message },
            'Failed to auto-apply fix - will show to user');
        }
      }

      // Update agent with auto-fixed workflow
      if (fixesAppliedThisRound > 0) {
        await supabase
          .from('agents')
          .update({
            pilot_steps: updatedSteps,
            updated_at: new Date().toISOString()
          })
          .eq('id', agentId);

        autoFixesApplied += fixesAppliedThisRound;

        // Reload agent for next iteration
        const { data: updatedAgent } = await supabase
          .from('agents')
          .select('*')
          .eq('id', agentId)
          .single();

        if (updatedAgent) {
          currentAgent = updatedAgent;
        }

        logger.info({
          sessionId,
          loopIteration,
          fixesThisRound: fixesAppliedThisRound,
          fixesSkipped: fixesSkippedThisRound,
          totalAutoFixes: autoFixesApplied
        }, 'Auto-fixes applied, re-running calibration');

        // Continue loop to re-run calibration
        continue;
      } else {
        // CRITICAL FIX: If all fixes were skipped, exit loop to prevent endless iteration
        logger.warn({
          sessionId,
          loopIteration,
          autoFixableCount: autoFixableIssues.length,
          fixesSkipped: fixesSkippedThisRound,
          reason: fixesSkippedThisRound > 0 ? 'All fixes skipped (execution handles them)' : 'No fixes applicable'
        }, 'Found auto-fixable issues but could not apply any fixes - exiting loop');

        // Add skipped issues to UI display
        allIssuesForUI.push(...autoFixableIssues);
        break;
      }
    }

    // After loop completes, process final results
    logger.info({
      sessionId,
      totalIterations: loopIteration,
      autoFixesApplied,
      finalExecutionId: finalResult?.executionId
    }, 'Auto-calibration loop completed');

    // Phase 6 — Calibration audit fix (G-CAL-3): non-convergence signal.
    // If the auto-calibration loop hit the iteration cap without converging,
    // surface a top-level issue so the user sees "calibration could not
    // converge after N iterations" instead of receiving a silently-incomplete
    // workflow as though it were ready.
    if (loopIteration >= MAX_ITERATIONS && allIssuesForUI.length > 0) {
      allIssuesForUI.push({
        source: 'calibration_loop',
        type: 'non_convergence',
        severity: 'high',
        description:
          `Auto-calibration did not converge after ${MAX_ITERATIONS} iterations. ` +
          `Some issues could not be auto-fixed; please review and resolve them manually before running this workflow.`,
        details: {
          totalIterations: loopIteration,
          maxIterations: MAX_ITERATIONS,
          autoFixesApplied,
          remainingIssueCount: allIssuesForUI.length,
        },
      });
      logger.warn({
        sessionId,
        agentId,
        totalIterations: loopIteration,
        maxIterations: MAX_ITERATIONS,
        remainingIssueCount: allIssuesForUI.length,
      }, '[G-CAL-3] Auto-calibration did not converge — surfacing non-convergence issue to user');
    }

    // 8. Process remaining issues that require user input
    logger.info({
      sessionId,
      hasCollectedIssues: !!(finalResult as any)?.collectedIssues,
      collectedIssuesLength: (finalResult as any)?.collectedIssues?.length || 0,
      remainingIssuesLength: allIssuesForUI.length
    }, 'Processing remaining issues for UI display');

    if (allIssuesForUI.length === 0) {
      logger.info({ sessionId, agentId }, 'No issues found - workflow is ready!');

      // SEMANTIC VALIDATION: Detect workflow completed without errors but produced no useful output
      // This is SCALABLE - checks generic metadata (items_processed vs items_delivered), not plugin-specific logic
      const executionSummary = finalResult.execution_summary;

      if (executionSummary && executionSummary.items_processed > 0) {
        const itemsDelivered = executionSummary.items_delivered || 0;

        // If workflow processed items but delivered nothing, flag for review
        if (itemsDelivered === 0) {
          const semanticIssue = {
            id: 'semantic_no_output_produced',
            type: 'semantic_failure',
            severity: 'high',
            title: 'Workflow completed but produced no output',
            details: `Workflow processed ${executionSummary.items_processed} items but delivered 0 items. ` +
                     'Common causes:\n' +
                     '- Filter condition removed all items\n' +
                     '- Flatten extracted wrong field\n' +
                     '- Transform produced empty result',
            category: 'data_flow',
            stepId: null,
            suggestedFix: null,
            context: {
              items_processed: executionSummary.items_processed,
              items_delivered: itemsDelivered,
              data_sources: executionSummary.data_sources_accessed,
              data_written: executionSummary.data_written
            }
          };

          allIssuesForUI.push(semanticIssue);

          logger.warn({
            sessionId,
            items_processed: executionSummary.items_processed,
            items_delivered: itemsDelivered
          }, 'Semantic validation: workflow produced no output despite processing items');

          await sessionRepo.update(sessionId, {
            // 'needs_review' is a calibration_history status, NOT a session status.
            // The session "needs user action" state is 'awaiting_fixes' (matches
            // the main completed-with-issues path); 'needs_review' isn't in the
            // CalibrationSession status union and would risk a DB CHECK violation.
            status: 'awaiting_fixes',
            execution_id: finalResult.executionId,
            completed_steps: finalResult.stepsCompleted,
            failed_steps: finalResult.stepsFailed,
            skipped_steps: finalResult.stepsSkipped,
            // The session column is `issues` (see create()); `issues_found` was a
            // non-existent field that would have been dropped/rejected at write.
            issues: allIssuesForUI,
            execution_summary: finalResult.execution_summary || null
          });

          return NextResponse.json({
            // P1a: needs-review outcome must not report success:true (status was
            // already 'needs_review' below; success was inconsistent with it).
            success: false,
            sessionId,
            executionId: finalResult.executionId,
            autoCalibration: {
              iterations: loopIteration,
              autoFixesApplied,
              message: 'Workflow completed but requires review due to semantic issues'
            },
            issues: {
              critical: [semanticIssue],
              warnings: [],
              autoRepairs: []
            },
            summary: {
              total: 1,
              critical: 1,
              warnings: 0,
              autoRepairs: 0,
              requiresUserAction: 1,
              completedSteps: finalResult.stepsCompleted,
              failedSteps: finalResult.stepsFailed,
              skippedSteps: finalResult.stepsSkipped,
            },
            status: 'needs_review',
            message: 'Workflow completed but semantic validation requires review'
          });
        }
      }

      // No semantic issues - mark session as completed
      console.log('📊 [Batch Calibration] Storing execution summary:', {
        hasExecutionSummary: !!finalResult.execution_summary,
        executionSummary: finalResult.execution_summary
      });
      await sessionRepo.update(sessionId, {
        status: 'completed',
        execution_id: finalResult.executionId,
        completed_steps: finalResult.stepsCompleted,
        failed_steps: finalResult.stepsFailed,
        skipped_steps: finalResult.stepsSkipped,
        completed_at: new Date().toISOString(),
        execution_summary: finalResult.execution_summary || null
      });

      // Update agent with successful calibration status
      logger.info({
        agentId,
        sessionId,
        iterations: loopIteration,
        autoFixesApplied,
        workflowHash: currentWorkflowHash
      }, 'Calibration successful - saving to calibration history');

      // Extract plugins from workflow
      const { extractPluginsFromWorkflow } = await import('@/lib/utils/calibrationMetrics');
      const pluginsUsed = extractPluginsFromWorkflow(workflowSteps);

      // Collect ALL issues that were detected during calibration (even if auto-fixed)
      // This gives complete visibility into what problems the system encountered and solved
      const allIssuesDetected = [
        // 1. Pre-flight structural repairs (compiler bugs, DSL issues)
        ...structuralFixes.map((result: any) => {
          const proposal = result.fixApplied;
          return {
            phase: 'pre-flight',
            type: 'structural_repair',
            category: proposal?.action || 'unknown',
            step: {
              stepId: proposal?.targetStepId,
              stepName: workflowSteps.find((s: any) => s.id === proposal?.targetStepId)?.name || proposal?.targetStepId
            },
            problem: proposal?.description || 'Structural issue detected',
            solution: {
              action: proposal?.action,
              confidence: proposal?.confidence,
              risk: proposal?.risk,
              details: proposal?.fix
            },
            severity: result.fixed ? 'high' : 'critical',
            autoFixed: result.fixed
          };
        }).filter((issue: any) => issue.solution.action), // Only include successfully fixed issues

        // 2. Transformation proposals (fields-to-array conversions detected by StructuralRepairEngine)
        ...transformationProposals.map((proposal: any) => ({
          phase: 'calibration',
          type: 'transformation_required',
          category: 'fields_to_array',
          step: {
            stepId: proposal.stepId,
            stepName: workflowSteps.find((s: any) => s.id === proposal.stepId)?.name || proposal.stepId
          },
          problem: `Parameter '${proposal.paramName}' requires array format but received object with fields`,
          solution: {
            action: 'insert_transform_step',
            sourceParam: proposal.sourceParam,
            targetParam: proposal.paramName,
            fieldMapping: proposal.fieldMapping,
            confidence: proposal.confidence
          },
          severity: 'high',
          autoFixed: true
        })),

        // 3. Iteration issues that were detected and auto-fixed during calibration loop
        // These are the hardcode, parameter, data shape issues from HardcodeDetector, etc.
        // NOTE: In success case, allIssuesForUI should be empty (all were auto-fixed in previous iterations)
        // But we should still track them from the iteration history if available
        // For now, we rely on metadata tracking (layer1Fixes, layer2Fixes, etc.)
      ];

      // Add count of iteration-level fixes from metadata (these were auto-fixed before final iteration)
      const iterationFixesSummary = {
        layer1Fixes: validationMetadata?.layer1Fixes || 0,
        layer2HighConfidenceFixes: validationMetadata?.layer2HighConfidenceFixes || 0,
        layer2MediumConfidenceFixes: validationMetadata?.layer2MediumConfidenceFixes || 0,
        earlyMultiStepFixes: validationMetadata?.earlyMultiStepFixes || 0,
        lateMultiStepFixes: validationMetadata?.lateMultiStepFixes || 0,
        actionReplacementFixes: validationMetadata?.actionReplacementFixes || 0
      };

      // Save to calibration_history table
      const { data: historyRecord, error: historyError } = await calibrationHistoryRepo.create({
        agent_id: agentId,
        session_id: sessionId,
        user_id: user.id,
        workflow_hash: currentWorkflowHash,
        workflow_step_count: workflowSteps.length,
        input_schema_hash: currentInputSchemaHash,
        status: 'success',
        iterations: loopIteration,
        auto_fixes_applied: autoFixesApplied,
        first_execution_success: loopIteration === 1 && autoFixesApplied === 0,
        issues_found: allIssuesDetected,
        issues_fixed: allIssuesDetected, // All detected issues were auto-fixed (success case)
        issues_remaining: [],
        execution_time_ms: finalResult.executionTimeMs || null,
        steps_completed: finalResult.stepsCompleted || 0,
        steps_failed: 0,
        steps_skipped: finalResult.stepsSkipped || 0,
        plugins_used: pluginsUsed,
        metadata: {
          ...validationMetadata,
          // Add comprehensive repair summary for analytics
          repairSummary: {
            // Pre-flight structural fixes
            structuralFixes: structuralFixes.length,
            transformationProposals: transformationProposals.length,

            // Iteration-level fixes (from HardcodeDetector, parameter fixes, etc.)
            iterationFixes: iterationFixesSummary,
            totalIterationFixes: Object.values(iterationFixesSummary).reduce((a: number, b: number) => a + b, 0),

            // Overall summary
            totalIssuesDetected: allIssuesDetected.length + Object.values(iterationFixesSummary).reduce((a: number, b: number) => a + b, 0),
            totalIssuesAutoFixed: autoFixesApplied,
            allAutoFixed: true,

            // Additional context
            iterations: loopIteration,
            firstExecutionSuccess: loopIteration === 1 && autoFixesApplied === 0
          }
        },
        completed_at: new Date().toISOString()
      });

      if (historyError) {
        logger.error({ err: historyError, agentId, sessionId }, 'Failed to save calibration history');
      }

      // Update agent with calibration flag and reference to last successful calibration
      if (historyRecord) {
        await supabase
          .from('agents')
          .update({
            is_calibrated: true, // Set flag to block re-calibration
            production_ready: true, // ✅ AUTO-APPROVE: Mark as production-ready after successful calibration
            workflow_hash: currentWorkflowHash,
            last_successful_calibration_id: historyRecord.id,
            updated_at: new Date().toISOString()
          })
          .eq('id', agentId);

        logger.info({ sessionId, agentId }, 'Agent automatically approved for production after successful calibration');
      }

      return NextResponse.json({
        success: true,
        status: 'success',
        sessionId,
        executionId: finalResult.executionId,
        autoCalibration: {
          iterations: loopIteration,
          autoFixesApplied,
          message: autoFixesApplied > 0
            ? `Automatically fixed ${autoFixesApplied} technical issue(s) across ${loopIteration} calibration round(s)`
            : 'No auto-fixable issues found'
        },
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
          requiresUserAction: 0,
          completedSteps: finalResult.stepsCompleted,
          failedSteps: finalResult.stepsFailed,
          skippedSteps: finalResult.stepsSkipped,
          totalSteps: workflowSteps.length
        },
        message: 'Workflow executed successfully with no issues found!'
      });
    }

    // 9. Group and prioritize remaining issues
    logger.info({ sessionId, issueCount: allIssuesForUI.length }, 'Grouping and prioritizing issues');

    const grouper = new IssueGrouper();
    const groupedIssues = grouper.groupIssues(allIssuesForUI);
    const prioritized = grouper.prioritizeIssues(groupedIssues);
    const summary = grouper.getIssueSummary(prioritized);

    logger.info({
      sessionId,
      original: allIssuesForUI.length,
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
      execution_id: finalResult.executionId,
      completed_steps: finalResult.stepsCompleted,
      failed_steps: finalResult.stepsFailed,
      skipped_steps: finalResult.stepsSkipped,
      execution_summary: finalResult.execution_summary || null
    });

    // Save calibration with issues to calibration_history
    const hasCriticalIssues = summary.critical > 0;
    const calibrationStatus = hasCriticalIssues ? 'needs_review' : 'failed';

    logger.info({
      agentId,
      sessionId,
      calibrationStatus,
      criticalIssues: summary.critical,
      totalIssues: allIssuesForUI.length
    }, 'Calibration completed with issues - saving to calibration history');

    // Separate issues by auto-fixed vs remaining
    const issuesFixed = prioritized.autoRepairs || [];
    const issuesRemaining = [...(prioritized.critical || []), ...(prioritized.warnings || [])];

    // Extract plugins from workflow
    const { extractPluginsFromWorkflow } = await import('@/lib/utils/calibrationMetrics');
    const pluginsUsed = extractPluginsFromWorkflow(workflowSteps);

    await calibrationHistoryRepo.create({
      agent_id: agentId,
      session_id: sessionId,
      user_id: user.id,
      workflow_hash: currentWorkflowHash,
      workflow_step_count: workflowSteps.length,
      input_schema_hash: currentInputSchemaHash,
      status: calibrationStatus as 'needs_review' | 'failed',
      iterations: loopIteration,
      auto_fixes_applied: autoFixesApplied,
      first_execution_success: loopIteration === 1 && autoFixesApplied === 0,
      issues_found: allIssuesForUI,
      issues_fixed: issuesFixed,
      issues_remaining: issuesRemaining,
      execution_time_ms: finalResult.executionTimeMs || null,
      steps_completed: finalResult.stepsCompleted || 0,
      steps_failed: finalResult.stepsFailed || 0,
      steps_skipped: finalResult.stepsSkipped || 0,
      plugins_used: pluginsUsed,
      metadata: {
        ...validationMetadata,
        issuesSummary: {
          critical: summary.critical,
          warnings: summary.warnings,
          autoRepairs: summary.autoRepairs,
          requiresUserAction: summary.requiresUserAction
        }
      },
      completed_at: new Date().toISOString()
    });

    // Update agent with workflow hash (no last_successful_calibration_id since it failed)
    await supabase
      .from('agents')
      .update({
        workflow_hash: currentWorkflowHash,
        updated_at: new Date().toISOString()
      })
      .eq('id', agentId);

    logger.info({ sessionId, agentId }, 'Batch calibration completed successfully');

    // Phase 6 — User-facing translation boundary.
    // Convert every raw issue object into plain-English UserFacingIssue
    // BEFORE returning to the client. The UI for non-technical users will
    // never see step IDs, error codes, schema paths, etc. Raw payloads
    // remain in calibration_history (line 4133 above) for support/debug.
    // See: lib/pilot/shadow/userFacing.ts
    const { toUserFacingList } = await import('@/lib/pilot/shadow/userFacing');
    const userFacingIssues = {
      critical: toUserFacingList(prioritized.critical || []),
      warnings: toUserFacingList(prioritized.warnings || []),
      autoRepairs: toUserFacingList(prioritized.autoRepairs || []),
    };

    // 11. Return results
    // P1a: report the real outcome. This branch only runs when there ARE issues
    // (calibrationStatus is 'needs_review' or 'failed'), so `success` must be
    // false and the explicit `status` is surfaced for the client to key off —
    // never report a needs-review/failed run as a success.
    return NextResponse.json({
      success: false,
      status: calibrationStatus,
      sessionId,
      executionId: finalResult.executionId,
      autoCalibration: {
        iterations: loopIteration,
        autoFixesApplied,
        // P1b: message is critical-aware, not fix-count-only. A run with 0 fixes
        // and open critical issues must never say "everything looked good".
        message: summary.critical > 0
          ? (autoFixesApplied > 0
              ? `We fixed ${autoFixesApplied} thing${autoFixesApplied === 1 ? '' : 's'} automatically, but ${summary.critical} issue${summary.critical === 1 ? '' : 's'} still need${summary.critical === 1 ? 's' : ''} your attention before this agent is ready.`
              : `We found ${summary.critical} issue${summary.critical === 1 ? '' : 's'} that need${summary.critical === 1 ? 's' : ''} your attention before this agent is ready.`)
          : (autoFixesApplied > 0
              ? `We took care of ${autoFixesApplied} thing${autoFixesApplied === 1 ? '' : 's'} for you${summary.warnings > 0 ? `, and there ${summary.warnings === 1 ? 'is' : 'are'} ${summary.warnings} suggestion${summary.warnings === 1 ? '' : 's'} to review` : ''}.`
              : `We found ${summary.total} suggestion${summary.total === 1 ? '' : 's'} to review before this agent is ready.`)
      },
      issues: userFacingIssues,
      summary: {
        total: summary.total,
        critical: summary.critical,
        warnings: summary.warnings,
        autoRepairs: summary.autoRepairs,
        requiresUserAction: summary.requiresUserAction,
        completedSteps: finalResult.stepsCompleted,
        failedSteps: finalResult.stepsFailed,
        skippedSteps: finalResult.stepsSkipped,
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

    // Phase 2 calibration tail: record the gate outcome (any run — so a manual
    // sandbox pass also clears the gate) and, for BACKGROUND runs only, email the
    // user. Best-effort and fully isolated — must never change the route's
    // response or throw.
    if (calibrationStarted && runCtx) {
      try {
        const histRepo = new CalibrationHistoryRepository(runCtx.supabase);
        const { data: rows } = await histRepo.getByAgent(runCtx.agentId, runCtx.userId, 1);
        const latest = rows?.[0];

        // Clean pass = the run wrote a 'success' history row with 0 remaining issues.
        const issuesFound = (latest?.issues_found || []).length;
        const issuesFixed = (latest?.issues_fixed || []).length;
        const issuesRemaining = (latest?.issues_remaining || []).length;
        const passed = latest?.status === 'success' && issuesRemaining === 0;

        // Update the gate for every run (foreground manual pass must unlock too).
        const agentRepo = new AgentRepository(runCtx.supabase);
        await agentRepo.setCalibrationStatus(runCtx.agentId, runCtx.userId, passed ? 'passed' : 'failed');

        // Email only for the background (post-creation) path — the manual sandbox
        // user is watching live and doesn't need an email.
        if (isBackground && runCtx.userEmail) {
          const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
          const ctaUrl = passed
            ? `${base}/agents/${runCtx.agentId}`
            : `${base}/v2/sandbox/${runCtx.agentId}`;
          const remainingIssueTitles = (latest?.issues_remaining || [])
            .map((i: any) => i?.title || i?.message || i?.description)
            .filter(Boolean);

          // Summary model/provider are DB-config-driven (default: cheapest).
          const { provider: summaryProvider, model: summaryModel } = await getCalibrationEmailConfig(runCtx.supabase);

          await sendCalibrationResultEmail({
            to: runCtx.userEmail,
            agentId: runCtx.agentId,
            agentName: runCtx.agentName,
            passed,
            issuesFound,
            issuesFixed,
            issuesRemaining,
            remainingIssueTitles,
            ctaUrl,
            ownerUserId: runCtx.userId, // enables google-mail plugin-connection fallback
            summaryProvider,
            summaryModel,
          });
        }

        logger.info({ agentId: runCtx.agentId, passed, isBackground }, 'Calibration tail completed');
      } catch (tailErr) {
        // Never let the tail break the run. Best effort: mark failed so a
        // background agent doesn't stay stuck on "running".
        logger.error({ err: tailErr, agentId: runCtx.agentId }, 'Calibration tail failed');
        try {
          await new AgentRepository(runCtx.supabase).setCalibrationStatus(runCtx.agentId, runCtx.userId, 'failed');
        } catch { /* swallow */ }
      }
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
      // Check steps array (common format)
      if (step.steps) {
        const found = findStepByIdRecursive(step.steps, stepId);
        if (found) return found;
      }
      // Check then/else branches
      if (step.then) {
        const thenArray = Array.isArray(step.then) ? step.then : [step.then];
        const found = findStepByIdRecursive(thenArray, stepId);
        if (found) return found;
      }
      if (step.else) {
        const elseArray = Array.isArray(step.else) ? step.else : [step.else];
        const found = findStepByIdRecursive(elseArray, stepId);
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
