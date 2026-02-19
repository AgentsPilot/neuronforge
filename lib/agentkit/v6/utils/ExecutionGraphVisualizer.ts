/**
 * Execution Graph Visualizer
 *
 * Generates visual representations of execution graphs for debugging and documentation.
 * Supports:
 * - Mermaid diagrams (for markdown/GitHub)
 * - DOT graphs (for Graphviz)
 * - Text-based representation
 *
 * Usage:
 * ```typescript
 * const visualizer = new ExecutionGraphVisualizer()
 * const mermaid = visualizer.toMermaid(executionGraph)
 * console.log(mermaid)
 * ```
 */

import type {
  ExecutionGraph,
  ExecutionNode,
  ChoiceConfig,
  LoopConfig,
  ParallelConfig
} from '../logical-ir/schemas/declarative-ir-types-v4'

export class ExecutionGraphVisualizer {
  /**
   * Generate Mermaid diagram
   *
   * Output can be rendered in GitHub markdown, VS Code, or mermaid.live
   */
  toMermaid(graph: ExecutionGraph): string {
    const lines: string[] = []

    lines.push('graph TB')
    lines.push(`  start([Start]) --> ${graph.start}`)
    lines.push('')

    // Add all nodes
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      this.addMermaidNode(node, graph, lines)
    }

