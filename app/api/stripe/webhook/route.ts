// app/api/stripe/webhook/route.ts
// Stripe webhook handler - processes payment events and updates database

import { NextRequest, NextResponse } from 'next/server';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { activitySentence } from '@/lib/business-os/activityText';
import { createClient } from '@supabase/supabase-js';
import { getStripeService } from '@/lib/stripe/StripeService';
import { pilotCreditsToTokens } from '@/lib/utils/pricingConfig';
import { QuotaAllocationService } from '@/lib/services/QuotaAllocationService';
import { resolveAccountOwner } from '@/lib/payments/stripeAccountContext';
import { notifyOwnerOfDispute } from '@/lib/services/DisputeAlertService';
import { subscriptionIdFromInvoice, subscriptionMetadataFromInvoice } from '@/lib/payments/invoiceSubscription';
import { bindPlanSubscription } from '@/lib/payments/bindPlanSubscription';
import { vetLinkId } from '@/lib/payments/ownedLinkId';
import { fromMinorUnits } from '@/lib/payments/refundMath';
import { resolveInvoicePaymentIntent } from '@/lib/payments/invoicePaymentIntent';
import { syncBookingsForTransactions } from '@/lib/payments/syncBookingPaymentState';
import { resolveProcessorFee, feeColumns } from '@/lib/payments/processorFee';
import { phaseDurationFor, planPhases, planSchedule, type PlanFrequency } from '@/lib/payments/planSchedule';
import { paymentPlanSubscriptionRepository } from '@/lib/repositories/PaymentPlanSubscriptionRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { schedulingBookingRepository, schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { describeChargeAccount } from '@/lib/payments/stripeAccountContext';
import { createLogger, type Logger } from '@/lib/logger';
import {
  BusinessOsHandlerMissingError,
  denyLevel,
  dispatchBusinessOsEvent,
  type BusinessOsFlow,
} from '@/lib/business-os/billing/webhookDispatcher';
import { handleBoostWebhookEvent } from '@/lib/business-os/boost/boostWebhookDeps';
import Stripe from 'stripe';

// Disable body parsing for webhook signature verification
export const runtime = 'nodejs';

// Module logger. POST derives a per-request child carrying the correlation id
// and the Stripe event id, and passes it to every handler as `log`, so each
// line a delivery writes can be found from the event id alone.
const logger = createLogger({ module: 'stripe-webhook', route: '/api/stripe/webhook' });

// Create admin Supabase client (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Plan payments P-1 removed `handleInvoicePaid`, the agent-platform conversion
// of a platform `invoice.paid` into Pilot Credits. It took the account from
// `metadata.user_id` (the invoice's, its subscription's, or the customer's FIRST
// subscription's) and wrote that account's balance on the service role, so the
// first Business OS plan invoice would have been converted into credits for
// whichever user the metadata named (as-built G-6). Every platform `invoice.paid`
// now goes through the Business OS router in `POST`, which either hands it to a
// plan flow or denies it. Do not bring a metadata-keyed conversion back.

/**
 * Handle invoice.payment_failed event
 * - Increment retry count
 * - Check grace period
 * - Pause agents if grace period exceeded
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice, log: Logger) {
  log.info({ stripeInvoiceId: invoice.id }, 'Processing invoice.payment_failed');

  const userId = invoice.metadata?.user_id;

  if (!userId) {
    log.error({ stripeInvoiceId: invoice.id }, 'No user_id in invoice metadata');
    return;
  }

  // Get user subscription
  const { data: userSub } = await supabaseAdmin
    .from('user_subscriptions')
    .select('payment_retry_count, grace_period_days, current_period_end')
    .eq('user_id', userId)
    .single();

  const retryCount = (userSub?.payment_retry_count || 0) + 1;

  // Fetch grace period from system config if not set per-user
  let gracePeriodDays = userSub?.grace_period_days;

  if (!gracePeriodDays) {
    // Fetch default from system_settings_config
    const { data: configData } = await supabaseAdmin
      .from('system_settings_config')
      .select('value')
      .eq('key', 'payment_grace_period_days')
      .maybeSingle();

    gracePeriodDays = configData ? parseInt(configData.value as string) : 3;
  }

  // Calculate if grace period is exceeded
  const periodEnd = userSub?.current_period_end ? new Date(userSub.current_period_end) : new Date();
  const daysSincePeriodEnd = Math.floor((Date.now() - periodEnd.getTime()) / (1000 * 60 * 60 * 24));
  const shouldPauseAgents = daysSincePeriodEnd > gracePeriodDays;

  // Update user subscription
  await supabaseAdmin
    .from('user_subscriptions')
    .update({
      payment_retry_count: retryCount,
      last_payment_attempt: new Date().toISOString(),
      status: shouldPauseAgents ? 'past_due' : 'active',
      agents_paused: shouldPauseAgents
    })
    .eq('user_id', userId);

  // Log billing event
  await supabaseAdmin
    .from('billing_events')
    .insert({
      user_id: userId,
      event_type: 'renewal_failed',
      credits_delta: 0,
      description: `Payment failed (attempt ${retryCount}). ${shouldPauseAgents ? 'Agents paused due to grace period exceeded.' : `Grace period active (${gracePeriodDays} days).`}`,
      stripe_event_id: invoice.id,
      stripe_invoice_id: invoice.id,
      amount_cents: invoice.amount_due,
      currency: invoice.currency
    });

  // AUDIT TRAIL: Log payment failure
  try {
    const { auditLog } = await import('@/lib/services/AuditTrailService');

    await auditLog({
      action: 'PAYMENT_FAILED',
      entityType: 'subscription',
      entityId: String(subscriptionIdFromInvoice(invoice) || invoice.id),
      userId: userId,
      resourceName: `Subscription Payment Failure`,
      details: {
        stripe_invoice_id: invoice.id,
        amount_due_cents: invoice.amount_due,
        amount_due_usd: (invoice.amount_due / 100).toFixed(2),
        retry_count: retryCount,
        grace_period_days: gracePeriodDays,
        days_since_period_end: daysSincePeriodEnd,
        agents_paused: shouldPauseAgents,
        status: shouldPauseAgents ? 'past_due' : 'active'
      },
      severity: shouldPauseAgents ? 'critical' : 'warning',
      complianceFlags: ['SOC2']
    });

    log.info({ userId }, 'Audit trail logged for payment failure');
  } catch (auditError) {
    log.error({ err: auditError, userId }, 'Audit logging failed (non-critical)');
  }

  log.info({
    userId,
    retryCount,
    shouldPauseAgents,
    daysSincePeriodEnd,
    gracePeriodDays
  }, 'Payment failure processed');

  // TODO: Send email notification to user about payment failure
}

/**
 * Handle checkout.session.completed event
 * - For boost packs: apply credits immediately
 * - Subscriptions: no longer converted (plan payments P-1)
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session, log: Logger) {
  log.info({ sessionId: session.id }, 'Processing checkout.session.completed');

  const userId = session.metadata?.user_id;
  const purchaseType = session.metadata?.purchase_type;

  if (!userId) {
    log.error({ sessionId: session.id }, 'No user_id in session metadata');
    return;
  }

  if (session.mode === 'payment' && purchaseType === 'boost_pack') {
    // One-time boost pack purchase
    log.info({ sessionId: session.id, userId }, 'Processing boost pack purchase');
    // Keys only: session metadata is not logged as values.
    log.debug(
      { sessionId: session.id, metadataKeys: Object.keys(session.metadata ?? {}) },
      'Session metadata'
    );

    const pilotCredits = parseInt(session.metadata?.credits || '0');
    const boostPackId = session.metadata?.boost_pack_id;

    log.info({ pilotCredits, boostPackId }, 'Boost pack details');

    // Convert Pilot Credits to tokens for storage (fetched from database)
    const credits = await pilotCreditsToTokens(pilotCredits, supabaseAdmin);

    log.info({ pilotCredits, tokens: credits }, 'Converting Pilot Credits to tokens');

    // Get current balance
    const { data: userSub } = await supabaseAdmin
      .from('user_subscriptions')
      .select('balance, total_earned')
      .eq('user_id', userId)
      .single();

    const currentBalance = userSub?.balance || 0;
    const currentTotalEarned = userSub?.total_earned || 0;

    // BOOST PACKS ROLL OVER - accumulate on top of existing balance
    const newBalance = currentBalance + credits;
    const newTotalEarned = currentTotalEarned + credits;

    // Update balance
    await supabaseAdmin
      .from('user_subscriptions')
      .update({
        balance: newBalance,
        total_earned: newTotalEarned,
        // Clear free tier expiration on purchase (user is now a paying customer)
        free_tier_expires_at: null,
        account_frozen: false
      })
      .eq('user_id', userId);

    // Create credit transaction and capture the ID
    const { data: creditTransaction, error: creditTxError } = await supabaseAdmin
      .from('credit_transactions')
      .insert({
        user_id: userId,
        credits_delta: credits,
        balance_before: currentBalance,
        balance_after: newBalance,
        transaction_type: 'allocation',
        activity_type: 'boost_pack_purchase',
        description: `Boost pack purchase: ${credits.toLocaleString()} credits`,
        metadata: {
          stripe_session_id: session.id,
          stripe_payment_intent_id: session.payment_intent,
          boost_pack_id: boostPackId,
          amount_paid_cents: session.amount_total
        }
      })
      .select('id')
      .single();

    if (creditTxError) {
      log.error({ err: creditTxError, userId }, 'Failed to create credit transaction for boost pack');
    } else {
      log.info({ creditTransactionId: creditTransaction?.id }, 'Credit transaction created');
    }

    // Record boost pack purchase with proper schema
    if (boostPackId) {
      const { error: boostPackError } = await supabaseAdmin
        .from('boost_pack_purchases')
        .insert({
          user_id: userId,
          boost_pack_id: boostPackId,
          transaction_id: creditTransaction?.id || null,
          credits_purchased: credits,
          bonus_credits: 0, // Bonus already included in credits
          price_paid_usd: (session.amount_total || 0) / 100, // Numeric, not string
          stripe_payment_intent_id: session.payment_intent as string,
          payment_status: 'succeeded',
          metadata: {
            stripe_session_id: session.id,
            boost_pack_id: boostPackId,
            amount_total: session.amount_total
          }
        });

      if (boostPackError) {
        log.error({ err: boostPackError, userId, boostPackId }, 'Failed to insert into boost_pack_purchases');
      } else {
        log.info({ userId, boostPackId }, 'Boost pack purchase recorded in boost_pack_purchases table');
      }
    } else {
      log.warn({ sessionId: session.id }, 'No boostPackId in session metadata - skipping boost_pack_purchases insert');
    }

    log.info({
      userId,
      credits,
      newBalance
    }, 'Boost pack processed');

    // Allocate storage and execution quotas based on new balance
    try {
      const quotaService = new QuotaAllocationService(supabaseAdmin);
      const quotaResult = await quotaService.allocateQuotasForUser(userId);

      if (quotaResult.success) {
        log.info(
          { userId, storageQuotaMB: quotaResult.storageQuotaMB, executionQuota: quotaResult.executionQuota ?? 'unlimited' },
          'Quotas allocated'
        );
      } else {
        log.error({ err: quotaResult.error, userId }, 'Failed to allocate quotas');
      }
    } catch (quotaError: any) {
      log.error({ err: quotaError, userId }, 'Error allocating quotas (non-critical)');
    }

  } else if (session.mode === 'subscription') {
    // Plan payments P-1 (SA Q-2): the session-time Pilot-Credit conversion that
    // lived here is gone, with its welcome bonus. The Business OS router denies
    // every platform subscription-mode session before the switch, so reaching
    // this line means the router was bypassed. Nothing is written.
    log.error(
      { sessionId: session.id, alert: true },
      'Platform subscription checkout reached the legacy handler; not converted'
    );
  }
}

/**
 * Handle customer.subscription.updated event (agent platform, platform events only)
 *
 * Plan payments P-10: this is now a status mirror and nothing else. It used to
 * turn `metadata.credits` into `monthly_credits` / `monthly_amount_usd`, insert
 * a `billing_events` row and re-run `QuotaAllocationService`; credit
 * subscriptions are no longer sold, so those effects are gone (reuse plan §4.6
 * *Dies*, L-26). The mirror stays because the portal and cancel / reactivate
 * routes still serve the agent platform's remaining subscriptions: without it a
 * cancellation made in the Stripe portal would never reach `user_subscriptions`.
 *
 * Both early returns are kept on purpose (SA Q-9): the handler runs for exactly
 * the events it ran for before, and never for a Business OS plan subscription,
 * which carries no legacy `user_id` + `credits` metadata.
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription, log: Logger) {
  log.info({ subscriptionId: subscription.id }, 'Processing customer.subscription.updated');

  const userId = subscription.metadata?.user_id;

  if (!userId) {
    log.error({ subscriptionId: subscription.id }, 'No user_id in subscription metadata');
    return;
  }

  // Legacy credit subscriptions only (try both 'credits' and 'pilot_credits').
  // The value is no longer written anywhere; it only decides whether to mirror.
  const pilotCredits = parseInt(subscription.metadata?.credits || subscription.metadata?.pilot_credits || '0');

  if (!pilotCredits) {
    log.error({ subscriptionId: subscription.id, userId }, 'No credits in subscription metadata');
    return;
  }

  // Lifecycle mirror only: cancellation state and status.
  await supabaseAdmin
    .from('user_subscriptions')
    .update({
      cancel_at_period_end: subscription.cancel_at_period_end || false,
      canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
      status: subscription.status
    })
    .eq('user_id', userId);

  log.info({ userId, status: subscription.status }, 'Subscription status mirrored');
}

/**
 * Handle business invoice.paid event (from Connect accounts)
 * - Update payment_invoices status to 'paid'
 * - Create payment_transaction record
 */
