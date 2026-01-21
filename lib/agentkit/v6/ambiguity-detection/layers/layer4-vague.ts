/**
 * Layer 4: Vague Language Detection
 *
 * Analyzes enhanced prompt and semantic plan for:
 * - Vague quantifiers ("some", "a few", "many")
 * - Unclear timeframes ("soon", "recently", "later")
 * - Ambiguous references ("it", "that", "those")
 * - Semantic plan ambiguities flagged by LLM
 */

import type {
  DetectionContext,
  LayerDetectionResult,
  MustConfirmItem,
  ShouldReviewItem,
  LooksGoodItem
} from '../types'

// Vague quantifiers and their clarification options
const VAGUE_QUANTIFIERS: Record<string, { pattern: RegExp; clarifications: string[] }> = {
  some: {
    pattern: /\bsome\s+\w+/gi,
    clarifications: ['All matching items', 'First 10 items', 'Items from today only', 'Let me specify a number']
  },
  few: {
    pattern: /\b(a\s+)?few\s+\w+/gi,
    clarifications: ['3 items', '5 items', '10 items', 'Let me specify']
  },
  many: {
    pattern: /\bmany\s+\w+/gi,
    clarifications: ['All items', 'Top 50', 'Top 100', 'Let me specify a limit']
  },
  several: {
    pattern: /\bseveral\s+\w+/gi,
    clarifications: ['5 items', '10 items', 'All matching', 'Let me specify']
  },
  recent: {
    pattern: /\brecent(ly)?\b/gi,
    clarifications: ['Last 24 hours', 'Last 7 days', 'Last 30 days', 'Let me specify']
  },
  latest: {
    pattern: /\blatest\b/gi,
    clarifications: ['Most recent 1', 'Most recent 5', 'Most recent 10', 'Today only']
  },
  old: {
    pattern: /\bold(er)?\b/gi,
    clarifications: ['Older than 30 days', 'Older than 7 days', 'Older than 90 days', 'Let me specify']
  },
  important: {
    pattern: /\bimportant\b/gi,
    clarifications: ['High priority only', 'Starred/flagged items', 'From specific senders', 'Let me define criteria']
  },
  urgent: {
    pattern: /\burgent\b/gi,
    clarifications: ['Contains "urgent" in subject', 'Marked high priority', 'From VIP contacts', 'Let me define criteria']
  },
  regular: {
    pattern: /\bregular(ly)?\b/gi,
    clarifications: ['Daily', 'Weekly', 'Monthly', 'Let me specify frequency']
  }
}

// Vague timeframe patterns
const VAGUE_TIMEFRAMES: Record<string, { pattern: RegExp; clarifications: string[] }> = {
  soon: {
    pattern: /\bsoon\b/gi,
    clarifications: ['Within 1 hour', 'Within 24 hours', 'Within this week', 'Immediately']
  },
  later: {
    pattern: /\blater\b/gi,
    clarifications: ['After 1 hour', 'Tomorrow', 'Next week', 'Let me specify']
  },
  periodically: {
    pattern: /\bperiodically\b/gi,
    clarifications: ['Every hour', 'Every day', 'Every week', 'Let me specify']
  },
  occasionally: {
    pattern: /\boccasionally\b/gi,
    clarifications: ['Once a week', 'Once a month', 'When triggered', 'Let me specify']
  }
}

export function detectVagueLanguage(context: DetectionContext): LayerDetectionResult {
  const mustConfirm: MustConfirmItem[] = []
  const shouldReview: ShouldReviewItem[] = []
  const looksGood: LooksGoodItem[] = []

  const { semanticPlan, enhancedPrompt } = context

  // Build full prompt text for analysis
  const promptSections = enhancedPrompt.sections || {}
  const allPromptText = [
    ...(promptSections.data || []),
    ...(promptSections.actions || []),
    ...(promptSections.output || []),
    ...(promptSections.delivery || [])
  ].join(' ')

  // Check for vague quantifiers
  for (const [term, config] of Object.entries(VAGUE_QUANTIFIERS)) {
    const matches = allPromptText.match(config.pattern)
    if (matches && matches.length > 0) {
      const matchContext = matches[0]

      mustConfirm.push({
        id: `layer4_vague_${term}`,
        layer: 4,
        type: 'vague_language',
        title: `Clarify: "${matchContext}"`,
        description: `The term "${term}" is ambiguous. Please specify what you mean.`,
        options: config.clarifications.map((clarification, idx) => ({
          id: `${term}_option_${idx}`,
          label: clarification,
          description: ''
        }))
      })
    }
  }

  // Check for vague timeframes
  for (const [term, config] of Object.entries(VAGUE_TIMEFRAMES)) {
    const matches = allPromptText.match(config.pattern)
    if (matches && matches.length > 0) {
      mustConfirm.push({
        id: `layer4_timeframe_${term}`,
        layer: 4,
        type: 'vague_language',
        title: `Clarify timing: "${term}"`,
        description: `The timing "${term}" needs clarification.`,
        options: config.clarifications.map((clarification, idx) => ({
          id: `${term}_time_${idx}`,
          label: clarification,
          description: ''
        }))
      })
    }
  }

  // Process semantic plan ambiguities that require user input
  const ambiguities = semanticPlan.ambiguities || []
  for (let i = 0; i < ambiguities.length; i++) {
    const ambiguity = ambiguities[i]

    if (ambiguity.requires_user_input) {
      const options = (ambiguity.possible_resolutions || []).map((resolution, idx) => ({
        id: `semantic_resolution_${i}_${idx}`,
        label: resolution,
        description: ''
      }))

      // Add "Other" option if not many resolutions provided
      if (options.length < 4 && options.length > 0) {
        options.push({
          id: `semantic_resolution_${i}_other`,
          label: 'None of these',
          description: 'I need to specify something different'
        })
      }

      if (options.length > 0) {
        mustConfirm.push({
          id: `layer4_semantic_ambiguity_${i}`,
          layer: 4,
          type: 'semantic_ambiguity',
          title: 'Clarification Needed',
          description: ambiguity.description,
          options,
          recommended: ambiguity.recommended_resolution
            ? options.find(o => o.label === ambiguity.recommended_resolution)?.id
            : undefined
        })
      }
    } else {
      // Non-critical ambiguity - add to should review
      shouldReview.push({
        id: `layer4_semantic_noted_${i}`,
        type: 'vague_detected',
        assumption: ambiguity.description,
        confidence: 0.7
      })
    }
  }

  // If no vague language detected, mark as good
  if (mustConfirm.length === 0 && shouldReview.length === 0) {
    looksGood.push({
      id: 'layer4_language_clear',
      assumption: 'No ambiguous language detected in the request',
      confidence: 0.95,
      validated_by: 'language_analysis'
    })
  }

  return {
    layer: 4,
    must_confirm: mustConfirm,
    should_review: shouldReview,
    looks_good: looksGood
  }
}