    // Add styling
    lines.push('')
    lines.push('  %% Styling')
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      if (node.type === 'operation' && node.operation) {
        const style = this.getMermaidStyle(node.operation.operation_type)
        if (style) {
          lines.push(`  style ${nodeId} ${style}`)
        }
      }
    }

    return lines.join('\n')
  }

  /**
   * Add a node to the Mermaid diagram
   */
  private addMermaidNode(node: ExecutionNode, graph: ExecutionGraph, lines: string[]) {
    const label = this.getNodeLabel(node)

    switch (node.type) {
      case 'operation':
        lines.push(`  ${node.id}[${label}]`)
        if (node.next) {
          lines.push(`  ${node.id} --> ${node.next}`)
        }
        break

      case 'choice':
        if (!node.choice) break
        lines.push(`  ${node.id}{${label}}`)
        for (const rule of node.choice.rules) {
          const condition = this.getConditionLabel(rule.condition)
          lines.push(`  ${node.id} -->|${condition}| ${rule.next}`)
        }
        lines.push(`  ${node.id} -->|else| ${node.choice.default}`)
        break

      case 'loop':
        if (!node.loop) break
        lines.push(`  ${node.id}{{${label}}}`)
        lines.push(`  ${node.id} --> ${node.loop.body_start}`)
        if (node.next) {
          lines.push(`  ${node.id} -.->|after loop| ${node.next}`)
        }
        break

      case 'parallel':
        if (!node.parallel) break
        lines.push(`  ${node.id}[[${label}]]`)
        for (const branch of node.parallel.branches) {
          lines.push(`  ${node.id} --> ${branch.start}`)
        }
        if (node.next) {
          lines.push(`  ${node.id} -.->|after parallel| ${node.next}`)
        }
        break

      case 'end':
        lines.push(`  ${node.id}([End])`)
        break
    }
  }

  /**
   * Get node label for Mermaid
   */
  private getNodeLabel(node: ExecutionNode): string {
    switch (node.type) {
      case 'operation':
        if (!node.operation) return node.id
        const opType = node.operation.operation_type
        if (opType === 'fetch' && node.operation.fetch) {
          return `Fetch: ${node.operation.fetch.plugin_key}`
        }
        if (opType === 'ai' && node.operation.ai) {
          return `AI: ${node.operation.ai.type}`
        }
        if (opType === 'deliver' && node.operation.deliver) {
          return `Deliver: ${node.operation.deliver.plugin_key}`
        }
        return `Op: ${opType}`

      case 'choice':
        return `Choice: ${node.id}`

      case 'loop':
        if (!node.loop) return node.id
        return `Loop: ${node.loop.iterate_over}`

      case 'parallel':
        return `Parallel: ${node.id}`

      case 'end':
        return 'End'

      default:
        return node.id
    }
  }

  /**
   * Get condition label for Mermaid
   */
  private getConditionLabel(condition: any): string {
    if (condition.type === 'simple') {
      const op = condition.operator
      const value = condition.value
      return `${condition.variable} ${op} ${value}`
    }
    return 'condition'
  }

  /**
   * Get Mermaid styling for operation types
   */
  private getMermaidStyle(operationType: string): string | null {
    const styles: Record<string, string> = {
      'fetch': 'fill:#e1f5ff',
      'ai': 'fill:#fff4e1',
      'deliver': 'fill:#e8f5e9',
      'transform': 'fill:#f3e5f5',
      'file_op': 'fill:#fff3e0'
    }
    return styles[operationType] || null
  }

  /**
   * Generate DOT graph (Graphviz format)
   */
  toDOT(graph: ExecutionGraph): string {
    const lines: string[] = []

    lines.push('digraph ExecutionGraph {')
    lines.push('  rankdir=TB;')
    lines.push('  node [shape=box];')
    lines.push('')

    // Add nodes
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      const label = this.getNodeLabel(node)
      const shape = this.getDOTShape(node.type)
      const color = node.type === 'operation' && node.operation
        ? this.getDOTColor(node.operation.operation_type)
        : 'lightgray'

      lines.push(`  ${nodeId} [label="${label}", shape=${shape}, fillcolor="${color}", style=filled];`)
    }

    lines.push('')

    // Add edges
    lines.push(`  start [label="Start", shape=circle];`)
    lines.push(`  start -> ${graph.start};`)

    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      this.addDOTEdges(node, lines)
    }

    lines.push('}')

    return lines.join('\n')
  }

  /**
   * Add edges to DOT graph
   */
  private addDOTEdges(node: ExecutionNode, lines: string[]) {
    switch (node.type) {
      case 'operation':
        if (node.next) {
          lines.push(`  ${node.id} -> ${node.next};`)
        }
        break

      case 'choice':
        if (!node.choice) break
        for (const rule of node.choice.rules) {
          const label = this.getConditionLabel(rule.condition)
          lines.push(`  ${node.id} -> ${rule.next} [label="${label}"];`)
        }
        lines.push(`  ${node.id} -> ${node.choice.default} [label="else", style=dashed];`)
        break

      case 'loop':
        if (!node.loop) break
        lines.push(`  ${node.id} -> ${node.loop.body_start} [label="body"];`)
        if (node.next) {
          lines.push(`  ${node.id} -> ${node.next} [label="after", style=dashed];`)
        }
        break

      case 'parallel':
        if (!node.parallel) break
        for (const branch of node.parallel.branches) {
          lines.push(`  ${node.id} -> ${branch.start} [label="${branch.id}"];`)
        }
        if (node.next) {
          lines.push(`  ${node.id} -> ${node.next} [label="after", style=dashed];`)
        }
        break
    }
  }

  /**
   * Get DOT shape for node type
   */
  private getDOTShape(nodeType: string): string {
    const shapes: Record<string, string> = {
      'operation': 'box',
      'choice': 'diamond',
      'loop': 'hexagon',
      'parallel': 'parallelogram',
      'end': 'circle'
    }
    return shapes[nodeType] || 'box'
  }

  /**
   * Get DOT color for operation type
   */
  private getDOTColor(operationType: string): string {
    const colors: Record<string, string> = {
      'fetch': 'lightblue',
      'ai': 'lightyellow',
      'deliver': 'lightgreen',
      'transform': 'plum',
      'file_op': 'peachpuff'
    }
    return colors[operationType] || 'lightgray'
  }

  /**
   * Generate text-based representation
   */
  toText(graph: ExecutionGraph): string {
    const lines: string[] = []

    lines.push('EXECUTION GRAPH')
    lines.push('='.repeat(80))
    lines.push('')
    lines.push(`Start Node: ${graph.start}`)
    lines.push(`Total Nodes: ${Object.keys(graph.nodes).length}`)
    lines.push(`Variables: ${graph.variables?.length || 0}`)
    lines.push('')

    // Variables
    if (graph.variables && graph.variables.length > 0) {
      lines.push('VARIABLES')
      lines.push('-'.repeat(80))
      for (const variable of graph.variables) {
        lines.push(`  ${variable.name}: ${variable.type} (${variable.scope})`)
      }
      lines.push('')
    }

    // Nodes
    lines.push('NODES')
    lines.push('-'.repeat(80))
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      lines.push(this.nodeToText(node, 0))
    }

    return lines.join('\n')
  }

  /**
   * Convert node to text representation
   */
  private nodeToText(node: ExecutionNode, indent: number): string {
    const prefix = '  '.repeat(indent)
    const lines: string[] = []

    lines.push(`${prefix}[${node.id}] ${node.type.toUpperCase()}`)

    if (node.description) {
      lines.push(`${prefix}  Description: ${node.description}`)
    }

    // Add type-specific info
    switch (node.type) {
      case 'operation':
        if (node.operation) {
          lines.push(`${prefix}  Operation: ${node.operation.operation_type}`)
          if (node.operation.fetch) {
            lines.push(`${prefix}  Plugin: ${node.operation.fetch.plugin_key}`)
            lines.push(`${prefix}  Action: ${node.operation.fetch.action}`)
          }
          if (node.operation.ai) {
            lines.push(`${prefix}  AI Type: ${node.operation.ai.type}`)
          }
        }
        break

      case 'choice':
        if (node.choice) {
          lines.push(`${prefix}  Rules: ${node.choice.rules.length}`)
          lines.push(`${prefix}  Default: ${node.choice.default}`)
        }
        break

      case 'loop':
        if (node.loop) {
          lines.push(`${prefix}  Iterate Over: ${node.loop.iterate_over}`)
          lines.push(`${prefix}  Item Variable: ${node.loop.item_variable}`)
          lines.push(`${prefix}  Body Start: ${node.loop.body_start}`)
        }
        break

      case 'parallel':
        if (node.parallel) {
          lines.push(`${prefix}  Branches: ${node.parallel.branches.length}`)
          lines.push(`${prefix}  Wait Strategy: ${node.parallel.wait_strategy}`)
        }
        break
    }

    // Inputs/Outputs
    if (node.inputs && node.inputs.length > 0) {
      lines.push(`${prefix}  Inputs: ${node.inputs.map(i => i.variable).join(', ')}`)
    }
    if (node.outputs && node.outputs.length > 0) {
      lines.push(`${prefix}  Outputs: ${node.outputs.map(o => o.variable).join(', ')}`)
    }

    // Next
    if (node.next) {
      const next = Array.isArray(node.next) ? node.next.join(', ') : node.next
      lines.push(`${prefix}  Next: ${next}`)
    }

    return lines.join('\n')
  }

  /**
   * Analyze execution graph
   */
  analyze(graph: ExecutionGraph): {
    nodeCount: number
    nodeTypes: Record<string, number>
    maxDepth: number
    estimatedComplexity: 'low' | 'medium' | 'high'
  } {
    const nodeTypes: Record<string, number> = {}
    let maxDepth = 0

    for (const node of Object.values(graph.nodes)) {
      nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1
    }

    // Simple depth estimation
    const visited = new Set<string>()
    const getDepth = (nodeId: string, depth: number): number => {
      if (visited.has(nodeId) || !graph.nodes[nodeId]) return depth
      visited.add(nodeId)

      const node = graph.nodes[nodeId]
      let maxDepth = depth

      if (node.next) {
        const nextIds = Array.isArray(node.next) ? node.next : [node.next]
        for (const nextId of nextIds) {
          maxDepth = Math.max(maxDepth, getDepth(nextId, depth + 1))
        }
      }

      return maxDepth
    }

    maxDepth = getDepth(graph.start, 0)

    const nodeCount = Object.keys(graph.nodes).length
    let estimatedComplexity: 'low' | 'medium' | 'high' = 'low'

    if (nodeCount > 20 || maxDepth > 5 || nodeTypes.loop > 1 || nodeTypes.parallel > 0) {
      estimatedComplexity = 'high'
    } else if (nodeCount > 10 || maxDepth > 3 || nodeTypes.loop > 0) {
      estimatedComplexity = 'medium'
    }

    return {
      nodeCount,
      nodeTypes,
      maxDepth,
      estimatedComplexity
    }
  }
}

/**
 * Convenience function to generate Mermaid diagram
 */
export function generateMermaidDiagram(graph: ExecutionGraph): string {
  const visualizer = new ExecutionGraphVisualizer()
  return visualizer.toMermaid(graph)
}

/**
 * Convenience function to generate DOT graph
 */
export function generateDOTGraph(graph: ExecutionGraph): string {
  const visualizer = new ExecutionGraphVisualizer()
  return visualizer.toDOT(graph)
}
