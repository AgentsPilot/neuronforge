/**
 * SLA Evaluation Test API
 *
 * POST /api/v2/slas/evaluate - Manually trigger SLA evaluation for an agent
 *
 * Used for testing SLA evaluation without running a full automation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { createLogger } from '@/lib/logger'
import { SLAEvaluator } from '@/lib/services/SLAEvaluator'
import { z } from 'zod'

const logger = createLogger({ module: 'SLAEvaluateAPI' })

const EvaluateSchema = z.object({
  agent_id: z.string().uuid(),
})

/**
 * POST - Manually trigger SLA evaluation
 */
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

    const body = await request.json()
    const validation = EvaluateSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: validation.error.errors },
        { status: 400 }
      )
    }

    const { agent_id } = validation.data

    requestLogger.info({ agentId: agent_id, userId: user.id }, 'Manual SLA evaluation triggered')

    const evaluator = new SLAEvaluator()
    const result = await evaluator.evaluateAfterExecution(
      'manual-test-' + Date.now(), // fake execution ID
      agent_id,
      user.id
    )

    requestLogger.info({
      agentId: agent_id,
      evaluatedCount: result.evaluatedCount,
      violationsCount: result.violationsCount,
      recoveriesCount: result.recoveriesCount,
    }, 'SLA evaluation complete')

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to evaluate SLAs')
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