/**
 * A refund that happened at Stripe rather than here.
 *
 * Someone refunding from the Stripe dashboard is a normal thing to do, and until
 * now it was invisible: the app's numbers kept reporting money it no longer had.
 * Worse, the next refund attempted in the app would compute what remains from a
 * stale total and could return more than the charge held.
 *
 * Every refund Stripe reports is written into the ledger, keyed on its own id.
 * The unique index on `processor_refund_id` is what makes this converge with the
 * app and the reconciler instead of counting the same refund three times — this
 * handler can run repeatedly and produce the same single row. The transaction
 * and invoice totals then follow by trigger.
 */
/**
 * A chargeback: the bank has taken the money back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONLY MONEY MOVEMENT THIS PLATFORM COULD NOT SEE.
 *
 * Nothing handled `charge.dispute.*`, so the funds left the connected account
 * while the invoice still read `paid`, the booking still read paid, and revenue
 * still counted it. Every screen agreed about money that was gone.
 *
 * WHY `status` AND NOT A NEW COLUMN. Every revenue read in this codebase filters
 * on an ALLOW-LIST — `in('status', ['succeeded','refunded'])` or
 * `eq('status','succeeded')` — so a status they do not name drops out of all of
 * them at once, with no read left to remember to update. The column has no CHECK
 * constraint, so this needs no migration.
 *
 * REVERSIBLE, because a dispute is. The previous status is kept in `metadata` so
 * winning the case restores exactly what was there rather than a guess.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function handleDispute(
  dispute: Stripe.Dispute,
  phase: 'opened' | 'closed' | 'reinstated',
  log: Logger
) {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  const paymentIntentId =
    typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;

  let query = supabaseAdmin
    .from('payment_transactions')
    .select('id, user_id, status, amount, currency, contact_id, metadata')
    .limit(1);

  query = paymentIntentId
    ? query.eq('stripe_payment_intent_id', paymentIntentId)
    : query.eq('stripe_charge_id', chargeId || '');

  const { data: matches } = await query;
  const transaction = matches?.[0];

  if (!transaction) {
    // Money disputed against a payment this app never recorded. Loud, not
    // dropped: it means the books are wrong in a way only Stripe can see.
    log.error({ disputeId: dispute.id, chargeId, paymentIntentId }, 'Dispute for an unknown payment');
    return;
  }

  const metadata = (transaction.metadata ?? {}) as Record<string, unknown>;
  const won = phase === 'reinstated' || (phase === 'closed' && dispute.status === 'won');

  /*
   * Won means the money came back, so the payment returns to what it was before
   * the dispute — read from metadata rather than assumed to be `succeeded`, in
   * case it had already been partly refunded.
   */
  const restored = (metadata.status_before_dispute as string) || 'succeeded';

  const nextStatus = won ? restored : 'disputed';

  const { error } = await supabaseAdmin
    .from('payment_transactions')
    .update({
      status: nextStatus,
      metadata: {
        ...metadata,
        // Written only when the dispute opens, so a second event cannot
        // overwrite the original with `disputed` and lose the way back.
        status_before_dispute:
          phase === 'opened' ? transaction.status : metadata.status_before_dispute,
        dispute: {
          id: dispute.id,
          phase,
          status: dispute.status,
          reason: dispute.reason,
          amount_minor: dispute.amount,
          evidence_due_by: dispute.evidence_details?.due_by ?? null,
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', transaction.id);

  if (error) {
    log.error({ err: error, disputeId: dispute.id, transactionId: transaction.id }, 'Failed to record dispute');
    return;
  }

  log.info(
    {
      disputeId: dispute.id,
      phase,
      transactionId: transaction.id,
      previousStatus: transaction.status,
      nextStatus,
    },
    'Dispute recorded'
  );

  /*
   * Tell the owner, now.
   *
   * Stripe's evidence window is measured in days and a dispute nobody sees is
   * lost by default, so this is the one webhook side effect worth an immediate
   * email. Non-blocking: the ledger is already correct, and a mail failure must
   * not make Stripe retry a write that has happened.
   */
  if (phase === 'opened') {
    notifyOwnerOfDispute({
      ownerId: transaction.user_id,
      contactId: transaction.contact_id,
      amount: Number(transaction.amount) || 0,
      currency: transaction.currency || '',
      reason: dispute.reason || '',
      evidenceDueBy: dispute.evidence_details?.due_by ?? null,
    }).catch(err => log.error({ err, disputeId: dispute.id }, 'Dispute alert failed (non-blocking)'));
  }
}

async function handleChargeRefunded(charge: Stripe.Charge, connectAccountId: string | null, log: Logger) {
  log.info({ chargeId: charge.id }, 'Processing charge.refunded');

  const paymentIntentId =
    typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;

  // Located by either reference, because which one was recorded depends on the
  // flow that created the payment.
  let query = supabaseAdmin
    .from('payment_transactions')
    .select('id, user_id, invoice_id, currency')
    .limit(1);

  query = paymentIntentId
    ? query.eq('stripe_payment_intent_id', paymentIntentId)
    : query.eq('stripe_charge_id', charge.id);

  const { data: matches } = await query;
  const transaction = matches?.[0];

  if (!transaction) {
    // Refunded money against a payment this app never recorded. Not droppable —
    // it means the books are wrong in a way only Stripe can see.
    log.error({
      chargeId: charge.id,
      paymentIntentId
    }, 'charge.refunded for an unknown payment');
    return;
  }

  for (const stripeRefund of charge.refunds?.data ?? []) {
    const refundCurrency = (stripeRefund.currency || transaction.currency).toUpperCase();

    /*
     * `/ 100` made the ledger disagree with itself.
     *
     * `amount_minor` was recorded correctly straight from Stripe, while `amount`
     * assumed two decimal places — and `amount` is the column the guard and the
     * recompute trigger read. For a ¥5,000 refund the ledger said 50.00, so the
     * transaction read ~1% refunded and the guard would have allowed the
     * "remaining" 99% to be refunded again.
     *
     * `fromMinorUnits` was already imported in this file and used correctly for
     * plan periods a few hundred lines below.
     */
    const amountMajor = fromMinorUnits(stripeRefund.amount, refundCurrency);

    const { error } = await supabaseAdmin.from('payment_refunds').upsert(
      {
        user_id: transaction.user_id,
        transaction_id: transaction.id,
        invoice_id: transaction.invoice_id,
        amount: amountMajor,
        amount_minor: stripeRefund.amount,
        currency: refundCurrency,
        // Stripe can report a refund as still pending for some payment methods;
        // only a succeeded one may count toward the refunded total.
        status: stripeRefund.status === 'succeeded' ? 'succeeded' : 'pending',
        processor_type: 'stripe',
        processor_refund_id: stripeRefund.id,
        stripe_connect_account_id: connectAccountId,
        // Deterministic, so a redelivery of this event cannot open a second row.
        idempotency_key: `stripe:${stripeRefund.id}`,
        source: 'webhook',
        succeeded_at:
          stripeRefund.status === 'succeeded'
            ? new Date(stripeRefund.created * 1000).toISOString()
            : null,
        metadata: { origin: 'charge.refunded', charge_id: charge.id }
      },
      { onConflict: 'processor_refund_id' }
    );

    if (error) {
      log.error({ err: error, refundId: stripeRefund.id, chargeId: charge.id }, 'Failed to record refund');
      throw new Error(`Failed to record refund ${stripeRefund.id}: ${error.message}`);
    }
  }

  /*
   * The booking behind the payment, so a refund taken in the Stripe dashboard
   * reaches it too.
   *
   * `propagate_refund_to_booking` does this by trigger and is the authority —
   * it is the only mechanism that can, since this path has no request behind
   * it. Called explicitly as well so the behaviour is right before that
   * migration is applied; it derives the same value from the same rows, so
   * afterwards it changes nothing.
   */
  await syncBookingsForTransactions([transaction.id], transaction.user_id);

  log.info({ refundCount: charge.refunds?.data?.length ?? 0, chargeId: charge.id }, 'Recorded refunds');
}

/**
 * A link id from metadata, kept only if `ownerId` owns the row it names.
 *
 * Absent → null, nothing read. Not UUID-shaped → null, nothing read, reason
 * `malformed`: it cannot name a row, and only its LENGTH is logged, because an
 * arbitrary metadata value is not one of our ids. Not owned, or not readable →
 * null and one error line saying which (`reason`), so a dropped link can be
 * found and, if it was a transient failure, repaired. A UUID-shaped id is
 * logged; it is ours, not personal data.
 */
async function ownedOrNull(
  rawId: string | undefined,
  ownerId: string,
  field: 'contact_id' | 'booking_id' | 'service_id',
  findOwnedId: (id: string, userId: string) => Promise<{ data: string | null; error: Error | null }>,
  context: { connectAccountId: string; paymentIntentId: string },
  log: Logger
): Promise<string | null> {
  const { id, reason } = await vetLinkId(rawId, ownerId, findOwnedId);
  if (!reason) return id;

  log.error(
    {
      ...context,
      field,
      ...(reason === 'malformed' ? { idLength: (rawId ?? '').length } : { id: rawId }),
      reason,
    },
    'payment_intent.succeeded link not proved to belong to the owner - dropping it'
  );
  return null;
}

/**
 * A standalone payment on a connected account.
 *
 * Upserted on `stripe_payment_intent_id`, which is UNIQUE, so this cannot
 * duplicate a row that `booking/finalize` or `checkout.session.completed`
 * already wrote — whichever arrives first wins and the other is a no-op.
 *
 * Invoice-backed payments are skipped: `invoice.paid` handles those, and it
 * knows which invoice to attach the payment to, which this does not.
 */
async function handleConnectPaymentIntentSucceeded(
  intent: Stripe.PaymentIntent,
  connectAccountId: string,
  log: Logger
) {
  /*
   * `intent.invoice` is GONE on this API version — Stripe removed the
   * PaymentIntent→Invoice back-reference in Basil, the same release that moved
   * `invoice.subscription` into `invoice.parent`. The cast that used to read it
   * silently returned undefined, so the guard it protected never fired.
   *
   * Nothing was double-recorded, because the owner check below catches the same
   * intents for a different reason: an invoice's PaymentIntent is created by
   * STRIPE at finalisation and carries no metadata of ours, so it has no
   * `owner_id` and is dropped there. That is the guard doing its job by
   * accident, which is worth saying out loud rather than relying on quietly.
   *
   * Payment-plan periods take exactly this path — every one of them — so the
   * "no owner_id" case is separated below from a genuinely untagged charge,
   * which is a real fault and still an error.
   */
  const ownerId = intent.metadata?.owner_id;
  if (!ownerId) {
    const looksStripeGenerated = Object.keys(intent.metadata || {}).length === 0;

    if (looksStripeGenerated) {
      // An invoice or subscription period. `invoice.paid` owns it.
      log.info({ paymentIntentId: intent.id }, 'Untagged payment_intent (invoice-backed); invoice.paid owns it');
    } else {
      // Tagged by one of our surfaces, but not with an owner — a charge path is
      // not identifying the business it belongs to, and the money cannot be
      // attributed. That is a fault.
      log.error({ paymentIntentId: intent.id }, 'payment_intent.succeeded with no owner_id in metadata');
    }
    return;
  }

  if (!(await accountOwns(connectAccountId, ownerId, log))) {
    // `owner_id` is metadata on the connected account's own object, so the
    // account writes it. Inserted unchecked it becomes a payment row under any
    // user_id the account chooses — money in the attacker's balance, revenue on
    // the victim's books.
    log.error(
      { connectAccountId, claimedOwnerId: ownerId, paymentIntentId: intent.id },
      'payment_intent.succeeded claims an owner that does not own this account - refusing'
    );
    return;
  }

  const { data: existing } = await supabaseAdmin
    .from('payment_transactions')
    .select('id')
    .eq('stripe_payment_intent_id', intent.id)
    .limit(1)
    .maybeSingle();

  if (existing) {
    log.info({ paymentIntentId: intent.id }, 'Payment already recorded');
    return;
  }

  /*
   * The links, vetted (F-4).
   *
   * `owner_id` is proved above, but the contact, booking and service ids beside
   * it are metadata the same connected account wrote, and they are not proved by
   * it. A foreign `booking_id` on this row is enough on its own: the
   * `propagate_refund_to_booking` trigger then marks THAT booking paid, by id,
   * across businesses. Each id is kept only if the owner owns it. A foreign one
   * is dropped, never refused: the money did arrive in this account and belongs
   * on its books. A failed read drops too (fail closed), with its own reason, so
   * a repair can tell it from an attack.
   */
  const linkContext = { connectAccountId, paymentIntentId: intent.id };
  const contactId = await ownedOrNull(
    intent.metadata?.contact_id, ownerId, 'contact_id',
    (id, userId) => crmContactRepository.findOwnedId(id, userId), linkContext, log
  );
  const bookingId = await ownedOrNull(
    intent.metadata?.booking_id, ownerId, 'booking_id',
    (id, userId) => schedulingBookingRepository.findOwnedId(id, userId), linkContext, log
  );
  const serviceId = await ownedOrNull(
    intent.metadata?.service_id, ownerId, 'service_id',
    (id, userId) => schedulingServiceRepository.findOwnedId(id, userId), linkContext, log
  );

  const currency = intent.currency.toUpperCase();

  /*
   * What Stripe kept.
   *
   * Recorded at collection time because it is cheapest to know then — the
   * charge is fresh and the account is already resolved. Null when the charge
   * has not settled yet, which is a real state: the reconciler comes back for
   * those rather than this guessing a rate.
   */
  const fee = await resolveProcessorFee({
    stripe: new Stripe(process.env.STRIPE_SECRET_KEY!),
    account: connectAccountId,
    paymentIntentId: intent.id,
  });

  const { error } = await supabaseAdmin.from('payment_transactions').insert({
    user_id: ownerId,
    contact_id: contactId,
    // `/ 100` assumed every currency has two decimal places. JPY has none, so a
    // ¥5,000 payment was recorded as 50 — under-reporting revenue a hundredfold
    // and leaving the refund guard comparing figures on two different scales.
    amount: fromMinorUnits(intent.amount_received, currency),
    currency,
    status: 'succeeded',
    processor_type: 'stripe',
    payment_method: 'card',
    stripe_payment_intent_id: intent.id,
    // THE COLUMNS, not metadata. Both readers — `findSettledForBooking` and
    // `resolveRefundTarget` — query the columns, so money written only into
    // metadata was money that could not be refunded or attributed to its work.
    booking_id: bookingId,
    service_id: serviceId,
    ...feeColumns(fee),
    paid_at: new Date(intent.created * 1000).toISOString(),
    description: intent.description || 'Website payment',
    refund_status: 'none',
    refunded_amount: 0,
    metadata: {
      // Kept as well, not instead: rows written before this carry it only here.
      // The vetted values: a reader falling back to this copy must not find
      // the id the columns refused.
      booking_id: bookingId,
      service_id: serviceId,
      source: 'payment_intent_webhook'
    },
    ...describeChargeAccount(connectAccountId)
  });

  if (error) {
    log.error({ err: error, paymentIntentId: intent.id }, 'Failed to record payment');
    throw new Error(`Failed to record payment ${intent.id}: ${error.message}`);
  }

  log.info({ paymentIntentId: intent.id, userId: ownerId }, 'Recorded standalone payment');
}

/**
 * One period of a payment plan was collected.
 *
 * Returns true when this invoice belonged to a plan, so the caller knows not to
 * treat it as an ordinary invoice. Dedupes on the Stripe invoice id, which the
 * unique index on `payment_plan_installments.stripe_invoice_id` also enforces —
 * a redelivered webhook must not mark a second period paid.
 */
async function recordPlanPeriodPaid(
  invoice: Stripe.Invoice,
  subscriptionId: string,
  connectAccountId: string,
  log: Logger
): Promise<boolean> {
  const plan = await paymentPlanSubscriptionRepository.findBySubscriptionId(subscriptionId);
  if (!plan.data) return false;

  // The plan is found by a globally unique Stripe id, so ownership still has to
  // be proved against the account the event came from.
  if (!(await accountOwns(connectAccountId, plan.data.user_id, log))) {
    log.error(
      { connectAccountId, subscriptionId },
      'Plan period from an account that does not own the plan - refusing'
    );
    return true;
  }

  /*
   * A period is paid when MONEY ARRIVED — not when Stripe says `paid`.
   *
   * Cancelling a plan mid-cycle makes Stripe issue a proration CREDIT: an
   * invoice with a negative total, `amount_paid: 0`, and status `paid`, because
   * there is nothing to collect. `invoice.paid` fires for it like any other.
   *
   * Taken at face value that credit was recorded as "Payment 2 of 3" — a
   * succeeded transaction of $0 — it marked the ₪333.33 second instalment PAID,
   * and it advanced `periods_paid` to 2. The books then claimed ₪666.66
   * collected from a client who had paid ₪333.33 once.
   *
   * Returning true, not false: this invoice DOES belong to a plan, so the
   * ordinary invoice path must not pick it up either. It is simply not a
   * payment.
   */
  const collected = invoice.amount_paid ?? 0;

  if (collected <= 0) {
    log.info(
      { stripeInvoiceId: invoice.id, total: String(invoice.total) },
      'Plan invoice collected nothing (credit or zero-value); not a period payment'
    );
    return true;
  }

  const { data: alreadyRecorded } = await supabaseAdmin
    .from('payment_plan_installments')
    .select('id')
    .eq('stripe_invoice_id', invoice.id)
    .maybeSingle();

  if (alreadyRecorded) {
    log.info({ stripeInvoiceId: invoice.id }, 'Plan period already recorded');
    return true;
  }

  const currency = (invoice.currency || plan.data.currency).toUpperCase();
  const amount = fromMinorUnits(collected, currency);
  const periodsPaid = plan.data.periods_paid + 1;

  /*
   * The payment intent, so this period can be refunded.
   *
   * Recorded without one, every plan installment was permanently unrefundable:
   * `RefundService` needs a payment intent or a charge to refund against, finds
   * neither, and throws `missing_reference` — AFTER writing a ledger row that
   * then has to be marked failed. The owner saw a 502 whose real reason is
   * hidden in production, on a button the UI went on offering.
   *
   * The `invoice.paid` path below has always resolved this; the plan path was
   * written without it. Same resolver, same warning when it comes back empty,
   * so both read the same way in the logs.
   */
  const planPaymentIntent = await resolveInvoicePaymentIntent(invoice, new Stripe(process.env.STRIPE_SECRET_KEY!), connectAccountId).catch(err => {
    log.warn({ err, stripeInvoiceId: invoice.id }, 'Could not resolve the payment intent for a plan period');
    return null;
  });

  if (!planPaymentIntent) {
    log.warn(
      { stripeInvoiceId: invoice.id },
      'Plan period recorded with no payment intent - this payment will not be refundable'
    );
  }

  // The money first, then the plan's own state — the same order settlement
  // follows everywhere else, so a failure leaves money recorded and a count
  // behind, never a count ahead of money that never arrived.
  // The fee on this period, from the same charge the payment intent points at.
  const planFee = await resolveProcessorFee({
    stripe: new Stripe(process.env.STRIPE_SECRET_KEY!),
    account: connectAccountId,
    paymentIntentId: planPaymentIntent,
  });

  const { data: periodTransaction, error: txError } = await supabaseAdmin.from('payment_transactions').insert({
    user_id: plan.data.user_id,
    contact_id: plan.data.contact_id,
    booking_id: plan.data.booking_id,
    service_id: plan.data.service_id,
    amount,
    currency,
    status: 'succeeded',
    processor_type: 'stripe',
    payment_method: 'card',
    stripe_payment_intent_id: planPaymentIntent,
    ...feeColumns(planFee),
    paid_at: new Date().toISOString(),
    description: `Payment ${periodsPaid} of ${plan.data.installment_count}`,
    refund_status: 'none',
    refunded_amount: 0,
    /*
     * The Stripe invoice id lives in metadata, NOT in a column.
     *
     * `payment_transactions` has no `stripe_invoice_id` — it has `invoice_id`,
     * a UUID pointing at `payment_invoices`. Writing the Stripe id to a column
     * that does not exist made PostgREST reject the whole insert ("Could not
     * find the 'stripe_invoice_id' column ... in the schema cache"), which threw
     * and failed the webhook, so no plan period was ever recorded.
     *
     * Dedupe does not depend on this: it is enforced by the unique index on
     * `payment_plan_installments.stripe_invoice_id`, which is a real column,
     * and checked above before anything is written.
     */
    /*
     * The numbers travel beside the description.
     *
     * `description` below is written in English, once, and read by every
     * locale — so the drawer showed a Hebrew reader "Payment 1 of 3". The UI
     * phrases it from these instead; the description stays as a stable
     * English record for support and export.
     */
    metadata: {
      source: 'payment_plan',
      subscription_id: subscriptionId,
      stripe_invoice_id: invoice.id,
      installment_number: periodsPaid,
      installment_count: plan.data.installment_count,
    },
    ...describeChargeAccount(connectAccountId),
  })
    .select('id')
    .single();

  if (txError) {
    log.error({ err: txError, stripeInvoiceId: invoice.id, subscriptionId }, 'Could not record a plan period');
    throw txError;
  }

  /*
   * Mark the projected instalment, so "2 of 3 paid" is answerable locally.
   *
   * The same six fields `PaymentPlanRepository.markInstallmentPaid` writes on
   * the owner-driven path. This wrote three, so a period collected by Stripe
   * had no `payment_method`, no `processor_type`, and — the one that matters —
   * no `transaction_id`: nothing tied the period to the money that settled it,
   * which is the link a refund has to follow to find its charge.
   *
   * `updated_at` is set explicitly. There is no trigger on this table, so the
   * row that was marked paid still claimed it had not been touched since it was
   * projected.
   */
  await supabaseAdmin
    .from('payment_plan_installments')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      stripe_invoice_id: invoice.id,
      payment_method: 'card',
      processor_type: 'stripe',
      transaction_id: periodTransaction?.id ?? null,
      next_retry_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('subscription_id', plan.data.id)
    .eq('installment_number', periodsPaid);

  /*
   * When the next period falls due.
   *
   * `recordPeriodPaid` has always taken this and no caller ever passed it, so
   * every payment wrote `next_charge_at` and `next_charge_amount` back to NULL
   * — the row could say "1 of 3 paid" but never when the next ₪333 was coming.
   * Read from the projection rather than asked of Stripe: the periods are
   * already local, and a webhook should not make a network call to answer a
   * question it can answer from its own tables.
   */
  const { data: nextPeriod } = await supabaseAdmin
    .from('payment_plan_installments')
    .select('due_date, amount')
    .eq('subscription_id', plan.data.id)
    .eq('status', 'pending')
    .order('installment_number')
    .limit(1)
    .maybeSingle();

  await paymentPlanSubscriptionRepository.recordPeriodPaid(plan.data.id, periodsPaid, {
    chargeAt: nextPeriod?.due_date ?? null,
    amount: nextPeriod ? Number(nextPeriod.amount) : null,
  });

  if (periodsPaid >= plan.data.installment_count) {
    await paymentPlanSubscriptionRepository.close(plan.data.id, 'completed');
  }

  /*
   * The booking becomes paid when money actually arrives.
   *
   * A plan whose first payment is DEFERRED is confirmed with
   * `payment_status: 'pending'`, because at that moment nothing has been
   * charged — the card is merely stored against a trialling subscription. This
   * is the only place that learns otherwise, so without it such a booking would
   * read `pending` for ever, through every period, on the orders page and in
   * the drawer alike.
   *
   * Idempotent and safe for the immediate path too, where `finalize` already
   * wrote `paid`: this writes the same value again.
   */
  if (plan.data.booking_id) {
    const { error: bookingError } = await supabaseAdmin
      .from('scheduling_bookings')
      .update({ payment_status: 'paid', updated_at: new Date().toISOString() })
      .eq('id', plan.data.booking_id)
      .eq('user_id', plan.data.user_id);

    if (bookingError) {
      // Not fatal: the money is recorded, which is the part that must not be
      // lost. A booking reading `pending` beside a recorded payment is visible
      // and repairable; failing the webhook here would risk the period instead.
      log.error(
        { err: bookingError, bookingId: plan.data.booking_id },
        'Plan period recorded but the booking still reads unpaid'
      );
    }
  }

  log.info(
    { subscriptionId, periodsPaid, installmentCount: plan.data.installment_count },
    'Plan period recorded'
  );
  return true;
}

/**
 * A client's plan subscription, bounded the moment it exists.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS SEPARATELY FROM `invoice.paid`.
 *
 * `bindPlanSubscription` was reachable from two events only — `invoice.paid`
 * and `checkout.session.completed` — and a plan whose FIRST PAYMENT IS DEFERRED
 * produces neither. Stripe raises no invoice during a trial, and the embedded
 * card form creates no Checkout Session. So such a subscription sat with no
 * schedule for the whole trial: unbounded, unmirrored, and invisible to the
 * owner. An unbounded subscription bills the client forever, which is the one
 * outcome `bindPlanSubscription` exists to prevent.
 *
 * It only bound at the trial's first charge — and that is the same
 * `invoice.paid` that failed in production on 2026-09-29. A failure there would
 * have left the plan billing indefinitely.
 *
 * ONLY `trialing`, deliberately. The comment inside `handleConnectInvoicePaid`
 * explains why the immediate path must still wait: a schedule cannot be created
 * from an `incomplete` subscription, and that is exactly the state an
 * unpaid-but-immediate plan is in at creation. A trialling subscription owes
 * nothing yet, so Stripe puts it straight into `trialing` and it can be bounded
 * now. Every other status is left for the existing path.
 *
 * Bound BEFORE the client has entered a card, which is safe in both directions:
 * the schedule caps the periods either way, and `trial_settings.end_behavior
 * .missing_payment_method: 'cancel'` (set when the subscription was created)
 * cancels it at the trial's end if no card ever arrives.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function handleConnectPlanSubscriptionCreated(
  subscription: Stripe.Subscription,
  connectAccountId: string,
  log: Logger
) {
  if (subscription.status !== 'trialing') return;

  const planMeta = subscription.metadata ?? {};
  // Not a plan of ours: a connected account's own subscriptions are its
  // business, exactly as `customer.subscription.updated` already treats them.
  if (!planMeta.plan_count || !planMeta.owner_id) return;

  if (!(await accountOwns(connectAccountId, planMeta.owner_id, log))) {
    log.error(
      { connectAccountId, subscriptionId: subscription.id },
      'Trialling plan claims an owner this account does not own - refusing'
    );
    return;
  }

  log.info({ subscriptionId: subscription.id }, 'Bounding a trialling plan subscription before its first charge');

  try {
    await bindPlanSubscription({
      stripe: new Stripe(process.env.STRIPE_SECRET_KEY!),
      connectAccountId,
      subscriptionId: subscription.id,
      customerId:
        typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer?.id ?? null,
      ownerId: planMeta.owner_id,
      bookingId: planMeta.booking_id || null,
      serviceId: planMeta.service_id || null,
      planTotal: Number(planMeta.plan_total ?? 0),
      planCurrency: planMeta.plan_currency || 'USD',
      planCount: Number(planMeta.plan_count),
      planFrequency: (planMeta.plan_frequency || 'monthly') as PlanFrequency,
      paymentPlanId: planMeta.payment_plan_id || null,
    });
  } catch (bindError) {
    // Rethrown for the same reason as the invoice path: Stripe retries, and a
    // retry is what protects the client from an unbounded subscription.
    log.error(
      { err: bindError, subscriptionId: subscription.id },
      'Could not bound a trialling plan subscription'
    );
    throw bindError;
  }
}

/**
 * Does this connected account belong to the business that owns this record?
 *
 * The owner lookup is two queries and one request may ask more than once, so
 * found owners are cached. What the cache guarantees (FU-5):
 *
 * - A failed lookup is never stored. `resolveAccountOwner` throws on a read
 *   error; the throw reaches `POST`'s catch, which releases the claim and
 *   returns 500, so Stripe retries with a fresh lookup.
 * - "No business" (`null`) is never stored either, so an account whose row
 *   lands a moment later is found by the next event, not refused for the life
 *   of the instance.
 * - `POST` clears the map when a request starts. The map is module-level, so
 *   requests overlapping on one warm instance may share a positive owner that
 *   another of them found moments earlier; nothing older survives a new request.
 */
const accountOwnerCache = new Map<string, string>();

async function accountOwns(
  connectAccountId: string,
  ownerId: string | null | undefined,
  log: Logger
): Promise<boolean> {
  if (!ownerId) return false;

  return (await accountOwner(connectAccountId, log)) === ownerId;
}

/**
 * The business that owns this connected account, or null when it maps to none.
 *
 * Taken from the account the event came from (`event.account`, inside the
 * signed payload), never from metadata. Shares `accountOwns`' cache, so asking
 * both for the same mapped account costs one lookup. A lookup error throws
 * (see `accountOwnerCache`); it is never read as "maps to none".
 */
async function accountOwner(connectAccountId: string, log: Logger): Promise<string | null> {
  let owner = accountOwnerCache.get(connectAccountId) ?? null;

  if (!owner) {
    owner = await resolveAccountOwner(supabaseAdmin, connectAccountId);
    if (owner) accountOwnerCache.set(connectAccountId, owner);
  }

  // An account we cannot map to any business is not proof of ownership. It is
  // also not necessarily an attack — a newly connected account whose row has
  // not landed yet reads the same way — so it is logged rather than silent.
  if (!owner) {
    log.warn({ connectAccountId }, 'Connect account maps to no known business');
    return null;
  }

  return owner;
}

async function handleConnectInvoicePaid(invoice: Stripe.Invoice, connectAccountId: string, log: Logger) {
  log.info({ stripeInvoiceId: invoice.id, connectAccountId }, 'Processing Connect invoice.paid');
  // Keys only: Connect invoice metadata is written by the connected business
  // and may carry client details, so its values are never logged.
  log.debug(
    { stripeInvoiceId: invoice.id, metadataKeys: Object.keys(invoice.metadata || {}) },
    'Invoice metadata'
  );

  /**
   * A payment plan period.
   *
   * Stripe raises one invoice per period against the subscription, so this is
   * where a plan's money actually arrives — every period after the first, and
   * the first one too. Without this branch a plan charged correctly and the
   * platform recorded none of it: the money list would show "0 of 12 paid"
   * forever while the client's card was debited every month.
   */
  const subscriptionId = subscriptionIdFromInvoice(invoice);

  if (subscriptionId) {
    /*
     * The first period of a plan sold through the BOOKING MODAL.
     *
     * The hosted Checkout page bounds its plans at `checkout.session.completed`,
     * because a session exists to be told about. The embedded flow has no
     * session: `/api/website/payment-intent` creates the subscription directly
     * with `default_incomplete` and the client confirms it in the modal, so the
     * first time this platform hears that the plan is real is right here, when
     * its opening invoice is paid.
     *
     * Bounding it is what stops it billing forever — `end_behavior: 'cancel'`
     * after the agreed number of periods. It happens BEFORE the period is
     * recorded because `recordPlanPeriodPaid` looks the plan up by its local
     * mirror, and until this runs there is no mirror to find.
     *
     * A schedule cannot be created from an `incomplete` subscription, which is
     * why this waits for payment rather than running at creation time. The
     * window is one period wide — a month, typically — so a retried delivery
     * has room to succeed before anything could be charged twice.
     */
    const planMeta = subscriptionMetadataFromInvoice(invoice);

    if (planMeta.plan_count && planMeta.owner_id) {
      if (await accountOwns(connectAccountId, planMeta.owner_id, log)) {
        try {
          const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!);

          await bindPlanSubscription({
            stripe: stripeClient,
            connectAccountId,
            subscriptionId,
            customerId:
              typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null,
            ownerId: planMeta.owner_id,
            bookingId: planMeta.booking_id || null,
            serviceId: planMeta.service_id || null,
            planTotal: Number(planMeta.plan_total ?? 0),
            planCurrency: planMeta.plan_currency || invoice.currency?.toUpperCase() || 'USD',
            planCount: Number(planMeta.plan_count),
            planFrequency: (planMeta.plan_frequency || 'monthly') as PlanFrequency,
            paymentPlanId: planMeta.payment_plan_id || null,
          });
        } catch (bindError) {
          // Loud, and deliberately rethrown: an unbounded subscription charges a
          // client indefinitely. Failing the webhook makes Stripe retry, which
          // is the behaviour that protects the client.
          log.error({ err: bindError, subscriptionId }, 'Could not bound a plan subscription');
          throw bindError;
        }
      } else {
        log.error(
          { connectAccountId, subscriptionId },
          'Plan metadata claims an owner this account does not own - refusing'
        );
      }
    }

    const handled = await recordPlanPeriodPaid(invoice, subscriptionId, connectAccountId, log);
    // A period belongs to its plan, not to a platform invoice. Returning here
    // stops the ordinary invoice path treating it as an unmatched Stripe
    // invoice and doing nothing with it twice.
    if (handled) return;
  }

  // Look up the platform invoice by Stripe invoice ID
  let platformInvoice: {
    id: string;
    user_id: string;
    contact_id: string;
    invoice_number: string;
    booking_id?: string | null;
    amount?: number;
  } | null = null;

  const { data: invoiceByStripeId, error: lookupError } = await supabaseAdmin
    .from('payment_invoices')
    .select('*')
    .eq('stripe_invoice_id', invoice.id)
    .single();

  if (invoiceByStripeId) {
    platformInvoice = invoiceByStripeId;
    log.info({ invoiceId: invoiceByStripeId.id }, 'Found platform invoice by stripe_invoice_id');
  } else {
    log.info({ stripeInvoiceId: invoice.id }, 'No platform invoice found by stripe_invoice_id, checking metadata');

    /*
     * Fallback: find our own invoice id in the Stripe invoice's metadata.
     *
     * Two writers, two key names, and this knew only one. The Checkout Session
     * path writes `invoice_id`; the booking and invoice system writes
     * `neuronforge_invoice_id` (BookingLifecycleService). So for every invoice
     * raised with a booking, this fallback looked up `undefined`, found
     * nothing, and the webhook gave up — which matters most in exactly the case
     * the fallback exists for: the `invoice.paid` event arriving before we have
     * stored `stripe_invoice_id` on our row.
     *
     * Both keys are read now, ours first.
     */
    const metadataInvoiceId =
      invoice.metadata?.neuronforge_invoice_id || invoice.metadata?.invoice_id;

    if (metadataInvoiceId) {
      log.info({ invoiceId: metadataInvoiceId }, 'Looking up platform invoice by metadata');
      const { data: invoiceByMetadata, error: metadataLookupError } = await supabaseAdmin
        .from('payment_invoices')
        .select('*')
        .eq('id', metadataInvoiceId)
        .single();

      if (invoiceByMetadata && !metadataLookupError) {
        platformInvoice = invoiceByMetadata;
        log.info({ invoiceId: invoiceByMetadata.id }, 'Found platform invoice by metadata invoice id');

        // Ownership FIRST, before anything is written. The UUID came from
        // metadata the connected account writes, and the write below plants
        // this account's Stripe invoice id on the row. Checked after the write,
        // a refusal left another business's invoice pointing at the attacker's
        // Stripe invoice, so its later finalized / payment_failed /
        // marked_uncollectible events found and rewrote the wrong row (F-1).
        if (!(await accountOwns(connectAccountId, invoiceByMetadata.user_id, log))) {
          log.error(
            { connectAccountId, invoiceId: invoiceByMetadata.id },
            'Connect invoice.paid names an invoice owned by a different business - refusing'
          );
          return;
        }

        // Update the invoice with stripe_invoice_id for future lookups
        await supabaseAdmin
          .from('payment_invoices')
          .update({
            stripe_invoice_id: invoice.id,
            updated_at: new Date().toISOString()
          })
          .eq('id', invoiceByMetadata.id);
        log.info({ invoiceId: invoiceByMetadata.id, stripeInvoiceId: invoice.id }, 'Updated invoice with stripe_invoice_id');
      }
    }
  }

  if (platformInvoice && !(await accountOwns(connectAccountId, platformInvoice.user_id, log))) {
    // The event came from one business's account, but names another business's
    // invoice. Both lookups above resolve by ID ALONE — a stripe_invoice_id or a
    // UUID in metadata — and metadata on a connected account is written by that
    // account. So without this check a business could create and pay an invoice
    // on its own account carrying a competitor's invoice UUID, and we would mark
    // the competitor's invoice paid and insert a payment row under their user_id
    // while the money sat in the attacker's balance.
    //
    // Refused rather than repaired: there is no benign reading of it.
    log.error(
      { connectAccountId, invoiceId: platformInvoice.id },
      'Connect invoice.paid names an invoice owned by a different business - refusing'
    );
    return;
  }

  if (!platformInvoice) {
    log.info({ stripeInvoiceId: invoice.id }, 'No platform invoice found for Stripe invoice');
    // This might be a Stripe invoice created directly in Stripe, not through our platform
    return;
  }

  log.info(
    { invoiceId: platformInvoice.id, invoiceNumber: platformInvoice.invoice_number },
    'Found platform invoice'
  );

  const paidAt = new Date().toISOString();

  // Already recorded? Stripe can deliver invoice.paid more than once, and a
  // failed attempt is now retried, so this handler has to be safe to run twice.
  // Without this guard a retry would add a second payment against one invoice
  // and double the recorded revenue.
  const { data: existingTx } = await supabaseAdmin
    .from('payment_transactions')
    .select('id')
    .eq('invoice_id', platformInvoice.id)
    .in('status', ['succeeded', 'refunded'])
    .limit(1)
    .maybeSingle();

  if (existingTx) {
    log.info(
      { invoiceId: platformInvoice.id, invoiceNumber: platformInvoice.invoice_number },
      'Payment already recorded for invoice'
    );
    return;
  }

  // The payment intent, from wherever this API version keeps it.
  //
  // `invoice.payment_intent` was REMOVED from the Invoice object in the 2025
  // API versions; settlement now hangs off `invoice.payments[].payment`. This
  // account is already on the newer shape — all three paid invoices returned
  // `payment_intent: undefined` while carrying a real
  // `payments.data[0].payment.payment_intent`.
  //
  // Reading only the old field would record every invoice payment with a null
  // id, and Stripe needs the payment intent or the charge to refund against —
  // so each of those payments would be permanently unrefundable. Both shapes are
  // read, and the list is fetched if the webhook payload did not inline it.
  const paymentIntentId = await resolveInvoicePaymentIntent(invoice, new Stripe(process.env.STRIPE_SECRET_KEY!), connectAccountId);

  if (!paymentIntentId) {
    log.warn(
      { invoiceId: platformInvoice.id, stripeInvoiceId: invoice.id },
      'invoice.paid carried no payment intent in either shape - this payment will not be refundable'
    );
  }

  // The payment is recorded BEFORE the invoice is marked paid.
  //
  // It used to be the other way round with the failure only logged, so a failed
  // insert left an invoice that looked settled with no money behind it. This
  // order means a failure leaves the invoice UNPAID — visible, and retryable.
  const invoiceCurrency = invoice.currency.toUpperCase();

  // What Stripe kept out of this invoice payment.
  const invoiceFee = await resolveProcessorFee({
    stripe: new Stripe(process.env.STRIPE_SECRET_KEY!),
    account: connectAccountId,
    paymentIntentId,
  });

  const { error: txError } = await supabaseAdmin
    .from('payment_transactions')
    .insert({
      user_id: platformInvoice.user_id,
      contact_id: platformInvoice.contact_id,
      invoice_id: platformInvoice.id,
      /*
       * `/ 100` assumed every currency has two decimal places, and this was the
       * last place in the file still doing it. JPY has none and KWD has three,
       * so a ¥5,000 invoice payment was recorded as ¥50 — under-reporting the
       * money by a hundredfold and leaving the refund guard comparing two
       * different scales.
       */
      amount: fromMinorUnits(invoice.amount_paid, invoiceCurrency),
      currency: invoiceCurrency,
      status: 'succeeded',
      payment_method: 'card',
      description: `Payment for invoice ${platformInvoice.invoice_number}`,
      processor_type: 'stripe',
      stripe_payment_intent_id: paymentIntentId,
      stripe_customer_id: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || null,
      ...feeColumns(invoiceFee),
      paid_at: paidAt,
      metadata: {
        stripe_invoice_id: invoice.id,
        connect_account_id: connectAccountId,
        invoice_number: platformInvoice.invoice_number
      },
      refund_status: 'none',
      refunded_amount: 0,
      // Where this charge lives, taken from Stripe's own answer rather than
      // looked up again later. A refund issued against the wrong account does
      // not fail safely — it either errors or returns money from the wrong
      // balance — and after the fact there is nothing in the database that could
      // tell the two apart.
      ...describeChargeAccount(connectAccountId)
    });

  if (txError) {
    log.error({ err: txError, invoiceId: platformInvoice.id }, 'Failed to create payment transaction');
    throw new Error(
      `Failed to record payment for invoice ${platformInvoice.id}: ${txError.message}`
    );
  }

  log.info(
    { invoiceId: platformInvoice.id, invoiceNumber: platformInvoice.invoice_number },
    'Payment transaction created for invoice'
  );

  // Then the invoice. The update_invoice_on_payment trigger also does this when
  // the transaction lands; this is idempotent and covers databases without it.
  const { error: updateError } = await supabaseAdmin
    .from('payment_invoices')
    .update({
      status: 'paid',
      paid_at: paidAt,
      stripe_hosted_invoice_url: invoice.hosted_invoice_url,
      stripe_invoice_pdf: invoice.invoice_pdf,
      updated_at: paidAt
    })
    .eq('id', platformInvoice.id);

  if (updateError) {
    log.error({ err: updateError, invoiceId: platformInvoice.id }, 'Failed to update platform invoice');
    throw new Error(
      `Failed to mark invoice ${platformInvoice.id} paid: ${updateError.message}`
    );
  }

  // Update linked booking's payment_status if invoice has a booking_id
  if (platformInvoice.booking_id) {
    log.info({ bookingId: platformInvoice.booking_id }, 'Updating booking payment_status');
    const { error: bookingUpdateError } = await supabaseAdmin
      .from('scheduling_bookings')
      .update({
        payment_status: 'paid',
        updated_at: new Date().toISOString()
      })
      .eq('id', platformInvoice.booking_id);

    if (bookingUpdateError) {
      log.error(
        { err: bookingUpdateError, bookingId: platformInvoice.booking_id },
        'Failed to update booking payment status'
      );
    } else {
      log.info({ bookingId: platformInvoice.booking_id }, 'Booking payment status updated to paid');
    }
  } else {
    /*
     * ───────────────────────────────────────────────────────────────────────
     * NO BOOKING ON THE INVOICE MEANS NO BOOKING. WE DO NOT GUESS.
     *
     * This used to hunt for one: same contact, a booking whose SERVICE PRICE
     * equalled the invoice amount, most recent unpaid one wins. On a match it
     * marked that booking paid AND wrote its id onto the invoice.
     *
     * Those three signals cannot tell an invoice raised FOR a booking from a
     * standalone invoice that happens to cost the same — which, for a business
     * selling one service repeatedly at one price, is the normal shape of the
     * data rather than an edge case.
     *
     * It did real damage, both halves silent:
     *
     *   A standalone invoice raised from the orders page was bound, on payment,
     *   to an unrelated booking three days older that already had its own
     *   invoice. The invoice left the "invoices without an order" tab, merged
     *   into that booking's row, and the row read ₪600 overdue — one paid
     *   invoice and one unpaid, totalled as if they were one job.
     *
     *   And the booking was marked PAID by money that was never for it. Nobody
     *   checks a booking that says paid.
     *
     * The binding was permanent: `booking_id` is what every later read follows.
     *
     * The backfill that does this same matching over historical rows
     * (20260825_backfill_invoice_booking_id.sql) learned this and guards hard —
     * one-to-one in BOTH directions, within an hour, and only where the booking
     * has no invoice yet. Its own words: "a booking showing ₪800 it never
     * charged is worse than a booking showing nothing." That is the standard a
     * guess has to meet, and three loose signals at payment time do not.
     *
     * The link belongs at CREATION, where it is known. An invoice raised
     * against a booking carries `booking_id` from the start and takes the
     * branch above; one raised standalone is standalone, and stays that way.
     * ───────────────────────────────────────────────────────────────────────
     */
    log.info(
      { invoiceId: platformInvoice.id },
      'Invoice has no booking_id; left unlinked rather than matched by guess'
    );
  }

  // Log audit event
  try {
    const { auditLog } = await import('@/lib/services/AuditTrailService');
    await auditLog({
      action: 'INVOICE_PAID',
      entityType: 'payment_invoice',
      entityId: platformInvoice.id,
      userId: platformInvoice.user_id,
      resourceName: platformInvoice.invoice_number,
      details: {
        amount: invoice.amount_paid / 100,
        currency: invoice.currency,
        stripe_invoice_id: invoice.id,
        connect_account_id: connectAccountId
      },
      severity: 'info'
    });
  } catch (auditError) {
    log.warn({ err: auditError, invoiceId: platformInvoice.id }, 'Audit logging failed');
  }

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE RECEIPT.
   *
   * Every other way an invoice settles sends one — the owner's "mark as paid",
   * the invoice send route, the website checkout — because they all go through
   * `settleInvoicePaid`. This path records the payment itself and so sent
   * NOTHING: a client who paid a Stripe invoice got the booking confirmation
   * before the money moved and then silence, with no record of what left their
   * account. Verified on INV-00018: settled at 18:25:57, zero emails after it.
   *
   * Non-blocking and last, so a mail failure cannot fail a webhook Stripe would
   * then retry into a handler that has already done its work.
   * ───────────────────────────────────────────────────────────────────────────
   */
  void (async () => {
    try {
      const { data: receiptInvoice } = await supabaseAdmin
        .from('payment_invoices')
        .select('user_id, client_email, client_name, invoice_number, currency, booking_id')
        .eq('id', platformInvoice.id)
        .maybeSingle();

      if (!receiptInvoice?.client_email) {
        log.info({ invoiceId: platformInvoice.id }, 'No client email on this invoice; no receipt to send');
        return;
      }

      const { BookingEmailService } = await import('@/lib/services/BookingEmailService');

      const receipt = await BookingEmailService.sendPaymentReceipt(receiptInvoice.user_id, {
        customerEmail: receiptInvoice.client_email,
        customerName: receiptInvoice.client_name || '',
        // What the client was charged, in the currency they were charged it —
        // never the balance-transaction figure, which is the account's
        // settlement currency and a different number.
        amount: fromMinorUnits(invoice.amount_paid, invoiceCurrency),
        currency: receiptInvoice.currency || invoiceCurrency,
        receiptNumber: receiptInvoice.invoice_number,
        paymentMethod: 'card',
        bookingId: receiptInvoice.booking_id ?? undefined,
      });

      if (!receipt.sent) {
        log.warn({ invoiceId: platformInvoice.id, reason: receipt.error }, 'Receipt not sent');
      }
    } catch (receiptError) {
      log.error(
        { err: receiptError, invoiceId: platformInvoice.id },
        'Payment settled but the receipt did not go out'
      );
    }
  })();

  log.info(
    { invoiceId: platformInvoice.id, invoiceNumber: platformInvoice.invoice_number },
    'Connect invoice paid processed'
  );
}

/**
 * Handle Connect checkout.session.completed event
 * - For invoice payments: Update payment_invoices status to 'paid'
 * - For booking payments: Update booking payment status
 */
async function handleConnectCheckoutCompleted(
  session: Stripe.Checkout.Session,
  connectAccountId: string,
  log: Logger
) {
  log.info({ sessionId: session.id, connectAccountId }, 'Processing Connect checkout.session.completed');

  const invoiceId = session.metadata?.invoice_id;
  const bookingId = session.metadata?.booking_id;

  /**
   * A payment plan's first charge. Bound it, or it bills forever.
   *
   * A Checkout Session cannot create a Subscription Schedule, so the session is
   * opened in `subscription` mode and the schedule is attached here, the moment
   * the subscription exists. `end_behavior: 'cancel'` is what stops it after the
   * agreed number of periods — an open subscription would keep charging the
   * client past the end of what they signed up for, which is the single worst
   * outcome available in this file.
   *
   * Attached from the subscription rather than created fresh: releasing and
   * recreating would drop the payment method the client just entered.
   */
  if (session.mode === 'subscription' && session.subscription && session.metadata?.plan_count) {
    const subscriptionId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
    const ownerId = session.metadata?.owner_id;

    try {
      // The webhook has no module-level client; the one at the invoice handler
      // is function-scoped. Constructed here for the same reason.
      const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!);

      if (ownerId && (await accountOwns(connectAccountId, ownerId, log))) {
        await bindPlanSubscription({
          stripe: stripeClient,
          connectAccountId,
          subscriptionId,
          customerId:
            typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
          ownerId,
          bookingId: bookingId || null,
          serviceId: session.metadata?.service_id || null,
          planTotal: Number(session.metadata?.plan_total ?? 0),
          planCurrency: session.metadata?.plan_currency || 'USD',
          planCount: Number(session.metadata.plan_count),
          planFrequency: (session.metadata?.plan_frequency || 'monthly') as PlanFrequency,
        });
      } else {
        log.error(
          { connectAccountId, subscriptionId },
          'Plan checkout names an owner this account does not own - refusing'
        );
      }
    } catch (scheduleError) {
      // Loud, and deliberately not swallowed: an unbounded subscription charges
      // a client indefinitely, so this needs a human, not a log line.
      log.error(
        { err: scheduleError, subscriptionId, connectAccountId },
        'Could not bound a payment plan - subscription may bill indefinitely'
      );
      throw scheduleError;
    }
  }

  // Handle invoice payment via Checkout Session
  if (invoiceId) {
    log.info({ invoiceId, sessionId: session.id }, 'Checkout session for invoice');

    // Look up the platform invoice
    const { data: platformInvoice, error: lookupError } = await supabaseAdmin
      .from('payment_invoices')
      .select('*')
      .eq('id', invoiceId)
      .single();

    if (lookupError || !platformInvoice) {
      log.error({ err: lookupError, invoiceId }, 'Platform invoice not found');
      return;
    }

    if (!(await accountOwns(connectAccountId, platformInvoice.user_id, log))) {
      // Same hole as the invoice.paid path: the invoice is found by a UUID that
      // travelled in metadata written by the connected account.
      log.error(
        { connectAccountId, invoiceId },
        'Connect checkout names an invoice owned by a different business - refusing'
      );
      return;
    }

    if (platformInvoice.status === 'paid') {
      log.info({ invoiceId }, 'Invoice already marked as paid');
      return;
    }

    // The payment is recorded BEFORE the invoice is marked paid.
    //
    // The order used to be the other way round, and the insert that followed
    // could never succeed: it set `type: 'payment'`, a column that does not
    // exist on payment_transactions, and `status: 'completed'`, which is not one
    // of pending/succeeded/failed/refunded. Postgres rejected every row, the
    // failure was only logged, and the invoice had already been marked paid — so
    // the money vanished from the records while the invoice looked settled.
    //
    // Writing the payment first means a failure here leaves the invoice UNPAID:
    // visible, wrong in the safe direction, and retryable.
    const paidAt = new Date().toISOString();
    const amountPaid = (session.amount_total || 0) / 100;

    const { error: txError } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        user_id: platformInvoice.user_id,
        contact_id: platformInvoice.contact_id,
        invoice_id: invoiceId,
        amount: amountPaid,
        currency: platformInvoice.currency || 'USD',
        status: 'succeeded',
        processor_type: 'stripe',
        payment_method: 'card',
        paid_at: paidAt,
        stripe_payment_intent_id: session.payment_intent as string,
        description: `Payment for invoice ${platformInvoice.invoice_number}`,
        metadata: {
          checkout_session_id: session.id,
          connect_account_id: connectAccountId
        },
        // Same reasoning as the invoice handler: recorded at charge time,
        // never inferred at refund time.
        ...describeChargeAccount(connectAccountId)
      });

    if (txError) {
      // Thrown, not logged and swallowed. The caller turns this into a non-2xx
      // so Stripe retries; swallowing it is what produced paid-looking invoices
      // with no payment behind them.
      log.error({ err: txError, invoiceId }, 'Failed to create payment transaction');
      throw new Error(`Failed to record payment for invoice ${invoiceId}: ${txError.message}`);
    }

    log.info(
      { invoiceId, invoiceNumber: platformInvoice.invoice_number },
      'Payment transaction created for invoice'
    );

    // Now the invoice. The update_invoice_on_payment trigger already does this
    // when the transaction lands, so this is belt-and-braces for databases where
    // that trigger is not present — and it is idempotent either way.
    const { error: updateError } = await supabaseAdmin
      .from('payment_invoices')
      .update({
        status: 'paid',
        paid_at: paidAt,
        updated_at: paidAt
      })
      .eq('id', invoiceId);

    if (updateError) {
      log.error({ err: updateError, invoiceId }, 'Failed to update invoice status');
      throw new Error(`Failed to mark invoice ${invoiceId} paid: ${updateError.message}`);
    }

    log.info({ invoiceId, invoiceNumber: platformInvoice.invoice_number }, 'Invoice marked as paid');

    /*
     * The pipeline is not moved from here any more.
     *
     * This promoted the contact on payment — first by writing the literal
     * `stage: 'customer'`, a key only the seeded default pipeline contains,
     * then via `promoteToClientStage`. Both answered the wrong question.
     * Payment is not the relationship: a business billing by invoice has
     * clients who have not paid, and a free intro call is not a client at all.
     *
     * A booking being CONFIRMED is the rule, and it lives in one place — the
     * `promote_contact_on_confirmed_booking` trigger. What this path owes it is
     * the confirmation itself, below: a booking held pending because money was
     * owed is confirmed once that money arrives.
     */

    // Update linked booking's payment_status if invoice has a booking_id
    if (platformInvoice.booking_id) {
      log.info({ bookingId: platformInvoice.booking_id, invoiceId }, 'Updating booking payment status for invoice booking');
      const { error: bookingError } = await supabaseAdmin
        .from('scheduling_bookings')
        .update({
          payment_status: 'paid',
          /*
           * And confirm it, if it was only pending because money was owed.
           *
           * This set `payment_status` alone, so a booking taken with payment
           * up front stayed `pending` forever once paid — while the website's
           * own finalize route set it `confirmed` for the same event. Two paths
           * through the same purchase left the booking in two different states.
           *
           * Scoped to `pending` by the filter below so a cancelled or completed
           * booking is never resurrected by a late webhook.
           */
          status: 'confirmed',
          updated_at: new Date().toISOString()
        })
        .eq('id', platformInvoice.booking_id)
        .eq('status', 'pending');

      if (bookingError) {
        log.error({ err: bookingError, bookingId: platformInvoice.booking_id }, 'Failed to update booking payment status');
      } else {
        log.info({ bookingId: platformInvoice.booking_id, invoiceId }, 'Booking payment status updated for invoice');
      }
    }

    return;
  }

  // Handle booking payment via Checkout Session
  if (bookingId) {
    log.info({ bookingId, sessionId: session.id }, 'Checkout session for booking');

    // The booking id is metadata the connected account wrote, so it could name
    // any business's booking (F-2). The write is scoped to the business that
    // owns the SENDING account: another business's booking matches no row.
    const owner = await accountOwner(connectAccountId, log);
    if (!owner) {
      log.error(
        { connectAccountId, bookingId },
        'Connect checkout names a booking on an account that maps to no business - refusing'
      );
      return;
    }

    // Update booking payment status. `count` (never `.select()` after an
    // update) is how a foreign id is told apart: it updates nothing.
    const { error: bookingError, count: bookingsUpdated } = await supabaseAdmin
      .from('scheduling_bookings')
      .update(
        {
          payment_status: 'paid',
          updated_at: new Date().toISOString()
        },
        { count: 'exact' }
      )
      .eq('id', bookingId)
      .eq('user_id', owner);

    if (bookingError) {
      log.error({ err: bookingError, bookingId }, 'Failed to update booking payment status');
    } else if (bookingsUpdated === 0) {
      // Strictly 0: an absent count says nothing and must not read as a refusal.
      log.error(
        { connectAccountId, bookingId },
        'Connect checkout names a booking owned by a different business - no row updated'
      );
    } else {
      log.info({ bookingId }, 'Booking payment status updated');
    }

    return;
  }

  log.info({ sessionId: session.id }, 'Connect checkout session with no invoice_id or booking_id - skipping');
}

