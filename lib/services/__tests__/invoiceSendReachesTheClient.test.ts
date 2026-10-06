/**
 * "Create and send" has to put the invoice in front of the client.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * `sendInvoice` treated a hosted Stripe invoice url as proof of delivery and
 * sent nothing of its own. That is true in live mode, where Stripe emails the
 * invoice — and false in TEST mode, where Stripe accepts it, finalises it,
 * emits `invoice.sent`, and emails nobody.
 *
 * So every sandbox send reported success and no client received anything.
 * Measured on the reporting account: fifteen invoices in one evening, each with
 * `sent_at` stamped within six seconds of creation, not one email. The platform
 * had a working branded email path the whole time; it was simply skipped
 * whenever Stripe had answered.
 *
 * The decision is tested here rather than through `sendInvoice`, which needs a
 * business profile, a connected account, a PDF renderer and a mail transport
 * before it reaches the branch. The call site is pinned by the source guard
 * below, which is the half a unit test of the predicate cannot see.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

// The service imports the PDF renderer, which ships ESM that jest does not
// transform. Nothing here renders a PDF, so the module is stubbed rather than
// the whole suite being given a transform it needs for one import.
jest.mock('@/lib/pdf/InvoicePDFGenerator', () => ({ generateInvoicePDFAsync: jest.fn() }));

import { stripeEmailsTheClient } from '../InvoiceDeliveryService';

const warnings: string[] = [];
const log = {
  debug: () => undefined,
  info: () => undefined,
  warn: (_context: Record<string, unknown>, message: string) => {
    warnings.push(message);
  },
  error: () => undefined,
};

const saved = process.env.STRIPE_SECRET_KEY;

beforeEach(() => {
  warnings.length = 0;
});

afterAll(() => {
  process.env.STRIPE_SECRET_KEY = saved;
});

describe('who is responsible for emailing the client', () => {
  it('is Stripe, in live mode, where it actually sends', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_exampleexampleexample';
    expect(stripeEmailsTheClient(log)).toBe(true);
  });

  it('is us, in test mode, because Stripe emails nobody from a sandbox', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_exampleexampleexample';
    expect(stripeEmailsTheClient(log)).toBe(false);
  });

  it('is us when the key cannot be read at all, and says so', () => {
    // Failing towards sending: an email the client did not strictly need is a
    // far smaller fault than a bill they never saw.
    delete process.env.STRIPE_SECRET_KEY;
    expect(stripeEmailsTheClient(log)).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  it('never echoes the key, not even a prefix of it', () => {
    process.env.STRIPE_SECRET_KEY = 'nonsense_value_that_is_not_a_key';
    stripeEmailsTheClient(log);
    expect(warnings.join(' ')).not.toContain('nonsense');
  });
});

describe('the send path uses that answer', () => {
  const code = fs
    .readFileSync(path.join(process.cwd(), 'lib/services/InvoiceDeliveryService.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('treats a hosted url as delivery only when Stripe is the one delivering', () => {
    // The bug in one line: `if (!hostedInvoiceUrl)` as the gate on emailing.
    expect(code).toMatch(/const stripeDelivered = Boolean\(hostedInvoiceUrl\) && stripeEmailsTheClient\(log\)/);
    expect(code).not.toMatch(/if \(!hostedInvoiceUrl\) \{\s*const emailed = await sendByEmail/);
  });

  it('emails whenever Stripe did not', () => {
    expect(code).toMatch(/if \(!stripeDelivered\) \{/);
    expect(code).toMatch(/const sentVia: 'stripe' \| 'email' = stripeDelivered \? 'stripe' : 'email'/);
  });

  it('gives that email the hosted page as its pay link', () => {
    // Otherwise the fallback offers the platform's own pay route for an invoice
    // Stripe is already hosting: two pay pages for one bill.
    expect(code).toMatch(/if \(hostedInvoiceUrl\) invoice\.stripe_hosted_invoice_url = hostedInvoiceUrl;/);
  });
});
