import { canFinishCalibration, getPassSuggestions, isCalibrationHistoryPass } from '../finishGate';

describe('canFinishCalibration — A1 verdict-gated finish transition', () => {
  it('a clean passing run (success, 0 critical) can finish', () => {
    expect(canFinishCalibration({ success: true, status: 'success', verdict: 'passed', summary: { critical: 0 } })).toBe(true);
  });

  it('a cosmetic-only passing run (success, 0 critical, suggestions present) can finish', () => {
    // summary.total > 0 but critical === 0 and success === true → finish allowed.
    expect(canFinishCalibration({ success: true, status: 'success', verdict: 'passed', summary: { critical: 0 } })).toBe(true);
  });

  it('a run with blocking/critical issues CANNOT finish', () => {
    expect(canFinishCalibration({ success: false, status: 'needs_review', verdict: 'needs_review', summary: { critical: 2 } })).toBe(false);
  });

  it('a needs_review run (success:false) cannot finish even with 0 critical', () => {
    expect(canFinishCalibration({ success: false, status: 'needs_review', verdict: 'needs_review', summary: { critical: 0 } })).toBe(false);
  });

  it('an inconclusive coverage-floor run (success:false, 0 issues) cannot finish', () => {
    expect(canFinishCalibration({ success: false, status: 'needs_review', verdict: 'inconclusive', summary: { critical: 0 } })).toBe(false);
  });

  it('defensive: missing/undefined result cannot finish', () => {
    expect(canFinishCalibration(undefined)).toBe(false);
    expect(canFinishCalibration(null)).toBe(false);
    expect(canFinishCalibration({})).toBe(false);
  });

  it('defensive: success true but a critical count present cannot finish', () => {
    expect(canFinishCalibration({ success: true, summary: { critical: 1 } })).toBe(false);
  });
});

describe('getPassSuggestions — A3 UI half (surface optional cosmetic notes on a pass)', () => {
  const passWithHardcode = {
    success: true,
    status: 'success',
    verdict: 'passed',
    summary: { critical: 0 },
    issues: {
      critical: [],
      warnings: [{ title: 'Hardcoded value: 500', message: 'The value 500 could be made a reusable parameter.', severity: 'heads_up' }],
      autoRepairs: [],
    },
  };

  it('returns the cosmetic suggestion from a passed-with-suggestions result', () => {
    const s = getPassSuggestions(passWithHardcode);
    expect(s).toHaveLength(1);
    expect(s[0].title).toBe('Hardcoded value: 500');
    expect(s[0].message).toContain('reusable parameter');
  });

  it('returns [] for a clean pass with zero warnings (keep the perfect-run screen)', () => {
    expect(getPassSuggestions({ success: true, status: 'success', summary: { critical: 0 }, issues: { warnings: [] } })).toEqual([]);
    expect(getPassSuggestions({ success: true, status: 'success', summary: { critical: 0 } })).toEqual([]);
  });

  it('returns [] for a NON-passing result (finish screen never renders → no suggestions surfaced)', () => {
    expect(getPassSuggestions({ success: false, summary: { critical: 0 }, issues: { warnings: [{ title: 'x', message: 'y' }] } })).toEqual([]);
    expect(getPassSuggestions({ success: true, summary: { critical: 2 }, issues: { warnings: [{ title: 'x', message: 'y' }] } })).toEqual([]);
  });

  it('is resilient to malformed warning entries (missing title/message)', () => {
    const s = getPassSuggestions({ success: true, summary: { critical: 0 }, issues: { warnings: [{}, { message: 'only a message' }] } });
    expect(s).toHaveLength(2);
    expect(s[0].title).toBe('Optional suggestion');
    expect(s[1].message).toBe('only a message');
  });

  it('defensive: null/undefined result → []', () => {
    expect(getPassSuggestions(null)).toEqual([]);
    expect(getPassSuggestions(undefined)).toEqual([]);
  });
});

describe('isCalibrationHistoryPass — FIX 1 (calibration_status gate consistent with the verdict)', () => {
  it('a cosmetic-only PASS (history status "success", suggestions remaining) → pass, NOT failed', () => {
    // The route writes history 'success' on the Item 6a relaxation; remaining
    // waveable suggestions must NOT flip the gate to 'failed'.
    expect(isCalibrationHistoryPass('success')).toBe(true);
  });

  it('a clean PASS (history status "success") → pass', () => {
    expect(isCalibrationHistoryPass('success')).toBe(true);
  });

  it('a needs_review / inconclusive / corrected run → NOT a pass', () => {
    expect(isCalibrationHistoryPass('needs_review')).toBe(false);
  });

  it('a failed run → NOT a pass', () => {
    expect(isCalibrationHistoryPass('failed')).toBe(false);
  });

  it('verification_only / unknown / null → NOT a pass (conservative)', () => {
    expect(isCalibrationHistoryPass('verification_only')).toBe(false);
    expect(isCalibrationHistoryPass(undefined)).toBe(false);
    expect(isCalibrationHistoryPass(null)).toBe(false);
  });
});
