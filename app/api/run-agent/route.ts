// /app/api/run-agent/route.ts
// Enhanced agent runner supporting both immediate execution and queue-based execution

import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth'
import { createLogger } from '@/lib/logger'
import { runAgentWithContext } from '@/lib/utils/runAgentWithContext'
import { extractPdfTextFromBase64 } from '@/lib/utils/extractPdfTextFromBase64'
import { addManualExecution } from '@/lib/queues/qstashQueue'
import { runAgentKit } from '@/lib/agentkit/runAgentKit' // NEW: AgentKit execution
import { updateAgentIntensityMetrics } from '@/lib/utils/updateAgentIntensity'
import type { AgentExecutionData } from '@/lib/types/intensity'
import { WorkflowPilot } from '@/lib/pilot'
import type { Agent as PilotAgent } from '@/lib/pilot/types'
import { auditLog } from '@/lib/services/AuditTrailService'
import { CreditService } from '@/lib/services/CreditService'
import {
  AgentRepository,
  AgentStatsRepository,
  AgentConfigurationRepository,
  AgentLogsRepository,
  ExecutionRepository,
  ExecutionLogRepository,
  SystemConfigRepository,
} from '@/lib/repositories'

export const runtime = 'nodejs'

// Create route-level logger
const routeLogger = createLogger({ module: 'API', route: '/api/run-agent' })

interface RunAgentRequest {
  agent_id: string;
  input_variables?: Record<string, any>;
  override_user_prompt?: string;
  execution_id?: string;
  use_queue?: boolean; // New: whether to use queue-based execution
  use_agentkit?: boolean; // NEW: Use OpenAI AgentKit for execution
  execution_type?: string; // NEW: 'manual' (test mode) vs other types
  user_id?: string; // For queue-based execution
  session_id?: string; // NEW: For SSE correlation - pass to WorkflowPilot
  debugMode?: boolean; // NEW: Enable debug mode for step-by-step execution
  debugRunId?: string; // NEW: Pre-generated debug run ID from frontend
}

/**
 * Enhanced POST handler supporting both immediate and queue-based execution
 */
