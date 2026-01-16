/**
 * Extended Logical IR Zod Validation Schemas
 *
 * Validates IR structure using Zod before compilation.
 * Also provides normalization and error formatting.
 */

import { z } from 'zod'
import type {
  ExtendedLogicalIR,
  ValidationResult,
  IRValidationResult
} from './extended-ir-types'

// ============================================================================
// Base Schemas
// ============================================================================

export const DataSourceSchema = z.object({
  id: z.string(),
  type: z.enum(['tabular', 'api', 'webhook', 'database', 'file', 'stream']),
  source: z.string().optional(),
  location: z.string(),
  tab: z.string().optional(),
  endpoint: z.string().optional(),
  trigger: z.string().optional(),
  role: z.string().optional()
})

const NormalizationSchema = z.object({
  required_headers: z.array(z.string()).min(1),
  case_sensitive: z.boolean().optional(),
  missing_header_action: z.enum(['error', 'warn', 'ignore']).optional()
})

export const FilterSchema = z.object({
  id: z.string().optional(),
  field: z.string(),
  operator: z.enum([
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'greater_than',
    'less_than',
    'greater_than_or_equal',
    'less_than_or_equal',
    'in',
    'not_in',
    'is_empty',
    'is_not_empty'
  ]),
  value: z.any(),
  description: z.string().optional()
})

const TransformConfigSchema = z.object({
  source: z.string().optional(),
  field: z.string().optional(),
  group_by: z.string().optional(),
  sort_by: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional(),
  aggregation: z.enum(['sum', 'count', 'average', 'min', 'max']).optional(),
  join_key: z.string().optional(),
  condition: z.any().optional(),  // Recursive, defined below
  mapping: z.string().optional()
})

const TransformSchema = z.object({
  id: z.string().optional(),
  operation: z.enum([
    'map',
    'filter',
    'reduce',
    'sort',
    'group',
    'aggregate',
    'join',
    'deduplicate',
    'flatten'
  ]),
  config: TransformConfigSchema
})

const OutputFieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean().optional(),
  description: z.string().optional()
})

const OutputSchemaSchema = z.object({
  type: z.enum(['string', 'object', 'array', 'number', 'boolean']),
  fields: z.array(OutputFieldSchema).optional(),
  enum: z.array(z.string()).optional()
})

const AIConstraintsSchema = z.object({
  max_tokens: z.number().optional(),
  temperature: z.number().min(0).max(1).optional(),
  model_preference: z.enum(['fast', 'accurate', 'balanced']).optional()
})

export const AIOperationSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['summarize', 'extract', 'classify', 'sentiment', 'generate', 'decide']),
  instruction: z.string().min(5),
  input_source: z.string(),
  output_schema: OutputSchemaSchema,
  constraints: AIConstraintsSchema.optional()
})

const ConditionSchema: any = z.lazy(() =>
  z.object({
    type: z.enum(['simple', 'complex_and', 'complex_or', 'complex_not']),
    field: z.string().optional(),
    operator: z.enum([
      'equals',
      'not_equals',
      'contains',
      'greater_than',
      'less_than',
      'in',
      'is_empty',
      'is_not_empty'
    ]).optional(),
    value: z.any().optional(),
    conditions: z.array(ConditionSchema).optional()
  })
)

// NOTE: IntentActionSchema no longer needed - then/else/do are now string arrays
// for OpenAI strict mode compatibility (no additionalProperties: true allowed)

export const ConditionalSchema = z.object({
  id: z.string().optional(),
  when: ConditionSchema,
  then: z.array(z.string()),
  else: z.array(z.string()).optional()
})

export const LoopSchema = z.object({
  id: z.string().optional(),
  for_each: z.string(),
  item_variable: z.string(),
  do: z.array(z.string()),
  max_iterations: z.number().optional(),
  max_concurrency: z.number().optional()
})

const PartitionSchema = z.object({
  id: z.string().optional(),
  field: z.string(),
  split_by: z.enum(['value', 'condition']),
  condition: ConditionSchema.optional(),
  handle_empty: z.object({
    partition_name: z.string(),
    description: z.string().optional()
  }).optional()
})

const GroupingSchema = z.object({
  input_partition: z.string(),
  group_by: z.string(),
  emit_per_group: z.boolean()
})

const RenderingSchema = z.object({
  type: z.enum([
    'html_table',
    'email_embedded_table',
    'json',
    'csv',
    'template',
    'summary_block',
    'alert',
    'none'
  ]),
  template: z.string().optional(),
  engine: z.enum(['jinja', 'handlebars', 'mustache']).optional(),
  columns_in_order: z.array(z.string()).optional(),
  empty_message: z.string().optional()
})

const DeliveryConfigSchema = z.object({
  recipient: z.union([z.string(), z.array(z.string())]).optional(),
  recipient_source: z.string().optional(),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  channel: z.string().optional(),
  message: z.string().optional(),
  url: z.string().optional(),
  endpoint: z.string().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
  headers: z.string().optional(),
  payload: z.string().optional(),
  table: z.string().optional(),
  operation: z.enum(['insert', 'update', 'delete']).optional(),
  path: z.string().optional(),
  format: z.enum(['json', 'csv', 'txt']).optional()
})

