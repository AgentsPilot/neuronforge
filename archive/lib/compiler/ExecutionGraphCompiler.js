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
import { validateExecutionGraph } from '../logical-ir/validation/ExecutionGraphValidator';
import { createLogger } from '@/lib/logger';
import { analyzeOutputSchema } from '@/lib/pilot/utils/SchemaAwareDataExtractor';
const moduleLogger = createLogger({ module: 'V6', service: 'ExecutionGraphCompiler' });
/**
 * Execution Graph Compiler
 */
export class ExecutionGraphCompiler {
    constructor(pluginManager) {
        this.logger = moduleLogger;
        this.pluginManager = pluginManager;
    }
    /**
     * Main compilation entry point
     *
     * @param ir - Declarative Logical IR v4.0 with execution graph
     * @param workflowConfig - Optional workflow configuration extracted from enhanced prompt (resolved_user_inputs)
     */
    async compile(ir, workflowConfig) {
        const startTime = Date.now();
        const ctx = {
            stepCounter: 0,
            logs: [],
            warnings: [],
            pluginsUsed: new Set(),
            variableMap: new Map(),
            currentScope: 'global',
            loopContextStack: [],
            loopDepth: 0,
            ir,
            workflowConfig
        };
        try {
            this.log(ctx, `Starting execution graph compilation`);
            // Validate IR version
            if (ir.ir_version !== '4.0') {
                return {
                    success: false,
                    workflow: [],
                    logs: ctx.logs,
                    errors: [`Invalid IR version: ${ir.ir_version}. Expected '4.0'`]
                };
            }
            // Validate execution graph exists
            if (!ir.execution_graph) {
                return {
                    success: false,
                    workflow: [],
                    logs: ctx.logs,
                    errors: ['Missing execution_graph in IR v4.0']
                };
            }
            const graph = ir.execution_graph;
            // Phase 1: Validate execution graph
            this.log(ctx, 'Phase 1: Validating execution graph');
            const validationResult = validateExecutionGraph(graph);
            if (!validationResult.valid) {
                const errorMessages = validationResult.errors.map(e => `[${e.category}] ${e.node_id ? `Node ${e.node_id}: ` : ''}${e.message}`);
                return {
                    success: false,
                    workflow: [],
                    logs: ctx.logs,
                    errors: errorMessages,
                    validation_result: validationResult
                };
            }
            if (validationResult.warnings.length > 0) {
                for (const warning of validationResult.warnings) {
                    this.warn(ctx, `${warning.node_id ? `Node ${warning.node_id}: ` : ''}${warning.message}`);
                }
            }
            // Phase 2: Initialize variable map from declarations
            this.log(ctx, 'Phase 2: Initializing variable declarations');
            this.initializeVariables(graph, ctx);
            // Phase 3: Traverse graph and compile nodes
            this.log(ctx, 'Phase 3: Compiling execution graph to workflow steps');
            let workflow = await this.compileGraph(graph, ctx);
            // Phase 3.5: Normalize data formats (auto-insert rows_to_objects for 2D arrays)
            this.log(ctx, 'Phase 3.5: Normalizing data formats');
            workflow = this.normalizeDataFormats(workflow, ctx);
            // Phase 3.6: Renumber steps sequentially after normalization
            workflow = this.renumberSteps(workflow);
            // Phase 4: Post-compilation optimization
            this.log(ctx, 'Phase 4: Running post-compilation optimizations');
            const optimizedWorkflow = await this.optimizeWorkflow(workflow, ctx);
            const compilationTime = Date.now() - startTime;
            this.log(ctx, `Compilation complete in ${compilationTime}ms`);
            return {
                success: true,
                workflow: optimizedWorkflow,
                logs: ctx.logs,
                plugins_used: Array.from(ctx.pluginsUsed),
                compilation_time_ms: compilationTime,
                validation_result: validationResult
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(ctx, `Compilation failed: ${errorMessage}`);
            return {
                success: false,
                workflow: [],
                logs: ctx.logs,
                errors: [errorMessage]
            };
        }
    }
    /**
     * Initialize variable map from graph variable declarations
     */
    initializeVariables(graph, ctx) {
        if (!graph.variables)
            return;
        for (const variable of graph.variables) {
            ctx.variableMap.set(variable.name, {
                type: variable.type,
                scope: variable.scope,
                default_value: variable.default_value
            });
            this.log(ctx, `Declared variable: ${variable.name} (${variable.type}, ${variable.scope})`);
        }
    }
    /**
     * Compile entire graph to workflow steps
     */
    async compileGraph(graph, ctx) {
        const steps = [];
        const visited = new Set();
        // Start from the start node
        const startNodeId = graph.start;
        this.log(ctx, `Starting compilation from node: ${startNodeId}`);
        await this.compileNode(startNodeId, graph, ctx, steps, visited);
        return steps;
    }
    /**
     * Compile a single node and its descendants
     */
    async compileNode(nodeId, graph, ctx, steps, visited) {
        // Prevent infinite loops (though validator should catch cycles)
        if (visited.has(nodeId)) {
            this.warn(ctx, `Node ${nodeId} already visited, skipping to prevent cycle`);
            return;
        }
        const node = graph.nodes[nodeId];
        if (!node) {
            this.warn(ctx, `Node ${nodeId} not found in graph`);
            return;
        }
        visited.add(nodeId);
        this.log(ctx, `Compiling node: ${nodeId} (type: ${node.type})`);
        // Compile based on node type
        switch (node.type) {
            case 'operation':
                await this.compileOperationNode(node, graph, ctx, steps, visited);
                break;
            case 'choice':
                await this.compileChoiceNode(node, graph, ctx, steps, visited);
                break;
            case 'loop':
                await this.compileLoopNode(node, graph, ctx, steps, visited);
                break;
            case 'parallel':
                await this.compileParallelNode(node, graph, ctx, steps, visited);
                break;
            case 'end':
                // End nodes don't generate steps, they just mark termination
                this.log(ctx, `Reached end node: ${nodeId}`);
                break;
            default:
                this.warn(ctx, `Unknown node type: ${node.type}`);
        }
        // After compiling this node, continue to next node(s)
        if (node.next && node.type !== 'choice' && node.type !== 'loop' && node.type !== 'parallel') {
            const nextIds = Array.isArray(node.next) ? node.next : [node.next];
            for (const nextId of nextIds) {
                await this.compileNode(nextId, graph, ctx, steps, visited);
            }
        }
    }
    /**
     * Compile an operation node
     */
    async compileOperationNode(node, graph, ctx, steps, visited) {
        if (!node.operation) {
            this.warn(ctx, `Operation node ${node.id} missing operation config`);
            return;
        }
        const operation = node.operation;
        const stepId = `step_${++ctx.stepCounter}`;
        // Resolve input variables
        const resolvedConfig = this.resolveVariables(operation, node.inputs || [], ctx);
        // Extract input variable from node.inputs array
        // If the input has a path, include it in the variable reference
        const inputVariable = node.inputs && node.inputs.length > 0
            ? this.buildInputReference(node.inputs[0])
            : undefined;
        let workflowStep;
        switch (operation.operation_type) {
            case 'fetch':
                workflowStep = this.compileFetchOperation(stepId, node.id, operation, resolvedConfig, ctx);
                break;
            case 'transform':
                workflowStep = await this.compileTransformOperation(stepId, node.id, operation, resolvedConfig, inputVariable, ctx, graph);
                break;
            case 'ai':
                workflowStep = this.compileAIOperation(stepId, node.id, operation, resolvedConfig, inputVariable, ctx);
                break;
            case 'deliver':
                workflowStep = this.compileDeliverOperation(stepId, node.id, operation, resolvedConfig, ctx);
                break;
            case 'file_op':
                workflowStep = this.compileFileOperation(stepId, node.id, operation, resolvedConfig, ctx);
                break;
            default:
                this.warn(ctx, `Unknown operation type: ${operation.operation_type}`);
                return;
        }
        // Set output variable if specified
        // CRITICAL FIX: Support OutputBinding.path field for nested output paths
        // This fixes the bug where output path was defined in schema but never used
        if (node.outputs && node.outputs.length > 0) {
            const output = node.outputs[0];
            if (output.path) {
                // Concatenate variable and path for nested field access
                workflowStep.output_variable = `${output.variable}.${output.path}`;
                this.log(ctx, `  → Output with path: ${output.variable}.${output.path}`);
            }
            else {
                workflowStep.output_variable = output.variable;
            }
            // Track output variable in loop context if we're inside a loop
            if (ctx.loopContextStack.length > 0 && workflowStep.output_variable) {
                const currentLoop = ctx.loopContextStack[ctx.loopContextStack.length - 1];
                currentLoop.outputVariables.push(workflowStep.output_variable);
                this.log(ctx, `  → Registered '${workflowStep.output_variable}' in loop context`);
            }
        }
        steps.push(workflowStep);
        this.log(ctx, `  → Generated step: ${stepId} (${workflowStep.type})`);
    }
    /**
     * Compile fetch operation
     */
    compileFetchOperation(stepId, nodeId, operation, resolvedConfig, ctx) {
        const fetch = operation.fetch;
        ctx.pluginsUsed.add(fetch.plugin_key);
        // Build params using plugin schema to ensure correct parameter names
        const config = this.buildParamsFromSchema(fetch.plugin_key, fetch.action, resolvedConfig.fetch?.config || {});
        return {
            step_id: stepId,
            type: 'action',
            description: operation.description || `Fetch data using ${fetch.plugin_key}`,
            plugin: fetch.plugin_key,
            operation: fetch.action,
            config
        };
    }
    /**
     * Compile transform operation with context-aware intelligence
     */
    async compileTransformOperation(stepId, nodeId, operation, resolvedConfig, inputVariable, ctx, graph) {
        const transform = operation.transform;
        // Extract input: prioritize explicit transform.input, then node's inputVariable, then config
        const input = transform.input ||
            (inputVariable ? `{{${inputVariable}}}` : undefined) ||
            resolvedConfig.transform?.input;
        // STEP 1: Detect if this transform is unnecessary
        const detection = this.detectUnnecessaryTransform(nodeId, transform, graph);
        if (detection.isUnnecessary) {
            this.warn(ctx, `Transform ${nodeId} appears unnecessary: ${detection.reason}`);
            this.log(ctx, `  Suggestion: ${detection.suggestion}`);
        }
        // STEP 2: Find downstream delivery nodes
        const deliveryNodes = this.findDownstreamDeliveryNodes(nodeId, graph);
        if (deliveryNodes.length === 0) {
            this.log(ctx, `  Transform ${nodeId}: No downstream delivery nodes found (may deliver elsewhere)`);
        }
        // STEP 3: Analyze required data formats from delivery destinations
        const formats = await this.determineRequiredFormat(deliveryNodes);
        if (deliveryNodes.length > 0) {
            this.log(ctx, `  Transform ${nodeId} downstream analysis: ` +
                `${formats.deliveryDetails.length} delivery nodes, ` +
                `requires: ${formats.needs2DArray ? '2D-array ' : ''}` +
                `${formats.needsHTML ? 'HTML ' : ''}${formats.needsPlainText ? 'text' : ''}`);
        }
        // STEP 4: Choose appropriate operation based on requirements
        const irType = transform.type;
        let pilotOperation = this.chooseTransformOperation(transform, formats, nodeId, ctx);
        // STEP 5: Validate against PILOT runtime-supported operations
        // This list comes from lib/pilot/schema/runtime-validator.ts and lib/pilot/StepExecutor.ts
        const validPilotOps = [
            'set', 'map', 'filter', 'reduce', 'sort',
            'group', 'group_by', // group_by is alias for group
            'aggregate', 'deduplicate',
            'flatten', 'join', 'pivot', 'split', 'expand',
            'partition', // Partition data by field value
            'rows_to_objects', // For converting 2D arrays (like Sheets) to objects
            'map_headers', // Normalize/rename headers in 2D arrays
            'render_table', // For rendering data as HTML/formatted tables
            'fetch_content' // For fetching attachment/file content from plugins
        ];
        if (!validPilotOps.includes(pilotOperation)) {
            this.warn(ctx, `Invalid transform type '${irType}' → '${pilotOperation}', defaulting to 'map'`);
            pilotOperation = 'map';
        }
        // STEP 6: Validate the choice (type checking) and FAIL if incorrect
        // ARCHITECTURAL FIX: Don't silently change operation types - fail compilation
        // This forces the IR to be corrected rather than generating broken DSL
        const node = graph.nodes[nodeId];
        let inputVarPath = node.inputs?.[0]?.variable;
        let inputSource = 'node.inputs';
        // Prefer transform.input over node.inputs for transform operations
        // (transform.input has the full {{...}} reference, node.inputs might just have variable name)
        if (transform.input) {
            // Extract variable reference from {{...}}
            const varMatch = transform.input.match(/^{{(.+?)}}$/);
            inputVarPath = varMatch ? varMatch[1] : transform.input;
            inputSource = 'transform.input';
        }
        else if (!inputVarPath) {
            // No input found
            inputVarPath = undefined;
        }
        if (inputVarPath && ['map', 'filter', 'reduce'].includes(pilotOperation)) {
            // Check if using nested field access (e.g., "current_email.attachments")
            const hasNestedAccess = inputVarPath.includes('.');
            this.log(ctx, `  Validating ${pilotOperation} input: "${inputVarPath}" (from ${inputSource}, hasNestedAccess: ${hasNestedAccess})`);
            // Only validate if NOT using nested access
            if (!hasNestedAccess) {
                const baseVar = inputVarPath.split('.')[0];
                const varDecl = graph.variables?.find(v => v.name === baseVar);
                if (varDecl && varDecl.type !== 'array') {
                    throw new Error(`Transform node '${nodeId}' uses operation '${pilotOperation}' which requires array input, ` +
                        `but variable '${baseVar}' is declared as type '${varDecl.type}'. ` +
                        `This is an IR generation error - the variable type or operation type must be fixed in the IR. ` +
                        `Options: (1) Change variable '${baseVar}' type to 'array' if it holds array data, ` +
                        `OR (2) Change transform operation from '${pilotOperation}' to appropriate operation for ${varDecl.type} data.`);
                }
            }
            // If using nested access (e.g., current_email.attachments), skip validation
            // The nested field might be an array even if the base variable is an object
        }
        // Transform the config to convert IR format to PILOT DSL format
        const transformedConfig = this.transformConditionFormat(resolvedConfig.transform || {});
        // CRITICAL FIX: Map transform-type-specific config fields to PILOT DSL format
        // This fixes the bug where IR schema fields (filter_expression, map_expression, etc.)
        // were being ignored during compilation, causing runtime failures
        const transformConfig = resolvedConfig.transform;
        if (transformConfig && transformConfig.type) {
            if (transformConfig.type === 'filter') {
                // IR field: filter_expression → DSL field: condition
                if (transformConfig.filter_expression) {
                    transformedConfig.condition = this.transformConditionObject(transformConfig.filter_expression);
                    this.log(ctx, `  → Compiled filter_expression to condition`);
                }
            }
            else if (transformConfig.type === 'map') {
                // IR field: map_expression → DSL field: expression
                if (transformConfig.map_expression) {
                    transformedConfig.expression = transformConfig.map_expression;
                    this.log(ctx, `  → Compiled map_expression to expression`);
                }
            }
            else if (transformConfig.type === 'reduce') {
                // IR field: reduce_operation → DSL field: reducer
                if (transformConfig.reduce_operation) {
                    transformedConfig.reducer = transformConfig.reduce_operation;
                    this.log(ctx, `  → Compiled reduce_operation to reducer`);
                }
            }
            else if (transformConfig.type === 'group_by') {
                // IR field: group_by_field → DSL field: group_by
                if (transformConfig.group_by_field) {
                    transformedConfig.group_by = transformConfig.group_by_field;
                    this.log(ctx, `  → Compiled group_by_field to group_by`);
                }
            }
            else if (transformConfig.type === 'sort') {
                // IR fields: sort_field, sort_order → DSL fields: sort_by, order
                if (transformConfig.sort_field) {
                    transformedConfig.sort_by = transformConfig.sort_field;
                    this.log(ctx, `  → Compiled sort_field to sort_by`);
                }
                if (transformConfig.sort_order) {
                    transformedConfig.order = transformConfig.sort_order;
                    this.log(ctx, `  → Compiled sort_order to order`);
                }
            }
            else if (transformConfig.type === 'custom' && transformConfig.custom_code) {
                // IR field: custom_code → DSL field: custom_code (experimental)
                transformedConfig.custom_code = transformConfig.custom_code;
                this.warn(ctx, `Custom code transforms are experimental: ${nodeId}`);
            }
        }
        this.log(ctx, `  Transform ${nodeId}: ${irType} → ${pilotOperation}`);
        // STEP 7: Inject additional loop context variables if transform has additional_inputs
        // This handles multi-input transforms (e.g., merge operations that need multiple variables)
        if (transform.additional_inputs && transform.additional_inputs.length > 0) {
            this.log(ctx, `  → Transform has ${transform.additional_inputs.length} additional inputs`);
            for (const additionalVar of transform.additional_inputs) {
                if (!transformedConfig[additionalVar]) {
                    transformedConfig[additionalVar] = `{{${additionalVar}}}`;
                    this.log(ctx, `    → Injected additional input: ${additionalVar}`);
                }
            }
        }
        // STEP 8: Auto-inject loop context variables for merge/custom transforms
        // If we're in a loop and the transform has custom_code that mentions combining/merging,
        // automatically inject all loop-scoped variables into the config
        if (ctx.loopContextStack.length > 0 && (pilotOperation === 'map' || pilotOperation === 'custom')) {
            const customCode = transform.custom_code || '';
            const needsLoopVars = customCode.toLowerCase().includes('combine') ||
                customCode.toLowerCase().includes('merge') ||
                customCode.toLowerCase().includes('metadata') ||
                customCode.toLowerCase().includes('email') ||
                customCode.toLowerCase().includes('file');
            if (needsLoopVars) {
                const currentLoop = ctx.loopContextStack[ctx.loopContextStack.length - 1];
                this.log(ctx, `  → Transform needs loop context variables (detected from custom_code)`);
                // Inject item variable
                if (!transformedConfig[currentLoop.itemVariable]) {
                    transformedConfig[currentLoop.itemVariable] = `{{${currentLoop.itemVariable}}}`;
                    this.log(ctx, `    → Injected loop item variable: ${currentLoop.itemVariable}`);
                }
                // Inject all output variables from previous steps in loop
                for (const outputVar of currentLoop.outputVariables) {
                    if (!transformedConfig[outputVar] && outputVar !== input?.replace(/[{}]/g, '')) {
                        transformedConfig[outputVar] = `{{${outputVar}}}`;
                        this.log(ctx, `    → Injected loop output variable: ${outputVar}`);
                    }
                }
            }
        }
        // PILOT format: input at top level, not in config
        return {
            step_id: stepId,
            type: 'transform',
            operation: pilotOperation, // PILOT expects 'operation' field for transform type
            input: input, // PILOT expects input at top level
            description: operation.description || `Transform: ${pilotOperation}`,
            config: transformedConfig // Use transformed config
        };
    }
    /**
     * Compile AI operation
     */
    compileAIOperation(stepId, nodeId, operation, resolvedConfig, inputVariable, ctx) {
        const ai = operation.ai;
        // Extract input: prioritize explicit ai.input, then node's inputVariable
        const input = ai.input ||
            (inputVariable ? `{{${inputVariable}}}` : undefined);
        // CRITICAL: deterministic_extract → deterministic_extraction step type
        // Uses PDF parser + AWS Textract before AI (not pure LLM)
        const stepType = ai.type === 'deterministic_extract'
            ? 'deterministic_extraction'
            : 'ai_processing';
        // PILOT format: input and prompt at top level
        // NOTE: Model is NOT included - it's determined by runtime routing in StepExecutor
        return {
            step_id: stepId,
            type: stepType,
            input: input, // PILOT expects input at top level
            prompt: ai.instruction, // PILOT expects prompt at top level
            description: operation.description || `AI: ${ai.type}`,
            config: {
                ai_type: ai.type,
                output_schema: ai.output_schema,
                temperature: ai.temperature,
                ...resolvedConfig.ai
            }
        };
    }
    /**
     * Compile deliver operation
     */
    compileDeliverOperation(stepId, nodeId, operation, resolvedConfig, ctx) {
        const deliver = operation.deliver;
        ctx.pluginsUsed.add(deliver.plugin_key);
        // Build params using plugin schema to ensure correct parameter names
        const config = this.buildParamsFromSchema(deliver.plugin_key, deliver.action, resolvedConfig.deliver?.config || {});
        return {
            step_id: stepId,
            type: 'action',
            description: operation.description || `Deliver using ${deliver.plugin_key}`,
            plugin: deliver.plugin_key,
            operation: deliver.action,
            config
        };
    }
    /**
     * Compile file operation
     */
    compileFileOperation(stepId, nodeId, operation, resolvedConfig, ctx) {
        const fileOp = operation.file_op;
        if (fileOp.plugin_key) {
            ctx.pluginsUsed.add(fileOp.plugin_key);
        }
        return {
            step_id: stepId,
            type: 'action',
            description: operation.description || `File operation: ${fileOp.type}`,
            plugin: fileOp.plugin_key,
            operation: fileOp.action,
            config: resolvedConfig.file_op?.config || {}
        };
    }
    /**
     * Compile a choice (conditional) node
     */
    async compileChoiceNode(node, graph, ctx, steps, visited) {
        if (!node.choice) {
            this.warn(ctx, `Choice node ${node.id} missing choice config`);
            return;
        }
        const choice = node.choice;
        const stepId = `step_${++ctx.stepCounter}`;
        // CRITICAL FIX: Merge node.inputs path with condition variable references
        // This fixes the bug where choice conditions ignored path navigation from inputs
        let conditionToConvert = choice.rules[0]?.condition;
        if (node.inputs && node.inputs.length > 0) {
            const inputBinding = node.inputs[0];
            if (inputBinding.path && conditionToConvert) {
                conditionToConvert = this.mergeInputPathWithCondition(conditionToConvert, inputBinding);
                this.log(ctx, `  → Merged input path '${inputBinding.path}' into choice condition`);
            }
        }
        // Build conditional step with branches
        const conditionalStep = {
            step_id: stepId,
            type: 'conditional',
            description: choice.description || `Conditional: ${node.id}`,
            condition: this.convertCondition(conditionToConvert),
            steps: []
        };
        // Compile branches for each rule
        for (let i = 0; i < choice.rules.length; i++) {
            const rule = choice.rules[i];
            const branchSteps = [];
            const branchVisited = new Set(visited);
            await this.compileNode(rule.next, graph, ctx, branchSteps, branchVisited);
            if (i === 0) {
                // First rule uses the main condition
                conditionalStep.steps = branchSteps;
            }
            else {
                // Additional rules would need nested conditionals (simplified for now)
                this.warn(ctx, `Multiple choice rules not fully supported yet, using first rule only`);
            }
        }
        // Add else branch (default path)
        const elseSteps = [];
        const elseVisited = new Set(visited);
        await this.compileNode(choice.default, graph, ctx, elseSteps, elseVisited);
        if (elseSteps.length > 0) {
            conditionalStep.else_steps = elseSteps;
        }
        steps.push(conditionalStep);
        this.log(ctx, `  → Generated conditional step: ${stepId}`);
    }
    /**
     * Compile a loop node
     */
    async compileLoopNode(node, graph, ctx, steps, visited) {
        if (!node.loop) {
            this.warn(ctx, `Loop node ${node.id} missing loop config`);
            return;
        }
        const loop = node.loop;
        const stepId = `step_${++ctx.stepCounter}`;
        // Compile loop body with loop context tracking
        ctx.loopDepth++;
        // Push loop context onto stack
        const loopContext = {
            itemVariable: loop.item_variable,
            outputVariables: []
        };
        ctx.loopContextStack.push(loopContext);
        this.log(ctx, `  → Entered loop context: ${loop.item_variable}`);
        const bodySteps = [];
        const bodyVisited = new Set(); // Don't include parent visited to allow loop body compilation
        await this.compileNode(loop.body_start, graph, ctx, bodySteps, bodyVisited);
        // Track output variables created in loop body
        for (const step of bodySteps) {
            if (step.output_variable) {
                loopContext.outputVariables.push(step.output_variable);
            }
        }
        // Pop loop context
        ctx.loopContextStack.pop();
        ctx.loopDepth--;
        this.log(ctx, `  → Exited loop context (${loopContext.outputVariables.length} variables created)`);
        // CRITICAL FIX: Determine scatter-gather input from node.inputs if available
        // This fixes the bug where loop with inputs:[{variable:"emails_result", path:"emails"}]
        // was being compiled to input:"{{emails_result}}" instead of "{{emails_result.emails}}"
        let scatterInput = `{{${loop.iterate_over}}}`;
        if (node.inputs && node.inputs.length > 0) {
            const firstInput = node.inputs[0];
            if (firstInput.path) {
                // Use variable.path for nested field access
                scatterInput = `{{${firstInput.variable}.${firstInput.path}}}`;
                this.log(ctx, `  → Loop input resolved from inputs with path: ${scatterInput}`);
            }
            else {
                // Use just variable if no path
                scatterInput = `{{${firstInput.variable}}}`;
                this.log(ctx, `  → Loop input resolved from inputs without path: ${scatterInput}`);
            }
        }
        else {
            // Fall back to iterate_over field (backward compatible)
            this.log(ctx, `  → Loop input using iterate_over field: ${scatterInput}`);
        }
        // Create scatter_gather step
        const scatterGatherStep = {
            step_id: stepId,
            type: 'scatter_gather',
            description: loop.description || `Loop over ${loop.iterate_over}`,
            scatter: {
                input: scatterInput, // ✅ Now uses path from inputs if available
                steps: bodySteps,
                itemVariable: loop.item_variable,
                maxConcurrency: loop.concurrency
            },
            gather: {
                operation: loop.collect_outputs ? 'collect' : 'flatten',
                outputKey: loop.output_variable
            },
            output_variable: loop.output_variable // ✅ Register as named variable for access by later steps
        };
        steps.push(scatterGatherStep);
        this.log(ctx, `  → Generated scatter_gather step: ${stepId}`);
        // Continue to next node after loop
        if (node.next) {
            const nextIds = Array.isArray(node.next) ? node.next : [node.next];
            for (const nextId of nextIds) {
                await this.compileNode(nextId, graph, ctx, steps, visited);
            }
        }
    }
    /**
     * Compile a parallel node
     */
    async compileParallelNode(node, graph, ctx, steps, visited) {
        if (!node.parallel) {
            this.warn(ctx, `Parallel node ${node.id} missing parallel config`);
            return;
        }
        const parallel = node.parallel;
        const stepId = `step_${++ctx.stepCounter}`;
        // Compile each branch
        const branches = [];
        for (const branch of parallel.branches) {
            const branchSteps = [];
            const branchVisited = new Set();
            await this.compileNode(branch.start, graph, ctx, branchSteps, branchVisited);
            // Wrap branch steps in a sub-workflow
            const branchStep = {
                step_id: `${stepId}_branch_${branch.id}`,
                type: 'sub_workflow',
                description: branch.description || `Parallel branch: ${branch.id}`,
                steps: branchSteps
            };
            branches.push(branchStep);
        }
        // Create parallel step
        const parallelStep = {
            step_id: stepId,
            type: 'parallel',
            description: parallel.description || `Parallel execution: ${node.id}`,
            steps: branches,
            config: {
                wait_strategy: parallel.wait_strategy,
                wait_count: parallel.wait_count,
                timeout_ms: parallel.timeout_ms
            }
        };
        steps.push(parallelStep);
        this.log(ctx, `  → Generated parallel step: ${stepId} with ${branches.length} branches`);
        // Continue to next node after parallel
        if (node.next) {
            const nextIds = Array.isArray(node.next) ? node.next : [node.next];
            for (const nextId of nextIds) {
                await this.compileNode(nextId, graph, ctx, steps, visited);
            }
        }
    }
    /**
     * Resolve variable references in configuration
     */
    resolveVariables(operation, inputs, ctx) {
        // For now, return the operation config as-is
        // Variable resolution happens at runtime via {{variable}} syntax
        // This method can be enhanced to validate variable references
        return operation;
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
    transformConditionFormat(config) {
        if (!config || typeof config !== 'object') {
            return config;
        }
        // Deep clone to avoid mutating original
        const transformed = JSON.parse(JSON.stringify(config));
        // Transform the 'condition' field if it exists (for filter/conditional operations)
        if (transformed.condition && typeof transformed.condition === 'object') {
            transformed.condition = this.transformConditionObject(transformed.condition);
        }
        // Transform the 'filters' field if it exists (alternate IR format for filter operations)
        // Some IR generation uses 'filters' instead of 'condition', so convert it to 'condition'
        if (transformed.filters && typeof transformed.filters === 'object') {
            transformed.condition = this.transformConditionObject(transformed.filters);
            delete transformed.filters; // Remove the IR-specific 'filters' key
        }
        // Transform any other nested objects
        for (const key in transformed) {
            if (key === 'condition' || key === 'filters') {
                continue; // Already handled
            }
            if (typeof transformed[key] === 'object' && transformed[key] !== null && !Array.isArray(transformed[key])) {
                transformed[key] = this.transformConditionFormat(transformed[key]);
            }
            else if (Array.isArray(transformed[key])) {
                transformed[key] = transformed[key].map((item) => {
                    if (typeof item === 'object' && item !== null) {
                        return this.transformConditionFormat(item);
                    }
                    return item;
                });
            }
        }
        return transformed;
    }
    /**
     * Transform a single condition object from IR format to PILOT DSL format
     *
     * PILOT DSL uses conditionType discriminators:
     * - Simple: { conditionType: 'simple', field, operator, value }
     * - Complex: { conditionType: 'complex_or|complex_and|complex_not', conditions/condition }
     */
    transformConditionObject(condition) {
        if (!condition || typeof condition !== 'object') {
            return condition;
        }
        const result = { ...condition };
        // Case 1: IR formalization format { conditions: [...], combineWith: "OR"|"AND"|"NOT" }
        if (result.conditions && result.combineWith) {
            const combineWith = result.combineWith.toUpperCase();
            if (combineWith === 'OR') {
                return {
                    conditionType: 'complex_or',
                    conditions: result.conditions.map((c) => this.transformConditionObject(c))
                };
            }
            else if (combineWith === 'AND') {
                return {
                    conditionType: 'complex_and',
                    conditions: result.conditions.map((c) => this.transformConditionObject(c))
                };
            }
            else if (combineWith === 'NOT' && result.conditions.length === 1) {
                return {
                    conditionType: 'complex_not',
                    condition: this.transformConditionObject(result.conditions[0])
                };
            }
            else {
                // Unknown - default to AND
                console.warn(`[ExecutionGraphCompiler] Unknown combineWith: ${combineWith}, defaulting to AND`);
                return {
                    conditionType: 'complex_and',
                    conditions: result.conditions.map((c) => this.transformConditionObject(c))
                };
            }
        }
        // Case 2: IR v4 format { type: "simple", variable, operator, value }
        if (result.type === 'simple') {
            delete result.type;
            // Rename 'variable' to 'field' for PILOT DSL
            if (result.variable) {
                result.field = result.variable;
                delete result.variable;
            }
            // Add conditionType discriminator
            result.conditionType = 'simple';
            return result;
        }
        // Case 3: IR v4 format { type: "complex", operator: "and"|"or"|"not", conditions: [...] }
        if (result.type === 'complex') {
            delete result.type;
            const op = result.operator?.toLowerCase();
            if (op === 'and' && result.conditions) {
                return {
                    conditionType: 'complex_and',
                    conditions: result.conditions.map((c) => this.transformConditionObject(c))
                };
            }
            else if (op === 'or' && result.conditions) {
                return {
                    conditionType: 'complex_or',
                    conditions: result.conditions.map((c) => this.transformConditionObject(c))
                };
            }
            else if (op === 'not' && result.conditions && result.conditions.length === 1) {
                return {
                    conditionType: 'complex_not',
                    condition: this.transformConditionObject(result.conditions[0])
                };
            }
        }
        // Case 4: Already valid PILOT format with conditionType
        if (result.conditionType) {
            // Already has discriminator - just recurse on nested conditions
            if (result.conditions) {
                result.conditions = result.conditions.map((c) => this.transformConditionObject(c));
            }
            if (result.condition) {
                result.condition = this.transformConditionObject(result.condition);
            }
            return result;
        }
        // Case 5: Legacy PILOT format without conditionType { and: [...] }, { or: [...] }, { not: {...} }
        if (result.and) {
            return {
                conditionType: 'complex_and',
                conditions: result.and.map((c) => this.transformConditionObject(c))
            };
        }
        if (result.or) {
            return {
                conditionType: 'complex_or',
                conditions: result.or.map((c) => this.transformConditionObject(c))
            };
        }
        if (result.not) {
            return {
                conditionType: 'complex_not',
                condition: this.transformConditionObject(result.not)
            };
        }
        // Case 6: Simple condition { field, operator, value } - add conditionType
        if (result.field && result.operator !== undefined) {
            result.conditionType = 'simple';
            return result;
        }
        // Unknown format - log warning and return as-is
        if (Object.keys(result).length > 0) {
            console.warn(`[ExecutionGraphCompiler] Unknown condition format: ${JSON.stringify(result)}`);
        }
        return result;
    }
    /**
     * Build parameters from IR config using plugin schema
     * This ensures parameter names match the plugin schema (e.g., "range" not "sheet_name")
     */
    buildParamsFromSchema(pluginKey, actionName, irConfig) {
        if (!this.pluginManager || !irConfig) {
            return irConfig;
        }
        try {
            const plugins = this.pluginManager.getAvailablePlugins();
            const pluginDef = plugins[pluginKey];
            if (!pluginDef || !pluginDef.actions || !pluginDef.actions[actionName]) {
                return irConfig; // Plugin or action not found, return as-is
            }
            const actionDef = pluginDef.actions[actionName];
            const schema = actionDef.parameters;
            if (!schema || !schema.properties) {
                return irConfig; // No schema, return as-is
            }
            const params = {};
            const schemaProps = Object.keys(schema.properties);
            // Iterate over schema properties and try to find matching values in IR config
            for (const schemaParamName of schemaProps) {
                // First check if IR config has this exact parameter name
                if (schemaParamName in irConfig) {
                    params[schemaParamName] = irConfig[schemaParamName];
                    continue;
                }
                // Check for common mismatches (case-insensitive, underscore/dash variations)
                const normalizedSchemaName = schemaParamName.toLowerCase().replace(/[_-]/g, '');
                for (const [irParamName, irParamValue] of Object.entries(irConfig)) {
                    const normalizedIrName = irParamName.toLowerCase().replace(/[_-]/g, '');
                    // If normalized names match, use the schema parameter name
                    if (normalizedSchemaName === normalizedIrName) {
                        params[schemaParamName] = irParamValue;
                        break;
                    }
                }
            }
            // Also include any IR params that weren't matched (for forward compatibility)
            for (const [irParamName, irParamValue] of Object.entries(irConfig)) {
                if (!(irParamName in params) && !schemaProps.some(sp => {
                    const normalized = sp.toLowerCase().replace(/[_-]/g, '');
                    return normalized === irParamName.toLowerCase().replace(/[_-]/g, '');
                })) {
                    params[irParamName] = irParamValue;
                }
            }
            return params;
        }
        catch (error) {
            // If validation fails, return original config
            return irConfig;
        }
    }
    /**
     * Convert IR condition to PILOT DSL condition
     */
    convertCondition(condition) {
        if (condition.type === 'simple') {
            return this.convertSimpleCondition(condition);
        }
        else {
            return this.convertComplexCondition(condition);
        }
    }
    /**
     * Convert simple condition
     * Generates PILOT DSL format with conditionType discriminator
     */
    convertSimpleCondition(condition) {
        const operatorMap = {
            'eq': 'equals',
            'ne': 'not_equals',
            'gt': 'greater_than',
            'lt': 'less_than',
            'gte': 'greater_than_or_equal',
            'lte': 'less_than_or_equal',
            'contains': 'contains',
            'is_empty': 'is_empty'
        };
        return {
            conditionType: 'simple',
            field: condition.variable,
            operator: operatorMap[condition.operator] || condition.operator,
            value: condition.value
        };
    }
    /**
     * Convert complex condition
     * Generates PILOT DSL format with conditionType discriminator
     */
    convertComplexCondition(condition) {
        const subConditions = condition.conditions.map(c => this.convertCondition(c));
        if (condition.operator === 'and') {
            return {
                conditionType: 'complex_and',
                conditions: subConditions
            };
        }
        else if (condition.operator === 'or') {
            return {
                conditionType: 'complex_or',
                conditions: subConditions
            };
        }
        else if (condition.operator === 'not') {
            return {
                conditionType: 'complex_not',
                condition: subConditions[0]
            };
        }
        return subConditions[0];
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
    validateHardRequirementsEnforcement(workflow, hardRequirements, ctx) {
        const errors = [];
        const warnings = [];
        this.log(ctx, `Validating ${hardRequirements.requirements.length} hard requirements using structural validation`);
        // Build workflow step map for graph traversal
        const stepMap = this.buildStepMap(workflow);
        // Validate thresholds using structural validation (not string matching)
        for (const threshold of hardRequirements.thresholds) {
            const result = this.validateThresholdEnforcement(threshold, workflow, stepMap, ctx);
            errors.push(...result.errors);
            warnings.push(...result.warnings);
        }
        // Validate sequential dependencies using graph reachability
        for (const invariant of hardRequirements.invariants) {
            if (invariant.type === 'sequential_dependency') {
                const result = this.validateSequentialDependency(invariant, workflow, stepMap, ctx);
                errors.push(...result.errors);
                warnings.push(...result.warnings);
            }
            else if (invariant.type === 'no_duplicate_writes') {
                const result = this.validateNoDuplicateWrites(invariant, workflow, ctx);
                errors.push(...result.errors);
                warnings.push(...result.warnings);
            }
        }
        // Validate routing rules using structural validation
        for (const rule of hardRequirements.routing_rules) {
            const result = this.validateRoutingRule(rule, workflow, stepMap, ctx);
            errors.push(...result.errors);
            warnings.push(...result.warnings);
        }
        // Validate required outputs are captured
        for (const requiredOutput of hardRequirements.required_outputs) {
            const result = this.validateRequiredOutput(requiredOutput, workflow, ctx);
            errors.push(...result.errors);
            warnings.push(...result.warnings);
        }
        // Validate side effect constraints
        for (const constraint of hardRequirements.side_effect_constraints) {
            const result = this.validateSideEffectConstraint(constraint, workflow, stepMap, ctx);
            errors.push(...result.errors);
            warnings.push(...result.warnings);
        }
        // Log summary
        if (errors.length === 0 && warnings.length === 0) {
            this.log(ctx, `✅ All ${hardRequirements.requirements.length} hard requirements validated successfully`);
        }
        else if (errors.length > 0) {
            this.log(ctx, `❌ ${errors.length} hard requirement errors found`);
        }
        else {
            this.log(ctx, `⚠️  ${warnings.length} hard requirement warnings found`);
        }
        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }
    /**
     * Build a map of step IDs to steps for efficient lookup
     */
    buildStepMap(workflow) {
        const map = new Map();
        const addToMap = (steps) => {
            for (const step of steps) {
                if (step.step_id || step.id) {
                    map.set(step.step_id || step.id, step);
                }
                // Recursively add nested steps
                if (step.type === 'conditional') {
                    const cond = step;
                    if (cond.then)
                        addToMap(Array.isArray(cond.then) ? cond.then : [cond.then]);
                    if (cond.else)
                        addToMap(Array.isArray(cond.else) ? cond.else : [cond.else]);
                    if (cond.then_steps)
                        addToMap(cond.then_steps);
                    if (cond.else_steps)
                        addToMap(cond.else_steps);
                }
                else if (step.type === 'scatter_gather' && step.scatter?.steps) {
                    addToMap(step.scatter.steps);
                }
                else if (step.type === 'parallel' && step.branches) {
                    for (const branch of step.branches) {
                        if (branch.steps)
                            addToMap(branch.steps);
                    }
                }
            }
        };
        addToMap(workflow);
        return map;
    }
    /**
     * Validate threshold enforcement using structural validation
     * Checks:
     * 1. Find node that outputs threshold.field (extraction node)
     * 2. Find action nodes using threshold.applies_to
     * 3. Verify conditional gates the action with correct operator and value
     * 4. Verify conditional comes AFTER extraction (graph traversal)
     */
    validateThresholdEnforcement(threshold, workflow, stepMap, ctx) {
        const errors = [];
        const warnings = [];
        // Find steps that produce the threshold field (AI extraction, transform, etc.)
        const extractionSteps = this.findStepsProducingField(threshold.field, workflow);
        // Find action steps that should be gated by threshold
        const gatedActions = [];
        for (const actionName of threshold.applies_to) {
            const steps = this.findActionStepsByType(actionName, workflow);
            gatedActions.push(...steps);
        }
        if (gatedActions.length === 0) {
            warnings.push(`Threshold "${threshold.field} ${threshold.operator} ${threshold.value}" applies to actions ${threshold.applies_to.join(', ')}, but no such actions found in workflow`);
            return { errors, warnings };
        }
        // For each gated action, verify there's a conditional with correct logic
        for (const action of gatedActions) {
            const conditional = this.findGatingConditional(action, workflow, threshold.field);
            if (!conditional) {
                errors.push(`Action "${action.step_id || action.id}" (${action.type}) should be gated by threshold "${threshold.field} ${threshold.operator} ${threshold.value}", but no conditional found`);
                continue;
            }
            // Validate conditional uses correct operator and value
            const validatesCorrectly = this.conditionalMatchesThreshold(conditional, threshold);
            if (!validatesCorrectly) {
                errors.push(`Conditional "${conditional.step_id || conditional.id}" gates action "${action.step_id || action.id}" but uses wrong operator or value. Expected: ${threshold.field} ${threshold.operator} ${threshold.value}`);
            }
            else {
                this.log(ctx, `✓ Threshold enforced: ${threshold.field} ${threshold.operator} ${threshold.value} gates ${action.step_id || action.id}`);
            }
        }
        return { errors, warnings };
    }
    /**
     * Validate sequential dependency using graph reachability
     */
    validateSequentialDependency(invariant, workflow, stepMap, ctx) {
        const errors = [];
        const warnings = [];
        // Parse dependency (e.g., "create_folder before upload_file")
        const beforeMatch = invariant.description.match(/(\w+).*before.*(\w+)/i);
        if (!beforeMatch) {
            warnings.push(`Cannot parse sequential dependency: ${invariant.description}`);
            return { errors, warnings };
        }
        const [, firstAction, secondAction] = beforeMatch;
        // Find steps by operation type
        const firstSteps = this.findActionStepsByType(firstAction, workflow);
        const secondSteps = this.findActionStepsByType(secondAction, workflow);
        if (firstSteps.length === 0 || secondSteps.length === 0) {
            warnings.push(`Sequential dependency "${invariant.description}" cannot be validated - actions not found in workflow`);
            return { errors, warnings };
        }
        // Check graph reachability: first step must be reachable from start before second step
        const firstStep = firstSteps[0];
        const secondStep = secondSteps[0];
        const isCorrectOrder = this.isReachable(firstStep, secondStep, workflow, stepMap);
        if (!isCorrectOrder) {
            errors.push(`Sequential dependency violated: "${firstAction}" must happen before "${secondAction}" (step IDs: ${firstStep.step_id || firstStep.id} before ${secondStep.step_id || secondStep.id})`);
        }
        else {
            // Also check that secondStep uses output from firstStep (data dependency)
            const usesOutput = this.stepUsesOutputFrom(secondStep, firstStep);
            if (!usesOutput) {
                warnings.push(`Sequential dependency "${invariant.description}" enforced by graph order, but "${secondAction}" does not use output from "${firstAction}" - may indicate missing data dependency`);
            }
            else {
                this.log(ctx, `✓ Sequential dependency enforced: ${invariant.description}`);
            }
        }
        return { errors, warnings };
    }
    /**
     * Validate no duplicate writes invariant
     */
    validateNoDuplicateWrites(invariant, workflow, ctx) {
        const errors = [];
        const warnings = [];
        // Find all file write operations (append_sheets, upload_file, etc.)
        const writeOps = this.findAllFileWriteOperations(workflow);
        // Group by target location
        const targetMap = new Map();
        for (const op of writeOps) {
            const target = this.getWriteTarget(op);
            if (target) {
                if (!targetMap.has(target)) {
                    targetMap.set(target, []);
                }
                targetMap.get(target).push(op);
            }
        }
        // Check for duplicates
        targetMap.forEach((ops, target) => {
            if (ops.length > 1) {
                const stepIds = ops.map(op => op.step_id || op.id).join(', ');
                errors.push(`Duplicate writes to same location "${target}" detected in steps: ${stepIds}`);
            }
        });
        if (errors.length === 0) {
            this.log(ctx, `✓ No duplicate writes validated: ${invariant.description}`);
        }
        return { errors, warnings };
    }
    /**
     * Validate routing rule using structural validation
     */
    validateRoutingRule(rule, workflow, stepMap, ctx) {
        const errors = [];
        const warnings = [];
        // Find conditional that evaluates the routing condition
        const routingConditional = this.findConditionalEvaluatingField(rule.condition, workflow);
        if (!routingConditional) {
            errors.push(`Routing rule not enforced: No conditional found that evaluates field "${rule.condition}"`);
            return { errors, warnings };
        }
        // Verify the conditional routes to the correct destination
        const routesToCorrectDestination = this.conditionalRoutesToDestination(routingConditional, rule.field_value, rule.destination);
        if (!routesToCorrectDestination) {
            errors.push(`Routing rule incorrectly enforced: Conditional "${routingConditional.step_id || routingConditional.id}" evaluates ${rule.condition} but does not route to "${rule.destination}" when value is "${rule.field_value}"`);
        }
        else {
            this.log(ctx, `✓ Routing rule enforced: ${rule.condition} = "${rule.field_value}" → ${rule.destination}`);
        }
        return { errors, warnings };
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
    validateRequiredOutput(requiredOutput, workflow, ctx) {
        const errors = [];
        const warnings = [];
        // HYBRID STEP 1: Check if we have requirements_enforcement tracking from IR
        // Look for ANY enforcement entry with output_capture mechanism (covers all required outputs)
        if (ctx.ir?.requirements_enforcement) {
            const outputEnforcement = ctx.ir.requirements_enforcement.find(enforcement => enforcement.enforced_by.enforcement_mechanism === 'output_capture');
            if (outputEnforcement) {
                // LLM explicitly tracked output capture - trust validation_passed flag
                const nodeIds = outputEnforcement.enforced_by.node_ids.join(', ');
                if (outputEnforcement.validation_passed) {
                    // LLM confirmed all required outputs are captured
                    this.log(ctx, `✓ Required output "${requiredOutput}" - enforcement tracked by IR (req: ${outputEnforcement.requirement_id}, nodes: ${nodeIds})`);
                    return { errors, warnings };
                }
                else {
                    // LLM documented that outputs aren't properly captured
                    errors.push(`Required output "${requiredOutput}" - IR tracking indicates validation failed (req: ${outputEnforcement.requirement_id}): ${outputEnforcement.validation_details || 'No details provided'}`);
                    return { errors, warnings };
                }
            }
        }
        // HYBRID STEP 2: Fallback to manual search if no tracking provided
        // This handles backward compatibility with IRs that don't have enforcement tracking
        const producingSteps = this.findStepsProducingField(requiredOutput, workflow);
        if (producingSteps.length === 0) {
            // LENIENT MODE: If no IR enforcement tracking exists, just warn instead of failing
            // This allows workflows to proceed even if LLM didn't generate requirements_enforcement
            // The workflow may still work correctly at runtime
            warnings.push(`Required output "${requiredOutput}" not explicitly captured (no IR enforcement tracking found). Workflow may still produce this output at runtime.`);
            this.log(ctx, `⚠ Required output "${requiredOutput}" not explicitly tracked - relying on runtime behavior`);
        }
        else {
            this.log(ctx, `✓ Required output "${requiredOutput}" captured by step ${producingSteps[0].step_id || producingSteps[0].id} (fallback: manual search)`);
        }
        return { errors, warnings };
    }
    /**
     * Validate side effect constraint
     */
    validateSideEffectConstraint(constraint, workflow, stepMap, ctx) {
        const errors = [];
        const warnings = [];
        // Find steps performing the constrained action
        const actionSteps = this.findActionStepsByType(constraint.action, workflow);
        if (actionSteps.length === 0) {
            // No action found - constraint doesn't apply
            return { errors, warnings };
        }
        // For each action, verify it's gated by a conditional checking the constraint
        for (const actionStep of actionSteps) {
            const gatingConditional = this.findGatingConditional(actionStep, workflow, constraint.allowed_when);
            if (!gatingConditional) {
                errors.push(`Side effect constraint not enforced: Action "${constraint.action}" (step ${actionStep.step_id || actionStep.id}) should be gated by condition "${constraint.allowed_when}"`);
            }
            else {
                this.log(ctx, `✓ Side effect constraint enforced: ${constraint.action} gated by ${constraint.allowed_when}`);
            }
        }
        return { errors, warnings };
    }
    // ===== Helper Methods for Graph Traversal =====
    findStepsProducingField(fieldName, workflow) {
        const steps = [];
        const search = (workflowSteps) => {
            for (const step of workflowSteps) {
                // AI extraction with output_schema
                if (step.type === 'ai_processing') {
                    const aiStep = step;
                    if (aiStep.params?.output_schema) {
                        const schema = aiStep.params.output_schema;
                        if (schema.properties && schema.properties[fieldName]) {
                            steps.push(step);
                        }
                    }
                }
                // Transform with output_variable
                if (step.type === 'transform' && step.output_variable === fieldName) {
                    steps.push(step);
                }
                // File operations that produce outputs (upload → drive_link, etc.)
                if (step.type === 'action') {
                    const action = step;
                    if (action.output_variable === fieldName || action.params?.output_field === fieldName) {
                        steps.push(step);
                    }
                }
                // Recurse into nested structures
                if (step.type === 'conditional') {
                    const cond = step;
                    if (cond.then)
                        search(Array.isArray(cond.then) ? cond.then : [cond.then]);
                    if (cond.else)
                        search(Array.isArray(cond.else) ? cond.else : [cond.else]);
                    if (cond.then_steps)
                        search(cond.then_steps);
                    if (cond.else_steps)
                        search(cond.else_steps);
                }
                else if (step.type === 'scatter_gather' && step.scatter?.steps) {
                    search(step.scatter.steps);
                }
                else if (step.type === 'parallel' && step.branches) {
                    for (const branch of step.branches) {
                        if (branch.steps)
                            search(branch.steps);
                    }
                }
            }
        };
        search(workflow);
        return steps;
    }
    findActionStepsByType(actionType, workflow) {
        const steps = [];
        const normalizedType = actionType.toLowerCase().replace(/_/g, '');
        const search = (workflowSteps) => {
            for (const step of workflowSteps) {
                if (step.type === 'action') {
                    const action = step;
                    const pluginKey = action.plugin_key || '';
                    const operation = action.operation_type || '';
                    // Match by operation type or plugin+operation combination
                    if (operation.toLowerCase().replace(/_/g, '').includes(normalizedType) ||
                        `${pluginKey}${operation}`.toLowerCase().replace(/_/g, '').includes(normalizedType)) {
                        steps.push(step);
                    }
                }
                // Recurse into nested structures
                if (step.type === 'conditional') {
                    const cond = step;
                    if (cond.then)
                        search(Array.isArray(cond.then) ? cond.then : [cond.then]);
                    if (cond.else)
                        search(Array.isArray(cond.else) ? cond.else : [cond.else]);
                    if (cond.then_steps)
                        search(cond.then_steps);
                    if (cond.else_steps)
                        search(cond.else_steps);
                }
                else if (step.type === 'scatter_gather' && step.scatter?.steps) {
                    search(step.scatter.steps);
                }
                else if (step.type === 'parallel' && step.branches) {
                    for (const branch of step.branches) {
                        if (branch.steps)
                            search(branch.steps);
                    }
                }
            }
        };
        search(workflow);
        return steps;
    }
    findGatingConditional(actionStep, workflow, fieldName) {
        // Search for conditional that contains this action in its branches
        const search = (steps) => {
            for (const step of steps) {
                if (step.type === 'conditional') {
                    const cond = step;
                    // Check if this conditional evaluates the right field
                    const evaluatesField = this.conditionalEvaluatesField(cond, fieldName);
                    if (!evaluatesField)
                        continue;
                    // Check if action is in then/else branches
                    const thenSteps = cond.then ? (Array.isArray(cond.then) ? cond.then : [cond.then]) : (cond.then_steps || []);
                    const elseSteps = cond.else ? (Array.isArray(cond.else) ? cond.else : [cond.else]) : (cond.else_steps || []);
                    const inThen = thenSteps.some((s) => (s.step_id || s.id) === (actionStep.step_id || actionStep.id));
                    const inElse = elseSteps.some((s) => (s.step_id || s.id) === (actionStep.step_id || actionStep.id));
                    if (inThen || inElse) {
                        return step;
                    }
                    // Recurse into nested conditionals
                    const foundInThen = search(thenSteps);
                    if (foundInThen)
                        return foundInThen;
                    const foundInElse = search(elseSteps);
                    if (foundInElse)
                        return foundInElse;
                }
                else if (step.type === 'scatter_gather' && step.scatter?.steps) {
                    const found = search(step.scatter.steps);
                    if (found)
                        return found;
                }
                else if (step.type === 'parallel' && step.branches) {
                    for (const branch of step.branches) {
                        if (branch.steps) {
                            const found = search(branch.steps);
                            if (found)
                                return found;
                        }
                    }
                }
            }
            return null;
        };
        return search(workflow);
    }
    conditionalEvaluatesField(conditional, fieldName) {
        const condition = conditional.condition;
        if (!condition)
            return false;
        // Simple condition: { field: "amount", operator: ">", value: 50 }
        if (condition.field && typeof condition.field === 'string') {
            const field = condition.field.replace(/[{}]/g, '').split('.').pop(); // Extract field name from {{var.field}}
            return field === fieldName || condition.field.includes(fieldName);
        }
        // Complex condition: { and/or: [...] }
        if (condition.and) {
            return condition.and.some((c) => this.conditionalEvaluatesField({ condition: c }, fieldName));
        }
        if (condition.or) {
            return condition.or.some((c) => this.conditionalEvaluatesField({ condition: c }, fieldName));
        }
        return false;
    }
    conditionalMatchesThreshold(conditional, threshold) {
        const condition = conditional.condition;
        if (!condition || !condition.field || typeof condition.field !== 'string')
            return false;
        // Extract field name
        const field = condition.field.replace(/[{}]/g, '').split('.').pop();
        if (field !== threshold.field && !condition.field.includes(threshold.field)) {
            return false;
        }
        // Check operator matches
        const operatorMap = {
            'gt': ['>', 'greater_than', 'gt'],
            'gte': ['>=', 'greater_than_or_equal', 'gte'],
            'lt': ['<', 'less_than', 'lt'],
            'lte': ['<=', 'less_than_or_equal', 'lte'],
            'eq': ['==', '=', 'equals', 'eq'],
            'ne': ['!=', 'not_equals', 'ne']
        };
        const expectedOperators = operatorMap[threshold.operator] || [threshold.operator];
        if (!expectedOperators.includes(condition.operator)) {
            return false;
        }
        // Check value matches
        return condition.value === threshold.value || String(condition.value) === String(threshold.value);
    }
    isReachable(fromStep, toStep, workflow, stepMap) {
        const visited = new Set();
        const fromId = fromStep.step_id || fromStep.id;
        const toId = toStep.step_id || toStep.id;
        if (!fromId || !toId)
            return false;
        const dfs = (currentId) => {
            if (currentId === toId)
                return true;
            if (visited.has(currentId))
                return false;
            visited.add(currentId);
            const currentStep = stepMap.get(currentId);
            if (!currentStep)
                return false;
            // Check next steps based on step type
            if (currentStep.type === 'conditional') {
                const cond = currentStep;
                const thenSteps = cond.then ? (Array.isArray(cond.then) ? cond.then : [cond.then]) : (cond.then_steps || []);
                const elseSteps = cond.else ? (Array.isArray(cond.else) ? cond.else : [cond.else]) : (cond.else_steps || []);
                for (const step of [...thenSteps, ...elseSteps]) {
                    const stepId = step.step_id || step.id;
                    if (stepId && dfs(stepId))
                        return true;
                }
            }
            else if (currentStep.type === 'scatter_gather') {
                const scatter = currentStep.scatter;
                if (scatter?.steps) {
                    for (const step of scatter.steps) {
                        const stepId = step.step_id || step.id;
                        if (stepId && dfs(stepId))
                            return true;
                    }
                }
            }
            else if (currentStep.type === 'parallel') {
                const branches = currentStep.branches || [];
                for (const branch of branches) {
                    if (branch.steps) {
                        for (const step of branch.steps) {
                            const stepId = step.step_id || step.id;
                            if (stepId && dfs(stepId))
                                return true;
                        }
                    }
                }
            }
            // Check next step in sequence (for action/transform/ai_processing steps)
            const nextStepId = currentStep.next_step_id;
            if (nextStepId && dfs(nextStepId))
                return true;
            return false;
        };
        return dfs(fromId);
    }
    stepUsesOutputFrom(step, sourceStep) {
        const stepStr = JSON.stringify(step);
        const sourceOutputVar = sourceStep.output_variable;
        const sourceStepId = sourceStep.step_id || sourceStep.id;
        if (sourceOutputVar && stepStr.includes(sourceOutputVar)) {
            return true;
        }
        if (sourceStepId && stepStr.includes(sourceStepId)) {
            return true;
        }
        return false;
    }
    findAllFileWriteOperations(workflow) {
        const writeOps = [];
        // Generic pattern: Detect write operations by action name patterns
        const writePatterns = ['append', 'upload', 'create', 'write', 'update', 'insert', 'post', 'send', 'publish'];
        const search = (steps) => {
            for (const step of steps) {
                if (step.type === 'action') {
                    const action = step;
                    const actionName = (action.action || '').toLowerCase();
                    // Check if action name starts with any write pattern
                    const isWriteOperation = writePatterns.some(pattern => actionName.startsWith(pattern) || actionName.includes(`_${pattern}`));
                    if (isWriteOperation) {
                        writeOps.push(step);
                    }
                }
                // Recurse into nested structures
                if (step.type === 'conditional') {
                    const cond = step;
                    if (cond.then)
                        search(Array.isArray(cond.then) ? cond.then : [cond.then]);
                    if (cond.else)
                        search(Array.isArray(cond.else) ? cond.else : [cond.else]);
                    if (cond.then_steps)
                        search(cond.then_steps);
                    if (cond.else_steps)
                        search(cond.else_steps);
                }
                else if (step.type === 'scatter_gather' && step.scatter?.steps) {
                    search(step.scatter.steps);
                }
                else if (step.type === 'parallel' && step.branches) {
                    for (const branch of step.branches) {
                        if (branch.steps)
                            search(branch.steps);
                    }
                }
            }
        };
        search(workflow);
        return writeOps;
    }
    /**
     * Get write target identifier for duplicate detection
     *
     * Generic approach: Build target from all "identifier" parameters
     * (parameters ending in _id, _name, _path, or named 'range', 'key', 'index')
     */
    getWriteTarget(step) {
        const action = step;
        const params = action.params || {};
        const plugin = action.plugin || 'unknown';
        const actionName = action.action || 'unknown';
        // Collect all identifier parameters (generic pattern detection)
        const identifierParams = [];
        const identifierKeys = ['_id', '_name', '_path', 'range', 'key', 'index', 'channel', 'topic', 'queue'];
        for (const [paramName, paramValue] of Object.entries(params)) {
            // Skip if value is an object, array, or undefined
            if (typeof paramValue !== 'string' && typeof paramValue !== 'number')
                continue;
            // Check if this is an identifier parameter
            const isIdentifier = identifierKeys.some(suffix => paramName.endsWith(suffix) || paramName === suffix);
            if (isIdentifier) {
                identifierParams.push(`${paramName}:${paramValue}`);
            }
        }
        // If we found identifiers, build target string
        if (identifierParams.length > 0) {
            return `${plugin}:${actionName}:${identifierParams.sort().join(':')}`;
        }
        return null;
    }
    findConditionalEvaluatingField(fieldName, workflow) {
        const search = (steps) => {
            for (const step of steps) {
                if (step.type === 'conditional') {
                    if (this.conditionalEvaluatesField(step, fieldName)) {
                        return step;
                    }
                    // Recurse into nested conditionals
                    const cond = step;
                    const thenSteps = cond.then ? (Array.isArray(cond.then) ? cond.then : [cond.then]) : (cond.then_steps || []);
                    const elseSteps = cond.else ? (Array.isArray(cond.else) ? cond.else : [cond.else]) : (cond.else_steps || []);
                    const foundInThen = search(thenSteps);
                    if (foundInThen)
                        return foundInThen;
                    const foundInElse = search(elseSteps);
                    if (foundInElse)
                        return foundInElse;
                }
                else if (step.type === 'scatter_gather' && step.scatter?.steps) {
                    const found = search(step.scatter.steps);
                    if (found)
                        return found;
                }
                else if (step.type === 'parallel' && step.branches) {
                    for (const branch of step.branches) {
                        if (branch.steps) {
                            const found = search(branch.steps);
                            if (found)
                                return found;
                        }
                    }
                }
            }
            return null;
        };
        return search(workflow);
    }
    conditionalRoutesToDestination(conditional, fieldValue, destination) {
        // Check if conditional branches contain steps that route to destination
        // This is a simplified check - in practice, you'd inspect delivery steps
        const thenSteps = conditional.then ? (Array.isArray(conditional.then) ? conditional.then : [conditional.then]) : (conditional.then_steps || []);
        const elseSteps = conditional.else ? (Array.isArray(conditional.else) ? conditional.else : [conditional.else]) : (conditional.else_steps || []);
        const allSteps = [...thenSteps, ...elseSteps];
        for (const step of allSteps) {
            const stepStr = JSON.stringify(step);
            if (stepStr.includes(destination)) {
                return true;
            }
        }
        return false;
    }
    /**
     * Detect if a plugin operation returns a 2D array that needs conversion to objects
     *
     * Uses SchemaAwareDataExtractor to analyze output schemas.
     * Returns the array field name (e.g., "values" for Google Sheets)
     */
    detectOutputIs2DArray(pluginKey, actionName) {
        if (!this.pluginManager) {
            return { is2DArray: false, isWrappedArray: false, arrayFieldName: 'data' };
        }
        try {
            const plugins = this.pluginManager.getAvailablePlugins();
            const plugin = plugins[pluginKey];
            if (!plugin || !plugin.actions || !plugin.actions[actionName]) {
                return { is2DArray: false, isWrappedArray: false, arrayFieldName: 'data' };
            }
            const action = plugin.actions[actionName];
            const outputSchema = action.output_schema;
            if (!outputSchema) {
                return { is2DArray: false, isWrappedArray: false, arrayFieldName: 'data' };
            }
            // Use SchemaAwareDataExtractor to analyze the schema
            const analysis = analyzeOutputSchema(outputSchema);
            // Case 1: 2D array (Google Sheets: {values: [[...]]})
            if (analysis.is2DArray && analysis.primaryArrayField) {
                return {
                    is2DArray: true,
                    isWrappedArray: false,
                    arrayFieldName: analysis.primaryArrayField
                };
            }
            // Case 2: Wrapped 1D array (Gmail: {emails: [{...}]}, Airtable: {records: [{...}]})
            // Any output with a primary array field inside an object wrapper needs unwrapping
            if (analysis.primaryArrayField && analysis.itemType === 'object') {
                return {
                    is2DArray: false,
                    isWrappedArray: true,
                    arrayFieldName: analysis.primaryArrayField
                };
            }
            return { is2DArray: false, isWrappedArray: false, arrayFieldName: 'data' };
        }
        catch (error) {
            this.logger.warn(`Failed to detect data structure for ${pluginKey}.${actionName}: ${error}`);
            return { is2DArray: false, isWrappedArray: false, arrayFieldName: 'data' };
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
    normalizeDataFormats(workflow, ctx) {
        if (!this.pluginManager) {
            return workflow;
        }
        const normalized = [];
        let insertedTransforms = 0;
        for (let i = 0; i < workflow.length; i++) {
            const step = workflow[i];
            normalized.push(step);
            // Check if this step outputs data from a plugin operation
            if (step.output_variable && step.plugin && step.operation) {
                const detection = this.detectOutputIs2DArray(step.plugin, step.operation);
                if (detection.is2DArray) {
                    // Case 1: 2D array → Insert rows_to_objects transform
                    const convertStepId = `step_${++ctx.stepCounter}`;
                    const normalizedVarName = `${step.output_variable}_objects`;
                    const convertStep = {
                        step_id: convertStepId,
                        type: 'transform',
                        operation: 'rows_to_objects',
                        input: `{{${step.output_variable}.${detection.arrayFieldName}}}`,
                        description: `Auto-normalize: Convert 2D array to objects`,
                        output_variable: normalizedVarName,
                        config: {}
                    };
                    normalized.push(convertStep);
                    insertedTransforms++;
                    this.log(ctx, `  → Auto-inserted rows_to_objects for ${step.plugin}.${step.operation} (${step.output_variable}.${detection.arrayFieldName} → ${normalizedVarName})`);
                    // Update all subsequent references to use the normalized variable
                    for (let j = i + 1; j < workflow.length; j++) {
                        this.updateVariableReferences(workflow[j], step.output_variable, normalizedVarName, detection.arrayFieldName);
                    }
                }
                else if (detection.isWrappedArray) {
                    // Case 2: Wrapped array → Update all references to unwrap the array field
                    // e.g., {{all_emails}} → {{all_emails.emails}}
                    this.log(ctx, `  → Auto-unwrapping ${step.plugin}.${step.operation} (${step.output_variable} → ${step.output_variable}.${detection.arrayFieldName})`);
                    // Update all subsequent references to unwrap the array
                    for (let j = i + 1; j < workflow.length; j++) {
                        this.unwrapVariableReferences(workflow[j], step.output_variable, detection.arrayFieldName);
                    }
                }
            }
        }
        if (insertedTransforms > 0) {
            this.log(ctx, `✓ Data format normalization complete: ${insertedTransforms} transforms inserted`);
        }
        return normalized;
    }
    /**
     * Renumber workflow steps sequentially with globally unique IDs
     * This ensures steps are numbered 1, 2, 3, ... across ALL nesting levels
     * Nested steps get globally unique IDs to avoid collisions (e.g., step1, step2, step3...)
     */
    renumberSteps(workflow) {
        let globalCounter = 1;
        const renumberRecursive = (steps) => {
            return steps.map((step) => {
                const newStepId = `step${globalCounter++}`;
                // Update step_id and id fields
                const renumberedStep = {
                    ...step,
                    step_id: newStepId,
                    id: newStepId
                };
                // Recursively renumber nested steps in scatter_gather
                if (step.type === 'scatter_gather' && step.scatter?.steps) {
                    renumberedStep.scatter = {
                        ...step.scatter,
                        steps: renumberRecursive(step.scatter.steps)
                    };
                }
                // Recursively renumber nested steps in conditional branches
                // Conditionals use 'steps' for then-branch and 'else_steps' for else-branch
                if (step.type === 'conditional') {
                    const conditionalStep = step;
                    // Handle 'steps' property (then branch in DSL format)
                    if (conditionalStep.steps && Array.isArray(conditionalStep.steps) && conditionalStep.steps.length > 0) {
                        renumberedStep.steps = renumberRecursive(conditionalStep.steps);
                    }
                    // Handle 'else_steps' property (else branch in DSL format)
                    if (conditionalStep.else_steps && Array.isArray(conditionalStep.else_steps) && conditionalStep.else_steps.length > 0) {
                        renumberedStep.else_steps = renumberRecursive(conditionalStep.else_steps);
                    }
                    // Also handle 'then'/'else' format (if already translated to PILOT)
                    if (conditionalStep.then && Array.isArray(conditionalStep.then) && conditionalStep.then.length > 0) {
                        renumberedStep.then = renumberRecursive(conditionalStep.then);
                    }
                    if (conditionalStep.else && Array.isArray(conditionalStep.else) && conditionalStep.else.length > 0) {
                        renumberedStep.else = renumberRecursive(conditionalStep.else);
                    }
                }
                return renumberedStep;
            });
        };
        return renumberRecursive(workflow);
    }
    /**
     * Update variable references in a step to use normalized variable name
     *
     * Example: {{existing_rows.values}} → {{existing_rows_objects}}
     */
    updateVariableReferences(step, oldVarName, newVarName, arrayFieldName) {
        const oldPattern = `{{${oldVarName}.${arrayFieldName}}}`;
        const newPattern = `{{${newVarName}}}`;
        // Helper to recursively replace in objects
        const replaceInValue = (value) => {
            if (typeof value === 'string') {
                return value.replace(oldPattern, newPattern);
            }
            else if (Array.isArray(value)) {
                return value.map(replaceInValue);
            }
            else if (value && typeof value === 'object') {
                const result = {};
                for (const [k, v] of Object.entries(value)) {
                    result[k] = replaceInValue(v);
                }
                return result;
            }
            return value;
        };
        // Update input field
        if (step.input) {
            step.input = replaceInValue(step.input);
        }
        // Update config fields
        if (step.config) {
            step.config = replaceInValue(step.config);
        }
        // Update condition fields (for conditional steps)
        if (step.condition) {
            step.condition = replaceInValue(step.condition);
        }
        // Update nested steps (for scatter_gather, conditional, etc.)
        if (step.scatter?.steps) {
            for (const nestedStep of step.scatter.steps) {
                this.updateVariableReferences(nestedStep, oldVarName, newVarName, arrayFieldName);
            }
        }
        if (step.then) {
            for (const thenStep of step.then) {
                this.updateVariableReferences(thenStep, oldVarName, newVarName, arrayFieldName);
            }
        }
        if (step.else_steps) {
            for (const elseStep of step.else_steps) {
                this.updateVariableReferences(elseStep, oldVarName, newVarName, arrayFieldName);
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
    unwrapVariableReferences(step, varName, arrayFieldName) {
        // Helper to recursively unwrap in strings
        const unwrapInValue = (value) => {
            if (typeof value === 'string') {
                // Match {{varName}} but NOT {{varName.something}}
                // This regex ensures we only unwrap direct references, not already-accessed paths
                const directRefPattern = new RegExp(`\\{\\{${varName}\\}\\}(?!\\.\\w)`, 'g');
                return value.replace(directRefPattern, `{{${varName}.${arrayFieldName}}}`);
            }
            else if (Array.isArray(value)) {
                return value.map(unwrapInValue);
            }
            else if (value && typeof value === 'object') {
                const result = {};
                for (const [k, v] of Object.entries(value)) {
                    result[k] = unwrapInValue(v);
                }
                return result;
            }
            return value;
        };
        // Update input field
        if (step.input) {
            step.input = unwrapInValue(step.input);
        }
        // Update config fields
        if (step.config) {
            step.config = unwrapInValue(step.config);
        }
        // Update condition fields (for conditional steps)
        if (step.condition) {
            step.condition = unwrapInValue(step.condition);
        }
        // Update nested steps (for scatter_gather, conditional, etc.)
        if (step.scatter?.steps) {
            for (const nestedStep of step.scatter.steps) {
                this.unwrapVariableReferences(nestedStep, varName, arrayFieldName);
            }
        }
        if (step.then) {
            for (const thenStep of step.then) {
                this.unwrapVariableReferences(thenStep, varName, arrayFieldName);
            }
        }
        if (step.else_steps) {
            for (const elseStep of step.else_steps) {
                this.unwrapVariableReferences(elseStep, varName, arrayFieldName);
            }
        }
    }
    /**
     * Build input reference from InputBinding
     * Handles path navigation for nested fields
     */
    buildInputReference(input) {
        if (!input.path) {
            // No path, just return variable name
            return input.variable;
        }
        // Has path - append it to variable name with dot notation
        // The variable reference will be wrapped in {{}} later by the calling code
        return `${input.variable}.${input.path}`;
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
    mergeInputPathWithCondition(condition, inputBinding) {
        if (!inputBinding.path) {
            return condition;
        }
        // Deep clone to avoid mutating original
        const updated = JSON.parse(JSON.stringify(condition));
        // Handle simple conditions
        if (updated.type === 'simple') {
            // If condition uses the input variable, append path
            if (updated.variable === inputBinding.variable) {
                updated.variable = `${inputBinding.variable}.${inputBinding.path}`;
            }
        }
        // Handle complex conditions (recursively update nested conditions)
        else if (updated.type === 'complex' && updated.conditions) {
            updated.conditions = updated.conditions.map((c) => this.mergeInputPathWithCondition(c, inputBinding));
        }
        return updated;
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
    findDownstreamDeliveryNodes(nodeId, graph, visited = new Set()) {
        if (visited.has(nodeId))
            return [];
        visited.add(nodeId);
        const node = graph.nodes[nodeId];
        if (!node)
            return [];
        // Found a delivery node
        if (node.type === 'operation' && node.operation?.operation_type === 'deliver') {
            return [node];
        }
        // Traverse to next nodes
        const deliveryNodes = [];
        // Linear next
        if (node.next) {
            const nextNodes = Array.isArray(node.next) ? node.next : [node.next];
            for (const nextNode of nextNodes) {
                deliveryNodes.push(...this.findDownstreamDeliveryNodes(nextNode, graph, visited));
            }
        }
        // Choice branches
        if (node.type === 'choice' && node.choice) {
            for (const rule of node.choice.rules) {
                if (rule.next) {
                    deliveryNodes.push(...this.findDownstreamDeliveryNodes(rule.next, graph, visited));
                }
            }
            if (node.choice.default) {
                deliveryNodes.push(...this.findDownstreamDeliveryNodes(node.choice.default, graph, visited));
            }
        }
        // Parallel branches
        if (node.type === 'parallel' && node.parallel) {
            for (const branch of node.parallel.branches) {
                if (branch.start) {
                    deliveryNodes.push(...this.findDownstreamDeliveryNodes(branch.start, graph, visited));
                }
            }
        }
        // Loop body (look inside the loop)
        if (node.type === 'loop' && node.loop && node.loop.body_start) {
            deliveryNodes.push(...this.findDownstreamDeliveryNodes(node.loop.body_start, graph, visited));
        }
        return deliveryNodes;
    }
    /**
     * Traverse execution graph to find where a variable is consumed
     * @param variableName The variable to track
     * @param graph The execution graph
     * @returns Array of nodes that consume this variable
     */
    findVariableConsumers(variableName, graph) {
        const consumers = [];
        for (const [nodeId, node] of Object.entries(graph.nodes)) {
            // Check if this node declares the variable as input
            if (node.inputs?.some(input => input.variable === variableName)) {
                consumers.push(node);
            }
            // Check if node config references the variable
            const nodeData = node.operation || node.choice || node.loop;
            if (nodeData) {
                const nodeStr = JSON.stringify(nodeData);
                if (nodeStr && (nodeStr.includes(`{{${variableName}`) || nodeStr.includes(`"${variableName}"`))) {
                    consumers.push(node);
                }
            }
        }
        return consumers;
    }
    /**
     * Load plugin definition and read action parameter schema
     * @param pluginKey The plugin identifier (e.g., "google-sheets")
     * @param action The action name (e.g., "append_rows")
     * @returns Plugin action definition with parameter schema
     */
    async loadPluginAction(pluginKey, action) {
        try {
            // Load plugin definition from lib/plugins/definitions/
            const fs = await import('fs/promises');
            const path = await import('path');
            const pluginPath = path.join(process.cwd(), 'lib', 'plugins', 'definitions', `${pluginKey}.json`);
            const pluginDef = JSON.parse(await fs.readFile(pluginPath, 'utf-8'));
            // Find the action definition
            const actionDef = pluginDef.actions?.find((a) => a.name === action);
            return actionDef;
        }
        catch (error) {
            this.logger.warn(`Failed to load plugin action ${pluginKey}.${action}: ${error}`);
            return null;
        }
    }
    /**
     * Analyze plugin parameter schema to determine required data format
     * @param pluginKey The plugin identifier
     * @param action The action name
     * @param config The action config object
     * @returns Format requirements for this delivery
     */
    async analyzePluginDataFormat(pluginKey, action, config) {
        const actionDef = await this.loadPluginAction(pluginKey, action);
        const formats = {
            needs2DArray: false,
            needsHTML: false,
            needsPlainText: false,
            parameterName: undefined
        };
        if (!actionDef)
            return formats;
        // Analyze parameter schemas
        for (const param of actionDef.parameters || []) {
            // Check for 2D array requirements (Sheets)
            if (param.type === 'array' && param.items?.type === 'array') {
                formats.needs2DArray = true;
                formats.parameterName = param.name;
            }
            // Check for HTML body requirements (Email)
            if ((param.name === 'body' || param.name === 'html_body') &&
                param.type === 'string') {
                formats.needsHTML = true;
                formats.parameterName = param.name;
            }
            // Check for plain text requirements (SMS)
            if ((param.name === 'message' || param.name === 'text') &&
                param.type === 'string') {
                formats.needsPlainText = true;
                formats.parameterName = param.name;
            }
        }
        return formats;
    }
    /**
     * Determine required data format by analyzing downstream delivery nodes
     * @param deliveryNodes Array of delivery nodes found downstream
     * @returns Aggregate format requirements
     */
    async determineRequiredFormat(deliveryNodes) {
        const aggregateFormats = {
            needs2DArray: false,
            needsHTML: false,
            needsPlainText: false,
            deliveryDetails: []
        };
        for (const node of deliveryNodes) {
            const delivery = node.operation?.deliver;
            if (!delivery)
                continue;
            // Analyze this specific delivery's format requirements
            const format = await this.analyzePluginDataFormat(delivery.plugin_key, delivery.action, delivery.config);
            aggregateFormats.needs2DArray || (aggregateFormats.needs2DArray = format.needs2DArray);
            aggregateFormats.needsHTML || (aggregateFormats.needsHTML = format.needsHTML);
            aggregateFormats.needsPlainText || (aggregateFormats.needsPlainText = format.needsPlainText);
            aggregateFormats.deliveryDetails.push({
                pluginKey: delivery.plugin_key,
                action: delivery.action,
                format
            });
        }
        return aggregateFormats;
    }
    /**
     * Choose appropriate transform operation based on data format requirements
     * @param irTransform The transform config from IR
     * @param formats Required data formats from downstream consumers
     * @param nodeId The node ID for logging
     * @param ctx Compiler context for logging
     * @returns The selected PILOT operation type
     */
    chooseTransformOperation(irTransform, formats, nodeId, ctx) {
        const irType = irTransform?.type;
        // If IR specifies a concrete type, respect it (unless it's wrong)
        if (irType && typeof irType === 'string' && irType !== 'custom' && irType !== 'template') {
            // Validate: Check if map/filter/reduce have appropriate input
            if (['map', 'filter', 'reduce'].includes(irType)) {
                // These require array inputs - will be validated separately
                return irType;
            }
            return irType;
        }
        // IR didn't specify or said 'custom'/'template' - use downstream requirements
        if (formats.needs2DArray && !formats.needsHTML && !formats.needsPlainText) {
            this.log(ctx, `  → Chose 'map' for 2D array delivery`);
            return 'map';
        }
        if (formats.needsHTML && !formats.needs2DArray) {
            this.log(ctx, `  → Chose 'render_table' for HTML delivery`);
            return 'render_table';
        }
        if (formats.needsPlainText && !formats.needs2DArray && !formats.needsHTML) {
            this.log(ctx, `  → Using default for plain text delivery`);
            return irType || 'map';
        }
        // Mixed formats - log warning and default to most flexible
        if (formats.needs2DArray && formats.needsHTML) {
            this.warn(ctx, `${nodeId}: Mixed delivery formats detected (2D array + HTML). Defaulting to 'map'.`);
            return 'map';
        }
        // No specific format detected - use safe default
        if (irType !== 'custom' && irType !== 'template') {
            this.warn(ctx, `${nodeId}: Could not determine format requirement. Using IR type: ${irType || 'map'}`);
        }
        return irType || 'map';
    }
    /**
     * Detect if a transform step is unnecessary and can be inlined
     * @param nodeId The transform node ID
     * @param transform The transform config
     * @param graph The execution graph
     * @returns Detection result with optimization suggestion
     */
    detectUnnecessaryTransform(nodeId, transform, graph) {
        const node = graph.nodes[nodeId];
        if (!node)
            return { isUnnecessary: false };
        const inputBindings = node.inputs || [];
        const outputBindings = node.outputs || [];
        // Pattern 1: Scalar input to array-only operation
        if (transform?.type && ['map', 'filter', 'reduce'].includes(transform.type)) {
            // Check if input is scalar (not array)
            // First try to get input from transform.input field (most reliable)
            let inputVarPath = transform.input;
            // If not in transform.input, try inputBindings
            if (!inputVarPath && inputBindings[0]?.variable) {
                inputVarPath = inputBindings[0].variable;
            }
            if (inputVarPath) {
                // Extract variable reference from {{...}} if present
                const varMatch = inputVarPath.match(/^{{(.+?)}}$/);
                const cleanPath = varMatch ? varMatch[1] : inputVarPath;
                // Check if this uses nested field access (e.g., "current_email.attachments")
                const hasNestedAccess = cleanPath.includes('.');
                // Only validate if NOT using nested access
                // (If using nested access, we can't determine the type without schema inspection)
                if (!hasNestedAccess) {
                    const baseVar = cleanPath.split('.')[0];
                    const varDecl = graph.variables?.find(v => v.name === baseVar);
                    if (varDecl && varDecl.type !== 'array') {
                        return {
                            isUnnecessary: true,
                            reason: `${transform.type} operation requires array input, but '${baseVar}' is ${varDecl.type}`,
                            suggestion: `Remove this transform step and use direct variable interpolation in downstream nodes`,
                            canInline: true
                        };
                    }
                }
                // If using nested access (e.g., current_email.attachments), skip this check
                // The nested field MIGHT be an array even if the base variable is an object
            }
        }
        // Pattern 2: Single-use transform output
        if (outputBindings.length === 1) {
            const outputVar = outputBindings[0].variable;
            const consumers = this.findVariableConsumers(outputVar, graph);
            if (consumers.length === 1) {
                // Output used in exactly one place - check if inlinable
                const consumer = consumers[0];
                if (consumer.type === 'operation' && consumer.operation?.operation_type === 'deliver') {
                    return {
                        isUnnecessary: true,
                        reason: `Transform output '${outputVar}' only used in one delivery node`,
                        suggestion: `Consider inlining the transform logic directly into the delivery config`,
                        canInline: false // Don't auto-inline, just suggest
                    };
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
                canInline: false // Don't auto-inline to avoid breaking things
            };
        }
        return { isUnnecessary: false };
    }
    /**
     * Post-compilation optimization pass
     *
     * Detects and fixes common inefficiencies:
     * 1. Redundant AI merge operations after deterministic_extract
     * 2. Unnecessary transform steps
     * 3. Normalize references and fix common errors
     */
    async optimizeWorkflow(workflow, ctx) {
        let optimized = this.mergeRedundantAIMergeSteps(workflow, ctx);
        optimized = await this.normalizeAndFixWorkflow(optimized, ctx);
        return optimized;
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
    async normalizeAndFixWorkflow(workflow, ctx) {
        const variables = new Set();
        // Process steps sequentially to maintain variable tracking order
        const normalized = [];
        for (const step of workflow) {
            const normalizedStep = await this.normalizeStep(step, variables, ctx);
            normalized.push(normalizedStep);
        }
        return normalized;
    }
    /**
     * Normalize a single step
     */
    async normalizeStep(step, variables, ctx) {
        const normalized = { ...step };
        // Track output variable
        if (normalized.output_variable) {
            variables.add(normalized.output_variable);
        }
        // Normalize based on step type
        switch (normalized.type) {
            case 'action':
                return await this.normalizeActionStepRefs(normalized, variables, ctx);
            case 'transform':
                return this.normalizeTransformStepRefs(normalized, variables, ctx);
            case 'scatter_gather':
                return await this.normalizeScatterGatherStepRefs(normalized, variables, ctx);
            case 'conditional':
                return await this.normalizeConditionalStepRefs(normalized, variables, ctx);
            case 'ai_processing':
                return this.normalizeAIStepRefs(normalized, variables, ctx);
            default:
                return normalized;
        }
    }
    /**
     * Normalize action step references
     * Now uses plugin schema metadata for intelligent normalization
     */
    async normalizeActionStepRefs(step, variables, ctx) {
        if (step.config && this.pluginManager) {
            // Get plugin schema for this action
            const pluginSchema = await this.getPluginActionSchema(step.plugin, step.operation);
            if (pluginSchema?.parameters?.properties) {
                this.log(ctx, `  → Using plugin schema for ${step.plugin}.${step.operation}`);
                step.config = await this.normalizeActionConfigWithSchema(step.config, pluginSchema.parameters.properties, variables, ctx);
            }
            else {
                // Fallback to basic normalization if no schema available
                this.log(ctx, `  → No plugin schema found for ${step.plugin}.${step.operation}, using basic normalization`);
                step.config = this.normalizeConfigRefs(step.config, variables, ctx);
            }
        }
        else if (step.config) {
            step.config = this.normalizeConfigRefs(step.config, variables, ctx);
        }
        return step;
    }
    /**
     * Get plugin action schema from plugin manager
     */
    async getPluginActionSchema(pluginKey, actionName) {
        if (!this.pluginManager)
            return null;
        try {
            const allPlugins = this.pluginManager.getAvailablePlugins();
            const plugin = allPlugins[pluginKey];
            if (!plugin)
                return null;
            const action = plugin.actions[actionName];
            return action || null;
        }
        catch (error) {
            return null;
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
    findFuzzyConfigMatch(targetKey, config) {
        const matches = [];
        // Tokenize target key
        const targetTokens = this.tokenizeKey(targetKey);
        for (const configKey of Object.keys(config)) {
            if (configKey === targetKey)
                continue; // Skip exact (already checked)
            const configTokens = this.tokenizeKey(configKey);
            // Calculate token overlap
            const commonTokens = targetTokens.filter(t => configTokens.includes(t));
            if (commonTokens.length > 0) {
                const totalTokens = new Set([...targetTokens, ...configTokens]).size;
                const score = commonTokens.length / totalTokens;
                // Threshold: at least 33% token overlap
                if (score >= 0.33) {
                    matches.push({ key: configKey, score });
                }
            }
        }
        // Sort by score descending
        return matches.sort((a, b) => b.score - a.score).map(m => m.key);
    }
    /**
     * Tokenize key into semantic tokens (handles snake_case, kebab-case, camelCase)
     */
    tokenizeKey(key) {
        return key
            .replace(/([a-z])([A-Z])/g, '$1_$2') // camelCase → snake
            .toLowerCase()
            .split(/[_\-]/)
            .filter(t => t.length > 0);
    }
    /**
     * Tokenize a key for fuzzy matching
     * Splits on underscore, hyphen, and camelCase boundaries
     */
    tokenizeKey(key) {
        return key
            .replace(/([a-z])([A-Z])/g, '$1_$2') // camelCase → snake_case
            .toLowerCase()
            .split(/[_-]/) // split on underscore or hyphen
            .filter(t => t.length > 0);
    }
    /**
     * Calculate token overlap score between two keys
     * Returns score between 0 and 1 (0 = no overlap, 1 = identical)
     */
    calculateTokenOverlap(key1, key2) {
        const tokens1 = new Set(this.tokenizeKey(key1));
        const tokens2 = new Set(this.tokenizeKey(key2));
        const commonTokens = [...tokens1].filter(t => tokens2.has(t));
        const allTokens = new Set([...tokens1, ...tokens2]);
        if (allTokens.size === 0)
            return 0;
        return commonTokens.length / allTokens.size;
    }
    /**
     * Find best matching config key using token-based fuzzy matching
     * Returns undefined if no match found above threshold
     */
    findBestConfigMatch(targetKey, workflowConfig, threshold = 0.33) {
        let bestMatch;
        let bestScore = 0;
        for (const configKey of Object.keys(workflowConfig)) {
            const score = this.calculateTokenOverlap(targetKey, configKey);
            if (score > bestScore && score >= threshold) {
                bestScore = score;
                bestMatch = configKey;
            }
        }
        return bestMatch;
    }
    /**
     * Normalize action config using plugin schema metadata
     * Applies x-variable-mapping, x-input-mapping, and x-context-binding
     */
    async normalizeActionConfigWithSchema(config, parameterSchema, variables, ctx) {
        const normalized = {};
        for (const [paramName, paramDef] of Object.entries(parameterSchema)) {
            const configValue = config[paramName];
            // Skip if parameter not provided, unless we can inject from workflow config
            if (configValue === undefined) {
                // Check if context binding can provide it
                if (paramDef['x-context-binding'] && ctx.workflowConfig) {
                    const binding = paramDef['x-context-binding'];
                    const configKey = binding.key;
                    // Try exact match first
                    let matchedKey = configKey;
                    let configVal = ctx.workflowConfig[configKey];
                    // If exact match not found, try fuzzy matching
                    if (configVal === undefined) {
                        const fuzzyMatch = this.findBestConfigMatch(configKey, ctx.workflowConfig);
                        if (fuzzyMatch) {
                            matchedKey = fuzzyMatch;
                            configVal = ctx.workflowConfig[fuzzyMatch];
                            this.log(ctx, `  → Fuzzy matched '${configKey}' → '${fuzzyMatch}' (score: ${this.calculateTokenOverlap(configKey, fuzzyMatch).toFixed(2)})`);
                        }
                    }
                    if (configVal !== undefined) {
                        // Inject value from workflow config
                        normalized[paramName] = configVal;
                        this.log(ctx, `  → Injected '${paramName}' from workflow config: ${matchedKey} = ${configVal}`);
                        continue;
                    }
                    else {
                        this.log(ctx, `  → Parameter '${paramName}' can be bound from ${binding.source}.${binding.key} (not available in config)`);
                    }
                }
                continue;
            }
            // Apply x-variable-mapping if value is an object variable
            if (paramDef['x-variable-mapping'] && typeof configValue === 'string') {
                const mapping = paramDef['x-variable-mapping'];
                const varName = configValue.replace(/[{}]/g, '');
                // Check if this looks like it needs extraction (e.g., {{folder}} instead of {{folder.folder_id}})
                if (variables.has(varName) && !varName.includes('.')) {
                    // Apply mapping
                    const mappedValue = `{{${varName}.${mapping.field_path}}}`;
                    normalized[paramName] = mappedValue;
                    this.log(ctx, `  → Applied mapping: ${paramName} = ${configValue} → ${mappedValue}`);
                    continue;
                }
            }
            // Apply x-input-mapping if value could be multiple types
            if (paramDef['x-input-mapping'] && typeof configValue === 'string') {
                const mapping = paramDef['x-input-mapping'];
                const varName = configValue.replace(/[{}]/g, '');
                // Check if this is a file object that needs URL extraction
                if (variables.has(varName) && mapping.from_file_object) {
                    const mappedValue = `{{${varName}.${mapping.from_file_object}}}`;
                    normalized[paramName] = mappedValue;
                    this.log(ctx, `  → Applied input mapping: ${paramName} = ${configValue} → ${mappedValue}`);
                    continue;
                }
            }
            // Default: apply basic normalization
            if (typeof configValue === 'string') {
                if (!configValue.includes('{{') && !configValue.includes('config.')) {
                    const baseVar = configValue.split('.')[0];
                    if (variables.has(baseVar)) {
                        normalized[paramName] = `{{${configValue}}}`;
                    }
                    else {
                        normalized[paramName] = configValue;
                    }
                }
                else {
                    normalized[paramName] = configValue;
                }
            }
            else if (typeof configValue === 'object') {
                normalized[paramName] = this.normalizeConfigRefs(configValue, variables, ctx);
            }
            else {
                normalized[paramName] = configValue;
            }
        }
        // Copy over any parameters not in schema (might be runtime-provided)
        for (const [key, value] of Object.entries(config)) {
            if (!(key in normalized)) {
                normalized[key] = typeof value === 'object'
                    ? this.normalizeConfigRefs(value, variables, ctx)
                    : value;
            }
        }
        return normalized;
    }
    /**
     * Normalize transform step references
     */
    normalizeTransformStepRefs(step, variables, ctx) {
        // Normalize input
        if (step.input && !step.input.includes('{{')) {
            step.input = `{{${step.input}}}`;
        }
        // Fix reduce operations missing field
        if (step.operation === 'reduce' && step.config) {
            const reduceOp = step.config.reduce_operation || step.config.reducer;
            if ((reduceOp === 'sum' || reduceOp === 'avg' || reduceOp === 'min' || reduceOp === 'max') && !step.config.field) {
                // Try to extract from custom_code (format: "field:fieldname")
                if (step.config.custom_code && step.config.custom_code.startsWith('field:')) {
                    const field = step.config.custom_code.substring(6); // Remove "field:" prefix
                    step.config.field = field;
                    delete step.config.custom_code; // Remove the temporary storage
                    this.log(ctx, `  → Extracted reduce field from IR: field='${field}'`);
                }
                else {
                    // Try to infer from output_variable or step_id
                    const outputVar = step.output_variable || '';
                    const stepId = step.step_id || step.id || '';
                    const combinedName = `${outputVar} ${stepId}`.toLowerCase();
                    if (combinedName.includes('amount')) {
                        step.config.field = 'amount';
                        this.log(ctx, `  → Auto-inferred reduce field from variable name: field='amount'`);
                    }
                    else {
                        // Leave missing - will need manual fix or runtime error
                        this.log(ctx, `  → Warning: reduce ${reduceOp} operation missing field parameter`);
                    }
                }
            }
        }
        // Normalize filter conditions
        if (step.operation === 'filter' && step.config) {
            if (step.config.condition) {
                step.config.condition = this.normalizeConditionRefs(step.config.condition, ctx);
            }
            if (step.config.filter_expression) {
                step.config.filter_expression = this.normalizeFilterExpressionRefs(step.config.filter_expression, ctx);
            }
        }
        return step;
    }
    /**
     * Normalize scatter_gather step references
     */
    async normalizeScatterGatherStepRefs(step, variables, ctx) {
        // Normalize scatter input
        if (step.scatter?.input && !step.scatter.input.includes('{{')) {
            step.scatter.input = `{{${step.scatter.input}}}`;
        }
        // Add item variable to scope
        const itemVar = step.scatter?.itemVariable || 'item';
        variables.add(itemVar);
        // Normalize nested steps
        if (step.scatter?.steps) {
            const normalized = [];
            for (const s of step.scatter.steps) {
                const normalizedStep = await this.normalizeStep(s, variables, ctx);
                normalized.push(normalizedStep);
            }
            step.scatter.steps = normalized;
        }
        // Remove item variable from scope
        variables.delete(itemVar);
        // Check gather operation
        if (step.gather?.operation === 'flatten') {
            // Check if nested steps actually return arrays
            const hasArrayOutputs = step.scatter?.steps?.some((s) => s.operation === 'list' || s.operation === 'search');
            if (!hasArrayOutputs) {
                this.log(ctx, `  → Warning: Step ${step.step_id} uses gather='flatten' but may need 'collect'`);
            }
        }
        return step;
    }
    /**
     * Normalize conditional step references
     */
    async normalizeConditionalStepRefs(step, variables, ctx) {
        if (step.condition) {
            step.condition = this.normalizeConditionRefs(step.condition, ctx);
        }
        if (step.steps) {
            const normalized = [];
            for (const s of step.steps) {
                const normalizedStep = await this.normalizeStep(s, variables, ctx);
                normalized.push(normalizedStep);
            }
            step.steps = normalized;
        }
        return step;
    }
    /**
     * Normalize AI processing step references
     */
    normalizeAIStepRefs(step, variables, ctx) {
        // Check if output schema is defined
        if (!step.output_schema && !step.config?.output_schema) {
            this.log(ctx, `  → Warning: AI step ${step.step_id} missing output_schema`);
        }
        return step;
    }
    /**
     * Normalize config references
     */
    normalizeConfigRefs(config, variables, ctx) {
        if (!config || typeof config !== 'object')
            return config;
        const normalized = Array.isArray(config) ? [] : {};
        for (const [key, value] of Object.entries(config)) {
            if (typeof value === 'string') {
                // Check if it's a known variable (not already wrapped)
                if (!value.includes('{{') && !value.includes('config.')) {
                    // Check if it's a variable name or field path
                    const baseVar = value.split('.')[0];
                    if (variables.has(baseVar)) {
                        normalized[key] = `{{${value}}}`;
                    }
                    else {
                        normalized[key] = value;
                    }
                }
                else {
                    normalized[key] = value;
                }
            }
            else if (typeof value === 'object') {
                normalized[key] = this.normalizeConfigRefs(value, variables, ctx);
            }
            else {
                normalized[key] = value;
            }
        }
        return normalized;
    }
    /**
     * Normalize condition references
     */
    normalizeConditionRefs(condition, ctx) {
        if (!condition)
            return condition;
        const normalized = { ...condition };
        // Simple condition
        if (condition.conditionType === 'simple' || condition.type === 'simple') {
            // Field and variable are already in the right format for conditions
            // Just ensure they're valid
        }
        // Complex conditions (recursive)
        if (condition.conditions) {
            normalized.conditions = condition.conditions.map((c) => this.normalizeConditionRefs(c, ctx));
        }
        return normalized;
    }
    /**
     * Normalize filter expression references
     */
    normalizeFilterExpressionRefs(expr, ctx) {
        if (!expr)
            return expr;
        const normalized = { ...expr };
        // Simple expressions
        if (expr.type === 'simple') {
            // Filter expressions are fine as-is; they operate on array items
        }
        return normalized;
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
    mergeRedundantAIMergeSteps(workflow, ctx) {
        const stepsToRemove = new Set();
        const optimizedSteps = [];
        for (let i = 0; i < workflow.length; i++) {
            const currentStep = workflow[i];
            const nextStep = i < workflow.length - 1 ? workflow[i + 1] : null;
            // Check if current step is deterministic_extraction
            if (currentStep.type === 'deterministic_extraction' && nextStep) {
                // Check if next step is AI merge operation
                if (this.isAIMergeOperation(nextStep, currentStep)) {
                    this.log(ctx, `Optimization: Merging redundant AI step ${nextStep.step_id} into ${currentStep.step_id}`);
                    // Expand current step's output_schema with fields from next step
                    const mergedStep = this.expandOutputSchema(currentStep, nextStep);
                    optimizedSteps.push(mergedStep);
                    // Mark next step for removal
                    stepsToRemove.add(nextStep.step_id || nextStep.id);
                    // Skip next step in loop
                    i++;
                    continue;
                }
            }
            // Keep step if not marked for removal
            if (!stepsToRemove.has(currentStep.step_id || currentStep.id)) {
                optimizedSteps.push(currentStep);
            }
        }
        // Update variable references to point from removed steps to their predecessors
        return this.updateVariableReferencesAfterOptimization(optimizedSteps, stepsToRemove, workflow, ctx);
    }
    /**
     * Check if a step is an AI merge operation
     */
    isAIMergeOperation(step, previousStep) {
        // Must be ai_processing
        if (step.type !== 'ai_processing')
            return false;
        // Check config for AI type
        const aiType = step.config?.ai_type;
        if (aiType !== 'generate' && aiType !== 'transform')
            return false;
        // Check if instruction contains merge/combine keywords
        const instruction = (step.prompt || step.description || '').toLowerCase();
        const mergeKeywords = ['combine', 'merge', 'create complete', 'create a complete', 'add metadata', 'include metadata'];
        const hasMergeIntent = mergeKeywords.some(kw => instruction.includes(kw));
        if (!hasMergeIntent)
            return false;
        // Check if input references the previous step
        const input = step.input || '';
        const prevStepId = previousStep.step_id || previousStep.id;
        const prevOutputVar = previousStep.output_variable || prevStepId;
        const referencesPrevious = input.includes(`{{${prevStepId}`) || input.includes(`{{${prevOutputVar}`);
        return referencesPrevious;
    }
    /**
     * Expand output_schema of extraction step to include merge fields
     */
    expandOutputSchema(extractionStep, mergeStep) {
        const mergedStep = { ...extractionStep };
        // Get schemas
        const extractSchema = extractionStep.config?.output_schema || extractionStep.output_schema;
        const mergeSchema = mergeStep.config?.output_schema || mergeStep.output_schema;
        if (!extractSchema || !mergeSchema) {
            return mergedStep; // Can't merge without schemas
        }
        // Merge properties (JSON Schema format)
        if (extractSchema.properties && mergeSchema.properties) {
            mergedStep.config = mergedStep.config || {};
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
            };
            // Also update top-level output_schema if present
            if (mergedStep.output_schema) {
                mergedStep.output_schema = mergedStep.config.output_schema;
            }
        }
        // Update output_variable to use the merge step's name (for better context)
        if (mergeStep.output_variable) {
            mergedStep.output_variable = mergeStep.output_variable;
        }
        return mergedStep;
    }
    /**
     * Update variable references after removing optimized steps
     */
    updateVariableReferencesAfterOptimization(steps, removedSteps, originalWorkflow, ctx) {
        if (removedSteps.size === 0)
            return steps;
        // Build mapping: removed step ID -> its predecessor's output variable
        const replacementMap = new Map();
        for (let i = 0; i < originalWorkflow.length; i++) {
            const currentStep = originalWorkflow[i];
            const currentId = currentStep.step_id || currentStep.id;
            if (removedSteps.has(currentId) && i > 0) {
                const prevStep = originalWorkflow[i - 1];
                const prevOutputVar = prevStep.output_variable || prevStep.step_id || prevStep.id;
                const removedOutputVar = currentStep.output_variable || currentId;
                replacementMap.set(removedOutputVar, prevOutputVar);
                replacementMap.set(currentId, prevOutputVar);
                this.log(ctx, `Optimization: Redirecting references from {{${removedOutputVar}}} to {{${prevOutputVar}}}`);
            }
        }
        // Update all variable references in remaining steps
        return steps.map(step => this.replaceVariableReferences(step, replacementMap));
    }
    /**
     * Recursively replace variable references in a step
     */
    replaceVariableReferences(obj, replacements) {
        if (typeof obj === 'string') {
            let updated = obj;
            for (const [oldVar, newVar] of Array.from(replacements.entries())) {
                const pattern = new RegExp(`\\{\\{${oldVar}(\\.|\\}})`, 'g');
                updated = updated.replace(pattern, `{{${newVar}$1`);
            }
            return updated;
        }
        if (Array.isArray(obj)) {
            return obj.map(item => this.replaceVariableReferences(item, replacements));
        }
        if (obj && typeof obj === 'object') {
            const updated = {};
            for (const [key, value] of Object.entries(obj)) {
                updated[key] = this.replaceVariableReferences(value, replacements);
            }
            return updated;
        }
        return obj;
    }
    /**
     * Logging helpers
     */
    log(ctx, message) {
        ctx.logs.push(message);
        this.logger.info(message);
    }
    warn(ctx, message) {
        ctx.warnings.push(message);
        this.logger.warn(message);
    }
    error(ctx, message) {
        ctx.warnings.push(`ERROR: ${message}`);
        this.logger.error(message);
    }
}
