// /app/api/run-agent/route.ts
// Enhanced agent runner supporting both immediate execution and queue-based execution

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { v4 as uuidv4 } from 'uuid'
import { runAgentWithContext } from '@/lib/utils/runAgentWithContext'
import { extractPdfTextFromBase64 } from '@/lib/utils/extractPdfTextFromBase64'
import { addManualExecution } from '@/lib/queues/qstashQueue'
import { runAgentKit } from '@/lib/agentkit/runAgentKit' // NEW: AgentKit execution
import { updateAgentIntensityMetrics } from '@/lib/utils/updateAgentIntensity'
import type { AgentExecutionData } from '@/lib/types/intensity'
import { WorkflowPilot } from '@/lib/pilot'
import { SystemConfigService } from '@/lib/services/SystemConfigService'
import { auditLog } from '@/lib/services/AuditTrailService'

export const runtime = 'nodejs'

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
    session_id: provided_session_id // NEW: For SSE correlation
  } = body

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: async () => {},
        remove: async () => {},
      },
    }
  )

  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch agent
  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agent_id)
    .single()

  if (agentError || !agent) {
    console.error('❌ Agent fetch error:', agentError)
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  // **UNIFIED EXECUTION PATH**
  // Determine which executor to use and execute
  let executionResult: any = null;
  let executionType: 'pilot' | 'agentkit' = 'agentkit';
  let shouldExecute = true;
  let inputValues: Record<string, any> = {}; // Shared across both execution paths
  let inputSchema: any = null;

  // Check if agent has workflow_steps AND pilot is enabled
  const hasWorkflowSteps = agent.workflow_steps && Array.isArray(agent.workflow_steps) && agent.workflow_steps.length > 0;

  if (hasWorkflowSteps) {
    console.log(`🔍 Agent has ${agent.workflow_steps.length} workflow steps - checking pilot status...`);

    // Check if pilot is enabled in system config
    const pilotEnabled = await SystemConfigService.getBoolean(
      supabase,
      'pilot_enabled',
      false // Default: disabled for safety
    );

    if (pilotEnabled && !use_agentkit) {
      console.log(`🎯 Using Workflow Pilot for agent "${agent.agent_name}" (${agent_id})`);

      try {
        const userInput = override_user_prompt || agent.user_prompt;

        // Determine input source based on execution type (same logic as AgentKit)
        if (execution_type === 'test') {
          // TEST MODE: Use values from UI
          inputValues = input_variables || {};
          inputSchema = agent.input_schema;
          console.log(`📋 Pilot TEST MODE: Using ${Object.keys(inputValues).length} input values from UI`);
        } else {
          // RUN MODE: Fetch saved configuration
          const { data: agentConfig } = await supabase
            .from('agent_configurations')
            .select('input_values, input_schema')
            .eq('agent_id', agent_id)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          inputValues = agentConfig?.input_values || {};
          inputSchema = agent.input_schema || agentConfig?.input_schema;
          console.log(`📋 Pilot RUN MODE: Using ${Object.keys(inputValues).length} input values from saved configuration`);
        }

        // Use provided session_id for SSE correlation, or generate new one
        const sessionId = provided_session_id || uuidv4();
        console.log(`📋 Using session_id: ${sessionId} ${provided_session_id ? '(from request)' : '(generated)'}`);

        // Execute using WorkflowPilot
        const pilot = new WorkflowPilot(supabase);
        executionResult = await pilot.execute(
          agent, // Pass full agent object
          user.id,
          userInput,
          inputValues,
          sessionId
        );

        executionType = 'pilot';
        shouldExecute = false; // Don't execute AgentKit

      } catch (error: any) {
        console.error('❌ WorkflowPilot execution error:', error);

        // If pilot is disabled, fall through to AgentKit
        if (error.message?.includes('disabled in system configuration')) {
          console.warn('⚠️  Pilot disabled - falling back to AgentKit');
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
      console.warn(`⚠️  Agent has workflow_steps but pilot is disabled - falling back to AgentKit`);
      // Fall through to AgentKit execution
    }
  }

  // **AGENTKIT EXECUTION PATH**
  // Execute with AgentKit if pilot didn't execute (shouldExecute is still true)
  if (shouldExecute) {
    console.log(`🤖 Using AgentKit execution for agent "${agent.agent_name}" (${agent_id})`)

    try {
      const userInput = override_user_prompt || agent.user_prompt

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
        console.log(`📋 AgentKit TEST MODE: Using ${Object.keys(inputValues).length} input values from UI (not saved)`, inputValues)
      } else {
        // RUN MODE (AgentSandbox Run / AgentList / Scheduled): Fetch saved configuration
        const { data: agentConfig, error: configError } = await supabase
          .from('agent_configurations')
          .select('input_values, input_schema')
          .eq('agent_id', agent_id)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        inputValues = agentConfig?.input_values || {}
        inputSchema = agent.input_schema || agentConfig?.input_schema
        console.log(`📋 AgentKit RUN MODE (${execution_type || 'scheduled'}): Using ${Object.keys(inputValues).length} input values from saved configuration`, inputValues)
      }

      // Generate session ID for analytics tracking (UUID format)
      const sessionId = uuidv4()

      // Execute using OpenAI AgentKit with V2 Plugin System
      executionResult = await runAgentKit(
        user.id,
        {
          id: agent.id,
          agent_name: agent.agent_name,
          system_prompt: agent.system_prompt,
          enhanced_prompt: agent.enhanced_prompt,
          user_prompt: agent.user_prompt,
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
      const triggerConfig = agent.trigger_condintion?.error_handling || {};
      const shouldSendEmail = triggerConfig.on_failure === 'email';

      if (shouldSendEmail && executionResult.success) {
        console.log('📧 AgentKit: Sending result via email as per trigger_condintion');

        // The result already contains the response - no need to send it again
        // The email should have been sent by the agent itself during execution
        // Just log that email delivery was configured
      }

    } catch (error: any) {
      console.error('❌ AgentKit execution error:', error)
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
        console.log(`[RUN-AGENT] 💾 Recording AgentKit execution to agent_executions table:`, {
          agent_id: agent.id,
          execution_type: executionType,
          tokensUsed: normalizedResult.tokensUsed,
          status: normalizedResult.success ? 'completed' : 'failed'
        });

        const { error: insertError } = await supabase.from('agent_executions').insert({
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
          console.error('[RUN-AGENT] ❌ Failed to log AgentKit execution:', insertError)
        } else {
          console.log(`[RUN-AGENT] ✅ Successfully logged AgentKit execution with tokens in logs.tokensUsed:`, normalizedResult.tokensUsed);
        }
      } else {
        console.log(`[RUN-AGENT] ⏭️  Skipping agent_executions insert for pilot (StateManager already logged it)`);
      }

      // 2. Log to agent_logs table for consistency with legacy system
      console.log(`🪵 Inserting ${executionType} result to agent_logs...`);
      const { data: logData, error: logInsertError } = await supabase
        .from('agent_logs')
        .insert({
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
          // status_message: REMOVED - Column doesn't exist in agent_logs schema
          // execution_type: REMOVED - Column doesn't exist in schema yet
          created_at: now
        })
        .select('id')
        .single();

      if (logInsertError) {
        console.error(`❌ Failed to insert ${executionType} log into agent_logs:`, logInsertError);
      } else {
        console.log(`✅ ${executionType} log inserted successfully`);
      }

      // 3. Update agent_stats with accurate success tracking
      console.log('📊 Updating agent_stats...');
      const { error: statsError } = await supabase.rpc('increment_agent_stats', {
         agent_id_input: agent.id,
        user_id_input: user.id,
        success: normalizedResult.success,
      })

      if (statsError) {
        console.error('❌ Failed to update agent_stats:', statsError);
      } else {
        console.log('✅ agent_stats updated successfully');
      }

      // 4. Track intensity metrics for dynamic pricing
      let intensityScore = 5.0; // Default medium intensity
      try {
        console.log('📊 [INTENSITY] Starting update for agent:', agent.id);
        console.log('📊 [INTENSITY] Tokens used:', normalizedResult.tokensUsed.total);

        // Parse workflow complexity from agent definition
        const workflowSteps = agent.workflow_steps || [];
        const workflowComplexity = {
          steps: workflowSteps.length,
          branches: workflowSteps.filter((s: any) => s.type === 'conditional' || s.type === 'branch').length,
          loops: workflowSteps.filter((s: any) => s.type === 'loop' || s.type === 'iteration').length,
          parallel: workflowSteps.filter((s: any) => s.parallel === true).length,
        };

        const executionData: AgentExecutionData = {
          agent_id: agent.id,
          user_id: user.id,
          tokens_used: normalizedResult.tokensUsed.total,
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
          console.log('✅ [INTENSITY] Update SUCCESS - Combined Score:', intensityScore.toFixed(2));
        } else {
          console.log('❌ [INTENSITY] Update FAILED - using default score:', intensityScore);
        }
      } catch (intensityError) {
        console.error('❌ Failed to update intensity metrics:', intensityError);
        console.log('⚠️  Using default intensity score:', intensityScore);
        // Non-fatal error - continue execution
      }

      // 5. Track token spending (stored as tokens in DB, displayed as Pilot Credits in UI)
      try {
        console.log('💰 [SPENDING] Tracking token consumption for execution');
        const tokensUsed = normalizedResult.tokensUsed.total;

        // Calculate what these tokens represent for display purposes (tokens stored in DB)
        const intensityMultiplier = 1.0 + (intensityScore / 10);
        const adjustedTokens = Math.ceil(tokensUsed * intensityMultiplier);

        console.log('💰 [SPENDING] Token calculation:', {
          rawTokens: tokensUsed,
          intensityScore,
          intensityMultiplier,
          adjustedTokens
        });

        // Get current balance and total_spent (stored as tokens)
        const { data: currentSub } = await supabase
          .from('user_subscriptions')
          .select('balance, total_spent')
          .eq('user_id', user.id)
          .single();

        const currentBalance = currentSub?.balance || 0;
        const currentTotalSpent = currentSub?.total_spent || 0;
        const newBalance = currentBalance - adjustedTokens;
        const newTotalSpent = currentTotalSpent + adjustedTokens;

        // Update BOTH balance and total_spent with tokens (UI will convert to Pilot Credits for display)
        const { error: updateError } = await supabase
          .from('user_subscriptions')
          .update({
            balance: newBalance,
            total_spent: newTotalSpent,
            agents_paused: newBalance <= 0
          })
          .eq('user_id', user.id);

        if (updateError) {
          console.error('❌ [SPENDING] Failed to update balance and total_spent:', updateError);
        } else {
          console.log(`✅ [SPENDING] Token spending tracked: ${adjustedTokens} tokens`);
          console.log(`   Balance: ${currentBalance} → ${newBalance} tokens`);
          console.log(`   Total Spent: ${currentTotalSpent} → ${newTotalSpent} tokens`);
        }

        // Log transaction for audit trail (stored as tokens)
        const { error: txError } = await supabase.from('credit_transactions').insert({
          user_id: user.id,
          agent_id: agent.id,
          credits_delta: -adjustedTokens, // Stored as tokens
          balance_before: currentBalance,
          balance_after: newBalance,
          transaction_type: 'deduction', // DB constraint requires 'deduction' for charges
          activity_type: 'agent_execution',
          description: `${executionType === 'pilot' ? 'Pilot' : 'AgentKit'} execution: ${tokensUsed} tokens × ${intensityMultiplier.toFixed(2)} intensity`,
          metadata: {
            execution_type: executionType,
            raw_tokens: tokensUsed,
            intensity_score: intensityScore,
            multiplier: intensityMultiplier,
            adjusted_tokens: adjustedTokens,
            agent_name: agent.agent_name
          }
        });

        if (txError) {
          console.error('❌ [SPENDING] Failed to log transaction:', txError);
        } else {
          console.log('✅ [SPENDING] Transaction logged successfully');
        }

      } catch (spendingError) {
        console.error('❌ [SPENDING] Failed to track token consumption:', spendingError);
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
        console.error('⚠️ Audit log failed (non-blocking):', err);
      });

      // Return unified response format
      return NextResponse.json({
        success: normalizedResult.success,
        message: normalizedResult.response,
        data: executionType === 'pilot' ? {
          agent_id: agent.id,
          agent_name: agent.agent_name,
          execution_type: 'workflow_pilot',
          executionId: executionResult.executionId,
          stepsCompleted: executionResult.stepsCompleted,
          stepsFailed: executionResult.stepsFailed,
          stepsSkipped: executionResult.stepsSkipped,
          totalSteps: executionResult.stepsCompleted + executionResult.stepsFailed + executionResult.stepsSkipped,
          tokens_used: normalizedResult.tokensUsed.total,
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
          tokens_used: normalizedResult.tokensUsed.total,
          execution_time_ms: normalizedResult.executionTime,
          iterations: normalizedResult.iterations,
          input_values_used: Object.keys(inputValues || {}).length
        },
        [executionType]: true
      });

    } catch (error: any) {
      console.error(`❌ ${executionType} logging error:`, error);
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
      console.log('⚠️  QStash queue unavailable in local development - falling back to direct execution')
      console.log(`⚡ Using immediate execution for agent ${agent_id} (local dev fallback)`)

      // Fall through to immediate execution path below
      // Don't return here - let the immediate execution code run
    } else {
      console.log(`🔄 Using queue-based execution for agent ${agent_id}`)

      try {
      // Validate agent can be executed
      if (agent.status === 'archived') {
        return NextResponse.json({ error: 'Cannot execute archived agent' }, { status: 400 })
      }
      if (agent.status === 'inactive') {
        return NextResponse.json({ error: 'Cannot execute inactive agent' }, { status: 400 })
      }

      const executionUserId = provided_user_id || user.id

      // Check if agent is already running
      const { data: runningExecutions, error: runningError } = await supabase
        .from('agent_executions')
        .select('id')
        .eq('agent_id', agent_id)
        .in('status', ['pending', 'running'])
        .limit(1)

      if (runningError) {
        console.error('Error checking running executions:', runningError)
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

      // Create execution record in new table
      const scheduledAt = new Date().toISOString()
      const { data: execution, error: executionError } = await supabase
        .from('agent_executions')
        .insert({
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
        .select('id')
        .single()

      if (executionError || !execution) {
        console.error('Failed to create execution record:', executionError)
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

      console.log(`✅ Queued manual execution for agent ${agent.agent_name}`, {
        agentId: agent.id,
        executionId: execution.id,
        jobId,
      })

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
        console.error('Failed to queue agent job:', queueError)
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
  console.log(`⚡ Using immediate execution for agent ${agent_id}`)

  // Initialize execution tracking if execution_id provided
  if (execution_id) {
    console.log(`🚀 Starting execution tracking for: ${execution_id}`)
    
    // Update execution record to running status
    const { error: execError } = await supabase
      .from('agent_configurations')
      .update({
        status: 'running',
        created_at: new Date().toISOString()
      })
      .eq('id', execution_id)

    if (execError) {
      console.error('❌ Failed to update execution record:', execError)
    } else {
      console.log('✅ Execution record updated to running status')
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
        console.log('📄 Detected PDF upload, extracting text...')
        
        if (execution_id) {
          const { error: logError } = await supabase.from('agent_execution_logs').insert({
            execution_id,
            agent_id: agent_id,
            user_id: user.id,
            timestamp: new Date().toISOString(),
            level: 'info',
            message: 'PDF upload detected, extracting text content',
            phase: 'documents'
          })
          
          if (logError) {
            console.error('Failed to insert PDF detection log:', logError)
          }
        }
        
        const text = await extractPdfTextFromBase64(value)
        input_variables.__uploaded_file_text = text
        
        if (execution_id) {
          const { error: logError } = await supabase.from('agent_execution_logs').insert({
            execution_id,
            agent_id: agent_id,
            user_id: user.id,
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `PDF text extraction completed. Extracted ${text.length} characters`,
            phase: 'documents'
          })
          
          if (logError) {
            console.error('Failed to insert PDF completion log:', logError)
          }
        }
        break // Only process the first PDF for now
      }
    }
  } catch (err: any) {
    console.error('❌ Failed to extract PDF text:', err)
    if (execution_id) {
      const { error: logError } = await supabase.from('agent_execution_logs').insert({
        execution_id,
        agent_id: agent_id,
        user_id: user.id,
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `PDF text extraction failed: ${err.message}`,
        phase: 'documents'
      })
      
      if (logError) {
        console.error('Failed to insert PDF error log:', logError)
      }
    }
  }

  try {
    const startTime = Date.now()

    if (execution_id) {
      const { error: logError } = await supabase.from('agent_execution_logs').insert({
        execution_id,
        agent_id: agent_id,
        user_id: user.id,
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Starting agent execution with interpolated prompt',
        phase: 'prompt'
      })
      
      if (logError) {
        console.error('Failed to insert start execution log:', logError)
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
      const { error: logError } = await supabase.from('agent_execution_logs').insert({
        execution_id,
        agent_id: agent_id,
        user_id: user.id,
        timestamp: new Date().toISOString(),
        level: 'info',
        message: `Agent execution completed successfully in ${executionDuration}ms`,
        phase: 'validation'
      })
      
      if (logError) {
        console.error('Failed to insert completion log:', logError)
      }

      // Update execution record with final metrics
      const { error: updateError } = await supabase.from('agent_configurations').update({
        status: 'completed',
        duration_ms: executionDuration,
        completed_at: new Date().toISOString()
      }).eq('id', execution_id)
      
      if (updateError) {
        console.error('Failed to update execution completion:', updateError)
      }
    }

    console.log('🪵 Inserting agent log...')
    // Determine standardized status from descriptive send_status
    const isSuccess = send_status?.startsWith('✅') || send_status?.startsWith('📧') || send_status?.startsWith('🚨');
    const standardizedStatus = isSuccess ? 'completed' : 'failed';

    const { data: logData, error: logInsertError } = await supabase
      .from('agent_logs')
      .insert({
        agent_id,
        user_id: user.id,
        run_output: parsed_output ? JSON.stringify(parsed_output) : null,
        full_output: message ? { message } : null,
        status: standardizedStatus, // Standardized: 'completed' or 'failed'
        status_message: send_status, // Descriptive message for display
        execution_type: 'agentkit_legacy', // Mark as legacy AgentKit execution
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (logInsertError) {
      console.error('❌ Failed to insert log into agent_logs:', logInsertError)
    } else {
      console.log('✅ Agent log inserted successfully')
      // Note: agent_output_context table removed for privacy compliance
      // We no longer store raw execution outputs (message, parsed_output, pluginContext)
    }

    console.log('📊 Updating agent_stats...')
    const { error: statsError } = await supabase.rpc('increment_agent_stats', {
      agent_id_input: agent_id,
      user_id_input: user.id,
      success: isSuccess,
    })

    if (statsError) {
      console.error('❌ Failed to update agent_stats:', statsError)
    } else {
      console.log('✅ agent_stats updated')
    }

    // NOTE: Legacy execution path does not track intensity metrics
    // All agents should use AgentKit (use_agentkit: true) for proper intensity tracking
    console.log('⚠️ Legacy execution path - intensity metrics not tracked (use AgentKit instead)');

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
    console.error('❌ runAgentWithContext error:', err)
    
    if (execution_id) {
      const { error: logError } = await supabase.from('agent_execution_logs').insert({
        execution_id,
        agent_id: agent_id,
        user_id: user.id,
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `Critical error: ${err.message}`,
        phase: 'validation'
      })
      
      if (logError) {
        console.error('Failed to insert error log:', logError)
      }

      // Update execution record as failed
      const { error: updateError } = await supabase.from('agent_configurations').update({
        status: 'failed',
        completed_at: new Date().toISOString()
      }).eq('id', execution_id)
      
      if (updateError) {
        console.error('Failed to update execution as failed:', updateError)
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
  try {
    const { searchParams } = new URL(request.url);
    const agent_id = searchParams.get('agent_id');
    const execution_id = searchParams.get('execution_id');
    const status_only = searchParams.get('status_only');

    // If status_only is present but no agent_id or execution_id, return a valid JSON error
    if ((status_only === 'true' || status_only === '1') && !agent_id && !execution_id) {
      return NextResponse.json(
        { error: 'Must provide agent_id or execution_id for status query.' },
        { status: 400 }
      );
    }

    if (!agent_id && !execution_id) {
      return NextResponse.json(
        { error: 'Must provide either agent_id or execution_id' },
        { status: 400 }
      );
    }

    // Check required env vars
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.json(
        { error: 'Supabase environment variables missing' },
        { status: 500 }
      );
    }

    let cookieStore;
    try {
      cookieStore = await cookies();
    } catch (cookieError) {
      return NextResponse.json(
        { error: 'Failed to get cookies', details: cookieError instanceof Error ? cookieError.message : String(cookieError) },
        { status: 500 }
      );
    }

    let supabase;
    try {
      supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            get: (name) => cookieStore.get(name)?.value,
            set: async () => {},
            remove: async () => {},
          },
        }
      );
    } catch (supabaseError) {
      return NextResponse.json(
        { error: 'Failed to create Supabase client', details: supabaseError instanceof Error ? supabaseError.message : String(supabaseError) },
        { status: 500 }
      );
    }

    let query = supabase
      .from('agent_executions')
      .select('id, agent_id, execution_type, status, progress, scheduled_at, started_at, completed_at, error_message, execution_duration_ms, retry_count')
      .order('created_at', { ascending: false });

    if (execution_id) {
      query = query.eq('id', execution_id);
    } else if (agent_id) {
      query = query.eq('agent_id', agent_id).limit(5); // Last 5 executions
    }

    const { data: executions, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch execution status', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      executions: executions || [],
      count: executions?.length || 0,
    });

  } catch (error) {
    // Always return valid JSON, never HTML
    return NextResponse.json(
      { error: 'Internal server error', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// Prevent caching
export const dynamic = 'force-dynamic';