export const DeliverySchema = z.object({
  id: z.string().optional(),
  method: z.enum(['email', 'slack', 'webhook', 'database', 'api_call', 'file', 'sms']),
  config: DeliveryConfigSchema
})

const EdgeCaseSchema = z.object({
  condition: z.enum([
    'no_rows_after_filter',
    'empty_data_source',
    'missing_required_field',
    'duplicate_records',
    'rate_limit_exceeded',
    'api_error'
  ]),
  action: z.enum([
    'send_empty_result_message',
    'skip_execution',
    'use_default_value',
    'retry',
    'alert_admin'
  ]),
  message: z.string().optional(),
  recipient: z.string().optional()
})

// ============================================================================
// Main IR Schema
// ============================================================================

export const ExtendedLogicalIRSchema = z.object({
  ir_version: z.string(),
  goal: z.string().min(5),

  // Data Layer
  data_sources: z.array(DataSourceSchema).min(1),
  normalization: NormalizationSchema.optional(),

  // Processing Layer
  filters: z.array(FilterSchema).optional(),
  transforms: z.array(TransformSchema).optional(),
  ai_operations: z.array(AIOperationSchema).optional(),

  // Control Flow
  conditionals: z.array(ConditionalSchema).optional(),
  loops: z.array(LoopSchema).optional(),
  partitions: z.array(PartitionSchema).optional(),
  grouping: GroupingSchema.optional(),

  // Output Layer
  rendering: RenderingSchema.optional(),
  delivery: z.array(DeliverySchema).min(1),

  // Error Handling
  edge_cases: z.array(EdgeCaseSchema).optional(),
  clarifications_required: z.array(z.string())
})

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate IR structure using Zod
 */
