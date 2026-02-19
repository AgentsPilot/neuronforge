/**
 * Requirements Grounding Validator
 *
 * Validates that Hard Requirements from Phase 0 are preserved in the Semantic Plan.
 * This runs AFTER semantic plan generation and BEFORE IR formalization.
 *
 * Purpose: Ensure no requirements are lost between Enhanced Prompt → Semantic Plan
 */

import type { HardRequirements } from './HardRequirementsExtractor'
import type { SemanticPlan } from '../semantic-plan/schemas/semantic-plan-types'

export interface RequirementsValidationResult {
  valid: boolean
  score: number  // 0-100, percentage of requirements preserved
  preserved_requirements: string[]  // Requirement IDs that are preserved
  missing_requirements: string[]    // Requirement IDs that are missing
  details: Array<{
    requirementId: string
    type: string
    constraint: string
    preserved: boolean
    semanticMapping: string | null
    evidence: string
  }>
}

export class RequirementsGroundingValidator {
  /**
   * Validate that all Hard Requirements are preserved in Semantic Plan
   */
  validate(
    hardRequirements: HardRequirements,
    semanticPlan: SemanticPlan
  ): RequirementsValidationResult {
    const details: RequirementsValidationResult['details'] = []
    const preserved: string[] = []
    const missing: string[] = []

    // Check each requirement
    hardRequirements.requirements.forEach(req => {
      const result = this.checkRequirement(req, semanticPlan, hardRequirements)

      details.push({
        requirementId: req.id,
        type: req.type,
        constraint: req.constraint,
        preserved: result.preserved,
        semanticMapping: result.mapping,
        evidence: result.evidence
      })

      if (result.preserved) {
        preserved.push(req.id)
      } else {
        missing.push(req.id)
      }
    })

    const totalReqs = hardRequirements.requirements.length
    const preservedCount = preserved.length
    const score = totalReqs > 0 ? Math.round((preservedCount / totalReqs) * 100) : 100

    return {
      valid: score >= 80, // Require 80% preservation to pass
      score,
      preserved_requirements: preserved,
      missing_requirements: missing,
      details
    }
  }

