// /app/api/queue-status/route.ts
import { NextResponse } from 'next/server';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export async function GET() {
  try {
    // Create Redis connection
    const redis = new Redis({
      host: 'redis-18958.c14.us-east-1-2.ec2.redns.redis-cloud.com',
      port: 18958,
      password: '9T1oNBiaPUwALct21DV7kT2uYQFGafsh',
      maxRetriesPerRequest: 3,
    });

    // Create queue instance
    const agentQueue = new Queue('agent-queue', {
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

    await redis.disconnect();

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Queue status error:', error);
    return NextResponse.json(
      { error: 'Failed to get queue status', details: error.message },
      { status: 500 }
    );
  }
}