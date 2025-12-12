/**
 * WorkflowParser - Parse workflow steps into executable dependency graph (DAG)
 *
 * Responsibilities:
 * - Build dependency graph from workflow_steps
 * - Topological sort to determine execution order
 * - Detect parallel execution opportunities
 * - Validate workflow (check for cycles, missing dependencies)
 *
 * @module lib/orchestrator/WorkflowParser
 */

import type {
  WorkflowStep,
  ExecutionPlan,
  ExecutionStep,
  ParallelGroup,
  ValidationResult,
} from './types';
import { ValidationError } from './types';

export class WorkflowParser {
  /**
   * Parse workflow steps into execution plan
   */
  parse(workflowSteps: WorkflowStep[]): ExecutionPlan {
    if (!workflowSteps || workflowSteps.length === 0) {
      return {
        steps: [],
        parallelGroups: [],
        totalSteps: 0,
        estimatedDuration: 0,
      };
    }

    // 0. Normalize steps (auto-generate IDs for legacy format)
    const normalizedSteps = this.normalizeSteps(workflowSteps);

    // 1. Validate workflow
    const validation = this.validate(normalizedSteps);
    if (!validation.valid) {
      throw new ValidationError(
        `Workflow validation failed: ${validation.errors.join(', ')}`,
        undefined,
        { errors: validation.errors, warnings: validation.warnings }
      );
    }

    // 2. Build dependency graph
    const graph = this.buildDependencyGraph(normalizedSteps);

    // 3. Topological sort
    const sortedSteps = this.topologicalSort(graph, normalizedSteps);

    // 4. Assign execution levels
    const executionSteps = this.assignExecutionLevels(sortedSteps, graph);

    // 5. Detect parallel groups
    const parallelGroups = this.detectParallelGroups(executionSteps);

    // 6. Estimate duration
    const estimatedDuration = this.estimateDuration(executionSteps);

    return {
      steps: executionSteps,
      parallelGroups,
      totalSteps: normalizedSteps.length,
      estimatedDuration,
    };
  }

  /**
   * Recursively normalize a single step (handles nested steps in conditionals and loops)
   */
  private normalizeSingleStep(step: WorkflowStep, index: number): WorkflowStep {
    const anyStep = step as any;

    // V4 Format Normalization: Convert V4 scatter-gather to PILOT format
    if (step.type === 'scatter_gather') {
      // Check if this is V4 format (scatter.items + steps at root level)
      if (anyStep.scatter && (anyStep.scatter.items || !anyStep.scatter.steps) && anyStep.steps) {
        console.log(`[WorkflowParser] Normalizing V4 scatter-gather format for step ${step.id || index + 1}`);

        // Create normalized step, explicitly removing root-level 'steps' field
        const { steps: rootSteps, ...stepWithoutSteps } = step as any;

        const normalizedStep = {
          ...stepWithoutSteps,
          scatter: {
            input: anyStep.scatter.items || anyStep.scatter.input,  // Convert items → input
            steps: this.normalizeSteps(anyStep.steps),  // Recursively normalize nested steps
            item_name: anyStep.scatter.item_name || 'item',
            maxConcurrency: anyStep.scatter.maxConcurrency,
            itemVariable: anyStep.scatter.item_name || 'item',
          },
          gather: anyStep.gather || {
            operation: 'collect',  // Default gather operation
          },
        };
        return normalizedStep;
      }
      // If already in PILOT format, still normalize nested steps
      else if (anyStep.scatter?.steps) {
        return {
          ...step,
          scatter: {
            ...anyStep.scatter,
            steps: this.normalizeSteps(anyStep.scatter.steps),
          },
        };
      }
    }

    // Normalize nested steps in conditionals
    if (step.type === 'conditional') {
      const normalized: any = { ...step };
      if (anyStep.then_steps) {
        normalized.then_steps = this.normalizeSteps(anyStep.then_steps);
      }
      if (anyStep.else_steps) {
        normalized.else_steps = this.normalizeSteps(anyStep.else_steps);
      }
      return normalized;
    }

    return step;
  }

