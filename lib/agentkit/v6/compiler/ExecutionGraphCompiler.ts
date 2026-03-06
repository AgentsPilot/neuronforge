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
 * Compiler Context - tracks state during compilation
 */
interface CompilerContext {
  stepCounter: number
  logs: string[]
  warnings: string[]
  pluginsUsed: Set<string>
  currentScope: 'global' | 'loop' | 'branch'
  loopDepth: number
  hardRequirements?: HardRequirements // Hard requirements to enforce during compilation
  ir?: DeclarativeLogicalIRv4 // IR for accessing requirements_enforcement tracking
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
   * @param hardRequirements - Hard requirements extracted in Phase 0 that MUST be enforced
   */
  async compile(
    ir: DeclarativeLogicalIRv4,
    hardRequirements?: HardRequirements
  ): Promise<CompilationResult> {
    const startTime = Date.now()
    const ctx: CompilerContext = {
      stepCounter: 0,
      logs: [],
      warnings: [],
      pluginsUsed: new Set(),
      currentScope: 'global',
      loopDepth: 0,
      hardRequirements,
      ir
    }

    try {
      this.log(ctx, `Starting execution graph compilation${hardRequirements ? ` with ${hardRequirements.requirements.length} hard requirements` : ''}`)

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

      // Phase 2: Traverse graph and compile nodes
      this.log(ctx, 'Phase 2: Compiling execution graph to workflow steps')
      let workflow = await this.compileGraph(graph, ctx)

      // Phase 3.5: Normalize data formats (auto-insert rows_to_objects for 2D arrays)
      this.log(ctx, 'Phase 3.5: Normalizing data formats')
      workflow = this.normalizeDataFormats(workflow, ctx)

      // Phase 3.6: Renumber steps sequentially after normalization
      workflow = this.renumberSteps(workflow)

      // Phase 4: Validate hard requirements enforcement (if provided)
      if (hardRequirements && hardRequirements.requirements.length > 0) {
        this.log(ctx, 'Phase 4: Validating hard requirements enforcement in compiled workflow')
        const requirementsValidation = this.validateHardRequirementsEnforcement(workflow, hardRequirements, ctx)

        if (!requirementsValidation.valid) {
          this.warn(ctx, `Hard requirements validation warnings: ${requirementsValidation.warnings.join(', ')}`)
        }

        if (requirementsValidation.errors.length > 0) {
          return {
            success: false,
            workflow,
            logs: ctx.logs,
            errors: requirementsValidation.errors,
            compilation_time_ms: Date.now() - startTime,
            validation_result: validationResult
          }
        }
      }

      const compilationTime = Date.now() - startTime
      this.log(ctx, `Compilation complete in ${compilationTime}ms`)

      return {
        success: true,
        workflow,
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
        workflowStep = this.compileAIOperation(stepId, node.id, operation, resolvedConfig, inputVariable, ctx)
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
      'set', 'map', 'filter', 'reduce', 'sort',
      'group', 'group_by',  // group_by is alias for group
      'aggregate', 'deduplicate',
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
    const inputVar = node.inputs?.[0]?.variable
    if (inputVar && ['map', 'filter', 'reduce'].includes(pilotOperation)) {
      const slotSchema = graph.data_schema?.slots?.[inputVar]?.schema
      if (slotSchema && slotSchema.type !== 'array') {
        throw new Error(
          `Transform node '${nodeId}' uses operation '${pilotOperation}' which requires array input, ` +
          `but slot '${inputVar}' is declared as type '${slotSchema.type}'. ` +
          `This is an IR generation error - the slot type or operation type must be fixed in the IR. ` +
          `Options: (1) Change slot '${inputVar}' schema type to 'array' if it holds array data, ` +
          `OR (2) Change transform operation from '${pilotOperation}' to appropriate operation for ${slotSchema.type} data.`
        )
      }
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
          this.log(ctx, `  → Compiled filter_expression to condition`)
        }
      } else if (transformConfig.type === 'map') {
        // IR field: map_expression → DSL field: expression
        if (transformConfig.map_expression) {
          transformedConfig.expression = transformConfig.map_expression
          this.log(ctx, `  → Compiled map_expression to expression`)
        }
      } else if (transformConfig.type === 'reduce') {
        // IR field: reduce_operation → DSL field: reducer
        if (transformConfig.reduce_operation) {
          transformedConfig.reducer = transformConfig.reduce_operation
          this.log(ctx, `  → Compiled reduce_operation to reducer`)
        }
      } else if (transformConfig.type === 'group_by') {
        // IR field: group_by_field → DSL field: group_by
        if (transformConfig.group_by_field) {
          transformedConfig.group_by = transformConfig.group_by_field
          this.log(ctx, `  → Compiled group_by_field to group_by`)
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
      } else if (transformConfig.type === 'custom' && transformConfig.custom_code) {
        // IR field: custom_code → DSL field: custom_code (experimental)
        transformedConfig.custom_code = transformConfig.custom_code
        this.warn(ctx, `Custom code transforms are experimental: ${nodeId}`)
      }
    }

    this.log(ctx, `  Transform ${nodeId}: ${irType} → ${pilotOperation}`)

    // PILOT format: input at top level, not in config
    return {
      step_id: stepId,
      type: 'transform',
      operation: pilotOperation,  // PILOT expects 'operation' field for transform type
      input: input,  // PILOT expects input at top level
      description: operation.description || `Transform: ${pilotOperation}`,
      config: transformedConfig  // Use transformed config
    }
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
    ctx: CompilerContext
  ): WorkflowStep {
    const ai = operation.ai!

    // Extract input: prioritize explicit ai.input, then node's inputVariable
    const input = ai.input ||
                  (inputVariable ? `{{${inputVariable}}}` : undefined)

    // PILOT format: input and prompt at top level
    // NOTE: Model is NOT included - it's determined by runtime routing in StepExecutor
    return {
      step_id: stepId,
      type: 'ai_processing',
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

    // Compile loop body
    ctx.loopDepth++
    const bodySteps: WorkflowStep[] = []
    const bodyVisited = new Set<string>() // Don't include parent visited to allow loop body compilation

    await this.compileNode(loop.body_start, graph, ctx, bodySteps, bodyVisited)
    ctx.loopDepth--

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
        outputKey: loop.output_variable,
        ...(loop.collect_from && { from: loop.collect_from })  // ✅ Add collect_from as "from" field
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
        console.warn(`[ExecutionGraphCompiler] Unknown combineWith: ${combineWith}, defaulting to AND`)
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
      console.warn(`[ExecutionGraphCompiler] Unknown condition format: ${JSON.stringify(result)}`)
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

      return params
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

    // Strategy 1: Find conditional that evaluates the routing condition
    const routingConditional = this.findConditionalEvaluatingField(rule.condition, workflow)

    if (routingConditional) {
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
        this.log(ctx, `✓ Routing rule enforced via conditional: ${rule.condition} = "${rule.field_value}" → ${rule.destination}`)
      }
      return { errors, warnings }
    }

    // Strategy 2: For group_by routing, a scatter_gather over grouped data is valid enforcement
    if (rule.condition.startsWith('group_by=')) {
      const scatterStep = this.findScatterGatherByField(rule.field_value, workflow)
      if (scatterStep) {
        this.log(ctx, `✓ Routing rule enforced via scatter_gather: ${rule.condition} — loop iterates per "${rule.field_value}" group`)
        return { errors, warnings }
      }
    }

    // Strategy 3: Check IR requirements_enforcement tracking (LLM validated this)
    if (ctx.ir?.requirements_enforcement) {
      const fieldLower = rule.field_value.toLowerCase()
      const enforcement = ctx.ir.requirements_enforcement.find(e =>
        e.validation_passed &&
        e.validation_details?.toLowerCase().includes(fieldLower) &&
        e.validation_details?.toLowerCase().includes('routing') ||
        e.validation_details?.toLowerCase().includes('group')
      )
      if (enforcement) {
        this.log(ctx, `✓ Routing rule enforced (IR-tracked): ${rule.condition} — ${enforcement.validation_details}`)
        return { errors, warnings }
      }
    }

    errors.push(
      `Routing rule not enforced: No conditional or scatter_gather found that routes by field "${rule.condition}"`
    )
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
      errors.push(
        `Required output "${requiredOutput}" not captured by any workflow step (fallback: manual search - no IR enforcement tracking found)`
      )
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

        // Also check AI processing and transform steps — filtering/thresholds
        // are often implemented via AI steps, not plugin actions
        if (step.type === 'ai_processing' || step.type === 'transform') {
          const anyStep = step as any
          const stepId = (anyStep.step_id || anyStep.id || '').toLowerCase().replace(/_/g, '')
          const description = (anyStep.description || '').toLowerCase().replace(/_/g, '')
          const operation = (anyStep.operation || '').toLowerCase().replace(/_/g, '')

          if (stepId.includes(normalizedType) ||
              description.includes(normalizedType) ||
              operation.includes(normalizedType)) {
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
    if (condition.field) {
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
    if (!condition || !condition.field) return false

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
    const writeOperations = ['append_sheets', 'upload_file', 'create_file', 'write_file', 'update_sheet']

    const search = (steps: WorkflowStep[]) => {
      for (const step of steps) {
        if (step.type === 'action') {
          const action = step as any
          const operation = action.operation_type || ''
          if (writeOperations.some(op => operation.includes(op))) {
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

  private getWriteTarget(step: WorkflowStep): string | null {
    const action = step as any
    const params = action.params || {}

    // For Google Sheets operations
    if (params.spreadsheet_id && params.range) {
      return `sheets:${params.spreadsheet_id}:${params.range}`
    }

    // For Google Drive operations
    if (params.folder_id && params.file_name) {
      return `drive:${params.folder_id}:${params.file_name}`
    }

    // For file system operations
    if (params.path) {
      return `file:${params.path}`
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
   * Find a scatter_gather step that iterates over data grouped by a specific field.
   * A scatter_gather satisfies a group_by routing rule when it loops over grouped data,
   * effectively routing each group's data to its own execution path.
   */
  private findScatterGatherByField(fieldValue: string, workflow: WorkflowStep[]): WorkflowStep | null {
    const fieldLower = fieldValue.toLowerCase().replace(/\s+/g, '_')

    const search = (steps: WorkflowStep[]): WorkflowStep | null => {
      for (const step of steps) {
        if (step.type === 'scatter_gather') {
          const scatter = (step as any).scatter
          if (scatter) {
            // Check if the scatter input references grouped data related to the field
            const inputStr = (scatter.input || '').toLowerCase()
            if (inputStr.includes('group') || inputStr.includes(fieldLower)) {
              return step
            }
            // Check the step description/output_variable for grouping references
            const stepStr = JSON.stringify(step).toLowerCase()
            if (stepStr.includes('group') && stepStr.includes(fieldLower)) {
              return step
            }
          }
        }

        // Recurse into nested structures
        if (step.type === 'conditional') {
          const cond = step as any
          const thenSteps = cond.then ? (Array.isArray(cond.then) ? cond.then : [cond.then]) : (cond.then_steps || [])
          const elseSteps = cond.else ? (Array.isArray(cond.else) ? cond.else : [cond.else]) : (cond.else_steps || [])
          const found = search(thenSteps) || search(elseSteps)
          if (found) return found
        }
      }
      return null
    }

    return search(workflow)
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

          // Register the new variable as an inferred slot in data_schema (Task 7.6)
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
    const oldPattern = `{{${oldVarName}.${arrayFieldName}}}`
    const newPattern = `{{${newVarName}}}`

    // Helper to recursively replace in objects
    const replaceInValue = (value: any): any => {
      if (typeof value === 'string') {
        return value.replace(oldPattern, newPattern)
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
        return value.replace(directRefPattern, `{{${varName}.${arrayFieldName}}}`)
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
      this.log(ctx, `  → Chose 'map' for 2D array delivery (Sheets)`)
      return 'map'
    }

    if (formats.needsHTML && !formats.needs2DArray) {
      this.log(ctx, `  → Chose 'render_table' for HTML delivery (Email/Slack)`)
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
      const inputVar = inputBindings[0]?.variable
      if (inputVar) {
        const slotSchema = graph.data_schema?.slots?.[inputVar]?.schema
        if (slotSchema && slotSchema.type !== 'array') {
          return {
            isUnnecessary: true,
            reason: `${transform.type} operation requires array input, but '${inputVar}' is ${slotSchema.type}`,
            suggestion: `Remove this transform step and use direct variable interpolation in downstream nodes`,
            canInline: true
          }
        }
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
   * Logging helpers
   */
  // ============================================================================
  // Data Schema — schema attachment and validation (Phase 3)
  // ============================================================================

  /**
   * Attach output_schema and input_schema from data_schema slots to a compiled step.
   * (Task 3.3)
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
   * Called during compilation when data_schema is present.
   * (Task 3.2)
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

      // Get plugin output_schema
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
   * (Task 3.4)
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

    // Get input and output slot schemas
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
   * (Task 3.5)
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
   * Validate choice node: if using oneOf schema, branch count should match rule count.
   * (Task 3.6)
   */
  private validateChoiceSchema(
    nodeId: string,
    node: ExecutionNode,
    graph: ExecutionGraph,
    ctx: CompilerContext
  ): void {
    const dataSchema = graph.data_schema
    if (!dataSchema || !node.choice) return

    // Find any output slot with oneOf for this choice
    if (!node.outputs) return

    for (const output of node.outputs) {
      const slotName = output.variable.split('.')[0]
      const slot = dataSchema.slots[slotName]
      if (!slot?.schema.oneOf) continue

      // +1 for default branch
      const branchCount = node.choice.rules.length + 1
      const oneOfCount = slot.schema.oneOf.length

      if (oneOfCount !== branchCount) {
        this.warn(ctx,
          `Choice "${nodeId}": slot "${slotName}" has ${oneOfCount} oneOf branches ` +
          `but choice has ${branchCount} paths (${node.choice.rules.length} rules + 1 default)`)
      }
    }
  }

  /**
   * Run all data_schema validations during compilation.
   * Called after graph validation, before step compilation.
   * (Tasks 3.2, 3.4, 3.5, 3.6, 3.9)
   */
  private validateDataSchemaInCompiler(graph: ExecutionGraph, ctx: CompilerContext): void {
    if (!graph.data_schema) return

    this.log(ctx, 'Validating data_schema in compiler')

    // Plugin cross-validation (3.2)
    this.validateSchemaAgainstPlugins(graph, ctx)

    // Per-node schema validations
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      // Shape-preserving transform validation (3.4)
      if (node.type === 'operation' && node.operation?.operation_type === 'transform') {
        this.validateShapePreservingTransform(nodeId, node, graph, ctx)
      }

      // Loop schema validation (3.5)
      if (node.type === 'loop') {
        this.validateLoopSchema(nodeId, node, graph, ctx)
      }

      // Choice schema validation (3.6)
      if (node.type === 'choice') {
        this.validateChoiceSchema(nodeId, node, graph, ctx)
      }
    }

    // Cross-step type compatibility (3.9)
    this.validateCrossStepTypeCompatibility(graph, ctx)
  }

  /**
   * Cross-step type compatibility: verify AI output field types match
   * downstream plugin input parameter types.
   * (Task 3.9)
   */
  private validateCrossStepTypeCompatibility(graph: ExecutionGraph, ctx: CompilerContext): void {
    const dataSchema = graph.data_schema
    if (!dataSchema) return

    // For each node, check if its input slot type is compatible with what was produced
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
          }
        }
      }
    }
  }

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
