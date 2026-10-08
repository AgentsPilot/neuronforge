/**
 * An invoice's PaymentIntent must never carry `owner_id`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS THE RULE
 *
 * Two webhook handlers can each record one payment, and they dedupe on
 * DIFFERENT keys:
 *
 *   payment_intent.succeeded  →  upserts on `stripe_payment_intent_id`,
 *                                writes no `invoice_id`
 *   invoice.paid              →  looks for an existing row by `invoice_id`
 *
 * A row written by the first is therefore invisible to the second, whose
 * insert then collides on the unique payment-intent id and throws. Because the
 * invoice is marked paid only after that insert, the failure leaves the money
 * taken and the bill outstanding, and every Stripe retry hits the same wall.
 *
 * The only thing keeping that unreachable is the owner check in
 * `handleConnectPaymentIntentSucceeded`: Stripe creates an invoice's
 * PaymentIntent itself, with no metadata, so the handler logs
 * "invoice-backed; invoice.paid owns it" and returns. The code says as much in
 * its own words — "that is the guard doing its job by accident, which is worth
 * saying out loud rather than relying on quietly."
 *
 * Embedding invoice payment is exactly the change that could break it: if a
 * surface creates or updates an invoice-backed PaymentIntent and stamps our
 * `owner_id` on it, the accident stops holding. The embed must CONFIRM the
 * secret the invoice already carries (`confirmation_secret`) and write no
 * metadata.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
const codeOf = (file: string) =>
  read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const WEBHOOK = 'app/api/stripe/webhook/route.ts';

describe('the payment-intent handler', () => {
  it('still defers an untagged, invoice-backed intent to invoice.paid', () => {
    const code = codeOf(WEBHOOK);
    // No owner on the intent → it is Stripe's, raised for an invoice.
    expect(code).toMatch(/const ownerId = intent\.metadata\?\.owner_id;/);
    expect(code).toMatch(/if \(!ownerId\)/);
    // And the handler leaves rather than recording it.
    expect(code).toMatch(/looksStripeGenerated/);
  });

  it('invoice.paid no longer assumes it is the only writer', () => {
    const code = codeOf(WEBHOOK);
    // It must look the row up by intent as well as by invoice…
    expect(code).toMatch(/\.eq\('stripe_payment_intent_id', paymentIntentId\)/);
    // …and attach rather than insert a colliding row.
    expect(code).toMatch(/alreadyRecorded/);
    expect(code).toMatch(/\.update\(\{ invoice_id: platformInvoice\.id \}\)/);
  });
});

describe('no surface stamps an owner on an invoice-backed intent', () => {
  /**
   * The embed reaches an invoice's intent through `confirmation_secret`, which
   * confirms what Stripe already created. Creating a PaymentIntent FOR an
   * invoice, or updating one, is what would attach our metadata.
   */
  const SURFACES = [
    'app/api/website/payment-intent/route.ts',
    'app/api/public/invoice/[id]/pay/route.ts',
  ];

  it.each(SURFACES)('%s never updates a payment intent', file => {
    let code: string;
    try {
      code = codeOf(file);
    } catch {
      // A surface that does not exist yet cannot break the rule.
      return;
    }
    expect(code).not.toMatch(/paymentIntents\.update\(/);
  });

  it('the subscription path reads confirmation_secret, not payment_intent', () => {
    const code = codeOf('app/api/website/payment-intent/route.ts');
    expect(code).toMatch(/latest_invoice\.confirmation_secret/);
    // `invoice.payment_intent` is gone on this API version; reading it returns
    // undefined and the secret silently never arrives.
    expect(code).not.toMatch(/invoice\.payment_intent\b/);
  });
});
