/**
 * Subset Reference Resolver
 *
 * Implements aggregate subset auto-promotion invariant:
 * - When AggregateStep produces subset outputs, each subset becomes a global RefName
 * - Subsets are accessible to downstream steps without going through parent output
 * - Validates that subset refs are only used after the aggregate step that defines them
 * - Validates subset condition item context convention (ref must match aggregate.input)
 *
 * This is a COMPILER INVARIANT, not a prompt fix.
 */

import type { IntentContract, IntentStep as Step, AggregateStep, RefName, Condition } from '../semantic-plan/types/intent-schema-types'
import { createLogger } from '@/lib/logger'

const logger = createLogger({ module: 'SubsetRefResolver', service: 'V6' })

export interface SubsetDefinition {
  name: string // subset name
  definedBy: string // step ID that defines it
  stepIndex: number // index in steps array
}

export interface SubsetResolutionResult {
  success: boolean
  subsets: Map<string, SubsetDefinition> // subset name → definition
  errors: string[]
  warnings: string[]
}

/**
 * Resolves subset references from aggregate steps
 */
export class SubsetRefResolver {
  /**
   * Analyze intent contract and extract all subset definitions
   */
  resolve(intent: IntentContract): SubsetResolutionResult {
    const subsets = new Map<string, SubsetDefinition>()
    const errors: string[] = []
    const warnings: string[] = []

    // Phase 1: Extract all subset definitions
    this.extractSubsets(intent.steps, subsets, errors)

    // Phase 2: Validate subset usage (must be used after definition)
    this.validateSubsetUsage(intent.steps, subsets, errors)

    // Phase 3: Validate subset condition item context
    this.validateSubsetItemContext(intent.steps, errors, warnings)

    logger.info(
      { subsetCount: subsets.size, errorCount: errors.length },
      '[SubsetRefResolver] Subset resolution complete'
    )

    return {
      success: errors.length === 0,
      subsets,
      errors,
      warnings,
    }
  }

