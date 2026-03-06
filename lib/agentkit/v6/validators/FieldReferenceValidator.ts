/**
 * Field Reference Validator
 *
 * Validates that all field references in the execution graph exist in the
 * corresponding plugin output schemas. This is the #1 most critical validator
 * since field name errors account for ~35% of current IR generation failures.
 *
 * The Problem:
 * - LLMs often invent semantic field names (e.g., "email_content_text")
 * - Real plugin schemas have different names (e.g., "snippet" from google-mail)
 * - This causes compilation failures with cryptic error messages
 *
 * The Solution:
 * - Extract all field references from IR (variable paths like "email.snippet")
 * - Trace back to the source plugin that produced this data
 * - Validate field exists in that plugin's output_schema
 * - Suggest similar field names using Levenshtein distance
 *
 * Week 2 Implementation: Core field validation logic
 */

import type { PluginManagerV2 } from '../../../server/plugin-manager-v2'
import type { ExecutionGraph, ExecutionNode, VariableDefinition } from '../logical-ir/schemas/declarative-ir-types-v4'
import type { ValidationError } from '../logical-ir/validation/ExecutionGraphValidator'
import { createLogger, Logger } from '@/lib/logger'

const moduleLogger = createLogger({ module: 'V6', service: 'FieldReferenceValidator' })

interface FieldValidationResult {
  valid: boolean
  error?: string
  suggestions?: string[]
}

interface VariableSource {
  variable: string
  sourceNodeId: string
  sourcePlugin?: string
  sourceAction?: string
  outputSchema?: any
}

export class FieldReferenceValidator {
  private pluginManager?: PluginManagerV2
  private availablePlugins: Record<string, any> = {}
  private logger: Logger

  constructor(pluginManager?: PluginManagerV2) {
    this.logger = moduleLogger.child({ service: 'FieldReferenceValidator' })
    this.pluginManager = pluginManager

    if (pluginManager) {
      this.availablePlugins = pluginManager.getAvailablePlugins()
      this.logger.info(`Initialized with ${Object.keys(this.availablePlugins).length} plugins`)
    } else {
      this.logger.warn('Running without PluginManagerV2 - field validation will be limited')
    }
  }

  /**
   * Main validation entry point
   *
   * Validates all field references in the execution graph against plugin schemas.
   * Returns validation errors with actionable suggestions.
   */
  validate(graph: ExecutionGraph): ValidationError[] {
    const errors: ValidationError[] = []

    if (!this.pluginManager) {
      this.logger.warn('Skipping field validation - no plugin manager available')
      return errors
    }

    // Step 1: Build variable source map (which plugin produced each variable)
    const variableSources = this.buildVariableSourceMap(graph)

    // Step 2: Validate all field references in the graph
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      // Check input bindings
      if (node.inputs) {
        for (const input of node.inputs) {
          const fieldErrors = this.validateFieldReference(
            input.variable,
            variableSources,
            nodeId,
            'input'
          )
          errors.push(...fieldErrors)
        }
      }

      // Check output bindings
      if (node.outputs) {
        for (const output of node.outputs) {
          // Outputs write to variables, so validation is different
          // We validate the variable exists and the path is valid
          const fieldErrors = this.validateOutputFieldReference(
            output.variable,
            output.path,
            graph.variables,
            nodeId
          )
          errors.push(...fieldErrors)
        }
      }

      // Check conditionals (choice nodes)
      if (node.type === 'choice' && node.choice) {
        for (const rule of node.choice.rules) {
          const conditionErrors = this.validateConditionFieldReferences(
            rule.condition,
            variableSources,
            nodeId
          )
          errors.push(...conditionErrors)
        }
      }

      // Check loop iterations
      if (node.type === 'loop' && node.loop) {
        const loopErrors = this.validateFieldReference(
          node.loop.iterate_over,
          variableSources,
          nodeId,
          'loop_iterator'
        )
        errors.push(...loopErrors)
      }

      // Check transform operations (map, filter, reduce)
      if (node.operation?.operation_type === 'transform' && node.operation.transform) {
        const transform = node.operation.transform

        // Validate input for transform
        if (transform.input) {
          const transformErrors = this.validateFieldReference(
            transform.input,
            variableSources,
            nodeId,
            'transform_input'
          )
          errors.push(...transformErrors)
        }

        // Validate filter expressions
        if (transform.type === 'filter' && transform.filter_expression) {
          const filterErrors = this.validateConditionFieldReferences(
            transform.filter_expression,
            variableSources,
            nodeId
          )
          errors.push(...filterErrors)
        }

        // Validate sort fields
        if (transform.type === 'sort' && transform.sort_by) {
          const sortErrors = this.validateFieldReference(
            transform.sort_by,
            variableSources,
            nodeId,
            'sort_field'
          )
          errors.push(...sortErrors)
        }
      }
    }

