// /app/api/worker/route.ts
// Vercel Cron Worker - Processes pending jobs from Redis queue
// Called every minute by Vercel Cron to process waiting jobs

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 1 minute max

/**
 * Process pending jobs from the queue
 * This is called by Vercel Cron every minute
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    console.log('🔧 Worker endpoint called at:', new Date().toISOString());

    // Security: Only allow Vercel Cron
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.warn('⚠️ Unauthorized worker request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Process one job from the queue
    // Note: processOneJob() handles its own connection lifecycle
    const { processOneJob } = await import('@/lib/queues/agentWorker');
    const result = await processOneJob();

    const duration = Date.now() - startTime;

    console.log(`✅ Worker completed in ${duration}ms`);
    console.log(`📦 Result:`, result);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      duration,
      processed: result.processed ? 1 : 0,
      jobId: result.jobId,
      error: result.error
    });

  } catch (error) {
    console.error('❌ Worker error:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Worker failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
