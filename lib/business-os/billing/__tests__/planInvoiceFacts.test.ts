/**
 * planInvoiceFacts (plan payments P-3b.2, workplan §3.2 "the handler decides",
 * §3.7, §8): the facts of a plan invoice, pure.
 *
 * Tier names here are placeholders (`tier_one`, `tier_two`): the function never
 * validates a tier, the apply use case does (RC-1), so the tests stay free of
 * real tier names (FR-12).
 */

import fs from 'fs';
import path from 'path';
import type Stripe from 'stripe';

import { planInvoiceFacts, planInvoiceIdentity } from '@/lib/business-os/billing/planInvoiceFacts';

const FIXTURES = path.join(__dirname, 'fixtures', 'stripe');
const invoiceFrom = (name: string): Stripe.Invoice =>
  (JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) as Stripe.Event).data.object as Stripe.Invoice;

const CREATE = invoiceFrom('invoice-paid-subscription-create.json');
const PRORATION = invoiceFrom('invoice-paid-proration.json');
const RENEWAL = invoiceFrom('invoice-paid-renewal.json');
const TRIAL = invoiceFrom('invoice-paid-trial-zero.json');
const FAILED = invoiceFrom('invoice-payment-failed.json');

const PRICE_A = 'price_probe_a_handbuilt';
const PRICE_B = 'price_probe_b_handbuilt';
const TIERS: Record<string, string> = { [PRICE_A]: 'tier_one', [PRICE_B]: 'tier_two' };
const tierOf = (priceId: string) => TIERS[priceId] ?? null;

function edit(invoice: Stripe.Invoice, change: (copy: Stripe.Invoice) => void): Stripe.Invoice {
  const copy = JSON.parse(JSON.stringify(invoice)) as Stripe.Invoice;
  change(copy);
  return copy;
}

const iso = (unix: number) => new Date(unix * 1000).toISOString();

function facts(invoice: Stripe.Invoice, kind: 'paid' | 'failed' = 'paid') {
  return planInvoiceFacts(invoice, invoice.lines.data, tierOf, kind);
}

describe('planInvoiceFacts: a first paid invoice', () => {
  it('reads every fact from the Basil shape', () => {
    expect(facts(CREATE)).toEqual({
      ok: true,
      facts: {
        invoiceId: CREATE.id,
        customerId: 'cus_probe_1',
        subscriptionId: 'sub_probe_1',
        bosUserIdClaim: null,
        currency: 'usd',
        tier: 'tier_one',
        periodStart: iso(1790000000),
        periodEnd: iso(1792592000),
        amountMinor: 2000,
        amountTaxMinor: 0,
        paidAt: iso(1790000070),
        assignsPlan: true,
        billingReason: CREATE.billing_reason,
      },
    });
  });

  it('the legacy line shape (`line.price`) and the legacy `invoice.subscription` still read', () => {
    const legacy = edit(CREATE, (i) => {
      const line = i.lines.data[0] as unknown as Record<string, unknown>;
      line.price = { id: PRICE_A };
      delete line.pricing;
      (i as unknown as Record<string, unknown>).subscription = 'sub_legacy_1';
      delete (i as unknown as Record<string, unknown>).parent;
    });
    const out = facts(legacy);
    expect(out.ok && out.facts.tier).toBe('tier_one');
    expect(out.ok && out.facts.subscriptionId).toBe('sub_legacy_1');
  });

  it('an expanded customer object gives its id', () => {
    const out = facts(edit(CREATE, (i) => { (i as unknown as { customer: unknown }).customer = { id: 'cus_obj' }; }));
    expect(out.ok && out.facts.customerId).toBe('cus_obj');
  });
});

