/**
 * Schema Compatibility Validator
 *
 * **CRITICAL SYSTEM COMPONENT**
 * This validator prevents data loss between workflow steps by ensuring transform output schemas
 * are compatible with downstream consumers. Without this validation, workflows will execute
 * but silently lose data when template variables reference non-existent fields.
 *
 * **Comprehensive Coverage:**
 * 1. Transform output → Action with x-variable-mapping (e.g., flatten → get_email_attachment)
 * 2. Transform output → Nested transform accessing fields (e.g., filter conditions)
 * 3. Transform output → Deliver mapping (e.g., append_rows with field mapping)
 * 4. Loop item variable → Actions/transforms inside loop body
 * 5. Action output → Downstream field access (e.g., drive_file.web_view_link)
 *
 * **Plugin-Agnostic Design:**
 * - Uses x-variable-mapping metadata from plugin schemas (not hardcoded rules)
 * - Works with ANY plugin that declares field expectations
 * - Scales to custom plugins automatically
 *
 * **Auto-Fix Strategy:**
 * - Adds missing fields to transform output_schema when detected
 * - Preserves existing fields (never removes)
 * - Uses plugin schemas as source of truth for field names
 * - Logs all fixes for transparency
 */

import type {
  ExecutionGraph,
  ExecutionNode,
  OperationConfig,
  TransformConfig as BaseTransformConfig,
  ConditionExpression,
  SimpleCondition,
} from '../schemas/declarative-ir-types-v4'
import type { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'
import type { ActionDefinition } from '@/lib/types/plugin-types'
import { createLogger } from '@/lib/logger'

const logger = createLogger('SchemaCompatibilityValidator')

// Extended transform config with output_schema (added by IntentToIRConverter)
interface TransformConfig extends BaseTransformConfig {
  output_schema?: {
    type: 'array' | 'object'
    items?: {
      type: 'object'
      properties: Record<string, any>
      required?: string[]
    }
    properties?: Record<string, any>
    required?: string[]
  }
  condition?: ConditionExpression // For filter operations
}

export interface SchemaCompatibilityError {
  type: 'error' | 'warning'
  category: 'schema_mismatch' | 'missing_field' | 'type_mismatch' | 'undefined_variable'
  source_node_id: string
  consumer_node_id: string
  variable_name: string
  field_name?: string
  message: string
  suggestion?: string
  auto_fixed?: boolean
}

export interface SchemaCompatibilityResult {
  valid: boolean
  errors: SchemaCompatibilityError[]
  warnings: SchemaCompatibilityError[]
  fixes_applied: number
}

interface FieldRequirement {
  field_name: string
  required_by_node: string
  required_by_operation: string
  source: 'x-variable-mapping' | 'condition' | 'transform_input' | 'deliver_mapping' | 'template_reference'
  is_required: boolean // Whether field MUST exist (vs optional)
}

interface VariableOutputInfo {
  node_id: string
  variable_name: string
  output_schema?: any
  declared_fields: Set<string>
  required_fields: Set<string>
  source_type: 'transform' | 'action' | 'loop_item' | 'loop_output' | 'ai'
}

export class SchemaCompatibilityValidator {
  private errors: SchemaCompatibilityError[] = []
  private warnings: SchemaCompatibilityError[] = []
  private fixesApplied: number = 0
  private pluginManager: PluginManagerV2 | null = null

  constructor(pluginManager?: PluginManagerV2) {
    this.pluginManager = pluginManager || null
  }

  /**
   * Main validation entry point
   * Returns validation result with auto-fixes applied to the graph
   */
  validate(graph: ExecutionGraph, autoFix: boolean = true): SchemaCompatibilityResult {
    this.reset()

    logger.info('[SchemaCompatibilityValidator] Starting comprehensive schema validation...')

    // Phase 1: Build variable output map (what each variable provides)
    const variableOutputs = this.buildVariableOutputMap(graph)
    logger.debug(
      `[SchemaCompatibilityValidator] Identified ${variableOutputs.size} variables with schemas`
    )

    // Phase 2: Build field requirements map (what downstream steps need)
    const fieldRequirements = this.buildFieldRequirementsMap(graph)
    logger.debug(
      `[SchemaCompatibilityValidator] Identified ${fieldRequirements.size} variables with field requirements`
    )

    // Debug: Log all field requirements
    for (const [varName, reqs] of fieldRequirements.entries()) {
      logger.debug(`[SchemaCompatibilityValidator] Variable "${varName}" requires ${reqs.length} fields: ${reqs.map(r => r.field_name).join(', ')}`)
    }

    // Phase 3: Cross-validate and auto-fix mismatches
    this.validateAndFixMismatches(variableOutputs, fieldRequirements, graph, autoFix)

    logger.info(
      `[SchemaCompatibilityValidator] Validation complete: ${this.errors.length} errors, ${this.warnings.length} warnings, ${this.fixesApplied} fixes applied`
    )

    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
      fixes_applied: this.fixesApplied,
    }
  }

  private reset() {
    this.errors = []
    this.warnings = []
    this.fixesApplied = 0
  }

  /**
   * Phase 1: Build comprehensive map of all variables and their output schemas
   */
  private buildVariableOutputMap(graph: ExecutionGraph): Map<string, VariableOutputInfo> {
    const outputs = new Map<string, VariableOutputInfo>()

    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      // Case 1: Transform operations with output_schema
      if (node.type === 'operation' && node.operation?.operation_type === 'transform') {
        const transform = node.operation.transform
        const outputVar = node.outputs?.[0]?.variable

        if (outputVar && transform?.output_schema) {
          this.addVariableOutput(outputs, {
            node_id: nodeId,
            variable_name: outputVar,
            output_schema: transform.output_schema,
            declared_fields: this.extractDeclaredFields(transform.output_schema),
            required_fields: this.extractRequiredFields(transform.output_schema),
            source_type: 'transform',
          })
        } else if (outputVar && transform?.type === 'filter' && transform.input) {
          // CRITICAL: Filter transforms without explicit output_schema inherit from input
          // This is necessary for loop item variables to get correct schemas
          const inputVar = transform.input
          const inputOutput = outputs.get(inputVar)

          if (inputOutput) {
            logger.debug(
              `[SchemaCompatibilityValidator] Filter transform "${nodeId}" inheriting schema from input "${inputVar}"`
            )
            this.addVariableOutput(outputs, {
              node_id: nodeId,
              variable_name: outputVar,
              output_schema: inputOutput.output_schema,
              declared_fields: new Set(inputOutput.declared_fields),
              required_fields: new Set(inputOutput.required_fields),
              source_type: 'transform',
            })
          }
        }
      }

      // Case 2: Action operations with known output schemas
      if (node.type === 'operation' && node.operation?.operation_type === 'fetch') {
        const outputVar = node.outputs?.[0]?.variable
        if (outputVar && this.pluginManager) {
          const pluginKey = node.operation.fetch?.plugin_key
          const actionName = node.operation.fetch?.action

          if (pluginKey && actionName) {
            const schema = this.getPluginActionSchema(pluginKey, actionName)
            if (schema?.output_schema) {
              this.addVariableOutput(outputs, {
                node_id: nodeId,
                variable_name: outputVar,
                output_schema: schema.output_schema,
                declared_fields: this.extractDeclaredFields(schema.output_schema),
                required_fields: this.extractRequiredFields(schema.output_schema),
                source_type: 'action',
              })
            }
          }
        }
      }

      // Case 3: AI/Generate operations with output_schema
      if (node.type === 'operation' && node.operation?.operation_type === 'ai') {
        const ai = node.operation.ai
        const outputVar = node.outputs?.[0]?.variable

        if (outputVar && ai?.output_schema) {
          this.addVariableOutput(outputs, {
            node_id: nodeId,
            variable_name: outputVar,
            output_schema: ai.output_schema,
            declared_fields: this.extractDeclaredFields(ai.output_schema),
            required_fields: this.extractRequiredFields(ai.output_schema),
            source_type: 'ai',
          })
        }
      }

      // Case 4: Loop nodes - both item variables and output variables
      if (node.type === 'loop' && node.loop) {
        const itemVar = node.loop.item_variable
        const outputVar = node.loop.output_variable
        const iterateOver = node.loop.iterate_over

        // Loop item variable inherits schema from input array items
        if (itemVar) {
          const sourceOutput = outputs.get(iterateOver)
          if (sourceOutput?.output_schema?.items) {
            this.addVariableOutput(outputs, {
              node_id: nodeId,
              variable_name: itemVar,
              output_schema: sourceOutput.output_schema.items,
              declared_fields: this.extractDeclaredFields(sourceOutput.output_schema.items),
              required_fields: this.extractRequiredFields(sourceOutput.output_schema.items),
              source_type: 'loop_item',
            })
          }
        }

        // Loop output variable (collected results)
        if (outputVar && node.loop.collect_outputs) {
          // Output is an array of whatever the loop body produces
          // This is harder to infer - we'd need to analyze loop body
          // For now, mark it as a loop output without schema
          this.addVariableOutput(outputs, {
            node_id: nodeId,
            variable_name: outputVar,
            output_schema: undefined,
            declared_fields: new Set(),
            required_fields: new Set(),
            source_type: 'loop_output',
          })
        }
      }
    }

    return outputs
  }

  private addVariableOutput(outputs: Map<string, VariableOutputInfo>, info: VariableOutputInfo) {
    outputs.set(info.variable_name, info)
    logger.debug(
      `[SchemaCompatibilityValidator] Variable "${info.variable_name}" from ${info.source_type} node ${info.node_id} provides fields: ${Array.from(info.declared_fields).join(', ') || 'none'}`
    )
  }

  /**
   * Extract field names from JSON schema (supports object and array schemas)
   */
  private extractDeclaredFields(schema: any): Set<string> {
    const fields = new Set<string>()
    if (!schema) return fields

    // Object schema
    if (schema.properties) {
      Object.keys(schema.properties).forEach((f) => fields.add(f))
    }

    // Array schema (items.properties)
    if (schema.items?.properties) {
      Object.keys(schema.items.properties).forEach((f) => fields.add(f))
    }

    return fields
  }

  /**
   * Extract required field names from JSON schema
   */
  private extractRequiredFields(schema: any): Set<string> {
    const fields = new Set<string>()
    if (!schema) return fields

    // Object schema
    if (Array.isArray(schema.required)) {
      schema.required.forEach((f: string) => fields.add(f))
    }

    // Array schema (items.required)
    if (Array.isArray(schema.items?.required)) {
      schema.items.required.forEach((f: string) => fields.add(f))
    }

    return fields
  }

  /**
   * Phase 2: Build comprehensive map of field requirements from all consumers
   */
  private buildFieldRequirementsMap(graph: ExecutionGraph): Map<string, FieldRequirement[]> {
    const requirements = new Map<string, FieldRequirement[]>()

    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      if (node.type !== 'operation' || !node.operation) continue

      const op = node.operation

      // Requirement 1: Actions with x-variable-mapping
      this.extractActionVariableMappingRequirements(node, nodeId, op, requirements)

      // Requirement 2: Condition expressions (filter, choice)
      this.extractConditionRequirements(node, nodeId, op, requirements)

      // Requirement 3: Deliver mapping (append_rows, update operations)
      this.extractDeliverMappingRequirements(node, nodeId, op, requirements)

      // Requirement 4: Template references in configs (general case)
      this.extractTemplateReferenceRequirements(node, nodeId, op, requirements)
    }

    return requirements
  }

  /**
   * Extract field requirements from actions with x-variable-mapping
   */
  private extractActionVariableMappingRequirements(
    node: ExecutionNode,
    nodeId: string,
    op: OperationConfig,
    requirements: Map<string, FieldRequirement[]>
  ) {
    if (!this.pluginManager) return
    if (op.operation_type !== 'fetch' && op.operation_type !== 'deliver') return

    const pluginKey = op.fetch?.plugin_key || op.deliver?.plugin_key
    const actionName = op.fetch?.action || op.deliver?.action

    if (!pluginKey || !actionName) return

    const schema = this.getPluginActionSchema(pluginKey, actionName)
    if (!schema?.parameters?.properties) return

    // Find input variables
    const inputVars = node.inputs?.map((i) => i.variable.split('.')[0]) || []

    for (const [paramName, paramDef] of Object.entries(schema.parameters.properties)) {
      const mapping = (paramDef as any)['x-variable-mapping']
      if (!mapping?.field_path) continue

      // This parameter expects a field from an input variable
      for (const inputVar of inputVars) {
        this.addFieldRequirement(requirements, inputVar, {
          field_name: mapping.field_path,
          required_by_node: nodeId,
          required_by_operation: `${pluginKey}.${actionName}.${paramName}`,
          source: 'x-variable-mapping',
          is_required: schema.parameters.required?.includes(paramName) || false,
        })
      }
    }
  }

  /**
   * Extract field requirements from condition expressions
   */
  private extractConditionRequirements(
    node: ExecutionNode,
    nodeId: string,
    op: OperationConfig,
    requirements: Map<string, FieldRequirement[]>
  ) {
    let condition: ConditionExpression | undefined

    // Transform conditions (filter)
    if (op.operation_type === 'transform' && op.transform?.condition) {
      condition = op.transform.condition
    }

    // Choice node conditions
    // (Note: choice is node.choice, not operation.choice)

    if (!condition) return

    const fieldRefs = this.extractFieldReferencesFromCondition(condition)
    for (const [varName, fieldName] of fieldRefs) {
      this.addFieldRequirement(requirements, varName, {
        field_name: fieldName,
        required_by_node: nodeId,
        required_by_operation: 'condition_expression',
        source: 'condition',
        is_required: true, // Conditions always need their fields
      })
    }
  }

  /**
   * Extract field references from condition expressions recursively
   */
  private extractFieldReferencesFromCondition(
    condition: ConditionExpression
  ): Array<[string, string]> {
    const refs: Array<[string, string]> = []

    if (condition.type === 'simple') {
      const variable = condition.variable
      if (variable && variable.includes('.')) {
        const parts = variable.split('.')
        if (parts.length >= 2) {
          const varName = parts[0]
          const fieldName = parts.slice(1).join('.')
          refs.push([varName, fieldName])
        }
      }
    } else if (condition.type === 'complex') {
      for (const subCondition of condition.conditions) {
        refs.push(...this.extractFieldReferencesFromCondition(subCondition))
      }
    }

    return refs
  }

  /**
   * Extract field requirements from deliver mapping
   */
  private extractDeliverMappingRequirements(
    node: ExecutionNode,
    nodeId: string,
    op: OperationConfig,
    requirements: Map<string, FieldRequirement[]>
  ) {
    if (op.operation_type !== 'deliver') return

    const fieldsConfig = op.deliver?.config?.fields
    if (!fieldsConfig || typeof fieldsConfig !== 'object') return

    for (const [_columnName, value] of Object.entries(fieldsConfig)) {
      if (typeof value === 'string') {
        // Extract template references like {{var.field}}
        const matches = value.matchAll(/\{\{([^}]+)\}\}/g)
        for (const match of matches) {
          const ref = match[1]
          if (ref.includes('.')) {
            const parts = ref.split('.')
            if (parts.length >= 2) {
              const varName = parts[0]
              const fieldName = parts.slice(1).join('.')
              this.addFieldRequirement(requirements, varName, {
                field_name: fieldName,
                required_by_node: nodeId,
                required_by_operation: 'deliver_field_mapping',
                source: 'deliver_mapping',
                is_required: true, // Field mapping always needs fields
              })
            }
          }
        }
      }
    }
  }

  /**
   * Extract field requirements from template references in config
   * This catches general cases like {{var.field}} anywhere in operation config
   */
  private extractTemplateReferenceRequirements(
    node: ExecutionNode,
    nodeId: string,
    op: OperationConfig,
    requirements: Map<string, FieldRequirement[]>
  ) {
    // Recursively scan operation config for template references
    const scanObject = (obj: any, path: string = '') => {
      if (!obj || typeof obj !== 'object') return

      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          // Look for both {{var.field}} patterns AND plain var.field references
          // IR format uses plain strings, PILOT DSL uses {{}} wrappers
          const templateMatches = value.matchAll(/\{\{([^}]+)\}\}/g)
          const refs: string[] = []

          // Extract {{var.field}} references
          for (const match of templateMatches) {
            refs.push(match[1])
          }

          // Also check if the ENTIRE value is a plain var.field reference
          // (common in IR before template wrapping happens in compiler)
          if (value.includes('.') && !value.includes('{{') && !value.includes(' ')) {
            // Looks like a plain field reference (e.g., "attachment.message_id")
            refs.push(value)
          }

          // Process all found references
          for (const ref of refs) {
            if (ref.includes('.')) {
              const parts = ref.split('.')
              if (parts.length >= 2) {
                const varName = parts[0]
                const fieldName = parts.slice(1).join('.')
                this.addFieldRequirement(requirements, varName, {
                  field_name: fieldName,
                  required_by_node: nodeId,
                  required_by_operation: `template_ref:${path}.${key}`,
                  source: 'template_reference',
                  is_required: false, // Template refs might be optional
                })
              }
            }
          }
        } else if (typeof value === 'object') {
          scanObject(value, `${path}.${key}`)
        }
      }
    }

    scanObject(op)
  }

  /**
   * Add a field requirement to the map
   */
  private addFieldRequirement(
    requirements: Map<string, FieldRequirement[]>,
    varName: string,
    requirement: FieldRequirement
  ) {
    if (!requirements.has(varName)) {
      requirements.set(varName, [])
    }

    // Avoid duplicate requirements
    const existing = requirements.get(varName)!
    const isDuplicate = existing.some(
      (r) =>
        r.field_name === requirement.field_name &&
        r.required_by_node === requirement.required_by_node &&
        r.source === requirement.source
    )

    if (!isDuplicate) {
      existing.push(requirement)
      logger.debug(
        `[SchemaCompatibilityValidator] ${varName}.${requirement.field_name} required by ${requirement.required_by_operation} (${requirement.source})`
      )
    }
  }

  /**
   * Phase 3: Cross-validate schemas and auto-fix mismatches
   */
  private validateAndFixMismatches(
    variableOutputs: Map<string, VariableOutputInfo>,
    fieldRequirements: Map<string, FieldRequirement[]>,
    graph: ExecutionGraph,
    autoFix: boolean
  ) {
    for (const [varName, requirements] of fieldRequirements.entries()) {
      const output = variableOutputs.get(varName)

      if (!output) {
        // Variable not found - this is caught by ExecutionGraphValidator
        // We only care about schema mismatches here
        continue
      }

      for (const requirement of requirements) {
        const fieldName = requirement.field_name

        if (!output.declared_fields.has(fieldName)) {
          // CRITICAL MISMATCH: Consumer expects field that producer doesn't declare

          // Determine which transform to fix
          let targetTransform: VariableOutputInfo | null = null

          if (output.source_type === 'transform') {
            // Direct transform - fix it
            targetTransform = output
          } else if (output.source_type === 'loop_item') {
            // Loop item variable - trace back to the source array transform
            const loopNode = graph.nodes[output.node_id]
            if (loopNode?.type === 'loop' && loopNode.loop) {
              const sourceArrayVar = loopNode.loop.iterate_over
              const sourceOutput = variableOutputs.get(sourceArrayVar)

              // If source is a transform (filter, map, etc.), fix it
              if (sourceOutput && sourceOutput.source_type === 'transform') {
                targetTransform = sourceOutput
                logger.debug(
                  `[SchemaCompatibilityValidator] Loop item "${varName}" missing field - tracing back to source transform "${sourceArrayVar}"`
                )
              }
            }
          }

          if (autoFix && targetTransform) {
            // Auto-fix: Add missing field to transform output_schema
            this.addFieldToTransformSchema(graph, targetTransform, fieldName, requirement.is_required)
            this.fixesApplied++

            // Also update the loop item variable's schema tracking
            if (output.source_type === 'loop_item') {
              output.declared_fields.add(fieldName)
              if (requirement.is_required) {
                output.required_fields.add(fieldName)
              }
            }

            this.warnings.push({
              type: 'warning',
              category: 'missing_field',
              source_node_id: targetTransform.node_id,
              consumer_node_id: requirement.required_by_node,
              variable_name: varName,
              field_name: fieldName,
              message: `Variable "${varName}" missing field "${fieldName}" required by ${requirement.required_by_operation}`,
              suggestion: `Auto-fixed: Added "${fieldName}" to "${targetTransform.variable_name}" output_schema`,
              auto_fixed: true,
            })

            logger.warn(
              `[SchemaCompatibilityValidator] AUTO-FIX: Added "${fieldName}" to ${targetTransform.node_id} output "${targetTransform.variable_name}" for ${requirement.required_by_operation}`
            )
          } else if (!autoFix) {
            // Report error without fixing
            this.errors.push({
              type: 'error',
              category: 'missing_field',
              source_node_id: output.node_id,
              consumer_node_id: requirement.required_by_node,
              variable_name: varName,
              field_name: fieldName,
              message: `Variable "${varName}" missing field "${fieldName}" required by ${requirement.required_by_operation}. This will cause runtime template evaluation failure.`,
              suggestion: `Add "${fieldName}" to the output_schema for ${varName} in node ${output.node_id}`,
              auto_fixed: false,
            })
          } else {
            // Can't auto-fix (not a transform, or other reason)
            this.warnings.push({
              type: 'warning',
              category: 'missing_field',
              source_node_id: output.node_id,
              consumer_node_id: requirement.required_by_node,
              variable_name: varName,
              field_name: fieldName,
              message: `Variable "${varName}" (from ${output.source_type}) may not have field "${fieldName}" required by ${requirement.required_by_operation}`,
              suggestion: `Verify that ${output.source_type} provides this field at runtime`,
              auto_fixed: false,
            })
          }
        }
      }
    }
  }

  /**
   * Add a missing field to a transform's output_schema
   * Supports both array and object schemas
   */
  private addFieldToTransformSchema(
    graph: ExecutionGraph,
    output: VariableOutputInfo,
    fieldName: string,
    isRequired: boolean
  ) {
    const node = graph.nodes[output.node_id]
    if (!node || node.type !== 'operation' || !node.operation) return

    const op = node.operation
    if (op.operation_type !== 'transform' || !op.transform) return

    const schema = op.transform.output_schema

    // Ensure schema exists
    if (!schema) {
      // For filters, try to copy the input schema first
      if (op.transform.type === 'filter' && op.transform.input) {
        const inputVar = op.transform.input
        const inputNode = this.findNodeByOutputVariable(graph, inputVar)
        const inputTransform = inputNode?.type === 'operation' ? (inputNode.operation?.transform as any) : null
        if (inputTransform?.output_schema) {
          // Deep copy the input schema
          op.transform.output_schema = JSON.parse(
            JSON.stringify(inputTransform.output_schema)
          )
          logger.debug(
            `[SchemaCompatibilityValidator] Filter "${output.node_id}" has no output_schema - copied from input "${inputVar}"`
          )
        } else {
          // No input schema to copy, create empty
          op.transform.output_schema = {
            type: 'array',
            items: { type: 'object', properties: {}, required: [] },
          }
        }
      } else {
        // Non-filter transform, create empty schema
        op.transform.output_schema = {
          type: 'array',
          items: { type: 'object', properties: {}, required: [] },
        }
      }
    }

    const finalSchema = op.transform.output_schema

    // Handle array schemas (most common: flatten, filter, map)
    if (finalSchema.type === 'array') {
      if (!finalSchema.items) {
        finalSchema.items = { type: 'object', properties: {}, required: [] }
      }
      if (!finalSchema.items.properties) {
        finalSchema.items.properties = {}
      }
      if (!Array.isArray(finalSchema.items.required)) {
        finalSchema.items.required = []
      }

      // Add field
      finalSchema.items.properties[fieldName] = { type: 'string' }

      // Mark as required if needed
      if (isRequired && !finalSchema.items.required.includes(fieldName)) {
        finalSchema.items.required.push(fieldName)
      }

      // Update tracking
      output.declared_fields.add(fieldName)
      if (isRequired) {
        output.required_fields.add(fieldName)
      }
    }

    // Handle object schemas (for single-object transforms)
    if (finalSchema.type === 'object') {
      if (!finalSchema.properties) {
        finalSchema.properties = {}
      }
      if (!Array.isArray(finalSchema.required)) {
        finalSchema.required = []
      }

      // Add field
      finalSchema.properties[fieldName] = { type: 'string' }

      // Mark as required if needed
      if (isRequired && !finalSchema.required.includes(fieldName)) {
        finalSchema.required.push(fieldName)
      }

      // Update tracking
      output.declared_fields.add(fieldName)
      if (isRequired) {
        output.required_fields.add(fieldName)
      }
    }
  }

  /**
   * Find node by its output variable name
   */
  private findNodeByOutputVariable(graph: ExecutionGraph, varName: string): ExecutionNode | null {
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      if (node.outputs && node.outputs.length > 0) {
        if (node.outputs[0].variable === varName) {
          return node
        }
      }
    }
    return null
  }

  /**
   * Get plugin action schema from PluginManager
   */
  private getPluginActionSchema(pluginKey: string, actionName: string): ActionDefinition | null {
    if (!this.pluginManager) return null

    try {
      const plugin = this.pluginManager.getPlugin(pluginKey)
      if (!plugin?.actions?.[actionName]) return null

      return plugin.actions[actionName] as ActionDefinition
    } catch (error) {
      return null
    }
  }
}

/**
 * Convenience function for validating schema compatibility
 */
export function validateSchemaCompatibility(
  graph: ExecutionGraph,
  pluginManager?: PluginManagerV2,
  autoFix: boolean = true
): SchemaCompatibilityResult {
  const validator = new SchemaCompatibilityValidator(pluginManager)
  return validator.validate(graph, autoFix)
}
