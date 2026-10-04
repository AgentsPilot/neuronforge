/**
 * Plan resolver: is this platform event a Business OS plan payment?
 *
 * Decided by the PRICE ids on the invoice lines, compared with the prices
 * behind our configured lookup keys (`planPriceCatalog`). Deny by default: a
 * platform invoice whose prices we do not recognise is refused, so it can never
 * fall into the agent-platform Pilot-Credit conversion (as-built G-6).
 *
 * | Platform event                              | Recognised            | Not recognised                    |
 * |---------------------------------------------|-----------------------|-----------------------------------|
 * | `invoice.paid`, `invoice.payment_failed`    | `flow: 'plan'`        | `deny` (SA Q-1: payment_failed too)|
 * | `checkout.session.completed`, subscription  | (P-3a adds this)      | `deny legacy_subscription_checkout`|
 * | `checkout.session.completed`, payment       | n/a                   | `not_business_os` (boost pack)    |
 * | anything else                               | n/a                   | `not_business_os`                 |
 *
 * Metadata never routes and never names an account. It is a cross-check: a
 * disagreement between price and metadata is refused and alerted.
 *
 * Reads nothing from the database (SA P1-C6).
 *
 * @module lib/business-os/billing/planInvoiceResolver
 */

import type Stripe from 'stripe';

import { invoiceLinePriceIds } from '@/lib/payments/invoiceLinePrices';
import { subscriptionMetadataFromInvoice } from '@/lib/payments/invoiceSubscription';
import { planPriceCatalog, type PlanPriceCatalog } from '@/lib/business-os/billing/planPriceCatalog';
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

export function createPlanResolver(deps: { catalog: PlanPriceCatalog }): BusinessOsResolver {
  const { catalog } = deps;

  async function resolveInvoice(event: Stripe.Event, invoice: Stripe.Invoice): Promise<DispatchOutcome> {
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

    // SA Q-8: an event embeds only the first page of lines. Prices we cannot
    // see could be anything, so refuse loudly. Before P-3b assigns plans, a
    // truncated RECOGNISED invoice must be fetched instead (carry-forward).
    if (truncated) return deny('lines_truncated', detail([]));

    if (priceIds.length === 0) {
      return deny(metadata.claimsBusinessOs ? 'metadata_mismatch' : 'no_priced_lines', detail([]));
    }

    // Throws on a Stripe error: the claim is released and Stripe retries.
    let known = await catalog.load();
    // SA P1-C3: a cached map may predate a price. Never deny on a stale cache.
    if (known.fromCache && priceIds.some((id) => !known.byPriceId.has(id))) {
      known = await catalog.load({ bypassCache: true });
    }

    const matched = priceIds.filter((id) => known.byPriceId.has(id));
    const lookupKeys = [...new Set(matched.map((id) => known.byPriceId.get(id) as string))].sort();

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

  return {
    flow: 'plan',
    async resolve(event) {
      switch (event.type) {
        case 'invoice.paid':
        case 'invoice.payment_failed':
          return resolveInvoice(event, event.data.object as Stripe.Invoice);

        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.mode !== 'subscription') return NOT_OURS; // boost pack (TK-5)
          // SA Q-2: the session-time Pilot-Credit conversion is gone. P-3a adds
          // Business OS session recognition ahead of this deny.
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

        default:
          return NOT_OURS;
      }
    },
  };
}

/** The resolver the webhook uses, on the process-wide catalog. */
export const planResolver: BusinessOsResolver = createPlanResolver({ catalog: planPriceCatalog });
