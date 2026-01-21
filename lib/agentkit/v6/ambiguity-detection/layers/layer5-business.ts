/**
 * Layer 5: Business Risk Detection
 *
 * Analyzes assumptions and operations for:
 * - PII/sensitive data handling
 * - Irreversible operations (delete, send)
 * - High-impact actions that need explicit confirmation
 * - External communications (emails, notifications)
 */

import type {
  DetectionContext,
  LayerDetectionResult,
  MustConfirmItem,
  ShouldReviewItem,
  LooksGoodItem
} from '../types'

// PII-related keywords
const PII_KEYWORDS = [
  'email', 'phone', 'address', 'ssn', 'social security',
  'credit card', 'bank', 'account number', 'password',
  'name', 'personal', 'private', 'confidential', 'salary',
  'medical', 'health', 'dob', 'date of birth', 'age'
]

// Irreversible action keywords
const IRREVERSIBLE_KEYWORDS = [
  'delete', 'remove', 'erase', 'destroy', 'purge',
  'send', 'email', 'notify', 'message', 'post',
  'publish', 'share', 'transfer', 'move'
]

// High-impact action keywords
const HIGH_IMPACT_KEYWORDS = [
  'all', 'every', 'entire', 'complete', 'bulk',
  'production', 'live', 'customer', 'client', 'external'
]

