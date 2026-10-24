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
  'lib/business-os/insight/detectors/catalog/OpsPeakUnutilizedDetector.ts',
  'lib/business-os/insight/detectors/catalog/OpsUtilizationLowDetector.ts',
  'lib/business-os/insight/detectors/catalog/RetCancellationSpikeDetector.ts',
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
    'lib/business-os/insight/detectors/catalog/OpsPeakUnutilizedDetector.ts',
    'lib/business-os/insight/detectors/catalog/OpsServicePerformanceDetector.ts',
    'lib/business-os/insight/detectors/catalog/PricingDiscountAbuseDetector.ts',
    'lib/business-os/insight/detectors/catalog/PricingIntroOfferStuckDetector.ts',
    'app/api/business-os/metrics/summary/route.ts',
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
