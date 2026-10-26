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
 * Money MK-2 (SA-RR-MK SA-1): the response also carries `chargedInWindow`,
 * the charged AI cost of charges CREATED in the window, deleted accounts
 * included, built by Finance's own ledger read and builder
 * (`lib/business-os/finance/chargedAiCost.ts`), so the cost tile equals
 * Finance for the same window by construction. With an account only the
 * account-scoped read runs, with the validated id. The default window (no
 * dates) is This month, the page's default.
 *
 * Money MK-3 (SA-3, C-7): the response also carries `recorded`, the window's
 * recorded AI cost (the usage log, Business OS rows) and "Recorded above
 * charged", for the AI cost page's A-K2 and A-K3 tiles and its recorded block.
 * The two usage-log reads are Finance's own, bound once in
 * `app/api/admin/business-os/finance/recordedReads.ts` (this route names no
 * usage-log reader), run after the 409 like every other read: with an account
 * only the one-account read, with the validated id; with none only the
 * all-accounts read. Same 2 s deadline as Finance; a failed or late read makes
 * `recorded` Unknown and never fails the report. Built by Finance's own
 * builder against `chargedInWindow`'s units, so it equals Finance's
 * `aiCost.recorded` for the same window by construction. The log line gains
 * `recorded`: which read, how it ended, counts and flags, never an amount.
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
import { buildCreditReport, CREDIT_REPORT_LIMITS, windowInstants } from '@/lib/business-os/credits/creditReport';
import type { CreditReportResponse } from '@/lib/business-os/credits/creditReportTypes';
import { buildChargedAiCostInWindowWithUnits, recordedInWindow } from '@/lib/business-os/finance/chargedAiCost';
import { FINANCE_LIMITS } from '@/lib/business-os/finance/financeHealth';
// MK-3 (SA-Q-MK3-1): Finance's two usage-log reads, bound once; this route names no usage-log reader.
import { recordedReads, runRecordedRead } from '@/app/api/admin/business-os/finance/recordedReads';
// Finance's own production wiring of R-a / R-a′, so this route names no new ledger reader (importer guard).
import { financeHealthDeps } from '@/lib/business-os/finance/financeHealthDeps';
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
    // MK-2 (RU-8): no dates means This month (UTC), the page's default.
    const window = parsed.data.from && parsed.data.to
      ? { from: parsed.data.from, to: parsed.data.to }
      : { from: `${toDate(today).slice(0, 7)}-01`, to: toDate(today) };

    // The report (whole billing periods), the window's charged AI cost and its recorded AI cost
    // (MK-3), in parallel. The recorded read never rejects (`runRecordedRead`).
    const instants = windowInstants(window);
    const [report, charged, recordedRun] = await Promise.all([
      buildCreditReport({ window, accountId }, requestLogger, {
        // Admin identity reads are called only from app/api/admin/** (repository guard).
        findNames: (ids) => businessProfileRepository.findAdminIdentitiesByUserIds(ids),
        now: () => now,
      }),
      buildChargedAiCostInWindowWithUnits({ window: instants, accountId }, requestLogger, {
        ledger: financeHealthDeps().ledger,
      }),
      runRecordedRead(
        recordedReads({ correlationId, adminId: gate.user.id }),
        accountId,
        { from: instants.start, to: instants.end },
        FINANCE_LIMITS.RECORDED_DEADLINE_MS
      ),
    ]);
    const chargedInWindow = charged.charged;
    const builtRecorded = recordedInWindow(charged, recordedRun.read);
    if (recordedRun.outcome !== 'ok') {
      requestLogger.warn({ read: 'recorded', outcome: recordedRun.outcome }, 'Recorded AI cost read did not complete');
    }
    const data: CreditReportResponse = { ...report, chargedInWindow, recorded: builtRecorded.recorded };

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
        charged: { status: chargedInWindow.status, rows: chargedInWindow.rows },
        // MK-3: which read, how it ended, counts and flags; never an amount or a difference.
        recorded: {
          status: builtRecorded.recorded.status,
          read: recordedRun.kind,
          outcome: recordedRun.outcome,
          ms: recordedRun.ms,
          ...builtRecorded.counts,
        },
      },
      'Admin read the Business OS credit cost report'
    );

    return NextResponse.json({ success: true, data });
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
