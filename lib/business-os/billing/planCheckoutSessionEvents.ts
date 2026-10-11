/**
 * Business OS plan checkout sessions from the webhook (plan payments P-3b.2,
 * workplan §3.5; P-3a SA Q-1): `checkout.session.completed` links the
 * subscription and clears the checkout lock, `checkout.session.expired` clears
 * the lock.
 *
 * Runs inside the `plan` flow handler, after the router recognised the
 * session's PRICE and after the handler checked the event's mode (PF-15).
 *
 *   1  account   the billing row holding the session's customer, in this mode
 *                (SR-8). None, or detached → `warn`, nothing written (not money,
 *                so no money-history row)
 *   2  metadata  `bos_user_id` present and not the row's account → `error` +
 *                alert, nothing written (a cross-check: metadata never chooses)
 *   3  write     compare-and-set on THIS session's lock (`open_checkout_session_id
 *                = session.id`), so another checkout's lock is never cleared:
 *                completed, row with no subscription → link + clear;
 *                completed, row with this subscription → clear;
 *                completed, row with ANOTHER subscription → clear, `warn`, and
 *                the link is left to `invoice.paid` (SA-P14 layer 2 decides);
 *                expired → clear.
 *                A count of 0 is a replay or a lock already gone: `info`.
 *
 * No plan write, no money history, no audit: the payment is `invoice.paid`'s.
 * A read or write failure throws (the claim is released, Stripe retries).
 *
 * @module lib/business-os/billing/planCheckoutSessionEvents
 */

import type Stripe from 'stripe';

import type { Logger } from '@/lib/logger';
import type {
  BusinessOsBillingAccount,
  BusinessOsBillingAccountRepository,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';
import { BOS_USER_ID_METADATA_KEY } from '@/lib/business-os/billing/stripeMetadataKeys';

export interface PlanCheckoutSessionDeps {
  billingAccounts: Pick<
    BusinessOsBillingAccountRepository,
    'findByStripeCustomer' | 'linkCheckoutSession' | 'releaseCheckoutLock'
  >;
  now: () => Date;
}

const CUSTOMER_ID_PATTERN = /^cus_[A-Za-z0-9]{1,251}$/;

function idOf(ref: string | { id?: string | null } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id ?? null;
}

/** The account the session belongs to, or null after logging why nothing is written. */
async function sessionAccount(
  deps: PlanCheckoutSessionDeps,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  log: Logger
): Promise<BusinessOsBillingAccount | null> {
  const customerId = idOf(session.customer as string | { id?: string } | null);
  const ids = { sessionId: session.id, customerId, livemode: event.livemode, stripeEventId: event.id };

  if (!customerId || !CUSTOMER_ID_PATTERN.test(customerId)) {
    log.warn({ event: 'bos_billing_session_no_account', ...ids }, 'Business OS plan session names no customer; nothing written');
    return null;
  }
  const found = await deps.billingAccounts.findByStripeCustomer(customerId, event.livemode);
  if (found.error) throw found.error;
  if (!found.data || found.data.accountId === null) {
    log.warn({ event: 'bos_billing_session_no_account', ...ids }, 'Business OS plan session customer has no billing record; nothing written');
    return null;
  }

  const claim = session.metadata?.[BOS_USER_ID_METADATA_KEY];
  if (claim && claim !== found.data.accountId) {
    log.error(
      { event: 'bos_billing_session_metadata_mismatch', accountId: found.data.accountId, ...ids, alert: true },
      'Business OS plan session metadata names another account; nothing written'
    );
    return null;
  }
  return found.data;
}

async function release(
  deps: PlanCheckoutSessionDeps,
  account: BusinessOsBillingAccount,
  session: Stripe.Checkout.Session,
  log: Logger,
  ids: Record<string, unknown>
): Promise<void> {
  const released = await deps.billingAccounts.releaseCheckoutLock({
    userId: account.accountId as string,
    livemode: account.livemode,
    sessionId: session.id,
    nowIso: deps.now().toISOString(),
  });
  if (released.error || !released.data) throw released.error ?? new Error('checkout_lock_release_failed');
  log.info(
    { event: released.data.released ? 'bos_billing_checkout_lock_cleared' : 'bos_billing_checkout_lock_already_clear', ...ids },
    released.data.released ? 'Business OS checkout lock cleared' : 'Business OS checkout lock was not this session (or already clear)'
  );
}

/** `checkout.session.completed`: link the subscription and clear the lock. */
export async function onPlanCheckoutSessionCompleted(event: Stripe.Event, log: Logger, deps: PlanCheckoutSessionDeps): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const account = await sessionAccount(deps, event, session, log);
  if (!account) return;

  const subscriptionId = idOf(session.subscription as string | { id?: string } | null);
  const ids = { accountId: account.accountId, sessionId: session.id, subscriptionId, livemode: event.livemode, stripeEventId: event.id };

  if (subscriptionId === null) {
    log.warn({ event: 'bos_billing_session_without_subscription', ...ids }, 'Completed plan session carries no subscription; clearing the lock only');
    await release(deps, account, session, log, ids);
    return;
  }

  if (account.stripeSubscriptionId !== null && account.stripeSubscriptionId !== subscriptionId) {
    // Another subscription is on the record: never overwritten here.
    // `invoice.paid` links it or refuses it (SA-P14 layer 2).
    log.warn(
      { event: 'bos_billing_checkout_other_subscription', heldSubscriptionId: account.stripeSubscriptionId, ...ids },
      'Billing record holds another subscription; lock cleared, link left to the paid invoice'
    );
    await release(deps, account, session, log, ids);
    return;
  }

  if (account.stripeSubscriptionId === null) {
    const linked = await deps.billingAccounts.linkCheckoutSession({
      userId: account.accountId as string,
      livemode: account.livemode,
      sessionId: session.id,
      stripeSubscriptionId: subscriptionId,
      nowIso: deps.now().toISOString(),
    });
    if (linked.error) {
      if (linked.error.message !== 'stripe_subscription_held_by_another_account') throw linked.error;
      // The repository alerted. The lock is still this account's to clear.
      await release(deps, account, session, log, ids);
      return;
    }
    if (linked.data?.linked) {
      log.info({ event: 'bos_billing_checkout_linked', ...ids }, 'Business OS checkout linked its subscription and cleared the lock');
      return;
    }
  }

  // Already linked (a replay, or the paid invoice came first): clear the lock alone.
  await release(deps, account, session, log, ids);
}

/** `checkout.session.expired`: clear this session's lock, never another's. */
export async function onPlanCheckoutSessionExpired(event: Stripe.Event, log: Logger, deps: PlanCheckoutSessionDeps): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const account = await sessionAccount(deps, event, session, log);
  if (!account) return;
  await release(deps, account, session, log, {
    accountId: account.accountId,
    sessionId: session.id,
    livemode: event.livemode,
    stripeEventId: event.id,
  });
}
