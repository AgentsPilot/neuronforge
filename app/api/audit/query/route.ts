// app/api/audit/query/route.ts - The signed-in owner's own audit log.
//
// Called by the /monitoring page. Before Layer 3 step 0 it returned the audit
// log of whatever account the `x-user-id` header named, with no login. Now the
// account is the session user only (FR-22, FR-23), the query is validated (FR-24),
// and the read goes through AuditTrailRepository, which never returns an AI audit
// entry (FR-27). The response shape is unchanged: { success, logs, total, page,
// limit, hasMore }.
import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditReadQuerySchema } from '@/lib/audit/requestSchemas';
import { auditTrailRepository } from '@/lib/repositories/AuditTrailRepository';

const logger = createLogger({ module: 'AuditQueryAPI' });

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';

// GET /api/audit/query - Query the current user's audit logs
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      // TEMPORARY (added 2026-09-18, remove after 2026-09-25): Layer 3 step 0,
      // SA WC-10 — counts rejected reads for a week so a missed caller shows up.
      // Tracked as follow-up F-C (workplan §13): review the count, then remove
      // this and the matching log in lib/audit/clientAuditWrite.ts.
      requestLogger.info(
        { route: '/api/audit/query', legacyHeaderPresent: request.headers.has('x-user-id') },
        'Audit read rejected: no session'
      );
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = AuditReadQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid query parameters',
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400 }
      );
    }

    const { action, entityType, severity, page, limit } = parsed.data;
    const result = await auditTrailRepository.listOwnerEntries(user.id, { action, entityType, severity, page, limit });

    if (result.error || !result.data) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Audit query failed');
      return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json({ success: true, ...result.data });
  } catch (error) {
    requestLogger.error({ err: error }, 'Audit query failed');
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
