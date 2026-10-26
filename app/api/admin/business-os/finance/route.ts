/**
 * The admin finance & business health page's one route (slice 1a, S1-FR-7 to
 * S1-FR-11, SEC-1 to SEC-10). Workplan
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_WORKPLAN.md § The route.
 *
 *   GET /api/admin/business-os/finance?preset=today|7d|30d|this_month|custom|since_start
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
 * Slice 2a adds the takings block (the businesses' client payments, not our
 * revenue) to the payload, and its status and counts to the same line: never
 * an amount, a currency total or a name (S2-FR-12, SEC-8). No new query
 * parameter: the strict schema still refuses any other key, `currency`
 * included (AC-46).
 *
 * Slice 2b adds the client payment problems block. Its reminder figures are
 * the jobs & queues admin read, bound here to this request's admin context
 * and the reminder queue, and injected (SA-Q14): this is the one finance file
 * allowed to name that read. The builder calls it only when no business is
 * picked, under a 2 s deadline. The block's status, its five part states and
 * its counts join the same line: never an amount, a currency, a due date or
 * a name. Still no new query parameter.
 *
 * Slice 4a turns "Our revenue" into a section with the platform's boost
 * revenue; its boost status and counts join the same line (`revenueBoosts`,
 * `counts.boosts`): never an amount, a currency, a package or a name
 * (S4-FR-10, SEC-8). Still no new query parameter.
 *
 * Slice 5a adds the platform's plan payments received to that section. Its
 * status (`revenuePlans`), its counts (`counts.plans`) and whether the
 * platform-wide revenue head count ran (`counts.revenueExistence`: it is not
 * called with a business picked, SA-Q35) join the same line: counts, booleans
 * and state words only, never an amount, a currency, a tier or a name
 * (M2-FR-11). Still no new query parameter.
 *
 * Slice 6a (Money M-3) adds FOUR query parameters for the Accounts tab: `tab`
 * (`accounts` only; absent = Overview), `sort`, `group` and `show`. `sort`,
 * `group` and `show` are accepted only together with `tab=accounts` (E-48),
 * and `tab` never with `accountId` (SA-W84): each is a 400. `group` is matched
 * by SHAPE through `FINANCE_GROUP_SHAPE`, imported from the page's pure URL
 * module (one definition, SA-W83), so no tier is written here. None of the
 * four is an id or reaches a query: they only order and select rows already
 * read. The line gains `sections.accountEconomics` and
 * `counts.accountEconomics`: counts, booleans and enum words, `group` as its
 * kind, never a tier id, an amount, a currency or a name (M3-FR-14).
 *
 * Money M-4 (OV-5, §11F.7) adds Section 3's recorded AI cost from two
 * usage-log reads: the Health tile's all-accounts read
 * `listCostPointsAllAccountsInWindow` (no business picked) and the Businesses
 * drawer's one-account read `listCallsInWindow` (exactly the picked id, which
 * the builder has already checked). Since Money MK-3 (SA-Q-MK3-1) both are
 * bound once, in `./recordedReads.ts`, which this route and the AI cost
 * report route share; this route names no usage-log reader itself (the
 * finance source guard). They are bound to this request's admin read context
 * and injected, the 2b precedent, each with `end` less 1 ms (SA-Q52). The
 * line gains `sections.aiRecorded` (a status) and `counts.aiRecorded` (which
 * read, how it ended, counts and flags): never an amount, a difference, a
 * feature value, a session id or a name (M4-FR-9). Still no new query
 * parameter.
 *
 * DF-6 (§11L, E-75, SA-Q92) adds one window choice, `since_start`, Finance's
 * own (the shared `ADMIN_WINDOW_CHOICES` is not edited, so Activity and the
 * credit report are unchanged). It is accepted ONLY with `accountId` (a 400
 * otherwise, BD-26) and resolved here, purely, from the cut-over constant and
 * this request's clock: no plan row, no read, no timezone. It is the only
 * window longer than 92 days; `custom` keeps the 92-day cap with or without a
 * business. The pinned schema is untouched: `parseFinanceQuery` admits the
 * choice around it. The builder, its order and every read are unchanged.
 *
 * Every response, success or error, is `Cache-Control: no-store` (SEC-9).
 *
 * Money MK-4 (KPI restructure review SA-2, SA-4): MRR now joins the payload as
 * `mrr` and `stripeMode`, read by `lib/admin/billing/financeMrr` (the mode is
 * decided there, never here) BESIDE the builder, never inside it. A failed MRR
 * read is its own `unknown` section and never fails the page. The query
 * schema is unchanged.
 *
 * Money MK-5b (§5.1 F-K5b, SA-10): the builder adds `converted` (Converted
 * this month), through the wiring's `converted` reads; the billing mode is
 * decided in `lib/admin/billing`, never here. The line gains
 * `sections.converted` (a status) and `counts.converted` (counts only, never
 * an id, a date or a name). The query schema is unchanged.
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
import { readFinanceMrr } from '@/lib/admin/billing/financeMrr';
import { resolveFinanceWindow } from '@/lib/business-os/finance/financeWindow';
import { ADMIN_WINDOW_CHOICES, customRangeProblem, isRealDate } from '@/app/admin/components/adminWindowPresets';
import { FINANCE_ACCOUNTS_SHOWS, FINANCE_ACCOUNTS_SORTS, FINANCE_GROUP_SHAPE } from '@/app/admin/finance/financeUrl';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { adminJobsQueuesRepository } from '@/lib/repositories/AdminJobsQueuesRepository';
// Money MK-3 (SA-Q-MK3-1): the recorded AI cost's two usage-log reads, bound once for this route and the AI cost report.
import { recordedReads } from './recordedReads';

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
      // Slice 6a (SA-Q43, SA-Q44): the Accounts tab and its sort and filters.
      tab: z.enum(['accounts']).optional(),
      sort: z.enum(FINANCE_ACCOUNTS_SORTS).optional(),
      group: z.string().regex(FINANCE_GROUP_SHAPE, 'group must be a plan group').optional(),
      show: z.enum(FINANCE_ACCOUNTS_SHOWS).optional(),
    })
    .strict()
    .superRefine((q, ctx) => {
      // E-48: the tab's sort and filters only with the tab.
      if (q.tab !== 'accounts' && (q.sort !== undefined || q.group !== undefined || q.show !== undefined)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'sort, group and show need tab=accounts' });
      }
      // SA-W84: the tab is all businesses only.
      if (q.tab !== undefined && q.accountId !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'tab cannot be used with a business picked' });
      }
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

/** The validated query; `preset` also takes Finance's own `since_start` (DF-6, E-80). */
type FinanceRouteQuery = Omit<z.infer<ReturnType<typeof buildQuerySchema>>, 'preset'> & {
  preset: z.infer<ReturnType<typeof buildQuerySchema>>['preset'] | 'since_start';
};

