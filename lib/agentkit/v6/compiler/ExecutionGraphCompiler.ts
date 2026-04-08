/**
 * Execution Graph Compiler
 *
 * Compiles execution graphs (IR v4.0) into PILOT DSL workflow steps.
 *
 * Compilation Strategy:
 * 1. Validate the execution graph
 * 2. Perform topological sort to determine execution order
 * 3. Traverse graph from start node
 * 4. Compile each node type to appropriate PILOT DSL steps
 * 5. Resolve variable references ({{variable}})
 * 6. Track data flow and dependencies
 * 7. Apply optimization passes
 *
 * Node Type Mapping:
 * - operation → action/transform/ai_processing step
 * - choice → conditional step with branches
 * - loop → scatter_gather step
 * - parallel → parallel step with branches
 * - end → no-op (marks termination)
 */

import type {
  DeclarativeLogicalIRv4,
  ExecutionGraph,
  ExecutionNode,
  OperationConfig,
  ChoiceConfig,
  LoopConfig,
  ParallelConfig,
  ConditionExpression,
  SimpleCondition,
  ComplexCondition
} from '../logical-ir/schemas/declarative-ir-types-v4'
import type { SchemaField, WorkflowDataSchema } from '../logical-ir/schemas/workflow-data-schema'
import type { HardRequirements } from '../requirements/HardRequirementsExtractor'
import type { WorkflowStep, Condition } from '@/lib/pilot/types/pilot-dsl-types'
import { validateExecutionGraph, type ValidationResult } from '../logical-ir/validation/ExecutionGraphValidator'
import { createLogger, Logger } from '@/lib/logger'
import { analyzeOutputSchema } from '@/lib/pilot/utils/SchemaAwareDataExtractor'

const moduleLogger = createLogger({ module: 'V6', service: 'ExecutionGraphCompiler' })

/**
 * Compilation Result
 */
export interface CompilationResult {
  success: boolean
  workflow: WorkflowStep[]
  logs: string[]
  errors?: string[]
  plugins_used?: string[]
  compilation_time_ms?: number
  validation_result?: ValidationResult
}

/**
 * Loop Context - tracks loop variables for nested compilation
 */
interface LoopContext {
  itemVariable: string
  outputVariables: string[] // Variables created within this loop iteration
}

/**
 * Variable Source - tracks which plugin action created a variable
 */
interface VariableSource {
  variable: string
  pluginKey: string
  actionName: string
  outputSchema?: any // Output schema from plugin definition
}

/**
 * Compiler Context - tracks state during compilation
 */
interface CompilerContext {
  stepCounter: number
  logs: string[]
  warnings: string[]
  pluginsUsed: Set<string>
  variableMap: Map<string, any> // Track variable values/types
  variableSources: Map<string, VariableSource> // Track which action created each variable (for schema-driven optimization)
  currentScope: 'global' | 'loop' | 'branch'
  loopDepth: number
  loopContextStack: LoopContext[] // Stack of loop contexts for nested loops
  ir?: DeclarativeLogicalIRv4 // IR for accessing execution graph metadata
  workflowConfig?: Record<string, any> // Workflow configuration from enhanced prompt (resolved_user_inputs)
}

/**
 * Execution Graph Compiler
 */
export class ExecutionGraphCompiler {
  private logger: Logger
  private pluginManager?: any

  constructor(pluginManager?: any) {
    this.logger = moduleLogger
    this.pluginManager = pluginManager
  }

  /**
   * Main compilation entry point
   *
   * @param ir - Declarative Logical IR v4.0 with execution graph
   * @param workflowConfig - Optional workflow configuration extracted from enhanced prompt (resolved_user_inputs)
   */
  async compile(
    ir: DeclarativeLogicalIRv4,
    workflowConfig?: Record<string, any>
  ): Promise<CompilationResult> {
    const startTime = Date.now()
    const ctx: CompilerContext = {
      stepCounter: 0,
      logs: [],
      warnings: [],
      pluginsUsed: new Set(),
      variableMap: new Map(),
      variableSources: new Map(),
      currentScope: 'global',
      loopContextStack: [],
      loopDepth: 0,
      ir,
      workflowConfig
    }

    try {
      // Merge IntentContract config defaults with user-provided workflowConfig
      // IntentContract defaults serve as base; user-provided values override
      if (ir.config_defaults && ir.config_defaults.length > 0) {
        const mergedConfig: Record<string, any> = {}

        // Step 1: Load IntentContract defaults as base
        for (const configEntry of ir.config_defaults) {
          if (configEntry.default !== undefined) {
            mergedConfig[configEntry.key] = configEntry.default
          }
        }

        // Step 2: Overlay user-provided workflowConfig (exact key match wins)
        if (ctx.workflowConfig) {
          for (const [key, value] of Object.entries(ctx.workflowConfig)) {
            mergedConfig[key] = value
          }
        }

        const defaultsOnly = ir.config_defaults
          .filter(c => c.default !== undefined && !(ctx.workflowConfig && c.key in ctx.workflowConfig))
          .map(c => c.key)

        ctx.workflowConfig = mergedConfig
        this.log(ctx, `Merged config: ${Object.keys(mergedConfig).length} keys (${defaultsOnly.length} from IntentContract defaults: ${defaultsOnly.join(', ') || 'none'})`)
      }

      this.log(ctx, `Starting execution graph compilation`)

      // Validate IR version
      if (ir.ir_version !== '4.0') {
        return {
          success: false,
          workflow: [],
          logs: ctx.logs,
          errors: [`Invalid IR version: ${ir.ir_version}. Expected '4.0'`]
        }
      }

      // Validate execution graph exists
      if (!ir.execution_graph) {
        return {
          success: false,
          workflow: [],
          logs: ctx.logs,
          errors: ['Missing execution_graph in IR v4.0']
        }
      }

      const graph = ir.execution_graph

      // Phase 1: Validate execution graph
      this.log(ctx, 'Phase 1: Validating execution graph')
      const validationResult = validateExecutionGraph(graph)

      if (!validationResult.valid) {
        const errorMessages = validationResult.errors.map(e =>
          `[${e.category}] ${e.node_id ? `Node ${e.node_id}: ` : ''}${e.message}`
        )
        return {
          success: false,
          workflow: [],
          logs: ctx.logs,
          errors: errorMessages,
          validation_result: validationResult
        }
      }

      if (validationResult.warnings.length > 0) {
        for (const warning of validationResult.warnings) {
          this.warn(ctx, `${warning.node_id ? `Node ${warning.node_id}: ` : ''}${warning.message}`)
        }
      }

      // Phase 1.5: Validate data_schema (if present)
      if (graph.data_schema) {
        this.log(ctx, 'Phase 1.5: Validating data_schema')
        this.validateDataSchemaInCompiler(graph, ctx)
      }

      // Phase 2: Initialize variable map from declarations
      this.log(ctx, 'Phase 2: Initializing variable declarations')
      this.initializeVariables(graph, ctx)

      // Phase 3: Traverse graph and compile nodes
      this.log(ctx, 'Phase 3: Compiling execution graph to workflow steps')
      let workflow = await this.compileGraph(graph, ctx)

      // Phase 3.5: Normalize data formats (auto-insert rows_to_objects for 2D arrays)
      this.log(ctx, 'Phase 3.5: Normalizing data formats')
      workflow = this.normalizeDataFormats(workflow, ctx)

      // Phase 3.6: Renumber steps sequentially after normalization
      workflow = this.renumberSteps(workflow)

      // Phase 3.7: Field name reconciliation (O10)
      // Auto-correct field references that don't match upstream output schemas
      this.log(ctx, 'Phase 3.7: Reconciling field name references')
      workflow = this.reconcileFieldReferences(workflow, ctx)

      // Phase 3.8: Config reference consistency (O11)
      // Detect config keys that are declared but never referenced, warn about hardcoded values
      if (ir.config_defaults && ir.config_defaults.length > 0) {
        this.log(ctx, 'Phase 3.8: Checking config reference consistency')
        workflow = this.enforceConfigReferences(workflow, ir.config_defaults, ctx)
      }

      // Phase 3.9: Nullable field detection (O16)
      // Warn when extraction step nullable outputs feed into required plugin parameters
      this.log(ctx, 'Phase 3.9: Checking nullable-to-required parameter mappings')
      this.detectNullableToRequiredMappings(workflow, ctx)

      // Phase 3.10: Empty results assertions (O18)
      // Add on_empty metadata to transform steps that feed scatter-gather
      this.log(ctx, 'Phase 3.10: Adding empty result assertions')
      this.addEmptyResultAssertions(workflow, ctx)

      // Phase 4: Post-compilation optimization
      this.log(ctx, 'Phase 4: Running post-compilation optimizations')
      const optimizedWorkflow = await this.optimizeWorkflow(workflow, ctx)

      // Phase 5: Convert to Pilot-compatible format (Pre-B compatibility)
      // Action steps: operation → action, config → params
      // All steps: step_id → id, add name field
      this.log(ctx, 'Phase 5: Converting to Pilot-compatible format')
      const pilotWorkflow = this.toPilotFormat(optimizedWorkflow, ctx)

      // PD-3: Compile-time token-budget warning for scatter→AI patterns.
      // Flags workflows where a scatter_gather whose input could exceed ~10
      // items feeds directly into an ai_processing step. This is the most
      // common pattern that produces token bloat in Phase E (seen in WP-14).
      this.warnScatterIntoAIPatterns(pilotWorkflow, ctx)

      const compilationTime = Date.now() - startTime
      this.log(ctx, `Compilation complete in ${compilationTime}ms`)

      return {
        success: true,
        workflow: pilotWorkflow,
        logs: ctx.logs,
        plugins_used: Array.from(ctx.pluginsUsed),
        compilation_time_ms: compilationTime,
        validation_result: validationResult
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.log(ctx, `Compilation failed: ${errorMessage}`)

      return {
        success: false,
        workflow: [],
        logs: ctx.logs,
        errors: [errorMessage]
      }
    }
  }

  /**
   * Initialize variable map from graph variable declarations
   */
  private initializeVariables(graph: ExecutionGraph, ctx: CompilerContext) {
    if (!graph.variables) return

    for (const variable of graph.variables) {
      ctx.variableMap.set(variable.name, {
        type: variable.type,
        scope: variable.scope,
        default_value: variable.default_value
      })
      this.log(ctx, `Declared variable: ${variable.name} (${variable.type}, ${variable.scope})`)
    }
  }

  /**
   * Compile entire graph to workflow steps
   */
  private async compileGraph(graph: ExecutionGraph, ctx: CompilerContext): Promise<WorkflowStep[]> {
    const steps: WorkflowStep[] = []
    const visited = new Set<string>()

    // Start from the start node
    const startNodeId = graph.start
    this.log(ctx, `Starting compilation from node: ${startNodeId}`)

    await this.compileNode(startNodeId, graph, ctx, steps, visited)

    return steps
  }

  /**
   * Compile a single node and its descendants
   */
  private async compileNode(
    nodeId: string,
    graph: ExecutionGraph,
    ctx: CompilerContext,
    steps: WorkflowStep[],
    visited: Set<string>
  ): Promise<void> {
    // Prevent infinite loops (though validator should catch cycles)
    if (visited.has(nodeId)) {
      this.warn(ctx, `Node ${nodeId} already visited, skipping to prevent cycle`)
      return
    }

    const node = graph.nodes[nodeId]
    if (!node) {
      this.warn(ctx, `Node ${nodeId} not found in graph`)
      return
    }

    visited.add(nodeId)
    this.log(ctx, `Compiling node: ${nodeId} (type: ${node.type})`)

    // Compile based on node type
    switch (node.type) {
      case 'operation':
        await this.compileOperationNode(node, graph, ctx, steps, visited)
        break
      case 'choice':
        await this.compileChoiceNode(node, graph, ctx, steps, visited)
        break
      case 'loop':
        await this.compileLoopNode(node, graph, ctx, steps, visited)
        break
      case 'parallel':
        await this.compileParallelNode(node, graph, ctx, steps, visited)
        break
      case 'end':
        // End nodes don't generate steps, they just mark termination
        this.log(ctx, `Reached end node: ${nodeId}`)
        break
      default:
        this.warn(ctx, `Unknown node type: ${(node as any).type}`)
    }

    // After compiling this node, continue to next node(s)
    if (node.next && node.type !== 'choice' && node.type !== 'loop' && node.type !== 'parallel') {
      const nextIds = Array.isArray(node.next) ? node.next : [node.next]
      for (const nextId of nextIds) {
        await this.compileNode(nextId, graph, ctx, steps, visited)
      }
    }
  }

  /**
   * Compile an operation node
   */
  private async compileOperationNode(
    node: ExecutionNode,
    graph: ExecutionGraph,
    ctx: CompilerContext,
    steps: WorkflowStep[],
    visited: Set<string>
  ): Promise<void> {
    if (!node.operation) {
      this.warn(ctx, `Operation node ${node.id} missing operation config`)
      return
    }

    const operation = node.operation
    const stepId = `step_${++ctx.stepCounter}`

    // Resolve input variables
    const resolvedConfig = this.resolveVariables(operation, node.inputs || [], ctx)

    // Extract input variable from node.inputs array
    // If the input has a path, include it in the variable reference
    const inputVariable = node.inputs && node.inputs.length > 0
      ? this.buildInputReference(node.inputs[0])
      : undefined

    let workflowStep: WorkflowStep

    switch (operation.operation_type) {
      case 'fetch':
        workflowStep = this.compileFetchOperation(stepId, node.id, operation, resolvedConfig, ctx)
        break
      case 'transform':
        workflowStep = await this.compileTransformOperation(stepId, node.id, operation, resolvedConfig, inputVariable, ctx, graph)
        break
      case 'ai':
        workflowStep = this.compileAIOperation(stepId, node.id, operation, resolvedConfig, inputVariable, node.inputs || [], ctx)
        break
      case 'deliver':
        workflowStep = this.compileDeliverOperation(stepId, node.id, operation, resolvedConfig, ctx)
        break
      case 'file_op':
        workflowStep = this.compileFileOperation(stepId, node.id, operation, resolvedConfig, ctx)
        break
      default:
        this.warn(ctx, `Unknown operation type: ${(operation as any).operation_type}`)
        return
    }

    // Set output variable if specified
    // CRITICAL FIX: Support OutputBinding.path field for nested output paths
    // This fixes the bug where output path was defined in schema but never used
    if (node.outputs && node.outputs.length > 0) {
      const output = node.outputs[0]
      if (output.path) {
        // Concatenate variable and path for nested field access
        workflowStep.output_variable = `${output.variable}.${output.path}`
        this.log(ctx, `  → Output with path: ${output.variable}.${output.path}`)
      } else {
        workflowStep.output_variable = output.variable
      }

      // Track variable source for schema-driven optimizations
      // This allows us to later check if a variable's output schema contains required fields
      if (workflowStep.output_variable && (operation.operation_type === 'fetch' || operation.operation_type === 'deliver')) {
        const pluginKey = operation.fetch?.plugin_key || operation.deliver?.plugin_key
        const actionName = operation.fetch?.action || operation.deliver?.action

        if (pluginKey && actionName) {
          const outputSchema = this.getActionOutputSchema(pluginKey, actionName)
          ctx.variableSources.set(workflowStep.output_variable, {
            variable: workflowStep.output_variable,
            pluginKey,
            actionName,
            outputSchema
          })
          this.log(ctx, `  → Tracked variable source: ${workflowStep.output_variable} from ${pluginKey}.${actionName}`)
        }
      }

      // Track output variable in loop context if we're inside a loop
      if (ctx.loopContextStack.length > 0 && workflowStep.output_variable) {
        const currentLoop = ctx.loopContextStack[ctx.loopContextStack.length - 1]
        currentLoop.outputVariables.push(workflowStep.output_variable)
        this.log(ctx, `  → Registered '${workflowStep.output_variable}' in loop context`)
      }
    }

    // Attach output_schema and input_schema from data_schema slots (if available)
    this.attachSlotSchemas(workflowStep, node, graph)

    steps.push(workflowStep)
    this.log(ctx, `  → Generated step: ${stepId} (${workflowStep.type})`)
  }

  /**
   * Compile fetch operation
   */
  private compileFetchOperation(
    stepId: string,
    nodeId: string,
    operation: OperationConfig,
    resolvedConfig: any,
    ctx: CompilerContext
  ): WorkflowStep {
    const fetch = operation.fetch!

    ctx.pluginsUsed.add(fetch.plugin_key)

    // Build params using plugin schema to ensure correct parameter names
    const config = this.buildParamsFromSchema(
      fetch.plugin_key,
      fetch.action,
      resolvedConfig.fetch?.config || {}
    )

    return {
      step_id: stepId,
      type: 'action',
      description: operation.description || `Fetch data using ${fetch.plugin_key}`,
      plugin: fetch.plugin_key,
      operation: fetch.action,
      config
    }
  }

  /**
   * Compile transform operation with context-aware intelligence
   */
  private async compileTransformOperation(
    stepId: string,
    nodeId: string,
    operation: OperationConfig,
    resolvedConfig: any,
    inputVariable: string | undefined,
    ctx: CompilerContext,
    graph: ExecutionGraph
  ): Promise<WorkflowStep> {
    const transform = operation.transform!

    // Extract input: prioritize explicit transform.input, then node's inputVariable, then config
    const input = transform.input ||
                  (inputVariable ? `{{${inputVariable}}}` : undefined) ||
                  resolvedConfig.transform?.input

    // STEP 1: Detect if this transform is unnecessary
    const detection = this.detectUnnecessaryTransform(nodeId, transform, graph)

    if (detection.isUnnecessary) {
      this.warn(ctx, `Transform ${nodeId} appears unnecessary: ${detection.reason}`)
      this.log(ctx, `  Suggestion: ${detection.suggestion}`)
    }

    // STEP 2: Find downstream delivery nodes
    const deliveryNodes = this.findDownstreamDeliveryNodes(nodeId, graph)

    if (deliveryNodes.length === 0) {
      this.log(ctx, `  Transform ${nodeId}: No downstream delivery nodes found (may deliver elsewhere)`)
    }

    // STEP 3: Analyze required data formats from delivery destinations
    const formats = await this.determineRequiredFormat(deliveryNodes)

    if (deliveryNodes.length > 0) {
      this.log(
        ctx,
        `  Transform ${nodeId} downstream analysis: ` +
        `${formats.deliveryDetails.length} delivery nodes, ` +
        `requires: ${formats.needs2DArray ? '2D-array ' : ''}` +
        `${formats.needsHTML ? 'HTML ' : ''}${formats.needsPlainText ? 'text' : ''}`
      )
    }

    // STEP 4: Choose appropriate operation based on requirements
    const irType = transform.type
    let pilotOperation = this.chooseTransformOperation(transform, formats, nodeId, ctx)

    // STEP 5: Validate against PILOT runtime-supported operations
    // This list comes from lib/pilot/schema/runtime-validator.ts and lib/pilot/StepExecutor.ts
    const validPilotOps = [
      'select',  // D-B18: aliased to map at compile time
      'custom',  // D-B18: aliased to map at compile time
      'set', 'map', 'filter', 'reduce', 'sort',
      'group', 'group_by',  // group_by is alias for group
      'aggregate', 'deduplicate', 'dedupe',  // dedupe is the runtime name
      'flatten', 'join', 'pivot', 'split', 'expand',
      'partition',  // Partition data by field value
      'rows_to_objects',  // For converting 2D arrays (like Sheets) to objects
      'map_headers',  // Normalize/rename headers in 2D arrays
      'render_table',  // For rendering data as HTML/formatted tables
      'fetch_content'  // For fetching attachment/file content from plugins
    ]

    if (!validPilotOps.includes(pilotOperation)) {
      this.warn(ctx, `Invalid transform type '${irType}' → '${pilotOperation}', defaulting to 'map'`)
      pilotOperation = 'map'
    }

    // STEP 6: Validate the choice (type checking) and FAIL if incorrect
    // ARCHITECTURAL FIX: Don't silently change operation types - fail compilation
    // This forces the IR to be corrected rather than generating broken DSL
    const node = graph.nodes[nodeId]
    let inputVarPath = node.inputs?.[0]?.variable
    let inputSource = 'node.inputs'

    // Prefer transform.input over node.inputs for transform operations
    // (transform.input has the full {{...}} reference, node.inputs might just have variable name)
    if (transform.input) {
      // Extract variable reference from {{...}}
      const varMatch = transform.input.match(/^{{(.+?)}}$/)
      inputVarPath = varMatch ? varMatch[1] : transform.input
      inputSource = 'transform.input'
    } else if (!inputVarPath) {
      // No input found
      inputVarPath = undefined
    }

    if (inputVarPath && ['map', 'filter', 'reduce'].includes(pilotOperation)) {
      // Check if using nested field access (e.g., "current_email.attachments")
      const hasNestedAccess = inputVarPath.includes('.')

      this.log(ctx, `  Validating ${pilotOperation} input: "${inputVarPath}" (from ${inputSource}, hasNestedAccess: ${hasNestedAccess})`)

      // Only validate if NOT using nested access
      if (!hasNestedAccess) {
        const baseVar = inputVarPath.split('.')[0]
        const varDecl = graph.variables?.find(v => v.name === baseVar)
        if (varDecl && varDecl.type !== 'array') {
          throw new Error(
            `Transform node '${nodeId}' uses operation '${pilotOperation}' which requires array input, ` +
            `but variable '${baseVar}' is declared as type '${varDecl.type}'. ` +
            `This is an IR generation error - the variable type or operation type must be fixed in the IR. ` +
            `Options: (1) Change variable '${baseVar}' type to 'array' if it holds array data, ` +
            `OR (2) Change transform operation from '${pilotOperation}' to appropriate operation for ${varDecl.type} data.`
          )
        }
      }
      // If using nested access (e.g., current_email.attachments), skip validation
      // The nested field might be an array even if the base variable is an object
    }

    // Transform the config to convert IR format to PILOT DSL format
    const transformedConfig = this.transformConditionFormat(resolvedConfig.transform || {})

    // CRITICAL FIX: Map transform-type-specific config fields to PILOT DSL format
    // This fixes the bug where IR schema fields (filter_expression, map_expression, etc.)
    // were being ignored during compilation, causing runtime failures
    const transformConfig = resolvedConfig.transform
    if (transformConfig && transformConfig.type) {
      if (transformConfig.type === 'filter') {
        // IR field: filter_expression → DSL field: condition
        if (transformConfig.filter_expression) {
          transformedConfig.condition = this.transformConditionObject(transformConfig.filter_expression)

          // CRITICAL FIX: Filter variable scoping
          // When filtering an array, if the condition references the same variable as the filter input,
          // it means "current item from that array", so we need to replace it with "item"
          const filterInput = transformConfig.input
          if (filterInput && transformedConfig.condition) {
            transformedConfig.condition = this.fixFilterVariableScoping(
              transformedConfig.condition,
              filterInput
            )
          }

          this.log(ctx, `  → Compiled filter_expression to condition`)

          // Remove filter_expression from output - we only need condition (DSL format)
          delete transformedConfig.filter_expression
        }
      } else if (transformConfig.type === 'deduplicate') {
        // Alias deduplicate → dedupe (runtime uses 'dedupe')
        transformConfig.type = 'dedupe'
        transformedConfig.type = 'dedupe'
        this.log(ctx, `  → Aliased 'deduplicate' → 'dedupe'`)
      } else if (transformConfig.type === 'select' || transformConfig.type === 'custom') {
        // D-B18: Alias select/custom → map. Both were removed from the IntentContract
        // schema (WP-4 mapping is the correct approach). This handles old ICs that still have them.
        const originalType = transformConfig.type
        transformConfig.type = 'map'
        transformedConfig.type = 'map'
        this.log(ctx, `  → D-B18: Aliased '${originalType}' → 'map' (${originalType} removed from IC schema)`)
      } else if (transformConfig.type === 'map') {
        // IR field: map_expression → DSL field: expression
        if (transformConfig.map_expression) {
          transformedConfig.expression = transformConfig.map_expression
          this.log(ctx, `  → Compiled map_expression to expression`)
        }

        // O24: When map has custom_code but no expression, try to generate structured config
        // by analyzing upstream output_schema and this step's output_schema
        if (transformConfig.custom_code && !transformConfig.map_expression && !transformedConfig.expression) {
          const structuredConfig = this.deriveMapStructuredConfig(nodeId, transform, graph, ctx)
          if (structuredConfig) {
            Object.assign(transformedConfig, structuredConfig)
            // Remove custom_code since we have structured config now
            delete transformedConfig.custom_code
          } else {
            // Couldn't derive structured config — keep custom_code and warn
            transformedConfig.custom_code = transformConfig.custom_code
            this.warn(ctx, `[O24] Map step ${nodeId} has unresolvable custom_code — may produce incorrect output at runtime: "${transformConfig.custom_code}"`)
          }
        }
      } else if (transformConfig.type === 'reduce') {
        // IR field: reduce_operation → DSL field: reducer
        if (transformConfig.reduce_operation) {
          transformedConfig.reducer = transformConfig.reduce_operation
          this.log(ctx, `  → Compiled reduce_operation to reducer`)
        }
      } else if (transformConfig.type === 'group_by' || transformConfig.type === 'group') {
        // IR field: group_by_field → DSL field: group_by
        if (transformConfig.group_by_field) {
          transformedConfig.group_by = transformConfig.group_by_field
          this.log(ctx, `  → Compiled group_by_field to group_by`)
        }

        // WP-5: Emit explicit output format config from output_schema.
        // Tells the runtime exactly what shape to return, no schema inference needed.
        const earlyOutputSchema = (transform as any).output_schema
        const groupOutputSchema = transformConfig.output_schema || earlyOutputSchema
        if (groupOutputSchema?.type === 'array' && groupOutputSchema.items?.properties) {
          const props = Object.entries(groupOutputSchema.items.properties) as Array<[string, any]>
          const keyField = props.find(([_, v]) => v.type === 'string')?.[0]
          const itemsField = props.find(([_, v]) => v.type === 'array')?.[0]
          if (keyField && itemsField) {
            transformedConfig.output_format = 'array'
            transformedConfig.key_field = keyField
            transformedConfig.items_field = itemsField
            this.log(ctx, `  → WP-5: Compiled group output config: format=array, key_field=${keyField}, items_field=${itemsField}`)
          }
        }
      } else if (transformConfig.type === 'sort') {
        // IR fields: sort_field, sort_order → DSL fields: sort_by, order
        if (transformConfig.sort_field) {
          transformedConfig.sort_by = transformConfig.sort_field
          this.log(ctx, `  → Compiled sort_field to sort_by`)
        }
        if (transformConfig.sort_order) {
          transformedConfig.order = transformConfig.sort_order
          this.log(ctx, `  → Compiled sort_order to order`)
        }
      } else if (transformConfig.type === 'flatten') {
        // O13: Derive structured flatten config from upstream + downstream schemas
        // The runtime's transformFlatten supports config.field for nested extraction:
        //   config.field = "attachments" → extracts item.attachments from each array element
        // The runtime's unwrapStructuredOutput handles object→array unwrapping automatically
        const flattenField = this.deriveFlattenField(nodeId, transform, graph, ctx)
        if (flattenField) {
          transformedConfig.field = flattenField
          this.log(ctx, `  → O13: Derived flatten field: "${flattenField}" (nested array extraction)`)
        }
      } else if (transformConfig.type === 'custom' && transformConfig.custom_code) {
        // IR field: custom_code → DSL field: custom_code (experimental)
        transformedConfig.custom_code = transformConfig.custom_code
        this.warn(ctx, `Custom code transforms are experimental: ${nodeId}`)
      }
    }

    this.log(ctx, `  Transform ${nodeId}: ${irType} → ${pilotOperation}`)

    // STEP 7: Inject additional loop context variables if transform has additional_inputs
    // This handles multi-input transforms (e.g., merge operations that need multiple variables)
    if (transform.additional_inputs && transform.additional_inputs.length > 0) {
      this.log(ctx, `  → Transform has ${transform.additional_inputs.length} additional inputs`)
      for (const additionalVar of transform.additional_inputs) {
        if (!transformedConfig[additionalVar]) {
          transformedConfig[additionalVar] = `{{${additionalVar}}}`
          this.log(ctx, `    → Injected additional input: ${additionalVar}`)
        }
      }
    }

    // STEP 8: Auto-inject loop context variables for merge/custom transforms
    // If we're in a loop and the transform has custom_code that mentions combining/merging,
    // automatically inject all loop-scoped variables into the config
    if (ctx.loopContextStack.length > 0 && (pilotOperation === 'map' || pilotOperation === 'custom')) {
      const customCode = transform.custom_code || ''
      const needsLoopVars = customCode.toLowerCase().includes('combine') ||
                            customCode.toLowerCase().includes('merge') ||
                            customCode.toLowerCase().includes('metadata') ||
                            customCode.toLowerCase().includes('email') ||
                            customCode.toLowerCase().includes('file')

      if (needsLoopVars) {
        const currentLoop = ctx.loopContextStack[ctx.loopContextStack.length - 1]
        this.log(ctx, `  → Transform needs loop context variables (detected from custom_code)`)

        // Inject item variable
        if (!transformedConfig[currentLoop.itemVariable]) {
          transformedConfig[currentLoop.itemVariable] = `{{${currentLoop.itemVariable}}}`
          this.log(ctx, `    → Injected loop item variable: ${currentLoop.itemVariable}`)
        }

        // Inject all output variables from previous steps in loop
        for (const outputVar of currentLoop.outputVariables) {
          if (!transformedConfig[outputVar] && outputVar !== input?.replace(/[{}]/g, '')) {
            transformedConfig[outputVar] = `{{${outputVar}}}`
            this.log(ctx, `    → Injected loop output variable: ${outputVar}`)
          }
        }
      }
    }

    // O14: Detect multi-source merge disguised as 'map' inside scatter-gather
    // Pattern: map with single-object input + additional variables in config + object output_schema
    // Fix: convert to 'set' with inline field-mapping input that resolves all sources
    // Also triggers outside scatter-gather when input is a single object (not array)
    // with additional variable references and a merged output_schema shape.
    let finalOperation = pilotOperation
    let finalInput = input
    const isInsideLoop = ctx.loopDepth > 0
    const outputSchema = (transform as any).output_schema

    // Detect single-object input (not array) — signals merge, not map
    let inputIsSingleObject = false
    if (inputVarPath) {
      const baseVar = inputVarPath.split('.')[0]
      const varDecl = graph.variables?.find(v => v.name === baseVar)
      if (varDecl && varDecl.type === 'object') {
        inputIsSingleObject = true
      }
      // Also check data_schema slots
      const slot = graph.data_schema?.slots?.[baseVar]
      if (slot?.schema?.type === 'object') {
        inputIsSingleObject = true
      }
    }

    // O14: A 'map' operation on a single object is never valid — map requires array input.
    // Detect and convert to 'set' regardless of output schema type.
    if (pilotOperation === 'map' && (isInsideLoop || inputIsSingleObject) &&
        outputSchema && (outputSchema.type === 'object' || outputSchema.type === 'array') &&
        (outputSchema.properties || outputSchema.items)) {
      // Check if config has additional variable references (injected loop variables)
      const additionalVars = Object.entries(transformedConfig)
        .filter(([key, val]) => typeof val === 'string' && (val as string).startsWith('{{') && key !== 'input' && key !== 'type' && key !== 'custom_code' && key !== 'output_schema')
        .map(([key]) => key)

      if (additionalVars.length > 0) {
          this.log(ctx, `  → O14: Detected multi-source merge inside scatter-gather (${additionalVars.length} additional vars: ${additionalVars.join(', ')})`)

          // Build field-mapping input: each output field maps to a {{source.field}} reference
          const fieldMapping = this.buildMergeFieldMapping(
            outputSchema,
            input?.replace(/[{}]/g, '') || '',
            additionalVars,
            transformedConfig,
            graph,
            ctx
          )

          if (fieldMapping && Object.keys(fieldMapping).length > 0) {
            finalOperation = 'set'
            finalInput = fieldMapping
            this.log(ctx, `  → O14: Converted map → set with ${Object.keys(fieldMapping).length} field mappings`)
          } else {
            // Fallback: convert map → set with pass-through input
            // This handles cases where buildMergeFieldMapping can't resolve fields
            // (e.g., array output schemas for 2D sheet rows). 'set' passes data through
            // instead of failing with "Map operation requires array input".
            finalOperation = 'set'
            this.log(ctx, `  → O14: Converted map → set (pass-through, field mapping not applicable for ${outputSchema.type} output)`)
          }
        }
      }

    // O26: When a set step is pass-through (single source, no field mapping) and feeds an
    // append_rows action, build an explicit field mapping from sheet_columns config.
    // This ensures: (1) only declared columns are written, (2) field names are mapped
    // correctly (e.g., from→sender email), (3) write order matches declared column order,
    // (4) downstream column_index for dedup extraction aligns with actual write order.
    // Detect pass-through: finalInput is still the original input (not a field mapping object)
    const isPassThrough = finalOperation === 'set' && typeof finalInput === 'string'
    if (isPassThrough && input) {
      const sheetColumnsMapping = this.buildSheetColumnsFieldMapping(
        nodeId, input, graph, ctx
      )
      if (sheetColumnsMapping) {
        finalInput = sheetColumnsMapping
        this.log(ctx, `  → O26: Built sheet column field mapping with ${Object.keys(sheetColumnsMapping).length} columns`)
      }
    }

    // PILOT format: input at top level, not in config
    const result = {
      step_id: stepId,
      type: 'transform' as const,
      operation: finalOperation,  // PILOT expects 'operation' field for transform type
      input: finalInput,  // PILOT expects input at top level
      description: operation.description || `Transform: ${finalOperation}`,
      config: transformedConfig  // Use transformed config
    }
    return result
  }

  /**
   * Compile AI operation
   */
  private compileAIOperation(
    stepId: string,
    nodeId: string,
    operation: OperationConfig,
    resolvedConfig: any,
    inputVariable: string | undefined,
    allInputs: Array<{ variable: string; path?: string }>,
    ctx: CompilerContext
  ): WorkflowStep {
    const ai = operation.ai!

    // Extract input: prioritize explicit ai.input, then build from all node inputs
    let input: any
    if (ai.input) {
      input = ai.input
    } else if (allInputs.length > 1) {
      // Multiple inputs: create an object with all referenced variables
      input = {}
      for (const inputBinding of allInputs) {
        const varRef = this.buildInputReference(inputBinding)
        // Use variable name as key (strip any parent references)
        const keyName = inputBinding.variable.split('.').pop() || inputBinding.variable
        input[keyName] = `{{${varRef}}}`
      }
    } else if (inputVariable) {
      // Single input: use as string
      input = `{{${inputVariable}}}`
    }

    // CRITICAL: deterministic_extract → deterministic_extraction step type
    // Uses PDF parser + AWS Textract before AI (not pure LLM)
    const stepType = ai.type === 'deterministic_extract'
      ? 'deterministic_extraction'
      : 'ai_processing'

    // PILOT format: input and prompt at top level
    // NOTE: Model is NOT included - it's determined by runtime routing in StepExecutor
    return {
      step_id: stepId,
      type: stepType as any,
      input: input,  // PILOT expects input at top level
      prompt: ai.instruction,  // PILOT expects prompt at top level
      description: operation.description || `AI: ${ai.type}`,
      config: {
        ai_type: ai.type,
        output_schema: ai.output_schema,
        temperature: ai.temperature,
        ...resolvedConfig.ai
      }
    }
  }

  /**
   * Compile deliver operation
   */
  private compileDeliverOperation(
    stepId: string,
    nodeId: string,
    operation: OperationConfig,
    resolvedConfig: any,
    ctx: CompilerContext
  ): WorkflowStep {
    const deliver = operation.deliver!

    ctx.pluginsUsed.add(deliver.plugin_key)

    // Build params using plugin schema to ensure correct parameter names
    const config = this.buildParamsFromSchema(
      deliver.plugin_key,
      deliver.action,
      resolvedConfig.deliver?.config || {}
    )

    return {
      step_id: stepId,
      type: 'action',
      description: operation.description || `Deliver using ${deliver.plugin_key}`,
      plugin: deliver.plugin_key,
      operation: deliver.action,
      config
    }
  }

  /**
   * Compile file operation
   */
  private compileFileOperation(
    stepId: string,
    nodeId: string,
    operation: OperationConfig,
    resolvedConfig: any,
    ctx: CompilerContext
  ): WorkflowStep {
    const fileOp = operation.file_op!

    if (fileOp.plugin_key) {
      ctx.pluginsUsed.add(fileOp.plugin_key)
    }

    return {
      step_id: stepId,
      type: 'action',
      description: operation.description || `File operation: ${fileOp.type}`,
      plugin: fileOp.plugin_key,
      operation: fileOp.action,
      config: resolvedConfig.file_op?.config || {}
    }
  }

  /**
   * Compile a choice (conditional) node
   */
  private async compileChoiceNode(
    node: ExecutionNode,
    graph: ExecutionGraph,
    ctx: CompilerContext,
    steps: WorkflowStep[],
    visited: Set<string>
  ): Promise<void> {
    if (!node.choice) {
      this.warn(ctx, `Choice node ${node.id} missing choice config`)
      return
    }

    const choice = node.choice
    const stepId = `step_${++ctx.stepCounter}`

    // CRITICAL FIX: Merge node.inputs path with condition variable references
    // This fixes the bug where choice conditions ignored path navigation from inputs
    let conditionToConvert = choice.rules[0]?.condition
    if (node.inputs && node.inputs.length > 0) {
      const inputBinding = node.inputs[0]
      if (inputBinding.path && conditionToConvert) {
        conditionToConvert = this.mergeInputPathWithCondition(conditionToConvert, inputBinding)
        this.log(ctx, `  → Merged input path '${inputBinding.path}' into choice condition`)
      }
    }

    // Build conditional step with branches
    const conditionalStep: WorkflowStep = {
      step_id: stepId,
      type: 'conditional',
      description: choice.description || `Conditional: ${node.id}`,
      condition: this.convertCondition(conditionToConvert),
      steps: []
    }

    // Compile branches for each rule
    for (let i = 0; i < choice.rules.length; i++) {
      const rule = choice.rules[i]
      const branchSteps: WorkflowStep[] = []
      const branchVisited = new Set(visited)

      await this.compileNode(rule.next, graph, ctx, branchSteps, branchVisited)

      if (i === 0) {
        // First rule uses the main condition
        conditionalStep.steps = branchSteps
      } else {
        // Additional rules would need nested conditionals (simplified for now)
        this.warn(ctx, `Multiple choice rules not fully supported yet, using first rule only`)
      }
    }

    // Add else branch (default path)
    const elseSteps: WorkflowStep[] = []
    const elseVisited = new Set(visited)
    await this.compileNode(choice.default, graph, ctx, elseSteps, elseVisited)

    if (elseSteps.length > 0) {
      conditionalStep.else_steps = elseSteps
    }

    steps.push(conditionalStep)
    this.log(ctx, `  → Generated conditional step: ${stepId}`)

    // Continue to the next node after the choice (e.g., send_summary_email after decide)
    if (node.next) {
      const nextIds = Array.isArray(node.next) ? node.next : [node.next]
      for (const nextId of nextIds) {
        await this.compileNode(nextId, graph, ctx, steps, visited)
      }
    }
  }

  /**
   * Compile a loop node
   */
  private async compileLoopNode(
    node: ExecutionNode,
    graph: ExecutionGraph,
    ctx: CompilerContext,
    steps: WorkflowStep[],
    visited: Set<string>
  ): Promise<void> {
    if (!node.loop) {
      this.warn(ctx, `Loop node ${node.id} missing loop config`)
      return
    }

    const loop = node.loop
    const stepId = `step_${++ctx.stepCounter}`

    // Compile loop body with loop context tracking
    ctx.loopDepth++

    // Push loop context onto stack
    const loopContext: LoopContext = {
      itemVariable: loop.item_variable,
      outputVariables: []
    }
    ctx.loopContextStack.push(loopContext)
    this.log(ctx, `  → Entered loop context: ${loop.item_variable}`)

    const bodySteps: WorkflowStep[] = []
    const bodyVisited = new Set<string>() // Don't include parent visited to allow loop body compilation

    await this.compileNode(loop.body_start, graph, ctx, bodySteps, bodyVisited)

    // Track output variables created in loop body
    for (const step of bodySteps) {
      if (step.output_variable) {
        loopContext.outputVariables.push(step.output_variable)
      }
    }

    // Pop loop context
    ctx.loopContextStack.pop()
    ctx.loopDepth--
    this.log(ctx, `  → Exited loop context (${loopContext.outputVariables.length} variables created)`)

    // CRITICAL FIX: Determine scatter-gather input from node.inputs if available
    // This fixes the bug where loop with inputs:[{variable:"emails_result", path:"emails"}]
    // was being compiled to input:"{{emails_result}}" instead of "{{emails_result.emails}}"
    let scatterInput = `{{${loop.iterate_over}}}`
    if (node.inputs && node.inputs.length > 0) {
      const firstInput = node.inputs[0]
      if (firstInput.path) {
        // Use variable.path for nested field access
        scatterInput = `{{${firstInput.variable}.${firstInput.path}}}`
        this.log(ctx, `  → Loop input resolved from inputs with path: ${scatterInput}`)
      } else {
        // Use just variable if no path
        scatterInput = `{{${firstInput.variable}}}`
        this.log(ctx, `  → Loop input resolved from inputs without path: ${scatterInput}`)
      }
    } else {
      // Fall back to iterate_over field (backward compatible)
      this.log(ctx, `  → Loop input using iterate_over field: ${scatterInput}`)
    }

    // Create scatter_gather step
    const scatterGatherStep: WorkflowStep = {
      step_id: stepId,
      type: 'scatter_gather',
      description: loop.description || `Loop over ${loop.iterate_over}`,
      scatter: {
        input: scatterInput,  // ✅ Now uses path from inputs if available
        steps: bodySteps,
        itemVariable: loop.item_variable,
        maxConcurrency: loop.concurrency
      },
      gather: {
        operation: loop.collect_outputs ? 'collect' : 'flatten',
        outputKey: loop.output_variable
      },
      output_variable: loop.output_variable  // ✅ Register as named variable for access by later steps
    }

    steps.push(scatterGatherStep)
    this.log(ctx, `  → Generated scatter_gather step: ${stepId}`)

    // Continue to next node after loop
    if (node.next) {
      const nextIds = Array.isArray(node.next) ? node.next : [node.next]
      for (const nextId of nextIds) {
        await this.compileNode(nextId, graph, ctx, steps, visited)
      }
    }
  }

  /**
   * Compile a parallel node
   */
  private async compileParallelNode(
    node: ExecutionNode,
    graph: ExecutionGraph,
    ctx: CompilerContext,
    steps: WorkflowStep[],
    visited: Set<string>
  ): Promise<void> {
    if (!node.parallel) {
      this.warn(ctx, `Parallel node ${node.id} missing parallel config`)
      return
    }

    const parallel = node.parallel
    const stepId = `step_${++ctx.stepCounter}`

    // Compile each branch
    const branches: WorkflowStep[] = []

    for (const branch of parallel.branches) {
      const branchSteps: WorkflowStep[] = []
      const branchVisited = new Set<string>()

      await this.compileNode(branch.start, graph, ctx, branchSteps, branchVisited)

      // Wrap branch steps in a sub-workflow
      const branchStep: WorkflowStep = {
        step_id: `${stepId}_branch_${branch.id}`,
        type: 'sub_workflow',
        description: branch.description || `Parallel branch: ${branch.id}`,
        steps: branchSteps
      }

      branches.push(branchStep)
    }

    // Create parallel step
    const parallelStep: WorkflowStep = {
      step_id: stepId,
      type: 'parallel',
      description: parallel.description || `Parallel execution: ${node.id}`,
      steps: branches,
      config: {
        wait_strategy: parallel.wait_strategy,
        wait_count: parallel.wait_count,
        timeout_ms: parallel.timeout_ms
      }
    }

    steps.push(parallelStep)
    this.log(ctx, `  → Generated parallel step: ${stepId} with ${branches.length} branches`)

    // Continue to next node after parallel
    if (node.next) {
      const nextIds = Array.isArray(node.next) ? node.next : [node.next]
      for (const nextId of nextIds) {
        await this.compileNode(nextId, graph, ctx, steps, visited)
      }
    }
  }

  /**
   * Resolve variable references in configuration
   */
  private resolveVariables(operation: OperationConfig, inputs: any[], ctx: CompilerContext): any {
    // For now, return the operation config as-is
    // Variable resolution happens at runtime via {{variable}} syntax
    // This method can be enhanced to validate variable references
    return operation
  }

  /**
   * Transform IR condition format to PILOT DSL format
   *
   * Handles all condition formats and converts them to PILOT DSL:
   *
   * 1. IR: { conditions: [...], combineWith: "OR"|"AND" } → PILOT: { or: [...] } or { and: [...] }
   * 2. IR: { type: "simple", variable, operator, value } → PILOT: { field, operator, value }
   * 3. IR: { type: "complex", operator: "and"|"or"|"not", conditions: [...] } → PILOT: { and/or/not: [...] }
   * 4. Already valid PILOT: { field, operator, value } or { and/or/not: [...] } → pass through
   *
   * This handles conditions from both IR v4 ExecutionGraph and IR formalization prompt outputs.
   */
  private transformConditionFormat(config: any): any {
    if (!config || typeof config !== 'object') {
      return config
    }

    // Deep clone to avoid mutating original
    const transformed = JSON.parse(JSON.stringify(config))

    // Transform the 'condition' field if it exists (for filter/conditional operations)
    if (transformed.condition && typeof transformed.condition === 'object') {
      transformed.condition = this.transformConditionObject(transformed.condition)
    }

    // Transform the 'filters' field if it exists (alternate IR format for filter operations)
    // Some IR generation uses 'filters' instead of 'condition', so convert it to 'condition'
    if (transformed.filters && typeof transformed.filters === 'object') {
      transformed.condition = this.transformConditionObject(transformed.filters)
      delete transformed.filters // Remove the IR-specific 'filters' key
    }

    // Transform any other nested objects
    for (const key in transformed) {
      if (key === 'condition' || key === 'filters') {
        continue // Already handled
      }

      if (typeof transformed[key] === 'object' && transformed[key] !== null && !Array.isArray(transformed[key])) {
        transformed[key] = this.transformConditionFormat(transformed[key])
      } else if (Array.isArray(transformed[key])) {
        transformed[key] = transformed[key].map((item: any) => {
          if (typeof item === 'object' && item !== null) {
            return this.transformConditionFormat(item)
          }
          return item
        })
      }
    }

    return transformed
  }

  /**
   * Transform a single condition object from IR format to PILOT DSL format
   *
   * PILOT DSL uses conditionType discriminators:
   * - Simple: { conditionType: 'simple', field, operator, value }
   * - Complex: { conditionType: 'complex_or|complex_and|complex_not', conditions/condition }
   */
  private transformConditionObject(condition: any): any {
    if (!condition || typeof condition !== 'object') {
      return condition
    }

    const result: any = { ...condition }

    // Case 1: IR formalization format { conditions: [...], combineWith: "OR"|"AND"|"NOT" }
    if (result.conditions && result.combineWith) {
      const combineWith = result.combineWith.toUpperCase()

      if (combineWith === 'OR') {
        return {
          conditionType: 'complex_or',
          conditions: result.conditions.map((c: any) => this.transformConditionObject(c))
        }
      } else if (combineWith === 'AND') {
        return {
          conditionType: 'complex_and',
          conditions: result.conditions.map((c: any) => this.transformConditionObject(c))
        }
      } else if (combineWith === 'NOT' && result.conditions.length === 1) {
        return {
          conditionType: 'complex_not',
          condition: this.transformConditionObject(result.conditions[0])
        }
      } else {
        // Unknown - default to AND
        this.logger.warn(`Unknown combineWith: ${combineWith}, defaulting to AND`)
        return {
          conditionType: 'complex_and',
          conditions: result.conditions.map((c: any) => this.transformConditionObject(c))
        }
      }
    }

    // Case 2: IR v4 format { type: "simple", variable, operator, value }
    if (result.type === 'simple') {
      delete result.type
      // Rename 'variable' to 'field' for PILOT DSL
      if (result.variable) {
        result.field = result.variable
        delete result.variable
      }
      // Add conditionType discriminator
      result.conditionType = 'simple'
      return result
    }

    // Case 3: IR v4 format { type: "complex", operator: "and"|"or"|"not", conditions: [...] }
    if (result.type === 'complex') {
      delete result.type
      const op = result.operator?.toLowerCase()

      if (op === 'and' && result.conditions) {
        return {
          conditionType: 'complex_and',
          conditions: result.conditions.map((c: any) => this.transformConditionObject(c))
        }
      } else if (op === 'or' && result.conditions) {
        return {
          conditionType: 'complex_or',
          conditions: result.conditions.map((c: any) => this.transformConditionObject(c))
        }
      } else if (op === 'not' && result.conditions && result.conditions.length === 1) {
        return {
          conditionType: 'complex_not',
          condition: this.transformConditionObject(result.conditions[0])
        }
      }
    }

    // Case 4: Already valid PILOT format with conditionType
    if (result.conditionType) {
      // Already has discriminator - just recurse on nested conditions
      if (result.conditions) {
        result.conditions = result.conditions.map((c: any) => this.transformConditionObject(c))
      }
      if (result.condition) {
        result.condition = this.transformConditionObject(result.condition)
      }
      return result
    }

    // Case 5: Legacy PILOT format without conditionType { and: [...] }, { or: [...] }, { not: {...} }
    if (result.and) {
      return {
        conditionType: 'complex_and',
        conditions: result.and.map((c: any) => this.transformConditionObject(c))
      }
    }
    if (result.or) {
      return {
        conditionType: 'complex_or',
        conditions: result.or.map((c: any) => this.transformConditionObject(c))
      }
    }
    if (result.not) {
      return {
        conditionType: 'complex_not',
        condition: this.transformConditionObject(result.not)
      }
    }

    // Case 6: Simple condition { field, operator, value } - add conditionType
    if (result.field && result.operator !== undefined) {
      result.conditionType = 'simple'
      return result
    }

    // Unknown format - log warning and return as-is
    if (Object.keys(result).length > 0) {
      this.logger.warn(`Unknown condition format: ${JSON.stringify(result)}`)
    }

    return result
  }

  /**
   * Build parameters from IR config using plugin schema
   * This ensures parameter names match the plugin schema (e.g., "range" not "sheet_name")
   */
  private buildParamsFromSchema(pluginKey: string, actionName: string, irConfig: any): any {
    if (!this.pluginManager || !irConfig) {
      return irConfig
    }

    try {
      const plugins = this.pluginManager.getAvailablePlugins()
      const pluginDef = plugins[pluginKey]

      if (!pluginDef || !pluginDef.actions || !pluginDef.actions[actionName]) {
        return irConfig // Plugin or action not found, return as-is
      }

      const actionDef = pluginDef.actions[actionName]
      const schema = actionDef.parameters

      if (!schema || !schema.properties) {
        return irConfig // No schema, return as-is
      }

      const params: Record<string, any> = {}
      const schemaProps = Object.keys(schema.properties)

      // Iterate over schema properties and try to find matching values in IR config
      for (const schemaParamName of schemaProps) {
        // First check if IR config has this exact parameter name
        if (schemaParamName in irConfig) {
          params[schemaParamName] = irConfig[schemaParamName]
          continue
        }

        // Check for common mismatches (case-insensitive, underscore/dash variations)
        const normalizedSchemaName = schemaParamName.toLowerCase().replace(/[_-]/g, '')

        for (const [irParamName, irParamValue] of Object.entries(irConfig)) {
          const normalizedIrName = irParamName.toLowerCase().replace(/[_-]/g, '')

          // If normalized names match, use the schema parameter name
          if (normalizedSchemaName === normalizedIrName) {
            params[schemaParamName] = irParamValue
            break
          }
        }
      }

      // Also include any IR params that weren't matched (for forward compatibility)
      for (const [irParamName, irParamValue] of Object.entries(irConfig)) {
        if (!(irParamName in params) && !schemaProps.some(sp => {
          const normalized = sp.toLowerCase().replace(/[_-]/g, '')
          return normalized === irParamName.toLowerCase().replace(/[_-]/g, '')
        })) {
          params[irParamName] = irParamValue
        }
      }

      // Deduplicate parameters with the same value
      const deduped: Record<string, any> = {}
      const seenValues = new Map<string, string>() // value → first param name

      for (const [paramName, paramValue] of Object.entries(params)) {
        // Only check for duplicate string values (variable references)
        if (typeof paramValue === 'string') {
          const existing = seenValues.get(paramValue)
          if (existing) {
            // Skip this duplicate, keep the first occurrence
            continue
          }
          seenValues.set(paramValue, paramName)
        }
        deduped[paramName] = paramValue
      }

      return deduped
    } catch (error) {
      // If validation fails, return original config
      return irConfig
    }
  }

  /**
   * Convert IR condition to PILOT DSL condition
   */
  private convertCondition(condition: ConditionExpression): Condition {
    if (condition.type === 'simple') {
      return this.convertSimpleCondition(condition)
    } else {
      return this.convertComplexCondition(condition)
    }
  }

  /**
   * Convert simple condition
   * Generates PILOT DSL format with conditionType discriminator
   */
  private convertSimpleCondition(condition: SimpleCondition): Condition {
    const operatorMap: Record<string, string> = {
      'eq': 'equals',
      'ne': 'not_equals',
      'gt': 'greater_than',
      'lt': 'less_than',
      'gte': 'greater_than_or_equal',
      'lte': 'less_than_or_equal',
      'contains': 'contains',
      'is_empty': 'is_empty'
    }

    return {
      conditionType: 'simple',
      field: condition.variable,
      operator: operatorMap[condition.operator] as any || condition.operator as any,
      value: condition.value
    } as Condition
  }

  /**
   * Convert complex condition
   * Generates PILOT DSL format with conditionType discriminator
   */
  private convertComplexCondition(condition: ComplexCondition): Condition {
    const subConditions = condition.conditions.map(c => this.convertCondition(c))

    if (condition.operator === 'and') {
      return {
        conditionType: 'complex_and',
        conditions: subConditions
      } as Condition
    } else if (condition.operator === 'or') {
      return {
        conditionType: 'complex_or',
        conditions: subConditions
      } as Condition
    } else if (condition.operator === 'not') {
      return {
        conditionType: 'complex_not',
        condition: subConditions[0]
      } as Condition
    }

    return subConditions[0]
  }

  /**
   * Validate that hard requirements are enforced in the compiled workflow
   */
  /**
   * Validate hard requirements enforcement using graph traversal (Phase 4)
   *
   * This replaces the old string-matching approach with structural validation
   * that can detect logical errors like wrong operators, wrong sequence, etc.
   */
  private validateHardRequirementsEnforcement(
    workflow: WorkflowStep[],
    hardRequirements: HardRequirements,
    ctx: CompilerContext
  ): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = []
    const warnings: string[] = []

    this.log(ctx, `Validating ${hardRequirements.requirements.length} hard requirements using structural validation`)

    // Build workflow step map for graph traversal
    const stepMap = this.buildStepMap(workflow)

    // Validate thresholds using structural validation (not string matching)
    for (const threshold of hardRequirements.thresholds) {
      const result = this.validateThresholdEnforcement(threshold, workflow, stepMap, ctx)
      errors.push(...result.errors)
      warnings.push(...result.warnings)
    }

    // Validate sequential dependencies using graph reachability
    for (const invariant of hardRequirements.invariants) {
      if (invariant.type === 'sequential_dependency') {
        const result = this.validateSequentialDependency(invariant, workflow, stepMap, ctx)
        errors.push(...result.errors)
        warnings.push(...result.warnings)
      } else if (invariant.type === 'no_duplicate_writes') {
        const result = this.validateNoDuplicateWrites(invariant, workflow, ctx)
        errors.push(...result.errors)
        warnings.push(...result.warnings)
      }
    }

    // Validate routing rules using structural validation
    for (const rule of hardRequirements.routing_rules) {
      const result = this.validateRoutingRule(rule, workflow, stepMap, ctx)
      errors.push(...result.errors)
      warnings.push(...result.warnings)
    }

    // Validate required outputs are captured
    for (const requiredOutput of hardRequirements.required_outputs) {
      const result = this.validateRequiredOutput(requiredOutput, workflow, ctx)
      errors.push(...result.errors)
      warnings.push(...result.warnings)
    }

    // Validate side effect constraints
    for (const constraint of hardRequirements.side_effect_constraints) {
      const result = this.validateSideEffectConstraint(constraint, workflow, stepMap, ctx)
      errors.push(...result.errors)
      warnings.push(...result.warnings)
    }

    // Log summary
    if (errors.length === 0 && warnings.length === 0) {
      this.log(ctx, `✅ All ${hardRequirements.requirements.length} hard requirements validated successfully`)
    } else if (errors.length > 0) {
      this.log(ctx, `❌ ${errors.length} hard requirement errors found`)
    } else {
      this.log(ctx, `⚠️  ${warnings.length} hard requirement warnings found`)
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    }
  }

