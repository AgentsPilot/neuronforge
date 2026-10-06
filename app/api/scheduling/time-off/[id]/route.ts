/**
 * DELETE /api/scheduling/time-off/[id] — "I am working that day after all"
 *
 * A hard delete, deliberately. Unlike a booking or an invoice, a day off is not
 * a record of something that happened: removing it means the business is open
 * again, and a tombstone would leave the date readable as closed by anything
 * that forgot to filter for it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { schedulingTimeOffRepository } from '@/lib/repositories/SchedulingTimeOffRepository';

const logger = createLogger({ module: 'SchedulingTimeOffAPI' });
const auditTrail = AuditTrailService.getInstance();

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const result = await schedulingTimeOffRepository.delete(id, user.id);

    if (result.error) {
      requestLogger.error({ err: result.error, id, userId: user.id }, 'Failed to remove time off');
      return NextResponse.json({ success: false, error: 'Failed to remove time off' }, { status: 500 });
    }

    auditTrail
      .log({
        action: 'SCHEDULING_TIME_OFF_REMOVED',
        userId: user.id,
        entityType: 'scheduling_availability_exception',
        entityId: id,
        resourceName: 'Time off',
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    requestLogger.info({ id, userId: user.id }, 'Time off removed');

    return NextResponse.json({ success: true });
  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
      },
      { status: 500 }
    );
  }
}