/**
 * Handle business invoice.payment_failed event (from Connect accounts)
 * - Update payment_invoices status to 'overdue'
 */
async function handleConnectInvoicePaymentFailed(invoice: Stripe.Invoice, connectAccountId: string, log: Logger) {
  log.info({ stripeInvoiceId: invoice.id, connectAccountId }, 'Processing Connect invoice.payment_failed');

  /**
   * A plan period that did not go through.
   *
   * Recorded against the plan so the business can be told something useful —
   * "their card was declined on payment 3 of 12" — rather than discovering it
   * when the total never arrives. Stripe keeps retrying on its own schedule;
   * this only mirrors the state.
   */
  const failedSubscriptionId = subscriptionIdFromInvoice(invoice);

  if (failedSubscriptionId) {
    const plan = await paymentPlanSubscriptionRepository.findBySubscriptionId(failedSubscriptionId);

    if (plan.data && (await accountOwns(connectAccountId, plan.data.user_id, log))) {
      await paymentPlanSubscriptionRepository.recordFailure(
        plan.data.id,
        (invoice as unknown as { last_finalization_error?: { code?: string } }).last_finalization_error?.code ?? null
      );

      log.info({ planId: plan.data.id, subscriptionId: failedSubscriptionId }, 'Plan marked past_due');
      return;
    }
  }

  // Look up the platform invoice by Stripe invoice ID
  const { data: platformInvoice, error: lookupError } = await supabaseAdmin
    .from('payment_invoices')
    .select('id, invoice_number, user_id')
    .eq('stripe_invoice_id', invoice.id)
    .single();

  if (lookupError || !platformInvoice) {
    log.info({ stripeInvoiceId: invoice.id }, 'No platform invoice found for Stripe invoice');
    return;
  }

  // Found by Stripe invoice id, which is only as trustworthy as whoever wrote
  // it onto our row: the invoice.paid fallback used to plant it before its owner
  // check (F-1). So the sending account must own the row, like invoice.paid.
  if (!(await accountOwns(connectAccountId, platformInvoice.user_id, log))) {
    log.error(
      { connectAccountId, invoiceId: platformInvoice.id },
      'Connect invoice.payment_failed names an invoice owned by a different business - refusing'
    );
    return;
  }

  // Update platform invoice to overdue
  const { error: updateError } = await supabaseAdmin
    .from('payment_invoices')
    .update({
      status: 'overdue',
      updated_at: new Date().toISOString()
    })
    .eq('id', platformInvoice.id);

  if (updateError) {
    log.error({ err: updateError, invoiceId: platformInvoice.id }, 'Failed to update platform invoice');
    return;
  }

  /*
   * A failed payment, on the client's timeline.
   *
   * Only successful receipts were recorded, so "this client's card keeps
   * declining" was a pattern with no trail behind it — the invoice quietly
   * turned overdue and the drawer said nothing.
   */
  const { data: failedInvoice } = await supabaseAdmin
    .from('payment_invoices')
    .select('contact_id, amount, currency')
    .eq('id', platformInvoice.id)
    .maybeSingle();

  if (failedInvoice?.contact_id) {
    const { data: ownerProfile } = await supabaseAdmin
      .from('business_profiles')
      .select('language')
      .eq('user_id', platformInvoice.user_id)
      .maybeSingle();
    const ownerLocale = ownerProfile?.language || 'en';
    const currency = failedInvoice.currency || 'USD';

    crmActivityRepository.create({
      user_id: platformInvoice.user_id,
      contact_id: failedInvoice.contact_id,
      activity_type: 'payment_failed',
      title: activitySentence('payment_failed', {
        amount: new Intl.NumberFormat(
          ownerLocale === 'he' ? 'he-IL' : ownerLocale === 'es' ? 'es-ES' : 'en-US',
          { style: 'currency', currency }
        ).format(Number(failedInvoice.amount) || 0),
      }, ownerLocale),
      description: JSON.stringify({
        kind: 'payment_failed',
        amount: failedInvoice.amount,
        currency,
        invoiceNumber: platformInvoice.invoice_number || undefined,
      }),
      auto_logged: true,
      source_capability: 'payments',
      source_entity_id: platformInvoice.id,
    }).catch(err => log.warn({ err, invoiceId: platformInvoice.id }, 'Payment-failed activity logging failed (non-blocking)'));
  }

  log.info(
    { invoiceId: platformInvoice.id, invoiceNumber: platformInvoice.invoice_number },
    'Connect invoice payment failed processed'
  );
}

