/**
 * Business OS summary of ONE account, for the admin Businesses panel
 * (admin reorganisation slice 2b).
 *
 *   GET /api/admin/business-os/accounts/<uuid>/summary
 *
 * ADMIN ONLY, and a deliberate CROSS-ACCOUNT READ of one admin-selected
 * account, limited to metadata: the business's name and vertical, its Business
 * OS AI spend over 30 days, and its recent failed AI actions. No prompt,
 * message body, owner-written text or email is read or returned.
 *
 * The entitlement snapshot is NOT served here: the panel calls the existing
 * entitlements route, so "exactly as the entitlements API returns it" is true by
 * construction.
 *
 * Order, and nothing before it: requireAdmin (401/403) → 400 (Zod) → 409
 * platform account (pure, no read) → tenancy (the SAME `isBusinessOsTenant` the
 * entitlements route uses: 500 / 404) → three independent reads. One failed
 * read becomes `{ status: 'error' }` for its block, not a failed request.
 *
 * Money: AI cost is USD by definition of the model pricing table. It is never
 * converted and never combined with a business's own currency.
 *
 * @module app/api/admin/business-os/accounts/[accountId]/summary
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { bosRowFilter, isPlatformAccount } from '@/lib/business-os/llm/callCatalog';
import {
  LLM_USAGE_LIMITS,
  READ_FAILED,
  classifyCallRow,
  computeAreaTotals,
  readOk,
} from '@/lib/business-os/usage/llmUsageVerification';
import { isBusinessOsTenant } from '@/lib/business-os/entitlements/adminOps';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { onboardingConversationRepository } from '@/lib/repositories/OnboardingConversationRepository';
import { tokenUsageRepository } from '@/lib/repositories/TokenUsageRepository';
import { auditTrailRepository, type AdminAiFailureRow } from '@/lib/repositories/AuditTrailRepository';

const logger = createLogger({ module: 'AdminBosAccountSummaryAPI' });

// Node: Pino, the catalog and the repositories are Node-only. An admin- and
// cookie-dependent GET must never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const accountIdSchema = z.string().uuid();

/** The window of every block: the last 30 days. */
const WINDOW_DAYS = 30;
/** How many recent failures the panel lists. */
const FAILURES_LIMIT = 10;
/** Longest string any projected detail field may carry. */
const MAX_FIELD = 80;

interface AiFailureItem {
  id: string;
  createdAt: string;
  groupId: string | null;
  area: string | null;
  actionType: string | null;
  trigger: string | null;
  errorCode: string | null;
  callCount: number | null;
  failedCallCount: number | null;
}

function shortString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, MAX_FIELD) : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

/**
 * The allow-list (SA C-5c). Named fields only, each type-checked and capped, so
 * a row written by older code — or a key nobody reviewed — cannot reach the
 * screen. Never a spread of `details`.
 */
function projectAiFailure(row: AdminAiFailureRow): AiFailureItem {
  const details = (row.details && typeof row.details === 'object' ? row.details : {}) as Record<string, unknown>;
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    groupId: shortString(row.entity_id),
    area: shortString(details.area),
    actionType: shortString(details.actionType),
    trigger: shortString(details.trigger),
    errorCode: shortString(details.errorCode),
    callCount: count(details.callCount),
    failedCallCount: count(details.failedCallCount),
  };
}

export async function GET(request: NextRequest, context: { params: { accountId: string } }) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const baseLogger = logger.child({ correlationId });

  // Admin gate. Nothing above this line may touch a request body,
  // the database, a job queue, or an outbound message.
  const gate = await requireAdmin(baseLogger);
  if (gate instanceof NextResponse) return gate;

  const requestLogger = baseLogger.child({ adminId: gate.user.id });

  try {
    const parsedId = accountIdSchema.safeParse(context.params.accountId);
    if (!parsedId.success) {
      return NextResponse.json({ success: false, error: 'invalid_account_id' }, { status: 400 });
    }
    const accountId = parsedId.data;

    // Pure check first (C-5b): a platform account's rows are the platform's,
    // not one business's.
    if (isPlatformAccount(accountId)) {
      return NextResponse.json({ success: false, error: 'platform_account' }, { status: 409 });
    }

    const isTenant = await isBusinessOsTenant({
      accountId,
      profileRepository: businessProfileRepository,
      onboardingRepository: onboardingConversationRepository,
    });
    if (isTenant === null) {
      return NextResponse.json({ success: false, error: 'tenant_check_failed' }, { status: 500 });
    }
    if (!isTenant) {
      return NextResponse.json({ success: false, error: 'not_a_business_os_account' }, { status: 404 });
    }

    const end = new Date();
    const start = new Date(end.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [identity, calls, failures] = await Promise.all([
      businessProfileRepository.findAdminIdentity(accountId),
      tokenUsageRepository.listCallsInWindow(accountId, { start, end }, bosRowFilter(), {
        pageSize: LLM_USAGE_LIMITS.PAGE_SIZE,
        ceiling: LLM_USAGE_LIMITS.READ_CEILING,
      }),
      auditTrailRepository.listAdminAiFailures(accountId, { since: start, limit: FAILURES_LIMIT }),
    ]);

    const business = identity.error
      ? ({ status: 'error' } as const)
      : identity.data
        ? ({
            status: 'ok',
            companyName: identity.data.company_name,
            vertical: identity.data.vertical,
            subVertical: identity.data.sub_vertical,
          } as const)
        : ({ status: 'none' } as const);

    // The same functions the Business OS LLM usage report uses, so the panel
    // and the report cannot disagree about what a Business OS call costs.
    const totals = computeAreaTotals(
      calls.error || !calls.data
        ? READ_FAILED
        : readOk({ rows: calls.data.rows.map(classifyCallRow), incomplete: calls.data.reachedCeiling })
    );
    const aiSpend30d = {
      status: totals.status,
      currency: 'USD' as const,
      window: { start: start.toISOString(), end: end.toISOString() },
      total: totals.total,
      lines: totals.status === 'error' ? [] : totals.lines.filter((line) => line.calls > 0),
    };

    const recentAiFailures =
      failures.error || !failures.data
        ? ({ status: 'error', window: { start: start.toISOString(), end: end.toISOString() }, limit: FAILURES_LIMIT, items: [] } as const)
        : {
            status: 'ok' as const,
            window: { start: start.toISOString(), end: end.toISOString() },
            limit: FAILURES_LIMIT,
            items: failures.data.map(projectAiFailure),
          };

    // Never the business name: a cross-account read is logged by id and counts.
    requestLogger.info(
      {
        accountId,
        businessStatus: business.status,
        spendStatus: aiSpend30d.status,
        spendCalls: aiSpend30d.total.calls,
        failuresStatus: recentAiFailures.status,
        failuresCount: recentAiFailures.items.length,
      },
      'Admin read a Business OS account summary'
    );

    return NextResponse.json({
      success: true,
      data: { accountId, business, aiSpend30d, recentAiFailures },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Business OS account summary failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
