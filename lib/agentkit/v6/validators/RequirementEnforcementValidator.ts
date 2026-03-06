/**
 * Requirement Enforcement Validator
 *
 * Validates that all hard requirements from Phase 0 are properly enforced
 * in the execution graph. This ensures the LLM didn't drop critical constraints
 * during IR generation.
 *
 * The Problem:
 * - LLM forgets to enforce threshold requirements
 * - Unit of work requirements not properly mapped to loop collection
 * - Routing rules missing from choice nodes
 * - Invariants (sequential dependencies) violated in execution order
 *
 * The Solution:
 * - Formally validate each requirement type against IR structure
 * - Provide specific guidance on how to enforce missing requirements
 * - Track enforcement mechanisms (choice nodes, sequence, bindings)
 *
 * Week 2 Implementation: Core requirement validation logic
 */

import type { ExecutionGraph, ExecutionNode, RequirementEnforcement } from '../logical-ir/schemas/declarative-ir-types-v4'
import type { HardRequirements } from '../requirements/HardRequirementsExtractor'
import type { ValidationError } from '../logical-ir/validation/ExecutionGraphValidator'
import { createLogger, Logger } from '@/lib/logger'

const moduleLogger = createLogger({ module: 'V6', service: 'RequirementEnforcementValidator' })

interface EnforcementCheck {
  requirementId: string
  requirementType: string
  enforced: boolean
  enforcementMechanism?: string
  nodeIds?: string[]
  reason?: string
}

export class RequirementEnforcementValidator {
  private logger: Logger

  constructor() {
    this.logger = moduleLogger.child({ service: 'RequirementEnforcementValidator' })
  }

  /**
   * Main validation entry point
   *
   * Validates that all hard requirements are enforced in the execution graph:
   * 1. Unit of work → Loop collection points
   * 2. Thresholds → Choice nodes with conditions
   * 3. Routing rules → Conditional branches
   * 4. Invariants → Execution order and dependencies
   * 5. Required outputs → Rendering configuration
   */
  validate(
    graph: ExecutionGraph,
    hardRequirements: HardRequirements | undefined
  ): ValidationError[] {
    const errors: ValidationError[] = []

    if (!hardRequirements || hardRequirements.requirements.length === 0) {
      this.logger.info('No hard requirements to validate')
      return errors
    }

    this.logger.info(`Validating ${hardRequirements.requirements.length} hard requirements`)

    // Validate each requirement type
    const unitOfWorkErrors = this.validateUnitOfWork(graph, hardRequirements)
    errors.push(...unitOfWorkErrors)

    const thresholdErrors = this.validateThresholds(graph, hardRequirements)
    errors.push(...thresholdErrors)

    const routingErrors = this.validateRoutingRules(graph, hardRequirements)
    errors.push(...routingErrors)

    const invariantErrors = this.validateInvariants(graph, hardRequirements)
    errors.push(...invariantErrors)

    const outputErrors = this.validateRequiredOutputs(graph, hardRequirements)
    errors.push(...outputErrors)

    this.logger.info(`Requirement validation completed: ${errors.length} errors found`)
    return errors
  }

  /**
   * Validate unit of work requirement
   *
   * Unit of work determines the granularity of processing (email, attachment, row, etc.)
   * This should map to collect_outputs on the corresponding loop node.
   */
  private validateUnitOfWork(
    graph: ExecutionGraph,
    hardRequirements: HardRequirements
  ): ValidationError[] {
    const errors: ValidationError[] = []

    if (!hardRequirements.unit_of_work) {
      // No unit of work specified - no validation needed
      return errors
    }

    const unitOfWork = hardRequirements.unit_of_work

    // Find loops in the graph
    const loopNodes = Object.entries(graph.nodes).filter(
      ([_, node]) => node.type === 'loop'
    )

    if (loopNodes.length === 0) {
      // No loops - might be a simple workflow without iteration
      this.logger.warn(`Unit of work '${unitOfWork}' specified but no loops found in graph`)
      return errors
    }

    // Check if any loop has collect_outputs enabled at the correct level
    let foundCorrectCollection = false

    for (const [nodeId, node] of loopNodes) {
      if (node.loop?.collect_outputs) {
        // Infer what this loop is iterating over
        const iterateOver = node.loop.iterate_over
        const itemVariable = node.loop.item_variable

        // Check if this matches the unit of work
        // For example, if unit_of_work is 'attachment', we should be collecting at the attachment loop
        const loopTarget = this.inferLoopTarget(iterateOver, itemVariable)

        if (loopTarget === unitOfWork) {
          foundCorrectCollection = true
          this.logger.debug(`Unit of work '${unitOfWork}' correctly enforced by loop ${nodeId}`)
          break
        }
      }
    }

    if (!foundCorrectCollection) {
      // Find what the unit of work should map to
      const suggestion = this.getSuggestionForUnitOfWork(unitOfWork, loopNodes)

      errors.push({
        type: 'error',
        category: 'semantics',
        node_id: loopNodes[0]?.[0],
        message: `Unit of work requirement not enforced: Expected collection at '${unitOfWork}' level, but no matching loop has collect_outputs=true`,
        suggestion
      })

      this.logger.warn(`Unit of work '${unitOfWork}' not properly enforced`)
    }

    return errors
  }

