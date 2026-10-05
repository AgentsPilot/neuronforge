/**
 * The READ-ONLY deletion preview of one business, for the admin Businesses
 * page (admin delete AD-1b; requirement D13, §6.1, §6.3; SA SC-1, SC-3, SC-10).
 *
 *   POST /api/admin/users/<uuid>/deletion/preview     body: {} (or empty)
 *
 * ADMIN ONLY, and a deliberate CROSS-ACCOUNT read of one admin-selected
 * account: what deleting its business would remove and keep, and every reason
 * the deletion would be refused (R-1 … R-8). NOTHING IS DELETED: there is no
 * commit route, no token and no destructive call on this path (SC-9). A POST
 * only because the admin explicitly asks for it (the dialog opens), and so the
 * shared gate oracle covers it (`adminGate.writes`, SA D-6).
 *
 * Order, and nothing before it: `requireAdmin` (401 / 403) → the path id, Zod
 * uuid, lower-cased (400, before any lookup) → the body, read as text: empty
 * → `{}`, malformed JSON → 400, then `z.object({}).strict()` so a `userId` or
 * any other key is a 400 → the composition. The target comes ONLY from the
 * path (FR-A4, tenant-isolation-guard); level and options are fixed on the
 * server (SC-2).
 *
 * 404 when no account has this id. 500 when the identity read fails (never a
 * 404 and never "not an admin", SA D-1) or the preview throws.
 *
 * One `BUSINESS_DELETION_PREVIEWED` audit row per answered request (200, 404,
 * 500 after a valid request), written with the admin as user and actor, so it
 * never lands on the owner's account. Bounded and never rejecting
 * (`logAndFlush`): an audit failure never fails the preview. Logs and the
 * audit row carry ids, statuses and counts only; the email and business name
 * are in the response, for the admin (SC-10).
 *
 * @module app/api/admin/users/[id]/deletion/preview
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import {
  buildAdminDeletionPreview,
  type AdminDeletionPreviewOutcome,
} from '@/lib/business-os/purge/AdminDeletionPreview';

const logger = createLogger({ module: 'AdminDeletionPreviewAPI' });

// Node: Pino and the repositories are Node-only. An admin- and cookie-dependent
// answer must never be cached. 60 s: the preview counts every deletable table.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const targetIdSchema = z.string().uuid();
/** SC-1: the body carries nothing. A `userId` (or any key) is a 400. */
const bodySchema = z.object({}).strict();

type AuditOutcome = 'previewed' | 'not_found' | 'error';

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  const gate = await requireAdmin(logger.child({ route: 'admin-deletion-preview', method: 'POST' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const adminId = gate.user.id;
  const requestLogger = logger.child({ correlationId, adminId });

  const parsedId = targetIdSchema.safeParse(context.params.id);
  if (!parsedId.success) {
    return NextResponse.json({ success: false, error: 'invalid_user_id' }, { status: 400 });
  }
  // Canonical form: Postgres matches uuids case-insensitively, JS equality (R-1) does not.
  const targetId = parsedId.data.toLowerCase();

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_body' }, { status: 400 });
  }
  let body: unknown = {};
  if (rawBody.trim().length > 0) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ success: false, error: 'invalid_body' }, { status: 400 });
    }
  }
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'invalid_body',
        details: process.env.NODE_ENV === 'development' ? parsedBody.error.issues[0]?.message : undefined,
      },
      { status: 400 }
    );
  }

  const audit = (outcome: AuditOutcome, extra: Record<string, unknown> = {}) =>
    logAndFlush(
      {
        action: AUDIT_EVENTS.BUSINESS_DELETION_PREVIEWED,
        entityType: 'user',
        entityId: targetId,
        // The admin is user and actor: the row never lands on the owner's account.
        userId: adminId,
        actorId: adminId,
        severity: 'info',
        details: { correlationId, outcome, targetId, ...extra },
        request,
      },
      requestLogger,
      { reason: 'admin deletion preview', continues: 'the preview answers regardless' }
    )
      // logAndFlush never rejects by contract; the catch keeps that true here regardless.
      .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

  let outcome: AdminDeletionPreviewOutcome;
  try {
    outcome = await buildAdminDeletionPreview({ adminId, targetId, correlationId });
  } catch (error) {
    requestLogger.error({ err: error, targetId }, 'Admin deletion preview failed');
    await audit('error');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }

  if (outcome.kind === 'identity_error') {
    await audit('error');
    return NextResponse.json({ success: false, error: 'identity_read_failed' }, { status: 500 });
  }
  if (outcome.kind === 'not_found') {
    await audit('not_found');
    return NextResponse.json({ success: false, error: 'user_not_found' }, { status: 404 });
  }

  const { preview } = outcome;
  await audit('previewed', {
    counted: preview.counted,
    refusals: preview.refusals.map((r) => `${r.id}:${r.status}`),
    deletionAvailable: preview.deletionAvailable,
  });

  requestLogger.info(
    { targetId, counted: preview.counted, refusals: preview.refusals.map((r) => `${r.id}:${r.status}`) },
    'Admin opened a deletion preview'
  );

  return NextResponse.json({ success: true, data: preview });
}
