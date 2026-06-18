/**
 * Backfill Execution Metrics API
 *
 * POST /api/v2/analytics/backfill-metrics
 *
 * Recalculates total_items for existing execution_metrics records
 * by reading the first step's item_count from workflow_step_executions.
 *
 * This fixes historical data that was incorrectly summing all step counts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { createLogger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabaseServer'

const logger = createLogger({ module: 'BackfillMetricsAPI' })

export async function POST(request: NextRequest) {
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

    requestLogger.info({ userId: user.id }, 'Starting metrics backfill')

    // Get all execution_metrics for user's agents
    const { data: metrics, error: metricsError } = await supabaseServer
      .from('execution_metrics')
      .select(`
        execution_id,
        agent_id,
        total_items,
        agents!inner(user_id)
      `)
      .eq('agents.user_id', user.id)

    if (metricsError) {
      requestLogger.error({ err: metricsError }, 'Failed to fetch execution_metrics')
      throw metricsError
    }

    if (!metrics || metrics.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No metrics to backfill',
        updated: 0,
      })
    }

    requestLogger.info({ metricsCount: metrics.length }, 'Found metrics to backfill')

    let updated = 0
    let skipped = 0
    const errors: string[] = []

    // Process each execution
    for (const metric of metrics) {
      try {
        // Get the first non-system step's item_count for this execution
        const { data: steps, error: stepsError } = await supabaseServer
          .from('workflow_step_executions')
          .select('step_name, action, plugin, item_count')
          .eq('workflow_execution_id', metric.execution_id)
          .neq('plugin', 'system')
          .order('created_at', { ascending: true })
          .limit(10)

        if (stepsError) {
          errors.push(`${metric.execution_id}: ${stepsError.message}`)
          continue
        }

        if (!steps || steps.length === 0) {
          skipped++
          continue
        }

        // Find the first step with items
        const firstStepWithItems = steps.find(s => (s.item_count || 0) > 0)
        const correctTotalItems = firstStepWithItems?.item_count || 0

        // Only update if different
        if (correctTotalItems !== metric.total_items) {
          const { error: updateError } = await supabaseServer
            .from('execution_metrics')
            .update({ total_items: correctTotalItems })
            .eq('execution_id', metric.execution_id)

          if (updateError) {
            errors.push(`${metric.execution_id}: ${updateError.message}`)
          } else {
            requestLogger.debug({
              executionId: metric.execution_id,
              oldValue: metric.total_items,
              newValue: correctTotalItems,
              firstStep: firstStepWithItems?.step_name,
            }, 'Updated metric')
            updated++
          }
        } else {
          skipped++
        }
      } catch (err) {
        errors.push(`${metric.execution_id}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    requestLogger.info({
      total: metrics.length,
      updated,
      skipped,
      errors: errors.length,
    }, 'Backfill complete')

    return NextResponse.json({
      success: true,
      message: `Backfill complete: ${updated} updated, ${skipped} unchanged`,
      total: metrics.length,
      updated,
      skipped,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    })

  } catch (error) {
    requestLogger.error({ err: error }, 'Backfill failed')
    return NextResponse.json(
      { success: false, error: 'Backfill failed' },
      { status: 500 }
    )
  }
}
