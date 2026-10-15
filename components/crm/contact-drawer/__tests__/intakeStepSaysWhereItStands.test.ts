/**
 * The intake card says where the form actually stands.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * The step carried a status colour and nothing else, so the journey drew a
 * heading — טופס לקוח — over an empty box. Every state that was not "answered"
 * looked identical:
 *
 *   · a form sent three days ago and chased once
 *   · a form that was never sent
 *   · a form nobody will ever be asked for, because the job was cancelled
 *
 * all rendered as the same blank card. The owner's question looking at it is
 * "did we ask them yet", and that was the one thing it could not say.
 *
 * The timestamps were on the row the whole time — `intake_sent_at` and
 * `intake_reminded_at` sit beside `intake_completed_at` — and only the last was
 * read, so the step could answer "is there a response" and no other question.
 * `Appointment` did not declare the other two and `toAppointment` did not pass
 * them, which is why nothing complained.
 *
 * `details` is also what decides the card's SHAPE: `cardFact` falls back
 * through it, and `hasCardBody` is computed from `cardFact`. A step with
 * neither a fact nor a block has no body at all — which is literally the empty
 * box being fixed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  buildJourneySteps,
  toAppointment,
  type ExtendedBookingData,
} from '@/components/crm/contact-drawer/CRMContactDrawerV2';
import type { Appointment } from '@/components/crm/contact-drawer/types';

const SENT = '2026-10-14T20:03:00.000Z';
const CHASED = '2026-10-16T09:00:00.000Z';
const ANSWERED = '2026-10-17T11:30:00.000Z';

const booking = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'b1',
  service_id: 's1',
  client_first_name: 'דויד',
  /* A SCHEDULED service: the intake step only exists where there is a meeting
     to prepare for. The product case is asserted on its own below. */
  start_time: '2026-10-20T16:00:00.000Z',
  end_time: '2026-10-20T17:00:00.000Z',
  status: 'confirmed',
  created_at: '2026-10-14T20:03:00.000Z',
  service: { service_name: 'ייעוץ', is_scheduled: true, sale_mode: 'direct' },
  ...over,
});

/** The intake step, built with the business collecting intake. */
const intake = (over: Partial<Appointment> = {}, language = 'he') => {
  const data: ExtendedBookingData = { booking: booking(over), payment: null };
  return buildJourneySteps(data, language, true, 'UTC').find(s => s.key === 'intake');
};

describe('the card is never empty', () => {
  it('every state carries a line', () => {
    /*
     * The shape of the bug: `details` is what `cardFact` falls back through,
     * and `hasCardBody` is computed from `cardFact`. No details, no body.
     */
    const states: Partial<Appointment>[] = [
      {},
      { intake_sent_at: SENT },
      { intake_sent_at: SENT, intake_reminded_at: CHASED },
      { status: 'cancelled' },
      { status: 'completed' },
      {
        intake_completed_at: ANSWERED,
        intake_responses: { responses: { q1: 'yes' } },
      },
    ];

    for (const state of states) {
      expect(intake(state)?.details).toBeTruthy();
    }
  });
});

describe('never asked', () => {
  it('says so while there is still a point in asking', () => {
    expect(intake({})?.details).toBe('טרם נשלח');
  });

  it('drops the "yet" once the booking is cancelled', () => {
    /*
     * "Not sent YET" on a cancelled job implies an action the owner should
     * still take. There is nothing left to send.
     */
    expect(intake({ status: 'cancelled' })?.details).toBe('לא נשלח');
  });

  it('and once it is over', () => {
    expect(intake({ status: 'completed' })?.details).toBe('לא נשלח');
  });
});

describe('asked and waiting', () => {
  it('names the day it went out', () => {
    const details = intake({ intake_sent_at: SENT })?.details ?? '';

    expect(details).toContain('נשלח, ממתין למילוי');
    /* The date matters as much as the word: "sent" with no "when" cannot tell
       an owner whether chasing is overdue. */
    expect(details).toContain('14');
  });

  it('names both days once the client has been chased', () => {
    const details = intake({ intake_sent_at: SENT, intake_reminded_at: CHASED })?.details ?? '';

    expect(details).toContain('נשלח, ממתין למילוי');
    expect(details).toContain('נשלחה תזכורת');
    /* The gap between the two is the thing worth seeing. */
    expect(details).toContain('14');
    expect(details).toContain('16');
  });
});

