/**
 * THE CONFIRMATION ASKS FOR THE FIRST PERIOD, NOT THE WHOLE AGREEMENT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A booking sold as "₪400 today, ₪400 on the 7th" produced a ₪400 invoice and a
 * confirmation email that said "please complete your payment of ₪800" — because
 * the template printed `price`, which is the agreement, in the one place that
 * means "pay this now".
 *
 * The client had just been shown the split in the booking dialog. Three
 * documents, two of them agreeing and the loudest one wrong.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { generateBookingConfirmationEmail } from '../templates/booking-confirmation';

const branding = {
  businessName: 'בית הספר הבינלאומי להורות',
  primaryColor: '#3B82F6',
  logoUrl: null,
} as unknown as Parameters<typeof generateBookingConfirmationEmail>[0]['branding'];

const base = {
  clientName: 'אופיר עומר',
  clientEmail: 'client@example.com',
  serviceName: 'בדיקת תוכנית תשלומים',
  dateTime: new Date('2026-10-01T10:00:00Z'),
  endTime: new Date('2026-10-01T11:00:00Z'),
  duration: 60,
  timezone: 'Asia/Jerusalem',
  price: 800,
  currency: 'ILS',
  paymentStatus: 'pending' as const,
  rescheduleUrl: 'https://example.com/r',
  cancelUrl: 'https://example.com/c',
  bookingId: 'booking-1',
  branding,
};

const PLAN = {
  totalAmount: 800,
  periods: [
    { number: 1, amount: 400, dueDate: '2026-09-30', status: 'pending' },
    { number: 2, amount: 400, dueDate: '2026-10-07', status: 'pending' },
  ],
};

/**
 * The one sentence that means "pay this now".
 *
 * Extracted rather than searched for across the whole document: the agreed
 * total legitimately appears elsewhere — the price row and the plan's own
 * total — so a document-wide assertion would pass or fail for the wrong reason.
 */
function paymentDemand(html: string): string {
  const match = html.match(/Please complete your payment of[^<]*/);
  if (!match) throw new Error('no payment demand rendered — the test cannot assert on it');
  return match[0];
}

describe('a booking sold on a payment plan', () => {
  it('asks for the first period, never the total', () => {
    const { html } = generateBookingConfirmationEmail({ ...base, locale: 'en', plan: PLAN });

    const demand = paymentDemand(html);
    expect(demand).toContain('400');
    expect(demand).not.toContain('800');
  });

  it('lists every period with its date', () => {
    const { html } = generateBookingConfirmationEmail({ ...base, plan: PLAN, locale: 'en' });

    expect(html).toContain('Payment plan');
    expect(html).toContain('due today');
    // Both periods, and the agreed total as a total rather than as a demand.
    expect(html.match(/400/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('Total');
  });

  it('marks a period that has already been paid', () => {
    const { html } = generateBookingConfirmationEmail({
      ...base,
      locale: 'en',
      plan: {
        totalAmount: 800,
        periods: [
          { number: 1, amount: 400, dueDate: '2026-09-30', status: 'paid' },
          { number: 2, amount: 400, dueDate: '2026-10-07', status: 'pending' },
        ],
      },
    });

    expect(html).toContain('paid');
    // "Due today" has moved to period 2 — the first unpaid one.
    expect(html).toContain('due today');
  });
});

describe('an ordinary booking', () => {
  it('is completely unchanged — no plan table, and the price is what is asked', () => {
    const { html } = generateBookingConfirmationEmail({ ...base, locale: 'en' });

    expect(html).not.toContain('Payment plan');
    expect(paymentDemand(html)).toContain('800');
  });
});
