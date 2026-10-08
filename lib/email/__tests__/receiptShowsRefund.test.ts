/**
 * A receipt for money that came back says so.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * The owner refunds part of a milestone, then presses "send receipt" on that
 * stage. The client receives a document headed "₪4,500 paid", listing ₪4,500
 * against the invoice number, with no mention of the ₪2,250 that went back.
 *
 * It is the client's record of the transaction, and it was wrong about the one
 * thing that had changed since it was first true. Nothing errored: the template
 * simply had no refund field, so every one of the four senders passed a figure
 * that was once correct.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES NOT DO
 *
 * "Amount paid" still reads what was paid. That happened, and the receipt is a
 * record of it. Netting it there would say the client paid ₪2,250 on a day they
 * paid ₪4,500 — the same misstatement the stage row made before it was fixed.
 * The refund is reported beside it, with what the client is actually out of
 * pocket.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { generatePaymentReceiptEmail } from '@/lib/email/templates/payment-receipt';

/* The template renders branding into the shell, so a bare object throws inside
   `escapeHtml` long before any assertion — same fixture the plan receipt uses. */
const branding = {
  businessName: 'בית הספר הבינלאומי להורות',
  primaryColor: '#3B82F6',
  logoUrl: null,
  locale: 'he',
} as unknown as Parameters<typeof generatePaymentReceiptEmail>[0]['branding'];

const BASE = {
  clientName: 'דויד המלך',
  amount: 4500,
  currency: 'ILS',
  receiptNumber: 'INV-00028',
  paymentDate: new Date('2026-10-07T12:00:00Z'),
  timezone: 'Asia/Jerusalem',
  branding,
  locale: 'he' as const,
};

/** Figures appear with separators, so match on the digits that survive them. */
const has = (html: string, amount: string) => html.replace(/[,\s]/g, '').includes(amount);

describe('a refunded receipt', () => {
  it('still states what was paid', () => {
    const { html } = generatePaymentReceiptEmail({
      ...BASE,
      refund: { amount: 2250, at: new Date('2026-10-07T14:00:00Z') },
    } as Parameters<typeof generatePaymentReceiptEmail>[0]);

    expect(has(html, '4500')).toBe(true);
  });

  it('reports the refund', () => {
    const { html } = generatePaymentReceiptEmail({
      ...BASE,
      refund: { amount: 2250, at: new Date('2026-10-07T14:00:00Z') },
    } as Parameters<typeof generatePaymentReceiptEmail>[0]);

    expect(html).toContain('הוחזר');
    expect(has(html, '2250')).toBe(true);
  });

  it('says what the client is actually out of pocket', () => {
    /*
     * ₪4,500 paid and ₪2,250 returned are both true and neither answers it.
     * This is the figure a client checks against their statement.
     */
    const { html } = generatePaymentReceiptEmail({
      ...BASE,
      amount: 4500,
      refund: { amount: 1000, at: null },
    } as Parameters<typeof generatePaymentReceiptEmail>[0]);

    expect(html).toContain('שולם בפועל');
    expect(has(html, '3500')).toBe(true);
  });

  it('never reports a negative net', () => {
    // A refund larger than the receipt is a data fault; a client told they paid
    // minus ₪500 learns nothing and worries.
    const { html } = generatePaymentReceiptEmail({
      ...BASE,
      amount: 100,
      refund: { amount: 500, at: null },
    } as Parameters<typeof generatePaymentReceiptEmail>[0]);

    expect(html).not.toMatch(/-\s*₪?\s*400/);
  });
});

describe('an ordinary receipt is untouched', () => {
  it('says nothing about refunds when none happened', () => {
    const { html } = generatePaymentReceiptEmail(
      BASE as Parameters<typeof generatePaymentReceiptEmail>[0]
    );

    expect(html).not.toContain('הוחזר');
    expect(html).not.toContain('שולם בפועל');
  });

  it('treats a zero refund as no refund', () => {
    /*
     * `refunded_amount` is 0 on every invoice nobody has refunded, so this is
     * the ordinary case reaching the template, not an edge one.
     */
    const { html } = generatePaymentReceiptEmail({
      ...BASE,
      refund: { amount: 0, at: null },
    } as Parameters<typeof generatePaymentReceiptEmail>[0]);

    expect(html).not.toContain('הוחזר');
  });
});
