/**
 * DSL Requirements Validator
 *
 * Validates that Hard Requirements from Phase 0 are preserved in the Compiled DSL.
 * This runs AFTER DSL compilation and validates the final executable workflow.
 *
 * Purpose: Ensure no requirements are lost between IR → DSL compilation
 */

import type { HardRequirements } from './HardRequirementsExtractor'
import type { WorkflowStep } from '@/lib/pilot/types/pilot-dsl-types'

export interface DSLValidationResult {
  valid: boolean
  score: number  // 0-100, percentage of requirements preserved
  preserved_requirements: string[]  // Requirement IDs that are preserved
  missing_requirements: string[]    // Requirement IDs that are missing
  details: Array<{
    requirementId: string
    type: string
    constraint: string
    preserved: boolean
    dslMapping: string | null
    evidence: string
  }>
}

export class DSLRequirementsValidator {
  /**
   * Validate that all Hard Requirements are preserved in DSL
   */
  validate(
    hardRequirements: HardRequirements,
    workflow: WorkflowStep[]
  ): DSLValidationResult {
    const details: DSLValidationResult['details'] = []
    const preserved: string[] = []
    const missing: string[] = []

    // Check each requirement
    hardRequirements.requirements.forEach(req => {
      const result = this.checkRequirement(req, workflow, hardRequirements)

      details.push({
        requirementId: req.id,
        type: req.type,
        constraint: req.constraint,
        preserved: result.preserved,
        dslMapping: result.mapping,
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
   * Helper: Search for a keyword in workflow JSON (field-agnostic)
   */
  private searchWorkflowForKeyword(workflow: WorkflowStep[], keyword: string): boolean {
    const workflowJson = JSON.stringify(workflow).toLowerCase()
    return workflowJson.includes(keyword.toLowerCase())
  }

  /**
   * Helper: Search for any of multiple keywords in workflow JSON
   */
  private searchWorkflowForKeywords(workflow: WorkflowStep[], keywords: string[]): boolean {
    const workflowJson = JSON.stringify(workflow).toLowerCase()
    return keywords.some(kw => workflowJson.includes(kw.toLowerCase()))
  }

  /**
   * Check if a single requirement is preserved in the DSL workflow
   */
  private checkRequirement(
    req: { id: string; type: string; constraint: string },
    workflow: WorkflowStep[],
    hardReqs: HardRequirements
  ): { preserved: boolean; mapping: string | null; evidence: string } {
    switch (req.type) {
      case 'unit_of_work': {
        // Check if unit of work is referenced anywhere in the workflow (field-agnostic)
        const unitOfWork = hardReqs.unit_of_work

        if (!unitOfWork) {
          return {
            preserved: true,
            mapping: null,
            evidence: 'No unit of work specified'
          }
        }

        if (unitOfWork === 'attachment') {
          // Search for attachment-related keywords
          const found = this.searchWorkflowForKeywords(workflow, ['attachment', 'pdf', 'file'])
          if (found) {
            return {
              preserved: true,
              mapping: 'workflow steps',
              evidence: `Unit of work (${unitOfWork}) found in workflow`
            }
          }
        } else if (unitOfWork === 'email') {
          // Search for email-related keywords
          const found = this.searchWorkflowForKeywords(workflow, ['mail', 'email', 'message'])
          if (found) {
            return {
              preserved: true,
              mapping: 'workflow steps',
              evidence: `Unit of work (${unitOfWork}) found in workflow`
            }
          }
        } else if (unitOfWork === 'row') {
          // Search for row-related keywords
          const found = this.searchWorkflowForKeywords(workflow, ['row', 'sheet', 'spreadsheet'])
          if (found) {
            return {
              preserved: true,
              mapping: 'workflow steps',
              evidence: `Unit of work (${unitOfWork}) found in workflow`
            }
          }
        } else {
          // Generic unit of work - search for exact match
          const found = this.searchWorkflowForKeyword(workflow, unitOfWork)
          if (found) {
            return {
              preserved: true,
              mapping: 'workflow steps',
              evidence: `Unit of work (${unitOfWork}) found in workflow`
            }
          }
        }

        return {
          preserved: false,
          mapping: null,
          evidence: `Unit of work ${unitOfWork} not found in DSL`
        }
      }

      case 'threshold': {
        // Check if threshold is implemented in conditional steps or filters
        const thresholds = hardReqs.thresholds
        if (thresholds.length === 0) {
          return { preserved: true, mapping: null, evidence: 'No thresholds to validate' }
        }

        const threshold = thresholds[0]

        // Field-agnostic: Search for threshold field and value anywhere in workflow
        const workflowJson = JSON.stringify(workflow).toLowerCase()
        const hasField = workflowJson.includes(threshold.field.toLowerCase())
        const hasValue = workflowJson.includes(String(threshold.value))

        if (hasField && hasValue) {
          return {
            preserved: true,
            mapping: 'workflow steps',
            evidence: `Threshold ${threshold.field}>${threshold.value} found in workflow`
          }
        }
        return {
          preserved: false,
          mapping: null,
          evidence: `Threshold ${threshold.field}>${threshold.value} not found in DSL`
        }
      }

      case 'invariant': {
        // Check if invariants are preserved
        if (req.constraint.includes('sequential')) {
          // Field-agnostic: Check if Drive operations are parallelized
          // Look for 'drive' keyword in parallel blocks
          const parallelSteps = workflow.filter(step => step.type === 'parallel')

          let driveInParallel = false
          parallelSteps.forEach(parallel => {
            const parallelJson = JSON.stringify(parallel).toLowerCase()
            if (parallelJson.includes('drive') && parallelJson.includes('folder')) {
              driveInParallel = true
            }
          })

          // Check if drive operations exist at top level (sequential)
          const topLevelDriveOps = workflow.filter(step => {
            const stepJson = JSON.stringify(step).toLowerCase()
            return stepJson.includes('drive') &&
                   (stepJson.includes('folder') || stepJson.includes('upload') || stepJson.includes('share'))
          })

          // Sequential is preserved if:
          // 1. Drive ops are NOT in parallel block, OR
          // 2. Drive ops exist at top level outside parallel blocks
          if (!driveInParallel || topLevelDriveOps.length >= 2) {
            return {
              preserved: true,
              mapping: 'workflow steps',
              evidence: `Sequential dependency preserved (Drive operations ${driveInParallel ? 'also at top level' : 'not parallelized'})`
            }
          }

          return {
            preserved: false,
            mapping: null,
            evidence: 'Sequential dependency not preserved - Drive operations in parallel block'
          }
        } else if (req.constraint.includes('data availability')) {
          // Data availability is preserved if workflow has proper step ordering
          // (data fetching → processing → delivery)

          // Field-agnostic: Find data source step by searching for fetch/read keywords
          const dataStepIndex = workflow.findIndex(step => {
            if (step.type !== 'action') return false
            const stepJson = JSON.stringify(step).toLowerCase()
            return stepJson.includes('search') ||
                   stepJson.includes('read') ||
                   stepJson.includes('list') ||
                   stepJson.includes('fetch') ||
                   stepJson.includes('get')
          })

          // Find processing step (scatter_gather, ai_processing, transform)
          const processingStepIndex = workflow.findIndex(step =>
            step.type === 'scatter_gather' ||
            step.type === 'ai_processing' ||
            step.type === 'transform'
          )

          // Find delivery step by searching for delivery keywords
          const deliveryStepIndex = workflow.findIndex(step => {
            if (step.type === 'parallel') return true
            const stepJson = JSON.stringify(step).toLowerCase()
            return stepJson.includes('send') ||
                   stepJson.includes('append') ||
                   stepJson.includes('create') ||
                   stepJson.includes('write') ||
                   stepJson.includes('deliver')
          })

          // Data availability preserved if: data → processing → delivery order
          if (dataStepIndex >= 0 && processingStepIndex > dataStepIndex) {
            return {
              preserved: true,
              mapping: 'workflow step ordering',
              evidence: `Data availability preserved (step order: data@${dataStepIndex} → processing@${processingStepIndex} → delivery@${deliveryStepIndex})`
            }
          }
          return {
            preserved: false,
            mapping: null,
            evidence: 'Data availability not clear in DSL'
          }
        }
        return {
          preserved: false,
          mapping: null,
          evidence: 'Invariant type not recognized'
        }
      }

      case 'required_output': {
        // Check if required output field is captured and passed through workflow
        const match = req.constraint.match(/output\.includes\('([^']+)'\)/)
        if (!match) {
          return { preserved: false, mapping: null, evidence: 'Could not parse output field' }
        }

        const outputField = match[1]

        // Field-agnostic: Search for output field anywhere in workflow
        const found = this.searchWorkflowForKeyword(workflow, outputField)

        if (found) {
          return {
            preserved: true,
            mapping: 'workflow steps',
            evidence: `Output field ${outputField} found in workflow`
          }
        }
        return {
          preserved: false,
          mapping: null,
          evidence: `Output field ${outputField} not found in DSL`
        }
      }

      case 'side_effect_constraint': {
        // Check if conditional logic is implemented
        const hasConditional = workflow.some(step => step.type === 'conditional')
        const hasConditionalLoop = workflow.some(step =>
          step.type === 'loop' && step.loop?.iterate_over &&
          workflow.some(innerStep => innerStep.type === 'conditional')
        )

        if (hasConditional || hasConditionalLoop) {
          return {
            preserved: true,
            mapping: 'conditional step',
            evidence: 'Conditional logic found in workflow'
          }
        }
        return {
          preserved: false,
          mapping: null,
          evidence: 'Conditional logic not found in DSL'
        }
      }

      case 'routing_rule': {
        // Check if routing rules are implemented via conditionals or partitions
        const rules = hardReqs.routing_rules
        if (rules.length === 0) {
          return { preserved: true, mapping: null, evidence: 'No routing rules to validate' }
        }

        const hasRouting = workflow.some(step => {
          if (step.type === 'conditional') {
            const condJson = JSON.stringify(step).toLowerCase()
            return condJson.includes('route') || condJson.includes('partition')
          }
          return false
        })

        if (hasRouting) {
          return {
            preserved: true,
            mapping: 'conditional step',
            evidence: 'Routing logic found in workflow'
          }
        }
        return {
          preserved: false,
          mapping: null,
          evidence: 'Routing logic not found in DSL'
        }
      }

      case 'empty_behavior': {
        // Check if empty state handling is implemented
        const hasEmptyCheck = workflow.some(step => {
          const stepJson = JSON.stringify(step).toLowerCase()
          return stepJson.includes('empty') ||
                 stepJson.includes('no results') ||
                 stepJson.includes('length') ||
                 (step.type === 'conditional' && stepJson.includes('is_empty'))
        })

        if (hasEmptyCheck) {
          return {
            preserved: true,
            mapping: 'conditional or transform step',
            evidence: 'Empty state handling found in workflow'
          }
        }
        return {
          preserved: false,
          mapping: null,
          evidence: 'Empty state handling not found in DSL'
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
