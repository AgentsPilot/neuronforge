/**
 * GET /api/admin/business-os/billing/plans/[planId] — one plan's accounts,
 * statuses and MRR, for the Finance plan drawer (Money MK-8; KPI restructure
 * review §3 Plans & subscriptions, "Plan drawer"; workplan
 * docs/workplans/ADMIN_MONEY_MK8_FINANCE_DRAWERS_WORKPLAN.md §2.2).
 *
 * Order: requireAdmin (401/403) → no query key at all (400) → strict Zod on the
 * path (400) → the plan must be a configured plan (404 `plan_not_found`; the
 * id is compared with `config.tierOrder`, no tier literal) → the current
 * Stripe mode (409 `stripe_mode_unknown`, as Subscriptions) → the two reads
 * the Subscriptions list uses (500 on any failure: a list with a missing read
 * would misstate MRR) → the pure plan builder (one rule with the list) →
 * business names for the rows shown → 200.
 *
 * Read-only and cross-account through the service-role repositories, which is
 * intentional: an admin read across accounts, reached only after
 * `requireAdmin`. The only caller-supplied value is the plan id, which selects
 * rows but is never an account. No Stripe call, no audit (a read), no secret
 * column (the P8A-R3 column set). Every response is `no-store`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { currentStripeMode, type StripeMode } from '@/lib/business-os/billing/stripeMode';
import { subscriptionsDeps } from '@/lib/admin/billing/subscriptionsDeps';
import { buildPlanSubscriptions } from '@/lib/admin/billing/subscriptionsView';
import { STRIPE_MODE_UNKNOWN } from '@/lib/admin/billing/subscriptionsTypes';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';

const logger = createLogger({ module: 'AdminBosPlanDrawerAPI' });

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

/** A plan id by SHAPE only; whether it is a plan is the config's answer. */
const planIdSchema = z.string().regex(/^[a-z0-9_-]{1,64}$/, 'not a plan id');

/** The 404 sentence: the plan is not one of the configured plans. */
export const PLAN_NOT_FOUND = 'That plan is not one of the configured plans.';

function serverMode(): StripeMode | null {
  try {
    return currentStripeMode();
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, context: { params: { planId: string } }) {
  const gate = await requireAdmin(logger.child({ route: 'bos-plan-drawer', method: 'GET' }));
  if (gate instanceof NextResponse) return noStore(gate);

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, adminId: gate.user.id });
  const startedAt = Date.now();

  try {
    // No query key is accepted: the plan is the path, and nothing else selects rows.
    if ([...request.nextUrl.searchParams.keys()].length > 0) return errorResponse(400, 'This read takes no query parameters.');

    const parsed = planIdSchema.safeParse(context.params.planId);
    if (!parsed.success) return errorResponse(400, 'That does not look like a plan id.', parsed.error.flatten());
    const planId = parsed.data;

    const deps = subscriptionsDeps();
    const config = deps.readConfig();
    if (!config.tierOrder.includes(planId)) {
      requestLogger.info({ reason: 'plan_not_found' }, 'Plan drawer refused: not a configured plan');
      return errorResponse(404, PLAN_NOT_FOUND, { code: 'plan_not_found' });
    }

    const mode = serverMode();
    if (mode === null) {
      requestLogger.warn({ reason: 'stripe_mode_unknown' }, 'Plan drawer refused: Stripe key mode unknown');
      return errorResponse(409, STRIPE_MODE_UNKNOWN, { code: 'stripe_mode_unknown' });
    }

    const [billing, plans] = await Promise.all([deps.readBillingRows(mode === 'live'), deps.readPlanRows()]);
    if (billing.error || !billing.data) {
      requestLogger.error({ err: billing.error, read: 'billing' }, 'Plan drawer read failed');
      return errorResponse(500, 'Could not read the plan’s subscriptions. Try again.');
    }
    if (plans.error || !plans.data) {
      requestLogger.error({ err: plans.error, read: 'plans' }, 'Plan drawer read failed');
      return errorResponse(500, 'Could not read the plans. Try again.');
    }

    const payload = buildPlanSubscriptions({
      billingRows: billing.data,
      planRows: plans.data,
      config,
      now: new Date(),
      mode,
      status: null,
      planId,
    });

    // Names only for the rows shown. A failed name read leaves them empty and never fails the figures.
    const ids = payload.rows.map((row) => row.accountId).filter((id): id is string => id !== null);
    if (ids.length > 0) {
      const names = await businessProfileRepository.findAdminIdentitiesByUserIds(ids);
      if (names.error || !names.data) {
        requestLogger.warn({ err: names.error }, 'Plan drawer: business names could not be read');
      } else {
        const byId = new Map(names.data.map((identity) => [identity.user_id, identity.company_name]));
        for (const row of payload.rows) row.businessName = row.accountId === null ? null : byId.get(row.accountId) ?? null;
      }
    }

    // Counts and the mode only: never a business name or an id. The plan id is config data, not an account.
    requestLogger.info(
      {
        mode,
        planId,
        accounts: payload.totals.accounts,
        matching: payload.matching,
        shown: payload.rows.length,
        currencies: payload.totals.mrr.length,
        durationMs: Date.now() - startedAt,
      },
      'Plan drawer read'
    );

    return NextResponse.json({ success: true, data: payload }, { headers: NO_STORE });
  } catch (error) {
    requestLogger.error({ err: error }, 'Plan drawer route failed');
    return errorResponse(500, 'Internal server error', error instanceof Error ? error.message : String(error));
  }
}
