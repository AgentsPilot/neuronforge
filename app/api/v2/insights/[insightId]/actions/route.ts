/**
 * Insight Actions API
 *
 * GET /api/v2/insights/[insightId]/actions - Get available actions for an insight
 * POST /api/v2/insights/[insightId]/actions - Apply an action to resolve an insight
 * POST /api/v2/insights/[insightId]/actions/preview - Preview an action before applying
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { createLogger } from '@/lib/logger'
import { InsightRepository } from '@/lib/repositories/InsightRepository'
import { supabaseServer } from '@/lib/supabaseServer'
import { OutcomeRepository } from '@/lib/repositories/OutcomeRepository'
import { InsightActionEngine } from '@/lib/pilot/insight/InsightActionEngine'
import { z } from 'zod'

const logger = createLogger({ module: 'InsightActionsAPI' })

interface RouteContext {
  params: Promise<{ insightId: string }>
}

const ApplyActionSchema = z.object({
  action_type: z.string(),
  preview_only: z.boolean().optional().default(false),
})

/**
 * GET - Get available actions for an insight
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })
  const { insightId } = await context.params

  try {
    const user = await getUser()
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    /*
     * Service role, with ownership checked on the very next line.
     *
     * `new InsightRepository()` took NO client, so `this.supabase` was
     * undefined and every call to this route threw on its first query --
     * two `tsc` errors that `next.config.js` ignores at build time, which is
     * why it shipped. `findById` is deliberately unscoped (it selects by id
     * alone), so the client has to bypass RLS and the route verifies
     * `user_id !== user.id` immediately: the fetch-then-verify shape the
     * `tenant-isolation-guard` skill sanctions when it is documented.
     */
    const insightRepo = new InsightRepository(supabaseServer)
    const insightResult = await insightRepo.findById(insightId)

    if (!insightResult || insightResult.user_id !== user.id) {
      return NextResponse.json(
        { success: false, error: 'Insight not found' },
        { status: 404 }
      )
    }

    // Get available actions
    const actionEngine = new InsightActionEngine()
    const actions = actionEngine.getAvailableActions(insightResult)

    requestLogger.info({
      userId: user.id,
      insightId,
      actionCount: actions.length,
    }, 'Available actions fetched')

    return NextResponse.json({
      success: true,
      data: {
        insight_id: insightId,
        insight_type: insightResult.insight_type,
        insight_status: insightResult.status,
        actions: actions.map(action => ({
          type: action.type,
          label: action.label,
          description: action.description,
          auto_applicable: action.auto_applicable,
        })),
      },
    })
  } catch (error) {
    requestLogger.error({ err: error, insightId }, 'Failed to get available actions')
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST - Apply or preview an action
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })
  const { insightId } = await context.params

  try {
    const user = await getUser()
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Validate input
    const body = await request.json()
    const validation = ApplyActionSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: validation.error.errors,
        },
        { status: 400 }
      )
    }

    const { action_type, preview_only } = validation.data

    /*
     * Service role, with ownership checked on the very next line.
     *
     * `new InsightRepository()` took NO client, so `this.supabase` was
     * undefined and every call to this route threw on its first query --
     * two `tsc` errors that `next.config.js` ignores at build time, which is
     * why it shipped. `findById` is deliberately unscoped (it selects by id
     * alone), so the client has to bypass RLS and the route verifies
     * `user_id !== user.id` immediately: the fetch-then-verify shape the
     * `tenant-isolation-guard` skill sanctions when it is documented.
     */
    const insightRepo = new InsightRepository(supabaseServer)
    const insight = await insightRepo.findById(insightId)

    if (!insight || insight.user_id !== user.id) {
      return NextResponse.json(
        { success: false, error: 'Insight not found' },
        { status: 404 }
      )
    }

    const actionEngine = new InsightActionEngine()

    // Preview mode
    if (preview_only) {
      const preview = await actionEngine.previewAction(
        insight,
        action_type as any,
        user.id
      )

      requestLogger.info({
        userId: user.id,
        insightId,
        actionType: action_type,
      }, 'Action preview generated')

      return NextResponse.json({
        success: true,
        data: {
          preview,
        },
      })
    }

    // Apply the action
    const result = await actionEngine.applyAction(
      insight,
      action_type as any,
      user.id
    )

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to apply action' },
        { status: 500 }
      )
    }

    /*
     * Record the outcome.
     *
     * ⚠️ THIS CURRENTLY NEVER SUCCEEDS. `public.insight_outcomes` does not
     * exist — no migration in this repository creates it, and a live probe on
     * 2026-10-06 returned `relation "public.insight_outcomes" does not exist`.
     * So every action applied here has failed to record its outcome for as
     * long as the route has existed.
     *
     * It was invisible because the result was discarded: `create` catches,
     * logs and returns `{ data: null, error }`, and the next line logged
     * "Action applied successfully" regardless. The outcome write is
     * deliberately non-blocking — a missing audit row must not fail an action
     * the user already got — so the fix is to make the failure VISIBLE, not
     * to throw.
     *
     * Creating the table belongs to the agent platform, whose shape this
     * repository shares (`executions_measured`, success per run). Business OS
     * has its own loop in `insight_measurements` (20261006g) and deliberately
     * does not reuse this one.
     */
    const outcomeRepo = new OutcomeRepository()
    const outcome = await outcomeRepo.create({
      insight_id: insightId,
      user_id: user.id,
      action_type,
      action_metadata: { changes: result.changes_applied },
      metric_name: 'success_rate',
      metric_unit: 'percentage',
    })

    if (outcome.error) {
      requestLogger.warn(
        { insightId, actionType: action_type, errName: outcome.error.name },
        'Action applied, but its outcome was NOT recorded'
      )
    }

    requestLogger.info({
      userId: user.id,
      insightId,
      actionType: action_type,
      changesCount: result.changes_applied.length,
    }, 'Action applied successfully')

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    requestLogger.error({ err: error, insightId }, 'Failed to apply action')
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
