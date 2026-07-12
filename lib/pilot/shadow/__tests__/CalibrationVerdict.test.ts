import {
  computeVerdict,
  isBlockingIssue,
  isWaveable,
  mapVerdictToDbStatus,
  type VerdictIssue,
} from '../CalibrationVerdict';

const exercised = { exercisedRealPath: true };
const notExercised = { exercisedRealPath: false, reason: 'processed 14, delivered 0' };

const blockingFieldIssue: VerdictIssue = { type: 'plugin_field_fidelity_mismatch', severity: 'critical', blocking: true };
const hardcodeNag: VerdictIssue = { type: 'hardcode_detected', severity: 'medium', requiresUserInput: true, autoRepairAvailable: false };

describe('isBlockingIssue', () => {
  it('treats plugin-field-fidelity mismatch as blocking', () => {
    expect(isBlockingIssue(blockingFieldIssue)).toBe(true);
    expect(isBlockingIssue({ type: 'broken_variable_reference' })).toBe(true);
    expect(isBlockingIssue({ severity: 'critical' })).toBe(true);
  });
  it('does not treat a cosmetic nag as blocking', () => {
    expect(isBlockingIssue(hardcodeNag)).toBe(false);
  });
});

describe('isWaveable', () => {
  it('waves an allow-listed non-blocking user-confirm-only nag', () => {
    expect(isWaveable(hardcodeNag)).toBe(true);
  });
  it('never waves a blocking issue', () => {
    expect(isWaveable(blockingFieldIssue)).toBe(false);
  });
  it('never waves a non-allow-listed issue type', () => {
    expect(isWaveable({ type: 'semantic_failure', severity: 'medium' })).toBe(false);
  });
});

describe('computeVerdict — G1a (blocking always prevents a pass)', () => {
  it('a live field-mismatch cannot pass, even if all other issues are waveable', () => {
    const r = computeVerdict({ issues: [blockingFieldIssue, hardcodeNag], coverage: exercised });
    expect(r.isPassing).toBe(false);
    expect(r.verdict).toBe('needs_review');
    expect(r.blockingIssues).toHaveLength(1);
  });
});

describe('computeVerdict — G1b (relaxation does not leak blocking)', () => {
  it('a session whose ONLY remaining issue is a parameterization nag is not forced to failed', () => {
    const r = computeVerdict({ issues: [hardcodeNag], coverage: exercised });
    expect(r.verdict).toBe('passed');
    expect(r.isPassing).toBe(true);
  });
  it('a non-blocking but non-cosmetic issue still holds back a pass', () => {
    const r = computeVerdict({ issues: [{ type: 'semantic_failure', severity: 'high' }], coverage: exercised });
    expect(r.verdict).toBe('needs_review');
    expect(r.isPassing).toBe(false);
  });
});

describe('computeVerdict — G1c (unexercised real path is never a clean pass)', () => {
  it('zero-eligible-items run resolves to inconclusive, not passed', () => {
    const r = computeVerdict({ issues: [], coverage: notExercised });
    expect(r.verdict).toBe('inconclusive');
    expect(r.isPassing).toBe(false);
    expect(mapVerdictToDbStatus(r.verdict)).toBe('needs_review');
  });
  it('a clean run that exercised the real path passes', () => {
    const r = computeVerdict({ issues: [], coverage: exercised });
    expect(r.verdict).toBe('passed');
    expect(r.isPassing).toBe(true);
    expect(mapVerdictToDbStatus(r.verdict)).toBe('success');
  });
});

describe('computeVerdict — Item 7 corrected states', () => {
  it('caps at corrected_not_verified when a correction was applied but the re-run did not exercise the path', () => {
    const r = computeVerdict({ issues: [], coverage: notExercised, corrected: true });
    expect(r.verdict).toBe('corrected_not_verified');
    expect(r.isPassing).toBe(false);
  });
  it('a corrected-then-re-verified run is a legitimate pass', () => {
    const r = computeVerdict({ issues: [], coverage: exercised, corrected: true });
    expect(r.verdict).toBe('passed');
    expect(r.isPassing).toBe(true);
  });
});

describe('mapVerdictToDbStatus', () => {
  it('maps the new states onto the DB-allowed needs_review', () => {
    expect(mapVerdictToDbStatus('inconclusive')).toBe('needs_review');
    expect(mapVerdictToDbStatus('corrected_not_verified')).toBe('needs_review');
    expect(mapVerdictToDbStatus('failed')).toBe('failed');
    expect(mapVerdictToDbStatus('passed')).toBe('success');
  });
});

describe('computeVerdict — Finding 4 (data-quality coverage floor)', () => {
  const exercisedButBlank = { exercisedRealPath: true, deliveredAllBlank: true };

  it('a 13-row ALL-BLANK delivered report can NEVER be passed (positive row count is not enough)', () => {
    const r = computeVerdict({ issues: [], coverage: exercisedButBlank });
    expect(r.isPassing).toBe(false);
    expect(r.verdict).toBe('inconclusive');
  });

  it('an all-blank delivered report with only a waveable nag still cannot pass', () => {
    const r = computeVerdict({ issues: [hardcodeNag], coverage: exercisedButBlank });
    expect(r.isPassing).toBe(false);
    expect(r.verdict).toBe('inconclusive');
  });

  it('an all-blank delivered report AFTER a correction caps at corrected_not_verified (not passed)', () => {
    const r = computeVerdict({ issues: [], coverage: exercisedButBlank, corrected: true });
    expect(r.isPassing).toBe(false);
    expect(r.verdict).toBe('corrected_not_verified');
  });

  it('a report that ran AND carried meaningful data still passes (deliveredAllBlank false)', () => {
    const r = computeVerdict({ issues: [], coverage: { exercisedRealPath: true, deliveredAllBlank: false } });
    expect(r.isPassing).toBe(true);
    expect(r.verdict).toBe('passed');
  });
});

describe('isBlockingIssue — Item 10 degraded-step types', () => {
  it('treats all-empty / all-failed step issues as blocking', () => {
    expect(isBlockingIssue({ type: 'degraded_step_all_empty' })).toBe(true);
    expect(isBlockingIssue({ type: 'degraded_step_all_failed' })).toBe(true);
  });
  it('a degraded-step blocking issue prevents a pass even with meaningful coverage', () => {
    const r = computeVerdict({
      issues: [{ type: 'degraded_step_all_empty', severity: 'critical', blocking: true }],
      coverage: { exercisedRealPath: true, deliveredAllBlank: false },
    });
    expect(r.isPassing).toBe(false);
    expect(r.verdict).toBe('needs_review');
  });
});
