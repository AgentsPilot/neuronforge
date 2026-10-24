/**
 * One question at a time, and the right one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The dialog's four cases, each of which was a real bug or is one waiting:
 *
 *   · a product has no date step — the dialog demanded a date for a course
 *     and refused to save without one;
 *   · a package slot inherits service and client, so those are answered
 *     before anyone sees the dialog;
 *   · a settled booking is read, not filled;
 *   · reopening step 1 must not send steps 2 and 3 back to "pending" when
 *     they already have answers.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { planBookingSteps, bookingFooterSummary } from '@/lib/scheduling/bookingSteps';
import type { BookingStepFacts } from '@/lib/scheduling/bookingSteps';

const blank: BookingStepFacts = {
  service: null,
  client: null,
  when: null,
  details: null,
  needsSchedule: true,
};

const stateOf = (facts: BookingStepFacts, opened?: 'service' | 'client' | 'when' | 'details') =>
  Object.fromEntries(planBookingSteps(facts, opened).map(s => [s.key, s.state]));

describe('an empty dialog', () => {
  it('asks for the service and nothing else', () => {
    expect(stateOf(blank)).toEqual({
      service: 'open',
      client: 'pending',
      when: 'pending',
      details: 'pending',
    });
  });

  it('numbers the steps from one', () => {
    expect(planBookingSteps(blank).map(s => s.index)).toEqual([1, 2, 3, 4]);
  });
});

describe('moving through it', () => {
  it('a chosen service collapses and the client is asked', () => {
    expect(stateOf({ ...blank, service: 'ייעוץ אישי · 60 דק׳ · ₪400' })).toEqual({
      service: 'done',
      client: 'open',
      when: 'pending',
      details: 'pending',
    });
  });

  it('then the hour', () => {
    expect(stateOf({ ...blank, service: 'ייעוץ', client: 'דנה כהן' })).toEqual({
      service: 'done',
      client: 'done',
      when: 'open',
      details: 'pending',
    });
  });

  it('and the dialog rests on the details once the facts are in', () => {
    /*
     * Notes and intake are optional, so nothing can answer this step for the
     * owner — which is why it is last and why it stays open.
     */
    expect(
      stateOf({ ...blank, service: 'ייעוץ', client: 'דנה כהן', when: 'יום ג׳ 10:00' })
    ).toEqual({
      service: 'done',
      client: 'done',
      when: 'done',
      details: 'open',
    });
  });
});

describe('a service with no date step', () => {
  it('has three steps, and none of them is the hour', () => {
    const plan = planBookingSteps({ ...blank, needsSchedule: false });

    expect(plan.map(s => s.key)).toEqual(['service', 'client', 'details']);
  });

  it('so answering service and client rests on the details, not on an hour', () => {
    /*
     * The bug this replaces: an ADHD course is bought, not booked into an
     * hour. The dialog asked for a date anyway and would not save without
     * one — a required field for a fact that does not exist.
     */
    expect(
      stateOf({ ...blank, needsSchedule: false, service: 'קורס', client: 'דנה כהן' })
    ).toEqual({ service: 'done', client: 'done', details: 'open' });
  });

  it('and the numbering closes up rather than skipping 3', () => {
    const plan = planBookingSteps({ ...blank, needsSchedule: false });

    expect(plan.map(s => [s.key, s.index])).toEqual([
      ['service', 1],
      ['client', 2],
      ['details', 3],
    ]);
  });
});

describe('picking a slot for a package', () => {
  it('opens on the hour, because the service and the client came with it', () => {
    expect(stateOf({ ...blank, service: 'חבילת 4 מפגשים', client: 'דנה כהן' }).when).toBe('open');
  });
});

describe('a settled booking', () => {
  it('opens nothing: it is read, not filled', () => {
    expect(
      stateOf({
        ...blank,
        service: 'ייעוץ',
        client: 'דנה כהן',
        when: 'יום ג׳ 10:00',
        settled: true,
      })
    ).toEqual({ service: 'done', client: 'done', when: 'done', details: 'pending' });
  });

  it('and does not open the first blank one either', () => {
    /* A cancelled booking with no notes must not pop the details open. */
    expect(stateOf({ ...blank, service: 'ייעוץ', settled: true }).client).toBe('pending');
  });
});

