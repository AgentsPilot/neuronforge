/**
 * PluginParameterValidator - Schema-Driven Parameter Validation & Auto-Correction
 *
 * This utility validates plugin parameters against plugin schemas and auto-corrects
 * common LLM mistakes using intelligent heuristics (NO hardcoding).
 *
 * Core Principle: Use the plugin schema as the source of truth
 *
 * Auto-correction strategy:
 * 1. Compare IR parameters against schema parameters
 * 2. If there's exactly ONE unmatched IR param and ONE unmatched schema param
 * 3. → High confidence they should map to each other
 * 4. → Auto-correct and log the change
 *
 * This works for ANY plugin without hardcoding specific parameter names.
 */

import type { PluginManagerV2 } from '../../../server/plugin-manager-v2'
import { createLogger } from '@/lib/logger'

const logger = createLogger({ module: 'V6', service: 'PluginParameterValidator' })

export interface ValidationResult {
  valid: boolean
  correctedConfig?: Record<string, any>
  corrections: ParameterCorrection[]
  errors: string[]
  warnings: string[]
}

export interface ParameterCorrection {
  from: string
  to: string
  value: any
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

export class PluginParameterValidator {
  constructor(private pluginManager?: PluginManagerV2) {}

  /**
   * Validate and auto-correct parameters for a plugin action
   *
   * @param pluginKey - Plugin key (e.g., "google-sheets")
   * @param actionName - Action name (e.g., "read_range")
   * @param irConfig - Parameters from IR
   * @returns Validation result with corrected config if needed
   */
  validateAndCorrect(
    pluginKey: string,
    actionName: string,
    irConfig: Record<string, any>
  ): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      corrections: [],
      errors: [],
      warnings: []
    }

    // If no plugin manager, skip validation
    if (!this.pluginManager) {
      result.warnings.push('No plugin manager available - skipping validation')
      return result
    }

