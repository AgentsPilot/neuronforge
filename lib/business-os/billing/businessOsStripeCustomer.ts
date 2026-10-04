/**
 * The Business OS Stripe customer of an account (plan payments P-2a, workplan
 * §3.6; reuse plan Q-T8 as refined by SA-P1; SA rulings Q-6, Q-11, P2-C3,
 * P2-C8).
 *
 * The Business OS half of the Q-T8 split: the shared Stripe-only
 * `StripeService.findOrCreatePlatformCustomer` does the Stripe call, and this
 * function persists the id in the Business OS billing record. It never reads
 * or writes `user_subscriptions` (RD-2), so a person who also paid on the agent
 * platform gets a second Stripe customer, which SA-P1 accepted.
 *
 * NO ROUTE CALLS THIS IN P-2a. P-3a wires it into the plan checkout and must
 * pass `userId` AND `email` from the session, never from the request body
 * (SA Q-11).
 *
 * Behaviour:
 * - a billing row for (account, current mode) exists → its customer id, with
 *   no Stripe call. The row is trusted: there is no retrieve (SA Q-6; a
 *   customer deleted at Stripe is handled in P-3a by a compare-and-set replace);
 * - otherwise one Stripe create with Business OS metadata (`product`,
 *   `bos_user_id`; never `user_id`, C-3) and the idempotency key
 *   `bos-customer:<userId>` (Stripe keys are already separate per mode), then
 *   the row is recorded with the mode Stripe reported;
 * - a lost race (the row appeared meanwhile) returns the stored id;
 * - a mode disagreement between the server key and the customer Stripe
 *   returned, including a `null` livemode, throws and records nothing (PF-15,
 *   P2-C3);
 * - any Stripe error, an `idempotency_error` included (same key, different
 *   email or name within 24 h), rejects and records nothing (P2-C8);
 * - a failed read of the billing row rejects before any Stripe call, so an
 *   unreadable record never leads to a second customer.
 *
 * @module lib/business-os/billing/businessOsStripeCustomer
 */

import { createLogger } from '@/lib/logger';
import { getStripeService, type StripeService } from '@/lib/stripe/StripeService';
import {
  businessOsBillingAccountRepository,
  type BusinessOsBillingAccountRepository,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';
import {
  BOS_PLAN_PRODUCT_MARKER,
  BOS_PRODUCT_METADATA_KEY,
  BOS_USER_ID_METADATA_KEY,
} from '@/lib/business-os/billing/stripeMetadataKeys';
import { currentStripeMode, isLiveMode, type StripeMode } from '@/lib/business-os/billing/stripeMode';

const logger = createLogger({ module: 'BusinessOsStripeCustomer' });

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Stripe idempotency key of an account's Business OS customer. */
export function businessOsCustomerIdempotencyKey(userId: string): string {
  return `bos-customer:${userId}`;
}

export type BusinessOsStripeCustomerFailure =
  | 'invalid_input'
  | 'billing_row_unreadable'
  | 'stripe_mode_mismatch'
  | 'billing_row_not_recorded';

export class BusinessOsStripeCustomerError extends Error {
  readonly reason: BusinessOsStripeCustomerFailure;

  constructor(reason: BusinessOsStripeCustomerFailure) {
    super(reason);
    this.name = 'BusinessOsStripeCustomerError';
    this.reason = reason;
  }
}

export interface EnsureBusinessOsStripeCustomerDeps {
  repo?: Pick<BusinessOsBillingAccountRepository, 'findByUser' | 'recordCustomer'>;
  stripe?: Pick<StripeService, 'findOrCreatePlatformCustomer'>;
  mode?: () => StripeMode;
}

export async function ensureBusinessOsStripeCustomer(
  input: { userId: string; email: string; name?: string },
  deps: EnsureBusinessOsStripeCustomerDeps = {}
): Promise<{ customerId: string; created: boolean }> {
  const { userId, email, name } = input;
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId) || typeof email !== 'string' || email.trim() === '') {
    throw new BusinessOsStripeCustomerError('invalid_input');
  }

  const repo = deps.repo ?? businessOsBillingAccountRepository;
  // Throws on a missing or unrecognised key: no mode, no customer.
  const mode = (deps.mode ?? currentStripeMode)();
  const livemode = isLiveMode(mode);

  const existing = await repo.findByUser(userId, livemode);
  if (existing.error) {
    logger.error({ err: existing.error, userId, livemode }, 'Business OS billing row unreadable; no Stripe customer created');
    throw new BusinessOsStripeCustomerError('billing_row_unreadable');
  }
  if (existing.data) {
    return { customerId: existing.data.stripeCustomerId, created: false };
  }

  const stripe = deps.stripe ?? getStripeService();
  let customer: { customerId: string; created: boolean; livemode: boolean | null };
  try {
    customer = await stripe.findOrCreatePlatformCustomer({
      email,
      name,
      metadata: {
        [BOS_PRODUCT_METADATA_KEY]: BOS_PLAN_PRODUCT_MARKER,
        [BOS_USER_ID_METADATA_KEY]: userId,
      },
      idempotencyKey: businessOsCustomerIdempotencyKey(userId),
    });
  } catch (err) {
    // An idempotency_error lands here too (P2-C8). No email or name in the log.
    const stripeErrorType =
      typeof err === 'object' && err !== null && 'type' in err && typeof (err as { type?: unknown }).type === 'string'
        ? (err as { type: string }).type
        : undefined;
    logger.error({ err, userId, livemode, stripeErrorType }, 'Stripe customer create failed; nothing recorded');
    throw err;
  }

  // `null` (a reused deleted customer) is a disagreement too: never guess a mode (P2-C3).
  if (customer.livemode !== livemode) {
    logger.error(
      { userId, expectedLivemode: livemode, stripeLivemode: customer.livemode, stripeCustomerId: customer.customerId, alert: true },
      'Stripe customer mode disagrees with the server key; nothing recorded'
    );
    throw new BusinessOsStripeCustomerError('stripe_mode_mismatch');
  }

  const recorded = await repo.recordCustomer({ userId, livemode, stripeCustomerId: customer.customerId });
  if (recorded.error || !recorded.data) {
    logger.error(
      { err: recorded.error, userId, livemode, stripeCustomerId: customer.customerId },
      'Business OS billing row not recorded'
    );
    throw new BusinessOsStripeCustomerError('billing_row_not_recorded');
  }

  return {
    customerId: recorded.data.account.stripeCustomerId,
    created: recorded.data.created && customer.created,
  };
}
