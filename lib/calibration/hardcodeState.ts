/**
 * D10 — pure derivation of the sandbox's hardcode-detection UI state from a
 * HardcodeDetector result.
 *
 * The bug: `loadAgent` set `hasHardcodedValues=true` / `detectionResult` ONLY when
 * hardcodes were found, with no else-branch — so after a successful parameterization
 * (no hardcodes remain) the stale "true" state persisted and the resolved suggestion
 * kept showing. Routing the detection through this pure helper makes "clear on empty"
 * the default and keeps the logic unit-testable without mounting the page.
 */

import type { DetectionResult } from '@/lib/pilot/shadow/HardcodeDetector';

export interface HardcodeUiState {
  hasHardcodedValues: boolean;
  detectionResult: DetectionResult | null;
}

/** Total hardcoded values across all categories (0 when none / null). */
export function countDetectedHardcodes(detection: DetectionResult | null | undefined): number {
  if (!detection) return 0;
  return (
    (detection.resource_ids?.length || 0) +
    (detection.business_logic?.length || 0) +
    (detection.configuration?.length || 0)
  );
}

/**
 * Map a detection result to the UI state. When nothing is detected, BOTH fields
 * are cleared (`false` / `null`) — this is the clear-on-empty branch the original
 * code was missing.
 */
export function deriveHardcodeState(detection: DetectionResult | null | undefined): HardcodeUiState {
  return countDetectedHardcodes(detection) > 0
    ? { hasHardcodedValues: true, detectionResult: detection as DetectionResult }
    : { hasHardcodedValues: false, detectionResult: null };
}
