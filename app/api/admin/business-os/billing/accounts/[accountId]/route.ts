/**
 * GET /api/admin/business-os/billing/accounts/[accountId] — one account's
 * billing panel in the Businesses drawer (plan payments P-8a.2, AM-1, AC-AM.1,
 * AC-F4.1; workplan docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8A_WORKPLAN.md
 * §5.3, SA-WP-P8a).
 *
 * Order (the summary route's `tenant-isolation-guard` order):
 *   1. requireAdmin (401/403);
 *   2. the id is a UUID (400 `invalid_account_id`);
 *   3. not the platform account (409 `platform_account`), a pure check;
 *   4. a Business OS tenant (404 `not_a_business_os_account`, 500
 *      `tenant_check_failed`), by the same `isBusinessOsTenant`;
 *   5. the current Stripe mode (409 `stripe_mode_unknown`: never a guessed mode);
 *   6. two reads, each scoped to that one id: the billing row of this mode (R-p′)
 *      and the plan row. Either failing is a 500;
 *   7. the pure builder, then 200.
 * The caller-supplied id is trusted only after steps 2 to 4.
 *
 * Service role underneath (the repositories document it): an admin read of
 * another account, reached only after `requireAdmin`. No Stripe call (§7
 * "Data source", SR-11), no write, no audit (a read, SA Q-6). Every response is
 * `no-store`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { isPlatformAccount } from '@/lib/business-os/llm/callCatalog';
import { isBusinessOsTenant } from '@/lib/business-os/entitlements/adminOps';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { currentStripeMode, type StripeMode } from '@/lib/business-os/billing/stripeMode';
import { buildBillingPanel } from '@/lib/admin/billing/billingPanelView';
import { STRIPE_MODE_UNKNOWN } from '@/lib/admin/billing/subscriptionsTypes';
import { businessOsAccountPlanRepository } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { businessOsBillingAdminReadRepository } from '@/lib/repositories/BusinessOsBillingAdminReadRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { onboardingConversationRepository } from '@/lib/repositories/OnboardingConversationRepository';

const logger = createLogger({ module: 'AdminBosBillingPanelAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const accountIdSchema = z.string().uuid();

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

function serverMode(): StripeMode | null {
  try {
    return currentStripeMode();
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, context: { params: { accountId: string } }) {
  const gate = await requireAdmin(logger.child({ route: 'bos-billing-panel', method: 'GET' }));
  if (gate instanceof NextResponse) return noStore(gate);

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, adminId: gate.user.id });

  try {
    const parsedId = accountIdSchema.safeParse(context.params.accountId);
    if (!parsedId.success) return errorResponse(400, 'invalid_account_id');
    const accountId = parsedId.data.toLowerCase();

    if (isPlatformAccount(accountId)) return errorResponse(409, 'platform_account');

    const isTenant = await isBusinessOsTenant({
      accountId,
      profileRepository: businessProfileRepository,
      onboardingRepository: onboardingConversationRepository,
      planRepository: businessOsAccountPlanRepository,
    });
    if (isTenant === null) return errorResponse(500, 'tenant_check_failed');
    if (!isTenant) return errorResponse(404, 'not_a_business_os_account');

    const mode = serverMode();
    if (mode === null) {
      requestLogger.warn({ accountId, reason: 'stripe_mode_unknown' }, 'Billing panel refused: Stripe key mode unknown');
      return errorResponse(409, STRIPE_MODE_UNKNOWN, { code: 'stripe_mode_unknown' });
    }

    const [billing, planInputs] = await Promise.all([
      businessOsBillingAdminReadRepository.findBillingRowForAccount(accountId, mode === 'live'),
      businessOsAccountPlanRepository.findEntitlementInputs(accountId),
    ]);
    if (billing.error) {
      requestLogger.error({ err: billing.error, accountId, read: 'billing' }, 'Billing panel read failed');
      return errorResponse(500, 'Could not read this account’s billing record. Try again.');
    }
    if (planInputs.error || !planInputs.data) {
      requestLogger.error({ err: planInputs.error, accountId, read: 'plan' }, 'Billing panel read failed');
      return errorResponse(500, 'Could not read this account’s plan. Try again.');
    }

    // Only the plan row crosses: the override rows (admin-written reasons) are never read here.
    const payload = buildBillingPanel({
      billing: billing.data,
      plan: planInputs.data.plan,
      config: getEntitlementConfig(),
      now: new Date(),
      mode,
    });

    // Ids, the mode and states only: never a Stripe id or a business name.
    requestLogger.info(
      {
        accountId,
        mode,
        subscribed: payload.stripe !== null,
        status: payload.stripe?.status ?? null,
        disagreements: payload.disagreements,
      },
      'Billing panel read'
    );

    return NextResponse.json({ success: true, data: payload }, { headers: NO_STORE });
  } catch (error) {
    requestLogger.error({ err: error }, 'Billing panel route failed');
    return errorResponse(500, 'Internal server error', error instanceof Error ? error.message : String(error));
  }
}
