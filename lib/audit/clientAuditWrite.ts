// lib/audit/clientAuditWrite.ts
//
// The one implementation behind the two browser-facing audit write routes,
// POST /api/audit/log and POST /api/audit-trail (Layer 3 step 0, FR-22 to FR-26).
//
// Before step 0 both routes took the account from the request (an `x-user-id`
// header, or a body `userId`) and checked no login, so anyone could write audit
// entries under any account. Now:
//   - the account is the session user, and nothing else (401 without one);
//   - the body is validated before anything is written (400), and a client can
//     never write an AI audit entry;
//   - severity and compliance flags come from EVENT_METADATA, never the client;
//   - no internal error text reaches the client outside development.
//
// The request is still passed to the audit service (IP address and user agent),
// exactly as before; the credential it copies into `session_id` is the separate
// open item OI-B.

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrail } from '@/lib/services/AuditTrailService';
import { generateDiff } from './diff';
import { AuditWriteBodySchema, stripReservedDetailKeys } from './requestSchemas';
import type { EntityType } from './types';

const logger = createLogger({ module: 'ClientAuditWriteAPI' });

export type ClientAuditWriteRoute = '/api/audit/log' | '/api/audit-trail';

/** Each route keeps the success message it has always returned. */
const SUCCESS_MESSAGE: Record<ClientAuditWriteRoute, string> = {
  '/api/audit/log': 'Audit log recorded',
  '/api/audit-trail': 'Audit trail logged successfully',
};

/** Whether a value is a plain JSON object (used only to inspect a rejected body). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(request: NextRequest): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

export async function handleClientAuditWrite(
  request: NextRequest,
  route: ClientAuditWriteRoute
): Promise<NextResponse> {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route });

  try {
    const user = await getUser();
    if (!user) {
      // TEMPORARY (added 2026-09-18, remove after 2026-09-25): Layer 3 step 0,
      // SA WC-10. Counts rejected writes for a week so a caller the repository
      // search missed shows up. Records only WHETHER the old identity channels
      // were used, never their values. Tracked as follow-up F-C (workplan §13):
      // review the count, then remove this and the one in app/api/audit/query.
      const parsed = await readJson(request);
      requestLogger.info(
        {
          legacyHeaderPresent: request.headers.has('x-user-id'),
          legacyBodyUserIdPresent: parsed.ok && isRecord(parsed.body) && 'userId' in parsed.body,
        },
        'Audit write rejected: no session'
      );
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const raw = await readJson(request);
    if (!raw.ok) {
      return NextResponse.json({ success: false, error: 'Invalid request data' }, { status: 400 });
    }

    const parsed = AuditWriteBodySchema.safeParse(raw.body);
    if (!parsed.success) {
      requestLogger.warn(
        { userId: user.id, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })) },
        'Audit write rejected: invalid body'
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400 }
      );
    }

    const body = parsed.data;
    const changes = body.before && body.after ? generateDiff(body.before, body.after) : null;

    // Not awaited: an audit write never holds up the caller. The service queues
    // the entry and never rejects (silent by default); the catch is a backstop.
    void AuditTrail.log({
      action: body.action,
      entityType: body.entityType as EntityType, // checked against CLIENT_WRITABLE_ENTITY_TYPES by the schema
      entityId: body.entityId ?? null,
      userId: user.id,
      actorId: user.id,
      resourceName: body.resourceName ?? undefined,
      changes: changes ?? undefined,
      // The service's own keys (system_action, changeSummary) are never taken from a client (CR-2).
      details: body.details ? stripReservedDetailKeys(body.details) : undefined,
      request,
    }).catch((err: unknown) =>
      requestLogger.error({ err, userId: user.id, action: body.action }, 'Audit write could not be queued')
    );

    return NextResponse.json({ success: true, message: SUCCESS_MESSAGE[route] });
  } catch (error) {
    requestLogger.error({ err: error }, 'Audit write failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}