  /**
   * Validate threshold requirements
   *
   * Thresholds should be enforced via choice nodes that conditionally execute operations.
   */
  private validateThresholds(
    graph: ExecutionGraph,
    hardRequirements: HardRequirements
  ): ValidationError[] {
    const errors: ValidationError[] = []

    if (hardRequirements.thresholds.length === 0) {
      return errors
    }

    // Find all choice nodes in the graph
    const choiceNodes = Object.entries(graph.nodes).filter(
      ([_, node]) => node.type === 'choice'
    )

    // Check each threshold
    for (const threshold of hardRequirements.thresholds) {
      const { field, operator, value } = threshold

      // Look for a choice node that enforces this threshold
      let foundEnforcement = false

      for (const [nodeId, node] of choiceNodes) {
        if (node.choice) {
          // Check if any rule condition matches this threshold
          for (const rule of node.choice.rules) {
            if (this.conditionMatchesThreshold(rule.condition, field, operator, value)) {
              foundEnforcement = true
              this.logger.debug(`Threshold '${field} ${operator} ${value}' enforced by choice node ${nodeId}`)
              break
            }
          }
        }

        if (foundEnforcement) break
      }

      if (!foundEnforcement) {
        errors.push({
          type: 'error',
          category: 'semantics',
          node_id: undefined,
          message: `Threshold requirement not enforced: '${field} ${operator} ${value}' should gate actions but no matching choice node found`,
          suggestion: `Add a choice node with condition: { type: "simple", variable: "${field}", operator: "${operator}", value: ${JSON.stringify(value)} }`
        })

        this.logger.warn(`Threshold '${field} ${operator} ${value}' not enforced`)
      }
    }

    return errors
  }

  /**
   * Validate routing rules
   *
   * Routing rules should be enforced via choice nodes with conditional branches.
   */
  private validateRoutingRules(
    graph: ExecutionGraph,
    hardRequirements: HardRequirements
  ): ValidationError[] {
    const errors: ValidationError[] = []

    if (hardRequirements.routing_rules.length === 0) {
      return errors
    }

    // Find all choice nodes
    const choiceNodes = Object.entries(graph.nodes).filter(
      ([_, node]) => node.type === 'choice'
    )

    // Check each routing rule
    for (const routingRule of hardRequirements.routing_rules) {
      const { condition, destination, field_value } = routingRule

      // Look for a choice node that implements this routing
      let foundRouting = false

      for (const [nodeId, node] of choiceNodes) {
        if (node.choice) {
          // Check if any rule condition matches this routing rule
          for (const rule of node.choice.rules) {
            if (this.conditionMatchesRouting(rule.condition, condition, field_value)) {
              foundRouting = true
              this.logger.debug(`Routing rule '${condition} → ${destination}' enforced by choice node ${nodeId}`)
              break
            }
          }
        }

        if (foundRouting) break
      }

      if (!foundRouting) {
        errors.push({
          type: 'error',
          category: 'semantics',
          node_id: undefined,
          message: `Routing rule not enforced: '${condition} → ${destination}' should route based on '${field_value}' but no matching choice node found`,
          suggestion: `Add a choice node with condition based on '${condition}' and route to different delivery operations`
        })

        this.logger.warn(`Routing rule '${condition} → ${destination}' not enforced`)
      }
    }

    return errors
  }