    this.logger.info(`Field validation completed: ${errors.length} errors found`)
    return errors
  }

  /**
   * Build a map of which plugin/action produced each variable
   * This allows us to trace field references back to their source schema
   */
  private buildVariableSourceMap(graph: ExecutionGraph): Map<string, VariableSource> {
    const sources = new Map<string, VariableSource>()

    // Iterate through nodes to find variable producers
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      // Fetch operations produce variables
      if (node.operation?.operation_type === 'fetch' && node.operation.fetch) {
        const fetch = node.operation.fetch
        const plugin = this.availablePlugins[fetch.plugin_key]

        // Find output variable for this fetch operation
        if (node.outputs && node.outputs.length > 0) {
          const outputVar = node.outputs[0].variable
          const action = plugin?.actions?.[fetch.action]

          sources.set(outputVar, {
            variable: outputVar,
            sourceNodeId: nodeId,
            sourcePlugin: fetch.plugin_key,
            sourceAction: fetch.action,
            outputSchema: action?.output_schema
          })

          this.logger.debug(`Mapped variable '${outputVar}' to ${fetch.plugin_key}.${fetch.action}`)
        }
      }

      // AI operations produce variables
      if (node.operation?.operation_type === 'ai' && node.operation.ai) {
        if (node.outputs && node.outputs.length > 0) {
          const outputVar = node.outputs[0].variable

          sources.set(outputVar, {
            variable: outputVar,
            sourceNodeId: nodeId,
            sourcePlugin: 'ai',
            sourceAction: node.operation.ai.type,
            outputSchema: node.operation.ai.output_schema
          })

          this.logger.debug(`Mapped variable '${outputVar}' to AI operation`)
        }
      }

      // Transform operations can produce new variables
      if (node.operation?.operation_type === 'transform' && node.operation.transform) {
        if (node.outputs && node.outputs.length > 0) {
          const outputVar = node.outputs[0].variable

          // Transform output schema depends on input schema
          sources.set(outputVar, {
            variable: outputVar,
            sourceNodeId: nodeId,
            sourcePlugin: 'transform',
            sourceAction: node.operation.transform.type
          })

          this.logger.debug(`Mapped variable '${outputVar}' to transform operation`)
        }
      }

      // Loop iterations produce item variables
      if (node.type === 'loop' && node.loop) {
        const itemVar = node.loop.item_variable

        // Trace back to what the loop is iterating over
        const iterateOver = node.loop.iterate_over
        const sourceVar = this.extractVariableName(iterateOver)
        const source = sources.get(sourceVar)

        if (source) {
          // Item variable inherits schema from array element
          sources.set(itemVar, {
            variable: itemVar,
            sourceNodeId: nodeId,
            sourcePlugin: source.sourcePlugin,
            sourceAction: source.sourceAction,
            outputSchema: this.extractArrayItemSchema(source.outputSchema)
          })

          this.logger.debug(`Mapped loop item variable '${itemVar}' to array element of '${sourceVar}'`)
        }
      }
    }

    return sources
  }

  /**
   * Validate a field reference (e.g., "email.snippet" or "{{current_email.from}}")
   */
  private validateFieldReference(
    fieldRef: string,
    variableSources: Map<string, VariableSource>,
    nodeId: string,
    context: 'input' | 'output' | 'loop_iterator' | 'transform_input' | 'sort_field'
  ): ValidationError[] {
    const errors: ValidationError[] = []

    // Extract variable name and field path
    const cleanRef = this.cleanFieldReference(fieldRef)
    const { variable, path } = this.parseFieldPath(cleanRef)

    // Find source of this variable
    const source = variableSources.get(variable)

    if (!source) {
      // Variable source not found - this is a data flow error, not field error
      // Skip field validation (ExecutionGraphValidator will catch this)
      return errors
    }

    // If no path specified, no field validation needed
    if (!path || path.length === 0) {
      return errors
    }

    // Validate path against source schema
    const validation = this.validateFieldPath(path, source.outputSchema)

    if (!validation.valid) {
      const contextDescription = this.getContextDescription(context)
      const suggestion = validation.suggestions && validation.suggestions.length > 0
        ? `Did you mean: ${validation.suggestions.slice(0, 3).join(', ')}?`
        : `Check ${source.sourcePlugin}.${source.sourceAction} output schema.`

      errors.push({
        type: 'error',
        category: 'data_flow',
        node_id: nodeId,
        message: `Field '${path.join('.')}' not found in ${context} variable '${variable}' (from ${source.sourcePlugin}.${source.sourceAction})`,
        suggestion: `${contextDescription}. ${suggestion}`
      })

      this.logger.warn(`Field validation failed: ${variable}.${path.join('.')} in node ${nodeId}`)
    }

    return errors
  }

  /**
   * Validate output field reference
   */
  private validateOutputFieldReference(
    variableName: string,
    fieldPath: string | undefined,
    variables: VariableDefinition[],
    nodeId: string
  ): ValidationError[] {
    const errors: ValidationError[] = []

    // Check variable exists
    const variableDecl = variables.find(v => v.name === variableName)

    if (!variableDecl) {
      errors.push({
        type: 'error',
        category: 'data_flow',
        node_id: nodeId,
        message: `Output references undeclared variable: '${variableName}'`,
        suggestion: `Add '${variableName}' to the variables array or use an existing variable.`
      })
    }

    // Note: We can't validate the field path for outputs without knowing the runtime data structure
    // Output paths are used to write to specific fields, which may be created dynamically

    return errors
  }

  /**
   * Validate field references in condition expressions
   */
  private validateConditionFieldReferences(
    condition: any,
    variableSources: Map<string, VariableSource>,
    nodeId: string
  ): ValidationError[] {
    const errors: ValidationError[] = []

    if (condition.type === 'simple') {
      const fieldErrors = this.validateFieldReference(
        condition.variable,
        variableSources,
        nodeId,
        'input'
      )
      errors.push(...fieldErrors)
    } else if (condition.type === 'complex') {
      for (const subCondition of condition.conditions) {
        const subErrors = this.validateConditionFieldReferences(
          subCondition,
          variableSources,
          nodeId
        )
        errors.push(...subErrors)
      }
    }

    return errors
  }

  /**
   * Clean field reference (remove {{ }} and whitespace)
   */
  private cleanFieldReference(fieldRef: string): string {
    return fieldRef
      .replace(/{{/g, '')
      .replace(/}}/g, '')
      .trim()
  }

  /**
   * Parse field path into variable name and field path
   * Example: "email.snippet" → { variable: "email", path: ["snippet"] }
   * Example: "email.attachments[0].name" → { variable: "email", path: ["attachments", "0", "name"] }
   */
  private parseFieldPath(fieldRef: string): { variable: string; path: string[] } {
    const parts = fieldRef.split('.')
    const variable = parts[0]
    const path = parts.slice(1)

    // Handle array indexing (e.g., "attachments[0]" → ["attachments", "0"])
    const expandedPath: string[] = []
    for (const part of path) {
      if (part.includes('[')) {
        const [field, ...indices] = part.split('[')
        expandedPath.push(field)
        for (const index of indices) {
          expandedPath.push(index.replace(']', ''))
        }
      } else {
        expandedPath.push(part)
      }
    }

    return { variable, path: expandedPath }
  }

  /**
   * Extract variable name from potentially dotted path
   */
  private extractVariableName(variableRef: string): string {
    const cleaned = this.cleanFieldReference(variableRef)
    return this.parseFieldPath(cleaned).variable
  }

  /**
   * Validate a field path exists in a schema
   */
  private validateFieldPath(path: string[], schema: any): FieldValidationResult {
    if (!schema) {
      return { valid: false, error: 'No schema available for validation' }
    }

    let currentSchema = schema
    const traversedPath: string[] = []

    for (const fieldName of path) {
      traversedPath.push(fieldName)

      // Handle array indices
      if (!isNaN(Number(fieldName))) {
        // This is an array index - check if current schema is array
        if (currentSchema.type === 'array' && currentSchema.items) {
          currentSchema = currentSchema.items
          continue
        } else {
          return {
            valid: false,
            error: `Path '${traversedPath.join('.')}' attempts array indexing but schema is not an array`
          }
        }
      }

      // Navigate to field in schema
      if (currentSchema.type === 'object' && currentSchema.properties) {
        if (currentSchema.properties[fieldName]) {
          currentSchema = currentSchema.properties[fieldName]
        } else {
          // Field not found - suggest similar fields
          const availableFields = Object.keys(currentSchema.properties)
          const suggestions = this.findSimilarFields(fieldName, availableFields)

          return {
            valid: false,
            error: `Field '${fieldName}' not found in schema at path '${traversedPath.slice(0, -1).join('.')}'`,
            suggestions
          }
        }
      } else if (currentSchema.type === 'array' && currentSchema.items) {
        // Navigate into array items
        currentSchema = currentSchema.items
      } else {
        return {
          valid: false,
          error: `Cannot navigate to '${fieldName}' - schema is not an object or array`
        }
      }
    }

    return { valid: true }
  }

  /**
   * Find similar field names using Levenshtein distance
   */
  private findSimilarFields(targetField: string, availableFields: string[]): string[] {
    const similarities = availableFields.map(field => ({
      field,
      distance: this.levenshteinDistance(targetField.toLowerCase(), field.toLowerCase())
    }))

    // Return fields with distance < 3, sorted by distance
    return similarities
      .filter(s => s.distance < 3)
      .sort((a, b) => a.distance - b.distance)
      .map(s => s.field)
      .slice(0, 3)
  }

  /**
   * Calculate Levenshtein distance between two strings
   * (Classic dynamic programming algorithm for string similarity)
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length
    const n = str2.length
    const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0))

    for (let i = 0; i <= m; i++) dp[i][0] = i
    for (let j = 0; j <= n; j++) dp[0][j] = j

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1]
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,    // deletion
            dp[i][j - 1] + 1,    // insertion
            dp[i - 1][j - 1] + 1 // substitution
          )
        }
      }
    }

    return dp[m][n]
  }

  /**
   * Extract array item schema from array schema
   */
  private extractArrayItemSchema(schema: any): any {
    if (!schema) return undefined

    if (schema.type === 'array' && schema.items) {
      return schema.items
    }

    return undefined
  }

  /**
   * Get human-readable context description for error messages
   */
  private getContextDescription(context: string): string {
    const descriptions: Record<string, string> = {
      input: 'Node input binding',
      output: 'Node output binding',
      loop_iterator: 'Loop iteration target',
      transform_input: 'Transform operation input',
      sort_field: 'Sort operation field'
    }

    return descriptions[context] || 'Field reference'
  }
}

/**
 * Convenience function for field validation
 */
export function validateFieldReferences(
  graph: ExecutionGraph,
  pluginManager?: PluginManagerV2
): ValidationError[] {
  const validator = new FieldReferenceValidator(pluginManager)
  return validator.validate(graph)
}
