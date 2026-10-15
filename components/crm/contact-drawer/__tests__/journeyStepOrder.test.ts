/**
 * The client journey runs in the order the client lived it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * `confirmation` was pushed after `payment` because it is built from the email
 * record, which is read later in the function — an order of CONSTRUCTION that
 * was never an order of EVENTS. On a product sale the journey read:
 *
 *     שירות · פרטי לקוח · תשלום · טופס לקוח · אישור · הזמנה בוטלה
 *
 * claiming the client paid before anyone told them the booking existed. On an
 * instalment plan it is worse: the payment node is the one thing still open
 * weeks after everything above it has settled, so it is the last place that
 * belongs near the top.
 *
 * It also made the date header repeat. The dated steps all carry the same
 * timestamp and the undated ones (`intake`, and `fulfillment` on a product)
 * were separating two runs of the same day, so the journey drew "14 באוק׳",
 * an undated card, then "14 באוק׳" again.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE VARIATIONS ARE THE POINT
 *
 * A reorder is exactly the kind of change that fixes one card and breaks four,
 * so every shape the builder serves is asserted here, not just the reported
 * one: product sale, scheduled service, quoted job, package session, free
 * service, and a booking whose confirmation never went out.
 *
 * The quoted job is the one to watch. It has its OWN reordering — the quote
 * follows the consultation and the money follows the quote — and these two
 * rules have to compose rather than fight.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  buildJourneySteps,
  type ExtendedBookingData,
} from '@/components/crm/contact-drawer/CRMContactDrawerV2';
import type { Appointment, SessionPayment } from '@/components/crm/contact-drawer/types';

const WHEN = '2026-10-14T23:03:00.000Z';

const booking = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'b1',
  service_id: 's1',
  client_first_name: 'דויד',
  client_email: 'client@example.invalid',
  start_time: null,
  end_time: null,
  status: 'confirmed',
  created_at: WHEN,
  service: { service_name: 'בדיקת תוכנית תשלומים', is_scheduled: false, sale_mode: 'direct' },
  ...over,
});

const paid = (over: Partial<SessionPayment> = {}): SessionPayment => ({
  amount: 800,
  currency: 'ILS',
  status: 'paid',
  ...over,
});

const steps = (data: ExtendedBookingData) =>
  buildJourneySteps(data, 'he', false, 'Asia/Jerusalem').map(s => s.key);

/** Where each key sits, or -1. */
const at = (keys: string[], key: string) => keys.indexOf(key);

const CONFIRMED_EMAIL = { status: 'sent' as const, sentAt: WHEN };

describe('the reported product sale', () => {
  const keys = steps({
    booking: booking(),
    payment: paid(),
    confirmationEmail: CONFIRMED_EMAIL,
  });

  it('tells the client it is confirmed before taking the money', () => {
    expect(at(keys, 'confirmation')).toBeGreaterThan(-1);
    expect(at(keys, 'payment')).toBeGreaterThan(-1);
    expect(at(keys, 'confirmation')).toBeLessThan(at(keys, 'payment'));
  });

  it('still opens on the service and the client', () => {
    expect(keys[0]).toBe('service');
    expect(keys[1]).toBe('client');
  });

  it('still ends on the fulfilment, which is what a product has instead of a session', () => {
    expect(keys[keys.length - 1]).toBe('fulfillment');
    expect(keys).not.toContain('session');
  });
});

describe('a scheduled service', () => {
  const keys = steps({
    booking: booking({
      start_time: '2026-10-20T16:00:00.000Z',
      end_time: '2026-10-20T17:00:00.000Z',
      service: { service_name: 'ייעוץ', is_scheduled: true, sale_mode: 'direct' },
    }),
    payment: paid({ amount: 400 }),
    confirmationEmail: CONFIRMED_EMAIL,
  });

  it('puts the confirmation before the payment here too', () => {
    expect(at(keys, 'confirmation')).toBeLessThan(at(keys, 'payment'));
  });

  it('ends on the session rather than a fulfilment', () => {
    expect(keys[keys.length - 1]).toBe('session');
    expect(keys).not.toContain('fulfillment');
  });

  it('keeps the meeting last, after the money', () => {
    /* The appointment IS the job for a direct service: everything leads to it. */
    expect(at(keys, 'payment')).toBeLessThan(at(keys, 'session'));
  });
});

describe('a quoted job, which has its own ordering rule', () => {
  const keys = steps({
    booking: booking({
      start_time: '2026-10-20T16:00:00.000Z',
      end_time: '2026-10-20T17:00:00.000Z',
      service: { service_name: 'שיפוץ', is_scheduled: true, sale_mode: 'proposal' },
    }),
    payment: paid({ amount: 500, status: 'pending' }),
    confirmationEmail: CONFIRMED_EMAIL,
    /* Present-but-null is "quoted, no quote written yet". The step is gated on
       `data.proposal !== undefined`, so omitting it means the drawer has not
       looked rather than that there is nothing. */
    proposal: null,
  });

  it('still runs the quote and the money AFTER the consultation', () => {
    /*
     * The rule this file's other reorder exists for: the price follows the
     * visit, the money follows the price. Putting the confirmation first must
     * not drag the payment back up with it.
     */
    expect(at(keys, 'session')).toBeLessThan(at(keys, 'proposal'));
    expect(at(keys, 'proposal')).toBeLessThan(at(keys, 'payment'));
  });

  it('and the confirmation is still ahead of the money', () => {
    expect(at(keys, 'confirmation')).toBeLessThan(at(keys, 'payment'));
  });

  it('the confirmation does not jump past the consultation', () => {
    /* It is sent when the consultation is booked, so it belongs before it. */
    expect(at(keys, 'confirmation')).toBeLessThan(at(keys, 'session'));
  });
});

