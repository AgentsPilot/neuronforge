/**
 * GET /api/admin/business-os/billing/subscriptions — the admin Subscriptions
 * list and its totals, including MRR (plan payments P-8a.1, AM-2 and AM-3;
 * workplan docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8A_WORKPLAN.md §5.3,
 * SA-WP-P8a).
 *
 * Order: requireAdmin (401/403) → repeated key (400) → strict Zod (400) → the
 * current Stripe mode (409 `stripe_mode_unknown` when the key's mode cannot be
 * read: no figure is ever shown for a guessed mode) → reads (500 on any
 * failure: a list with a missing read would misstate MRR) → the pure builder
 * → business names for the rows shown → 200.
 *
 * Read-only and cross-account, through the service-role repositories, which
 * is intentional: it is an admin read across accounts that no owner RLS client
 * can serve, reached only after `requireAdmin`. There is no caller-supplied
 * id. No Stripe call (Q-T9: our own records only) and no audit (a read, SA
 * Q-6). Every response is `no-store`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { currentStripeMode, type StripeMode } from '@/lib/business-os/billing/stripeMode';
import { subscriptionsDeps } from '@/lib/admin/billing/subscriptionsDeps';
import { buildSubscriptions } from '@/lib/admin/billing/subscriptionsView';
import { STRIPE_MODE_UNKNOWN, SUBSCRIPTION_STATUSES } from '@/lib/admin/billing/subscriptionsTypes';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';

const logger = createLogger({ module: 'AdminBosSubscriptionsAPI' });

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

const querySchema = z
  .object({
    status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  })
  .strict();

function serverMode(): StripeMode | null {
  try {
    return currentStripeMode();
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const gate = await requireAdmin(logger.child({ route: 'bos-subscriptions', method: 'GET' }));
  if (gate instanceof NextResponse) return noStore(gate);

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, adminId: gate.user.id });
  const startedAt = Date.now();

  try {
    const params = request.nextUrl.searchParams;
    const keys = [...params.keys()];
    if (new Set(keys).size !== keys.length) return errorResponse(400, 'Each query parameter may appear once');

    const parsed = querySchema.safeParse(Object.fromEntries(params.entries()));
    if (!parsed.success) {
      return errorResponse(400, 'The status filter is not valid.', parsed.error.flatten());
    }
    const status = parsed.data.status ?? null;

    const mode = serverMode();
    if (mode === null) {
      requestLogger.warn({ reason: 'stripe_mode_unknown' }, 'Subscriptions refused: Stripe key mode unknown');
      return errorResponse(409, STRIPE_MODE_UNKNOWN, { code: 'stripe_mode_unknown' });
    }

    const deps = subscriptionsDeps();
    const [billing, plans] = await Promise.all([deps.readBillingRows(mode === 'live'), deps.readPlanRows()]);
    if (billing.error || !billing.data) {
      requestLogger.error({ err: billing.error, read: 'billing' }, 'Subscriptions read failed');
      return errorResponse(500, 'Could not read the subscriptions. Try again.');
    }
    if (plans.error || !plans.data) {
      requestLogger.error({ err: plans.error, read: 'plans' }, 'Subscriptions read failed');
      return errorResponse(500, 'Could not read the plans. Try again.');
    }

    const now = new Date();
    const payload = buildSubscriptions({
      billingRows: billing.data,
      planRows: plans.data,
      config: deps.readConfig(),
      now,
      mode,
      status,
    });

    // Names only for the rows shown, after the cut. A failed name read leaves
    // the names empty (the page shows the id) and never fails the figures.
    const ids = payload.rows.map((row) => row.accountId).filter((id): id is string => id !== null);
    if (ids.length > 0) {
      const names = await businessProfileRepository.findAdminIdentitiesByUserIds(ids);
      if (names.error || !names.data) {
        requestLogger.warn({ err: names.error }, 'Subscriptions: business names could not be read');
      } else {
        const byId = new Map(names.data.map((identity) => [identity.user_id, identity.company_name]));
        for (const row of payload.rows) row.businessName = row.accountId === null ? null : byId.get(row.accountId) ?? null;
      }
    }

    // Counts, the mode and the filter only: never a business name or an id.
    requestLogger.info(
      {
        mode,
        status,
        accounts: payload.totals.accounts,
        matching: payload.matching,
        shown: payload.rows.length,
        currencies: payload.totals.mrr.length,
        durationMs: Date.now() - startedAt,
      },
      'Subscriptions read'
    );

    return NextResponse.json({ success: true, data: payload }, { headers: NO_STORE });
  } catch (error) {
    requestLogger.error({ err: error }, 'Subscriptions route failed');
    return errorResponse(500, 'Internal server error', error instanceof Error ? error.message : String(error));
  }
}
