/**
 * Type Consistency Validator
 *
 * Validates that operations in the execution graph receive the correct data types.
 * This prevents runtime errors caused by type mismatches between variable declarations
 * and their usage in operations.
 *
 * The Problem:
 * - LLM declares variable as "object" but uses it in map/filter (requires array)
 * - Loop iterates over non-array variable
 * - Type mismatches cause compilation or execution failures (~15% of errors)
 *
 * The Solution:
 * - Track variable types from declarations and node outputs
 * - Validate operation inputs match expected types
 * - Provide clear type error messages with suggestions
 *
 * Week 2 Implementation: Core type validation logic
 */

import type { ExecutionGraph, ExecutionNode, VariableDefinition } from '../logical-ir/schemas/declarative-ir-types-v4'
import type { ValidationError } from '../logical-ir/validation/ExecutionGraphValidator'
import { createLogger, Logger } from '@/lib/logger'

const moduleLogger = createLogger({ module: 'V6', service: 'TypeConsistencyValidator' })

type VariableType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any'

interface TypeInference {
  variable: string
  inferredType: VariableType
  sourceNodeId: string
  confidence: 'declared' | 'inferred' | 'unknown'
}

export class TypeConsistencyValidator {
  private logger: Logger
  private typeInferences: Map<string, TypeInference> = new Map()

  constructor() {
    this.logger = moduleLogger.child({ service: 'TypeConsistencyValidator' })
  }

  /**
   * Main validation entry point
   *
   * Validates type consistency across the execution graph:
   * 1. Transform operations (map, filter, reduce) receive arrays
   * 2. Loop iterations are over arrays
   * 3. Condition comparisons use appropriate types
   * 4. Variable declarations match their usage
   */
  validate(graph: ExecutionGraph): ValidationError[] {
    const errors: ValidationError[] = []

    // Step 1: Build type inference map from variable declarations
    this.buildTypeInferences(graph)

    // Step 2: Validate each node's type requirements
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      // Validate transform operations
      if (node.operation?.operation_type === 'transform' && node.operation.transform) {
        const transformErrors = this.validateTransformTypes(nodeId, node, graph)
        errors.push(...transformErrors)
      }

      // Validate loop operations
      if (node.type === 'loop' && node.loop) {
        const loopErrors = this.validateLoopTypes(nodeId, node, graph)
        errors.push(...loopErrors)
      }

      // Validate choice conditions
      if (node.type === 'choice' && node.choice) {
        const choiceErrors = this.validateChoiceTypes(nodeId, node, graph)
        errors.push(...choiceErrors)
      }

      // Validate AI operations
      if (node.operation?.operation_type === 'ai' && node.operation.ai) {
        const aiErrors = this.validateAITypes(nodeId, node, graph)
        errors.push(...aiErrors)
      }
    }