describe('planInvoiceFacts: tier and period from the POSITIVE plan lines', () => {
  it('an upgrade proration: the negative credit line for the old tier is ignored', () => {
    const out = facts(PRORATION);
    expect(out).toMatchObject({ ok: true, facts: { tier: 'tier_two', amountMinor: 2985, assignsPlan: true } });
  });

  it('two positive plan lines on different tiers are refused (mixed_tiers)', () => {
    const mixed = edit(PRORATION, (i) => {
      i.lines.data[0].amount = 100;
    });
    expect(facts(mixed)).toMatchObject({ ok: false, reason: 'mixed_tiers', identity: { invoiceId: PRORATION.id } });
  });

  it('the period is the earliest start and latest end over the deciding lines', () => {
    const twoPeriods = edit(CREATE, (i) => {
      const second = JSON.parse(JSON.stringify(i.lines.data[0])) as Stripe.InvoiceLineItem;
      second.period = { start: 1792592000, end: 1795184000 };
      i.lines.data.push(second);
    });
    const out = facts(twoPeriods);
    expect(out.ok && [out.facts.periodStart, out.facts.periodEnd]).toEqual([iso(1790000000), iso(1795184000)]);
  });

  it('a line that is not a plan price does not name the tier', () => {
    const extra = edit(CREATE, (i) => {
      const other = JSON.parse(JSON.stringify(i.lines.data[0])) as Stripe.InvoiceLineItem;
      (other.pricing as unknown as { price_details: { price: string } }).price_details.price = 'price_not_a_plan';
      other.amount = 999;
      i.lines.data.push(other);
    });
    expect(facts(extra)).toMatchObject({ ok: true, facts: { tier: 'tier_one' } });
  });

  it('no plan line at all is refused (no_plan_line)', () => {
    expect(planInvoiceFacts(CREATE, CREATE.lines.data, () => null, 'paid')).toMatchObject({ ok: false, reason: 'no_plan_line' });
  });

  it('a line with no period, or an end not after its start, is malformed', () => {
    expect(facts(edit(CREATE, (i) => { (i.lines.data[0] as unknown as { period: null }).period = null; }))).toMatchObject({
      ok: false,
      reason: 'malformed_invoice',
    });
    expect(facts(edit(CREATE, (i) => { i.lines.data[0].period = { start: 1790000000, end: 1790000000 }; }))).toMatchObject({
      ok: false,
      reason: 'malformed_invoice',
    });
  });
});

describe('planInvoiceFacts: assigns-plan (SA-P8, SA-P16c)', () => {
  it('a $0 trial invoice records but assigns no plan; its tier still comes from the plan line', () => {
    expect(facts(TRIAL)).toMatchObject({ ok: true, facts: { amountMinor: 0, assignsPlan: false, tier: 'tier_one' } });
  });

  it('a renewal (subscription_cycle) with an amount assigns the plan, with its own period', () => {
    expect(facts(RENEWAL)).toMatchObject({
      ok: true,
      facts: { assignsPlan: true, billingReason: 'subscription_cycle', periodStart: iso(1792592000), periodEnd: iso(1795184000) },
    });
  });

  it('a 100% discounted cycle invoice ($0) still assigns the plan', () => {
    const free = edit(RENEWAL, (i) => {
      i.amount_paid = 0;
      i.lines.data[0].amount = 0;
      (i as unknown as { discounts: string[] }).discounts = ['di_1'];
    });
    expect(facts(free)).toMatchObject({ ok: true, facts: { amountMinor: 0, assignsPlan: true } });
  });

  it('a $0 cycle invoice WITHOUT a discount assigns nothing; a $0 subscription_update does not either (C-3, CF-6)', () => {
    const noDiscount = edit(RENEWAL, (i) => {
      i.amount_paid = 0;
      i.lines.data[0].amount = 0;
    });
    expect(facts(noDiscount)).toMatchObject({ ok: true, facts: { assignsPlan: false } });
    const update = edit(PRORATION, (i) => {
      i.amount_paid = 0;
      (i as unknown as { discounts: string[] }).discounts = ['di_1'];
    });
    expect(facts(update)).toMatchObject({ ok: true, facts: { assignsPlan: false } });
  });

  it('a failed invoice never assigns a plan, reads amount_due, and needs no paid_at', () => {
    expect(facts(FAILED, 'failed')).toMatchObject({
      ok: true,
      facts: { tier: 'tier_two', amountMinor: FAILED.amount_due, paidAt: null, assignsPlan: false },
    });
  });
});