export function validateIR(ir: unknown): IRValidationResult {
  console.log('[ExtendedIR] Starting validation...')
  console.log('[ExtendedIR] IR keys:', Object.keys(ir || {}))

  try {
    console.log('[ExtendedIR] Running Zod schema validation...')
    const parsed = ExtendedLogicalIRSchema.parse(ir)
    console.log('[ExtendedIR] ✓ Zod validation passed')

    // Additional custom validations
    console.log('[ExtendedIR] Running custom validation rules...')
    const customValidation = validateCustomRules(parsed as unknown as ExtendedLogicalIR)
    if (!customValidation.valid) {
      console.log('[ExtendedIR] ✗ Custom validation failed:', customValidation.errors)
      return customValidation
    }
    console.log('[ExtendedIR] ✓ Custom validation passed')

    if (customValidation.warnings && customValidation.warnings.length > 0) {
      console.warn('[ExtendedIR] ⚠ Validation warnings:', customValidation.warnings)
    }

    console.log('[ExtendedIR] ✓ Validation successful')
    return {
      valid: true,
      errors: [],
      warnings: customValidation.warnings,
      normalizedIR: parsed as unknown as ExtendedLogicalIR
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      const formattedErrors = formatZodErrors(error)
      console.log('[ExtendedIR] ✗ Zod validation failed:', formattedErrors)
      return {
        valid: false,
        errors: formattedErrors
      }
    }

    const errorMsg = `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    console.log('[ExtendedIR] ✗ Validation error:', errorMsg)
    return {
      valid: false,
      errors: [errorMsg]
    }
  }
}

/**
 * Custom validation rules beyond Zod schema
 */
function validateCustomRules(ir: ExtendedLogicalIR): IRValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  console.log('[ExtendedIR] Custom Rule 1: Checking for execution tokens...')
  // Rule 1: No execution tokens allowed (except in legitimate field names)
  const irString = JSON.stringify(ir)
  const forbiddenPatterns = [
    { token: 'plugin', exclude: [] },
    { token: 'step_id', exclude: [] },
    { token: 'execute', exclude: [] },
    { token: 'workflow_steps', exclude: [] }
  ]

  for (const { token, exclude } of forbiddenPatterns) {
    if (irString.includes(`"${token}"`)) {
      // Check if it's not in an excluded context
      const isExcluded = exclude.some(ex => irString.includes(ex))
      if (!isExcluded) {
        console.log(`[ExtendedIR] ✗ Found forbidden token: ${token}`)
        errors.push(`IR contains forbidden execution token: "${token}". IR should only contain intent, not execution details.`)
      }
    }
  }

  // Note: "action" is allowed as it's a legitimate field in edge_cases

  console.log('[ExtendedIR] Custom Rule 2: Checking variable syntax...')
  // Rule 2: Variable references must use {{}} syntax
  const variablePattern = /\{\{[^}]+\}\}/
  if (ir.filters) {
    for (const filter of ir.filters) {
      if (typeof filter.value === 'string' && filter.value.includes('step') && !variablePattern.test(filter.value)) {
        console.log(`[ExtendedIR] ⚠ Suspicious variable reference: ${filter.value}`)
        warnings.push(`Filter value "${filter.value}" looks like a variable reference but doesn't use {{}} syntax`)
      }
    }
  }

  console.log('[ExtendedIR] Custom Rule 3: Checking AI operations...')
  // Rule 3: AI operations must have output_schema
  if (ir.ai_operations) {
    console.log(`[ExtendedIR] Found ${ir.ai_operations.length} AI operations`)
    for (const aiOp of ir.ai_operations) {
      if (!aiOp.output_schema) {
        console.log(`[ExtendedIR] ✗ AI operation missing output_schema: ${aiOp.id || aiOp.type}`)
        errors.push(`AI operation "${aiOp.id || aiOp.type}" missing required output_schema`)
      }
    }
  }

  console.log('[ExtendedIR] Custom Rule 4: Checking conditionals...')
  // Rule 4: Conditionals must have both when and then
  if (ir.conditionals) {
    console.log(`[ExtendedIR] Found ${ir.conditionals.length} conditionals`)
    for (const cond of ir.conditionals) {
      if (!cond.when) {
        console.log(`[ExtendedIR] ✗ Conditional missing 'when': ${cond.id || 'unnamed'}`)
        errors.push(`Conditional "${cond.id || 'unnamed'}" missing required 'when' condition`)
      }
      if (!cond.then || cond.then.length === 0) {
        console.log(`[ExtendedIR] ✗ Conditional missing 'then': ${cond.id || 'unnamed'}`)
        errors.push(`Conditional "${cond.id || 'unnamed'}" missing required 'then' actions`)
      }
    }
  }

  console.log('[ExtendedIR] Custom Rule 5: Checking loops...')
  // Rule 5: Loops must have for_each and do
  if (ir.loops) {
    console.log(`[ExtendedIR] Found ${ir.loops.length} loops`)
    for (const loop of ir.loops) {
      if (!loop.for_each) {
        console.log(`[ExtendedIR] ✗ Loop missing 'for_each': ${loop.id || 'unnamed'}`)
        errors.push(`Loop "${loop.id || 'unnamed'}" missing required 'for_each' field`)
      }
      if (!loop.do || loop.do.length === 0) {
        console.log(`[ExtendedIR] ✗ Loop missing 'do': ${loop.id || 'unnamed'}`)
        errors.push(`Loop "${loop.id || 'unnamed'}" missing required 'do' actions`)
      }
    }
  }

  console.log('[ExtendedIR] Custom Rule 6: Checking delivery configs...')
  // Rule 6: Delivery must have valid method + config
  console.log(`[ExtendedIR] Found ${ir.delivery.length} delivery methods`)
  for (const delivery of ir.delivery) {
    if (delivery.method === 'email' && !delivery.config.recipient && !delivery.config.recipient_source) {
      console.log(`[ExtendedIR] ✗ Email delivery missing recipient: ${delivery.id || 'unnamed'}`)
      errors.push(`Email delivery "${delivery.id || 'unnamed'}" missing recipient or recipient_source`)
    }
    if (delivery.method === 'slack' && !delivery.config.channel) {
      console.log(`[ExtendedIR] ✗ Slack delivery missing channel: ${delivery.id || 'unnamed'}`)
      errors.push(`Slack delivery "${delivery.id || 'unnamed'}" missing channel`)
    }
  }

  console.log(`[ExtendedIR] Custom rules complete. Errors: ${errors.length}, Warnings: ${warnings.length}`)
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalizedIR: ir
  }
}

/**
 * Format Zod errors into user-friendly messages
 */
function formatZodErrors(error: z.ZodError): string[] {
  return error.errors.map(err => {
    const path = err.path.join('.')
    return `${path}: ${err.message}`
  })
}

/**
 * Normalize IR (fix common LLM quirks)
 */
export function normalizeIR(ir: unknown): ExtendedLogicalIR {
  console.log('[ExtendedIR] Starting normalization...')
  // This is similar to normalizePhase4Response pattern
  const normalized = { ...(ir as object) } as any

  console.log('[ExtendedIR] Normalizing arrays...')
  // Ensure arrays are arrays
  if (normalized.data_sources && !Array.isArray(normalized.data_sources)) {
    console.log('[ExtendedIR] Converting data_sources to array')
    normalized.data_sources = [normalized.data_sources]
  }
  if (normalized.delivery && !Array.isArray(normalized.delivery)) {
    console.log('[ExtendedIR] Converting delivery to array')
    normalized.delivery = [normalized.delivery]
  }
  if (normalized.clarifications_required && !Array.isArray(normalized.clarifications_required)) {
    console.log('[ExtendedIR] Converting clarifications_required to array')
    normalized.clarifications_required = [normalized.clarifications_required]
  }

  // Ensure clarifications_required exists
  if (!normalized.clarifications_required) {
    console.log('[ExtendedIR] Adding empty clarifications_required array')
    normalized.clarifications_required = []
  }

  // Set default IR version
  if (!normalized.ir_version) {
    console.log('[ExtendedIR] Setting default IR version 2.0')
    normalized.ir_version = '2.0'
  }

  console.log('[ExtendedIR] Normalization complete')
  return normalized as ExtendedLogicalIR
}
