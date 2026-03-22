// /app/api/agent-configurations/save-inputs/route.ts
// API endpoint to save/update input_values for an agent

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUser } from '@/lib/auth'
import { agentConfigurationRepository } from '@/lib/repositories'
import { createLogger } from '@/lib/logger'
import { AuditTrailService } from '@/lib/services/AuditTrailService'
import { AUDIT_EVENTS } from '@/lib/audit/events'

const logger = createLogger({ module: 'SaveInputsAPI' })
const auditTrail = AuditTrailService.getInstance()

export const runtime = 'nodejs'

const SaveInputsSchema = z.object({
  agent_id: z.string().min(1, 'agent_id is required'),
  input_values: z.record(z.string(), z.unknown()),
  input_schema: z.unknown().optional(),
})

/**
 * POST handler to save/update input_values in agent_configurations
 * This finds the most recent 'configured' entry or creates a new one
 */
export async function POST(req: NextRequest) {
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })

  try {
    // 1. Authenticate
    const user = await getUser()
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // 2. Validate input
    const body = await req.json()
    const parsed = SaveInputsSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const { agent_id, input_values, input_schema } = parsed.data

    requestLogger.info({ agent_id, userId: user.id }, 'Save inputs request received')

    // 3. Save via repository
    const { data, error } = await agentConfigurationRepository.saveInputValues(
      agent_id,
      user.id,
      input_values,
      { inputSchema: input_schema, status: 'configured' }
    )

    if (error || !data) {
      requestLogger.error({ err: error, agent_id }, 'Failed to save input values')
      return NextResponse.json(
        { success: false, error: 'Failed to save input values' },
        { status: 500 }
      )
    }

    requestLogger.info({ configId: data.id, userId: user.id }, 'Input values saved successfully')

    // 4. Audit log (non-blocking)
    auditTrail.log({
      action: AUDIT_EVENTS.AGENT_CONFIG_SAVED,
      entityType: 'agent',
      entityId: agent_id,
      userId: user.id,
      details: { configId: data.id, inputCount: Object.keys(input_values).length },
      request: req
    }).catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'))

    // 5. Return response
    return NextResponse.json({ success: true, data })

  } catch (error) {
    requestLogger.error({ err: error }, 'Unexpected error saving input values')
    return NextResponse.json(
      { success: false, error: 'Failed to save input values' },
      { status: 500 }
    )
  }
}
