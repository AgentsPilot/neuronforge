import { AllFailedStepDetector } from '../AllFailedStepDetector';

describe('AllFailedStepDetector — Item 10 (all-failed / all-empty step)', () => {
  const detector = new AllFailedStepDetector();

  it('raises a blocking all_empty issue when 100% of a scatter\'s items are blank/fallback (RCA extract case)', () => {
    const stepOutputs = {
      expense_rows: Array.from({ length: 13 }, () => ({ amount: '', vendor: 'Unknown', date: '' })),
    };
    const issues = detector.detect(stepOutputs);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('all_empty');
    expect(issues[0].stepId).toBe('expense_rows');
    expect(issues[0].itemCount).toBe(13);
    expect(issues[0].blocking).toBe(true);
  });

  it('raises a blocking all_failed issue when every item declares success:false', () => {
    const stepOutputs = {
      extracted: [
        { success: false, data: {} },
        { success: false, data: {} },
      ],
    };
    const issues = detector.detect(stepOutputs);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('all_failed');
  });

  it('does NOT flag a step where at least one item carries meaningful data (happy path)', () => {
    const stepOutputs = {
      expense_rows: [
        { amount: '42.00', vendor: 'Acme', date: '2026-03-01' },
        { amount: '', vendor: 'Unknown', date: '' },
      ],
    };
    expect(detector.detect(stepOutputs)).toHaveLength(0);
  });

  it('skips scalar / single-object / empty outputs (nothing to judge across items)', () => {
    expect(detector.detect({ a: 'scalar', b: { one: 1 }, c: [] })).toHaveLength(0);
    expect(detector.detect(null)).toHaveLength(0);
  });

  // QA-added (Phase 1.5): explicit mixed success/failure negative path — a scatter
  // where SOME items succeed with real data must NOT be flagged all_failed OR
  // all_empty (the North-Star run must pass once even one row is real).
  it('QA: does NOT flag a scatter with mixed success/failure when a success item carries real data', () => {
    const stepOutputs = {
      extracted: [
        { success: false, data: {} },
        { success: true, amount: '42.00', vendor: 'Acme', date: '2026-03-01' },
      ],
    };
    expect(detector.detect(stepOutputs)).toHaveLength(0);
  });

  // QA-added (Phase 1.5) — DOCUMENTS a known edge-case limitation (see QA report):
  // a `success:true` boolean on an otherwise-blank row is itself counted as
  // "meaningful data" by isMeaningfulItem, so an all-blank-report row that also
  // carries success:true is NOT caught by the all_empty branch. In practice the
  // real RCA shapes are caught: extraction items carry `success:false` (→ all_failed)
  // and delivered report rows carry no success field (→ all_empty). This asserts
  // the ACTUAL behaviour so a future change to the signal is a conscious decision.
  it('QA: a success:true marker on a blank row masks all_empty (documented limitation)', () => {
    const stepOutputs = {
      extracted: [
        { success: true, amount: '', vendor: 'Unknown', date: '' },
        { success: true, amount: '', vendor: 'N/A', date: '' },
      ],
    };
    // Not flagged: success:true is treated as a meaningful value.
    expect(detector.detect(stepOutputs)).toHaveLength(0);
  });
});
