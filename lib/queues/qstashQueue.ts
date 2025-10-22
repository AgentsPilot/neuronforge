// /lib/queues/qstashQueue.ts
// Upstash QStash-based queue for agent executions (drop-in replacement for BullMQ)

import { Client } from '@upstash/qstash';
import { v4 as uuidv4 } from 'uuid';
import { createServerClient } from '@supabase/ssr';

// Lazy-initialize QStash client (to ensure env vars are loaded)
let qstashClient: Client | null = null;

function getQStashClient(): Client {
  if (!qstashClient) {
    if (!process.env.QSTASH_TOKEN) {
      throw new Error('QSTASH_TOKEN environment variable is not set');
    }
    qstashClient = new Client({
      token: process.env.QSTASH_TOKEN,
    });
  }
  return qstashClient;
}

// Supabase client for fallback
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

// Job data interface (same as BullMQ version)
export interface AgentJobData {
  agent_id: string;
  user_id: string;
  execution_id: string;
  execution_type: 'manual' | 'scheduled';
  cron_expression?: string;
  timezone?: string;
  input_variables?: Record<string, any>;
  override_user_prompt?: string;
}

/**
 * Get the base URL for the application
 */
function getBaseUrl(): string {
  // Vercel production/preview
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  // Custom domain
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }

  // Local development
  return 'http://localhost:3000';
}

/**
 * Add a manual execution job to QStash
 */
export async function addManualExecution(
  agentId: string,
  userId: string,
  executionId?: string,
  inputVariables?: Record<string, any>,
  overrideUserPrompt?: string
): Promise<{ jobId: string; executionId: string }> {
  const finalExecutionId = executionId || uuidv4();

  const jobData: AgentJobData = {
    agent_id: agentId,
    user_id: userId,
    execution_id: finalExecutionId,
    execution_type: 'manual',
    input_variables: inputVariables,
    override_user_prompt: overrideUserPrompt,
  };

  try {
    // Publish to QStash with immediate execution
    const client = getQStashClient();
    const response = await client.publishJSON({
      url: `${getBaseUrl()}/api/cron/process-queue`,
      body: jobData,
      retries: 3, // Retry up to 3 times on failure
      headers: {
        'Content-Type': 'application/json',
        'X-Job-Type': 'manual',
        'X-Execution-Id': finalExecutionId,
      },
    });

    console.log(`✅ Queued manual job via QStash for agent ${agentId}`, {
      messageId: response.messageId,
      executionId: finalExecutionId,
      scheduledAt: new Date().toISOString(),
    });

    return {
      jobId: response.messageId,
      executionId: finalExecutionId,
    };
  } catch (error) {
    console.error('Failed to queue job via QStash:', error);

    // Fallback: Mark execution as failed in database
    await supabase
      .from('agent_executions')
      .update({
        status: 'failed',
        error_message: `Failed to queue job: ${error instanceof Error ? error.message : 'Unknown error'}`,
      })
      .eq('id', finalExecutionId);

    throw error;
  }
}

/**
 * Add a scheduled execution job to QStash
 */
export async function addScheduledExecution(
  agentId: string,
  userId: string,
  cronExpression: string,
  timezone: string = 'UTC',
  executionId?: string
): Promise<{ jobId: string; executionId: string }> {
  const finalExecutionId = executionId || uuidv4();

  const jobData: AgentJobData = {
    agent_id: agentId,
    user_id: userId,
    execution_id: finalExecutionId,
    execution_type: 'scheduled',
    cron_expression: cronExpression,
    timezone,
  };

  try {
    // Create a schedule in QStash
    const client = getQStashClient();
    const schedule = await client.schedules.create({
      destination: `${getBaseUrl()}/api/cron/process-queue`,
      cron: cronExpression,
      body: JSON.stringify(jobData),
      retries: 3,
      headers: {
        'Content-Type': 'application/json',
        'X-Job-Type': 'scheduled',
        'X-Agent-Id': agentId,
      },
    });

    console.log(`✅ Scheduled job via QStash for agent ${agentId}`, {
      scheduleId: schedule.scheduleId,
      executionId: finalExecutionId,
      cronExpression,
      timezone,
    });

    // Store schedule ID in agent record for later cancellation
    await supabase
      .from('agents')
      .update({
        qstash_schedule_id: schedule.scheduleId
      })
      .eq('id', agentId);

    return {
      jobId: schedule.scheduleId,
      executionId: finalExecutionId,
    };
  } catch (error) {
    console.error('Failed to schedule job via QStash:', error);
    throw error;
  }
}