  /**
   * Phase 1: Extract all subset outputs from aggregate steps
   */
  private extractSubsets(
    steps: Step[],
    subsets: Map<string, SubsetDefinition>,
    errors: string[],
    stepIndexOffset = 0
  ): void {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      const globalIndex = stepIndexOffset + i

      // Check if this is an aggregate step
      if (step.kind === 'aggregate') {
        const aggregateStep = step as AggregateStep
        const outputs = aggregateStep.aggregate.outputs

        for (const output of outputs) {
          if (output.type === 'subset') {
            const subsetName = output.name

            // Check for duplicates
            if (subsets.has(subsetName)) {
              const existing = subsets.get(subsetName)!
              errors.push(
                `Duplicate subset name "${subsetName}": defined by both "${existing.definedBy}" and "${step.id}"`
              )
            } else {
              // Register subset as global RefName
              subsets.set(subsetName, {
                name: subsetName,
                definedBy: step.id,
                stepIndex: globalIndex,
              })

              logger.debug(
                { subset: subsetName, definedBy: step.id },
                '[SubsetRefResolver] Registered subset as global RefName'
              )
            }
          }
        }
      }

      // Recursively process nested steps (loops, decisions, parallel branches)
      if (step.kind === 'loop' && (step as any).loop?.do) {
        this.extractSubsets((step as any).loop.do, subsets, errors, globalIndex)
      }

      if (step.kind === 'decide') {
        if ((step as any).decide?.then) {
          this.extractSubsets((step as any).decide.then, subsets, errors, globalIndex)
        }
        if ((step as any).decide?.else) {
          this.extractSubsets((step as any).decide.else, subsets, errors, globalIndex)
        }
      }

      if (step.kind === 'parallel' && (step as any).parallel?.branches) {
        for (const branch of (step as any).parallel.branches) {
          if (branch.steps) {
            this.extractSubsets(branch.steps, subsets, errors, globalIndex)
          }
        }
      }
    }
  }

  /**
   * Phase 2: Validate that subset refs are only used after definition
   */
  private validateSubsetUsage(
    steps: Step[],
    subsets: Map<string, SubsetDefinition>,
    errors: string[],
    stepIndexOffset = 0
  ): void {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      const globalIndex = stepIndexOffset + i

      // Extract all input refs from this step
      const inputRefs = this.extractInputRefs(step)

      for (const ref of inputRefs) {
        // Check if this ref is a subset
        if (subsets.has(ref)) {
          const subset = subsets.get(ref)!

          // Special case: If this step is the one that defines the subset,
          // allow references within the same aggregate (for "of" field in outputs)
          if (subset.definedBy === step.id && subset.stepIndex === globalIndex) {
            // Same step - this is OK (e.g., count of subset defined in same aggregate)
            continue
          }

          // Validate that subset is defined before this step
          if (subset.stepIndex >= globalIndex) {
            errors.push(
              `Step "${step.id}" (index ${globalIndex}) references subset "${ref}" before it is defined by "${subset.definedBy}" (index ${subset.stepIndex})`
            )
          }
        }
      }

      // Recursively validate nested steps
      if (step.kind === 'loop' && (step as any).loop?.do) {
        this.validateSubsetUsage((step as any).loop.do, subsets, errors, globalIndex)
      }

      if (step.kind === 'decide') {
        if ((step as any).decide?.then) {
          this.validateSubsetUsage((step as any).decide.then, subsets, errors, globalIndex)
        }
        if ((step as any).decide?.else) {
          this.validateSubsetUsage((step as any).decide.else, subsets, errors, globalIndex)
        }
      }

      if (step.kind === 'parallel' && (step as any).parallel?.branches) {
        for (const branch of (step as any).parallel.branches) {
          if (branch.steps) {
            this.validateSubsetUsage(branch.steps, subsets, errors, globalIndex)
          }
        }
      }
    }
  }

  /**
   * Extract all input RefNames from a step
   */
  private extractInputRefs(step: Step): RefName[] {
    const refs: RefName[] = []

    // Extract from inputs array (present in most steps)
    if ((step as any).inputs) {
      const inputs = (step as any).inputs as RefName[]
      refs.push(...inputs)
    }

    // Extract from specific step configurations
    switch (step.kind) {
      case 'loop':
        if ((step as any).loop?.over) {
          refs.push((step as any).loop.over)
        }
        break

      case 'aggregate':
        if ((step as any).aggregate?.input) {
          refs.push((step as any).aggregate.input)
        }
        // Also check if aggregate outputs reference other collections via "of"
        if ((step as any).aggregate?.outputs) {
          for (const output of (step as any).aggregate.outputs) {
            if (output.of) {
              refs.push(output.of)
            }
          }
        }
        break

      case 'transform':
        if ((step as any).transform?.input) {
          refs.push((step as any).transform.input)
        }
        break

      case 'deliver':
        if ((step as any).deliver?.input) {
          refs.push((step as any).deliver.input)
        }
        if ((step as any).deliver?.destination) {
          refs.push((step as any).deliver.destination)
        }
        break

      case 'extract':
        if ((step as any).extract?.input) {
          refs.push((step as any).extract.input)
        }
        break

      case 'generate':
        // Generate steps use inputs array (already handled above)
        break

      case 'decide':
        // Decide steps may reference variables in conditions
        // For now, we don't validate condition refs deeply (would need AST traversal)
        break
    }

    return refs
  }

  /**
   * Phase 3: Validate subset condition item context
   *
   * Convention: In subset where-conditions, {ref: <aggregate.input>} means "current item"
   * The condition is evaluated per-item to determine subset membership.
   */
  private validateSubsetItemContext(
    steps: Step[],
    errors: string[],
    warnings: string[]
  ): void {
    for (const step of steps) {
      if (step.kind === 'aggregate') {
        const aggregateStep = step as AggregateStep
        const aggregateInput = aggregateStep.aggregate.input

        for (const output of aggregateStep.aggregate.outputs) {
          if (output.type === 'subset' && (output as any).where) {
            const condition = (output as any).where as Condition
            const conditionRefs = this.extractConditionRefs(condition)

            // Validate that condition refs follow the convention
            for (const ref of conditionRefs) {
              if (ref !== aggregateInput) {
                warnings.push(
                  `Step "${step.id}" subset "${output.name}": condition references "${ref}" but aggregate input is "${aggregateInput}". ` +
                  `Convention: use {ref: "${aggregateInput}"} to reference current item being evaluated.`
                )
              }
            }
          }
        }
      }

      // Recursively process nested steps
      if (step.kind === 'loop' && (step as any).loop?.do) {
        this.validateSubsetItemContext((step as any).loop.do, errors, warnings)
      }

      if (step.kind === 'decide') {
        if ((step as any).decide?.then) {
          this.validateSubsetItemContext((step as any).decide.then, errors, warnings)
        }
        if ((step as any).decide?.else) {
          this.validateSubsetItemContext((step as any).decide.else, errors, warnings)
        }
      }

      if (step.kind === 'parallel' && (step as any).parallel?.branches) {
        for (const branch of (step as any).parallel.branches) {
          if (branch.steps) {
            this.validateSubsetItemContext(branch.steps, errors, warnings)
          }
        }
      }
    }
  }

  /**
   * Extract all RefNames from a condition AST
   */
  private extractConditionRefs(condition: Condition): RefName[] {
    const refs: RefName[] = []

    if ((condition as any).op === 'and' || (condition as any).op === 'or') {
      // Complex condition with multiple sub-conditions
      const conditions = (condition as any).conditions as Condition[]
      for (const subCondition of conditions) {
        refs.push(...this.extractConditionRefs(subCondition))
      }
    } else if ((condition as any).op === 'not') {
      // Not condition with single sub-condition
      const subCondition = (condition as any).condition as Condition
      refs.push(...this.extractConditionRefs(subCondition))
    } else if ((condition as any).op === 'test') {
      // Test condition with left/right operands
      const left = (condition as any).left
      const right = (condition as any).right

      if (left?.kind === 'ref' && left.ref) {
        refs.push(left.ref)
      }

      if (right?.kind === 'ref' && right.ref) {
        refs.push(right.ref)
      }
    }

    return refs
  }
}
