/**
 * Plan resolver: is this platform event a Business OS plan payment?
 *
 * Decided by the PRICE ids on the invoice lines (or the session's line items,
 * or the subscription's items), compared with the prices behind our configured
 * lookup keys (`planPriceCatalog`). Deny by default: a platform invoice whose
 * prices we do not recognise is refused, so it can never fall into the
 * agent-platform Pilot-Credit conversion (as-built G-6).
 *
 * | Platform event                                | Switch off (production today)       | Switch on, recognised | Switch on, not recognised           |
 * |-----------------------------------------------|-------------------------------------|-----------------------|-------------------------------------|
 * | `invoice.paid`, `invoice.payment_failed`      | `deny` (empty catalog)              | `flow: 'plan'`        | `deny` (SA Q-1: payment_failed too) |
 * | the same, with `lines.has_more`               | `deny lines_truncated`              | lines read in full (CF-2), then the row above               |
 * | `invoice.payment_action_required` (P-6a.2)    | `not_business_os` (no catalog read) | `flow: 'plan'`        | `deny`, as `invoice.payment_failed` |
 * | `checkout.session.completed`, subscription    | `deny legacy_subscription_checkout` | `flow: 'plan'`        | `deny legacy_subscription_checkout` |
 * | `checkout.session.expired`, subscription      | `not_business_os`                   | `flow: 'plan'`        | `not_business_os`                   |
 * | `customer.subscription.updated` / `.deleted`  | `not_business_os`                   | `flow: 'plan'`        | `not_business_os`                   |
 * | `checkout.session.*`, payment mode            | `not_business_os` (boost pack)      | `not_business_os`     | `not_business_os`                   |
 * | anything else                                 | `not_business_os`                   | n/a                   | n/a                                 |
 *
 * Some prices recognised and some not is `deny mixed_prices`, for every event.
 *
 * "Switch off" is `BUSINESS_OS_PLAN_PRICES_ENABLED` off, i.e. no active plan
 * lookup key (P-3b workplan §3.6). It is checked BEFORE any new Stripe call, so
 * with the switch off every branch above makes zero Stripe calls and returns
 * exactly what it returned before P-3b.2 (a test pins it).
 *
 * Metadata never routes and never names an account. It is a cross-check: a
 * disagreement between price and metadata is refused and alerted.
 *
 * Reads nothing from the database (SA P1-C6). A Stripe read that fails throws:
 * "could not tell" releases the claim so Stripe retries (SA Q-6).
 *
 * @module lib/business-os/billing/planInvoiceResolver
 */

import type Stripe from 'stripe';

import { invoiceLinePriceIds } from '@/lib/payments/invoiceLinePrices';
import { subscriptionMetadataFromInvoice } from '@/lib/payments/invoiceSubscription';
import { getStripeService, type StripeService } from '@/lib/stripe/StripeService';
import { activePlanLookupKeys, planPriceCatalog, type PlanPriceCatalog } from '@/lib/business-os/billing/planPriceCatalog';
import {
  BOS_PLAN_PRODUCT_MARKER,
  BOS_PRODUCT_METADATA_KEY,
  BOS_USER_ID_METADATA_KEY,
  LEGACY_PILOT_CREDIT_METADATA_KEYS,
} from '@/lib/business-os/billing/stripeMetadataKeys';
import type {
  BusinessOsResolver,
  DenyDetail,
  DenyReason,
  DispatchOutcome,
} from '@/lib/business-os/billing/webhookDispatcher';

const NOT_OURS: DispatchOutcome = { kind: 'not_business_os' };

/** The Stripe reads the resolver may make, and only while the switch is on. */
export type PlanResolverStripeReads = Pick<
  StripeService,
  'listInvoiceLinesAll' | 'listCheckoutSessionPriceIds' | 'retrieveBusinessOsSubscription'
>;

export interface PlanResolverDeps {
  catalog: PlanPriceCatalog;
  /** Called lazily, only by a P-3b.2 branch with the switch on. Default: `getStripeService()`. */
  stripe?: () => PlanResolverStripeReads;
  /** Is plan-price recognition on? Default: any active plan lookup key (the price switch). */
  recognitionEnabled?: () => boolean;
}

interface MetadataSignals {
  /** Keys only, for the log line. */
  readonly keys: string[];
  /** The metadata says this is a Business OS plan object. */
  readonly claimsBusinessOs: boolean;
  /** The metadata carries agent-platform Pilot-Credit keys. */
  readonly hasLegacyKeys: boolean;
  /** A `product` value other than the plan marker. */
  readonly hasForeignProduct: boolean;
}

