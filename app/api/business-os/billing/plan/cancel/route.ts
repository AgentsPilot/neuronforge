/**
 * POST /api/business-os/billing/plan/cancel
 *
 * Set the SIGNED-IN owner's plan subscription to cancel at the period end
 * (plan payments P-7a.1; workplan
 * docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P7A_WORKPLAN.md §4.2; SA C-1 to C-5,
 * TQ-1 to TQ-5). Nothing is refunded (Q-B7); the plan keeps working to the
 * paid-through date, then does not renew.
 *
 * Body: `{}` or `{ reasonCode }` (strict). `reasonCode` is one of
 * `PLAN_LEAVE_REASON_CODES` (D2 / SX-1, SX C-10, SA-4; SA Q-5: optional until
 * D3's drawer makes it required); there is no free-text field. Any other key,
 * such as an injected `userId` or `subscriptionId`, is a 400 (P-7a C-5);
 * unparsable JSON is a 400 too.
 *
 * 200 → { success: true, data: { outcome: 'cancelled', endsOn } }
 *     | { success: true, data: { outcome: 'cancelled', endsOn, mode: 'immediate' } }
 *       (P-7a.4: a failed renewal at Stripe; the plan ended NOW, `endsOn` = when)
 *     | { success: true, data: { outcome: 'unchanged', state, date } }
 *       (already set to end, or P-7a.4 `state: 'ended'`; nothing written, nothing audited).
 *
 * P-7a.4 (workplan §4.3; BQ-3 = A; SA C-11, TQ-12): while a renewal payment is
 * failing AT STRIPE (fresh `past_due` / `unpaid`, never our row's count), the
 * cancel ends the subscription now and voids its open invoice(s), so the old
 * hosted "Pay now" link cannot put the tier back. Same audit key, with
 * `details.mode = 'immediate'` and the void counts.
 * Refusals answer { success: false, error, code } from PLAN_MANAGE_REFUSALS.
 * A `stripe_error` with `outcomeUnknown: true` means the write was attempted
 * and its answer was lost: the screen re-reads, never "nothing changed".
 *
 * Behind `BUSINESS_OS_PLAN_PRICES_ENABLED` (SA C-1, TQ-1; BQ-1: the price
 * recognition switch, NOT the checkout switch, so pausing sales never stops a
 * payer from leaving): while off the route answers 404 before reading the
 * session, the body, the database or Stripe. The account is the session's
 * (`getUser()`, then the account seam `resolveAccountId`), never a request
 * value. It refuses a billing action, never a capability (a recorded non-gate,
 * SR-17), and writes no plan.
 *
 * Audit (AM-7, WC-7): BOS_BILLING_SUBSCRIPTION_CANCELLED once per request
 * that reached the Stripe write (outcome `cancelled` or `unknown`), flushed
 * before the response; `details.reasonCode` is the code or null (D2, SA Q-4).
 * Refusals and `unchanged` are logged, never audited. Two
 * tabs pressing at the same instant can both reach the write and write two
 * entries (SA note); the write itself is idempotent.
 *
 * Email (account deletion lifecycle D4a / SX-3; SA S-6, S-11; user U-2): on
 * `cancelled` only, after the audit flush, the owner gets "Plan cancelled", or
 * "Your plan has ended" for the P-7a.4 immediate end. Behind
 * `BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED` (off by default). Awaited under its
 * own 4 s deadline, audited as BOS_PLAN_CANCEL_EMAIL_SENT / _NOT_SENT, and it
 * never changes the response. Refusals, `unchanged` and a lost answer send
 * nothing. Sent from here, never from the engine, which D6 also calls.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { PLAN_MANAGE_REFUSALS, managePlanSubscription, type PlanManageAuditFacts } from '@/lib/business-os/billing/planSubscriptionManage';
import { isPlanPriceRecognitionEnabled } from '@/lib/business-os/billing/planPricesFlag';
import { PLAN_LEAVE_REASON_CODES } from '@/lib/business-os/billing/planLeaveReasons';
import { notifyPlanCancelEmail } from '@/lib/business-os/billing/planCancelEmailDeps';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'BosPlanCancelAPI' });

/** P-7a C-5 + D2 (SA Q-5): `{}` or a reason code from the list; nothing else is accepted. */
const CancelBodySchema = z.object({ reasonCode: z.enum(PLAN_LEAVE_REASON_CODES).optional() }).strict();

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
    const parsed = CancelBodySchema.safeParse(body);
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
    requestLogger.info({ userId: user.id, accountId }, 'Plan cancel requested');

    const result = await managePlanSubscription(
      { action: 'cancel', userId: user.id, accountId, reasonCode: parsed.data.reasonCode ?? null },
      { logger: requestLogger }
    );

    const audit = (facts: PlanManageAuditFacts) =>
      logAndFlush(
        {
          action: AUDIT_EVENTS.BOS_BILLING_SUBSCRIPTION_CANCELLED,
          entityType: 'business_os_billing_account',
          entityId: accountId,
          userId: user.id,
          details: {
            subscriptionId: facts.subscriptionId,
            outcome: facts.outcome,
            endsOn: facts.endsOn,
            mode: facts.mode,
            // P-7a.4 (C-11): present on the immediate end only.
            ...(facts.invoicesVoided !== undefined ? { invoicesVoided: facts.invoicesVoided } : {}),
            ...(facts.invoicesLeftOpen !== undefined ? { invoicesLeftOpen: facts.invoicesLeftOpen } : {}),
            livemode: facts.livemode,
            reasonCode: facts.reasonCode,
            actor: 'owner',
            correlationId,
          },
          request,
        },
        requestLogger,
        { reason: 'plan cancel requested', continues: 'the outcome is returned regardless' }
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
    if (result.outcome !== 'cancelled') {
      // The orchestration answers the action it was asked for; anything else is a fault.
      throw new Error('unexpected_manage_outcome');
    }
    await audit(result.audit);
    // D4a / SX-3 (S-6, S-11, U-2): only on a real change, after the action's
    // audit, awaited under its own 4 s deadline. Never throws; the answer below
    // does not depend on it. Off unless BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED.
    await notifyPlanCancelEmail(
      {
        event: result.mode === 'immediate' ? 'ended_now' : 'cancelled',
        userId: user.id,
        date: result.endsOn,
        invoicesLeftOpen: result.audit.invoicesLeftOpen,
        subscriptionId: result.audit.subscriptionId,
        livemode: result.audit.livemode,
        correlationId,
      },
      { accountId, userId: user.id, request, logger: requestLogger }
    );
    return NextResponse.json({
      success: true,
      data: { outcome: 'cancelled', endsOn: result.endsOn, ...(result.mode === 'immediate' ? { mode: 'immediate' } : {}) },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Plan cancel failed');
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
