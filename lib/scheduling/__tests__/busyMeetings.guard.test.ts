/**
 * The two ways slot occupancy can break silently.
 *
 * Both have happened. Neither raises an error, neither shows in a log, and
 * both are only visible as a double booking or an hour that cannot be sold.
 */

import fs from 'fs';
import path from 'path';

import {
  MEETING_HOLDS_SLOT_FILTER,
  MEETING_STATUSES,
  holdsSlot,
} from '@/lib/business-os/bookingStatus';
import { overlapsBusy, type BusyInterval } from '@/lib/scheduling/busyMeetings';

const read = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n');

describe('the filter cannot be written as a NOT IN', () => {
  /*
   * In SQL, `NULL NOT IN ('no_show','cancelled')` is NULL — not true. An
   * unmarked meeting would therefore fail the filter and vanish from the
   * result, and since NULL is the normal state of every FUTURE appointment,
   * every future slot would read as free. The whole diary would be bookable.
   *
   * So the filter has to name what DOES hold a slot, positively.
   */
  it('names what holds a slot rather than what does not', () => {
    expect(MEETING_HOLDS_SLOT_FILTER).toContain('is.null');
    expect(MEETING_HOLDS_SLOT_FILTER).toContain('eq.held');
    expect(MEETING_HOLDS_SLOT_FILTER).not.toContain('not.in');
    expect(MEETING_HOLDS_SLOT_FILTER).not.toContain('neq');
  });

  it('accounts for every outcome a meeting can have', () => {
    /* A new outcome added to the enum and not considered here is a slot whose
       occupancy nobody decided. Freeing or holding is a choice; forgetting is
       not. */
    const held = ['held'];
    const frees = ['no_show', 'cancelled', 'moved'];
    expect([...held, ...frees].sort()).toEqual([...MEETING_STATUSES].sort());
  });
});

describe('cancel() reads the column the outcome actually lives in', () => {
  /*
   * `complete()` and `markNoShow()` stopped writing `status` — that is the
   * separation. A meeting marked held today reads `status = 'confirmed'` and
   * only `meeting_status = 'held'`.
   *
   * `cancel()` preserves a recorded attendance by testing for one. If it tests
   * `status` alone it finds nothing, concludes no meeting happened, and writes
   * `meeting_status: 'cancelled'` over the `held` — erasing the exact fact this
   * separation was built to keep. It has to read BOTH, and it has to SELECT
   * both: a column absent from the select is `undefined`, not false, and
   * PostgREST rejects the whole query for one unknown name.
   */
  const repo = read('lib/repositories/SchedulingRepository.ts');
  const cancelBody = repo.slice(repo.indexOf('async cancel('));

  it('selects meeting_status before deciding', () => {
    const select = cancelBody.slice(0, cancelBody.indexOf('.maybeSingle()'));
    expect(select).toContain('meeting_status');
  });

  it('treats held and no_show on meeting_status as a recorded outcome', () => {
    const decision = cancelBody.slice(0, cancelBody.indexOf('const result ='));
    expect(decision).toMatch(/meeting_status === 'held'/);
    expect(decision).toMatch(/meeting_status === 'no_show'/);
  });

  it('still honours the old column, for rows that predate the split', () => {
    const decision = cancelBody.slice(0, cancelBody.indexOf('const result ='));
    expect(decision).toMatch(/status === 'completed'/);
  });
});

describe('overlapsBusy is half-open, so back-to-back appointments are bookable', () => {
  const busy: BusyInterval[] = [
    { start_time: '2026-03-02T10:00:00.000Z', end_time: '2026-03-02T11:00:00.000Z' },
  ];

  it('does not collide with a slot starting exactly when it ends', () => {
    expect(overlapsBusy('2026-03-02T11:00:00.000Z', '2026-03-02T12:00:00.000Z', busy)).toBe(false);
  });

  it('does not collide with a slot ending exactly when it starts', () => {
    expect(overlapsBusy('2026-03-02T09:00:00.000Z', '2026-03-02T10:00:00.000Z', busy)).toBe(false);
  });

  it('collides on a partial overlap at either end', () => {
    expect(overlapsBusy('2026-03-02T10:30:00.000Z', '2026-03-02T11:30:00.000Z', busy)).toBe(true);
    expect(overlapsBusy('2026-03-02T09:30:00.000Z', '2026-03-02T10:30:00.000Z', busy)).toBe(true);
  });

  it('collides with a slot wholly inside it, and with one that swallows it', () => {
    expect(overlapsBusy('2026-03-02T10:15:00.000Z', '2026-03-02T10:45:00.000Z', busy)).toBe(true);
    expect(overlapsBusy('2026-03-02T08:00:00.000Z', '2026-03-02T13:00:00.000Z', busy)).toBe(true);
  });

  it('is free when nothing is busy', () => {
    expect(overlapsBusy('2026-03-02T10:00:00.000Z', '2026-03-02T11:00:00.000Z', [])).toBe(false);
  });
});