    this.logger.info(`Type validation completed: ${errors.length} errors found`)
    return errors
  }

  /**
   * Build type inference map from variable declarations and node outputs
   */
  private buildTypeInferences(graph: ExecutionGraph): void {
    this.typeInferences.clear()

    // Step 1: Infer from variable declarations
    if (graph.variables) {
      for (const variable of graph.variables) {
        this.typeInferences.set(variable.name, {
          variable: variable.name,
          inferredType: variable.type,
          sourceNodeId: 'declaration',
          confidence: 'declared'
        })

        this.logger.debug(`Inferred type for '${variable.name}': ${variable.type} (declared)`)
      }
    }

    // Step 2: Infer from node outputs
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      // Fetch operations produce objects or arrays
      if (node.operation?.operation_type === 'fetch' && node.outputs) {
        for (const output of node.outputs) {
          const varName = this.extractVariableName(output.variable)

          // Most fetch operations return arrays (e.g., search_emails, read_range)
          // Some return objects (e.g., get_user_profile)
          // Default to 'array' for fetches unless we know better
          if (!this.typeInferences.has(varName)) {
            this.typeInferences.set(varName, {
              variable: varName,
              inferredType: 'array',
              sourceNodeId: nodeId,
              confidence: 'inferred'
            })
          }
        }
      }

      // AI operations produce objects (structured extraction)
      if (node.operation?.operation_type === 'ai' && node.outputs) {
        for (const output of node.outputs) {
          const varName = this.extractVariableName(output.variable)

          if (!this.typeInferences.has(varName)) {
            this.typeInferences.set(varName, {
              variable: varName,
              inferredType: 'object',
              sourceNodeId: nodeId,
              confidence: 'inferred'
            })
          }
        }
      }

      // Transform operations preserve or transform types
      if (node.operation?.operation_type === 'transform' && node.outputs) {
        for (const output of node.outputs) {
          const varName = this.extractVariableName(output.variable)
          const transform = node.operation.transform

          if (!transform) continue

          // Infer output type based on transform type
          let outputType: VariableType = 'any'

          switch (transform.type) {
            case 'map':
            case 'filter':
            case 'sort':
              // These preserve array type
              outputType = 'array'
              break
            case 'reduce':
              // Reduce can produce any type depending on accumulator
              outputType = 'any'
              break
            case 'extract':
              // Extract produces the type of the extracted field
              outputType = 'any'
              break
          }

          if (!this.typeInferences.has(varName)) {
            this.typeInferences.set(varName, {
              variable: varName,
              inferredType: outputType,
              sourceNodeId: nodeId,
              confidence: 'inferred'
            })
          }
        }
      }

      // Loop item variables inherit element type from iterated array
      if (node.type === 'loop' && node.loop) {
        const itemVar = node.loop.item_variable

        // Item variables are typically objects (elements of an array)
        if (!this.typeInferences.has(itemVar)) {
          this.typeInferences.set(itemVar, {
            variable: itemVar,
            inferredType: 'object',
            sourceNodeId: nodeId,
            confidence: 'inferred'
          })
        }

        // Loop output variables (collected results) are arrays
        if (node.loop.output_variable && node.loop.collect_outputs) {
          const outputVar = node.loop.output_variable

          if (!this.typeInferences.has(outputVar)) {
            this.typeInferences.set(outputVar, {
              variable: outputVar,
              inferredType: 'array',
              sourceNodeId: nodeId,
              confidence: 'inferred'
            })
          }
        }
      }
    }
  }

  /**
   * Validate transform operation types
   */
  private validateTransformTypes(
    nodeId: string,
    node: ExecutionNode,
    graph: ExecutionGraph
  ): ValidationError[] {
    const errors: ValidationError[] = []
    const transform = node.operation?.transform

    if (!transform) return errors

    // Transform operations that require array input
    const arrayRequiringTransforms = ['map', 'filter', 'reduce', 'sort']

    if (arrayRequiringTransforms.includes(transform.type)) {
      // Extract input variable
      const inputRef = transform.input || ''
      const inputVar = this.extractVariableName(inputRef)

      // Get type inference
      const typeInfo = this.typeInferences.get(inputVar)

      if (typeInfo) {
        if (typeInfo.inferredType !== 'array' && typeInfo.inferredType !== 'any') {
          errors.push({
            type: 'error',
            category: 'semantics',
            node_id: nodeId,
            message: `Transform operation '${transform.type}' requires array input, but variable '${inputVar}' is declared as type '${typeInfo.inferredType}'`,
            suggestion: `Change variable '${inputVar}' type to 'array' in the variables declaration, OR use a field that is an array (e.g., '${inputVar}.items' or '${inputVar}.results')`
          })

          this.logger.warn(`Type mismatch in node ${nodeId}: ${transform.type} requires array, got ${typeInfo.inferredType}`)
        }
      } else {
        // Variable type unknown - warn but don't error
        this.logger.warn(`Cannot infer type for variable '${inputVar}' used in transform ${nodeId}`)
      }
    }

    // Validate filter expressions reference correct types
    if (transform.type === 'filter' && transform.filter_expression) {
      const filterErrors = this.validateFilterExpressionTypes(
        nodeId,
        transform.filter_expression
      )
      errors.push(...filterErrors)
    }

    return errors
  }

  /**
   * Validate loop types
   */
  private validateLoopTypes(
    nodeId: string,
    node: ExecutionNode,
    graph: ExecutionGraph
  ): ValidationError[] {
    const errors: ValidationError[] = []
    const loop = node.loop

    if (!loop) return errors

    // Loop must iterate over an array
    const iterateOverRef = loop.iterate_over
    const iterateOverVar = this.extractVariableName(iterateOverRef)

    const typeInfo = this.typeInferences.get(iterateOverVar)

    if (typeInfo) {
      if (typeInfo.inferredType !== 'array' && typeInfo.inferredType !== 'any') {
        errors.push({
          type: 'error',
          category: 'semantics',
          node_id: nodeId,
          message: `Loop iteration requires array, but variable '${iterateOverVar}' is declared as type '${typeInfo.inferredType}'`,
          suggestion: `Change variable '${iterateOverVar}' type to 'array' in the variables declaration, OR iterate over a field that is an array (e.g., '${iterateOverVar}.items')`
        })

        this.logger.warn(`Type mismatch in loop ${nodeId}: iterate_over requires array, got ${typeInfo.inferredType}`)
      }
    }

    return errors
  }

  /**
   * Validate choice condition types
   */
  private validateChoiceTypes(
    nodeId: string,
    node: ExecutionNode,
    graph: ExecutionGraph
  ): ValidationError[] {
    const errors: ValidationError[] = []
    const choice = node.choice

    if (!choice) return errors

    // Validate each rule's condition
    for (const rule of choice.rules) {
      const conditionErrors = this.validateConditionTypes(nodeId, rule.condition)
      errors.push(...conditionErrors)
    }

    return errors
  }

  /**
   * Validate condition expression types
   */
  private validateConditionTypes(nodeId: string, condition: any): ValidationError[] {
    const errors: ValidationError[] = []

    if (condition.type === 'simple') {
      // Validate operator compatibility with variable type
      const variableRef = condition.variable
      const variableName = this.extractVariableName(variableRef)
      const typeInfo = this.typeInferences.get(variableName)

      if (typeInfo) {
        const operator = condition.operator

        // String-specific operators
        const stringOperators = ['contains', 'starts_with', 'ends_with', 'matches']
        if (stringOperators.includes(operator) && typeInfo.inferredType !== 'string' && typeInfo.inferredType !== 'any') {
          errors.push({
            type: 'error',
            category: 'semantics',
            node_id: nodeId,
            message: `Condition operator '${operator}' requires string type, but variable '${variableName}' is type '${typeInfo.inferredType}'`,
            suggestion: `Use a string variable or convert '${variableName}' to string, OR use a numeric operator (eq, gt, gte, lt, lte)`
          })
        }

        // Numeric comparison operators
        const numericOperators = ['gt', 'gte', 'lt', 'lte']
        if (numericOperators.includes(operator) && typeInfo.inferredType === 'string') {
          // Warn but don't error - strings can be compared lexicographically
          this.logger.warn(`Condition in ${nodeId} uses numeric operator '${operator}' on string variable '${variableName}'`)
        }

        // Array/object operators
        if (operator === 'is_empty') {
          if (typeInfo.inferredType !== 'array' && typeInfo.inferredType !== 'object' && typeInfo.inferredType !== 'string' && typeInfo.inferredType !== 'any') {
            errors.push({
              type: 'error',
              category: 'semantics',
              node_id: nodeId,
              message: `Condition operator 'is_empty' requires array, object, or string type, but variable '${variableName}' is type '${typeInfo.inferredType}'`,
              suggestion: `Use 'exists' operator instead, OR ensure variable is an array/object/string`
            })
          }
        }
      }
    } else if (condition.type === 'complex') {
      // Recursively validate sub-conditions
      for (const subCondition of condition.conditions) {
        const subErrors = this.validateConditionTypes(nodeId, subCondition)
        errors.push(...subErrors)
      }
    }

    return errors
  }

  /**
   * Validate filter expression types
   */
  private validateFilterExpressionTypes(nodeId: string, filterExpression: any): ValidationError[] {
    // Filter expressions are condition expressions, use same validation
    return this.validateConditionTypes(nodeId, filterExpression)
  }

  /**
   * Validate AI operation types
   */
  private validateAITypes(
    nodeId: string,
    node: ExecutionNode,
    graph: ExecutionGraph
  ): ValidationError[] {
    const errors: ValidationError[] = []
    const ai = node.operation?.ai

    if (!ai) return errors

    // Validate input type for AI operations
    if (node.inputs && node.inputs.length > 0) {
      for (const input of node.inputs) {
        const inputVar = this.extractVariableName(input.variable)
        const typeInfo = this.typeInferences.get(inputVar)

        // AI operations can work with any type, but we can warn about potential issues
        if (typeInfo && typeInfo.inferredType === 'array') {
          // Warn if passing entire array to AI (might be too large)
          this.logger.warn(`AI operation in ${nodeId} receives array variable '${inputVar}' - consider extracting specific fields`)
        }
      }
    }

    // Validate output schema consistency
    if (ai.output_schema) {
      const schemaType = ai.output_schema.type

      // If output schema is declared as array but AI operations typically produce objects
      if (schemaType === 'array' && ai.type === 'extract') {
        this.logger.warn(`AI extract operation in ${nodeId} has array output schema - consider using object schema unless extracting multiple items`)
      }
    }

    return errors
  }

  /**
   * Extract variable name from potentially dotted path
   */
  private extractVariableName(variableRef: string): string {
    // Remove {{ }} if present
    const cleaned = variableRef.replace(/{{/g, '').replace(/}}/g, '').trim()

    // Extract first part before dot
    const parts = cleaned.split('.')
    return parts[0]
  }
}

/**
 * Convenience function for type validation
 */
export function validateTypeConsistency(graph: ExecutionGraph): ValidationError[] {
  const validator = new TypeConsistencyValidator()
  return validator.validate(graph)
}