describe('a booking that ended without the form coming back', () => {
  /*
   * "Sent, awaiting a reply" is a LIVE state: it says the ball is with the
   * client and the owner may want to chase. On a cancelled booking that is
   * false — the meeting it was preparing for is not happening, and the form
   * will never be filled in. The journey kept reporting the chase.
   */
  it('stops saying the owner is waiting, once cancelled', () => {
    const details = intake({ status: 'cancelled', intake_sent_at: SENT })?.details ?? '';

    expect(details).toContain('נשלח, לא מולא');
    expect(details).not.toContain('ממתין למילוי');
  });

  it('and once the booking is completed', () => {
    const details = intake({ status: 'completed', intake_sent_at: SENT })?.details ?? '';

    expect(details).toContain('נשלח, לא מולא');
    expect(details).not.toContain('ממתין למילוי');
  });

  it('keeps the date it went out, which is the record of having asked', () => {
    expect(intake({ status: 'cancelled', intake_sent_at: SENT })?.details).toContain('14');
  });

  it('does not claim a chase that is no longer the point', () => {
    /* Reminded is part of the live chase story. Once the booking is off, what
       matters is that it was asked and never came back. */
    const details =
      intake({ status: 'cancelled', intake_sent_at: SENT, intake_reminded_at: CHASED })?.details ?? '';

    expect(details).toContain('נשלח, לא מולא');
    expect(details).not.toContain('ממתין למילוי');
  });

  it('an ANSWERED form still reads as answered on a cancelled booking', () => {
    /*
     * The client did fill it in before the job was called off. That happened,
     * and saying "never completed" about it would be false.
     */
    const details = intake({
      status: 'cancelled',
      intake_sent_at: SENT,
      intake_completed_at: ANSWERED,
      intake_responses: { responses: { q1: 'yes' } },
    })?.details ?? '';

    expect(details).toContain('מולא');
    expect(details).not.toContain('לא מולא');
  });

  it('English and Spanish too', () => {
    expect(intake({ status: 'cancelled', intake_sent_at: SENT }, 'en')?.details).toContain(
      'Sent, never completed'
    );
    expect(intake({ status: 'cancelled', intake_sent_at: SENT }, 'es')?.details).toContain(
      'Enviado, sin completar'
    );
  });
});

describe('answered', () => {
  const answered = {
    intake_sent_at: SENT,
    intake_reminded_at: CHASED,
    intake_completed_at: ANSWERED,
    intake_responses: { responses: { q1: 'yes' } },
  };

  it('outranks sent and reminded', () => {
    const details = intake(answered)?.details ?? '';

    expect(details).toContain('מולא');
    expect(details).not.toContain('ממתין למילוי');
  });

  it('is the step status too', () => {
    expect(intake(answered)?.status).toBe('completed');
  });

  it('an empty response object is not an answer', () => {
    /*
     * `intake_responses: {}` means the form was sent, not returned —
     * `hasIntake` counts the response KEYS for exactly this reason.
     */
    const details = intake({ intake_sent_at: SENT, intake_responses: { responses: {} } })?.details ?? '';

    expect(details).toContain('ממתין למילוי');
    expect(details).not.toContain('מולא');
  });
});

describe('the step files under the day it happened', () => {
  it('dates an unanswered form by when it was sent', () => {
    /*
     * It had only `intake_completed_at`, so an unanswered form was undated and
     * fell into the journey's undated group — wedged between two runs of the
     * same day, which is what made the date header repeat.
     */
    expect(intake({ intake_sent_at: SENT })?.timestamp).toBe(SENT);
  });

  it('prefers the chase over the original send', () => {
    expect(intake({ intake_sent_at: SENT, intake_reminded_at: CHASED })?.timestamp).toBe(CHASED);
  });

  it('prefers the answer over both', () => {
    expect(
      intake({
        intake_sent_at: SENT,
        intake_reminded_at: CHASED,
        intake_completed_at: ANSWERED,
        intake_responses: { responses: { q1: 'yes' } },
      })?.timestamp
    ).toBe(ANSWERED);
  });

  it('stays undated when nothing has happened', () => {
    /* Correct: there is no day to file it under. */
    expect(intake({})?.timestamp).toBeFalsy();
  });
});

describe('the other languages', () => {
  it('English', () => {
    expect(intake({}, 'en')?.details).toBe('Not sent yet');
    expect(intake({ status: 'cancelled' }, 'en')?.details).toBe('Never sent');
    expect(intake({ intake_sent_at: SENT }, 'en')?.details).toContain('Sent, awaiting a reply');
  });

  it('Spanish', () => {
    expect(intake({}, 'es')?.details).toBe('Aún no enviado');
  });

  it('an unknown language falls back to English rather than rendering nothing', () => {
    expect(intake({}, 'fr')?.details).toBe('Not sent yet');
  });
});

