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
 * No money history, no audit (Q-1). Everything else these events mean
 * (pending downgrade, failed attempts, the "ended" history and audit) is
 * P-6a / P-7b's. A read or write failure throws (claim released, retried).
 *
 * @module lib/business-os/billing/planSubscriptionMirror
 */

import type Stripe from 'stripe';

import type { Logger } from '@/lib/logger';
import type { StripeService } from '@/lib/stripe/StripeService';
import type {
  BusinessOsBillingAccountRepository,
  BusinessOsSubscriptionStatus,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';
import { BOS_USER_ID_METADATA_KEY } from '@/lib/business-os/billing/stripeMetadataKeys';

export interface PlanSubscriptionMirrorDeps {
  billingAccounts: Pick<BusinessOsBillingAccountRepository, 'findByStripeSubscription' | 'mirrorSubscriptionState'>;
  stripe: () => Pick<StripeService, 'retrieveBusinessOsSubscription'>;
  now: () => Date;
}

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
}
