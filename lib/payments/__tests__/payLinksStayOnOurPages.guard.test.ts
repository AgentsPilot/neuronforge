/**
 * Every "Pay now" an email sends opens one of OUR pages.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * Five senders carry a Pay button — the booking confirmation, the rescheduled
 * email, the invoice itself, the payment reminders, and the insight-driven
 * chase. Each decided its own destination, and all five decided the same way:
 *
 *     invoice.stripe_hosted_invoice_url || <something of ours>
 *
 * So a client paying from email landed on `invoice.stripe.com`. Stripe's
 * branding, Stripe's layout, nothing belonging to the business whose bill it
 * was, and no sign of the appointment it was for — on the one screen where the
 * business is most obviously asking to be trusted with money.
 *
 * It was reasoned, not careless: `PaymentReminderService` said so in a comment,
 * "Stripe's hosted page is preferred because it can actually take the money".
 * That was true when it was written. The portal and the invoice page both mount
 * Stripe's Payment Element now, so the hosted page buys nothing and costs the
 * frame.
 *
 * Two of eleven invoices on this database carry a hosted URL at all — one
 * raised outside Stripe has none — so for most invoices the preference fell
 * through to our page anyway, which is why the ones that did go to Stripe were
 * easy to miss.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE
 *
 *   · an invoice with a booking behind it  → the portal, `?pay=1`
 *   · an invoice with none                 → `/invoice/[id]`
 *   · never `stripe_hosted_invoice_url`, and never `/pay`, which redirects there
 *
 * One function decides it for all five, so the next sender cannot quietly
 * reach a sixth conclusion.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
/** Comments explain the rule; only code can break it. */
const codeOf = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

/** Every sender that offers a way to pay. */
const SENDERS = [
  'lib/services/BookingEmailService.ts',
  'lib/services/InvoiceDeliveryService.ts',
  'lib/services/PaymentReminderService.ts',
  'lib/services/InsightActionDispatchService.ts',
  /*
   * The quote-acceptance redirect, added after it was found hand-building
   * `/invoice/<id>?t=` while every other sender went through the one
   * function. It was signed, so the OTHER guard — which only checks that a
   * token is appended — passed it; nothing checked where it pointed.
   *
   * A client who has just accepted a quote and owes a deposit was sent to the
   * invoice document rather than to the portal, where the appointment they
   * agreed to is on screen beside the amount. That is the single most
   * important moment in the whole flow to get right.
   */
  'app/api/proposal/[token]/route.ts',
];

describe('no email sends a client to Stripe to pay', () => {
  it.each(SENDERS)('%s never uses the hosted URL as a destination', file => {
    const code = codeOf(file);

    /*
     * Reading the column is fine — `InvoiceDeliveryService` STORES it, and
     * that is how the owner finds the invoice in their Stripe dashboard. What
     * must not happen is handing it to a client as somewhere to go, which in
     * every one of these files looked like `hosted || ours`.
     */
    expect(code).not.toMatch(/stripe_hosted_invoice_url\s*\|\|/);
    expect(code).not.toMatch(/stripeHostedInvoiceUrl\s*\|\|/);
    expect(code).not.toMatch(/payUrl:\s*invoice\.stripe_hosted_invoice_url/);
  });

  it.each(SENDERS)('%s never points a client at /pay, which only redirects', file => {
    // `/api/public/invoice/[id]/pay` 302s to Stripe's hosted page, or mints a
    // Checkout Session and 302s to that. One step further from the business.
    expect(codeOf(file)).not.toMatch(/\/api\/public\/invoice\/\$\{[^}]+\}\/pay/);
  });

  it.each(SENDERS)('%s resolves the destination through the one function', file => {
    expect(codeOf(file)).toMatch(/invoicePayLink\(/);
  });
});

describe('the rule itself', () => {
  const link = codeOf('lib/payments/invoicePayLink.ts');

  it('prefers the portal when a booking is behind the invoice', () => {
    expect(link).toMatch(/\/book\/manage\/\$\{generateBookingToken\(bookingId, email\)\}\?pay=1/);
  });

  it('falls back to the invoice page, never to nothing', () => {
    /*
     * Both exits matter: no booking, and a booking whose contact has no
     * address to sign a token for. A Pay button that renders no link is a
     * client who cannot pay.
     */
    expect(link).toMatch(/if \(!bookingId\) return invoicePage;/);
    expect(link).toMatch(/if \(!email\) return invoicePage;/);
  });

  it('signs the token for the address the portal will check', () => {
    /*
     * `/api/book/manage/[token]` compares the token's email against the
     * BOOKING'S CONTACT. An invoice's `client_email` is a snapshot from when
     * it was raised, so a contact who changed address would get a Pay button
     * resolving to "booking not found".
     */
    expect(link).toMatch(/contact:crm_contacts\(email\)/);
    expect(link).not.toMatch(/client_email/);
  });

  it('cannot read another tenant’s booking', () => {
    // CLAUDE.md rule 4 — this is a service-role read.
    expect(link).toMatch(/\.eq\('user_id', userId\)/);
  });
});

describe('the portal opens on the card fields when sent there', () => {
  const page = codeOf('app/book/manage/[token]/page.tsx');

  it('acts on ?pay=1', () => {
    /*
     * One mechanism now serves both `?pay=1` and the `?task=` the four task
     * routes redirect with, so the pay flag is read alongside the others
     * rather than in a branch of its own.
     */
    expect(page).toMatch(/get\('pay'\) === '1' \? 'pay' : params\.get\('task'\)/);
    /* The task now also carries which SESSION of a package it is about, so
       the call spans several lines — the guarantee is that `wanted`, read from
       the URL, is what opens the card, not the shape of the literal. */
    expect(page).toMatch(/setTask\(\{[\s\S]{0,160}kind: wanted as/);
  });

  it('only while there is something to pay', () => {
    /*
     * `payment.invoiceId` is null once an invoice is settled, so a client
     * re-opening an old email sees their booking rather than a card form for a
     * bill they have already paid.
     */
    expect(page).toMatch(/pay: Boolean\(payInvoiceId\)/);
    expect(page).toMatch(/if \(!ready\[wanted\]\) return;/);
  });
});