  /**
   * Normalize workflow steps (auto-generate IDs for legacy Smart Agent Builder format)
   * Also normalizes V4 scatter-gather format to PILOT format
   */
  private normalizeSteps(workflowSteps: WorkflowStep[]): WorkflowStep[] {
    const normalized = workflowSteps.map((step, index) => {
      // First, normalize the step structure (V4 → PILOT conversion)
      const normalizedStep = this.normalizeSingleStep(step, index);

      // If step already has an ID, use it
      if (normalizedStep.id) {
        return normalizedStep;
      }

      // Auto-generate ID for legacy format
      const generatedId = `step${index + 1}`;

      // Handle legacy Smart Agent Builder format
      const legacyStep = step as any;

      if (legacyStep.type === 'plugin_action') {
        // Validate params existence
        const params = legacyStep.params || {};
        const hasParams = Object.keys(params).length > 0;

        if (!hasParams) {
          console.warn(
            `⚠️  [WorkflowParser] Step "${legacyStep.operation}" (${legacyStep.plugin}.${legacyStep.plugin_action}) has empty params.`,
            `This may cause execution failures if the plugin action requires parameters.`,
            `Consider adding params field with proper variable mappings (e.g., {{input.field}} or {{step1.data.field}})`
          );
        }

        // Convert legacy plugin_action to orchestrator action step
        return {
          id: generatedId,
          type: 'action' as const,
          name: legacyStep.operation || `Step ${index + 1}`,
          plugin: legacyStep.plugin,
          action: legacyStep.plugin_action,
          params: params,
          dependencies: step.dependencies || [],
        };
      }

      if (legacyStep.type === 'ai_processing') {
        // Convert legacy ai_processing to orchestrator ai_processing step
        return {
          id: generatedId,
          type: 'ai_processing' as const,
          name: legacyStep.operation || `AI Processing ${index + 1}`,
          prompt: legacyStep.operation || undefined,
          params: legacyStep.params || {},
          dependencies: step.dependencies || [],
        };
      }

      // If it's already in the correct format but just missing ID, add it
      return {
        ...step,
        id: generatedId,
      };
    });

    // If no steps have explicit dependencies, infer them from sequential order
    // This is for Smart Agent Builder which doesn't generate dependencies
    const hasAnyDependencies = normalized.some(step =>
      step.dependencies && step.dependencies.length > 0
    );

    if (!hasAnyDependencies && normalized.length > 1) {
      console.log('[WorkflowParser] No explicit dependencies found - inferring sequential dependencies from step order');

      // Make each step depend on the previous step (sequential workflow)
      return normalized.map((step, index) => {
        if (index === 0) {
          // First step has no dependencies
          return { ...step, dependencies: [] };
        } else {
          // Each subsequent step depends on the previous step
          return {
            ...step,
            dependencies: [normalized[index - 1].id],
          };
        }
      });
    }

    return normalized;
  }

