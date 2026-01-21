/**
 * Layer 3: Cross-Assumption Conflict Detection
 *
 * Analyzes assumptions to find:
 * - Contradictory assumptions (X and NOT X)
 * - Mutually exclusive options assumed
 * - Logical inconsistencies between assumptions
 */

import type {
  DetectionContext,
  LayerDetectionResult,
  MustConfirmItem,
  ShouldReviewItem,
  LooksGoodItem
} from '../types'

// Known conflict patterns (pairs of terms that contradict)
const CONFLICT_PATTERNS: Array<[string[], string[]]> = [
  // Time conflicts
  [['daily', 'every day'], ['weekly', 'once a week']],
  [['real-time', 'immediately', 'instant'], ['batched', 'scheduled', 'delayed']],

  // Scope conflicts
  [['all', 'everything', 'entire'], ['filtered', 'subset', 'some', 'specific']],
  [['single', 'one'], ['multiple', 'many', 'each']],

  // Access conflicts
  [['private', 'personal', 'own'], ['shared', 'public', 'everyone']],

  // Mode conflicts
  [['automatic', 'automated'], ['manual', 'approval required']],
  [['overwrite', 'replace'], ['append', 'add']],

  // Format conflicts
  [['summary', 'aggregated'], ['detailed', 'individual', 'each item']],
]

export function detectCrossConflicts(context: DetectionContext): LayerDetectionResult {
  const mustConfirm: MustConfirmItem[] = []
  const shouldReview: ShouldReviewItem[] = []
  const looksGood: LooksGoodItem[] = []

  const { semanticPlan } = context
  const assumptions = semanticPlan.assumptions || []

  // Build assumption text index for conflict checking
  const assumptionTexts = assumptions.map(a => ({
    id: a.id,
    text: a.description.toLowerCase(),
    original: a.description,
    confidence: a.confidence
  }))

  // Check each conflict pattern
  for (const [pattern1, pattern2] of CONFLICT_PATTERNS) {
    const matchingAssumptions1: typeof assumptionTexts = []
    const matchingAssumptions2: typeof assumptionTexts = []

    for (const assumption of assumptionTexts) {
      // Check if assumption matches pattern 1
      if (pattern1.some(term => assumption.text.includes(term))) {
        matchingAssumptions1.push(assumption)
      }
      // Check if assumption matches pattern 2
      if (pattern2.some(term => assumption.text.includes(term))) {
        matchingAssumptions2.push(assumption)
      }
    }

    // If we have matches in both patterns, there's a potential conflict
    if (matchingAssumptions1.length > 0 && matchingAssumptions2.length > 0) {
      const assumption1 = matchingAssumptions1[0]
      const assumption2 = matchingAssumptions2[0]

      mustConfirm.push({
        id: `layer3_conflict_${assumption1.id}_${assumption2.id}`,
        layer: 3,
        type: 'cross_conflict',
        title: 'Conflicting Assumptions',
        description: `Two assumptions may conflict:\n• "${assumption1.original}"\n• "${assumption2.original}"`,
        options: [
          {
            id: `keep_${assumption1.id}`,
            label: 'Use first assumption',
            description: assumption1.original
          },
          {
            id: `keep_${assumption2.id}`,
            label: 'Use second assumption',
            description: assumption2.original
          },
          {
            id: 'keep_both',
            label: 'Both are correct',
            description: 'These assumptions apply to different parts of the workflow'
          }
        ],
        source_assumption_id: assumption1.id
      })
    }
  }

  // Check for direct contradictions in same assumption (e.g., "all" and "filtered" in same text)
  for (const assumption of assumptionTexts) {
    for (const [pattern1, pattern2] of CONFLICT_PATTERNS) {
      const hasPattern1 = pattern1.some(term => assumption.text.includes(term))
      const hasPattern2 = pattern2.some(term => assumption.text.includes(term))

      if (hasPattern1 && hasPattern2) {
        // Same assumption contains contradictory terms
        const alreadyFlagged = mustConfirm.some(item =>
          item.source_assumption_id === assumption.id && item.type === 'cross_conflict'
        )

        if (!alreadyFlagged) {
          shouldReview.push({
            id: `layer3_internal_conflict_${assumption.id}`,
            type: 'conflict_potential',
            assumption: assumption.original,
            confidence: assumption.confidence * 0.7, // Reduce confidence due to potential internal conflict
            source_assumption_id: assumption.id
          })
        }
        break // Only flag once per assumption
      }
    }
  }

  // Check for inference conflicts
  const inferences = semanticPlan.inferences || []
  for (const inference of inferences) {
    // Check if inference is based on potentially conflicting assumptions
    const basedOnConflicting = inference.based_on?.some(baseId => {
      return mustConfirm.some(item => item.source_assumption_id === baseId)
    })

    if (basedOnConflicting) {
      shouldReview.push({
        id: `layer3_inference_conflict_${inference.id}`,
        type: 'conflict_potential',
        assumption: `Inference: ${inference.inference}`,
        confidence: inference.confidence * 0.8,
        source_assumption_id: inference.id
      })
    }
  }

  // Mark non-conflicting assumptions as good
  const conflictingIds = new Set([
    ...mustConfirm.map(item => item.source_assumption_id),
    ...shouldReview.map(item => item.source_assumption_id)
  ])

  for (const assumption of assumptions) {
    if (!conflictingIds.has(assumption.id)) {
      // Only add if not already processed by another layer
      looksGood.push({
        id: `layer3_no_conflict_${assumption.id}`,
        assumption: assumption.description,
        confidence: assumption.confidence,
        validated_by: 'conflict_analysis',
        source_assumption_id: assumption.id
      })
    }
  }

  return {
    layer: 3,
    must_confirm: mustConfirm,
    should_review: shouldReview,
    looks_good: looksGood
  }
}
