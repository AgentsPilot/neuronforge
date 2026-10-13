/**
 * Automation #5 may only ever close a meeting that actually happened.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the first automation that writes to the OWNER'S OWN RECORDS instead
 * of sending a message, which makes its failure mode quieter than the others:
 * nobody receives a wrong email, a status just silently becomes untrue. The
 * three conditions below are what stop that, and each one is a different way of
 * being wrong:
 *
 *   cancelled  -> the meeting did not happen; completing it invents revenue
 *   future     -> it has not happened YET; a rescheduled booking moved forward
 *                 would otherwise be closed before it occurred
 *   already    -> somebody got there first, so there is nothing to do and
 *                 certainly no second event to emit
 *
 * `completeMeeting` is module-private and sits on `supabaseServer` plus two
 * repositories, so this guards the source rather than executing it. The
 * behavioural half is covered where it belongs: the atomic claim in
 * `SchedulingRepository.update()` has its own suite
 * (`SchedulingRepository.statusTransition.test.ts`), and that claim is what
 * makes a replayed queue row a no-op.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(join(__dirname, '..', 'LeadResponseDispatchService.ts'), 'utf8');

/** `completeMeeting`, from its signature to the end of its body. */
const fn = source.slice(
  source.indexOf('async function completeMeeting'),
  source.indexOf('async function remindAboutMeeting')
);

describe('completeMeeting', () => {
  it('is a real slice of the file, so these assertions mean something', () => {
    // Every assertion below is a substring match; an empty haystack passes none
    // of the positives but would hide a rename.
    expect(fn.length).toBeGreaterThan(500);
  });

  it('is reached only by its own queue kind', () => {
    expect(source).toContain("if (row.kind === 'meeting_complete') return completeMeeting(row, log);");
  });

  it('refuses a meeting that is not still waiting to be marked', () => {
    /*
     * A cancelled meeting did not happen. Completing it would put a booking
     * into the retention metrics that nobody attended, and emit a
     * `booking.completed` event against it.
     */
    expect(fn).toMatch(/status !== 'confirmed' && status !== 'pending'/);
    expect(fn).toContain("reason: 'already_resolved'");
  });

  it('refuses a meeting whose start time has not passed', () => {
    /*
     * `dueAt` already encodes the twelve-hour wait, but a queue row can be
     * drained late or replayed, and a booking can be moved FORWARD after the
     * row was written. The booking's own clock is the authority.
     */
    expect(fn).toMatch(/startedAt > Date\.now\(\)/);
    expect(fn).toContain("reason: 'not_yet_past'");
  });

  it('treats an unparseable start time as "do not act"', () => {
    // A missing or malformed date must not read as "long ago".
    expect(fn).toMatch(/Number\.isNaN\(startedAt\)/);
  });

  it('goes through the repository, not a direct update', () => {
    /*
     * Two things depend on this and both are invisible if it changes:
     * `update()` makes the status change an atomic claim, so two drains cannot
     * both complete one meeting; and it is the path that emits
     * `booking.completed` on the event rail. A direct write here would mark the
     * meeting and leave the rail silent.
     */
    expect(fn).toContain('schedulingBookingRepository.complete(');
    expect(fn).not.toMatch(/\.from\('scheduling_bookings'\)[\s\S]{0,120}\.update\(/);
  });

  it('reads a null result as "somebody else did it", not as success', () => {
    // The atomic claim returns no row when the status was already the target.
    expect(fn).toMatch(/if \(!data\) return \{ sent: false, reason: 'already_resolved' \}/);
  });

  it('sends nothing to anybody', () => {
    /*
     * The property that makes this the lowest-risk automation on the board. If
     * a send ever appears here it is a different feature and needs the consent
     * conversation the other four had.
     */
    expect(fn).not.toMatch(/sendEmail|emailTransport|notifyOwner/);
  });
});

/**
 * Every completion it writes stays answerable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `completed` is one of three answers and this can only give the first. The
 * moment it writes that answer the booking leaves `meeting_unmarked`, so the
 * owner's prompt disappears at the same instant the assumption is recorded.
 * The `booking_auto_completed` marker is what puts a correction back in front
 * of them, via the `meeting_auto_completed` gap, for seven days.
 *
 * So the marker is not decoration and the ORDER is the safety: written first,
 * and a failure to write it stops the completion. A marker with no completion
 * is invisible (the gap requires the booking to actually be `completed`); a
 * completion with no marker is a no-show silently on the books as attendance
 * with no surface left to correct it on.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('the correction it leaves behind', () => {
  it('records who decided, with the marker the triage row reads', () => {
    expect(fn).toContain("activity_type: 'booking_auto_completed'");
    expect(fn).toContain('source_entity_id: booking.id');
  });

  it('writes the marker BEFORE completing, not after', () => {
    const marker = fn.indexOf("activity_type: 'booking_auto_completed'");
    const complete = fn.indexOf('schedulingBookingRepository.complete');

    expect(marker).toBeGreaterThan(-1);
    expect(complete).toBeGreaterThan(-1);
    expect(marker).toBeLessThan(complete);
  });

  it('does not complete the meeting when the marker cannot be written', () => {
    // Leaving it on the Needs You card is the status quo, and harmless.
    expect(fn).toMatch(/marker\.error[\s\S]{0,400}?return \{ sent: false, reason: 'marker_failed' \}/);
  });

  it('writes the owner their own language, not English', () => {
    expect(fn).toContain('getBusinessLocale(row.user_id)');
  });
});

/**
 * The row says what is about to happen to it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The unmarked gap claims a meeting two hours after it ends; the automation
 * answers at twelve. So for ten hours the Needs You row asked the owner to
 * decide something the platform was about to decide, said nothing about it, and
 * then disappeared when the queue drained.
 *
 * Nothing was broken. But a task vanishing with no explanation is how somebody
 * stops trusting the list, and the owner could not tell the automation having
 * run from the row having been a mistake.
 *
 * A sentence, not a control — the seven-day triage row above already lets them
 * correct an auto-completed meeting, so a Cancel here would add ten hours of
 * prevention to a week of cure.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('the warning before it happens', () => {
  const route = readFileSync(
    join(__dirname, '..', '..', '..', 'app', 'api', 'business-os', 'gaps', 'route.ts'),
    'utf8'
  );

  it('looks up the queued close, not only the queued reply', () => {
    expect(route).toContain("row.kind === 'meeting_complete' && row.status === 'pending'");
  });

  /*
   * Keyed by BOOKING. One client can have three unmarked meetings and the
   * queue carries one row per booking, so keying this the way the enquiry map
   * is keyed would put the wrong time on two of them.
   */
  it('keys it by the booking rather than the contact', () => {
    expect(route).toMatch(/closingByBooking[\s\S]{0,200}?row\.entity_id/);
    expect(route).toContain('closingByBooking.get(item.entityId)');
  });

  it('carries a time and nothing else', () => {
    const card = readFileSync(
      join(__dirname, '..', '..', '..', 'components', 'business-os', 'insight', 'NeedsYouCard.tsx'),
      'utf8'
    );

    expect(card).toContain("t('gaps.closing_at')");
    // No action: a button here would be a second way to do what the triage
    // row already does, on a row that is about to resolve itself.
    expect(card).not.toMatch(/closingAt[\s\S]{0,400}?onClick/);
  });
});

