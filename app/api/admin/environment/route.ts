/**
 * GET /api/admin/environment (admin environment view, EC-1; requirement FR-1 to
 * FR-8, SA rulings OQ-2, OQ-8, conditions SA-C5 to SA-C10).
 *
 * Read-only: how this deployment is configured, built from the running
 * process's environment, the catalogue and the platform deny-list. Masking
 * happens in `classifyEnvironment` before anything reaches the response: a
 * secret is Set / Not set, a switch is On / Off, a personal list is a count,
 * and a plain setting is shown only when it passes its shape gates.
 *
 * Order: `requireAdmin` (401/403) first; then the strict empty query (400 on
 * any parameter, SA-C9); then the classification. Every response, the gate's
 * included, is `Cache-Control: no-store`.
 *
 * Logging and audit carry the environment label and counts only: never a
 * variable name of an uncatalogued row, never a value (M-5).
 *
 * Errors are logged as `{ errorClass }`, not `{ err }` (SA ruling Q-7, citing
 * SA-C6): Pino's error serialiser writes the message, and this feature must not
 * depend on no message ever echoing a value. Scoped to this feature's files.
 *
 * No database access besides the one audit row; no repository (FR-8).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { classifyEnvironment, errorClassOf } from '@/lib/admin/environment/classifyEnvironment';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'AdminEnvironmentAPI' });
const auditTrail = AuditTrailService.getInstance();
const ROUTE = '/api/admin/environment';
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** SA-C9: the route takes no parameters at all. */
const QuerySchema = z.object({}).strict();

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function errorResponse(status: number, error: string, code: string): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error,
      code,
      // A fixed code, never a caught error's message (SA-C6).
      details: process.env.NODE_ENV === 'development' ? code : undefined,
    },
    { status, headers: NO_STORE }
  );
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement that does work: nothing above reads the query or the environment.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return noStore(gate);
  const adminId = gate.user.id;

  const query = QuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!query.success) {
    return errorResponse(400, 'This page takes no parameters.', 'invalid_input');
  }

  try {
    const { payload, rowErrors } = classifyEnvironment(process.env);

    for (const rowError of rowErrors) {
      requestLogger.warn(
        { variable: rowError.name, errorClass: rowError.errorClass },
        'Environment row masked after a classification error'
      );
    }
    requestLogger.info(
      { adminUserId: adminId, environment: payload.environment.label, ...payload.counts },
      'Environment view built'
    );

    // Non-blocking: an audit failure never fails the view (OQ-8). A read, so no WC-7 flush.
    auditTrail
      .log({
        action: AUDIT_EVENTS.ADMIN_ENVIRONMENT_VIEWED,
        entityType: 'system',
        entityId: null,
        userId: adminId,
        actorId: adminId,
        severity: 'info',
        details: { correlationId, environment: payload.environment.label, ...payload.counts },
        request,
      })
      .catch((thrown: unknown) =>
        requestLogger.error({ errorClass: errorClassOf(thrown) }, 'Audit failed (non-blocking)')
      );

    return NextResponse.json({ success: true, data: payload }, { headers: NO_STORE });
  } catch (thrown) {
    requestLogger.error({ adminUserId: adminId, errorClass: errorClassOf(thrown) }, 'Environment view failed');
    return errorResponse(500, 'The environment view could not be built.', 'environment_classification_failed');
  }
}
