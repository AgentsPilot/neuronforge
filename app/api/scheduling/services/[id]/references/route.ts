/**
 * What would break if this service were removed.
 *
 * Called before the delete confirmation and before switching a service off, so
 * the owner is told which of their published pages and links depend on it
 * rather than finding out from a client who could not book.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { findServiceReferences } from '@/lib/services/ServiceReferenceService';

const logger = createLogger({ module: 'ServiceReferencesAPI' });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id: serviceId } = await params;

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Confirms the service is this user's before reporting anything about it.
    const service = await schedulingServiceRepository.findById(serviceId, user.id);
    if (service.error || !service.data) {
      return NextResponse.json({ success: false, error: 'Service not found' }, { status: 404 });
    }

    const references = await findServiceReferences(serviceId, user.id);

    requestLogger.info(
      {
        userId: user.id,
        serviceId,
        landingPages: references.landingPages.length,
        smartLinks: references.smartLinks.length,
      },
      'Resolved service references'
    );

    return NextResponse.json({ success: true, data: references });
  } catch (error) {
    requestLogger.error({ err: error, serviceId }, 'Failed to resolve service references');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
