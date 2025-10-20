// /app/api/queue-status/route.ts
import { NextResponse } from 'next/server';
import { Queue } from 'bullmq';
import { getWorkerRedisConnection } from '@/lib/redis';

export async function GET() {
  try {
    // Use shared Redis connection
    const redis = getWorkerRedisConnection();

    // Create queue instance
    const agentQueue = new Queue('agent-execution', {
      connection: redis,
    });

    // Get queue stats
    const waiting = await agentQueue.getWaiting();
    const active = await agentQueue.getActive();
    const completed = await agentQueue.getCompleted(0, 10); // Last 10 completed
    const failed = await agentQueue.getFailed(0, 10); // Last 10 failed

    const stats = {
      waiting: {
        count: waiting.length,
        jobs: waiting.map(job => ({
          id: job.id,
          name: job.name,
          data: job.data,
          createdAt: job.timestamp,
        }))
      },
      active: {
        count: active.length,
        jobs: active.map(job => ({
          id: job.id,
          name: job.name,
          data: job.data,
          processedOn: job.processedOn,
        }))
      },
      completed: {
        count: completed.length,
        jobs: completed.map(job => ({
          id: job.id,
          name: job.name,
          data: job.data,
          processedOn: job.processedOn,
          finishedOn: job.finishedOn,
        }))
      },
      failed: {
        count: failed.length,
        jobs: failed.map(job => ({
          id: job.id,
          name: job.name,
          data: job.data,
          failedReason: job.failedReason,
          processedOn: job.processedOn,
        }))
      }
    };

  // Do not disconnect singleton connection

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Queue status error:', error);
    let details = 'Unknown error';
    if (error instanceof Error) {
      details = error.message;
    } else if (typeof error === 'string') {
      details = error;
    }
    return NextResponse.json(
      { error: 'Failed to get queue status', details },
      { status: 500 }
    );
  }
}