    try {
      // Get plugin definition
      const plugins = this.pluginManager.getAvailablePlugins()
      const pluginDef = plugins[pluginKey]

      if (!pluginDef) {
        result.errors.push(`Plugin '${pluginKey}' not found`)
        result.valid = false
        return result
      }

      // Get action definition
      const actionDef = pluginDef.actions?.[actionName]
      if (!actionDef) {
        result.errors.push(`Action '${actionName}' not found in plugin '${pluginKey}'`)
        result.valid = false
        return result
      }

      // Get parameter schema
      const schema = (actionDef as any).parameters
      if (!schema || !schema.properties) {
        // No schema to validate against
        result.warnings.push(`No parameter schema for ${pluginKey}.${actionName}`)
        return result
      }

      // Extract schema parameter names
      const schemaParams = Object.keys(schema.properties)
      const requiredParams = schema.required || []

      // Start with a copy of IR config
      const correctedConfig: Record<string, any> = { ...irConfig }

      // Track matched and unmatched parameters
      const matchedIrParams = new Set<string>()
      const matchedSchemaParams = new Set<string>()

      // Phase 1: Exact matches (case-sensitive)
      for (const schemaParam of schemaParams) {
        if (schemaParam in irConfig) {
          matchedIrParams.add(schemaParam)
          matchedSchemaParams.add(schemaParam)
        }
      }

      // Phase 2: Normalized matches (case-insensitive, underscore/dash variations)
      const normalizeParamName = (name: string) => name.toLowerCase().replace(/[_-]/g, '')

      for (const schemaParam of schemaParams) {
        if (matchedSchemaParams.has(schemaParam)) continue

        const normalizedSchema = normalizeParamName(schemaParam)

        for (const [irParam, irValue] of Object.entries(irConfig)) {
          if (matchedIrParams.has(irParam)) continue

          const normalizedIr = normalizeParamName(irParam)

          if (normalizedSchema === normalizedIr) {
            // Found a normalized match - correct the parameter name
            correctedConfig[schemaParam] = irValue
            delete correctedConfig[irParam]

            matchedIrParams.add(irParam)
            matchedSchemaParams.add(schemaParam)

            result.corrections.push({
              from: irParam,
              to: schemaParam,
              value: irValue,
              confidence: 'high',
              reason: `Normalized name match: '${irParam}' → '${schemaParam}'`
            })

            logger.info({
              pluginKey,
              actionName,
              from: irParam,
              to: schemaParam,
              msg: 'Auto-corrected parameter name (normalized match)'
            })

            break
          }
        }
      }

      // Phase 3: Intelligent one-to-one mapping (for remaining unmatched params)
      const unmatchedIrParams = Object.keys(irConfig).filter((p: string) => !matchedIrParams.has(p))
      const unmatchedSchemaParams = requiredParams.filter((p: string) => !matchedSchemaParams.has(p))

      // If there's exactly ONE unmatched IR param and ONE unmatched required schema param
      // → High confidence they should map to each other
      if (unmatchedIrParams.length === 1 && unmatchedSchemaParams.length === 1) {
        const irParam = unmatchedIrParams[0]
        const schemaParam = unmatchedSchemaParams[0]
        const irValue = irConfig[irParam]

        // Apply the correction
        correctedConfig[schemaParam] = irValue
        delete correctedConfig[irParam]

        matchedIrParams.add(irParam)
        matchedSchemaParams.add(schemaParam)

        result.corrections.push({
          from: irParam,
          to: schemaParam,
          value: irValue,
          confidence: 'high',
          reason: `Only unmatched pair: '${irParam}' → '${schemaParam}' (required)`
        })

        logger.warn({
          pluginKey,
          actionName,
          from: irParam,
          to: schemaParam,
          msg: 'Auto-corrected parameter name (one-to-one mapping)'
        })
      }

      // Phase 4: Check for missing required parameters
      for (const requiredParam of requiredParams) {
        if (!(requiredParam in correctedConfig)) {
          result.errors.push(
            `Missing required parameter '${requiredParam}' for ${pluginKey}.${actionName}`
          )
          result.valid = false
        }
      }

      // Phase 5: Warn about remaining unmatched IR parameters
      const finalUnmatchedIrParams = Object.keys(correctedConfig).filter(
        (p: string) => !schemaParams.includes(p)
      )

      for (const unmatchedParam of finalUnmatchedIrParams) {
        result.warnings.push(
          `Parameter '${unmatchedParam}' not found in schema for ${pluginKey}.${actionName}. ` +
          `Valid parameters: ${schemaParams.join(', ')}`
        )
      }

      // Phase 6: Semantic validation - detect intent mismatches
      // Example: Searching for attachments but not requesting attachment data
      if (pluginKey === 'google-mail' && actionName === 'search_emails') {
        const query = correctedConfig.query || ''
        const includeAttachments = correctedConfig.include_attachments

        // Check if query searches for attachments but doesn't request attachment data
        if (query.includes('has:attachment') && includeAttachments !== true) {
          correctedConfig.include_attachments = true

          result.corrections.push({
            from: 'include_attachments (missing or false)',
            to: 'include_attachments',
            value: true,
            confidence: 'high',
            reason: `Query searches for attachments ("${query}") but include_attachments was ${includeAttachments}. Auto-corrected to true.`
          })

          logger.warn({
            pluginKey,
            actionName,
            query,
            previousValue: includeAttachments,
            newValue: true,
            msg: 'Auto-corrected include_attachments based on query intent'
          })
        }
      }

      // Set corrected config if any corrections were made
      if (result.corrections.length > 0) {
        result.correctedConfig = correctedConfig
      }

      return result

    } catch (error) {
      result.errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`)
      result.valid = false
      return result
    }
  }

  /**
   * Validate and correct all plugin operations in an execution graph
   */
  validateExecutionGraph(graph: any): { corrections: number; errors: string[] } {
    let totalCorrections = 0
    const errors: string[] = []

    if (!graph || !graph.nodes) {
      return { corrections: 0, errors: ['Invalid execution graph'] }
    }

    // Walk through all nodes
    for (const [nodeId, node] of Object.entries(graph.nodes as Record<string, any>)) {
      if (node.type !== 'operation') continue

      const operation = node.operation
      if (!operation) continue

      // Validate fetch operations
      if (operation.operation_type === 'fetch' && operation.fetch) {
        const result = this.validateAndCorrect(
          operation.fetch.plugin_key,
          operation.fetch.action,
          operation.fetch.config || {}
        )

        if (result.correctedConfig) {
          operation.fetch.config = result.correctedConfig
          totalCorrections += result.corrections.length
        }

        if (!result.valid) {
          errors.push(`Node ${nodeId}: ${result.errors.join(', ')}`)
        }
      }

      // Validate deliver operations
      if (operation.operation_type === 'deliver' && operation.deliver) {
        const result = this.validateAndCorrect(
          operation.deliver.plugin_key,
          operation.deliver.action,
          operation.deliver.config || {}
        )

        if (result.correctedConfig) {
          operation.deliver.config = result.correctedConfig
          totalCorrections += result.corrections.length
        }

        if (!result.valid) {
          errors.push(`Node ${nodeId}: ${result.errors.join(', ')}`)
        }
      }
    }

    logger.info({
      totalCorrections,
      totalErrors: errors.length,
      msg: 'Execution graph parameter validation complete'
    })

    return { corrections: totalCorrections, errors }
  }
}
