/**
 * Unit tests for the calibration auto-RCA Zod schema (AC-8, FR-15).
 * Proves a well-formed object validates and malformed / bad-layer output fails,
 * driving the AC-3 deterministic fallback.
 */

import {
  CalibrationAutoRcaSchema,
  ROOT_CAUSE_LAYERS,
  REMEDIATION_PATHS,
} from '../calibrationRca-schema';

function validRca(overrides: Record<string, unknown> = {}) {
  return {
    symptom: 'Calibration landed on needs_review with 1 remaining issue',
    evidence: 'history.issues_remaining + pilot_steps step_2 definition',
    earliestFailingStep: 'step_2 (sheets.read_range) failed; step_3 cascaded (no input data)',
    rootCauseLayer: 'V6 generation',
    rootCause: 'Generation hardcoded range="Sheet1" instead of deriving the tab name',
    fixOwner: 'v6-pipeline',
    suggestedSolutions: ['Derive the sheet tab name from the gid at bind time'],
    remediationPath: 'full cycle',
    ...overrides,
  };
}

describe('CalibrationAutoRcaSchema', () => {
  it('accepts a well-formed 8-field RCA object', () => {
    const result = CalibrationAutoRcaSchema.safeParse(validRca());
    expect(result.success).toBe(true);
  });

  it('accepts every one of the 5 allowed root-cause layers', () => {
    for (const layer of ROOT_CAUSE_LAYERS) {
      expect(CalibrationAutoRcaSchema.safeParse(validRca({ rootCauseLayer: layer })).success).toBe(true);
    }
  });

  it('accepts both remediation paths', () => {
    for (const path of REMEDIATION_PATHS) {
      expect(CalibrationAutoRcaSchema.safeParse(validRca({ remediationPath: path })).success).toBe(true);
    }
  });

  it('rejects an out-of-set root-cause layer', () => {
    const result = CalibrationAutoRcaSchema.safeParse(validRca({ rootCauseLayer: 'network' }));
    expect(result.success).toBe(false);
  });

  it('rejects an out-of-set remediation path', () => {
    const result = CalibrationAutoRcaSchema.safeParse(validRca({ remediationPath: 'ignore it' }));
    expect(result.success).toBe(false);
  });

  it('rejects a missing required field', () => {
    const bad = validRca();
    delete (bad as Record<string, unknown>).rootCause;
    expect(CalibrationAutoRcaSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an empty suggestedSolutions array', () => {
    expect(CalibrationAutoRcaSchema.safeParse(validRca({ suggestedSolutions: [] })).success).toBe(false);
  });

  it('rejects empty-string fields', () => {
    expect(CalibrationAutoRcaSchema.safeParse(validRca({ symptom: '' })).success).toBe(false);
  });

  it('rejects unknown extra keys (strict boundary)', () => {
    expect(CalibrationAutoRcaSchema.safeParse(validRca({ hallucinated: 'x' })).success).toBe(false);
  });
});