describe('reopening a step the owner already answered', () => {
  const answered: BookingStepFacts = {
    service: 'ייעוץ',
    client: 'דנה כהן',
    when: 'יום ג׳ 10:00',
    details: 'טופס לקוח יישלח',
    needsSchedule: true,
  };

  it('opens that one', () => {
    expect(stateOf(answered, 'service').service).toBe('open');
  });

  it('and the steps after it keep their answers instead of going back to pending', () => {
    /*
     * The failure worth guarding: changing the service must not make the
     * client and the hour look unanswered. The owner would re-enter facts the
     * dialog is still holding.
     */
    expect(stateOf(answered, 'service')).toEqual({
      service: 'open',
      client: 'done',
      when: 'done',
      details: 'done',
    });
  });

  it('a step that does not apply cannot be opened', () => {
    /*
     * "when" on a product. The order falls back to the natural one rather
     * than opening nothing — asserted with a step still blank, because when
     * everything is answered an ignored `opened` and an honoured one look
     * identical.
     */
    const product: BookingStepFacts = {
      ...answered,
      needsSchedule: false,
      when: null,
      client: null,
    };

    expect(stateOf(product, 'when')).toEqual({
      service: 'done',
      client: 'open',
      details: 'done',
    });
  });

  it('and it beats the natural order even when an earlier step is blank', () => {
    expect(stateOf({ ...blank, service: 'ייעוץ' }, 'details')).toEqual({
      service: 'done',
      client: 'pending',
      when: 'pending',
      details: 'open',
    });
  });
});

describe('a summary that says nothing is not an answer', () => {
  it('an empty string leaves the step open', () => {
    /*
     * The one failure the collapsing design is most likely to produce: a step
     * marked answered before its summary is ready collapses to a bare tick,
     * hiding the control the owner still needs.
     */
    expect(stateOf({ ...blank, service: '' }).service).toBe('open');
  });

  it('and the summary comes back null, not as the empty string', () => {
    const [service] = planBookingSteps({ ...blank, service: '' });

    expect(service.summary).toBeNull();
  });

  it('while a real one is carried through untouched', () => {
    const [service] = planBookingSteps({ ...blank, service: 'ייעוץ אישי · 60 דק׳ · ₪400' });

    expect(service.summary).toBe('ייעוץ אישי · 60 דק׳ · ₪400');
  });
});

describe('a step the dialog is refusing', () => {
  const filled: BookingStepFacts = {
    service: 'ייעוץ',
    client: 'דנה כהן · not-an-email',
    when: 'יום ג׳ 10:00',
    details: null,
    needsSchedule: true,
  };

  it('stays open, so its message is on screen', () => {
    /*
     * The worst state the collapsing design can produce: a tick, a dead Save
     * button, and the explanation hidden inside the step that closed over it.
     */
    expect(stateOf({ ...filled, errors: { client: true } }).client).toBe('open');
  });

  it('even though it has a summary it could have collapsed to', () => {
    const [, client] = planBookingSteps({ ...filled, errors: { client: true } });

    expect(client.summary).toBe('דנה כהן · not-an-email');
  });

  it('and it beats a later step that would otherwise be the open one', () => {
    expect(stateOf({ ...filled, errors: { service: true } })).toEqual({
      service: 'open',
      client: 'done',
      when: 'done',
      details: 'pending',
    });
  });

  it('while a step with no error collapses as usual', () => {
    expect(stateOf({ ...filled, errors: { client: false } }).client).toBe('done');
  });

  it('on a settled booking nothing opens even so', () => {
    /* Nothing there is the owner's to fix, and a refusal on a cancelled
       booking is not a question being asked. */
    expect(stateOf({ ...filled, settled: true, errors: { client: true } }).client).toBe('pending');
  });
});

describe('the footer line', () => {
  it('reads service, hour, client — the order a person says it in', () => {
    expect(
      bookingFooterSummary({
        service: 'ייעוץ אישי',
        when: 'יום ג׳, 20 באוק׳ 10:00',
        client: 'דנה כהן',
        details: null,
        needsSchedule: true,
      })
    ).toBe('ייעוץ אישי · יום ג׳, 20 באוק׳ 10:00 · דנה כהן');
  });

  it('drops what is not answered yet rather than leaving a gap', () => {
    /* Not "ייעוץ אישי ·  · " — a separator with nothing after it reads as a
       missing value rather than a question not yet reached. */
    expect(bookingFooterSummary({ ...blank, service: 'ייעוץ אישי' })).toBe('ייעוץ אישי');
  });

  it('and says nothing at all on an empty dialog', () => {
    expect(bookingFooterSummary(blank)).toBe('');
  });

  it('never mentions the details step', () => {
    /* The footer is where the booking STANDS. "Notes added" is not a fact
       about the appointment. */
    expect(bookingFooterSummary({ ...blank, details: 'הערות' })).toBe('');
  });
});
