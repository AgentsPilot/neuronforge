/**
 * What a client receives when they buy a PRODUCT — something with no time slot.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS PINS
 *
 * `hasSchedule === false` stripped the reschedule button and left the cancel
 * button beside it, so an order arrived with a lone "Cancel" under a "Need
 * changes?" heading. Following it was worse than useless:
 *
 *   - the manage page reads `start_time`, which is null for a product, and
 *     `new Date(null)` is the Unix epoch — so the client was shown a
 *     1 January 1970 appointment;
 *   - its 24-hours-notice rule then measured against 1970 and refused, telling
 *     them it was too late to cancel a thing that has no date.
 *
 * Reported by a real client who bought a product from the contact drawer.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { generateBookingConfirmationEmail } from '../templates/booking-confirmation';

const branding = {
  businessName: 'Bright Clinic',
  primaryColor: '#4F46E5',
  secondaryColor: '#111111',
} as never;

const RESCHEDULE = 'https://app.example.com/book/manage/tok/reschedule';
const CANCEL = 'https://app.example.com/book/manage/tok/cancel';

function email(hasSchedule: boolean) {
  return generateBookingConfirmationEmail({
    clientName: 'Dana',
    clientEmail: 'dana@example.com',
    serviceName: 'Gift Voucher',
    duration: hasSchedule ? 60 : 0,
    timezone: 'Asia/Jerusalem',
    dateTime: new Date('2026-10-05T09:00:00Z'),
    endTime: new Date('2026-10-05T10:00:00Z'),
    rescheduleUrl: RESCHEDULE,
    cancelUrl: CANCEL,
    bookingId: 'booking-1',
    branding,
    hasSchedule,
  } as never);
}

describe('a product order', () => {
  const html = email(false).html;

  it('offers no cancel link', () => {
    expect(html).not.toContain(CANCEL);
  });

  it('offers no reschedule link', () => {
    expect(html).not.toContain(RESCHEDULE);
  });

  it('does not ask "need changes?" with nothing behind it', () => {
    // The heading is the section's own; with both buttons gone it would stand
    // over an empty row.
    expect(html).not.toMatch(/Need changes/i);
  });

  it('still tells the client how to reach the business', () => {
    // The route out, now that the buttons are gone. Without this the client has
    // no way to act on the order at all.
    expect(html).toContain('Bright Clinic');
  });

  it('carries no calendar invitation, since there is nothing to add', () => {
    expect(html).not.toContain('calendar.google.com');
  });
});

describe('an appointment — unchanged', () => {
  const html = email(true).html;

  it('still offers both links', () => {
    expect(html).toContain(CANCEL);
    expect(html).toContain(RESCHEDULE);
  });

  it('still carries the calendar invitation', () => {
    expect(html).toContain('calendar.google.com');
  });
});
