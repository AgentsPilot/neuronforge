/**
 * POST /api/scheduling/services/[id]/publish
 *
 * Publishes a draft service, making it active and bookable.
 * This is the user's approval step after reviewing AI-generated services.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'PublishServiceAPI' });
const auditTrail = AuditTrailService.getInstance();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id } = await params;

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    requestLogger.info({ userId: user.id, serviceId: id }, 'Publishing draft service');

    // 2. Publish the service
    const result = await schedulingServiceRepository.publish(id, user.id);

    if (result.error) {
      // Check if it's because service wasn't a draft
      const existing = await schedulingServiceRepository.findById(id, user.id);
      if (existing.data && existing.data.status !== 'draft') {
        return NextResponse.json(
          { success: false, error: 'Service is not a draft' },
          { status: 400 }
        );
      }

      requestLogger.error({ err: result.error, userId: user.id, serviceId: id }, 'Failed to publish service');
      return NextResponse.json(
        { success: false, error: 'Failed to publish service' },
        { status: 500 }
      );
    }

    // 3. Audit log (non-blocking)
    auditTrail.log({
      action: 'SCHEDULING_SERVICE_PUBLISHED',
      userId: user.id,
      entityType: 'scheduling_service',
      entityId: id,
      resourceName: result.data?.service_name || 'Unknown service',
      request
    }).catch(err => requestLogger.error({ err }, 'Audit failed'));

    // 4. Return success
    requestLogger.info({ userId: user.id, serviceId: id }, 'Service published successfully');
    return NextResponse.json({
      success: true,
      service: result.data,
      message: 'Service is now active and clients can book it.'
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Publish service request failed');
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
