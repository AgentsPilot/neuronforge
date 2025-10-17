import { NextResponse } from 'next/server';
import { agentQueue } from '@/lib/queues/agentQueue';

export async function GET() {
  return NextResponse.json({ 
    message: 'Use POST method to add jobs to queue' 
  });
}

export async function POST() {
  try {
    // Add a test job to the queue
    const job = await agentQueue.add('test-agent-execution', {
      agentId: 'test-agent-123',
      userId: 'user-456',
      executionType: 'manual'
    });

    return NextResponse.json({ 
      success: true, 
      message: 'Job added to queue successfully!',
      jobId: job.id 
    });
  } catch (error) {
    console.error('Queue error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}