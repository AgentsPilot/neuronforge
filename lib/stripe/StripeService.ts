// lib/stripe/StripeService.ts
// Stripe service: platform customers, the agent platform's subscription
// lifecycle, and Stripe Connect.

import Stripe from 'stripe';
import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import {
  BOS_PLAN_PRODUCT_MARKER,
  BOS_PRODUCT_METADATA_KEY,
  BOS_USER_ID_METADATA_KEY,
} from '@/lib/business-os/billing/stripeMetadataKeys';
import { subscriptionIdFromInvoice } from '@/lib/payments/invoiceSubscription';
import { invoiceLinePriceIds } from '@/lib/payments/invoiceLinePrices';
import type { PortalConfigurationFacts } from '@/lib/business-os/billing/portalConfiguration';

const logger = createLogger({ module: 'StripeService' });

// ── Business OS plan upgrade facts (plan payments P-7b.1a, workplan §3.3) ──

/** One subscription item, as the upgrade routes and the U-4 guard read it. */
export interface BusinessOsSubscriptionItemFacts {
  id: string;
  priceId: string | null;
  /** Unix seconds. On `2025-10-29.clover` the period lives on the item (SA V-8). */
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
}

/** Stripe's pending update on a subscription: when it expires and the prices it would set. */
export interface BusinessOsPendingUpdateFacts {
  expiresAt: number;
  priceIds: string[];
}

/**
 * The payment state of an upgrade invoice. `none`: no payment Stripe reports
 * a usable state for (the orchestration treats it as "outcome unknown").
 */
export type BusinessOsUpgradePaymentState = 'succeeded' | 'requires_action' | 'requires_payment_method' | 'processing' | 'none';

export interface BusinessOsUpgradePreviewFacts {
  amountDueMinor: number;
  totalMinor: number;
  /** SA V-12: Stripe's tax on the preview (0 while no tax is collected). */
  taxMinor: number;
  currency: string;
}

export interface BusinessOsUpgradeFacts {
  subscriptionId: string;
  livemode: boolean;
  pendingUpdate: boolean;
  pendingUpdateExpiresAt: number | null;
  invoiceId: string | null;
  invoiceStatus: string | null;
  paymentState: BusinessOsUpgradePaymentState;
  /** For the owner's browser only (SA V-1). Never logged, audited or put in an error. */
  confirmationClientSecret: string | null;
}

export interface BusinessOsUpgradeInvoiceFacts {
  invoiceId: string;
  subscriptionId: string | null;
  customerId: string | null;
  status: string | null;
  billingReason: string | null;
  amountDueMinor: number | null;
  livemode: boolean;
  paymentState: BusinessOsUpgradePaymentState;
  /** For the owner's browser only (SA V-1). Never logged, audited or put in an error. */
  confirmationClientSecret: string | null;
}

/** P-7a.1 (SA C-2): a subscription after a cancel / reactivate write, in the mirror's terms. Unix seconds. */
export interface BusinessOsCancelFacts {
  id: string;
  status: Stripe.Subscription.Status;
  customerId: string | null;
  livemode: boolean;
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null;
  endedAt: number | null;
  /** The latest item period end (clover: the period is on the items). */
  currentPeriodEnd: number | null;
}

/** P-7a.2 (X-5): the portal locales the app sends. `he` is not one Stripe accepts; the caller sends `auto`. */
export type BusinessOsPortalLocale = 'en' | 'es' | 'auto';

/** P-7a.2: a portal session. `url` is a bearer link: never logged, audited or put in an error. */
export interface BusinessOsPortalSessionFacts {
  url: string;
  customerId: string;
  configurationId: string | null;
  livemode: boolean;
}

/** P-7a.2 (TQ-6): one invoice of the owner's list, as Stripe reports it. Unix seconds. */
export interface BusinessOsInvoiceListFacts {
  id: string;
  customerId: string | null;
  livemode: boolean;
  status: string | null;
  billingReason: string | null;
  totalMinor: number | null;
  currency: string | null;
  created: number | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  /** From the embedded lines (`invoiceLinePriceIds`); may be truncated, used for the plan label only. */
  priceIds: string[];
}

/** SA U-1: the idempotency key of one upgrade request. Same request, same key. */
export function businessOsUpgradeIdempotencyKey(subscriptionId: string, priceId: string, prorationDate: number): string {
  return `bos-upgrade:${subscriptionId}:${priceId}:${prorationDate}`;
}

/**
 * A Stripe error reduced to what an operator needs (SA V-1 / F-1). A Stripe
 * error can carry the PaymentIntent, client secret included, so the object
 * itself is never logged.
 */
function safeStripeErrorFields(err: unknown): Record<string, unknown> {
  if (typeof err !== 'object' || err === null) return { kind: typeof err };
  const e = err as { type?: unknown; code?: unknown; statusCode?: unknown; requestId?: unknown; name?: unknown };
  return {
    name: typeof e.name === 'string' ? e.name : null,
    type: typeof e.type === 'string' ? e.type : null,
    code: typeof e.code === 'string' ? e.code : null,
    statusCode: typeof e.statusCode === 'number' ? e.statusCode : null,
    requestId: typeof e.requestId === 'string' ? e.requestId : null,
  };
}

function refId(ref:string | { id?: string | null } | null | undefined): string | null {
  if (!ref) return null;
  if (typeof ref === 'string') return ref;
  return ref.id ?? null;
}

