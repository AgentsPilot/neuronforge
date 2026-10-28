/**
 * "Payment Required" always comes with a way to pay.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * A course sold for $70. The client's confirmation read:
 *
 *     Your order is confirmed!
 *     Mental Training Course · Price $70.00
 *     Payment Required: Please complete your payment of $70.00 to confirm
 *                       your order.
 *
 * and there was no Pay button under it. The client is told to pay and handed
 * nothing to pay with.
 *
 * The two halves had different sources. The NOTICE is drawn from
 * `hasPendingPayment` — the booking's status and the service's price, both
 * always available. The BUTTON needed `data.paymentUrl`, and the sender minted
 * one only when `options.invoiceId` was passed in:
 *
 *     const hasInvoice = !!options?.invoiceId;
 *
 * Exactly one caller holds that: `createBooking`, which has just raised the
 * invoice. Every other sender produced the notice with no button. The one an
 * owner actually meets is "Send again" — the resend route passes
 * `skipInvoice: true` and nothing else.
 *
 * That flag's comment is right about what it is for: re-sending an email must
 * not raise a second, real charge. The fault was that not RAISING an invoice
 * and not LINKING to the one already on the booking had become the same flag.
 *
 * Measured on the reported booking: the invoice was raised 0.7s after the
 * booking and the first confirmation went out 7s later WITH its button; the
 * owner pressed "Send again" 52s after that, and the second mail — the one in
 * the screenshot — had the notice and no button.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * `sendBookingConfirmation` is ~200 lines of a service with no injection seam:
 * it reaches for `supabaseServer`, the token signer, the template and the
 * transport. There is no existing harness that renders one, and the repo's own
 * precedent for this shape is `publicBookingWiring.test.ts` — assert the
 * wiring, because the wiring is the thing that broke.
 *
 * The status filter is the half that could do harm if it drifted, so it is
 * asserted clause by clause.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const sender = read('lib/services/BookingEmailService.ts');
const resend = read('app/api/scheduling/bookings/[id]/resend/route.ts');
const template = read('lib/email/templates/booking-confirmation.ts');

/** The block that decides whether a pay link is minted. */
const payBlock = (() => {
  const from = sender.indexOf('THE BILL IS ON THE BOOKING');
  expect(from).toBeGreaterThan(-1);

  return sender.slice(from, sender.indexOf('Checking payment URL conditions', from));
})();

describe('the button no longer depends on who is sending', () => {
  it('does not read the caller alone', () => {
    expect(sender).not.toMatch(/const hasInvoice = !!options\?\.invoiceId;/);
  });

  it('falls back to the invoice already on the booking', () => {
    expect(payBlock).toMatch(/let linkableInvoiceId = options\?\.invoiceId/);
    expect(payBlock).toMatch(/from\('payment_invoices'\)/);
    expect(payBlock).toMatch(/\.eq\('booking_id', bookingId\)/);
  });

  it('and the link is minted from whichever was found', () => {
    expect(sender).toMatch(/invoiceId: linkableInvoiceId!/);
    expect(sender).not.toMatch(/invoiceId: options!\.invoiceId!/);
  });
});

describe('the lookup cannot invite a client to pay the wrong thing', () => {
  it('offers only invoices that are actually owed', () => {
    /*
     * A `cancelled` invoice is not owed — the owner called it off — and
     * linking to one would ask a client for money that is no longer wanted.
     * `paid` and `refunded` are already excluded by `isPending`, but naming
     * the allowed set keeps that from being the only thing standing between a
     * client and a receipt with a Pay button on it.
     */
    expect(payBlock).toMatch(/\.in\('status', \['draft', 'sent', 'overdue'\]\)/);
  });

  it('stays inside the owner’s own data', () => {
    // CLAUDE.md rule 4, on a service-role client.
    expect(payBlock).toMatch(/\.eq\('user_id', userId\)/);
  });

  it('takes the most recent, not an arbitrary row', () => {
    expect(payBlock).toMatch(/\.order\('created_at', \{ ascending: false \}\)/);
    expect(payBlock).toMatch(/\.limit\(1\)/);
  });

  it('asks nothing when nothing is owed', () => {
    /* No money due, no query: this runs on every confirmation sent. */
    expect(payBlock).toMatch(/if \(!linkableInvoiceId && isPending && hasPrice\)/);
  });

  it('sends the email anyway if the lookup fails', () => {
    // The mail is worth more than the button.
    expect(payBlock).toMatch(/Could not look up an invoice for the pay button/);
  });
});

describe('what must not change', () => {
  it('a resend still refuses to raise a second invoice', () => {
    /*
     * The whole point of `skipInvoice`, and the reason this was fixed in the
     * sender rather than by handing the resend an invoice id to create.
     */
    const confirmed = resend.slice(
      resend.indexOf("case 'booking_confirmed':"),
      resend.indexOf("case 'booking_rescheduled'"),
    );

    expect(confirmed).toMatch(/skipInvoice: true/);
  });

  it('nothing in the pay-link path creates an invoice', () => {
    expect(payBlock).not.toMatch(/insert\(|createBookingInvoice/);
  });

  it('the template still gates the button on having a URL', () => {
    /* The notice without a button is what this is all about; the button
       without a URL would be a dead link. */
    expect(template).toMatch(/data\.paymentUrl \? emailButton\(t\.payNow\[locale\]/);
  });
});
