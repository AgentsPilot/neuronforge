/**
 * Execution Graph Validator
 *
 * Performs deep semantic validation of execution graphs beyond JSON Schema.
 * Validates:
 * - Graph structure (DAG, reachability, no cycles except loop bodies)
 * - Data flow (variables declared before use, no undefined references)
 * - Control flow (all next references valid, all paths lead to end)
 * - Loop convergence (loop bodies must have path back to loop_end)
 * - Choice coverage (all choice nodes have default path)
 *
 * Returns actionable error messages to help LLMs fix generation issues.
 */

import type {
  ExecutionGraph,
  ExecutionNode,
  InputBinding,
  OutputBinding,
  ConditionExpression
} from '../schemas/declarative-ir-types-v4'
import type { SchemaField, WorkflowDataSchema } from '../schemas/workflow-data-schema'

export interface ValidationError {
  type: 'error' | 'warning'
  category: 'structure' | 'data_flow' | 'control_flow' | 'semantics' | 'schema'
  node_id?: string
  message: string
  suggestion?: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationError[]
}

export class ExecutionGraphValidator {
  private errors: ValidationError[] = []
  private warnings: ValidationError[] = []
  private visitedNodes: Set<string> = new Set()
  private variableScope: Map<string, 'global' | 'loop' | 'branch'> = new Map()
  private declaredVariables: Set<string> = new Set()
  private usedVariables: Set<string> = new Set()

