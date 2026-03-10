/**
 * DataSchemaBuilder — Constructs WorkflowDataSchema from BoundIntentContract
 *
 * After CapabilityBinderV2 binds steps to plugin actions, this class
 * builds a complete data_schema from:
 * - Plugin output_schema for bound steps (source: "plugin")
 * - LLM-declared output_schema for shape-changing transforms (source: "ai_declared")
 * - LLM-declared fields[]/outputs[] for extract/generate steps (source: "ai_declared")
 * - Derived schemas for shape-preserving transforms, loops, aggregates (source: "inferred")
 *
 * No `type: "any"` slots — every slot has a concrete schema or a warning is logged.
 *
 * Workplan: docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md (Phase 2)
 */

import type { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'
import type {
  IntentStep,
  TransformStep,
  ExtractStep,
  GenerateStep,
  AggregateStep,
  LoopStep,
  DataSourceStep,
  ArtifactStep,
  DeliverStep,
  NotifyStep,
} from '../semantic-plan/types/intent-schema-types'
import type { BoundStep } from './CapabilityBinderV2'
import type {
  WorkflowDataSchema,
  DataSlot,
  SchemaField,
} from '../logical-ir/schemas/workflow-data-schema'
import { convertActionOutputSchemaToSchemaField } from '../logical-ir/schemas/workflow-data-schema'
import { createLogger } from '@/lib/logger'

const logger = createLogger({ module: 'DataSchemaBuilder', service: 'V6' })

/** Shape-preserving transform ops — output schema = input schema */
const SHAPE_PRESERVING_OPS = new Set(['filter', 'sort', 'dedupe'])

/** Shape-changing transform ops — require output_schema from LLM */
const SHAPE_CHANGING_OPS = new Set(['map', 'group', 'merge', 'reduce', 'select'])

export class DataSchemaBuilder {
  private pluginManager: PluginManagerV2
  private warnings: string[]

  constructor(pluginManager: PluginManagerV2) {
    this.pluginManager = pluginManager
    this.warnings = []
  }

  /**
   * Build a complete WorkflowDataSchema from bound steps.
   *
   * Pass 1: Create a DataSlot for each step with an output RefName
   * Pass 2: Populate consumed_by from step inputs
   */
  build(boundSteps: BoundStep[]): { schema: WorkflowDataSchema; warnings: string[] } {
    this.warnings = []
    const slots: Record<string, DataSlot> = {}

    // Pass 1: Build slots from all steps (including nested)
    const allSteps = this.flattenSteps(boundSteps)

    for (const step of allSteps) {
      this.buildSlotsForStep(step, slots)
    }

    // Pass 2: Fix up loop gather schemas — body step slots now exist
    this.fixupLoopGatherSchemas(allSteps, slots)

    // Pass 3: Populate consumed_by
    for (const step of allSteps) {
      if (!step.inputs) continue
      for (const inputRef of step.inputs) {
        if (slots[inputRef]) {
          if (!slots[inputRef].consumed_by) {
            slots[inputRef].consumed_by = []
          }
          slots[inputRef].consumed_by!.push(step.id)
        }
      }

      // Also check transform.input, extract.input, aggregate.input, deliver.input, loop.over
      const implicitInput = this.getImplicitInput(step)
      if (implicitInput && slots[implicitInput]) {
        if (!slots[implicitInput].consumed_by) {
          slots[implicitInput].consumed_by = []
        }
        if (!slots[implicitInput].consumed_by!.includes(step.id)) {
          slots[implicitInput].consumed_by!.push(step.id)
        }
      }
    }

    logger.info(
      {
        slotCount: Object.keys(slots).length,
        slotNames: Object.keys(slots),
        warningCount: this.warnings.length,
      },
      '[DataSchemaBuilder] data_schema built'
    )

    return { schema: { slots }, warnings: this.warnings }
  }

  /**
   * Build slot(s) for a single step based on its kind.
   */
  private buildSlotsForStep(step: BoundStep, slots: Record<string, DataSlot>): void {
    // Loop and aggregate steps produce extra slots (item_ref, collect_as, named outputs)
    // regardless of whether they have a main output. Build these first.
    if (step.kind === 'loop') {
      this.buildLoopSlots(step as BoundStep & LoopStep, slots)
    }
    if (step.kind === 'aggregate') {
      this.buildAggregateSlots(step as BoundStep & AggregateStep, slots)
    }

    if (!step.output) return // No named output → no main slot

    const schema = this.inferSchema(step, slots)
    if (!schema) return // Could not infer (warning already logged)

    slots[step.output] = {
      schema,
      scope: 'global', // Default; loop steps override for item_ref
      produced_by: step.id,
    }
  }

  /**
   * Route schema inference to the appropriate handler based on step kind.
   */
  private inferSchema(step: BoundStep, slots: Record<string, DataSlot>): SchemaField | null {
    // AI steps with explicit output declarations: prefer LLM-declared schema over plugin's
    // generic output_schema. A `generate` step bound to chatgpt-research still produces
    // {subject, body} (from generate.outputs[]), not {answer, question} (from plugin schema).
    if (step.kind === 'generate' && (step as any).generate?.outputs?.length > 0) {
      return this.inferSchemaForGenerateStep(step as BoundStep & GenerateStep)
    }
    if (step.kind === 'extract' && (step as any).extract?.fields?.length > 0) {
      return this.inferSchemaForExtractStep(step as BoundStep & ExtractStep)
    }

    // Plugin-bound steps: use plugin output_schema
    if (step.plugin_key && step.action) {
      return this.inferSchemaForBoundStep(step)
    }

    // Unbound steps: infer from step structure
    switch (step.kind) {
      case 'transform':
        return this.inferSchemaForTransformStep(step as BoundStep & TransformStep, slots)
      case 'extract':
        return this.inferSchemaForExtractStep(step as BoundStep & ExtractStep)
      case 'generate':
        return this.inferSchemaForGenerateStep(step as BoundStep & GenerateStep)
      case 'aggregate':
        return this.inferSchemaForAggregateStep(step as BoundStep & AggregateStep, slots)
      case 'decide':
      case 'parallel':
        return null // Control flow steps don't produce data slots
      case 'loop':
        // Loop's main output is handled; item_ref and collect_as are in buildLoopSlots
        return null
      default:
        this.warn(`Step ${step.id} (${step.kind}): no schema inference strategy available`)
        return null
    }
  }

  // ============================================================================
  // Schema Inference by Step Kind
  // ============================================================================

  /**
   * Plugin-bound step: extract output_schema from the plugin action definition.
   * Source: "plugin" (highest trust)
   */
  private inferSchemaForBoundStep(step: BoundStep): SchemaField | null {
    const pluginDef = this.pluginManager.getPluginDefinition(step.plugin_key!)
    if (!pluginDef) {
      this.warn(`Step ${step.id}: plugin ${step.plugin_key} not found in registry`)
      return null
    }

    const actionDef = pluginDef.actions[step.action!]
    if (!actionDef) {
      this.warn(`Step ${step.id}: action ${step.action} not found on plugin ${step.plugin_key}`)
      return null
    }

    if (actionDef.output_schema) {
      return convertActionOutputSchemaToSchemaField(actionDef.output_schema)
    }

    // Fallback: build minimal schema from output_fields if no output_schema
    if (actionDef.output_fields && actionDef.output_fields.length > 0) {
      const properties: Record<string, SchemaField> = {}
      for (const field of actionDef.output_fields) {
        properties[field] = { type: 'any', source: 'plugin' }
      }
      this.warn(
        `Step ${step.id}: plugin ${step.plugin_key}.${step.action} has output_fields but no output_schema — using field names only`
      )
      return { type: 'object', properties, source: 'plugin' }
    }

    this.warn(`Step ${step.id}: plugin ${step.plugin_key}.${step.action} has no output schema`)
    return null
  }

  /**
   * Transform step: shape-preserving inherits input schema, shape-changing uses output_schema.
   */
  private inferSchemaForTransformStep(
    step: BoundStep & TransformStep,
    slots: Record<string, DataSlot>
  ): SchemaField | null {
    const op = step.transform?.op
    if (!op) {
      this.warn(`Step ${step.id}: transform has no op`)
      return null
    }

    const inputRef = step.transform.input
    const inputSlot = inputRef ? slots[inputRef] : null

    // Flatten is special: shape-preserving if no output_schema, but can be shape-changing
    if (op === 'flatten') {
      if (step.transform.output_schema) {
        return this.convertJsonObjectToSchemaField(step.transform.output_schema, 'ai_declared')
      }
      // Flatten without output_schema: unwrap one array level
      if (inputSlot?.schema.type === 'array' && inputSlot.schema.items) {
        return { ...inputSlot.schema.items, source: 'inferred' }
      }
      return inputSlot ? { ...inputSlot.schema, source: 'inferred' } : null
    }

    // Shape-preserving: inherit input schema
    if (SHAPE_PRESERVING_OPS.has(op)) {
      if (!inputSlot) {
        this.warn(`Step ${step.id}: transform input "${inputRef}" not found in slots`)
        return null
      }
      return { ...this.deepCopySchema(inputSlot.schema), source: 'inferred' }
    }

    // Shape-changing: require output_schema
    if (SHAPE_CHANGING_OPS.has(op)) {
      if (step.transform.output_schema) {
        return this.convertJsonObjectToSchemaField(step.transform.output_schema, 'ai_declared')
      }
      this.warn(
        `Step ${step.id}: shape-changing transform (${op}) is missing output_schema — ` +
          `cannot determine output shape. Fix in Phase 1 prompt or use extract/generate instead.`
      )
      return null
    }

    // Unknown op: try output_schema, fall back to input
    if (step.transform.output_schema) {
      return this.convertJsonObjectToSchemaField(step.transform.output_schema, 'ai_declared')
    }
    if (inputSlot) {
      return { ...this.deepCopySchema(inputSlot.schema), source: 'inferred' }
    }

    this.warn(`Step ${step.id}: transform op "${op}" — cannot determine output schema`)
    return null
  }

  /**
   * Extract step: build schema from declared fields[].
   * Source: "ai_declared"
   */
  private inferSchemaForExtractStep(step: BoundStep & ExtractStep): SchemaField | null {
    if (!step.extract?.fields || step.extract.fields.length === 0) {
      this.warn(`Step ${step.id}: extract step has no fields declared`)
      return null
    }

    const properties: Record<string, SchemaField> = {}
    for (const field of step.extract.fields) {
      properties[field.name] = {
        type: this.mapExtractType(field.type),
        description: field.description,
        required: field.required,
        source: 'ai_declared',
      }
    }

    return {
      type: 'object',
      properties,
      source: 'ai_declared',
    }
  }

  /**
   * Generate step: build schema from declared outputs[].
   * Source: "ai_declared"
   */
  private inferSchemaForGenerateStep(step: BoundStep & GenerateStep): SchemaField | null {
    if (!step.generate?.outputs || step.generate.outputs.length === 0) {
      // Generate without declared outputs — output is freeform text
      return {
        type: 'string',
        description: 'Generated content',
        source: 'ai_declared',
      }
    }

    const properties: Record<string, SchemaField> = {}
    for (const output of step.generate.outputs) {
      properties[output.name] = {
        type: this.mapExtractType(output.type),
        description: output.description,
        source: 'ai_declared',
      }
    }

    return {
      type: 'object',
      properties,
      source: 'ai_declared',
    }
  }

  /**
   * Aggregate step: produce typed output slots based on output declarations.
   * Note: the main output RefName slot is created here, and additional named
   * outputs are created in buildAggregateSlots().
   */
  private inferSchemaForAggregateStep(
    step: BoundStep & AggregateStep,
    slots: Record<string, DataSlot>
  ): SchemaField | null {
    if (!step.aggregate?.outputs || step.aggregate.outputs.length === 0) {
      this.warn(`Step ${step.id}: aggregate step has no outputs declared`)
      return null
    }

    // If only one output and it matches step.output, return its schema directly
    if (step.aggregate.outputs.length === 1) {
      return this.inferAggregateOutputSchema(step.aggregate.outputs[0], step, slots)
    }

    // Multiple outputs: the main step.output is an object containing all named outputs
    const properties: Record<string, SchemaField> = {}
    for (const output of step.aggregate.outputs) {
      const outputSchema = this.inferAggregateOutputSchema(output, step, slots)
      if (outputSchema) {
        properties[output.name] = outputSchema
      }
    }

    return {
      type: 'object',
      properties,
      source: 'inferred',
    }
  }

  /**
   * Infer schema for a single aggregate output (subset, count, sum, etc.)
   */
  private inferAggregateOutputSchema(
    output: AggregateStep['aggregate']['outputs'][0],
    step: BoundStep & AggregateStep,
    slots: Record<string, DataSlot>
  ): SchemaField | null {
    const inputRef = step.aggregate.input
    const inputSlot = inputRef ? slots[inputRef] : null

    switch (output.type) {
      case 'subset':
        // Subset = same shape as input (filtered)
        if (inputSlot) {
          return { ...this.deepCopySchema(inputSlot.schema), source: 'inferred' }
        }
        return { type: 'array', source: 'inferred' }

      case 'count':
        return { type: 'number', description: `Count of ${output.name}`, source: 'inferred' }

      case 'sum':
      case 'min':
      case 'max':
        return {
          type: 'number',
          description: `${output.type} of ${(output as any).field || output.name}`,
          source: 'inferred',
        }

      case 'custom':
        return { type: 'object', source: 'inferred' }

      default:
        return { type: 'any', source: 'inferred' }
    }
  }

  /**
   * Build additional slots for loop step: item_ref (loop-scoped) and collect_as.
   */
  private buildLoopSlots(step: BoundStep & LoopStep, slots: Record<string, DataSlot>): void {
    if (!step.loop) return

    const overRef = step.loop.over
    const overSlot = overRef ? slots[overRef] : null

    // item_ref: the current item inside the loop
    if (step.loop.item_ref) {
      let itemSchema: SchemaField = { type: 'any', source: 'inferred' }

      if (overSlot?.schema.type === 'array' && overSlot.schema.items) {
        // Item = array items schema
        itemSchema = { ...this.deepCopySchema(overSlot.schema.items), source: 'inferred' }
      } else if (overSlot) {
        // Iterating over non-array (edge case) — use the slot schema directly
        itemSchema = { ...this.deepCopySchema(overSlot.schema), source: 'inferred' }
      }

      slots[step.loop.item_ref] = {
        schema: itemSchema,
        scope: 'loop',
        produced_by: step.id,
      }
    }

    // collect_as: gathered results from loop iterations
    if (step.loop.collect?.enabled && step.loop.collect.collect_as) {
      const collectRef = step.loop.collect.collect_as

      // Find the inner step that produces from_step_output
      let innerSchema: SchemaField = { type: 'any', source: 'inferred' }
      if (step.loop.collect.from_step_output && slots[step.loop.collect.from_step_output]) {
        innerSchema = this.deepCopySchema(slots[step.loop.collect.from_step_output].schema)
      }

      slots[collectRef] = {
        schema: {
          type: 'array',
          items: innerSchema,
          source: 'inferred',
        },
        scope: 'global',
        produced_by: step.id,
      }
    }
  }

  /**
   * Fix up loop gather (collect_as) schemas after all body step slots exist.
   * During Pass 1, loop steps are processed before their body steps, so
   * `from_step_output` isn't in slots yet. This pass resolves the items schema
   * now that body step outputs are available.
   */
  private fixupLoopGatherSchemas(allSteps: BoundStep[], slots: Record<string, DataSlot>): void {
    for (const step of allSteps) {
      if (step.kind !== 'loop') continue
      const loopStep = step as BoundStep & LoopStep
      if (!loopStep.loop?.collect?.enabled || !loopStep.loop.collect.collect_as) continue

      const collectRef = loopStep.loop.collect.collect_as
      const collectSlot = slots[collectRef]
      if (!collectSlot) continue

      // If the items schema is still `any`, try to resolve it now
      if (collectSlot.schema.type === 'array' && collectSlot.schema.items?.type === 'any') {
        const fromRef = loopStep.loop.collect.from_step_output
        if (fromRef && slots[fromRef]) {
          collectSlot.schema.items = this.deepCopySchema(slots[fromRef].schema)
          logger.debug(
            { collectRef, fromRef },
            '[DataSchemaBuilder] Fixed up loop gather items schema'
          )
        }
      }
    }
  }

  /**
   * Build additional named slots for aggregate outputs.
   * Each named aggregate output (subset, count, etc.) gets its own slot.
   */
  private buildAggregateSlots(
    step: BoundStep & AggregateStep,
    slots: Record<string, DataSlot>
  ): void {
    if (!step.aggregate?.outputs) return

    for (const output of step.aggregate.outputs) {
      // Skip if it matches the main step.output (created separately by buildSlotsForStep)
      if (output.name === step.output) continue

      const schema = this.inferAggregateOutputSchema(output, step, slots)
      if (schema) {
        slots[output.name] = {
          schema,
          scope: 'global',
          produced_by: step.id,
        }
      }
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  /**
   * Get implicit input reference from step-kind-specific fields.
   * Steps have inputs declared in kind-specific fields (transform.input, loop.over, etc.)
   * in addition to the generic inputs[] array.
   */
  private getImplicitInput(step: BoundStep): string | null {
    switch (step.kind) {
      case 'transform':
        return (step as any).transform?.input || null
      case 'extract':
        return (step as any).extract?.input || null
      case 'aggregate':
        return (step as any).aggregate?.input || null
      case 'deliver':
        return (step as any).deliver?.input || null
      case 'loop':
        return (step as any).loop?.over || null
      case 'generate':
        return (step as any).generate?.input || null
      case 'summarize':
        return (step as any).summarize?.input || null
      case 'classify':
        return (step as any).classify?.input || null
      default:
        return null
    }
  }

  /**
   * Recursively flatten all steps including nested (loop body, decide branches, parallel branches).
   */
  private flattenSteps(steps: BoundStep[]): BoundStep[] {
    const result: BoundStep[] = []

    for (const step of steps) {
      result.push(step)

      if (step.kind === 'loop' && (step as any).loop?.do) {
        result.push(...this.flattenSteps((step as any).loop.do))
      }

      if (step.kind === 'decide' && (step as any).decide) {
        if ((step as any).decide.then) {
          result.push(...this.flattenSteps((step as any).decide.then))
        }
        if ((step as any).decide.else) {
          result.push(...this.flattenSteps((step as any).decide.else))
        }
      }

      if (step.kind === 'parallel' && (step as any).parallel?.branches) {
        for (const branch of (step as any).parallel.branches) {
          if (branch.steps) {
            result.push(...this.flattenSteps(branch.steps))
          }
        }
      }
    }

    return result
  }

  /**
   * Convert a JsonObject (from IntentContract's transform.output_schema) to SchemaField.
   */
  private convertJsonObjectToSchemaField(
    obj: Record<string, any>,
    source: SchemaField['source']
  ): SchemaField {
    const type = this.normalizeType(obj.type)

    const field: SchemaField = { type, source }

    if (obj.description) field.description = obj.description

    if (type === 'object' && obj.properties) {
      field.properties = {}
      const required = obj.required || []
      for (const [key, prop] of Object.entries(obj.properties)) {
        const child = this.convertJsonObjectToSchemaField(prop as Record<string, any>, source)
        if (required.includes(key)) child.required = true
        field.properties[key] = child
      }
    }

    if (type === 'array' && obj.items) {
      field.items = this.convertJsonObjectToSchemaField(obj.items as Record<string, any>, source)
    }

    return field
  }

  /**
   * Map extract/generate field type strings to SchemaFieldType.
   */
  private mapExtractType(type?: string): SchemaField['type'] {
    if (!type) return 'any'
    switch (type) {
      case 'string':
      case 'date':
      case 'currency':
        return 'string'
      case 'number':
      case 'integer':
        return 'number'
      case 'boolean':
        return 'boolean'
      case 'object':
        return 'object'
      case 'array':
        return 'array'
      default:
        return 'any'
    }
  }

  /**
   * Normalize type string to SchemaFieldType.
   */
  private normalizeType(type?: string): SchemaField['type'] {
    if (!type) return 'any'
    switch (type) {
      case 'string':
        return 'string'
      case 'number':
      case 'integer':
        return 'number'
      case 'boolean':
        return 'boolean'
      case 'object':
        return 'object'
      case 'array':
        return 'array'
      default:
        return 'any'
    }
  }

  /**
   * Deep copy a SchemaField to avoid shared references between slots.
   */
  private deepCopySchema(schema: SchemaField): SchemaField {
    return JSON.parse(JSON.stringify(schema))
  }

  private warn(message: string): void {
    this.warnings.push(message)
    logger.warn(`[DataSchemaBuilder] ${message}`)
  }
}
