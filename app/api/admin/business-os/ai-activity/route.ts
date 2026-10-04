/**
 * The admin AI Activity view (Gap B slice B1a: FR-B1, FR-B3, FR-B8, FR-B10,
 * FR-B12, FR-B13, NFR-1, NFR-10, AC-B14; slice B1b: the audit join, FR-B5
 * question 1, NFR-4.4, AC-B5, AC-B6). Workplan
 * docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B1_WORKPLAN.md § E.
 *
 *   GET /api/admin/business-os/ai-activity?from=YYYY-MM-DD&to=YYYY-MM-DD
 *       [&accountId=<uuid>][&area=<area>][&outcome=succeeded|failed]
 *       [&trigger=owner|scheduled|external][&minCostUsd=<dollars>]
 *       [&sort=time|cost][&limit=1..100]
 *
 * ADMIN ONLY, and a deliberate CROSS-ACCOUNT READ of the credit ledger: one
 * row per Business OS AI action, with what it was, whether it worked and what
 * it cost. Business names are read for display only and never logged. The
 * audit entries of the page's grouping ids are read across all accounts
 * (B1b) and matched to each charge by the builder on action id AND account;
 * another account's entry never leaves the server.
 *
 * Order, and nothing before it: requireAdmin (401/403) → repeated key (400) →
 * Zod, strict (400) → platform account (409, pure, no read) → the reads.
 * Nothing from the request reaches the database except validated values. The
 * window is REQUIRED (D-3): there is no default, so an unbounded read cannot
 * be asked for by leaving it out.
 *
 * READ-ONLY. No audit entry (the precedent of the cost report); the
 * accountability is one `info` log with the admin id, the correlation id, the
 * filters and the counts (AC-B8). Never a business name, never a row.
 *
 * @module app/api/admin/business-os/ai-activity
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { BOS_LLM_AREAS, isPlatformAccount } from '@/lib/business-os/llm/callCatalog';
import { AI_ACTIVITY_LIMITS, AiActivityListReadError, buildAiActivity } from '@/lib/business-os/credits/aiActivity';
import { aiActivityArchive, aiActivityLedger } from '@/lib/business-os/credits/aiActivityDeps';
import { auditTrailRepository } from '@/lib/repositories/AuditTrailRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';

const logger = createLogger({ module: 'AdminBosAiActivityAPI' });

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

function todayUtcMs(now: Date): number {
  return Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

const DATE = z.string().refine((v) => dateMs(v) !== null, 'must be a date, YYYY-MM-DD');

/**
 * The minimum-cost messages are shown on the Activity tab VERBATIM (QA E-2),
 * so they are written for the admin reading them: plain words, no parameter
 * name, and the actual reason for each refusal. What is accepted is exactly
 * the repository's own guard: up to 6 whole-dollar digits and at most the
 * ledger's 10 decimal places.
 */
// Not exported: a route file may export only route fields; the test asserts the literals.
const MIN_COST_MESSAGES = {
  format: 'Minimum cost must be a dollar amount written in digits, for example 0.05',
  tooLarge: 'Minimum cost must be less than $1,000,000',
  tooPrecise: 'Minimum cost can have at most 10 decimal places',
} as const;

function checkMinimumCost(value: string, ctx: z.RefinementCtx): void {
  const parts = /^(\d+)(?:\.(\d+))?$/.exec(value);
  const message = !parts
    ? MIN_COST_MESSAGES.format
    : parts[1].length > 6
      ? MIN_COST_MESSAGES.tooLarge
      : (parts[2]?.length ?? 0) > 10
        ? MIN_COST_MESSAGES.tooPrecise
        : null;
  if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
}

