/**
 * Layer 2: Semantic Pattern Detection
 *
 * Analyzes semantic plan understanding to detect:
 * - Delivery pattern ambiguity (per_item vs per_group)
 * - Loop intent ambiguity (one action to all vs one per item)
 * - Data visibility patterns (who sees what data)
 */

import type {
  DetectionContext,
  LayerDetectionResult,
  MustConfirmItem,
  ShouldReviewItem,
  LooksGoodItem
} from '../types'

export function detectSemanticPatterns(context: DetectionContext): LayerDetectionResult {
  const mustConfirm: MustConfirmItem[] = []
  const shouldReview: ShouldReviewItem[] = []
  const looksGood: LooksGoodItem[] = []

  const { semanticPlan, enhancedPrompt } = context
  const understanding = semanticPlan.understanding

  // Pattern 1: Delivery pattern ambiguity (per_item vs per_group)
  if (understanding?.delivery) {
    const delivery = understanding.delivery

    // Check if both per_item and per_group could apply
    const hasGrouping = delivery.grouping && delivery.grouping !== 'none'
    const deliveryPattern = delivery.pattern?.toLowerCase() || ''

    // Ambiguous patterns that could be interpreted either way
    const ambiguousPatterns = ['email', 'send', 'notify', 'alert', 'message']
    const isAmbiguousAction = ambiguousPatterns.some(p => deliveryPattern.includes(p))

    if (isAmbiguousAction && hasGrouping) {
      // Could be "one email per group" or "one email with all groups"
      mustConfirm.push({
        id: 'layer2_delivery_pattern',
        layer: 2,
        type: 'pattern_detected',
        title: 'Delivery Pattern',
        description: `The workflow involves sending ${deliveryPattern} with grouped data. How should this be delivered?`,
        options: [
          {
            id: 'per_group',
            label: 'One per group',
            description: `Send a separate ${deliveryPattern} for each ${delivery.grouping}`,
            impact: 'Multiple messages, each with subset of data'
          },
          {
            id: 'single_summary',
            label: 'Single summary',
            description: `Send one ${deliveryPattern} containing all groups`,
            impact: 'One message with all data combined'
          }
        ],
        recommended: delivery.per_group ? 'per_group' : 'single_summary'
      })
    }
  }

  // Pattern 2: Loop intent detection from prompt text
  const promptSections = enhancedPrompt.sections || {}
  const allPromptText = [
    ...(promptSections.data || []),
    ...(promptSections.actions || []),
    ...(promptSections.output || []),
    ...(promptSections.delivery || [])
  ].join(' ').toLowerCase()

  // Check for "each" or "every" patterns that suggest iteration
  const eachPattern = /\b(each|every|per|for all|individually)\b/i
  const allPattern = /\b(all|combined|together|summary|aggregate)\b/i

  const hasEachIntent = eachPattern.test(allPromptText)
  const hasAllIntent = allPattern.test(allPromptText)

  // If both patterns present, it's ambiguous
  if (hasEachIntent && hasAllIntent) {
    // Check if we haven't already flagged delivery pattern
    const alreadyFlaggedDelivery = mustConfirm.some(item => item.id === 'layer2_delivery_pattern')

    if (!alreadyFlaggedDelivery) {
      mustConfirm.push({
        id: 'layer2_loop_intent',
        layer: 2,
        type: 'pattern_detected',
        title: 'Processing Intent',
        description: 'The request mentions both individual processing ("each", "every") and aggregate processing ("all", "combined"). Which is intended?',
        options: [
          {
            id: 'process_each',
            label: 'Process each item separately',
            description: 'Perform the action individually for each item',
            impact: 'Multiple operations, one per item'
          },
          {
            id: 'process_all',
            label: 'Process all items together',
            description: 'Perform the action once with all items combined',
            impact: 'Single operation with aggregated data'
          }
        ]
      })
    }
  }

  // Pattern 3: Data visibility (who sees what)
  // Look for patterns suggesting data filtering per recipient
  const visibilityKeywords = ['their', 'own', 'assigned', 'responsible', 'belongs']
  const hasVisibilityIntent = visibilityKeywords.some(kw => allPromptText.includes(kw))

  // Look for patterns suggesting everyone sees everything
  const sharedKeywords = ['all data', 'complete', 'full report', 'entire']
  const hasSharedIntent = sharedKeywords.some(kw => allPromptText.includes(kw))

  if (hasVisibilityIntent && hasSharedIntent) {
    mustConfirm.push({
      id: 'layer2_data_visibility',
      layer: 2,
      type: 'pattern_detected',
      title: 'Data Visibility',
      description: 'The request mentions both personal data filtering and complete data access. Clarify the intended visibility.',
      options: [
        {
          id: 'filtered_per_user',
          label: 'Each person sees only their data',
          description: 'Filter data based on ownership/assignment',
          impact: 'Privacy-preserving, personalized views'
        },
        {
          id: 'everyone_sees_all',
          label: 'Everyone sees all data',
          description: 'No filtering, complete data shared with all',
          impact: 'Full transparency, no privacy filtering'
        }
      ]
    })
  }

  // If no ambiguities detected, mark delivery understanding as good
  if (mustConfirm.length === 0 && understanding?.delivery) {
    looksGood.push({
      id: 'layer2_delivery_understood',
      assumption: `Delivery pattern: ${understanding.delivery.pattern || 'standard'}`,
      confidence: 0.9,
      validated_by: 'semantic_analysis'
    })
  }

  return {
    layer: 2,
    must_confirm: mustConfirm,
    should_review: shouldReview,
    looks_good: looksGood
  }
}