export function detectBusinessRisks(context: DetectionContext): LayerDetectionResult {
  const mustConfirm: MustConfirmItem[] = []
  const shouldReview: ShouldReviewItem[] = []
  const looksGood: LooksGoodItem[] = []

  const { semanticPlan, enhancedPrompt } = context
  const assumptions = semanticPlan.assumptions || []

  // Build full context for analysis
  const promptSections = enhancedPrompt.sections || {}
  const allText = [
    semanticPlan.goal || '',
    ...(promptSections.data || []),
    ...(promptSections.actions || []),
    ...(promptSections.output || []),
    ...(promptSections.delivery || []),
    ...assumptions.map(a => a.description)
  ].join(' ').toLowerCase()

  // Check for PII handling
  const detectedPII = PII_KEYWORDS.filter(kw => allText.includes(kw))
  if (detectedPII.length > 0) {
    mustConfirm.push({
      id: 'layer5_pii_detected',
      layer: 5,
      type: 'business_risk',
      title: 'Sensitive Data Handling',
      description: `This workflow may handle sensitive data (${detectedPII.slice(0, 3).join(', ')}${detectedPII.length > 3 ? '...' : ''}). Please confirm the intended data handling.`,
      options: [
        {
          id: 'pii_acknowledged',
          label: 'I understand the data sensitivity',
          description: 'Proceed with appropriate handling of sensitive data',
          impact: 'Workflow will process sensitive data'
        },
        {
          id: 'pii_filter',
          label: 'Filter out sensitive fields',
          description: 'Exclude PII from the workflow output',
          impact: 'Some data fields will be omitted'
        },
        {
          id: 'pii_mask',
          label: 'Mask sensitive data',
          description: 'Include but mask/redact sensitive fields',
          impact: 'Sensitive fields will be partially hidden'
        }
      ]
    })
  }

  // Check for irreversible operations
  const detectedIrreversible = IRREVERSIBLE_KEYWORDS.filter(kw => allText.includes(kw))
  const hasDelete = detectedIrreversible.some(kw => ['delete', 'remove', 'erase', 'destroy', 'purge'].includes(kw))
  const hasSend = detectedIrreversible.some(kw => ['send', 'email', 'notify', 'message', 'post', 'publish'].includes(kw))

  if (hasDelete) {
    mustConfirm.push({
      id: 'layer5_delete_operation',
      layer: 5,
      type: 'business_risk',
      title: 'Destructive Operation',
      description: 'This workflow includes delete/remove operations which cannot be undone.',
      options: [
        {
          id: 'delete_confirmed',
          label: 'Yes, delete is intended',
          description: 'Proceed with the delete operation',
          impact: 'Data will be permanently removed'
        },
        {
          id: 'delete_archive',
          label: 'Archive instead of delete',
          description: 'Move to archive/trash instead of permanent deletion',
          impact: 'Data can be recovered if needed'
        },
        {
          id: 'delete_remove',
          label: 'Remove delete from workflow',
          description: 'Skip the delete step entirely',
          impact: 'No data will be deleted'
        }
      ]
    })
  }

  if (hasSend) {
    // Check if sending to external recipients
    const hasExternal = allText.includes('customer') || allText.includes('client') ||
                        allText.includes('external') || allText.includes('user')

    if (hasExternal) {
      mustConfirm.push({
        id: 'layer5_external_send',
        layer: 5,
        type: 'business_risk',
        title: 'External Communication',
        description: 'This workflow will send communications to external recipients (customers/clients).',
        options: [
          {
            id: 'send_confirmed',
            label: 'Yes, send to external recipients',
            description: 'Proceed with sending to customers/clients',
            impact: 'Recipients will receive the communication'
          },
          {
            id: 'send_internal_only',
            label: 'Send to internal team only',
            description: 'Redirect to internal recipients instead',
            impact: 'Only team members will be notified'
          },
          {
            id: 'send_draft',
            label: 'Create as draft for review',
            description: 'Create drafts that require manual approval',
            impact: 'Messages saved as drafts, not sent automatically'
          }
        ]
      })
    } else {
      // Internal send - less risky but still worth reviewing
      shouldReview.push({
        id: 'layer5_internal_send',
        type: 'medium_confidence',
        assumption: 'Workflow includes send/notification actions',
        confidence: 0.85
      })
    }
  }

  // Check for bulk/high-impact operations
  const hasBulkOperation = HIGH_IMPACT_KEYWORDS.some(kw => allText.includes(kw)) &&
                          IRREVERSIBLE_KEYWORDS.some(kw => allText.includes(kw))

  if (hasBulkOperation && !hasDelete && !hasSend) {
    shouldReview.push({
      id: 'layer5_bulk_operation',
      type: 'medium_confidence',
      assumption: 'Workflow performs bulk operations on data',
      confidence: 0.8
    })
  }

  // Check assumptions with high impact_if_wrong
  for (const assumption of assumptions) {
    if (assumption.impact_if_wrong === 'critical' || assumption.impact_if_wrong === 'high') {
      // Check if not already covered by other detections
      const alreadyCovered = mustConfirm.some(item =>
        item.description.toLowerCase().includes(assumption.description.toLowerCase().slice(0, 20))
      )

      if (!alreadyCovered) {
        mustConfirm.push({
          id: `layer5_high_impact_${assumption.id}`,
          layer: 5,
          type: 'business_risk',
          title: 'High-Impact Assumption',
          description: `"${assumption.description}" - This assumption has ${assumption.impact_if_wrong} impact if incorrect.`,
          options: [
            {
              id: 'impact_confirmed',
              label: 'This is correct',
              description: 'Proceed with this assumption',
              impact: `If wrong: ${assumption.impact_if_wrong} impact`
            },
            {
              id: 'impact_verify',
              label: 'Let me verify first',
              description: 'I need to double-check this before proceeding'
            },
            {
              id: 'impact_skip',
              label: 'Skip this assumption',
              description: 'Remove this from the workflow'
            }
          ],
          source_assumption_id: assumption.id
        })
      }
    }
  }

  // If no risks detected, mark as good
  if (mustConfirm.length === 0 && shouldReview.length === 0) {
    looksGood.push({
      id: 'layer5_no_risks',
      assumption: 'No high-risk operations detected',
      confidence: 0.9,
      validated_by: 'risk_analysis'
    })
  }

  return {
    layer: 5,
    must_confirm: mustConfirm,
    should_review: shouldReview,
    looks_good: looksGood
  }
}