function buildQuerySchema(now: Date) {
  const today = todayUtcMs(now);
  return z
    .object({
      from: DATE,
      to: DATE,
      accountId: z.string().uuid('accountId must be a UUID').optional(),
      area: z.enum(BOS_LLM_AREAS).optional(),
      outcome: z.enum(['succeeded', 'failed']).optional(),
      trigger: z.enum(['owner', 'scheduled', 'external']).optional(),
      minCostUsd: z.string().superRefine(checkMinimumCost).optional(),
      sort: z.enum(['time', 'cost']).default('time'),
      limit: z
        .string()
        .regex(/^\d{1,3}$/, `limit must be 1 to ${AI_ACTIVITY_LIMITS.MAX_ROWS}`)
        .transform(Number)
        .refine((n) => n >= 1 && n <= AI_ACTIVITY_LIMITS.MAX_ROWS, `limit must be 1 to ${AI_ACTIVITY_LIMITS.MAX_ROWS}`)
        .default(String(AI_ACTIVITY_LIMITS.MAX_ROWS)),
    })
    // Strict: B1 refuses `actionId` (the deep link lands in B3) and any unknown key.
    .strict()
    .superRefine((q, ctx) => {
      const from = dateMs(q.from);
      const to = dateMs(q.to);
      if (from === null || to === null) return; // reported by the field refinements
      if (from > to) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'from must not be after to' });
        return;
      }
      if ((to - from) / DAY_MS + 1 > AI_ACTIVITY_LIMITS.MAX_WINDOW_DAYS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `The window may be at most ${AI_ACTIVITY_LIMITS.MAX_WINDOW_DAYS} days`,
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
  const startedAt = Date.now();

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
    const query = parsed.data;

    const accountId = query.accountId ?? null;
    // Pure check: a platform account's rows are the platform's, not a business's.
    if (accountId !== null && isPlatformAccount(accountId)) {
      return NextResponse.json({ success: false, error: 'platform_account' }, { status: 409 });
    }

    const filters = {
      accountId,
      area: query.area ?? null,
      outcome: query.outcome ?? null,
      trigger: query.trigger ?? null,
      minCostUsd: query.minCostUsd ?? null,
    };
    const window = { from: query.from, to: query.to };

    const payload = await buildAiActivity({ window, ...filters, sort: query.sort, limit: query.limit }, requestLogger, {
      ledger: aiActivityLedger(),
      // Admin identity reads are called only from app/api/admin/** (repository guard).
      findNames: (ids) => businessProfileRepository.findAdminIdentitiesByUserIds(ids),
      // B1b. Admin-pinned too; the group ids come from the page's charge rows, never the request.
      listAuditEntries: (groupIds, auditWindow) =>
        auditTrailRepository.listAiActionEntriesAllAccountsByGroupIds(
          { correlationId, adminId: gate.user.id },
          groupIds,
          auditWindow
        ),
      archive: aiActivityArchive(),
      now: () => now,
    });

    // Ids, filters and counts only: never a business name, never a row.
    requestLogger.info(
      {
        window,
        ...filters,
        sort: query.sort,
        limit: query.limit,
        rows: payload.rows.length,
        total: payload.total,
        capped: payload.capped,
        coverage: payload.cutover.coverage,
        names: payload.names,
        adjustments: payload.adjustments,
        unresolvedAdjustments: payload.unresolvedAdjustments,
        // Never silent: an amount that could not be read counts as 0, and is counted here.
        unreadableAmounts: payload.unreadableAmounts,
        deletedAccounts: payload.deletedAccounts
          ? { status: payload.deletedAccounts.status, count: payload.deletedAccounts.count, atLeast: payload.deletedAccounts.atLeast }
          : null,
        // B1b: counts over the rows shown, never an entry.
        audit: payload.audit
          ? { status: payload.audit.status, archive: payload.audit.archive, noEntry: payload.audit.noEntry }
          : null,
        durationMs: Date.now() - startedAt,
      },
      'Admin read the Business OS AI activity'
    );

    return NextResponse.json({ success: true, data: payload });
  } catch (error) {
    if (error instanceof AiActivityListReadError) {
      // Already logged by the builder with the read that failed.
      return NextResponse.json({ success: false, error: 'The AI activity could not be read. Try again.' }, { status: 500 });
    }
    requestLogger.error({ err: error }, 'Business OS AI activity read failed');
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
