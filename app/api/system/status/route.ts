// app/api/system/status/route.ts

export async function GET() {
  try {
    // Import the scheduler directly
    const { automaticScheduler } = await import('@/lib/scheduler/automaticScheduler')
    const { executionCleanup } = await import('@/lib/cleanup/executionCleanup')
    const { applicationInitializer } = await import('@/lib/startup/initialize')
    
    // Get detailed status
    const schedulerStatus = automaticScheduler.getStatus()
    const cleanupStats = await executionCleanup.getCleanupStats()
    const initStatus = applicationInitializer.getStatus()

    // Try to count active agents directly from database
    const { supabaseServer } = await import('@/lib/supabaseServer')
    
    const { count: activeAgentsCount } = await supabaseServer
      .from('agents')
      .select('id', { count: 'exact' })
      .eq('status', 'active')

    const { count: scheduledAgentsCount } = await supabaseServer
      .from('agents')
      .select('id', { count: 'exact' })
      .eq('mode', 'scheduled')
      .eq('status', 'active')
      .not('schedule_cron', 'is', null)

    return Response.json({
      success: true,
      system: {
        initialization: {
          isInitialized: initStatus.isInitialized
        },
        scheduler: {
          isRunning: schedulerStatus.isRunning,
          scheduledAgentsCount: schedulerStatus.scheduledAgentsCount,
          scheduledAgents: schedulerStatus.scheduledAgents,
          shouldHaveAgents: scheduledAgentsCount || 0
        },
        database: {
          totalActiveAgents: activeAgentsCount || 0,
          scheduledAgentsInDB: scheduledAgentsCount || 0,
          totalExecutions: cleanupStats.totalExecutions
        },
        cleanup: {
          stuckExecutions: cleanupStats.stuckExecutions
        },
        timestamp: new Date().toISOString()
      }
    })

  } catch (error) {
    console.error('❌ System status API error:', error)
    
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { 
      status: 500 
    })
  }
}