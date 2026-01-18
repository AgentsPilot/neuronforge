/**
 * Declarative IR Validator
 *
 * Validates that IR is purely declarative with NO execution details.
 * Inspired by OpenAI's strict validation approach.
 */

import type { DeclarativeLogicalIR, IRValidationResult, IRValidationError } from '../schemas/declarative-ir-types'
import Ajv from 'ajv'

// ============================================================================
// Forbidden Tokens - IR must NOT contain these
// ============================================================================

export const FORBIDDEN_IR_TOKENS = [
  // Execution field names
  '"plugin"',
  '"step_id"',
  '"execute"',
  '"workflow_steps"',
  '"dag"',

  // Loop field names (compiler infers loops from delivery_rules)
  '"loops"',
  '"for_each"',
  '"do"',
  '"scatter_gather"',
  '"fanout"',

  // Operation ID field
  '"id":'
]

// ============================================================================
// Validator Class
// ============================================================================

export class DeclarativeIRValidator {
  private ajv: Ajv
  private validateSchema: any
  private schemaCompiled = false

  constructor() {
    this.ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false })
  }

  /**
   * Lazy schema compilation to avoid bundling large schema at import time
   */
  private ensureSchemaCompiled(): void {
    if (!this.schemaCompiled) {
      // Dynamic require to avoid bundling schema at module load time
      const { DECLARATIVE_IR_SCHEMA_STRICT } = require('../schemas/declarative-ir-schema-strict')
      this.validateSchema = this.ajv.compile(DECLARATIVE_IR_SCHEMA_STRICT)
      this.schemaCompiled = true
    }
  }

  /**
   * Validate declarative IR
   *
   * Checks:
   * 1. JSON schema validation
   * 2. Forbidden token check
   * 3. Semantic validation
   */
  validate(ir: any): IRValidationResult {
    // Ensure schema is compiled on first use
    this.ensureSchemaCompiled()

    const errors: IRValidationError[] = []

    // Step 1: Schema validation
    const schemaValid = this.validateSchema(ir)
    if (!schemaValid) {
      const schemaErrors = this.validateSchema.errors ?? []
      console.log('[DeclarativeIRValidator] AJV Errors:', JSON.stringify(schemaErrors, null, 2))
      schemaErrors.forEach((err: any) => {
        errors.push({
          error_code: 'INVALID_SCHEMA',
          message: `${err.instancePath || '$'} ${err.message || 'invalid'} ${err.params ? JSON.stringify(err.params) : ''}`,
          ir_path: err.instancePath || '$'
        })
      })
    }

    // Step 2: Forbidden token check
    const tokenErrors = this.checkForbiddenTokens(ir)
    errors.push(...tokenErrors)

    // Step 3: Semantic validation
    const semanticErrors = this.validateSemantics(ir)
    errors.push(...semanticErrors)

    return {
      valid: errors.length === 0,
      errors
    }
  }

  /**
   * Check for forbidden execution tokens
   */
  private checkForbiddenTokens(ir: any): IRValidationError[] {
    const errors: IRValidationError[] = []
    const raw = JSON.stringify(ir).toLowerCase()

    for (const token of FORBIDDEN_IR_TOKENS) {
      if (raw.includes(token.toLowerCase())) {
        errors.push({
          error_code: 'FORBIDDEN_TOKEN',
          message: `IR contains forbidden execution token: "${token}"`,
          leaked_token: token
        })
      }
    }

    return errors
  }

  /**
   * Check for redundant filters
   *
   * Having both plugin-native query AND IR filters is a valid pattern:
   * - Plugin query: What data to fetch from the source (e.g., "in:inbox newer_than:7d")
   * - IR filters: What subset of fetched data to process (e.g., contains "complaint")
   *
   * These are complementary, not redundant. This check is now disabled as it was
   * producing false positives for valid workflows.
   */
  private checkRedundantFilters(_ir: DeclarativeLogicalIR): IRValidationError[] {
    // Disabled: Plugin queries and IR filters serve different purposes
    // Plugin query = what to fetch, IR filters = what to process from fetched data
    return []
  }

  /**
   * Semantic validation
   */
  private validateSemantics(ir: DeclarativeLogicalIR): IRValidationError[] {
    const errors: IRValidationError[] = []

    // Check for redundant filters (filters that duplicate data source query logic)
    const redundantFilterErrors = this.checkRedundantFilters(ir)
    errors.push(...redundantFilterErrors)

    // ========================================================================
    // CRITICAL: Validate data_sources have plugin_key and operation_type
    // These are required for compilation - null values will cause failures
    // ========================================================================
    if (ir.data_sources && ir.data_sources.length > 0) {
      ir.data_sources.forEach((ds, idx) => {
        if (!ds.plugin_key || ds.plugin_key === null) {
          errors.push({
            error_code: 'MISSING_REQUIRED_FIELD',
            message: `Data source at index ${idx} is missing 'plugin_key'. This is required for compilation.`,
            ir_path: `$.data_sources[${idx}].plugin_key`,
            suggestion: `Specify the plugin_key (e.g., "google-mail", "google-sheets", "outlook-mail")`
          })
        }
        if (!ds.operation_type || ds.operation_type === null) {
          errors.push({
            error_code: 'MISSING_REQUIRED_FIELD',
            message: `Data source at index ${idx} is missing 'operation_type'. This is required for compilation.`,
            ir_path: `$.data_sources[${idx}].operation_type`,
            suggestion: `Specify the operation_type (e.g., "read", "search", "list", "fetch")`
          })
        }
      })
    }

    // ========================================================================
    // CRITICAL: Validate filter conditions have field names
    // Null field values will cause "cannot compile deterministically" errors
    // ========================================================================
    if (ir.filters?.conditions) {
      ir.filters.conditions.forEach((cond, idx) => {
        if (!cond.field || cond.field === null) {
          errors.push({
            error_code: 'MISSING_REQUIRED_FIELD',
            message: `Filter condition at index ${idx} is missing 'field'. This is required for filtering.`,
            ir_path: `$.filters.conditions[${idx}].field`,
            suggestion: `Specify the field name to filter on (e.g., "date", "status", "amount")`
          })
        }
      })
    }

    // Also check nested filter groups
    if (ir.filters?.groups) {
      ir.filters.groups.forEach((group, groupIdx) => {
        if (group.conditions) {
          group.conditions.forEach((cond, condIdx) => {
            if (!cond.field || cond.field === null) {
              errors.push({
                error_code: 'MISSING_REQUIRED_FIELD',
                message: `Filter condition at groups[${groupIdx}].conditions[${condIdx}] is missing 'field'.`,
                ir_path: `$.filters.groups[${groupIdx}].conditions[${condIdx}].field`,
                suggestion: `Specify the field name to filter on`
              })
            }
          })
        }
      })
    }

    // Check delivery_rules is present
    if (!ir.delivery_rules) {
      errors.push({
        error_code: 'MISSING_REQUIRED_FIELD',
        message: 'delivery_rules is required',
        ir_path: '$.delivery_rules'
      })
      return errors // Can't proceed without delivery_rules
    }

    // Check at least one delivery method is specified with a valid plugin_key
    // This check is plugin-agnostic: delivery can be email, google-sheets, slack, airtable, etc.
    const { per_item_delivery, per_group_delivery, summary_delivery, multiple_destinations } = ir.delivery_rules
    const hasValidDelivery =
      (per_item_delivery && per_item_delivery.plugin_key) ||
      (per_group_delivery && per_group_delivery.plugin_key) ||
      (summary_delivery && summary_delivery.plugin_key) ||
      (multiple_destinations && multiple_destinations.length > 0 && multiple_destinations.every(d => d.plugin_key))

    if (!hasValidDelivery) {
      errors.push({
        error_code: 'MISSING_REQUIRED_FIELD',
        message: 'At least one delivery method must be specified with a valid plugin_key (per_item_delivery, per_group_delivery, summary_delivery, or multiple_destinations)',
        ir_path: '$.delivery_rules'
      })
    }

    // ========================================================================
    // CRITICAL: Validate delivery methods have operation_type
    // This is required for the compiler to know which plugin action to call
    // ========================================================================
    if (per_item_delivery && per_item_delivery.plugin_key && !per_item_delivery.operation_type) {
      errors.push({
        error_code: 'MISSING_REQUIRED_FIELD',
        message: `per_item_delivery has plugin_key but missing 'operation_type'.`,
        ir_path: '$.delivery_rules.per_item_delivery.operation_type',
        suggestion: `Specify the operation_type (e.g., "send", "post", "publish")`
      })
    }
    if (per_group_delivery && per_group_delivery.plugin_key && !per_group_delivery.operation_type) {
      errors.push({
        error_code: 'MISSING_REQUIRED_FIELD',
        message: `per_group_delivery has plugin_key but missing 'operation_type'.`,
        ir_path: '$.delivery_rules.per_group_delivery.operation_type',
        suggestion: `Specify the operation_type (e.g., "send", "post", "publish")`
      })
    }
    if (summary_delivery && summary_delivery.plugin_key && !summary_delivery.operation_type) {
      errors.push({
        error_code: 'MISSING_REQUIRED_FIELD',
        message: `summary_delivery has plugin_key but missing 'operation_type'.`,
        ir_path: '$.delivery_rules.summary_delivery.operation_type',
        suggestion: `Specify the operation_type (e.g., "send", "post", "publish")`
      })
    }
    if (multiple_destinations && multiple_destinations.length > 0) {
      multiple_destinations.forEach((dest, idx) => {
        if (dest.plugin_key && !dest.operation_type) {
          errors.push({
            error_code: 'MISSING_REQUIRED_FIELD',
            message: `multiple_destinations[${idx}] has plugin_key but missing 'operation_type'.`,
            ir_path: `$.delivery_rules.multiple_destinations[${idx}].operation_type`,
            suggestion: `Specify the operation_type (e.g., "send", "post", "append_rows")`
          })
        }
        // Wave 8: Validate recipient OR recipient_source is present
        // recipient = static email address, recipient_source = dynamic field name (for per-group delivery)
        if (!dest.recipient && !dest.recipient_source) {
          errors.push({
            error_code: 'MISSING_REQUIRED_FIELD',
            message: `multiple_destinations[${idx}] is missing 'recipient' or 'recipient_source'. One is required for delivery.`,
            ir_path: `$.delivery_rules.multiple_destinations[${idx}].recipient`,
            suggestion: `Specify either 'recipient' (static email) or 'recipient_source' (field name containing recipient)`
          })
        }
      })
    }

    // If per_group_delivery, must have grouping
    if (per_group_delivery && !ir.grouping) {
      errors.push({
        error_code: 'MISSING_REQUIRED_FIELD',
        message: 'per_group_delivery requires grouping to be specified',
        ir_path: '$.grouping'
      })
    }

    // If grouping references partition, partition must exist
    if (ir.grouping) {
      const groupField = ir.grouping.group_by
      // Only validate if group_by is not null, empty string, or "none" (which means no grouping)
      if (groupField !== null && groupField !== '' && groupField !== 'none' && ir.partitions) {
        const partitionExists = ir.partitions.some(p => p.field === groupField)
        if (!partitionExists) {
          errors.push({
            error_code: 'INVALID_REFERENCE',
            message: `grouping.group_by references field "${groupField}" but no partition exists for this field`,
            ir_path: '$.grouping.group_by'
          })
        }
      }
    }

    // Check AI operations have required fields
    if (ir.ai_operations) {
      ir.ai_operations.forEach((aiOp, idx) => {
        if (!aiOp.type) {
          errors.push({
            error_code: 'MISSING_REQUIRED_FIELD',
            message: `AI operation at index ${idx} is missing 'type'`,
            ir_path: `$.ai_operations[${idx}].type`
          })
        }
        if (!aiOp.instruction) {
          errors.push({
            error_code: 'MISSING_REQUIRED_FIELD',
            message: `AI operation at index ${idx} is missing 'instruction'`,
            ir_path: `$.ai_operations[${idx}].instruction`
          })
        }
        if (!aiOp.output_schema) {
          errors.push({
            error_code: 'MISSING_REQUIRED_FIELD',
            message: `AI operation at index ${idx} is missing 'output_schema'`,
            ir_path: `$.ai_operations[${idx}].output_schema`
          })
        }
      })
    }

    return errors
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Quick validation function
 */
export function validateDeclarativeIR(ir: any): IRValidationResult {
  const validator = new DeclarativeIRValidator()
  return validator.validate(ir)
}

/**
 * Check if IR contains forbidden tokens (fast check)
 */
export function hasForbiddenTokens(ir: any): { hasForbidden: boolean; tokens: string[] } {
  const raw = JSON.stringify(ir).toLowerCase()
  const found: string[] = []

  for (const token of FORBIDDEN_IR_TOKENS) {
    if (raw.includes(token.toLowerCase())) {
      found.push(token)
    }
  }

  return {
    hasForbidden: found.length > 0,
    tokens: found
  }
}
