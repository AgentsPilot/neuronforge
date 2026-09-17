/**
 * Business OS LLM usage verification report (Layer 1.1 FR-1).
 *
 * ADMIN ONLY, gated here in the route (middleware does not protect `/api`)
 * through AdminAccessService (the admin_users table) — never the user-writable
 * profile role field.
 * Order: 401 signed out → 403 not an admin (or the admin check threw: fail
 * closed) → 400 invalid query. No ledger or profile read happens before all
 * three pass.
 *
 * This is a deliberate CROSS-ACCOUNT READ for one selected business (plus
 * platform-account rows for Checks 2 and 3), limited to ledger metadata: no
 * prompts, payloads, error messages or emails. A platform account can't be the
 * selected business. Read-only: no writes (other than AdminAccessService's own
 * admin binding), no LLM calls, no audit event — accountability is this route's
 * structured log (info for manual refreshes, debug for automatic ones, never a
 * business name).
 *
 *   GET /api/admin/business-os/llm-usage?accountId=<uuid>&since=<ISO 8601>&trigger=manual|auto
 *
 * @module app/api/admin/business-os/llm-usage
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AdminAccessService } from '@/lib/services/AdminAccessService';
import {
  buildReportQuerySchema,
  firstIssueMessage,
  resolveReportWindow,
} from '@/lib/business-os/usage/llmUsageVerification';
import { buildLlmUsageReport } from '@/lib/business-os/usage/llmUsageReport';

const logger = createLogger({ module: 'AdminLlmUsageReportAPI' });

// The catalog imports Node `crypto` and Pino: never the Edge runtime. An
// admin- and cookie-dependent GET must never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // The fixed end of the window: every windowed read in this request uses it.
  const receivedAt = new Date();
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    let isAdmin = false;
    try {
      isAdmin = await AdminAccessService.getInstance().isAdmin({ id: user.id, email: user.email });
    } catch (err) {
      // Fail closed: an admin check that cannot answer is a "no".
      requestLogger.error({ err, userId: user.id }, 'Admin check threw; denying access');
    }

    if (!isAdmin) {
      requestLogger.warn({ userId: user.id }, 'Non-admin attempted to read the LLM usage report');
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(request.url);
    const parsed = buildReportQuerySchema(receivedAt).safeParse({
      accountId: url.searchParams.get('accountId') ?? undefined,
      since: url.searchParams.get('since') ?? undefined,
      trigger: url.searchParams.get('trigger') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: firstIssueMessage(parsed.error),
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400 }
      );
    }

    const { accountId, since, trigger } = parsed.data;
    const window = resolveReportWindow(since, receivedAt);

    const report = await buildLlmUsageReport({ accountId, window, trigger }, requestLogger);

    if (report.platformAccountEnvIgnored) {
      requestLogger.warn(
        { adminUserId: user.id },
        'SYSTEM_ADMIN_USER_ID is set but is not a UUID; only the all-zero platform account was checked'
      );
    }

    const { checks } = report;
    const logFields = {
      adminUserId: user.id,
      accountId,
      trigger,
      windowStart: report.window.start,
      windowEnd: report.window.end,
      rowsRead: checks.calls.rowsRead,
      incomplete: report.incomplete,
      rowsTruncated: checks.calls.rowsTruncated,
      groupsTruncated: checks.groups.groupsTruncated,
      breakdownTruncated: checks.platformAccount.breakdownTruncated,
      timestampsTruncated: checks.legacyLabels.helperLabelOnPlatform?.timestampsTruncated ?? false,
      statuses: {
        calls: checks.calls.status,
        platformAccount: checks.platformAccount.status,
        legacyLabels: checks.legacyLabels.status,
        groups: checks.groups.status,
        usageCard: checks.usageCard.status,
        areaTotals: report.areaTotals.status,
      },
    };

    // A manual refresh is an admin's deliberate cross-account read: info. An
    // automatic one repeats every 10-60 s: debug, so it can't flood the logs.
    if (trigger === 'auto') requestLogger.debug(logFields, 'LLM usage report served');
    else requestLogger.info(logFields, 'LLM usage report served');

    return NextResponse.json({ success: true, data: report });
  } catch (error) {
    requestLogger.error({ err: error }, 'LLM usage report failed');
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
