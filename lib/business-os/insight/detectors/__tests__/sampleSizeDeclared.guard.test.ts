/**
 * A detector that claims a RATE must declare the denominator it claimed it on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HAZARD H15, PINNED SO IT CAN ONLY SHRINK.
 *
 * `minSamples` is declared by nearly every detector and reads like a guard:
 * `ops_utilization_low` declares 28, meaning "four weeks of bookings before I
 * say anything". For a long time NOTHING read it, and that detector fired on a
 * single booking for months.
 *
 * `BaseDetector.createDetectionResult` now enforces it — but only when the
 * detector volunteers a `sampleSize`, which is opt-in. Four of 46 do. On the
 * rest the field still looks like a guard and guards nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT ONE BIG SWEEP
 *
 * The fix is not "add `sampleSize` to 42 files". It is 42 CLASSIFICATION
 * decisions, because `effectiveClaimType` defaults an undeclared detector to
 * `rate` — the strict side — and many of these are not rates at all:
 *
 *   instance  "these 3 invoices are overdue"   no denominator exists. One
 *                                              overdue invoice is one overdue
 *                                              invoice at any sample size.
 *   rate      "18% of bookings are cancelled"  meaningless without the 18% OF
 *                                              WHAT, and that is `sampleSize`.
 *
 * So each file needs a reading of what its `currentValue` actually means. And
 * the dangerous direction is clear: declaring `instance` makes a detector
 * LOUDER, because an instance claim is allowed to run on a `learn` vector
 * while every inference waits for `lit`. A wrong `instance` is a card on an
 * account with almost no data — exactly the day-52 class of bug (H12).
 *
 * Hence this list rather than a rewrite. It names every detector that does not
 * yet satisfy the rule, which does three things:
 *
 *   1. a NEW detector cannot join the debt — it fails here until it either
 *      passes `sampleSize` or declares `claimType: 'instance'`;
 *   2. the sweep can proceed one file at a time, each removal a deliberate
 *      decision with a test run behind it;
 *   3. the number is visible. "42" is a fact somebody can act on; "minSamples
 *      is mostly not enforced" is a feeling.
 *
 * ⚠️ THIS LIST MAY ONLY SHRINK. If a change makes it longer, the change is
 * wrong — do not add a name to get green.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const CATALOG = join(__dirname, '..', 'catalog');

/**
 * Detectors that neither pass `sampleSize` nor declare an `instance` claim.
 *
 * Measured 2026-10-07 at 42, and reduced to 36 the same day: six detectors
 * whose `currentValue` is a count of enumerated entities (or a sum across
 * them) were classified `instance`, which is what they always were.
 *
 * Every remaining entry is an unmade decision about what its `currentValue`
 * means, not a bug in itself.
 */
const NOT_YET_CLASSIFIED = new Set([
  'AcqLowConversionDetector',
  'CashArAgingDetector',
  'CashCancelledUnrefundedDetector',
  'CashClientConcentrationDetector',
  'CashIncomeDropDetector',
  'CashPayoutBlockedDetector',
  'CashRefundPatternDetector',
  'CashRevenueAtRiskDetector',
  'CashWorkUnbilledDetector',
  'ConvDeclineReasonDetector',
  'ConvNoNextStepDetector',
  'ConvPipelineStuckDetector',
  'ConvQuoteAcceptanceDropDetector',
  'ConvServiceRateDropDetector',
  'ConvSourceUnderperformDetector',
  'ConvStageDropoffDetector',
  'CrmEngagementDecayDetector',
  'OpsLastMinuteCancelsDetector',
  'OpsPeakUnutilizedDetector',
  'OpsServicePerformanceDetector',
  'PaymentIssuesDetector',
  'PricingDiscountAbuseDetector',
  'PricingIntroOfferStuckDetector',
  'RetCancelPatternDetector',
  'RetCancellationSpikeDetector',
  'RetNoShowSpikeDetector',
  'RetPackageEndingDetector',
  'RetRepeatBookingLowDetector',
  'RetRescheduleChurnDetector',
  'SalesReplySlowDetector',
  'SalesStalledDetector',
  'WebIncompleteContentDetector',
  'WebLinkNotConvertingDetector',
  'WebMissingCtaDetector',
  'WebMobileConversionGapDetector',
  'WebPageNoConversionsDetector',
]);

function detectorFiles(): string[] {
  return readdirSync(CATALOG)
    .filter(f => f.endsWith('Detector.ts') && f !== 'BaseDetector.ts')
    .sort();
}

/** Does this detector satisfy the rule? */
function satisfiesRule(source: string): boolean {
  // An instance claim has no denominator to declare.
  if (/claimType:\s*'instance'/.test(source)) return true;
  // Otherwise it must hand `createDetectionResult` a sample size.
  return /\bsampleSize:/.test(source);
}

describe('H15: a rate claim declares its denominator', () => {
  const files = detectorFiles();

  it('found the catalogue', () => {
    // Guards against a rename quietly emptying this whole suite.
    expect(files.length).toBeGreaterThanOrEqual(45);
  });

  it.each(files)('%s', file => {
    const source = readFileSync(join(CATALOG, file), 'utf8');
    const name = file.replace(/\.ts$/, '');

    if (NOT_YET_CLASSIFIED.has(name)) {
      /*
       * Still on the list. Asserted the other way round on purpose: once a
       * detector is fixed, this fails and forces its name out of the list, so
       * the list cannot rot into a permanent exemption.
       */
      expect(satisfiesRule(source)).toBe(false);
      return;
    }

    expect(satisfiesRule(source)).toBe(true);
  });

  it('the list only shrinks', () => {
    const unclassified = files.filter(
      f => !satisfiesRule(readFileSync(join(CATALOG, f), 'utf8'))
    );

    expect(unclassified).toHaveLength(NOT_YET_CLASSIFIED.size);
    // 42 when pinned, 36 after the first batch. Lower it; never raise it.
    expect(NOT_YET_CLASSIFIED.size).toBeLessThanOrEqual(36);
  });

  it('every name on the list is a real detector', () => {
    // A renamed or deleted detector must not leave a ghost exemption behind.
    const names = new Set(files.map(f => f.replace(/\.ts$/, '')));
    const ghosts = [...NOT_YET_CLASSIFIED].filter(n => !names.has(n));

    expect(ghosts).toEqual([]);
  });
});