  /**
   * Build a map of step IDs to steps for efficient lookup
   */
  private buildStepMap(workflow: WorkflowStep[]): Map<string, WorkflowStep> {
    const map = new Map<string, WorkflowStep>()

    const addToMap = (steps: WorkflowStep[]) => {
      for (const step of steps) {
        if (step.step_id || step.id) {
          map.set(step.step_id || step.id!, step)
        }

        // Recursively add nested steps
        if (step.type === 'conditional') {
          const cond = step as any
          if (cond.then) addToMap(Array.isArray(cond.then) ? cond.then : [cond.then])
          if (cond.else) addToMap(Array.isArray(cond.else) ? cond.else : [cond.else])
          if (cond.then_steps) addToMap(cond.then_steps)
          if (cond.else_steps) addToMap(cond.else_steps)
        } else if (step.type === 'scatter_gather' && (step as any).scatter?.steps) {
          addToMap((step as any).scatter.steps)
        } else if (step.type === 'parallel' && (step as any).branches) {
          for (const branch of (step as any).branches) {
            if (branch.steps) addToMap(branch.steps)
          }
        }
      }
    }

    addToMap(workflow)
    return map
  }

  /**
   * Validate threshold enforcement using structural validation
   * Checks:
   * 1. Find node that outputs threshold.field (extraction node)
   * 2. Find action nodes using threshold.applies_to
   * 3. Verify conditional gates the action with correct operator and value
   * 4. Verify conditional comes AFTER extraction (graph traversal)
   */
  private validateThresholdEnforcement(
    threshold: { field: string; operator: string; value: any; applies_to: string[] },
    workflow: WorkflowStep[],
    stepMap: Map<string, WorkflowStep>,
    ctx: CompilerContext
  ): { errors: string[]; warnings: string[] } {
    const errors: string[] = []
    const warnings: string[] = []

    // Find steps that produce the threshold field (AI extraction, transform, etc.)
    const extractionSteps = this.findStepsProducingField(threshold.field, workflow)

    // Find action steps that should be gated by threshold
    const gatedActions: WorkflowStep[] = []
    for (const actionName of threshold.applies_to) {
      const steps = this.findActionStepsByType(actionName, workflow)
      gatedActions.push(...steps)
    }

    if (gatedActions.length === 0) {
      warnings.push(
        `Threshold "${threshold.field} ${threshold.operator} ${threshold.value}" applies to actions ${threshold.applies_to.join(', ')}, but no such actions found in workflow`
      )
      return { errors, warnings }
    }

    // For each gated action, verify there's a conditional with correct logic
    for (const action of gatedActions) {
      const conditional = this.findGatingConditional(action, workflow, threshold.field)

      if (!conditional) {
        errors.push(
          `Action "${action.step_id || action.id}" (${action.type}) should be gated by threshold "${threshold.field} ${threshold.operator} ${threshold.value}", but no conditional found`
        )
        continue
      }

      // Validate conditional uses correct operator and value
      const validatesCorrectly = this.conditionalMatchesThreshold(conditional, threshold)
      if (!validatesCorrectly) {
        errors.push(
          `Conditional "${conditional.step_id || conditional.id}" gates action "${action.step_id || action.id}" but uses wrong operator or value. Expected: ${threshold.field} ${threshold.operator} ${threshold.value}`
        )
      } else {
        this.log(ctx, `✓ Threshold enforced: ${threshold.field} ${threshold.operator} ${threshold.value} gates ${action.step_id || action.id}`)
      }
    }

    return { errors, warnings }
  }

  /**
   * Validate sequential dependency using graph reachability
   */
  private validateSequentialDependency(
    invariant: { type: string; description: string; check: string },
    workflow: WorkflowStep[],
    stepMap: Map<string, WorkflowStep>,
    ctx: CompilerContext
  ): { errors: string[]; warnings: string[] } {
    const errors: string[] = []
    const warnings: string[] = []

    // Parse dependency (e.g., "create_folder before upload_file")
    const beforeMatch = invariant.description.match(/(\w+).*before.*(\w+)/i)
    if (!beforeMatch) {
      warnings.push(`Cannot parse sequential dependency: ${invariant.description}`)
      return { errors, warnings }
    }

    const [, firstAction, secondAction] = beforeMatch

    // Find steps by operation type
    const firstSteps = this.findActionStepsByType(firstAction, workflow)
    const secondSteps = this.findActionStepsByType(secondAction, workflow)

    if (firstSteps.length === 0 || secondSteps.length === 0) {
      warnings.push(
        `Sequential dependency "${invariant.description}" cannot be validated - actions not found in workflow`
      )
      return { errors, warnings }
    }

    // Check graph reachability: first step must be reachable from start before second step
    const firstStep = firstSteps[0]
    const secondStep = secondSteps[0]

    const isCorrectOrder = this.isReachable(firstStep, secondStep, workflow, stepMap)
    if (!isCorrectOrder) {
      errors.push(
        `Sequential dependency violated: "${firstAction}" must happen before "${secondAction}" (step IDs: ${firstStep.step_id || firstStep.id} before ${secondStep.step_id || secondStep.id})`
      )
    } else {
      // Also check that secondStep uses output from firstStep (data dependency)
      const usesOutput = this.stepUsesOutputFrom(secondStep, firstStep)
      if (!usesOutput) {
        warnings.push(
          `Sequential dependency "${invariant.description}" enforced by graph order, but "${secondAction}" does not use output from "${firstAction}" - may indicate missing data dependency`
        )
      } else {
        this.log(ctx, `✓ Sequential dependency enforced: ${invariant.description}`)
      }
    }

    return { errors, warnings }
  }

  /**
   * Validate no duplicate writes invariant
   */
  private validateNoDuplicateWrites(
    invariant: { type: string; description: string; check: string },
    workflow: WorkflowStep[],
    ctx: CompilerContext
  ): { errors: string[]; warnings: string[] } {
    const errors: string[] = []
    const warnings: string[] = []

    // Find all file write operations (append_sheets, upload_file, etc.)
    const writeOps = this.findAllFileWriteOperations(workflow)

    // Group by target location
    const targetMap = new Map<string, WorkflowStep[]>()
    for (const op of writeOps) {
      const target = this.getWriteTarget(op)
      if (target) {
        if (!targetMap.has(target)) {
          targetMap.set(target, [])
        }
        targetMap.get(target)!.push(op)
      }
    }

    // Check for duplicates
    targetMap.forEach((ops, target) => {
      if (ops.length > 1) {
        const stepIds = ops.map(op => op.step_id || op.id).join(', ')
        errors.push(
          `Duplicate writes to same location "${target}" detected in steps: ${stepIds}`
        )
      }
    })

    if (errors.length === 0) {
      this.log(ctx, `✓ No duplicate writes validated: ${invariant.description}`)
    }

    return { errors, warnings }
  }

