/**
 * The Business OS plan subscription mirror (plan payments P-3b.2, workplan
 * §3.5; SA ruling Q-1): `customer.subscription.updated` / `.deleted` copy the
 * subscription's STATUS onto the billing record. Nothing else.
 *
 * Why it is in P-3b: once a subscription is linked, `isPlanSubscriptionLive`
 * says live until `ended_at` is set, so without this a cancelled account could
 * be neither deleted (AD R-3) nor sold a new plan (P-3a layer 1).
 *
 *   1  account   the billing row holding this subscription, in this mode (SR-8).
 *                None, or detached → `warn`, nothing written
 *   2  Stripe    the subscription read FRESH (SA Q-1), so the order events
 *                arrive in does not matter: the record always gets Stripe's
 *                latest state, whichever event delivers it
 *   3  metadata  `bos_user_id` on it present and not the row's account → `error`
 *                + alert, nothing written
 *   4  write     `subscription_status`, `cancel_at_period_end`, `ended_at`
 *                (Stripe's, else NULL), compare-and-set on the row still
 *                holding this subscription. Never `current_period_end`, the
 *                tier or the plan row: only a paid invoice moves those
 *
 *   5  ended     P-6a.2 (workplan §5.5; SA C-4): on `customer.subscription.deleted`
 *                ONLY (Stripe sends exactly one per subscription; X-4 showed no
 *                `.updated` to `canceled` before it), after a successful mirror:
 *                one `subscription_ended` money history row (unique on the
 *                event id, so a replay records nothing) and, when that row is
 *                new, one `BOS_BILLING_SUBSCRIPTION_ENDED` audit (`info`, C-10).
 *                A `.updated` that reads an ended subscription mirrors it and
 *                nothing more. No plan write, no entitlement invalidation: the
 *                lifecycle derives from the paid-through date (SA-P8)
 *
 * Otherwise no money history and no audit (Q-1); a pending downgrade is
 * P-7b's. A read or write failure throws (claim released, retried).
 *
 * @module lib/business-os/billing/planSubscriptionMirror
 */

import type Stripe from 'stripe';

import type { Logger } from '@/lib/logger';
import type { StripeService } from '@/lib/stripe/StripeService';
import type {
  BusinessOsBillingAccount,
  BusinessOsBillingAccountRepository,
  BusinessOsSubscriptionStatus,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';
import type { BusinessOsBillingEventRepository } from '@/lib/repositories/BusinessOsBillingEventRepository';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import type { RecordPlanChangeInput } from '@/lib/business-os/entitlements/recordPlanChange';
import { BOS_USER_ID_METADATA_KEY } from '@/lib/business-os/billing/stripeMetadataKeys';

export interface PlanSubscriptionMirrorDeps {
  billingAccounts: Pick<BusinessOsBillingAccountRepository, 'findByStripeSubscription' | 'mirrorSubscriptionState'>;
  /** P-6a.2: the `subscription_ended` money history row. */
  billingEvents: Pick<BusinessOsBillingEventRepository, 'recordEvent'>;
  stripe: () => Pick<StripeService, 'retrieveBusinessOsSubscription'>;
  /** P-6a.2: the `BOS_BILLING_SUBSCRIPTION_ENDED` audit, flushed bounded (PF-11). */
  recordPlanChange: (input: RecordPlanChangeInput) => Promise<void>;
  now: () => Date;
}

/** Stripe's `cancellation_details.reason` values worth recording; anything else is recorded as null. */
const CANCELLATION_REASONS: readonly string[] = ['payment_failed', 'cancellation_requested', 'payment_disputed'];

const SUBSCRIPTION_ID_PATTERN = /^sub_[A-Za-z0-9]{1,251}$/;
const SUBSCRIPTION_STATUSES: readonly BusinessOsSubscriptionStatus[] = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
];

