/**
 * Intent to IR Converter
 *
 * DETERMINISTIC conversion from BoundIntentContract (Generic Intent V1) to ExecutionGraph (IR v4).
 * NO LLM calls - purely rule-based transformation.
 *
 * Conversion Strategy:
 * 1. Initialize execution graph structure
 * 2. Convert each IntentStep to one or more IR nodes
 * 3. Build node connections (next_nodes) based on step order
 * 4. Resolve variable references (output → var names)
 * 5. Handle special cases (aggregates, loops, conditions)
 */

import type {
  IntentStep,
  DataSourceStep,
  ArtifactStep,
  TransformStep,
  ExtractStep,
  LoopStep,
  DecideStep,
  AggregateStep,
  DeliverStep,
  NotifyStep,
  GenerateStep,
  ValueRef,
  Condition,
} from '../semantic-plan/types/intent-schema-types'
import type { BoundIntentContract, BoundStep } from '../capability-binding/CapabilityBinderV2'
import type { WorkflowDataSchema } from '../logical-ir/schemas/workflow-data-schema'
import { validateSchemaCompatibility } from '../logical-ir/validation/SchemaCompatibilityValidator'
import type {
  DeclarativeLogicalIRv4,
  ExecutionGraph,
  ExecutionNode,
  OperationConfig,
  LoopConfig,
  ChoiceConfig,
  ConditionExpression,
  SimpleCondition,
  ComplexCondition,
} from '../logical-ir/schemas/declarative-ir-types-v4'
import { createLogger } from '@/lib/logger'
import type { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'
import type { ActionDefinition, ActionParameterProperty } from '@/lib/types/plugin-types'

const logger = createLogger({ module: 'IntentToIRConverter', service: 'V6' })

/**
 * Conversion context - tracks state during conversion
 */
interface ConversionContext {
  nodeCounter: number
  nodes: Map<string, ExecutionNode>
  variableMap: Map<string, string> // IntentStep.output -> IR variable name
  artifactMetadata: Map<string, Record<string, any>> // artifact output name -> its options (for extracting in deliver steps)
  startNode: string | null
  errors: string[]
  warnings: string[]
  config?: Array<{ key: string; type: string; description?: string; default?: any }> // Intent config for field resolution
  dataSchema?: WorkflowDataSchema // data_schema from binding phase for field reference validation
}

/**
 * Conversion result
 */
export interface ConversionResult {
  success: boolean
  ir?: DeclarativeLogicalIRv4
  errors: string[]
  warnings: string[]
}

/**
 * Intent to IR Converter
 *
 * Converts BoundIntentContract (with plugin bindings) into ExecutionGraph IR v4.
 */
export class IntentToIRConverter {
  private pluginManager?: PluginManagerV2

  /**
   * Constructor - accepts optional PluginManager for schema-aware conversion
   */
  constructor(pluginManager?: PluginManagerV2) {
    this.pluginManager = pluginManager
  }

  /**
   * Convert BoundIntentContract to ExecutionGraph IR
   */
  convert(boundIntent: BoundIntentContract): ConversionResult {
    logger.info('[IntentToIRConverter] Starting conversion...')

    const ctx: ConversionContext = {
      nodeCounter: 0,
      nodes: new Map(),
      variableMap: new Map(),
      artifactMetadata: new Map(),
      startNode: null,
      errors: [],
      warnings: [],
      config: boundIntent.config,
      dataSchema: boundIntent.data_schema,
    }

    try {
      // Convert all steps to nodes (pass true for isTopLevel)
      const nodeIds = this.convertSteps(boundIntent.steps, ctx, true)

      if (ctx.errors.length > 0) {
        logger.error({ errors: ctx.errors }, '[IntentToIRConverter] Conversion failed')
        return {
          success: false,
          errors: ctx.errors,
          warnings: ctx.warnings,
        }
      }

      // Add end node
      const endNodeId = this.addEndNode(ctx)

      // Connect last node to end
      if (nodeIds.length > 0) {
        const lastNodeId = nodeIds[nodeIds.length - 1]
        const lastNode = ctx.nodes.get(lastNodeId)
        if (lastNode) {
          lastNode.next = endNodeId
        }
      }

      // Determine start node: should be first node from top-level steps
      const startNode = nodeIds.length > 0 ? nodeIds[0] : endNodeId

      // Build execution graph
      const executionGraph: ExecutionGraph = {
        start: startNode,
        nodes: Object.fromEntries(ctx.nodes.entries()),
        // Carry data_schema from binding phase through to IR
        data_schema: boundIntent.data_schema,
      }

      // WP-11: Force content_level=full on fetch steps when downstream extraction needs body text.
      // Fetch actions default to metadata/snippet to minimize payload — but that leaves body="" and
      // silently breaks extract/ai steps that read it. Schema-driven: we only touch fetch steps
      // whose plugin schema declares a `content_level` param, so this is generic (not gmail-specific).
      this.enforceContentLevelForExtraction(ctx)

      // CRITICAL: Run schema compatibility validation (auto-fixes mismatches)
      logger.info('[IntentToIRConverter] Running schema compatibility validation...')
      const validationResult = validateSchemaCompatibility(executionGraph, this.pluginManager, true)

      if (validationResult.fixes_applied > 0) {
        logger.info(`[IntentToIRConverter] Schema validation applied ${validationResult.fixes_applied} auto-fixes`)
      }

      // Add validation warnings to context
      for (const warning of validationResult.warnings) {
        if (warning.auto_fixed) {
          ctx.warnings.push(
            `Schema fix: Added field "${warning.field_name}" to ${warning.variable_name} (required by ${warning.consumer_node_id})`
          )
        } else {
          ctx.warnings.push(warning.message)
        }
      }

      // Add validation errors to context
      for (const error of validationResult.errors) {
        ctx.errors.push(error.message)
      }

      // Build IR v4
      const ir: DeclarativeLogicalIRv4 = {
        ir_version: '4.0',
        goal: boundIntent.goal,
        execution_graph: executionGraph,
      }

      // Carry IntentContract config[] through as config_defaults for compiler merging
      if (ctx.config && ctx.config.length > 0) {
        ir.config_defaults = ctx.config.map((c: any) => ({
          key: c.key,
          type: c.type || 'string',
          ...(c.description ? { description: c.description } : {}),
          ...(c.default !== undefined ? { default: c.default } : {}),
        }))
        logger.debug(
          { configKeys: ir.config_defaults.map(c => c.key) },
          '[IntentToIRConverter] Attached config_defaults to IR'
        )
      }

      logger.info(
        {
          nodeCount: ctx.nodes.size,
          variableCount: ctx.variableMap.size,
          warnings: ctx.warnings.length,
          schemaFixes: validationResult.fixes_applied,
        },
        '[IntentToIRConverter] Conversion successful'
      )

      return {
        success: true,
        ir,
        errors: [],
        warnings: ctx.warnings,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error({ error: errorMsg }, '[IntentToIRConverter] Conversion threw error')
      return {
        success: false,
        errors: [errorMsg],
        warnings: ctx.warnings,
      }
    }
  }

  /**
   * Convert array of steps to nodes
   * @param isTopLevel - true if this is the top-level step list (not nested in loop/decide)
   */
  private convertSteps(steps: IntentStep[], ctx: ConversionContext, isTopLevel = false): string[] {
    const nodeIds: string[] = []
    let lastNodeId: string | null = null

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i] as BoundStep

      const stepNodeIds = this.convertStep(step, ctx)

      // Connect previous step's last node to first node of this step
      if (lastNodeId && stepNodeIds.length > 0) {
        const prevNode = ctx.nodes.get(lastNodeId)
        if (prevNode) {
          prevNode.next = stepNodeIds[0]
        }
      }

      // Set start node to first node of first step (only at top level)
      if (isTopLevel && i === 0 && stepNodeIds.length > 0 && !ctx.startNode) {
        ctx.startNode = stepNodeIds[0]
      }

      // Track all nodes created (for returning)
      nodeIds.push(...stepNodeIds)

      // Update lastNodeId to the LAST node created by this step
      if (stepNodeIds.length > 0) {
        lastNodeId = stepNodeIds[stepNodeIds.length - 1]
      }
    }

    return nodeIds
  }

  /**
   * Convert a single IntentStep to one or more IR nodes
   */
  private convertStep(step: BoundStep, ctx: ConversionContext): string[] {
    switch (step.kind) {
      case 'data_source':
        return [this.convertDataSource(step as DataSourceStep & BoundStep, ctx)]

      case 'artifact':
        return [this.convertArtifact(step as ArtifactStep & BoundStep, ctx)]

      case 'extract':
        return [this.convertExtract(step as ExtractStep & BoundStep, ctx)]

      case 'loop':
        return [this.convertLoop(step as LoopStep & BoundStep, ctx)]

      case 'decide':
        return [this.convertDecide(step as DecideStep & BoundStep, ctx)]

      case 'aggregate':
        return this.convertAggregate(step as AggregateStep & BoundStep, ctx)

      case 'deliver':
        return [this.convertDeliver(step as DeliverStep & BoundStep, ctx)]

      case 'notify':
        return [this.convertNotify(step as NotifyStep & BoundStep, ctx)]

      case 'generate':
        return [this.convertGenerate(step as GenerateStep & BoundStep, ctx)]

      case 'transform':
        return [this.convertTransform(step as TransformStep & BoundStep, ctx)]

      case 'classify':
        return [this.convertClassify(step as any, ctx)]

      default:
        ctx.warnings.push(`Step kind "${step.kind}" not yet supported, skipping`)
        return []
    }
  }

  /**
   * Convert data_source step to operation node
   */
  private convertDataSource(step: DataSourceStep & BoundStep, ctx: ConversionContext): string {
    const nodeId = this.generateNodeId(ctx)
    const outputVar = this.getOutputVariable(step, ctx)

    const genericParams = this.buildDataSourceParams(step, ctx)

    // Schema-aware parameter mapping (like in convertDeliver)
    let finalParams = genericParams
    if (this.pluginManager && step.plugin_key && step.action) {
      const schema = this.getPluginActionSchema(step.plugin_key, step.action)
      if (schema) {
        logger.debug(`[IntentToIRConverter] Using schema for ${step.plugin_key}.${step.action}`)
        finalParams = this.mapParamsToSchema(genericParams, schema, ctx)
      } else {
        logger.debug(`[IntentToIRConverter] No schema found for ${step.plugin_key}.${step.action}, using generic params`)
      }
    }

    const operation: OperationConfig = {
      operation_type: 'fetch',
      fetch: {
        plugin_key: step.plugin_key || 'unknown',
        action: step.action || 'unknown',
        config: finalParams,
      },
      description: step.summary || `Fetch data using ${step.plugin_key || 'unknown'}`
    }

    const node: ExecutionNode = {
      id: nodeId,
      type: 'operation',
      operation,
      outputs: [{ variable: outputVar }],
    }

    ctx.nodes.set(nodeId, node)
    return nodeId
  }

  /**
   * Build parameters for data_source operation
   */
  private buildDataSourceParams(step: DataSourceStep, ctx: ConversionContext): Record<string, any> {
    const params: Record<string, any> = {}

    // Process payload fields (e.g., spreadsheet_id, tab_name from IntentContract)
    if ((step as any).payload) {
      for (const [key, value] of Object.entries((step as any).payload)) {
        params[key] = this.normalizeValueReference(value, ctx)
      }
    }

    // Process inputs array (for operations like get_email_attachment that need references)
    if (step.inputs && step.inputs.length > 0) {
      for (const input of step.inputs) {
        const inputVar = this.resolveRefName(input, ctx)
        // Generic input reference - schema-aware mapping will convert to specific params
        params.input_ref = inputVar
      }
    }

    // Add query if present — resolve structured ValueRef objects (config refs, data refs)
    if (step.query) {
      params.query = this.normalizeValueReference(step.query, ctx)
      logger.debug(`[IntentToIRConverter] Resolved query: ${JSON.stringify(step.query)} → ${params.query}`)
    }

    // Add filters if present — fold into query_filters array for downstream merging
    // Filters represent constraints (e.g., time windows, field conditions) that the LLM
    // declared separately from the query. Many plugins (e.g., Gmail) expect these folded
    // into the query string rather than as standalone params. We emit them as structured
    // metadata so the compiler/runtime can merge them appropriately.
    if (step.filters && step.filters.length > 0) {
      const resolvedFilters: Array<{ field: string; op: string; value: any }> = []
      for (const filter of step.filters) {
        resolvedFilters.push({
          field: filter.field,
          op: filter.op,
          value: this.normalizeValueReference(filter.value, ctx)
        })
      }
      params.query_filters = resolvedFilters
      logger.debug(`[IntentToIRConverter] Resolved ${resolvedFilters.length} query filter(s)`)
    }

    // Add retrieval options if present
    if (step.retrieval) {
      if (step.retrieval.max_results !== undefined) {
        params.max_results = step.retrieval.max_results
      }
      if (step.retrieval.include_attachments !== undefined) {
        params.include_attachments = step.retrieval.include_attachments
      }
    }

    return params
  }

  /**
   * Convert artifact step to operation node
   */
  private convertArtifact(step: ArtifactStep & BoundStep, ctx: ConversionContext): string {
    const nodeId = this.generateNodeId(ctx)
    const outputVar = this.getOutputVariable(step, ctx)

    const params: Record<string, any> = {}

    // Process artifact options FIRST (may contain config references)
    if (step.artifact.options) {
      for (const [key, value] of Object.entries(step.artifact.options)) {
        // Skip 'name' and 'parent_id' from options - these come from name_hint and destination_ref
        if (key !== 'name' && key !== 'parent_id') {
          params[key] = this.normalizeValueReference(value, ctx)
        }
      }
    }

    // SCHEMA-DRIVEN: Map artifact.name_hint to the plugin's first required parameter as FALLBACK only.
    // Options take precedence — name_hint only fills in if the parameter wasn't already set.
    // (name_hint is a label like "vendor_folder" or "sheet_tab", not the actual parameter value.)
    if (step.artifact.name_hint && step.plugin_key && step.action) {
      const schema = this.getPluginActionSchema(step.plugin_key, step.action)
      if (schema && schema.parameters.required && schema.parameters.required.length > 0) {
        const firstRequiredParam = schema.parameters.required[0]
        if (!params[firstRequiredParam]) {
          params[firstRequiredParam] = step.artifact.name_hint
          logger.debug(`[IntentToIRConverter] Mapped artifact.name_hint → ${firstRequiredParam} (fallback, first required param from schema)`)
        } else {
          logger.debug(`[IntentToIRConverter] Skipped artifact.name_hint → ${firstRequiredParam} (already set from options: ${params[firstRequiredParam]})`)
        }
      }
    }

    // TODO: Add support for destination_ref mapping when needed
    // For now, parent folder references should be in artifact.options with correct param name

    // Validate required parameters if schema is available
    if (this.pluginManager && step.plugin_key && step.action) {
      const schema = this.getPluginActionSchema(step.plugin_key, step.action)
      if (schema && schema.parameters.required) {
        for (const requiredParam of schema.parameters.required) {
          if (!params[requiredParam]) {
            ctx.warnings.push(
              `Step ${step.id}: Missing required parameter '${requiredParam}' for ${step.plugin_key}.${step.action}`
            )
          }
        }
      }
    }

    const operation: OperationConfig = {
      operation_type: 'deliver',
      deliver: {
        plugin_key: step.plugin_key || 'unknown',
        action: step.action || 'unknown',
        config: params,
      },
      description: step.summary || `Create artifact using ${step.plugin_key || 'unknown'}`
    }

    const node: ExecutionNode = {
      id: nodeId,
      type: 'operation',
      operation,
      outputs: [{ variable: outputVar }],
    }

    ctx.nodes.set(nodeId, node)

    // Store artifact options in context for later use by deliver steps
    if (step.output && step.artifact.options) {
      ctx.artifactMetadata.set(step.output, params)
      logger.debug(`[IntentToIRConverter] Stored artifact metadata for ${step.output}: ${JSON.stringify(params)}`)
    }

    return nodeId
  }

  /**
   * Convert extract step to operation node
   * Now schema-aware for plugin-based extraction
   */
  private convertExtract(step: ExtractStep & BoundStep, ctx: ConversionContext): string {
    const nodeId = this.generateNodeId(ctx)
    const outputVar = this.getOutputVariable(step, ctx)

    const genericConfig: Record<string, any> = {
      input: this.resolveRefName(step.extract.input, ctx),
      fields: step.extract.fields.map((f: any) => ({
        name: f.name,
        type: f.type,
        required: f.required,
      })),
    }

    if (step.extract.deterministic) {
      genericConfig.deterministic = true
    }

    // Direction #3 (Phase 2b): If the binder already rejected this step's binding
    // due to input-type incompatibility, route to AI extraction immediately.
    // This is the schema-driven check — it runs before the WP-12 heuristic fallback.
    let effectivePluginKey = step.plugin_key
    if (
      step.binding_method === 'unbound' &&
      step.binding_reason?.includes('input_type_incompatible')
    ) {
      logger.info(
        `[O-Dir3] Extract step '${step.id}' unbound by Phase 2b (input_type_incompatible) — routing to AI extraction. ` +
        `Rejected: ${(step.rejected_candidates || []).map(r => `${r.plugin_key}.${r.action_name}`).join(', ')}`
      )
      ctx.warnings.push(
        `[O-Dir3] Rerouted extract step '${step.id}' to AI — binder rejected all candidates due to input-type incompatibility.`
      )
      effectivePluginKey = undefined
    }

    // WP-12 heuristic fallback: If the binder didn't catch it (e.g., missing
    // x-semantic-type annotations), use the tactical heuristic as safety net.
    // This path will be removed once plugin annotations are complete (see A.7 step 8).
    if (
      effectivePluginKey &&
      effectivePluginKey !== 'chatgpt-research' &&
      this.pluginManager &&
      step.action
    ) {
      const pluginExpectsFile = this.actionExpectsFileAttachment(effectivePluginKey, step.action)
      if (pluginExpectsFile) {
        const sourceIsFile = this.inputLooksLikeFileAttachment(step.extract.input, ctx)
        if (!sourceIsFile) {
          logger.info(
            `[O-WP12] ${effectivePluginKey}.${step.action} expects file_attachment but extract.input resolves to text/object — routing to AI extraction instead (heuristic fallback)`
          )
          ctx.warnings.push(
            `[O-WP12] Rerouted extract step '${step.id}' from ${effectivePluginKey} to AI because source variable is not a file attachment (heuristic fallback).`
          )
          effectivePluginKey = undefined
        }
      }
    }

    // Extract uses either AI (for LLM extraction) or deliver (for plugin-based extraction like document-extractor)
    const operation: OperationConfig = effectivePluginKey && effectivePluginKey !== 'chatgpt-research'
      ? (() => {
          // Schema-aware parameter mapping for plugin-based extraction
          let finalConfig = genericConfig
          if (this.pluginManager && step.plugin_key && step.action) {
            const schema = this.getPluginActionSchema(step.plugin_key, step.action)
            if (schema) {
              logger.debug(`[IntentToIRConverter] Using schema for ${step.plugin_key}.${step.action}`)
              // Map 'input' to schema-specific parameter (e.g., 'file_url' for document-extractor)
              const paramSchema = schema.parameters.properties
              for (const [paramName, paramDef] of Object.entries(paramSchema)) {
                const inputMapping = (paramDef as ActionParameterProperty)['x-input-mapping']
                if (inputMapping && genericConfig.input) {
                  // Apply input mapping for file URL extraction
                  finalConfig = { ...genericConfig }
                  delete finalConfig.input
                  finalConfig[paramName] = genericConfig.input
                  logger.debug(`  → Mapped input → ${paramName}`)
                  break
                }
              }
            }
          }

          return {
            operation_type: 'deliver',
            deliver: {
              plugin_key: effectivePluginKey,
              action: step.action || 'extract_structured_data',
              config: finalConfig,
            },
            description: step.summary || `Extract data using ${effectivePluginKey}`
          }
        })()
      : {
          // AI-only extraction branch — runs when there's no file-extractor plugin
          // binding (i.e., the source is free-form text like an email body, a chat
          // message, a webhook payload, or when WP-12 rerouted away from
          // document-extractor). Use ai.type='extract' so the compiler emits an
          // `ai_processing` DSL step (pure LLM call) rather than
          // `deterministic_extraction` (file-oriented — requires PDF/Textract).
          operation_type: 'ai',
          ai: {
            type: 'llm_extract',
            instruction: `Extract the following structured fields from the input text. For each email/message, read the subject, snippet, and body, then extract: ${step.extract.fields.map((f: any) => `${f.name} (${f.type}${f.required ? ', required' : ''}${f.description ? ` — ${f.description}` : ''})`).join('; ')}. Return a JSON object with these fields. If a field cannot be found in the text, set its value to null.`,
            input: this.resolveRefName(step.extract.input, ctx),
            output_schema: {
              fields: step.extract.fields.map((f: any) => ({
                name: f.name,
                type: f.type as any,
                description: f.description,
                required: f.required,
              })),
            }
          },
          description: step.summary || 'AI-powered data extraction'
        }

    const node: ExecutionNode = {
      id: nodeId,
      type: 'operation',
      operation,
      outputs: [{ variable: outputVar }],
    }

    ctx.nodes.set(nodeId, node)
    return nodeId
  }

  /**
   * Convert loop step to loop node
   */
  private convertLoop(step: LoopStep & BoundStep, ctx: ConversionContext): string {
    const nodeId = this.generateNodeId(ctx)
    // D-B16: loop.over may be a ValueRef object (e.g., {kind: "config", key: "summary_recipients"})
    // instead of a plain string. Resolve it using resolveValueRef for structured refs.
    let collectionVar: string
    if (typeof step.loop.over === 'string') {
      collectionVar = this.resolveRefName(step.loop.over, ctx)
    } else if (step.loop.over && typeof step.loop.over === 'object' && 'kind' in step.loop.over) {
      const resolved = this.resolveValueRef(step.loop.over as any, ctx)
      collectionVar = typeof resolved === 'string' ? resolved.replace(/\{\{|\}\}/g, '') : String(resolved || 'unknown')
    } else {
      collectionVar = String(step.loop.over || 'unknown')
    }
    const itemVar = step.loop.item_ref
    const outputVar = step.loop.collect?.collect_as || `${step.id}_results`

    // Convert loop body steps
    const bodyNodeIds = this.convertSteps(step.loop.do, ctx)

    // Connect body nodes in sequence
    for (let i = 0; i < bodyNodeIds.length - 1; i++) {
      const node = ctx.nodes.get(bodyNodeIds[i])
      if (node) {
        node.next = bodyNodeIds[i + 1]
      }
    }

    const loopConfig: LoopConfig = {
      iterate_over: collectionVar,
      item_variable: itemVar,
      body_start: bodyNodeIds[0] || 'undefined',
      collect_outputs: step.loop.collect?.enabled || false,
      output_variable: step.loop.collect?.enabled ? outputVar : undefined,
    }

    const node: ExecutionNode = {
      id: nodeId,
      type: 'loop',
      loop: loopConfig
    }

    ctx.nodes.set(nodeId, node)

    // Register output variable
    if (step.output) {
      ctx.variableMap.set(step.output, outputVar)
    }

    return nodeId
  }

  /**
   * Convert decide step to choice node
   */
  private convertDecide(step: DecideStep & BoundStep, ctx: ConversionContext): string {
    const nodeId = this.generateNodeId(ctx)

    // Create a merge node that both branches will point to after completion
    // This ensures proper control flow and prevents validation errors about nodes with no outgoing edges
    const mergeNodeId = this.generateNodeId(ctx)
    const mergeNode: ExecutionNode = {
      id: mergeNodeId,
      type: 'end',
      description: `Merge point after conditional ${step.id}`
    }
    ctx.nodes.set(mergeNodeId, mergeNode)

    // Convert then branch
    const thenNodeIds = this.convertSteps(step.decide.then, ctx)
    const thenStartNode = thenNodeIds.length > 0 ? thenNodeIds[0] : mergeNodeId

    // Point last node of then branch to merge node
    if (thenNodeIds.length > 0) {
      const lastThenNode = ctx.nodes.get(thenNodeIds[thenNodeIds.length - 1])
      if (lastThenNode && !lastThenNode.next) {
        lastThenNode.next = mergeNodeId
      }
    }

    // Convert else branch if present
    let elseStartNode: string
    if (step.decide.else && step.decide.else.length > 0) {
      const elseNodeIds = this.convertSteps(step.decide.else, ctx)
      elseStartNode = elseNodeIds.length > 0 ? elseNodeIds[0] : mergeNodeId

      // Point last node of else branch to merge node
      if (elseNodeIds.length > 0) {
        const lastElseNode = ctx.nodes.get(elseNodeIds[elseNodeIds.length - 1])
        if (lastElseNode && !lastElseNode.next) {
          lastElseNode.next = mergeNodeId
        }
      }
    } else {
      elseStartNode = mergeNodeId
    }

    // Convert condition
    const condition = this.convertCondition(step.decide.condition, ctx)

    const choiceConfig: ChoiceConfig = {
      rules: [
        {
          condition,
          next: thenStartNode,
        },
      ],
      default: elseStartNode,
    }

    const node: ExecutionNode = {
      id: nodeId,
      type: 'choice',
      choice: choiceConfig,
    }

    ctx.nodes.set(nodeId, node)
    return nodeId
  }

  /**
   * Convert aggregate step to multiple operation nodes
   */
  private convertAggregate(step: AggregateStep & BoundStep, ctx: ConversionContext): string[] {
    const nodeIds: string[] = []
    const inputVar = this.resolveRefName(step.aggregate.input, ctx)

    for (const output of step.aggregate.outputs) {
      const nodeId = this.generateNodeId(ctx)
      const outputVar = output.name

      let operation: OperationConfig

      if (output.type === 'subset') {
        // Subset = filter operation
        const condition = this.convertCondition(output.where, ctx)

        operation = {
          operation_type: 'transform',
          transform: {
            type: 'filter',
            input: inputVar,
            filter_expression: condition,
          },
          description: `Filter subset for ${output.name}`
        }
      } else if (output.type === 'count') {
        operation = {
          operation_type: 'transform',
          transform: {
            type: 'reduce',
            input: output.of ? this.resolveRefName(output.of, ctx) : inputVar,
            reduce_operation: 'count',
          },
          description: `Count items for ${output.name}`
        }
      } else if (output.type === 'sum' || output.type === 'min' || output.type === 'max') {
        // Get field from aggregate output (if provided by LLM)
        const field = (output as any).field

        operation = {
          operation_type: 'transform',
          transform: {
            type: 'reduce',
            input: output.of ? this.resolveRefName(output.of, ctx) : inputVar,
            reduce_operation: output.type as any,
            // Store field in custom_code for compiler to extract (format: "field:fieldname")
            custom_code: field ? `field:${field}` : undefined,
          },
          description: `Aggregate ${output.type} for ${output.name}`
        }

        if (!field) {
          ctx.warnings.push(
            `Aggregate ${output.type} for ${output.name} missing 'field' parameter. ` +
            `Compiler normalization will attempt to fix this based on variable name.`
          )
        }
      } else {
        ctx.warnings.push(`Aggregate output type "${output.type}" not yet supported`)
        continue
      }

      const node: ExecutionNode = {
        id: nodeId,
        type: 'operation',
        operation,
        outputs: [{ variable: outputVar }],
      }

      ctx.nodes.set(nodeId, node)
      ctx.variableMap.set(output.name, outputVar)
      nodeIds.push(nodeId)
    }

    // Connect aggregate nodes in sequence
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const node = ctx.nodes.get(nodeIds[i])
      if (node) {
        node.next = nodeIds[i + 1]
      }
    }

    return nodeIds
  }

  /**
   * Convert deliver step to operation node
   * Now schema-aware: maps generic parameters to plugin-specific parameter names
   */
  private convertDeliver(step: DeliverStep & BoundStep, ctx: ConversionContext): string {
    const nodeId = this.generateNodeId(ctx)
    const outputVar = step.output || `${step.id}_result`

    const genericParams: Record<string, any> = {}

    // Add input data
    const inputVar = this.resolveRefName(step.deliver.input, ctx)
    genericParams.data = inputVar

    // D-B19: Map deliver.mapping entries directly to top-level genericParams.
    // mapping[].to values are param names (spreadsheet_id, range, values), not nested fields.
    // Use resolveValueRef for all from types to get proper {{ }} wrapping.
    if (step.deliver.mapping && step.deliver.mapping.length > 0) {
      for (const m of step.deliver.mapping) {
        if (typeof m.from === 'object' && 'kind' in m.from) {
          genericParams[m.to] = this.resolveValueRef(m.from as any, ctx)
        } else if (typeof m.from === 'object' && 'ref' in m.from) {
          const varName = this.resolveRefName(m.from.ref, ctx)
          genericParams[m.to] = m.from.field ? `${varName}.${m.from.field}` : varName
        } else {
          genericParams[m.to] = m.from
        }
        logger.debug(`  → deliver.mapping: ${m.to} = ${genericParams[m.to]}`)
      }
    }

    // Process deliver options (may contain config references)
    if (step.deliver.options) {
      for (const [key, value] of Object.entries(step.deliver.options)) {
        genericParams[key] = this.normalizeValueReference(value, ctx)
      }
    }

    // Add destination if present
    if (step.deliver.destination) {
      genericParams.destination = this.resolveRefName(step.deliver.destination, ctx)

      // CRITICAL FIX: Extract artifact options when destination references an artifact
      // This ensures parameters like tab_name from sheet artifacts are included
      const artifactOptions = ctx.artifactMetadata.get(step.deliver.destination)
      if (artifactOptions) {
        logger.debug(`[IntentToIRConverter] Extracting artifact options for destination ${step.deliver.destination}`)
        // Merge artifact options into generic params (artifact options take precedence over defaults)
        for (const [key, value] of Object.entries(artifactOptions)) {
          if (!genericParams[key]) {  // Don't overwrite existing params
            genericParams[key] = value
            logger.debug(`  → Added ${key} from artifact: ${value}`)
          }
        }
      }
    }

    // Schema-aware parameter mapping
    let finalParams = genericParams
    if (this.pluginManager && step.plugin_key && step.action) {
      const schema = this.getPluginActionSchema(step.plugin_key, step.action)
      if (schema) {
        logger.debug(`[IntentToIRConverter] Using schema for ${step.plugin_key}.${step.action}`)
        finalParams = this.mapParamsToSchema(genericParams, schema, ctx)

        // Validate required parameters
        if (schema.parameters.required) {
          for (const requiredParam of schema.parameters.required) {
            if (!finalParams[requiredParam]) {
              ctx.warnings.push(
                `Step ${step.id}: Missing required parameter '${requiredParam}' for ${step.plugin_key}.${step.action}`
              )
            }
          }
        }
      } else {
        logger.debug(`[IntentToIRConverter] No schema found for ${step.plugin_key}.${step.action}, using generic params`)
      }
    }

    const operation: OperationConfig = {
      operation_type: 'deliver',
      deliver: {
        plugin_key: step.plugin_key || 'unknown',
        action: step.action || 'unknown',
        config: finalParams,
      },
      description: step.summary || `Deliver data using ${step.plugin_key || 'unknown'}`
    }

    const node: ExecutionNode = {
      id: nodeId,
      type: 'operation',
      operation,
      outputs: [{ variable: outputVar }],
    }

    ctx.nodes.set(nodeId, node)
    if (step.output) {
      ctx.variableMap.set(step.output, outputVar)
    }

    return nodeId
  }

  /**
   * Convert notify step to operation node
   * Maps directly to schema structure - NotifyStep already has proper nested structure
   *
   * WP-1: Schema-driven param binding. Instead of hardcoding which actions are
   * "send-like", load the action's parameter schema and match IntentContract
   * fields (recipients, content, options) to the schema's expected params.
   * Falls back to isSendAction heuristic if plugin schema not available.
   */
  private convertNotify(step: NotifyStep & BoundStep, ctx: ConversionContext): string {
    const nodeId = this.generateNodeId(ctx)

    const action = step.action || 'send_message'
    const pluginKey = step.plugin_key || 'unknown'

    // Build params matching schema structure directly
    const params: Record<string, any> = {}

    // WP-1: Try schema-driven param binding first
    const actionSchema = this.getPluginActionSchema(pluginKey, action)
    const schemaProps = actionSchema?.parameters?.properties
      ? new Set(Object.keys(actionSchema.parameters.properties))
      : null

    if (schemaProps) {
      // Schema available — match IntentContract sources to schema params
      logger.debug(`[WP-1] Schema-driven notify binding for ${pluginKey}/${action}: params [${[...schemaProps].join(', ')}]`)

      // Source 1: notify.recipients → only if schema literally has 'recipients' param
      // For plugins that use different recipient params (channel_id, recipient_phone),
      // the LLM should put them in notify.options with the correct param name.
      if (schemaProps.has('recipients') && step.notify.recipients?.to) {
        params.recipients = {
          to: step.notify.recipients.to.map((r: any) => this.resolveValueRef(r, ctx))
        }
      }

      // Source 2: notify.content → only if schema literally has 'content' param
      // For plugins that use different content params (message_text, body_text),
      // the LLM should put them in notify.options with the correct param name.
      if (schemaProps.has('content') && step.notify.content) {
        const contentObj: Record<string, any> = {}
        if (step.notify.content.subject) {
          contentObj.subject = this.resolveValueRef(step.notify.content.subject, ctx)
        }
        if (step.notify.content.body) {
          if (step.notify.content.format === 'html') {
            contentObj.html_body = this.resolveValueRef(step.notify.content.body, ctx)
          } else {
            contentObj.body = this.resolveValueRef(step.notify.content.body, ctx)
          }
        }
        params.content = contentObj
      }

      // Source 3: notify.options → match each key against schema params.
      // This is the primary source for non-Gmail plugins. The LLM puts
      // plugin-specific params here (channel_id, message_text, recipient_phone, etc.)
      // and we match them directly against the schema. No guessing, no alias lists.
      if (step.notify.options) {
        for (const [key, value] of Object.entries(step.notify.options)) {
          if (schemaProps.has(key) && !params[key]) {
            if (Array.isArray(value)) {
              params[key] = value.map((v: any) => this.resolveValueRef(v, ctx))
            } else {
              params[key] = this.resolveValueRef(value as any, ctx)
            }
          }
        }
      }
    } else {
      // Fallback: no schema available — use isSendAction heuristic (D-B9 original fix)
      const isSendAction = action === 'send_email' || action === 'send_message'
        || action === 'send_template_message' || action === 'send_text_message'
        || action === 'send_interactive_message' || action === 'post_message'

      if (isSendAction) {
        if (step.notify.recipients?.to) {
          params.recipients = {
            to: step.notify.recipients.to.map((r: any) => this.resolveValueRef(r, ctx))
          }
        }
        const contentObj: Record<string, any> = {}
        if (step.notify.content?.subject) {
          contentObj.subject = this.resolveValueRef(step.notify.content.subject, ctx)
        }
        if (step.notify.content?.body) {
          if (step.notify.content.format === 'html') {
            contentObj.html_body = this.resolveValueRef(step.notify.content.body, ctx)
          } else {
            contentObj.body = this.resolveValueRef(step.notify.content.body, ctx)
          }
        }
        params.content = contentObj
      } else {
        if (step.notify.options) {
          for (const [key, value] of Object.entries(step.notify.options)) {
            if (Array.isArray(value)) {
              params[key] = value.map((v: any) => this.resolveValueRef(v, ctx))
            } else {
              params[key] = this.resolveValueRef(value as any, ctx)
            }
          }
        }
      }
    }

    const operation: OperationConfig = {
      operation_type: 'deliver',
      deliver: {
        plugin_key: step.plugin_key || 'unknown',
        action,
        config: params,
      },
      description: step.summary || 'Send notification'
    }

    const node: ExecutionNode = {
      id: nodeId,
      type: 'operation',
      operation
    }

    ctx.nodes.set(nodeId, node)
    return nodeId
  }

  /**
   * Convert generate step to operation node
   */
  private convertGenerate(step: GenerateStep & BoundStep, ctx: ConversionContext): string {
    const nodeId = this.generateNodeId(ctx)
    const outputVar = this.getOutputVariable(step, ctx)

    const inputVar = step.generate.input ? this.resolveRefName(step.generate.input, ctx) : undefined

    // Build output schema from generate.outputs if present
    const outputSchema = step.generate.outputs
      ? this.buildOutputSchemaFromFields(step.generate.outputs)
      : undefined

    const operation: OperationConfig = {
      operation_type: 'ai',
      ai: {
        type: 'generate',
        instruction: step.generate.instruction,
        input: inputVar,
        output_schema: outputSchema,
      },
      description: step.summary || 'AI content generation'
    }

    // Add inputs array if step has multiple inputs (for AI processing that needs multiple variables)
    // CRITICAL: Filter out undeclared variables (e.g., aggregate parent outputs that don't exist)
    const inputs: Array<{ variable: string; path?: string }> = []
    if (step.inputs && step.inputs.length > 0) {
      for (const inputRef of step.inputs) {
        const resolvedVar = this.resolveRefName(inputRef, ctx)
        // Only add if variable was declared (check if any node outputs this variable)
        const isDeclared = Array.from(ctx.nodes.values()).some(n => {
          // Check operation nodes' outputs array
          if (n.outputs?.some(o => o.variable === resolvedVar)) {
            return true
          }
          // Check loop nodes' output_variable field
          if (n.type === 'loop' && n.loop?.output_variable === resolvedVar) {
            return true
          }
          return false
        })
        if (isDeclared) {
          inputs.push({ variable: resolvedVar })
        } else {
          ctx.warnings.push(
            `Skipping undeclared input "${inputRef}" (resolved: "${resolvedVar}") for generate step "${step.id}". ` +
            `This may be an aggregate parent output.`
          )
        }
      }
    }

    const node: ExecutionNode = {
      id: nodeId,
      type: 'operation',
      operation,
      outputs: [{ variable: outputVar }],
      inputs: inputs.length > 0 ? inputs : undefined,
    }

    ctx.nodes.set(nodeId, node)
    return nodeId
  }

  /**
   * Build JSON Schema from field definitions
   */
  private buildOutputSchemaFromFields(fields: any[]): any {
    const properties: Record<string, any> = {}
    const required: string[] = []

    for (const field of fields) {
      properties[field.name] = {
        type: field.type,
        description: field.description,
      }

      if (field.required !== false) {
        required.push(field.name)
      }
    }

    return {
      type: 'object',
      properties,
      required,
    }
  }

  /**
   * Convert transform step to operation node
   */
  private convertTransform(step: TransformStep & BoundStep, ctx: ConversionContext): string {
    const nodeId = this.generateNodeId(ctx)
    const outputVar = this.getOutputVariable(step, ctx)

    const inputVar = this.resolveRefName(step.transform.input, ctx)

    const transformConfig: any = {
      type: step.transform.op as any, // map, filter, reduce, flatten, custom, etc.
      input: inputVar,
      custom_code: step.transform.description,
    }

    // Preserve output_schema if present (critical for downstream steps)
    if (step.transform.output_schema) {
      transformConfig.output_schema = step.transform.output_schema
    }

    // Use structured condition if present (for reliable filter execution)
    if (step.transform.op === 'filter' && (step.transform as any).where) {
      transformConfig.condition = this.convertCondition((step.transform as any).where, ctx, { isFilterContext: true, inputVar })
      logger.debug(`[IntentToIRConverter] Using structured filter condition`)
    }

    // Transfer rules if present (e.g., group_by for group operations)
    if ((step.transform as any).rules) {
      transformConfig.rules = (step.transform as any).rules
      logger.debug(`[IntentToIRConverter] Transferring transform rules:`, transformConfig.rules)
    }

    // WP-4: Transfer structured field mapping if present (replaces custom_code for map transforms)
    // The IntentContract LLM emits mapping: [{to: "sender", from: "from"}, ...]
    // Convert to field_mapping: {sender: "from", ...} for the runtime
    if (step.transform.op === 'map' && (step.transform as any).mapping && Array.isArray((step.transform as any).mapping)) {
      const mapping = (step.transform as any).mapping as Array<{ to: string; from: string }>
      transformConfig.field_mapping = mapping.reduce((acc: Record<string, string>, m) => {
        acc[m.to] = m.from
        return acc
      }, {} as Record<string, string>)
      // Clear custom_code when we have a structured mapping — it's redundant
      if (transformConfig.field_mapping && Object.keys(transformConfig.field_mapping).length > 0) {
        delete transformConfig.custom_code
      }
      logger.debug(`[IntentToIRConverter] WP-4: Converted mapping to field_mapping:`, transformConfig.field_mapping)
    }

    const operation: OperationConfig = {
      operation_type: 'transform',
      transform: transformConfig,
      description: step.summary || `Transform data: ${step.transform.op}`
    }

    const node: ExecutionNode = {
      id: nodeId,
      type: 'operation',
      operation,
      outputs: [{ variable: outputVar }],
    }

    ctx.nodes.set(nodeId, node)
    return nodeId
  }

  /**
   * Convert classify step to AI operation node
   * Classification is treated as AI-powered labeling/tagging
   */
  private convertClassify(step: any, ctx: ConversionContext): string {
    const nodeId = this.generateNodeId(ctx)
    const outputVar = this.getOutputVariable(step, ctx)

    const inputVar = this.resolveRefName(step.classify.input, ctx)

    // Build classification instruction
    const labels = step.classify.labels || ['positive', 'negative']
    const outputField = step.classify.output_field || 'classification'

    const instruction = step.classify.instruction ||
      `Classify each item into one of these categories: ${labels.join(', ')}. ` +
      `Store the classification result in the '${outputField}' field for each item.`

    // Create output schema that preserves all input fields plus adds classification field
    // Uses the { fields: [...] } format expected by DeclarativeLogicalIRv4 AIOperationConfig
    const outputSchema = {
      fields: [{
        name: outputField,
        type: 'string' as const,
        description: `Classification result (one of: ${labels.join(', ')})`
      }]
    }

    const operation: OperationConfig = {
      operation_type: 'ai',
      ai: {
        type: 'classify',
        instruction,
        input: inputVar,
        labels,
        output_schema: outputSchema
      },
      description: step.summary || `Classify items into categories: ${labels.join(', ')}`
    }

    const node: ExecutionNode = {
      id: nodeId,
      type: 'operation',
      operation,
      outputs: [{ variable: outputVar }],
    }

    ctx.nodes.set(nodeId, node)
    return nodeId
  }

  /**
   * Convert Intent Condition to IR ConditionExpression
   */
  private convertCondition(
    condition: Condition,
    ctx: ConversionContext,
    options?: { isFilterContext?: boolean; inputVar?: string }
  ): ConditionExpression {
    if (condition.op === 'and' || condition.op === 'or') {
      const complex: ComplexCondition = {
        type: 'complex',
        operator: condition.op,
        conditions: condition.conditions.map((c) => this.convertCondition(c, ctx, options)),
      }
      return complex
    } else if (condition.op === 'not') {
      const complex: ComplexCondition = {
        type: 'complex',
        operator: 'not',
        conditions: [this.convertCondition(condition.condition, ctx, options)],
      }
      return complex
    } else if (condition.op === 'test') {
      // Convert comparator to IR operator
      const operator = this.convertComparator(condition.comparator)

      let variable = this.resolveValueRefToVariable(condition.left, ctx)

      // CRITICAL FIX: For filter operations, convert "array_name.field" to "item.field"
      // Filter runtime iterates over array items, so field references must use "item" prefix
      if (options?.isFilterContext && options?.inputVar && variable.startsWith(options.inputVar + '.')) {
        let fieldName = variable.substring(options.inputVar.length + 1)
        // NEW: Resolve field name from config if it matches a config key pattern
        fieldName = this.resolveFieldNameFromConfig(fieldName, ctx)
        variable = `item.${fieldName}`
        logger.debug(`[IntentToIRConverter] Normalized filter field: ${options.inputVar}.${fieldName} → item.${fieldName}`)
      }

      const value = condition.right ? this.resolveValueRef(condition.right, ctx) : undefined

      const simple: SimpleCondition = {
        type: 'simple',
        variable,
        operator,
        value,
      }
      return simple
    } else {
      // TypeScript exhaustiveness check - should never reach here
      const _exhaustiveCheck: never = condition
      throw new Error(`Unknown condition op: ${(_exhaustiveCheck as any).op}`)
    }
  }

  /**
   * Convert Intent comparator to IR operator
   */
  private convertComparator(comparator: string): SimpleCondition['operator'] {
    const map: Record<string, SimpleCondition['operator']> = {
      eq: 'eq',
      ne: 'ne',
      gt: 'gt',
      gte: 'gte',
      lt: 'lt',
      lte: 'lte',
      contains: 'contains',
      exists: 'exists',
      is_empty: 'is_empty',
      not_empty: 'exists', // Map to exists
      in: 'in', // FIXED: Preserve 'in' operator for array membership checks
      starts_with: 'starts_with',
      ends_with: 'ends_with',
      matches: 'matches',
    }

    return map[comparator] || 'eq'
  }

  /**
   * Resolve ValueRef to actual value
   */
  private resolveValueRef(valueRef: ValueRef | undefined, ctx: ConversionContext): any {
    if (!valueRef) return undefined

    switch (valueRef.kind) {
      case 'literal':
        return valueRef.value

      case 'ref':
        const varName = this.resolveRefName(valueRef.ref, ctx)
        if (valueRef.field && typeof valueRef.field === 'string') {
          this.validateFieldReference(valueRef.ref, valueRef.field, ctx)
          return `${varName}.${valueRef.field}`
        }
        return valueRef.field ? `${varName}.${valueRef.field}` : varName

      case 'config':
        return `{{config.${valueRef.key}}}`

      case 'computed':
        // O21: Basic computed expression support — handles concat and falls back gracefully
        if (valueRef.op === 'concat' && Array.isArray(valueRef.args)) {
          const resolvedArgs = valueRef.args.map((arg: any) => {
            const resolved = this.resolveValueRef(arg, ctx)
            return resolved !== undefined ? String(resolved) : ''
          })
          // If all args resolved, concatenate them
          const result = resolvedArgs.join('')
          if (result) {
            logger.debug(`[IntentToIRConverter] O21: Resolved computed concat: ${JSON.stringify(valueRef.args)} → ${result}`)
            return result
          }
        }
        // Fallback: try to resolve the first config arg as a simple reference
        if (Array.isArray(valueRef.args)) {
          const configArg = valueRef.args.find((a: any) => a.kind === 'config')
          if (configArg) {
            const fallback = this.resolveValueRef(configArg, ctx)
            logger.debug(`[IntentToIRConverter] O21: Computed fallback to first config arg: ${fallback}`)
            return fallback
          }
        }
        ctx.warnings.push(`Computed ValueRef with op "${valueRef.op}" not fully resolved`)
        return undefined

      default:
        return undefined
    }
  }

  /**
   * Resolve ValueRef to variable name (for conditions)
   */
  private resolveValueRefToVariable(valueRef: ValueRef, ctx: ConversionContext): string {
    if (valueRef.kind === 'ref') {
      const varName = this.resolveRefName(valueRef.ref, ctx)
      if (valueRef.field) {
        // Check if field is a config reference object
        if (typeof valueRef.field === 'object' && 'kind' in valueRef.field) {
          // It's a ValueRef object, resolve it to get the config placeholder
          const fieldValue = this.resolveValueRef(valueRef.field as ValueRef, ctx)
          // The fieldValue is already in {{config.xxx}} format, just append it
          return `${varName}.${fieldValue}`
        }
        // Plain string field
        return `${varName}.${valueRef.field}`
      }
      return varName
    }
    return 'unknown'
  }

  /**
   * Normalize a value that may be a ValueRef or a plain value
   * Used for config parameters that can be literals, refs, or config references
   */
  private normalizeValueReference(value: any, ctx: ConversionContext): any {
    // If it's an object with 'kind' field, it's a ValueRef
    if (value && typeof value === 'object' && 'kind' in value) {
      const resolved = this.resolveValueRef(value as ValueRef, ctx)
      // Wrap bare ref values in {{}} template syntax for IR config values.
      // Config refs (kind: "config") already return {{config.key}}, but
      // data refs (kind: "ref") return bare "varName.field" — wrap them.
      if (typeof resolved === 'string' && !resolved.includes('{{') && value.kind === 'ref') {
        return `{{${resolved}}}`
      }
      return resolved
    }
    // Otherwise, return as-is (literal value)
    return value
  }

  /**
   * Resolve field name from config if it matches a field name config pattern
   * This fixes LLM-generated field references that use config keys instead of actual field names
   */
  private resolveFieldNameFromConfig(fieldName: string, ctx: ConversionContext): string {
    if (!ctx.config || !fieldName) return fieldName

    // Check if fieldName matches a config key that ends with _column_name or _field_name
    for (const configParam of ctx.config) {
      if (configParam.key === fieldName &&
          (configParam.key.endsWith('_column_name') || configParam.key.endsWith('_field_name'))) {
        // Found a match - return the default value if available
        if (configParam.default && typeof configParam.default === 'string') {
          logger.debug(`[IntentToIRConverter] Resolved field name: ${fieldName} → ${configParam.default} (from config)`)
          return configParam.default
        }
      }
    }

    return fieldName
  }

  /**
   * Validate that a field reference exists in the data_schema slot.
   * Logs warnings (not errors) for unresolvable references — downstream phases may still fix them.
   */
  private validateFieldReference(refName: string, fieldName: string, ctx: ConversionContext): void {
    if (!ctx.dataSchema) return // No data_schema available, skip validation

    const slot = ctx.dataSchema.slots[refName]
    if (!slot) {
      ctx.warnings.push(
        `Field reference: "${refName}.${fieldName}" — slot "${refName}" not found in data_schema`
      )
      return
    }

    // Only validate field access on object schemas with declared properties
    if (slot.schema.type === 'object' && slot.schema.properties) {
      if (!slot.schema.properties[fieldName]) {
        ctx.warnings.push(
          `Field reference: "${refName}.${fieldName}" — field "${fieldName}" not found in slot schema ` +
            `(available: ${Object.keys(slot.schema.properties).join(', ')})`
        )
      }
    }
    // For array types, field access may target item properties — skip validation here
    // (would need to check items.properties which is a deeper validation)
  }

  /**
   * Resolve RefName to IR variable name
   */
  private resolveRefName(refName: string, ctx: ConversionContext): string {
    return ctx.variableMap.get(refName) || refName
  }

  /**
   * Get or create output variable for a step
   */
  private getOutputVariable(step: IntentStep, ctx: ConversionContext): string {
    if (step.output) {
      const varName = step.output
      ctx.variableMap.set(step.output, varName)
      return varName
    }
    return `${step.id}_result`
  }

  /**
   * Generate unique node ID
   */
  private generateNodeId(ctx: ConversionContext): string {
    return `node_${ctx.nodeCounter++}`
  }

  /**
   * Add end node to graph
   */
  private addEndNode(ctx: ConversionContext): string {
    const nodeId = 'node_end'
    if (!ctx.nodes.has(nodeId)) {
      const node: ExecutionNode = {
        id: nodeId,
        type: 'end',
      }
      ctx.nodes.set(nodeId, node)
    }
    return nodeId
  }

  /**
   * Get plugin action schema from plugin manager
   */
  private getPluginActionSchema(pluginKey: string, actionName: string): ActionDefinition | null {
    if (!this.pluginManager) return null
    return this.pluginManager.getActionDefinition(pluginKey, actionName) || null
  }

  /**
   * WP-11: Force content_level=full on fetch steps whose output is consumed by
   * downstream extract/ai steps. Schema-driven — only applies to fetch actions
   * whose plugin schema declares a `content_level` enum param (generic, not
   * gmail-specific).
   *
   * Without this, the default (e.g. Gmail search_emails → 'snippet') returns
   * empty email bodies, and downstream extraction silently returns "Unknown X"
   * placeholder values for every field.
   */
  private enforceContentLevelForExtraction(ctx: ConversionContext): void {
    // Does the graph contain any extraction-like step (ai node, or deliver.extract_*)?
    let hasExtractionConsumer = false
    for (const node of ctx.nodes.values()) {
      const op = node.operation
      if (!op) continue
      if (op.operation_type === 'ai') {
        hasExtractionConsumer = true
        break
      }
      if (
        op.operation_type === 'deliver' &&
        typeof op.deliver?.action === 'string' &&
        /extract/i.test(op.deliver.action)
      ) {
        hasExtractionConsumer = true
        break
      }
    }
    if (!hasExtractionConsumer) return

    // For each fetch node: if its plugin schema has a content_level enum param
    // that includes 'full', set it to 'full' unless already explicit.
    for (const node of ctx.nodes.values()) {
      const op = node.operation
      if (!op || op.operation_type !== 'fetch' || !op.fetch) continue

      const { plugin_key, action, config } = op.fetch
      if (!plugin_key || !action) continue

      const schema = this.getPluginActionSchema(plugin_key, action)
      const contentLevelProp = schema?.parameters?.properties?.content_level as ActionParameterProperty | undefined
      if (!contentLevelProp) continue
      const enumValues = (contentLevelProp as any).enum as string[] | undefined
      if (!enumValues || !enumValues.includes('full')) continue

      if ((config as any).content_level === 'full') continue

      const previous = (config as any).content_level
      ;(config as any).content_level = 'full'
      logger.info(
        `[O-WP11] Set content_level='full' for ${plugin_key}.${action} (was ${previous ?? 'unset'}) — graph has extraction consumer`
      )
      ctx.warnings.push(
        `[O-WP11] Auto-set content_level='full' on ${plugin_key}.${action} because downstream step extracts from body text.`
      )
    }
  }

  /**
   * WP-12: Does this plugin action declare an input param that expects a file
   * attachment? Recognised signals:
   *   1. `x-variable-mapping.from_type === 'file_attachment'`
   *   2. `x-input-mapping.accepts` contains 'file_object' (e.g., document-extractor)
   *   3. Param named `file_url` / `file_content` / `file_path` / `mime_type`
   * If yes, the action is designed for files (PDF/XLSX/image) — not free-form text.
   */
  private actionExpectsFileAttachment(pluginKey: string, actionName: string): boolean {
    const schema = this.getPluginActionSchema(pluginKey, actionName)
    const props = schema?.parameters?.properties
    if (!props) return false
    const FILE_PARAM_NAMES = new Set(['file_url', 'file_content', 'file_path', 'mime_type', 'mimeType'])
    for (const [paramName, paramDef] of Object.entries(props)) {
      const pd = paramDef as ActionParameterProperty
      const varMapping = (pd as any)['x-variable-mapping']
      if (varMapping?.from_type === 'file_attachment') return true
      const inputMapping = (pd as any)['x-input-mapping']
      const accepts = Array.isArray(inputMapping?.accepts) ? inputMapping.accepts : []
      if (accepts.includes('file_object') || accepts.includes('file_attachment')) return true
      if (FILE_PARAM_NAMES.has(paramName)) return true
    }
    return false
  }

  /**
   * WP-12: Does the named input variable resolve to something that looks like a
   * file attachment? A file attachment schema has one of: file_url, attachment_id,
   * mimeType, file_content. A text object (email, message, post) has body/subject/
   * text/content/snippet instead. Walks data_schema to find the variable or its
   * parent collection's item schema.
   */
  private inputLooksLikeFileAttachment(inputName: string, ctx: ConversionContext): boolean {
    const dataSchema = ctx.dataSchema
    if (!dataSchema?.slots) {
      // Without schema info, be conservative — assume NOT a file so we fall back to AI
      return false
    }

    const FILE_MARKERS = new Set(['file_url', 'attachment_id', 'mimeType', 'file_content', 'file_path'])
    const TEXT_MARKERS = new Set(['body', 'subject', 'snippet', 'message', 'text', 'content'])

    const inspectObjectSchema = (objSchema: any): 'file' | 'text' | 'unknown' => {
      const props = objSchema?.properties
      if (!props || typeof props !== 'object') return 'unknown'
      const keys = Object.keys(props)
      const hasFile = keys.some(k => FILE_MARKERS.has(k))
      const hasText = keys.some(k => TEXT_MARKERS.has(k))
      if (hasFile && !hasText) return 'file'
      if (hasText && !hasFile) return 'text'
      if (hasFile && hasText) return 'text' // email with attachments field is still text-primary
      return 'unknown'
    }

    // Direct slot match (e.g., variable === a top-level slot name)
    const directSlot = dataSchema.slots[inputName]
    if (directSlot?.schema) {
      const verdict = inspectObjectSchema(directSlot.schema)
      if (verdict !== 'unknown') return verdict === 'file'
    }

    // Walk slots looking for item schemas whose TOP-LEVEL fields match our input's
    // role. We prioritize text detection: any item-schema that looks like an email/
    // message/post is treated as text, even if it has a nested `attachments` array.
    // Only return 'file' if we find an item schema whose top-level fields are
    // exclusively file markers (e.g., a standalone file attachment list).
    let sawTextItems = false
    let sawFileItems = false
    for (const slot of Object.values(dataSchema.slots) as any[]) {
      const slotSchema = slot?.schema
      if (!slotSchema?.properties) continue
      for (const propDef of Object.values(slotSchema.properties) as any[]) {
        if (propDef?.type === 'array' && propDef.items?.type === 'object') {
          const verdict = inspectObjectSchema(propDef.items)
          if (verdict === 'text') sawTextItems = true
          if (verdict === 'file') sawFileItems = true
        }
      }
    }

    // If any collection in the graph has text-like items, the loop variable
    // is likely one of those (emails/messages/posts) — treat as text.
    if (sawTextItems) return false
    // Only when the graph exclusively contains file-like collections do we
    // treat the input as a file attachment.
    if (sawFileItems) return true

    // Unknown — default to not-a-file so we fall back to AI extraction
    // (safer than feeding free text to a file-extractor plugin).
    return false
  }

  /**
   * Map generic deliver parameters to schema-specific parameters
   * Uses x-variable-mapping to decompose objects into individual parameters
   */
  private mapParamsToSchema(
    genericParams: Record<string, any>,
    schema: ActionDefinition,
    ctx: ConversionContext
  ): Record<string, any> {
    const mappedParams: Record<string, any> = {}
    const paramSchema = schema.parameters.properties

    // FIRST: Handle x-from-artifact parameters
    // These are parameters that should be automatically extracted from artifact options
    for (const [paramName, paramDef] of Object.entries(paramSchema)) {
      const fromArtifact = (paramDef as any)['x-from-artifact']
      if (!fromArtifact) continue

      // Get the artifact field name (defaults to same as param name)
      const artifactField = (paramDef as any)['x-artifact-field'] || paramName

      // Check if this field exists in any of the generic params (from artifact extraction)
      if (genericParams[artifactField]) {
        mappedParams[paramName] = genericParams[artifactField]
        logger.debug(`  → Mapped artifact field '${artifactField}' → '${paramName}' (x-from-artifact)`)
      }
    }

    // Convention-based mapping using from_type in x-variable-mapping
    // Convention:
    // - from_type='folder' → maps from 'destination' generic param
    // - from_type='file_attachment' → maps from 'data' generic param
    // - from_type=<other> → maps from 'input_ref' generic param
    // - no from_type → tries all generic params in order (destination, data, input_ref)

    const typeToGenericParam: Record<string, any> = {
      'folder': 'destination',
      'file_attachment': 'data',
    }

    for (const [paramName, paramDef] of Object.entries(paramSchema)) {
      const mapping = (paramDef as ActionParameterProperty)['x-variable-mapping']
      if (!mapping) continue

      // Determine which generic param to use based on from_type
      let sourceParam: string | null = null

      if (mapping.from_type) {
        // Use conventional mapping if defined
        sourceParam = typeToGenericParam[mapping.from_type] || 'input_ref'
      }

      // Try the determined source first, then fall back to trying all
      const tryOrder = sourceParam
        ? [sourceParam, ...['destination', 'data', 'input_ref'].filter(p => p !== sourceParam)]
        : ['destination', 'data', 'input_ref']

      for (const genericKey of tryOrder) {
        if (mappedParams[paramName]) break  // Already mapped
        if (!genericParams[genericKey]) continue

        const genericVar = genericParams[genericKey]
        mappedParams[paramName] = `${genericVar}.${mapping.field_path}`
        logger.debug(`  → Mapped ${genericVar} → ${paramName} (extract: ${mapping.field_path}${mapping.from_type ? `, from_type: ${mapping.from_type}` : ''})`)
        break
      }
    }

    // Final fallback: if data param exists and no mappings were made, pass data as-is
    if (genericParams.data && Object.keys(mappedParams).length === 0 && schema.parameters.required) {
      const firstRequired = schema.parameters.required[0]
      if (firstRequired) {
        mappedParams[firstRequired] = genericParams.data
        logger.debug(`  → Mapped ${genericParams.data} → ${firstRequired} (last resort fallback)`)
      }
    }

    // Handle 'input_ref' parameter - map using x-variable-mapping
    if (genericParams.input_ref && paramSchema) {
      const inputVar = genericParams.input_ref

      // Use x-variable-mapping to decompose input_ref into schema parameters
      // Skip parameters already mapped by 'data' or 'destination'
      for (const [paramName, paramDef] of Object.entries(paramSchema)) {
        if (mappedParams[paramName]) continue  // Already mapped, skip

        const mapping = (paramDef as ActionParameterProperty)['x-variable-mapping']

        if (mapping) {
          // Apply variable mapping: input_ref variable → schema parameter with field extraction
          mappedParams[paramName] = `${inputVar}.${mapping.field_path}`
          logger.debug(`  → Mapped ${inputVar} → ${paramName} (extract: ${mapping.field_path})`)
        }
      }
    }

    // Copy over any other parameters that aren't generic (fields, options, etc.)
    // BUT ONLY if they're defined in the plugin schema OR are special fields like 'fields'
    for (const [key, value] of Object.entries(genericParams)) {
      if (key !== 'data' && key !== 'destination' && key !== 'input_ref' && !mappedParams[key]) {
        // Only copy if it's in the schema OR it's a special field like 'fields'
        if (paramSchema[key] || key === 'fields') {
          mappedParams[key] = value
        }
      }
    }

    return mappedParams
  }
}
