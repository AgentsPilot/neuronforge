/**
 * When the drawer may say an owner owes a price.
 *
 * Two real defects are pinned here. The journey used to flip to "your move" the
 * moment a consultation's start time passed — asserting a meeting that may never
 * have happened — and a no-show closed the job entirely, contradicting the
 * drawer's own comment that only cancelling means the work is off.
 */

import { quoteGate, quoteWaitingOn, type QuoteGateInput } from '../quoteGate';

const NOW = new Date('2026-10-04T12:00:00.000Z');
const BEFORE = new Date('2026-10-04T09:30:00.000Z');
const AFTER = new Date('2026-10-05T09:30:00.000Z');

const base: QuoteGateInput = {
  bookingStatus: 'confirmed',
  startTime: AFTER,
  isUnscheduled: false,
  proposalStatus: null,
  now: NOW,
};

describe('before the meeting', () => {
  it('waits, and nobody owes anything', () => {
    expect(quoteGate(base)).toBe('ahead');
    expect(quoteWaitingOn('ahead')).toBe('meeting');
  });
});

describe('the time has passed and nothing is marked', () => {
  it('asks, rather than claiming the meeting happened', () => {
    expect(quoteGate({ ...base, startTime: BEFORE })).toBe('unmarked');
    expect(quoteWaitingOn('unmarked')).toBe('unmarked');
  });

  it('is the same for a booking still sitting at pending', () => {
    expect(quoteGate({ ...base, bookingStatus: 'pending', startTime: BEFORE })).toBe('unmarked');
  });
});

describe('once the owner says what happened', () => {
  it('held means the owner may quote', () => {
    expect(quoteGate({ ...base, bookingStatus: 'completed', startTime: BEFORE })).toBe('open');
    expect(quoteWaitingOn('open')).toBe('owner');
  });

  it('missed keeps the job ALIVE — it does not close it', () => {
    // The defect: `no_show` was folded in with `cancelled`, so a client who
    // missed a site visit took the quote button away with them.
    expect(quoteGate({ ...base, bookingStatus: 'no_show', startTime: BEFORE })).toBe('missed');
    expect(quoteWaitingOn('missed')).toBe('noshow');
  });

  it('cancelled is the only mark that ends it', () => {
    expect(quoteGate({ ...base, bookingStatus: 'cancelled', startTime: BEFORE })).toBe('closed');
    expect(quoteWaitingOn('closed')).toBe('closed');
  });
});

describe('a quote that already exists', () => {
  it('drives the step itself, whatever the meeting was marked', () => {
    // Quoting from the van: a price sent before anyone ticked the appointment
    // must not be re-gated on that tick.
    expect(quoteGate({ ...base, startTime: BEFORE, proposalStatus: 'sent' })).toBe('open');
    expect(quoteWaitingOn('open', 'sent')).toBe('client');
  });

  it('puts the ball back with the owner when it was declined', () => {
    expect(quoteWaitingOn('open', 'declined')).toBe('owner');
  });

  it('but a STOPPED quote closes the job, with no booking involved', () => {
    // Stopping a quote touches no booking, so the booking status can never see
    // it — a bookingless quote has no appointment to cancel.
    expect(
      quoteGate({ ...base, bookingStatus: 'confirmed', startTime: null, proposalStatus: 'stopped' })
    ).toBe('closed');
  });

  it('and a cancelled booking beats a live quote', () => {
    expect(
      quoteGate({ ...base, bookingStatus: 'cancelled', startTime: BEFORE, proposalStatus: 'sent' })
    ).toBe('closed');
  });
});

describe('when there is no meeting to wait for', () => {
  it('an unscheduled service is the owner\'s move at once', () => {
    expect(quoteGate({ ...base, isUnscheduled: true, startTime: null })).toBe('open');
  });

  it('so is a quote sent cold, with no booking behind it', () => {
    // `proposals.booking_id` is nullable and the create route defaults it to
    // null, so this is an ordinary case rather than a broken row.
    expect(quoteGate({ ...base, startTime: null })).toBe('open');
  });

  it('and an unusable date does not strand the step', () => {
    expect(quoteGate({ ...base, startTime: new Date('nonsense') })).toBe('open');
  });
});

describe('the clock', () => {
  it('turns at the start time, not at the end of the day', () => {
    const start = new Date('2026-10-04T11:59:59.000Z');
    expect(quoteGate({ ...base, startTime: start, now: NOW })).toBe('unmarked');

    const soon = new Date('2026-10-04T12:00:01.000Z');
    expect(quoteGate({ ...base, startTime: soon, now: NOW })).toBe('ahead');
  });
});
