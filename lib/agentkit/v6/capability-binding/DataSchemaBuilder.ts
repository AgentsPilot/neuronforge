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
import {
  reconcileFieldNames,
  directFieldNames,
  collectRawFieldNames,
  isFieldPreservingOp,
  FLATTEN_BUILTINS,
} from './field-name-reconciliation'

const logger = createLogger({ module: 'DataSchemaBuilder', service: 'V6' })

/** Shape-preserving transform ops — output schema = input schema */
const SHAPE_PRESERVING_OPS = new Set(['filter', 'sort', 'dedupe'])

/** WP-63 result of build(): the schema plus the declared→canonical field rename map. */
export interface DataSchemaBuildResult {
  schema: WorkflowDataSchema
  warnings: string[]
  /** WP-63 Gap A: declared field name → producer canonical name (re-cased fields). */
  fieldRenames: Map<string, string>
}

/** Shape-changing transform ops — require output_schema from LLM */
const SHAPE_CHANGING_OPS = new Set(['map', 'group', 'merge', 'reduce', 'select'])

export class DataSchemaBuilder {
  private pluginManager: PluginManagerV2
  private warnings: string[]
  /** WP-63 Gap A: accumulated declared→canonical field renames (global, conflict-guarded). */
  private fieldRenames: Map<string, string>
  /** WP-63 Gap A: declared names dropped from the global map due to a conflicting rename target. */
  private renameConflicts: Set<string>

  constructor(pluginManager: PluginManagerV2) {
    this.pluginManager = pluginManager
    this.warnings = []
    this.fieldRenames = new Map()
    this.renameConflicts = new Set()
  }

