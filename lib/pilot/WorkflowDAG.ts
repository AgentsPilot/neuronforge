/**
 * WorkflowDAG - Workflow Directed Acyclic Graph Validator
 *
 * Phase 4: Workflow Structure Validation
 * Validates workflow structures, detects cycles, identifies merge points,
 * calculates critical paths, and determines execution order
 */

import type { WorkflowStep } from './types';

export interface DAGValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  hasCycles: boolean;
  cycles?: string[][];
  mergePoints?: string[];
  criticalPath?: string[];
  executionOrder?: string[];
  maxDepth?: number;
  parallelizationOpportunities?: Array<{
    batchNumber: number;
    steps: string[];
  }>;
}

export interface DAGNode {
  id: string;
  step: WorkflowStep;
  dependencies: string[];
  dependents: string[];
  depth: number;
  criticalPathLength: number;
}

export class WorkflowDAG {
  private nodes: Map<string, DAGNode> = new Map();
  private steps: WorkflowStep[];

  constructor(steps: WorkflowStep[]) {
    this.steps = steps;
    this.buildGraph();
  }

  /**
   * Validate entire workflow structure
   */
  validate(): DAGValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for empty workflow
    if (this.steps.length === 0) {
      errors.push('Workflow has no steps');
      return {
        isValid: false,
        errors,
        warnings,
        hasCycles: false,
      };
    }

    // Check for duplicate step IDs
    const duplicates = this.findDuplicateIds();
    if (duplicates.length > 0) {
      errors.push(`Duplicate step IDs found: ${duplicates.join(', ')}`);
    }

    // Check for missing dependencies
    const missingDeps = this.findMissingDependencies();
    if (missingDeps.length > 0) {
      errors.push(`Steps reference non-existent dependencies: ${missingDeps.join(', ')}`);
    }

    // Check for cycles
    const cycles = this.detectCycles();
    const hasCycles = cycles.length > 0;
    if (hasCycles) {
      errors.push(`Workflow contains ${cycles.length} cycle(s)`);
      for (const cycle of cycles) {
        errors.push(`  Cycle: ${cycle.join(' -> ')} -> ${cycle[0]}`);
      }
    }

    // If there are critical errors, return early
    if (errors.length > 0) {
      return {
        isValid: false,
        errors,
        warnings,
        hasCycles,
        cycles: hasCycles ? cycles : undefined,
      };
    }

    // Find merge points (steps with multiple dependencies)
    const mergePoints = this.findMergePoints();
    if (mergePoints.length > 0) {
      warnings.push(`Found ${mergePoints.length} merge point(s): ${mergePoints.join(', ')}`);
    }

    // Calculate execution order (topological sort)
    const executionOrder = this.topologicalSort();
    if (!executionOrder) {
      errors.push('Unable to determine execution order (likely due to cycles)');
      return {
        isValid: false,
        errors,
        warnings,
        hasCycles: true,
      };
    }

    // Calculate critical path
    const criticalPath = this.calculateCriticalPath();

    // Calculate max depth
    const maxDepth = this.calculateMaxDepth();

    // Find parallelization opportunities
    const parallelizationOpportunities = this.findParallelizationOpportunities();

    // Warnings for very deep workflows
    if (maxDepth > 20) {
      warnings.push(`Workflow has depth of ${maxDepth}, which may be difficult to debug`);
    }

    // Warnings for very long critical paths
    if (criticalPath && criticalPath.length > 30) {
      warnings.push(`Critical path has ${criticalPath.length} steps, consider parallelization`);
    }

