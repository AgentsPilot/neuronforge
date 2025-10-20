// /lib/queues/agentQueue.ts
// Enhanced BullMQ queue for agent executions with unified scheduling

import { Queue, Job, QueueEvents } from 'bullmq';
import { getWorkerRedisConnection } from '@/lib/redis';
import { v4 as uuidv4 } from 'uuid';
import { createServerClient } from '@supabase/ssr';
// Use same fallback table name as worker
const FALLBACK_TABLE = 'agent_job_fallback';
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

async function persistJobFallback(jobData) {
  try {
    const { error } = await supabase.from(FALLBACK_TABLE).insert({
      job_data: jobData,
      created_at: new Date().toISOString(),
    });
    if (error) {
      console.error('Failed to persist job to fallback table:', error);
    } else {
      console.warn('Job persisted to fallback table due to Redis unavailability');
    }
  } catch (err) {
    console.error('Error persisting job to fallback table:', err);
  }
}

// Singleton pattern for queue
let queueInstance: Queue | null = null;

function getQueue(): Queue {
  if (!queueInstance) {
    const connection = getWorkerRedisConnection();
    queueInstance = new Queue('agent-execution', {
      connection,
      defaultJobOptions: {
        removeOnComplete: {
          age: 24 * 60 * 60, // Keep completed jobs for 24 hours
          count: 1000, // Keep last 1000 completed jobs
        },
        removeOnFail: {
          age: 7 * 24 * 60 * 60, // Keep failed jobs for 7 days
          count: 500, // Keep last 500 failed jobs
        },
        attempts: 3, // Reduced from 5 to 3
        backoff: {
          type: 'exponential',
          delay: 2000, // Start with 2 second delay
        }
      }
    });
  }
  return queueInstance;
}

// Export the queue getter
export const agentQueue = getQueue();

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

  // Check Redis connection status
  const connection = getWorkerRedisConnection();
  if (!connection.status || connection.status === 'end' || connection.status === 'wait') {
    await persistJobFallback(jobData);
    return {
      jobId: 'fallback',
      executionId: finalExecutionId,
    };
  }
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

  // Check Redis connection status
  const connection = getWorkerRedisConnection();
  if (!connection.status || connection.status === 'end' || connection.status === 'wait') {
    await persistJobFallback(jobData);
    return {
      jobId: 'fallback',
      executionId: finalExecutionId,
    };
  }
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
 * Clean up old jobs and perform queue maintenance
 */
export async function cleanupOldJobs(olderThanHours: number = 24) {
  const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
  
  // Clean up completed jobs
  const completedCount = await agentQueue.clean(cutoffTime, 1000, 'completed');
  
  // Clean up failed jobs
  const failedCount = await agentQueue.clean(cutoffTime, 500, 'failed');
  
  // Clean up delayed jobs
  const delayedCount = await agentQueue.clean(cutoffTime, 100, 'delayed');

  // Clean up waiting jobs
  const waitingCount = await agentQueue.clean(cutoffTime, 100, 'waiting');
  
  console.log(`✅ Queue maintenance completed:`, {
    timestamp: new Date().toISOString(),
    completedJobsRemoved: completedCount,
    failedJobsRemoved: failedCount,
    delayedJobsRemoved: delayedCount,
    waitingJobsRemoved: waitingCount,
    olderThan: `${olderThanHours} hours`
  });
  
  return {
    completedJobsRemoved: completedCount,
    failedJobsRemoved: failedCount,
    delayedJobsRemoved: delayedCount,
    waitingJobsRemoved: waitingCount
  };
}

// Singleton pattern for QueueEvents
let queueEventsInstance: QueueEvents | null = null;

function getQueueEvents(): QueueEvents {
  if (!queueEventsInstance) {
    const connection = getWorkerRedisConnection();
    queueEventsInstance = new QueueEvents('agent-execution', { connection });

    // Event listeners for debugging and monitoring
    queueEventsInstance.on('completed', ({ jobId, returnvalue }) => {
      console.log(`✅ Job ${jobId} completed`, {
        result: returnvalue,
        timestamp: new Date().toISOString()
      });
    });

    queueEventsInstance.on('failed', ({ jobId, failedReason }) => {
      console.error(`❌ Job ${jobId} failed:`, {
        error: failedReason,
        timestamp: new Date().toISOString()
      });
    });

    queueEventsInstance.on('stalled', ({ jobId }) => {
      console.warn(`⚠️ Job ${jobId} stalled`, {
        timestamp: new Date().toISOString()
      });
    });
  }
  return queueEventsInstance;
}

// Initialize queue events
const queueEvents = getQueueEvents();

// Export the queue instance and functions
export default agentQueue;