  /**
   * Validate workflow for structural issues
   */
  validate(workflowSteps: WorkflowStep[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!workflowSteps || workflowSteps.length === 0) {
      errors.push('Workflow has no steps');
      return { valid: false, errors, warnings };
    }

    // Check for duplicate step IDs
    const stepIds = new Set<string>();
    const duplicates = new Set<string>();

    workflowSteps.forEach(step => {
      if (!step.id) {
        errors.push(`Step missing id: ${JSON.stringify(step)}`);
        return;
      }

      if (stepIds.has(step.id)) {
        duplicates.add(step.id);
      }
      stepIds.add(step.id);
    });

    if (duplicates.size > 0) {
      errors.push(`Duplicate step IDs: ${Array.from(duplicates).join(', ')}`);
    }

    // Check for missing dependencies
    workflowSteps.forEach(step => {
      const deps = step.dependencies || [];

      deps.forEach(depId => {
        if (!stepIds.has(depId)) {
          errors.push(`Step ${step.id} depends on non-existent step ${depId}`);
        }
      });
    });

    // Check for circular dependencies
    if (this.hasCycle(workflowSteps)) {
      errors.push('Circular dependency detected in workflow');
    }

    // Check for missing required fields
    workflowSteps.forEach(step => {
      if (!step.name) {
        warnings.push(`Step ${step.id} missing name`);
      }

      if (step.type === 'action') {
        if (!step.plugin) {
          errors.push(`Action step ${step.id} missing plugin`);
        }
        if (!step.action) {
          errors.push(`Action step ${step.id} missing action`);
        }
      }

      if (step.type === 'conditional') {
        if (!step.condition) {
          errors.push(`Conditional step ${step.id} missing condition`);
        }
      }

      if (step.type === 'loop') {
        if (!step.iterateOver) {
          errors.push(`Loop step ${step.id} missing iterateOver`);
        }
        if (!step.loopSteps || step.loopSteps.length === 0) {
          errors.push(`Loop step ${step.id} missing loopSteps`);
        }
      }

      if (step.type === 'transform') {
        if (!step.operation) {
          errors.push(`Transform step ${step.id} missing operation`);
        }
        if (!step.input) {
          errors.push(`Transform step ${step.id} missing input`);
        }
      }

      // Phase 2: Switch step validation
      if (step.type === 'switch') {
        if (!step.evaluate) {
          errors.push(`Switch step ${step.id} missing evaluate expression`);
        }
        if (!step.cases || Object.keys(step.cases).length === 0) {
          errors.push(`Switch step ${step.id} missing cases`);
        }
      }

      // Phase 3: Scatter-gather step validation
      if (step.type === 'scatter_gather') {
        if (!step.scatter || !step.scatter.input) {
          errors.push(`Scatter-gather step ${step.id} missing scatter.input`);
        }
        if (!step.scatter || !step.scatter.steps || step.scatter.steps.length === 0) {
          errors.push(`Scatter-gather step ${step.id} missing scatter.steps`);
        }
        if (!step.gather || !step.gather.operation) {
          errors.push(`Scatter-gather step ${step.id} missing gather.operation`);
        }
      }

      // Phase 4: Enrichment step validation
      if (step.type === 'enrichment') {
        if (!step.sources || step.sources.length === 0) {
          errors.push(`Enrichment step ${step.id} missing sources`);
        }
        if (!step.strategy) {
          errors.push(`Enrichment step ${step.id} missing strategy`);
        }
        if (step.strategy === 'join' && !step.joinOn) {
          errors.push(`Enrichment step ${step.id} with join strategy missing joinOn field`);
        }
      }

      // Phase 4: Validation step validation
      if (step.type === 'validation') {
        if (!step.input) {
          errors.push(`Validation step ${step.id} missing input`);
        }
        if (!step.schema && !step.rules) {
          errors.push(`Validation step ${step.id} must have either schema or rules`);
        }
      }

      // Phase 4: Comparison step validation
      if (step.type === 'comparison') {
        if (!step.left) {
          errors.push(`Comparison step ${step.id} missing left value`);
        }
        if (!step.right) {
          errors.push(`Comparison step ${step.id} missing right value`);
        }
        if (!step.operation) {
          errors.push(`Comparison step ${step.id} missing operation`);
        }
      }

      // Phase 5: Sub-workflow step validation
      if (step.type === 'sub_workflow') {
        // Must have either workflowId or workflowSteps
        if (!step.workflowId && !step.workflowSteps) {
          errors.push(`Sub-workflow step ${step.id} must have either workflowId or workflowSteps`);
        }

        // If both are present, warn that workflowSteps takes precedence
        if (step.workflowId && step.workflowSteps) {
          warnings.push(`Sub-workflow step ${step.id} has both workflowId and workflowSteps - workflowSteps will be used`);
        }

        // Inputs must be defined
        if (!step.inputs || Object.keys(step.inputs).length === 0) {
          warnings.push(`Sub-workflow step ${step.id} has no inputs defined - sub-workflow may not receive necessary data`);
        }

        // Validate inline workflow steps if present
        if (step.workflowSteps && step.workflowSteps.length > 0) {
          // Recursively validate sub-workflow steps
          const subValidation = this.validate(step.workflowSteps);
          if (!subValidation.valid) {
            errors.push(`Sub-workflow step ${step.id} has invalid inline workflow: ${subValidation.errors.join(', ')}`);
          }
          // Propagate sub-workflow warnings
          if (subValidation.warnings) {
            subValidation.warnings.forEach(warning => {
              warnings.push(`Sub-workflow ${step.id}: ${warning}`);
            });
          }
        }
      }

      // Phase 6: Human approval step validation
      if (step.type === 'human_approval') {
        // Approvers required
        if (!step.approvers || step.approvers.length === 0) {
          errors.push(`Human approval step ${step.id} must have at least one approver`);
        }

        // Approval type required
        if (!step.approvalType) {
          errors.push(`Human approval step ${step.id} missing approvalType`);
        }

        // Title required
        if (!step.title) {
          errors.push(`Human approval step ${step.id} missing title`);
        }

        // Validate timeout action
        if (step.onTimeout && !['approve', 'reject', 'escalate'].includes(step.onTimeout)) {
          errors.push(`Human approval step ${step.id} has invalid onTimeout value: ${step.onTimeout}`);
        }

        // If escalate action, must have escalateTo
        if (step.onTimeout === 'escalate' && (!step.escalateTo || step.escalateTo.length === 0)) {
          errors.push(`Human approval step ${step.id} with escalate timeout action must specify escalateTo`);
        }

        // Validate notification channels
        if (step.notificationChannels) {
          step.notificationChannels.forEach((channel, idx) => {
            if (!channel.type) {
              errors.push(`Human approval step ${step.id} notification channel ${idx} missing type`);
            }
            if (!channel.config) {
              errors.push(`Human approval step ${step.id} notification channel ${idx} missing config`);
            }
          });
        }
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Build dependency graph
   */
  private buildDependencyGraph(
    workflowSteps: WorkflowStep[]
  ): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();

    // Initialize graph
    workflowSteps.forEach(step => {
      graph.set(step.id, new Set());
    });

    // Add edges (dependencies)
    workflowSteps.forEach(step => {
      const deps = step.dependencies || [];

      deps.forEach(depId => {
        const depSet = graph.get(depId);
        if (depSet) {
          depSet.add(step.id);  // depId -> step.id
        }
      });
    });

    return graph;
  }

  /**
   * Topological sort using Kahn's algorithm
   */
  private topologicalSort(
    graph: Map<string, Set<string>>,
    workflowSteps: WorkflowStep[]
  ): WorkflowStep[] {
    // Count in-degrees
    const inDegree = new Map<string, number>();

    workflowSteps.forEach(step => {
      inDegree.set(step.id, (step.dependencies || []).length);
    });

    // Queue of steps with no dependencies
    const queue: WorkflowStep[] = [];

    workflowSteps.forEach(step => {
      if ((inDegree.get(step.id) || 0) === 0) {
        queue.push(step);
      }
    });

    const sorted: WorkflowStep[] = [];
    const stepMap = new Map(workflowSteps.map(s => [s.id, s]));

    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);

      // Reduce in-degree of dependent steps
      const dependents = graph.get(current.id) || new Set();

      dependents.forEach(depId => {
        const newInDegree = (inDegree.get(depId) || 0) - 1;
        inDegree.set(depId, newInDegree);

        if (newInDegree === 0) {
          const depStep = stepMap.get(depId);
          if (depStep) {
            queue.push(depStep);
          }
        }
      });
    }

    return sorted;
  }

  /**
   * Assign execution levels to steps
   */
  private assignExecutionLevels(
    sortedSteps: WorkflowStep[],
    graph: Map<string, Set<string>>
  ): ExecutionStep[] {
    const levels = new Map<string, number>();

    // Calculate level for each step
    sortedSteps.forEach(step => {
      const deps = step.dependencies || [];

      if (deps.length === 0) {
        levels.set(step.id, 0);
      } else {
        const maxDepLevel = Math.max(...deps.map(depId => levels.get(depId) || 0));
        levels.set(step.id, maxDepLevel + 1);
      }
    });

    // Build execution steps
    const executionSteps: ExecutionStep[] = sortedSteps.map(step => {
      const level = levels.get(step.id) || 0;
      const deps = step.dependencies || [];

      return {
        stepId: step.id,
        stepDefinition: step,
        dependencies: deps,
        level,
        canRunInParallel: this.canRunInParallel(step, sortedSteps),
        parallelGroupId: undefined,  // Assigned in detectParallelGroups
      };
    });

    return executionSteps;
  }

  /**
   * Detect parallel execution opportunities
   */
  private detectParallelGroups(steps: ExecutionStep[]): ParallelGroup[] {
    const parallelGroups: ParallelGroup[] = [];
    const levelGroups = new Map<number, ExecutionStep[]>();

    // Group steps by level
    steps.forEach(step => {
      if (!levelGroups.has(step.level)) {
        levelGroups.set(step.level, []);
      }
      levelGroups.get(step.level)!.push(step);
    });

    // Find parallel groups within each level
    levelGroups.forEach((levelSteps, level) => {
      if (levelSteps.length > 1) {
        // Check if steps can run in parallel
        const canRunInParallel = levelSteps.every(s => s.canRunInParallel);

        if (canRunInParallel && !this.haveInterdependencies(levelSteps)) {
          const groupId = `parallel_level_${level}`;

          // Assign parallel group ID to steps
          levelSteps.forEach(step => {
            step.parallelGroupId = groupId;
          });

          parallelGroups.push({
            groupId,
            level,
            steps: levelSteps.map(s => s.stepId),
          });
        }
      }
    });

    return parallelGroups;
  }

  /**
   * Check if steps have interdependencies
   */
  private haveInterdependencies(steps: ExecutionStep[]): boolean {
    const stepIds = new Set(steps.map(s => s.stepId));

    // Check if any step depends on another step in the group
    for (const step of steps) {
      for (const depId of step.dependencies) {
        if (stepIds.has(depId)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if step can run in parallel
   */
  private canRunInParallel(step: WorkflowStep, allSteps: WorkflowStep[]): boolean {
    // Conditional steps should run sequentially (affect control flow)
    if (step.type === 'conditional') {
      return false;
    }

    // Switch steps should run sequentially (affect control flow)
    // Phase 2: Enhanced Conditionals
    if (step.type === 'switch') {
      return false;
    }

    // Loop steps should run sequentially (unless marked as parallel)
    if (step.type === 'loop' && !step.parallel) {
      return false;
    }

    // LLM decision steps should run sequentially (expensive, token-limited)
    if (step.type === 'llm_decision') {
      return false;
    }

    // Scatter-gather steps handled by ParallelExecutor
    // Phase 3: Advanced Parallel Patterns
    if (step.type === 'scatter_gather') {
      return false;
    }

    // Sub-workflow steps should run sequentially (execute nested workflows)
    // Phase 5: Sub-Workflows
    if (step.type === 'sub_workflow') {
      return false;
    }

    // Human approval steps should run sequentially (require human interaction)
    // Phase 6: Human-in-the-Loop
    if (step.type === 'human_approval') {
      return false;
    }

    // Action and transform steps can run in parallel
    return true;
  }

  /**
   * Estimate workflow duration (rough estimate)
   */
  private estimateDuration(steps: ExecutionStep[]): number {
    const avgStepDuration = 2000; // 2 seconds per step (rough estimate)

    // Find maximum level
    const maxLevel = steps.reduce((max, step) => Math.max(max, step.level), 0);

    // Estimate: (maxLevel + 1) * avgStepDuration
    // This assumes perfect parallelization within each level
    return (maxLevel + 1) * avgStepDuration;
  }

  /**
   * Check for circular dependencies using DFS
   */
  private hasCycle(workflowSteps: WorkflowStep[]): boolean {
    const graph = new Map<string, string[]>();

    // Build adjacency list
    workflowSteps.forEach(step => {
      graph.set(step.id, step.dependencies || []);
    });

    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const neighbors = graph.get(nodeId) || [];

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) {
            return true;
          }
        } else if (recursionStack.has(neighbor)) {
          // Back edge found - cycle detected
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    // Check each connected component
    for (const step of workflowSteps) {
      if (!visited.has(step.id)) {
        if (dfs(step.id)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get critical path (longest path through workflow)
   */
  getCriticalPath(plan: ExecutionPlan): string[] {
    const levels = new Map<number, string[]>();

    // Group steps by level
    plan.steps.forEach(step => {
      if (!levels.has(step.level)) {
        levels.set(step.level, []);
      }
      levels.get(step.level)!.push(step.stepId);
    });

    // Critical path is one step from each level
    const criticalPath: string[] = [];
    const sortedLevels = Array.from(levels.keys()).sort((a, b) => a - b);

    sortedLevels.forEach(level => {
      const levelSteps = levels.get(level)!;
      criticalPath.push(levelSteps[0]);  // Pick first step from each level
    });

    return criticalPath;
  }

  /**
   * Optimize execution plan (optional)
   *
   * - Reorder steps within same level for better performance
   * - Group similar plugin calls together
   */
  optimize(plan: ExecutionPlan): ExecutionPlan {
    // TODO: Implement optimization strategies
    // For now, return plan as-is
    return plan;
  }

  /**
   * Visualize execution plan (for debugging)
   */
  visualize(plan: ExecutionPlan): string {
    const lines: string[] = [];

    lines.push('=== Workflow Execution Plan ===');
    lines.push(`Total Steps: ${plan.totalSteps}`);
    lines.push(`Estimated Duration: ${plan.estimatedDuration}ms`);
    lines.push('');

    // Group by level
    const levelGroups = new Map<number, ExecutionStep[]>();

    plan.steps.forEach(step => {
      if (!levelGroups.has(step.level)) {
        levelGroups.set(step.level, []);
      }
      levelGroups.get(step.level)!.push(step);
    });

    const sortedLevels = Array.from(levelGroups.keys()).sort((a, b) => a - b);

    sortedLevels.forEach(level => {
      const steps = levelGroups.get(level)!;

      lines.push(`Level ${level}:`);

      steps.forEach(step => {
        const def = step.stepDefinition;
        const parallel = step.parallelGroupId ? ' [PARALLEL]' : '';
        const deps = step.dependencies.length > 0
          ? ` (depends on: ${step.dependencies.join(', ')})`
          : '';

        lines.push(`  - ${step.stepId}: ${def.name}${parallel}${deps}`);
        lines.push(`    Type: ${def.type}`);

        if (def.type === 'action') {
          lines.push(`    Plugin: ${def.plugin}.${def.action}`);
        }
      });

      lines.push('');
    });

    if (plan.parallelGroups.length > 0) {
      lines.push('Parallel Groups:');
      plan.parallelGroups.forEach(group => {
        lines.push(`  ${group.groupId} (level ${group.level}): ${group.steps.join(', ')}`);
      });
    }

    return lines.join('\n');
  }
}
