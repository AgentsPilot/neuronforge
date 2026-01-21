/**
 * 5-Layer Ambiguity Detector
 *
 * Main orchestrator that runs all 5 detection layers and merges results.
 * Each layer analyzes different aspects of the semantic plan and grounding:
 *
 * Layer 1: Confidence Mismatches - grounding vs semantic confidence
 * Layer 2: Semantic Patterns - delivery patterns, loop intent
 * Layer 3: Cross-Assumption Conflicts - contradictory assumptions
 * Layer 4: Vague Language - ambiguous terms in prompt
 * Layer 5: Business Risks - PII, irreversible operations
 */

import type {
  DetectionContext,
  AmbiguityReport,
  MustConfirmItem,
  ShouldReviewItem,
  LooksGoodItem,
  GroundingAmbiguity
} from './types'

import { detectConfidenceMismatches } from './layers/layer1-confidence'
import { detectSemanticPatterns } from './layers/layer2-patterns'
import { detectCrossConflicts } from './layers/layer3-conflicts'
import { detectVagueLanguage } from './layers/layer4-vague'
import { detectBusinessRisks } from './layers/layer5-business'
import { createLogger } from '@/lib/logger'

// Create module-scoped logger
const logger = createLogger({ module: 'V6', service: 'AmbiguityDetector' })

export class AmbiguityDetector {
  /**
   * Run all 5 layers of ambiguity detection
   */
  detect(context: DetectionContext): AmbiguityReport {
    const startTime = Date.now()
    logger.info('Starting 5-layer detection')

    // Run all layers
    const layer1 = detectConfidenceMismatches(context)
    logger.debug({
      layer: 1,
      mustConfirmCount: layer1.must_confirm.length,
      shouldReviewCount: layer1.should_review.length
    }, 'Layer 1 (Confidence) complete')

    const layer2 = detectSemanticPatterns(context)
    logger.debug({
      layer: 2,
      mustConfirmCount: layer2.must_confirm.length,
      shouldReviewCount: layer2.should_review.length
    }, 'Layer 2 (Patterns) complete')

    const layer3 = detectCrossConflicts(context)
    logger.debug({
      layer: 3,
      mustConfirmCount: layer3.must_confirm.length,
      shouldReviewCount: layer3.should_review.length
    }, 'Layer 3 (Conflicts) complete')

    const layer4 = detectVagueLanguage(context)
    logger.debug({
      layer: 4,
      mustConfirmCount: layer4.must_confirm.length,
      shouldReviewCount: layer4.should_review.length
    }, 'Layer 4 (Vague) complete')

    const layer5 = detectBusinessRisks(context)
    logger.debug({
      layer: 5,
      mustConfirmCount: layer5.must_confirm.length,
      shouldReviewCount: layer5.should_review.length
    }, 'Layer 5 (Risks) complete')

    // Merge results
    const allMustConfirm = [
      ...layer1.must_confirm,
      ...layer2.must_confirm,
      ...layer3.must_confirm,
      ...layer4.must_confirm,
      ...layer5.must_confirm
    ]

    const allShouldReview = [
      ...layer1.should_review,
      ...layer2.should_review,
      ...layer3.should_review,
      ...layer4.should_review,
      ...layer5.should_review
    ]

    // For looks_good, deduplicate by source_assumption_id
    const looksGoodMap = new Map<string, LooksGoodItem>()
    const allLooksGood = [
      ...layer1.looks_good,
      ...layer2.looks_good,
      ...layer3.looks_good,
      ...layer4.looks_good,
      ...layer5.looks_good
    ]

    for (const item of allLooksGood) {
      const key = item.source_assumption_id || item.id
      // Keep the one with highest confidence
      const existing = looksGoodMap.get(key)
      if (!existing || item.confidence > existing.confidence) {
        looksGoodMap.set(key, item)
      }
    }

    // Remove items from looks_good if they're in must_confirm or should_review
    const problemIds = new Set([
      ...allMustConfirm.map(item => item.source_assumption_id).filter(Boolean),
      ...allShouldReview.map(item => item.source_assumption_id).filter(Boolean)
    ])

    const filteredLooksGood = Array.from(looksGoodMap.values()).filter(item => {
      const key = item.source_assumption_id || item.id
      return !problemIds.has(key)
    })

    // Extract grounding ambiguities from grounding results
    const groundingAmbiguities = this.extractGroundingAmbiguities(context)

    // Calculate overall confidence
    const overallConfidence = this.calculateOverallConfidence(
      allMustConfirm,
      allShouldReview,
      filteredLooksGood,
      context
    )

    const duration = Date.now() - startTime
    logger.info({
      duration,
      mustConfirmCount: allMustConfirm.length,
      shouldReviewCount: allShouldReview.length,
      looksGoodCount: filteredLooksGood.length,
      groundingAmbiguitiesCount: groundingAmbiguities.length,
      overallConfidence
    }, 'Detection complete')

    return {
      must_confirm: allMustConfirm,
      should_review: allShouldReview,
      looks_good: filteredLooksGood,
      grounding_ambiguities: groundingAmbiguities,
      overall_confidence: overallConfidence
    }
  }

  /**
   * Extract ambiguities discovered during grounding (multiple matches)
   */
  private extractGroundingAmbiguities(context: DetectionContext): GroundingAmbiguity[] {
    const ambiguities: GroundingAmbiguity[] = []
    const { groundedPlan, semanticPlan } = context

    // From grounding results - multiple alternatives found
    for (const result of groundedPlan.grounding_results || []) {
      if (result.alternatives && result.alternatives.length > 1) {
        ambiguities.push({
          id: `grounding_${result.assumption_id}`,
          field: result.field || result.assumption_id,
          description: `Multiple matches found for "${result.field || result.assumption_id}"`,
          discovered_options: result.alternatives.map((alt: any, idx: number) => ({
            id: `alt_${idx}`,
            label: typeof alt === 'string' ? alt : (alt.value || alt.label || `Option ${idx + 1}`),
            metadata: typeof alt === 'object' ? alt.metadata : undefined
          })),
          source: 'grounding'
        })
      }
    }

    // From semantic plan ambiguities that have possible resolutions
    const semanticAmbiguities = semanticPlan.ambiguities || []
    for (let i = 0; i < semanticAmbiguities.length; i++) {
      const amb = semanticAmbiguities[i]
      if (amb.possible_resolutions && amb.possible_resolutions.length > 1) {
        // Only add if not already a must_confirm item
        ambiguities.push({
          id: `semantic_${amb.id || i}`,
          field: 'requirement',
          description: amb.description,
          discovered_options: amb.possible_resolutions.map((res: string, idx: number) => ({
            id: `res_${idx}`,
            label: res
          })),
          source: 'semantic'
        })
      }
    }

    return ambiguities
  }

  /**
   * Calculate overall confidence based on detection results
   */
  private calculateOverallConfidence(
    mustConfirm: MustConfirmItem[],
    shouldReview: ShouldReviewItem[],
    looksGood: LooksGoodItem[],
    context: DetectionContext
  ): number {
    // Base confidence from grounding
    let confidence = context.groundedPlan.grounding_confidence || 0.5

    // Reduce confidence for must_confirm items
    confidence -= mustConfirm.length * 0.05

    // Slightly reduce for should_review items
    confidence -= shouldReview.length * 0.02

    // Boost slightly for looks_good items
    confidence += looksGood.length * 0.01

    // Ensure confidence is between 0 and 1
    return Math.max(0, Math.min(1, confidence))
  }
}

// Export singleton instance
export const ambiguityDetector = new AmbiguityDetector()
