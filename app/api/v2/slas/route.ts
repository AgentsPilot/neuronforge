/**
 * SLA Management API
 *
 * GET /api/v2/slas - Get all SLAs for the user
 * POST /api/v2/slas - Create a new SLA
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { createLogger } from '@/lib/logger'
import { SLARepository } from '@/lib/repositories/SLARepository'
import { OrganizationService } from '@/lib/services/OrganizationService'
import { z } from 'zod'

const logger = createLogger({ module: 'SLAAPI' })

const CreateSLASchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  agent_id: z.string().uuid().optional().nullable(),
  group_id: z.string().uuid().optional().nullable(),
  applies_to_all: z.boolean().optional().default(false),
  metric_name: z.enum([
    'success_rate',
    'avg_duration_ms',
    'items_processed',
    'time_saved_seconds',
    'execution_count',
  ]),
  target_value: z.number(),
  threshold_type: z.enum(['above', 'below', 'between']),
  threshold_max: z.number().optional().nullable(),
  alert_channels: z.array(
    z.object({
      type: z.enum(['email', 'webhook', 'slack']),
      value: z.string(),
    })
  ).optional(),
  escalation_after_minutes: z.number().min(1).optional().nullable(),
})

/**
 * GET - Get all SLAs for the user
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

    const slaRepo = new SLARepository()
    const result = await slaRepo.findByUserId(user.id)

    if (result.error) {
      throw result.error
    }

    // Get open violations count
    const violationsResult = await slaRepo.getOpenViolations(user.id)
    const openViolations = violationsResult.data?.length || 0

    requestLogger.info({
      userId: user.id,
      slaCount: result.data?.length || 0,
      openViolations,
    }, 'SLAs fetched')

    return NextResponse.json({
      success: true,
      data: {
        slas: result.data,
        open_violations: openViolations,
      },
    })
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch SLAs')
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST - Create a new SLA
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

    // Validate input
    const body = await request.json()
    requestLogger.info({ body }, 'SLA creation request body')

    const validation = CreateSLASchema.safeParse(body)

    if (!validation.success) {
      requestLogger.warn({
        errors: validation.error.errors,
        body
      }, 'SLA validation failed')
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: validation.error.errors,
        },
        { status: 400 }
      )
    }

    // Get user's organization
    const orgService = new OrganizationService()
    const org = await orgService.getCurrentOrganization(user.id)

    // Create SLA
    const slaRepo = new SLARepository()
    const result = await slaRepo.create({
      ...validation.data,
      user_id: user.id,
      org_id: org?.id,
    })

    if (result.error) {
      throw result.error
    }

    requestLogger.info({
      userId: user.id,
      slaId: result.data?.id,
      name: validation.data.name,
    }, 'SLA created')

    return NextResponse.json({
      success: true,
      data: result.data,
    })
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to create SLA')
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
