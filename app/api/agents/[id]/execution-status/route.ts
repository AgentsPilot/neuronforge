// Update: app/api/agents/[id]/execution-status/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getLatestExecution, getRunningExecutions } from '@/lib/database/executionHelpers';
import { calculateNextRun, formatNextRun } from '@/lib/utils/scheduleFormatter';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: agentId } = await params;

    const { createClient } = require('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get agent info
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('mode, schedule_cron, status, timezone')
      .eq('id', agentId)
      .single();

    if (agentError) {
      console.error('Agent fetch error:', agentError);
      return NextResponse.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 });
    }

    // Check executions from agent_executions table (QStash-based system)
    const { data: runningExecutions, error: runningError } = await getRunningExecutions(agentId);
    const { data: latestExecution, error: latestError } = await getLatestExecution(agentId);

    // DEBUG: Check what's actually in the database
    const { data: allRecentExecutions } = await supabase
      .from('agent_executions')
      .select('id, status, created_at, started_at, execution_type, progress')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(5);

    console.log('=== DEBUG EXECUTIONS ===');
    console.log('Running executions:', runningExecutions);
    console.log('Latest execution:', latestExecution);
    console.log('All recent executions:', allRecentExecutions);

    // Determine if agent is actually running
    const isRunning = runningExecutions && runningExecutions.length > 0;

    // Calculate next run for scheduled agents
    let nextRun = null;
    let nextRunFormatted = 'On demand';
    
if (agent.mode === 'scheduled' && agent.schedule_cron) {
  nextRun = calculateNextRun(agent.schedule_cron, agent.timezone || 'UTC');
  nextRunFormatted = formatNextRun(nextRun, agent.timezone || 'UTC');
}

    console.log(`Agent ${agentId} status: isRunning=${isRunning}`);

    return NextResponse.json({
      success: true,
      isRunning,
      latestExecution,
      runningExecutions: runningExecutions || [],
      nextRun: nextRun?.toISOString() || null,
      nextRunFormatted,
      agentMode: agent.mode,
      agentStatus: agent.status,
      // Debug info
      debug: {
        runningCount: runningExecutions?.length || 0,
        allRecentExecutions
      }
    });

  } catch (error) {
    console.error('Error getting execution status:', error);
    return NextResponse.json({
      success: false,
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}