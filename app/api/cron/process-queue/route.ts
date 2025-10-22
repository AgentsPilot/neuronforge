// /app/api/cron/process-queue/route.ts
// Worker endpoint called by Upstash QStash to process agent execution jobs

import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { createServerClient } from '@supabase/ssr';
import { v4 as uuidv4 } from 'uuid';
import { runAgentWithContext } from '@/lib/utils/runAgentWithContext';
import { runAgentKit } from '@/lib/agentkit/runAgentKit'; // NEW: AgentKit execution
import { AgentJobData } from '@/lib/queues/qstashQueue';
import parser from 'cron-parser';

export const runtime = 'nodejs';
export const maxDuration = 60; // 60 seconds max (Vercel Pro limit)

// Create Supabase client
const supabase = createServerClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    cookies: {
      get: () => undefined,
      set: () => {},
      remove: () => {},
    },
  }
);

/**
 * Calculate the next run time for a cron expression
 */
function calculateNextRun(cronExpression: string, timezone: string = 'UTC'): Date {
  try {
    const interval = parser.parseExpression(cronExpression, {
      tz: timezone,
      currentDate: new Date(),
    });
    return interval.next().toDate();
  } catch (error) {
    console.error('Error parsing cron expression:', error);
    // Fallback: schedule for 1 hour from now
    return new Date(Date.now() + 60 * 60 * 1000);
  }
}

/**
 * Update agent_executions table with current status
 */
async function updateExecution(
  executionId: string,
  updates: {
    status?: 'pending' | 'running' | 'completed' | 'failed';
    started_at?: string;
    completed_at?: string;
    result?: any;
    error_message?: string;
    execution_duration_ms?: number;
    progress?: number;
    retry_count?: number;
  }
) {
  try {
    const { error } = await supabase
      .from('agent_executions')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', executionId);

    if (error) {
      console.error('Failed to update execution:', error);
    }
  } catch (error) {
    console.error('Error updating execution:', error);
  }
}

/**
 * Insert execution log entry
 */
async function insertExecutionLog(
  executionId: string,
  agentId: string,
  userId: string,
  level: 'info' | 'error' | 'warning',
  message: string,
  phase: string
) {
  try {
    const { error } = await supabase.from('agent_execution_logs').insert({
      execution_id: executionId,
      agent_id: agentId,
      user_id: userId,
      timestamp: new Date().toISOString(),
      level,
      message,
      phase
    });

    if (error) {
      console.error('Failed to insert execution log:', error);
    }
  } catch (error) {
    console.error('Error inserting execution log:', error);
  }
}

/**
 * Update agent stats (legacy support)
 */
async function updateAgentStats(agentId: string, userId: string, success: boolean) {
  try {
    const { error } = await supabase.rpc('increment_agent_stats', {
      agent_id_input: agentId,
      user_id_input: userId,
      success,
    });

    if (error) {
      console.error('Failed to update agent_stats:', error);
    }
  } catch (error) {
    console.error('Error updating agent stats:', error);
  }
}

/**
 * Update agents table with last_run and next_run
 */
