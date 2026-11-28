// app/api/admin/messages/[id]/route.ts
// PATCH: change one contact-form message's status and/or notes.
// DELETE: delete one contact-form message (its replies go with it).
// The admin Messages screen reads `response.ok` only for both.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { createLogger } from '@/lib/logger';
import { contactMessagesRepository } from '@/lib/repositories/ContactMessagesRepository';
import { adminMessageIdParamSchema, adminMessagePatchSchema } from '@/lib/validation/contactMessages';

const logger = createLogger({ module: 'MessagesByIdAdminAPI' });

const devDetails = (details: unknown) => (process.env.NODE_ENV === 'development' ? details : undefined);

function invalidInput(details: unknown) {
  return NextResponse.json({ success: false, error: 'Invalid input', details: devDetails(details) }, { status: 400 });
}

function internalError(error: unknown) {
  return NextResponse.json(
    {
      success: false,
      error: 'Internal server error',
      details: devDetails(error instanceof Error ? error.message : String(error)),
    },
    { status: 500 }
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;
    const adminId = gate.user.id;

    const id = adminMessageIdParamSchema.parse(params.id);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return invalidInput('Body is not valid JSON');
    }
    // `updated_at` is accepted by the schema and deliberately not passed on.
    const { status, admin_notes } = adminMessagePatchSchema.parse(raw);

    const { data, error } = await contactMessagesRepository.updateForAdmin(
      { correlationId, adminId },
      id,
      { status, admin_notes }
    );

    if (error) {
      requestLogger.error({ err: error, messageId: id }, 'Failed to update contact message');
      return NextResponse.json(
        { success: false, error: 'Failed to update message', details: devDetails(error.message) },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ success: false, error: 'Message not found' }, { status: 404 });
    }

    const fields = [
      ...(status !== undefined ? ['status'] : []),
      ...(admin_notes !== undefined ? ['admin_notes'] : []),
    ];
    await logAndFlush(
      {
        action: AUDIT_EVENTS.CONTACT_MESSAGE_UPDATED,
        entityType: 'contact_message',
        entityId: id,
        userId: adminId,
        actorId: adminId,
        severity: 'info',
        ...(status !== undefined ? { changes: { after: { status } } } : {}),
        details: { fields, correlationId },
        request,
      },
      requestLogger,
      { reason: 'contact message update', continues: 'the saved change stands' }
    ).catch((err) => requestLogger.error({ err, messageId: id }, 'Audit failed (non-blocking)'));

    requestLogger.info({ messageId: id, fields }, 'Contact message updated');
    return NextResponse.json({ success: true, message: data });
  } catch (error) {
    if (error instanceof z.ZodError) return invalidInput(error.flatten());
    requestLogger.error({ err: error }, 'Contact message update request failed');
    return internalError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;
    const adminId = gate.user.id;

    const id = adminMessageIdParamSchema.parse(params.id);

    const { data, error } = await contactMessagesRepository.deleteForAdmin({ correlationId, adminId }, id);

    if (error || !data) {
      requestLogger.error({ err: error, messageId: id }, 'Failed to delete contact message');
      return NextResponse.json(
        { success: false, error: 'Failed to delete message', details: devDetails(error?.message) },
        { status: 500 }
      );
    }

    // A message that is already gone answers 200, so the screen does not report
    // a failure for a row that no longer exists (D-7). Nothing changed, so no audit.
    if (data.deleted) {
      await logAndFlush(
        {
          action: AUDIT_EVENTS.CONTACT_MESSAGE_DELETED,
          entityType: 'contact_message',
          entityId: id,
          userId: adminId,
          actorId: adminId,
          severity: 'warning',
          details: { correlationId },
          request,
        },
        requestLogger,
        { reason: 'contact message delete', continues: 'the delete stands' }
      ).catch((err) => requestLogger.error({ err, messageId: id }, 'Audit failed (non-blocking)'));
    }

    requestLogger.info({ messageId: id, deleted: data.deleted }, 'Contact message delete handled');
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) return invalidInput(error.flatten());
    requestLogger.error({ err: error }, 'Contact message delete request failed');
    return internalError(error);
  }
}
