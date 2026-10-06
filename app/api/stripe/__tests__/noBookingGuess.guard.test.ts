/**
 * A paid invoice is never matched to a booking by guesswork.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * The Connect `invoice.paid` handler used to have a fallback: when an invoice
 * carried no `booking_id`, it looked for one — same contact, a booking whose
 * SERVICE PRICE equalled the invoice amount, most recent unpaid one wins. On a
 * match it marked that booking paid and wrote its id onto the invoice.
 *
 * Three loose signals cannot tell an invoice raised FOR a booking from a
 * standalone invoice that happens to cost the same. For a business selling one
 * service repeatedly at one price that is not an edge case, it is the ordinary
 * shape of the data.
 *
 * On live data it bound a standalone ₪300 invoice, at the moment it was paid, to
 * an unrelated booking three days older that already had its own ₪300 invoice.
 * Two silent consequences:
 *
 *   · the invoice left the "invoices without an order" tab and merged into that
 *     booking's row, which then read ₪600 overdue — one paid invoice and one
 *     unpaid, added together as though they were one job;
 *   · the booking was marked PAID by money that was never for it.
 *
 * And `booking_id` is what every later read follows, so the binding was
 * permanent.
 *
 * A SOURCE GUARD, because the alternative is standing up a Stripe webhook, a
 * Connect account and a matching booking to prove a negative. What has to stay
 * true is structural — this handler must not query bookings by contact-and-price
 * — and that is exactly what a source assertion can hold.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const webhook = fs.readFileSync(
  path.join(process.cwd(), 'app/api/stripe/webhook/route.ts'),
  'utf8'
);

/** The `invoice.paid` handler, where the guess used to live. */
function connectInvoicePaidHandler(): string {
  const start = webhook.indexOf('async function handleConnectInvoicePaid');
  expect(start).toBeGreaterThan(-1);
  // To the next top-level function, which bounds the handler well enough.
  const next = webhook.indexOf('\nasync function ', start + 1);
  return webhook.slice(start, next === -1 ? undefined : next);
}

describe('paying an invoice never invents a booking link', () => {
  it('does not search for a booking to attach a paid invoice to', () => {
    // The exact shape of the old fallback: find a booking, then adopt it.
    expect(webhook).not.toMatch(/matchingBooking/);
  });

  it('never writes booking_id onto an invoice from the paid handler', () => {
    /*
     * The permanent half of the damage. Marking a booking paid is recoverable;
     * writing the id onto the invoice is what every later read then follows.
     */
    const handler = connectInvoicePaidHandler();

    expect(handler).not.toMatch(/from\(['"]payment_invoices['"]\)[\s\S]{0,200}booking_id:/);
  });

  it('does not match a booking by its service price', () => {
    // `Math.abs(servicePrice - invoiceAmount) < 0.01` was the whole test that
    // bound unrelated money together.
    const handler = connectInvoicePaidHandler();

    expect(handler).not.toMatch(/servicePrice/);
    expect(handler).not.toMatch(/scheduling_services\(price\)/);
  });

  it('still marks the booking paid when the invoice genuinely names one', () => {
    /*
     * The other half, and the reason this is not simply "delete the code". An
     * invoice raised against a booking carries `booking_id` from creation, and
     * that booking must still be settled when it is paid.
     */
    const handler = connectInvoicePaidHandler();

    expect(handler).toMatch(/if \(platformInvoice\.booking_id\)/);
    expect(handler).toMatch(/payment_status: 'paid'/);
  });

  it('says in the log that an unlinked invoice was left unlinked', () => {
    // So the next person reading production logs sees a decision rather than a
    // gap, and does not re-add the guess to "fix" the silence.
    const handler = connectInvoicePaidHandler();

    expect(handler).toMatch(/left unlinked rather than matched by guess/);
  });
});