/**
 * Cancel all jobs for a specific agent
 */
export async function cancelJobsForAgent(agentId: string): Promise<number> {
  try {
    // Get agent's schedule ID
    const { data: agent } = await supabase
      .from('agents')
      .select('qstash_schedule_id')
      .eq('id', agentId)
      .single();

    if (!agent?.qstash_schedule_id) {
      console.log(`No schedule found for agent ${agentId}`);
      return 0;
    }

    // Delete the schedule from QStash
    const client = getQStashClient();
    await client.schedules.delete(agent.qstash_schedule_id);

    // Clear schedule ID from agent
    await supabase
      .from('agents')
      .update({ qstash_schedule_id: null })
      .eq('id', agentId);

    console.log(`✅ Cancelled schedule for agent ${agentId}`);
    return 1;
  } catch (error) {
    console.error(`Failed to cancel jobs for agent ${agentId}:`, error);
    return 0;
  }
}

/**
 * Get queue statistics (placeholder for QStash)
 */
export async function getQueueStats() {
  // Note: QStash doesn't provide queue stats via SDK
  // Use Upstash console for monitoring
  // Return pending executions from database instead

  const { data: executions } = await supabase
    .from('agent_executions')
    .select('status');

  const stats = {
    waiting: executions?.filter(e => e.status === 'pending').length || 0,
    active: executions?.filter(e => e.status === 'running').length || 0,
    completed: executions?.filter(e => e.status === 'completed').length || 0,
    failed: executions?.filter(e => e.status === 'failed').length || 0,
    total: executions?.length || 0,
  };

  return stats;
}

/**
 * Get active jobs for a specific agent
 */
export async function getActiveJobsForAgent(agentId: string) {
  const { data: executions } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('agent_id', agentId)
    .in('status', ['pending', 'running']);

  return executions || [];
}

/**
 * Cleanup old jobs (managed by agent_executions table)
 */
export async function cleanupOldJobs(olderThanHours: number = 24) {
  const cutoffTime = new Date(Date.now() - (olderThanHours * 60 * 60 * 1000)).toISOString();

  // Delete old completed executions
  const { error: completedError, count: completedCount } = await supabase
    .from('agent_executions')
    .delete()
    .eq('status', 'completed')
    .lt('completed_at', cutoffTime);

  // Delete old failed executions (keep longer)
  const failedCutoff = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString();
  const { error: failedError, count: failedCount } = await supabase
    .from('agent_executions')
    .delete()
    .eq('status', 'failed')
    .lt('completed_at', failedCutoff);

  if (completedError || failedError) {
    console.error('Error cleaning up old jobs:', completedError || failedError);
  }

  console.log(`✅ Cleanup completed:`, {
    timestamp: new Date().toISOString(),
    completedJobsRemoved: completedCount || 0,
    failedJobsRemoved: failedCount || 0,
    olderThan: `${olderThanHours} hours`
  });

  return {
    completedJobsRemoved: completedCount || 0,
    failedJobsRemoved: failedCount || 0,
  };
}

// Export a mock queue instance for compatibility
export const agentQueue = {
  add: async (name: string, data: AgentJobData) => {
    if (data.execution_type === 'manual') {
      return addManualExecution(
        data.agent_id,
        data.user_id,
        data.execution_id,
        data.input_variables,
        data.override_user_prompt
      );
    } else {
      return addScheduledExecution(
        data.agent_id,
        data.user_id,
        data.cron_expression!,
        data.timezone,
        data.execution_id
      );
    }
  },
};

export default agentQueue;