function isWholeMinor(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function unixOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function subscriptionItemFacts(item: Stripe.SubscriptionItem): BusinessOsSubscriptionItemFacts {
  return {
    id: item.id,
    priceId: item.price?.id ?? null,
    currentPeriodStart: unixOrNull(item.current_period_start),
    currentPeriodEnd: unixOrNull(item.current_period_end),
  };
}

function pendingUpdateFacts(pending: Stripe.Subscription.PendingUpdate | null | undefined): BusinessOsPendingUpdateFacts | null {
  if (!pending) return null;
  const priceIds: string[] = [];
  for (const item of pending.subscription_items ?? []) {
    const id = item.price?.id;
    if (id && !priceIds.includes(id)) priceIds.push(id);
  }
  return { expiresAt: pending.expires_at, priceIds };
}

/** Sum of the Basil `total_taxes[].amount`, 0 when absent; null when unreadable. */
function invoiceTaxMinor(invoice: Stripe.Invoice): number | null {
  const taxes = (invoice as unknown as { total_taxes?: Array<{ amount?: unknown }> | null }).total_taxes;
  if (taxes === undefined || taxes === null) return 0;
  let sum = 0;
  for (const entry of taxes) {
    if (!isWholeMinor(entry?.amount)) return null;
    sum += entry.amount;
  }
  return sum;
}

/**
 * The payment state from an invoice's payments (pure). The default payment
 * (`is_default`), else the first; its PaymentIntent's status decides. A
 * PaymentIntent that was not expanded tells nothing: `none`.
 */
export function upgradePaymentStateOf(payments: ReadonlyArray<Stripe.InvoicePayment>): BusinessOsUpgradePaymentState {
  const chosen = payments.find((payment) => payment.is_default) ?? payments[0];
  const intent = chosen?.payment?.payment_intent;
  if (!intent || typeof intent === 'string') return 'none';
  switch (intent.status) {
    case 'succeeded':
      return 'succeeded';
    case 'requires_action':
      return 'requires_action';
    case 'requires_payment_method':
      return 'requires_payment_method';
    case 'processing':
    case 'requires_capture':
      return 'processing';
    default:
      return 'none';
  }
}

/**
 * StripeService
 *
 * Handles Stripe operations for the platform:
 * - Platform customers (agent platform and Business OS)
 * - Agent-platform subscription lifecycle: portal, cancel, reactivate, invoices
 * - Webhook signature verification
 * - Stripe Connect accounts for Business OS client payments
 *
 * Plan payments P-10 removed the Pilot-Credit purchase side
 * (`createCustomCreditSubscription`, `updateSubscriptionAmount`): both minted
 * ad-hoc prices and had no caller left (reuse plan §4.6 *Dies*, L-9). The
 * boost-pack checkout is switched off but kept (Credits Boost FR-40).
 */
export class StripeService {
  private stripe: Stripe;
  /**
   * Plan payments P-6a.1 (SA C-5): whether the key is a TEST-mode key. Only the
   * mode is kept, never the key. The test-clock methods refuse anything else
   * themselves, before any Stripe call (defence in depth behind the route).
   */
  private readonly isTestModeKey: boolean;

  constructor(stripeSecretKey: string) {
    if (!stripeSecretKey) {
      throw new Error('Stripe secret key is required');
    }
    this.isTestModeKey = stripeSecretKey.startsWith('sk_test_') || stripeSecretKey.startsWith('rk_test_');
    this.stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2025-10-29.clover'
    });
  }

  /**
   * Find or create a Stripe customer. Shared by the agent platform and
   * Business OS (plan payments P-2a, reuse plan Q-T8).
   *
   * Stripe only: no database access and no product-specific side effect. Each
   * product persists the returned id in its own record (agent platform:
   * `user_subscriptions`; Business OS: `business_os_billing_accounts`).
   *
   * Semantics are exactly the ones `getOrCreateCustomer` always had, so the
   * agent platform does not change (characterisation suite
   * `lib/stripe/__tests__/getOrCreateCustomer.characterisation.test.ts`):
   * - with `existingCustomerId`, the customer is retrieved; if the call
   *   resolves the id is reused, INCLUDING a customer deleted at Stripe
   *   (`{ deleted: true }`), a kept quirk (SA ruling Q-6);
   * - if the retrieve throws, it warns and falls through to create;
   * - otherwise it creates with exactly `{ email, name, metadata }`, and passes
   *   request options only when an idempotency key is given (the agent
   *   platform passes none: adding one would change its behaviour).
   *
   * `livemode` is `null` for a reused deleted customer: Stripe's
   * `DeletedCustomer` has no `livemode` field (SA P2-C3).
   *
   * Deliberately placed above `getOrCreateCustomer` and takes no database
   * client: the user_subscriptions lockdown guard reads the slice from
   * `getOrCreateCustomer` to `createBoostPackCheckout`, and only two methods
   * of this class may take one.
   */
  async findOrCreatePlatformCustomer(params: {
    existingCustomerId?: string | null;
    email: string;
    name?: string;
    metadata: Record<string, string>;
    idempotencyKey?: string;
  }): Promise<{ customerId: string; created: boolean; livemode: boolean | null }> {
    const { existingCustomerId, email, name, metadata, idempotencyKey } = params;

    if (existingCustomerId) {
      // Verify customer exists in Stripe
      try {
        const retrieved = await this.stripe.customers.retrieve(existingCustomerId);
        return {
          customerId: existingCustomerId,
          created: false,
          livemode: retrieved.deleted ? null : retrieved.livemode,
        };
      } catch (error) {
        logger.warn({ err: error, customerId: existingCustomerId }, 'Stripe customer not found, creating a new one');
        // Fall through to create new customer
      }
    }

    // Create new Stripe customer. The two-argument form only with a key, so a
    // call without one is exactly the call the agent platform always made.
    const customer = idempotencyKey
      ? await this.stripe.customers.create({ email, name, metadata }, { idempotencyKey })
      : await this.stripe.customers.create({ email, name, metadata });

    return { customerId: customer.id, created: true, livemode: customer.livemode };
  }

  /**
   * Get or create Stripe customer for user (agent platform).
   *
   * The Stripe half lives in `findOrCreatePlatformCustomer`; this caller keeps
   * the `user_subscriptions` read and seed, with the statements unchanged (Q-T8).
   */
  async getOrCreateCustomer(
    supabase: SupabaseClient,
    userId: string,
    email: string,
    name?: string
  ): Promise<string> {
    // Check if customer already exists in our database
    const { data: userSub } = await supabase
      .from('user_subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    // No idempotency key: the agent platform never sent one.
    const found = await this.findOrCreatePlatformCustomer({
      existingCustomerId: userSub?.stripe_customer_id,
      email,
      name,
      metadata: {
        user_id: userId
      }
    });

    if (!found.created) {
      return found.customerId;
    }

    // Named `customer` so the user_subscriptions statements below stay as they were.
    const customer = { id: found.customerId };

    // Update our database - only update stripe_customer_id on existing rows
    const { data: existing } = await supabase
      .from('user_subscriptions')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (existing) {
      // Update existing subscription with new customer ID
      await supabase
        .from('user_subscriptions')
        .update({ stripe_customer_id: customer.id })
        .eq('user_id', userId);
    } else {
      // Insert new subscription row with minimum required fields
      await supabase
        .from('user_subscriptions')
        .insert({
          user_id: userId,
          stripe_customer_id: customer.id,
          monthly_amount_usd: 10.00,
          monthly_credits: 20833
        });
    }

    return customer.id;
  }

  /**
   * Create one-time boost pack purchase
   *
   * NO CALLER since plan payments P-10. The AgentsPilot boost purchase is
   * switched off, not deleted (Credits Boost FR-40, user decision Q14):
   * `create-checkout` refuses every purchase with 410. This method, the
   * webhook's `boost_pack` branch and the `boost_packs` /
   * `boost_pack_purchases` tables are kept so the purchase can be revived.
   * Deleting any of them needs an SA-approved plan. A revival must pass the
   * service-role client (W-4) and add back a reviewed caller to the
   * user_subscriptions lockdown guard.
   */
  async createBoostPackCheckout(params: {
    supabase: SupabaseClient;
    userId: string;
    email: string;
    name?: string;
    boostPackId: string;
    successUrl: string;
    cancelUrl: string;
    currency?: string; // Optional currency code (defaults to USD)
  }): Promise<Stripe.Checkout.Session> {
    const {
      supabase,
      userId,
      email,
      name,
      boostPackId,
      successUrl,
      currency = 'usd' // Default to USD if not specified
    } = params;

    // Get boost pack details
    const { data: boostPack, error } = await supabase
      .from('boost_packs')
      .select('*')
      .eq('id', boostPackId)
      .single();

    if (error || !boostPack) {
      throw new Error('Boost pack not found');
    }

    // Use pre-calculated credits from database (no runtime calculation!)
    // Admin has already calculated and stored the correct values
    const totalCredits = boostPack.credits_amount + (boostPack.bonus_credits || 0);

    // Get or create customer
    const customerId = await this.getOrCreateCustomer(supabase, userId, email, name);

    // Normalize currency code to lowercase for Stripe
    const stripeCurrency = currency.toLowerCase();

    // Create checkout session for one-time payment with embedded UI support
    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: stripeCurrency,
            unit_amount: Math.round(boostPack.price_usd * 100), // Convert to cents (or smallest currency unit)
            product_data: {
              name: boostPack.pack_name,
              description: `${totalCredits.toLocaleString()} Pilot Credits${boostPack.bonus_credits ? ` (includes ${boostPack.bonus_credits.toLocaleString()} bonus)` : ''}`,
              metadata: {
                boost_pack_id: boostPackId,
                credits: totalCredits.toString(),
                bonus_credits: (boostPack.bonus_credits || 0).toString()
              }
            }
          },
          quantity: 1
        }
      ],
      ui_mode: 'embedded', // Enable embedded checkout
      return_url: successUrl, // Fallback URL (won't be used with onComplete callback)
      metadata: {
        user_id: userId,
        boost_pack_id: boostPackId,
        credits: totalCredits.toString(),
        purchase_type: 'boost_pack'
      }
    });

    return session;
  }

  // ── Business OS plan checkout (plan payments P-3a, workplan §3.4) ─────────
  // Four Stripe-only methods: no database client, no product record. They sit
  // AFTER `createBoostPackCheckout`, outside the slice the user_subscriptions
  // lockdown guard reads, and none of them accepts a client.

  /**
   * The prices behind some lookup keys, in one call (at most ten keys, Stripe's
   * limit for `lookup_keys`). No `active` filter: an archived price must surface
   * and fail the runtime price check rather than silently disappear (SA-P12 b).
   */
  async listPricesByLookupKeys(lookupKeys: readonly string[]): Promise<Stripe.Price[]> {
    if (lookupKeys.length === 0 || lookupKeys.length > 10) {
      throw new Error('listPricesByLookupKeys takes between one and ten lookup keys');
    }
    const page = await this.stripe.prices.list({ lookup_keys: [...lookupKeys], limit: 10 });
    return page.data;
  }

  /**
   * Every subscription of a customer, in any status, for the Business OS
   * checkout's live-subscription check (SA-P14 layer 1b, SA Q-5, C-2).
   *
   * Pages through ALL of them (100 per page), so a live subscription behind
   * cancelled ones is never missed. Stops after `maxPages`; `complete: false`
   * then tells the caller the answer may be partial, and the caller fails closed.
   */
  async listCustomerSubscriptions(
    customerId: string,
    options: { maxPages?: number } = {}
  ): Promise<{ subscriptions: Array<{ id: string; status: Stripe.Subscription.Status }>; complete: boolean }> {
    const maxPages = options.maxPages ?? 10;
    const subscriptions: Array<{ id: string; status: Stripe.Subscription.Status }> = [];
    let startingAfter: string | undefined;

    for (let page = 0; page < maxPages; page += 1) {
      const result = await this.stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const subscription of result.data) subscriptions.push({ id: subscription.id, status: subscription.status });
      if (!result.has_more) return { subscriptions, complete: true };
      // "More" with nothing on the page: no cursor to go on with. Fail closed
      // through this method's own contract (`complete: false`), which the
      // checkout already refuses as `subscription_check_incomplete` (503). A
      // throw here would surface as `stripe_error` (502) instead.
      if (result.data.length === 0) return { subscriptions, complete: false };
      startingAfter = result.data[result.data.length - 1].id;
    }
    return { subscriptions, complete: false };
  }

  /**
   * Open an EMBEDDED Stripe subscription checkout for one Business OS plan
   * price (SA-P8 card only, SA-P15 Adaptive Pricing off, SA-P14 expiry and
   * idempotency key, SA-P2 no anchor or proration parameters).
   *
   * The metadata is built HERE from the shared Business OS keys and nothing
   * else, so no caller can add a legacy Pilot-Credit key, which the
   * agent-platform webhook handlers still act on (CF-4, C-3). No `currency`
   * parameter: the price's own currency (USD, checked by the caller) is the
   * only one.
   *
   * `expiresAt` is a unix time in seconds the caller chose (P-3a C-1:
   * now + 31 minutes, since Stripe refuses less than 30 measured at its side).
   * The returned `expiresAt` is Stripe's, which is what the caller records.
   */
  async createBusinessOsPlanCheckoutSession(params: {
    customerId: string;
    priceId: string;
    bosUserId: string;
    returnUrl: string;
    expiresAt: number;
    idempotencyKey: string;
  }): Promise<{ sessionId: string; clientSecret: string; expiresAt: number; livemode: boolean }> {
    const { customerId, priceId, bosUserId, returnUrl, expiresAt, idempotencyKey } = params;
    const metadata = {
      [BOS_PRODUCT_METADATA_KEY]: BOS_PLAN_PRODUCT_MARKER,
      [BOS_USER_ID_METADATA_KEY]: bosUserId,
    };

    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        ui_mode: 'embedded',
        return_url: returnUrl,
        redirect_on_completion: 'if_required',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        payment_method_types: ['card'],
        adaptive_pricing: { enabled: false },
        expires_at: expiresAt,
        metadata,
        subscription_data: { metadata },
      },
      { idempotencyKey }
    );

    if (!session.client_secret) {
      // An embedded session always carries one; without it nobody can pay.
      throw new Error('Stripe returned an embedded checkout session without a client secret');
    }
    return {
      sessionId: session.id,
      clientSecret: session.client_secret,
      expiresAt: session.expires_at,
      livemode: session.livemode,
    };
  }

  /** Expire an open checkout session, so it can no longer be paid. */
  async expireCheckoutSession(sessionId: string): Promise<void> {
    await this.stripe.checkout.sessions.expire(sessionId);
  }

  /**
   * The state of one checkout session, for plan payments P-4.1 M-3 (replace
   * the account's own open checkout). Returns three facts and nothing else:
   * the raw Stripe object carries the client secret, so it is never returned
   * or logged (SA W-4 b). The caller passes only the session id stored on the
   * account's own billing row, never a request value.
   */
  async retrieveCheckoutSessionState(
    sessionId: string
  ): Promise<{ status: 'open' | 'complete' | 'expired' | null; customerId: string | null; livemode: boolean }> {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    const customer = session.customer;
    return {
      status: session.status,
      customerId: typeof customer === 'string' ? customer : customer?.id ?? null,
      livemode: session.livemode,
    };
  }

  // ── Business OS plan webhook reads (plan payments P-3b.2, workplan §3.1, §3.6) ──
  // Three Stripe-only READS for the plan webhook handler and router: no database
  // client, no product record, no write of any kind. Each pages to the end, and
  // gives up (throws) after `maxPages` rather than answer with a partial list:
  // the webhook treats a throw as "could not tell", releases the claim and
  // Stripe retries, whereas a partial list could decide a payment wrongly.

  /**
   * One subscription, fresh, in the shape the plan handler reads (§3.7):
   * status, `billing_cycle_anchor`, `cancel_at_period_end`, `ended_at`, the
   * customer, the metadata and EVERY item price (paged when the embedded item
   * list says `has_more`). Unix seconds are returned as Stripe gives them.
   *
   * P-7b.1a (workplan §3.3 a, SA design point "items not de-duplicated"):
   * additive fields for the upgrade routes and the U-4 guard. `items` is the
   * COMPLETE item list from the same paged read (never de-duplicated, so
   * "exactly one item" is decided on its length), each with its period: on
   * `2025-10-29.clover` the current period lives on the ITEM, not the
   * subscription (SA V-8). `pendingUpdate` is Stripe's pending update (its
   * expiry and the prices it would set), `latestInvoiceId` the invoice it
   * waits on. `priceIds` stays de-duplicated for its existing callers.
   */
  async retrieveBusinessOsSubscription(
    subscriptionId: string,
    options: { maxPages?: number } = {}
  ): Promise<{
    id: string;
    status: Stripe.Subscription.Status;
    customerId: string | null;
    billingCycleAnchor: number;
    cancelAtPeriodEnd: boolean;
    /**
     * P-7a.1 (SA C-3, X-2): Stripe's `cancel_at`, unix seconds. Set together
     * with `cancel_at_period_end`, and ALONE when a cancellation date is set
     * without the flag (`cancel_at`, as the dashboard may). Optional only so
     * existing hand-built fakes stay valid; absent reads as null.
     */
    cancelAt?: number | null;
    endedAt: number | null;
    livemode: boolean;
    metadata: Stripe.Metadata;
    priceIds: string[];
    items: BusinessOsSubscriptionItemFacts[];
    pendingUpdate: BusinessOsPendingUpdateFacts | null;
    latestInvoiceId: string | null;
  }> {
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    const priceIds: string[] = [];
    const items: BusinessOsSubscriptionItemFacts[] = [];
    const add = (page: ReadonlyArray<Stripe.SubscriptionItem>) => {
      for (const item of page) {
        const id = item.price?.id;
        if (id && !priceIds.includes(id)) priceIds.push(id);
        items.push(subscriptionItemFacts(item));
      }
    };

    if (subscription.items?.has_more) {
      // The embedded list is only the first page: read every item instead.
      const maxPages = options.maxPages ?? 10;
      let startingAfter: string | undefined;
      let complete = false;
      for (let page = 0; page < maxPages; page += 1) {
        const result = await this.stripe.subscriptionItems.list({
          subscription: subscription.id,
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        add(result.data);
        if (!result.has_more) {
          complete = true;
          break;
        }
        // "More" with nothing on the page: no cursor to go on with. Fail closed.
        if (result.data.length === 0) throw new Error('subscription_items_incomplete');
        startingAfter = result.data[result.data.length - 1].id;
      }
      if (!complete) throw new Error('subscription_items_incomplete');
    } else {
      add(subscription.items?.data ?? []);
    }

    const customer = subscription.customer;
    return {
      id: subscription.id,
      status: subscription.status,
      customerId: typeof customer === 'string' ? customer : customer?.id ?? null,
      billingCycleAnchor: subscription.billing_cycle_anchor,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      cancelAt: unixOrNull(subscription.cancel_at),
      endedAt: subscription.ended_at ?? null,
      livemode: subscription.livemode,
      metadata: subscription.metadata ?? {},
      priceIds,
      items,
      pendingUpdate: pendingUpdateFacts(subscription.pending_update),
      latestInvoiceId: refId(subscription.latest_invoice),
    };
  }

  // ── Business OS plan cancel / reactivate (plan payments P-7a.1; P-7a C-2, TQ-3; D2 SX C-4) ──

  /**
   * THE cancel / reactivate write: `cancel_at_period_end` on OUR row's
   * subscription (the caller passes the id from our billing record, never a
   * request value). Returns the facts the status mirror needs, from the
   * update's own answer (SA C-2: no second retrieve).
   *
   * Idempotency (P-7a TQ-3, SX C-4; D2 workplan §3.3, SA Q-3 / W-4): never a
   * FIXED key, because a key derived from the ids would replay a stale answer
   * on cancel → reactivate → cancel within 24 h. The caller may pass a key
   * that is fresh PER ATTEMPT (`planManageAttemptKey`, a random uuid suffix):
   * a network retry inside that attempt reuses it, the next attempt never
   * does. Without one, the request carries no options (as P-7a.1 built it).
   * X-2 (2026-10-26, sandbox): `true` also sets `cancel_at` to the period end;
   * `false` clears both, including a `cancel_at` set without the flag.
   */
  async setBusinessOsCancelAtPeriodEnd(
    subscriptionId: string,
    cancelAtPeriodEnd: boolean,
    options?: { idempotencyKey?: string }
  ): Promise<BusinessOsCancelFacts> {
    const params = { cancel_at_period_end: cancelAtPeriodEnd };
    const subscription = options?.idempotencyKey
      ? await this.stripe.subscriptions.update(subscriptionId, params, { idempotencyKey: options.idempotencyKey })
      : await this.stripe.subscriptions.update(subscriptionId, params);
    const customer = subscription.customer;
    const periodEnds = (subscription.items?.data ?? [])
      .map((item) => unixOrNull(item.current_period_end))
      .filter((value): value is number => value !== null);
    return {
      id: subscription.id,
      status: subscription.status,
      customerId: typeof customer === 'string' ? customer : customer?.id ?? null,
      livemode: subscription.livemode,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      cancelAt: unixOrNull(subscription.cancel_at),
      endedAt: unixOrNull(subscription.ended_at),
      // On clover the period lives on the items; the latest end is when the plan stops.
      currentPeriodEnd: periodEnds.length > 0 ? Math.max(...periodEnds) : null,
    };
  }

  // ── Business OS card and invoices (plan payments P-7a.2, workplan §4.4, §4.5; SA C-6, TQ-6 to TQ-8) ──
  // The caller passes ids from OUR billing row and the checked configuration
  // id; nothing here comes from a request. The legacy agent-platform
  // `createPortalSession` / `listInvoices` below are NOT used for Business OS:
  // they name no configuration (Stripe's default may allow cancel and plan
  // switching) and check nothing.

  /** The portal configuration, reduced to what `portalConfigurationProblems` checks. */
  async retrieveBusinessOsPortalConfiguration(configurationId: string): Promise<PortalConfigurationFacts> {
    const config = await this.stripe.billingPortal.configurations.retrieve(configurationId);
    const features = config.features;
    return {
      id: config.id,
      active: config.active,
      livemode: config.livemode,
      features: {
        payment_method_update: features?.payment_method_update?.enabled === true,
        invoice_history: features?.invoice_history?.enabled === true,
        subscription_cancel: features?.subscription_cancel?.enabled === true,
        subscription_update: features?.subscription_update?.enabled === true,
        customer_update: features?.customer_update?.enabled === true,
      },
    };
  }

  /**
   * A portal session on OUR configuration for OUR row's customer. `flow:
   * 'payment_method_update'` opens on the card form and, with
   * `after_completion` redirect (SA C-6), comes straight back to `returnUrl`.
   * X-1 (2026-10-26, sandbox): a card added there becomes the customer's
   * invoice default and the subscription's own default is CLEARED, so the
   * next renewal uses the new card. X-5: `he` is not a portal locale (the
   * caller sends `auto` for it).
   *
   * The URL is a bearer link to the customer's billing: returned for the
   * owner's browser only, never logged, audited or put in an error.
   */
  async createBusinessOsPortalSession(params: {
    customerId: string;
    configurationId: string;
    returnUrl: string;
    locale: BusinessOsPortalLocale;
    flow: 'payment_method_update' | null;
  }): Promise<BusinessOsPortalSessionFacts> {
    const { customerId, configurationId, returnUrl, locale, flow } = params;
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      configuration: configurationId,
      return_url: returnUrl,
      locale,
      ...(flow === 'payment_method_update'
        ? { flow_data: { type: 'payment_method_update', after_completion: { type: 'redirect', redirect: { return_url: returnUrl } } } }
        : {}),
    });
    return {
      url: session.url,
      customerId: session.customer,
      configurationId: refId(session.configuration),
      livemode: session.livemode,
    };
  }

  /**
   * One page of OUR row's customer's invoices, newest first (TQ-6: no
   * auto-paging; `limit` is the caller's, at most 100). Facts only; the
   * caller maps, filters and drops.
   */
  async listBusinessOsInvoices(params: { customerId: string; limit: number }): Promise<{
    invoices: BusinessOsInvoiceListFacts[];
    hasMore: boolean;
  }> {
    const limit = Math.max(1, Math.min(100, Math.floor(params.limit)));
    const page = await this.stripe.invoices.list({ customer: params.customerId, limit });
    return {
      invoices: page.data.map((invoice) => ({
        id: invoice.id ?? '',
        customerId: refId(invoice.customer),
        livemode: invoice.livemode,
        status: invoice.status ?? null,
        billingReason: invoice.billing_reason ?? null,
        // A credit (negative total) is a real invoice too; only a non-integer is unreadable.
        totalMinor: Number.isSafeInteger(invoice.total) ? invoice.total : null,
        currency: typeof invoice.currency === 'string' ? invoice.currency : null,
        created: unixOrNull(invoice.created),
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
        invoicePdf: invoice.invoice_pdf ?? null,
        priceIds: invoiceLinePriceIds(invoice).priceIds,
      })),
      hasMore: page.has_more,
    };
  }

  // ── Business OS plan upgrade (plan payments P-7b.1a, workplan §3.3; SA U-1) ──
  // The ONE write is `upgradeBusinessOsPlanSubscription`. Every method builds
  // its own parameters (CF-4): the caller passes ids taken from OUR billing
  // row and the fresh subscription read, a price id from the runtime price
  // check, and the server-chosen proration date. No metadata, no anchor, no
  // trial end, no new price. Each returns FACTS only: the raw Stripe objects
  // carry a confirmation client secret and are never returned or logged.

  /**
   * Read-only: what the upgrade would cost now (`invoices.createPreview`,
   * which replaced "upcoming invoice" on the Basil line). The amounts only.
   */
  async previewBusinessOsPlanUpgrade(params: {
    customerId: string;
    subscriptionId: string;
    itemId: string;
    priceId: string;
    prorationDate: number;
  }): Promise<BusinessOsUpgradePreviewFacts> {
    const { customerId, subscriptionId, itemId, priceId, prorationDate } = params;
    const invoice = await this.stripe.invoices.createPreview({
      customer: customerId,
      subscription: subscriptionId,
      subscription_details: {
        items: [{ id: itemId, price: priceId }],
        proration_behavior: 'always_invoice',
        proration_date: prorationDate,
      },
    });
    const amountDueMinor = invoice.amount_due;
    const totalMinor = invoice.total;
    const taxMinor = invoiceTaxMinor(invoice);
    if (!isWholeMinor(amountDueMinor) || !Number.isSafeInteger(totalMinor) || taxMinor === null) {
      throw new Error('upgrade_preview_amounts_unreadable');
    }
    return {
      amountDueMinor,
      totalMinor,
      taxMinor,
      currency: typeof invoice.currency === 'string' ? invoice.currency.toLowerCase() : '',
    };
  }

  /**
   * THE upgrade write (SA U-1): swap the one item's price on the existing
   * subscription, charge the prorated difference at once
   * (`always_invoice`), and leave the subscription unchanged unless the
   * payment succeeds (`pending_if_incomplete`). The idempotency key is built
   * here from the subscription, the price and the proration date, so two
   * identical confirms replay rather than charge twice (Stripe answers an
   * identical in-flight request with an idempotency error).
   *
   * A card error THROWN by the call propagates (the orchestration maps it to
   * `declined`, SA V-7). Experiment E-2 (2026-10-13) observed that Stripe
   * RETURNS a decline on this path instead: the pending update is kept, the
   * invoice stays `open` and its PaymentIntent reads `requires_payment_method`.
   * The thrown shape stays mapped as a backstop.
   */
  async upgradeBusinessOsPlanSubscription(params: {
    subscriptionId: string;
    itemId: string;
    priceId: string;
    prorationDate: number;
  }): Promise<BusinessOsUpgradeFacts> {
    const { subscriptionId, itemId, priceId, prorationDate } = params;
    const subscription = await this.stripe.subscriptions.update(
      subscriptionId,
      {
        items: [{ id: itemId, price: priceId }],
        proration_behavior: 'always_invoice',
        proration_date: prorationDate,
        payment_behavior: 'pending_if_incomplete',
        expand: ['latest_invoice.confirmation_secret'],
      },
      { idempotencyKey: businessOsUpgradeIdempotencyKey(subscriptionId, priceId, prorationDate) }
    );

    const invoice = typeof subscription.latest_invoice === 'object' ? subscription.latest_invoice : null;
    const pending = pendingUpdateFacts(subscription.pending_update);

    // SA F-1: the payment state is read only when there IS a pending update
    // (without one the outcome is `upgraded` whatever the payment says, so the
    // read would only add a way to fail). The write above has ALREADY
    // happened, so a failure of this follow-up read must never leave the
    // method as an error: the orchestration would classify it by its class and
    // could answer "refused before running" for a change that was made (V-3).
    // Any failure answers `none` → unknown outcome, audited and alerted.
    // Without a pending update no network read is made; a `paid` invoice is
    // still reported as `succeeded` (no read needed), anything else `none`.
    let paymentState: BusinessOsUpgradePaymentState = invoice?.status === 'paid' ? 'succeeded' : 'none';
    if (pending !== null && invoice) {
      try {
        paymentState = await this.upgradeInvoicePaymentState(invoice);
      } catch (err) {
        // Never the error object: a Stripe error here can carry the PaymentIntent (V-1).
        logger.warn(
          {
            event: 'bos_billing_upgrade_payment_read_failed',
            subscriptionId: subscription.id,
            invoiceId: invoice.id ?? null,
            stripeError: safeStripeErrorFields(err),
          },
          'Upgrade payment state unreadable after the update; answering none'
        );
        paymentState = 'none';
      }
    }

    return {
      subscriptionId: subscription.id,
      livemode: subscription.livemode,
      pendingUpdate: pending !== null,
      pendingUpdateExpiresAt: pending?.expiresAt ?? null,
      invoiceId: invoice?.id ?? refId(subscription.latest_invoice),
      invoiceStatus: invoice?.status ?? null,
      paymentState,
      confirmationClientSecret: invoice?.confirmation_secret?.client_secret ?? null,
    };
  }

  /**
   * One invoice, for the Q-2 resume (SA ruling): is the subscription's latest
   * invoice OUR open upgrade invoice, waiting on 3-D Secure? Read only after
   * the fresh subscription read showed a pending update (SA V-9), by the id
   * Stripe gave for that subscription. Facts only; the confirmation secret is
   * returned for the confirm route's 200 body and nothing else (SA V-1).
   */
  async retrieveBusinessOsUpgradeInvoice(invoiceId: string): Promise<BusinessOsUpgradeInvoiceFacts> {
    const invoice = await this.stripe.invoices.retrieve(invoiceId, { expand: ['confirmation_secret'] });
    return {
      invoiceId: invoice.id ?? invoiceId,
      subscriptionId: subscriptionIdFromInvoice(invoice),
      customerId: refId(invoice.customer as string | { id: string } | null),
      status: invoice.status ?? null,
      billingReason: invoice.billing_reason ?? null,
      amountDueMinor: isWholeMinor(invoice.amount_due) ? invoice.amount_due : null,
      livemode: invoice.livemode,
      paymentState: await this.upgradeInvoicePaymentState(invoice),
      confirmationClientSecret: invoice.confirmation_secret?.client_secret ?? null,
    };
  }

  /**
   * The payment state of an upgrade invoice (workplan §3.3, SA design point),
   * as sandbox experiment E-1 (2026-10-13, `2025-10-29.clover`) settled it:
   * a `paid` invoice is `succeeded` with no read; any other status but `open`
   * is `none` (a voided upgrade invoice, E-4, makes no read); an `open`
   * invoice is read with ONE `invoicePayments.list` call with the
   * PaymentIntent expanded (E-1b: the default payment, PaymentIntent
   * `requires_action`). The update's answer carries no `payments` key, and
   * expanding `latest_invoice.payments.data.payment.payment_intent` on the
   * update is refused by Stripe (`property_expansion_max_depth`), so the list
   * read is the permanent path. The `invoice.payments?.data` branch is kept
   * for an invoice that already carries the list (an invoice retrieved with
   * it expanded, as the E-2 capture was); it is not reached on the update's
   * answer. Pinned by the captured fixtures (`planUpgrade.captured.test.ts`).
   */
  private async upgradeInvoicePaymentState(invoice: Stripe.Invoice): Promise<BusinessOsUpgradePaymentState> {
    if (invoice.status === 'paid') return 'succeeded';
    if (invoice.status !== 'open' || !invoice.id) return 'none';
    const payments =
      invoice.payments?.data ??
      (
        await this.stripe.invoicePayments.list({
          invoice: invoice.id,
          limit: 10,
          expand: ['data.payment.payment_intent'],
        })
      ).data;
    return upgradePaymentStateOf(payments);
  }

  /**
   * Every line of an invoice (CF-2 / P-1 SA Q-8): an event embeds only the
   * first page, so a truncated invoice is read in full here instead of being
   * denied. Throws when the lines do not end within `maxPages`.
   */
  async listInvoiceLinesAll(invoiceId: string, options: { maxPages?: number } = {}): Promise<Stripe.InvoiceLineItem[]> {
    const maxPages = options.maxPages ?? 10;
    const lines: Stripe.InvoiceLineItem[] = [];
    let startingAfter: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await this.stripe.invoices.listLineItems(invoiceId, {
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      lines.push(...result.data);
      if (!result.has_more) return lines;
      // "More" with nothing on the page: no cursor to go on with. Fail closed.
      if (result.data.length === 0) throw new Error('invoice_lines_incomplete');
      startingAfter = result.data[result.data.length - 1].id;
    }
    throw new Error('invoice_lines_incomplete');
  }

  /**
   * The distinct price ids a checkout session sells, from its line items (the
   * session event carries none). A line without a price contributes nothing.
   * Throws when the items do not end within `maxPages`.
   */
  async listCheckoutSessionPriceIds(sessionId: string, options: { maxPages?: number } = {}): Promise<string[]> {
    const maxPages = options.maxPages ?? 10;
    const priceIds: string[] = [];
    let startingAfter: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await this.stripe.checkout.sessions.listLineItems(sessionId, {
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const item of result.data) {
        const id = item.price?.id;
        if (id && !priceIds.includes(id)) priceIds.push(id);
      }
      if (!result.has_more) return priceIds;
      // "More" with nothing on the page: no cursor to go on with. Fail closed.
      if (result.data.length === 0) throw new Error('checkout_session_items_incomplete');
      startingAfter = result.data[result.data.length - 1].id;
    }
    throw new Error('checkout_session_items_incomplete');
  }

  // ── Business OS plan test clocks (plan payments P-6a.1, workplan §5.8; SA
  // C-5, C-7). TEST MODE ONLY: each method refuses a non-test key before any
  // Stripe call. No database client, no table: the caller records the customer.

  /** Throws unless this service holds a test-mode key. Never echoes the key. */
  private assertTestModeKey(): void {
    if (!this.isTestModeKey) throw new Error('test_clock_requires_test_mode_key');
  }

  /**
   * Create a fresh test clock frozen at `frozenTimeUnix` and a new Business OS
   * customer on it, with the Business OS metadata (`product`, `bos_user_id`).
   * No email, no name: Checkout collects the email and sets it on the customer.
   *
   * Idempotency: the customer create uses `bos-customer-clock:<user>:<clock>`,
   * unique per clock, so a retry never makes a second customer on the same
   * clock, and it can never collide with the account's ordinary
   * `bos-customer:<user>` key.
   */
  async createBusinessOsTestClockCustomer(params: {
    bosUserId: string;
    frozenTimeUnix: number;
  }): Promise<{ testClockId: string; frozenTime: string; customerId: string; livemode: boolean }> {
    this.assertTestModeKey();
    const { bosUserId, frozenTimeUnix } = params;

    const clock = await this.stripe.testHelpers.testClocks.create({
      frozen_time: frozenTimeUnix,
      name: 'Business OS plan test clock',
    });
    const customer = await this.stripe.customers.create(
      {
        test_clock: clock.id,
        metadata: {
          [BOS_PRODUCT_METADATA_KEY]: BOS_PLAN_PRODUCT_MARKER,
          [BOS_USER_ID_METADATA_KEY]: bosUserId,
        },
      },
      { idempotencyKey: `bos-customer-clock:${bosUserId}:${clock.id}` }
    );

    return {
      testClockId: clock.id,
      frozenTime: new Date(clock.frozen_time * 1000).toISOString(),
      customerId: customer.id,
      livemode: customer.livemode,
    };
  }

  /**
   * The facts the test-clock route checks before it advances or reads a clock:
   * the customer's test clock and its `bos_user_id` metadata. `deleted: true`
   * for a customer deleted at Stripe.
   */
  async retrieveBusinessOsCustomerClock(customerId: string): Promise<{
    deleted: boolean;
    testClockId: string | null;
    bosUserId: string | null;
  }> {
    this.assertTestModeKey();
    const customer = await this.stripe.customers.retrieve(customerId);
    if (customer.deleted) return { deleted: true, testClockId: null, bosUserId: null };
    const clock = customer.test_clock;
    return {
      deleted: false,
      testClockId: typeof clock === 'string' ? clock : clock?.id ?? null,
      bosUserId: customer.metadata?.[BOS_USER_ID_METADATA_KEY] ?? null,
    };
  }

  /** A test clock's frozen time and status (`ready`, `advancing`, `internal_failure`). */
  async retrieveBusinessOsTestClock(testClockId: string): Promise<{ testClockId: string; frozenTime: string; status: string }> {
    this.assertTestModeKey();
    const clock = await this.stripe.testHelpers.testClocks.retrieve(testClockId);
    return { testClockId: clock.id, frozenTime: new Date(clock.frozen_time * 1000).toISOString(), status: clock.status };
  }

  /**
   * Move a test clock forward to `toUnix`. Stripe advances asynchronously: the
   * answer is usually `advancing`; read the clock again for `ready`.
   */
  async advanceBusinessOsTestClock(
    testClockId: string,
    toUnix: number
  ): Promise<{ testClockId: string; frozenTime: string; status: string }> {
    this.assertTestModeKey();
    const clock = await this.stripe.testHelpers.testClocks.advance(testClockId, { frozen_time: toUnix });
    return { testClockId: clock.id, frozenTime: new Date(clock.frozen_time * 1000).toISOString(), status: clock.status };
  }

  /**
   * Create customer portal session for subscription management
   */
  async createPortalSession(
    customerId: string,
    returnUrl: string
  ): Promise<Stripe.BillingPortal.Session> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl
    });

    return session;
  }

  /**
   * Cancel subscription at period end
   */
  async cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const subscription = await this.stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true
    });

    return subscription;
  }

  /**
   * Reactivate canceled subscription
   */
  async reactivateSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const subscription = await this.stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false
    });

    return subscription;
  }

  /**
   * Get subscription details
   */
  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return await this.stripe.subscriptions.retrieve(subscriptionId);
  }

  /**
   * List customer invoices
   */
  async listInvoices(customerId: string, limit: number = 10): Promise<Stripe.Invoice[]> {
    const invoices = await this.stripe.invoices.list({
      customer: customerId,
      limit
    });

    return invoices.data;
  }

  /**
   * Every invoice Stripe considers paid since a moment, for reconciliation.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Stripe is the authority on "money arrived"; our tables are only a record of
   * it. This read exists so something can compare the two, because between
   * 2026-09-26 and 2026-10-05 they disagreed for fourteen payments and nothing
   * noticed: production held a signing secret no Stripe destination signs with,
   * so every delivery was refused with a 400 and the money was recorded nowhere.
   *
   * `accountId` is the connected account to ask, or `null` for the platform's
   * own. A direct charge on a connected account exists ONLY there, so asking
   * the platform about it returns nothing — see `lib/payments/stripeAccountContext`.
   *
   * Filters on `created` rather than on the moment of payment, because Stripe
   * offers no filter for the latter. An invoice created before the window can
   * still be paid inside it, so callers get `created >= createdSince` and must
   * narrow by `status_transitions.paid_at` themselves.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async listPaidInvoices(params: {
    accountId: string | null;
    createdSince: Date;
    limit?: number;
    startingAfter?: string;
  }): Promise<{ invoices: Stripe.Invoice[]; hasMore: boolean }> {
    const page = await this.stripe.invoices.list(
      {
        status: 'paid',
        created: { gte: Math.floor(params.createdSince.getTime() / 1000) },
        limit: params.limit ?? 100,
        ...(params.startingAfter ? { starting_after: params.startingAfter } : {}),
      },
      params.accountId ? { stripeAccount: params.accountId } : undefined
    );

    return { invoices: page.data, hasMore: page.has_more };
  }

  /**
   * Construct webhook event from raw body
   */
  constructWebhookEvent(
    payload: string | Buffer,
    signature: string,
    webhookSecret: string
  ): Stripe.Event {
    return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }

  // ============================================
  // STRIPE CONNECT METHODS
  // For accepting payments from business clients
  // ============================================

  /**
   * Create Stripe Express account for new users
   * Express accounts are the simplest - Stripe handles all KYC/verification
   */
  async createExpressAccount(params: {
    email: string;
    country?: string;
    businessType?: 'individual' | 'company';
    businessProfile?: {
      name?: string;
      url?: string;
      mcc?: string; // Merchant Category Code (industry)
      product_description?: string;
    };
    individual?: {
      first_name?: string;
      last_name?: string;
      email?: string;
      phone?: string;
      dob?: { day: number; month: number; year: number };
      address?: {
        line1?: string;
        line2?: string;
        city?: string;
        state?: string;
        postal_code?: string;
        country?: string;
      };
      ssn_last_4?: string;
    };
    // Note: tosAcceptance is NOT supported for Express accounts - Stripe handles TOS during hosted onboarding
  }): Promise<{ accountId: string }> {
    const accountParams: Stripe.AccountCreateParams = {
      type: 'express',
      email: params.email,
      country: params.country || 'US',
      business_type: params.businessType || 'individual',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    };

    // Add business profile if provided
    if (params.businessProfile) {
      accountParams.business_profile = {
        name: params.businessProfile.name,
        url: params.businessProfile.url,
        mcc: params.businessProfile.mcc,
        product_description: params.businessProfile.product_description,
      };
    }

    // Add individual details if provided (for individual business type)
    if (params.individual && params.businessType === 'individual') {
      accountParams.individual = {};

      if (params.individual.first_name) accountParams.individual.first_name = params.individual.first_name;
      if (params.individual.last_name) accountParams.individual.last_name = params.individual.last_name;
      if (params.individual.email) accountParams.individual.email = params.individual.email;
      if (params.individual.phone) accountParams.individual.phone = params.individual.phone;
      if (params.individual.dob) accountParams.individual.dob = params.individual.dob;
      if (params.individual.ssn_last_4) accountParams.individual.ssn_last_4 = params.individual.ssn_last_4;

      if (params.individual.address) {
        accountParams.individual.address = {
          line1: params.individual.address.line1,
          line2: params.individual.address.line2,
          city: params.individual.address.city,
          state: params.individual.address.state,
          postal_code: params.individual.address.postal_code,
          country: params.individual.address.country || params.country || 'US',
        };
      }
    }

    // Note: TOS acceptance is NOT allowed for Express accounts
    // Express accounts handle TOS acceptance during Stripe's hosted onboarding flow
    // Only Custom accounts with controller.requirement_collection = 'application' can accept TOS via API

    const account = await this.stripe.accounts.create(accountParams);

    return { accountId: account.id };
  }

  /**
   * Create Express account with minimal information
   * Stripe's embedded onboarding will collect everything else
   * This provides the simplest onboarding experience
   */
  async createExpressAccountMinimal(params: {
    email?: string;
    country?: string;
  }): Promise<{ accountId: string }> {
    const accountParams: Stripe.AccountCreateParams = {
      type: 'express',
      country: params.country || 'US',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    };

    // Only add email if provided
    if (params.email) {
      accountParams.email = params.email;
    }

    const account = await this.stripe.accounts.create(accountParams);

    return { accountId: account.id };
  }

  /**
   * Create Account Link for Express onboarding
   * This generates a URL where the user completes their Stripe setup
   */
  async createAccountLink(params: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
    type?: 'account_onboarding' | 'account_update';
  }): Promise<string> {
    const accountLink = await this.stripe.accountLinks.create({
      account: params.accountId,
      refresh_url: params.refreshUrl,
      return_url: params.returnUrl,
      type: params.type || 'account_onboarding',
    });

    return accountLink.url;
  }

  /**
   * Generate OAuth link for existing Stripe account owners (Standard accounts)
   */
  generateStandardOAuthLink(params: {
    clientId: string;
    redirectUri: string;
    state: string;
  }): string {
    const baseUrl = 'https://connect.stripe.com/oauth/authorize';
    const queryParams = new URLSearchParams({
      response_type: 'code',
      client_id: params.clientId,
      scope: 'read_write',
      redirect_uri: params.redirectUri,
      state: params.state,
    });

    return `${baseUrl}?${queryParams.toString()}`;
  }

  /**
   * Exchange OAuth authorization code for account access (Standard accounts)
   */
  async handleOAuthCallback(code: string): Promise<{
    accountId: string;
    accessToken: string;
    refreshToken: string;
  }> {
    const response = await this.stripe.oauth.token({
      grant_type: 'authorization_code',
      code,
    });

    return {
      accountId: response.stripe_user_id!,
      accessToken: response.access_token!,
      refreshToken: response.refresh_token!,
    };
  }

  /**
   * Retrieve account status from Stripe
   */
  async getConnectAccountStatus(accountId: string): Promise<{
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    country: string | null;
    defaultCurrency: string | null;
    businessType: string | null;
  }> {
    const account = await this.stripe.accounts.retrieve(accountId);

    return {
      chargesEnabled: account.charges_enabled || false,
      payoutsEnabled: account.payouts_enabled || false,
      detailsSubmitted: account.details_submitted || false,
      country: account.country || null,
      defaultCurrency: account.default_currency || null,
      businessType: account.business_type || null,
    };
  }

  /**
   * Generate Express Dashboard login link
   * Only works for Express accounts
   */
  async createExpressDashboardLink(accountId: string): Promise<string> {
    const loginLink = await this.stripe.accounts.createLoginLink(accountId);
    return loginLink.url;
  }

  /**
   * Delete a connected account from Stripe
   * Stripe recommends platform-initiated deletion via API
   */
  async deleteConnectedAccount(accountId: string): Promise<void> {
    await this.stripe.accounts.del(accountId);
  }

  /**
   * Get full account details from Stripe for pre-filling forms
   * Used when continuing onboarding to show what's already been provided
   */
  async getConnectAccountDetails(accountId: string): Promise<{
    email: string | null;
    country: string | null;
    businessType: string | null;
    businessProfile: {
      name: string | null;
      url: string | null;
      mcc: string | null;
    };
    individual: {
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      phone: string | null;
      dob: { day: number; month: number; year: number } | null;
      address: {
        line1: string | null;
        line2: string | null;
        city: string | null;
        state: string | null;
        postalCode: string | null;
        country: string | null;
      } | null;
      ssnLast4Provided: boolean;
    } | null;
    requirements: {
      currentlyDue: string[];
      eventuallyDue: string[];
      pastDue: string[];
    };
  }> {
    const account = await this.stripe.accounts.retrieve(accountId);

    const individual = account.individual;
    const businessProfile = account.business_profile;

    return {
      email: account.email || null,
      country: account.country || null,
      businessType: account.business_type || null,
      businessProfile: {
        name: businessProfile?.name || null,
        url: businessProfile?.url || null,
        mcc: businessProfile?.mcc || null,
      },
      individual: individual ? {
        firstName: individual.first_name || null,
        lastName: individual.last_name || null,
        email: individual.email || null,
        phone: individual.phone || null,
        dob: individual.dob ? {
          day: individual.dob.day!,
          month: individual.dob.month!,
          year: individual.dob.year!,
        } : null,
        address: individual.address ? {
          line1: individual.address.line1 || null,
          line2: individual.address.line2 || null,
          city: individual.address.city || null,
          state: individual.address.state || null,
          postalCode: individual.address.postal_code || null,
          country: individual.address.country || null,
        } : null,
        ssnLast4Provided: individual.ssn_last_4_provided || false,
      } : null,
      requirements: {
        currentlyDue: account.requirements?.currently_due || [],
        eventuallyDue: account.requirements?.eventually_due || [],
        pastDue: account.requirements?.past_due || [],
      },
    };
  }

  /**
   * Update a connected account with additional information
   * Used to complete onboarding for Express accounts
   */
  async updateConnectedAccount(
    accountId: string,
    data: {
      businessProfile?: {
        name?: string;
        url?: string;
        mcc?: string;
      };
      individual?: {
        first_name?: string;
        last_name?: string;
        email?: string;
        phone?: string;
        dob?: {
          day: number;
          month: number;
          year: number;
        };
        address?: {
          line1?: string;
          line2?: string;
          city?: string;
          state?: string;
          postal_code?: string;
          country?: string;
        };
        ssn_last_4?: string;
      };
      tosAcceptance?: {
        date: number;
        ip: string;
      };
    }
  ): Promise<void> {
    const updateParams: Stripe.AccountUpdateParams = {};

    if (data.businessProfile) {
      updateParams.business_profile = {
        name: data.businessProfile.name,
        url: data.businessProfile.url,
        mcc: data.businessProfile.mcc,
      };
    }

    if (data.individual) {
      updateParams.individual = {
        first_name: data.individual.first_name,
        last_name: data.individual.last_name,
        email: data.individual.email,
        phone: data.individual.phone,
        dob: data.individual.dob,
        address: data.individual.address,
        ssn_last_4: data.individual.ssn_last_4,
      };
    }

    if (data.tosAcceptance) {
      updateParams.tos_acceptance = {
        date: data.tosAcceptance.date,
        ip: data.tosAcceptance.ip,
      };
    }

    await this.stripe.accounts.update(accountId, updateParams);
  }
}

// Export singleton instance (created with env var)
let stripeServiceInstance: StripeService | null = null;

export function getStripeService(): StripeService {
  if (!stripeServiceInstance) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }
    stripeServiceInstance = new StripeService(stripeKey);
  }
  return stripeServiceInstance;
}
