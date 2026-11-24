/**
 * The services band counts orders, and a package's purchase row is not one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER SAW
 *
 * "What people buy" reported 2 bookings against `CleanUp office quotation` for
 * a client who had made one appointment and bought one package. Opening that
 * same client in the contact drawer showed exactly one card.
 *
 * Both surfaces were reading the same two rows:
 *
 *   · the quote request — a real appointment, 24 Nov 09:00, held
 *   · a row with NO TIME, written the moment the quote was accepted, holding
 *     the six agreed sessions as `scheduling_meetings`
 *
 * `ProposalAcceptanceService.createPackageMeetings` says what the second one is
 * at the point it writes it: "this row is the purchase, not a meeting". The
 * drawer knows, and reparents its meetings onto the quote's journey — flat, it
 * drew a second card reading "Waiting for a quote" on the thing a quote had
 * just created. The report did not know, and counted rows.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SOURCE GUARD AND WHAT IT IS REALLY PROTECTING
 *
 * The first fix written for this skipped every booking with no `start_time`, on
 * the reasoning that a row with no hour cannot be an appointment. That reasoning
 * is wrong about this product and the live data said so immediately: a service
 * with `is_scheduled: false` is sold without an hour, and six of the eight rows
 * in this column were exactly that. The broad rule took the account's total
 * from 8 to 2.
 *
 * So the narrow test is the one that must survive: `booking_source` of
 * `'proposal'` AND no time. This case exists to stop the broad one coming back,
 * because it reads as the more principled of the two and is the more damaging.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');

const STATS = 'app/api/business-os/stats/route.ts';
const ACCEPTANCE = 'lib/services/ProposalAcceptanceService.ts';

/** Source with comments removed, so the notes ABOUT the rule do not satisfy it. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The loop that builds the per-service order count, and nothing else. */
const countingLoop = (source: string) => {
  const at = source.indexOf('const bookedByService = new Map<string, number>()');
  return source.slice(at, source.indexOf('const serviceRevenueArray', at));
};

describe('what the services band counts', () => {
  const stats = code(read(STATS));
  const loop = countingLoop(stats);

  it('skips a package purchase row', () => {
    expect(loop).toContain("booking.booking_source === 'proposal' && !booking.start_time");
  });

  it('and reads the two columns it needs to tell one', () => {
    /* Neither is displayed; both are how the row is recognised. A select that
       drops either makes the test silently false — `undefined` is falsy, so a
       missing `start_time` would skip every proposal booking instead. */
    const query = stats.slice(
      stats.indexOf('const { data: bookedRows'),
      stats.indexOf('const bookedByService')
    );

    expect(query).toContain('start_time');
    expect(query).toContain('booking_source');
  });

  it('STILL counts a service sold without an appointment', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE CASE THE FIRST ATTEMPT BROKE.
     *
     * `is_scheduled: false` services — a product, a job the owner schedules
     * themselves — carry no `start_time` and are perfectly real orders. A rule
     * written on the absence of a time alone deletes them: measured on the
     * reporting account, 8 orders became 2.
     *
     * So the condition must be BOTH halves. A bare `!booking.start_time` skip
     * is the regression, and it is the one that looks tidier.
     * ─────────────────────────────────────────────────────────────────────────
     */
    expect(loop).not.toMatch(/if \(!booking\.start_time\) continue;/);
  });

  it('still ignores a cancelled booking, which it always did', () => {
    expect(loop).toContain("booking.status === 'cancelled'");
  });
});

describe('the row this skips is the one acceptance writes', () => {
  it('is written with a proposal source and no time', () => {
    /*
     * The two files have to agree about what a container looks like. If
     * acceptance ever gives that row an hour, or files it under another source,
     * this skip stops matching and the double count returns silently.
     */
    const acceptance = read(ACCEPTANCE);
    const write = acceptance.slice(
      acceptance.indexOf('const container = await schedulingBookingRepository.create('),
      acceptance.indexOf('if (container.error')
    );

    expect(write).toContain('start_time: null');
    expect(write).toContain("booking_source: 'proposal'");
  });

  it('and nothing else in the product writes that source', () => {
    /* One writer is what makes the narrow test safe. A second would need this
       guard revisited rather than the skip widened. */
    const everywhere = read(ACCEPTANCE);

    expect(everywhere.match(/booking_source: 'proposal'/g) ?? []).toHaveLength(1);
  });
});