/**
 * The gap that carries the correction, and the window it lives in.
 */
describe('the triage row', () => {
  const definitions = readFileSync(
    join(__dirname, '..', '..', 'business-os', 'gaps', 'definitions.ts'),
    'utf8'
  );

  it('is an owner errand, so it reaches the dashboard', () => {
    expect(definitions).toMatch(/id: 'meeting_auto_completed',\s*\n\s*blocksOn: 'owner',/);
  });

  it('reads the marker the automation writes', () => {
    expect(definitions).toContain(".eq('activity_type', 'booking_auto_completed')");
  });

  /*
   * The filter that makes the row disappear once answered. Without it, an
   * owner who corrected a meeting to `no_show` would keep being asked about it
   * for the rest of the week.
   */
  it('drops a meeting the owner has already corrected', () => {
    const gap = definitions.slice(
      definitions.indexOf("id: 'meeting_auto_completed'"),
      definitions.indexOf('export const GAP_DEFINITIONS')
    );
    expect(gap).toContain(".eq('status', 'completed')");
  });

  it('settles after a week rather than accumulating', () => {
    expect(definitions).toContain('const MEETING_TRIAGE_DAYS = 7');
  });
});

describe('the registry entry', () => {
  const automations = readFileSync(
    join(__dirname, '..', '..', 'business-os', 'gaps', 'automations.ts'),
    'utf8'
  );

  it('is opt-in and bound to the gap that already finds this work', () => {
    const entry = automations.slice(
      automations.indexOf("id: 'auto_complete_meetings'"),
      automations.indexOf('hintKey', automations.indexOf("id: 'auto_complete_meetings'"))
    );

    expect(entry).toContain("gapId: 'meeting_unmarked'");
    expect(entry).toContain("covers: ['meeting_complete']");
    expect(entry).toContain("sweepQueues: 'meeting_complete'");
    // Only a business that takes bookings has meetings to mark.
    expect(entry).toContain("requires: 'takes_bookings'");
  });

  it('defaults to off in the migration', () => {
    /*
     * Unlike `payment_reminder_enabled`, which defaults true. This one writes to
     * the owner's records rather than sending a message, and a status changing
     * without anyone asking is worse than an email nobody minded.
     */
    const migration = readFileSync(
      join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261006d_auto_complete_meetings.sql'),
      'utf8'
    );

    expect(migration).toMatch(/auto_complete_meetings_enabled boolean NOT NULL DEFAULT false/);
    // The queue rejects an unlisted kind outright, so the CHECK must know it.
    expect(migration).toContain("'meeting_complete'");
  });
});