/** DF-6 (DF6-FR-2, BD-26): the only window longer than 92 days is for one business. */
const SINCE_START_NEEDS_A_BUSINESS = 'since_start needs a business picked';

/**
 * DF-6 (DF6-FR-1, DF6-FR-2). The schema above is pinned byte for byte (AC-173
 * part B), so Finance's own `since_start` is admitted here, AROUND it, and the
 * shared `ADMIN_WINDOW_CHOICES` is not edited: every other key of a since-start
 * request goes through the same strict schema (unknown keys, the date format of
 * an ignored `from` / `to`, E-48, SA-W84 all unchanged), and the choice is then
 * accepted only with `accountId`. Any other `preset` value, `since-start`
 * included, is the schema's own 400.
 */
function parseFinanceQuery(
  raw: Record<string, string>,
  now: Date
): { success: true; data: FinanceRouteQuery } | { success: false; error: z.ZodError } {
  if (raw.preset !== 'since_start') return buildQuerySchema(now).safeParse(raw);
  // Every key but the choice goes through the pinned schema (its default window is then replaced).
  const rest = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'preset'));
  const parsed = buildQuerySchema(now).safeParse(rest);
  if (!parsed.success) return parsed;
  if (parsed.data.accountId === undefined) {
    return {
      success: false,
      error: new z.ZodError([{ code: z.ZodIssueCode.custom, message: SINCE_START_NEEDS_A_BUSINESS, path: ['preset'] }]),
    };
  }
  return { success: true, data: { ...parsed.data, preset: 'since_start' } };
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const baseLogger = logger.child({ correlationId });

  // Admin gate. Nothing above this line may touch a request body,
  // the database, a job queue, or an outbound message.
  const gate = await requireAdmin(baseLogger);
  if (gate instanceof NextResponse) return noStore(gate);

  const requestLogger = baseLogger.child({ adminId: gate.user.id });
  // The admin read context of the two cross-account admin reads: R-j (slice 2b, the jobs & queues
  // read) and, since M-4, the all-accounts recorded AI cost read. Each refuses to run without it.
  const adminReadContext = { correlationId, adminId: gate.user.id };
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
    const parsed = parseFinanceQuery(Object.fromEntries(params.entries()), now);
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

    // Slice 6a: the defaults are applied here, so the builder always has a full query.
    const accountsTab =
      query.tab === 'accounts' ? { sort: query.sort ?? 'ai_cost', group: query.group ?? null, show: query.show ?? 'all' } : null;

    // MK-4: all businesses, started beside the builder; a picked business only once the builder
    // has found its plan row (no read for an id that is not a business). Never rejects.
    const mrrRead = accountId === null ? readFinanceMrr(null) : null;

    const result = await buildFinanceHealth({ window, accountId, now, accountsTab }, requestLogger, {
      ...financeHealthDeps(),
      // Admin identity reads are called only from app/api/admin/** (repository guard, SEC-5).
      findNames: (ids) => businessProfileRepository.findAdminIdentitiesByUserIds(ids),
      // R-j (SA-Q14): the jobs & queues admin read, its one definition of stuck and dead-lettered.
      readReminderFigures: (readAt, signal) =>
        adminJobsQueuesRepository.readQueueFiguresAllAccounts(adminReadContext, 'payment_reminders', readAt, { signal }),
      // M-4 (§11F.7): the two recorded AI cost reads (all accounts with no business picked; exactly
      // the picked id otherwise), bound once in `recordedReads.ts` (MK-3, SA-Q-MK3-1).
      ...recordedReads(adminReadContext),
    });

    if (result.kind === 'account_not_found') return errorResponse(404, 'Business not found');
    if (result.kind === 'account_check_failed') {
      return errorResponse(500, 'Could not check this business. Try again.');
    }

    const { payload: built, counts } = result;
    const { mrr, stripeMode } = await (mrrRead ?? readFinanceMrr(accountId));
    const payload = { ...built, mrr, stripeMode };
    // Ids, filters, statuses and counts only: never a business name, never a
    // figure (no credit figure either). `counts.creditAccounts` and
    // `counts.creditsPass` make the credit pass's scale trigger visible from
    // this route too (SA-WR-13). `counts.takings` (slice 2a) and
    // `counts.paymentProblems` (slice 2b) are counts, booleans and state
    // words only (S2-FR-12); so are `counts.boosts` (slice 4a, S4-FR-10),
    // `counts.plans` and `counts.revenueExistence` (slice 5a, M2-FR-11), and
    // `counts.accountEconomics` (slice 6a, M3-FR-14: `group` as its kind), and
    // `counts.aiRecorded` (M-4, M4-FR-9: which read, how it ended, counts and flags).
    requestLogger.info(
      {
        window: { preset: window.preset, from: window.from, to: window.to },
        accountId,
        sections: {
          revenue: payload.revenue.status,
          revenueBoosts: payload.revenue.boosts.status,
          revenuePlans: payload.revenue.plans.status,
          accounts: payload.accounts.status,
          // Slice 6a: `not_built` on the Overview and with a business picked.
          accountEconomics: payload.accountEconomics?.status ?? 'not_built',
          aiCost: payload.aiCost.status,
          // M-4: the recorded AI cost's status; `not_built` on the Accounts tab.
          aiRecorded: payload.aiCost.recorded?.status ?? 'not_built',
          credits: payload.credits.status,
          takings: payload.takings.status,
          // MK-4: MRR now, its status and the lines count only (never a figure).
          mrr: { status: mrr.status, currencies: mrr.lines.length },
          // MK-5b: Converted this month, its status only (the counts are in `counts.converted`).
          converted: payload.converted?.status ?? 'not_built',
          // MK-9: F-K5's breakdown, the trial part's status only (its counts are in `counts.payingBreakdown`).
          payingBreakdown: payload.payingBreakdown?.trials.status ?? 'not_built',
          paymentProblems: {
            block: payload.paymentProblems.status,
            overdueInvoices: payload.paymentProblems.overdueInvoices.status,
            overdueInstalments: payload.paymentProblems.overdueInstalments.status,
            clientPlans: payload.paymentProblems.clientPlans.status,
            reminders: payload.paymentProblems.reminders.state,
            failedPayments: payload.paymentProblems.failedPayments.state,
          },
        },
        tiles: {
          k1: payload.tiles.k1.status,
          k2: payload.tiles.k2.status,
          k3: payload.tiles.k3.status,
          k4: payload.tiles.k4.status,
          k5: payload.tiles.k5.status,
        },
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