describe('a package session', () => {
  it('is left alone: it carries no quote of its own', () => {
    /*
     * One meeting of an accepted package. It must not grow a proposal step —
     * the quote belongs to the purchase, which created it.
     */
    const keys = steps({
      booking: booking({
        parent_booking_id: 'purchase-1',
        occurrence_number: 2,
        start_time: '2026-10-20T16:00:00.000Z',
        end_time: '2026-10-20T17:00:00.000Z',
        service: { service_name: 'טיפול', is_scheduled: true, sale_mode: 'proposal' },
      }),
      payment: paid({ amount: 75 }),
      confirmationEmail: CONFIRMED_EMAIL,
    });

    expect(keys).not.toContain('proposal');
    expect(at(keys, 'confirmation')).toBeLessThan(at(keys, 'payment'));
  });
});

describe('the steps that may be absent', () => {
  it('a booking with no confirmation email keeps every other step in order', () => {
    const keys = steps({ booking: booking(), payment: paid() });

    expect(keys[0]).toBe('service');
    expect(keys[1]).toBe('client');
    expect(keys[keys.length - 1]).toBe('fulfillment');
  });

  it('a free service still orders what it does have', () => {
    const keys = steps({
      booking: booking({ payment_status: undefined }),
      payment: { amount: 0, currency: 'ILS', status: 'free' },
      confirmationEmail: CONFIRMED_EMAIL,
    });

    if (at(keys, 'payment') > -1) {
      expect(at(keys, 'confirmation')).toBeLessThan(at(keys, 'payment'));
    }
    expect(keys[0]).toBe('service');
  });

  it('no payment at all leaves the confirmation where it was built', () => {
    /*
     * The move is conditional on both steps existing. With no payment there is
     * nothing to move in front of, and the array must come back untouched
     * rather than with a step spliced to index -1 — which would put the
     * confirmation at the END.
     */
    const keys = steps({ booking: booking(), payment: null, confirmationEmail: CONFIRMED_EMAIL });

    expect(at(keys, 'confirmation')).toBeGreaterThan(-1);
    expect(keys[keys.length - 1]).toBe('fulfillment');
  });
});

describe('the whole sequence, pinned', () => {
  /*
   * The relative assertions above each protect one rule. These pin the result,
   * so a future reorder that satisfies every rule and still produces a strange
   * journey has to be looked at deliberately rather than slipping through.
   */
  it('product sale', () => {
    expect(
      steps({ booking: booking(), payment: paid(), confirmationEmail: CONFIRMED_EMAIL })
    ).toEqual(['service', 'client', 'confirmation', 'payment', 'fulfillment']);
  });

  it('scheduled service', () => {
    expect(
      steps({
        booking: booking({
          start_time: '2026-10-20T16:00:00.000Z',
          end_time: '2026-10-20T17:00:00.000Z',
          service: { service_name: 'ייעוץ', is_scheduled: true, sale_mode: 'direct' },
        }),
        payment: paid({ amount: 400 }),
        confirmationEmail: CONFIRMED_EMAIL,
      })
    ).toEqual(['service', 'client', 'confirmation', 'payment', 'session']);
  });

  it('quoted job: the price follows the visit, the money follows the price', () => {
    expect(
      steps({
        booking: booking({
          start_time: '2026-10-20T16:00:00.000Z',
          end_time: '2026-10-20T17:00:00.000Z',
          service: { service_name: 'שיפוץ', is_scheduled: true, sale_mode: 'proposal' },
        }),
        payment: paid({ amount: 500, status: 'pending' }),
        confirmationEmail: CONFIRMED_EMAIL,
        proposal: null,
      })
    ).toEqual(['service', 'client', 'confirmation', 'session', 'proposal', 'payment']);
  });

  it('nothing to pay', () => {
    expect(
      steps({ booking: booking(), payment: null, confirmationEmail: CONFIRMED_EMAIL })
    ).toEqual(['service', 'client', 'confirmation', 'fulfillment']);
  });
});

describe('nothing is lost or duplicated by the reorder', () => {
  const shapes: Array<[string, ExtendedBookingData]> = [
    ['product', { booking: booking(), payment: paid(), confirmationEmail: CONFIRMED_EMAIL }],
    [
      'scheduled',
      {
        booking: booking({
          start_time: '2026-10-20T16:00:00.000Z',
          end_time: '2026-10-20T17:00:00.000Z',
          service: { service_name: 'ייעוץ', is_scheduled: true, sale_mode: 'direct' },
        }),
        payment: paid(),
        confirmationEmail: CONFIRMED_EMAIL,
      },
    ],
    [
      'quoted',
      {
        booking: booking({
          start_time: '2026-10-20T16:00:00.000Z',
          end_time: '2026-10-20T17:00:00.000Z',
          service: { service_name: 'שיפוץ', is_scheduled: true, sale_mode: 'proposal' },
        }),
        payment: paid({ status: 'pending' }),
        confirmationEmail: CONFIRMED_EMAIL,
        proposal: null,
      },
    ],
  ];

  for (const [name, data] of shapes) {
    it(`${name}: every key appears exactly once`, () => {
      const keys = steps(data);

      expect(new Set(keys).size).toBe(keys.length);
    });

    it(`${name}: the confirmation survives the move`, () => {
      expect(steps(data)).toContain('confirmation');
    });
  }
});
