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
import type { ExtractCoverageVerdict, CoverageField } from '../capability-binding/ExtractionCoverage'
import { baseVarOfRef, classifySchemaFileness, bytesFieldOf, schemaHasBytes } from '../capability-binding/ExtractionCoverage'
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
import { detectReferencedInScopeVariables, extractBaseVarName } from './ai-input-context'
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
  outputProducerPlugin: Map<string, string> // IR variable name -> plugin_key that produced it (for download auto-insert, WP-57)
  loopItemVarStack: string[] // Item 11 / WP-58: enclosing scatter loop `item_ref`s, so an AI step in the loop body can detect a referenced loop variable
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
      outputProducerPlugin: new Map(),
      loopItemVarStack: [],
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
        return this.convertExtract(step as ExtractStep & BoundStep, ctx)

      case 'loop':
        return [this.convertLoop(step as LoopStep & BoundStep, ctx)]

      case 'decide':
        return [this.convertDecide(step as DecideStep & BoundStep, ctx)]

      case 'aggregate':
        return this.convertAggregate(step as AggregateStep & BoundStep, ctx)

      case 'deliver':
        return this.convertDeliver(step as DeliverStep & BoundStep, ctx)

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
        // P3.2 (EP required-plugin-param cycle): bind a dropped search subject to
        // the action's single unbound required string param (schema-driven).
        this.bindSearchSubjectToRequiredParam(finalParams, genericParams, schema, step, ctx)

        // B5: required-param warning for parity with convertDeliver/convertArtifact
        // (convertDataSource previously had none — the search path emitted params:{}
        // with not even a warning). Runs AFTER P3.2 so it only fires on genuinely
        // unbound required params. The compiler's P3.1 pass is the plugin-agnostic
        // backstop; this catches it one phase earlier for search/data-source steps.
        if (schema.parameters.required) {
          for (const requiredParam of schema.parameters.required) {
            if (!finalParams[requiredParam]) {
              ctx.warnings.push(
                `Step ${(step as any).id ?? ''}: Missing required parameter '${requiredParam}' for ${step.plugin_key}.${step.action}`
              )
            }
          }
        }
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
    // WP-57: remember which plugin produced this output so a downstream file-extractor
    // can find the right provider's download action.
    if (step.plugin_key && outputVar) {
      ctx.outputProducerPlugin.set(outputVar, step.plugin_key)
    }
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
  private convertExtract(step: ExtractStep & BoundStep, ctx: ConversionContext): string[] {
    const nodeId = this.generateNodeId(ctx)
    const outputVar = this.getOutputVariable(step, ctx)

    // WP-62: the binder (Phase 2c) may have authored an authoritative
    // deterministic-vs-AI coverage verdict. When present, the converter HONORS it
    // (single decision-maker — Q1 anti-double-decision guard) and never recomputes
    // coverage or re-runs the heuristic rerouters below.
    const coverage = (step as BoundStep).extract_coverage as ExtractCoverageVerdict | undefined
    const isCoveredSplit = !!(coverage?.covered && coverage.residualFields.length > 0)

    // Fields the deterministic extractor is asked to produce: the document-surface
    // subset when the binder authored coverage, else the full declared set.
    const deterministicFields: CoverageField[] =
      coverage?.covered ? coverage.surfaceFields : (step.extract.fields as CoverageField[])

    const genericConfig: Record<string, any> = {
      input: this.resolveRefName(step.extract.input, ctx),
      fields: deterministicFields.map((f: any) => ({
        name: f.name,
        type: f.type,
        required: f.required,
      })),
    }

    if (step.extract.deterministic) {
      genericConfig.deterministic = true
    }

    let effectivePluginKey = step.plugin_key

    if (coverage) {
      // HONOR the binder's authoritative verdict (Q1). Covered → keep the
      // binder-authored deterministic binding; not covered → AI branch (net
      // preserved). The heuristic rerouters below are SKIPPED so nothing can
      // strip a binder-authored binding (B3 / AC-6).
      // NOTE: the observability log is emitted AFTER the file-param resolution
      // block below, so `branch` reflects the FINAL branch — the H1 safe-direction
      // reroute may still flip a covered verdict to AI when no bytes field resolves
      // (SA nit N4: don't log "deterministic-bind" before that can happen).
      effectivePluginKey = coverage.covered ? step.plugin_key : undefined
    } else {
      // Legacy path (no coverage verdict authored, e.g. non-document extract or a
      // cached pre-WP-62 bound contract): the pre-existing heuristic rerouters.

      // Direction #3 (Phase 2b): If the binder already rejected this step's binding
      // due to input-type incompatibility, route to AI extraction immediately.
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
    }

    // WP-57 auto-insert: when extraction is bound to a file-input plugin (e.g.
    // document-extractor) but the input slot is a file *reference* without bytes (a
    // storage listing item — id/name/mimeType, no content), the extractor would receive
    // metadata and fail. Insert a content-fetch step on the file's producer plugin to
    // download the bytes first, then point the extract at that. Plugin-agnostic: the
    // download action is discovered from the producer plugin's schema (an action that
    // returns x-semantic-type=file_attachment bytes and takes a file_id). Narrowly
    // guarded — only fires for the otherwise-broken reference case.
    const prependNodeIds: string[] = []
    if (
      effectivePluginKey &&
      effectivePluginKey !== 'chatgpt-research' &&
      this.pluginManager &&
      step.action &&
      this.actionExpectsFileAttachment(effectivePluginKey, step.action) &&
      !this.slotHasBytes(step.extract.input, ctx)
    ) {
      const resolvedInput = this.resolveRefName(step.extract.input, ctx)
      const cleanRef = resolvedInput.replace(/\{\{|\}\}/g, '')
      const producerPlugin =
        ctx.outputProducerPlugin.get(cleanRef) ||
        ctx.outputProducerPlugin.get(step.extract.input)
      const dl = producerPlugin ? this.findDownloadAction(producerPlugin) : null
      if (dl) {
        const downloadNodeId = this.generateNodeId(ctx)
        const downloadOutputVar = `${cleanRef}_bytes`
        const downloadNode: ExecutionNode = {
          id: downloadNodeId,
          type: 'operation',
          operation: {
            operation_type: 'fetch',
            fetch: {
              plugin_key: dl.pluginKey,
              action: dl.action,
              config: { file_id: `{{${cleanRef}.id}}` },
            },
            description: `Download file bytes for '${cleanRef}' before extraction (WP-57 auto-insert)`,
          },
          outputs: [{ variable: downloadOutputVar }],
          next: nodeId,
        }
        ctx.nodes.set(downloadNodeId, downloadNode)
        ctx.outputProducerPlugin.set(downloadOutputVar, dl.pluginKey)
        // Point the extractor at the downloaded bytes instead of the metadata reference.
        genericConfig.input = downloadOutputVar
        prependNodeIds.push(downloadNodeId)
        logger.info(
          `[O-WP57] Auto-inserted ${dl.pluginKey}.${dl.action} before extract '${step.id}' — ` +
          `${effectivePluginKey} needs file bytes but input '${cleanRef}' is a metadata reference.`
        )
        ctx.warnings.push(
          `[O-WP57] Auto-inserted ${dl.pluginKey}.${dl.action} before extract '${step.id}' to fetch file bytes for ${effectivePluginKey}.`
        )
      }
    }

    // WP-62 hotfix (live-validation gap, agent `2ffcd7bf`): a param that accepts a
    // file_object declares `type: "string"` (base64 bytes) — it must receive the
    // producer's BYTES FIELD, not the whole producer object. Phase 1 legitimately
    // emits either granularity (`attachment_content` OR `attachment_content.data`),
    // so the ref granularity must be resolved HERE in reliable code — the same
    // thesis WP-62 applied to the routing decision. Previously the mapping copied
    // the ref verbatim → `file_content: {{attachment_content}}` → runtime
    // "should be string, got object" → every scatter item failed.
    //
    // Idempotent by construction: the ref is always REBUILT from `baseVarOfRef` +
    // the schema's bytes field, so an already-`.data` ref resolves to the same
    // `.data` (never `.data.data`). Schema-driven: the bytes key comes from the
    // producer slot's schema via the shared `bytesFieldOf` — never a plugin/field
    // name branch (Principle 6 / Anti-pattern F).
    let fileParamBinding: { paramName: string; ref: string } | null = null
    if (
      effectivePluginKey &&
      effectivePluginKey !== 'chatgpt-research' &&
      this.pluginManager &&
      step.plugin_key &&
      step.action &&
      genericConfig.input
    ) {
      const schema = this.getPluginActionSchema(step.plugin_key, step.action)
      const paramProps = (schema?.parameters?.properties || {}) as Record<string, any>
      // Mirror the mapping loop below: the FIRST x-input-mapping param is the target.
      const target = Object.entries(paramProps).find(([, pd]) => !!pd?.['x-input-mapping'])
      if (target && this.paramAcceptsFileObject(target[1])) {
        const [paramName] = target
        const slotSchema = this.resolveSlotSchema(genericConfig.input, ctx)
        // Only navigate when the slot is a known OBJECT. An unknown slot (e.g. the
        // WP-57 auto-inserted download output) or an already-string slot keeps the
        // legacy verbatim copy — no behaviour change for those paths.
        if (slotSchema && slotSchema.type !== 'string') {
          const bytesField = bytesFieldOf(slotSchema)
          if (bytesField) {
            const baseVar = baseVarOfRef(this.resolveRefName(genericConfig.input, ctx))
            fileParamBinding = { paramName, ref: `${baseVar}.${bytesField}` }
            logger.info(
              { stepId: step.id, param: paramName, from: genericConfig.input, to: fileParamBinding.ref, bytesField },
              '[WP-62] Resolved file-object param to the producer bytes field (reliable-code ref granularity)',
            )
          } else {
            // A bytes-less object would violate the param's declared string type at
            // runtime. Do NOT emit a broken ref — fall back to the AI net (safe
            // direction), visibly (Principle 11: no silent default).
            logger.warn(
              { stepId: step.id, param: paramName, input: genericConfig.input },
              '[WP-62] Extract input resolves to an object with no bytes field — cannot bind a file-object param; routing to AI extraction (net preserved)',
            )
            ctx.warnings.push(
              `[WP-62] Rerouted extract step '${step.id}' to AI — input '${genericConfig.input}' is an object with no bytes field for ${effectivePluginKey}.${step.action}'s '${paramName}'.`,
            )
            effectivePluginKey = undefined
          }
        }
      }
    }

    // WP-62 observability (AC-7 / SA nit N4): log the FINAL chosen branch after the
    // H1 file-param resolution — `deterministic-bind` only when a live binding truly
    // survives, else `ai-fallback` (including the safe-direction reroute above).
    if (coverage) {
      logger.info(
        {
          stepId: step.id,
          branch: effectivePluginKey ? 'deterministic-bind' : 'ai-fallback',
          decidingCriterion: coverage.decidingCriterion,
          plugin: effectivePluginKey || undefined,
          rerouted: coverage.covered && !effectivePluginKey,
          surfaceFields: coverage.surfaceFields.map((f) => f.name),
          residualFields: coverage.residualFields.map((f) => f.name),
        },
        `[WP-62] convertExtract honoring binder coverage verdict: ${coverage.reason}`,
      )
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
                  // WP-62 hotfix: a file-object param takes the bytes-navigated ref
                  // resolved above (e.g. `attachment_content.data`); everything else
                  // keeps the legacy verbatim copy.
                  finalConfig[paramName] =
                    fileParamBinding?.paramName === paramName
                      ? fileParamBinding.ref
                      : genericConfig.input
                  logger.debug(`  → Mapped input → ${paramName} (${finalConfig[paramName]})`)
                  break
                }
              }

              // WP-59 cleanup: the IR grammar carries `deterministic`, but file
              // extractors express the same intent via `use_ai` (deterministic === !use_ai).
              // Translate to the plugin's real param when its schema declares it; otherwise
              // drop the unknown key so we don't emit a no-op param (it reached the executor
              // as dead config and tripped a Phase-A "Unknown parameter" warning).
              if ('deterministic' in finalConfig) {
                if (finalConfig === genericConfig) finalConfig = { ...genericConfig }
                const isDeterministic = finalConfig.deterministic
                delete finalConfig.deterministic
                if ('use_ai' in paramSchema) {
                  finalConfig.use_ai = !isDeterministic
                  logger.debug(`  → Translated deterministic=${isDeterministic} → use_ai=${!isDeterministic}`)
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

    // WP-62 CC-3a auto-split: a covered extraction that folds meta/computed fields
    // emits the deterministic extractor for the surface subset into an intermediate
    // variable, and a synthesized downstream `generate` produces the final record.
    const deterministicOutputVar = isCoveredSplit ? `${outputVar}__extracted` : outputVar

    const node: ExecutionNode = {
      id: nodeId,
      type: 'operation',
      operation,
      outputs: [{ variable: deterministicOutputVar }],
    }

    ctx.nodes.set(nodeId, node)

    if (isCoveredSplit && coverage) {
      // Synthesize the residual `generate` step (the working-agent 0ee53785 shape).
      // Guardrails: G1 (zero-surface) never reaches here — the binder left those
      // unbound; G3 already-split plans have empty residual → no synthesis; G4 the
      // split keys on the field-source partition only (plugin-agnostic).
      const splitNodeId = this.synthesizeResidualGenerateNode(
        step,
        coverage,
        deterministicOutputVar,
        outputVar,
        ctx,
      )
      // convertSteps only wires the FIRST/LAST node of a step's returned array, so
      // the intermediate extract→generate edge must be set explicitly here.
      node.next = splitNodeId
      logger.info(
        {
          stepId: step.id,
          extractNode: nodeId,
          generateNode: splitNodeId,
          surfaceFields: coverage.surfaceFields.map((f) => f.name),
          residualFields: coverage.residualFields.map((f) => f.name),
        },
        '[WP-62] Auto-synthesized normalization split: deterministic extract → residual generate',
      )
      return [...prependNodeIds, nodeId, splitNodeId]
    }

    // Any WP-57 download step is prepended so convertSteps wires prev → download → extract.
    return [...prependNodeIds, nodeId]
  }

  /**
   * WP-62 (CC-3a): synthesize a downstream `generate` (ai_processing) step that
   * produces the residual meta/computed fields of a split extraction, taking the
   * deterministic extractor's surface output as input. Mirrors the working agent
   * `0ee53785` shape (deterministic extract + separate normalize/generate).
   *
   * Safety (Principle 2 / Principle 11 / G2): the instruction copies surface fields
   * through UNCHANGED and sets any residual that cannot be determined to null —
   * never a human-readable placeholder, never fabricated surface data.
   */
  private synthesizeResidualGenerateNode(
    step: ExtractStep & BoundStep,
    coverage: ExtractCoverageVerdict,
    surfaceInputVar: string,
    outputVar: string,
    ctx: ConversionContext,
  ): string {
    const genNodeId = this.generateNodeId(ctx)
    const surfaceNames = coverage.surfaceFields.map((f) => f.name)
    const residualSpec = coverage.residualFields
      .map(
        (f: any) =>
          `${f.name} (${f.type || 'string'}${f.required ? ', required' : ''}${f.description ? ` — ${f.description}` : ''})`,
      )
      .join('; ')

    const instruction =
      `You are given fields already extracted from a document, provided as input: ${surfaceNames.join(', ')}. ` +
      `Copy those fields through UNCHANGED — do not alter, re-derive, or invent their values. ` +
      `Then add the following field(s): ${residualSpec}. ` +
      `Derive each added field only from the provided data and context; if a field cannot be determined, set its value to null (never a placeholder like "Unknown"). ` +
      `Return a single JSON object containing all of the fields.`

    // Output schema = ALL requested fields (surface passthrough + residual) so
    // downstream consumers see the same full record the folded extract promised.
    const outputSchema = this.buildOutputSchemaFromFields(step.extract.fields as any[])

    const operation: OperationConfig = {
      operation_type: 'ai',
      ai: {
        type: 'generate',
        // `surfaceInputVar` is the intermediate variable name this converter just
        // minted for the deterministic extract node's output (`<outputVar>__extracted`)
        // — it is already a resolved IR variable, not an IntentContract RefName, so
        // it is passed as-is (no resolveRefName needed). (SA Nit #5.)
        instruction,
        input: surfaceInputVar,
        output_schema: outputSchema,
      },
      description: `Normalize/derive residual fields for '${step.id}' (WP-62 split)`,
    }

    const genNode: ExecutionNode = {
      id: genNodeId,
      type: 'operation',
      operation,
      outputs: [{ variable: outputVar }],
      inputs: [{ variable: surfaceInputVar }],
    }
    ctx.nodes.set(genNodeId, genNode)
    return genNodeId
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

    // WP-57: the loop item inherits the producer plugin of the collection it iterates,
    // so a file-extractor in the loop body can find the right provider's download action.
    const collectionProducer = ctx.outputProducerPlugin.get(collectionVar)
    if (collectionProducer) {
      ctx.outputProducerPlugin.set(itemVar, collectionProducer)
    }

    // Item 11 / WP-58: make the loop item variable discoverable to AI steps in
    // the loop body, so a `generate`/`ai` step whose instruction references it
    // can declare it as an additional input (it is otherwise only prose).
    ctx.loopItemVarStack.push(itemVar)
    // Convert loop body steps
    const bodyNodeIds = this.convertSteps(step.loop.do, ctx)
    ctx.loopItemVarStack.pop()

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
  private convertDeliver(step: DeliverStep & BoundStep, ctx: ConversionContext): string[] {
    const nodeId = this.generateNodeId(ctx)
    const outputVar = step.output || `${step.id}_result`

    const genericParams: Record<string, any> = {}

    // Add input data
    const inputVar = this.resolveRefName(step.deliver.input, ctx)
    genericParams.data = inputVar

    // D-B19c: Classify deliver.mapping[].to values against the bound action's
    // parameter schema:
    //   - PARAM_NAME mode (D-B19): all `to` values are plugin param names
    //     (e.g. spreadsheet_id, message_id) → copy to genericParams[m.to].
    //   - COLUMN_HEADER mode (D-B19c): no `to` values are plugin param names —
    //     they are spreadsheet column headers (e.g. "Type", "Vendor / merchant").
    //     Synthesize a precursor transform/map node that projects the input
    //     array to {header: source_field, ...} objects in IC-declared order;
    //     set genericParams.values to the synthesized output variable. The
    //     append_rows executor's array-of-objects mode handles the rest.
    //   - MIXED mode (none today): warn loudly, default to PARAM_NAME for compat.
    const synthesizedNodeIds: string[] = []
    if (step.deliver.mapping && step.deliver.mapping.length > 0) {
      const schema = (this.pluginManager && step.plugin_key && step.action)
        ? this.getPluginActionSchema(step.plugin_key, step.action)
        : null
      const paramNames = schema?.parameters?.properties
        ? new Set(Object.keys(schema.parameters.properties))
        : null
      const allAreParams = paramNames
        ? step.deliver.mapping.every((m: any) => paramNames.has(m.to))
        : true
      const noneAreParams = paramNames
        ? step.deliver.mapping.every((m: any) => !paramNames.has(m.to))
        : false
      const isColumnHeaderMode = paramNames !== null && noneAreParams
      const isMixedMode = paramNames !== null && !allAreParams && !noneAreParams

      if (isMixedMode) {
        ctx.warnings.push(
          `Step ${step.id}: deliver.mapping has both param-name and column-header values for ${step.plugin_key}.${step.action} — defaulting to D-B19 PARAM_NAME mode for backward compat. Verify scenario intent.`
        )
      }

      if (isColumnHeaderMode) {
        // Build header → source-field dict (insertion order = IC mapping order).
        const fieldMapping: Record<string, string> = {}
        for (const m of step.deliver.mapping) {
          let sourceField: string | undefined
          if (typeof m.from === 'object' && 'ref' in m.from && m.from.field) {
            sourceField = m.from.field
          } else if (typeof m.from === 'object' && 'kind' in m.from && (m.from as any).kind === 'ref' && (m.from as any).field) {
            sourceField = (m.from as any).field
          }
          if (sourceField) {
            fieldMapping[m.to] = sourceField
          }
        }

        if (Object.keys(fieldMapping).length > 0) {
          // Synthesize precursor transform/map node.
          const synthNodeId = this.generateNodeId(ctx)
          const synthOutputVar = `${step.id}_rows`
          const transformConfig: any = {
            type: 'map',
            input: inputVar,
            field_mapping: fieldMapping,
          }
          const synthNode: ExecutionNode = {
            id: synthNodeId,
            type: 'operation',
            operation: {
              operation_type: 'transform',
              transform: transformConfig,
              description: `D-B19c: Project ${inputVar} into row objects for ${step.plugin_key}.${step.action}`,
            },
            outputs: [{ variable: synthOutputVar }],
            next: nodeId,
          }
          ctx.nodes.set(synthNodeId, synthNode)
          synthesizedNodeIds.push(synthNodeId)

          // Deliver step now reads from the synthesized rows variable.
          genericParams.values = `{{${synthOutputVar}}}`
          logger.debug(
            `[IntentToIRConverter] D-B19c: COLUMN_HEADER mode for ${step.plugin_key}.${step.action} — synthesized transform/map ${synthNodeId} (${Object.keys(fieldMapping).length} columns) → ${genericParams.values}`
          )
        }
      } else {
        // PARAM_NAME mode (D-B19) — existing behavior.
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

    // D-B19c: when a precursor transform was synthesized, the entry point is the
    // precursor (its `next` already chains to the deliver node). Return both IDs
    // so the caller registers both in the IR — the precursor first.
    if (synthesizedNodeIds.length > 0) {
      return [...synthesizedNodeIds, nodeId]
    }
    return [nodeId]
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
        // Robust: LLM occasionally emits recipients.to as a single ValueRef
        // object instead of an array of ValueRefs. Normalize before mapping.
        // WP-49: also project cc / bcc when present so the EP's CC/BCC
        // recipients aren't silently dropped on the way to the DSL.
        const normalize = (v: any) => Array.isArray(v) ? v : [v]
        const toList = normalize(step.notify.recipients.to)
        params.recipients = {
          to: toList.map((r: any) => this.resolveValueRef(r, ctx)),
          ...(step.notify.recipients.cc && {
            cc: normalize(step.notify.recipients.cc).map((r: any) => this.resolveValueRef(r, ctx))
          }),
          ...(step.notify.recipients.bcc && {
            bcc: normalize(step.notify.recipients.bcc).map((r: any) => this.resolveValueRef(r, ctx))
          })
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
          // Robust: LLM occasionally emits recipients.to as a single ValueRef
          // object instead of an array of ValueRefs. Normalize before mapping.
          // WP-49: also project cc / bcc (mirror schema-aware branch above).
          const normalize = (v: any) => Array.isArray(v) ? v : [v]
          const toList = normalize(step.notify.recipients.to)
          params.recipients = {
            to: toList.map((r: any) => this.resolveValueRef(r, ctx)),
            ...(step.notify.recipients.cc && {
              cc: normalize(step.notify.recipients.cc).map((r: any) => this.resolveValueRef(r, ctx))
            }),
            ...(step.notify.recipients.bcc && {
              bcc: normalize(step.notify.recipients.bcc).map((r: any) => this.resolveValueRef(r, ctx))
            })
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

    // W2 / WP-16 task 0.11 — defensive `reason` field nudge.
    // When the LLM picks `generate/internal` for a deterministic-looking
    // operation, the structured `transform` primitives (with_fields,
    // project_column, set_difference, filter, map, group, etc.) are almost
    // always a better choice. Require a `reason` field on internal-domain
    // generate steps so the choice is deliberate and visible to W5
    // measurement (task 0.12).
    //
    // Other domains (email-content generation, summarization, etc.) are
    // legitimate AI uses and don't need a justification.
    const isInternalGenerate = step.uses?.some(
      u => u.capability === 'generate' && u.domain === 'internal'
    ) ?? false
    if (isInternalGenerate && !step.generate.reason) {
      ctx.warnings.push(
        `Step "${step.id}" (generate/internal) has no \`reason\` field — LLM picked AI ` +
          `for a deterministic-looking operation without justifying why a structured ` +
          `transform (with_fields/project_column/set_difference/filter/map/group) ` +
          `couldn't express it. Update Phase 1 prompt to enforce \`reason\`.`
      )
    }

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

    // Item 11 / WP-58: an AI step whose instruction references an in-scope variable
    // (most importantly the enclosing scatter's loop item variable) must RECEIVE
    // that variable as data, not just as prose. Detect referenced-but-unbound
    // in-scope variables deterministically (shared detector; no plugin/field
    // hardcoding) and declare them as additional_inputs so the resolver injects
    // each as a labelled block. Root-cause phase: phase4 stores the canonical shape.
    const additionalInputs = detectReferencedInScopeVariables(
      step.generate.instruction || '',
      ctx.loopItemVarStack,
      inputVar ? [extractBaseVarName(inputVar)] : []
    )
    if (additionalInputs.length > 0) {
      operation.ai!.additional_inputs = additionalInputs
      logger.debug(
        { stepId: step.id, additionalInputs },
        '[Item 11/WP-58] Declared referenced in-scope variables as AI additional_inputs'
      )
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

    // WP-57: shape-preserving transforms keep each item's identity, so the output
    // inherits the input's producer plugin. This lets a downstream file-extractor still
    // find the right provider's download action when a filter (e.g. "only PDFs") sits
    // between the storage listing and the per-file loop.
    {
      const PASSTHROUGH_OPS = new Set(['filter', 'sort', 'dedupe', 'flatten'])
      if (PASSTHROUGH_OPS.has(step.transform.op as string)) {
        const inputProducer = ctx.outputProducerPlugin.get(inputVar.replace(/\{\{|\}\}/g, ''))
        if (inputProducer && outputVar) {
          ctx.outputProducerPlugin.set(outputVar, inputProducer)
        }
      }
    }

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

    // W2 / WP-16: with_fields — augment items with computed fields.
    // Walk each expression and normalize `ref: <inputVar>` → `ref: "item"` so the
    // runtime evaluator binds field accesses to the per-iteration value (matches
    // the `transformFilter` convention).
    if (step.transform.op === 'with_fields' && Array.isArray((step.transform as any).fields)) {
      const fields = (step.transform as any).fields as Array<{ name: string; expression: any }>
      transformConfig.fields = fields.map(f => ({
        name: f.name,
        expression: this.normalizeExpressionRefs(f.expression, ctx, inputVar),
      }))
      delete transformConfig.custom_code
      logger.debug(`[IntentToIRConverter] WP-16 (with_fields): Normalized ${fields.length} field expression(s)`)
    }

    // W2 / WP-16: project_column — extract a single column/field from each row.
    // Config is forwarded as-is; the runtime executor handles all three column kinds.
    if (step.transform.op === 'project_column' && (step.transform as any).column) {
      transformConfig.column = (step.transform as any).column
      delete transformConfig.custom_code
      logger.debug(`[IntentToIRConverter] WP-16 (project_column): kind=${transformConfig.column.kind}`)
    }

    // W2 / WP-16: set_difference — anti-join. Resolve `reference: RefName` to the
    // actual variable path so the runtime's resolveVariable() can fetch the
    // reference array. `key_field` (and optional `reference_key_field`) are copied as-is.
    if (step.transform.op === 'set_difference') {
      const refName = (step.transform as any).reference
      const keyField = (step.transform as any).key_field
      const refKeyField = (step.transform as any).reference_key_field
      if (typeof refName !== 'string' || !refName) {
        ctx.warnings.push(
          `set_difference step "${step.id}" missing required "reference" RefName — runtime will fail`
        )
      } else {
        // WP-22: emit `{{varname}}` so the runtime's `resolveVariable()`
        // recognizes it as a variable reference. Without the braces,
        // resolveVariable returns the bare name as a literal string
        // (because it requires `{{...}}` syntax), and `transformSetDifference`
        // throws "reference must resolve to an array; got string".
        // Aligns with the convention used elsewhere (step.input, etc.).
        transformConfig.reference = `{{${this.resolveRefName(refName, ctx)}}}`
      }
      if (typeof keyField !== 'string' || !keyField) {
        ctx.warnings.push(
          `set_difference step "${step.id}" missing required "key_field" — runtime will fail`
        )
      } else {
        transformConfig.key_field = keyField
      }
      if (typeof refKeyField === 'string' && refKeyField) {
        transformConfig.reference_key_field = refKeyField
      }
      delete transformConfig.custom_code
      logger.debug(
        `[IntentToIRConverter] WP-16 (set_difference): reference=${transformConfig.reference}, key_field=${transformConfig.key_field}`
      )
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
      contains_any: 'contains_any', // W2: keyword-filter shorthand — runtime in ConditionalEvaluator
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
   * W2 / WP-16: Normalize `Expression` AST refs for `with_fields` runtime.
   *
   * The LLM emits `{kind: "ref", ref: "<inputVar>", field: "X"}` to mean "field X
   * on each item being iterated." The runtime evaluator's per-iteration scope
   * binds the current item under `"item"` (matching the existing `transformFilter`
   * convention). So we rewrite `ref: <inputVar>` → `ref: "item"` for any expression
   * inside `with_fields.fields[].expression`.
   *
   * Refs to OTHER slots are left untouched — the runtime resolves them via context.
   *
   * The `if` expression's `condition` field is a Condition AST (not Expression);
   * we delegate to `convertCondition()` with `isFilterContext: true` so its refs
   * are normalized consistently with how filter conditions are handled.
   */
  private normalizeExpressionRefs(
    expr: any,
    ctx: ConversionContext,
    inputVar: string
  ): any {
    // WP-33: tolerate template-string expressions. The LLM sometimes emits
    // `expression: "{{var.field}}"` (the syntax that works for `step.input`,
    // condition values, recipients, etc.) instead of the structured
    // `{kind: "ref", ref: "var", field: "field"}` the W2 grammar specifies.
    // Without this conversion the string survives into phase4, `resolveAllVariables`
    // pre-substitutes it to a primitive, and the runtime evaluator throws
    // INVALID_EXPRESSION because it expects an AST node.
    if (typeof expr === 'string') {
      const m = expr.match(/^\s*\{\{\s*([\w$]+)(?:\.([\w$][\w$.]*))?\s*\}\}\s*$/)
      if (m) {
        const ref = m[1]
        const fieldPath = m[2]
        if (ref === 'input' && fieldPath) {
          return { kind: 'config', key: fieldPath }
        }
        // Apply the same `ref === inputVar → "item"` rewrite the structured path does.
        const normalizedRef = ref === inputVar ? 'item' : ref
        return fieldPath
          ? { kind: 'ref', ref: normalizedRef, field: fieldPath }
          : { kind: 'ref', ref: normalizedRef }
      }
      // Plain non-template string → literal value.
      return { kind: 'literal', value: expr }
    }

    if (expr == null || typeof expr !== 'object' || typeof expr.kind !== 'string') {
      return expr
    }

    switch (expr.kind) {
      case 'ref': {
        // Rewrite ref: <inputVar> → ref: "item" for per-iteration field access.
        // Match against the resolved input variable name (post-resolveRefName).
        if (expr.ref === inputVar || expr.ref === this.resolveRefName(expr.ref, ctx)) {
          // Only rewrite when the LLM was referring to the iteration source.
          // Compare against both the raw RefName and the resolved variable name.
          if (expr.ref === inputVar) {
            return { ...expr, ref: 'item' }
          }
        }
        return expr
      }

      case 'literal':
      case 'config':
      case 'today':
        return expr

      case 'concat':
        return {
          ...expr,
          args: Array.isArray(expr.args)
            ? expr.args.map((a: any) => this.normalizeExpressionRefs(a, ctx, inputVar))
            : expr.args,
        }

      case 'if':
        return {
          ...expr,
          condition: this.convertCondition(expr.condition, ctx, { isFilterContext: true, inputVar }),
          then: this.normalizeExpressionRefs(expr.then, ctx, inputVar),
          else: this.normalizeExpressionRefs(expr.else, ctx, inputVar),
        }

      case 'date_diff':
        return {
          ...expr,
          left: this.normalizeExpressionRefs(expr.left, ctx, inputVar),
          right: this.normalizeExpressionRefs(expr.right, ctx, inputVar),
        }

      case 'date_add':
        return {
          ...expr,
          date: this.normalizeExpressionRefs(expr.date, ctx, inputVar),
          days: this.normalizeExpressionRefs(expr.days, ctx, inputVar),
        }

      case 'null_check':
        return {
          ...expr,
          value: this.normalizeExpressionRefs(expr.value, ctx, inputVar),
        }

      case 'all_not_null':
        // `refs[]` are field names on the current item. The runtime evaluator
        // checks the current item directly (via `ref in currentItem`) before
        // falling back to context.resolveVariable. No rewriting needed.
        return expr

      default:
        // Unknown kind — leave as-is. The runtime evaluator will raise a
        // typed error when it encounters an unrecognized expression.
        return expr
    }
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
        // O21 + D-B24: handle concat and format (same semantics — sequential arg join).
        // The IntentContract prompt (intent-system-prompt-v2.ts:130) advertises both ops,
        // so the LLM legitimately emits either. Treating them as aliases avoids the
        // silent fallback below discarding literal args.
        if ((valueRef.op === 'concat' || valueRef.op === 'format') && Array.isArray(valueRef.args)) {
          const resolvedArgs = valueRef.args.map((arg: any) => {
            const resolved = this.resolveValueRef(arg, ctx)
            return resolved !== undefined ? String(resolved) : ''
          })
          // If all args resolved, concatenate them
          const result = resolvedArgs.join('')
          if (result) {
            logger.debug(`[IntentToIRConverter] O21: Resolved computed ${valueRef.op}: ${JSON.stringify(valueRef.args)} → ${result}`)
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
    // WP-11 (original): force `content_level: 'full'` when the graph contains
    // an AI step or a deliver-extract action.
    let hasGlobalExtractionConsumer = false
    for (const node of ctx.nodes.values()) {
      const op = node.operation
      if (!op) continue
      if (op.operation_type === 'ai') {
        hasGlobalExtractionConsumer = true
        break
      }
      if (
        op.operation_type === 'deliver' &&
        typeof op.deliver?.action === 'string' &&
        /extract/i.test(op.deliver.action)
      ) {
        hasGlobalExtractionConsumer = true
        break
      }
    }

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

      // WP-24: schema-driven detection of *deterministic* body consumers.
      // The plugin's `output_dependencies` declares which output fields are
      // unpopulated at non-full content levels (e.g., Gmail's `body` is empty
      // unless content_level='full'). If any downstream IR node references one
      // of those fields, we must force `content_level: 'full'` even when no
      // AI or extract step is present.
      //
      // This catches workflows that use deterministic transforms (filter on
      // `item.body`, map with `field_mapping: {target: "body"}`) which the
      // original WP-11 heuristic missed — observed during Phase E on
      // complaint-email-logger where rows appended but body column was empty.
      const gatedFields = this.getGatedOutputFields(schema)
      const hasGatedConsumer = gatedFields.size > 0 && this.someNodeReferencesGatedField(ctx, gatedFields)

      const triggerReason = hasGlobalExtractionConsumer
        ? 'graph has AI/extract consumer'
        : hasGatedConsumer
          ? `downstream node references gated field(s): ${[...gatedFields].join(', ')}`
          : null

      if (!triggerReason) continue

      const previous = (config as any).content_level
      ;(config as any).content_level = 'full'
      logger.info(
        `[O-WP11/WP24] Set content_level='full' for ${plugin_key}.${action} (was ${previous ?? 'unset'}) — ${triggerReason}`
      )
      ctx.warnings.push(
        `[O-WP11/WP24] Auto-set content_level='full' on ${plugin_key}.${action} — ${triggerReason}.`
      )
    }
  }

  /**
   * WP-24 helper: read `output_dependencies` from the plugin action schema and
   * return the union of all `unpopulated_fields` — the set of output fields
   * that are populated only when the gating param (e.g., `content_level`) is
   * at its highest level (`full`).
   *
   * Generic across plugins. Returns an empty set if the schema doesn't declare
   * `output_dependencies` or it's malformed.
   */
  private getGatedOutputFields(schema: any): Set<string> {
    const gated = new Set<string>()
    const deps = schema?.output_dependencies
    if (!Array.isArray(deps)) return gated
    for (const dep of deps) {
      const fields = dep?.unpopulated_fields
      if (Array.isArray(fields)) {
        for (const f of fields) {
          if (typeof f === 'string' && f.length > 0) gated.add(f)
        }
      }
    }
    return gated
  }

  /**
   * WP-24 helper: walk all IR node configs (transform / notify / deliver / ai)
   * and return true if any reference one of the gated field names.
   *
   * Detection strategy: stringify each node's operation config and search for
   *   - JSON-value match: `"<field>"` (e.g., `field_mapping: {target: "body"}`)
   *   - Path-tail match: `\.<field>` followed by `"`, `}`, or word boundary
   *     (catches `condition.field: "item.body"` and `value: "{{var.body}}"`)
   *
   * Skips fetch nodes — only consumers are relevant. Conservative: regex is
   * scoped to the operation config blob, not the whole node, to avoid
   * matching node IDs / metadata that happen to contain the field name.
   */
  private someNodeReferencesGatedField(ctx: ConversionContext, gatedFields: Set<string>): boolean {
    if (gatedFields.size === 0) return false
    for (const node of ctx.nodes.values()) {
      const op = node.operation
      if (!op || op.operation_type === 'fetch') continue
      const haystack = JSON.stringify({
        transform: (op as any).transform,
        deliver: (op as any).deliver,
        notify: (op as any).notify,
        ai: (op as any).ai,
      })
      for (const field of gatedFields) {
        // Escape regex special chars in field name (defensive — fields are
        // usually plain identifiers but be safe).
        const esc = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const valueRe = new RegExp(`"${esc}"`)
        const pathTailRe = new RegExp(`\\.${esc}(?:["}\\b]|$)`)
        if (valueRe.test(haystack) || pathTailRe.test(haystack)) return true
      }
    }
    return false
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
   * WP-62 hotfix: does this PARAM accept a file object, per its own
   * `x-input-mapping.accepts` declaration? Schema-driven (the param's declaration is
   * the contract) — no plugin/param-name branch.
   */
  private paramAcceptsFileObject(paramDef: any): boolean {
    const accepts = paramDef?.['x-input-mapping']?.accepts
    return (
      Array.isArray(accepts) &&
      (accepts.includes('file_object') || accepts.includes('file_attachment'))
    )
  }

  /**
   * WP-57: Does the named input slot already carry file BYTES (vs just a metadata
   * reference)? A downloadable-content slot has a content field (file_content / content /
   * data / base64); a storage-listing item (id, name, mimeType, webViewLink) does not.
   * Used to decide whether a content-fetch step must be auto-inserted before a file
   * extractor.
   */
  private slotHasBytes(refName: string, ctx: ConversionContext): boolean {
    // Bytes vocabulary is owned by ExtractionCoverage (single source of truth) so
    // this check, the coverage verdict, and the file-param mapping cannot diverge.
    return schemaHasBytes(this.resolveSlotSchema(refName, ctx))
  }

  /**
   * Resolve the data_schema slot schema for a ref, using the SAME normalization the
   * binder's authoritative CC-1 uses (`baseVarOfRef` — strip `{{}}`, drop the dotted
   * tail) plus variableMap resolution. Loop/scatter-scoped aware: loop-body outputs
   * are stored flat in `slots` keyed by step.output. Returns null when unknown.
   */
  private resolveSlotSchema(refName: string, ctx: ConversionContext): any | null {
    const slots = ctx.dataSchema?.slots
    if (!slots || !refName) return null
    const resolved = this.resolveRefName(refName, ctx).replace(/\{\{|\}\}/g, '')
    const keys = Array.from(
      new Set([refName, resolved, baseVarOfRef(refName), baseVarOfRef(resolved)]),
    )
    for (const k of keys) {
      if (slots[k]?.schema) return slots[k].schema
    }
    return null
  }

  /**
   * WP-57: Find a download action on the given plugin that returns the raw file BYTES
   * a file-extractor needs — schema-driven, plugin-agnostic. An action qualifies when
   * its output is annotated `x-semantic-type: file_attachment`, exposes a content field
   * (file_content / content / data), and takes a `file_id` parameter. Returns null when
   * the plugin has no such action (the caller then leaves the workflow unchanged).
   */
  private findDownloadAction(pluginKey: string): { pluginKey: string; action: string } | null {
    if (!this.pluginManager) return null
    const def = this.pluginManager.getPluginDefinition(pluginKey)
    const actions = (def as any)?.actions
    if (!actions || typeof actions !== 'object') return null
    for (const [actionName, action] of Object.entries(actions)) {
      const out = (action as any).output_schema
      if (out?.['x-semantic-type'] !== 'file_attachment') continue
      // Shared bytes vocabulary (ExtractionCoverage) — no local duplicate set.
      const returnsBytes = schemaHasBytes(out)
      const params = (action as any).parameters?.properties || {}
      if (returnsBytes && 'file_id' in params) {
        return { pluginKey, action: actionName }
      }
    }
    return null
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

    // B3 (WP-62) / SA Finding #1: file/text classification is delegated to the
    // SHARED `classifySchemaFileness` (semantic_type → bytes field → field-name
    // markers, positive-file-wins) so this legacy heuristic and the binder's
    // authoritative CC-1 (`extractInputIsFile`) can never diverge. Bytes-bearing
    // and semantic signals are producer-shape signals: they win here BEFORE the
    // whole-graph text short-circuit below, so they cannot be overridden.

    // B3: resolve the input's OWN producer slot, loop-internal aware. Loop-body
    // step outputs are stored flat in `slots` (keyed by step.output, scope:'loop'),
    // so a scatter-scoped file variable resolves here. Try the raw ref, the
    // variableMap-resolved name, and the SHARED base-var normalization of a dotted
    // ref (e.g. `{{attachment_content.data}}` → `attachment_content`).
    const resolvedName = this.resolveRefName(inputName, ctx).replace(/\{\{|\}\}/g, '')
    const candidateSlotKeys = Array.from(
      new Set([inputName, resolvedName, baseVarOfRef(inputName), baseVarOfRef(resolvedName)]),
    )
    for (const key of candidateSlotKeys) {
      const slot = dataSchema.slots[key]
      if (!slot?.schema) continue
      const verdict = classifySchemaFileness(slot.schema)
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
          const verdict = classifySchemaFileness(propDef.items)
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
    // D-B19b: Copy explicit payload/mapping values FIRST so they take precedence
    // over x-variable-mapping heuristics. E.g., IC payload has folder_id: "{{results.files[0].id}}"
    // but x-variable-mapping would overwrite it with "results.folder_id" (wrong field).
    for (const [key, value] of Object.entries(genericParams)) {
      if (key !== 'data' && key !== 'destination' && key !== 'input_ref' && !mappedParams[key]) {
        if (paramSchema[key]) {
          mappedParams[key] = value
        }
      }
    }

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

  /**
   * P3.2 (EP required-plugin-param cycle — `df67bf69` topic-drop RCA):
   * Bind a free-text search SUBJECT to the bound action's required text param when
   * it would otherwise be dropped. `mapParamsToSchema` only copies a generic param
   * through if its key exists in the action schema; a search subject arrives as
   * `query`, but an action may name its required text param differently (e.g.
   * `research_topic`'s `topic`) and have NO `query` property — so `query` is
   * silently dropped → `params:{}` → runtime "<param> is required". This binds the
   * subject to the action's SINGLE unbound required string param.
   *
   * Schema-driven and plugin-agnostic (no plugin/action names — Principle 6). When
   * the target is ambiguous (0 or ≥2 unbound required string params) it does NOT
   * guess (Principle 2 / Anti-pattern C) — it records a warning and leaves the param
   * unbound for the compiler's no-empty-required-params guard (P3.1) to surface.
   */
  private bindSearchSubjectToRequiredParam(
    finalParams: Record<string, any>,
    genericParams: Record<string, any>,
    schema: ActionDefinition,
    step: DataSourceStep & BoundStep,
    ctx: ConversionContext
  ): void {
    const subject = genericParams.query
    const paramSchema = (schema.parameters?.properties || {}) as Record<string, any>
    // Only act when a subject exists AND the schema has no `query` param (i.e. the
    // subject was dropped by schema mapping). If `query` is a real param, it was used.
    if (subject === undefined || paramSchema.query) return

    const required = Array.isArray(schema.parameters?.required) ? schema.parameters.required : []
    const unboundRequiredStrings = required.filter((r) => {
      const p = paramSchema[r]
      return p && p.type === 'string' && finalParams[r] === undefined
    })
    if (unboundRequiredStrings.length === 0) return

    const where = `${step.plugin_key}.${step.action}`
    if (unboundRequiredStrings.length === 1) {
      const target = unboundRequiredStrings[0]
      const p = paramSchema[target]
      // Sanity-gate a LITERAL value against the param's length bounds; skip for {{refs}}
      // whose length isn't known until runtime.
      const literal = typeof subject === 'string' && !subject.includes('{{') ? subject : null
      const withinBounds =
        literal === null ||
        ((p.minLength === undefined || literal.length >= p.minLength) &&
          (p.maxLength === undefined || literal.length <= p.maxLength))
      if (withinBounds) {
        finalParams[target] = subject
        logger.debug(`[IntentToIRConverter] P3.2: bound search subject → required string param '${target}' (single unbound target) for ${where}`)
      } else {
        ctx.warnings.push(`[P3.2] Search subject did not satisfy '${target}' length bounds for ${where}; left unbound for the required-param guard.`)
      }
    } else if (unboundRequiredStrings.length > 1) {
      ctx.warnings.push(`[P3.2] Ambiguous search subject for ${where}: ${unboundRequiredStrings.length} unbound required string params (${unboundRequiredStrings.join(', ')}); not guessing — deferring to the required-param guard.`)
    }
  }
}
