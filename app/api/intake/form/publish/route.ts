/**
 * Make the draft the form clients receive.
 *
 *   POST /api/intake/form/publish
 *
 * The one moment a generated form stops being a suggestion. Everything before
 * this is the owner's private draft; everything after reaches real clients, so
 * this is the act the publish gate in `intakeReach` is waiting for.
 *
 * @module app/api/intake/form/publish
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { intakeFormRepository } from '@/lib/repositories/IntakeFormRepository';

const logger = createLogger({ module: 'IntakePublishAPI' });
const auditTrail = AuditTrailService.getInstance();

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const result = await intakeFormRepository.publishDraft(user.id);

    if (result.error) {
      /*
       * These two are the owner's to fix, not faults — "no draft" means they
       * have nothing pending, "no questions" means they emptied it. Returned as
       * their own message at 400 rather than swallowed into a 500, because a
       * generic failure here reads as the button being broken.
       */
      const message = result.error.message;
      const ownerFixable =
        message === 'No draft intake form to publish' ||
        message === 'An intake form needs at least one question';

      if (ownerFixable) {
        return NextResponse.json({ success: false, error: message }, { status: 400 });
      }

      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to publish intake');
      return NextResponse.json(
        { success: false, error: 'Could not publish your intake form' },
        { status: 500 }
      );
    }

    const form = result.data!;

    // Non-blocking: a published form must not be reported as unpublished
    // because an audit row could not be written.
    auditTrail
      .log({
        action: 'INTAKE_FORM_PUBLISHED',
        entityType: 'intake_form',
        entityId: form.id,
        userId: user.id,
        resourceName: `v${form.version}`,
        severity: 'info',
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info(
      { userId: user.id, formId: form.id, version: form.version },
      'Intake form published'
    );

    return NextResponse.json({ success: true, data: form });
  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
