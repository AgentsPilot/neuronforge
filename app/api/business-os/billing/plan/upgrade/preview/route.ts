/**
 * POST /api/business-os/billing/plan/upgrade/preview
 *
 * What upgrading the SIGNED-IN owner's paid plan would cost now (plan
 * payments P-7b.1a; workplan docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P7B1_WORKPLAN.md
 * §3.4; SA U-1, U-2, V-9, V-11, V-12, Q-2).
 *
 * Body (strict; any other key is refused with 400, so an injected `userId`,
 * `subscriptionId`, `priceId` or amount never reaches the service):
 *   { tier: <a tier from TIER_ORDER> }
 *
 * 200 → { success: true, data: { fromTier, tier, amountDueMinor, taxMinor,
 *          currency: 'usd', prorationDate, renewsOn, monthlyPriceMinor } }.
 * The confirm sends `prorationDate` back unchanged. Read-only at Stripe
 * (`invoices.createPreview`).
 *
 * Refusals answer { success: false, error, code } from PLAN_UPGRADE_REFUSALS;
 * `upgrade_pending` adds `retryAfter`, and `upgrade_awaiting_confirmation`
 * (Q-2: our own upgrade waits for 3-D Secure) adds `amountDueMinor` and a
 * fresh `prorationDate`, never a confirmation secret.
 *
 * Behind `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` (off by default): while off, the
 * route answers 404 before reading the session, the body, the database or
 * Stripe. Who the account is comes from the session only (`getUser()`, then
 * the account seam `resolveAccountId`). `TIER_ORDER` builds the body schema.
 * It refuses a SALE, never a capability (a recorded non-gate, SR-17).
 *
 * A preview is a read: logged, never audited (SA Q-9 of P-3a).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { PLAN_UPGRADE_REFUSALS, previewPlanUpgrade } from '@/lib/business-os/billing/planUpgrade';
import { isPlanCheckoutEnabled } from '@/lib/business-os/billing/planCheckoutFlag';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'BosPlanUpgradePreviewAPI' });

const PreviewBodySchema = z.object({ tier: z.enum(TIER_ORDER) }).strict();

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
    const parsed = PreviewBodySchema.safeParse(body);
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
    const { tier } = parsed.data;

    // The session's account, through the seam. Never a request value.
    const accountId = resolveAccountId(user.id);
    requestLogger.info({ userId: user.id, accountId, tier }, 'Plan upgrade preview requested');

    const result = await previewPlanUpgrade({ userId: user.id, tier }, { logger: requestLogger });

    if (!result.ok) {
      const refusal = PLAN_UPGRADE_REFUSALS[result.code];
      return NextResponse.json(
        {
          success: false,
          error: refusal.message,
          code: result.code,
          ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}),
          ...(result.amountDueMinor !== undefined ? { amountDueMinor: result.amountDueMinor } : {}),
          ...(result.prorationDate !== undefined ? { prorationDate: result.prorationDate } : {}),
        },
        { status: refusal.status }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        fromTier: result.fromTier,
        tier: result.tier,
        amountDueMinor: result.amountDueMinor,
        taxMinor: result.taxMinor,
        currency: result.currency,
        prorationDate: result.prorationDate,
        renewsOn: result.renewsOn,
        monthlyPriceMinor: result.monthlyPriceMinor,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Plan upgrade preview failed');
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