    return {
      isValid: true,
      errors: [],
      warnings,
      hasCycles: false,
      mergePoints: mergePoints.length > 0 ? mergePoints : undefined,
      criticalPath,
      executionOrder,
      maxDepth,
      parallelizationOpportunities,
    };
  }

  /**
   * Build dependency graph from workflow steps
   */
  private buildGraph(): void {
    this.nodes.clear();

    // First pass: Create nodes
    for (const step of this.steps) {
      const dependencies = step.dependencies || [];

      this.nodes.set(step.id, {
        id: step.id,
        step,
        dependencies,
        dependents: [],
        depth: 0,
        criticalPathLength: 0,
      });
    }

    // Second pass: Build dependent relationships
    for (const node of this.nodes.values()) {
      for (const depId of node.dependencies) {
        const depNode = this.nodes.get(depId);
        if (depNode) {
          depNode.dependents.push(node.id);
        }
      }
    }

    // Third pass: Calculate depths
    this.calculateDepths();
  }

  /**
   * Calculate depth for each node (longest path from root)
   */
  private calculateDepths(): void {
    const visited = new Set<string>();
    const temp = new Set<string>();

    const visit = (nodeId: string): number => {
      if (temp.has(nodeId)) {
        // Cycle detected, return 0 to avoid infinite recursion
        return 0;
      }
      if (visited.has(nodeId)) {
        return this.nodes.get(nodeId)!.depth;
      }

      temp.add(nodeId);
      const node = this.nodes.get(nodeId)!;

      let maxDepth = 0;
      for (const depId of node.dependencies) {
        const depDepth = visit(depId);
        maxDepth = Math.max(maxDepth, depDepth);
      }

      node.depth = maxDepth + 1;
      temp.delete(nodeId);
      visited.add(nodeId);

      return node.depth;
    };

    for (const nodeId of this.nodes.keys()) {
      visit(nodeId);
    }
  }

  /**
   * Find duplicate step IDs
   */
  private findDuplicateIds(): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const step of this.steps) {
      if (seen.has(step.id)) {
        duplicates.add(step.id);
      }
      seen.add(step.id);
    }

    return Array.from(duplicates);
  }

  /**
   * Find missing dependencies (referenced but not defined)
   */
  private findMissingDependencies(): string[] {
    const allIds = new Set(this.steps.map(s => s.id));
    const missing = new Set<string>();

    for (const step of this.steps) {
      for (const depId of step.dependencies || []) {
        if (!allIds.has(depId)) {
          missing.add(`${step.id} -> ${depId}`);
        }
      }
    }

    return Array.from(missing);
  }

  /**
   * Detect cycles in the workflow using DFS
   * Returns array of cycles found
   */
  detectCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (nodeId: string): void => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const node = this.nodes.get(nodeId);
      if (!node) return;

      for (const depId of node.dependencies) {
        if (!visited.has(depId)) {
          dfs(depId);
        } else if (recursionStack.has(depId)) {
          // Cycle detected! Extract the cycle from path
          const cycleStartIndex = path.indexOf(depId);
          const cycle = path.slice(cycleStartIndex);
          cycles.push(cycle);
        }
      }

      path.pop();
      recursionStack.delete(nodeId);
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    }

    return cycles;
  }

  /**
   * Find merge points (nodes with multiple dependencies)
   */
  findMergePoints(): string[] {
    const mergePoints: string[] = [];

    for (const node of this.nodes.values()) {
      if (node.dependencies.length > 1) {
        mergePoints.push(node.id);
      }
    }

    return mergePoints;
  }

  /**
   * Topological sort using Kahn's algorithm
   * Returns null if cycle detected
   */
  topologicalSort(): string[] | null {
    const inDegree = new Map<string, number>();
    const queue: string[] = [];
    const result: string[] = [];

    // Initialize in-degrees
    for (const node of this.nodes.values()) {
      inDegree.set(node.id, node.dependencies.length);

      // Add nodes with no dependencies to queue
      if (node.dependencies.length === 0) {
        queue.push(node.id);
      }
    }

    // Process queue
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      result.push(nodeId);

      const node = this.nodes.get(nodeId)!;

      // Reduce in-degree for dependents
      for (const dependentId of node.dependents) {
        const currentDegree = inDegree.get(dependentId)!;
        inDegree.set(dependentId, currentDegree - 1);

        // If in-degree becomes 0, add to queue
        if (inDegree.get(dependentId) === 0) {
          queue.push(dependentId);
        }
      }
    }

    // If result doesn't contain all nodes, there's a cycle
    if (result.length !== this.nodes.size) {
      return null;
    }

    return result;
  }

  /**
   * Calculate critical path (longest path through the DAG)
   * Uses dynamic programming approach
   */
  calculateCriticalPath(): string[] {
    const executionOrder = this.topologicalSort();
    if (!executionOrder) {
      return [];
    }

    // Calculate longest path TO each node
    const longestPath = new Map<string, number>();
    const predecessor = new Map<string, string | null>();

    for (const nodeId of executionOrder) {
      const node = this.nodes.get(nodeId)!;
      let maxLength = 0;
      let maxPred: string | null = null;

      for (const depId of node.dependencies) {
        const depLength = longestPath.get(depId) || 0;
        if (depLength + 1 > maxLength) {
          maxLength = depLength + 1;
          maxPred = depId;
        }
      }

      longestPath.set(nodeId, maxLength);
      predecessor.set(nodeId, maxPred);
      node.criticalPathLength = maxLength;
    }

    // Find node with longest path (terminal node on critical path)
    let maxLength = 0;
    let endNode: string | null = null;

    for (const [nodeId, length] of longestPath.entries()) {
      if (length > maxLength) {
        maxLength = length;
        endNode = nodeId;
      }
    }

    // Reconstruct path
    const path: string[] = [];
    let current: string | null = endNode;

    while (current !== null) {
      path.unshift(current);
      current = predecessor.get(current) || null;
    }

    return path;
  }

  /**
   * Calculate maximum depth of the workflow
   */
  calculateMaxDepth(): number {
    let maxDepth = 0;

    for (const node of this.nodes.values()) {
      maxDepth = Math.max(maxDepth, node.depth);
    }

    return maxDepth;
  }

  /**
   * Find parallelization opportunities
   * Groups steps that can run in parallel (same depth level)
   */
  findParallelizationOpportunities(): Array<{ batchNumber: number; steps: string[] }> {
    const depthGroups = new Map<number, string[]>();

    // Group nodes by depth
    for (const node of this.nodes.values()) {
      const group = depthGroups.get(node.depth) || [];
      group.push(node.id);
      depthGroups.set(node.depth, group);
    }

    // Convert to array format
    const opportunities: Array<{ batchNumber: number; steps: string[] }> = [];
    const sortedDepths = Array.from(depthGroups.keys()).sort((a, b) => a - b);

    for (let i = 0; i < sortedDepths.length; i++) {
      const depth = sortedDepths[i];
      const steps = depthGroups.get(depth)!;

      // Only include batches with multiple steps (parallelization opportunity)
      if (steps.length > 1) {
        opportunities.push({
          batchNumber: i + 1,
          steps,
        });
      }
    }

    return opportunities;
  }

  /**
   * Get all root nodes (nodes with no dependencies)
   */
  getRootNodes(): string[] {
    const roots: string[] = [];

    for (const node of this.nodes.values()) {
      if (node.dependencies.length === 0) {
        roots.push(node.id);
      }
    }

    return roots;
  }

  /**
   * Get all leaf nodes (nodes with no dependents)
   */
  getLeafNodes(): string[] {
    const leaves: string[] = [];

    for (const node of this.nodes.values()) {
      if (node.dependents.length === 0) {
        leaves.push(node.id);
      }
    }

    return leaves;
  }

  /**
   * Get node by ID
   */
  getNode(id: string): DAGNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get all nodes
   */
  getAllNodes(): DAGNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get steps that depend on a given step
   */
  getDependents(stepId: string): string[] {
    return this.nodes.get(stepId)?.dependents || [];
  }

  /**
   * Get dependencies of a given step
   */
  getDependencies(stepId: string): string[] {
    return this.nodes.get(stepId)?.dependencies || [];
  }

  /**
   * Check if stepA depends on stepB (directly or transitively)
   */
  dependsOn(stepA: string, stepB: string): boolean {
    const visited = new Set<string>();
    const queue = [stepA];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const node = this.nodes.get(current);
      if (!node) continue;

      for (const depId of node.dependencies) {
        if (depId === stepB) {
          return true;
        }
        queue.push(depId);
      }
    }

    return false;
  }

  /**
   * Get all ancestors of a step (all steps it depends on)
   */
  getAncestors(stepId: string): string[] {
    const ancestors = new Set<string>();
    const queue = [stepId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = this.nodes.get(current);
      if (!node) continue;

      for (const depId of node.dependencies) {
        if (!ancestors.has(depId)) {
          ancestors.add(depId);
          queue.push(depId);
        }
      }
    }

    return Array.from(ancestors);
  }

  /**
   * Get all descendants of a step (all steps that depend on it)
   */
  getDescendants(stepId: string): string[] {
    const descendants = new Set<string>();
    const queue = [stepId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = this.nodes.get(current);
      if (!node) continue;

      for (const dependentId of node.dependents) {
        if (!descendants.has(dependentId)) {
          descendants.add(dependentId);
          queue.push(dependentId);
        }
      }
    }

    return Array.from(descendants);
  }
}
