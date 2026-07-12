/**
 * Regression — Phase 1.6 integration bug (QA High-severity).
 *
 * The route's zero-issue branch has a LEGACY "SEMANTIC VALIDATION" gate that
 * returns needs_review whenever `items_delivered === 0`. It sits BEFORE the new
 * Phase 1.6 coverage floor, so a clean, populated send/notify-terminating agent
 * (meaningful pre-delivery data, scalar/suppressed send → delivered=0) was capped
 * to needs_review with a misleading "produced no output" message — defeating
 * CASE 2. The unit triad missed it because that block `return`s before the
 * signal→verdict path.
 *
 * The fix guards that legacy gate with the SAME hoisted signal the verdict uses:
 *   coverageSaysNoOutput = !exercisedRealPath || deliveredAllBlank
 *                        = coverageConfirmsNoMeaningfulOutput(deriveCoverageSignal(...))
 * so the gate only fires when the NEW signal agrees the real path produced no
 * meaningful output. This test reproduces the route's gate decision from the real
 * `deriveCoverageSignal` output for each scenario — it would have failed on the
 * pre-fix `if (itemsDelivered === 0)` (which is effectively `coverageSaysNoOutput`
 * hardwired to true for a scalar send).
 */

import {
  deriveCoverageSignal,
  coverageConfirmsNoMeaningfulOutput,
} from '../dataQuality';

/**
 * Reproduce the route's guarded gate decision (L~4313-4392): the legacy gate
 * fires only when the workflow processed items, delivered count is 0, AND the
 * coverage signal confirms no meaningful output.
 */
function legacyGateFires(args: {
  stepOutputs: Record<string, unknown>;
  itemsProcessed: number;
  itemsDelivered: number;
}): boolean {
  const coverage = deriveCoverageSignal({
    stepOutputs: args.stepOutputs,
    itemsProcessed: args.itemsProcessed,
    itemsDelivered: args.itemsDelivered,
  });
  const processed = args.itemsProcessed;
  const delivered = args.itemsDelivered;
  return processed > 0 && delivered === 0 && coverageConfirmsNoMeaningfulOutput(coverage);
}

describe('Phase 1.6 regression — legacy semantic-validation gate is guarded by the coverage signal', () => {
  it('CLEAN send-terminating agent (delivered=0, meaningful rows + executed send) is NOT intercepted → can reach passed', () => {
    const stepOutputs = {
      expense_rows: [
        { amount: 'ILS 99.90', vendor: 'Wolt', date: '2026-02-25' },
        { amount: 'USD 232.96', vendor: 'Expedia', date: '2026-03-01' },
      ],
      send_report: { message_id: '19f52a6c391f3aaa', sent_at: '2026-07-11T19:28:08Z' },
    };
    // Pre-fix, the raw `items_delivered === 0` condition was true → gate fired → capped.
    expect(legacyGateFires({ stepOutputs, itemsProcessed: 14, itemsDelivered: 0 })).toBe(false);
  });

  it('GENUINELY-EMPTY run (processed>0, no meaningful pre-delivery data, no executed send) still → gate fires (needs_review)', () => {
    const stepOutputs = {
      // A processing step ran, but the pre-delivery collection is empty/absent.
      fetch_step: { count: 0 },
    };
    expect(legacyGateFires({ stepOutputs, itemsProcessed: 14, itemsDelivered: 0 })).toBe(true);
  });

  it('ALL-BLANK report (false-green guard) still → gate fires; never bypassed to passed', () => {
    const stepOutputs = {
      expense_rows: Array.from({ length: 13 }, () => ({ amount: '', vendor: 'Unknown', date: '' })),
      send_report: { message_id: 'm1', sent_at: 't' }, // send executed, but data is blank
    };
    // deliveredAllBlank must keep this gated even though a send executed.
    expect(legacyGateFires({ stepOutputs, itemsProcessed: 14, itemsDelivered: 0 })).toBe(true);
  });

  it('PARTIALLY-blank report is not force-gated here (falls through; the partial_report_data issue drives needs_review)', () => {
    const stepOutputs = {
      expense_rows: Array.from({ length: 13 }, () => ({ amount: '10', vendor: 'Wolt', source_email_from: '' })),
      send_report: { message_id: 'm1', sent_at: 't' },
    };
    // Meaningful data present → gate does not fire; the route surfaces a
    // partial_report_data issue so allIssuesForUI is non-empty (issues branch).
    expect(legacyGateFires({ stepOutputs, itemsProcessed: 14, itemsDelivered: 0 })).toBe(false);
  });
});

describe('coverageConfirmsNoMeaningfulOutput', () => {
  it('false when exercised and not all-blank (do not gate)', () => {
    expect(coverageConfirmsNoMeaningfulOutput({ exercisedRealPath: true, deliveredAllBlank: false, partialBlankColumns: [] })).toBe(false);
  });
  it('true when not exercised', () => {
    expect(coverageConfirmsNoMeaningfulOutput({ exercisedRealPath: false, deliveredAllBlank: false, partialBlankColumns: [] })).toBe(true);
  });
  it('true when all-blank even if flagged exercised (false-green guard)', () => {
    expect(coverageConfirmsNoMeaningfulOutput({ exercisedRealPath: true, deliveredAllBlank: true, partialBlankColumns: [] })).toBe(true);
  });
});