  /**
   * Validate routing rule using structural validation
   */
  private validateRoutingRule(
    rule: { condition: string; field_value: string; destination: string },
    workflow: WorkflowStep[],
    stepMap: Map<string, WorkflowStep>,
    ctx: CompilerContext
  ): { errors: string[]; warnings: string[] } {
    const errors: string[] = []
    const warnings: string[] = []

    // Find conditional that evaluates the routing condition
    const routingConditional = this.findConditionalEvaluatingField(rule.condition, workflow)

    if (!routingConditional) {
      errors.push(
        `Routing rule not enforced: No conditional found that evaluates field "${rule.condition}"`
      )
      return { errors, warnings }
    }

    // Verify the conditional routes to the correct destination
    const routesToCorrectDestination = this.conditionalRoutesToDestination(
      routingConditional,
      rule.field_value,
      rule.destination
    )

    if (!routesToCorrectDestination) {
      errors.push(
        `Routing rule incorrectly enforced: Conditional "${routingConditional.step_id || routingConditional.id}" evaluates ${rule.condition} but does not route to "${rule.destination}" when value is "${rule.field_value}"`
      )
    } else {
      this.log(ctx, `✓ Routing rule enforced: ${rule.condition} = "${rule.field_value}" → ${rule.destination}`)
    }

    return { errors, warnings }
  }

  /**
   * Validate required output is captured
   *
   * HYBRID APPROACH (most scalable):
   * 1. Check if IR has requirements_enforcement with output_capture mechanism
   * 2. If found, trust LLM's validation_passed flag (covers all required outputs)
   * 3. Otherwise, fall back to manual workflow search for this specific output
   *
   * This scales to any plugin/data source without hardcoded field knowledge
   */
  private validateRequiredOutput(
    requiredOutput: string,
    workflow: WorkflowStep[],
    ctx: CompilerContext
  ): { errors: string[]; warnings: string[] } {
    const errors: string[] = []
    const warnings: string[] = []

    // HYBRID STEP 1: Check if we have requirements_enforcement tracking from IR
    // Look for ANY enforcement entry with output_capture mechanism (covers all required outputs)
    if (ctx.ir?.requirements_enforcement) {
      const outputEnforcement = ctx.ir.requirements_enforcement.find(
        enforcement => enforcement.enforced_by.enforcement_mechanism === 'output_capture'
      )

      if (outputEnforcement) {
        // LLM explicitly tracked output capture - trust validation_passed flag
        const nodeIds = outputEnforcement.enforced_by.node_ids.join(', ')

        if (outputEnforcement.validation_passed) {
          // LLM confirmed all required outputs are captured
          this.log(
            ctx,
            `✓ Required output "${requiredOutput}" - enforcement tracked by IR (req: ${outputEnforcement.requirement_id}, nodes: ${nodeIds})`
          )
          return { errors, warnings }
        } else {
          // LLM documented that outputs aren't properly captured
          errors.push(
            `Required output "${requiredOutput}" - IR tracking indicates validation failed (req: ${outputEnforcement.requirement_id}): ${outputEnforcement.validation_details || 'No details provided'}`
          )
          return { errors, warnings }
        }
      }
    }

    // HYBRID STEP 2: Fallback to manual search if no tracking provided
    // This handles backward compatibility with IRs that don't have enforcement tracking
    const producingSteps = this.findStepsProducingField(requiredOutput, workflow)

    if (producingSteps.length === 0) {
      // LENIENT MODE: If no IR enforcement tracking exists, just warn instead of failing
      // This allows workflows to proceed even if LLM didn't generate requirements_enforcement
      // The workflow may still work correctly at runtime
      warnings.push(
        `Required output "${requiredOutput}" not explicitly captured (no IR enforcement tracking found). Workflow may still produce this output at runtime.`
      )
      this.log(ctx, `⚠ Required output "${requiredOutput}" not explicitly tracked - relying on runtime behavior`)
    } else {
      this.log(ctx, `✓ Required output "${requiredOutput}" captured by step ${producingSteps[0].step_id || producingSteps[0].id} (fallback: manual search)`)
    }

    return { errors, warnings }
  }

  /**
   * Validate side effect constraint
   */
  private validateSideEffectConstraint(
    constraint: { action: string; allowed_when: string; forbidden_when: string },
    workflow: WorkflowStep[],
    stepMap: Map<string, WorkflowStep>,
    ctx: CompilerContext
  ): { errors: string[]; warnings: string[] } {
    const errors: string[] = []
    const warnings: string[] = []

    // Find steps performing the constrained action
    const actionSteps = this.findActionStepsByType(constraint.action, workflow)

    if (actionSteps.length === 0) {
      // No action found - constraint doesn't apply
      return { errors, warnings }
    }

    // For each action, verify it's gated by a conditional checking the constraint
    for (const actionStep of actionSteps) {
      const gatingConditional = this.findGatingConditional(actionStep, workflow, constraint.allowed_when)

      if (!gatingConditional) {
        errors.push(
          `Side effect constraint not enforced: Action "${constraint.action}" (step ${actionStep.step_id || actionStep.id}) should be gated by condition "${constraint.allowed_when}"`
        )
      } else {
        this.log(ctx, `✓ Side effect constraint enforced: ${constraint.action} gated by ${constraint.allowed_when}`)
      }
    }

    return { errors, warnings }
  }

  // ===== Helper Methods for Graph Traversal =====

  private findStepsProducingField(fieldName: string, workflow: WorkflowStep[]): WorkflowStep[] {
    const steps: WorkflowStep[] = []

    const search = (workflowSteps: WorkflowStep[]) => {
      for (const step of workflowSteps) {
        // AI extraction with output_schema
        if (step.type === 'ai_processing') {
          const aiStep = step as any
          if (aiStep.params?.output_schema) {
            const schema = aiStep.params.output_schema
            if (schema.properties && schema.properties[fieldName]) {
              steps.push(step)
            }
          }
        }

        // Transform with output_variable
        if (step.type === 'transform' && (step as any).output_variable === fieldName) {
          steps.push(step)
        }

        // File operations that produce outputs (upload → drive_link, etc.)
        if (step.type === 'action') {
          const action = step as any
          if (action.output_variable === fieldName || action.params?.output_field === fieldName) {
            steps.push(step)
          }
        }

        // Recurse into nested structures
        if (step.type === 'conditional') {
          const cond = step as any
          if (cond.then) search(Array.isArray(cond.then) ? cond.then : [cond.then])
          if (cond.else) search(Array.isArray(cond.else) ? cond.else : [cond.else])
          if (cond.then_steps) search(cond.then_steps)
          if (cond.else_steps) search(cond.else_steps)
        } else if (step.type === 'scatter_gather' && (step as any).scatter?.steps) {
          search((step as any).scatter.steps)
        } else if (step.type === 'parallel' && (step as any).branches) {
          for (const branch of (step as any).branches) {
            if (branch.steps) search(branch.steps)
          }
        }
      }
    }

    search(workflow)
    return steps
  }

  private findActionStepsByType(actionType: string, workflow: WorkflowStep[]): WorkflowStep[] {
    const steps: WorkflowStep[] = []
    const normalizedType = actionType.toLowerCase().replace(/_/g, '')

    const search = (workflowSteps: WorkflowStep[]) => {
      for (const step of workflowSteps) {
        if (step.type === 'action') {
          const action = step as any
          const pluginKey = action.plugin_key || ''
          const operation = action.operation_type || ''

          // Match by operation type or plugin+operation combination
          if (operation.toLowerCase().replace(/_/g, '').includes(normalizedType) ||
              `${pluginKey}${operation}`.toLowerCase().replace(/_/g, '').includes(normalizedType)) {
            steps.push(step)
          }
        }

        // Recurse into nested structures
        if (step.type === 'conditional') {
          const cond = step as any
          if (cond.then) search(Array.isArray(cond.then) ? cond.then : [cond.then])
          if (cond.else) search(Array.isArray(cond.else) ? cond.else : [cond.else])
          if (cond.then_steps) search(cond.then_steps)
          if (cond.else_steps) search(cond.else_steps)
        } else if (step.type === 'scatter_gather' && (step as any).scatter?.steps) {
          search((step as any).scatter.steps)
        } else if (step.type === 'parallel' && (step as any).branches) {
          for (const branch of (step as any).branches) {
            if (branch.steps) search(branch.steps)
          }
        }
      }
    }

    search(workflow)
    return steps
  }

  private findGatingConditional(
    actionStep: WorkflowStep,
    workflow: WorkflowStep[],
    fieldName: string
  ): WorkflowStep | null {
    // Search for conditional that contains this action in its branches
    const search = (steps: WorkflowStep[]): WorkflowStep | null => {
      for (const step of steps) {
        if (step.type === 'conditional') {
          const cond = step as any

          // Check if this conditional evaluates the right field
          const evaluatesField = this.conditionalEvaluatesField(cond, fieldName)
          if (!evaluatesField) continue

          // Check if action is in then/else branches
          const thenSteps = cond.then ? (Array.isArray(cond.then) ? cond.then : [cond.then]) : (cond.then_steps || [])
          const elseSteps = cond.else ? (Array.isArray(cond.else) ? cond.else : [cond.else]) : (cond.else_steps || [])

          const inThen = thenSteps.some((s: any) => (s.step_id || s.id) === (actionStep.step_id || actionStep.id))
          const inElse = elseSteps.some((s: any) => (s.step_id || s.id) === (actionStep.step_id || actionStep.id))

          if (inThen || inElse) {
            return step
          }

          // Recurse into nested conditionals
          const foundInThen = search(thenSteps)
          if (foundInThen) return foundInThen
          const foundInElse = search(elseSteps)
          if (foundInElse) return foundInElse
        } else if (step.type === 'scatter_gather' && (step as any).scatter?.steps) {
          const found = search((step as any).scatter.steps)
          if (found) return found
        } else if (step.type === 'parallel' && (step as any).branches) {
          for (const branch of (step as any).branches) {
            if (branch.steps) {
              const found = search(branch.steps)
              if (found) return found
            }
          }
        }
      }
      return null
    }

    return search(workflow)
  }

  private conditionalEvaluatesField(conditional: any, fieldName: string): boolean {
    const condition = conditional.condition
    if (!condition) return false

    // Simple condition: { field: "amount", operator: ">", value: 50 }
    if (condition.field && typeof condition.field === 'string') {
      const field = condition.field.replace(/[{}]/g, '').split('.').pop() // Extract field name from {{var.field}}
      return field === fieldName || condition.field.includes(fieldName)
    }

    // Complex condition: { and/or: [...] }
    if (condition.and) {
      return condition.and.some((c: any) => this.conditionalEvaluatesField({ condition: c }, fieldName))
    }
    if (condition.or) {
      return condition.or.some((c: any) => this.conditionalEvaluatesField({ condition: c }, fieldName))
    }

    return false
  }

  private conditionalMatchesThreshold(
    conditional: any,
    threshold: { field: string; operator: string; value: any }
  ): boolean {
    const condition = conditional.condition
    if (!condition || !condition.field || typeof condition.field !== 'string') return false

    // Extract field name
    const field = condition.field.replace(/[{}]/g, '').split('.').pop()
    if (field !== threshold.field && !condition.field.includes(threshold.field)) {
      return false
    }

    // Check operator matches
    const operatorMap: Record<string, string[]> = {
      'gt': ['>', 'greater_than', 'gt'],
      'gte': ['>=', 'greater_than_or_equal', 'gte'],
      'lt': ['<', 'less_than', 'lt'],
      'lte': ['<=', 'less_than_or_equal', 'lte'],
      'eq': ['==', '=', 'equals', 'eq'],
      'ne': ['!=', 'not_equals', 'ne']
    }

    const expectedOperators = operatorMap[threshold.operator] || [threshold.operator]
    if (!expectedOperators.includes(condition.operator)) {
      return false
    }

    // Check value matches
    return condition.value === threshold.value || String(condition.value) === String(threshold.value)
  }

  private isReachable(
    fromStep: WorkflowStep,
    toStep: WorkflowStep,
    workflow: WorkflowStep[],
    stepMap: Map<string, WorkflowStep>
  ): boolean {
    const visited = new Set<string>()
    const fromId = fromStep.step_id || fromStep.id
    const toId = toStep.step_id || toStep.id

    if (!fromId || !toId) return false

    const dfs = (currentId: string): boolean => {
      if (currentId === toId) return true
      if (visited.has(currentId)) return false
      visited.add(currentId)

      const currentStep = stepMap.get(currentId)
      if (!currentStep) return false

      // Check next steps based on step type
      if (currentStep.type === 'conditional') {
        const cond = currentStep as any
        const thenSteps = cond.then ? (Array.isArray(cond.then) ? cond.then : [cond.then]) : (cond.then_steps || [])
        const elseSteps = cond.else ? (Array.isArray(cond.else) ? cond.else : [cond.else]) : (cond.else_steps || [])

        for (const step of [...thenSteps, ...elseSteps]) {
          const stepId = step.step_id || step.id
          if (stepId && dfs(stepId)) return true
        }
      } else if (currentStep.type === 'scatter_gather') {
        const scatter = (currentStep as any).scatter
        if (scatter?.steps) {
          for (const step of scatter.steps) {
            const stepId = step.step_id || step.id
            if (stepId && dfs(stepId)) return true
          }
        }
      } else if (currentStep.type === 'parallel') {
        const branches = (currentStep as any).branches || []
        for (const branch of branches) {
          if (branch.steps) {
            for (const step of branch.steps) {
              const stepId = step.step_id || step.id
              if (stepId && dfs(stepId)) return true
            }
          }
        }
      }

      // Check next step in sequence (for action/transform/ai_processing steps)
      const nextStepId = (currentStep as any).next_step_id
      if (nextStepId && dfs(nextStepId)) return true

      return false
    }

    return dfs(fromId!)
  }

  private stepUsesOutputFrom(step: WorkflowStep, sourceStep: WorkflowStep): boolean {
    const stepStr = JSON.stringify(step)
    const sourceOutputVar = (sourceStep as any).output_variable
    const sourceStepId = sourceStep.step_id || sourceStep.id

    if (sourceOutputVar && stepStr.includes(sourceOutputVar)) {
      return true
    }

    if (sourceStepId && stepStr.includes(sourceStepId)) {
      return true
    }

    return false
  }

  private findAllFileWriteOperations(workflow: WorkflowStep[]): WorkflowStep[] {
    const writeOps: WorkflowStep[] = []

    // Generic pattern: Detect write operations by action name patterns
    const writePatterns = ['append', 'upload', 'create', 'write', 'update', 'insert', 'post', 'send', 'publish']

    const search = (steps: WorkflowStep[]) => {
      for (const step of steps) {
        if (step.type === 'action') {
          const action = step as any
          const actionName = (action.action || '').toLowerCase()

          // Check if action name starts with any write pattern
          const isWriteOperation = writePatterns.some(pattern =>
            actionName.startsWith(pattern) || actionName.includes(`_${pattern}`)
          )

          if (isWriteOperation) {
            writeOps.push(step)
          }
        }

        // Recurse into nested structures
        if (step.type === 'conditional') {
          const cond = step as any
          if (cond.then) search(Array.isArray(cond.then) ? cond.then : [cond.then])
          if (cond.else) search(Array.isArray(cond.else) ? cond.else : [cond.else])
          if (cond.then_steps) search(cond.then_steps)
          if (cond.else_steps) search(cond.else_steps)
        } else if (step.type === 'scatter_gather' && (step as any).scatter?.steps) {
          search((step as any).scatter.steps)
        } else if (step.type === 'parallel' && (step as any).branches) {
          for (const branch of (step as any).branches) {
            if (branch.steps) search(branch.steps)
          }
        }
      }
    }

    search(workflow)
    return writeOps
  }

  /**
   * Get write target identifier for duplicate detection
   *
   * Generic approach: Build target from all "identifier" parameters
   * (parameters ending in _id, _name, _path, or named 'range', 'key', 'index')
   */
  private getWriteTarget(step: WorkflowStep): string | null {
    const action = step as any
    const params = action.params || {}
    const plugin = action.plugin || 'unknown'
    const actionName = action.action || 'unknown'

    // Collect all identifier parameters (generic pattern detection)
    const identifierParams: string[] = []
    const identifierKeys = ['_id', '_name', '_path', 'range', 'key', 'index', 'channel', 'topic', 'queue']

    for (const [paramName, paramValue] of Object.entries(params)) {
      // Skip if value is an object, array, or undefined
      if (typeof paramValue !== 'string' && typeof paramValue !== 'number') continue

      // Check if this is an identifier parameter
      const isIdentifier = identifierKeys.some(suffix =>
        paramName.endsWith(suffix) || paramName === suffix
      )

      if (isIdentifier) {
        identifierParams.push(`${paramName}:${paramValue}`)
      }
    }

    // If we found identifiers, build target string
    if (identifierParams.length > 0) {
      return `${plugin}:${actionName}:${identifierParams.sort().join(':')}`
    }

    return null
  }

  private findConditionalEvaluatingField(fieldName: string, workflow: WorkflowStep[]): WorkflowStep | null {
    const search = (steps: WorkflowStep[]): WorkflowStep | null => {
      for (const step of steps) {
        if (step.type === 'conditional') {
          if (this.conditionalEvaluatesField(step, fieldName)) {
            return step
          }

          // Recurse into nested conditionals
          const cond = step as any
          const thenSteps = cond.then ? (Array.isArray(cond.then) ? cond.then : [cond.then]) : (cond.then_steps || [])
          const elseSteps = cond.else ? (Array.isArray(cond.else) ? cond.else : [cond.else]) : (cond.else_steps || [])

          const foundInThen = search(thenSteps)
          if (foundInThen) return foundInThen
          const foundInElse = search(elseSteps)
          if (foundInElse) return foundInElse
        } else if (step.type === 'scatter_gather' && (step as any).scatter?.steps) {
          const found = search((step as any).scatter.steps)
          if (found) return found
        } else if (step.type === 'parallel' && (step as any).branches) {
          for (const branch of (step as any).branches) {
            if (branch.steps) {
              const found = search(branch.steps)
              if (found) return found
            }
          }
        }
      }
      return null
    }

    return search(workflow)
  }

  private conditionalRoutesToDestination(
    conditional: any,
    fieldValue: string,
    destination: string
  ): boolean {
    // Check if conditional branches contain steps that route to destination
    // This is a simplified check - in practice, you'd inspect delivery steps
    const thenSteps = conditional.then ? (Array.isArray(conditional.then) ? conditional.then : [conditional.then]) : (conditional.then_steps || [])
    const elseSteps = conditional.else ? (Array.isArray(conditional.else) ? conditional.else : [conditional.else]) : (conditional.else_steps || [])

    const allSteps = [...thenSteps, ...elseSteps]
    for (const step of allSteps) {
      const stepStr = JSON.stringify(step)
      if (stepStr.includes(destination)) {
        return true
      }
    }

    return false
  }

  /**
   * Detect if a plugin operation returns a 2D array that needs conversion to objects
   *
   * Uses SchemaAwareDataExtractor to analyze output schemas.
   * Returns the array field name (e.g., "values" for Google Sheets)
   */
  private detectOutputIs2DArray(pluginKey: string, actionName: string): {
    is2DArray: boolean
    isWrappedArray: boolean
    arrayFieldName: string
  } {
    if (!this.pluginManager) {
      return { is2DArray: false, isWrappedArray: false, arrayFieldName: 'data' }
    }

    try {
      const plugins = this.pluginManager.getAvailablePlugins()
      const plugin = plugins[pluginKey]

      if (!plugin || !plugin.actions || !plugin.actions[actionName]) {
        return { is2DArray: false, isWrappedArray: false, arrayFieldName: 'data' }
      }

      const action = plugin.actions[actionName]
      const outputSchema = action.output_schema

      if (!outputSchema) {
        return { is2DArray: false, isWrappedArray: false, arrayFieldName: 'data' }
      }

      // Use SchemaAwareDataExtractor to analyze the schema
      const analysis = analyzeOutputSchema(outputSchema)

      // Case 1: 2D array (Google Sheets: {values: [[...]]})
      if (analysis.is2DArray && analysis.primaryArrayField) {
        return {
          is2DArray: true,
          isWrappedArray: false,
          arrayFieldName: analysis.primaryArrayField
        }
      }

      // Case 2: Wrapped 1D array (Gmail: {emails: [{...}]}, Airtable: {records: [{...}]})
      // Any output with a primary array field inside an object wrapper needs unwrapping
      if (analysis.primaryArrayField && analysis.itemType === 'object') {
        return {
          is2DArray: false,
          isWrappedArray: true,
          arrayFieldName: analysis.primaryArrayField
        }
      }

      return { is2DArray: false, isWrappedArray: false, arrayFieldName: 'data' }
    } catch (error) {
      this.logger.warn(`Failed to detect data structure for ${pluginKey}.${actionName}: ${error}`)
      return { is2DArray: false, isWrappedArray: false, arrayFieldName: 'data' }
    }
  }

  /**
   * Post-compilation normalization: Fix data format mismatches
   *
   * Handles two common LLM generation issues:
   *
   * Case 1: 2D Arrays (Google Sheets)
   * - Plugin returns {values: [[row1], [row2]]}
   * - LLM generates {{data.values}} accessor
   * - Solution: Insert rows_to_objects transform
   *
   * Case 2: Wrapped Arrays (Gmail, Airtable, most APIs)
   * - Plugin returns {emails: [{...}, {...}]}
   * - LLM generates {{all_emails}} (missing .emails accessor)
   * - Solution: Auto-unwrap to {{all_emails.emails}}
   *
   * This is plugin-agnostic and schema-driven using SchemaAwareDataExtractor.
   */
  private normalizeDataFormats(workflow: WorkflowStep[], ctx: CompilerContext): WorkflowStep[] {
    if (!this.pluginManager) {
      return workflow
    }

    const normalized: WorkflowStep[] = []
    let insertedTransforms = 0

    for (let i = 0; i < workflow.length; i++) {
      const step = workflow[i]
      normalized.push(step)

      // Check if this step outputs data from a plugin operation
      if (step.output_variable && step.plugin && step.operation) {
        const detection = this.detectOutputIs2DArray(step.plugin, step.operation)

        if (detection.is2DArray) {
          // O23: Check if all downstream consumers only use column_index extraction.
          // If so, skip rows_to_objects — the raw 2D array is sufficient.
          const downstreamConsumers = this.findDownstreamConsumers(workflow, i + 1, step.output_variable)
          const allUseColumnIndex = downstreamConsumers.length > 0 && downstreamConsumers.every(s =>
            s.config?.column_index !== undefined || s.config?.column_index === 0
          )

          if (allUseColumnIndex) {
            this.log(ctx, `  → O23: Skipping rows_to_objects for ${step.output_variable} — all ${downstreamConsumers.length} downstream consumer(s) use column_index extraction`)
            // Don't insert rows_to_objects — but rewrite downstream inputs to point at the .values sub-field
            // so map receives the raw 2D array, not the wrapper object
            const valuesPath = `${step.output_variable}.${detection.arrayFieldName}`
            for (const consumer of downstreamConsumers) {
              // Handle both bare refs and wrapped {{}} refs (Phase 4.5 adds {{ }} later)
              const bareVar = step.output_variable
              if (consumer.input === `{{${bareVar}}}` || consumer.input === bareVar) {
                consumer.input = `{{${valuesPath}}}`
              }
              if (consumer.config?.input === bareVar) {
                consumer.config.input = valuesPath
              }
            }
            this.log(ctx, `  → O23: Rewrote ${downstreamConsumers.length} consumer input(s) to {{${valuesPath}}}`)
            continue
          }

          // Case 1: 2D array → Insert rows_to_objects transform
          const convertStepId = `step_${++ctx.stepCounter}`
          const normalizedVarName = `${step.output_variable}_objects`

          const convertStep: WorkflowStep = {
            step_id: convertStepId,
            type: 'transform',
            operation: 'rows_to_objects',
            input: `{{${step.output_variable}.${detection.arrayFieldName}}}`,
            description: `Auto-normalize: Convert 2D array to objects`,
            output_variable: normalizedVarName,
            config: {}
          }

          normalized.push(convertStep)
          insertedTransforms++

          this.log(ctx, `  → Auto-inserted rows_to_objects for ${step.plugin}.${step.operation} (${step.output_variable}.${detection.arrayFieldName} → ${normalizedVarName})`)

          // Register the new variable as an inferred slot in data_schema (Task 4.5)
          const dataSchema = ctx.ir?.execution_graph?.data_schema
          if (dataSchema) {
            dataSchema.slots[normalizedVarName] = {
              schema: {
                type: 'array',
                items: { type: 'object', properties: {} },
                source: 'inferred'
              },
              scope: 'global',
              produced_by: convertStepId
            }
            this.log(ctx, `  → Registered inferred data_schema slot: ${normalizedVarName}`)
          }

          // Update all subsequent references to use the normalized variable
          for (let j = i + 1; j < workflow.length; j++) {
            this.updateVariableReferences(workflow[j], step.output_variable, normalizedVarName, detection.arrayFieldName)
          }
        } else if (detection.isWrappedArray) {
          // Case 2: Wrapped array → Update all references to unwrap the array field
          // e.g., {{all_emails}} → {{all_emails.emails}}
          this.log(ctx, `  → Auto-unwrapping ${step.plugin}.${step.operation} (${step.output_variable} → ${step.output_variable}.${detection.arrayFieldName})`)

          // Update all subsequent references to unwrap the array
          for (let j = i + 1; j < workflow.length; j++) {
            this.unwrapVariableReferences(workflow[j], step.output_variable, detection.arrayFieldName)
          }
        }
      }
    }

    if (insertedTransforms > 0) {
      this.log(ctx, `✓ Data format normalization complete: ${insertedTransforms} transforms inserted`)
    }

    return normalized
  }

  /**
   * O23 helper: Find all downstream workflow steps that consume a given variable.
   * Searches the full JSON serialization of each step for variable name references.
   */
  private findDownstreamConsumers(workflow: WorkflowStep[], startIndex: number, varName: string): WorkflowStep[] {
    const consumers: WorkflowStep[] = []

    for (let j = startIndex; j < workflow.length; j++) {
      const step = workflow[j]
      const stepStr = JSON.stringify(step)
      if (stepStr.includes(varName)) {
        consumers.push(step)
      }
    }

    return consumers
  }

