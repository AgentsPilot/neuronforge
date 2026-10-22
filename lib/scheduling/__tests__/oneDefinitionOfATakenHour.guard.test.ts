import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * The database and the application agree about which hours are taken.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CAUGHT
 *
 * `scheduling_bookings_no_overlap` decided from `status` alone, which was the
 * whole truth only while every meeting outcome overwrote it. Once held,
 * no-show and cancelled started writing `meeting_status` and leaving `status`
 * alone, the two layers drifted apart on exactly one case:
 *
 *   · `busyMeetings()` says a cancelled meeting's hour is free, and offers it
 *   · the constraint says the booking still holds it, and refuses with 23P01
 *
 * So a client picked a time from the public calendar and was told it had gone.
 * The application half had been updated carefully, with comments explaining
 * why; the constraint was simply not part of that change.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT READS SQL AS TEXT
 *
 * There is no running database here, and the failure is not a behaviour one
 * side gets wrong — both are internally consistent. It is the two of them
 * describing different rules, which is only visible by reading them together.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('one definition of a taken hour', () => {
  const root = join(__dirname, '..', '..', '..');

  /** The constraint as it stands after the LAST migration that defines it. */
  const constraintSql = (() => {
    const dir = join(root, 'supabase', 'migrations');
    const defining = readdirSync(dir)
      .filter(f => f.endsWith('.sql'))
      .filter(f => readFileSync(join(dir, f), 'utf-8').includes('ADD CONSTRAINT scheduling_bookings_no_overlap'))
      .sort();

    expect(defining.length).toBeGreaterThan(0);
    /* Migrations are applied in filename order, so the last one that adds it
       is the one in force. A guard reading the first would go on passing
       against a definition nothing uses. */
    return readFileSync(join(dir, defining[defining.length - 1]), 'utf-8');
  })();

  const statusRules = readFileSync(
    join(root, 'lib', 'business-os', 'bookingStatus.ts'),
    'utf-8'
  );

  it('the constraint reads the meeting, not only the job', () => {
    const predicate = constraintSql.slice(constraintSql.indexOf('ADD CONSTRAINT'));
    expect(predicate).toContain("meeting_status IS NULL OR meeting_status = 'held'");
  });

  it('and spells it the way SQL actually works', () => {
    /*
     * `NULL NOT IN (…)` is NULL, not true. The negated form would drop every
     * unmarked meeting — nearly all of them — and free hours that are taken.
     * `MEETING_HOLDS_SLOT_FILTER` carries the same note for the same reason.
     */
    const predicate = constraintSql.slice(constraintSql.indexOf('ADD CONSTRAINT'));
    expect(predicate).not.toMatch(/meeting_status\s+NOT\s+IN/i);
    expect(statusRules).toContain(
      "export const MEETING_HOLDS_SLOT_FILTER = 'meeting_status.is.null,meeting_status.eq.held';"
    );
  });

  it('and both still agree on which job statuses hold an hour', () => {
    const inCode = statusRules
      .slice(statusRules.indexOf('SLOT_HOLDING_STATUSES = ['))
      .slice(0, 200)
      .match(/'([a-z_]+)'/g)
      ?.map(s => s.replace(/'/g, ''))
      .sort();

    const predicate = constraintSql.slice(constraintSql.indexOf('ADD CONSTRAINT'));
    const inSql = predicate
      .slice(predicate.indexOf('status IN ('))
      .slice(0, 120)
      .match(/'([a-z_]+)'/g)
      ?.map(s => s.replace(/'/g, ''))
      .sort();

    expect(inCode).toEqual(['completed', 'confirmed', 'pending']);
    expect(inSql).toEqual(inCode);
  });
});

/**
 * And no surface answers the question its own way.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Three availability readers had hand-written queries that each disagreed with
 * the booking page: the smart-link route (`.neq('status','cancelled')`, reading
 * bookings not meetings, windowed by containment), and the chat's slot finder
 * (omitting `pending`, ignoring `meeting_status`, capped at 500). A client
 * reached the same business through three doors and was offered three different
 * sets of hours.
 */
describe('every availability surface asks the same question', () => {
  const root = join(__dirname, '..', '..', '..');
  const read = (p: string) => readFileSync(join(root, p), 'utf-8');

  const SURFACES = [
    'app/api/website/booking/availability/route.ts',
    'app/api/website/scheduling/availability/route.ts',
    'app/api/conversion/[userCode]/availability/route.ts',
    'lib/business-os/ChatCommandExecutor.ts',
  ];

  it('delegates to the shared helper', () => {
    for (const path of SURFACES) {
      expect({ path, uses: read(path).includes('busyMeetings(') }).toEqual({ path, uses: true });
    }
  });

  it('and none keeps a private definition of busy', () => {
    /*
     * The tell that shipped: filtering bookings by status by hand instead of
     * asking `busyMeetings`.
     *
     * Comments stripped first. One of these files EXPLAINS the old query in
     * prose, quoting it — so a plain substring search finds the explanation
     * and reports the bug it describes as still present. The same trap the
     * drawer guards hit, where a comment quoting the code defeated the
     * assertion about it.
     */
    const code = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    for (const path of SURFACES) {
      expect({ path, own: code(read(path)).includes(".neq('status', 'cancelled')") }).toEqual({
        path,
        own: false,
      });
    }
  });
});