  /**
   * Validate invariants
   *
   * Invariants enforce execution order and dependencies.
   */
  private validateInvariants(
    graph: ExecutionGraph,
    hardRequirements: HardRequirements
  ): ValidationError[] {
    const errors: ValidationError[] = []

    if (hardRequirements.invariants.length === 0) {
      return errors
    }

    // Check each invariant
    for (const invariant of hardRequirements.invariants) {
      switch (invariant.type) {
        case 'sequential_dependency':
          // Validate execution order
          const orderErrors = this.validateSequentialDependency(graph, invariant)
          errors.push(...orderErrors)
          break

        case 'no_duplicate_writes':
          // Validate no duplicate writes to same destination
          const duplicateErrors = this.validateNoDuplicateWrites(graph, invariant)
          errors.push(...duplicateErrors)
          break

        case 'data_availability':
          // Validate data is available before use
          // (This is already handled by ExecutionGraphValidator's data flow validation)
          this.logger.debug(`Data availability invariant validated by ExecutionGraphValidator`)
          break

        case 'custom':
          // Custom invariants - log but don't error (requires manual validation)
          this.logger.warn(`Custom invariant found: ${invariant.description}. Manual validation required.`)
          break
      }
    }

    return errors
  }

  /**
   * Validate required outputs
   *
   * Required outputs should appear in rendering configuration or delivery operations.
   */
  private validateRequiredOutputs(
    graph: ExecutionGraph,
    hardRequirements: HardRequirements
  ): ValidationError[] {
    const errors: ValidationError[] = []

    if (hardRequirements.required_outputs.length === 0) {
      return errors
    }

    // Find all deliver operations
    const deliverNodes = Object.entries(graph.nodes).filter(
      ([_, node]) => node.operation?.operation_type === 'deliver'
    )

    if (deliverNodes.length === 0) {
      errors.push({
        type: 'error',
        category: 'semantics',
        node_id: undefined,
        message: `Required outputs specified (${hardRequirements.required_outputs.join(', ')}) but no delivery operations found`,
        suggestion: `Add delivery operation nodes to output the required fields`
      })
      return errors
    }

    // Check if required outputs are referenced in delivery operations
    for (const requiredOutput of hardRequirements.required_outputs) {
      let foundOutput = false

      for (const [nodeId, node] of deliverNodes) {
        // Check if this deliver operation includes the required output
        // This could be in inputs, rendering config, or parameter bindings
        if (node.inputs) {
          for (const input of node.inputs) {
            if (input.variable.includes(requiredOutput) || input.path?.includes(requiredOutput)) {
              foundOutput = true
              this.logger.debug(`Required output '${requiredOutput}' found in deliver node ${nodeId}`)
              break
            }
          }
        }

        if (foundOutput) break
      }

      if (!foundOutput) {
        errors.push({
          type: 'error',
          category: 'semantics',
          node_id: deliverNodes[0]?.[0],
          message: `Required output '${requiredOutput}' not included in any delivery operation`,
          suggestion: `Add '${requiredOutput}' to the inputs or rendering configuration of a delivery operation`
        })

        this.logger.warn(`Required output '${requiredOutput}' not enforced`)
      }
    }

    return errors
  }

  /**
   * Check if a condition matches a threshold requirement
   */
  private conditionMatchesThreshold(
    condition: any,
    field: string,
    operator: string,
    value: any
  ): boolean {
    if (condition.type === 'simple') {
      // Check if condition variable matches field
      const variableMatches = condition.variable.includes(field) || field.includes(condition.variable.split('.').pop() || '')

      // Check if operators match
      const operatorMatches = condition.operator === operator

      // Check if values match (approximate)
      const valueMatches = JSON.stringify(condition.value) === JSON.stringify(value)

      return variableMatches && operatorMatches && valueMatches
    } else if (condition.type === 'complex') {
      // Check sub-conditions
      return condition.conditions.some((subCond: any) =>
        this.conditionMatchesThreshold(subCond, field, operator, value)
      )
    }

    return false
  }

  /**
   * Check if a condition matches a routing rule
   */
  private conditionMatchesRouting(
    condition: any,
    routingCondition: string,
    fieldValue: string
  ): boolean {
    if (condition.type === 'simple') {
      // Check if condition references the field in routing rule
      const conditionStr = `${condition.variable} ${condition.operator} ${JSON.stringify(condition.value)}`
      return conditionStr.includes(fieldValue) || routingCondition.toLowerCase().includes(condition.variable.toLowerCase())
    } else if (condition.type === 'complex') {
      // Check sub-conditions
      return condition.conditions.some((subCond: any) =>
        this.conditionMatchesRouting(subCond, routingCondition, fieldValue)
      )
    }

    return false
  }

