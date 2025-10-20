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

    // Queue status monitoring
    let queueStatus = {
      isAvailable: false,
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      jobs: [],
      error: null
    };

    try {
      // Try to get queue status - FIXED: correct import path
      const { agentQueue } = await import('@/lib/queues/agentQueue')
      const queue = agentQueue
      
      // Get job counts and recent jobs
      const [waiting, active, completed, failed] = await Promise.all([
        queue.getWaiting(),
        queue.getActive(), 
        queue.getCompleted(0, 10), // Last 10 completed
        queue.getFailed(0, 5)      // Last 5 failed
      ])

      queueStatus = {
        isAvailable: true,
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        jobs: [
          // Current active jobs with progress and details
          ...active.map(job => ({
            id: job.id,
            agentId: job.data.agent_id,
            executionId: job.data.execution_id,
            status: 'active',
            progress: job.progress || 0,
            startedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
            createdAt: new Date(job.timestamp).toISOString(),
            attempts: job.attemptsMade,
            data: {
              execution_type: job.data.execution_type,
              input_variables: job.data.input_variables
            }
          })),
          // Waiting jobs (queued) with position
          ...waiting.slice(0, 10).map((job, index) => ({
            id: job.id,
            agentId: job.data.agent_id,
            executionId: job.data.execution_id,
            status: 'waiting',
            queuePosition: index + 1,
            createdAt: new Date(job.timestamp).toISOString(),
            data: {
              execution_type: job.data.execution_type,
              input_variables: job.data.input_variables
            }
          })),
          // Recent completed jobs
          ...completed.slice(0, 5).map(job => ({
            id: job.id,
            agentId: job.data.agent_id,
            executionId: job.data.execution_id,
            status: 'completed',
            completedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
            duration: job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : null,
            returnValue: job.returnvalue ? 'Available' : 'None'
          })),
          // Recent failed jobs
          ...failed.slice(0, 3).map(job => ({
            id: job.id,
            agentId: job.data.agent_id,
            executionId: job.data.execution_id,
            status: 'failed',
            failedAt: job.failedReason ? new Date(job.timestamp).toISOString() : null,
            error: job.failedReason || 'Unknown error',
            attempts: job.attemptsMade
          }))
        ],
        error: null
      }
    } catch (queueError) {
      console.warn('Could not connect to queue:', queueError.message)
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
          totalExecutions: cleanupStats.totalExecutions,
          lastCleanup: cleanupStats.lastCleanup
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

// Optional: Add a specific agent queue check endpoint
export async function POST(request: Request) {
  try {
    const { agentId } = await request.json()
    
    if (!agentId) {
      return Response.json({
        success: false,
        error: 'Agent ID required'
      }, { status: 400 })
    }

    const { agentQueue } = await import('@/lib/queues/agentQueue')
    const queue = agentQueue
    
    const [waiting, active] = await Promise.all([
      queue.getWaiting(),
      queue.getActive()
    ])

    // Find specific agent in queue
    const agentInWaiting = waiting.find(job => job.data.agent_id === agentId)
    const agentInActive = active.find(job => job.data.agent_id === agentId)
    
    const queuePosition = agentInWaiting ? 
      waiting.findIndex(job => job.data.agent_id === agentId) + 1 : null

    return Response.json({
      success: true,
      agent: {
        id: agentId,
        inQueue: !!(agentInWaiting || agentInActive),
        status: agentInActive ? 'active' : agentInWaiting ? 'waiting' : 'not_queued',
        queuePosition: queuePosition,
        jobId: (agentInWaiting || agentInActive)?.id || null,
        progress: agentInActive?.progress || 0,
        executionId: (agentInWaiting || agentInActive)?.data?.execution_id || null
      }
    })

  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Queue check failed'
    }, { status: 500 })
  }
}