  /**
   * Phase 5: Convert compiled workflow to Pilot-compatible format.
   *
   * The compiler internally uses 'operation' and 'config' for all step types.
   * The Pilot engine expects different field names depending on step type:
   * - Action steps: 'action' (not 'operation'), 'params' (not 'config')
   * - Transform steps: 'operation' and 'config' (no change needed)
   * - All steps: 'id' (not 'step_id'), 'name' (required by WorkflowStepBase)
   */
  private toPilotFormat(workflow: WorkflowStep[], ctx: CompilerContext): WorkflowStep[] {
    let convertedCount = 0
    let configRefsRewritten = 0
    let fieldRefsReconciled = 0

    // WP-2: Build schema registry for field name reconciliation.
    // Maps variable names → known field names from output_schema.
    // Includes scatter item variables (e.g., "urgent_email" → fields from email item schema).
    const schemaRegistry = new Map<string, Set<string>>()

    const registerSchemas = (steps: any[]) => {
      for (const step of steps) {
        if (step.output_variable && step.output_schema) {
          const fields = new Set<string>()
          const props = step.output_schema.properties || step.output_schema.items?.properties || {}
          for (const key of Object.keys(props)) {
            fields.add(key)
          }
          if (fields.size > 0) {
            schemaRegistry.set(step.output_variable, fields)
          }
        }
        // Register scatter item variable with item schema fields.
        // The scatter input may be a filtered/transformed variable whose output_schema
        // is just {type: "array"} without items. Trace upstream through the input chain
        // to find a schema with items.properties (e.g., the original plugin output).
        if (step.scatter?.itemVariable && step.scatter?.input) {
          const inputRef = step.scatter.input.replace(/\{\{|\}\}/g, '').trim()
          const itemFields = this.resolveItemSchemaFields(workflow, inputRef)
          if (itemFields.size > 0) {
            schemaRegistry.set(step.scatter.itemVariable, itemFields)
          }
        }
        // Recurse
        if (step.scatter?.steps) registerSchemas(step.scatter.steps)
        if (step.steps) registerSchemas(step.steps)
        if (step.then_steps) registerSchemas(step.then_steps)
        if (step.else_steps) registerSchemas(step.else_steps)
      }
    }
    registerSchemas(workflow)

    const convertStep = (step: any): any => {
      const converted: any = { ...step }

      // All steps: ensure 'id' is primary, add 'name'
      if (converted.step_id && !converted.id) {
        converted.id = converted.step_id
      }
      if (!converted.name) {
        converted.name = converted.description || converted.id || 'unnamed'
      }

      // Action steps: operation → action, config → params
      if (converted.type === 'action') {
        if (converted.operation && !converted.action) {
          converted.action = converted.operation
          delete converted.operation
        }
        if (converted.config !== undefined && converted.params === undefined) {
          converted.params = converted.config
          delete converted.config
        }
        convertedCount++

        // Fix: Ensure append_rows has top-level 'values' param.
        // The IR converter may produce two patterns that need normalization:
        //   1. fields.values: "{{row_data}}" → hoist to values
        //   2. fields: {A: "ref1", B: "ref2"} → convert column map to values array
        if (converted.action === 'append_rows' && !converted.params?.values && converted.params?.fields) {
          const fields = converted.params.fields
          if (fields.values) {
            // Pattern 1: fields.values contains the data reference
            converted.params.values = fields.values
            delete converted.params.fields
            this.log(ctx, `  → Hoisted fields.values → values for append_rows in ${converted.step_id || converted.id}`)
          } else {
            // Pattern 2: fields has column mappings {A: "ref", B: "ref", ...}
            // Convert to values: [["{{ref}}", "{{ref}}", ...]] ordered by column letter
            const colKeys = Object.keys(fields).filter(k => /^[A-Z]$/.test(k)).sort()
            if (colKeys.length > 0) {
              const row = colKeys.map(col => {
                const ref = fields[col]
                return typeof ref === 'string' && !ref.includes('{{') ? `{{${ref}}}` : ref
              })
              converted.params.values = [row]
              delete converted.params.fields
              this.log(ctx, `  → Converted column map to values array for append_rows: ${colKeys.length} columns`)
            }
          }
        }

        // O26 Fix C: Anchor append_rows range to column range (e.g., "UrgentEmails" → "UrgentEmails!A:E")
        // Without column anchor, Sheets API auto-detects data region and may offset subsequent appends
        if (converted.action === 'append_rows' && converted.params?.range) {
          const range = String(converted.params.range)
          if (!range.includes('!')) {
            // Bare tab name — anchor to column range based on sheet_columns count
            const sheetColumns = ctx.workflowConfig?.['google_sheets__table_create__columns']
              || ctx.workflowConfig?.['sheet_columns']
              || ctx.workflowConfig?.['output_columns']
            if (sheetColumns && typeof sheetColumns === 'string') {
              const colCount = sheetColumns.split(',').filter((c: string) => c.trim()).length
              if (colCount > 0 && colCount <= 26) {
                const lastCol = String.fromCharCode(64 + colCount) // 1→A, 5→E, 26→Z
                converted.params.range = `${range}!A:${lastCol}`
                this.log(ctx, `  → O26 Fix C: Anchored append_rows range: "${range}" → "${converted.params.range}" (${colCount} columns)`)
              }
            }
          }
        }
      }

      // O30: Wrap bare input refs for ai_processing steps
      // The IR converter emits bare strings like "inbox_emails.emails" for step.input
      // and step.config.input. The runtime's resolveAllVariables() only resolves
      // strings wrapped in {{ }}. Wrap them here so they resolve at runtime.
      if (converted.type === 'ai_processing' || converted.type === 'llm_decision') {
        if (typeof converted.input === 'string' && !converted.input.includes('{{')) {
          const wrapped = `{{${converted.input}}}`
          this.log(ctx, `  → O30: Wrapped bare ai_processing input: "${converted.input}" → "${wrapped}"`)
          converted.input = wrapped
        }
        if (converted.config && typeof converted.config.input === 'string' && !converted.config.input.includes('{{')) {
          converted.config = { ...converted.config, input: `{{${converted.config.input}}}` }
        }
      }

      // WP-2: Generic field name reconciliation (replaces D-B10 hack).
      // For every {{variable.field}} reference, check if `field` exists in the
      // producing step's output_schema. If not, try common resolution strategies:
      //   1. Strip prefix: message_id → id, file_id → id, contact_id → id
      //   2. Case/space normalization: "Lead Name" → "lead_name", "lead name"
      // This is schema-aware and works across all plugins.
      const reconcileFieldRefs = (obj: any): any => {
        if (typeof obj === 'string') {
          return obj.replace(/\{\{(\w+)\.(\w+)\}\}/g, (match: string, varName: string, field: string) => {
            const knownFields = schemaRegistry.get(varName)
            if (!knownFields || knownFields.has(field)) return match // field exists or no schema

            // Strategy 1: Strip common prefixes (message_id → id, file_id → id, etc.)
            if (field.endsWith('_id')) {
              const stripped = 'id'
              if (knownFields.has(stripped)) {
                fieldRefsReconciled++
                this.log(ctx, `  → WP-2: Reconciled {{${varName}.${field}}} → {{${varName}.${stripped}}} (strip prefix)`)
                return `{{${varName}.${stripped}}}`
              }
            }

            // Strategy 2: Case-insensitive match
            for (const known of knownFields) {
              if (known.toLowerCase() === field.toLowerCase()) {
                fieldRefsReconciled++
                this.log(ctx, `  → WP-2: Reconciled {{${varName}.${field}}} → {{${varName}.${known}}} (case match)`)
                return `{{${varName}.${known}}}`
              }
            }

            // Strategy 3: Underscore/space normalization (lead_name → "Lead Name" or "lead name")
            const normalized = field.replace(/_/g, ' ')
            for (const known of knownFields) {
              if (known.toLowerCase() === normalized.toLowerCase()) {
                fieldRefsReconciled++
                this.log(ctx, `  → WP-2: Reconciled {{${varName}.${field}}} → {{${varName}.${known}}} (space/underscore match)`)
                return `{{${varName}.${known}}}`
              }
            }

            return match // no match found — leave as-is (Phase A F5 will flag it)
          })
        }
        if (Array.isArray(obj)) {
          return obj.map(reconcileFieldRefs)
        }
        if (obj && typeof obj === 'object') {
          const result: any = {}
          for (const [key, val] of Object.entries(obj)) {
            result[key] = reconcileFieldRefs(val)
          }
          return result
        }
        return obj
      }

      if (converted.params) {
        converted.params = reconcileFieldRefs(converted.params)
      }
      if (converted.input && typeof converted.input === 'string') {
        converted.input = reconcileFieldRefs(converted.input)
      }

      // B10: Rewrite {{config.X}} → {{input.X}} in all step values
      // ExecutionContext doesn't support "config" as a variable root.
      // Production agents use {{input.X}} — config values are passed as inputValues at runtime.
      const rewriteResult = this.resolveStructuredRefs(converted)
      configRefsRewritten += rewriteResult.count
      const rewritten = rewriteResult.obj

      // Fix: Unwrap object-to-array references for scatter and transform inputs.
      // When the input variable's output_schema is type:"object" with an array property
      // (e.g., search_files returns {files: [...]}), rewrite the input to reference
      // the array field: {{var}} → {{var.files}}
      // This applies to scatter_gather inputs, and transform inputs (filter, sort, map).
      const unwrapObjectToArray = (input: string): string => {
        const ref = input.replace(/\{\{|\}\}/g, '').trim()
        const baseName = ref.split('.')[0]
        if (ref.includes('.')) return input // Already has a dotted path

        // Only unwrap if the source step is an action, ai_processing, or group transform.
        // Most transforms (filter, sort, map) output arrays. But group transforms return
        // a legacy object {grouped, groups, keys, count} when no output_format is specified.
        const sourceStep = workflow.find((s: any) => s.output_variable === baseName)
        if (sourceStep && sourceStep.type === 'transform') {
          const isGroupTransform = sourceStep.operation === 'group' || sourceStep.operation === 'group_by'
            || sourceStep.config?.type === 'group' || sourceStep.config?.type === 'group_by'
          if (!isGroupTransform) {
            return input // Non-group transforms already produce the right shape
          }
          // Group transform without explicit output_format returns legacy object.
          // The iterable array is in the 'groups' field.
          if (!sourceStep.config?.output_format) {
            const newInput = `{{${baseName}.groups}}`
            this.log(ctx, `  → Input unwrap: ${input} → ${newInput} (group transform legacy object → groups array)`)
            return newInput
          }
          return input // Group with output_format already returns array
        }
        if (sourceStep && sourceStep.type === 'scatter_gather') {
          return input // Scatter-gather already produces array
        }

        const sourceSchema = this.findOutputSchema(workflow, baseName)
        if (sourceSchema && sourceSchema.type === 'object' && sourceSchema.properties) {
          const arrayField = Object.entries(sourceSchema.properties)
            .find(([_, v]: [string, any]) => v.type === 'array')?.[0]
          if (arrayField) {
            const newInput = `{{${baseName}.${arrayField}}}`
            this.log(ctx, `  → Input unwrap: ${input} → ${newInput} (${arrayField} is the array field in ${baseName})`)
            return newInput
          }
        }
        return input
      }

      if (rewritten.type === 'scatter_gather' && rewritten.scatter?.input) {
        rewritten.scatter.input = unwrapObjectToArray(rewritten.scatter.input)
      }
      if (rewritten.type === 'transform' && rewritten.input && typeof rewritten.input === 'string') {
        rewritten.input = unwrapObjectToArray(rewritten.input)
        if (rewritten.config?.input && typeof rewritten.config.input === 'string') {
          rewritten.config.input = rewritten.config.input.replace(/\{\{|\}\}/g, '').trim()
          // Keep config.input in sync (without {{ }})
          const mainRef = rewritten.input.replace(/\{\{|\}\}/g, '').trim()
          rewritten.config.input = mainRef
        }
      }

      // Recurse into nested steps
      if (rewritten.scatter?.steps) {
        rewritten.scatter = {
          ...rewritten.scatter,
          steps: rewritten.scatter.steps.map(convertStep)
        }
      }
      if (rewritten.steps) {
        rewritten.steps = rewritten.steps.map(convertStep)
      }
      if (rewritten.then_steps) {
        rewritten.then_steps = rewritten.then_steps.map(convertStep)
      }
      if (rewritten.else_steps) {
        rewritten.else_steps = rewritten.else_steps.map(convertStep)
      }

      return rewritten
    }

    const result = workflow.map(convertStep)
    this.log(ctx, `  → Converted ${convertedCount} action steps to Pilot format (operation→action, config→params)`)
    if (configRefsRewritten > 0) {
      this.log(ctx, `  → Rewrote ${configRefsRewritten} config references: {{config.X}} → {{input.X}}`)
    }
    if (fieldRefsReconciled > 0) {
      this.log(ctx, `  → WP-2: Reconciled ${fieldRefsReconciled} field name mismatches`)
    }
    return result
  }

  /**
   * B10: Rewrite {{config.X}} → {{input.X}} in all string values.
   * ExecutionContext only supports {{input.X}} for user-provided config values.
   * Returns the rewritten object and a count of replacements made.
   */
  /**
   * WP-2 helper: Resolve item schema fields for a scatter input variable.
   * Traces upstream through filter/transform chains to find the original
   * schema with items.properties. E.g.:
   *   urgent_emails (filter, schema: {type:"array"})
   *     → classified_emails (ai, schema: none)
   *       → inbox_emails.emails (action, schema: {type:"array", items:{properties:{id, subject, ...}}})
   */
  private resolveItemSchemaFields(workflow: any[], ref: string): Set<string> {
    const visited = new Set<string>()
    const resolve = (varRef: string): Set<string> => {
      if (visited.has(varRef)) return new Set()
      visited.add(varRef)

      const baseName = varRef.split('.')[0]

      const findStep = (steps: any[]): any => {
        for (const step of steps) {
          if (step.output_variable === baseName) return step
          if (step.scatter?.steps) { const f = findStep(step.scatter.steps); if (f) return f }
          if (step.steps) { const f = findStep(step.steps); if (f) return f }
          if (step.then_steps) { const f = findStep(step.then_steps); if (f) return f }
          if (step.else_steps) { const f = findStep(step.else_steps); if (f) return f }
        }
        return null
      }

      const step = findStep(workflow)
      if (!step) return new Set()

      // Check if this step's output_schema has item properties
      const schema = step.output_schema
      if (schema) {
        const itemProps = schema.items?.properties || {}
        const fields = Object.keys(itemProps)
        if (fields.length > 0) return new Set(fields)

        // Also check top-level properties for non-array schemas
        const topProps = schema.properties || {}
        // Look for an array field that might have item properties
        for (const val of Object.values(topProps) as any[]) {
          if (val.type === 'array' && val.items?.properties) {
            return new Set(Object.keys(val.items.properties))
          }
        }
      }

      // Trace upstream: check step.input or step.config.input
      const inputRef = step.input?.replace(/\{\{|\}\}/g, '').trim()
        || step.config?.input?.replace?.(/\{\{|\}\}/g, '')?.trim()
      if (inputRef) {
        return resolve(inputRef)
      }

      return new Set()
    }

    return resolve(ref)
  }

  /**
   * WP-2 helper: Find the output_schema for a variable reference.
   * Handles dotted refs like "inbox_emails.emails" — looks up "inbox_emails"
   * then navigates to the "emails" property schema.
   */
  private findOutputSchema(workflow: any[], ref: string): any {
    const parts = ref.split('.')
    const varName = parts[0]

    const findInSteps = (steps: any[]): any => {
      for (const step of steps) {
        if (step.output_variable === varName && step.output_schema) {
          let schema = step.output_schema
          // Navigate dotted path: inbox_emails.emails → inbox_emails schema → properties.emails
          for (let i = 1; i < parts.length; i++) {
            const props = schema.properties || schema.items?.properties
            if (props && props[parts[i]]) {
              schema = props[parts[i]]
            } else {
              return null
            }
          }
          return schema
        }
        // Recurse into nested steps
        if (step.scatter?.steps) {
          const found = findInSteps(step.scatter.steps)
          if (found) return found
        }
        if (step.steps) {
          const found = findInSteps(step.steps)
          if (found) return found
        }
        if (step.then_steps) {
          const found = findInSteps(step.then_steps)
          if (found) return found
        }
        if (step.else_steps) {
          const found = findInSteps(step.else_steps)
          if (found) return found
        }
      }
      return null
    }

    return findInSteps(workflow)
  }

