/**
 * 5-Layer Ambiguity Detection Module
 *
 * Analyzes semantic plan and grounding results to identify items
 * that need user confirmation before IR formalization.
 *
 * Usage:
 * ```typescript
 * import { detectAmbiguities } from '@/lib/agentkit/v6/ambiguity-detection'
 *
 * const report = detectAmbiguities(semanticPlan, groundedPlan, enhancedPrompt)
 * // report.must_confirm - Items blocking "Create Agent"
 * // report.should_review - Items expanded by default
 * // report.looks_good - Items collapsed (pre-approved)
 * // report.grounding_ambiguities - Multiple matches found
 * ```
 */

export * from './types'
export { AmbiguityDetector, ambiguityDetector } from './detector'

// Layer exports (for testing/debugging)
export { detectConfidenceMismatches } from './layers/layer1-confidence'
export { detectSemanticPatterns } from './layers/layer2-patterns'
export { detectCrossConflicts } from './layers/layer3-conflicts'
export { detectVagueLanguage } from './layers/layer4-vague'
export { detectBusinessRisks } from './layers/layer5-business'

import type {
  SemanticPlanInput,
  GroundedPlanInput,
  EnhancedPromptInput,
  AmbiguityReport
} from './types'
import { ambiguityDetector } from './detector'

/**
 * Main entry point for ambiguity detection
 *
 * @param semanticPlan - Output from Phase 1 (Semantic Plan Generation)
 * @param groundedPlan - Output from Phase 2 (Grounding)
 * @param enhancedPrompt - Input from Thread-Based Phase 3
 * @returns AmbiguityReport with categorized items for Review UI
 */
export function detectAmbiguities(
  semanticPlan: SemanticPlanInput,
  groundedPlan: GroundedPlanInput,
  enhancedPrompt: EnhancedPromptInput
): AmbiguityReport {
  return ambiguityDetector.detect({
    semanticPlan,
    groundedPlan,
    enhancedPrompt
  })
}
