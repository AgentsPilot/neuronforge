/**
 * D10 — deriveHardcodeState must CLEAR the detection UI state when no hardcodes
 * remain (the missing else-branch), and set it when hardcodes are present.
 */

import { deriveHardcodeState, countDetectedHardcodes } from '../hardcodeState';
import type { DetectionResult } from '@/lib/pilot/shadow/HardcodeDetector';

const EMPTY: DetectionResult = { resource_ids: [], business_logic: [], configuration: [], total_count: 0 };

function withOne(): DetectionResult {
  return {
    resource_ids: [],
    business_logic: [
      // shape matches DetectedValue; only length is read by the helper
      { path: 'step1.params.max_results', value: 500, suggested_param: 'max_results', category: 'business_logic' } as any,
    ],
    configuration: [],
    // total_count is intentionally left inconsistent (0) to prove the helper counts
    // the category arrays itself and does not trust a precomputed total.
    total_count: 0,
  };
}

describe('countDetectedHardcodes', () => {
  it('is 0 for null / undefined / empty', () => {
    expect(countDetectedHardcodes(null)).toBe(0);
    expect(countDetectedHardcodes(undefined)).toBe(0);
    expect(countDetectedHardcodes(EMPTY)).toBe(0);
  });

  it('sums across all categories', () => {
    expect(countDetectedHardcodes(withOne())).toBe(1);
  });
});

describe('deriveHardcodeState', () => {
  it('CLEARS state when nothing is detected (the fixed else-branch)', () => {
    expect(deriveHardcodeState(EMPTY)).toEqual({ hasHardcodedValues: false, detectionResult: null });
    expect(deriveHardcodeState(null)).toEqual({ hasHardcodedValues: false, detectionResult: null });
  });

  it('SETS state when a hardcode is present', () => {
    const detection = withOne();
    expect(deriveHardcodeState(detection)).toEqual({
      hasHardcodedValues: true,
      detectionResult: detection,
    });
  });
});