  /**
   * Main validation entry point
   */
  validate(graph: ExecutionGraph): ValidationResult {
    this.reset()

    // Phase 1: Structural validation
    this.validateGraphStructure(graph)

    // Phase 2: Variable declarations
    this.validateVariableDeclarations(graph)

    // Phase 3: Control flow validation
    this.validateControlFlow(graph)

    // Phase 4: Data flow validation
    this.validateDataFlow(graph)

    // Phase 5: Node-specific validation
    this.validateAllNodes(graph)

    // Phase 6: Data schema validation (only if data_schema is present)
    if (graph.data_schema) {
      this.validateDataSchema(graph, graph.data_schema)
    }

    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings
    }
  }

  private reset() {
    this.errors = []
    this.warnings = []
    this.visitedNodes.clear()
    this.variableScope.clear()
    this.declaredVariables.clear()
    this.usedVariables.clear()
  }

  /**
   * Phase 1: Validate graph structure
   */
  private validateGraphStructure(graph: ExecutionGraph) {
    // Check start node exists
    if (!graph.start) {
      this.addError('structure', undefined, 'Missing start node', 'Add a "start" field with the entry point node ID')
      return
    }

    if (!graph.nodes[graph.start]) {
      this.addError('structure', graph.start, `Start node "${graph.start}" not found in nodes`, 'Ensure the start node ID matches a node in the nodes object')
      return
    }

    // Check all nodes are reachable from start
    const reachable = this.findReachableNodes(graph, graph.start)
    const allNodeIds = Object.keys(graph.nodes)

    for (const nodeId of allNodeIds) {
      if (!reachable.has(nodeId) && nodeId !== graph.start) {
        this.addWarning('structure', nodeId, `Node "${nodeId}" is unreachable from start`, 'Remove unreachable nodes or add a path from the start node')
      }
    }

    // Check for cycles (except within loop bodies)
    this.detectCycles(graph)

    // Check all paths lead to an end node
    this.validateAllPathsEnd(graph)
  }

  /**
   * Find all nodes reachable from a start node
   */
  private findReachableNodes(graph: ExecutionGraph, startId: string): Set<string> {
    const reachable = new Set<string>()
    const queue: string[] = [startId]

    while (queue.length > 0) {
      const currentId = queue.shift()!
      if (reachable.has(currentId)) continue

      reachable.add(currentId)
      const node = graph.nodes[currentId]

      if (!node) continue

      // Add next nodes to queue
      if (node.next) {
        const nextIds = Array.isArray(node.next) ? node.next : [node.next]
        queue.push(...nextIds)
      }

      // For choice nodes, add all rule targets and default
      if (node.type === 'choice' && node.choice) {
        for (const rule of node.choice.rules) {
          queue.push(rule.next)
        }
        queue.push(node.choice.default)
      }

      // For loop nodes, add body_start
      if (node.type === 'loop' && node.loop) {
        queue.push(node.loop.body_start)
      }

      // For parallel nodes, add all branch starts
      if (node.type === 'parallel' && node.parallel) {
        for (const branch of node.parallel.branches) {
          queue.push(branch.start)
        }
      }
    }

    return reachable
  }

  /**
   * Detect cycles in the graph (excluding loop bodies)
   */
  private detectCycles(graph: ExecutionGraph) {
    const visited = new Set<string>()
    const recursionStack = new Set<string>()

    const dfs = (nodeId: string, path: string[]): boolean => {
      if (!graph.nodes[nodeId]) return false

      if (recursionStack.has(nodeId)) {
        // Cycle detected
        const cycleStart = path.indexOf(nodeId)
        const cycle = path.slice(cycleStart).concat(nodeId)
        this.addError('structure', nodeId, `Cycle detected: ${cycle.join(' → ')}`, 'Remove circular references or use a loop node for iteration')
        return true
      }

      if (visited.has(nodeId)) return false

      visited.add(nodeId)
      recursionStack.add(nodeId)
      path.push(nodeId)

      const node = graph.nodes[nodeId]

      // Skip cycle detection inside loop bodies (loops are allowed to cycle)
      if (node.type === 'loop') {
        // Don't follow body_start from loop nodes in cycle detection
        if (node.next) {
          const nextIds = Array.isArray(node.next) ? node.next : [node.next]
          for (const nextId of nextIds) {
            dfs(nextId, [...path])
          }
        }
      } else {
        // Regular node - check all outgoing edges
        const outgoing = this.getOutgoingNodes(node)
        for (const nextId of outgoing) {
          dfs(nextId, [...path])
        }
      }

      recursionStack.delete(nodeId)
      path.pop()
      return false
    }

    dfs(graph.start, [])
  }

  /**
   * Get all outgoing node IDs from a node
   */
  private getOutgoingNodes(node: ExecutionNode): string[] {
    const outgoing: string[] = []

    if (node.next) {
      outgoing.push(...(Array.isArray(node.next) ? node.next : [node.next]))
    }

    if (node.type === 'choice' && node.choice) {
      for (const rule of node.choice.rules) {
        outgoing.push(rule.next)
      }
      outgoing.push(node.choice.default)
    }

    if (node.type === 'loop' && node.loop) {
      outgoing.push(node.loop.body_start)
    }

    if (node.type === 'parallel' && node.parallel) {
      for (const branch of node.parallel.branches) {
        outgoing.push(branch.start)
      }
    }

    return outgoing
  }

  /**
   * Validate all paths lead to an end node
   */
  private validateAllPathsEnd(graph: ExecutionGraph) {
    const endNodes = Object.values(graph.nodes).filter(n => n.type === 'end')

    if (endNodes.length === 0) {
      this.addError('structure', undefined, 'No end node found', 'Add at least one node with type: "end"')
      return
    }

    // Check if all leaf nodes (nodes with no outgoing edges) are end nodes
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      if (node.type === 'end') continue

      const outgoing = this.getOutgoingNodes(node)
      if (outgoing.length === 0) {
        this.addError('control_flow', nodeId, `Node "${nodeId}" has no outgoing edges and is not an end node`, 'Add a "next" field or change type to "end"')
      }
    }
  }

  /**
   * Phase 2: Validate variable declarations
   */
  private validateVariableDeclarations(graph: ExecutionGraph) {
    if (!graph.variables) return

    const seenNames = new Set<string>()

    for (const variable of graph.variables) {
      // Check for duplicates
      if (seenNames.has(variable.name)) {
        this.addError('data_flow', undefined, `Duplicate variable declaration: "${variable.name}"`, 'Remove duplicate variable declarations')
      }
      seenNames.add(variable.name)

      // Track variable scope
      this.variableScope.set(variable.name, variable.scope)
      this.declaredVariables.add(variable.name)
    }
  }

  /**
   * Phase 3: Validate control flow
   */
  private validateControlFlow(graph: ExecutionGraph) {
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      // Validate next references
      if (node.next) {
        const nextIds = Array.isArray(node.next) ? node.next : [node.next]
        for (const nextId of nextIds) {
          if (!graph.nodes[nextId]) {
            this.addError('control_flow', nodeId, `Node "${nodeId}" references non-existent next node: "${nextId}"`, `Ensure "${nextId}" exists in the nodes object`)
          }
        }
      }

      // Validate choice node references
      if (node.type === 'choice' && node.choice) {
        for (const rule of node.choice.rules) {
          if (!graph.nodes[rule.next]) {
            this.addError('control_flow', nodeId, `Choice rule references non-existent node: "${rule.next}"`, `Ensure "${rule.next}" exists in the nodes object`)
          }
        }
        if (!graph.nodes[node.choice.default]) {
          this.addError('control_flow', nodeId, `Choice default references non-existent node: "${node.choice.default}"`, `Ensure "${node.choice.default}" exists in the nodes object`)
        }
      }

      // Validate loop node references
      if (node.type === 'loop' && node.loop) {
        if (!graph.nodes[node.loop.body_start]) {
          this.addError('control_flow', nodeId, `Loop body_start references non-existent node: "${node.loop.body_start}"`, `Ensure "${node.loop.body_start}" exists in the nodes object`)
        }
      }

      // Validate parallel node references
      if (node.type === 'parallel' && node.parallel) {
        for (const branch of node.parallel.branches) {
          if (!graph.nodes[branch.start]) {
            this.addError('control_flow', nodeId, `Parallel branch "${branch.id}" references non-existent start node: "${branch.start}"`, `Ensure "${branch.start}" exists in the nodes object`)
          }
        }
      }
    }
  }

  /**
   * Phase 4: Validate data flow (variables used before declared)
   */
  private validateDataFlow(graph: ExecutionGraph) {
    const executionOrder = this.getTopologicalOrder(graph)

    const availableVariables = new Set<string>(this.declaredVariables)

    for (const nodeId of executionOrder) {
      const node = graph.nodes[nodeId]
      if (!node) continue

      // Check inputs
      if (node.inputs) {
        for (const input of node.inputs) {
          const varName = this.extractVariableName(input.variable)
          this.usedVariables.add(varName)

          if (!availableVariables.has(varName)) {
            this.addError('data_flow', nodeId, `Node "${nodeId}" reads from undeclared variable: "${varName}"`, `Declare "${varName}" in the variables array or ensure it's written by a previous node`)
          }
        }
      }

      // Check condition variables (for choice nodes)
      if (node.type === 'choice' && node.choice) {
        for (const rule of node.choice.rules) {
          const conditionVars = this.extractConditionVariables(rule.condition)
          for (const varName of conditionVars) {
            this.usedVariables.add(varName)
            if (!availableVariables.has(varName)) {
              this.addError('data_flow', nodeId, `Choice condition references undeclared variable: "${varName}"`, `Declare "${varName}" or ensure it's available before this node`)
            }
          }
        }
      }

      // Add outputs to available variables
      if (node.outputs) {
        for (const output of node.outputs) {
          const varName = this.extractVariableName(output.variable)
          availableVariables.add(varName)
        }
      }

      // Loop nodes declare their item variable
      if (node.type === 'loop' && node.loop) {
        availableVariables.add(node.loop.item_variable)
        if (node.loop.output_variable) {
          availableVariables.add(node.loop.output_variable)
        }
      }
    }

    // Warn about unused variables
    for (const varName of this.declaredVariables) {
      if (!this.usedVariables.has(varName)) {
        this.addWarning('data_flow', undefined, `Variable "${varName}" is declared but never used`, 'Remove unused variable declarations')
      }
    }
  }

  /**
   * Get topological ordering of nodes (execution order)
   */
  private getTopologicalOrder(graph: ExecutionGraph): string[] {
    const order: string[] = []
    const visited = new Set<string>()

    const dfs = (nodeId: string) => {
      if (visited.has(nodeId) || !graph.nodes[nodeId]) return
      visited.add(nodeId)

      const node = graph.nodes[nodeId]

      // Visit children first
      const outgoing = this.getOutgoingNodes(node)
      for (const nextId of outgoing) {
        dfs(nextId)
      }

      order.unshift(nodeId) // Add to front (reverse postorder)
    }

    dfs(graph.start)
    return order
  }

  /**
   * Extract variable name from potentially dotted path
   */
  private extractVariableName(variableRef: string): string {
    // Handle "variable.path" → extract "variable"
    const parts = variableRef.split('.')
    return parts[0]
  }

  /**
   * Extract all variable names from a condition
   */
  private extractConditionVariables(condition: ConditionExpression): string[] {
    const vars: string[] = []

    if (condition.type === 'simple') {
      vars.push(this.extractVariableName(condition.variable))
    } else if (condition.type === 'complex') {
      for (const subCondition of condition.conditions) {
        vars.push(...this.extractConditionVariables(subCondition))
      }
    }

    return vars
  }

  /**
   * Phase 5: Validate node-specific semantics
   */
  private validateAllNodes(graph: ExecutionGraph) {
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      this.validateNode(nodeId, node)
    }
  }

  private validateNode(nodeId: string, node: ExecutionNode) {
    switch (node.type) {
      case 'operation':
        this.validateOperationNode(nodeId, node)
        break
      case 'choice':
        this.validateChoiceNode(nodeId, node)
        break
      case 'loop':
        this.validateLoopNode(nodeId, node)
        break
      case 'parallel':
        this.validateParallelNode(nodeId, node)
        break
      case 'end':
        // End nodes are always valid
        break
    }
  }

  private validateOperationNode(nodeId: string, node: ExecutionNode) {
    if (!node.operation) {
      this.addError('semantics', nodeId, `Operation node "${nodeId}" missing operation config`, 'Add an "operation" field with operation_type and corresponding config')
      return
    }

    const op = node.operation

    // Validate discriminated union
    switch (op.operation_type) {
      case 'fetch':
        if (!op.fetch) {
          this.addError('semantics', nodeId, `Fetch operation missing "fetch" config`, 'Add a "fetch" field with plugin_key and action')
        }
        break
      case 'transform':
        if (!op.transform) {
          this.addError('semantics', nodeId, `Transform operation missing "transform" config`, 'Add a "transform" field with type and input')
        }
        break
      case 'ai':
        if (!op.ai) {
          this.addError('semantics', nodeId, `AI operation missing "ai" config`, 'Add an "ai" field with type and instruction')
        }
        break
      case 'deliver':
        if (!op.deliver) {
          this.addError('semantics', nodeId, `Deliver operation missing "deliver" config`, 'Add a "deliver" field with plugin_key and action')
        }
        break
      case 'file_op':
        if (!op.file_op) {
          this.addError('semantics', nodeId, `File operation missing "file_op" config`, 'Add a "file_op" field with type')
        }
        break
    }
  }

  private validateChoiceNode(nodeId: string, node: ExecutionNode) {
    if (!node.choice) {
      this.addError('semantics', nodeId, `Choice node "${nodeId}" missing choice config`, 'Add a "choice" field with rules and default')
      return
    }

    if (node.choice.rules.length === 0) {
      this.addWarning('semantics', nodeId, `Choice node "${nodeId}" has no rules, will always use default path`, 'Add conditional rules or use a regular operation node')
    }
  }

  private validateLoopNode(nodeId: string, node: ExecutionNode) {
    if (!node.loop) {
      this.addError('semantics', nodeId, `Loop node "${nodeId}" missing loop config`, 'Add a "loop" field with iterate_over, item_variable, and body_start')
      return
    }

    if (node.loop.collect_outputs && !node.loop.output_variable) {
      this.addError('semantics', nodeId, `Loop node "${nodeId}" has collect_outputs=true but no output_variable`, 'Add an "output_variable" field to store collected outputs')
    }
  }

  private validateParallelNode(nodeId: string, node: ExecutionNode) {
    if (!node.parallel) {
      this.addError('semantics', nodeId, `Parallel node "${nodeId}" missing parallel config`, 'Add a "parallel" field with branches and wait_strategy')
      return
    }

    if (node.parallel.branches.length < 2) {
      this.addError('semantics', nodeId, `Parallel node "${nodeId}" must have at least 2 branches`, 'Add more branches or use a regular operation node')
    }

    if (node.parallel.wait_strategy === 'n' && !node.parallel.wait_count) {
      this.addError('semantics', nodeId, `Parallel node "${nodeId}" has wait_strategy="n" but no wait_count`, 'Add a "wait_count" field specifying how many branches to wait for')
    }

    // Check for duplicate branch IDs
    const branchIds = new Set<string>()
    for (const branch of node.parallel.branches) {
      if (branchIds.has(branch.id)) {
        this.addError('semantics', nodeId, `Parallel node "${nodeId}" has duplicate branch ID: "${branch.id}"`, 'Ensure all branch IDs are unique')
      }
      branchIds.add(branch.id)
    }
  }

  // ============================================================================
  // Phase 6: Data Schema Validation
  // ============================================================================

  /**
   * Validate data_schema consistency:
   * - All input/output bindings reference declared slots
   * - All produced_by fields reference existing nodes
   * - AI output_schema depth enforcement (CRITICAL)
   */
  private validateDataSchema(graph: ExecutionGraph, dataSchema: WorkflowDataSchema) {
    const slotNames = new Set(Object.keys(dataSchema.slots))
    const nodeIds = new Set(Object.keys(graph.nodes))

    // 6a. Validate produced_by references existing nodes
    for (const [slotName, slot] of Object.entries(dataSchema.slots)) {
      if (!nodeIds.has(slot.produced_by)) {
        this.addError('schema', slot.produced_by,
          `Data slot "${slotName}" has produced_by="${slot.produced_by}" which does not exist in nodes`,
          `Ensure produced_by references a valid node ID`)
      }
    }

    // 6b. Validate all input bindings reference declared slots
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      if (node.inputs) {
        for (const input of node.inputs) {
          const rootVar = this.extractVariableName(input.variable)
          if (!slotNames.has(rootVar) && rootVar !== 'input' && rootVar !== 'inputs') {
            this.addWarning('schema', nodeId,
              `Node "${nodeId}" reads from "${rootVar}" which is not declared in data_schema.slots`,
              `Add a slot for "${rootVar}" in data_schema.slots or verify the variable name`)
          }
        }
      }

      // 6c. Validate output bindings reference declared slots
      if (node.outputs) {
        for (const output of node.outputs) {
          const rootVar = this.extractVariableName(output.variable)
          if (!slotNames.has(rootVar)) {
            this.addWarning('schema', nodeId,
              `Node "${nodeId}" writes to "${rootVar}" which is not declared in data_schema.slots`,
              `Add a slot for "${rootVar}" in data_schema.slots`)
          }
        }
      }

      // 6d. Validate loop iterate_over and item_variable reference slots
      if (node.type === 'loop' && node.loop) {
        const iterateRoot = this.extractVariableName(node.loop.iterate_over)
        if (!slotNames.has(iterateRoot)) {
          this.addWarning('schema', nodeId,
            `Loop "${nodeId}" iterates over "${iterateRoot}" which is not declared in data_schema.slots`,
            `Add a slot for "${iterateRoot}" in data_schema.slots`)
        }

        if (!slotNames.has(node.loop.item_variable)) {
          this.addWarning('schema', nodeId,
            `Loop "${nodeId}" item_variable "${node.loop.item_variable}" not declared in data_schema.slots`,
            `Add a loop-scoped slot for "${node.loop.item_variable}" in data_schema.slots`)
        }
      }

      // 6e. Validate choice condition variables reference slots
      if (node.type === 'choice' && node.choice) {
        for (const rule of node.choice.rules) {
          const conditionVars = this.extractConditionVariables(rule.condition)
          for (const varName of conditionVars) {
            if (!slotNames.has(varName) && varName !== 'input' && varName !== 'inputs') {
              this.addWarning('schema', nodeId,
                `Choice condition references "${varName}" which is not declared in data_schema.slots`,
                `Add a slot for "${varName}" in data_schema.slots`)
            }
          }
        }
      }
    }

    // 6f. [CRITICAL] AI output_schema depth enforcement
    this.validateAISchemaDepth(graph, dataSchema)
  }

  /**
   * [CRITICAL] Enforce AI output_schema depth.
   * Reject array fields without `items` and object fields without `properties`
   * in AI-declared schemas.
   */
  private validateAISchemaDepth(graph: ExecutionGraph, dataSchema: WorkflowDataSchema) {
    for (const [slotName, slot] of Object.entries(dataSchema.slots)) {
      if (slot.schema.source !== 'ai_declared') continue

      const depthErrors = this.checkSchemaDepth(slot.schema, slotName)
      for (const err of depthErrors) {
        this.addError('schema', slot.produced_by, err,
          `AI-declared schemas must include full item-level depth. ` +
          `Arrays need "items" with properties, objects need "properties".`)
      }
    }
  }

  /**
   * Recursively check that arrays have items and objects have properties.
   */
  private checkSchemaDepth(schema: SchemaField, path: string): string[] {
    const errors: string[] = []

    if (schema.type === 'array' && !schema.items) {
      errors.push(`${path}: array field missing "items" schema`)
    }

    if (schema.type === 'object' && !schema.properties) {
      errors.push(`${path}: object field missing "properties" schema`)
    }

    // Recurse into properties
    if (schema.properties) {
      for (const [key, fieldSchema] of Object.entries(schema.properties)) {
        errors.push(...this.checkSchemaDepth(fieldSchema, `${path}.${key}`))
      }
    }

    // Recurse into items
    if (schema.items) {
      errors.push(...this.checkSchemaDepth(schema.items, `${path}.items`))
    }

    // Recurse into oneOf branches
    if (schema.oneOf) {
      for (let i = 0; i < schema.oneOf.length; i++) {
        errors.push(...this.checkSchemaDepth(schema.oneOf[i], `${path}.oneOf[${i}]`))
      }
    }

    return errors
  }

  private addError(category: ValidationError['category'], nodeId: string | undefined, message: string, suggestion?: string) {
    this.errors.push({
      type: 'error',
      category,
      node_id: nodeId,
      message,
      suggestion
    })
  }

  private addWarning(category: ValidationError['category'], nodeId: string | undefined, message: string, suggestion?: string) {
    this.warnings.push({
      type: 'warning',
      category,
      node_id: nodeId,
      message,
      suggestion
    })
  }
}

/**
 * Convenience function for validating execution graphs
 */
export function validateExecutionGraph(graph: ExecutionGraph): ValidationResult {
  const validator = new ExecutionGraphValidator()
  return validator.validate(graph)
}