function readMetadata(sources: ReadonlyArray<Stripe.Metadata | null | undefined>): MetadataSignals {
  const keys = new Set<string>();
  let claimsBusinessOs = false;
  let hasLegacyKeys = false;
  let hasForeignProduct = false;

  for (const metadata of sources) {
    if (!metadata) continue;
    for (const [key, value] of Object.entries(metadata)) {
      keys.add(key);
      if (key === BOS_USER_ID_METADATA_KEY && value) claimsBusinessOs = true;
      if (key === BOS_PRODUCT_METADATA_KEY) {
        if (value === BOS_PLAN_PRODUCT_MARKER) claimsBusinessOs = true;
        else if (value) hasForeignProduct = true;
      }
      if (LEGACY_PILOT_CREDIT_METADATA_KEYS.includes(key) && value) hasLegacyKeys = true;
    }
  }

  return { keys: [...keys].sort(), claimsBusinessOs, hasLegacyKeys, hasForeignProduct };
}

function deny(reason: DenyReason, detail: DenyDetail): DispatchOutcome {
  return { kind: 'deny', reason, detail };
}

export function createPlanResolver(deps: PlanResolverDeps): BusinessOsResolver {
  const { catalog } = deps;
  const stripe = deps.stripe ?? ((): PlanResolverStripeReads => getStripeService());
  const recognitionEnabled = deps.recognitionEnabled ?? ((): boolean => activePlanLookupKeys().length > 0);

  /** Which of these prices are plan prices, and under which lookup keys. */
  async function matchPrices(priceIds: readonly string[]): Promise<{ matched: string[]; lookupKeys: string[] }> {
    // Throws on a Stripe error: the claim is released and Stripe retries.
    let known = await catalog.load();
    // SA P1-C3: a cached map may predate a price. Never deny on a stale cache.
    if (known.fromCache && priceIds.some((id) => !known.byPriceId.has(id))) {
      known = await catalog.load({ bypassCache: true });
    }
    const matched = priceIds.filter((id) => known.byPriceId.has(id));
    const lookupKeys = [...new Set(matched.map((id) => known.byPriceId.get(id) as string))].sort();
    return { matched, lookupKeys };
  }

  async function resolveInvoice(event: Stripe.Event, embedded: Stripe.Invoice): Promise<DispatchOutcome> {
    let invoice = embedded;
    // SA Q-8 / CF-2: an event embeds only the first page of lines. With the
    // switch off this stays P-1's loud refusal, with no Stripe call. With it on,
    // the invoice is read in full and decided like any other (a fetch error
    // throws: the claim is released and Stripe retries).
    if (embedded.lines?.has_more === true && embedded.id && recognitionEnabled()) {
      const all = await stripe().listInvoiceLinesAll(embedded.id);
      invoice = { ...embedded, lines: { ...embedded.lines, data: all, has_more: false } };
    }

    const { priceIds, unpricedLines, truncated } = invoiceLinePriceIds(invoice);
    const metadata = readMetadata([invoice.metadata, subscriptionMetadataFromInvoice(invoice)]);

    const detail = (lookupKeysMatched: readonly string[]): DenyDetail => ({
      eventType: event.type,
      objectId: invoice.id ?? null,
      priceIds,
      lookupKeysMatched,
      metadataKeys: metadata.keys,
      unpricedLines,
      amountPaid: typeof invoice.amount_paid === 'number' ? invoice.amount_paid : null,
      livemode: event.livemode,
    });

    if (truncated) return deny('lines_truncated', detail([]));

    if (priceIds.length === 0) {
      return deny(metadata.claimsBusinessOs ? 'metadata_mismatch' : 'no_priced_lines', detail([]));
    }

    const { matched, lookupKeys } = await matchPrices(priceIds);

    if (matched.length === 0) {
      // Unknown price but the metadata says Business OS: a tamper signal or a
      // catalog gap. Either way a person must look.
      return deny(metadata.claimsBusinessOs ? 'metadata_mismatch' : 'unknown_price', detail([]));
    }

    if (matched.length < priceIds.length) return deny('mixed_prices', detail(lookupKeys));

    // Known plan price. Legacy Pilot-Credit keys or another product's marker on
    // it is a disagreement (RD-4.3, SR-2). Absent metadata is not.
    if (metadata.hasLegacyKeys || metadata.hasForeignProduct) {
      return deny('metadata_mismatch', detail(lookupKeys));
    }

    return { kind: 'flow', flow: 'plan', lookupKeys };
  }

  /**
   * A subscription-mode session or a subscription, by its prices (P-3b.2).
   * `unrecognised` is what an object with no plan price gets: its pre-P-3b.2 outcome.
   */
  async function resolveByPrices(
    event: Stripe.Event,
    objectId: string,
    priceIds: readonly string[],
    metadataSource: Stripe.Metadata | null | undefined,
    unrecognised: DispatchOutcome,
    amount: number | null
  ): Promise<DispatchOutcome> {
    if (priceIds.length === 0) return unrecognised;
    const { matched, lookupKeys } = await matchPrices(priceIds);
    if (matched.length === 0) return unrecognised;

    const metadata = readMetadata([metadataSource]);
    const detail: DenyDetail = {
      eventType: event.type,
      objectId,
      priceIds: [...priceIds],
      lookupKeysMatched: lookupKeys,
      metadataKeys: metadata.keys,
      amountPaid: amount,
      livemode: event.livemode,
    };
    if (matched.length < priceIds.length) return deny('mixed_prices', detail);
    if (metadata.hasLegacyKeys || metadata.hasForeignProduct) return deny('metadata_mismatch', detail);
    return { kind: 'flow', flow: 'plan', lookupKeys };
  }

  function legacySubscriptionCheckout(event: Stripe.Event, session: Stripe.Checkout.Session): DispatchOutcome {
    // SA Q-2: the session-time Pilot-Credit conversion is gone. A subscription
    // session that is not a recognised plan session is denied here, 200.
    return deny('legacy_subscription_checkout', {
      eventType: event.type,
      objectId: session.id ?? null,
      priceIds: [],
      lookupKeysMatched: [],
      metadataKeys: Object.keys(session.metadata ?? {}).sort(),
      amountPaid: session.amount_total ?? null,
      livemode: event.livemode,
    });
  }

  async function resolveSession(event: Stripe.Event, session: Stripe.Checkout.Session): Promise<DispatchOutcome> {
    if (session.mode !== 'subscription') return NOT_OURS; // boost pack (TK-5)
    const unrecognised =
      event.type === 'checkout.session.completed' ? legacySubscriptionCheckout(event, session) : NOT_OURS;

    // Switch off: P-1's outcome exactly, and no Stripe call (§3.6).
    if (!session.id || !recognitionEnabled()) return unrecognised;

    // The session event carries no prices: its line items do (P-3a SA Q-1).
    const priceIds = await stripe().listCheckoutSessionPriceIds(session.id);
    return resolveByPrices(event, session.id, priceIds, session.metadata, unrecognised, session.amount_total ?? null);
  }

  async function resolveSubscription(event: Stripe.Event, subscription: Stripe.Subscription): Promise<DispatchOutcome> {
    // Switch off: the legacy platform handlers run as before (§3.6).
    if (!subscription.id || !recognitionEnabled()) return NOT_OURS;

    let priceIds: string[] = [];
    if (subscription.items?.has_more) {
      // The embedded items are only the first page: read the subscription in full.
      priceIds = (await stripe().retrieveBusinessOsSubscription(subscription.id)).priceIds;
    } else {
      for (const item of subscription.items?.data ?? []) {
        const id = item.price?.id;
        if (id && !priceIds.includes(id)) priceIds.push(id);
      }
    }
    return resolveByPrices(event, subscription.id, priceIds, subscription.metadata, NOT_OURS, null);
  }

  return {
    flow: 'plan',
    async resolve(event) {
      switch (event.type) {
        case 'invoice.paid':
        case 'invoice.payment_failed':
          return resolveInvoice(event, event.data.object as Stripe.Invoice);

        // P-6a.2 (workplan §5.4; SA: required behind the switch). With the
        // switch off this is exactly the outcome it had before (`not_business_os`),
        // decided BEFORE any catalog read or Stripe call: `resolveInvoice` on
        // an empty catalog would deny it loudly, a production behaviour change.
        case 'invoice.payment_action_required':
          if (!recognitionEnabled()) return NOT_OURS;
          return resolveInvoice(event, event.data.object as Stripe.Invoice);

        case 'checkout.session.completed':
        case 'checkout.session.expired':
          return resolveSession(event, event.data.object as Stripe.Checkout.Session);

        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          return resolveSubscription(event, event.data.object as Stripe.Subscription);

        default:
          return NOT_OURS;
      }
    },
  };
}

/** The resolver the webhook uses, on the process-wide catalog. */
export const planResolver: BusinessOsResolver = createPlanResolver({ catalog: planPriceCatalog });
