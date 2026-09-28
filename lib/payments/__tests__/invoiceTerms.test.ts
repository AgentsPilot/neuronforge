/**
 * Not chasing somebody for a session that has not happened yet.
 *
 * A booking's invoice is due on the day of the appointment, and moving the
 * appointment does not move the invoice. So a session pushed from October to
 * November left a bill dated October: overdue the next day, and the client
 * emailed on days 1, 3 and 7, in the owner's name, about a session a month off.
 *
 * The fix holds the CHASE rather than moving the DATE, because a client can
 * reschedule from their own link with no limit — a deadline that followed the
 * appointment would let anyone defer their own bill for ever.
 *
 * These pin the narrowness, which is the part that could do damage: a deadline
 * the client actually agreed to must still be chased on its own date.
 */

import {
  SERVICE_DATE_TERMS,
  isServiceDateInvoice,
  waitsForItsSession,
} from '../invoiceTerms';

const AHEAD = new Set(['booking-ahead']);

describe('waitsForItsSession', () => {
  it('holds a booking invoice whose session is still ahead', () => {
    expect(
      waitsForItsSession(
        { booking_id: 'booking-ahead', payment_terms: SERVICE_DATE_TERMS },
        AHEAD
      )
    ).toBe(true);
  });

  it('chases once the session has been and gone', () => {
    expect(
      waitsForItsSession(
        { booking_id: 'booking-past', payment_terms: SERVICE_DATE_TERMS },
        AHEAD
      )
    ).toBe(false);
  });

  /*
   * THE ONE THAT MATTERS. A quote's 30-day terms, or due-on-receipt, are dates
   * the client agreed to. An appointment sitting in the future is no reason to
   * stop asking for money that is genuinely late.
   */
  it('still chases an agreed deadline, even with the session ahead', () => {
    expect(
      waitsForItsSession({ booking_id: 'booking-ahead', payment_terms: 'due_on_receipt' }, AHEAD)
    ).toBe(false);

    expect(
      waitsForItsSession({ booking_id: 'booking-ahead', payment_terms: 'Net 30' }, AHEAD)
    ).toBe(false);
  });

  it('still chases an invoice attached to no booking at all', () => {
    expect(waitsForItsSession({ booking_id: null, payment_terms: SERVICE_DATE_TERMS }, AHEAD)).toBe(
      false
    );
  });

  it('treats missing terms as an ordinary invoice', () => {
    expect(waitsForItsSession({ booking_id: 'booking-ahead' }, AHEAD)).toBe(false);
  });
});

describe('isServiceDateInvoice', () => {
  it('needs both the booking and the rule', () => {
    expect(isServiceDateInvoice({ booking_id: 'b', payment_terms: SERVICE_DATE_TERMS })).toBe(true);
    expect(isServiceDateInvoice({ booking_id: null, payment_terms: SERVICE_DATE_TERMS })).toBe(false);
    expect(isServiceDateInvoice({ booking_id: 'b', payment_terms: 'due_on_receipt' })).toBe(false);
  });
});