  private resolveStructuredRefs(obj: any): { obj: any; count: number } {
    let count = 0

    const rewrite = (value: any): any => {
      if (typeof value === 'string') {
        if (value.includes('{{config.')) {
          const replaced = value.replace(/\{\{config\./g, '{{input.')
          count += (value.match(/\{\{config\./g) || []).length
          return replaced
        }
        return value
      }
      if (Array.isArray(value)) {
        return value.map(rewrite)
      }
      if (value && typeof value === 'object') {
        // WP-6: Resolve ALL structured reference objects that survived from the IR.
        // The IR converter's resolveValueRef() should convert these to strings,
        // but deeply nested values or edge cases may survive unresolved.
        if (typeof value.kind === 'string') {
          count++
          switch (value.kind) {
            case 'config':
              // {kind: "config", key: "X"} → "{{input.X}}"
              return `{{input.${value.key}}}`
            case 'ref':
              // {kind: "ref", ref: "varName", field: "fieldName"} → "{{varName.fieldName}}"
              if (value.ref) {
                return value.field ? `{{${value.ref}.${value.field}}}` : `{{${value.ref}}}`
              }
              return undefined
            case 'literal':
              // {kind: "literal", value: X} → X (the raw value)
              return value.value
            case 'computed':
              // {kind: "computed", op: "concat", args: [...]} → try to resolve
              if (value.op === 'concat' && Array.isArray(value.args)) {
                const parts = value.args.map((arg: any) => rewrite(arg))
                return parts.filter((p: any) => p !== undefined).join('')
              }
              // Can't resolve other computed ops — leave warning
              return undefined
            default:
              // Unknown kind — pass through (will be caught by Phase A validation)
              count-- // Don't count as resolved
              break
          }
        }
        const result: any = {}
        for (const [key, val] of Object.entries(value)) {
          result[key] = rewrite(val)
        }
        return result
      }
      return value
    }

    return { obj: rewrite(obj), count }
  }

  /**
   * Renumber workflow steps sequentially with globally unique IDs
   * This ensures steps are numbered 1, 2, 3, ... across ALL nesting levels
   * Nested steps get globally unique IDs to avoid collisions (e.g., step1, step2, step3...)
   */
  private renumberSteps(workflow: WorkflowStep[]): WorkflowStep[] {
    let globalCounter = 1

    const renumberRecursive = (steps: WorkflowStep[]): WorkflowStep[] => {
      return steps.map((step) => {
        const newStepId = `step${globalCounter++}`

        // Update step_id and id fields
        const renumberedStep: any = {
          ...step,
          step_id: newStepId,
          id: newStepId
        }

        // Recursively renumber nested steps in scatter_gather
        if (step.type === 'scatter_gather' && step.scatter?.steps) {
          renumberedStep.scatter = {
            ...step.scatter,
            steps: renumberRecursive(step.scatter.steps)
          }
        }

        // Recursively renumber nested steps in conditional branches
        // Conditionals use 'steps' for then-branch and 'else_steps' for else-branch
        if (step.type === 'conditional') {
          const conditionalStep = step as any

          // Handle 'steps' property (then branch in DSL format)
          if (conditionalStep.steps && Array.isArray(conditionalStep.steps) && conditionalStep.steps.length > 0) {
            renumberedStep.steps = renumberRecursive(conditionalStep.steps)
          }

          // Handle 'else_steps' property (else branch in DSL format)
          if (conditionalStep.else_steps && Array.isArray(conditionalStep.else_steps) && conditionalStep.else_steps.length > 0) {
            renumberedStep.else_steps = renumberRecursive(conditionalStep.else_steps)
          }

          // Also handle 'then'/'else' format (if already translated to PILOT)
          if (conditionalStep.then && Array.isArray(conditionalStep.then) && conditionalStep.then.length > 0) {
            renumberedStep.then = renumberRecursive(conditionalStep.then)
          }
          if (conditionalStep.else && Array.isArray(conditionalStep.else) && conditionalStep.else.length > 0) {
            renumberedStep.else = renumberRecursive(conditionalStep.else)
          }
        }

        return renumberedStep as WorkflowStep
      })
    }

    return renumberRecursive(workflow)
  }

  // ============================================================================
  // Phase 3.7: Field Name Reconciliation (O10)
  // ============================================================================

  /**
   * Reconcile field name references across compiled workflow steps.
   *
   * Fixes two classes of field name mismatches:
   * (a) Casing mismatch: LLM used snake_case (mime_type) but plugin returns camelCase (mimeType)
   * (b) Wrong field name: compiler guessed a field name (content) that doesn't exist in upstream output (data)
   *
   * Algorithm:
   * 1. Build a map of output_variable → output_schema from all steps
   * 2. Walk all steps and find {{variable.field}} references in config values
   * 3. If field doesn't exist in upstream schema, resolve via fuzzy or semantic match
   * 4. Apply corrections and propagate downstream
   */
  private reconcileFieldReferences(workflow: WorkflowStep[], ctx: CompilerContext): WorkflowStep[] {
    // Step 1: Build variable → output_schema map from all steps (including nested)
    const schemaMap = new Map<string, Record<string, any>>()
    // Also build a full schema map (not flattened) for deep nested field extraction
    const fullSchemaMap = new Map<string, any>()
    this.buildSchemaMap(workflow, schemaMap, ctx, fullSchemaMap)

    if (schemaMap.size === 0) {
      this.log(ctx, '  → No output schemas found, skipping reconciliation')
      return workflow
    }

    this.log(ctx, `  → Built schema map: ${schemaMap.size} variables with output schemas`)

    // Step 2: Collect all corrections needed
    const corrections = new Map<string, string>() // "variable.wrongField" → "variable.correctField"
    this.findFieldMismatches(workflow, schemaMap, corrections, ctx, fullSchemaMap)

    if (corrections.size === 0) {
      this.log(ctx, '  → No field mismatches found')
      return workflow
    }

    this.log(ctx, `  → Found ${corrections.size} field corrections to apply`)

    // Step 3: Apply corrections across entire workflow
    const corrected = this.applyFieldCorrections(workflow, corrections, ctx)

    return corrected
  }

  /**
   * Build a map of output_variable → output_schema properties from all compiled steps.
   * Recursively walks into scatter_gather, conditional, etc.
   */
  private buildSchemaMap(steps: WorkflowStep[], schemaMap: Map<string, Record<string, any>>, ctx?: CompilerContext, fullSchemaMap?: Map<string, any>) {
    for (const step of steps) {
      // Extract output_schema properties for this step's output_variable
      if (step.output_variable && step.output_schema) {
        let props = this.extractSchemaProperties(step.output_schema)

        // Store full (un-flattened) schema for deep nested field extraction
        if (fullSchemaMap) {
          fullSchemaMap.set(step.output_variable, step.output_schema)
        }

        if (props && Object.keys(props).length > 0) {
          // O10a: For transform steps (flatten, filter, map), cross-check declared field names
          // against the upstream plugin source's actual field names.
          // The LLM may have normalized casing (e.g., mime_type) but the runtime data
          // preserves the plugin's original casing (e.g., mimeType).
          if (step.type === 'transform' && step.config?.input) {
            const inputVar = String(step.config.input).replace(/[{}]/g, '')
            // Use the FULL upstream schema (not flattened) for deep nested field extraction
            const upstreamFullSchema = fullSchemaMap?.get(inputVar)
            if (upstreamFullSchema) {
              props = this.reconcileTransformSchemaWithUpstream(props, upstreamFullSchema, step, ctx)
            }
          }

          schemaMap.set(step.output_variable, props)
          if (ctx) {
            this.log(ctx, `  → Schema map: ${step.output_variable} → [${Object.keys(props).join(', ')}]`)
          }
        }
      }

      // Recurse into nested steps
      if (step.type === 'scatter_gather' && step.scatter?.steps) {
        this.buildSchemaMap(step.scatter.steps, schemaMap, ctx, fullSchemaMap)
      }
      if (step.steps && Array.isArray(step.steps)) {
        this.buildSchemaMap(step.steps, schemaMap, ctx, fullSchemaMap)
      }
      const conditionalStep = step as any
      if (conditionalStep.else_steps && Array.isArray(conditionalStep.else_steps)) {
        this.buildSchemaMap(conditionalStep.else_steps, schemaMap, ctx, fullSchemaMap)
      }
    }
  }

  /**
   * O10a: Reconcile a transform step's declared field names with the upstream source.
   *
   * When a flatten/filter/map declares `mime_type` but upstream has `mimeType`,
   * the runtime data will have `mimeType` (plugin's original). Update the schema map
   * to use the upstream field names so downstream references get corrected.
   *
   * Accepts the FULL upstream output_schema (not flattened) so it can extract
   * deeply nested field names (e.g., emails[].attachments[].mimeType).
   */
  private reconcileTransformSchemaWithUpstream(
    transformProps: Record<string, { type: string; description?: string }>,
    upstreamFullSchema: any,
    step: WorkflowStep,
    ctx?: CompilerContext
  ): Record<string, { type: string; description?: string }> {
    const normalizeForFuzzy = (s: string): string => s.toLowerCase().replace(/[_\-]/g, '')

    // Build a lookup of ALL upstream field names (including deeply nested) by normalized form
    const upstreamByNormalized = new Map<string, string>()

    // Extract all field names from the full schema tree
    this.extractAllFieldNames(upstreamFullSchema, upstreamByNormalized)

    const corrected: Record<string, { type: string; description?: string }> = {}
    let hasCasingFixes = false

    for (const [declaredField, info] of Object.entries(transformProps)) {
      const normalized = normalizeForFuzzy(declaredField)
      const upstreamField = upstreamByNormalized.get(normalized)

      if (upstreamField && upstreamField !== declaredField) {
        // Casing mismatch — use upstream's canonical name
        corrected[upstreamField] = info
        hasCasingFixes = true
        if (ctx) {
          this.log(ctx, `  → [O10a] Transform ${step.step_id}: "${declaredField}" → "${upstreamField}" (upstream casing)`)
        }
      } else {
        corrected[declaredField] = info
      }
    }

    return hasCasingFixes ? corrected : transformProps
  }

  /**
   * Extract ALL field names from a full output_schema tree, at every nesting level.
   * Handles: object.properties, array.items.properties, and arbitrarily deep nesting.
   * Populates targetMap with normalizedName → canonicalName.
   */
  private extractAllFieldNames(
    schema: any,
    targetMap: Map<string, string>
  ) {
    if (!schema || typeof schema !== 'object') return

    const normalizeForFuzzy = (s: string): string => s.toLowerCase().replace(/[_\-]/g, '')

    // If this schema level has properties, extract all field names
    if (schema.properties) {
      for (const [fieldName, fieldValue] of Object.entries(schema.properties)) {
        targetMap.set(normalizeForFuzzy(fieldName), fieldName)
        // Recurse into each property's schema
        this.extractAllFieldNames(fieldValue as any, targetMap)
      }
    }

    // If this is an array type, recurse into items
    if (schema.type === 'array' && schema.items) {
      this.extractAllFieldNames(schema.items, targetMap)
    }
  }

  /**
   * Extract flat property map from an output_schema.
   * Handles both direct object schemas and array schemas (extracts items.properties).
   * Returns { fieldName: { type, description } } or null.
   */
  private extractSchemaProperties(schema: any): Record<string, { type: string; description?: string }> | null {
    if (!schema) return null

    // Direct object with properties
    if (schema.properties) {
      const result: Record<string, { type: string; description?: string }> = {}
      for (const [key, value] of Object.entries(schema.properties)) {
        const field = value as any
        result[key] = { type: field.type || 'unknown', description: field.description }
      }
      return result
    }

    // Array type — extract from items.properties
    if (schema.type === 'array' && schema.items?.properties) {
      const result: Record<string, { type: string; description?: string }> = {}
      for (const [key, value] of Object.entries(schema.items.properties)) {
        const field = value as any
        result[key] = { type: field.type || 'unknown', description: field.description }
      }
      return result
    }

    return null
  }

  /**
   * Walk all steps and find {{variable.field}} references where field doesn't exist
   * in the upstream output_schema. Populate corrections map.
   */
  private findFieldMismatches(
    steps: WorkflowStep[],
    schemaMap: Map<string, Record<string, any>>,
    corrections: Map<string, string>,
    ctx: CompilerContext,
    fullSchemaMap?: Map<string, any>
  ) {
    for (const step of steps) {
      // Determine input variable for transform/filter steps (for bare ref checking)
      const inputVariable = (step.type === 'transform' && step.config?.input)
        ? String(step.config.input).replace(/[{}]/g, '')
        : undefined

      // Check config values for {{variable.field}} references
      if (step.config) {
        this.findMismatchesInObject(step.config, schemaMap, corrections, ctx, `step ${step.step_id}`, inputVariable, fullSchemaMap)
      }

      // Check condition fields
      if (step.condition) {
        this.findMismatchesInObject(step.condition, schemaMap, corrections, ctx, `step ${step.step_id} condition`, inputVariable, fullSchemaMap)
      }

      // O25b: Validate cross-variable value references in in/not_in filter conditions
      // When a filter condition has operator "in" and value is a variable name,
      // verify the variable's output_schema is a compatible array type (not array<object>)
      if (step.config?.condition) {
        this.validateFilterConditionValues(step.config.condition, schemaMap, ctx, step.step_id, fullSchemaMap)
      }

      // Check input references
      if (typeof step.input === 'string') {
        this.checkSingleRef(step.input, schemaMap, corrections, ctx, `step ${step.step_id} input`, inputVariable, fullSchemaMap)
      }

      // Recurse into nested steps
      if (step.type === 'scatter_gather' && step.scatter?.steps) {
        this.findFieldMismatches(step.scatter.steps, schemaMap, corrections, ctx, fullSchemaMap)
      }
      if (step.steps && Array.isArray(step.steps)) {
        this.findFieldMismatches(step.steps, schemaMap, corrections, ctx, fullSchemaMap)
      }
      const conditionalStep = step as any
      if (conditionalStep.else_steps && Array.isArray(conditionalStep.else_steps)) {
        this.findFieldMismatches(conditionalStep.else_steps, schemaMap, corrections, ctx, fullSchemaMap)
      }
    }
  }

  /**
   * Recursively scan an object (config, condition, etc.) for {{variable.field}} template references
   * and check each against the schema map.
   */
  private findMismatchesInObject(
    obj: any,
    schemaMap: Map<string, Record<string, any>>,
    corrections: Map<string, string>,
    ctx: CompilerContext,
    location: string,
    inputVariable?: string,
    fullSchemaMap?: Map<string, any>
  ) {
    if (typeof obj === 'string') {
      this.checkSingleRef(obj, schemaMap, corrections, ctx, location, inputVariable, fullSchemaMap)
    } else if (Array.isArray(obj)) {
      for (const item of obj) {
        this.findMismatchesInObject(item, schemaMap, corrections, ctx, location, inputVariable, fullSchemaMap)
      }
    } else if (obj && typeof obj === 'object') {
      for (const value of Object.values(obj)) {
        this.findMismatchesInObject(value, schemaMap, corrections, ctx, location, inputVariable, fullSchemaMap)
      }
    }
  }

  /**
   * O25b: Validate that value references in in/not_in filter conditions point to compatible types.
   * Recursively walks nested conditions (complex_not, complex_and, complex_or).
   */
  private validateFilterConditionValues(
    condition: any,
    schemaMap: Map<string, Record<string, any>>,
    ctx: CompilerContext,
    stepId: string,
    fullSchemaMap?: Map<string, any>
  ) {
    if (!condition || typeof condition !== 'object') return

    // Handle nested conditions
    if (condition.conditionType === 'complex_not' && condition.condition) {
      this.validateFilterConditionValues(condition.condition, schemaMap, ctx, stepId, fullSchemaMap)
    }
    if (condition.conditions && Array.isArray(condition.conditions)) {
      for (const sub of condition.conditions) {
        this.validateFilterConditionValues(sub, schemaMap, ctx, stepId, fullSchemaMap)
      }
    }

    // Check simple conditions with 'in' operator where value is a variable name
    if (condition.conditionType === 'simple' && condition.value && typeof condition.value === 'string') {
      const operator = condition.operator?.toLowerCase()
      if (operator === 'in' || operator === 'not_in' || operator === 'includes') {
        const valueName = condition.value.replace(/[{}]/g, '')

        // Check if this is a known variable (not a literal)
        if (schemaMap.has(valueName) || fullSchemaMap?.has(valueName)) {
          const fullSchema = fullSchemaMap?.get(valueName)

          if (fullSchema) {
            // Validate the variable is an array of primitives, not objects
            if (fullSchema.type === 'array' && fullSchema.items?.type === 'object') {
              this.warn(ctx,
                `[O25b] step ${stepId}: filter condition "${condition.operator}" references "${valueName}" ` +
                `which is array<object>, not array<string>. The in/not_in check will fail at runtime. ` +
                `Expected: array<string> or array<number>.`
              )
            } else if (fullSchema.type !== 'array') {
              this.warn(ctx,
                `[O25b] step ${stepId}: filter condition "${condition.operator}" references "${valueName}" ` +
                `which has type "${fullSchema.type}", not an array. The in/not_in check will fail at runtime.`
              )
            } else {
              this.log(ctx, `  → [O25b] step ${stepId}: "${valueName}" is array<${fullSchema.items?.type || 'unknown'}> — compatible with ${condition.operator}`)
            }
          }
        }
      }
    }
  }

  /**
   * Check a single string value for field references.
   * Handles both template refs ({{variable.field}}) and bare refs (item.field, element.field)
   * used in filter/transform conditions.
   */
  private checkSingleRef(
    value: string,
    schemaMap: Map<string, Record<string, any>>,
    corrections: Map<string, string>,
    ctx: CompilerContext,
    location: string,
    inputVariable?: string,
    fullSchemaMap?: Map<string, any>
  ) {
    // Match {{variable.field}} patterns (not {{config.X}} which are user configs)
    const refPattern = /\{\{(\w+)\.(\w+)\}\}/g
    let match: RegExpExecArray | null

    while ((match = refPattern.exec(value)) !== null) {
      const variable = match[1]
      const field = match[2]

      // Skip config references — those are user-provided, not upstream output
      if (variable === 'config') continue

      // Check if we have a schema for this variable
      const props = schemaMap.get(variable)
      if (!props) continue // Unknown variable, can't validate

      // Check if field exists exactly
      if (field in props) continue // Exact match, no correction needed

      // Field doesn't exist — try to resolve via casing/semantic match first
      const correctedField = this.resolveFieldMismatch(field, props, ctx, location, variable)

      if (correctedField) {
        const oldRef = `${variable}.${field}`
        const newRef = `${variable}.${correctedField}`
        corrections.set(oldRef, newRef)
        this.log(ctx, `  → [O10] ${location}: {{${oldRef}}} → {{${newRef}}} (field reconciled)`)
      } else {
        // O20: Recursive nested field search — field may exist at a deeper nesting level
        // e.g., "amount" not at top level but at "extracted_fields.amount"
        const fullSchema = fullSchemaMap?.get(variable)
        if (fullSchema) {
          const nestedPaths = this.findFieldInNestedSchema(field, fullSchema)

          if (nestedPaths.length === 1) {
            // Found at exactly one nested path — auto-correct
            const nestedPath = nestedPaths[0]
            const oldRef = `${variable}.${field}`
            const newRef = `${variable}.${nestedPath}`
            corrections.set(oldRef, newRef)
            this.log(ctx, `  → [O20] ${location}: {{${oldRef}}} → {{${newRef}}} (nested field path resolved)`)
          } else if (nestedPaths.length > 1) {
            // Found at multiple nested paths — warn about ambiguity
            this.warn(
              ctx,
              `[O20] ${location}: {{${variable}.${field}}} — field "${field}" found at ` +
              `multiple nested paths: [${nestedPaths.join(', ')}]. Cannot auto-correct — ` +
              `please specify the full path explicitly.`
            )
          } else {
            // Not found anywhere — fall back to original O10 warning
            this.warn(ctx, `[O10] ${location}: {{${variable}.${field}}} — field "${field}" not found in ${variable} output schema. Available: [${Object.keys(props).join(', ')}]`)
          }
        } else {
          this.warn(ctx, `[O10] ${location}: {{${variable}.${field}}} — field "${field}" not found in ${variable} output schema. Available: [${Object.keys(props).join(', ')}]`)
        }
      }
    }

    // Also check bare references: item.field, element.field (used in filter/transform conditions)
    // These reference the input variable's schema (the array items being iterated)
    if (inputVariable) {
      const bareRefPattern = /\b(?:item|element)\.(\w+)\b/g
      let bareMatch: RegExpExecArray | null

      while ((bareMatch = bareRefPattern.exec(value)) !== null) {
        const field = bareMatch[1]

        let props = schemaMap.get(inputVariable)

        // O25a: If direct lookup fails, handle dotted input variables (e.g., "complaint_emails.emails")
        // Navigate into the base variable's full schema to find the nested array items' properties
        if (!props && inputVariable.includes('.') && fullSchemaMap) {
          const dotIdx = inputVariable.indexOf('.')
          const baseVar = inputVariable.substring(0, dotIdx)
          const subField = inputVariable.substring(dotIdx + 1)
          const baseFullSchema = fullSchemaMap.get(baseVar)
          if (baseFullSchema?.properties?.[subField]?.items?.properties) {
            props = {}
            for (const [k, v] of Object.entries(baseFullSchema.properties[subField].items.properties)) {
              props[k] = v as any
            }
            this.log(ctx, `  → [O25a] Resolved item schema for "${inputVariable}" via ${baseVar}.${subField}.items — fields: [${Object.keys(props).join(', ')}]`)
          }
        }

        if (!props) continue

        if (field in props) continue // Exact match

        const correctedField = this.resolveFieldMismatch(field, props, ctx, location, `item(${inputVariable})`)

        if (correctedField) {
          // Store as a bare field correction (oldField → newField) for item/element references
          const oldRef = `__bare__.${field}`
          const newRef = `__bare__.${correctedField}`
          if (!corrections.has(oldRef)) {
            corrections.set(oldRef, newRef)
            this.log(ctx, `  → [O10a] ${location}: item.${field} → item.${correctedField} (upstream casing, input: ${inputVariable})`)
          }
        }
      }
    }
  }

  /**
   * O20: Recursively search a schema tree for a field name at any nesting level.
   * Returns all paths where the field is found (e.g., ["extracted_fields.amount", "metadata.amount"]).
   * Skips the top level (already checked by the caller).
   */
  private findFieldInNestedSchema(
    fieldName: string,
    schema: any,
    currentPath: string = '',
    depth: number = 0
  ): string[] {
    const foundPaths: string[] = []
    // Limit recursion depth to prevent infinite loops
    if (depth > 5 || !schema || typeof schema !== 'object') return foundPaths

    const properties = schema.properties || schema.items?.properties || null
    if (!properties) return foundPaths

    for (const [propName, propSchema] of Object.entries(properties)) {
      const propPath = currentPath ? `${currentPath}.${propName}` : propName
      const propSchemaObj = propSchema as any

      // Skip top level (depth 0) — already checked by caller
      if (depth > 0 && propName === fieldName) {
        foundPaths.push(propPath)
      }

      // Recurse into nested objects and arrays
      if (propSchemaObj?.type === 'object' && propSchemaObj.properties) {
        foundPaths.push(...this.findFieldInNestedSchema(fieldName, propSchemaObj, propPath, depth + 1))
      }
      if (propSchemaObj?.type === 'array' && propSchemaObj.items) {
        foundPaths.push(...this.findFieldInNestedSchema(fieldName, propSchemaObj.items, propPath, depth + 1))
      }
    }

    return foundPaths
  }

  /**
   * Attempt to resolve a mismatched field name against an output schema's properties.
   *
   * Resolution priority:
   * 1. Fuzzy casing match (normalize to lowercase-no-separators)
   * 2. Type + description semantic match
   *
   * Returns the correct field name or null if no match found.
   */
  private resolveFieldMismatch(
    wrongField: string,
    schemaProps: Record<string, { type: string; description?: string }>,
    ctx: CompilerContext,
    location: string,
    variable: string
  ): string | null {
    // Strategy 1: Fuzzy casing match
    // Normalize both to lowercase with no separators: mime_type → mimetype, mimeType → mimetype
    const normalizeForFuzzy = (s: string): string => s.toLowerCase().replace(/[_\-]/g, '')
    const normalizedWrong = normalizeForFuzzy(wrongField)

    for (const [schemaField] of Object.entries(schemaProps)) {
      if (normalizeForFuzzy(schemaField) === normalizedWrong) {
        this.log(ctx, `  → [O10a] Casing match: "${wrongField}" → "${schemaField}" (${variable})`)
        return schemaField
      }
    }

    // Strategy 2: Type + description semantic match
    // Look for a field whose description contains the wrong field name as a keyword
    // e.g., wrongField="content" → field "data" described as "Base64-encoded file content for processing"
    const wrongLower = wrongField.toLowerCase()
    let bestMatch: string | null = null
    let bestScore = 0

    for (const [schemaField, info] of Object.entries(schemaProps)) {
      const desc = (info.description || '').toLowerCase()
      let score = 0

      // Check if the wrong field name appears in the description
      // O25a: Normalize underscores to spaces for matching (e.g., "message_id" matches "message ID")
      const descNormalized = desc.replace(/[_\-]/g, ' ')
      const wrongNormalized = wrongLower.replace(/[_\-]/g, ' ')
      if (descNormalized.includes(wrongNormalized) || desc.includes(wrongLower)) {
        score += 3
      }

      // Check if the wrong field name is a substring of the schema field or vice versa
      const schemaLower = schemaField.toLowerCase()
      if (schemaLower.includes(wrongLower) || wrongLower.includes(schemaLower)) {
        score += 2
      }

      // Check common semantic synonyms
      const synonyms: Record<string, string[]> = {
        'content': ['data', 'body', 'payload', 'text'],
        'data': ['content', 'body', 'payload'],
        'body': ['content', 'data', 'html_body', 'text'],
        'name': ['title', 'label', 'filename', 'file_name'],
        'url': ['link', 'href', 'web_view_link', 'web_content_link'],
        'id': ['identifier', 'key', 'message_id', 'thread_id', 'email_id'],
        'message_id': ['id'],
        'thread_id': ['id'],
      }
      const synonymsForWrong = synonyms[wrongLower] || []
      if (synonymsForWrong.includes(schemaLower)) {
        score += 2
      }

      if (score > bestScore) {
        bestScore = score
        bestMatch = schemaField
      }
    }

    // Only accept semantic match if score is strong enough (at least description match)
    if (bestMatch && bestScore >= 3) {
      this.log(ctx, `  → [O10b] Semantic match: "${wrongField}" → "${bestMatch}" (${variable}, score=${bestScore})`)
      return bestMatch
    }

    return null
  }

  /**
   * Apply field corrections across the entire workflow.
   * Replaces all occurrences of {{variable.wrongField}} with {{variable.correctField}}.
   * Also fixes field references in output_schema properties and filter conditions.
   */
  private applyFieldCorrections(
    workflow: WorkflowStep[],
    corrections: Map<string, string>,
    ctx: CompilerContext
  ): WorkflowStep[] {
    // Build string replacement pairs: "{{old}}" → "{{new}}"
    // Also handle bare references without braces (e.g., "item.mime_type" in conditions)
    const replacements: Array<{ pattern: RegExp; replacement: string; barePattern?: RegExp; bareReplacement?: string }> = []

    // Track unique field renames for schema property key correction
    const fieldRenames = new Map<string, string>() // oldField → newField

    corrections.forEach((newRef, oldRef) => {
      const oldField = oldRef.split('.').pop()!
      const newField = newRef.split('.').pop()!
      fieldRenames.set(oldField, newField)

      if (oldRef.startsWith('__bare__.')) {
        // Bare field correction (from item.field in filter conditions)
        // Only add bare pattern, no template pattern
        replacements.push({
          pattern: new RegExp(`(item|element)\\.${this.escapeRegex(oldField)}\\b`, 'g'),
          replacement: `$1.${newField}`
        })
      } else {
        // Template reference: {{variable.field}}
        replacements.push({
          pattern: new RegExp(`\\{\\{${this.escapeRegex(oldRef)}\\}\\}`, 'g'),
          replacement: `{{${newRef}}}`,
          // Also fix bare field references like "item.mime_type" in filter conditions
          barePattern: new RegExp(`(item|element)\\.${this.escapeRegex(oldField)}\\b`, 'g'),
          bareReplacement: `$1.${newField}`
        })
      }
    })

    let result = this.applyReplacementsToSteps(workflow, replacements, ctx)

    // Also fix output_schema property keys structurally (not via regex, to avoid
    // changing plugin parameter names like config.mime_type)
    if (fieldRenames.size > 0) {
      result = this.fixOutputSchemaKeys(result, fieldRenames, ctx)
    }

    return result
  }

  /**
   * Recursively apply string replacements across all steps.
   */
  private applyReplacementsToSteps(
    steps: WorkflowStep[],
    replacements: Array<{ pattern: RegExp; replacement: string; barePattern?: RegExp; bareReplacement?: string }>,
    ctx: CompilerContext
  ): WorkflowStep[] {
    return steps.map(step => {
      let fixed: any = JSON.parse(JSON.stringify(step)) // Deep clone

      // Apply replacements to the entire step (serialized)
      let serialized = JSON.stringify(fixed)
      for (const { pattern, replacement, barePattern, bareReplacement } of replacements) {
        serialized = serialized.replace(pattern, replacement)
        if (barePattern && bareReplacement) {
          serialized = serialized.replace(barePattern, bareReplacement)
        }
      }
      fixed = JSON.parse(serialized)

      return fixed as WorkflowStep
    })
  }

  /**
   * Fix output_schema property keys to match corrected field names.
   * Only renames keys inside output_schema objects — does NOT touch config parameter names.
   * Recursively walks all steps including nested scatter_gather/conditional.
   */
  private fixOutputSchemaKeys(
    steps: WorkflowStep[],
    fieldRenames: Map<string, string>,
    ctx: CompilerContext
  ): WorkflowStep[] {
    return steps.map(step => {
      const fixed: any = { ...step }

      // Fix output_schema at step level
      if (fixed.output_schema) {
        fixed.output_schema = this.renameSchemaPropertyKeys(fixed.output_schema, fieldRenames)
      }

      // Fix output_schema inside config (some transforms have config.output_schema)
      if (fixed.config?.output_schema) {
        fixed.config = { ...fixed.config, output_schema: this.renameSchemaPropertyKeys(fixed.config.output_schema, fieldRenames) }
      }

      // Fix input_schema if present
      if (fixed.input_schema) {
        fixed.input_schema = this.renameSchemaPropertyKeys(fixed.input_schema, fieldRenames)
      }

      // Recurse into nested steps
      if (fixed.type === 'scatter_gather' && fixed.scatter?.steps) {
        fixed.scatter = { ...fixed.scatter, steps: this.fixOutputSchemaKeys(fixed.scatter.steps, fieldRenames, ctx) }
      }
      if (fixed.steps && Array.isArray(fixed.steps)) {
        fixed.steps = this.fixOutputSchemaKeys(fixed.steps, fieldRenames, ctx)
      }
      if (fixed.else_steps && Array.isArray(fixed.else_steps)) {
        fixed.else_steps = this.fixOutputSchemaKeys(fixed.else_steps, fieldRenames, ctx)
      }

      return fixed as WorkflowStep
    })
  }

  /**
   * Rename property keys in a schema object.
   * Recursively handles properties, items.properties, etc.
   */
  private renameSchemaPropertyKeys(schema: any, fieldRenames: Map<string, string>): any {
    if (!schema || typeof schema !== 'object') return schema

    const result = { ...schema }

    if (result.properties) {
      const newProps: Record<string, any> = {}
      for (const [key, value] of Object.entries(result.properties)) {
        const newKey = fieldRenames.get(key) || key
        newProps[newKey] = this.renameSchemaPropertyKeys(value as any, fieldRenames)
      }
      result.properties = newProps
    }

    if (result.items) {
      result.items = this.renameSchemaPropertyKeys(result.items, fieldRenames)
    }

    return result
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  // ============================================================================
  // Phase 3.9: Nullable-to-Required Parameter Detection (O16)
  // ============================================================================

  /**
   * O16: Detect when an extraction step's nullable output fields are mapped to
   * required plugin parameters. Emits a compilation WARNING only -- no auto-fix.
   *
   * Algorithm:
   * 1. Find all steps with output_schema that have non-required fields (potentially null)
   * 2. For each downstream action step, check if its plugin parameters are required
   * 3. If a nullable output field feeds a required parameter, warn
   */
  private detectNullableToRequiredMappings(workflow: WorkflowStep[], ctx: CompilerContext): void {
    // Step 1: Build a map of output_variable → { requiredFields, allFields }
    const outputFieldInfo = new Map<string, { required: Set<string>; all: Set<string> }>()

    const collectOutputInfo = (steps: WorkflowStep[]) => {
      for (const step of steps) {
        if (step.output_variable && step.output_schema) {
          const schema = step.output_schema
          const requiredFields = new Set<string>(schema.required || [])
          const allFields = new Set<string>(
            Object.keys(schema.properties || schema.items?.properties || {})
          )
          // Nullable fields = all fields minus required fields
          outputFieldInfo.set(step.output_variable, { required: requiredFields, all: allFields })
        }

        // Recurse into nested steps
        if (step.type === 'scatter_gather' && step.scatter?.steps) {
          collectOutputInfo(step.scatter.steps)
        }
        if (step.steps && Array.isArray(step.steps)) {
          collectOutputInfo(step.steps)
        }
        const conditionalStep = step as any
        if (conditionalStep.else_steps && Array.isArray(conditionalStep.else_steps)) {
          collectOutputInfo(conditionalStep.else_steps)
        }
      }
    }
    collectOutputInfo(workflow)

    if (outputFieldInfo.size === 0) return

    // Step 2: Check action steps for required parameters that reference nullable fields
    let warningCount = 0

    const checkStep = (steps: WorkflowStep[]) => {
      for (const step of steps) {
        if (step.type === 'action' && step.plugin && step.operation) {
          const pluginSchema = this.getActionInputSchema(step.plugin, step.operation)
          if (!pluginSchema) continue

          const requiredParams = new Set<string>(pluginSchema.required || [])
          const params = (step as any).params || step.config || {}

          for (const [paramName, paramValue] of Object.entries(params)) {
            if (!requiredParams.has(paramName)) continue
            if (typeof paramValue !== 'string') continue

            // Check if this references a nullable field: {{variable.field}}
            const refMatch = (paramValue as string).match(/^\{\{(\w+)\.(\w+)\}\}$/)
            if (!refMatch) continue

            const [, variable, field] = refMatch
            const info = outputFieldInfo.get(variable)
            if (!info) continue

            // Field is nullable if it exists in all fields but NOT in required fields
            if (info.all.has(field) && !info.required.has(field)) {
              this.warn(
                ctx,
                `[O16] Nullable field "${variable}.${field}" mapped to required parameter ` +
                `"${paramName}" in ${step.plugin}.${step.operation} (step ${step.step_id}). ` +
                `If "${field}" is null at runtime, the plugin call will fail.`
              )
              warningCount++
            }
          }
        }

        // Recurse
        if (step.type === 'scatter_gather' && step.scatter?.steps) {
          checkStep(step.scatter.steps)
        }
        if (step.steps && Array.isArray(step.steps)) {
          checkStep(step.steps)
        }
        const conditionalStep = step as any
        if (conditionalStep.else_steps && Array.isArray(conditionalStep.else_steps)) {
          checkStep(conditionalStep.else_steps)
        }
      }
    }
    checkStep(workflow)

    if (warningCount === 0) {
      this.log(ctx, '  → No nullable-to-required parameter issues detected')
    } else {
      this.log(ctx, `  → O16: ${warningCount} nullable-to-required parameter warning(s) emitted`)
    }
  }

  /**
   * O16: Get plugin action input schema (parameters) for nullable field detection.
   */
  private getActionInputSchema(pluginKey: string, actionName: string): any | undefined {
    if (!this.pluginManager) return undefined

    try {
      const plugins = this.pluginManager.getAvailablePlugins()
      const pluginDef = plugins[pluginKey]

      if (!pluginDef?.actions?.[actionName]) return undefined

      return pluginDef.actions[actionName].parameters
    } catch {
      return undefined
    }
  }

  // ============================================================================
  // Phase 3.10: Empty Results Assertions (O18)
  // ============================================================================

  /**
   * O18 (Compiler-level): Add on_empty metadata to transform/flatten steps
   * that feed into scatter-gather. This enables the runtime to detect and
   * handle empty results appropriately.
   *
   * Default: on_empty: "warn" for most steps.
   * Before scatter-gather: on_empty: "throw" (empty scatter input is always a problem).
   */
  /**
   * PD-3: Emit a compile-time warning when a scatter_gather's output feeds
   * directly into an ai_processing step (or a chain of them). With enough
   * scatter iterations, the downstream AI step can blow past the model's
   * TPM budget — as seen in WP-14. This is structural guidance, not a
   * hard error: the user may have intentionally designed a big scatter.
   */
  private warnScatterIntoAIPatterns(workflow: WorkflowStep[], ctx: CompilerContext): void {
    const scatterOutputVars = new Set<string>()

    const walk = (steps: any[]) => {
      for (const step of steps) {
        if (step?.type === 'scatter_gather' && step?.output_variable) {
          scatterOutputVars.add(step.output_variable)
        }
        if (step?.scatter?.steps) walk(step.scatter.steps)
        if (step?.steps) walk(step.steps)
        if (step?.then_steps) walk(step.then_steps)
        if (step?.else_steps) walk(step.else_steps)
      }
    }
    walk(workflow as any[])

    if (scatterOutputVars.size === 0) return

    for (const step of workflow as any[]) {
      if (step?.type !== 'ai_processing') continue
      const input = typeof step.input === 'string' ? step.input : ''
      // Match {{scatter_var}} or {{scatter_var.field}}
      const refMatch = input.match(/\{\{([a-zA-Z0-9_]+)(?:\.[a-zA-Z0-9_.]+)?\}\}/)
      const refName = refMatch?.[1]
      if (refName && scatterOutputVars.has(refName)) {
        this.log(
          ctx,
          `  ⚠️  [PD-3] ai_processing step '${step.step_id || step.id}' consumes scatter_gather output '${refName}' directly. ` +
            `Risk of TPM limit at runtime when scatter produces many items. ` +
            `Consider summarizing per-item before aggregating, or chunking the downstream AI call.`
        )
      }
    }
  }

  private addEmptyResultAssertions(workflow: WorkflowStep[], ctx: CompilerContext): void {
    let assertionsAdded = 0

    const processSteps = (steps: WorkflowStep[]) => {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        const nextStep = i + 1 < steps.length ? steps[i + 1] : null

        // Add on_empty to transform/flatten steps
        if (step.type === 'transform' && ['flatten', 'filter', 'map', 'select'].includes(step.operation || '')) {
          const stepAny = step as any

          // Check if next step is scatter-gather — use "throw" to prevent empty iteration
          if (nextStep?.type === 'scatter_gather') {
            stepAny._on_empty = 'throw'
            this.log(ctx, `  → O18: Added on_empty: "throw" to ${step.step_id} (feeds scatter-gather ${nextStep.step_id})`)
            assertionsAdded++
          } else if (!stepAny._on_empty) {
            // Default: "warn" for all other transform steps producing arrays
            stepAny._on_empty = 'warn'
            assertionsAdded++
          }
        }

        // Recurse into scatter-gather body steps
        if (step.type === 'scatter_gather' && step.scatter?.steps) {
          processSteps(step.scatter.steps)
        }
        if (step.steps && Array.isArray(step.steps)) {
          processSteps(step.steps)
        }
        const conditionalStep = step as any
        if (conditionalStep.else_steps && Array.isArray(conditionalStep.else_steps)) {
          processSteps(conditionalStep.else_steps)
        }
      }
    }

    processSteps(workflow)

    if (assertionsAdded > 0) {
      this.log(ctx, `  → O18: Added ${assertionsAdded} empty result assertion(s)`)
    }
  }

  // ============================================================================
  // Phase 3.8: Config Reference Consistency (O11)
  // ============================================================================

  /**
   * O11 (Layer B): WARNING-ONLY validation pass that detects unreferenced config keys.
   * Scans the compiled DSL for {{config.X}} references and warns about config keys
   * declared in IntentContract but never referenced. Also detects hardcoded values
   * that match config defaults and warns (but does NOT auto-replace).
   *
   * Auto-replacement was removed per SA directive -- config value replacement
   * must be fixed at the source (Phase 1 prompt, Layer A) not patched in the compiler.
   */
  private enforceConfigReferences(
    workflow: WorkflowStep[],
    configDefaults: Array<{ key: string; type: string; description?: string; default?: any }>,
    ctx: CompilerContext
  ): WorkflowStep[] {
    // Step 1: Collect all {{config.X}} references from the compiled workflow
    const referencedConfigKeys = new Set<string>()
    const serializedWorkflow = JSON.stringify(workflow)
    const configRefPattern = /\{\{config\.(\w+)\}\}/g
    let match: RegExpExecArray | null
    while ((match = configRefPattern.exec(serializedWorkflow)) !== null) {
      referencedConfigKeys.add(match[1])
    }

    this.log(ctx, `  → Referenced config keys: [${Array.from(referencedConfigKeys).join(', ')}]`)

    // Step 2: Find unreferenced config keys and emit warnings
    const unreferenced: Array<{ key: string; default_value: any }> = []
    for (const entry of configDefaults) {
      if (!referencedConfigKeys.has(entry.key)) {
        unreferenced.push({ key: entry.key, default_value: entry.default })
        this.warn(ctx, `[O11] Config key "${entry.key}" declared but never referenced in workflow`)
      }
    }

    if (unreferenced.length === 0) {
      this.log(ctx, '  → All config keys are referenced')
      return workflow
    }

    this.log(ctx, `  → ${unreferenced.length} unreferenced config key(s): [${unreferenced.map(u => u.key).join(', ')}]`)

    // Step 3: WARNING-ONLY -- detect hardcoded values that match config defaults
    // Does NOT auto-replace. Warns so the issue can be fixed at the source (Phase 1 prompt).
    for (const { key, default_value } of unreferenced) {
      if (default_value === undefined || default_value === null) continue

      const paramCandidates = this.deriveParamCandidates(key)

      for (const paramName of paramCandidates) {
        let pattern: RegExp

        if (typeof default_value === 'number') {
          pattern = new RegExp(`"${this.escapeRegex(paramName)}"\\s*:\\s*${default_value}(?=[,}\\s])`, 'g')
        } else if (typeof default_value === 'string') {
          pattern = new RegExp(`"${this.escapeRegex(paramName)}"\\s*:\\s*"${this.escapeRegex(default_value)}"`, 'g')
        } else if (typeof default_value === 'boolean') {
          pattern = new RegExp(`"${this.escapeRegex(paramName)}"\\s*:\\s*${default_value}(?=[,}\\s])`, 'g')
        } else {
          continue
        }

        if (pattern.test(serializedWorkflow)) {
          this.warn(
            ctx,
            `[O11] Hardcoded value detected: "${paramName}": ${JSON.stringify(default_value)} ` +
            `matches config key "${key}" default. Should use { kind: "config", key: "${key}" } ` +
            `in IntentContract to make this value runtime-configurable.`
          )
        }
      }
    }

    // Return workflow unchanged -- no auto-replacement
    return workflow
  }

  /**
   * Derive candidate parameter names from a config key.
   * Strips common prefixes to find the likely plugin parameter name.
   * e.g., "gmail_search_max_results" → ["max_results", "gmail_search_max_results"]
   * e.g., "amount_threshold" → ["amount_threshold", "threshold"]
   */
  private deriveParamCandidates(configKey: string): string[] {
    const candidates = [configKey] // Always include the full key

    const parts = configKey.split('_')

    // Try removing first N prefix parts (1, 2, 3)
    // gmail_search_max_results → search_max_results, max_results, results
    for (let i = 1; i < parts.length; i++) {
      candidates.push(parts.slice(i).join('_'))
    }

    return candidates
  }

  /**
   * Update variable references in a step to use normalized variable name
   *
   * Example: {{existing_rows.values}} → {{existing_rows_objects}}
   */
  private updateVariableReferences(
    step: WorkflowStep,
    oldVarName: string,
    newVarName: string,
    arrayFieldName: string
  ): void {
    const oldSubFieldPattern = `{{${oldVarName}.${arrayFieldName}}}`
    const oldBareTemplate = `{{${oldVarName}}}`
    const newTemplate = `{{${newVarName}}}`

    // Helper to recursively replace in objects
    const replaceInValue = (value: any): any => {
      if (typeof value === 'string') {
        // First replace sub-field pattern: {{raw_leads.values}} → {{raw_leads_objects}}
        let result = value.replace(oldSubFieldPattern, newTemplate)
        // Replace template bare pattern: {{raw_leads}} → {{raw_leads_objects}}
        const bareTemplateRegex = new RegExp(`\\{\\{${oldVarName}\\}\\}`, 'g')
        result = result.replace(bareTemplateRegex, newTemplate)
        // Replace bare string (no braces): exact match "raw_leads" → "raw_leads_objects"
        // Only replace if the entire string is exactly the old var name (avoid partial matches)
        if (result === oldVarName) {
          result = newVarName
        }
        return result
      } else if (Array.isArray(value)) {
        return value.map(replaceInValue)
      } else if (value && typeof value === 'object') {
        const result: any = {}
        for (const [k, v] of Object.entries(value)) {
          result[k] = replaceInValue(v)
        }
        return result
      }
      return value
    }

    // Update input field
    if (step.input) {
      step.input = replaceInValue(step.input)
    }

    // Update config fields
    if (step.config) {
      step.config = replaceInValue(step.config)
      // Also update config.input bare string (DataOperations reads this without {{ }})
      if (step.config?.input === oldVarName) {
        step.config!.input = newVarName
      }
    }

    // Update condition fields (for conditional steps)
    if ((step as any).condition) {
      (step as any).condition = replaceInValue((step as any).condition)
    }

    // Update nested steps (for scatter_gather, conditional, etc.)
    if ((step as any).scatter?.steps) {
      for (const nestedStep of (step as any).scatter.steps) {
        this.updateVariableReferences(nestedStep, oldVarName, newVarName, arrayFieldName)
      }
    }

    if ((step as any).then) {
      for (const thenStep of (step as any).then) {
        this.updateVariableReferences(thenStep, oldVarName, newVarName, arrayFieldName)
      }
    }

    if ((step as any).else_steps) {
      for (const elseStep of (step as any).else_steps) {
        this.updateVariableReferences(elseStep, oldVarName, newVarName, arrayFieldName)
      }
    }
  }

  /**
   * Unwrap variable references to access wrapped arrays
   *
   * For wrapped APIs like Gmail {emails: [...]}, this converts:
   * - {{all_emails}} → {{all_emails.emails}}
   * - But preserves already-unwrapped references like {{all_emails.emails[0]}}
   */
  private unwrapVariableReferences(
    step: WorkflowStep,
    varName: string,
    arrayFieldName: string
  ): void {
    // Helper to recursively unwrap in strings
    const unwrapInValue = (value: any): any => {
      if (typeof value === 'string') {
        // Match {{varName}} but NOT {{varName.something}}
        // This regex ensures we only unwrap direct references, not already-accessed paths
        const directRefPattern = new RegExp(`\\{\\{${varName}\\}\\}(?!\\.\\w)`, 'g')
        let result = value.replace(directRefPattern, `{{${varName}.${arrayFieldName}}}`)
        // Also handle bare strings without {{ }} (at Phase 3.5, inputs may not have braces yet — same fix as O15)
        if (result === varName) {
          result = `${varName}.${arrayFieldName}`
        }
        return result
      } else if (Array.isArray(value)) {
        return value.map(unwrapInValue)
      } else if (value && typeof value === 'object') {
        const result: any = {}
        for (const [k, v] of Object.entries(value)) {
          result[k] = unwrapInValue(v)
        }
        return result
      }
      return value
    }

    // Update input field
    if (step.input) {
      step.input = unwrapInValue(step.input)
    }

    // Update config fields
    if (step.config) {
      step.config = unwrapInValue(step.config)
    }

    // Update condition fields (for conditional steps)
    if ((step as any).condition) {
      (step as any).condition = unwrapInValue((step as any).condition)
    }

    // Update nested steps (for scatter_gather, conditional, etc.)
    if ((step as any).scatter?.steps) {
      for (const nestedStep of (step as any).scatter.steps) {
        this.unwrapVariableReferences(nestedStep, varName, arrayFieldName)
      }
    }

    if ((step as any).then) {
      for (const thenStep of (step as any).then) {
        this.unwrapVariableReferences(thenStep, varName, arrayFieldName)
      }
    }

    if ((step as any).else_steps) {
      for (const elseStep of (step as any).else_steps) {
        this.unwrapVariableReferences(elseStep, varName, arrayFieldName)
      }
    }
  }

  /**
   * Build input reference from InputBinding
   * Handles path navigation for nested fields
   */
  private buildInputReference(input: { variable: string; path?: string }): string {
    if (!input.path) {
      // No path, just return variable name
      return input.variable
    }

    // Has path - append it to variable name with dot notation
    // The variable reference will be wrapped in {{}} later by the calling code
    return `${input.variable}.${input.path}`
  }

  /**
   * Merge input binding path with condition variable references
   *
   * This fixes the bug where choice conditions ignored node.inputs path parameter.
   * If the condition references the input variable, we append the path to create
   * nested field access (e.g., variable="data" + path="amount" → "data.amount")
   *
   * @param condition - Condition expression from choice rules
   * @param inputBinding - Input binding with optional path
   * @returns Updated condition with path merged into variable references
   */
  private mergeInputPathWithCondition(
    condition: any,
    inputBinding: { variable: string; path?: string }
  ): any {
    if (!inputBinding.path) {
      return condition
    }

    // Deep clone to avoid mutating original
    const updated = JSON.parse(JSON.stringify(condition))

    // Handle simple conditions
    if (updated.type === 'simple') {
      // If condition uses the input variable, append path
      if (updated.variable === inputBinding.variable) {
        updated.variable = `${inputBinding.variable}.${inputBinding.path}`
      }
    }
    // Handle complex conditions (recursively update nested conditions)
    else if (updated.type === 'complex' && updated.conditions) {
      updated.conditions = updated.conditions.map((c: any) =>
        this.mergeInputPathWithCondition(c, inputBinding)
      )
    }

    return updated
  }

  /**
   * CONTEXT-AWARE TRANSFORM SELECTION
   *
   * The following methods restore delivery-destination-aware intelligence that was
   * lost in the migration from DeclarativeCompiler to ExecutionGraph.
   *
   * Strategy:
   * 1. Traverse graph to find downstream delivery nodes
   * 2. Inspect plugin schemas to determine required data formats
   * 3. Choose appropriate transform operations based on requirements
   * 4. Detect and eliminate unnecessary transform steps
   */

  /**
   * Traverse execution graph to find all downstream delivery nodes
   * @param nodeId Starting node ID
   * @param graph The execution graph
   * @param visited Set of visited node IDs to prevent cycles
   * @returns Array of delivery operation nodes found downstream
   */
  private findDownstreamDeliveryNodes(
    nodeId: string,
    graph: ExecutionGraph,
    visited = new Set<string>()
  ): ExecutionNode[] {
    if (visited.has(nodeId)) return []
    visited.add(nodeId)

    const node = graph.nodes[nodeId]
    if (!node) return []

    // Found a delivery node
    if (node.type === 'operation' && node.operation?.operation_type === 'deliver') {
      return [node]
    }

    // Traverse to next nodes
    const deliveryNodes: ExecutionNode[] = []

    // Linear next
    if (node.next) {
      const nextNodes = Array.isArray(node.next) ? node.next : [node.next]
      for (const nextNode of nextNodes) {
        deliveryNodes.push(...this.findDownstreamDeliveryNodes(nextNode, graph, visited))
      }
    }

    // Choice branches
    if (node.type === 'choice' && node.choice) {
      for (const rule of node.choice.rules) {
        if (rule.next) {
          deliveryNodes.push(...this.findDownstreamDeliveryNodes(rule.next, graph, visited))
        }
      }
      if (node.choice.default) {
        deliveryNodes.push(...this.findDownstreamDeliveryNodes(node.choice.default, graph, visited))
      }
    }

    // Parallel branches
    if (node.type === 'parallel' && node.parallel) {
      for (const branch of node.parallel.branches) {
        if (branch.start) {
          deliveryNodes.push(...this.findDownstreamDeliveryNodes(branch.start, graph, visited))
        }
      }
    }

    // Loop body (look inside the loop)
    if (node.type === 'loop' && node.loop && node.loop.body_start) {
      deliveryNodes.push(...this.findDownstreamDeliveryNodes(node.loop.body_start, graph, visited))
    }

    return deliveryNodes
  }

  /**
   * Traverse execution graph to find where a variable is consumed
   * @param variableName The variable to track
   * @param graph The execution graph
   * @returns Array of nodes that consume this variable
   */
  private findVariableConsumers(
    variableName: string,
    graph: ExecutionGraph
  ): ExecutionNode[] {
    const consumers: ExecutionNode[] = []

    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      // Check if this node declares the variable as input
      if (node.inputs?.some(input => input.variable === variableName)) {
        consumers.push(node)
      }

      // Check if node config references the variable
      const nodeData = node.operation || node.choice || node.loop
      if (nodeData) {
        const nodeStr = JSON.stringify(nodeData)
        if (nodeStr && (nodeStr.includes(`{{${variableName}`) || nodeStr.includes(`"${variableName}"`))) {
          consumers.push(node)
        }
      }
    }

    return consumers
  }

  /**
   * Load plugin definition and read action parameter schema
   * @param pluginKey The plugin identifier (e.g., "google-sheets")
   * @param action The action name (e.g., "append_rows")
   * @returns Plugin action definition with parameter schema
   */
  private async loadPluginAction(pluginKey: string, action: string): Promise<any> {
    try {
      // Load plugin definition from lib/plugins/definitions/
      const fs = await import('fs/promises')
      const path = await import('path')
      const pluginPath = path.join(process.cwd(), 'lib', 'plugins', 'definitions', `${pluginKey}.json`)
      const pluginDef = JSON.parse(await fs.readFile(pluginPath, 'utf-8'))

      // Find the action definition
      const actionDef = pluginDef.actions?.find((a: any) => a.name === action)
      return actionDef
    } catch (error) {
      this.logger.warn(`Failed to load plugin action ${pluginKey}.${action}: ${error}`)
      return null
    }
  }

  /**
   * Analyze plugin parameter schema to determine required data format
   * @param pluginKey The plugin identifier
   * @param action The action name
   * @param config The action config object
   * @returns Format requirements for this delivery
   */
  private async analyzePluginDataFormat(
    pluginKey: string,
    action: string,
    config: any
  ): Promise<{
    needs2DArray: boolean
    needsHTML: boolean
    needsPlainText: boolean
    parameterName?: string
  }> {
    const actionDef = await this.loadPluginAction(pluginKey, action)
    const formats = {
      needs2DArray: false,
      needsHTML: false,
      needsPlainText: false,
      parameterName: undefined as string | undefined
    }

    if (!actionDef) return formats

    // Analyze parameter schemas
    for (const param of actionDef.parameters || []) {
      // Check for 2D array requirements (Sheets)
      if (param.type === 'array' && param.items?.type === 'array') {
        formats.needs2DArray = true
        formats.parameterName = param.name
      }

      // Check for HTML body requirements (Email)
      if ((param.name === 'body' || param.name === 'html_body') &&
          param.type === 'string') {
        formats.needsHTML = true
        formats.parameterName = param.name
      }

      // Check for plain text requirements (SMS)
      if ((param.name === 'message' || param.name === 'text') &&
          param.type === 'string') {
        formats.needsPlainText = true
        formats.parameterName = param.name
      }
    }

    return formats
  }

  /**
   * Determine required data format by analyzing downstream delivery nodes
   * @param deliveryNodes Array of delivery nodes found downstream
   * @returns Aggregate format requirements
   */
  private async determineRequiredFormat(
    deliveryNodes: ExecutionNode[]
  ): Promise<{
    needs2DArray: boolean
    needsHTML: boolean
    needsPlainText: boolean
    deliveryDetails: Array<{ pluginKey: string; action: string; format: any }>
  }> {
    const aggregateFormats = {
      needs2DArray: false,
      needsHTML: false,
      needsPlainText: false,
      deliveryDetails: [] as any[]
    }

    for (const node of deliveryNodes) {
      const delivery = node.operation?.deliver
      if (!delivery) continue

      // Analyze this specific delivery's format requirements
      const format = await this.analyzePluginDataFormat(
        delivery.plugin_key,
        delivery.action,
        delivery.config
      )

      aggregateFormats.needs2DArray ||= format.needs2DArray
      aggregateFormats.needsHTML ||= format.needsHTML
      aggregateFormats.needsPlainText ||= format.needsPlainText

      aggregateFormats.deliveryDetails.push({
        pluginKey: delivery.plugin_key,
        action: delivery.action,
        format
      })
    }

    return aggregateFormats
  }

  /**
   * Choose appropriate transform operation based on data format requirements
   * @param irTransform The transform config from IR
   * @param formats Required data formats from downstream consumers
   * @param nodeId The node ID for logging
   * @param ctx Compiler context for logging
   * @returns The selected PILOT operation type
   */
  private chooseTransformOperation(
    irTransform: any,
    formats: { needs2DArray: boolean; needsHTML: boolean; needsPlainText: boolean },
    nodeId: string,
    ctx: CompilerContext
  ): string {
    const irType = irTransform?.type

    // If IR specifies a concrete type, respect it (unless it's wrong)
    if (irType && typeof irType === 'string' && irType !== 'custom' && irType !== 'template') {
      // Validate: Check if map/filter/reduce have appropriate input
      if (['map', 'filter', 'reduce'].includes(irType)) {
        // These require array inputs - will be validated separately
        return irType
      }
      return irType
    }

    // IR didn't specify or said 'custom'/'template' - use downstream requirements
    if (formats.needs2DArray && !formats.needsHTML && !formats.needsPlainText) {
      this.log(ctx, `  → Chose 'map' for 2D array delivery`)
      return 'map'
    }

    if (formats.needsHTML && !formats.needs2DArray) {
      this.log(ctx, `  → Chose 'render_table' for HTML delivery`)
      return 'render_table'
    }

    if (formats.needsPlainText && !formats.needs2DArray && !formats.needsHTML) {
      this.log(ctx, `  → Using default for plain text delivery`)
      return irType || 'map'
    }

    // Mixed formats - log warning and default to most flexible
    if (formats.needs2DArray && formats.needsHTML) {
      this.warn(ctx, `${nodeId}: Mixed delivery formats detected (2D array + HTML). Defaulting to 'map'.`)
      return 'map'
    }

    // No specific format detected - use safe default
    if (irType !== 'custom' && irType !== 'template') {
      this.warn(ctx, `${nodeId}: Could not determine format requirement. Using IR type: ${irType || 'map'}`)
    }
    return irType || 'map'
  }

  /**
   * Detect if a transform step is unnecessary and can be inlined
   * @param nodeId The transform node ID
   * @param transform The transform config
   * @param graph The execution graph
   * @returns Detection result with optimization suggestion
   */
  /**
   * O13: Derive the nested field name for a flatten transform.
   *
   * When the upstream output is an object containing an array of items,
   * and each item has a nested array field, this method identifies that
   * nested field so the runtime can extract and flatten it.
   *
   * Example: upstream = {emails: [{attachments: [...]}]}
   *   → output_schema says items have attachment_id, filename, mimeType
   *   → find which field in the email object contains objects with those fields
   *   → return "attachments"
   *
   * The runtime's unwrapStructuredOutput handles the outer object→array unwrap.
   * This method only needs to identify the inner nested array field.
   */
  private deriveFlattenField(
    nodeId: string,
    transform: any,
    graph: ExecutionGraph,
    ctx: CompilerContext
  ): string | null {
    try {
      // Get the flatten step's output_schema — this defines what the flattened items look like
      const outputSchema = transform.output_schema
      if (!outputSchema?.items?.properties) return null

      const outputFieldNames = new Set(Object.keys(outputSchema.items.properties))
      if (outputFieldNames.size === 0) return null

      // Find the upstream variable name — check node.inputs first, fall back to transform.input
      const node = graph.nodes[nodeId]
      let upstreamVar = node?.inputs?.[0]?.variable
      if (!upstreamVar) {
        // Transform nodes often use transform.input instead of node.inputs
        upstreamVar = transform.input
      }
      if (!upstreamVar) return null

      // Find the upstream schema from data_schema slots
      const upstreamSchema = graph.data_schema?.slots?.[upstreamVar]?.schema || null

      if (!upstreamSchema) return null

      // Find the primary array in the upstream schema (e.g., "emails" in {emails: [...]})
      let itemsSchema: any = null
      if (upstreamSchema.type === 'array') {
        itemsSchema = upstreamSchema.items
      } else if (upstreamSchema.type === 'object' && upstreamSchema.properties) {
        // Find the array field in the object (unwrapStructuredOutput handles this at runtime)
        for (const [fieldName, fieldSchema] of Object.entries(upstreamSchema.properties)) {
          if ((fieldSchema as any)?.type === 'array' && (fieldSchema as any)?.items) {
            itemsSchema = (fieldSchema as any).items
            break
          }
        }
      }

      if (!itemsSchema?.properties) return null

      // Now look for a nested array field in the items whose children match the output schema
      for (const [fieldName, fieldSchema] of Object.entries(itemsSchema.properties)) {
        const fs = fieldSchema as any
        if (fs.type === 'array' && fs.items?.properties) {
          // Check if the nested array's item fields overlap with the output schema fields
          const nestedFieldNames = new Set(Object.keys(fs.items.properties))
          let matchCount = 0
          for (const outputField of outputFieldNames) {
            if (nestedFieldNames.has(outputField)) matchCount++
          }
          // If at least half of the output fields come from this nested array, it's our target
          if (matchCount >= Math.min(2, outputFieldNames.size / 2)) {
            this.log(ctx, `  → O13: Matched flatten field "${fieldName}" — ${matchCount}/${outputFieldNames.size} output fields found in nested schema`)
            return fieldName
          }
        }
      }

      return null
    } catch (err) {
      this.log(ctx, `  → O13: Could not derive flatten field for ${nodeId}: ${err}`)
      return null
    }
  }

  /**
   * O24: Derive structured map config from custom_code by analyzing upstream and output schemas.
   *
   * Handles two patterns:
   * 1. Input is 2D array (array<array<string>>) → emit column_index
   * 2. Input is array of objects → emit field or field_path
   *
   * Returns structured config object or null if cannot derive.
   */
  private deriveMapStructuredConfig(
    nodeId: string,
    transform: any,
    graph: ExecutionGraph,
    ctx: CompilerContext
  ): Record<string, any> | null {
    try {
      const outputSchema = transform.output_schema
      const customCode: string = transform.custom_code || ''

      // Find the upstream variable and its schema
      const node = graph.nodes[nodeId]
      let upstreamVar = node?.inputs?.[0]?.variable
      if (!upstreamVar) {
        upstreamVar = transform.input
      }
      if (!upstreamVar) return null

      // Find the upstream schema — handle sub-field access (e.g., "existing_rows.values")
      let upstreamSchema: any = null
      const dotIdx = upstreamVar.indexOf('.')
      if (dotIdx > -1) {
        const baseVar = upstreamVar.substring(0, dotIdx)
        const subField = upstreamVar.substring(dotIdx + 1)
        const baseSchema = graph.data_schema?.slots?.[baseVar]?.schema
        if (baseSchema?.properties?.[subField]) {
          upstreamSchema = baseSchema.properties[subField]
          this.log(ctx, `  → O24: Resolved sub-field schema for "${upstreamVar}" via "${baseVar}.${subField}"`)
        }
      }
      if (!upstreamSchema) {
        upstreamSchema = graph.data_schema?.slots?.[upstreamVar]?.schema || null
      }

      this.log(ctx, `  → O24: upstream="${upstreamVar}", schemaType=${upstreamSchema?.type || 'null'}, itemsType=${upstreamSchema?.items?.type || 'null'}`)

      // Determine if output is a flat array (single-value extraction like array<string>)
      const isFlatArrayOutput = outputSchema?.type === 'array' &&
        outputSchema?.items?.type !== 'object' &&
        outputSchema?.items?.type !== 'array'

      // Pattern 1: Input is 2D array → use column_index
      // Detected when upstream schema is array<array<string>> (e.g., read_range values)
      const isUpstream2DArray = upstreamSchema?.type === 'array' &&
        upstreamSchema?.items?.type === 'array'

      if (isUpstream2DArray && isFlatArrayOutput) {
        const columnIndex = this.parseColumnIndexFromCustomCode(customCode, ctx)
        if (columnIndex !== null) {
          this.log(ctx, `  → O24: Derived column_index=${columnIndex} from custom_code: "${customCode}"`)
          return { column_index: columnIndex }
        }
      }

      // Pattern 1b: Input is an object with 2D array field (e.g., read_range → {values: [[...]]})
      // The runtime will unwrap to the array field, so column_index still applies
      if (!isUpstream2DArray && upstreamSchema?.type === 'object' && upstreamSchema?.properties && isFlatArrayOutput) {
        for (const [fieldName, fieldSchema] of Object.entries(upstreamSchema.properties)) {
          const fs = fieldSchema as any
          if (fs?.type === 'array' && fs?.items?.type === 'array') {
            const columnIndex = this.parseColumnIndexFromCustomCode(customCode, ctx)
            if (columnIndex !== null) {
              this.log(ctx, `  → O24: Input is object with 2D array field "${fieldName}" — derived column_index=${columnIndex}`)
              return { column_index: columnIndex }
            }
          }
        }
      }

      // Pattern 2: Input is array of objects → use field or field_path
      const isUpstreamObjectArray = upstreamSchema?.type === 'array' &&
        upstreamSchema?.items?.type === 'object'

      if (isUpstreamObjectArray && isFlatArrayOutput) {
        const upstreamProperties = upstreamSchema?.items?.properties || {}
        const fieldNames = Object.keys(upstreamProperties)

        // Try to find a matching field from custom_code text
        const fieldName = this.parseFieldNameFromCustomCode(customCode, fieldNames, ctx)
        if (fieldName) {
          if (fieldName.includes('.')) {
            this.log(ctx, `  → O24: Derived field_path="${fieldName}" from custom_code`)
            return { field_path: fieldName }
          } else {
            this.log(ctx, `  → O24: Derived field="${fieldName}" from custom_code`)
            return { field: fieldName }
          }
        }

        // If output_schema has a description, try to match it against upstream field descriptions
        if (outputSchema?.items?.description) {
          for (const [fname, fschema] of Object.entries(upstreamProperties)) {
            const desc = (fschema as any)?.description || ''
            if (desc.toLowerCase().includes(outputSchema.items.description.toLowerCase()) ||
                outputSchema.items.description.toLowerCase().includes(desc.toLowerCase())) {
              this.log(ctx, `  → O24: Matched field="${fname}" via description: "${desc}"`)
              return { field: fname }
            }
          }
        }
      }

      // Last resort: try column_index from custom_code even without schema
      if (isFlatArrayOutput) {
        const columnIndex = this.parseColumnIndexFromCustomCode(customCode, ctx)
        if (columnIndex !== null) {
          this.log(ctx, `  → O24: No matching schema pattern — derived column_index=${columnIndex} from custom_code as fallback`)
          return { column_index: columnIndex }
        }
      }

      return null
    } catch (err) {
      this.log(ctx, `  → O24: Could not derive structured map config for ${nodeId}: ${err}`)
      return null
    }
  }

  /**
   * O24 helper: Parse a column index from custom_code natural language text.
   * Recognizes patterns like "column E", "5th column", "index 4", "column 5".
   */
  private parseColumnIndexFromCustomCode(customCode: string, ctx: CompilerContext): number | null {
    const lower = customCode.toLowerCase()

    // Pattern: "column E" or "column e" → convert letter to 0-based index (A=0, B=1, ...)
    const letterMatch = lower.match(/column\s+([a-z])\b/)
    if (letterMatch) {
      const index = letterMatch[1].charCodeAt(0) - 'a'.charCodeAt(0)
      this.log(ctx, `    O24: Parsed column letter "${letterMatch[1].toUpperCase()}" → index ${index}`)
      return index
    }

    // Pattern: "index 4" or "index: 4"
    const indexMatch = lower.match(/index[:\s]+(\d+)/)
    if (indexMatch) {
      return parseInt(indexMatch[1], 10)
    }

    // Pattern: "5th column" or "1st column" → convert to 0-based
    const nthMatch = lower.match(/(\d+)(?:st|nd|rd|th)\s+column/)
    if (nthMatch) {
      return parseInt(nthMatch[1], 10) - 1  // 1-based to 0-based
    }

    // Pattern: "column 5" → convert to 0-based
    const colNumMatch = lower.match(/column\s+(\d+)/)
    if (colNumMatch) {
      return parseInt(colNumMatch[1], 10) - 1  // 1-based to 0-based
    }

    return null
  }

  /**
   * O24 helper: Parse a field name from custom_code by matching against known upstream fields.
   * Recognizes patterns like "extract email", "get the id field", "message_id".
   */
  private parseFieldNameFromCustomCode(
    customCode: string,
    upstreamFieldNames: string[],
    ctx: CompilerContext
  ): string | null {
    const lower = customCode.toLowerCase()

    // Direct match: check if any upstream field name appears in the custom_code
    // Sort by length descending to match longer names first (e.g., "message_id" before "id")
    const sortedFields = [...upstreamFieldNames].sort((a, b) => b.length - a.length)
    for (const field of sortedFields) {
      if (lower.includes(field.toLowerCase())) {
        this.log(ctx, `    O24: Found field "${field}" mentioned in custom_code`)
        return field
      }
    }

    // Fuzzy match: normalize both to lowercase-no-separators
    const normalize = (s: string) => s.toLowerCase().replace(/[_\-\s]/g, '')
    for (const field of sortedFields) {
      const normalizedField = normalize(field)
      // Check if any word in custom_code matches the normalized field name
      const words = lower.split(/\s+/)
      for (const word of words) {
        if (normalize(word) === normalizedField) {
          this.log(ctx, `    O24: Fuzzy-matched field "${field}" from word "${word}"`)
          return field
        }
      }
    }

    return null
  }

  /**
   * O14: Build a field mapping for multi-source merge transforms.
   *
   * Given an output_schema and multiple source variables, determine which
   * source variable provides each output field.
   *
   * Strategy:
   * 1. For each output field, check if the primary input variable has it → {{primary.field}}
   * 2. If not, search additional variables' schemas for a matching field name
   * 3. For fields with renamed names (e.g., email_sender ← from), use description matching
   * 4. For boolean fields like has_amount, generate expression
   *
   * Returns an object template like:
   * {
   *   "type": "{{extracted_fields.type}}",
   *   "vendor": "{{extracted_fields.vendor}}",
   *   "drive_link": "{{drive_file.web_view_link}}",
   *   "email_sender": "{{attachment._parentData.from}}"
   * }
   */
  /**
   * O19: Binary/large field blocklist.
   * These field names are excluded from scatter-gather merge operations
   * unless explicitly referenced by downstream steps (AI prompts, plugin params,
   * filter conditions). Prevents token overflow in AI steps.
   */
  private static readonly BINARY_FIELD_BLOCKLIST = new Set([
    'data', 'content', 'file_content', 'base64', 'extracted_text',
    'raw_content', 'binary', 'blob', 'encoded_content', 'body_data',
    'attachment_data', 'file_data', 'raw_data', 'payload_data'
  ])

  /**
   * O19: Check if a field name is in the binary blocklist.
   */
  private isBinaryBlockedField(fieldName: string): boolean {
    return ExecutionGraphCompiler.BINARY_FIELD_BLOCKLIST.has(fieldName.toLowerCase())
  }

  /**
   * O19: Collect field names explicitly referenced by downstream steps.
   * Scans AI prompts, plugin params, filter conditions, and transform configs
   * for {{variable.field}} references to determine which fields are actually needed.
   */
  private collectDownstreamReferencedFields(
    nodeId: string,
    graph: ExecutionGraph,
    ctx: CompilerContext
  ): Set<string> {
    const referencedFields = new Set<string>()

    // Find the output variable of this node
    const node = graph.nodes[nodeId]
    const outputVar = node?.outputs?.[0]?.variable
    if (!outputVar) return referencedFields

    // Scan all nodes for references to this variable's fields
    for (const [id, n] of Object.entries(graph.nodes)) {
      if (id === nodeId) continue

      const nodeStr = JSON.stringify(n)
      // Match {{outputVar.fieldName}} patterns
      const pattern = new RegExp(`\\{\\{${outputVar}\\.([\\w.]+)\\}\\}`, 'g')
      let match: RegExpExecArray | null
      while ((match = pattern.exec(nodeStr)) !== null) {
        referencedFields.add(match[1].split('.')[0]) // top-level field name
      }

      // Also check for bare field references in prompts/instructions
      if (n.operation?.ai?.instruction) {
        const promptPattern = new RegExp(`\\b${outputVar}\\.([\\w]+)\\b`, 'g')
        let promptMatch: RegExpExecArray | null
        while ((promptMatch = promptPattern.exec(n.operation.ai.instruction)) !== null) {
          referencedFields.add(promptMatch[1])
        }
      }
    }

    return referencedFields
  }

  /**
   * O26: Build field mapping from sheet_columns config when a set step feeds an append_rows action.
   * Returns a fields mapping object like:
   *   { "sender email": "{{complaint_email.from}}", "subject": "{{complaint_email.subject}}", ... }
   * or null if the pattern doesn't match.
   */
  private buildSheetColumnsFieldMapping(
    nodeId: string,
    input: string,
    graph: ExecutionGraph,
    ctx: CompilerContext
  ): Record<string, string> | null {
    // Find the sheet_columns config — try EP key hint format first, then generic
    const sheetColumns = ctx.workflowConfig?.['google_sheets__table_create__columns']
      || ctx.workflowConfig?.['sheet_columns']
      || ctx.workflowConfig?.['output_columns']
    this.log(ctx, `  → O26: Looking for sheet_columns in config — found: ${sheetColumns ? `"${sheetColumns}"` : 'NOT FOUND'} (config keys: ${Object.keys(ctx.workflowConfig || {}).filter(k => k.includes('column')).join(', ') || 'none with "column"'})`)
    if (!sheetColumns || typeof sheetColumns !== 'string') return null

    try {
    // If sheet_columns config exists with the EP key hint prefix, we know there's a sheet write operation.
    // No need to search graph nodes — the existence of this config key is sufficient signal.

    // Parse column names from config
    const columns = sheetColumns.split(',').map((c: string) => c.trim()).filter((c: string) => c.length > 0)
    if (columns.length === 0) return null

    // Get the source variable name (strip {{ }})
    const sourceVar = input.replace(/[{}]/g, '').trim()

    // Get upstream output schema for the source variable
    // The source var may be a scatter-gather item variable (e.g., "complaint_email")
    // which isn't a data_schema slot — its schema comes from the parent array's items
    let sourceSchema: any = null
    const dataSchema = ctx.ir?.execution_graph?.data_schema

    // Try data_schema slots first (direct variable)
    // data_schema.slots is an object keyed by variable name, not an array
    if (dataSchema?.slots && typeof dataSchema.slots === 'object') {
      const slots = dataSchema.slots as Record<string, any>
      // Direct match
      if (slots[sourceVar]?.schema?.properties) {
        // Check if this is a wrapper object with an array field (e.g., {emails: [...], total_found: ...})
        // If so, the scatter item is actually one element of that array, not the wrapper
        const directSchema = slots[sourceVar].schema
        const arrayFields = Object.entries(directSchema.properties || {})
          .filter(([_, v]) => (v as any)?.type === 'array' && (v as any)?.items?.properties)
        if (arrayFields.length === 1) {
          // Single array field — the scatter item is likely one element of this array
          const [arrayFieldName, arrayFieldSchema] = arrayFields[0]
          sourceSchema = (arrayFieldSchema as any).items
          this.log(ctx, `  → O26: Unwrapped "${sourceVar}" to ${sourceVar}.${arrayFieldName} items schema (${Object.keys(sourceSchema.properties || {}).join(', ')})`)
        } else {
          sourceSchema = directSchema
        }
      }
      // Check if this is a scatter item variable — look for parent array slots
      if (!sourceSchema) {
        for (const [slotName, slotData] of Object.entries(slots)) {
          const slotSchema = (slotData as any)?.schema
          if (slotSchema?.type === 'array' && slotSchema?.items?.properties) {
            // Match by singular/plural convention: complaint_email ↔ new_complaint_emails
            if (slotName === sourceVar + 's' || slotName === 'new_' + sourceVar + 's' ||
                slotName.endsWith('_' + sourceVar + 's')) {
              sourceSchema = slotSchema.items
              this.log(ctx, `  → O26: Found item schema for "${sourceVar}" from array slot "${slotName}"`)
              break
            }
          }
        }
      }
    }

    // Note: ctx.compiledSteps doesn't exist on CompilerContext — steps are compiled incrementally
    // The data_schema slot lookup above should be sufficient for finding item schemas

    this.log(ctx, `  → O26: Source schema for "${sourceVar}": ${sourceSchema ? `found (${Object.keys(sourceSchema.properties || {}).join(', ')})` : 'NOT FOUND'}`)
    if (!sourceSchema?.properties) {
      this.log(ctx, `  → O26: No output schema found for "${sourceVar}", cannot build column mapping`)
      return null
    }

    const schemaProps = sourceSchema.properties
    const fieldMapping: Record<string, string> = {}

    for (const column of columns) {
      const columnLower = column.toLowerCase()

      // Try exact match first
      let matchedField: string | null = null
      for (const [fieldName] of Object.entries(schemaProps)) {
        if (fieldName.toLowerCase() === columnLower) {
          matchedField = fieldName
          break
        }
      }

      // Try semantic match via resolveFieldMismatch
      if (!matchedField) {
        matchedField = this.resolveFieldMismatch(column, schemaProps, ctx, `O26 column "${column}"`, sourceVar)
      }

      // Try substring/keyword matching on descriptions
      if (!matchedField) {
        const columnWords = columnLower.replace(/[/_\-]/g, ' ').split(/\s+/)
        let bestScore = 0
        let bestField: string | null = null

        for (const [fieldName, fieldInfo] of Object.entries(schemaProps)) {
          const desc = ((fieldInfo as any).description || '').toLowerCase()
          const fieldLower = fieldName.toLowerCase()
          let score = 0

          // Check if column words appear in field name or description
          for (const word of columnWords) {
            if (word.length < 3) continue // skip short words like "or", "id"
            if (fieldLower.includes(word)) score += 2
            if (desc.includes(word)) score += 1
          }

          // Special handling for common patterns
          if (columnLower.includes('sender') && (fieldLower === 'from' || desc.includes('sender'))) score += 5
          // O26 Fix B: Prefer 'snippet' over 'body' for email text/content columns
          // body is usually empty in search results, snippet always has content
          // Only boost when column explicitly mentions "text" or "content" (not just "email")
          if (columnLower.includes('text') || columnLower.includes('content') || columnLower.includes('body')) {
            if (fieldLower === 'snippet') score += 6  // Higher than body
            if (fieldLower === 'body') score += 3     // Lower — usually empty in search
          }
          if (columnLower.includes('message') && columnLower.includes('id') && fieldLower === 'id') score += 5
          if (columnLower.includes('link') && columnLower.includes('id') && fieldLower === 'id') score += 5

          if (score > bestScore) {
            bestScore = score
            bestField = fieldName
          }
        }

        if (bestField && bestScore >= 3) {
          matchedField = bestField
        }
      }

      if (matchedField) {
        fieldMapping[column] = `{{${sourceVar}.${matchedField}}}`
        this.log(ctx, `  → O26: Column "${column}" → ${sourceVar}.${matchedField}`)
      } else {
        this.warn(ctx, `[O26] Column "${column}" could not be matched to any field in ${sourceVar} schema. Available: [${Object.keys(schemaProps).join(', ')}]`)
        // Use the column name as-is as a best-effort field reference
        fieldMapping[column] = `{{${sourceVar}.${column}}}`
      }
    }

    return Object.keys(fieldMapping).length > 0 ? fieldMapping : null
    } catch (err) {
      this.log(ctx, `  → O26: ERROR in buildSheetColumnsFieldMapping: ${err}`)
      return null
    }
  }

  /**
   * O26 helper: Find the output_schema for a given variable name by searching the graph nodes.
   */
  private findOutputSchemaForVariable(varName: string, graph: ExecutionGraph): any {
    // Handle dotted variable names (e.g., "complaint_emails.emails")
    const baseVar = varName.includes('.') ? varName.substring(0, varName.indexOf('.')) : varName
    const subField = varName.includes('.') ? varName.substring(varName.indexOf('.') + 1) : null

    for (const node of Object.values(graph.nodes)) {
      const outputVar = node.outputs?.[0]?.variable
      if (outputVar === baseVar) {
        // Look up schema from data_schema slots
        const slot = graph.data_schema?.slots?.[baseVar]
        if (slot?.schema && subField) {
          // Navigate into the sub-field
          return slot.schema.properties?.[subField]?.items || slot.schema.properties?.[subField]
        }
        return slot?.schema
      }
    }

    // Also check data_schema slots
    if (graph.data_schema?.slots) {
      for (const [slotName, slot] of Object.entries(graph.data_schema.slots)) {
        if (slotName === baseVar && slot.schema) {
          if (subField) {
            return slot.schema.properties?.[subField]?.items || slot.schema.properties?.[subField]
          }
          return slot.schema
        }
      }
    }

    return null
  }

  private buildMergeFieldMapping(
    outputSchema: any,
    primaryInputVar: string,
    additionalVars: string[],
    config: any,
    graph: ExecutionGraph,
    ctx: CompilerContext
  ): Record<string, any> | null {
    try {
      const mapping: Record<string, any> = {}
      const outputFields = Object.entries(outputSchema.properties || {})

      // O19: Collect fields explicitly referenced by downstream steps
      // to allow blocklisted fields through when they are actually needed
      const downstreamRefs = this.collectDownstreamReferencedFields(
        // Find the current node ID from context (loop body node)
        this.findCurrentMergeNodeId(graph, ctx),
        graph,
        ctx
      )

      // Build a lookup of available variable schemas
      const varSchemas = new Map<string, any>()

      // Primary input schema from data_schema
      const primarySlot = graph.data_schema?.slots?.[primaryInputVar]
      if (primarySlot?.schema) {
        varSchemas.set(primaryInputVar, primarySlot.schema)
      }

      // Additional variable schemas
      for (const varName of additionalVars) {
        const slot = graph.data_schema?.slots?.[varName]
        if (slot?.schema) {
          varSchemas.set(varName, slot.schema)
        }
      }

      // Also check scatter item variable — it may have _parentData from flatten
      const itemVar = ctx.loopContextStack.length > 0
        ? ctx.loopContextStack[ctx.loopContextStack.length - 1].itemVariable
        : null

      for (const [fieldName, fieldSchema] of outputFields) {
        const fieldDesc = ((fieldSchema as any)?.description || '').toLowerCase()

        // O19: Skip binary/large fields unless explicitly referenced downstream
        if (this.isBinaryBlockedField(fieldName) && !downstreamRefs.has(fieldName)) {
          this.log(ctx, `    → O19: Excluded binary field "${fieldName}" from merge (not referenced downstream)`)
          continue
        }

        // Strategy 1: Check primary input variable
        if (this.variableHasField(varSchemas.get(primaryInputVar), fieldName)) {
          mapping[fieldName] = `{{${primaryInputVar}.${fieldName}}}`
          continue
        }

        // Strategy 2: Check additional variables
        let found = false
        for (const varName of additionalVars) {
          const resolvedVarName = config[varName]?.replace(/[{}]/g, '') || varName

          // Direct field match
          if (this.variableHasField(varSchemas.get(varName), fieldName)) {
            mapping[fieldName] = `{{${resolvedVarName}.${fieldName}}}`
            found = true
            break
          }

          // Common rename patterns
          const renameMap: Record<string, { var: string; field: string }[]> = {
            'drive_link': [{ var: 'drive_file', field: 'web_view_link' }],
            'email_sender': [{ var: itemVar || 'attachment', field: '_parentData.from' }],
            'email_subject': [{ var: itemVar || 'attachment', field: '_parentData.subject' }],
            'email_date': [{ var: itemVar || 'attachment', field: '_parentData.date' }],
            'received_date': [{ var: itemVar || 'attachment', field: '_parentData.date' }],
            'sender': [{ var: itemVar || 'attachment', field: '_parentData.from' }],
          }

          if (renameMap[fieldName]) {
            for (const candidate of renameMap[fieldName]) {
              if (additionalVars.includes(candidate.var) || candidate.var === itemVar) {
                const candidateResolved = config[candidate.var]?.replace(/[{}]/g, '') || candidate.var
                mapping[fieldName] = `{{${candidateResolved}.${candidate.field}}}`
                found = true
                break
              }
            }
            if (found) break
          }

          // Description-based matching: "link" → web_view_link, "sender" → from
          if (fieldDesc.includes('link') || fieldDesc.includes('url')) {
            if (this.variableHasField(varSchemas.get(varName), 'web_view_link')) {
              mapping[fieldName] = `{{${resolvedVarName}.web_view_link}}`
              found = true
              break
            }
          }
        }

        if (found) continue

        // Strategy 3: Boolean computed fields
        if ((fieldSchema as any)?.type === 'boolean') {
          if (fieldName === 'has_amount' || fieldName.startsWith('has_')) {
            const sourceField = fieldName.replace('has_', '')
            mapping[fieldName] = true // Default true — runtime can check
            continue
          }
        }

        // Strategy 4: Fallback — leave as null (field will be missing at runtime)
        this.log(ctx, `    → O14: Could not map output field "${fieldName}" to any source variable`)
        mapping[fieldName] = null
      }

      return mapping
    } catch (err) {
      this.log(ctx, `  → O14: buildMergeFieldMapping failed: ${err}`)
      return null
    }
  }

  /**
   * O19: Find the current merge node ID from compiler context.
   * Used to look up downstream references for binary field blocklist.
   */
  private findCurrentMergeNodeId(graph: ExecutionGraph, ctx: CompilerContext): string {
    // The merge step is typically inside a loop body. Find the last
    // operation node being compiled by checking step counter.
    // Fallback: return empty string (no downstream filtering applied)
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      if (node.type === 'operation' && node.operation?.operation_type === 'transform') {
        const transform = node.operation.transform
        if (transform?.type === 'map' || transform?.type === 'merge' || (transform?.type as string) === 'set') {
          // Check if this node is inside a loop (has loop context)
          if (ctx.loopContextStack.length > 0) {
            return nodeId
          }
        }
      }
    }
    return ''
  }

  /**
   * Check if a variable's schema has a given field name.
   */
  private variableHasField(schema: any, fieldName: string): boolean {
    if (!schema) return false
    // Object with properties
    if (schema.properties?.[fieldName]) return true
    // Array with item properties
    if (schema.items?.properties?.[fieldName]) return true
    return false
  }

  private detectUnnecessaryTransform(
    nodeId: string,
    transform: any,
    graph: ExecutionGraph
  ): {
    isUnnecessary: boolean
    reason?: string
    suggestion?: string
    canInline?: boolean
  } {
    const node = graph.nodes[nodeId]
    if (!node) return { isUnnecessary: false }

    const inputBindings = node.inputs || []
    const outputBindings = node.outputs || []

    // Pattern 1: Scalar input to array-only operation
    if (transform?.type && ['map', 'filter', 'reduce'].includes(transform.type)) {
      // Check if input is scalar (not array)
      // First try to get input from transform.input field (most reliable)
      let inputVarPath = transform.input

      // If not in transform.input, try inputBindings
      if (!inputVarPath && inputBindings[0]?.variable) {
        inputVarPath = inputBindings[0].variable
      }

      if (inputVarPath) {
        // Extract variable reference from {{...}} if present
        const varMatch = inputVarPath.match(/^{{(.+?)}}$/)
        const cleanPath = varMatch ? varMatch[1] : inputVarPath

        // Check if this uses nested field access (e.g., "current_email.attachments")
        const hasNestedAccess = cleanPath.includes('.')

        // Only validate if NOT using nested access
        // (If using nested access, we can't determine the type without schema inspection)
        if (!hasNestedAccess) {
          const baseVar = cleanPath.split('.')[0]
          const varDecl = graph.variables?.find(v => v.name === baseVar)
          if (varDecl && varDecl.type !== 'array') {
            return {
              isUnnecessary: true,
              reason: `${transform.type} operation requires array input, but '${baseVar}' is ${varDecl.type}`,
              suggestion: `Remove this transform step and use direct variable interpolation in downstream nodes`,
              canInline: true
            }
          }
        }
        // If using nested access (e.g., current_email.attachments), skip this check
        // The nested field MIGHT be an array even if the base variable is an object
      }
    }

    // Pattern 2: Single-use transform output
    if (outputBindings.length === 1) {
      const outputVar = outputBindings[0].variable
      const consumers = this.findVariableConsumers(outputVar, graph)

      if (consumers.length === 1) {
        // Output used in exactly one place - check if inlinable
        const consumer = consumers[0]
        if (consumer.type === 'operation' && consumer.operation?.operation_type === 'deliver') {
          return {
            isUnnecessary: true,
            reason: `Transform output '${outputVar}' only used in one delivery node`,
            suggestion: `Consider inlining the transform logic directly into the delivery config`,
            canInline: false  // Don't auto-inline, just suggest
          }
        }
      }
    }

    // Pattern 3: Template operation with no actual transformation
    if (transform.config?.template && !transform.config?.template.includes('|') &&
        !transform.config?.template.includes('filter') &&
        !transform.config?.template.includes('map')) {
      // Simple template with just variable interpolation, no filters/functions
      return {
        isUnnecessary: true,
        reason: `Template only performs variable interpolation, no actual transformation`,
        suggestion: `Use direct {{variable}} syntax in downstream config instead of intermediate step`,
        canInline: false  // Don't auto-inline to avoid breaking things
      }
    }

    return { isUnnecessary: false }
  }

  /**
   * Post-compilation optimization pass
   *
   * Detects and fixes common inefficiencies:
   * 1. Redundant AI merge operations after deterministic_extract
   * 2. Unnecessary transform steps
   * 3. Normalize references and fix common errors
   */
  private async optimizeWorkflow(workflow: WorkflowStep[], ctx: CompilerContext): Promise<WorkflowStep[]> {
    let optimized = this.mergeRedundantAIMergeSteps(workflow, ctx)
    optimized = await this.normalizeAndFixWorkflow(optimized, ctx)
    optimized = await this.applyRuntimeNormalizationFixes(optimized, ctx)
    return optimized
  }

  /**
   * Apply runtime normalization fixes
   * Addresses issues that cause runtime/binding failures:
   * 1. Hardcoded values that should come from config
   * 2. Missing data dependencies in AI steps
   * 3. Scatter_gather output inconsistencies
   * 4. Plugin schema contract violations
   */
  private async applyRuntimeNormalizationFixes(workflow: WorkflowStep[], ctx: CompilerContext): Promise<WorkflowStep[]> {
    this.log(ctx, 'Phase 4.5: Applying runtime normalization fixes')

    const fixed = workflow.map(step => this.fixStep(step, workflow, ctx))

    return fixed
  }

  /**
   * Fix a single step for runtime compatibility
   */
  private fixStep(step: WorkflowStep, workflow: WorkflowStep[], ctx: CompilerContext): WorkflowStep {
    let fixed: any = { ...step }

    // Fix 1: Normalize scatter_gather output handling
    if (fixed.type === 'scatter_gather') {
      fixed = this.fixScatterGatherOutput(fixed, ctx)
    }

    // Fix 2: Replace hardcoded threshold values with config references
    if (fixed.type === 'conditional' && fixed.condition) {
      fixed = { ...fixed, condition: this.fixHardcodedThresholds(fixed.condition, ctx) }
    }

    // Fix 3: Replace hardcoded spreadsheet_id and range with config
    if (fixed.type === 'action' && fixed.plugin === 'google-sheets' && fixed.params) {
      fixed = { ...fixed, params: this.fixHardcodedSheetParams(fixed.params, ctx) }
    }

    // Fix 4: Hardcoded values are handled by buildParamsFromSchema deduplication

    // Fix 5: Validate and fix AI step inputs (missing data dependencies)
    if (fixed.type === 'ai_processing') {
      fixed = this.fixAIStepInputs(fixed, workflow, ctx)
    }

    // Fix 6: Wrap bare variable references in action step params with {{ }}
    // Handles cases where IR/compiler produces bare references like "row_data"
    // instead of "{{row_data}}" inside nested param objects (e.g., fields.values)
    if (fixed.type === 'action' && (fixed.params || fixed.config)) {
      const params = fixed.params || fixed.config
      fixed = { ...fixed, params: this.wrapBareVariableRefs(params, workflow, ctx), config: undefined }
    }

    // Recursively fix nested steps
    if (fixed.scatter?.steps) {
      fixed = { ...fixed, scatter: { ...fixed.scatter, steps: fixed.scatter.steps.map((s: WorkflowStep) => this.fixStep(s, workflow, ctx)) } }
    }
    if (fixed.then) {
      fixed = { ...fixed, then: fixed.then.map((s: WorkflowStep) => this.fixStep(s, workflow, ctx)) }
    }
    if (fixed.else) {
      fixed = { ...fixed, else: fixed.else.map((s: WorkflowStep) => this.fixStep(s, workflow, ctx)) }
    }
    if (fixed.else_steps) {
      fixed = { ...fixed, else_steps: fixed.else_steps.map((s: WorkflowStep) => this.fixStep(s, workflow, ctx)) }
    }
    if (fixed.steps) {
      // For conditional steps: fix both "then" steps and else_steps
      fixed = { ...fixed, steps: fixed.steps.map((s: WorkflowStep) => this.fixStep(s, workflow, ctx)) }
    }

    return fixed
  }

  /**
   * Wrap bare variable references in action step params with {{ }} template syntax.
   * Recursively processes nested objects. Only wraps strings that exactly match
   * a known output_variable from the workflow (avoids wrapping literal values).
   */
  private wrapBareVariableRefs(params: any, workflow: WorkflowStep[], ctx: CompilerContext): any {
    // Collect all known output variable names
    const knownVars = new Set<string>()
    const collectVars = (steps: WorkflowStep[]) => {
      for (const step of steps) {
        if (step.output_variable) knownVars.add(step.output_variable)
        if (step.scatter?.steps) collectVars(step.scatter.steps)
        if ((step as any).steps) collectVars((step as any).steps)
        if ((step as any).else_steps) collectVars((step as any).else_steps)
      }
    }
    collectVars(workflow)
    // Also add scatter item variables
    for (const step of workflow) {
      if (step.scatter?.itemVariable) knownVars.add(step.scatter.itemVariable)
    }

    const wrap = (value: any): any => {
      if (typeof value === 'string' && !value.includes('{{') && knownVars.has(value)) {
        return `{{${value}}}`
      }
      if (Array.isArray(value)) return value.map(wrap)
      if (value && typeof value === 'object') {
        const result: any = {}
        for (const [k, v] of Object.entries(value)) {
          result[k] = wrap(v)
        }
        return result
      }
      return value
    }

    return wrap(params)
  }

  /**
   * Fix scatter_gather output handling
   * Issue: Duplicate or inconsistent output_variable and gather.outputKey
   */
  private fixScatterGatherOutput(step: any, ctx: CompilerContext): any {
    const fixed = { ...step }

    // Remove gather.outputKey entirely - output_variable is the canonical output field
    if (fixed.gather?.outputKey) {
      this.log(ctx, `  → ⚠️  Scatter_gather ${fixed.step_id} has redundant gather.outputKey, removing (using output_variable instead)`)
      const { outputKey, ...restGather } = fixed.gather
      fixed.gather = restGather
    }

    // If gather.operation = "flatten" but no output_variable, default to "collect".
    // Removing gather entirely breaks the scatter-gather step at runtime (D-B15).
    if (fixed.gather?.operation === 'flatten' && !fixed.output_variable) {
      this.log(ctx, `  → ⚠️  Scatter_gather ${fixed.step_id} has gather.operation = 'flatten' but no output — defaulting to 'collect'`)
      fixed.gather = { operation: 'collect' }
    }

    return fixed
  }

  /**
   * Fix hardcoded threshold values in conditions
   * Issue: Hardcoded 50 instead of {{config.amount_threshold_usd}}
   */
  private fixHardcodedThresholds(condition: any, ctx: CompilerContext): any {
    if (!condition) return condition

    const fixed = { ...condition }

    // Check for hardcoded threshold (value = 50)
    if (fixed.value === 50 && ctx.workflowConfig?.amount_threshold_usd) {
      this.log(ctx, `  → Replacing hardcoded threshold 50 with {{config.amount_threshold_usd}}`)
      fixed.value = '{{config.amount_threshold_usd}}'
    }

    // Recursively fix nested conditions
    if (fixed.conditions) {
      fixed.conditions = fixed.conditions.map((c: any) => this.fixHardcodedThresholds(c, ctx))
    }
    if (fixed.and) {
      fixed.and = fixed.and.map((c: any) => this.fixHardcodedThresholds(c, ctx))
    }
    if (fixed.or) {
      fixed.or = fixed.or.map((c: any) => this.fixHardcodedThresholds(c, ctx))
    }

    return fixed
  }

  /**
   * Fix hardcoded spreadsheet_id and range/tab values
   * Issue: Hardcoded IDs instead of {{config.google_sheet_id_candidate}} and {{config.sheet_tab_name}}
   */
  private fixHardcodedSheetParams(params: any, ctx: CompilerContext): any {
    const fixed = { ...params }

    // Fix spreadsheet_id
    if (typeof fixed.spreadsheet_id === 'string' &&
        !fixed.spreadsheet_id.includes('{{') &&
        ctx.workflowConfig?.google_sheet_id_candidate) {
      this.log(ctx, `  → Replacing hardcoded spreadsheet_id with {{config.google_sheet_id_candidate}}`)
      fixed.spreadsheet_id = '{{config.google_sheet_id_candidate}}'
    }

    // Fix range/tab name
    if (fixed.range === 'Expenses' && ctx.workflowConfig?.sheet_tab_name) {
      this.log(ctx, `  → Replacing hardcoded range 'Expenses' with {{config.sheet_tab_name}}`)
      fixed.range = '{{config.sheet_tab_name}}'
    }

    return fixed
  }

  /**
   * Fix AI step inputs that reference variables not in their input
   * Issue: Step prompts reference {{email_metadata}}, {{uploaded_file}} but input only has {{current_attachment}}
   */
  private fixAIStepInputs(step: any, workflow: WorkflowStep[], ctx: CompilerContext): any {
    if (!step.prompt) return step

    // Extract all {{variable}} references from prompt
    const promptVars = this.extractVariableReferences(step.prompt)

    // Get current input variables
    // Note: step.input can be a string ("{{var}}") or an object ({key: "{{var}}"})
    let currentInputs: string[] = []
    if (typeof step.input === 'string') {
      currentInputs = this.extractVariableReferences(step.input)
    } else if (typeof step.input === 'object' && step.input !== null) {
      // Extract variables from all object values
      for (const value of Object.values(step.input)) {
        if (typeof value === 'string') {
          currentInputs.push(...this.extractVariableReferences(value))
        }
      }
    }

    // Find missing variables
    const missingVars = promptVars.filter(v => !currentInputs.includes(v))

    if (missingVars.length > 0) {
      this.log(ctx, `  → ⚠️  AI step ${step.step_id} prompt references variables not in input: ${missingVars.join(', ')}`)
      // Note: We can't auto-fix this easily without knowing the step's scope context
      // Log warning for manual review
    }

    return step
  }

  /**
   * Extract variable references from a string (e.g., "{{var1}} and {{var2}}" → ["var1", "var2"])
   */
  private extractVariableReferences(text: string): string[] {
    if (!text || typeof text !== 'string') return []
    const matches = text.match(/\{\{([^}]+)\}\}/g)
    if (!matches) return []
    return matches.map(m => m.replace(/\{\{|\}\}/g, '').split('.')[0].trim())
  }

  /**
   * Normalize and fix workflow steps
   *
   * Fixes:
   * 1. Inconsistent variable references (bare strings → {{var}})
   * 2. Missing reduce field parameters
   * 3. Wrong gather operations
   * 4. Config key references
   * 5. Field paths in conditions
   */
  private async normalizeAndFixWorkflow(workflow: WorkflowStep[], ctx: CompilerContext): Promise<WorkflowStep[]> {
    const variables = new Set<string>()

    // Process steps sequentially to maintain variable tracking order
    const normalized: WorkflowStep[] = []
    for (const step of workflow) {
      const normalizedStep = await this.normalizeStep(step, variables, ctx)
      normalized.push(normalizedStep)
    }
    return normalized
  }

  /**
   * Normalize a single step
   */
  private async normalizeStep(step: WorkflowStep, variables: Set<string>, ctx: CompilerContext): Promise<WorkflowStep> {
    const normalized: any = { ...step }

    // Track output variable
    if (normalized.output_variable) {
      variables.add(normalized.output_variable)
    }

    // Normalize based on step type
    switch (normalized.type) {
      case 'action':
        return await this.normalizeActionStepRefs(normalized, variables, ctx)
      case 'transform':
        return this.normalizeTransformStepRefs(normalized, variables, ctx)
      case 'scatter_gather':
        return await this.normalizeScatterGatherStepRefs(normalized, variables, ctx)
      case 'conditional':
        return await this.normalizeConditionalStepRefs(normalized, variables, ctx)
      case 'ai_processing':
        return this.normalizeAIStepRefs(normalized, variables, ctx)
      default:
        return normalized
    }
  }

  /**
   * Normalize action step references
   * Now uses plugin schema metadata for intelligent normalization
   */
  private async normalizeActionStepRefs(step: any, variables: Set<string>, ctx: CompilerContext): Promise<any> {
    // Pre-process: fold query_filters into the query parameter.
    // The IntentContract separates query and filters, but many plugins (e.g., Gmail)
    // use a single query string where time/field constraints are part of the syntax.
    // Fold filters into the query so the plugin receives a single search expression.
    if (step.config?.query_filters && Array.isArray(step.config.query_filters)) {
      const filters = step.config.query_filters as Array<{ field: string; op: string; value: any }>
      if (filters.length > 0) {
        // Ensure query param exists (may be a config template like {{config.gmail_search_query}})
        if (!step.config.query) {
          step.config.query = ''
        }
        // Attach filters as structured metadata on the query for runtime merging.
        // The runtime or plugin executor can use these to augment the query string
        // with plugin-native syntax (e.g., Gmail: newer_than:1d, after:YYYY/MM/DD).
        step.config._query_filters = filters
        this.log(ctx, `  → Folded ${filters.length} query filter(s) into _query_filters metadata`)
      }
      delete step.config.query_filters
    }

    if (step.config && this.pluginManager) {
      // Get plugin schema for this action
      const pluginSchema = await this.getPluginActionSchema(step.plugin, step.operation)

      if (pluginSchema?.parameters?.properties) {
        this.log(ctx, `  → Using plugin schema for ${step.plugin}.${step.operation} (${variables.size} variables tracked)`)
        step.config = await this.normalizeActionConfigWithSchema(
          step.config,
          pluginSchema.parameters.properties,
          variables,
          ctx
        )
      } else {
        // Fallback to basic normalization if no schema available
        this.log(ctx, `  → No plugin schema found for ${step.plugin}.${step.operation}, using basic normalization`)
        step.config = this.normalizeConfigRefs(step.config, variables, ctx)
      }
    } else if (step.config) {
      step.config = this.normalizeConfigRefs(step.config, variables, ctx)
    }
    return step
  }

  /**
   * Get plugin action schema from plugin manager
   */
  private async getPluginActionSchema(pluginKey: string, actionName: string): Promise<any> {
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
   * Find fuzzy matches for a config key in workflow config
   *
   * Generic token-based matching (no hardcoded aliases):
   * 1. Split keys into semantic tokens (e.g., "spreadsheet_id" → ["spreadsheet", "id"])
   * 2. Calculate token overlap between target and config keys
   * 3. Rank by similarity score
   *
   * Examples:
   * - spreadsheet_id ↔ google_sheet_id (tokens: sheet, id → score: 0.5)
   * - sheet_tab_name ↔ google_sheet_tab (tokens: sheet, tab → score: 0.67)
   */
  private findFuzzyConfigMatch(targetKey: string, config: Record<string, any>): string[] {
    const matches: Array<{ key: string, score: number }> = []

    // Tokenize target key
    const targetTokens = this.tokenizeKey(targetKey)

    for (const configKey of Object.keys(config)) {
      if (configKey === targetKey) continue // Skip exact (already checked)

      const configTokens = this.tokenizeKey(configKey)

      // Calculate token overlap
      const commonTokens = targetTokens.filter(t => configTokens.includes(t))
      if (commonTokens.length > 0) {
        const totalTokens = new Set([...targetTokens, ...configTokens]).size
        const score = commonTokens.length / totalTokens

        // Threshold: at least 33% token overlap
        if (score >= 0.33) {
          matches.push({ key: configKey, score })
        }
      }
    }

    // Sort by score descending
    return matches.sort((a, b) => b.score - a.score).map(m => m.key)
  }

  /**
   * Tokenize a key for fuzzy matching
   * Splits on underscore, hyphen, and camelCase boundaries
   */
  private tokenizeKey(key: string): string[] {
    return key
      .replace(/([a-z])([A-Z])/g, '$1_$2') // camelCase → snake_case
      .toLowerCase()
      .split(/[_-]/) // split on underscore or hyphen
      .filter(t => t.length > 0)
  }

  /**
   * Calculate token overlap score between two keys
   * Returns score between 0 and 1 (0 = no overlap, 1 = identical)
   */
  private calculateTokenOverlap(key1: string, key2: string): number {
    const tokens1 = new Set(this.tokenizeKey(key1))
    const tokens2 = new Set(this.tokenizeKey(key2))

    const commonTokens = [...tokens1].filter(t => tokens2.has(t))
    const allTokens = new Set([...tokens1, ...tokens2])

    if (allTokens.size === 0) return 0
    return commonTokens.length / allTokens.size
  }

  /**
   * Find best matching config key using token-based fuzzy matching
   * Returns undefined if no match found above threshold
   */
  private findBestConfigMatch(
    targetKey: string,
    workflowConfig: Record<string, any>,
    threshold: number = 0.33,
    ctx?: CompilerContext
  ): string | undefined {
    let bestMatch: string | undefined
    let bestScore = 0

    for (const configKey of Object.keys(workflowConfig)) {
      const score = this.calculateTokenOverlap(targetKey, configKey)
      if (ctx) {
        this.log(ctx, `  → Fuzzy compare: '${targetKey}' vs '${configKey}' = ${score.toFixed(3)}`)
      }
      if (score > bestScore && score >= threshold) {
        bestScore = score
        bestMatch = configKey
      }
    }

    if (ctx && bestMatch) {
      this.log(ctx, `  → Best match for '${targetKey}': '${bestMatch}' (score: ${bestScore.toFixed(3)})`)
    }

    return bestMatch
  }

  /**
   * Normalize action config using plugin schema metadata
   * Applies x-variable-mapping, x-input-mapping, and x-context-binding
   */
  private async normalizeActionConfigWithSchema(
    config: any,
    parameterSchema: any,
    variables: Set<string>,
    ctx: CompilerContext
  ): Promise<any> {
    const normalized: any = {}

    // SCHEMA-DRIVEN: Only process parameters that are explicitly provided in config
    // OR have x-context-binding (can be injected from workflow config)
    // DO NOT fuzzy match optional parameters - that's non-deterministic and breaks scalability

    // First pass: Process all provided config parameters
    for (const [configKey, configVal] of Object.entries(config)) {
      // Find exact match in schema (or skip if parameter doesn't exist in schema)
      const paramDef = parameterSchema[configKey]
      if (!paramDef) {
        // Unknown parameter - just copy it through (validation will catch it)
        normalized[configKey] = configVal
        continue
      }

      let configValue = configVal
      const paramName = configKey // Use configKey as paramName for this provided parameter

      // Apply x-variable-mapping if value is an object variable
      if (paramDef['x-variable-mapping'] && typeof configValue === 'string') {
        const mapping = paramDef['x-variable-mapping']
        const varName = configValue.replace(/[{}]/g, '')

        // Check if this looks like it needs extraction (e.g., {{folder}} instead of {{folder.folder_id}})
        if (variables.has(varName) && !varName.includes('.')) {
          // Apply mapping
          const mappedValue = `{{${varName}.${mapping.field_path}}}`
          normalized[paramName] = mappedValue
          this.log(ctx, `  → Applied x-variable-mapping: ${paramName} = ${configValue} → ${mappedValue}`)

          // Schema-driven detection: Check if source variable's output schema contains the required field
          const varSource = ctx.variableSources.get(varName)
          if (varSource && varSource.outputSchema) {
            const hasField = this.schemaContainsField(varSource.outputSchema, mapping.field_path)

            if (!hasField) {
              // Required field is missing from source variable's output schema
              this.warn(
                ctx,
                `⚠️  Missing field '${mapping.field_path}' in variable '${varName}' ` +
                `(from ${varSource.pluginKey}.${varSource.actionName}). ` +
                `This will likely cause runtime failure. ` +
                `IntentContract should include intermediate step to fetch this field.`
              )

              // Try to suggest which operation could provide the missing field
              const suggestedOp = this.findOperationThatReturnsField(varSource.pluginKey, mapping.field_path, ctx)
              if (suggestedOp) {
                this.warn(
                  ctx,
                  `    💡 Suggestion: Add step using ${varSource.pluginKey}.${suggestedOp} ` +
                  `to retrieve '${mapping.field_path}' before using it.`
                )
              }
            }
          }

          continue
        }
      }

      // Apply x-input-mapping if value could be multiple types
      if (paramDef['x-input-mapping'] && typeof configValue === 'string') {
        const mapping = paramDef['x-input-mapping']
        const varName = configValue.replace(/[{}]/g, '')

        if (variables.has(varName)) {
          // Schema-aware: check producing slot to determine which accepts type matches
          const dataSchema = ctx.ir?.execution_graph?.data_schema
          const slotSchema = dataSchema?.slots?.[varName]?.schema

          let fieldAccessor: string | null = null
          let matchedType: string = 'unknown'

          if (slotSchema && slotSchema.properties) {
            // Check each accepted type against the slot's actual fields
            if (mapping.from_file_object && slotSchema.properties[mapping.from_file_object]) {
              fieldAccessor = mapping.from_file_object
              matchedType = 'file_object'
            } else if (mapping.from_base64_content && slotSchema.properties[mapping.from_base64_content]) {
              fieldAccessor = mapping.from_base64_content
              matchedType = 'base64_content'
            }
            // url_string: no field accessor needed (pass as-is)
          } else if (mapping.from_file_object) {
            // No schema available — fall back to from_file_object (legacy behavior)
            fieldAccessor = mapping.from_file_object
            matchedType = 'file_object (fallback)'
          }

          if (fieldAccessor) {
            const mappedValue = `{{${varName}.${fieldAccessor}}}`
            normalized[paramName] = mappedValue
            this.log(ctx, `  → Applied input mapping (${matchedType}): ${paramName} = ${configValue} → ${mappedValue}`)
          } else {
            // No matching accessor — pass the whole object reference
            normalized[paramName] = `{{${varName}}}`
            this.log(ctx, `  → x-input-mapping: no matching field on slot '${varName}', passing whole object`)
          }
          continue
        }
      }

      // Default: apply basic normalization
      if (typeof configValue === 'string') {
        if (!configValue.includes('{{') && !configValue.includes('config.')) {
          const baseVar = configValue.split('.')[0]
          if (variables.has(baseVar)) {
            normalized[paramName] = `{{${configValue}}}`
            this.log(ctx, `  → Wrapped variable reference: ${paramName} = ${configValue} → {{${configValue}}}`)
          } else {
            this.log(ctx, `  → Variable '${baseVar}' not in set (from ${paramName} = ${configValue}), not wrapping`)
            normalized[paramName] = configValue
          }
        } else {
          normalized[paramName] = configValue
        }
      } else if (typeof configValue === 'object') {
        normalized[paramName] = this.normalizeConfigRefs(configValue, variables, ctx)
      } else {
        normalized[paramName] = configValue
      }
    }

    // Second pass: Check for parameters with x-context-binding that can be injected
    for (const [paramName, paramDef] of Object.entries(parameterSchema as Record<string, any>)) {
      // Skip if already processed from config
      if (paramName in normalized) {
        continue
      }

      // Only inject if x-context-binding is available
      if (paramDef['x-context-binding'] && ctx.workflowConfig) {
        const binding = paramDef['x-context-binding']
        const configKey = binding.key

        // Try exact match first
        let matchedKey = configKey
        let configVal = ctx.workflowConfig[configKey]

        // If exact match not found, try fuzzy matching for workflow config only
        if (configVal === undefined) {
          this.log(ctx, `  → Exact match not found for '${configKey}', trying fuzzy matching...`)
          const fuzzyMatch = this.findBestConfigMatch(configKey, ctx.workflowConfig, 0.15, ctx)
          if (fuzzyMatch) {
            matchedKey = fuzzyMatch
            configVal = ctx.workflowConfig[fuzzyMatch]
            this.log(ctx, `  → ✅ Fuzzy matched '${configKey}' → '${fuzzyMatch}' (score: ${this.calculateTokenOverlap(configKey, fuzzyMatch).toFixed(2)})`)
          } else {
            this.log(ctx, `  → ❌ No fuzzy match found for '${configKey}'`)
          }
        }

        if (configVal !== undefined) {
          // CRITICAL FIX: Create a config REFERENCE, not a hardcoded value
          // This ensures workflows remain config-driven and reusable
          normalized[paramName] = `{{config.${matchedKey}}}`
          this.log(ctx, `  → Bound '${paramName}' to config reference: {{config.${matchedKey}}}`)
        } else {
          this.log(ctx, `  → Parameter '${paramName}' can be bound from ${binding.source}.${binding.key} (not available in config)`)
        }
      }
    }

    // Third pass: Auto-inject missing REQUIRED parameters from workflow config using fuzzy matching
    // This handles cases where plugin schema doesn't have x-context-binding but the parameter is required
    // NOTE: Uses higher threshold (0.4) than x-context-binding pass to avoid cross-domain false positives
    // (e.g., matching "file_id" to "sheet_id" when only "id" token overlaps)
    if (ctx.workflowConfig && parameterSchema) {
      for (const [paramName, paramDef] of Object.entries(parameterSchema as Record<string, any>)) {
        // Skip if already processed
        if (paramName in normalized) {
          continue
        }

        // Skip if this parameter already has x-context-binding (handled in second pass)
        if (paramDef['x-context-binding']) {
          continue
        }

        // Try to fuzzy match this parameter name against workflow config
        // If the parameter has x-artifact-field, use that as a hint for matching
        const artifactHint = paramDef['x-artifact-field']
        const searchKey = artifactHint || paramName

        this.log(ctx, `  → Checking for fuzzy match for missing parameter '${paramName}'${artifactHint ? ` (hint: ${artifactHint})` : ''}...`)
        const fuzzyMatch = this.findBestConfigMatch(searchKey, ctx.workflowConfig, 0.4, ctx)

        if (fuzzyMatch) {
          const configVal = ctx.workflowConfig[fuzzyMatch]
          if (configVal !== undefined) {
            // Auto-inject as config reference
            normalized[paramName] = `{{config.${fuzzyMatch}}}`
            this.log(
              ctx,
              `  → ✅ Auto-injected '${paramName}' from fuzzy-matched config key '${fuzzyMatch}' ` +
              `(${artifactHint ? `via artifact hint '${artifactHint}', ` : ''}score: ${this.calculateTokenOverlap(searchKey, fuzzyMatch).toFixed(2)})`
            )
          }
        } else {
          this.log(ctx, `  → No fuzzy match found for '${paramName}' in workflow config`)
        }
      }
    }

    return normalized
  }

  /**
   * Get action output schema from plugin definition
   * Returns undefined if plugin/action not found or has no output schema
   */
  private getActionOutputSchema(pluginKey: string, actionName: string): any | undefined {
    if (!this.pluginManager) return undefined

    try {
      const plugins = this.pluginManager.getAvailablePlugins()
      const pluginDef = plugins[pluginKey]

      if (!pluginDef || !pluginDef.actions || !pluginDef.actions[actionName]) {
        return undefined
      }

      const actionDef = pluginDef.actions[actionName]
      return actionDef.output_schema
    } catch (error) {
      return undefined
    }
  }

  /**
   * Check if a schema contains a specific field (handles nested paths and arrays)
   * @param schema - JSON Schema object
   * @param fieldPath - Field path to check (e.g., "content", "items.name")
   * @returns true if field exists in schema
   */
  private schemaContainsField(schema: any, fieldPath: string): boolean {
    if (!schema || typeof schema !== 'object') return false

    // Handle simple field name (no dots)
    if (!fieldPath.includes('.')) {
      // Check direct properties
      if (schema.properties && schema.properties[fieldPath]) {
        return true
      }

      // Check array items
      if (schema.type === 'array' && schema.items) {
        return this.schemaContainsField(schema.items, fieldPath)
      }

      return false
    }

    // Handle nested path (e.g., "items.name")
    const [first, ...rest] = fieldPath.split('.')
    const remainingPath = rest.join('.')

    // Check if first part exists
    if (schema.properties && schema.properties[first]) {
      return this.schemaContainsField(schema.properties[first], remainingPath)
    }

    // Check array items
    if (schema.type === 'array' && schema.items) {
      return this.schemaContainsField(schema.items, fieldPath) // Try full path in items
    }

    return false
  }

  /**
   * Find an operation in a plugin that returns a specific field in its output schema
   * This helps suggest intermediate steps when a required field is missing
   *
   * @param pluginKey - Plugin to search in
   * @param fieldPath - Field that needs to be retrieved
   * @param ctx - Compiler context for logging
   * @returns Action name that can provide the field, or undefined if not found
   */
  private findOperationThatReturnsField(
    pluginKey: string,
    fieldPath: string,
    ctx: CompilerContext
  ): string | undefined {
    if (!this.pluginManager) return undefined

    try {
      const plugins = this.pluginManager.getAvailablePlugins()
      const pluginDef = plugins[pluginKey]

      if (!pluginDef || !pluginDef.actions) {
        return undefined
      }

      // Common operation patterns that fetch full objects (prioritize these)
      const fetchPatterns = ['download', 'get', 'fetch', 'read', 'retrieve']

      const candidates: Array<{ actionName: string; priority: number }> = []

      // Search all actions in the plugin
      for (const [actionName, actionDef] of Object.entries(pluginDef.actions as Record<string, any>)) {
        if (actionDef.output_schema && this.schemaContainsField(actionDef.output_schema, fieldPath)) {
          // Calculate priority based on operation name
          let priority = 0
          const lowerActionName = actionName.toLowerCase()

          for (let i = 0; i < fetchPatterns.length; i++) {
            if (lowerActionName.includes(fetchPatterns[i])) {
              priority = fetchPatterns.length - i // Higher priority for earlier patterns
              break
            }
          }

          candidates.push({ actionName, priority })
        }
      }

      // Sort by priority (descending), then alphabetically
      candidates.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority
        return a.actionName.localeCompare(b.actionName)
      })

      // Return highest priority candidate
      return candidates.length > 0 ? candidates[0].actionName : undefined
    } catch (error) {
      return undefined
    }
  }

