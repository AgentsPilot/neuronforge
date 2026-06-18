/**
 * Individual SLA Management API
 *
 * GET /api/v2/slas/[slaId] - Get a specific SLA
 * PUT /api/v2/slas/[slaId] - Update an SLA
 * DELETE /api/v2/slas/[slaId] - Delete an SLA
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { createLogger } from '@/lib/logger'
import { SLARepository } from '@/lib/repositories/SLARepository'
import { z } from 'zod'

const logger = createLogger({ module: 'SLADetailAPI' })

interface RouteContext {
  params: Promise<{ slaId: string }>
}

const UpdateSLASchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  agent_id: z.string().uuid().optional().nullable(),
  group_id: z.string().uuid().optional().nullable(),
  applies_to_all: z.boolean().optional(),
  metric_name: z.enum([
    'success_rate',
    'avg_duration_ms',
    'items_processed',
    'time_saved_seconds',
    'execution_count',
  ]).optional(),
  target_value: z.number().optional(),
  threshold_type: z.enum(['above', 'below', 'between']).optional(),
  threshold_max: z.number().optional().nullable(),
  alert_channels: z.array(
    z.object({
      type: z.enum(['email', 'webhook', 'slack']),
      value: z.string(),
    })
  ).optional(),
  escalation_after_minutes: z.number().min(1).optional().nullable(),
  is_active: z.boolean().optional(),
})

/**
 * GET - Get a specific SLA
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })
  const { slaId } = await context.params

  try {
    const user = await getUser()
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const slaRepo = new SLARepository()
    const result = await slaRepo.findById(slaId, user.id)

    if (result.error) {
      throw result.error
    }

    if (!result.data) {
      return NextResponse.json(
        { success: false, error: 'SLA not found' },
        { status: 404 }
      )
    }

    // Get violations for this SLA
    const violationsResult = await slaRepo.getViolationHistory(slaId, user.id)

    requestLogger.info({
      userId: user.id,
      slaId,
    }, 'SLA fetched')

    return NextResponse.json({
      success: true,
      data: {
        ...result.data,
        violations: violationsResult.data || [],
      },
    })
  } catch (error) {
    requestLogger.error({ err: error, slaId }, 'Failed to fetch SLA')
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PUT - Update an SLA
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })
  const { slaId } = await context.params

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
    const validation = UpdateSLASchema.safeParse(body)

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

    const slaRepo = new SLARepository()
    const result = await slaRepo.update(slaId, user.id, validation.data)

    if (result.error) {
      throw result.error
    }

    if (!result.data) {
      return NextResponse.json(
        { success: false, error: 'SLA not found' },
        { status: 404 }
      )
    }

    requestLogger.info({
      userId: user.id,
      slaId,
      changes: Object.keys(validation.data),
    }, 'SLA updated')

    return NextResponse.json({
      success: true,
      data: result.data,
    })
  } catch (error) {
    requestLogger.error({ err: error, slaId }, 'Failed to update SLA')
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE - Delete an SLA
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })
  const { slaId } = await context.params

  try {
    const user = await getUser()
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const slaRepo = new SLARepository()
    const result = await slaRepo.delete(slaId, user.id)

    if (result.error) {
      throw result.error
    }

    requestLogger.info({
      userId: user.id,
      slaId,
    }, 'SLA deleted')

    return NextResponse.json({
      success: true,
      data: { deleted: true },
    })
  } catch (error) {
    requestLogger.error({ err: error, slaId }, 'Failed to delete SLA')
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
