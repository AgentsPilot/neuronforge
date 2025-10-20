// Update: app/api/agents/[id]/execution-status/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getLatestExecution, getRunningExecutions } from '@/lib/database/executionHelpers';
import { calculateNextRun, formatNextRun } from '@/lib/utils/scheduleFormatter';
import { agentQueue } from '@/lib/queues/agentQueue';

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

    // Check BOTH execution systems
    
    // 1. Check BullMQ executions (agent_executions table)
    const { data: bullmqExecutions, error: runningError } = await getRunningExecutions(agentId);
    const { data: latestBullmqExecution, error: latestError } = await getLatestExecution(agentId);
    
    // DEBUG: Check what's actually in the database
    const { data: allRecentExecutions } = await supabase
      .from('agent_executions')
      .select('id, status, created_at, started_at, job_id, execution_type')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(3);

    console.log('=== DEBUG EXECUTIONS ===');
    console.log('BullMQ executions found:', bullmqExecutions);
    console.log('BullMQ error:', runningError);
    console.log('Latest execution:', latestBullmqExecution);
    console.log('Latest error:', latestError);
    console.log('All recent executions:', allRecentExecutions);

    // 1.5. Check BullMQ queue directly for active jobs
    let hasActiveJob = false;
    try {
      const activeJobs = await agentQueue.getActive();
      const waitingJobs = await agentQueue.getWaiting();
      const allActiveJobs = [...activeJobs, ...waitingJobs];

      hasActiveJob = allActiveJobs.some(job => 
        job.data?.agentId === agentId
      );

      console.log('=== BULLMQ QUEUE CHECK ===');
      console.log(`Active jobs for agent ${agentId}:`, {
        totalActive: allActiveJobs.length,
        hasJobForThisAgent: hasActiveJob,
        relevantJobs: allActiveJobs
          .filter(j => j.data?.agentId === agentId)
          .map(j => ({ id: j.id, agentId: j.data?.agentId, executionId: j.data?.executionId }))
      });
    } catch (queueError) {
      console.error('Error checking BullMQ queue:', queueError);
    }
    
    // 2. Check workflow executions (agent_configurations table) 
    const { data: workflowExecutions } = await supabase
      .from('agent_configurations')
      .select('*')
      .eq('agent_id', agentId)
      .eq('status', 'running')
      .order('created_at', { ascending: false });

    const { data: latestWorkflowExecution } = await supabase
      .from('agent_configurations')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Determine if agent is actually running
    const isBullmqRunning = (bullmqExecutions && bullmqExecutions.length > 0) || hasActiveJob;
    const isWorkflowRunning = workflowExecutions && workflowExecutions.length > 0;
    const isRunning = isBullmqRunning || isWorkflowRunning;

    // Get the most recent execution from both systems
    let latestExecution = null;
    let latestExecutionSource = null;

    if (latestBullmqExecution && latestWorkflowExecution) {
      const bullmqTime = new Date(latestBullmqExecution.created_at).getTime();
      const workflowTime = new Date(latestWorkflowExecution.created_at).getTime();
      
      if (bullmqTime > workflowTime) {
        latestExecution = latestBullmqExecution;
        latestExecutionSource = 'bullmq';
      } else {
        latestExecution = {
          id: latestWorkflowExecution.id,
          status: latestWorkflowExecution.status === 'running' ? 'running' : 
                 latestWorkflowExecution.status === 'completed' ? 'completed' : 'failed',
          created_at: latestWorkflowExecution.created_at,
          completed_at: latestWorkflowExecution.completed_at,
          execution_duration_ms: latestWorkflowExecution.duration_ms,
          progress: latestWorkflowExecution.status === 'running' ? 50 : 100
        };
        latestExecutionSource = 'workflow';
      }
    } else if (latestBullmqExecution) {
      latestExecution = latestBullmqExecution;
      latestExecutionSource = 'bullmq';
    } else if (latestWorkflowExecution) {
      latestExecution = {
        id: latestWorkflowExecution.id,
        status: latestWorkflowExecution.status === 'running' ? 'running' : 
               latestWorkflowExecution.status === 'completed' ? 'completed' : 'failed',
        created_at: latestWorkflowExecution.created_at,
        completed_at: latestWorkflowExecution.completed_at,
        execution_duration_ms: latestWorkflowExecution.duration_ms,
        progress: latestWorkflowExecution.status === 'running' ? 50 : 100
      };
      latestExecutionSource = 'workflow';
    }

    // Calculate next run for scheduled agents
    let nextRun = null;
    let nextRunFormatted = 'On demand';
    
if (agent.mode === 'scheduled' && agent.schedule_cron) {
  nextRun = calculateNextRun(agent.schedule_cron, agent.timezone || 'UTC');  // ← Add timezone
  nextRunFormatted = formatNextRun(nextRun, agent.timezone || 'UTC');
}
    console.log(`Agent ${agentId} status: isRunning=${isRunning}, source=${latestExecutionSource}, bullmq=${isBullmqRunning}, workflow=${isWorkflowRunning}, hasActiveJob=${hasActiveJob}`);

    return NextResponse.json({
      success: true,
      isRunning,
      latestExecution,
      runningExecutions: [
        ...(bullmqExecutions || []),
        ...(workflowExecutions || []).map(we => ({
          id: we.id,
          status: 'running',
          created_at: we.created_at,
          progress: 50
        }))
      ],
      nextRun: nextRun?.toISOString() || null,
      nextRunFormatted,
      agentMode: agent.mode,
      agentStatus: agent.status,
      // Debug info
      debug: {
        bullmqRunning: isBullmqRunning,
        workflowRunning: isWorkflowRunning,
        latestSource: latestExecutionSource,
        bullmqCount: bullmqExecutions?.length || 0,
        workflowCount: workflowExecutions?.length || 0,
        hasActiveJob,
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