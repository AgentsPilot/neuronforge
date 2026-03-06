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
      }

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

    // Add query if present (but skip structured ref objects - those should use inputs instead)
    if (step.query) {
      // Skip structured query objects like {"kind": "ref", "ref": "...", "field": "..."}
      // The compiler will extract needed fields from inputs using x-variable-mapping
      const isStructuredRef = typeof step.query === 'object' && step.query !== null && 'kind' in step.query
      if (!isStructuredRef) {
        params.query = step.query
      } else {
        logger.debug(`[IntentToIRConverter] Skipping structured query object - using inputs instead`)
      }
    }

    // Add filters if present
    if (step.filters && step.filters.length > 0) {
      // Convert filters to plugin-specific params
      // This is simplified - real implementation would need plugin schema awareness
      for (const filter of step.filters) {
        params[filter.field] = this.resolveValueRef(filter.value, ctx)
      }
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

    // SCHEMA-DRIVEN: Map artifact.name_hint to the plugin's required parameter
    // Use the FIRST required parameter as the name parameter (most artifact creation actions have one required param: the name)
    if (step.artifact.name_hint && step.plugin_key && step.action) {
      const schema = this.getPluginActionSchema(step.plugin_key, step.action)
      if (schema && schema.parameters.required && schema.parameters.required.length > 0) {
        const firstRequiredParam = schema.parameters.required[0]
        params[firstRequiredParam] = step.artifact.name_hint
        logger.debug(`[IntentToIRConverter] Mapped artifact.name_hint → ${firstRequiredParam} (first required param from schema)`)
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

    // Extract uses either AI (for LLM extraction) or deliver (for plugin-based extraction like document-extractor)
    const operation: OperationConfig = step.plugin_key && step.plugin_key !== 'chatgpt-research'
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
              plugin_key: step.plugin_key,
              action: step.action || 'extract_structured_data',
              config: finalConfig,
            },
            description: step.summary || `Extract data using ${step.plugin_key}`
          }
        })()
      : {
          operation_type: 'ai',
          ai: {
            type: 'deterministic_extract',
            instruction: `Extract structured data with fields: ${step.extract.fields.map((f: any) => f.name).join(', ')}`,
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
    const collectionVar = this.resolveRefName(step.loop.over, ctx)
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

    // Add field mappings if present
    // NOTE: The LLM now creates explicit loop structures in IntentContract when needed,
    // so we use standard field mapping here. The loop is already created by convertLoop().
    if (step.deliver.mapping && step.deliver.mapping.length > 0) {
      genericParams.fields = step.deliver.mapping.reduce((acc: any, m: any) => {
        const value = typeof m.from === 'object' && 'ref' in m.from
          ? this.resolveRefName(m.from.ref, ctx) + (m.from.field ? `.${m.from.field}` : '')
          : this.resolveValueRef(m.from, ctx)

        acc[m.to] = value
        return acc
      }, {} as Record<string, any>)
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
   */
  private convertNotify(step: NotifyStep & BoundStep, ctx: ConversionContext): string {
    const nodeId = this.generateNodeId(ctx)

    // Build params matching schema structure directly
    const params: Record<string, any> = {}

    // Map recipients object
    if (step.notify.recipients?.to) {
      params.recipients = {
        to: step.notify.recipients.to.map((r: any) => this.resolveValueRef(r, ctx))
      }
    }

    // Map content object
    const contentObj: Record<string, any> = {}
    if (step.notify.content.subject) {
      contentObj.subject = this.resolveValueRef(step.notify.content.subject, ctx)
    }
    if (step.notify.content.body) {
      // Map to 'body' or 'html_body' based on format
      if (step.notify.content.format === 'html') {
        contentObj.html_body = this.resolveValueRef(step.notify.content.body, ctx)
      } else {
        contentObj.body = this.resolveValueRef(step.notify.content.body, ctx)
      }
    }
    params.content = contentObj

    const operation: OperationConfig = {
      operation_type: 'deliver',
      deliver: {
        plugin_key: step.plugin_key || 'unknown',
        action: step.action || 'send_message',
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
    const outputSchema = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          [outputField]: {
            type: 'string',
            enum: labels,
            description: `Classification result (one of: ${labels.join(', ')})`
          }
        }
      }
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
        return valueRef.field ? `${varName}.${valueRef.field}` : varName

      case 'config':
        return `{{config.${valueRef.key}}}`

      case 'computed':
        ctx.warnings.push('Computed ValueRef not yet fully supported')
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
      return this.resolveValueRef(value as ValueRef, ctx)
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

    try {
      const allPlugins = this.pluginManager.getAvailablePlugins()
      const plugin = allPlugins[pluginKey]
      if (!plugin) return null

      const action = plugin.actions[actionName]
      return action || null
    } catch (error) {
      return null
    }
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