describe('the window is an overlap, not a containment', () => {
  /*
   * An appointment that starts before the window and runs into it still
   * occupies the window's opening slots. Asking `start_time >= from` misses
   * it — which is how a long appointment across a day boundary gets double
   * booked, and is what the owner-side availability read did before this.
   */
  const src = read('lib/scheduling/busyMeetings.ts');
  const query = src.slice(src.indexOf('.from(\'scheduling_meetings\')'));

  it('bounds on lt(start, to) and gt(end, from)', () => {
    expect(query).toContain(".lt('start_time', to)");
    expect(query).toContain(".gt('end_time', from)");
  });

  it('never bounds the start by the window start', () => {
    expect(query).not.toContain(".gte('start_time'");
  });

  it('filters by owner — CLAUDE.md rule 4', () => {
    expect(query).toContain(".eq('user_id', userId)");
  });
});

/**
 * Strips comments before asserting on source.
 *
 * Mandatory here, not tidiness: the block these guards cover is mostly prose,
 * and that prose contains every string below — the words "moved", the status
 * name, the method calls. A raw `toContain` would pass against a file whose
 * code had been deleted and whose comment survived.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('a moved appointment gives its hour back', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * Rescheduling writes a second attempt so the time already communicated to a
   * client survives. The first row was then left at `meeting_status: NULL`,
   * and null MUST read as holding (see the top of this file), so the abandoned
   * hour stayed blocked forever — against everybody, including that same
   * client rebooking.
   *
   * Invisible: no error, no log, just an hour that never comes up in the
   * picker. 14 of them on the live database, 8 sitting on top of an
   * appointment somebody else had since taken.
   *
   * THE RELEASE AND THE NEW ATTEMPT ARE ONE STEP. Doing them as two statements
   * from the application cannot be correct in either order:
   *
   *   insert then release — the old attempt still holds its hour while the new
   *     one is written, so a 60-minute appointment moved 30 minutes collides
   *     WITH ITSELF and is refused 23P01. Proved on live data: an attempt at
   *     14:30–15:30 refused one at 15:00–16:00. And the refusal is silent,
   *     because the booking's own update succeeds and this sync is
   *     non-blocking — so the job takes the new time while the meetings table
   *     keeps the old one.
   *
   *   release then insert — a refused insert leaves the appointment holding no
   *     time at all.
   *
   * `move_meeting` (20261087) does both in one transaction, which is the only
   * way to have both guarantees.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const repo = code('lib/repositories/SchedulingRepository.ts');
  const moveBranch = repo.slice(repo.indexOf('if (movedInTime) {'));
  const upToLog = moveBranch.slice(0, moveBranch.indexOf('Appointment moved'));

  it('moves through the function, not through two statements', () => {
    expect(upToLog).toContain("rpc('move_meeting'");
  });

  it('never writes the release or the new attempt itself', () => {
    /* Either one alone is a broken state the function exists to prevent. */
    expect(upToLog).not.toContain("from('scheduling_meetings').insert");
    expect(upToLog).not.toContain("meeting_status: 'moved'");
  });

  it('hands the function the attempt to count from, by id', () => {
    /* The next occurrence number is read off the locked row inside the
       function, so no caller can supply one from a stale read. */
    expect(upToLog).toContain('p_meeting_id');
    expect(upToLog).toContain('p_user_id');
  });

  it('tells a taken hour apart from a fault', () => {
    /* 23P01 means somebody else holds the new time and the appointment keeps
       the one it had — true and recoverable, not a sync failure. */
    expect(upToLog).toContain('isSlotTakenError');
  });

  it('frees the slot, in the predicate as well as the filter', () => {
    /* Behavioural, not source: the one assertion here that cannot pass by
       accident. A confirmed job whose attempt was moved must not hold its old
       hour — falling through to the job's status is what kept it. */
    expect(holdsSlot({ status: 'confirmed', meeting_status: 'moved' })).toBe(false);
    expect(holdsSlot({ status: 'confirmed', meeting_status: null })).toBe(true);
  });
});

