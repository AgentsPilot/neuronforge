// app/api/system/status/route.ts

export async function GET() {
  try {
    // Import only what you're actually using
    const { executionCleanup } = await import('@/lib/cleanup/executionCleanup')
    
    // Get cleanup stats
    const cleanupStats = await executionCleanup.getCleanupStats()

    // Database counts
    const { supabaseServer } = await import('@/lib/supabaseServer')
    
    const { count: activeAgentsCount } = await supabaseServer
      .from('agents')
      .select('id', { count: 'exact' })
      .eq('status', 'active')

    const { count: totalAgentsCount } = await supabaseServer
      .from('agents')
      .select('id', { count: 'exact' })

    // Get recent execution status
    const { data: recentExecutions } = await supabaseServer
      .from('agent_executions')
      .select('status, created_at, agent_id')
      .order('created_at', { ascending: false })
      .limit(20)

    const executionStats = {
      total: recentExecutions?.length || 0,
      running: recentExecutions?.filter(e => e.status === 'running').length || 0,
      queued: recentExecutions?.filter(e => e.status === 'queued').length || 0,
      completed: recentExecutions?.filter(e => e.status === 'completed').length || 0,
      failed: recentExecutions?.filter(e => e.status === 'failed').length || 0
    }

    // QStash Queue Status - using agent_executions table
    // QStash handles scheduling via Vercel Cron, so we check execution status instead
    let queueStatus: {
      isAvailable: boolean;
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      jobs: any[];
      error: string | null;
      queueType: string;
    } = {
      isAvailable: true,
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      jobs: [],
      error: null,
      queueType: 'QStash + Vercel Cron'
    };

    try {
      // Get scheduled agents that are pending execution
      const { data: scheduledAgents } = await supabaseServer
        .from('agents')
        .select('id, agent_name, next_run, schedule_enabled')
        .eq('schedule_enabled', true)
        .not('next_run', 'is', null)
        .order('next_run', { ascending: true })
        .limit(10)

      // Count agents waiting to run (next_run is in the past)
      const now = new Date().toISOString()
      const waitingAgents = scheduledAgents?.filter(a => a.next_run && a.next_run < now) || []

      queueStatus = {
        isAvailable: true,
        waiting: waitingAgents.length,
        active: executionStats.running,
        completed: executionStats.completed,
        failed: executionStats.failed,
        jobs: scheduledAgents?.map((agent, index) => ({
          id: agent.id,
          agentId: agent.id,
          agentName: agent.agent_name,
          status: agent.next_run && agent.next_run < now ? 'waiting' : 'scheduled',
          scheduledFor: agent.next_run,
          queuePosition: agent.next_run && agent.next_run < now ? waitingAgents.findIndex(a => a.id === agent.id) + 1 : null
        })) || [],
        error: null,
        queueType: 'QStash + Vercel Cron'
      }
    } catch (queueError: any) {
      console.warn('Could not get queue status:', queueError.message)
      queueStatus.error = queueError.message
    }

    return Response.json({
      success: true,
      system: {
        database: {
          totalAgents: totalAgentsCount || 0,
          activeAgents: activeAgentsCount || 0,
          recentExecutions: executionStats
        },
        queue: queueStatus,
        cleanup: {
          stuckExecutions: cleanupStats.stuckExecutions,
          totalExecutions: cleanupStats.totalExecutions
        },
        timestamp: new Date().toISOString()
      }
    })

  } catch (error) {
    console.error('System status API error:', error)
    
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { 
      status: 500 
    })
  }
}

// Check specific agent execution status
export async function POST(request: Request) {
  try {
    const { agentId } = await request.json()

    if (!agentId) {
      return Response.json({
        success: false,
        error: 'Agent ID required'
      }, { status: 400 })
    }

    const { supabaseServer } = await import('@/lib/supabaseServer')

    // Get agent details
    const { data: agent } = await supabaseServer
      .from('agents')
      .select('id, agent_name, next_run, schedule_enabled, schedule_interval')
      .eq('id', agentId)
      .single()

    if (!agent) {
      return Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 })
    }

    // Get latest execution
    const { data: latestExecution } = await supabaseServer
      .from('agent_executions')
      .select('id, status, progress, started_at, completed_at')
      .eq('agent_id', agentId)
      .order('started_at', { ascending: false })
      .limit(1)
      .single()

    const now = new Date().toISOString()
    const isWaitingToRun = agent.schedule_enabled && agent.next_run && agent.next_run < now
    const isRunning = latestExecution?.status === 'running'

    return Response.json({
      success: true,
      agent: {
        id: agentId,
        name: agent.agent_name,
        inQueue: isWaitingToRun,
        status: isRunning ? 'active' : isWaitingToRun ? 'waiting' : 'idle',
        scheduledFor: agent.next_run,
        scheduleEnabled: agent.schedule_enabled,
        currentExecution: latestExecution ? {
          id: latestExecution.id,
          status: latestExecution.status,
          progress: latestExecution.progress || 0,
          startedAt: latestExecution.started_at,
          completedAt: latestExecution.completed_at
        } : null
      }
    })

  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Status check failed'
    }, { status: 500 })
  }
}