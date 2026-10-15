/**
 * TEST MODE ONLY — POST /api/admin/business-os/test/plan-test-clock
 *
 * Plan payments P-6a.1 (workplan BUSINESS_OS_PLAN_PAYMENTS_P6A_WORKPLAN.md
 * §5.8; SA C-5, C-6, C-7). Lets an admin put a Business OS account's
 * test-mode billing record on a Stripe test clock from `/test-business-os`, so
 * the renewal, failed-payment, grace and AC-F6.5 demo can move Stripe's time.
 *
 * Actions (one strict body each):
 *   { action: 'attach',  accountId }       a fresh clock + customer (C-6)
 *   { action: 'advance', accountId, to }   move the clock forward (≤ 60 days)
 *   { action: 'status',  accountId }       read-only: clock, billing failure
 *                                          fields, lifecycle at the clock's time (C-7)
 *
 * ── Order, and nothing before it (SA C-5) ───────────────────────────────────
 *   requireAdmin (401 / 403) → either payment switch off: 404 `not_enabled`
 *   (the route looks absent) → Zod `.strict()` (400) → the account seam →
 *   tenant (500 / 404 `not_a_tenant`) → server key mode test, else 409
 *   `live_mode_refused` → the action's own refusals (409, coded) → Stripe →
 *   audit for `attach` only (logAndFlush, WC-7) → 200.
 *
 * The account comes from the validated body and is tenant-checked above
 * (tenant-isolation-guard). Unlike the take-credits route, the admin MAY target
 * their own account (test mode only): the harness is open to every signed-in
 * account and the demo owners are not admins, so the panel pre-fills the
 * session's account id.
 *
 * Logs carry ids only; the response never carries the hosted invoice URL.
 *
 * @module app/api/admin/business-os/test/plan-test-clock
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { isPlanCheckoutEnabled } from '@/lib/business-os/billing/planCheckoutFlag';
import { isPlanPriceRecognitionEnabled } from '@/lib/business-os/billing/planPricesFlag';
import { currentStripeMode } from '@/lib/business-os/billing/stripeMode';
import {
  advancePlanTestClock,
  attachPlanTestClock,
  planTestClockStatus,
  type PlanTestClockResult,
} from '@/lib/business-os/billing/planTestClock';
import { isBusinessOsTenant } from '@/lib/business-os/entitlements/adminOps';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { businessOsAccountPlanRepository } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { onboardingConversationRepository } from '@/lib/repositories/OnboardingConversationRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'AdminBosPlanTestClockAPI' });
const ROUTE = '/api/admin/business-os/test/plan-test-clock';

const accountId = z.string().uuid();

const PlanTestClockSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('attach'), accountId }).strict(),
  z
    .object({
      action: z.literal('advance'),
      accountId,
      // An ISO instant with an explicit offset; the 60-day bound is checked against the clock.
      to: z.string().datetime({ offset: true }),
    })
    .strict(),
  z.object({ action: z.literal('status'), accountId }).strict(),
]);

function refused(result: Extract<PlanTestClockResult<unknown>, { ok: false }>) {
  return NextResponse.json({ success: false, error: result.code }, { status: 409 });
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement. Nothing above it reads the body or touches a table.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  const adminId = gate.user.id;

  try {
    // Both payment switches are off on every deployed environment, so the
    // route looks absent there (SA C-5: 404, not 409).
    if (!isPlanCheckoutEnabled() || !isPlanPriceRecognitionEnabled()) {
      return NextResponse.json({ success: false, error: 'not_enabled' }, { status: 404 });
    }

    const body: unknown = await request.json().catch(() => undefined);
    const parsed = PlanTestClockSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'invalid_input',
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400 }
      );
    }
    const input = parsed.data;
    // Canonical form: Postgres matches uuids case-insensitively, JS does not.
    const target = resolveAccountId(input.accountId.toLowerCase());

    const isTenant = await isBusinessOsTenant({
      accountId: target,
      profileRepository: businessProfileRepository,
      onboardingRepository: onboardingConversationRepository,
      planRepository: businessOsAccountPlanRepository,
    });
    if (isTenant === null) {
      return NextResponse.json({ success: false, error: 'tenant_check_failed' }, { status: 500 });
    }
    if (!isTenant) {
      return NextResponse.json({ success: false, error: 'not_a_tenant' }, { status: 404 });
    }

    // A missing or unrecognised key throws here: a 500, never a guessed mode.
    if (currentStripeMode() !== 'test') {
      requestLogger.warn({ adminId, accountId: target, action: input.action }, 'Plan test clock refused: live-mode key');
      return NextResponse.json({ success: false, error: 'live_mode_refused' }, { status: 409 });
    }

    if (input.action === 'status') {
      const result = await planTestClockStatus(target);
      if (!result.ok) return refused(result);
      return NextResponse.json({ success: true, data: result.data });
    }

    if (input.action === 'advance') {
      const result = await advancePlanTestClock(target, input.to);
      if (!result.ok) return refused(result);
      requestLogger.info({ adminId, accountId: target, testClockId: result.data.testClockId }, 'Plan test clock advanced');
      return NextResponse.json({ success: true, data: result.data });
    }

    const result = await attachPlanTestClock(target);
    if (!result.ok) return refused(result);
    const attached = result.data;

    await logAndFlush(
      {
        action: AUDIT_EVENTS.BOS_BILLING_TEST_CLOCK_ATTACHED,
        entityType: 'business_os_account_plan',
        entityId: target,
        userId: target,
        actorId: adminId,
        details: {
          testClockId: attached.testClockId,
          customerId: attached.customerId,
          previousCustomerId: attached.previousCustomerId,
          recordPath: attached.recordPath,
          livemode: false,
          testOnly: true,
          correlationId,
        },
        request,
      },
      requestLogger,
      { reason: 'plan test clock attach', continues: 'the attach stands' }
    );

    requestLogger.info(
      { adminId, accountId: target, testClockId: attached.testClockId, recordPath: attached.recordPath },
      'Plan test clock attached'
    );
    return NextResponse.json({ success: true, data: attached });
  } catch (error) {
    requestLogger.error({ err: error, adminId }, 'Plan test clock request failed');
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