describe('the function that moves it', () => {
  const sql = read('supabase/migrations/20261087_moving_a_meeting_is_one_step.sql')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*--.*$/gm, '');

  it('releases the old hour BEFORE taking the new one', () => {
    /* The other order collides with itself on any move shorter than the
       appointment's own length. */
    const release = sql.indexOf("SET meeting_status = 'moved'");
    const insert = sql.indexOf('INSERT INTO public.scheduling_meetings');

    expect(release).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(release);
  });

  it('is one transaction, so a refused hour rolls the release back', () => {
    /* Without this, a move to an hour somebody else took would leave the
       appointment holding no time at all. */
    expect(sql).toContain('LANGUAGE plpgsql');
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.move_meeting/);
  });

  it('locks the attempt it is moving', () => {
    /* `(booking_id, occurrence_number)` is not unique — a package's sessions
       share a booking — so two concurrent moves would both write attempt #2
       and nothing would catch it. */
    expect(sql).toContain('FOR UPDATE');
  });

  it('keeps the attempt on the SAME session', () => {
    /* A move is another attempt at one session, not a new session. Writing a
       fresh `session_number` would add a seventh appointment to a package of
       six every time one was rescheduled. */
    expect(sql).toContain('session_number');
    expect(sql).toContain('occurrence_number + 1');
  });

  it('never overwrites a recorded outcome', () => {
    /* `held` and `no_show` are records of what happened and keep saying it. */
    expect(sql).toContain('IF v_old.meeting_status IS NULL THEN');
  });

  it('writes the new attempt unanswered', () => {
    /* A row meaning "this was missed" must never be written for an
       appointment still in the future. */
    expect(sql).toMatch(/meeting_status[\s\S]{0,400}NULL/);
  });

  it('is scoped by owner — CLAUDE.md rule 4', () => {
    expect(sql).toContain('AND user_id = p_user_id');
  });

  it('treats re-saving the same hour as no move at all', () => {
    /* Otherwise every save of an unchanged time would add an attempt, and the
       journey would fill with moves nobody made. */
    expect(sql).toContain('IF v_old.start_time = p_start');
  });
});

