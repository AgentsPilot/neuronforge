// /app/api/worker/route.ts
// Vercel Background Worker for processing agent jobs
// This runs as a long-running serverless function (Vercel Pro feature)

import { NextRequest, NextResponse } from 'next/server';
import { startAgentWorker } from '@/lib/queues/agentWorker';

// Configure as a background function
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max (Vercel Pro limit)

let workerInstance: any = null;

export async function GET(request: NextRequest) {
  try {
    console.log('🔧 Background worker endpoint called');

    // Security: Only allow internal calls or authenticated requests
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.warn('Unauthorized worker request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if worker is already running
    if (workerInstance) {
      console.log('⚠️ Worker already running');
      return NextResponse.json({
        success: true,
        message: 'Worker already running',
        status: 'active'
      });
    }

    // Start the worker
    console.log('🚀 Starting background worker...');
    workerInstance = startAgentWorker();

    console.log('✅ Background worker started successfully');

    return NextResponse.json({
      success: true,
      message: 'Background worker started',
      status: 'running',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Failed to start background worker:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to start worker',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function POST(request: NextRequest) {
  return NextResponse.json({
    success: true,
    workerRunning: !!workerInstance,
    timestamp: new Date().toISOString()
  });
}