/**
 * Handle business invoice.finalized event (from Connect accounts)
 * - Update stripe_hosted_invoice_url and stripe_invoice_pdf
 */
async function handleConnectInvoiceFinalized(invoice: Stripe.Invoice, connectAccountId: string, log: Logger) {
  log.info({ stripeInvoiceId: invoice.id, connectAccountId }, 'Processing Connect invoice.finalized');

  // Look up the platform invoice by Stripe invoice ID
  const { data: platformInvoice, error: lookupError } = await supabaseAdmin
    .from('payment_invoices')
    .select('id, invoice_number, user_id')
    .eq('stripe_invoice_id', invoice.id)
    .single();

  if (lookupError || !platformInvoice) {
    log.info({ stripeInvoiceId: invoice.id }, 'No platform invoice found for Stripe invoice');
    return;
  }

  // Same reason as invoice.payment_failed: a planted Stripe id must not let
  // one business replace another's hosted payment link and PDF (F-1).
  if (!(await accountOwns(connectAccountId, platformInvoice.user_id, log))) {
    log.error(
      { connectAccountId, invoiceId: platformInvoice.id },
      'Connect invoice.finalized names an invoice owned by a different business - refusing'
    );
    return;
  }

  // Update with hosted URL and PDF
  const { error: updateError } = await supabaseAdmin
    .from('payment_invoices')
    .update({
      stripe_hosted_invoice_url: invoice.hosted_invoice_url,
      stripe_invoice_pdf: invoice.invoice_pdf,
      updated_at: new Date().toISOString()
    })
    .eq('id', platformInvoice.id);

  if (updateError) {
    log.error({ err: updateError, invoiceId: platformInvoice.id }, 'Failed to update platform invoice');
    return;
  }

  log.info(
    { invoiceId: platformInvoice.id, invoiceNumber: platformInvoice.invoice_number },
    'Connect invoice finalized processed'
  );
}

