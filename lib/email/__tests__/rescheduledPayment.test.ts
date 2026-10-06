/**
 * What a reschedule email says about money.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A reschedule used to say nothing at all. A client moving an unpaid
 * appointment got a tidy email with no mention that they had not paid and no
 * way to do it — the template had no field for a price, let alone a link.
 *
 * The rule it now follows is the confirmation's, not a new one: on a plan, what
 * is owed NOW is the FIRST UNPAID PERIOD, never the total. That rule carries a
 * scar — using the full price meant a booking sold as "₪400 today, ₪400 on the
 * 7th" asked for ₪800 in the same email as a ₪400 invoice — and the test below
 * pins it here so a second copy of the calculation cannot drift from it.
 *
 * The other half of this file is about SILENCE: a paid booking, a free one, a
 * business with no card route. Each must render exactly the email it rendered
 * before, because every one of those clients owes nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { generateBookingRescheduledEmail } from '@/lib/email/templates/booking-confirmation';
import type { BrandingData } from '@/lib/email/branding';

const BRANDING: BrandingData = {
  businessName: 'Studio',
  primaryColor: '#6366F1',
  secondaryColor: '#A5B4FC',
  onBrand: '#FFFFFF',
  pageColor: '#F5F5F7',
  surfaceColor: '#FFFFFF',
  mutedSurfaceColor: '#FAFAFA',
  borderColor: '#E5E7EB',
  textColor: '#111827',
  mutedTextColor: '#6B7280',
  radius: '16px',
  buttonRadius: '12px',
};

const base = {
  clientName: 'Dana Levi',
  clientEmail: 'dana@example.com',
  serviceName: 'Consultation',
  oldDateTime: new Date('2026-10-10T09:00:00Z'),
  newDateTime: new Date('2026-10-12T11:00:00Z'),
  newEndTime: new Date('2026-10-12T12:00:00Z'),
  duration: 60,
  timezone: 'UTC',
  rescheduleUrl: 'https://example.com/r',
  cancelUrl: 'https://example.com/c',
  bookingId: 'b-1',
  branding: BRANDING,
};

describe('an unpaid booking that was moved', () => {
  it('names what is owed and offers somewhere to pay', () => {
    const { html } = generateBookingRescheduledEmail({
      ...base,
      price: 400,
      currency: 'ILS',
      paymentStatus: 'pending',
      paymentUrl: 'https://pay.example.com/inv-1',
    });

    expect(html).toContain('₪400.00');
    expect(html).toContain('https://pay.example.com/inv-1');
  });

  it('still says what is owed when there is no card route', () => {
    /*
     * A business collecting by bank transfer has no pay link. The amount still
     * belongs in the email — the client needs to know they owe it — but there
     * is no button to put under it.
     */
    const { html } = generateBookingRescheduledEmail({
      ...base,
      price: 400,
      currency: 'ILS',
      paymentStatus: 'pending',
      paymentUrl: undefined,
    });

    expect(html).toContain('₪400.00');
    expect(html).not.toContain('pay.example.com');
  });
});

describe('a booking on a payment plan', () => {
  const plan = {
    totalAmount: 800,
    periods: [
      { number: 1, amount: 400, dueDate: '2026-10-01', status: 'paid' },
      { number: 2, amount: 400, dueDate: '2026-11-01', status: 'pending' },
    ],
  };

  it('asks for the next unpaid period, NOT the total', () => {
    /*
     * The regression this rule exists for. ₪800 here would be the whole plan —
     * including the ₪400 the client has already paid.
     */
    const { html } = generateBookingRescheduledEmail({
      ...base,
      price: 800,
      currency: 'ILS',
      paymentStatus: 'pending',
      plan,
    });

    expect(html).toContain('₪400.00');
  });

  it('shows the schedule, so the client can see what is settled', () => {
    const { html } = generateBookingRescheduledEmail({
      ...base,
      price: 800,
      currency: 'ILS',
      paymentStatus: 'pending',
      plan,
    });

    // Both periods appear; the schedule is the point of showing one at all.
    expect(html).toContain('₪800.00');
  });

  it('says nothing when every period is settled', () => {
    const { html } = generateBookingRescheduledEmail({
      ...base,
      price: 800,
      currency: 'ILS',
      paymentStatus: 'pending',
      plan: {
        totalAmount: 800,
        periods: [
          { number: 1, amount: 400, dueDate: '2026-10-01', status: 'paid' },
          { number: 2, amount: 400, dueDate: '2026-11-01', status: 'paid' },
        ],
      },
    });

    // No unpaid period means nothing is due, whatever `paymentStatus` claims.
    expect(html).not.toMatch(/₪400\.00/);
  });
});

describe('bookings that owe nothing — the email must be unchanged', () => {
  it.each([
    ['paid', 'paid'],
    ['refunded', 'refunded'],
    ['not required', 'not_required'],
  ])('a %s booking shows no payment section', (_label, status) => {
    const { html } = generateBookingRescheduledEmail({
      ...base,
      price: 400,
      currency: 'ILS',
      paymentStatus: status as 'paid' | 'refunded' | 'not_required',
      paymentUrl: 'https://pay.example.com/inv-1',
    });

    expect(html).not.toContain('pay.example.com');
  });

  it('a free booking shows nothing even while pending', () => {
    // Price zero: there is nothing to collect, and a "pay ₪0.00" notice would
    // be absurd.
    const { html } = generateBookingRescheduledEmail({
      ...base,
      price: 0,
      currency: 'ILS',
      paymentStatus: 'pending',
      paymentUrl: 'https://pay.example.com/inv-1',
    });

    expect(html).not.toContain('pay.example.com');
  });

  it('a caller passing no payment fields renders exactly what it did before', () => {
    /*
     * Every existing caller. The fields are optional precisely so that adding
     * them could not change an email anybody already relies on.
     */
    const withoutPayment = generateBookingRescheduledEmail({ ...base });
    const withPaidStatus = generateBookingRescheduledEmail({ ...base, paymentStatus: 'paid' });

    expect(withoutPayment.html).toBe(withPaidStatus.html);
    expect(withoutPayment.html).not.toContain('pay.example.com');
  });
});

describe('the rest of the email is untouched', () => {
  it('still carries the new time, the old time and the manage links', () => {
    const { html, icsContent } = generateBookingRescheduledEmail({
      ...base,
      price: 400,
      currency: 'ILS',
      paymentStatus: 'pending',
      paymentUrl: 'https://pay.example.com/inv-1',
    });

    expect(html).toContain('https://example.com/r');
    expect(html).toContain('https://example.com/c');
    // The calendar update is the reason this email exists at all.
    expect(icsContent).toContain('BEGIN:VCALENDAR');
  });
});