async function updateAgentRunTimes(
  agentId: string,
  lastRun: Date,
  cronExpression?: string,
  timezone: string = 'UTC'
) {
  try {
    const updates: any = {
      last_run: lastRun.toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Calculate next_run for scheduled agents
    if (cronExpression) {
      updates.next_run = calculateNextRun(cronExpression, timezone).toISOString();
    }

    const { error } = await supabase
      .from('agents')
      .update(updates)
      .eq('id', agentId);

    if (error) {
      console.error('Failed to update agent run times:', error);
    }
  } catch (error) {
    console.error('Error updating agent run times:', error);
  }
}

/**
 * Main job processor function
 */
async function processAgentJob(jobData: AgentJobData) {
  const { agent_id, user_id, execution_id, execution_type, cron_expression, timezone } = jobData;
  const startTime = new Date();

  console.log(`🚀 Starting ${execution_type} execution for agent ${agent_id}`, {
    executionId: execution_id,
    userId: user_id,
    source: 'QStash',
  });

  try {
    // 1. Mark execution as running
    await updateExecution(execution_id, {
      status: 'running',
      started_at: startTime.toISOString(),
      progress: 0,
    });

    await insertExecutionLog(
      execution_id,
      agent_id,
      user_id,
      'info',
      `Starting ${execution_type} execution`,
      'initialization'
    );

    // 2. Fetch agent data from Supabase
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agent_id)
      .single();

    if (agentError || !agent) {
      throw new Error(`Agent not found: ${agentError?.message || 'Unknown error'}`);
    }

    // 3. Validate agent is still active
    if (agent.status === 'archived' || agent.status === 'inactive') {
      throw new Error(`Agent is ${agent.status} and cannot be executed`);
    }

    await insertExecutionLog(
      execution_id,
      agent_id,
      user_id,
      'info',
      `Executing agent: ${agent.agent_name}`,
      'execution'
    );

    // 4. Execute the agent using AgentKit or legacy system
    const useAgentKit = jobData.use_agentkit || false;
    console.log(`🤖 Executing agent: ${agent.agent_name} ${useAgentKit ? '(AgentKit)' : '(Legacy)'}`);

    // Update progress before execution
    await updateExecution(execution_id, { progress: 25 });

    let executionResult: any;

    if (useAgentKit) {
      // NEW: Execute with OpenAI AgentKit

      // Fetch agent_configurations for input values
      const { data: agentConfig } = await supabase
        .from('agent_configurations')
        .select('input_values, input_schema')
        .eq('agent_id', agent_id)
        .eq('user_id', user_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const userInput = jobData.override_user_prompt || agent.user_prompt;
      const inputValues = agentConfig?.input_values || {};

      console.log(`📋 AgentKit: Found ${Object.keys(inputValues).length} input values from configuration`);

      // Generate session ID for analytics tracking (UUID format)
      const sessionId = uuidv4()

      const agentkitResult = await runAgentKit(
        user_id,
        {
          id: agent.id,
          agent_name: agent.agent_name,
          system_prompt: agent.system_prompt,
          enhanced_prompt: agent.enhanced_prompt,
          user_prompt: agent.user_prompt,
          plugins_required: agent.plugins_required || [],
          input_schema: agent.input_schema || agentConfig?.input_schema,
          output_schema: agent.output_schema,
          trigger_condintion: agent.trigger_condintion // Pass notification preference
        },
        userInput,
        inputValues, // Pass input values from agent_configurations
        sessionId // Pass session ID for analytics tracking
      );

      // Convert AgentKit result to legacy format for compatibility
      executionResult = {
        success: agentkitResult.success,
        message: agentkitResult.response,
        agentkit: true,
        iterations: agentkitResult.iterations,
        toolCalls: agentkitResult.toolCalls,
        tokensUsed: agentkitResult.tokensUsed,
        send_status: agentkitResult.success ? '✅ Completed' : '❌ Failed'
      };
    } else {
      // Legacy execution with runAgentWithContext
      executionResult = await runAgentWithContext({
        supabase,
        agent,
        userId: user_id,
        input_variables: jobData.input_variables || {},
        override_user_prompt: jobData.override_user_prompt,
      });
    }

    // Update progress after execution
    await updateExecution(execution_id, { progress: 75 });

    // 5. Calculate execution duration
    const endTime = new Date();
    const executionDurationMs = endTime.getTime() - startTime.getTime();

    // 6. Mark execution as completed
    await updateExecution(execution_id, {
      status: 'completed',
      completed_at: endTime.toISOString(),
      result: executionResult,
      execution_duration_ms: executionDurationMs,
      progress: 100,
    });

    await insertExecutionLog(
      execution_id,
      agent_id,
      user_id,
      'info',
      `Execution completed successfully in ${executionDurationMs}ms`,
      'completion'
    );

    // 7. Update agent's last_run and next_run times
    await updateAgentRunTimes(agent_id, endTime, cron_expression, timezone);

    // 8. Update stats
    const success = executionResult?.send_status?.startsWith('✅') ||
                   executionResult?.send_status?.startsWith('📧') ||
                   executionResult?.send_status?.startsWith('🚨');

    await updateAgentStats(agent_id, user_id, success);

    console.log(`✅ Successfully completed ${execution_type} execution for agent ${agent_id}`, {
      executionId: execution_id,
      duration: `${executionDurationMs}ms`,
    });

    return {
      success: true,
      executionId: execution_id,
      duration: executionDurationMs,
      result: executionResult,
    };

  } catch (error) {
    const endTime = new Date();
    const executionDurationMs = endTime.getTime() - startTime.getTime();
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    console.error(`❌ Failed ${execution_type} execution for agent ${agent_id}:`, {
      executionId: execution_id,
      error: errorMessage,
      duration: `${executionDurationMs}ms`,
    });

    // Update execution as failed
    await updateExecution(execution_id, {
      status: 'failed',
      completed_at: endTime.toISOString(),
      error_message: errorMessage,
      execution_duration_ms: executionDurationMs,
    });

    await insertExecutionLog(
      execution_id,
      agent_id,
      user_id,
      'error',
      `Execution failed: ${errorMessage}`,
      'error'
    );

    // Still update agent's last_run time even on failure
    await updateAgentRunTimes(agent_id, endTime, cron_expression, timezone);

    // Update stats for failed execution
    await updateAgentStats(agent_id, user_id, false);

    // Re-throw error for QStash retry handling
    throw error;
  }
}

/**
 * POST handler - Called by QStash to process a job
 */
async function handler(req: NextRequest) {
  try {
    const body: AgentJobData = await req.json();

    // Extract QStash retry count from headers
    const retryCount = parseInt(req.headers.get('upstash-retried') || '0');
    const isRetry = retryCount > 0;

    console.log('📨 Received job from QStash:', {
      agent_id: body.agent_id,
      execution_id: body.execution_id,
      execution_type: body.execution_type,
      retry_count: retryCount,
      is_retry: isRetry,
    });

    // Update execution with retry count
    if (isRetry) {
      await updateExecution(body.execution_id, {
        retry_count: retryCount,
        status: 'running',
      });

      await insertExecutionLog(
        body.execution_id,
        body.agent_id,
        body.user_id,
        'warning',
        `Retry attempt ${retryCount}/3 after previous failure`,
        'retry'
      );
    }

    // Process the job
    const result = await processAgentJob(body);

    return NextResponse.json(result);

  } catch (error) {
    console.error('❌ Error processing job:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 } // Will trigger QStash retry
    );
  }
}

// Verify QStash signature in production
export const POST = process.env.NODE_ENV === 'production'
  ? verifySignatureAppRouter(handler)
  : handler;