/**
 * Handle business invoice.marked_uncollectible event (from Connect accounts)
 * - Update payment_invoices status to 'cancelled'
 */
async function handleConnectInvoiceUncollectible(invoice: Stripe.Invoice, connectAccountId: string, log: Logger) {
  log.info({ stripeInvoiceId: invoice.id, connectAccountId }, 'Processing Connect invoice.marked_uncollectible');

  // Look up the platform invoice by Stripe invoice ID
  const { data: platformInvoice, error: lookupError } = await supabaseAdmin
    .from('payment_invoices')
    .select('id, invoice_number, user_id')
    .eq('stripe_invoice_id', invoice.id)
    .single();

  if (lookupError || !platformInvoice) {
    log.info({ stripeInvoiceId: invoice.id }, 'No platform invoice found for Stripe invoice');
    return;
  }

  // Same reason as invoice.payment_failed: a planted Stripe id must not let
  // one business cancel another's invoice (F-1).
  if (!(await accountOwns(connectAccountId, platformInvoice.user_id, log))) {
    log.error(
      { connectAccountId, invoiceId: platformInvoice.id },
      'Connect invoice.marked_uncollectible names an invoice owned by a different business - refusing'
    );
    return;
  }

  // Update platform invoice to cancelled
  const { error: updateError } = await supabaseAdmin
    .from('payment_invoices')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString()
    })
    .eq('id', platformInvoice.id);

  if (updateError) {
    log.error({ err: updateError, invoiceId: platformInvoice.id }, 'Failed to update platform invoice');
    return;
  }

  log.info(
    { invoiceId: platformInvoice.id, invoiceNumber: platformInvoice.invoice_number },
    'Connect invoice marked uncollectible'
  );
}