  /**
   * Check if a single requirement is preserved in the semantic plan
   */
  private checkRequirement(
    req: { id: string; type: string; constraint: string },
    plan: SemanticPlan,
    hardReqs: HardRequirements
  ): { preserved: boolean; mapping: string | null; evidence: string } {
    const planJson = JSON.stringify(plan).toLowerCase()

    switch (req.type) {
      case 'unit_of_work': {
        // Check if unit of work is referenced in data sources
        if (hardReqs.unit_of_work === 'attachment' && (planJson.includes('attachment') || planJson.includes('pdf'))) {
          return {
            preserved: true,
            mapping: 'understanding.data_sources',
            evidence: 'Unit of work (attachment) found in data sources description'
          }
        } else if (hardReqs.unit_of_work === 'email' && planJson.includes('email')) {
          return {
            preserved: true,
            mapping: 'understanding.data_sources',
            evidence: 'Unit of work (email) found in data sources'
          }
        } else if (hardReqs.unit_of_work === 'row' && planJson.includes('row')) {
          return {
            preserved: true,
            mapping: 'understanding.data_sources',
            evidence: 'Unit of work (row) found in data sources'
          }
        }
        return {
          preserved: false,
          mapping: null,
          evidence: `Unit of work ${hardReqs.unit_of_work} not found in semantic plan`
        }
      }

      case 'threshold': {
        // Check if threshold is captured in conditional operations or filtering
        const thresholds = hardReqs.thresholds
        if (thresholds.length === 0) {
          return { preserved: true, mapping: null, evidence: 'No thresholds to validate' }
        }

        const threshold = thresholds[0] // Assume first threshold for now
        const hasThreshold = planJson.includes(threshold.field.toLowerCase()) &&
                           (planJson.includes(String(threshold.value)) ||
                            planJson.includes('threshold') ||
                            planJson.includes('greater') ||
                            planJson.includes('conditional'))

        if (hasThreshold) {
          return {
            preserved: true,
            mapping: 'understanding.conditional_operations or filtering',
            evidence: `Threshold ${threshold.field}>${threshold.value} found in conditional operations or filtering`
          }
        }
        return {
          preserved: false,
          mapping: null,
          evidence: `Threshold ${threshold.field}>${threshold.value} not found in semantic plan`
        }
      }

      case 'invariant': {
        // Check if invariants are preserved
        if (req.constraint.includes('sequential')) {
          // Check for trigger markers in file_operations
          if (plan.understanding.file_operations) {
            const hasTriggers = plan.understanding.file_operations.some((op: any) => op.trigger)
            if (hasTriggers) {
              return {
                preserved: true,
                mapping: 'understanding.file_operations[].trigger',
                evidence: 'Sequential dependency markers found in file_operations'
              }
            }
          }
          return {
            preserved: false,
            mapping: null,
            evidence: 'Sequential dependency markers not found in file_operations'
          }
        } else if (req.constraint.includes('data availability')) {
          // Check if processing_steps exist
          if (plan.processing_steps && plan.processing_steps.length > 0) {
            return {
              preserved: true,
              mapping: 'processing_steps',
              evidence: 'Processing steps preserved (implies data availability)'
            }
          }
          return {
            preserved: false,
            mapping: null,
            evidence: 'Processing steps not preserved'
          }
        }
        return {
          preserved: false,
          mapping: null,
          evidence: 'Invariant type not recognized'
        }
      }

      case 'required_output': {
        // Check if required output field is in rendering
        const match = req.constraint.match(/output\.includes\('([^']+)'\)/)
        if (!match) {
          return { preserved: false, mapping: null, evidence: 'Could not parse output field' }
        }

        const outputField = match[1]
        const hasOutput = plan.understanding.rendering?.columns_to_include?.some((col: any) =>
          typeof col === 'string' && col.toLowerCase().includes(outputField.toLowerCase())
        ) || planJson.includes(outputField.toLowerCase())

        if (hasOutput) {
          return {
            preserved: true,
            mapping: 'understanding.rendering.columns_to_include',
            evidence: `Output field ${outputField} found in rendering columns`
          }
        }
        return {
          preserved: false,
          mapping: null,
          evidence: `Output field ${outputField} not found in rendering`
        }
      }

      case 'side_effect_constraint': {
        // Check if conditional logic is captured
        if (planJson.includes('conditional') || planJson.includes('if ') || planJson.includes('when ')) {
          return {
            preserved: true,
            mapping: 'understanding.conditional_operations',
            evidence: 'Conditional logic found in semantic plan'
          }
        }
        return {
          preserved: false,
          mapping: null,
          evidence: 'Conditional logic not found in semantic plan'
        }
      }

      case 'routing_rule': {
        // Check if routing rules are in conditional operations or partitions
        const rules = hardReqs.routing_rules
        if (rules.length === 0) {
          return { preserved: true, mapping: null, evidence: 'No routing rules to validate' }
        }

        const hasRouting = planJson.includes('route') || planJson.includes('partition') || planJson.includes('group')
        if (hasRouting) {
          return {
            preserved: true,
            mapping: 'understanding.grouping or conditional_operations',
            evidence: 'Routing logic found in semantic plan'
          }
        }
        return {
          preserved: false,
          mapping: null,
          evidence: 'Routing logic not found in semantic plan'
        }
      }

      case 'empty_behavior': {
        // Check if empty state handling is captured
        if (plan.understanding.rendering?.empty_state_message || planJson.includes('empty') || planJson.includes('no results')) {
          return {
            preserved: true,
            mapping: 'understanding.rendering.empty_state_message',
            evidence: 'Empty state handling found'
          }
        }
        return {
          preserved: false,
          mapping: null,
          evidence: 'Empty state handling not found'
        }
      }

      default:
        return {
          preserved: false,
          mapping: null,
          evidence: `Unknown requirement type: ${req.type}`
        }
    }
  }
}
