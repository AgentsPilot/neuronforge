/**
 * The credit leak check, on demand (credit deduction slice 4b, workplan §5.4;
 * SA-S9, FR-16 detection, AC-31).
 *
 *   GET /api/admin/business-os/credits/leak-check?from=YYYY-MM-DD&to=YYYY-MM-DD[&accountId=<uuid>]
 *
 * ADMIN ONLY. Compares every Business OS AI call in `token_usage` with the
 * credit ledger, per account and grouping id, for a window of at most 7 whole
 * UTC days (SA N-5; default: yesterday). The nightly door is
 * `app/api/cron/credit-leak-check`; both call `runCreditLeakCheck`.
 *
 * Order, and nothing before it: requireAdmin (401/403) → 400 (Zod, strict) →
 * 409 platform account (pure, no read) → the check. Nothing from the request
 * reaches the database except the validated dates and account id.
 *
 * READ-ONLY. No audit entry (the precedent of the cost report); the check logs
 * its own findings (`bos_credit_leak_found` at error per leaking account, the
 * known paths at warn, a summary at info) and this route adds one `info` line
 * with the admin id. Business names are looked up for display only and never
 * logged.
 *
 * @module app/api/admin/business-os/credits/leak-check
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { isPlatformAccount } from '@/lib/business-os/llm/callCatalog';
import { LEAK_CHECK_LIMITS, runCreditLeakCheck } from '@/lib/business-os/credits/creditLeakCheck';
import { creditLeakCheckDeps } from '@/lib/business-os/credits/creditLeakCheckDeps';
import type { CreditLeakCheckResult } from '@/lib/business-os/credits/creditLeakCheckTypes';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';

const logger = createLogger({ module: 'AdminBosCreditLeakCheckAPI' });

// Node: Pino and the repositories are Node-only. An admin- and cookie-dependent
// GET must never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The check stops starting accounts at 45 s (LEAK_CHECK_LIMITS.RUN_DEADLINE_MS).
export const maxDuration = 60;

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
      if ((to - from) / DAY_MS + 1 > LEAK_CHECK_LIMITS.MAX_ON_DEMAND_DAYS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `The leak check window may be at most ${LEAK_CHECK_LIMITS.MAX_ON_DEMAND_DAYS} days`,
        });
      }
      // One day of tolerance: an admin east of UTC is already on "tomorrow".
      // The check itself pulls an end later than "now − 6 min" back.
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
    // Pure check: the platform account's spend is counted, never checked as a business's.
    if (accountId !== null && isPlatformAccount(accountId)) {
      return NextResponse.json({ success: false, error: 'platform_account' }, { status: 409 });
    }

    // Whole UTC days, `[from 00:00, to + 1 day 00:00)`. Default: yesterday.
    const today = todayUtcMs(now);
    const fromMs = parsed.data.from ? dateMs(parsed.data.from)! : today - DAY_MS;
    const toMs = parsed.data.to ? dateMs(parsed.data.to)! : today - DAY_MS;

    const result: CreditLeakCheckResult = await runCreditLeakCheck(
      {
        window: { start: new Date(fromMs), end: new Date(toMs + DAY_MS) },
        accountId,
        deadlineAt: now.getTime() + LEAK_CHECK_LIMITS.RUN_DEADLINE_MS,
        trigger: 'on_demand',
      },
      creditLeakCheckDeps(),
      requestLogger
    );

    // Display only: names are never logged (and never reach the check).
    const ids = result.accounts.map((a) => a.accountId);
    if (ids.length > 0) {
      try {
        const { data } = await businessProfileRepository.findAdminIdentitiesByUserIds(ids);
        const names = new Map((data ?? []).map((row) => [row.user_id, row.company_name ?? null]));
        for (const account of result.accounts) account.companyName = names.get(account.accountId) ?? null;
      } catch (err) {
        requestLogger.warn({ err }, 'Business names for the leak check could not be read; ids are shown');
      }
    }

    requestLogger.info(
      {
        window: result.window,
        accountId,
        accountsChecked: result.accountsChecked,
        accountsWithLeak: result.accountsWithLeak,
        accountsIncomplete: result.accountsIncomplete,
        accountsNotChecked: result.accountsNotChecked,
        accountsRemaining: result.accountsRemaining,
        listingFailed: result.listingFailed,
      },
      'Admin ran the Business OS credit leak check'
    );

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    requestLogger.error({ err: error }, 'Business OS credit leak check failed');
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