/**
 * A client's payment plan ended at Stripe.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Two ways to get here, and they mean different things:
 *
 *   · the schedule reached its last period — the plan COMPLETED, normally;
 *   · somebody cancelled it in the Stripe dashboard — the plan was STOPPED.
 *
 * `periods_paid` against `installment_count` is what separates them, and it
 * matters: a completed plan is a finished sale, a cancelled one has periods that
 * must come off the business's receivables.
 *
 * OWNERSHIP IS VERIFIED, and never taken from metadata. Subscriptions on a
 * connected account are created by that business, which controls their metadata
 * — so a `user_id` there could name any tenant. The subscription is looked up by
 * OUR OWN recorded id, and the account that sent the event must be the one that
 * owns the plan we found.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function handlePlanSubscriptionEnded(
  subscription: Stripe.Subscription,
  connectAccountId: string,
  log: Logger
) {
  const { data: plan } = await supabaseAdmin
    .from('payment_plan_subscriptions')
    .select('id, user_id, status, installment_count, periods_paid')
    .eq('stripe_subscription_id', subscription.id)
    .maybeSingle();

  // Not a plan this platform sold. Connected accounts have subscriptions of
  // their own and they are none of our business.
  if (!plan) return;

  if (!(await accountOwns(connectAccountId, plan.user_id, log))) {
    log.error(
      { subscriptionId: subscription.id, connectAccountId },
      'Subscription ended on an account that does not own the plan it names'
    );
    return;
  }

  if (plan.status === 'cancelled' || plan.status === 'completed') return;

  const completed = (plan.periods_paid ?? 0) >= (plan.installment_count ?? 0);

  await supabaseAdmin
    .from('payment_plan_subscriptions')
    .update({
      status: completed ? 'completed' : 'cancelled',
      [completed ? 'completed_at' : 'cancelled_at']: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', plan.id);

  // Periods that will now never be charged stop counting as owed. `cancelled`
  // is a settled status, which is what takes them out of receivables.
  if (!completed) {
    await supabaseAdmin
      .from('payment_plan_installments')
      .update({ status: 'cancelled', next_retry_at: null, updated_at: new Date().toISOString() })
      .eq('user_id', plan.user_id)
      .eq('subscription_id', subscription.id)
      /*
       * Everything unsettled, not only `pending`.
       *
       * A billed-but-unpaid period kept counting as owed on a subscription
       * Stripe had already ended — the exact thing the comment above says this
       * write exists to prevent.
       */
      .not('status', 'in', '(paid,cancelled)');
  }

  log.info(
    { subscriptionId: subscription.id, planId: plan.id, outcome: completed ? 'completed' : 'cancelled' },
    'Payment plan ended'
  );
}

