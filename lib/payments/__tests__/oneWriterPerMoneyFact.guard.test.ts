/**
 * One writer per money fact. Two triggers call each.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS EXISTS TO PREVENT
 *
 * `recordPlanPeriodPaid` lived inside `app/api/stripe/webhook/route.ts`, so the
 * only thing that could ever record a plan period was a webhook that arrived.
 * When one did not arrive, nothing else could write the money, because a
 * library may not import a route.
 *
 * Measured on live data, 2026-11-23: Stripe had collected 4,565.82 across ten
 * plan renewals this platform had no record of. Every guard in the writer
 * passes for those invoices — they were never recorded because nothing ever
 * called it for them. Meanwhile the nightly settlement check ran thirty times
 * and reported `gapsFound: 0`, because its window was 48 hours and the money
 * was older than that.
 *
 * The fix was not another patch beside the others. It was to make the writer
 * importable, call it from the reconciler as well as the webhook, and let the
 * reconciler repair what it finds instead of logging it.
 *
 * ── TWO FACTS, TWO WRITERS, AND THE SAME RULE FOR BOTH ──────────────────────
 *
 * There are two things Stripe knows that our tables must also know:
 *
 *   `recordPlanPeriodPaid`  money Stripe COLLECTED for a plan period
 *   `mirrorPlanBill`        a bill Stripe RAISED and is waiting to be paid
 *
 * Each has exactly one implementation in `lib/payments/`, and each is called
 * from both the webhook (when Stripe tells us) and the nightly sweep (when
 * Stripe turns out to have told us something we missed). This file pins that
 * shape for both, plus the sweep's two questions.
 *
 * ── THE FAILURE MODE THIS CATCHES ───────────────────────────────────────────
 *
 * Somebody needs one of these written from a third place — a backfill script,
 * an admin repair button — and writes a second copy of the insert because it is
 * quicker than importing. From that moment the platform has two answers to
 * "what does a recorded payment look like", and they drift. This asserts there
 * is one of each.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const writer = read('lib/payments/recordPlanPeriod.ts');
const mirror = read('lib/payments/mirrorPlanBill.ts');
const webhook = read('app/api/stripe/webhook/route.ts');
const deps = read('lib/payments/settlementGapCheckDeps.ts');
const check = read('lib/payments/settlementGapCheck.ts');

describe('there is exactly one writer of a plan period', () => {
  it('lives in lib, where anything may import it', () => {
    expect(writer).toContain('export async function recordPlanPeriodPaid');
  });

  it('the webhook calls it rather than carrying its own copy', () => {
    expect(webhook).toContain("from '@/lib/payments/recordPlanPeriod'");
    expect(webhook).not.toContain('async function recordPlanPeriodPaid');
  });

  it('the reconciler calls the same one', () => {
    expect(deps).toContain("from '@/lib/payments/recordPlanPeriod'");
    expect(deps).toContain('recordPlanPeriodPaid(');
  });

  it('nobody else inserts a plan-period transaction', () => {
    /*
     * `source: 'payment_plan'` is the fingerprint of a recorded period. If it
     * appears in a second file, a second writer has been born.
     */
    for (const [name, source] of [
      ['the webhook', webhook],
      ['the reconciler deps', deps],
    ] as const) {
      expect(`${name}: ${source.includes("source: 'payment_plan'")}`).toBe(`${name}: false`);
    }
    expect(writer).toContain("source: 'payment_plan'");
  });
});

describe('the writer is safe to call twice, which is what lets a sweep repair', () => {
  it('checks whether the invoice is already recorded before writing', () => {
    const beforeInsert = writer.slice(0, writer.indexOf('insertFromWebhookReturningId'));
    expect(beforeInsert).toContain('findInstallmentIdByStripeInvoiceId');
  });

  it('refuses money that never arrived, however Stripe labelled the invoice', () => {
    /* A cancellation proration is `status: paid` with `amount_paid: 0`. Taken at
       face value it once advanced a plan a period for nothing. */
    expect(writer).toContain('invoice.amount_paid ?? 0');
    expect(writer).toContain('collected <= 0');
  });

  it('proves the connected account owns the plan before writing', () => {
    const beforeInsert = writer.slice(0, writer.indexOf('insertFromWebhookReturningId'));
    expect(beforeInsert).toContain('ownsAccount');
  });
});

