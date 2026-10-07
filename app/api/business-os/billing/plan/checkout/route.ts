/**
 * POST /api/business-os/billing/plan/checkout
 *
 * Open a Business OS plan checkout for the SIGNED-IN owner (plan payments
 * P-3a; workplan docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P3A_WORKPLAN.md §3).
 *
 * Body (strict; any other key is refused with 400, so an injected `userId`,
 * `accountId`, `customerId`, `priceId` or `amount` never reaches the service):
 *   { tier: <a tier from TIER_ORDER>, returnTo: 'settings_plan' | 'awaiting_payment' | 'test_harness' }
 *
 * 200 → { success: true, data: { clientSecret, sessionId, expiresAt, tier } }.
 * The client secret goes to the owner's browser only; it is never logged.
 *
 * Behind `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` (off by default): while off, the
 * route answers 404 before reading the session, the body, the database or
 * Stripe (SA Q-6). It ASSIGNS NO PLAN: P-3b does that from the webhook.
 *
 * Who the account is comes from the session only (`getUser()`, then the
 * account seam `resolveAccountId`). The email for a new Stripe customer is the
 * session's too (SA Q-11). This route imports `resolveAccountId` and
 * `getEntitlementService` (for `getSnapshot`, to refuse an account with no
 * plan row, SA Q-4) and `TIER_ORDER` for the body schema; it decides nothing
 * by tier or capability, so it is a recorded non-gate (SA Q-10).
 *
 * The start is audited (BOS_BILLING_CHECKOUT_STARTED) and flushed before the
 * response (WC-7). Refusals are logged by the service, not audited (SA Q-9).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { getEntitlementService } from '@/lib/business-os/entitlements/EntitlementService';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import {
  PLAN_CHECKOUT_REFUSALS,
  PLAN_CHECKOUT_RETURN_SURFACES,
  startPlanCheckout,
} from '@/lib/business-os/billing/planCheckout';
import { isPlanCheckoutEnabled } from '@/lib/business-os/billing/planCheckoutFlag';
import { createLogger } from '@/lib/logger';
import { businessOsAccountLineageRepository } from '@/lib/repositories/BusinessOsAccountLineageRepository';
import { businessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'BosPlanCheckoutAPI' });

const CheckoutBodySchema = z
  .object({
    tier: z.enum(TIER_ORDER),
    returnTo: z.enum(PLAN_CHECKOUT_RETURN_SURFACES),
  })
  .strict();

export async function POST(request: NextRequest) {
  // Off: the route looks absent, and nothing is read (SA Q-6).
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
    const parsed = CheckoutBodySchema.safeParse(body);
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
    const { tier, returnTo } = parsed.data;

    // The session's account, through the seam. Never a request value.
    const accountId = resolveAccountId(user.id);
    requestLogger.info({ userId: user.id, tier, returnTo }, 'Plan checkout requested');

    const result = await startPlanCheckout(
      { userId: user.id, accountId, email: user.email ?? null, tier, returnTo },
      {
        holdReaders: { lineage: businessOsAccountLineageRepository, invites: businessOsInviteRepository },
        readPlanSnapshot: (sessionAccountId) => getEntitlementService().getSnapshot(sessionAccountId),
        logger: requestLogger,
      }
    );

    if (!result.ok) {
      const refusal = PLAN_CHECKOUT_REFUSALS[result.code];
      return NextResponse.json(
        {
          success: false,
          error: refusal.message,
          code: result.code,
          ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
        },
        { status: refusal.status }
      );
    }

    // WC-7: written before responding, bounded, never throws.
    await logAndFlush(
      {
        action: AUDIT_EVENTS.BOS_BILLING_CHECKOUT_STARTED,
        entityType: 'business_os_billing_account',
        entityId: accountId,
        userId: user.id,
        details: {
          tier: result.tier,
          lookupKey: result.lookupKey,
          sessionId: result.sessionId,
          livemode: result.livemode,
          held: result.held,
          expiresAt: result.expiresAt,
          actor: 'owner',
          correlationId,
        },
        request,
      },
      requestLogger,
      { reason: 'plan checkout started', continues: 'the checkout is returned regardless' }
    );

    return NextResponse.json({
      success: true,
      data: {
        clientSecret: result.clientSecret,
        sessionId: result.sessionId,
        expiresAt: result.expiresAt,
        tier: result.tier,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Plan checkout failed');
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
