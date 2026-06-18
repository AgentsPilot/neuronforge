import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { createLogger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabaseServer'

const logger = createLogger({ module: 'ActivityAPI' })

/**
 * GET /api/v2/analytics/activity
 *
 * Returns recent activity events across all workflows for the user.
 * Used by the Recent Activity component on the Analytics dashboard.
 *
 * Includes item counts from execution_metrics for richer descriptions.
 */
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })

  try {
    const user = await getUser()
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50)

    requestLogger.info({ userId: user.id, limit }, 'Fetching activity events')

    // Fetch recent executions - exclude calibration runs
    const { data: executions, error } = await supabaseServer
      .from('agent_executions')
      .select(`
        id,
        agent_id,
        status,
        created_at,
        completed_at,
        logs,
        agents!inner(agent_name, user_id, workflow_purpose)
      `)
      .eq('agents.user_id', user.id)
      .eq('run_mode', 'production')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      requestLogger.error({ err: error }, 'Failed to fetch executions')
      throw error
    }

    // Get execution IDs to fetch metrics (same IDs are used in workflow_executions)
    const executionIds = (executions || []).map(e => e.id)

    // Fetch metrics from execution_metrics table (uses same execution_id as workflow_executions)
    let metricsMap: Record<string, number> = {}
    if (executionIds.length > 0) {
      const { data: metrics, error: metricsError } = await supabaseServer
        .from('execution_metrics')
        .select('execution_id, total_items')
        .in('execution_id', executionIds)

      if (metricsError) {
        requestLogger.warn({ err: metricsError }, 'Failed to fetch execution_metrics')
      } else if (metrics && metrics.length > 0) {
        metricsMap = Object.fromEntries(
          metrics.map(m => [m.execution_id, m.total_items || 0])
        )
        requestLogger.debug({ metricsCount: metrics.length, executionIds: executionIds.length }, 'Fetched execution metrics')
      } else {
        requestLogger.debug({ executionIds }, 'No execution_metrics found for these executions')
      }
    }

    // Transform executions to activity events with rich descriptions
    const activities = (executions || []).map((exec) => {
      // agents is returned as object (not array) when using !inner with single match
      const agentData = exec.agents as unknown as { agent_name: string; user_id: string; workflow_purpose?: string } | null
      const logs = exec.logs as Record<string, any> | null

      // Extract item count from metrics table, fallback to logs
      const itemsProcessed = metricsMap[exec.id]
        || logs?.itemsProcessed
        || logs?.metrics?.total_items
        || logs?.totalItems
        || 0

      let type: string
      let description: string

      switch (exec.status) {
        case 'success':
        case 'completed':
          type = 'execution_success'
          description = buildSuccessDescription(itemsProcessed)
          break
        case 'failed':
        case 'error':
          type = 'execution_failed'
          description = 'needs attention'
          break
        case 'running':
        case 'pending':
          type = 'execution_started'
          description = 'is running...'
          break
        default:
          type = 'execution_started'
          description = `status: ${exec.status}`
      }

      return {
        id: exec.id,
        type,
        workflow_name: agentData?.agent_name || 'Unknown Workflow',
        workflow_id: exec.agent_id,
        description,
        items_processed: itemsProcessed,
        timestamp: exec.completed_at || exec.created_at,
      }
    })

    return NextResponse.json({
      success: true,
      data: activities,
    })
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch activity')
    return NextResponse.json(
      { success: false, error: 'Failed to fetch activity' },
      { status: 500 }
    )
  }
}

/**
 * Build a human-readable description based on status
 */
function buildSuccessDescription(itemsProcessed: number): string {
  if (itemsProcessed === 0) {
    return 'completed successfully'
  }
  return 'completed successfully'
}
