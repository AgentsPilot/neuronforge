/**
 * The Finance History block's one route (finance slice 8.3, §11M.8 HS-FR-9 to
 * HS-FR-16, E-98 to E-101; workplan
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_8_3_HISTORY_BLOCK_WORKPLAN.md §3).
 *
 *   GET /api/admin/business-os/finance/history?preset=today|7d|30d|this_month|custom
 *       [&from=YYYY-MM-DD&to=YYYY-MM-DD]
 *
 * ADMIN ONLY, a platform read. Order, and nothing before it: requireAdmin
 * (401 / 403) → repeated key (400) → strict Zod (400) → the window, resolved
 * with this request's own clock → two reads → the pure view.
 *
 * ALL BUSINESSES ONLY (HS-W-8): `accountId` is refused (400), and so is
 * `since_start` (it needs a business) and any other key. The table holds
 * platform aggregates with no account, so there is no caller id to scope.
 *
 * A SEPARATE ROUTE ON PURPOSE (CF-9): the page's own request, payload (AC-145)
 * and request pins (AC-173) are untouched; the block sends this only when the
 * admin opens it (E-85).
 *
 * RETURNS A VIEW, NOT ROWS (E-99): the browser only formats. Not installed
 * (E-100): 200 with `state: 'not_installed'` and a `warn`, so the block shows a
 * calm notice. READ-ONLY: no audit entry (as the finance route, SA-Q11); one
 * `info` line with ids, the window, the state, a row count and timing, never a
 * value. Every response is `Cache-Control: no-store`.
 *
 * @module app/api/admin/business-os/finance/history
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { ADMIN_WINDOW_CHOICES, customRangeProblem, isRealDate, todayUtc } from '@/app/admin/components/adminWindowPresets';
import { resolveFinanceWindow } from '@/lib/business-os/finance/financeWindow';
import { buildHistoryView, dayBefore, notInstalledHistoryView } from '@/lib/business-os/finance/historyView';
import { financeHistoryDeps } from '@/lib/business-os/finance/financeHistoryDeps';

const logger = createLogger({ module: 'AdminBosFinanceHistoryAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function errorResponse(status: number, error: string, details?: unknown): NextResponse {
  return NextResponse.json(
    { success: false, error, details: process.env.NODE_ENV === 'development' ? details : undefined },
    { status, headers: NO_STORE }
  );
}

const INVALID_QUERY = 'The filters are not valid. Check the dates and the window.';
const READ_FAILED = 'Could not read the finance history.';

const DATE = z.string().refine(isRealDate, 'must be a date, YYYY-MM-DD');

function buildHistoryQuerySchema(now: Date) {
  return z
    .object({
      preset: z.enum(ADMIN_WINDOW_CHOICES).default('this_month'),
      // Format-checked for every preset; their values are used only for custom (SA-W6).
      from: DATE.optional(),
      to: DATE.optional(),
    })
    .strict()
    .superRefine((q, ctx) => {
      if (q.preset !== 'custom') return;
      if (!q.from || !q.to) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A custom window needs from and to' });
        return;
      }
      if (!isRealDate(q.from) || !isRealDate(q.to)) return;
      const problem = customRangeProblem(q.from, q.to, now);
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    });
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const baseLogger = logger.child({ correlationId });

  // Admin gate. Nothing above this line may touch a request body,
  // the database, a job queue, or an outbound message.
  const gate = await requireAdmin(baseLogger);
  if (gate instanceof NextResponse) return noStore(gate);

  const requestLogger = baseLogger.child({ adminId: gate.user.id });
  const startedAt = Date.now();

  try {
    const params = request.nextUrl.searchParams;
    const keys = [...params.keys()];
    if (new Set(keys).size !== keys.length) {
      return errorResponse(400, 'Each query parameter may appear once');
    }

    // The request's one clock: the window and the last day a snapshot can exist for.
    const now = new Date();
    const parsed = buildHistoryQuerySchema(now).safeParse(Object.fromEntries(params.entries()));
    if (!parsed.success) {
      return errorResponse(400, INVALID_QUERY, { issue: parsed.error.issues[0]?.message, ...parsed.error.flatten() });
    }
    const query = parsed.data;
    const resolved = resolveFinanceWindow({ preset: query.preset, from: query.from ?? null, to: query.to ?? null }, now);
    const window = { from: resolved.from, to: resolved.to };
    const latestDay = dayBefore(todayUtc(now));
    const readTo = window.to < latestDay ? window.to : latestDay;

    const deps = financeHistoryDeps();
    const [first, range] = await Promise.all([
      deps.snapshots.findFirstSnapshotDate(),
      readTo < window.from
        ? Promise.resolve({ data: { state: 'ready' as const, rows: [] }, error: null })
        : deps.snapshots.listSnapshotsInRange(window.from, readTo),
    ]);

    if (first.error || !first.data || range.error || !range.data) {
      requestLogger.error({ err: first.error ?? range.error, window }, 'Finance history read failed');
      return errorResponse(500, READ_FAILED, (first.error ?? range.error)?.message);
    }

    if (first.data.state === 'not_installed' || range.data.state === 'not_installed') {
      requestLogger.warn({ tableMissing: true, window }, 'Finance history table is not installed yet');
      return NextResponse.json({ success: true, data: notInstalledHistoryView(window) }, { headers: NO_STORE });
    }

    const view = buildHistoryView({
      window,
      latestDay,
      firstSnapshotDate: first.data.firstDate,
      rows: range.data.rows,
      config: deps.config,
    });
    requestLogger.info(
      { window, state: view.state, weekly: view.weekly, rows: range.data.rows.length, durationMs: Date.now() - startedAt },
      'Admin read the Finance history'
    );
    return NextResponse.json({ success: true, data: view }, { headers: NO_STORE });
  } catch (error) {
    requestLogger.error({ err: error }, 'Finance history read failed');
    return errorResponse(500, 'Internal server error', error instanceof Error ? error.message : String(error));
  }
}
