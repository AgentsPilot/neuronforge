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
import { acquireLock, releaseLock } from '@/lib/utils/distributedLock';
import { createLogger } from '@/lib/logger';
import type { CollectedIssue } from '@/lib/pilot/types';
import type { Agent } from '@/types/agent';

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

    // 7. AUTO-CALIBRATION LOOP - Fix issues before execution, then re-run until perfect
    logger.info({ sessionId, agentId, inputValues }, 'Starting auto-calibration loop');
    console.log('[BatchCalibration] Input values received:', JSON.stringify(inputValues, null, 2));

    let loopIteration = 0;
    const MAX_ITERATIONS = 10; // Increased to handle multiple fix rounds
    let finalResult: any = null;
    let autoFixesApplied = 0;
    let currentAgent = agent; // Track agent state across iterations
    let allIssuesForUI: any[] = []; // Collect all issues for final UI display
    const validator = new WorkflowValidator();

    while (loopIteration < MAX_ITERATIONS) {
      loopIteration++;
      logger.info({ sessionId, agentId, loopIteration }, `Auto-calibration iteration ${loopIteration}`);

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
            // ALWAYS apply flatten field fixes from WorkflowValidator
            // WorkflowValidator has determined the field is invalid (missing OR wrong)
            const currentField = action?.from;
            const suggestedField = action?.to;

            if (suggestedField) {
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
            // ✅ EXECUTION NOW HANDLES MOST OF THESE - Only apply for parameter name validation
            const context = action?.context;
            const suggestedField = action?.suggestedField;

            // SKIP: Field path corrections (execution handles with schema-aware resolution)
            if (context === 'flatten' || context === 'filter' || context === 'map' || context === 'transform') {
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
        inputValues || {},
        crypto.randomUUID(), // Generate session ID for execution
        undefined, // stepEmitter
        false, // debugMode
        undefined, // debugRunId
        undefined, // providedExecutionId
        'batch_calibration' // runMode: batch_calibration
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
      const iterationIssues = result.collectedIssues || [];

      // CRITICAL: Detect scatter-gather errors from BOTH sources:
      // 1. Already-collected issues (when scatter throws in batch calibration mode)
      // 2. Step outputs with error objects (when scatter swallows in production mode)
      const scatterGatherErrorIssues: CollectedIssue[] = [];

      // First, check if any collected issues are scatter-gather errors with parameter mismatch patterns
      for (const collectedIssue of iterationIssues) {
        const errorMessage = collectedIssue.message || collectedIssue.technicalDetails || '';

        // Pattern 1: "parameter X not implemented. Please pass Y parameter"
        const paramMismatchPattern = /(\w+)\s+not implemented.*?(?:pass|use)\s+(\w+)\s+parameter/i;
        const paramMatch = errorMessage.match(paramMismatchPattern);

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

            // Pattern 1: "parameter X not implemented. Please pass Y parameter"
            // Example: "file_url not implemented. Please pass file_content parameter directly"
            const paramMismatchPattern = /(\w+)\s+not implemented.*?(?:pass|use)\s+(\w+)\s+parameter/i;
            const paramMatch = firstError.match(paramMismatchPattern);

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

        // Pattern 1: "parameter X not implemented. Please pass Y parameter"
        const paramMismatchPattern = /(\w+)\s+not implemented.*?(?:pass|use)\s+(\w+)\s+parameter/i;
        const paramMatch = errorMessage.match(paramMismatchPattern);

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
      }

      // Separate auto-fixable from requires-user-input
      const autoFixableIssues = iterationIssues.filter(issue =>
        issue.autoRepairAvailable &&
        issue.autoRepairProposal &&
        issue.autoRepairProposal.confidence >= 0.85 && // High confidence only
        !issue.requiresUserInput
      );

      const requiresUserInputIssues = iterationIssues.filter(issue =>
        issue.requiresUserInput ||
        !issue.autoRepairAvailable ||
        (issue.autoRepairProposal && issue.autoRepairProposal.confidence < 0.85)
      );

      logger.info({
        sessionId,
        loopIteration,
        totalIssues: iterationIssues.length,
        autoFixable: autoFixableIssues.length,
        requiresUserInput: requiresUserInputIssues.length
      }, 'Issue classification complete');

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
          logger.info({
            sessionId,
            loopIteration,
            fieldRefCount: finalFieldRefIssues.length,
            operationFieldCount: finalOperationFieldIssues.length,
            flattenFieldCount: finalFlattenFieldIssues.length
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
                } else if (proposal.type === 'fix_flatten_field' || proposal.type === 'fix_operation_field') {
                  // ✅ EXECUTION NOW HANDLES THIS - Skip final fixes for field paths
                  logger.info({
                    issueId: issue.id,
                    stepId: change.stepId,
                    from: change.from || change.field,
                    to: change.suggestedField || change.to,
                    reason: 'Execution uses schema-aware resolution and runtime field path correction'
                  }, 'SKIPPED: final validation fix for field path (execution handles this)');
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

      for (const issue of autoFixableIssues) {
        const proposal = issue.autoRepairProposal!;

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
          }
          else if (proposal.action === 'fix_parameter_reference') {
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
          totalAutoFixes: autoFixesApplied
        }, 'Auto-fixes applied, re-running calibration');

        // Continue loop to re-run calibration
        continue;
      } else {
        logger.warn({ sessionId, loopIteration },
          'Found auto-fixable issues but could not apply any fixes');
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
            status: 'needs_review',
            execution_id: finalResult.executionId,
            completed_steps: finalResult.stepsCompleted,
            failed_steps: finalResult.stepsFailed,
            skipped_steps: finalResult.stepsSkipped,
            issues_found: allIssuesForUI,
            execution_summary: finalResult.execution_summary || null
          });

          return NextResponse.json({
            success: true,
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

      return NextResponse.json({
        success: true,
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

    logger.info({ sessionId, agentId }, 'Batch calibration completed successfully');

    // 11. Return results
    return NextResponse.json({
      success: true,
      sessionId,
      executionId: finalResult.executionId,
      autoCalibration: {
        iterations: loopIteration,
        autoFixesApplied,
        message: autoFixesApplied > 0
          ? `Automatically fixed ${autoFixesApplied} technical issue(s) across ${loopIteration} calibration round(s)`
          : 'No auto-fixable issues found'
      },
      issues: prioritized,
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