/**
 * Handle customer.subscription.deleted event
 * - Mark subscription as canceled
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription, log: Logger) {
  log.info({ subscriptionId: subscription.id }, 'Processing customer.subscription.deleted');

  const userId = subscription.metadata?.user_id;

  if (!userId) {
    log.error({ subscriptionId: subscription.id }, 'No user_id in subscription metadata');
    return;
  }

  await supabaseAdmin
    .from('user_subscriptions')
    .update({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
      cancel_at_period_end: false
    })
    .eq('user_id', userId);

  // Log billing event
  await supabaseAdmin
    .from('billing_events')
    .insert({
      user_id: userId,
      event_type: 'subscription_canceled',
      credits_delta: 0,
      description: 'Subscription canceled'
    });

  log.info({ userId, subscriptionId: subscription.id }, 'Subscription canceled');
}

/**
 * Mark a claimed event done, so later deliveries of it are skipped. The one
 * place a claim is completed: the switch path and the Business OS deny path both
 * use it (SA P1-C4).
 */
async function completeClaim(eventId: string) {
  await supabaseAdmin
    .from('processed_webhook_events')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('event_id', eventId);
}

/**
 * Business OS flow handlers, registered by the slices that build them (P-3b adds
 * `plan`; boost 4a adds `boost`). A recognised flow with no handler throws, the
 * claim is released and Stripe retries (SA Q-6) — so a resolver and its handler
 * ship together (boost SA C-2). A handler that returns means "complete"; one
 * that throws means "release for retry".
 */
const BUSINESS_OS_FLOW_HANDLERS: Partial<
  Record<BusinessOsFlow, (event: Stripe.Event, log: Logger) => Promise<void>>
> = {
  boost: handleBoostWebhookEvent,
};

/**
 * Main webhook handler
 */