describe('the step still appears only when it should', () => {
  it('is absent when the business does not collect intake and none exists', () => {
    const data: ExtendedBookingData = { booking: booking(), payment: null };

    expect(buildJourneySteps(data, 'he', false, 'UTC').find(s => s.key === 'intake')).toBeUndefined();
  });

  it('is absent on a PRODUCT even when the business collects intake', () => {
    /*
     * An intake form is what you ask someone before you SEE them. A purchase
     * with no appointment has nothing to prepare for, so the step was drawing a
     * card about a form that would never be sent and could not usefully be
     * sent — complete, after the change above, with a line explaining it had
     * not been.
     *
     * `resolveIntakeForSending` already draws this line on the client's own
     * manage page; the journey was the surface that had not been told.
     */
    const data: ExtendedBookingData = {
      booking: booking({
        service: { service_name: 'מוצר', is_scheduled: false, sale_mode: 'direct' },
      }),
      payment: null,
    };

    expect(buildJourneySteps(data, 'he', true, 'UTC').find(s => s.key === 'intake')).toBeUndefined();
  });

  it('is present on a SCHEDULED service when the business collects intake', () => {
    /* The other half: suppressing it for products must not suppress it where
       it is the whole point. */
    const data: ExtendedBookingData = {
      booking: booking({
        start_time: '2026-10-20T16:00:00.000Z',
        end_time: '2026-10-20T17:00:00.000Z',
        service: { service_name: 'ייעוץ', is_scheduled: true, sale_mode: 'direct' },
      }),
      payment: null,
    };

    expect(buildJourneySteps(data, 'he', true, 'UTC').find(s => s.key === 'intake')).toBeDefined();
  });

  it('survives on a product that DID answer one, because the record outlives the setting', () => {
    /*
     * A service switched from scheduled to unscheduled must not erase answers a
     * client already gave. `hasIntakeData` wins over the service's shape.
     */
    const data: ExtendedBookingData = {
      booking: booking({
        service: { service_name: 'מוצר', is_scheduled: false, sale_mode: 'direct' },
        intake_completed_at: ANSWERED,
        intake_responses: { responses: { q1: 'yes' } },
      }),
      payment: null,
    };

    expect(buildJourneySteps(data, 'he', false, 'UTC').find(s => s.key === 'intake')).toBeDefined();
  });

  it('appears for a response even when the business has since turned intake off', () => {
    /* The record outlives the setting. */
    const data: ExtendedBookingData = {
      booking: booking({
        intake_completed_at: ANSWERED,
        intake_responses: { responses: { q1: 'yes' } },
      }),
      payment: null,
    };

    expect(buildJourneySteps(data, 'he', false, 'UTC').find(s => s.key === 'intake')).toBeDefined();
  });
});

describe('the row reaches the step at all', () => {
  /*
   * `toAppointment` builds an explicit object rather than spreading the row, so
   * a field it does not name is dropped silently. That is why these two
   * timestamps were missing for as long as they were: the column existed, the
   * query selected it, and the mapper simply never mentioned it.
   *
   * Asserted here because every test above calls `buildJourneySteps` directly.
   * Without this, removing the two lines from the mapper leaves the whole suite
   * green and the real card empty again.
   */
  const row = {
    id: 'b1',
    service_id: 's1',
    client_first_name: 'דויד',
    start_time: null,
    end_time: null,
    status: 'confirmed',
    intake_sent_at: SENT,
    intake_reminded_at: CHASED,
    intake_completed_at: ANSWERED,
  };

  it('carries when the form was sent', () => {
    expect(toAppointment(row as never).intake_sent_at).toBe(SENT);
  });

  it('carries when the client was chased', () => {
    expect(toAppointment(row as never).intake_reminded_at).toBe(CHASED);
  });

  it('still carries when it was answered', () => {
    expect(toAppointment(row as never).intake_completed_at).toBe(ANSWERED);
  });

  it('turns an absent timestamp into undefined, not null', () => {
    /* The step tests these for truthiness; a null would read the same, but the
       declared type says `string | undefined` and the mapper should honour it. */
    const bare = toAppointment({ ...row, intake_sent_at: null, intake_reminded_at: null } as never);

    expect(bare.intake_sent_at).toBeUndefined();
    expect(bare.intake_reminded_at).toBeUndefined();
  });
});