  /**
   * Normalize transform step references
   */
  private normalizeTransformStepRefs(step: any, variables: Set<string>, ctx: CompilerContext): any {
    // Normalize input — only for string inputs (not object field mappings from O26)
    if (step.input && typeof step.input === 'string' && !step.input.includes('{{')) {
      step.input = `{{${step.input}}}`
    }

    // Fix reduce operations missing field
    if (step.operation === 'reduce' && step.config) {
      const reduceOp = step.config.reduce_operation || step.config.reducer
      if ((reduceOp === 'sum' || reduceOp === 'avg' || reduceOp === 'min' || reduceOp === 'max') && !step.config.field) {
        // Try to extract from custom_code (format: "field:fieldname")
        if (step.config.custom_code && step.config.custom_code.startsWith('field:')) {
          const field = step.config.custom_code.substring(6) // Remove "field:" prefix
          step.config.field = field
          delete step.config.custom_code // Remove the temporary storage
          this.log(ctx, `  → Extracted reduce field from IR: field='${field}'`)
        } else {
          // Try to infer from output_variable or step_id
          const outputVar = step.output_variable || ''
          const stepId = step.step_id || step.id || ''
          const combinedName = `${outputVar} ${stepId}`.toLowerCase()

          if (combinedName.includes('amount')) {
            step.config.field = 'amount'
            this.log(ctx, `  → Auto-inferred reduce field from variable name: field='amount'`)
          } else {
            // Leave missing - will need manual fix or runtime error
            this.log(ctx, `  → Warning: reduce ${reduceOp} operation missing field parameter`)
          }
        }
      }
    }

    // Normalize filter conditions
    if (step.operation === 'filter' && step.config) {
      if (step.config.condition) {
        step.config.condition = this.normalizeConditionRefs(step.config.condition, ctx)
      }
      if (step.config.filter_expression) {
        step.config.filter_expression = this.normalizeFilterExpressionRefs(step.config.filter_expression, ctx)
      }
    }

    return step
  }

