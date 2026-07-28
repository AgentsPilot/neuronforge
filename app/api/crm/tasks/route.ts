/**
 * POST /api/crm/tasks - Create a task
 * GET /api/crm/tasks - List tasks with filters
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { crmTaskRepository } from '@/lib/repositories/CRMTaskRepository';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { z } from 'zod';

const logger = createLogger({ module: 'CRMTasksAPI' });
const auditTrail = AuditTrailService.getInstance();

// Helper to accept both date (YYYY-MM-DD) and datetime strings
const dateOrDatetime = z.string().transform((val) => {
  // If it's already a datetime string, return as-is
  if (val.includes('T')) {
    return val;
  }
  // Convert date string to datetime (end of day in UTC)
  return `${val}T23:59:59.999Z`;
});

// Validation schemas
const createTaskSchema = z.object({
  contact_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  due_date: dateOrDatetime.optional().nullable(),
  reminder_at: dateOrDatetime.optional().nullable(),
  tags: z.array(z.string()).optional()
});

const listTasksSchema = z.object({
  contact_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  due_before: z.string().datetime().optional(),
  due_after: z.string().datetime().optional(),
  include_completed: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
  orderBy: z.enum(['due_date', 'created_at', 'priority']).optional(),
  orderDirection: z.enum(['asc', 'desc']).optional()
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

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
    const validated = createTaskSchema.parse(body);

    requestLogger.info(
      { userId: user.id, contactId: validated.contact_id, title: validated.title },
      'Creating CRM task'
    );

    // 3. Create task
    const result = await crmTaskRepository.create({
      user_id: user.id,
      contact_id: validated.contact_id ?? null,
      title: validated.title,
      description: validated.description ?? null,
      priority: validated.priority,
      status: validated.status,
      due_date: validated.due_date ?? null,
      reminder_at: validated.reminder_at ?? null,
      tags: validated.tags
    });

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to create task');
      return NextResponse.json(
        { success: false, error: 'Failed to create task' },
        { status: 500 }
      );
    }

    // 4. Audit log (non-blocking)
    auditTrail.log({
      action: 'CRM_TASK_CREATED',
      entityType: 'crm_task',
      entityId: result.data!.id,
      userId: user.id,
      resourceName: validated.title,
      metadata: {
        contact_id: validated.contact_id,
        priority: validated.priority || 'medium',
        due_date: validated.due_date
      },
      request
    }).catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    // 5. Return success
    requestLogger.info({ taskId: result.data!.id, userId: user.id }, 'Task created successfully');
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

    requestLogger.error({ err: error }, 'Request failed');
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

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Parse query parameters
    const { searchParams } = new URL(request.url);
    const queryParams = {
      contact_id: searchParams.get('contact_id') || undefined,
      status: (searchParams.get('status') as 'pending' | 'in_progress' | 'completed' | 'cancelled') || undefined,
      priority: (searchParams.get('priority') as 'low' | 'medium' | 'high' | 'urgent') || undefined,
      due_before: searchParams.get('due_before') || undefined,
      due_after: searchParams.get('due_after') || undefined,
      include_completed: searchParams.get('include_completed') || undefined,
      limit: searchParams.get('limit') || undefined,
      offset: searchParams.get('offset') || undefined,
      orderBy: (searchParams.get('orderBy') as 'due_date' | 'created_at' | 'priority') || undefined,
      orderDirection: (searchParams.get('orderDirection') as 'asc' | 'desc') || undefined
    };

    // Validate
    const validated = listTasksSchema.parse(queryParams);

    requestLogger.info({ userId: user.id, params: validated }, 'Listing CRM tasks');

    // 3. Get tasks
    const result = await crmTaskRepository.list(user.id, {
      contact_id: validated.contact_id,
      status: validated.status,
      priority: validated.priority,
      due_before: validated.due_before,
      due_after: validated.due_after,
      include_completed: validated.include_completed,
      limit: validated.limit,
      offset: validated.offset,
      orderBy: validated.orderBy,
      orderDirection: validated.orderDirection
    });

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to list tasks');
      return NextResponse.json(
        { success: false, error: 'Failed to list tasks' },
        { status: 500 }
      );
    }

    // 4. Return success
    return NextResponse.json({
      success: true,
      tasks: result.data,
      limit: validated.limit || 50,
      offset: validated.offset || 0
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ err: error }, 'Validation error');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid parameters',
          details: process.env.NODE_ENV === 'development' ? error.errors : undefined
        },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Request failed');
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
