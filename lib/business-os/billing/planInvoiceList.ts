/**
 * The owner's invoice list in Settings → Plan, mapped from Stripe's answer
 * (plan payments P-7a.2; workplan
 * docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P7A_WORKPLAN.md §4.5; SA TQ-6, C-6;
 * F9, AC-F9.1, AC-F9.2).
 *
 * PURE: no I/O, no clock, no logger of its own, and only a type import. The orchestration
 * (`planBillingDocuments.ts`) reads one page of OUR row's customer's invoices
 * from Stripe and hands it here with the plan-label lookup; this decides what
 * the owner sees.
 *
 * | Rule | Why |
 * |---|---|
 * | Drafts are dropped | Not an invoice yet (Stripe finalises a renewal draft about an hour later) |
 * | Another customer, or another mode, is dropped and REPORTED | Never shown: tenant isolation (the list is read for our row's customer only, so this is defence in depth) |
 * | Not `usd` is dropped and REPORTED (SR-15) | Plans are sold in USD only; anything else is a setup fault |
 * | A status other than paid / open / void / uncollectible is dropped | Nothing else can be said truthfully |
 * | The hosted link is kept only if it is Stripe's hosted invoice page (`isHostedInvoiceUrl`) | The link opens in a new tab; never an arbitrary URL |
 * | `billing_reason` → Plan started / Monthly renewal / Plan change / Invoice | U-10: the voided invoice of a declined upgrade reads "Plan change, Not charged", never "failed" |
 *
 * The plan label comes from the invoice's line prices through the plan price
 * catalog (lookup key → tier → label); unknown → no label. It is cosmetic: a
 * catalog that cannot be read leaves every label empty and the list stands.
 *
 * Never money history: nothing here reads `billing_events`, `user_subscriptions`
 * or any table (AC-F9.2, RD-2). An owner READ, never an access decision (SR-11).
 *
 * @module lib/business-os/billing/planInvoiceList
 */

import type { BusinessOsInvoiceListFacts } from '@/lib/stripe/StripeService';

/** BQ-7 (TL default): the last 12, then "See all in Stripe". */
export const PLAN_INVOICE_LIST_LIMIT = 12;

export type PlanInvoiceReason = 'subscription_create' | 'subscription_cycle' | 'subscription_update' | 'other';
export type PlanInvoiceStatus = 'paid' | 'open' | 'void' | 'uncollectible';

/** One row on the wire. */
export interface PlanInvoiceRow {
  id: string;
  /** ISO. */
  createdAt: string;
  reason: PlanInvoiceReason;
  planLabel: string | null;
  amountMinor: number;
  currency: 'usd';
  status: PlanInvoiceStatus;
  /** Stripe's hosted invoice page (invoice + receipt downloads), or null. */
  hostedInvoiceUrl: string | null;
}

export type PlanInvoiceDropReason = 'draft' | 'other_customer' | 'other_mode' | 'not_usd' | 'unknown_status' | 'unreadable';

export interface PlanInvoiceMapping {
  rows: PlanInvoiceRow[];
  /** Ids and reasons only (never a URL), for the orchestration's logs. */
  dropped: Array<{ id: string; reason: PlanInvoiceDropReason }>;
}

const REASONS: readonly PlanInvoiceReason[] = ['subscription_create', 'subscription_cycle', 'subscription_update'];
const STATUSES: readonly PlanInvoiceStatus[] = ['paid', 'open', 'void', 'uncollectible'];

export function planInvoiceReason(billingReason: string | null): PlanInvoiceReason {
  return REASONS.find((reason) => reason === billingReason) ?? 'other';
}

export interface PlanInvoiceMappingContext {
  /** OUR row's customer. */
  customerId: string;
  /** The server key's mode. */
  livemode: boolean;
  /** Price id → plan label, or null. */
  labelForPriceId: (priceId: string) => string | null;
  /**
   * Stripe's hosted-invoice URL check (`isHostedInvoiceUrl` in the billing
   * repository, the one P-6a uses), injected so this file stays import-free.
   */
  isHostedInvoiceUrl: (value: unknown) => value is string;
}

export function mapPlanInvoices(invoices: readonly BusinessOsInvoiceListFacts[], context: PlanInvoiceMappingContext): PlanInvoiceMapping {
  const rows: PlanInvoiceRow[] = [];
  const dropped: PlanInvoiceMapping['dropped'] = [];

  for (const invoice of invoices) {
    const drop = (reason: PlanInvoiceDropReason) => dropped.push({ id: invoice.id, reason });
    if (invoice.status === 'draft') {
      drop('draft');
      continue;
    }
    if (invoice.customerId !== context.customerId) {
      drop('other_customer');
      continue;
    }
    if (invoice.livemode !== context.livemode) {
      drop('other_mode');
      continue;
    }
    if (invoice.currency !== 'usd') {
      drop('not_usd');
      continue;
    }
    const status = STATUSES.find((known) => known === invoice.status);
    if (!status) {
      drop('unknown_status');
      continue;
    }
    if (!invoice.id || invoice.totalMinor === null || invoice.created === null) {
      drop('unreadable');
      continue;
    }

    let planLabel: string | null = null;
    for (const priceId of invoice.priceIds) {
      planLabel = context.labelForPriceId(priceId);
      if (planLabel !== null) break;
    }

    rows.push({
      id: invoice.id,
      createdAt: new Date(invoice.created * 1000).toISOString(),
      reason: planInvoiceReason(invoice.billingReason),
      planLabel,
      amountMinor: invoice.totalMinor,
      currency: 'usd',
      status,
      hostedInvoiceUrl: context.isHostedInvoiceUrl(invoice.hostedInvoiceUrl) ? invoice.hostedInvoiceUrl : null,
    });
  }

  return { rows, dropped };
}