  /**
   * Build a complete WorkflowDataSchema from bound steps.
   *
   * Pass 1: Create a DataSlot for each step with an output RefName
   * Pass 2: Populate consumed_by from step inputs
   */
  build(boundSteps: BoundStep[]): DataSchemaBuildResult {
    this.warnings = []
    this.fieldRenames = new Map()
    this.renameConflicts = new Set()
    const slots: Record<string, DataSlot> = {}

    // Pass 1: Build slots from all steps (including nested, with depth tracking)
    const allEntries = this.flattenSteps(boundSteps, 0)

    for (const { step, depth } of allEntries) {
      this.buildSlotsForStep(step, slots, depth)
    }

    // Pass 2: Fix up derived schemas via convergence loop.
    // Schemas cascade through multiple levels (loop gather → transform → aggregate → loop item),
    // so we re-run all fixups until no more changes occur (typically 2-3 iterations).
    const allSteps = allEntries.map(e => e.step)
    const MAX_FIXUP_ITERATIONS = 5
    for (let iteration = 0; iteration < MAX_FIXUP_ITERATIONS; iteration++) {
      const slotSnapshot = JSON.stringify(slots)

      // Pass 2a: Fix loop gather schemas — body step slots now exist
      this.fixupLoopGatherSchemas(allSteps, slots)

      // Pass 2b: Fix aggregate subset schemas — input arrays may now have full items
      this.fixupAggregateSubsetSchemas(allSteps, slots)

      // Pass 2c: Fix shape-preserving transform + loop item schemas
      this.fixupDerivedTransformSchemas(allEntries, slots)

      // Pass 2d (WP-63 Gap A): reconcile AI-declared FIELD-PRESERVING transform item
      // schemas to their producer's real field names (e.g. declared `mime_type` →
      // producer `mimeType`) BEFORE they propagate downstream. Runs inside the
      // convergence loop so a reconciled slot re-propagates through inheritance
      // (filter/sort/dedupe inherit; scatter/loop item_ref derives).
      this.reconcileAiDeclaredTransformSchemas(allEntries, slots)

      if (JSON.stringify(slots) === slotSnapshot) {
        break // Converged — no more changes
      }
    }

    // Pass 3: Populate consumed_by
    for (const { step } of allEntries) {
      // Explicit inputs[]
      if (step.inputs) {
        for (const inputRef of step.inputs) {
          if (slots[inputRef]) {
            if (!slots[inputRef].consumed_by) {
              slots[inputRef].consumed_by = []
            }
            slots[inputRef].consumed_by!.push(step.id)
          }
        }
      }

      // Implicit inputs: transform.input, extract.input, aggregate.input, deliver.input, loop.over
      const implicitInput = this.getImplicitInput(step)
      if (implicitInput && slots[implicitInput]) {
        if (!slots[implicitInput].consumed_by) {
          slots[implicitInput].consumed_by = []
        }
        if (!slots[implicitInput].consumed_by!.includes(step.id)) {
          slots[implicitInput].consumed_by!.push(step.id)
        }
      }

      // Loop collect.from_step_output — the loop step consumes the inner output
      if (step.kind === 'loop') {
        const loopStep = step as BoundStep & LoopStep
        const fromRef = loopStep.loop?.collect?.from_step_output
        if (fromRef && slots[fromRef]) {
          if (!slots[fromRef].consumed_by) {
            slots[fromRef].consumed_by = []
          }
          if (!slots[fromRef].consumed_by!.includes(step.id)) {
            slots[fromRef].consumed_by!.push(step.id)
          }
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

    return { schema: { slots }, warnings: this.warnings, fieldRenames: this.fieldRenames }
  }

  /**
   * Build slot(s) for a single step based on its kind.
   */
  private buildSlotsForStep(step: BoundStep, slots: Record<string, DataSlot>, depth: number = 0): void {
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
      scope: depth > 0 ? 'loop' : 'global', // Steps inside loop body get loop scope
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
   *
   * WP-18 Bug A (2026-05-08): if the LLM declared an `output_schema`, it wins —
   * even on shape-preserving ops. The "inherit input" rule has an unstated
   * assumption (input slot represents what the runtime sees) that breaks when
   * the compiler auto-injects a `rows_to_objects` between fetch + filter.
   * The LLM's declaration is the authority on shape; the inheritance rule is
   * a heuristic fallback.
   *
   * WP-18 Bug B (2026-05-08): when inheriting from a wrapper-object input slot
   * (e.g., Sheets `{values, row_count, ...}`) and the runtime will operate on
   * the unwrapped element shape, walk into the wrapper to find the nested
   * array's items. Mirrors the Phase 4 compiler's `rows_to_objects`
   * auto-inject without entangling Phase 2 with that compiler-specific logic.
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

    // WP-18 Bug A: LLM-declared output_schema wins for ANY transform op.
    // Process this first so shape-preserving ops with a declared schema use
    // the declaration, not the heuristic inheritance.
    if (step.transform.output_schema) {
      return this.convertJsonObjectToSchemaField(step.transform.output_schema, 'ai_declared')
    }

    // Flatten without output_schema: unwrap one array level.
    if (op === 'flatten') {
      if (inputSlot?.schema.type === 'array' && inputSlot.schema.items) {
        return { ...inputSlot.schema.items, source: 'inferred' }
      }
      return inputSlot ? { ...inputSlot.schema, source: 'inferred' } : null
    }

    // Shape-preserving without declared schema: inherit input, with
    // WP-18 Bug B wrapper-unwrap for compiler-auto-injected paths.
    if (SHAPE_PRESERVING_OPS.has(op)) {
      if (!inputSlot) {
        this.warn(`Step ${step.id}: transform input "${inputRef}" not found in slots`)
        return null
      }

      // WP-18 Bug B: if the input is a wrapper-object containing a single
      // nested array (canonical pattern: Sheets `{values: array<row>, ...}`),
      // the runtime operates on rows-as-objects after the compiler's
      // auto-inject. Inherit the array shape, not the wrapper shape.
      const unwrapped = this.unwrapWrapperToArray(inputSlot.schema)
      if (unwrapped) {
        return { ...this.deepCopySchema(unwrapped), source: 'inferred' }
      }

      return { ...this.deepCopySchema(inputSlot.schema), source: 'inferred' }
    }

    // Shape-changing: require output_schema (already handled above; warn if missing).
    if (SHAPE_CHANGING_OPS.has(op)) {
      this.warn(
        `Step ${step.id}: shape-changing transform (${op}) is missing output_schema — ` +
          `cannot determine output shape. Fix in Phase 1 prompt or use extract/generate instead.`
      )
      return null
    }

    // Unknown op: fall back to input.
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
      properties[field.name] = this.buildSchemaFromNestedFieldSpec(field, step.id, field.name)
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
      properties[output.name] = this.buildSchemaFromNestedFieldSpec(output, step.id, output.name)
    }

    return {
      type: 'object',
      properties,
      source: 'ai_declared',
    }
  }

  /**
   * WP-15: recursively walk a NestedFieldSpec from the IntentContract grammar
   * (extract.fields[] / generate.outputs[]) into a SchemaField.
   *
   * The grammar mirrors JSON Schema conventions: when `type === "array"`,
   * `items` declares the element shape; when `type === "object"`, `properties`
   * declares per-key shape. Without this walk, depth-1 inference produced slots
   * like `{rows: {type: "array"}}` with no `items.properties`, forcing the
   * compiler's auto-repair safety net (validateSchemaDepth) to fire and
   * silently degrade to `items: {type: "any"}`.
   *
   * Logs a warning when the LLM declares array/object without nested shape —
   * still emits a permissive schema so the pipeline doesn't hard-fail, but the
   * warning is the W5 retirement signal for task 7.3 / 4.6 (auto-repair).
   *
   * @param spec   the NestedFieldSpec from IntentContract (may be nested)
   * @param stepId for diagnostic context in warnings
   * @param path   dot-separated field path for diagnostic context
   */
  private buildSchemaFromNestedFieldSpec(
    spec: { type?: string; required?: boolean; description?: string; items?: any; properties?: Record<string, any> },
    stepId: string,
    path: string
  ): SchemaField {
    const fieldType = this.mapExtractType(spec.type)

    const out: SchemaField = {
      type: fieldType,
      source: 'ai_declared',
    }
    if (spec.description !== undefined) out.description = spec.description
    if (spec.required !== undefined) out.required = spec.required

    // RETIRE-1 (2026-05-10): switched from warn-and-fallback to throw-on-violation
    // after CP-D verified 0/10 firings across the regression suite. The Q-A4
    // sequencing gate was met: the LLM consistently emits depth-2+ shapes for
    // array/object output declarations under the WP-15 prompt + grammar.
    //
    // If a future emission produces a shallow shape, this throws at the
    // builder layer with a clear error instead of silently emitting
    // `items:{type:"any"}` / `properties:{}` and producing surprising
    // downstream behavior. Revert by restoring the warn-and-fallback
    // branches if the gate proves premature.
    if (fieldType === 'array') {
      if (!spec.items) {
        throw new Error(
          `[DataSchemaBuilder] Step ${stepId}: field "${path}" declared as array without "items" ` +
          `(RETIRE-1, was warn-and-fallback until 2026-05-10). The LLM must declare element shape ` +
          `for array fields — see Phase 1 system prompt section 6.4.1 (WP-15). ` +
          `If this is a regression, restore the warn-and-fallback branch in DataSchemaBuilder.`
        )
      }
      out.items = this.buildSchemaFromNestedFieldSpec(spec.items, stepId, `${path}[]`)
    }

    if (fieldType === 'object') {
      if (!spec.properties || typeof spec.properties !== 'object') {
        throw new Error(
          `[DataSchemaBuilder] Step ${stepId}: field "${path}" declared as object without "properties" ` +
          `(RETIRE-1, was warn-and-fallback until 2026-05-10). The LLM must declare per-key field shape ` +
          `for object fields — see Phase 1 system prompt section 6.4.1 (WP-15). ` +
          `If this is a regression, restore the warn-and-fallback branch in DataSchemaBuilder.`
        )
      }
      const props: Record<string, SchemaField> = {}
      for (const [key, child] of Object.entries(spec.properties)) {
        props[key] = this.buildSchemaFromNestedFieldSpec(child, stepId, `${path}.${key}`)
      }
      out.properties = props
    }

    return out
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
   *
   * WP-17 Bug A (2026-05-08): when the loop iterates over a wrapper-object slot
   * (e.g., Gmail search-results wrapper `{emails: array<email>, total_found,
   * ...}`), the previous code at the `else if (overSlot)` branch copied the
   * entire wrapper as the item schema. Now we walk into the wrapper looking
   * for a single nested array and use its `items` shape — matching how the
   * compiler / runtime actually iterate (over the unwrapped element).
   *
   * WP-17 Bug B (2026-05-08): when multiple loops share an `item_ref` name
   * (canonical pattern: mark_emails_read + apply_label_to_emails both using
   * `item_ref: "email"` over the same source array), the previous code
   * unconditionally overwrote `slots[item_ref]`, leaving `produced_by` as
   * the last loop only. Now we detect the collision: if schemas match
   * (or new is "any"), keep the existing slot and append step.id to
   * `produced_by_loops`. If schemas differ, log loudly and keep the first.
   */
  private buildLoopSlots(step: BoundStep & LoopStep, slots: Record<string, DataSlot>): void {
    if (!step.loop) return

    const overRef = step.loop.over
    const overSlot = overRef ? slots[overRef] : null

    // item_ref: the current item inside the loop
    if (step.loop.item_ref) {
      const itemSchema = this.deriveLoopItemSchema(overSlot)

      // WP-17 Bug B: handle multi-loop item_ref collision.
      const existingSlot = slots[step.loop.item_ref]
      if (existingSlot && existingSlot.scope === 'loop') {
        // Slot already created by an earlier loop with the same item_ref name.
        // Decide whether to merge (compatible schemas) or warn (collision).
        const newIsAny = itemSchema.type === 'any'
        const existingIsAny = existingSlot.schema.type === 'any'
        const schemasMatch = this.schemasShallowEqual(existingSlot.schema, itemSchema)

        if (newIsAny || existingIsAny || schemasMatch) {
          // Compatible — preserve the more-specific schema and record both producers.
          if (existingIsAny && !newIsAny) {
            existingSlot.schema = itemSchema
          }
          existingSlot.produced_by_loops = existingSlot.produced_by_loops ?? [existingSlot.produced_by]
          if (!existingSlot.produced_by_loops.includes(step.id)) {
            existingSlot.produced_by_loops.push(step.id)
          }
          logger.debug(
            { itemRef: step.loop.item_ref, loopId: step.id, allLoops: existingSlot.produced_by_loops },
            '[DataSchemaBuilder] Multi-loop item_ref — added to produced_by_loops'
          )
        } else {
          // Genuine collision — different schemas for the same name.
          this.warn(
            `Loop ${step.id} and ${existingSlot.produced_by} both declare item_ref "${step.loop.item_ref}" ` +
              `but produce different schemas. Keeping first; field references in the second loop body may not validate.`
          )
        }
      } else {
        // First loop using this item_ref — create the slot.
        slots[step.loop.item_ref] = {
          schema: itemSchema,
          scope: 'loop',
          produced_by: step.id,
        }
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
   * Fix up aggregate subset schemas after loop gather slots have been resolved.
   * During Pass 1, aggregate steps may reference loop gather outputs (e.g., processed_items)
   * whose items schema was still `any` at the time. Now that fixupLoopGatherSchemas has run,
   * the input slots have full items schemas, so we can re-derive subset outputs.
   */
  private fixupAggregateSubsetSchemas(allSteps: BoundStep[], slots: Record<string, DataSlot>): void {
    for (const step of allSteps) {
      if (step.kind !== 'aggregate') continue
      const aggStep = step as BoundStep & AggregateStep
      if (!aggStep.aggregate?.outputs) continue

      const inputRef = aggStep.aggregate.input
      const inputSlot = inputRef ? slots[inputRef] : null
      if (!inputSlot) continue

      for (const output of aggStep.aggregate.outputs) {
        if (output.type !== 'subset') continue

        const slotName = output.name
        const slot = slots[slotName]
        if (!slot) continue

        // Check if items is still shallow (type: "any") but input now has rich items
        if (slot.schema.type === 'array' &&
            slot.schema.items?.type === 'any' &&
            inputSlot.schema.type === 'array' &&
            inputSlot.schema.items?.type !== 'any') {
          slot.schema = { ...this.deepCopySchema(inputSlot.schema), source: 'inferred' }
          logger.debug(
            { slotName, inputRef },
            '[DataSchemaBuilder] Fixed up aggregate subset items schema'
          )
        }
      }

      // Also fix the main step.output if it's an object containing subset properties
      if (step.output && slots[step.output] && slots[step.output].schema.properties) {
        for (const output of aggStep.aggregate.outputs) {
          if (output.type !== 'subset') continue
          const prop = slots[step.output].schema.properties![output.name]
          if (prop && prop.type === 'array' && prop.items?.type === 'any' &&
              inputSlot.schema.type === 'array' && inputSlot.schema.items?.type !== 'any') {
            slots[step.output].schema.properties![output.name] = {
              ...this.deepCopySchema(inputSlot.schema),
              source: 'inferred',
            }
          }
        }
      }
    }
  }

  /**
   * Fix up shape-preserving transform schemas after Passes 2/2b have resolved
   * upstream slots. During Pass 1, shape-preserving transforms (filter, sort, dedupe)
   * inherit their input slot's schema, but if the input was a loop gather or aggregate
   * output, its items may have been `type: "any"` at that time. Now that upstream
   * slots are resolved, re-derive these transform outputs.
   * Also fixes cascading loop item schemas (same pattern as I7 fixed by I6).
   */
  private fixupDerivedTransformSchemas(
    allEntries: Array<{ step: BoundStep; depth: number }>,
    slots: Record<string, DataSlot>
  ): void {
    for (const { step } of allEntries) {
      if (step.kind !== 'transform') continue
      const transformStep = step as BoundStep & TransformStep
      const op = transformStep.transform?.op
      if (!op || !SHAPE_PRESERVING_OPS.has(op)) continue
      if (!step.output || !slots[step.output]) continue

      const inputRef = transformStep.transform.input
      const inputSlot = inputRef ? slots[inputRef] : null
      if (!inputSlot) continue

      const outputSlot = slots[step.output]

      // Check if output has stale items (type: "any") but input now has rich items
      if (outputSlot.schema.type === 'array' &&
          outputSlot.schema.items?.type === 'any' &&
          inputSlot.schema.type === 'array' &&
          inputSlot.schema.items?.type !== 'any') {
        outputSlot.schema = { ...this.deepCopySchema(inputSlot.schema), source: 'inferred' }
        logger.debug(
          { slotName: step.output, inputRef },
          '[DataSchemaBuilder] Fixed up shape-preserving transform schema'
        )
      }
    }

    // Second pass: fix up loop item_ref slots that iterate over now-resolved transform outputs
    for (const { step } of allEntries) {
      if (step.kind !== 'loop') continue
      const loopStep = step as BoundStep & LoopStep
      if (!loopStep.loop?.item_ref) continue

      const overRef = loopStep.loop.over
      const overSlot = overRef ? slots[overRef] : null
      if (!overSlot) continue

      const itemSlot = slots[loopStep.loop.item_ref]
      if (!itemSlot) continue

      // If item schema is still "any" but the iterated source now has rich items.
      // WP-17 Bug A: try the nested-array unwrap first, then fall through to
      // the existing top-level array path. This catches wrapper-object sources
      // like Gmail search results that the runtime iterates over the nested
      // array (via the compiler's auto-inject) but Phase 2 sees as an object.
      if (itemSlot.schema.type === 'any') {
        const derived = this.deriveLoopItemSchema(overSlot)
        if (derived.type !== 'any') {
          itemSlot.schema = derived
          logger.debug(
            { itemRef: loopStep.loop.item_ref, overRef },
            '[DataSchemaBuilder] Fixed up loop item schema from resolved transform'
          )
        }
      }
    }
  }

  // ============================================================================
  // WP-63 Gap A — reconcile ai_declared FIELD-PRESERVING transform item schemas
  // to their producer's real field names (declared `mime_type` → producer `mimeType`)
  // ============================================================================

  /**
   * WP-63 Gap A (Pass 2d). For each FIELD-PRESERVING transform (`flatten`, `filter`,
   * `sort`, `dedupe`, `project_column`, `set_difference` — runtime passes producer
   * fields through verbatim, so every declared field MUST trace to the producer),
   * reconcile an `ai_declared` item schema's field names to the producer's real
   * names via the shared normalized-key matcher. FIELD-SYNTHESIZING ops
   * (`with_fields`/`map`/`group`/… — Q2) are skipped: their declared fields are
   * legitimately computed and MUST NOT be reconciled or flagged (AC-5, AC-9).
   *
   * Never drops a field (Principle 2/11): re-cased → renamed in place; genuinely
   * absent → left as-is and recorded as a Gap-C warning candidate.
   */
  private reconcileAiDeclaredTransformSchemas(
    allEntries: Array<{ step: BoundStep; depth: number }>,
    slots: Record<string, DataSlot>
  ): void {
    for (const { step } of allEntries) {
      // (1) FIELD-PRESERVING transforms — reconcile their item schema to the producer.
      if (step.kind === 'transform') {
        const t = (step as BoundStep & TransformStep).transform
        if (!t || !isFieldPreservingOp(t.op) || !step.output) continue // Q2: preserving ops only
        this.reconcileSlotAgainstProducer(
          step.id,
          t.op,
          slots[step.output],
          this.resolveInputSlotSchema(t.input, slots),
          { emitGapC: true }
        )
        continue
      }

      // (2) Loop/scatter item_ref — mirror the iterated collection's items, so a
      // reconciled collection propagates to `{{itemVariable.field}}` refs. Not a
      // transform op, so no Q2 gate / no Gap-C (it inherits, never declares fields).
      if (step.kind === 'loop') {
        const loop = (step as BoundStep & LoopStep).loop
        if (!loop?.item_ref) continue
        const overSchema = this.resolveInputSlotSchema(loop.over, slots)
        this.reconcileSlotAgainstProducer(step.id, 'loop_item', slots[loop.item_ref], overSchema, { emitGapC: false })
      }
    }
  }

  /**
   * WP-63 Gap A core: reconcile a slot's item field names to the producer's real
   * names via the shared matcher. Rewrites the slot in place, records the global
   * renames (for A2), surfaces M1 ambiguity, and — when `emitGapC` — surfaces a
   * genuinely-absent field on a field-preserving op (Gap C, warning). Skips
   * `source: "plugin"` slots (plugin schema is already ground truth).
   */
  private reconcileSlotAgainstProducer(
    stepId: string,
    opLabel: string,
    slot: DataSlot | undefined,
    producerSchema: SchemaField | null,
    opts: { emitGapC: boolean }
  ): void {
    if (!slot?.schema || slot.schema.source === 'plugin') return
    if (!producerSchema) return

    const producerUniverse = [...collectRawFieldNames(producerSchema), ...FLATTEN_BUILTINS]
    if (producerUniverse.length === 0) return

    const declaredNames = directFieldNames(slot.schema)
    if (declaredNames.length === 0) return

    const { renames, unmatched, ambiguous } = reconcileFieldNames(declaredNames, producerUniverse)

    if (renames.size > 0) {
      this.renameItemSchemaFields(slot.schema, renames)
      for (const [declared, canonical] of renames) this.recordFieldRename(declared, canonical)
      logger.info(
        { stepId, op: opLabel, renames: Object.fromEntries(renames) },
        '[WP-63/GapA] Reconciled transform/loop item fields to producer casing'
      )
    }
    for (const a of ambiguous) {
      this.warn(
        `[WP-63] Step ${stepId} (${opLabel}): field "${a}" is ambiguous against the producer ` +
          `(≥2 producer fields normalize alike) — left as-is, not reconciled.`
      )
    }
    if (opts.emitGapC) {
      for (const u of unmatched) {
        this.warn(
          `[WP-63/GapC] Step ${stepId} (${opLabel}): declared field "${u}" has no match in the ` +
            `producer's real output — the runtime will not populate it (field-preserving op passes ` +
            `producer fields through verbatim). Kept, not dropped.`
        )
      }
    }
  }

  /**
   * WP-63 M3: resolve a transform input RefName to its producer SchemaField, handling
   * a DOTTED path (`expense_emails.emails`) that is not itself a top-level slot key —
   * `slots["expense_emails.emails"]` is null, so navigate `slots["expense_emails"]`
   * into `.emails`. Without this, Gap A can't find the producer at all.
   */
  private resolveInputSlotSchema(inputRef: string | undefined, slots: Record<string, DataSlot>): SchemaField | null {
    if (!inputRef) return null
    const clean = inputRef.replace(/\{\{|\}\}/g, '').trim()
    if (slots[clean]?.schema) return slots[clean].schema

    const parts = clean.split('.')
    const base = parts[0]
    let cur: any = slots[base]?.schema
    if (!cur) return null
    for (let i = 1; i < parts.length; i++) {
      if (!cur || typeof cur !== 'object') return null
      // Step into array items before reading a named property.
      if (cur.type === 'array' && cur.items) cur = cur.items
      cur = cur.properties?.[parts[i]]
    }
    return (cur as SchemaField) || null
  }

  /** Rewrite an item-schema's property keys per the rename map (declared → canonical). */
  private renameItemSchemaFields(schema: SchemaField, renames: Map<string, string>): void {
    const target: any = schema.type === 'array' ? schema.items : schema
    const props = target?.properties
    if (!props || typeof props !== 'object') return
    for (const [declared, canonical] of renames) {
      if (declared in props && !(canonical in props)) {
        props[canonical] = props[declared]
        delete props[declared]
      }
    }
  }

  /** Accumulate a global declared→canonical rename, dropping on conflicting targets. */
  private recordFieldRename(declared: string, canonical: string): void {
    if (this.renameConflicts.has(declared)) return
    const existing = this.fieldRenames.get(declared)
    if (existing && existing !== canonical) {
      this.fieldRenames.delete(declared)
      this.renameConflicts.add(declared)
      return
    }
    this.fieldRenames.set(declared, canonical)
  }

  // ============================================================================
  // WP-17 / WP-18 helpers (2026-05-08) — schema unwrapping + collision merge
  // ============================================================================

  /**
   * WP-17 Bug A: derive the per-iteration item schema from a loop's `over` slot.
   *
   * - If overSlot is itself an array → use its items.
   * - If overSlot is a wrapper-object containing exactly one nested array
   *   (e.g., Gmail's `{emails: array<email>, total_found, ...}`), use the
   *   nested array's items.
   * - Otherwise → fall back to `any` and let the second-pass fixup retry
   *   once upstream slots resolve.
   *
   * Mirrors the runtime's actual iteration target without entangling Phase 2
   * with the Phase 4 compiler's `rows_to_objects` auto-inject logic.
   */
  private deriveLoopItemSchema(overSlot: DataSlot | null): SchemaField {
    if (!overSlot) return { type: 'any', source: 'inferred' }

    if (overSlot.schema.type === 'array' && overSlot.schema.items) {
      return { ...this.deepCopySchema(overSlot.schema.items), source: 'inferred' }
    }

    const wrapperArray = this.unwrapWrapperToArray(overSlot.schema)
    if (wrapperArray && wrapperArray.items) {
      return { ...this.deepCopySchema(wrapperArray.items), source: 'inferred' }
    }

    // Iterating over a non-array, non-wrapper slot — preserve schema (rare).
    return { ...this.deepCopySchema(overSlot.schema), source: 'inferred' }
  }

  /**
   * WP-17 Bug A / WP-18 Bug B: walk a wrapper-object schema looking for a
   * single nested array property. Returns the **array schema** (with items),
   * or null if the input is not a recognizable wrapper.
   *
   * Recognition rule (intentionally conservative):
   * - Input must be `type: 'object'` with `properties`
   * - Exactly ONE property at depth 1 must be `type: 'array'` with `items`
   * - That property (the array, not its items) is returned
   *
   * Callers decide whether they want the array shape (e.g., shape-preserving
   * filter — output is still an array) or the items (e.g., loop iteration —
   * the per-element shape). Use `result.items` for the latter.
   *
   * If 0 or multiple arrays are found, returns null — leaves the caller to
   * use the existing fallback path (warning + keep wrapper). This avoids
   * silent misidentification of which array the runtime iterates.
   */
  private unwrapWrapperToArray(schema: SchemaField): SchemaField | null {
    if (schema.type !== 'object' || !schema.properties) return null

    let foundArray: SchemaField | null = null
    let arrayCount = 0
    for (const value of Object.values(schema.properties)) {
      if (value.type === 'array' && value.items) {
        arrayCount++
        if (arrayCount === 1) foundArray = value
        if (arrayCount > 1) return null // ambiguous — bail out
      }
    }

    return foundArray
  }

  /**
   * WP-17 Bug B: shallow schema-equality check for multi-loop collision merge.
   * Returns true if two schemas are structurally compatible enough that we
   * can record both loops as producers of the same `item_ref` slot.
   *
   * Compares: top-level type, top-level property names (for objects), array
   * items type. Does NOT do deep recursion — that's overkill for the
   * collision-merge decision (different field-level details should still be
   * treated as the same shape if the top-level structure matches).
   */
  private schemasShallowEqual(a: SchemaField, b: SchemaField): boolean {
    if (a.type !== b.type) return false
    if (a.type === 'object') {
      const aKeys = new Set(Object.keys(a.properties ?? {}))
      const bKeys = new Set(Object.keys(b.properties ?? {}))
      if (aKeys.size !== bKeys.size) return false
      for (const k of aKeys) if (!bKeys.has(k)) return false
      return true
    }
    if (a.type === 'array') {
      // Equal if both have items of the same type, or both lack items
      const aItems = a.items?.type ?? '__none__'
      const bItems = b.items?.type ?? '__none__'
      return aItems === bItems
    }
    return true
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
   * Returns tuples of { step, depth } where depth tracks nesting level (0 = top-level).
   */
  private flattenSteps(steps: BoundStep[], depth: number = 0): Array<{ step: BoundStep; depth: number }> {
    const result: Array<{ step: BoundStep; depth: number }> = []

    for (const step of steps) {
      result.push({ step, depth })

      if (step.kind === 'loop' && (step as any).loop?.do) {
        result.push(...this.flattenSteps((step as any).loop.do, depth + 1))
      }

      if (step.kind === 'decide' && (step as any).decide) {
        if ((step as any).decide.then) {
          result.push(...this.flattenSteps((step as any).decide.then, depth + 1))
        }
        if ((step as any).decide.else) {
          result.push(...this.flattenSteps((step as any).decide.else, depth + 1))
        }
      }

      if (step.kind === 'parallel' && (step as any).parallel?.branches) {
        for (const branch of (step as any).parallel.branches) {
          if (branch.steps) {
            result.push(...this.flattenSteps(branch.steps, depth + 1))
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
