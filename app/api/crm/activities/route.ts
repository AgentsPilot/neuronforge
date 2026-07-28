/**
 * GET /api/crm/activities
 * List CRM activities with filtering
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { z } from 'zod';

const auditTrail = AuditTrailService.getInstance();

const logger = createLogger({ module: 'CRMActivitiesAPI' });

const listActivitiesSchema = z.object({
  contact_id: z.string().uuid().optional(),
  activity_type: z.string().optional(),
  source_capability: z.string().optional(),
  limit: z.number().min(1).max(100).optional(),
  offset: z.number().min(0).optional(),
  orderBy: z.enum(['activity_date', 'created_at']).optional(),
  orderDirection: z.enum(['asc', 'desc']).optional()
});

const createActivitySchema = z.object({
  contact_id: z.string().uuid(),
  activity_type: z.enum(['note', 'call', 'email', 'meeting']),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional()
});

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
      activity_type: searchParams.get('activity_type') || undefined,
      source_capability: searchParams.get('source_capability') || undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : undefined,
      orderBy: (searchParams.get('orderBy') as 'activity_date' | 'created_at') || undefined,
      orderDirection: (searchParams.get('orderDirection') as 'asc' | 'desc') || undefined
    };

    // Validate
    const validated = listActivitiesSchema.parse(queryParams);

    requestLogger.info({ userId: user.id, params: validated }, 'Listing CRM activities');

    // 3. Get activities
    const result = await crmActivityRepository.list(user.id, validated);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to list activities');
      return NextResponse.json(
        { success: false, error: 'Failed to list activities' },
        { status: 500 }
      );
    }

    // 4. Return success
    return NextResponse.json({
      success: true,
      activities: result.data,
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

/**
 * POST /api/crm/activities
 * Create a manual CRM activity (note, call, email, meeting)
 */
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
    const validated = createActivitySchema.parse(body);

    requestLogger.info(
      { userId: user.id, contactId: validated.contact_id, type: validated.activity_type },
      'Creating manual CRM activity'
    );

    // 3. Create activity
    const result = await crmActivityRepository.create({
      user_id: user.id,
      contact_id: validated.contact_id,
      activity_type: validated.activity_type,
      title: validated.title,
      description: validated.description || null,
      auto_logged: false,
      source_capability: 'manual',
      activity_date: new Date().toISOString()
    });

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to create activity');
      return NextResponse.json(
        { success: false, error: 'Failed to create activity' },
        { status: 500 }
      );
    }

    // 4. Audit log (non-blocking)
    auditTrail.log({
      action: 'CRM_ACTIVITY_CREATED',
      entityType: 'crm_activity',
      entityId: result.data!.id,
      userId: user.id,
      metadata: {
        contact_id: validated.contact_id,
        activity_type: validated.activity_type
      }
    }).catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    // 5. Return success
    return NextResponse.json({
      success: true,
      activity: result.data
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
