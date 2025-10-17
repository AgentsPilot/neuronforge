// /lib/queues/agentQueue.ts
// Enhanced BullMQ queue for agent executions with unified scheduling

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

// Redis connection - FIXED to use proper Redis URL
const connection = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  retryDelayOnFailover: 100,
  lazyConnect: true,
  connectTimeout: 10000,
  commandTimeout: 30000,
  enableReadyCheck: false,
  maxLoadingTimeout: 10000,
});

// Create the agent execution queue
export const agentQueue = new Queue('agent-execution', { 
  connection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  }
});

// Job data interface
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
 * Add a manual execution job to the queue
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

  const job = await agentQueue.add(
    `manual-${agentId}-${Date.now()}`,
    jobData,
    {
      priority: 1, // High priority for manual executions
      delay: 0, // Execute immediately
    }
  );

  console.log(`✅ Added manual job for agent ${agentId}`, {
    jobId: job.id,
    executionId: finalExecutionId,
    scheduledAt: new Date().toISOString(),
  });

  return {
    jobId: job.id!,
    executionId: finalExecutionId,
  };
}

/**
 * Add a scheduled execution job to the queue
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

  const job = await agentQueue.add(
    `scheduled-${agentId}-${Date.now()}`,
    jobData,
    {
      priority: 5, // Lower priority for scheduled executions
      repeat: {
        pattern: cronExpression,
        tz: timezone,
      },
    }
  );

  console.log(`✅ Added scheduled job for agent ${agentId}`, {
    jobId: job.id,
    executionId: finalExecutionId,
    cronExpression,
    timezone,
  });

  return {
    jobId: job.id!,
    executionId: finalExecutionId,
  };
}

/**
 * Get active jobs for a specific agent
 */
export async function getActiveJobsForAgent(agentId: string) {
  const activeJobs = await agentQueue.getActive();
  const waitingJobs = await agentQueue.getWaiting();
  
  const allJobs = [...activeJobs, ...waitingJobs];
  
  return allJobs.filter(job => job.data?.agent_id === agentId);
}

/**
 * Cancel all jobs for a specific agent
 */
export async function cancelJobsForAgent(agentId: string) {
  const activeJobs = await getActiveJobsForAgent(agentId);
  
  for (const job of activeJobs) {
    await job.remove();
  }
  
  console.log(`✅ Cancelled ${activeJobs.length} jobs for agent ${agentId}`);
  
  return activeJobs.length;
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  const waiting = await agentQueue.getWaiting();
  const active = await agentQueue.getActive();
  const completed = await agentQueue.getCompleted();
  const failed = await agentQueue.getFailed();
  
  return {
    waiting: waiting.length,
    active: active.length,
    completed: completed.length,
    failed: failed.length,
    total: waiting.length + active.length + completed.length + failed.length,
  };
}

/**
 * Clean up old jobs
 */
export async function cleanupOldJobs(olderThanHours: number = 24) {
  const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
  
  await agentQueue.clean(cutoffTime, 100, 'completed');
  await agentQueue.clean(cutoffTime, 50, 'failed');
  
  console.log(`✅ Cleaned up jobs older than ${olderThanHours} hours`);
}

// Event listeners for debugging
agentQueue.on('completed', (job) => {
  console.log(`✅ Job ${job.id} completed for agent ${job.data?.agent_id}`);
});

agentQueue.on('failed', (job, err) => {
  console.error(`❌ Job ${job?.id} failed for agent ${job?.data?.agent_id}:`, err.message);
});

agentQueue.on('stalled', (jobId) => {
  console.warn(`⚠️ Job ${jobId} stalled`);
});

// Export the queue instance and functions
export default agentQueue;