/**
 * GET /api/crm/tasks/[id] - Get a single task
 * PUT /api/crm/tasks/[id] - Update a task
 * DELETE /api/crm/tasks/[id] - Delete a task
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { crmTaskRepository } from '@/lib/repositories/CRMTaskRepository';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { z } from 'zod';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { activitySentence } from '@/lib/business-os/activityText';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'CRMTaskAPI' });
const auditTrail = AuditTrailService.getInstance();

// Validation schema for updates
const updateTaskSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional().nullable(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  due_date: z.string().datetime().optional().nullable(),
  reminder_at: z.string().datetime().optional().nullable(),
  contact_id: z.string().uuid().optional().nullable(),
  tags: z.array(z.string()).optional()
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id } = await context.params;

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Get task
    const result = await crmTaskRepository.findById(id, user.id);

    if (result.error) {
      requestLogger.error({ err: result.error, taskId: id, userId: user.id }, 'Failed to get task');
      return NextResponse.json(
        { success: false, error: 'Failed to get task' },
        { status: 500 }
      );
    }

    if (!result.data) {
      return NextResponse.json(
        { success: false, error: 'Task not found' },
        { status: 404 }
      );
    }

    // 3. Return success
    return NextResponse.json({
      success: true,
      task: result.data
    });

  } catch (error) {
    requestLogger.error({ err: error, taskId: id }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id } = await context.params;

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Validate input
    const body = await request.json();
    const validated = updateTaskSchema.parse(body);

    requestLogger.info({ taskId: id, userId: user.id }, 'Updating CRM task');

    /*
     * Read first, so "completed" can be told from "saved again".
     *
     * Without the previous status every save of an already-finished task would
     * write another "task completed" row — the repetition that makes a timeline
     * unreadable.
     */
    const before = await crmTaskRepository.findById(id, user.id);

    // 3. Update task
    const result = await crmTaskRepository.update(id, user.id, validated);

    if (result.error) {
      requestLogger.error({ err: result.error, taskId: id, userId: user.id }, 'Failed to update task');
      return NextResponse.json(
        { success: false, error: 'Failed to update task' },
        { status: 500 }
      );
    }

    if (!result.data) {
      return NextResponse.json(
        { success: false, error: 'Task not found' },
        { status: 404 }
      );
    }

    // 4. Audit log (non-blocking)
    auditTrail.log({
      action: 'CRM_TASK_UPDATED',
      entityType: 'crm_task',
      entityId: id,
      userId: user.id,
      resourceName: result.data.title,
      metadata: {
        status: validated.status,
        priority: validated.priority
      },
      request
    }).catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    // The moment it was finished, on the contact's timeline.
    if (
      result.data?.contact_id &&
      validated.status === 'completed' &&
      before.data?.status !== 'completed'
    ) {
      const { data: ownerProfile } = await supabaseServer
        .from('business_profiles')
        .select('language')
        .eq('user_id', user.id)
        .maybeSingle();
      const ownerLocale = ownerProfile?.language || 'en';

      crmActivityRepository.create({
        user_id: user.id,
        contact_id: result.data.contact_id,
        activity_type: 'task_completed',
        title: activitySentence('task_completed', { task: result.data.title }, ownerLocale),
        description: JSON.stringify({
          kind: 'task_completed',
          task: result.data.title,
          previousStatus: before.data?.status || undefined,
        }),
        auto_logged: true,
        source_capability: 'crm',
        source_entity_id: id,
      }).catch(err => requestLogger.warn({ err }, 'Task-completed activity logging failed (non-blocking)'));
    }

    // 5. Return success
    requestLogger.info({ taskId: id, userId: user.id }, 'Task updated successfully');
    return NextResponse.json({
      success: true,
      task: result.data
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ err: error }, 'Validation error');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: process.env.NODE_ENV === 'development' ? error.errors : undefined
        },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error, taskId: id }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id } = await context.params;

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    requestLogger.info({ taskId: id, userId: user.id }, 'Deleting CRM task');

    // 2. Get task first for audit
    const existing = await crmTaskRepository.findById(id, user.id);

    // 3. Delete task
    const result = await crmTaskRepository.delete(id, user.id);

    if (result.error) {
      requestLogger.error({ err: result.error, taskId: id, userId: user.id }, 'Failed to delete task');
      return NextResponse.json(
        { success: false, error: 'Failed to delete task' },
        { status: 500 }
      );
    }

    // 4. Audit log (non-blocking)
    auditTrail.log({
      action: 'CRM_TASK_DELETED',
      entityType: 'crm_task',
      entityId: id,
      userId: user.id,
      resourceName: existing.data?.title || 'Unknown',
      request
    }).catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    // 5. Return success
    requestLogger.info({ taskId: id, userId: user.id }, 'Task deleted successfully');
    return NextResponse.json({
      success: true,
      message: 'Task deleted'
    });

  } catch (error) {
    requestLogger.error({ err: error, taskId: id }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}