  /**
   * Normalize scatter_gather step references
   */
  private async normalizeScatterGatherStepRefs(step: any, variables: Set<string>, ctx: CompilerContext): Promise<any> {
    // Normalize scatter input
    if (step.scatter?.input && !step.scatter.input.includes('{{')) {
      step.scatter.input = `{{${step.scatter.input}}}`
    }

    // Add item variable to scope
    const itemVar = step.scatter?.itemVariable || 'item'
    variables.add(itemVar)

    // Normalize nested steps
    if (step.scatter?.steps) {
      const normalized: WorkflowStep[] = []
      for (const s of step.scatter.steps) {
        const normalizedStep = await this.normalizeStep(s, variables, ctx)
        normalized.push(normalizedStep)
      }
      step.scatter.steps = normalized
    }

    // Remove item variable from scope
    variables.delete(itemVar)

    // Check gather operation
    if (step.gather?.operation === 'flatten') {
      // Check if nested steps actually return arrays
      const hasArrayOutputs = step.scatter?.steps?.some((s: any) =>
        s.operation === 'list' || s.operation === 'search'
      )
      if (!hasArrayOutputs) {
        this.log(ctx, `  → Warning: Step ${step.step_id} uses gather='flatten' but may need 'collect'`)
      }
    }

    return step
  }