describe('there is exactly one writer of a plan bill, by the same reasoning', () => {
  /*
   * A plan's later periods are invoiced by STRIPE, not by us, so until this
   * existed those bills had no local row and nothing could see them: not the
   * owner's money page, not the client portal, and not the chaser, which reads
   * our tables and nothing else. Measured 2026-11-23: five of them, 2,000 ILS,
   * on plans due to close with the money uncollected.
   */
  it('lives in lib, where both the webhook and the sweep may import it', () => {
    expect(mirror).toContain('export async function mirrorPlanBill');
  });

  it('the webhook calls it rather than carrying its own copy', () => {
    expect(webhook).toContain("from '@/lib/payments/mirrorPlanBill'");
    expect(webhook).not.toContain('async function mirrorPlanRenewalInvoice');
  });

  it('the sweep calls the same one', () => {
    expect(deps).toContain("from '@/lib/payments/mirrorPlanBill'");
    expect(deps).toContain('mirrorPlanBill(');
  });

  it('nobody else inserts an invoice row for a Stripe-raised bill', () => {
    /* `paymentInvoiceRepository.create` with a `stripe_invoice_id` is the
       fingerprint. The webhook and the sweep must both be free of it. */
    for (const [name, source] of [
      ['the webhook', webhook],
      ['the sweep deps', deps],
    ] as const) {
      expect(`${name}: ${source.includes('stripe_hosted_invoice_url: invoice.hosted_invoice_url')}`).toBe(
        `${name}: false`
      );
    }
    expect(mirror).toContain('stripe_hosted_invoice_url: invoice.hosted_invoice_url');
  });

  it('proves the connected account owns the plan before writing', () => {
    const beforeInsert = mirror.slice(0, mirror.indexOf('paymentInvoiceRepository.create'));
    expect(beforeInsert).toContain('ownsAccount');
  });

  it('refuses to mirror a bill with nothing due', () => {
    /* A cancellation proration is an invoice with a negative total. Mirrored at
       face value it becomes a bill for a client who owes nothing. */
    expect(mirror).toContain('invoice.amount_due ?? 0');
    expect(mirror).toContain('amount <= 0');
  });

  it('reports false when the insert was refused, so a sweep cannot miscount', () => {
    /* The duplicate-key path. Returning true there would let the sweep report a
       bill as "made visible" on the run that did not write it. */
    const afterInsert = mirror.slice(mirror.indexOf('if (error) {'));
    expect(afterInsert.indexOf('return false;')).toBeLessThan(afterInsert.indexOf('return true;'));
  });
});

describe('the sweep asks about debts as well as payments', () => {
  it('has a listing for what Stripe is still owed', () => {
    expect(check).toContain('listOpenInvoices?(');
    expect(deps).toContain('listOpenInvoices:');
  });

  it('treats an unseen bill as a state, not an event - so no window', () => {
    /*
     * The paid sweep narrows to a window because a payment happened at a
     * moment. A debt persists, and the oldest unseen one is the worst, so
     * narrowing here would retire exactly the findings that matter most. This
     * pins that `checkOpenBills` never filters on the window.
     */
    const open = check.slice(check.indexOf('async function checkOpenBills'), check.indexOf('async function checkBill'));
    expect(open).not.toContain('window');
  });

  it('a bill that already has a local row is not a finding', () => {
    /* Whether that row says `sent` or `overdue` belongs to the overdue sweep.
       This asks only whether the debt is visible at all. */
    expect(check).toContain('if (local.found) return;');
  });

  it('warns rather than errors, because an unseen debt is not a corrupt book', () => {
    /*
     * An unrecorded payment corrupts the books, so it is an error. An unseen
     * debt is usually not ours at all - an owner's own Stripe subscription,
     * which the mirror correctly declines - and erroring would page somebody
     * nightly for ever about something correct.
     */
    const bill = check.slice(check.indexOf('async function checkBill'));
    expect(bill).toContain("event: 'stripe_invisible_bill_found'");
    const found = bill.indexOf("event: 'stripe_invisible_bill_found'");
    expect(bill.lastIndexOf('logger.warn', found)).toBeGreaterThan(bill.lastIndexOf('logger.error', found));
  });

  it('a failed mirror does not abandon the remaining accounts', () => {
    const block = check.slice(check.indexOf('if (deps.mirrorBill)'), check.indexOf("event: 'stripe_invisible_bill_mirrored'"));
    expect(block).toContain('catch');
    expect(block).not.toContain('throw');
  });

  it('asks Stripe on the connected account, not the platform', () => {
    expect(deps).toContain('stripeRequestOptions(bill.accountId)');
  });
});

describe('the reconciler repairs rather than only reporting', () => {
  it('takes a repairer and counts what it did', () => {
    expect(check).toContain('repairGap?(gap: SettlementGap): Promise<boolean>');
    expect(check).toContain('result.gapsRepaired += 1');
    expect(check).toContain('result.repairFailed += 1');
  });

  it('still records the gap even when the repair works', () => {
    /* The finding is never lost; only the sentence changes. An audit of what
       the platform missed must survive the fact that it fixed it. */
    const block = check.slice(check.indexOf('result.gaps.push(gap)'), check.indexOf('stripe_settlement_gap_found'));
    expect(block).toContain('result.gaps.push(gap)');
    expect(block.indexOf('result.gaps.push(gap)')).toBeLessThan(block.indexOf('deps.repairGap'));
  });

  it('a failed repair does not abandon the remaining accounts', () => {
    /* The other targets still hold money nobody has recorded. Re-raising would
       trade the many for the one. */
    const block = check.slice(check.indexOf('if (deps.repairGap)'), check.indexOf('stripe_settlement_gap_found'));
    expect(block).toContain('catch');
    expect(block).not.toContain('throw');
  });

  it('asks Stripe on the connected account, not the platform', () => {
    /* The account belongs in the third argument. In the second it is Stripe's
       params bag, and the invoice 404s on the platform account. */
    expect(deps).toContain('stripeRequestOptions(gap.accountId)');
  });
});
