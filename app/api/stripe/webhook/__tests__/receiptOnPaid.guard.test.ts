/**
 * A client who pays an invoice is told their money arrived.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS MISSING
 *
 * Every other way an invoice settles sends a receipt, because they all go
 * through `settleInvoicePaid`: the owner's "mark as paid", the invoice send
 * route, the website checkout, the retry cron. The Stripe webhook records the
 * payment ITSELF and so sent nothing.
 *
 * The effect on a real client, verified on INV-00018: the booking confirmation
 * arrived at 18:24:55, before any money moved; the ₪300 settled at 18:25:57;
 * and no email followed. They paid and heard nothing — no record of what left
 * their account, and nothing to keep.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The handler needs a signed Stripe event, a connected account and a database
 * before it does anything, and what went wrong is a missing call — which is
 * exactly what a reader can check. The properties below are the ones that make
 * the receipt correct rather than merely present.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const webhook = readFileSync(
  join(process.cwd(), 'app', 'api', 'stripe', 'webhook', 'route.ts'),
  'utf8'
);

/** The connect invoice.paid handler, where the money is recorded. */
const handler = webhook.slice(
  webhook.indexOf('async function handleConnectInvoicePaid'),
  webhook.indexOf('async function', webhook.indexOf('async function handleConnectInvoicePaid') + 40)
);

describe('settling a Stripe-paid invoice', () => {
  it('sends the receipt', () => {
    expect(handler).toContain('BookingEmailService.sendPaymentReceipt');
  });

  it('tells the client what THEY were charged, not what reached the balance', () => {
    /*
     * Stripe reports the fee and the net from the balance transaction, in the
     * account's settlement currency — ₪300 arrives as $94.08 net. A receipt
     * built from that would name a sum in a currency the client never saw.
     */
    expect(handler).toContain('amount: fromMinorUnits(invoice.amount_paid, invoiceCurrency)');
    expect(handler).toContain('currency: receiptInvoice.currency || invoiceCurrency');
  });

  it('never fails the webhook over an email', () => {
    // Stripe retries a failed delivery, which would re-enter a handler that has
    // already recorded the payment.
    const receiptBlock = handler.slice(handler.indexOf('THE RECEIPT'));
    expect(receiptBlock).toContain('void (async () => {');
    expect(receiptBlock).toContain('catch (receiptError)');
  });

  it('says so rather than going quiet when there is nobody to send to', () => {
    expect(handler).toContain('No client email on this invoice; no receipt to send');
  });

  it('runs after the payment and the invoice are written', () => {
    // A receipt for money that failed to record is worse than no receipt.
    const paymentWrite = handler.indexOf('Payment transaction created for invoice');
    const receipt = handler.indexOf('sendPaymentReceipt');
    expect(paymentWrite).toBeGreaterThan(-1);
    expect(receipt).toBeGreaterThan(paymentWrite);
  });
});
