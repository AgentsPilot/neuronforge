/**
 * The admin finance & business health page's one route (slice 1a, S1-FR-7 to
 * S1-FR-11, SEC-1 to SEC-10). Workplan
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_WORKPLAN.md § The route.
 *
 *   GET /api/admin/business-os/finance?preset=today|7d|30d|this_month|custom
 *       [&from=YYYY-MM-DD&to=YYYY-MM-DD][&accountId=<uuid>]
 *
 * ADMIN ONLY, a deliberate CROSS-ACCOUNT READ. Order, and nothing before it:
 * requireAdmin (401/403) → repeated key (400) → strict Zod (400) → a platform
 * account id (404, pure) → the builder, which checks the picked business
 * against the plan table first (404 / 500) and then reads every section
 * settled on its own (a failed section is `unknown`, never a 500).
 *
 * The URL is input, never authority: for a preset, client `from` / `to` are
 * format-checked and IGNORED, and the window is resolved from this request's
 * one clock (SA-Q2, SA-W6).
 *
 * READ-ONLY. No audit entry (SA-Q11); the accountability is one `info` line
 * with the admin id, the correlation id, the validated filters (an account id,
 * never a name), the section statuses, counts and timing. Never a business
 * name, an email or a per-account figure.
 *
 * Every response, success or error, is `Cache-Control: no-store` (SEC-9).
 *
 * @module app/api/admin/business-os/finance
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { isPlatformAccount } from '@/lib/business-os/llm/callCatalog';
import { buildFinanceHealth } from '@/lib/business-os/finance/financeHealth';
import { financeHealthDeps } from '@/lib/business-os/finance/financeHealthDeps';
import { resolveFinanceWindow } from '@/lib/business-os/finance/financeWindow';
import { ADMIN_WINDOW_CHOICES, customRangeProblem, isRealDate } from '@/app/admin/components/adminWindowPresets';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';

const logger = createLogger({ module: 'AdminBosFinanceAPI' });

// Node: Pino and the repositories are Node-only. An admin- and cookie-dependent
// GET must never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** Every response leaves through here, so none can miss the header (AC-35). */
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

/** The 400 body's message: short and for the admin (CLAUDE.md error format, QA-3). */
const INVALID_QUERY = 'The filters are not valid. Check the dates, the window and the business.';

const DATE = z.string().refine(isRealDate, 'must be a date, YYYY-MM-DD');

function buildQuerySchema(now: Date) {
  return z
    .object({
      preset: z.enum(ADMIN_WINDOW_CHOICES).default('this_month'),
      // Format-checked for every preset; their VALUES are used only for custom (SA-W6).
      from: DATE.optional(),
      to: DATE.optional(),
      accountId: z.string().uuid('accountId must be a UUID').optional(),
    })
    .strict()
    .superRefine((q, ctx) => {
      if (q.preset !== 'custom') return;
      if (!q.from || !q.to) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A custom window needs from and to' });
        return;
      }
      if (!isRealDate(q.from) || !isRealDate(q.to)) return; // reported by the field refinements
      // The page's URL parser applies the same function, so the two cannot
      // disagree (SA-3): from <= to, to not after today UTC (no tolerance,
      // AC-34), at most 92 inclusive days.
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
    // A repeated key would be silently collapsed by Object.fromEntries (AC-33).
    if (new Set(keys).size !== keys.length) {
      return errorResponse(400, 'Each query parameter may appear once');
    }

    // The request's one clock: the window, K-1's spans, the cut-over and generatedAt.
    const now = new Date();
    const parsed = buildQuerySchema(now).safeParse(Object.fromEntries(params.entries()));
    if (!parsed.success) {
      // Zod's own detail only in development (QA-3).
      return errorResponse(400, INVALID_QUERY, {
        issue: parsed.error.issues[0]?.message,
        ...parsed.error.flatten(),
      });
    }
    const query = parsed.data;
    const accountId = query.accountId?.toLowerCase() ?? null;

    // A platform account is not a business: the same 404 as any id with no plan row (SA-F14).
    if (accountId !== null && isPlatformAccount(accountId)) {
      return errorResponse(404, 'Business not found');
    }

    const window = resolveFinanceWindow(
      { preset: query.preset, from: query.from ?? null, to: query.to ?? null },
      now
    );

    const result = await buildFinanceHealth({ window, accountId, now }, requestLogger, {
      ...financeHealthDeps(),
      // Admin identity reads are called only from app/api/admin/** (repository guard, SEC-5).
      findNames: (ids) => businessProfileRepository.findAdminIdentitiesByUserIds(ids),
    });

    if (result.kind === 'account_not_found') return errorResponse(404, 'Business not found');
    if (result.kind === 'account_check_failed') {
      return errorResponse(500, 'Could not check this business. Try again.');
    }

    const { payload, counts } = result;
    // Ids, filters, statuses and counts only: never a business name, never a figure.
    requestLogger.info(
      {
        window: { preset: window.preset, from: window.from, to: window.to },
        accountId,
        sections: { revenue: payload.revenue.status, accounts: payload.accounts.status, aiCost: payload.aiCost.status },
        tiles: { k1: payload.tiles.k1.status, k3: payload.tiles.k3.status, k5: payload.tiles.k5.status },
        counts,
        coverage: payload.aiCost.coverage,
        durationMs: Date.now() - startedAt,
      },
      'Admin read the Business OS finance page'
    );

    return NextResponse.json({ success: true, data: payload }, { headers: NO_STORE });
  } catch (error) {
    requestLogger.error({ err: error }, 'Business OS finance read failed');
    return errorResponse(500, 'Internal server error', error instanceof Error ? error.message : String(error));
  }
}
