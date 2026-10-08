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
