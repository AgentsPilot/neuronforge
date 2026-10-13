/**
 * POST /api/business-os/billing/plan/upgrade
 *
 * Upgrade the SIGNED-IN owner's paid plan now (plan payments P-7b.1a;
 * workplan docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P7B1_WORKPLAN.md §3.4;
 * SA U-1, U-2, U-5, U-9, V-1 to V-11, Q-1, Q-2, Q-4, Q-6).
 *
 * Body (strict; any other key is refused with 400, so an injected `userId`,
 * `subscriptionId`, `priceId` or amount never reaches the service):
 *   { tier: <a tier from TIER_ORDER>, prorationDate: <the preview's, unix seconds> }
 *
 * 200 → { success: true, data: { outcome } } where outcome is
 *   'upgraded' | 'processing' (the screen treats both as "Upgrading…")
 *   | 'action_required' (+ clientSecret, for Stripe.js 3-D Secure; fresh or
 *     resumed, Q-2)
 *   | 'declined' (+ retryAfter when Stripe keeps the pending update, Q-6).
 * THE CONFIRMATION SECRET (SA V-1) appears in this 200 body and nowhere else:
 * never a log line, an audit entry or an error.
 *
 * Refusals answer { success: false, error, code } from PLAN_UPGRADE_REFUSALS.
 * A `stripe_error` with `outcomeUnknown: true` (SA V-3) means the write was
 * attempted and its answer was lost: the screen never says "nothing
 * changed", and a retry with the SAME prorationDate replays at Stripe.
 *
 * Behind `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` (off by default): while off, the
 * route answers 404 before reading the session, the body, the database or
 * Stripe. Who the account is comes from the session only (`getUser()`, then
 * the account seam `resolveAccountId`). `TIER_ORDER` builds the body schema.
 * It refuses a SALE, never a capability (a recorded non-gate, SR-17). It
 * ASSIGNS NO PLAN: the webhook applies the paid upgrade invoice.
 *
 * Audit (U-9, WC-7): BOS_BILLING_UPGRADE_REQUESTED, once per request that
 * reached the write (whatever the outcome, incl. unknown), flushed before the
 * response. Refusals are logged, never audited.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { PLAN_UPGRADE_REFUSALS, confirmPlanUpgrade, type PlanUpgradeAuditFacts } from '@/lib/business-os/billing/planUpgrade';
import { isPlanCheckoutEnabled } from '@/lib/business-os/billing/planCheckoutFlag';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'BosPlanUpgradeAPI' });

const ConfirmBodySchema = z
  .object({
    tier: z.enum(TIER_ORDER),
    prorationDate: z.number().int().positive(),
  })
  .strict();

export async function POST(request: NextRequest) {
  // Off: the route looks absent, and nothing is read.
  if (!isPlanCheckoutEnabled()) {
    return NextResponse.json({ success: false, error: 'Not found', code: 'not_available' }, { status: 404 });
  }

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid input', code: 'invalid_input' }, { status: 400 });
    }
    const parsed = ConfirmBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          code: 'invalid_input',
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400 }
      );
    }
    const { tier, prorationDate } = parsed.data;

    // The session's account, through the seam. Never a request value.
    const accountId = resolveAccountId(user.id);
    requestLogger.info({ userId: user.id, accountId, tier, prorationDate }, 'Plan upgrade requested');

    const result = await confirmPlanUpgrade({ userId: user.id, tier, prorationDate }, { logger: requestLogger });

    // WC-7: every request that reached the write is audited before responding,
    // whatever the outcome. Bounded; never throws.
    const audit = (facts: PlanUpgradeAuditFacts) =>
      logAndFlush(
        {
          action: AUDIT_EVENTS.BOS_BILLING_UPGRADE_REQUESTED,
          entityType: 'business_os_billing_account',
          entityId: accountId,
          userId: user.id,
          details: {
            fromTier: facts.fromTier,
            toTier: facts.toTier,
            lookupKey: facts.lookupKey,
            prorationDate: facts.prorationDate,
            outcome: facts.outcome,
            resumed: facts.resumed,
            invoiceId: facts.invoiceId,
            subscriptionId: facts.subscriptionId,
            livemode: facts.livemode,
            actor: 'owner',
            correlationId,
          },
          request,
        },
        requestLogger,
        { reason: 'plan upgrade requested', continues: 'the outcome is returned regardless' }
      );

    if (!result.ok) {
      if (result.audit) await audit(result.audit);
      const refusal = PLAN_UPGRADE_REFUSALS[result.code];
      return NextResponse.json(
        {
          success: false,
          error: refusal.message,
          code: result.code,
          ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}),
          ...(result.outcomeUnknown ? { outcomeUnknown: true } : {}),
        },
        { status: refusal.status }
      );
    }

    await audit(result.audit);

    if (result.outcome === 'action_required') {
      return NextResponse.json({ success: true, data: { outcome: result.outcome, clientSecret: result.clientSecret } });
    }
    if (result.outcome === 'declined') {
      return NextResponse.json({
        success: true,
        data: { outcome: result.outcome, ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}) },
      });
    }
    return NextResponse.json({ success: true, data: { outcome: result.outcome } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Plan upgrade failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details:
          process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
      },
      { status: 500 }
    );
  }
}
