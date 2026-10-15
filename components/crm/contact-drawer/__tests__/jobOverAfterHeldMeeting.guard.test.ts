/**
 * The card asks the JOB whether it is over, not the appointment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * `SchedulingBookingRepository.cancel` no longer overwrites a recorded
 * attendance: a consultation marked held keeps `completed` when its job is
 * cancelled, because the table has no `completed_at` and writing `cancelled`
 * erased that the meeting ever happened.
 *
 * Every place on this card that asked `booking.status === 'cancelled'` was
 * therefore asking the status a question it had stopped answering. The symptom
 * reported was the worst of them: **Cancel came back** on an already-stopped
 * job, offering to call off work the owner had already called off. The others
 * were quieter and would have been found later —
 *
 *   · the badge fell past `lost` onto "quote sent", telling the owner a price
 *     was still with the client on a job they had cancelled
 *   · the cancellation reason vanished from the badge row
 *   · plan stages with no invoice raised went back to looking collectable
 *   · a refunded job read "Refunded" where this card deliberately says "Lost"
 *
 * This is a SOURCE guard. `BookingsTab.tsx` is ~4,700 lines of one component
 * with no seam to render a single card through, so the thing being protected is
 * that these call sites keep consulting `jobCalledOff`. A behavioural test here
 * would need the whole drawer, its fetches and its context.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(
  join(process.cwd(), 'components/crm/contact-drawer/BookingsTab.tsx'),
  'utf8'
);

/**
 * The file with comments removed.
 *
 * Every negative assertion below runs against this. The comments explain the
 * very patterns being forbidden — they quote `booking.status === 'cancelled'`
 * by name — so a test that searched the raw source would pass on its own
 * prose and never see the code.
 */
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('the comment stripping works', () => {
  it('removes a block comment that mentions the forbidden pattern', () => {
    /* If this fails, every negative assertion below is vacuous. */
    expect(SOURCE).toContain('`booking.status === \'cancelled\'` used to be the only answer');
    expect(code).not.toContain('used to be the only answer');
  });

  it('keeps the code', () => {
    expect(code).toContain('const jobCalledOff =');
    expect(code).toContain('function jobIsOver');
  });
});

describe('jobCalledOff is derived from the job, not the appointment', () => {
  it('reads the cancellation columns that every cancel path writes', () => {
    /*
     * These are what make a held-then-cancelled job answerable at all: the
     * status stays `completed`, so `cancel_reason` and `cancelled_by` are the
     * only trace on the booking row that it was called off.
     */
    const derivation = code.slice(
      code.indexOf('const jobCalledOff ='),
      code.indexOf('const jobCalledOff =') + 220
    );

    expect(derivation).toContain('booking.cancel_reason');
    expect(derivation).toContain('booking.cancelled_by');
    expect(derivation).toContain("quoteState === 'stopped'");
  });

  it('keeps the booking status as one of the signals', () => {
    /*
     * The predicate has to be a SUPERSET of the old test, not a replacement
     * for it. Rows cancelled by older code paths carry no `cancel_reason` and
     * no stopped quote, so the status is the only thing that says they are
     * off — and `cancelledUnpaid` now relies on this predicate alone, so
     * dropping it would put those jobs' unpaid stages back to collectable.
     */
    const derivation = code.slice(
      code.indexOf('const jobCalledOff ='),
      code.indexOf('const jobCalledOff =') + 220
    );

    expect(derivation).toContain("booking.status === 'cancelled'");
  });

  it('does not read cancellation_reason, which holds unrelated prose', () => {
    /*
     * `cancellation_reason` is free text — it carries the stored
     * `CLIENT_CANCELLED_PREFIX` and whatever else was typed into it, including
     * reschedule notes on bookings that were never cancelled. Deriving "called
     * off" from it would call those jobs off.
     */
    const derivation = code.slice(
      code.indexOf('const jobCalledOff ='),
      code.indexOf('const jobCalledOff =') + 220
    );

    expect(derivation).not.toContain('cancellation_reason');
  });
});