describe('two meetings cannot share one hour', () => {
  /*
   * `scheduling_meetings` had no exclusion constraint. It did not bite while
   * every meeting mirrored a booking that carried one — and it bites the
   * moment a package becomes ONE booking with no time of its own, which
   * `scheduling_bookings_no_overlap` skips by its own `start_time IS NOT NULL`
   * clause. `busyMeetings` is a check, not a guarantee: two clients clicking
   * at once both read the slot free.
   */
  const migration = read('supabase/migrations/20261085_a_moved_attempt_frees_its_hour.sql');
  const sql = migration.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');

  it('adds the constraint to the table that actually holds slots', () => {
    expect(sql).toContain('ALTER TABLE public.scheduling_meetings');
    expect(sql).toContain('ADD CONSTRAINT scheduling_meetings_no_overlap');
    expect(sql).toContain('EXCLUDE USING gist');
  });

  it('names what holds, never a NOT IN', () => {
    /* `NULL NOT IN (…)` is NULL in SQL, not true, so the negated form drops
       every unmarked meeting and the whole diary becomes bookable. */
    const constraint = sql.slice(sql.indexOf('scheduling_meetings_no_overlap'));
    expect(constraint).toContain("meeting_status IS NULL OR meeting_status = 'held'");
    expect(constraint).not.toMatch(/NOT IN/i);
  });

  it('frees the abandoned hours first, or the constraint is refused', () => {
    /* 8 existing overlaps would have rejected it. The backfill and the
       constraint therefore have to be one transaction. */
    const backfillAt = sql.indexOf("SET meeting_status = 'moved'");
    const constraintAt = sql.indexOf('ADD CONSTRAINT scheduling_meetings_no_overlap');
    expect(backfillAt).toBeGreaterThan(-1);
    expect(constraintAt).toBeGreaterThan(backfillAt);
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
  });

  it('backfills only superseded attempts nobody had marked', () => {
    const backfill = sql.slice(sql.indexOf("SET meeting_status = 'moved'"));
    const statement = backfill.slice(0, backfill.indexOf(';'));
    expect(statement).toContain('meeting_status IS NULL');
    expect(statement).toContain('later.occurrence_number > m.occurrence_number');
  });

  it('never treats a package SESSION as a superseded attempt', () => {
    /*
     * ───────────────────────────────────────────────────────────────────────
     * `occurrence_number` means two things, and only the booking says which.
     *
     * On a booking with a clock it counts ATTEMPTS at one appointment, so a
     * higher number supersedes a lower one. On a container — a package, which
     * has no clock of its own — it counts SESSIONS, and session 1 is not
     * superseded by session 2: both are still to happen.
     *
     * The rule is idempotent, so a re-run on a fresh environment is a real
     * possibility. Without this clause that re-run would stamp sessions
     * 1..N-1 `moved` and put five of a client's six booked hours back on
     * sale while they still hold them.
     * ───────────────────────────────────────────────────────────────────────
     */
    const backfill = sql.slice(sql.indexOf("SET meeting_status = 'moved'"));
    const statement = backfill.slice(0, backfill.indexOf(';'));
    expect(statement).toContain('scheduling_bookings');
    expect(statement).toContain('start_time IS NOT NULL');
  });

  it('lets the column hold the new value', () => {
    /* Without this the backfill fails the check constraint and the whole
       migration rolls back. */
    expect(sql).toMatch(/CHECK \(meeting_status IS NULL OR meeting_status IN \([^)]*'moved'[^)]*\)\)/);
  });

  it('drops the check by the name the table actually carries', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * This is the one that bit. The first attempt dropped
     * `scheduling_meetings_meeting_status_check` — the column's name with the
     * suffix — while 20261073 had named the constraint
     * `scheduling_meetings_status_check`.
     *
     * `DROP CONSTRAINT IF EXISTS <a name nothing has>` SUCCEEDS. So the
     * migration reported no problem, added a second check, left the original
     * three-value one in place, and the backfill was refused with 23514 on a
     * row it had every right to write.
     *
     * Taken from 20261073 rather than written out, so the two cannot drift.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const origin = read('supabase/migrations/20261073_scheduling_meetings.sql');
    const declared = /ADD CONSTRAINT (\S+)\s+CHECK \(meeting_status IS NULL/.exec(origin);

    expect(declared).not.toBeNull();
    expect(sql).toContain(`DROP CONSTRAINT IF EXISTS ${declared![1]};`);
    /* And re-adds it under that same name, so the table keeps one check. */
    expect(sql).toContain(`ADD CONSTRAINT ${declared![1]}`);
  });
});

describe('moving a session takes its money with it', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A stage names a MEETING. A move writes a NEW meeting and leaves the old
   * attempt holding the hour it was for — so a stage left behind points at an
   * appointment that no longer happens, and marking the rebooked session held
   * bills nothing at all.
   *
   * Silent in both directions: the owner sees a session go by with no invoice,
   * and a stage still reading "pending" against a superseded hour.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const repo = code('lib/repositories/SchedulingRepository.ts');
  const move = repo.slice(repo.indexOf('async moveMeeting('));
  const body = move.slice(0, move.indexOf('async setMeetingOutcome('));

  it('re-points the stage at the new attempt', () => {
    expect(body).toContain("from('payment_plan_installments')");
    expect(body).toContain('meeting_id: String(data)');
    expect(body).toContain(".eq('meeting_id', meetingId)");
  });

  it('only one that has not been billed', () => {
    /* A billed stage names a date on an invoice the client is holding. */
    expect(body).toContain(".eq('status', 'pending')");
    expect(body).toContain(".is('invoice_id', null)");
  });

  it('scoped to the owner — CLAUDE.md rule 4', () => {
    const update = body.slice(body.indexOf("from('payment_plan_installments')"));
    expect(update.slice(0, update.indexOf(';'))).toContain(".eq('user_id', userId)");
  });

  it('and never fails the move over it', () => {
    /* The appointment HAS moved, and both the owner and the client are acting
       on that. A stage on the old attempt is visible and recoverable. */
    expect(body).toContain('stageError');
    expect(body).not.toMatch(/if \(stageError\)[\s\S]{0,120}return \{ data: null/);
  });
});