export async function POST(request: NextRequest) {
  // Stripe sends no correlation header, so one is generated per delivery unless
  // a caller supplied it. The Stripe event id is bound once the event is
  // verified (below), and is the id to search by. Declared outside the try so
  // the catch can log with it.
  let log: Logger = logger.child({
    correlationId: request.headers.get('x-correlation-id') || crypto.randomUUID(),
  });

  // Set once this request has claimed the event. The catch needs it to release
  // the claim, and it must survive out of the try block to do so.
  let processedEventId: string | null = null;

  // A warm instance keeps module state between deliveries; an owner found for
  // an earlier one is not reused here (see `accountOwnerCache`, FU-5).
  accountOwnerCache.clear();

  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing stripe-signature header' },
        { status: 400 }
      );
    }

    // A signed header with an empty body is not a signature problem, and saying
    // "Signature verification failed" for it sends the next reader hunting for a
    // secret mismatch that isn't there. It means the request was aborted between
    // the headers and the body — the sender gave up while this route was still
    // being served. Locally that is the dev server cold-compiling this file (it
    // is thousands of lines) or having died, while `stripe listen` times out and
    // drops the connection; the handler then runs against a stream that is
    // already gone and reads ''. Still a 400: Stripe retries on it, and the CLI,
    // which does not retry, has nothing to resend anyway.
    if (!body) {
      log.error(
        { signatureTimestamp: signature.split(',')[0] },
        'Empty request body with a stripe-signature header present - ' +
        'the request was aborted before the body arrived (check the server is up ' +
        'and the route is warm)'
      );
      return NextResponse.json({ error: 'Empty request body' }, { status: 400 });
    }

    // Either secret verifies.
    //
    // Connected-account events can arrive at the same endpoint as platform ones,
    // or at a separate endpoint with its own secret, depending on how Stripe is
    // configured — and that is a dashboard setting nobody here controls.
    // Accepting both means this code is correct either way, so the fix does not
    // have to be coordinated with a dashboard change.
    const secrets = [
      process.env.STRIPE_WEBHOOK_SECRET,
      process.env.STRIPE_CONNECT_WEBHOOK_SECRET
    ].filter(Boolean) as string[];

    if (secrets.length === 0) {
      log.error('No Stripe webhook secret configured');
      return NextResponse.json(
        { error: 'Webhook secret not configured' },
        { status: 500 }
      );
    }

    const stripeService = getStripeService();
    let event: Stripe.Event | null = null;
    let verificationError: unknown = null;

    for (const secret of secrets) {
      try {
        event = stripeService.constructWebhookEvent(body, signature, secret);
        break;
      } catch (err) {
        verificationError = err;
      }
    }

    if (!event) {
      // A signature that matches no configured secret is not ours. 400 is
      // correct here — unlike a handler failure, retrying will not help.
      log.error({ err: verificationError }, 'Signature verification failed');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // Every line from here on carries the Stripe event, so one delivery can be
    // traced end to end from the event id alone.
    log = log.child({ stripeEventId: event.id, eventType: event.type, livemode: event.livemode });

    log.info('Received event');

    // ============================================================================
    // IDEMPOTENCY CHECK: Prevent duplicate processing of the same webhook event
    // ============================================================================
    // Two-phase, because "seen" and "done" are different facts.
    //
    // Recording the id before processing is correct — it is what stops two
    // concurrent deliveries both running the handler. What was missing was any
    // way back: a handler that threw left its row behind, so every Stripe retry
    // of that event was discarded as a duplicate. For an event that moves money
    // that is a one-way valve, and it is how client payments were lost.
    //
    // Only 'completed' suppresses a retry now. A 'failed' row is reclaimed
    // below so Stripe's next delivery can do the work.
    const { data: existingEvent, error: checkError } = await supabaseAdmin
      .from('processed_webhook_events')
      .select('event_id, status')
      .eq('event_id', event.id)
      .maybeSingle();

    if (checkError) {
      log.error({ err: checkError }, 'Error checking for duplicate event');
      // Continue processing - don't fail webhook if check fails
    }

    if (existingEvent?.status === 'completed') {
      log.info('Event already processed, skipping duplicate');
      return NextResponse.json({ received: true, duplicate: true });
    }

    if (existingEvent?.status === 'processing') {
      // Another delivery of the same event is in flight right now.
      log.info('Event is being processed by another request, skipping');
      return NextResponse.json({ received: true, duplicate: true });
    }

    if (existingEvent) {
      // A previous attempt failed. Claim it for this attempt.
      log.info('Retrying previously failed event');
      await supabaseAdmin
        .from('processed_webhook_events')
        .update({ status: 'processing', failure_message: null, processed_at: new Date().toISOString() })
        .eq('event_id', event.id);
      processedEventId = event.id;
    } else {
      const { error: insertError } = await supabaseAdmin
        .from('processed_webhook_events')
        .insert({
          event_id: event.id,
          event_type: event.type,
          status: 'processing',
          processed_at: new Date().toISOString(),
          metadata: {
            created: event.created,
            livemode: event.livemode
          }
        });

      if (insertError) {
        // Unique violation means another request claimed it between our SELECT
        // and this INSERT. Theirs wins.
        if (insertError.code === '23505') {
          log.info('Event is being processed by another request, skipping');
          return NextResponse.json({ received: true, duplicate: true });
        }
        log.error({ err: insertError }, 'Error recording event');
        // Continue processing even if we couldn't record the event
      } else {
        processedEventId = event.id;
      }
    }

    log.info('Event recorded, processing');

    // Which account this event belongs to — a business's connected account, or
    // the platform.
    //
    // This read a `stripe-account` request header, which Stripe does not send on
    // webhook deliveries; a connected-account event carries its account on the
    // event body. So this was always false and no client payment ever reached
    // the handlers below: 12 invoices existed against zero payment
    // transactions, with paid ones still reading `overdue`.
    //
    // Platform events have no `event.account`, so they take exactly the path
    // they take today.
    const connectAccountId = event.account ?? null;
    const isConnectEvent = !!connectAccountId;

    if (isConnectEvent) {
      log = log.child({ connectAccountId });
      log.info('Connect event from account');
    }

    // Business OS billing router (plan payments P-1). Platform events only:
    // Connect events never reach it. Deny by default: a platform invoice whose
    // price is not a Business OS plan price is acknowledged and NO handler runs,
    // so it can never be converted into Pilot Credits. A resolver that cannot
    // tell (e.g. Stripe unavailable) throws, and the catch below releases the
    // claim so Stripe retries.
    if (!isConnectEvent) {
      const outcome = await dispatchBusinessOsEvent(event, { log });

      if (outcome.kind === 'deny') {
        const denied = { event: 'bos_billing_event_denied', reason: outcome.reason, ...outcome.detail };
        if (denyLevel(outcome.reason) === 'error') {
          log.error({ ...denied, alert: true }, 'Business OS billing: event denied');
        } else {
          log.warn(denied, 'Business OS billing: event denied');
        }
        await completeClaim(event.id);
        return NextResponse.json({ received: true });
      }

      if (outcome.kind === 'flow') {
        const handler = BUSINESS_OS_FLOW_HANDLERS[outcome.flow];
        if (!handler) {
          log.warn(
            { event: `bos_billing_${outcome.flow}_unhandled`, lookupKeys: outcome.lookupKeys },
            'Business OS billing: recognised, but no handler is registered yet; releasing for retry'
          );
          throw new BusinessOsHandlerMissingError(outcome.flow);
        }
        await handler(event, log);
        await completeClaim(event.id);
        return NextResponse.json({ received: true });
      }
    }

    // Process event based on type
    switch (event.type) {
      case 'invoice.paid':
        if (isConnectEvent) {
          // Business user's client paid an invoice
          await handleConnectInvoicePaid(event.data.object as Stripe.Invoice, connectAccountId!, log);
        } else {
          // The Business OS router decides every platform invoice.paid (flow or
          // deny) before the switch. Reaching here means it was bypassed; the
          // old Pilot-Credit conversion is gone (P-1), so nothing is written.
          log.error({ alert: true }, 'Platform invoice.paid reached the switch; not processed');
        }
        break;

      case 'invoice.payment_failed':
        if (isConnectEvent) {
          // Business user's client failed to pay
          await handleConnectInvoicePaymentFailed(event.data.object as Stripe.Invoice, connectAccountId!, log);
        } else {
          // Platform subscription payment failed
          await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice, log);
        }
        break;

      case 'invoice.finalized':
        if (isConnectEvent) {
          // Business user's invoice was finalized (ready for payment)
          await handleConnectInvoiceFinalized(event.data.object as Stripe.Invoice, connectAccountId!, log);
        }
        // No platform handler for finalized - platform uses Stripe's automatic invoicing
        break;

      case 'invoice.marked_uncollectible':
        if (isConnectEvent) {
          // Business user's invoice marked as uncollectible
          await handleConnectInvoiceUncollectible(event.data.object as Stripe.Invoice, connectAccountId!, log);
        }
        // No platform handler - not applicable to subscription invoices
        break;

      case 'checkout.session.completed':
        if (isConnectEvent) {
          // Business user's client completed a checkout (invoice payment, booking payment, etc.)
          await handleConnectCheckoutCompleted(event.data.object as Stripe.Checkout.Session, connectAccountId!, log);
        } else {
          // Platform checkout: boost packs (subscription sessions are denied by
          // the Business OS router above)
          await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, log);
        }
        break;

      // Platform subscriptions ONLY — this is the platform's own SaaS billing.
      //
      // These were the last money events not gated on `isConnectEvent`, and the
      // gap was a cross-tenant write. Both handlers key solely on
      // `subscription.metadata.user_id`, and on a Connect event that metadata is
      // written by the CONNECTED BUSINESS (subscriptions are created on
      // connected accounts by the Stripe plugin executor). So a business could
      // set `metadata.user_id` to another tenant's id and rewrite that tenant's
      // plan, credits and status — or cancel it outright.
      //
      // A connected account's own subscriptions are its business, not ours.
      case 'customer.subscription.created':
        if (!isConnectEvent) break;
        await handleConnectPlanSubscriptionCreated(
          event.data.object as Stripe.Subscription,
          connectAccountId!,
          log
        );
        break;

      case 'customer.subscription.updated':
        if (isConnectEvent) break;
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, log);
        break;

      case 'customer.subscription.deleted':
        if (isConnectEvent) {
          // A CLIENT's payment plan ending — either because it reached its last
          // period, or because someone stopped it from the Stripe dashboard.
          // Mirrored so the plan does not read `active` while nothing is being
          // charged, and so its remaining periods leave the books.
          await handlePlanSubscriptionEnded(
            event.data.object as Stripe.Subscription,
            connectAccountId!,
            log
          );
          break;
        }
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, log);
        break;

      // Refunds issued outside this app — from the Stripe dashboard, or by
      // Stripe itself. Handled for both platform and connected accounts:
      // wherever the charge lives, the ledger has to learn about it.
      case 'charge.refunded':
        await handleChargeRefunded(event.data.object as Stripe.Charge, connectAccountId, log);
        break;

      /*
       * Chargebacks. The funds leave the account on `created` and only come back
       * if the case is won, so all three phases are handled — recording the loss
       * and never recording a recovery would be its own kind of wrong.
       */
      case 'charge.dispute.created':
        await handleDispute(event.data.object as Stripe.Dispute, 'opened', log);
        break;

      case 'charge.dispute.closed':
        await handleDispute(event.data.object as Stripe.Dispute, 'closed', log);
        break;

      case 'charge.dispute.funds_reinstated':
        await handleDispute(event.data.object as Stripe.Dispute, 'reinstated', log);
        break;

      // A payment that succeeded without any invoice behind it — a website or
      // landing-page sale. Recorded here because the browser is not a reliable
      // reporter: `booking/finalize` runs client-side, so a customer who closes
      // the tab after paying leaves money in Stripe with no row at all.
      //
      // Connected accounts only. A platform payment_intent.succeeded belongs to
      // subscription billing, which is not this system's concern.
      case 'payment_intent.succeeded':
        if (isConnectEvent) {
          await handleConnectPaymentIntentSucceeded(
            event.data.object as Stripe.PaymentIntent,
            connectAccountId!,
            log
          );
        }
        break;

      default:
        log.info('Unhandled event type');
    }

    // Only now is it safe to suppress future deliveries of this event.
    await completeClaim(event.id);

    return NextResponse.json({ received: true });

  } catch (error: any) {
    log.error({ err: error }, 'Webhook processing failed');

    // Release the event so Stripe's retry can reprocess it. Without this the id
    // stays claimed and every retry is discarded as a duplicate — the failure
    // mode that lost real payments.
    //
    // `processedEventId` is null when we failed before claiming anything (bad
    // signature, malformed body), where there is nothing to release.
    if (processedEventId) {
      try {
        await supabaseAdmin
          .from('processed_webhook_events')
          .update({
            status: 'failed',
            failure_message: String(error?.message ?? error).slice(0, 500)
          })
          .eq('event_id', processedEventId);
      } catch (releaseError) {
        // Nothing further to do — the original failure is the one that matters,
        // and swallowing this keeps it from masking the real error.
        log.error({ err: releaseError, processedEventId }, 'Could not release failed event');
      }
    }

    // 5xx, not 400. Stripe retries on any non-2xx, but a 4xx says "this request
    // was malformed, sending it again will not help" — which is the opposite of
    // true when our own handler threw.
    //
    // The body never carries the internal message outside development (SA
    // P1-C5): the status is what Stripe acts on, and the message stays in the
    // log and in the claim row's failure_message.
    return NextResponse.json(
      {
        success: false,
        error: 'Webhook processing failed',
        details: process.env.NODE_ENV === 'development' ? String(error?.message ?? error) : undefined,
      },
      { status: 500 }
    );
  }
}