export async function POST(req: Request) {
  const body: RunAgentRequest = await req.json()
  const {
    agent_id,
    input_variables = {},
    override_user_prompt,
    execution_id,
    use_queue = false, // Default to immediate execution for backward compatibility
    use_agentkit = false, // NEW: Default to false (use old system)
    execution_type, // NEW: Track if this is test mode from AgentSandbox
    user_id: provided_user_id,
    session_id: provided_session_id, // NEW: For SSE correlation
    debugMode = false, // NEW: Enable debug mode for step-by-step execution
    debugRunId // NEW: Pre-generated debug run ID from frontend
  } = body

  const supabase = await createAuthenticatedServerClient()

  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Create request-scoped logger with correlation context
  const correlationId = provided_session_id || uuidv4()
  const logger = routeLogger.child({
    method: 'POST',
    correlationId,
    agentId: agent_id,
    userId: user.id,
    executionType: execution_type
  })
  const startTime = Date.now()

  logger.info('Agent execution request received')

  // Initialize repositories with authenticated Supabase client
  const creditService = new CreditService(supabase)
  const agentRepository = new AgentRepository(supabase)
  const agentStatsRepository = new AgentStatsRepository(supabase)
  const agentConfigurationRepository = new AgentConfigurationRepository(supabase)
  const agentLogsRepository = new AgentLogsRepository(supabase)
  const executionRepository = new ExecutionRepository(supabase)
  const executionLogRepository = new ExecutionLogRepository(supabase)
  const systemConfigRepository = new SystemConfigRepository(supabase)

  // Check if account is frozen (free tier expired) or has insufficient balance
  try {
    // Get estimated cost from last run (if available)
    const { data: lastRunCost } = await agentStatsRepository.getLastRunCost(agent_id, user.id)

    // Use CreditService to check if execution is allowed
    const executionCheck = await creditService.checkExecutionAllowed(user.id, lastRunCost || undefined)

    if (!executionCheck.allowed) {
      if (executionCheck.frozen) {
        logger.warn({ frozen: true }, 'Account frozen - execution blocked')
        return NextResponse.json({
          error: 'Account Frozen',
          message: executionCheck.reason,
          frozen: true
        }, { status: 403 })
      }

      // Insufficient balance
      logger.warn({ balance: executionCheck.balance, required: lastRunCost }, 'Insufficient balance - execution blocked')
      return NextResponse.json({
        error: 'Insufficient Balance',
        message: executionCheck.reason || `This agent requires approximately ${lastRunCost} pilot tokens based on previous runs. Please purchase tokens to continue.`,
        insufficientBalance: true,
        requiredTokens: lastRunCost,
        currentBalance: executionCheck.balance
      }, { status: 403 })
    }
    // If no last run exists, allow execution (first run)
  } catch (freezeCheckError) {
    // Log but don't block execution if freeze check fails
    logger.warn({ err: freezeCheckError }, 'Freeze check failed - proceeding with execution')
  }

  // Fetch agent using repository (includes user ownership check)
  const { data: agent, error: agentError } = await agentRepository.findById(agent_id, user.id)

  if (agentError || !agent) {
    logger.error({ err: agentError }, 'Agent not found')
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  // Debug: Log sample of pilot_steps to verify parameterization
  if (agent.pilot_steps) {
    logger.info({
      pilotStepsSample: JSON.stringify(agent.pilot_steps).substring(0, 500)
    }, 'Agent fetched - checking pilot_steps')
  }

  // **UNIFIED EXECUTION PATH**
  // Determine which executor to use and execute
  let executionResult: any = null;
  let executionType: 'pilot' | 'agentkit' = 'agentkit';
  let shouldExecute = true;
  let inputValues: Record<string, any> = {}; // Shared across both execution paths
  let inputSchema: any = null;

  // Check if agent has workflow_steps OR pilot_steps AND pilot is enabled
  // Priority: pilot_steps > workflow_steps (for backward compatibility)
  const workflowStepsToUse = agent.pilot_steps || agent.workflow_steps;
  const hasWorkflowSteps = workflowStepsToUse && Array.isArray(workflowStepsToUse) && workflowStepsToUse.length > 0;

  if (hasWorkflowSteps) {
    logger.debug({ stepCount: workflowStepsToUse.length }, 'Agent has workflow steps - checking pilot status');

    // Check if pilot is enabled in system config
    const pilotEnabled = await systemConfigRepository.getBoolean(
      'pilot_enabled',
      false // Default: disabled for safety
    );

    if (pilotEnabled && !use_agentkit) {
      logger.info({ agentName: agent.agent_name, executor: 'pilot' }, 'Using Workflow Pilot');

      try {
        const userInput = override_user_prompt || agent.user_prompt;

        // Determine input source based on execution type (same logic as AgentKit)
        if (execution_type === 'test') {
          // TEST MODE: Use values from UI
          inputValues = input_variables || {};
          inputSchema = agent.input_schema;
          logger.debug({ inputCount: Object.keys(inputValues).length, mode: 'test' }, 'Pilot using UI input values');
        } else {
          // RUN MODE: Fetch saved configuration using repository
          const { data: agentConfig } = await agentConfigurationRepository.getInputValues(agent_id, user.id);

          inputValues = (agentConfig?.input_values || {}) as Record<string, any>;
          inputSchema = agent.input_schema || agentConfig?.input_schema;
          logger.debug({ inputCount: Object.keys(inputValues).length, mode: 'run' }, 'Pilot using saved configuration');
        }

        // Use provided session_id for SSE correlation, or generate new one
        const sessionId = provided_session_id || uuidv4();
        logger.debug({ sessionId, fromRequest: !!provided_session_id }, 'Session ID set');

        if (debugMode) {
          logger.debug({ debugRunId }, 'Debug mode enabled for pilot execution');
        }

        // Execute using WorkflowPilot
        const pilot = new WorkflowPilot(supabase);
        // Transform agent to convert null to undefined for type compatibility with pilot types
        const pilotAgent: PilotAgent = {
          id: agent.id,
          user_id: agent.user_id,
          agent_name: agent.agent_name,
          system_prompt: agent.system_prompt ?? undefined,
          enhanced_prompt: agent.enhanced_prompt ?? undefined,
          user_prompt: agent.user_prompt || '',
          workflow_steps: (agent.workflow_steps ?? undefined) as PilotAgent['workflow_steps'],
          pilot_steps: (agent.pilot_steps ?? undefined) as PilotAgent['pilot_steps'],
          plugins_required: agent.plugins_required || [],
          input_schema: agent.input_schema as PilotAgent['input_schema'],
          output_schema: agent.output_schema as PilotAgent['output_schema'],
          schedule_cron: agent.schedule_cron ?? undefined,
          trigger_condintion: agent.trigger_condintion ?? undefined,
          status: agent.status,
          created_at: agent.created_at,
          updated_at: agent.updated_at ?? undefined,
          // Business intelligence fields
          production_ready: agent.production_ready ?? false,
          insights_enabled: agent.insights_enabled ?? true, // Default to true
        };
        executionResult = await pilot.execute(
          pilotAgent, // Pass transformed agent object
          user.id,
          userInput || '',
          inputValues,
          sessionId,
          undefined, // stepEmitter
          debugMode, // Pass debugMode to enable debugging
          debugRunId, // Pass pre-generated debugRunId from frontend
          execution_id, // Pass frontend-generated execution ID for calibration polling
          execution_type === 'test' ? 'calibration' : 'production' // Map test mode to calibration type
        );

        executionType = 'pilot';
        shouldExecute = false; // Don't execute AgentKit

      } catch (error: any) {
        logger.error({ err: error }, 'WorkflowPilot execution failed');

        // If pilot is disabled, fall through to AgentKit
        if (error.message?.includes('disabled in system configuration')) {
          logger.warn('Pilot disabled - falling back to AgentKit');
          // Fall through to AgentKit execution below
        } else {
          return NextResponse.json({
            success: false,
            error: error.message || 'Workflow pilot execution failed',
            pilot: true,
          }, { status: 500 });
        }
      }
    } else if (!pilotEnabled) {
      logger.warn({ hasWorkflowSteps: true }, 'Agent has workflow_steps but pilot is disabled - falling back to AgentKit');
      // Fall through to AgentKit execution
    }
  }

  // **AGENTKIT EXECUTION PATH**
  // Execute with AgentKit if pilot didn't execute (shouldExecute is still true)
  if (shouldExecute) {
    logger.info({ agentName: agent.agent_name, executor: 'agentkit' }, 'Using AgentKit execution')

    try {
      const userInput = override_user_prompt || agent.user_prompt || ''

      // CRITICAL FIX: Determine input source based on execution type
      //
      // execution_type='test': AgentSandbox Test Mode - use input_variables from UI
      // execution_type='run': AgentSandbox Run Mode / AgentList - fetch from agent_configurations
      // execution_type=undefined/other: Scheduled/API - fetch from agent_configurations
      //
      if (execution_type === 'test') {
        // TEST MODE (AgentSandbox): Use values entered in UI form (temporary, not saved)
        inputValues = input_variables || {}
        inputSchema = agent.input_schema
        logger.debug({ inputCount: Object.keys(inputValues).length, mode: 'test' }, 'AgentKit using UI input values')
      } else {
        // RUN MODE (AgentSandbox Run / AgentList / Scheduled): Fetch saved configuration using repository
        const { data: agentConfig } = await agentConfigurationRepository.getInputValues(agent_id, user.id)

        inputValues = (agentConfig?.input_values || {}) as Record<string, any>
        inputSchema = agent.input_schema || agentConfig?.input_schema
        logger.debug({ inputCount: Object.keys(inputValues).length, mode: execution_type || 'scheduled' }, 'AgentKit using saved configuration')
      }

      // Generate session ID for analytics tracking (UUID format)
      const sessionId = uuidv4()

      // Execute using OpenAI AgentKit with V2 Plugin System
      executionResult = await runAgentKit(
        user.id,
        {
          id: agent.id,
          agent_name: agent.agent_name,
          system_prompt: agent.system_prompt ?? undefined, // Convert null to undefined for type compatibility
          enhanced_prompt: agent.enhanced_prompt ?? undefined,
          user_prompt: agent.user_prompt || '',
          plugins_required: agent.plugins_required || [],
          input_schema: inputSchema || agent.input_schema,
          output_schema: agent.output_schema,
          trigger_condintion: agent.trigger_condintion // Pass notification preference
        },
        userInput,
        inputValues, // Pass input values from UI (test mode) or saved config
        sessionId // Pass session ID for analytics tracking
      )

      executionType = 'agentkit';
      shouldExecute = false; // Execution complete

      // Check if agent should send email notification based on trigger_condintion
      const triggerConfig = (agent.trigger_condintion?.error_handling || {}) as { on_failure?: string };
      const shouldSendEmail = triggerConfig.on_failure === 'email';

      if (shouldSendEmail && executionResult.success) {
        logger.debug({ emailConfigured: true }, 'AgentKit sending result via email as per trigger_condintion');

        // The result already contains the response - no need to send it again
        // The email should have been sent by the agent itself during execution
        // Just log that email delivery was configured
      }

    } catch (error: any) {
      logger.error({ err: error }, 'AgentKit execution failed')
      return NextResponse.json({
        success: false,
        error: error.message || 'AgentKit execution failed',
        agentkit: true
      }, { status: 500 })
    }
  }

  // **UNIFIED LOGGING AND STATS TRACKING**
  // This section handles logging for BOTH pilot and agentkit executions
  if (executionResult) {
    // Normalize result format for both execution types (outside try so catch can access it)
    const normalizedResult = executionType === 'pilot' ? {
      success: executionResult.success,
      error: executionResult.error,
      executionTime: executionResult.totalExecutionTime,
      tokensUsed: { total: executionResult.totalTokensUsed, prompt: 0, completion: executionResult.totalTokensUsed },
      iterations: 1,
      toolCalls: [], // Pilot doesn't expose toolCalls array
      response: executionResult.output?.message || 'Workflow completed',
      model: 'workflow_pilot',
      provider: 'neuronforge',
      memoryData: undefined
    } : executionResult;

    try {
      const now = new Date().toISOString();

      // Sanitize toolCalls to remove client data (keep metadata only)
      const sanitizeToolCalls = (toolCalls: any[]) => {
        return toolCalls.map(tc => ({
          plugin: tc.plugin || 'unknown',
          action: tc.action || 'unknown',
          success: tc.success ?? true,
          itemsReturned: tc.result?.emails?.length ||
                         tc.result?.contacts?.length ||
                         tc.result?.events?.length ||
                         tc.result?.items?.length ||
                         tc.result?.length ||
                         (tc.result ? 1 : 0),
          executionTime: tc.executionTime || 0,
          error: tc.error || null
          // NO client data: no email subjects, bodies, contact names, etc.
        }));
      };

      // 1. Log execution to agent_executions table
      // IMPORTANT: Skip this for pilot executions - StateManager already logs to agent_executions
      // Pilot inserts via StateManager.completeExecution() with workflowExecution: true
      // Only AgentKit needs logging here since it doesn't use StateManager
      if (executionType !== 'pilot') {
        logger.debug({
          executor: executionType,
          tokensUsed: normalizedResult.tokensUsed,
          status: normalizedResult.success ? 'completed' : 'failed'
        }, 'Recording AgentKit execution to agent_executions table');

        const { error: insertError } = await executionRepository.create({
          agent_id: agent.id,
          user_id: user.id,
          execution_type: 'manual',
          status: normalizedResult.success ? 'completed' : 'failed',
          scheduled_at: now,
          started_at: new Date(Date.now() - normalizedResult.executionTime).toISOString(),
          completed_at: now,
          execution_duration_ms: normalizedResult.executionTime,
          error_message: normalizedResult.error || null,
          logs: {
            agentkit: true,
            iterations: normalizedResult.iterations,
            toolCalls: sanitizeToolCalls(normalizedResult.toolCalls),
            tokensUsed: normalizedResult.tokensUsed,
            model: normalizedResult.model || 'gpt-4o',
            provider: normalizedResult.provider || 'openai',
            inputValuesUsed: Object.keys(inputValues || {}).length
          }
        })

        if (insertError) {
          logger.error({ err: insertError }, 'Failed to log AgentKit execution')
        } else {
          logger.debug({ tokensUsed: normalizedResult.tokensUsed }, 'AgentKit execution logged successfully');
        }
      } else {
        logger.debug('Skipping agent_executions insert for pilot (StateManager already logged it)');
      }

      // 2. Log to agent_logs table for consistency with legacy system using repository
      logger.debug({ executor: executionType }, 'Inserting result to agent_logs');
      const { data: logData, error: logInsertError } = await agentLogsRepository.create({
        agent_id: agent.id,
        user_id: user.id,
        run_output: JSON.stringify(
          executionType === 'pilot' ? {
            success: normalizedResult.success,
            pilot: true,
            stepsCompleted: executionResult.stepsCompleted,
            stepsFailed: executionResult.stepsFailed,
            stepsSkipped: executionResult.stepsSkipped,
            totalSteps: executionResult.stepsCompleted + executionResult.stepsFailed + executionResult.stepsSkipped,
            tokensUsed: normalizedResult.tokensUsed.total,
            executionTimeMs: normalizedResult.executionTime,
            executionId: executionResult.executionId
          } : {
            success: normalizedResult.success,
            agentkit: true,
            iterations: normalizedResult.iterations,
            toolCallsCount: normalizedResult.toolCalls.length,
            tokensUsed: normalizedResult.tokensUsed.total,
            executionTimeMs: normalizedResult.executionTime,
            model: normalizedResult.model || 'gpt-4o',
            provider: normalizedResult.provider || 'openai'
          }
        ),
        full_output: executionType === 'pilot' ? {
          pilot_metadata: {
            executionId: executionResult.executionId,
            stepsCompleted: executionResult.stepsCompleted,
            stepsFailed: executionResult.stepsFailed,
            stepsSkipped: executionResult.stepsSkipped,
            totalSteps: executionResult.stepsCompleted + executionResult.stepsFailed + executionResult.stepsSkipped,
            tokensUsed: normalizedResult.tokensUsed
          }
        } : {
          agentkit_metadata: {
            model: normalizedResult.model || 'gpt-4o',
            provider: normalizedResult.provider || 'openai',
            iterations: normalizedResult.iterations,
            toolCalls: sanitizeToolCalls(normalizedResult.toolCalls),
            tokensUsed: normalizedResult.tokensUsed
          }
        },
        status: normalizedResult.success ? 'completed' : 'failed',
        created_at: now
      });

      if (logInsertError) {
        logger.error({ err: logInsertError, executor: executionType }, 'Failed to insert log into agent_logs');
      } else {
        logger.debug({ executor: executionType }, 'Log inserted to agent_logs successfully');
      }

      // 3. Update agent_stats with accurate success tracking using repository
      logger.debug('Updating agent_stats');
      const { error: statsError } = await agentStatsRepository.incrementStats(
        agent.id,
        user.id,
        normalizedResult.success
      )

      if (statsError) {
        logger.error({ err: statsError }, 'Failed to update agent_stats');
      } else {
        logger.debug('agent_stats updated successfully');
      }

      // 4. Track intensity metrics for dynamic pricing
      let intensityScore = 5.0; // Default medium intensity
      try {
        logger.debug({ tokensUsed: normalizedResult.tokensUsed.total }, 'Starting intensity metrics update');

        // Parse workflow complexity from agent definition
        const workflowSteps = agent.workflow_steps || [];
        const workflowComplexity = {
          steps: workflowSteps.length,
          branches: workflowSteps.filter((s: any) => s.type === 'conditional' || s.type === 'branch').length,
          loops: workflowSteps.filter((s: any) => s.type === 'loop' || s.type === 'iteration').length,
          parallel: workflowSteps.filter((s: any) => s.parallel === true).length,
        };

        // IMPORTANT: AIS should track adjusted tokens (what was charged) not raw tokens
        // This matches what users see in billing and execution results
        const rawTokens = normalizedResult.tokensUsed.total;
        const adjustedTokensForAIS = Math.ceil(rawTokens * (1.0 + (intensityScore / 10)));

        const executionData: AgentExecutionData = {
          agent_id: agent.id,
          user_id: user.id,
          tokens_used: adjustedTokensForAIS, // Use adjusted tokens for accurate billing tracking
          input_tokens: normalizedResult.tokensUsed.prompt || 0,
          output_tokens: normalizedResult.tokensUsed.completion || normalizedResult.tokensUsed.total,
          execution_duration_ms: normalizedResult.executionTime,
          iterations_count: normalizedResult.iterations,
          was_successful: normalizedResult.success,
          retry_count: 0,
          plugins_used: agent.plugins_required || [],
          tool_calls_count: executionType === 'pilot' ?
            (executionResult.stepsCompleted || 0) : normalizedResult.toolCalls.length,
          tool_orchestration_time_ms: executionType === 'pilot' ?
            normalizedResult.executionTime : 0,
          workflow_steps: workflowComplexity.steps,
          conditional_branches: workflowComplexity.branches,
          loop_iterations: workflowComplexity.loops,
          parallel_executions: workflowComplexity.parallel,
          memory_tokens: normalizedResult.memoryData?.tokens || 0,
          memory_entry_count: normalizedResult.memoryData?.entryCount || 0,
          memory_types: normalizedResult.memoryData?.types || [],
        };

        const aisResult = await updateAgentIntensityMetrics(supabase, executionData);
        if (aisResult.success) {
          intensityScore = aisResult.combined_score;
          logger.debug({ intensityScore: intensityScore.toFixed(2) }, 'Intensity metrics updated');
        } else {
          logger.warn({ defaultScore: intensityScore }, 'Intensity update failed - using default score');
        }
      } catch (intensityError) {
        logger.error({ err: intensityError, defaultScore: intensityScore }, 'Failed to update intensity metrics');
        // Non-fatal error - continue execution
      }

      // 5. Track token spending (stored as tokens in DB, displayed as Pilot Credits in UI)
      try {
        logger.debug('Tracking token consumption for execution');
        const tokensUsed = normalizedResult.tokensUsed.total;

        // Use CreditService to charge tokens with intensity (handles balance update + transaction logging)
        const { charged: adjustedTokens, multiplier: intensityMultiplier } = await creditService.chargeTokensWithIntensity(
          user.id,
          agent.id,
          tokensUsed,
          intensityScore,
          {
            executionType: executionType === 'pilot' ? 'Pilot' : 'AgentKit',
            agentName: agent.agent_name || 'Unnamed Agent'
          }
        );

        // Update agent_executions with adjusted tokens for UI display
        // This ensures all pages show the actual charged amount
        const executionIdToUpdate = executionType === 'pilot' ?
          executionResult.executionId : // Pilot uses the executionId from StateManager
          null; // AgentKit execution ID is auto-generated, we need to find it

        if (executionIdToUpdate) {
          const logsToUpdate = executionType === 'pilot' ? {
            success: true,
            executionTime: normalizedResult.executionTime,
            tokensUsed: {
              total: tokensUsed,
              prompt: 0,
              completion: 0,
              adjusted: adjustedTokens, // Add adjusted tokens with intensity
              intensityMultiplier: intensityMultiplier,
              intensityScore: intensityScore
            },
            iterations: 1,
            response: 'Workflow completed',
            model: 'workflow_orchestrator',
            provider: 'pilot',
            pilot: true,
            workflowExecution: true,
            stepsCompleted: executionResult.stepsCompleted,
            stepsFailed: executionResult.stepsFailed,
            stepsSkipped: executionResult.stepsSkipped,
            executionId: executionIdToUpdate
          } : {
            // AgentKit logs
            agentkit: true,
            iterations: normalizedResult.iterations,
            toolCalls: sanitizeToolCalls(normalizedResult.toolCalls),
            tokensUsed: {
              ...normalizedResult.tokensUsed,
              adjusted: adjustedTokens,
              intensityMultiplier: intensityMultiplier,
              intensityScore: intensityScore
            },
            model: normalizedResult.model || 'gpt-4o',
            provider: normalizedResult.provider || 'openai',
            inputValuesUsed: Object.keys(inputValues || {}).length
          };

          const { error: updateError } = await executionRepository.updateLogs(executionIdToUpdate, logsToUpdate);

          if (updateError) {
            logger.error({ err: updateError }, 'Failed to update agent_executions with adjusted tokens');
          } else {
            logger.debug({ adjustedTokens }, 'Updated agent_executions with adjusted tokens');
          }
        }

      } catch (spendingError) {
        logger.error({ err: spendingError }, 'Failed to track token consumption');
        // Non-fatal error - continue execution
      }

      // 📝 Audit Trail: Log agent execution (non-blocking)
      auditLog({
        action: 'AGENT_EXECUTED',
        entityType: 'agent',
        entityId: agent.id,
        userId: user.id,
        resourceName: agent.agent_name || 'Unnamed Agent',
        details: {
          execution_type: executionType,
          success: normalizedResult.success,
          tokens_used: normalizedResult.tokensUsed.total,
          duration_ms: normalizedResult.executionTime,
          manual: execution_type === 'manual',
          has_inputs: Object.keys(inputValues || {}).length > 0,
          // Execution-specific details
          ...(executionType === 'pilot' ? {
            steps_completed: executionResult.stepsCompleted,
            steps_failed: executionResult.stepsFailed,
            steps_skipped: executionResult.stepsSkipped
          } : {
            iterations: normalizedResult.iterations,
            tool_calls_count: normalizedResult.toolCalls.length
          })
        },
        severity: normalizedResult.success ? 'info' : 'warning'
        // Note: request context not available (using standard Request, not NextRequest)
      }).catch(err => {
        logger.warn({ err }, 'Audit log failed (non-blocking)');
      });

      // Fetch the execution record to get adjusted tokens (calculated in step 5 above)
      // This ensures we return the actual charged amount to the UI
      const executionIdForFetch = executionType === 'pilot' ? executionResult.executionId : null;
      let tokensToReturn = executionType === 'pilot' ? executionResult.totalTokensUsed : normalizedResult.tokensUsed.total;
      let rawTokensValue = tokensToReturn;
      let intensityMult = 1.0;

      if (executionIdForFetch) {
        // Fetch from database to get the adjusted tokens that were stored in step 5 using repository
        const { data: executionData } = await executionRepository.findById(executionIdForFetch);

        // Use adjusted tokens if available (from step 5 spending calculation)
        if (executionData?.logs?.tokensUsed?.adjusted) {
          tokensToReturn = executionData.logs.tokensUsed.adjusted; // Actual charged amount
          rawTokensValue = executionData.logs.tokensUsed.total; // Raw LLM tokens
          intensityMult = executionData.logs.tokensUsed.intensityMultiplier ?? 1.0; // Multiplier from intensity score (default 1.0)
          logger.debug({ adjustedTokens: tokensToReturn, rawTokens: rawTokensValue, multiplier: intensityMult.toFixed(2) }, 'Returning adjusted tokens');
        }
      }

      // Return unified response format
      return NextResponse.json({
        success: normalizedResult.success,
        message: normalizedResult.response,
        debugRunId: executionType === 'pilot' ? executionResult.debugRunId : undefined,
        data: executionType === 'pilot' ? {
          agent_id: agent.id,
          agent_name: agent.agent_name,
          execution_type: 'workflow_pilot',
          executionId: executionResult.executionId,
          stepsCompleted: executionResult.stepsCompleted,
          stepsFailed: executionResult.stepsFailed,
          stepsSkipped: executionResult.stepsSkipped,
          totalSteps: executionResult.stepsCompleted + executionResult.stepsFailed + executionResult.stepsSkipped,
          tokens_used: tokensToReturn, // Adjusted tokens (actual charged amount)
          raw_tokens: rawTokensValue, // Raw LLM tokens before intensity adjustment
          intensity_multiplier: intensityMult, // Intensity multiplier applied
          execution_time_ms: normalizedResult.executionTime,
          output: executionResult.output,
          // Include step IDs for visualization
          completedStepIds: executionResult.completedStepIds || [],
          failedStepIds: executionResult.failedStepIds || [],
          skippedStepIds: executionResult.skippedStepIds || [],
        } : {
          agent_id: agent.id,
          agent_name: agent.agent_name,
          execution_type: 'agentkit',
          tool_calls_count: normalizedResult.toolCalls.length,
          successful_tool_calls: normalizedResult.toolCalls.filter((tc: any) => tc.success).length,
          failed_tool_calls: normalizedResult.toolCalls.filter((tc: any) => !tc.success).length,
          tokens_used: tokensToReturn, // Adjusted tokens (actual charged amount)
          raw_tokens: rawTokensValue, // Raw LLM tokens before intensity adjustment
          intensity_multiplier: intensityMult, // Intensity multiplier applied
          execution_time_ms: normalizedResult.executionTime,
          iterations: normalizedResult.iterations,
          input_values_used: Object.keys(inputValues || {}).length
        },
        [executionType]: true
      });

    } catch (error: any) {
      logger.error({ err: error, executor: executionType }, 'Logging error');
      // Even if logging fails, return success if execution succeeded
      if (executionResult && normalizedResult.success) {
        return NextResponse.json({
          success: normalizedResult.success,
          message: normalizedResult.response,
          warning: 'Execution succeeded but logging failed',
          [executionType]: true
        });
      }
      throw error; // Re-throw if execution itself failed
    }
  }

  // **QUEUE-BASED EXECUTION PATH**
  if (use_queue) {
    // Check if running locally - QStash cannot send to localhost
    const isLocalDev = process.env.NODE_ENV === 'development' ||
                       process.env.VERCEL_ENV === undefined ||
                       !process.env.QSTASH_URL ||
                       !process.env.QSTASH_TOKEN

    if (isLocalDev) {
      logger.warn('QStash queue unavailable in local development - falling back to direct execution')

      // Fall through to immediate execution path below
      // Don't return here - let the immediate execution code run
    } else {
      logger.info({ useQueue: true }, 'Using queue-based execution')

      try {
      // Validate agent can be executed
      if (agent.status === 'archived') {
        return NextResponse.json({ error: 'Cannot execute archived agent' }, { status: 400 })
      }
      if (agent.status === 'inactive') {
        return NextResponse.json({ error: 'Cannot execute inactive agent' }, { status: 400 })
      }

      const executionUserId = provided_user_id || user.id

      // Check if agent is already running using repository
      const { data: runningExecutions, error: runningError } = await executionRepository.findRunningByAgentId(agent_id)

      if (runningError) {
        logger.error({ err: runningError }, 'Error checking running executions')
        return NextResponse.json(
          { error: 'Failed to check agent status', details: runningError.message },
          { status: 500 }
        )
      }

      if (runningExecutions && runningExecutions.length > 0) {
        return NextResponse.json(
          {
            error: 'Agent is already running',
            message: 'Please wait for the current execution to complete before starting a new one',
            currentExecutionId: runningExecutions[0].id
          },
          { status: 409 }
        )
      }

      // Create execution record using repository
      const scheduledAt = new Date().toISOString()
      const { data: execution, error: executionError } = await executionRepository.create({
        agent_id: agent.id,
        user_id: executionUserId,
        execution_type: 'manual',
        scheduled_at: scheduledAt,
        status: 'pending',
        cron_expression: agent.schedule_cron,
        progress: 0,
        logs: {
          created_via: 'manual_api_queue',
          requested_at: scheduledAt,
          ip_address: req.headers.get('x-forwarded-for') || 'unknown',
          input_variables: Object.keys(input_variables).length > 0 ? input_variables : null,
          override_user_prompt: override_user_prompt || null,
        }
      })

      if (executionError || !execution) {
        logger.error({ err: executionError }, 'Failed to create execution record')
        return NextResponse.json(
          { error: 'Failed to create execution record', details: executionError?.message },
          { status: 500 }
        )
      }

      // Add job to queue - FIXED: Use correct function name and parameters
      const { jobId, executionId } = await addManualExecution(
        agent.id,          // agentId
        executionUserId,   // userId
        execution.id,      // executionId
        input_variables,   // inputVariables
        override_user_prompt // overrideUserPrompt
      )

      logger.info({ executionId: execution.id, jobId, agentName: agent.agent_name }, 'Manual execution queued')

      return NextResponse.json({
        success: true,
        message: 'Agent execution queued successfully',
        data: {
          agent_id: agent.id,
          agent_name: agent.agent_name,
          execution_id: execution.id,
          job_id: jobId,
          execution_type: 'manual',
          status: 'pending',
          scheduled_at: scheduledAt,
          estimated_duration: '1-5 minutes',
        },
        queue_based: true,
      })

      } catch (queueError) {
        logger.error({ err: queueError }, 'Failed to queue agent job')
        return NextResponse.json(
          {
            error: 'Failed to queue agent execution',
            details: queueError instanceof Error ? queueError.message : 'Unknown error',
          },
          { status: 500 }
        )
      }
    }
  }

  // **EXISTING IMMEDIATE EXECUTION PATH** (preserves backward compatibility)
  logger.info('Using immediate execution (legacy path)')

  // Initialize execution tracking if execution_id provided
  if (execution_id) {
    logger.debug({ executionId: execution_id }, 'Starting execution tracking')

    // Update execution record to running status using repository
    const { error: execError } = await agentConfigurationRepository.updateStatus(execution_id, 'running')

    if (execError) {
      logger.error({ err: execError, executionId: execution_id }, 'Failed to update execution record to running')
    } else {
      logger.debug({ executionId: execution_id }, 'Execution record updated to running status')
    }
  }

  // Extract text from uploaded PDF (if exists)
  try {
    for (const key in input_variables) {
      const value = input_variables[key]
      if (
        typeof value === 'string' &&
        value.startsWith('data:application/pdf;base64,')
      ) {
        logger.info({ inputKey: key }, 'PDF upload detected, extracting text')
        
        if (execution_id) {
          const { error: logError } = await executionLogRepository.create({
            execution_id,
            agent_id: agent_id,
            user_id: user.id,
            timestamp: new Date().toISOString(),
            level: 'info',
            message: 'PDF upload detected, extracting text content',
            phase: 'documents'
          })

          if (logError) {
            logger.warn({ err: logError }, 'Failed to insert PDF detection log')
          }
        }

        const text = await extractPdfTextFromBase64(value)
        input_variables.__uploaded_file_text = text

        if (execution_id) {
          const { error: logError } = await executionLogRepository.create({
            execution_id,
            agent_id: agent_id,
            user_id: user.id,
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `PDF text extraction completed. Extracted ${text.length} characters`,
            phase: 'documents'
          })

          if (logError) {
            logger.warn({ err: logError }, 'Failed to insert PDF completion log')
          }
        }

        logger.info({ extractedChars: text.length }, 'PDF text extraction completed')
        break // Only process the first PDF for now
      }
    }
  } catch (err: any) {
    logger.error({ err }, 'Failed to extract PDF text')
    if (execution_id) {
      const { error: logError } = await executionLogRepository.create({
        execution_id,
        agent_id: agent_id,
        user_id: user.id,
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `PDF text extraction failed: ${err.message}`,
        phase: 'documents'
      })

      if (logError) {
        logger.warn({ err: logError }, 'Failed to insert PDF error log')
      }
    }
  }

  try {
    const startTime = Date.now()

    if (execution_id) {
      const { error: logError } = await executionLogRepository.create({
        execution_id,
        agent_id: agent_id,
        user_id: user.id,
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Starting agent execution with interpolated prompt',
        phase: 'prompt'
      })

      if (logError) {
        logger.warn({ err: logError }, 'Failed to insert start execution log')
      }
    }

    const { message, parsed_output, pluginContext, send_status } = await runAgentWithContext({
      supabase,
      agent,
      userId: user.id,
      input_variables,
      override_user_prompt,
    })

    const endTime = Date.now()
    const executionDuration = endTime - startTime

    if (execution_id) {
      const { error: logError } = await executionLogRepository.create({
        execution_id,
        agent_id: agent_id,
        user_id: user.id,
        timestamp: new Date().toISOString(),
        level: 'info',
        message: `Agent execution completed successfully in ${executionDuration}ms`,
        phase: 'validation'
      })

      if (logError) {
        logger.warn({ err: logError }, 'Failed to insert completion log')
      }

      // Update execution record with final metrics using repository
      const { error: updateError } = await agentConfigurationRepository.updateStatus(
        execution_id,
        'completed',
        { completedAt: new Date().toISOString(), durationMs: executionDuration }
      )

      if (updateError) {
        logger.error({ err: updateError, executionId: execution_id }, 'Failed to update execution completion')
      }
    }

    logger.debug('Inserting agent log')
    // Determine standardized status from descriptive send_status
    const isSuccess = send_status?.startsWith('✅') || send_status?.startsWith('📧') || send_status?.startsWith('🚨');
    const standardizedStatus = isSuccess ? 'completed' : 'failed';

    const { data: logData, error: logInsertError } = await agentLogsRepository.create({
      agent_id,
      user_id: user.id,
      run_output: parsed_output ? JSON.stringify(parsed_output) : null,
      full_output: message ? { message } : null,
      status: standardizedStatus as 'completed' | 'failed',
      status_message: send_status,
      execution_type: 'agentkit_legacy', // Mark as legacy AgentKit execution
      created_at: new Date().toISOString(),
    })

    if (logInsertError) {
      logger.error({ err: logInsertError }, 'Failed to insert agent log')
    } else {
      logger.debug({ logId: logData?.id }, 'Agent log inserted successfully')
      // Note: agent_output_context table removed for privacy compliance
      // We no longer store raw execution outputs (message, parsed_output, pluginContext)
    }

    logger.debug('Updating agent_stats')
    const { error: statsError } = await agentStatsRepository.incrementStats(
      agent_id,
      user.id,
      isSuccess
    )

    if (statsError) {
      logger.error({ err: statsError }, 'Failed to update agent_stats')
    } else {
      logger.debug({ success: isSuccess }, 'agent_stats updated')
    }

    // NOTE: Legacy execution path does not track intensity metrics
    // All agents should use AgentKit (use_agentkit: true) for proper intensity tracking
    logger.warn('Legacy execution path - intensity metrics not tracked (use AgentKit instead)')

    return NextResponse.json({
      result: {
        message,
        parsed_output,
        pluginContext,
        send_status,
      },
      execution_id: execution_id || null,
      queue_based: false,
    })

  } catch (err: any) {
    logger.error({ err }, 'runAgentWithContext error')

    if (execution_id) {
      const { error: logError } = await executionLogRepository.create({
        execution_id,
        agent_id: agent_id,
        user_id: user.id,
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `Critical error: ${err.message}`,
        phase: 'validation'
      })

      if (logError) {
        logger.warn({ err: logError }, 'Failed to insert error log')
      }

      // Update execution record as failed using repository
      const { error: updateError } = await agentConfigurationRepository.updateStatus(
        execution_id,
        'failed',
        { completedAt: new Date().toISOString() }
      )

      if (updateError) {
        logger.error({ err: updateError, executionId: execution_id }, 'Failed to update execution as failed')
      }
    }
    
    return NextResponse.json(
      { error: 'Failed to run agent using OpenAI' },
      { status: 500 }
    )
  }
}

/**
 * Get execution status for agents
 */
export async function GET(request: Request) {
  const logger = routeLogger.child({ method: 'GET' })

  try {
    const { searchParams } = new URL(request.url);
    const agent_id = searchParams.get('agent_id');
    const execution_id = searchParams.get('execution_id');
    const status_only = searchParams.get('status_only');

    logger.debug({ agentId: agent_id, executionId: execution_id, statusOnly: status_only }, 'Execution status request received')

    // If status_only is present but no agent_id or execution_id, return a valid JSON error
    if ((status_only === 'true' || status_only === '1') && !agent_id && !execution_id) {
      logger.warn('Status query missing required parameters')
      return NextResponse.json(
        { error: 'Must provide agent_id or execution_id for status query.' },
        { status: 400 }
      );
    }

    if (!agent_id && !execution_id) {
      logger.warn('Missing agent_id and execution_id')
      return NextResponse.json(
        { error: 'Must provide either agent_id or execution_id' },
        { status: 400 }
      );
    }

    const supabase = await createAuthenticatedServerClient();

    // Use ExecutionRepository for database query
    const executionRepo = new ExecutionRepository(supabase);
    const { data: executions, error } = await executionRepo.findForStatusQuery({
      executionId: execution_id || undefined,
      agentId: agent_id || undefined,
      limit: 5
    });

    if (error) {
      logger.error({ err: error, agentId: agent_id, executionId: execution_id }, 'Failed to fetch execution status')
      return NextResponse.json(
        { error: 'Failed to fetch execution status', details: error.message },
        { status: 500 }
      );
    }

    logger.debug({ count: executions?.length || 0 }, 'Execution status fetched successfully')

    return NextResponse.json({
      success: true,
      executions: executions || [],
      count: executions?.length || 0,
    });

  } catch (error) {
    logger.error({ err: error }, 'GET handler error')
    // Always return valid JSON, never HTML
    return NextResponse.json(
      { error: 'Internal server error', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// Prevent caching
export const dynamic = 'force-dynamic';