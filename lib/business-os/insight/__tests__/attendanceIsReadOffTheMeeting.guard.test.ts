/**
 * "Did the meeting happen" is `meeting_status`, nowhere else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `complete()` writes `meeting_status: 'held'` and does NOT write
 * `status: 'completed'`. That is the whole point of the booking/meeting
 * separation: a consultation that took place must not be erased by the job
 * being cancelled afterwards.
 *
 * The cost is that `status = 'completed'` stopped answering "did it happen".
 * Nine queries were still asking it — the unbilled-work chaser, the retention
 * and repeat-booking measures, two revenue averages, a readiness gap, and the
 * "clients served" figure printed on the owner's public website. Each silently
 * undercounted by one more row with every meeting marked held.
 *
 * Nothing threw. Nothing logged. The numbers just drifted down, which is the
 * worst failure mode available: a business watching its own insights decline
 * for a reason that is not in its business.
 *
 * This test exists because that class of bug is invisible in review — the old
 * line reads perfectly sensibly.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const SITES = [
  'lib/business-os/gaps/definitions.ts',
  'lib/business-os/insight/detectors/catalog/CashWorkUnbilledDetector.ts',
  /*
   * `OpsPeakUnutilizedDetector` no longer spells the question as a query.
   *
   * Its `meeting_status = 'held'` read averaged what an appointment is worth,
   * over bookings ranged on `start_time` — so a package's sessions were absent
   * from the average twice over: the job has no `start_time`, and `held` is
   * written on the session, not the job. It reads `appointmentDetailsBetween`
   * now and filters the outcome in code, which asks the meetings table more
   * directly than the query it replaced.
   *
   * Left out rather than relaxed, for the reason given below about
   * `RetCancellationSpikeDetector`: this list is files that ask attendance IN A
   * QUERY, and keeping one that does not would let the guard pass for the wrong
   * reason. `APPOINTMENT_READERS` pins it instead.
   */
  'lib/business-os/insight/detectors/catalog/OpsUtilizationLowDetector.ts',
  /*
   * `RetCancellationSpikeDetector` was here and no longer asks about attendance
   * at all.
   *
   * Its one `meeting_status = 'held'` query existed to average
   * `payment_amount` over bookings that took place, and value the week's
   * cancellations at that average. `payment_amount` is NULL on every booking in
   * the product — 0 of 319, measured 2026-10-29 — so the average was always
   * null and the alert never once reported money. It now prices the
   * cancellations themselves, through the rules the orders page writes money
   * off with, and reads no attendance.
   *
   * Left out rather than relaxed: this list is files that DO ask the question,
   * and keeping one that does not would make the guard pass for the wrong
   * reason the next time somebody removes a real query.
   */
  'lib/business-os/insight/detectors/catalog/RetRepeatBookingLowDetector.ts',
  'lib/business-os/insight/health/resolveBusinessHealth.ts',
  'lib/services/WebsiteBlockEnrichmentService.ts',
];

const read = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n');

