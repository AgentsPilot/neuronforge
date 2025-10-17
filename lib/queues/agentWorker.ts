// /lib/queue/agentWorker.ts
// Enhanced BullMQ worker that supports both legacy and unified execution tracking

import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { createServerClient } from '@supabase/ssr'
import { runAgentWithContext } from '@/lib/utils/runAgentWithContext';
import { AgentJobData } from './agentQueue';
import parser from 'cron-parser';

// Redis connection - FIXED to use proper Redis URL
const connection = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  retryDelayOnFailover: 100,
  lazyConnect: true,
  connectTimeout: 10000,
  commandTimeout: 30000, // Increase from 5000 to 30000
  enableReadyCheck: false,
  maxLoadingTimeout: 10000,
});
// Create Supabase client for worker
const supabase = createServerClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // Use service role for worker
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
    logs?: any;
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
      throw error;
    }
  } catch (error) {
    console.error('Error updating execution:', error);
    throw error;
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
 * Insert agent log entry (legacy support)
 */
async function insertAgentLog(
  agentId: string,
  userId: string,
  parsed_output: any,
  message: string,
  send_status: string
) {
  try {
    const { data: logData, error: logInsertError } = await supabase
      .from('agent_logs')
      .insert({
        agent_id: agentId,
        user_id: userId,
        run_output: parsed_output ? JSON.stringify(parsed_output) : null,
        full_output: message ? { message } : null,
        status: send_status,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (logInsertError) {
      console.error('Failed to insert agent log:', logInsertError);
      return null;
    }

    return logData?.id;
  } catch (error) {
    console.error('Error inserting agent log:', error);
    return null;
  }
}

/**
 * Insert agent output context (legacy support)
 */
async function insertAgentOutputContext(
  logId: string,
  agentId: string,
  userId: string,
  message: string,
  parsed_output: any,
  pluginContext: any,
  input_variables: any
) {
  try {
    const contextEntries = [];
    
    if (message) {
      contextEntries.push({
        user_id: userId,
        source_agent_id: agentId,
        run_id: logId,
        context_key: 'agent_message',
        context_data: { message }
      });
    }
    
    if (parsed_output) {
      contextEntries.push({
        user_id: userId,
        source_agent_id: agentId,
        run_id: logId,
        context_key: 'parsed_output',
        context_data: parsed_output
      });
    }
    
    if (pluginContext && Object.keys(pluginContext).length > 0) {
      contextEntries.push({
        user_id: userId,
        source_agent_id: agentId,
        run_id: logId,
        context_key: 'plugin_context',
        context_data: pluginContext
      });
    }
    
    if (input_variables && Object.keys(input_variables).length > 0) {
      contextEntries.push({
        user_id: userId,
        source_agent_id: agentId,
        run_id: logId,
        context_key: 'input_variables',
        context_data: input_variables
      });
    }

    if (contextEntries.length > 0) {
      const { error: contextInsertError } = await supabase
        .from('agent_output_context')
        .insert(contextEntries);

      if (contextInsertError) {
        console.error('Failed to insert agent output context:', contextInsertError);
      }
    }
  } catch (error) {
    console.error('Error inserting agent output context:', error);
  }
}

/**
 * Update agent stats (legacy support)
 */
async function updateAgentStats(agentId: string, userId: string, success: boolean) {
  try {
    const { error: statsError } = await supabase.rpc('increment_agent_stats', {
      agent_id_input: agentId,
      user_id_input: userId,
      success,
    });

    if (statsError) {
      console.error('Failed to update agent_stats:', statsError);
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
      throw error;
    }
  } catch (error) {
    console.error('Error updating agent run times:', error);
    throw error;
  }
}

/**
 * Main job processor function
 * Handles both scheduled and manual agent executions
 */
async function processAgentJob(job: Job<AgentJobData>) {
  const { agent_id, user_id, execution_id, execution_type, cron_expression, timezone } = job.data;
  const startTime = new Date();

  console.log(`🚀 Starting ${execution_type} execution for agent ${agent_id}`, {
    executionId: execution_id,
    jobId: job.id,
    userId: user_id,
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

    // 2. Update job progress
    await job.updateProgress(10);

    // 3. Fetch agent data from Supabase
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agent_id)
      .single();

    if (agentError || !agent) {
      throw new Error(`Agent not found: ${agentError?.message || 'Unknown error'}`);
    }

    // 4. Validate agent is still active
    if (agent.status === 'archived' || agent.status === 'inactive') {
      throw new Error(`Agent is ${agent.status} and cannot be executed`);
    }

    await job.updateProgress(20);

    await insertExecutionLog(
      execution_id,
      agent_id,
      user_id,
      'info',
      `Executing agent: ${agent.agent_name}`,
      'execution'
    );

    // 5. Execute the agent using the core logic
    console.log(`🤖 Executing agent: ${agent.agent_name}`);
    
    const executionResult = await runAgentWithContext({
      supabase,
      agent,
      userId: user_id,
      input_variables: {}, // Default empty for scheduled runs
      override_user_prompt: undefined,
      onProgress: async (progress: number) => {
        // Update both job and execution progress
        await job.updateProgress(Math.min(progress, 90)); // Reserve 90-100 for cleanup
        await updateExecution(execution_id, { progress });
      },
    });

    await job.updateProgress(90);

    // 6. Calculate execution duration
    const endTime = new Date();
    const executionDurationMs = endTime.getTime() - startTime.getTime();

    // 7. Mark execution as completed
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

    // 8. Update agent's last_run and next_run times
    await updateAgentRunTimes(agent_id, endTime, cron_expression, timezone);

    // 9. Legacy support: Insert into existing tables
    const success = executionResult?.send_status?.startsWith('✅') || 
                   executionResult?.send_status?.startsWith('📧') || 
                   executionResult?.send_status?.startsWith('🚨');

    const logId = await insertAgentLog(
      agent_id,
      user_id,
      executionResult?.parsed_output,
      executionResult?.message,
      executionResult?.send_status || 'Completed'
    );

    if (logId) {
      await insertAgentOutputContext(
        logId,
        agent_id,
        user_id,
        executionResult?.message,
        executionResult?.parsed_output,
        executionResult?.pluginContext,
        {} // Empty input variables for scheduled runs
      );
    }

    await updateAgentStats(agent_id, user_id, success);

    await job.updateProgress(100);

    console.log(`✅ Successfully completed ${execution_type} execution for agent ${agent_id}`, {
      executionId: execution_id,
      duration: `${executionDurationMs}ms`,
      result: executionResult?.summary || executionResult?.message || 'No summary available',
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
      retry_count: job.attemptsMade,
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

    // Legacy support: Update stats for failed execution
    await updateAgentStats(agent_id, user_id, false);

    // Re-throw error for BullMQ retry handling
    throw error;
  }
}

/**
 * Create and start the agent worker
 */
export function createAgentWorker() {
  const worker = new Worker<AgentJobData>(
    'agent-execution',
    processAgentJob,
    {
      connection,
      concurrency: parseInt(process.env.AGENT_WORKER_CONCURRENCY || '3'), // Process up to 3 agents simultaneously
      removeOnComplete: 100,
      removeOnFail: 50,
      // Job timing settings
      maxStalledCount: 2,
      stalledInterval: 30 * 1000, // 30 seconds
      maxStalls: 1,
    }
  );

  // Event listeners for monitoring and debugging
  worker.on('ready', () => {
    console.log('🔧 Agent worker is ready and waiting for jobs');
  });

  worker.on('active', (job) => {
    console.log(`⚡ Agent worker started processing job ${job.id} (${job.data.execution_type})`);
  });

  worker.on('completed', (job, result) => {
    console.log(`✅ Agent worker completed job ${job.id}:`, {
      agentId: job.data.agent_id,
      executionType: job.data.execution_type,
      duration: result?.duration,
    });
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Agent worker failed job ${job?.id}:`, {
      agentId: job?.data?.agent_id,
      executionType: job?.data?.execution_type,
      error: err.message,
      attempts: job?.attemptsMade,
    });
  });

  worker.on('stalled', (jobId) => {
    console.warn(`⚠️ Agent worker job ${jobId} stalled`);
  });

  worker.on('error', (err) => {
    console.error('❌ Agent worker error:', err);
  });

  return worker;
}

/**
 * Start the worker (call this in your main application or as a separate process)
 */
export function startAgentWorker() {
  const worker = createAgentWorker();
  
  // Graceful shutdown handling
  process.on('SIGINT', async () => {
    console.log('🛑 Gracefully shutting down agent worker...');
    await worker.close();
    await connection.quit();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('🛑 Gracefully shutting down agent worker...');
    await worker.close();
    await connection.quit();
    process.exit(0);
  });

  return worker;
}

// Export worker creation function
export default createAgentWorker;