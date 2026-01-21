/**
 * Layer 1: Confidence Mismatch Detection
 *
 * Compares grounding confidence vs semantic confidence to find:
 * - Assumptions where grounding couldn't validate what LLM claimed
 * - "Fake validation" where grounding returned "not implemented"
 * - Very low confidence scores that need user confirmation
 */

import type {
  DetectionContext,
  LayerDetectionResult,
  MustConfirmItem,
  ShouldReviewItem,
  LooksGoodItem
} from '../types'

const CONFIDENCE_THRESHOLD_HIGH = 0.8
const CONFIDENCE_THRESHOLD_MEDIUM = 0.5
const CONFIDENCE_MISMATCH_THRESHOLD = 0.3 // If grounding is 30%+ lower than semantic

export function detectConfidenceMismatches(context: DetectionContext): LayerDetectionResult {
  const mustConfirm: MustConfirmItem[] = []
  const shouldReview: ShouldReviewItem[] = []
  const looksGood: LooksGoodItem[] = []

  const { semanticPlan, groundedPlan } = context

  // Build a map of semantic assumptions by ID for comparison
  const semanticAssumptionMap = new Map<string, { description: string; confidence: number; impact_if_wrong?: string }>()
  for (const assumption of semanticPlan.assumptions || []) {
    semanticAssumptionMap.set(assumption.id, {
      description: assumption.description,
      confidence: assumption.confidence,
      impact_if_wrong: assumption.impact_if_wrong
    })
  }

  // Analyze each grounding result
  for (const result of groundedPlan.grounding_results || []) {
    const semanticAssumption = semanticAssumptionMap.get(result.assumption_id)
    const assumptionText = result.assumption_text || semanticAssumption?.description || result.assumption_id
    const semanticConfidence = semanticAssumption?.confidence ?? 0.5

    // Skip if skipped
    if (result.skipped) {
      continue
    }

    // Check for fake validation (grounding returned error or "not implemented")
    if (result.error && result.error.toLowerCase().includes('not implemented')) {
      mustConfirm.push({
        id: `layer1_fake_validation_${result.assumption_id}`,
        layer: 1,
        type: 'fake_validation',
        title: 'Validation Not Available',
        description: `Could not verify: "${assumptionText}". The validation for this type of data is not yet implemented.`,
        options: [
          {
            id: 'confirm_correct',
            label: 'This is correct',
            description: 'I confirm this assumption is accurate'
          },
          {
            id: 'skip_assumption',
            label: 'Skip this',
            description: 'Remove this assumption from the workflow'
          }
        ],
        source_assumption_id: result.assumption_id
      })
      continue
    }

    // Check for confidence mismatch (grounding much lower than semantic)
    if (result.validated && semanticConfidence - result.confidence >= CONFIDENCE_MISMATCH_THRESHOLD) {
      mustConfirm.push({
        id: `layer1_confidence_mismatch_${result.assumption_id}`,
        layer: 1,
        type: 'confidence_mismatch',
        title: 'Verification Uncertainty',
        description: `"${assumptionText}" - Initial confidence was ${(semanticConfidence * 100).toFixed(0)}%, but validation only achieved ${(result.confidence * 100).toFixed(0)}%.`,
        options: [
          {
            id: 'proceed_anyway',
            label: 'Proceed anyway',
            description: 'Continue with this assumption despite lower confidence'
          },
          {
            id: 'skip_assumption',
            label: 'Skip this',
            description: 'Remove this assumption from the workflow'
          }
        ],
        recommended: 'proceed_anyway',
        source_assumption_id: result.assumption_id
      })
      continue
    }

    // Check for very low confidence (needs confirmation)
    if (!result.validated || result.confidence < CONFIDENCE_THRESHOLD_MEDIUM) {
      mustConfirm.push({
        id: `layer1_low_confidence_${result.assumption_id}`,
        layer: 1,
        type: 'low_confidence',
        title: 'Low Confidence',
        description: `"${assumptionText}" could not be fully validated (${(result.confidence * 100).toFixed(0)}% confidence).`,
        options: [
          {
            id: 'confirm_correct',
            label: 'This is correct',
            description: 'I confirm this assumption is accurate'
          },
          {
            id: 'skip_assumption',
            label: 'Skip this',
            description: 'Remove this assumption from the workflow'
          }
        ],
        source_assumption_id: result.assumption_id
      })
      continue
    }

    // Medium confidence - should review
    if (result.confidence < CONFIDENCE_THRESHOLD_HIGH) {
      shouldReview.push({
        id: `layer1_medium_${result.assumption_id}`,
        type: 'medium_confidence',
        assumption: assumptionText,
        confidence: result.confidence,
        grounding_result: result.resolved_value ? JSON.stringify(result.resolved_value) : undefined,
        source_assumption_id: result.assumption_id
      })
      continue
    }

    // High confidence - looks good
    looksGood.push({
      id: `layer1_validated_${result.assumption_id}`,
      assumption: assumptionText,
      confidence: result.confidence,
      validated_by: result.validation_method || 'grounding',
      source_assumption_id: result.assumption_id
    })
  }

  // Check for grounding errors that indicate problems
  for (const error of groundedPlan.grounding_errors || []) {
    if (error.severity === 'error' && error.assumption_id) {
      const assumptionText = semanticAssumptionMap.get(error.assumption_id)?.description || error.assumption_id

      // Only add if not already in mustConfirm
      const alreadyAdded = mustConfirm.some(item => item.source_assumption_id === error.assumption_id)
      if (!alreadyAdded) {
        mustConfirm.push({
          id: `layer1_error_${error.assumption_id}`,
          layer: 1,
          type: 'low_confidence',
          title: 'Validation Error',
          description: `Error validating "${assumptionText}": ${error.message}`,
          options: [
            {
              id: 'ignore_error',
              label: 'Proceed anyway',
              description: 'Continue despite the validation error'
            },
            {
              id: 'skip_assumption',
              label: 'Skip this',
              description: 'Remove this assumption from the workflow'
            }
          ],
          source_assumption_id: error.assumption_id
        })
      }
    }
  }

  return {
    layer: 1,
    must_confirm: mustConfirm,
    should_review: shouldReview,
    looks_good: looksGood
  }
}