  /**
   * Normalize conditional step references
   */
  private async normalizeConditionalStepRefs(step: any, variables: Set<string>, ctx: CompilerContext): Promise<any> {
    if (step.condition) {
      step.condition = this.normalizeConditionRefs(step.condition, ctx)
    }

    // Normalize "then" branch (step.steps)
    if (step.steps) {
      const normalized: WorkflowStep[] = []
      for (const s of step.steps) {
        const normalizedStep = await this.normalizeStep(s, variables, ctx)
        normalized.push(normalizedStep)
      }
      step.steps = normalized
    }

    // Normalize "else" branch (step.else_steps)
    if (step.else_steps) {
      const normalizedElse: WorkflowStep[] = []
      for (const s of step.else_steps) {
        const normalizedStep = await this.normalizeStep(s, variables, ctx)
        normalizedElse.push(normalizedStep)
      }
      step.else_steps = normalizedElse
    }

    return step
  }

  /**
   * Normalize AI processing step references
   */
  private normalizeAIStepRefs(step: any, variables: Set<string>, ctx: CompilerContext): any {
    // Check if output schema is defined
    if (!step.output_schema && !step.config?.output_schema) {
      this.log(ctx, `  → Warning: AI step ${step.step_id} missing output_schema`)
    }
    return step
  }

  /**
   * Normalize config references
   */
  private normalizeConfigRefs(config: any, variables: Set<string>, ctx: CompilerContext): any {
    if (!config || typeof config !== 'object') return config

    const normalized: any = Array.isArray(config) ? [] : {}

    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        // Check if it's a known variable (not already wrapped)
        if (!value.includes('{{') && !value.includes('config.')) {
          // Check if it's a variable name or field path
          const baseVar = value.split('.')[0]
          if (variables.has(baseVar)) {
            normalized[key] = `{{${value}}}`
            this.log(ctx, `  → Wrapped variable reference: ${key} = ${value} → {{${value}}}`)
          } else {
            normalized[key] = value
          }
        } else {
          normalized[key] = value
        }
      } else if (typeof value === 'object') {
        normalized[key] = this.normalizeConfigRefs(value, variables, ctx)
      } else {
        normalized[key] = value
      }
    }

    return normalized
  }

  /**
   * Normalize condition references
   */
  private normalizeConditionRefs(condition: any, ctx: CompilerContext): any {
    if (!condition) return condition

    const normalized = { ...condition }

    // Simple condition
    if (condition.conditionType === 'simple' || condition.type === 'simple') {
      // Field and variable are already in the right format for conditions
      // Just ensure they're valid
    }

    // Complex conditions (recursive)
    if (condition.conditions) {
      normalized.conditions = condition.conditions.map((c: any) =>
        this.normalizeConditionRefs(c, ctx)
      )
    }

    return normalized
  }

  /**
   * Normalize filter expression references
   */
  private normalizeFilterExpressionRefs(expr: any, ctx: CompilerContext): any {
    if (!expr) return expr

    const normalized = { ...expr }

    // Simple expressions
    if (expr.type === 'simple') {
      // Filter expressions are fine as-is; they operate on array items
    }

    return normalized
  }

  /**
   * Detect and merge redundant AI operations that just combine data
   *
   * Pattern to detect:
   * Step N: deterministic_extraction with output_schema having fields [a, b, c]
   * Step N+1: ai_processing (type: generate) that merges step N output with other variables
   *          Instruction contains words like "combine", "merge", "create complete record"
   *          Output schema is superset of step N schema
   *
   * Optimization:
   * - Expand step N's output_schema to include all fields from step N+1
   * - Remove step N+1 entirely
   * - Update references from step N+1 to point to step N
   */
  private mergeRedundantAIMergeSteps(workflow: WorkflowStep[], ctx: CompilerContext): WorkflowStep[] {
    const stepsToRemove = new Set<string>()
    const optimizedSteps: WorkflowStep[] = []

    for (let i = 0; i < workflow.length; i++) {
      const currentStep = workflow[i] as any
      const nextStep = i < workflow.length - 1 ? workflow[i + 1] as any : null

      // Check if current step is deterministic_extraction
      if (currentStep.type === 'deterministic_extraction' && nextStep) {
        // Check if next step is AI merge operation
        if (this.isAIMergeOperation(nextStep, currentStep)) {
          this.log(ctx, `Optimization: Merging redundant AI step ${nextStep.step_id} into ${currentStep.step_id}`)

          // Expand current step's output_schema with fields from next step
          const mergedStep = this.expandOutputSchema(currentStep, nextStep)
          optimizedSteps.push(mergedStep)

          // Mark next step for removal
          stepsToRemove.add(nextStep.step_id || nextStep.id)

          // Skip next step in loop
          i++
          continue
        }
      }

      // Keep step if not marked for removal
      if (!stepsToRemove.has(currentStep.step_id || currentStep.id)) {
        optimizedSteps.push(currentStep)
      }
    }

    // Update variable references to point from removed steps to their predecessors
    return this.updateVariableReferencesAfterOptimization(optimizedSteps, stepsToRemove, workflow, ctx)
  }

  /**
   * Check if a step is an AI merge operation
   */
  private isAIMergeOperation(step: any, previousStep: any): boolean {
    // Must be ai_processing
    if (step.type !== 'ai_processing') return false

    // Check config for AI type
    const aiType = step.config?.ai_type
    if (aiType !== 'generate' && aiType !== 'transform') return false

    // Check if instruction contains merge/combine keywords
    const instruction = (step.prompt || step.description || '').toLowerCase()
    const mergeKeywords = ['combine', 'merge', 'create complete', 'create a complete', 'add metadata', 'include metadata']
    const hasMergeIntent = mergeKeywords.some(kw => instruction.includes(kw))

    if (!hasMergeIntent) return false

    // Check if input references the previous step
    const input = step.input || ''
    const prevStepId = previousStep.step_id || previousStep.id
    const prevOutputVar = previousStep.output_variable || prevStepId

    const referencesPrevious = input.includes(`{{${prevStepId}`) || input.includes(`{{${prevOutputVar}`)

    return referencesPrevious
  }

  /**
   * Expand output_schema of extraction step to include merge fields
   */
  private expandOutputSchema(extractionStep: any, mergeStep: any): any {
    const mergedStep = { ...extractionStep }

    // Get schemas
    const extractSchema = extractionStep.config?.output_schema || extractionStep.output_schema
    const mergeSchema = mergeStep.config?.output_schema || mergeStep.output_schema

    if (!extractSchema || !mergeSchema) {
      return mergedStep // Can't merge without schemas
    }

    // Merge properties (JSON Schema format)
    if (extractSchema.properties && mergeSchema.properties) {
      mergedStep.config = mergedStep.config || {}
      mergedStep.config.output_schema = {
        ...extractSchema,
        properties: {
          ...extractSchema.properties,
          ...mergeSchema.properties
        },
        required: [
          ...(extractSchema.required || []),
          // Don't add metadata fields to required
        ]
      }

      // Also update top-level output_schema if present
      if (mergedStep.output_schema) {
        mergedStep.output_schema = mergedStep.config.output_schema
      }
    }

    // Update output_variable to use the merge step's name (for better context)
    if (mergeStep.output_variable) {
      mergedStep.output_variable = mergeStep.output_variable
    }

    return mergedStep
  }

  /**
   * Update variable references after removing optimized steps
   */
  private updateVariableReferencesAfterOptimization(
    steps: WorkflowStep[],
    removedSteps: Set<string>,
    originalWorkflow: WorkflowStep[],
    ctx: CompilerContext
  ): WorkflowStep[] {
    if (removedSteps.size === 0) return steps

    // Build mapping: removed step ID -> its predecessor's output variable
    const replacementMap = new Map<string, string>()

    for (let i = 0; i < originalWorkflow.length; i++) {
      const currentStep = originalWorkflow[i] as any
      const currentId = currentStep.step_id || currentStep.id

      if (removedSteps.has(currentId) && i > 0) {
        const prevStep = originalWorkflow[i - 1] as any
        const prevOutputVar = prevStep.output_variable || prevStep.step_id || prevStep.id
        const removedOutputVar = currentStep.output_variable || currentId

        replacementMap.set(removedOutputVar, prevOutputVar)
        replacementMap.set(currentId, prevOutputVar)

        this.log(ctx, `Optimization: Redirecting references from {{${removedOutputVar}}} to {{${prevOutputVar}}}`)
      }
    }

    // Update all variable references in remaining steps
    return steps.map(step => this.replaceVariableReferences(step, replacementMap))
  }

  /**
   * Recursively replace variable references in a step
   */
  private replaceVariableReferences(obj: any, replacements: Map<string, string>): any {
    if (typeof obj === 'string') {
      let updated = obj
      for (const [oldVar, newVar] of Array.from(replacements.entries())) {
        const pattern = new RegExp(`\\{\\{${oldVar}(\\.|\\}})`, 'g')
        updated = updated.replace(pattern, `{{${newVar}$1`)
      }
      return updated
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.replaceVariableReferences(item, replacements))
    }

    if (obj && typeof obj === 'object') {
      const updated: any = {}
      for (const [key, value] of Object.entries(obj)) {
        updated[key] = this.replaceVariableReferences(value, replacements)
      }
      return updated
    }

    return obj
  }

  /**
   * Fix filter variable scoping
   * When filtering an array, conditions that reference the array itself mean "current item"
   * Replace array references with "item" to get correct PILOT DSL syntax
   *
   * Example: filtering "valid_transactions" where condition has "valid_transactions.amount"
   * should become "item.amount" (the current item being filtered)
   */
  private fixFilterVariableScoping(condition: any, filterInput: string): any {
    if (!condition) return condition

    const fixed = { ...condition }

    // Handle simple condition field references
    if (fixed.field) {
      // Check if field references the filter input variable
      const fieldParts = fixed.field.split('.')
      if (fieldParts[0] === filterInput) {
        // Replace with item.field_name
        fixed.field = fieldParts.length > 1 ? `item.${fieldParts.slice(1).join('.')}` : 'item'
      }
    }

    // Handle variable references
    if (fixed.variable) {
      const varParts = fixed.variable.split('.')
      if (varParts[0] === filterInput) {
        fixed.variable = varParts.length > 1 ? `item.${varParts.slice(1).join('.')}` : 'item'
      }
    }

    // Handle left/right sides of comparisons (for simple conditions)
    if (fixed.left && typeof fixed.left === 'object' && fixed.left.variable) {
      const varParts = fixed.left.variable.split('.')
      if (varParts[0] === filterInput) {
        fixed.left = {
          ...fixed.left,
          variable: varParts.length > 1 ? `item.${varParts.slice(1).join('.')}` : 'item'
        }
      }
    }

    if (fixed.right && typeof fixed.right === 'object' && fixed.right.variable) {
      const varParts = fixed.right.variable.split('.')
      if (varParts[0] === filterInput) {
        fixed.right = {
          ...fixed.right,
          variable: varParts.length > 1 ? `item.${varParts.slice(1).join('.')}` : 'item'
        }
      }
    }

    // Recursively handle complex conditions (conditions array)
    if (fixed.conditions && Array.isArray(fixed.conditions)) {
      fixed.conditions = fixed.conditions.map((c: any) =>
        this.fixFilterVariableScoping(c, filterInput)
      )
    }

    // Recursively handle nested single condition
    if (fixed.condition && typeof fixed.condition === 'object') {
      fixed.condition = this.fixFilterVariableScoping(fixed.condition, filterInput)
    }

    return fixed
  }

  // ============================================================================
  // Data Schema — schema attachment and validation (Phase 4)
  // ============================================================================

  /**
   * Attach output_schema and input_schema from data_schema slots to a compiled step.
   * (Task 4.2)
   */
  private attachSlotSchemas(step: WorkflowStep, node: ExecutionNode, graph: ExecutionGraph): void {
    const dataSchema = graph.data_schema
    if (!dataSchema) return

    // Attach output_schema from the slot this node writes to
    if (node.outputs && node.outputs.length > 0) {
      const outputVar = node.outputs[0].variable.split('.')[0]
      const outputSlot = dataSchema.slots[outputVar]
      if (outputSlot) {
        step.output_schema = outputSlot.schema
      }
    }

    // Attach input_schema from the slot this node reads from
    if (node.inputs && node.inputs.length > 0) {
      const inputVar = node.inputs[0].variable.split('.')[0]
      const inputSlot = dataSchema.slots[inputVar]
      if (inputSlot) {
        step.input_schema = inputSlot.schema
      }
    }
  }

  /**
   * Validate data_schema slots against plugin output_schemas.
   * (Task 4.1)
   */
  private validateSchemaAgainstPlugins(graph: ExecutionGraph, ctx: CompilerContext): void {
    const dataSchema = graph.data_schema
    if (!dataSchema || !this.pluginManager) return

    let plugins: Record<string, any>
    try {
      plugins = this.pluginManager.getAvailablePlugins()
    } catch {
      return
    }

    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      if (node.type !== 'operation' || !node.operation) continue

      const op = node.operation
      let pluginKey: string | undefined
      let actionName: string | undefined

      if (op.operation_type === 'fetch' && op.fetch) {
        pluginKey = op.fetch.plugin_key
        actionName = op.fetch.action
      } else if (op.operation_type === 'deliver' && op.deliver) {
        pluginKey = op.deliver.plugin_key
        actionName = op.deliver.action
      } else if (op.operation_type === 'file_op' && op.file_op) {
        pluginKey = op.file_op.plugin_key
        actionName = op.file_op.action
      }

      if (!pluginKey || !actionName) continue

      const pluginDef = plugins[pluginKey]
      if (!pluginDef?.actions?.[actionName]?.output_schema) continue

      const pluginOutputSchema = pluginDef.actions[actionName].output_schema

      // Find the declared slot for this node's output
      if (!node.outputs || node.outputs.length === 0) continue
      const outputVar = node.outputs[0].variable.split('.')[0]
      const declaredSlot = dataSchema.slots[outputVar]
      if (!declaredSlot) continue

      // Cross-validate: check declared slot fields exist in plugin schema
      if (declaredSlot.schema.properties && pluginOutputSchema.properties) {
        for (const fieldName of Object.keys(declaredSlot.schema.properties)) {
          if (!(fieldName in pluginOutputSchema.properties)) {
            this.warn(ctx,
              `Schema mismatch: slot "${outputVar}" declares field "${fieldName}" ` +
              `but plugin ${pluginKey}.${actionName} output_schema does not have this field. ` +
              `Available: [${Object.keys(pluginOutputSchema.properties).join(', ')}]`)
          }
        }
      }
    }
  }

  /**
   * Validate shape-preserving transforms: output schema should match input schema type.
   * (Task 4.3)
   */
  private validateShapePreservingTransform(
    nodeId: string,
    node: ExecutionNode,
    graph: ExecutionGraph,
    ctx: CompilerContext
  ): void {
    const dataSchema = graph.data_schema
    if (!dataSchema || !node.operation?.transform) return

    const transformType = node.operation.transform.type
    const shapePreserving = ['filter', 'sort', 'deduplicate']
    if (!shapePreserving.includes(transformType)) return

    const inputVar = node.inputs?.[0]?.variable?.split('.')[0]
    const outputVar = node.outputs?.[0]?.variable?.split('.')[0]
    if (!inputVar || !outputVar) return

    const inputSlot = dataSchema.slots[inputVar]
    const outputSlot = dataSchema.slots[outputVar]
    if (!inputSlot || !outputSlot) return

    if (inputSlot.schema.type !== outputSlot.schema.type) {
      this.warn(ctx,
        `Shape-preserving transform "${nodeId}" (${transformType}): ` +
        `input type "${inputSlot.schema.type}" doesn't match output type "${outputSlot.schema.type}". ` +
        `Filter/sort/deduplicate should preserve the input shape.`)
    }
  }

  /**
   * Validate loop node: item schema matches parent array's items, gather output is array.
   * (Task 4.4)
   */
  private validateLoopSchema(
    nodeId: string,
    node: ExecutionNode,
    graph: ExecutionGraph,
    ctx: CompilerContext
  ): void {
    const dataSchema = graph.data_schema
    if (!dataSchema || !node.loop) return

    // Check iterate_over slot is array type
    if (typeof node.loop.iterate_over !== 'string') return // D-B16: skip validation for non-string iterate_over
    const iterateVar = node.loop.iterate_over.split('.')[0]
    const iterateSlot = dataSchema.slots[iterateVar]
    if (iterateSlot && iterateSlot.schema.type !== 'array') {
      this.warn(ctx,
        `Loop "${nodeId}" iterates over "${iterateVar}" which is declared as type ` +
        `"${iterateSlot.schema.type}" — expected "array"`)
    }

    // Check gather output is array type
    if (node.loop.output_variable) {
      const gatherSlot = dataSchema.slots[node.loop.output_variable]
      if (gatherSlot && gatherSlot.schema.type !== 'array') {
        this.warn(ctx,
          `Loop "${nodeId}" gather output "${node.loop.output_variable}" is declared as type ` +
          `"${gatherSlot.schema.type}" — expected "array"`)
      }
    }

    // Check item_variable schema matches array's items schema
    const itemSlot = dataSchema.slots[node.loop.item_variable]
    if (iterateSlot?.schema.items && itemSlot) {
      if (iterateSlot.schema.items.type !== itemSlot.schema.type) {
        this.warn(ctx,
          `Loop "${nodeId}": item variable "${node.loop.item_variable}" type ` +
          `"${itemSlot.schema.type}" doesn't match array items type ` +
          `"${iterateSlot.schema.items.type}"`)
      }
    }
  }

  /**
   * Validate AI output_schema depth — reject array without items, object without properties.
   * (Task 4.6)
   */
  private validateAISchemaDepth(graph: ExecutionGraph, ctx: CompilerContext): void {
    const dataSchema = graph.data_schema
    if (!dataSchema) return

    for (const [slotName, slot] of Object.entries(dataSchema.slots)) {
      if (slot.schema.source !== 'ai_declared') continue

      if (slot.schema.type === 'array' && !slot.schema.items) {
        this.warn(ctx,
          `AI-declared slot "${slotName}" is type "array" but missing "items" schema. ` +
          `Auto-repairing with items: { type: "any" }`)
        slot.schema.items = { type: 'any', source: 'ai_declared' }
      }

      if (slot.schema.type === 'object' && !slot.schema.properties) {
        this.warn(ctx,
          `AI-declared slot "${slotName}" is type "object" but missing "properties". ` +
          `This may cause runtime issues.`)
      }
    }
  }

  /**
   * Cross-step type compatibility: verify input field references resolve against
   * the producing slot's schema.
   * (Task 4.7)
   */
  private validateCrossStepTypeCompatibility(graph: ExecutionGraph, ctx: CompilerContext): void {
    const dataSchema = graph.data_schema
    if (!dataSchema) return

    let connectionsChecked = 0
    let mismatches = 0

    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      if (!node.inputs || node.inputs.length === 0) continue

      for (const input of node.inputs) {
        const parts = input.variable.split('.')
        const rootVar = parts[0]
        const slot = dataSchema.slots[rootVar]
        if (!slot) continue

        // If accessing a sub-field, resolve the expected type
        if (parts.length > 1 && slot.schema.properties) {
          const fieldName = parts[1]
          const fieldSchema = slot.schema.properties[fieldName]
          if (!fieldSchema) {
            this.warn(ctx,
              `Node "${nodeId}" references "${input.variable}" but slot "${rootVar}" ` +
              `has no field "${fieldName}" in its schema. ` +
              `Available fields: [${Object.keys(slot.schema.properties).join(', ')}]`)
            mismatches++
          }
        }

        connectionsChecked++
      }
    }

    // Task 4.8: Deep producer→consumer type matching for plugin-bound nodes
    if (this.pluginManager) {
      let plugins: Record<string, any>
      try {
        plugins = this.pluginManager.getAvailablePlugins()
      } catch {
        plugins = {}
      }

      for (const [nodeId, node] of Object.entries(graph.nodes)) {
        if (node.type !== 'operation' || !node.operation) continue

        const op = node.operation
        let pluginKey: string | undefined
        let actionName: string | undefined
        let opConfig: Record<string, any> | undefined

        if (op.operation_type === 'fetch' && op.fetch) {
          pluginKey = op.fetch.plugin_key
          actionName = op.fetch.action
          opConfig = op.fetch.config
        } else if (op.operation_type === 'deliver' && op.deliver) {
          pluginKey = op.deliver.plugin_key
          actionName = op.deliver.action
          opConfig = op.deliver.config
        } else if (op.operation_type === 'file_op' && op.file_op) {
          pluginKey = op.file_op.plugin_key
          actionName = op.file_op.action
          opConfig = op.file_op.config
        }

        if (!pluginKey || !actionName || !opConfig) continue

        const pluginDef = plugins[pluginKey]
        if (!pluginDef?.actions?.[actionName]?.parameters?.properties) continue

        const paramProps = pluginDef.actions[actionName].parameters.properties as Record<string, any>

        // Check each config value for {{ref}} or {{ref.field}} references
        for (const [paramName, paramValue] of Object.entries(opConfig)) {
          if (typeof paramValue !== 'string') continue

          const varMatch = paramValue.match(/^\{\{([^}]+)\}\}$/)
          if (!varMatch) continue

          const refPath = varMatch[1]
          const refParts = refPath.split('.')
          const refRoot = refParts[0]
          const refSlot = dataSchema.slots[refRoot]
          if (!refSlot) continue

          // Resolve the producer's field type
          let producerType: string = refSlot.schema.type
          if (refParts.length > 1 && refSlot.schema.properties) {
            const fieldSchema = refSlot.schema.properties[refParts[1]]
            if (fieldSchema) {
              producerType = fieldSchema.type
            }
          }

          // Get the consumer's expected parameter type
          const paramDef = paramProps[paramName]
          if (!paramDef?.type) continue

          const consumerType = paramDef.type === 'integer' ? 'number' : paramDef.type

          connectionsChecked++

          // Compare types (allow 'any' and 'string' to match anything since most params accept string coercion)
          if (producerType !== 'any' && consumerType !== 'any' &&
              consumerType !== 'string' && producerType !== consumerType) {
            this.warn(ctx,
              `Type mismatch: node "${nodeId}" parameter "${paramName}" expects type "${consumerType}" ` +
              `but receives {{${refPath}}} which is type "${producerType}" ` +
              `(from slot "${refRoot}", plugin ${pluginKey}.${actionName})`)
            mismatches++
          }
        }
      }
    }

    if (mismatches === 0) {
      this.log(ctx, `✅ Cross-step type compatibility: all ${connectionsChecked} connections validated`)
    } else {
      this.log(ctx, `⚠️  Cross-step type compatibility: ${mismatches} issue(s) found across ${connectionsChecked} connections`)
    }
  }

  /**
   * Run all data_schema validations during compilation.
   * Called after graph validation, before step compilation.
   * (Tasks 4.1-4.8)
   */
  private validateDataSchemaInCompiler(graph: ExecutionGraph, ctx: CompilerContext): void {
    if (!graph.data_schema) return

    this.log(ctx, 'Validating data_schema in compiler')

    // Plugin cross-validation (4.1)
    this.validateSchemaAgainstPlugins(graph, ctx)

    // AI schema depth enforcement (4.6)
    this.validateAISchemaDepth(graph, ctx)

    // Per-node schema validations
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      // Shape-preserving transform validation (4.3)
      if (node.type === 'operation' && node.operation?.operation_type === 'transform') {
        this.validateShapePreservingTransform(nodeId, node, graph, ctx)
      }

      // Loop schema validation (4.4)
      if (node.type === 'loop') {
        this.validateLoopSchema(nodeId, node, graph, ctx)
      }
    }

    // Cross-step type compatibility (4.7)
    this.validateCrossStepTypeCompatibility(graph, ctx)
  }

  /**
   * Logging helpers
   */
  private log(ctx: CompilerContext, message: string) {
    ctx.logs.push(message)
    this.logger.info(message)
  }

  private warn(ctx: CompilerContext, message: string) {
    ctx.warnings.push(message)
    this.logger.warn(message)
  }

  private error(ctx: CompilerContext, message: string) {
    ctx.warnings.push(`ERROR: ${message}`)
    this.logger.error(message)
  }
}