describe('jobIsOver', () => {
  it('accepts a calledOff input', () => {
    const fn = code.slice(code.indexOf('function jobIsOver'), code.indexOf('function attendanceRecorded'));

    expect(fn).toContain('calledOff');
  });

  it('unions calledOff with the status rather than replacing it', () => {
    /*
     * Rows cancelled by older code paths carry no `cancel_reason`, and a
     * booking cancelled before it was ever held still writes `cancelled`.
     * Dropping the status test would make those jobs look live again — the
     * same bug in the opposite direction.
     */
    const fn = code.slice(code.indexOf('function jobIsOver'), code.indexOf('function attendanceRecorded'));

    expect(fn).toContain("input.status === 'cancelled' || Boolean(input.calledOff)");
  });

  it('is passed calledOff where it gates the action strip', () => {
    /*
     * The reported bug. Without this argument the strip reappears on a stopped
     * job and offers Cancel again.
     */
    const call = code.slice(code.indexOf('!jobIsOver({'), code.indexOf('!jobIsOver({') + 220);

    expect(call).toContain('calledOff: jobCalledOff');
  });

  it('still ends a quoted job only on cancellation or payment', () => {
    /*
     * The reason Cancel is offered after "mark held" in the first place: for a
     * quoted job the consultation is where the work STARTS, so holding it must
     * not end anything. If this reverts to reading attendance, an owner who
     * records a consultation loses the ability to call off unpriced work.
     */
    const fn = code.slice(code.indexOf('function jobIsOver'), code.indexOf('function attendanceRecorded'));

    expect(fn).toContain('if (input.isQuoted) return cancelled || input.quotePaid;');
  });
});

describe('the call sites that were reading the status', () => {
  const site = (needle: string, span = 320) => {
    const at = code.indexOf(needle);
    expect(at).toBeGreaterThan(-1);
    return code.slice(at, at + span);
  };

  it('the quoted badge is told the job was called off', () => {
    expect(site('getQuotedStatusLabel(\n', 420)).toContain('jobCalledOff');
  });

  it('the quoted badge has a calledOff branch below its stopped branch', () => {
    /*
     * Order is the assertion. An agreed job stopped part-way is not lost, and
     * that distinction is why `stopped` has its own badge — so `calledOff`
     * must not preempt it.
     */
    const fn = code.slice(code.indexOf('const getQuotedStatusLabel'), code.indexOf('const getBookingStatusLabel'));
    const stoppedAt = fn.indexOf("quoteState === 'stopped'");
    const calledOffAt = fn.indexOf('if (calledOff)');

    expect(stoppedAt).toBeGreaterThan(-1);
    expect(calledOffAt).toBeGreaterThan(stoppedAt);
  });

  it('the refund badge defers to the called-off job', () => {
    expect(site('const moneyReturned =')).toContain('!jobCalledOff');
  });

  it('the cancellation reason shows on a held-then-cancelled job', () => {
    expect(code).toContain('{jobCalledOff &&\n                        (booking.cancel_reason');
  });

  it('an uninvoiced plan stage still reads as closed', () => {
    expect(site('const cancelledUnpaid =')).toContain('jobCalledOff ||');
  });
});

describe('attendance is still asked of the appointment', () => {
  it('attendanceRecorded is unchanged and still status-only', () => {
    /*
     * The other half of the split. The two attendance buttons hide once
     * attendance is recorded, and that IS the booking's own status — conflating
     * it with the job's state is the bug this whole pair exists to avoid.
     */
    const fn = code.slice(code.indexOf('function attendanceRecorded'), code.indexOf('function AddPackageMeeting'));

    expect(fn).toContain("status === 'completed' || status === 'cancelled' || status === 'no_show'");
    expect(fn).not.toContain('calledOff');
  });
});
