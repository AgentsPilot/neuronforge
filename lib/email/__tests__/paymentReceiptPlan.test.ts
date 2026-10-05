/**
 * A RECEIPT FOR ONE PERIOD SAYS WHAT IS LEFT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The receipt said "₪400.00 paid" and stopped. True, and complete about the
 * money that arrived — and silent on the ₪400 still due on the 7th, which is
 * the one question a client paying in instalments has when a receipt lands:
 * am I finished?
 *
 * The schedule is rendered by `emailPlanSchedule`, the same function the
 * booking confirmation uses. That sharing is the point: two emails describing
 * one plan, written twice, is how the receipt came to describe a different sale
 * from the confirmation that preceded it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { generatePaymentReceiptEmail } from '../templates/payment-receipt';
import { generateBookingConfirmationEmail } from '../templates/booking-confirmation';

const branding = {
  businessName: 'בית הספר הבינלאומי להורות',
  primaryColor: '#3B82F6',
  logoUrl: null,
} as unknown as Parameters<typeof generatePaymentReceiptEmail>[0]['branding'];

const PERIODS = [
  { number: 1, amount: 400, dueDate: '2026-09-30', status: 'paid' },
  { number: 2, amount: 400, dueDate: '2026-10-07', status: 'pending' },
];

const base = {
  clientName: 'אופיר עומר',
  amount: 400,
  currency: 'ILS',
  receiptNumber: 'INV-00013',
  paymentDate: new Date('2026-09-30T14:46:00Z'),
  serviceName: 'בדיקת תוכנית תשלומים',
  branding,
  locale: 'en' as const,
};

describe('a receipt for one period of a plan', () => {
  it('shows the whole schedule, not just what was paid', () => {
    const { html } = generatePaymentReceiptEmail({
      ...base,
      plan: { totalAmount: 800, paidPeriodNumber: 1, periods: PERIODS },
    });

    expect(html).toContain('Payment plan');
    // Both periods are listed, and the agreement is named as a total.
    expect(html).toContain('Total');
    // The period still to come carries its date.
    expect(html).toMatch(/Oct/);
  });

  it('marks the period that was just settled as paid', () => {
    const { html } = generatePaymentReceiptEmail({
      ...base,
      plan: { totalAmount: 800, paidPeriodNumber: 1, periods: PERIODS },
    });

    expect(html).toContain('paid');
  });

  it('is unchanged for an ordinary payment', () => {
    const { html } = generatePaymentReceiptEmail(base);

    expect(html).not.toContain('Payment plan');
    expect(html).toContain('400');
  });
});

describe('the receipt and the confirmation', () => {
  it('describe the same plan the same way, because one function draws both', () => {
    const receipt = generatePaymentReceiptEmail({
      ...base,
      plan: { totalAmount: 800, paidPeriodNumber: 1, periods: PERIODS },
    });

    const confirmation = generateBookingConfirmationEmail({
      clientName: base.clientName,
      clientEmail: 'c@example.com',
      serviceName: base.serviceName,
      dateTime: new Date('2026-10-01T10:00:00Z'),
      endTime: new Date('2026-10-01T11:00:00Z'),
      duration: 60,
      timezone: 'Asia/Jerusalem',
      price: 800,
      currency: 'ILS',
      paymentStatus: 'pending',
      rescheduleUrl: 'https://example.com/r',
      cancelUrl: 'https://example.com/c',
      bookingId: 'b1',
      branding,
      locale: 'en',
      plan: { totalAmount: 800, periods: PERIODS },
    });

    /*
     * The dated rows themselves, lifted out of each email. If the two templates
     * ever stop sharing `emailPlanSchedule`, these stop matching — which is the
     * drift this test exists to catch.
     */
    const rows = (html: string) =>
      html
        .replace(/<[^>]+>/g, '\n') // tags out, so only the visible text is left
        .split('\n')
        .map(line => line.trim())
        .filter(line => /^\d+\.\s+\S/.test(line)) // "1. Sep 30 ·" — whatever the locale orders
        .map(line => line.replace(/\s+/g, ' ').replace(/·\s*$/, '').trim());

    expect(rows(receipt.html).length).toBeGreaterThan(0);
    expect(rows(receipt.html)).toEqual(rows(confirmation.html));
  });
});