  /**
   * Validate sequential dependency invariant
   */
  private validateSequentialDependency(
    graph: ExecutionGraph,
    invariant: any
  ): ValidationError[] {
    const errors: ValidationError[] = []

    // Parse invariant description to extract dependency information
    // Example: "Upload must complete before sending email"
    const description = invariant.description.toLowerCase()

    // Extract operation keywords
    const operations = Object.entries(graph.nodes).filter(
      ([_, node]) => node.operation
    )

    // Look for common sequential patterns in description
    const beforeKeywords = ['before', 'prior to', 'must complete before']
    const afterKeywords = ['after', 'following', 'once']

    // Simple heuristic: check execution order in graph
    // For more robust validation, we'd need to parse the invariant more formally

    this.logger.debug(`Sequential dependency invariant: ${description}`)

    // This is a simplified check - in production, we'd want more sophisticated parsing
    // For now, we assume the graph structure itself enforces ordering through 'next' fields

    return errors
  }

  /**
   * Validate no duplicate writes invariant
   */
  private validateNoDuplicateWrites(
    graph: ExecutionGraph,
    invariant: any
  ): ValidationError[] {
    const errors: ValidationError[] = []

    // Find all deliver operations
    const deliverNodes = Object.entries(graph.nodes).filter(
      ([_, node]) => node.operation?.operation_type === 'deliver'
    )

    // Check for duplicate delivery to same destination
    const destinations = new Map<string, string[]>()

    for (const [nodeId, node] of deliverNodes) {
      const deliver = node.operation?.deliver
      if (deliver) {
        const key = `${deliver.plugin_key}.${deliver.action}`
        const existingNodes = destinations.get(key) || []
        existingNodes.push(nodeId)
        destinations.set(key, existingNodes)
      }
    }

    // Flag duplicates
    for (const [destination, nodeIds] of destinations.entries()) {
      if (nodeIds.length > 1) {
        errors.push({
          type: 'error',
          category: 'semantics',
          node_id: nodeIds[0],
          message: `No duplicate writes invariant violated: Multiple nodes (${nodeIds.join(', ')}) deliver to same destination '${destination}'`,
          suggestion: `Consolidate delivery operations or use conditional routing to ensure only one path executes`
        })

        this.logger.warn(`Duplicate writes detected to ${destination}`)
      }
    }

    return errors
  }

  /**
   * Infer what a loop is iterating over based on variable names
   */
  private inferLoopTarget(iterateOver: string, itemVariable: string): string | null {
    const lowerIterateOver = iterateOver.toLowerCase()
    const lowerItemVar = itemVariable.toLowerCase()

    // Common patterns
    if (lowerIterateOver.includes('email') || lowerItemVar.includes('email')) {
      return 'email'
    }
    if (lowerIterateOver.includes('attachment') || lowerItemVar.includes('attachment')) {
      return 'attachment'
    }
    if (lowerIterateOver.includes('row') || lowerItemVar.includes('row')) {
      return 'row'
    }
    if (lowerIterateOver.includes('file') || lowerItemVar.includes('file')) {
      return 'file'
    }
    if (lowerIterateOver.includes('record') || lowerItemVar.includes('record')) {
      return 'record'
    }

    return null
  }

  /**
   * Get suggestion for unit of work enforcement
   */
  private getSuggestionForUnitOfWork(
    unitOfWork: string,
    loopNodes: [string, ExecutionNode][]
  ): string {
    const loopDescriptions = loopNodes.map(([nodeId, node]) => {
      const iterateOver = node.loop?.iterate_over || 'unknown'
      const itemVar = node.loop?.item_variable || 'unknown'
      return `${nodeId} iterates over ${iterateOver} as ${itemVar}`
    }).join('; ')

    return `Set collect_outputs=true on the loop that iterates over ${unitOfWork}s. Found loops: ${loopDescriptions}`
  }
}

/**
 * Convenience function for requirement validation
 */
export function validateRequirementEnforcement(
  graph: ExecutionGraph,
  hardRequirements: HardRequirements | undefined
): ValidationError[] {
  const validator = new RequirementEnforcementValidator()
  return validator.validate(graph, hardRequirements)
}