describe('planInvoiceFacts: amounts, currency, paid_at, claims', () => {
  it('tax is the sum of total_taxes[].amount', () => {
    const taxed = edit(CREATE, (i) => {
      (i as unknown as { total_taxes: Array<{ amount: number }> }).total_taxes = [{ amount: 120 }, { amount: 35 }];
    });
    expect(facts(taxed)).toMatchObject({ ok: true, facts: { amountTaxMinor: 155 } });
  });

  it('a legacy invoice without total_taxes falls back to `tax`', () => {
    const legacy = edit(CREATE, (i) => {
      delete (i as unknown as Record<string, unknown>).total_taxes;
      (i as unknown as { tax: number }).tax = 77;
    });
    expect(facts(legacy)).toMatchObject({ ok: true, facts: { amountTaxMinor: 77 } });
  });

  it('a non-USD invoice is NOT refused here (the caller applies SA-P15), the currency is reported lower-case', () => {
    expect(facts(edit(CREATE, (i) => { i.currency = 'EUR'; }))).toMatchObject({ ok: true, facts: { currency: 'eur' } });
  });

  it('a paid invoice without status_transitions.paid_at is malformed', () => {
    const out = facts(edit(CREATE, (i) => { i.status_transitions.paid_at = null; }));
    expect(out).toMatchObject({ ok: false, reason: 'malformed_invoice', identity: { invoiceId: CREATE.id, amountMinor: 2000 } });
  });

  it.each([
    ['no customer', (i: Stripe.Invoice) => { (i as unknown as { customer: null }).customer = null; }],
    ['no subscription', (i: Stripe.Invoice) => { (i as unknown as { parent: null }).parent = null; }],
    ['no id', (i: Stripe.Invoice) => { (i as unknown as { id: null }).id = null; }],
    ['an unreadable amount', (i: Stripe.Invoice) => { (i as unknown as { amount_paid: string }).amount_paid = '20'; }],
    ['an unreadable tax entry', (i: Stripe.Invoice) => { (i as unknown as { total_taxes: unknown[] }).total_taxes = [{ amount: -1 }]; }],
  ])('%s is malformed, never guessed', (_label, change) => {
    expect(facts(edit(CREATE, change))).toMatchObject({ ok: false, reason: 'malformed_invoice' });
  });

  it('bos_user_id is read from the subscription snapshot first, then the invoice: a cross-check value only', () => {
    const both = edit(CREATE, (i) => {
      i.parent!.subscription_details!.metadata = { bos_user_id: 'from-subscription' };
      i.metadata = { bos_user_id: 'from-invoice' };
    });
    expect(facts(both)).toMatchObject({ ok: true, facts: { bosUserIdClaim: 'from-subscription' } });
    const invoiceOnly = edit(CREATE, (i) => {
      i.metadata = { bos_user_id: 'from-invoice' };
    });
    expect(facts(invoiceOnly)).toMatchObject({ ok: true, facts: { bosUserIdClaim: 'from-invoice' } });
  });

  it('identity reads what it can from a refused invoice', () => {
    expect(planInvoiceIdentity(edit(CREATE, (i) => { i.currency = 'GBP'; }), 'paid')).toEqual({
      invoiceId: CREATE.id,
      customerId: 'cus_probe_1',
      subscriptionId: 'sub_probe_1',
      bosUserIdClaim: null,
      currency: 'gbp',
      amountMinor: 2000,
      amountTaxMinor: 0,
      paidAt: iso(1790000070),
    });
  });
});