/**
 * Comments are stripped before matching.
 *
 * Every one of these files now carries a comment that QUOTES the old filter to
 * explain what was wrong with it, so matching the raw source would fail on the
 * explanation rather than on the code. A guard whose slice boundary was itself
 * a comment has already produced one false pass in this codebase.
 */
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('no booking query treats status = completed as attendance', () => {
  for (const site of SITES) {
    it(site, () => {
      const src = code(read(site));

      /* `.eq('status', 'completed')` in any spacing, single or double quoted. */
      expect(src).not.toMatch(/\.eq\(\s*['"]status['"]\s*,\s*['"]completed['"]/);

      /*
       * A LONE `completed` in an `.in()` is the same mistake spelled
       * differently. The PAIR `['confirmed', 'completed']` is deliberate and
       * stays: there it means "not cancelled", not "it happened" — and those
       * sites got `MEETING_HOLDS_SLOT_FILTER` instead, because the pair used to
       * exclude a no-show and no longer does.
       */
      expect(src).not.toMatch(/\.in\(\s*['"]status['"]\s*,\s*\[\s*['"]completed['"]\s*\]/);
    });
  }
});

describe('the pair that means "not cancelled" also excludes a missed meeting', () => {
  /*
   * `.in('status', ['confirmed', 'completed'])` was a complete answer while
   * `markNoShow()` wrote `status: 'no_show'`. It writes `meeting_status` now,
   * so the pair silently started including no-shows — the mirror image of the
   * undercount above, and just as invisible.
   */
  const PAIR_SITES = [
    /*
     * `OpsPeakUnutilizedDetector` LEFT THIS LIST, alongside the summary route
     * and for the same reason: both of its windows now read
     * `appointmentDetailsBetween`, so there is no `status` pair left to require
     * a filter after. The pairing rule guards against reading attendance off
     * `status`; a file that asks the meetings directly cannot make that
     * mistake. Its own assertion is below.
     */
    'lib/business-os/insight/detectors/catalog/OpsServicePerformanceDetector.ts',
    'lib/business-os/insight/detectors/catalog/PricingDiscountAbuseDetector.ts',
    'lib/business-os/insight/detectors/catalog/PricingIntroOfferStuckDetector.ts',
    /*
     * `app/api/business-os/metrics/summary/route.ts` LEFT THIS LIST.
     *
     * Not because the rule stopped applying, but because it now passes it a
     * stronger way: the two session counts no longer read `scheduling_bookings`
     * at all. They ask `appointmentOutcomes`, which reads the meetings table —
     * so there is no `status` pair left to require a filter after.
     *
     * The pairing rule is about reading attendance off `status`. A file that
     * asks the meetings directly cannot make that mistake. Its own assertion
     * is below, and it is tighter than the one it replaced: it pins the
     * function, not the filter.
     */
  ];

  for (const site of PAIR_SITES) {
    it(site, () => {
      const src = code(read(site));
      const pairs = src.match(/\.in\(\s*['"]status['"]\s*,\s*\[\s*['"]confirmed['"][^\]]*\]\s*\)/g) ?? [];
      expect(pairs.length).toBeGreaterThan(0);

      /* Every one of them followed by the meeting filter. Counting rather than
         merely checking presence: a file with two such queries and one filter
         is the bug half-fixed, which is how it would come back. */
      const filters = src.match(/\.or\(\s*MEETING_HOLDS_SLOT_FILTER\s*\)/g) ?? [];
      expect(filters.length).toBeGreaterThanOrEqual(pairs.length);
    });
  }

  /*
   * The summary route counts APPOINTMENTS, which is a different fix for the
   * same bug.
   *
   * Counting bookings by `start_time` missed every package session, because a
   * job whose hours live on its sessions carries no `start_time` of its own and
   * NULL never satisfies `gte`. Measured on one account: 7 reported where 15
   * were real, in a single week.
   *
   * `appointmentOutcomes` is the shared answer — meetings, plus the bookings
   * that have an hour and no meeting row — and `open + held` keeps exactly what
   * the status pair kept: not a no-show, not a cancellation.
   */
  /*
   * The four surfaces that now answer "when" from the appointments table.
   *
   * Each used to range `scheduling_bookings` on `start_time`, which a job whose
   * hours live on its sessions does not have — so every package session was
   * invisible to all of them. Pinned by the function they call rather than by
   * the filter they chain, because the fix is the source they read.
   */
  const APPOINTMENT_READERS = [
    'lib/business-os/insight/detectors/catalog/OpsPeakUnutilizedDetector.ts',
    'lib/business-os/insight/detectors/catalog/OpsUtilizationLowDetector.ts',
    'lib/business-os/insight/detectors/catalog/RetNoShowSpikeDetector.ts',
    'lib/business-os/insight/detectors/catalog/RetCancelPatternDetector.ts',
  ];

  for (const site of APPOINTMENT_READERS) {
    it(`${site} reads appointments, not jobs`, () => {
      const src = code(read(site));

      expect(src).toMatch(/appointmentDetailsBetween\(/);

      /* And no longer walks a window on the bookings table to answer it. The
         cancellation detector still reads bookings by `updated_at` for the
         REASONS a job was called off, which is a job-level question and stays
         where it is — this only forbids ranging on `start_time`. */
      const windowedOnBookings =
        src.match(
          /from\(\s*['"]scheduling_bookings['"]\s*\)[\s\S]{0,260}?(gte|lte|lt)\(\s*['"]start_time['"]/g
        ) ?? [];
      expect(windowedOnBookings).toHaveLength(0);
    });
  }

  it('app/api/business-os/metrics/summary/route.ts counts appointments, not jobs', () => {
    const src = code(read('app/api/business-os/metrics/summary/route.ts'));

    expect(src).toMatch(/appointmentOutcomes\(/);
    expect(src).toMatch(/o\.open \+ o\.held/);

    /* And it no longer reaches for the bookings table to answer "how many
       sessions", which is the mistake the count above replaced. */
    const sessionCounts = src.match(
      /from\(\s*['"]scheduling_bookings['"]\s*\)[\s\S]{0,240}?gte\(\s*['"]start_time['"]/g
    ) ?? [];
    expect(sessionCounts).toHaveLength(0);
  });
});

describe('the nine sites ask the meeting instead', () => {
  for (const site of SITES) {
    it(site, () => {
      expect(code(read(site))).toMatch(
        /\.eq\(\s*['"]meeting_status['"]\s*,\s*['"]held['"]\s*\)/
      );
    });
  }
});

describe('every file that filters on the column imports its filter', () => {
  /* A hand-retyped `'meeting_status.is.null,meeting_status.eq.held'` is a
     string PostgREST will accept and silently mis-apply if a word is wrong. */
  it('MEETING_HOLDS_SLOT_FILTER is never spelled out by hand', () => {
    for (const site of SITES) {
      expect(code(read(site))).not.toContain('meeting_status.is.null');
    }
  });
});
