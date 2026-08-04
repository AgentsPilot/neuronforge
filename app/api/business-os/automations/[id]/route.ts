/**
 * Business OS Automation Detail API
 *
 * Endpoints for a single automation:
 * - GET: Fetch automation details
 * - PATCH: Update automation parameters
 * - DELETE: Delete automation
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { AutomationManager } from '@/lib/business-os/insight/automation';

const logger = createLogger({ module: 'AutomationDetailAPI' });

// ===========================
// Schemas
// ===========================

const updateAutomationSchema = z.object({
  action: z.enum(['update', 'pause', 'resume']).optional(),
  processParameters: z.record(z.unknown()).optional(),
  checkIntervalMinutes: z.number().min(5).max(1440).optional(),
  maxItemsPerRun: z.number().min(1).max(100).optional(),
  quietHoursStart: z.number().min(0).max(23).optional(),
  quietHoursEnd: z.number().min(0).max(23).optional(),
  pauseReason: z.string().optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ===========================
// GET - Fetch automation
// ===========================

export async function GET(request: NextRequest, context: RouteParams) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    const { data, error } = await supabaseServer
      .from('insight_automations')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { success: false, error: 'Automation not found' },
        { status: 404 }
      );
    }

    requestLogger.info(
      { userId: user.id, automationId: id },
      'Fetched automation'
    );

    return NextResponse.json({
      success: true,
      data: { automation: data },
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch automation');

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch automation',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}

// ===========================
// PATCH - Update automation
// ===========================

export async function PATCH(request: NextRequest, context: RouteParams) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    const body = await request.json();
    const params = updateAutomationSchema.parse(body);

    const manager = new AutomationManager(supabaseServer);

    // Handle specific actions
    if (params.action === 'pause') {
      const success = await manager.pause(id, user.id, params.pauseReason);
      if (!success) {
        return NextResponse.json(
          { success: false, error: 'Failed to pause automation' },
          { status: 400 }
        );
      }

      requestLogger.info({ userId: user.id, automationId: id }, 'Automation paused');

      return NextResponse.json({
        success: true,
        data: { status: 'paused' },
      });
    }

    if (params.action === 'resume') {
      const success = await manager.resume(id, user.id);
      if (!success) {
        return NextResponse.json(
          { success: false, error: 'Failed to resume automation' },
          { status: 400 }
        );
      }

      requestLogger.info({ userId: user.id, automationId: id }, 'Automation resumed');

      return NextResponse.json({
        success: true,
        data: { status: 'resumed' },
      });
    }

    // Update parameters
    const automation = await manager.updateParameters(id, user.id, {
      processParameters: params.processParameters,
      checkIntervalMinutes: params.checkIntervalMinutes,
      maxItemsPerRun: params.maxItemsPerRun,
      quietHoursStart: params.quietHoursStart,
      quietHoursEnd: params.quietHoursEnd,
    });

    if (!automation) {
      return NextResponse.json(
        { success: false, error: 'Failed to update automation' },
        { status: 400 }
      );
    }

    requestLogger.info({ userId: user.id, automationId: id }, 'Automation updated');

    return NextResponse.json({
      success: true,
      data: { automation },
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to update automation');

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid parameters', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update automation',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}

// ===========================
// DELETE - Delete automation
// ===========================

export async function DELETE(request: NextRequest, context: RouteParams) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    const manager = new AutomationManager(supabaseServer);
    const success = await manager.delete(id, user.id);

    if (!success) {
      return NextResponse.json(
        { success: false, error: 'Failed to delete automation' },
        { status: 400 }
      );
    }

    requestLogger.info({ userId: user.id, automationId: id }, 'Automation deleted');

    return NextResponse.json({
      success: true,
      data: { deleted: true },
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to delete automation');

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete automation',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