/** `customer.subscription.updated` / `.deleted`: mirror the status, read fresh from Stripe. */
export async function mirrorPlanSubscription(event: Stripe.Event, log: Logger, deps: PlanSubscriptionMirrorDeps): Promise<void> {
  const embedded = event.data.object as Stripe.Subscription;
  const subscriptionId = embedded.id;
  const ids = { subscriptionId, livemode: event.livemode, stripeEventId: event.id, eventType: event.type };

  if (typeof subscriptionId !== 'string' || !SUBSCRIPTION_ID_PATTERN.test(subscriptionId)) {
    log.warn({ event: 'bos_billing_subscription_no_account', ...ids }, 'Business OS plan subscription event carries no usable id; nothing written');
    return;
  }

  const found = await deps.billingAccounts.findByStripeSubscription(subscriptionId, event.livemode);
  if (found.error) throw found.error;
  const account = found.data;
  if (!account || account.accountId === null) {
    log.warn(
      { event: 'bos_billing_subscription_no_account', ...ids },
      'Business OS plan subscription is on no billing record; nothing written'
    );
    return;
  }

  const fresh = await deps.stripe().retrieveBusinessOsSubscription(subscriptionId);
  const claim = fresh.metadata?.[BOS_USER_ID_METADATA_KEY];
  if (claim && claim !== account.accountId) {
    log.error(
      { event: 'bos_billing_subscription_metadata_mismatch', accountId: account.accountId, ...ids, alert: true },
      'Business OS plan subscription metadata names another account; nothing written'
    );
    return;
  }
  const status = SUBSCRIPTION_STATUSES.find((known) => known === fresh.status);
  if (!status) throw new Error('unknown_subscription_status');
  const endedAtIso = fresh.endedAt ? new Date(fresh.endedAt * 1000).toISOString() : null;

  const mirrored = await deps.billingAccounts.mirrorSubscriptionState({
    userId: account.accountId,
    livemode: account.livemode,
    stripeSubscriptionId: subscriptionId,
    status,
    cancelAtPeriodEnd: fresh.cancelAtPeriodEnd,
    endedAtIso,
    nowIso: deps.now().toISOString(),
  });
  if (mirrored.error || !mirrored.data) throw mirrored.error ?? new Error('subscription_mirror_failed');

  log.info(
    {
      event: mirrored.data.mirrored ? 'bos_billing_subscription_mirrored' : 'bos_billing_subscription_mirror_skipped',
      accountId: account.accountId,
      status,
      cancelAtPeriodEnd: fresh.cancelAtPeriodEnd,
      ended: endedAtIso !== null,
      ...ids,
    },
    mirrored.data.mirrored
      ? 'Business OS plan subscription status mirrored'
      : 'Billing record no longer holds this subscription; nothing written'
  );

  // C-4: the end is recorded from `.deleted` only, and only on the row that
  // still holds this subscription.
  if (event.type === 'customer.subscription.deleted' && mirrored.data.mirrored) {
    await recordSubscriptionEnded(event, embedded, account, endedAtIso, log, deps);
  }
}

/** P-6a.2 (§5.5, AC-F6.3): one `subscription_ended` row; one audit when it is new. Throws on a write failure (retried). */
async function recordSubscriptionEnded(
  event: Stripe.Event,
  embedded: Stripe.Subscription,
  account: BusinessOsBillingAccount,
  endedAtIso: string | null,
  log: Logger,
  deps: PlanSubscriptionMirrorDeps
): Promise<void> {
  // Our record names the account (SR-8); the seam canonicalises it.
  const accountId = resolveAccountId(account.accountId as string);
  const subscriptionId = embedded.id;
  const ids = { accountId, subscriptionId, livemode: event.livemode, stripeEventId: event.id };

  const recorded = await deps.billingEvents.recordEvent({
    accountId,
    livemode: event.livemode,
    kind: 'subscription_ended',
    stripeEventId: event.id,
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: account.stripeCustomerId,
    tier: account.boughtTier,
  });
  if (recorded.error || !recorded.data) throw recorded.error ?? new Error('subscription_ended_not_recorded');
  if (recorded.data.outcome === 'duplicate') {
    log.info({ event: 'bos_billing_subscription_ended_replayed', ...ids }, 'Business OS plan subscription end already recorded');
    return;
  }

  const rawReason = embedded.cancellation_details?.reason ?? null;
  const cancellationReason = typeof rawReason === 'string' && CANCELLATION_REASONS.includes(rawReason) ? rawReason : null;
  log.info(
    { event: 'bos_billing_subscription_ended', cancellationReason, ended: endedAtIso !== null, eventRowId: recorded.data.eventRowId, ...ids },
    'Business OS plan subscription ended and recorded'
  );
  await deps.recordPlanChange({
    accountId,
    action: 'BOS_BILLING_SUBSCRIPTION_ENDED',
    actor: { kind: 'system', source: 'stripe_webhook' },
    entityType: 'business_os_account_plan',
    entityId: accountId,
    changes: {},
    details: {
      subscriptionId,
      cancellationReason,
      endedAt: endedAtIso,
      livemode: event.livemode,
      stripeEventId: event.id,
      eventRowId: recorded.data.eventRowId,
    },
    severity: 'info',
    // The lifecycle derives from the paid-through date (SA-P8): nothing to invalidate.
    invalidatesEntitlements: false,
    log,
  });
}
