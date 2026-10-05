/**
 * The operator cost report (credit deduction slice 4a, FR-33, FR-12c, AC-23
 * report half). Workplan §4.5.
 *
 *   GET /api/admin/business-os/credits/report?from=YYYY-MM-DD&to=YYYY-MM-DD[&accountId=<uuid>]
 *
 * ADMIN ONLY, and a deliberate CROSS-ACCOUNT READ of the credit ledger: what
 * Business OS actions cost us (USD, the provider's measured cost) and what we
 * charged (credits), per account and billing period. No owner text exists in
 * the ledger; business names are read for display only and never logged.
 *
 * Order, and nothing before it: requireAdmin (401/403) → 400 (Zod, strict) →
 * 409 platform account (pure, no read) → the reads. Nothing from the request
 * reaches the database except the validated dates and account id.
 *
 * READ-ONLY. No audit entry (the precedent of the shadow report and the
 * account summary); the accountability is one `info` log with the admin id,
 * the window, the account filter, the row count, `incomplete` and the count
 * of unreadable amounts.
 *
 * @module app/api/admin/business-os/credits/report
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { isPlatformAccount } from '@/lib/business-os/llm/callCatalog';
import { buildCreditReport, CREDIT_REPORT_LIMITS } from '@/lib/business-os/credits/creditReport';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';

const logger = createLogger({ module: 'AdminBosCreditReportAPI' });

// Node: Pino and the repositories are Node-only. An admin- and cookie-dependent
// GET must never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date (rejects 2026-02-30), as UTC midnight in ms. */
function dateMs(value: string): number | null {
  if (!DATE_PATTERN.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value) return null;
  return ms;
}

const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function todayUtcMs(now: Date): number {
  return Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function buildQuerySchema(now: Date) {
  const today = todayUtcMs(now);
  return z
    .object({
      from: z.string().refine((v) => dateMs(v) !== null, 'from must be a date, YYYY-MM-DD').optional(),
      to: z.string().refine((v) => dateMs(v) !== null, 'to must be a date, YYYY-MM-DD').optional(),
      accountId: z.string().uuid('accountId must be a UUID').optional(),
    })
    .strict()
    .superRefine((q, ctx) => {
      if ((q.from === undefined) !== (q.to === undefined)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Give both from and to, or neither' });
        return;
      }
      if (q.from === undefined || q.to === undefined) return;
      const from = dateMs(q.from);
      const to = dateMs(q.to);
      if (from === null || to === null) return; // reported by the field refinements
      if (from > to) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'from must not be after to' });
        return;
      }
      if ((to - from) / DAY_MS + 1 > CREDIT_REPORT_LIMITS.MAX_WINDOW_DAYS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `The window may be at most ${CREDIT_REPORT_LIMITS.MAX_WINDOW_DAYS} days`,
        });
      }
      // One day of tolerance: an admin east of UTC is already on "tomorrow".
      if (to > today + DAY_MS) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'to must not be in the future' });
      }
    });
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const baseLogger = logger.child({ correlationId });

  // Admin gate. Nothing above this line may touch a request body,
  // the database, a job queue, or an outbound message.
  const gate = await requireAdmin(baseLogger);
  if (gate instanceof NextResponse) return gate;

  const requestLogger = baseLogger.child({ adminId: gate.user.id });

  try {
    const params = request.nextUrl.searchParams;
    const keys = [...params.keys()];
    // A repeated key would be silently collapsed by Object.fromEntries.
    if (new Set(keys).size !== keys.length) {
      return NextResponse.json({ success: false, error: 'Each query parameter may appear once' }, { status: 400 });
    }

    const now = new Date();
    const parsed = buildQuerySchema(now).safeParse(Object.fromEntries(params.entries()));
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.issues[0]?.message ?? 'Invalid query',
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400 }
      );
    }

    const accountId = parsed.data.accountId ?? null;
    // Pure check: a platform account's rows are the platform's, not a business's.
    if (accountId !== null && isPlatformAccount(accountId)) {
      return NextResponse.json({ success: false, error: 'platform_account' }, { status: 409 });
    }

    const today = todayUtcMs(now);
    const window = parsed.data.from && parsed.data.to
      ? { from: parsed.data.from, to: parsed.data.to }
      : { from: toDate(today - (CREDIT_REPORT_LIMITS.DEFAULT_WINDOW_DAYS - 1) * DAY_MS), to: toDate(today) };

    const report = await buildCreditReport({ window, accountId }, requestLogger, {
      // Admin identity reads are called only from app/api/admin/** (repository guard).
      findNames: (ids) => businessProfileRepository.findAdminIdentitiesByUserIds(ids),
      now: () => now,
    });

    // Ids and counts only: never a business name.
    requestLogger.info(
      {
        window,
        accountId,
        periods: report.periods.length,
        rowsRead: report.rowsRead,
        incomplete: report.incomplete,
        incompleteReasons: report.incompleteReasons,
        sections: report.sections,
        // Never-silent (D-6): an amount that could not be read counts as 0.
        unreadableAmounts: report.unreadableAmounts,
      },
      'Admin read the Business OS credit cost report'
    );

    return NextResponse.json({ success: true, data: report });
  } catch (error) {
    requestLogger.error({ err: error }, 'Business OS credit cost report failed');
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
