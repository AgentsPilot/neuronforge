/**
 * POST /api/business-os/billing/plan/reactivate
 *
 * Remove the SIGNED-IN owner's pending cancellation before the period end, so
 * the plan renews as before (plan payments P-7a.1; workplan
 * docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P7A_WORKPLAN.md §4.2; SA C-1 to C-5,
 * TQ-1 to TQ-5). Nothing is charged now. After the end date the owner buys
 * again instead (F8 row 4).
 *
 * Body: `{}` (strict). Any key is a 400 (SA C-5); unparsable JSON is a 400.
 *
 * 200 → { success: true, data: { outcome: 'reactivated', renewsOn } }
 *     | { success: true, data: { outcome: 'unchanged', state, date } }
 *       (not set to end; nothing written, nothing audited).
 * Refusals answer { success: false, error, code } from PLAN_MANAGE_REFUSALS,
 * with `outcomeUnknown: true` when the write's answer was lost.
 *
 * Same switch, session-only account, non-gate status and audit rules as the
 * cancel route (`../cancel/route.ts`): BOS_BILLING_SUBSCRIPTION_REACTIVATED
 * once per request that reached the Stripe write, flushed before the response.
 *
 * Email (account deletion lifecycle D4a / SX-3; SA S-6, S-11): on
 * `reactivated` only, after the audit flush, the owner gets "Your plan
 * continues", under the same switch, deadline and audit pair as the cancel
 * route's email. `unchanged`, refusals and a lost answer send nothing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { PLAN_MANAGE_REFUSALS, managePlanSubscription, type PlanManageAuditFacts } from '@/lib/business-os/billing/planSubscriptionManage';
import { isPlanPriceRecognitionEnabled } from '@/lib/business-os/billing/planPricesFlag';
import { notifyPlanCancelEmail } from '@/lib/business-os/billing/planCancelEmailDeps';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'BosPlanReactivateAPI' });

/** SA C-5: the client always sends `{}`; nothing else is accepted. */
const ReactivateBodySchema = z.object({}).strict();

export async function POST(request: NextRequest) {
  // Off: the route looks absent, and nothing is read.
  if (!isPlanPriceRecognitionEnabled()) {
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
    const parsed = ReactivateBodySchema.safeParse(body);
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

    // The session's account, through the seam. Never a request value.
    const accountId = resolveAccountId(user.id);
    requestLogger.info({ userId: user.id, accountId }, 'Plan reactivate requested');

    const result = await managePlanSubscription({ action: 'reactivate', userId: user.id, accountId }, { logger: requestLogger });

    const audit = (facts: PlanManageAuditFacts) =>
      logAndFlush(
        {
          action: AUDIT_EVENTS.BOS_BILLING_SUBSCRIPTION_REACTIVATED,
          entityType: 'business_os_billing_account',
          entityId: accountId,
          userId: user.id,
          details: {
            subscriptionId: facts.subscriptionId,
            outcome: facts.outcome,
            renewsOn: facts.renewsOn,
            livemode: facts.livemode,
            actor: 'owner',
            correlationId,
          },
          request,
        },
        requestLogger,
        { reason: 'plan reactivate requested', continues: 'the outcome is returned regardless' }
      );

    if (!result.ok) {
      if (result.audit) await audit(result.audit);
      const refusal = PLAN_MANAGE_REFUSALS[result.code];
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

    if (result.outcome === 'unchanged') {
      return NextResponse.json({ success: true, data: { outcome: 'unchanged', state: result.state, date: result.date } });
    }
    if (result.outcome !== 'reactivated') {
      // The orchestration answers the action it was asked for; anything else is a fault.
      throw new Error('unexpected_manage_outcome');
    }
    await audit(result.audit);
    // D4a / SX-3 (S-6, S-11): only on a real change, after the action's audit.
    // Never throws; the answer below does not depend on it.
    await notifyPlanCancelEmail(
      {
        event: 'kept',
        userId: user.id,
        date: result.renewsOn,
        subscriptionId: result.audit.subscriptionId,
        livemode: result.audit.livemode,
        correlationId,
      },
      { accountId, userId: user.id, request, logger: requestLogger }
    );
    return NextResponse.json({ success: true, data: { outcome: 'reactivated', renewsOn: result.renewsOn } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Plan reactivate failed');
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
