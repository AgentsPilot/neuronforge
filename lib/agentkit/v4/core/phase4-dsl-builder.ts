/**
 * Phase4DSLBuilder
 *
 * Converts Phase 4 technical_workflow output to PILOT_DSL_SCHEMA.
 *
 * Input:  Phase 4 Response (technical_workflow, enhanced_prompt, feasibility, etc.)
 * Output: PILOT_DSL_SCHEMA (workflow_steps, required_inputs, etc.)
 *
 * Key Features:
 * - Deterministic transform routing (no LLM for filter, map, sort, etc.)
 * - LLM transform routing (summarize_with_llm, classify_with_llm, etc.)
 * - Control step conversion (for_each → scatter_gather, if → conditional)
 * - Input source resolution (constant, from_step, user_input, etc.)
 * - Condition parsing (string → structured condition)
 */

// ============================================================================
// TYPE IMPORTS
// ============================================================================

// Phase 4 input types (from validation schema)
import type {
  TechnicalWorkflowStep,
  OperationStep,
  TransformStep,
  ControlStep,
  StepInput,
  TechnicalInputRequired
} from '@/lib/validation/phase4-schema';

// PILOT DSL output types
import type {
  WorkflowStep,
  ActionStep,
  TransformStep as PilotTransformStep,
  AIProcessingStep,
  ScatterGatherStep,
  ConditionalStep,
  Condition,
  TransformConfig,
  ComparisonOperator
} from '@/lib/pilot/types';

// Plugin schema access for action parameter validation
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

/**
 * Input field definition for PILOT DSL required inputs
 * (Local type - not exported from pilot/types)
 */
export interface InputField {
  name: string;
  type: 'text' | 'email' | 'url' | 'date' | 'number' | 'textarea' | 'select' | 'checkbox';
  label: string;
  required: boolean;
  description: string;
  placeholder?: string;
  reasoning?: string;
  options?: Array<{ value: string; label: string }>;
  default?: any;
}

// ============================================================================
// PHASE 4 RESPONSE TYPE
// ============================================================================

export interface Phase4Response {
  technical_workflow: TechnicalWorkflowStep[];
  enhanced_prompt?: {
    plan_title?: string;
    plan_description?: string;
    specifics?: {
      services_involved?: string[];
      resolved_user_inputs?: Array<{ key: string; value: string }>;
    };
  };
  feasibility?: {
    can_execute: boolean;
    blocking_issues?: Array<{ type: string; description: string }>;
    warnings?: Array<{ type: string; description: string }>;
  };
  technical_inputs_required?: TechnicalInputRequired[];
  /** Fallback for suggested_plugins if enhanced_prompt.specifics.services_involved is not available */
  requiredServices?: string[];
}

// ============================================================================
// BUILD RESULT TYPE
// ============================================================================

export interface ConversionWarning {
  stepId: string;
  type: 'missing_input' | 'fallback_used' | 'type_inferred' | 'unknown_transform' | 'empty_config' | 'unsupported_feature' | 'json_template' | 'format_wrapped_for_action_schema' | 'format_fixed_for_array_join' | 'template_expanded';
  message: string;
  details?: Record<string, any>;
}

export interface ConversionError {
  stepId: string;
  type: 'invalid_step' | 'missing_required' | 'conversion_failed';
  message: string;
  details?: Record<string, any>;
}

export interface Phase4DSLBuilderResult {
  success: boolean;
  workflow: PILOT_DSL_SCHEMA | null;
  warnings: ConversionWarning[];
  errors: ConversionError[];
  stats: {
    totalSteps: number;
    convertedSteps: number;
    actionSteps: number;
    transformSteps: number;
    aiProcessingSteps: number;
    controlSteps: number;
    fallbacksUsed: number;
  };
}

// ============================================================================
// PILOT DSL SCHEMA OUTPUT TYPE
// ============================================================================

export interface PILOT_DSL_SCHEMA {
  agent_name: string;
  description: string;
  system_prompt: string;
  workflow_type: 'pure_ai' | 'data_retrieval_ai' | 'ai_external_actions';
  suggested_plugins: string[];
  required_inputs: InputField[];
  workflow_steps: WorkflowStep[];
  suggested_outputs: Array<{
    name: string;
    type: string;
    category: string;
    description: string;
    format: string;
    reasoning: string;
  }>;
  reasoning: string;
  confidence: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DETERMINISTIC_TRANSFORM_TYPES = [
  'filter', 'map', 'sort', 'group_by', 'aggregate', 'reduce',
  'deduplicate', 'flatten', 'pick_fields', 'format', 'merge', 'split', 'convert'
] as const;

const LLM_TRANSFORM_TYPES = [
  'summarize_with_llm', 'classify_with_llm', 'extract_with_llm',
  'analyze_with_llm', 'generate_with_llm', 'translate_with_llm', 'enrich_with_llm'
] as const;

// Map Phase 4 transform types to PILOT DSL operations
const TRANSFORM_TYPE_TO_OPERATION: Record<string, string> = {
  'filter': 'filter',
  'map': 'map',
  'sort': 'sort',
  'group_by': 'group',
  'aggregate': 'aggregate',
  'reduce': 'reduce',
  'deduplicate': 'deduplicate',  // Dedicated deduplicate operation - removes duplicates by field
  'flatten': 'map',
  'pick_fields': 'map',
  'format': 'format',  // Dedicated format operation for object-to-string formatting
  'merge': 'map',
  'split': 'split',  // Dedicated split operation - groups items by field value into buckets
  'convert': 'map'
};

// Transform output contracts: expected output shapes per operation type
const TRANSFORM_OUTPUT_CONTRACTS: Record<string, { shape: string; description: string }> = {
  'filter': { shape: 'T[]', description: 'Filtered array of items matching condition' },
  'map': { shape: 'U[]', description: 'Transformed array of items' },
  'sort': { shape: 'T[]', description: 'Sorted array of items' },
  'group': { shape: '{key: string, items: T[]}[]', description: 'Array of groups with key and items' },
  'aggregate': { shape: 'AggregateResult', description: 'Aggregated values (sum, count, avg, etc.)' },
  'reduce': { shape: 'U', description: 'Single reduced value' },
  'split': { shape: '{with_field: T[], without_field: T[]}', description: 'Partitioned arrays based on field presence' },
  'format': { shape: 'string', description: 'Formatted string output (HTML, text, etc.)' },
};

// ============================================================================
// MAIN CLASS
// ============================================================================

export class Phase4DSLBuilder {

  // --------------------------------------------------------------------------
  // Instance State (reset per build)
  // --------------------------------------------------------------------------

  private warnings: ConversionWarning[] = [];
  private errors: ConversionError[] = [];
  private stats = {
    totalSteps: 0,
    convertedSteps: 0,
    actionSteps: 0,
    transformSteps: 0,
    aiProcessingSteps: 0,
    controlSteps: 0,
    fallbacksUsed: 0
  };

  // Store workflow steps for look-ahead (finding downstream dependencies)
  private workflowSteps: TechnicalWorkflowStep[] = [];

  // Step registry: tracks step metadata for smart reference resolution
  // Maps stepId → { kind, type, operation, outputKeys } so resolveInput can determine correct data paths
  // Phase 5 Enhancement: Now also tracks declared output keys for validation
  private stepRegistry: Map<string, {
    kind: string;
    type?: string;
    operation?: string;
    outputKeys?: string[];  // Declared output keys from Phase 4 (excludes next_step, is_last_step)
  }> = new Map();

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Main entry point: Convert Phase 4 response to PILOT_DSL_SCHEMA
   * Returns a result object with the workflow, warnings, errors, and stats
   */
  public async build(phase4Response: Phase4Response): Promise<Phase4DSLBuilderResult> {
    // Reset state for new build
    this.resetState();

    const { technical_workflow, enhanced_prompt, feasibility, technical_inputs_required, requiredServices } = phase4Response;

    // Track total steps (including nested)
    this.stats.totalSteps = this.countTotalSteps(technical_workflow);

    try {
      // Convert workflow steps
      let workflowSteps = this.convertWorkflowSteps(technical_workflow);

      // Phase 5: Validate action params against plugin schemas
      // This wraps format step outputs when they feed into action params
      // that expect object structures (e.g., send_email.content needs {subject, html_body})
      const agentName = enhanced_prompt?.plan_title;
      workflowSteps = await this.validateAndFixActionParams(workflowSteps, agentName);

      // Convert required inputs (also auto-extracts {{input.*}} references)
      const requiredInputs = this.convertRequiredInputs(technical_inputs_required || [], workflowSteps);

      // Determine workflow type
      const workflowType = this.determineWorkflowType(workflowSteps);

      // Build output schema
      const workflow: PILOT_DSL_SCHEMA = {
        agent_name: enhanced_prompt?.plan_title || 'Untitled Agent',
        description: enhanced_prompt?.plan_description || '',
        system_prompt: `You are an automation agent. ${enhanced_prompt?.plan_description || ''}`,
        workflow_type: workflowType,
        suggested_plugins: enhanced_prompt?.specifics?.services_involved || requiredServices || [],
        required_inputs: requiredInputs,
        workflow_steps: workflowSteps,
        suggested_outputs: this.generateDefaultOutputs(),
        reasoning: this.generateReasoning(workflowSteps),
        confidence: this.calculateConfidence(feasibility)
      };

      return {
        success: this.errors.length === 0,
        workflow,
        warnings: [...this.warnings],
        errors: [...this.errors],
        stats: { ...this.stats }
      };
    } catch (error) {
      this.addError('unknown', 'conversion_failed', `Build failed: ${error instanceof Error ? error.message : String(error)}`);
      return {
        success: false,
        workflow: null,
        warnings: [...this.warnings],
        errors: [...this.errors],
        stats: { ...this.stats }
      };
    }
  }

  /**
   * Reset state for a new build
   */
  private resetState(): void {
    this.warnings = [];
    this.errors = [];
    this.workflowSteps = [];
    this.stepRegistry = new Map();
    this.stats = {
      totalSteps: 0,
      convertedSteps: 0,
      actionSteps: 0,
      transformSteps: 0,
      aiProcessingSteps: 0,
      controlSteps: 0,
      fallbacksUsed: 0
    };
  }

  /**
   * Count total steps including nested steps
   */
  private countTotalSteps(steps: TechnicalWorkflowStep[]): number {
    let count = 0;
    for (const step of steps) {
      count++;
      if (step.kind === 'control') {
        const controlStep = step as ControlStep;
        if (controlStep.steps) {
          count += this.countTotalSteps(controlStep.steps);
        }
        if (controlStep.else_steps) {
          count += this.countTotalSteps(controlStep.else_steps);
        }
      }
    }
    return count;
  }

  /**
   * Calculate confidence based on feasibility and conversion quality
   */
  private calculateConfidence(feasibility?: Phase4Response['feasibility']): number {
    let confidence = feasibility?.can_execute ? 0.95 : 0.7;

    // Reduce confidence based on warnings
    confidence -= this.warnings.length * 0.02;

    // Reduce confidence based on errors
    confidence -= this.errors.length * 0.1;

    // Reduce confidence based on fallbacks (minor penalty - fallbacks are expected behavior)
    confidence -= this.stats.fallbacksUsed * 0.005;

    return Math.max(0.3, Math.min(1, confidence));
  }

  // --------------------------------------------------------------------------
  // Warning/Error Helpers
  // --------------------------------------------------------------------------

  private addWarning(
    stepId: string,
    type: ConversionWarning['type'],
    message: string,
    details?: Record<string, any>
  ): void {
    this.warnings.push({ stepId, type, message, details });
  }

  private addError(
    stepId: string,
    type: ConversionError['type'],
    message: string,
    details?: Record<string, any>
  ): void {
    this.errors.push({ stepId, type, message, details });
  }

  // --------------------------------------------------------------------------
  // Step Conversion
  // --------------------------------------------------------------------------

  /**
   * Convert array of Phase 4 steps to PILOT DSL steps
   */
  private convertWorkflowSteps(steps: TechnicalWorkflowStep[]): WorkflowStep[] {
    // Phase 5: Restructure conditional steps to include branch-dependent steps
    // This uses next_step routing to move top-level steps into their proper branches
    const restructuredSteps = this.restructureConditionalBranches(steps);

    // Store for look-ahead (finding downstream filter dependencies)
    this.workflowSteps = restructuredSteps;

    // Pre-populate step registry so resolveInput knows step types during conversion
    this.populateStepRegistry(restructuredSteps);

    return restructuredSteps.map(step => this.convertStep(step));
  }

  /**
   * Restructure conditional steps to include all branch-dependent steps
   * Uses next_step routing to determine which top-level steps belong to each branch
   *
   * Example:
   *   Before: step5 (conditional) with then→step5_2→step6→step8, else→step5_3→step9, convergence at step10
   *   After: step5 with then_steps including step6,step8 and else_steps including step9
   */
  private restructureConditionalBranches(steps: TechnicalWorkflowStep[]): TechnicalWorkflowStep[] {
    // Build a map of stepId → step for quick lookup
    const stepMap = new Map<string, TechnicalWorkflowStep>();
    for (const step of steps) {
      stepMap.set(step.id, step);
    }

    // Find conditional steps and their branch routing
    const stepsToRemove = new Set<string>();
    const result: TechnicalWorkflowStep[] = [];

    for (const step of steps) {
      // Skip steps that will be moved into branches
      if (stepsToRemove.has(step.id)) continue;

      if (step.kind === 'control') {
        const controlStep = step as ControlStep;
        if (controlStep.control?.type === 'if') {
          // Analyze branch routing
          const thenChain = this.followRoutingChain(controlStep.steps || [], stepMap);
          const elseChain = this.followRoutingChain(controlStep.else_steps || [], stepMap);

          // Find convergence point (first step that appears in both chains or is after both)
          const convergenceStepId = this.findConvergencePoint(thenChain, elseChain, steps);

          // Separate steps by branch
          const thenBranchSteps: TechnicalWorkflowStep[] = [];
          const elseBranchSteps: TechnicalWorkflowStep[] = [];

          for (const stepId of thenChain) {
            if (stepId === convergenceStepId) break;
            const chainStep = stepMap.get(stepId);
            if (chainStep && !this.isNestedStep(stepId, controlStep)) {
              thenBranchSteps.push(chainStep);
              stepsToRemove.add(stepId);
            }
          }

          for (const stepId of elseChain) {
            if (stepId === convergenceStepId) break;
            const chainStep = stepMap.get(stepId);
            if (chainStep && !this.isNestedStep(stepId, controlStep)) {
              elseBranchSteps.push(chainStep);
              stepsToRemove.add(stepId);
            }
          }

          // Create restructured conditional step
          const restructuredStep: ControlStep = {
            ...controlStep,
            steps: [...(controlStep.steps || []), ...thenBranchSteps],
            else_steps: [...(controlStep.else_steps || []), ...elseBranchSteps]
          };

          result.push(restructuredStep);
        } else {
          result.push(step);
        }
      } else {
        result.push(step);
      }
    }

    return result;
  }

  /**
   * Follow the next_step routing chain starting from the last step of a branch
   * Returns array of step IDs in routing order
   */
  private followRoutingChain(
    branchSteps: TechnicalWorkflowStep[],
    stepMap: Map<string, TechnicalWorkflowStep>
  ): string[] {
    if (branchSteps.length === 0) return [];

    const chain: string[] = [];
    const visited = new Set<string>();

    // Start from the last step in the branch
    const lastBranchStep = branchSteps[branchSteps.length - 1];
    let nextStepId = this.getNextStepId(lastBranchStep);

    while (nextStepId && !visited.has(nextStepId)) {
      visited.add(nextStepId);
      chain.push(nextStepId);

      const nextStep = stepMap.get(nextStepId);
      if (!nextStep) break;

      nextStepId = this.getNextStepId(nextStep);
    }

    return chain;
  }

  /**
   * Extract next_step ID from a step's outputs
   */
  private getNextStepId(step: TechnicalWorkflowStep): string | null {
    const outputs = step.outputs as Record<string, any> | undefined;
    if (!outputs) return null;

    // next_step can be a string directly or nested in the outputs
    if (typeof outputs.next_step === 'string') {
      return outputs.next_step;
    }

    return null;
  }

  /**
   * Find the convergence point where both branch chains meet
   */
  private findConvergencePoint(
    thenChain: string[],
    elseChain: string[],
    allSteps: TechnicalWorkflowStep[]
  ): string | null {
    // If either chain is empty, no convergence needed
    if (thenChain.length === 0 || elseChain.length === 0) return null;

    const elseSet = new Set(elseChain);

    // Find first step in thenChain that also appears in elseChain
    for (const stepId of thenChain) {
      if (elseSet.has(stepId)) {
        return stepId;
      }
    }

    // If no direct overlap, find step that both chains eventually reach
    // This handles cases where chains have different lengths before converging
    const thenLast = thenChain[thenChain.length - 1];
    const elseLast = elseChain[elseChain.length - 1];

    if (thenLast === elseLast) {
      return thenLast;
    }

    return null;
  }

  /**
   * Check if a step ID is already nested inside a control step
   */
  private isNestedStep(stepId: string, controlStep: ControlStep): boolean {
    const checkNested = (steps: TechnicalWorkflowStep[] | undefined): boolean => {
      if (!steps) return false;
      return steps.some(s => s.id === stepId);
    };

    return checkNested(controlStep.steps) || checkNested(controlStep.else_steps);
  }

  /**
   * Pre-populate step registry with step metadata
   * This allows resolveInput to know step types before conversion completes
   *
   * IMPORTANT: This must predict whether a step will fall back to ai_processing
   * so that resolveInput generates the correct reference pattern.
   *
   * Phase 5 Enhancement: Now also tracks declared output keys for validation
   */
  private populateStepRegistry(steps: TechnicalWorkflowStep[]): void {
    for (const step of steps) {
      // Extract declared output keys (excluding metadata like next_step)
      const outputKeys = this.extractDeclaredOutputKeys(step.outputs);

      if (step.kind === 'operation') {
        const opStep = step as OperationStep;
        // Check if this is an LLM-based plugin (will become ai_processing)
        if (opStep.plugin && this.LLM_BASED_PLUGINS.includes(opStep.plugin)) {
          this.stepRegistry.set(step.id, { kind: 'operation', type: 'ai_processing', outputKeys });
        } else {
          this.stepRegistry.set(step.id, { kind: 'operation', type: 'action', outputKeys });
        }
      } else if (step.kind === 'transform') {
        const transformStep = step as TransformStep;
        const transformType = transformStep.type;

        // Check if this transform will fall back to ai_processing
        const willFallbackToAI = this.willTransformFallbackToAI(transformStep);

        if (willFallbackToAI) {
          // Register as ai_processing since it will fall back
          this.stepRegistry.set(step.id, { kind: 'transform', type: 'ai_processing', outputKeys });
        } else {
          this.stepRegistry.set(step.id, {
            kind: 'transform',
            type: transformType,
            operation: TRANSFORM_TYPE_TO_OPERATION[transformType || ''] || transformType,
            outputKeys
          });
        }
      } else if (step.kind === 'control') {
        const controlStep = step as ControlStep;
        // For control steps, output keys come from the last steps of each branch
        const branchOutputKeys = this.extractConditionalBranchOutputKeys(controlStep);
        this.stepRegistry.set(step.id, {
          kind: 'control',
          type: controlStep.control?.type,
          outputKeys: branchOutputKeys
        });
        // Recursively register nested steps
        if (controlStep.steps) {
          this.populateStepRegistry(controlStep.steps);
        }
        if (controlStep.else_steps) {
          this.populateStepRegistry(controlStep.else_steps);
        }
      }
    }
  }

  /**
   * Extract declared output keys from a step's outputs
   * Excludes metadata keys like next_step, is_last_step
   */
  private extractDeclaredOutputKeys(outputs: Record<string, any> | undefined): string[] {
    if (!outputs) return [];
    return Object.keys(outputs).filter(k =>
      k !== 'next_step' && k !== 'is_last_step' && !k.includes('next_step')
    );
  }

  /**
   * Extract output keys available from a conditional step's branches
   * For if/else control steps, this combines the output keys from the last step of each branch
   */
  private extractConditionalBranchOutputKeys(controlStep: ControlStep): string[] {
    const outputKeys = new Set<string>();

    // Get output keys from the last step of then branch
    if (controlStep.steps && controlStep.steps.length > 0) {
      const lastThenStep = controlStep.steps[controlStep.steps.length - 1];
      const thenOutputs = this.extractDeclaredOutputKeys(lastThenStep.outputs);
      thenOutputs.forEach(k => outputKeys.add(k));
    }

    // Get output keys from the last step of else branch
    if (controlStep.else_steps && controlStep.else_steps.length > 0) {
      const lastElseStep = controlStep.else_steps[controlStep.else_steps.length - 1];
      const elseOutputs = this.extractDeclaredOutputKeys(lastElseStep.outputs);
      elseOutputs.forEach(k => outputKeys.add(k));
    }

    // Add 'lastBranchOutput' as a special key for runtime branch resolution
    if (outputKeys.size > 0) {
      outputKeys.add('lastBranchOutput');
    }

    return Array.from(outputKeys);
  }

  /**
   * Predict whether a transform step will fall back to ai_processing
   * This mirrors the logic in convertTransformStep but without side effects
   */
  private willTransformFallbackToAI(step: TransformStep): boolean {
    const transformType = step.type;

    // LLM transform types always become ai_processing
    if (this.isLLMTransformType(transformType || '')) {
      return true;
    }

    // Filter transforms: check if filter field is in upstream schema
    // If upstream declares output_schema with the field, filter is deterministic
    if (transformType === 'filter') {
      const filterField = this.extractFilterField(step.inputs || {});
      if (filterField) {
        const upstreamCheck = this.checkFilterFieldInUpstreamSchema(step, filterField);
        if (upstreamCheck.needsAiProcessing) {
          return true;
        }
      }
    }

    // Mapping-based transforms without valid mapping config fall back
    if (this.isMappingBasedTransform(transformType || '') && !this.hasMappingConfig(step.inputs || {})) {
      return true;
    }

    return false;
  }

  /**
   * Convert a single Phase 4 step based on its kind
   */
  private convertStep(step: TechnicalWorkflowStep): WorkflowStep {
    try {
      let result: WorkflowStep;

      switch (step.kind) {
        case 'operation':
          result = this.convertOperationStep(step as OperationStep);
          // Track stats based on actual result type (may be ai_processing for LLM plugins)
          if (result.type === 'ai_processing') {
            this.stats.aiProcessingSteps++;
          } else {
            this.stats.actionSteps++;
          }
          break;
        case 'transform':
          result = this.convertTransformStep(step as TransformStep);
          if (result.type === 'ai_processing') {
            this.stats.aiProcessingSteps++;
          } else {
            this.stats.transformSteps++;
          }
          break;
        case 'control':
          result = this.convertControlStep(step as ControlStep);
          this.stats.controlSteps++;
          break;
        default:
          const unknownStep = step as TechnicalWorkflowStep;
          this.addError(unknownStep.id, 'invalid_step', `Unknown step kind: ${(unknownStep as any).kind}`, { kind: (unknownStep as any).kind });
          throw new Error(`Unknown step kind: ${(unknownStep as any).kind}`);
      }

      this.stats.convertedSteps++;
      return result;
    } catch (error) {
      this.addError(step.id, 'conversion_failed', `Failed to convert step: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Plugins that should be converted to ai_processing instead of action
   * These are LLM-based plugins that don't have real external actions
   */
  private readonly LLM_BASED_PLUGINS = [
    'chatgpt-research'
  ];

  /**
   * Convert operation step → ActionStep or AIProcessingStep (for LLM plugins)
   */
  private convertOperationStep(step: OperationStep): (ActionStep | AIProcessingStep) & { outputs?: Record<string, any> } {
    // Check if this is an LLM-based plugin that should be ai_processing
    if (step.plugin && this.LLM_BASED_PLUGINS.includes(step.plugin)) {
      this.addWarning(
        step.id,
        'fallback_used',
        `Plugin '${step.plugin}' is LLM-based - converting to ai_processing`,
        { plugin: step.plugin, action: step.action, reason: 'llm_based_plugin' }
      );
      this.stats.fallbacksUsed++;

      // Convert to ai_processing step
      return this.buildAIProcessingFromOperation(step);
    }

    const outputs = this.buildStepOutputs(step.outputs, step.id, 'action');

    return {
      id: step.id,
      type: 'action',
      name: this.truncate(step.description, 100),
      description: step.description,
      plugin: step.plugin,
      action: step.action,
      params: this.resolveInputs(step.inputs || {}),
      ...(outputs && { outputs })
    };
  }

  /**
   * Convert an operation step with LLM plugin to AIProcessingStep
   */
  private buildAIProcessingFromOperation(step: OperationStep): AIProcessingStep & { outputs?: Record<string, any> } {
    const outputs = this.buildStepOutputs(step.outputs, step.id, 'ai_processing');

    // Build prompt from action and params
    // E.g., action: "summarize_content" with params like content, length, style, focus_on
    const inputs = step.inputs || {};
    const action = step.action || 'process';

    // Find the main content input
    const contentInput = inputs['content'] || inputs['text'] || inputs['data'] || inputs['input'];
    const dataRef = contentInput ? this.resolveInput(contentInput) : '';

    // Build contextual prompt from action and other params
    let prompt = step.description;

    // Add action-specific instructions if available
    if (action === 'summarize_content') {
      const length = inputs['length'] ? this.resolveInput(inputs['length']) : 'brief';
      const style = inputs['style'] ? this.resolveInput(inputs['style']) : 'professional';
      const focusOn = inputs['focus_on'] ? this.resolveInput(inputs['focus_on']) : [];

      prompt = `${step.description}\n\nSummarization settings:\n- Length: ${length}\n- Style: ${style}`;
      if (Array.isArray(focusOn) && focusOn.length > 0) {
        prompt += `\n- Focus on: ${focusOn.join(', ')}`;
      }
    }

    // Add output format instructions
    const outputFormatInstructions = this.buildOutputFormatInstructions(step.outputs, action);
    if (outputFormatInstructions) {
      prompt = `${prompt}${outputFormatInstructions}`;
    }

    return {
      id: step.id,
      type: 'ai_processing',
      name: this.truncate(step.description, 100),
      description: step.description,
      prompt,
      params: {
        data: dataRef
      },
      ...(outputs && { outputs })
    };
  }

  /**
   * Convert transform step → TransformStep or AIProcessingStep
   */
  private convertTransformStep(step: TransformStep): WorkflowStep {
    let transformType = step.type;
    let wasInferred = false;

    if (!transformType) {
      transformType = this.inferTransformType(step.description);
      wasInferred = true;
      this.addWarning(
        step.id,
        'type_inferred',
        `Transform type inferred as '${transformType}' from description (no explicit type provided)`,
        { inferredType: transformType, description: step.description }
      );
      this.stats.fallbacksUsed++;
    }

    // Check if transform type is recognized
    if (!this.isKnownTransformType(transformType)) {
      this.addWarning(
        step.id,
        'unknown_transform',
        `Unknown transform type '${transformType}', treating as LLM transform`,
        { transformType }
      );
    }

    if (this.isLLMTransformType(transformType)) {
      return this.buildAIProcessingStep(step, transformType);
    }

    // For filter transforms, check if the filter field is declared in the upstream step's output_schema
    // If the upstream step (especially ai_processing) declares the field, the filter is deterministic
    // If not declared, we can still try deterministic execution (field might exist in plugin output)
    if (transformType === 'filter') {
      const filterField = this.extractFilterField(step.inputs || {});
      if (filterField) {
        const upstreamCheck = this.checkFilterFieldInUpstreamSchema(step, filterField);
        if (upstreamCheck.needsAiProcessing) {
          this.addWarning(
            step.id,
            'fallback_used',
            upstreamCheck.reason || `Filter field '${filterField}' requires ai_processing`,
            { transformType, field: filterField, reason: 'field_not_in_upstream_schema' }
          );
          this.stats.fallbacksUsed++;
          return this.buildAIProcessingStep(step, transformType);
        }
      }
    }

    // For mapping-based transforms (map, format, etc.), check if config would be empty
    // If so, fallback to ai_processing since we can't deterministically execute without config
    if (this.isMappingBasedTransform(transformType) && !this.hasMappingConfig(step.inputs || {})) {
      this.addWarning(
        step.id,
        'fallback_used',
        `Transform type '${transformType}' has no mapping configuration - falling back to ai_processing`,
        { transformType, reason: 'empty_mapping_config' }
      );
      this.stats.fallbacksUsed++;

      // Look ahead for downstream filter steps that expect computed fields from this step
      const downstreamFields = this.findDownstreamFieldRequirements(step.id);
      return this.buildAIProcessingStep(step, transformType, downstreamFields);
    }

    return this.buildTransformStep(step, transformType);
  }

  /**
   * Check if a filter field is declared in the upstream step's output_schema
   * Returns whether ai_processing is needed and the reason
   */
  private checkFilterFieldInUpstreamSchema(
    step: TransformStep,
    filterField: string
  ): { needsAiProcessing: boolean; reason?: string } {
    const inputs = step.inputs || {};

    // Find the collection input to determine the upstream step
    const collectionInput = inputs['collection'] || inputs['data'] || inputs['input'];
    if (!collectionInput || collectionInput.source !== 'from_step' || !collectionInput.ref) {
      // No upstream step reference - assume deterministic (might be user input)
      return { needsAiProcessing: false };
    }

    // Parse the reference to get the upstream step ID
    const refParts = collectionInput.ref.split('.');
    const upstreamStepId = refParts[0];

    // Find the upstream step in the workflow
    const upstreamStep = this.findStepById(upstreamStepId);
    if (!upstreamStep) {
      // Upstream step not found - let it fail at runtime
      return { needsAiProcessing: false };
    }

    // Check if upstream step has an output_schema (Phase 4 Reviewer adds this for LLM steps)
    const upstreamAny = upstreamStep as any;
    const outputSchema = upstreamAny.output_schema;

    if (!outputSchema) {
      // No output_schema declared - assume the field exists (plugin output or implicit)
      // This is the case for plugin actions where fields are defined by the schema registry
      return { needsAiProcessing: false };
    }

    // Check if the filter field is declared in the output_schema
    // output_schema can be: { type: "array", items: { properties: { field: ... } } }
    // or a simpler format
    const declaredFields = this.extractFieldsFromOutputSchema(outputSchema);

    if (declaredFields.length > 0 && !declaredFields.includes(filterField)) {
      // Field is NOT in the declared schema - this might be an error in the workflow
      // But we'll still try deterministic execution; it might fail at runtime
      // Only fall back to ai_processing if the field looks like it needs computation
      return { needsAiProcessing: false };
    }

    // Field is declared in output_schema OR no specific fields declared - deterministic
    return { needsAiProcessing: false };
  }

  /**
   * Extract field names from an output_schema declaration
   * Supports multiple formats:
   * 1. Reviewer format: { fieldName: { type: "string" }, ... }
   * 2. JSON Schema array: { type: "array", items: { properties: { ... } } }
   * 3. JSON Schema object: { type: "object", properties: { ... } }
   * 4. Simple properties: { properties: { ... } }
   */
  private extractFieldsFromOutputSchema(schema: any): string[] {
    if (!schema || typeof schema !== 'object') return [];

    // Handle array schema: { type: "array", items: { properties: { ... } } }
    if (schema.type === 'array' && schema.items?.properties) {
      return Object.keys(schema.items.properties);
    }

    // Handle object schema: { type: "object", properties: { ... } }
    if (schema.type === 'object' && schema.properties) {
      return Object.keys(schema.properties);
    }

    // Handle simple properties object
    if (schema.properties) {
      return Object.keys(schema.properties);
    }

    // Handle Reviewer format: { fieldName: { type: "string" }, fieldName2: { type: "boolean" }, ... }
    // Each key is a field name, value is an object with at least a "type" property
    const keys = Object.keys(schema);
    if (keys.length > 0) {
      const isReviewerFormat = keys.every(key => {
        const val = schema[key];
        return val && typeof val === 'object' && 'type' in val;
      });

      if (isReviewerFormat) {
        return keys;
      }
    }

    return [];
  }

  /**
   * Find a step by ID in the workflow (including nested steps)
   */
  private findStepById(stepId: string): TechnicalWorkflowStep | null {
    const search = (steps: TechnicalWorkflowStep[]): TechnicalWorkflowStep | null => {
      for (const step of steps) {
        if (step.id === stepId) return step;

        // Check nested steps
        const controlStep = step as any;
        if (controlStep.steps) {
          const found = search(controlStep.steps);
          if (found) return found;
        }
        if (controlStep.else_steps) {
          const found = search(controlStep.else_steps);
          if (found) return found;
        }
      }
      return null;
    };

    return search(this.workflowSteps);
  }

  /**
   * Extract the filter field name from a filter step's inputs
   */
  private extractFilterField(inputs: Record<string, StepInput>): string | null {
    const fieldInput = inputs['field'];
    if (!fieldInput || fieldInput.source !== 'constant') return null;

    let fieldName = String(fieldInput.value || '');

    // Normalize - strip {{item.}} prefix if present
    if (fieldName.startsWith('{{item.')) {
      fieldName = fieldName.replace(/^\{\{item\./, '').replace(/\}\}$/, '');
    } else if (fieldName.startsWith('{{') && fieldName.endsWith('}}')) {
      fieldName = fieldName.slice(2, -2);
      if (fieldName.startsWith('item.')) {
        fieldName = fieldName.slice(5);
      }
    }

    return fieldName || null;
  }

  /**
   * Check if a transform type uses mapping-based configuration
   */
  private isMappingBasedTransform(type: string): boolean {
    // Note: deduplicate and split are NOT mapping-based - they use field-based config
    // deduplicate: requires config.field to identify duplicates
    // split: requires config.field to group items into buckets
    return ['map', 'format', 'pick_fields', 'merge', 'convert', 'flatten'].includes(type);
  }

  /**
   * Check if inputs contain valid mapping configuration that can be executed deterministically
   *
   * A valid deterministic mapping must contain actual field mappings with {{item.*}} references.
   * Configuration parameters (like `user_domain: "gmail.com"`) are NOT sufficient because
   * the deterministic map transform can only:
   * 1. Copy literal values
   * 2. Expand templates like {{item.field}}
   *
   * It cannot compute business logic like "parse sender domain and compare to user_domain".
   * Such cases need ai_processing to derive computed fields.
   */
  private hasMappingConfig(inputs: Record<string, StepInput>): boolean {
    // Collection/data inputs are not config - they're just the input source
    const nonConfigKeys = ['collection', 'data', 'input', 'items', 'array', 'source'];

    let hasValidConfig = false;

    for (const [key, input] of Object.entries(inputs)) {
      // Skip input source keys
      if (nonConfigKeys.includes(key.toLowerCase())) continue;

      // Check if the value contains {{item.*}} references
      if (input?.source === 'constant' && input?.value !== undefined) {
        const valueStr = typeof input.value === 'string' ? input.value : JSON.stringify(input.value);

        // If it contains {{item.*}} references, it's an actual field mapping
        if (valueStr.includes('{{item.') || valueStr.includes('{{item}}')) {
          hasValidConfig = true;
        }
      }

      // Template input is valid for format transforms
      // Even a plain literal string template is valid - it's deterministic output
      if (key === 'template' && input?.source === 'constant') {
        const templateValue = input.value;
        // A template with any string value (even without references) is valid
        // It just means the output is that literal string or the evaluated template
        if (typeof templateValue === 'string' && templateValue.length > 0) {
          hasValidConfig = true;
        }
      }

      // Columns input is valid for map transforms (object array → 2D array conversion)
      // This enables deterministic conversion of objects to Google Sheets rows
      if (key === 'columns' && input?.source === 'constant' && Array.isArray(input.value)) {
        hasValidConfig = true;
      }
    }

    // Return true if we found valid config (templates or item references)
    // Constant-only configs without templates (like user_domain: "gmail.com") should fall back to ai_processing
    return hasValidConfig;
  }

  /**
   * Find downstream filter steps that depend on this step's output
   * and extract the computed field requirements from their conditions
   *
   * Phase 5 Fix: Now recursively checks nested steps inside control steps
   */
  private findDownstreamFieldRequirements(stepId: string): Array<{ field: string; description: string; fromStepId: string }> {
    const fields: Array<{ field: string; description: string; fromStepId: string }> = [];
    const seenFields = new Set<string>();

    // Find the output key of this step
    const currentStep = this.findStepById(stepId);
    if (!currentStep) return fields;

    const outputKeys = Object.keys(currentStep.outputs || {}).filter(k => k !== 'next_step');
    if (outputKeys.length === 0) return fields;

    // Recursive function to check all steps including nested ones
    const checkStep = (step: TechnicalWorkflowStep) => {
      // Check if this is a filter step
      if (step.kind === 'transform' && (step as TransformStep).type === 'filter') {
        const filterStep = step as TransformStep;
        const inputs = filterStep.inputs || {};

        // Check if this filter step's collection input references our step's output
        const collectionInput = inputs['collection'] || inputs['data'] || inputs['input'];
        if (collectionInput) {
          const inputRef = collectionInput.source === 'from_step' ? collectionInput.ref : null;
          if (inputRef) {
            // Check if it references our step or a downstream step that chains from us
            const referencesOurOutput = outputKeys.some(key =>
              inputRef === `${stepId}.${key}` || inputRef.startsWith(`${stepId}.`)
            );

            // Also check if it references a step that directly follows our output
            const referencesDownstreamOfUs = this.isStepDownstreamOf(inputRef.split('.')[0], stepId);

            if (referencesOurOutput || referencesDownstreamOfUs) {
              // Extract the field being filtered on
              const fieldInput = inputs['field'];
              if (fieldInput && fieldInput.source === 'constant') {
                let fieldName = String(fieldInput.value || '');

                // Strip {{item.}} prefix if present
                if (fieldName.startsWith('{{item.')) {
                  fieldName = fieldName.replace(/^\{\{item\./, '').replace(/\}\}$/, '');
                }
                if (!fieldName.startsWith('{{') && !fieldName.includes('.')) {
                  // Skip if we've already seen this field
                  if (!seenFields.has(fieldName)) {
                    seenFields.add(fieldName);

                    // Extract description from the step's description
                    const description = filterStep.description || `Boolean field for filtering in ${filterStep.id}`;

                    fields.push({
                      field: fieldName,
                      description: this.extractFieldLogicFromDescription(fieldName, description),
                      fromStepId: filterStep.id
                    });
                  }
                }
              }
            }
          }
        }
      }

      // Recursively check nested steps in control steps
      const controlStep = step as any;
      if (controlStep.steps) {
        for (const nested of controlStep.steps) {
          checkStep(nested);
        }
      }
      if (controlStep.else_steps) {
        for (const nested of controlStep.else_steps) {
          checkStep(nested);
        }
      }
    };

    // Check all workflow steps
    for (const step of this.workflowSteps) {
      checkStep(step);
    }

    return fields;
  }

  /**
   * Check if targetStepId is downstream of sourceStepId in the workflow
   */
  private isStepDownstreamOf(targetStepId: string, sourceStepId: string): boolean {
    const sourceIndex = this.workflowSteps.findIndex(s => s.id === sourceStepId);
    const targetIndex = this.workflowSteps.findIndex(s => s.id === targetStepId);
    return sourceIndex >= 0 && targetIndex > sourceIndex;
  }

  /**
   * Extract field computation logic from step description
   * E.g., "Keep only emails from client senders (sender domain != gmail.com)"
   *   → "true if sender domain != gmail.com"
   */
  private extractFieldLogicFromDescription(fieldName: string, description: string): string {
    // Look for parenthetical explanation
    const parenMatch = description.match(/\(([^)]+)\)/);
    if (parenMatch) {
      return `true if ${parenMatch[1]}`;
    }

    // Look for common patterns
    const patterns = [
      /based on (.+)/i,
      /where (.+)/i,
      /if (.+)/i,
      /when (.+)/i,
    ];

    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match) {
        return `true if ${match[1]}`;
      }
    }

    // Default: use field name as hint
    return `true/false - compute based on: ${description}`;
  }

  /**
   * Check if a transform type is recognized
   */
  private isKnownTransformType(type: string): boolean {
    return (DETERMINISTIC_TRANSFORM_TYPES as readonly string[]).includes(type) ||
           (LLM_TRANSFORM_TYPES as readonly string[]).includes(type) ||
           type?.endsWith('_with_llm');
  }

  /**
   * Convert control step → ScatterGatherStep or ConditionalStep
   */
  private convertControlStep(step: ControlStep): WorkflowStep {
    const controlType = step.control?.type;

    if (controlType === 'for_each') {
      return this.buildScatterGatherStep(step);
    } else if (controlType === 'if') {
      return this.buildConditionalStep(step);
    } else {
      throw new Error(`Unknown control type: ${controlType}`);
    }
  }

  // --------------------------------------------------------------------------
  // Transform Step Builders
  // --------------------------------------------------------------------------

  /**
   * Build PILOT DSL TransformStep (deterministic, no LLM)
   */
  private buildTransformStep(step: TransformStep, transformType: string): PilotTransformStep & { outputs?: Record<string, any> } {
    const operation = TRANSFORM_TYPE_TO_OPERATION[transformType] || 'map';
    const inputRef = this.findPrimaryInput(step.inputs || {}, step.id);
    const config = this.buildTransformConfig(transformType, step.inputs || {}, step.id, step.outputs);
    const outputs = this.buildStepOutputs(step.outputs, step.id, 'transform', operation);

    // For map transforms with columns, extract static values from description
    // E.g., "add Status='Open'" → static_values: { Status: "Open" }
    if (operation === 'map' && config.mapping?.columns) {
      const staticValues = this.extractStaticValuesFromDescription(step.description);
      if (Object.keys(staticValues).length > 0) {
        config.mapping.static_values = staticValues;
      }
    }

    return {
      id: step.id,
      type: 'transform',
      name: this.truncate(step.description, 100),
      description: step.description,
      operation: operation as PilotTransformStep['operation'],
      input: inputRef,
      config,
      ...(outputs && { outputs })
    };
  }

  /**
   * Extract static values from step description
   * Looks for patterns like: add X="Y", set X='Y', X="Y"
   */
  private extractStaticValuesFromDescription(description: string): Record<string, string> {
    const staticValues: Record<string, string> = {};

    // Pattern: add/set FieldName="Value" or FieldName='Value'
    // Also matches standalone FieldName="Value" patterns
    const patterns = [
      /\badd\s+(\w+)\s*=\s*["']([^"']+)["']/gi,
      /\bset\s+(\w+)\s*=\s*["']([^"']+)["']/gi,
      /\b(\w+)\s*=\s*["']([^"']+)["']/gi
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        const [, field, value] = match;
        // Only add if it looks like a column assignment (capitalized or known column name)
        if (field && value && /^[A-Z]/.test(field)) {
          staticValues[field] = value;
        }
      }
    }

    return staticValues;
  }

  /**
   * Build PILOT DSL AIProcessingStep (requires LLM)
   * @param downstreamFields - Optional array of field requirements from downstream filter steps
   */
  private buildAIProcessingStep(
    step: TransformStep,
    transformType: string,
    downstreamFields?: Array<{ field: string; description: string; fromStepId: string }>
  ): AIProcessingStep & { outputs?: Record<string, any>; output_schema?: any } {
    const dataInput = this.findPrimaryInput(step.inputs || {}, step.id);

    // Phase 5: Infer bucket keys for split transforms to generate explicit outputs
    const splitBucketKeys = transformType === 'split' ? this.inferSplitBucketKeys(step) : undefined;
    const outputs = this.buildStepOutputs(step.outputs, step.id, 'ai_processing', undefined, splitBucketKeys);

    // Check if reviewer provided a detailed output_schema
    const stepAny = step as any;
    const hasDetailedSchema = stepAny.output_schema && typeof stepAny.output_schema === 'object';

    // Build enhanced prompt with downstream field requirements
    let prompt = step.description;

    // Check if there are detailed instructions in the inputs (e.g., from extract_with_llm)
    const instructionsInput = step.inputs?.['instructions'];
    if (instructionsInput?.source === 'constant' && typeof instructionsInput.value === 'string') {
      prompt = `${step.description}\n\n${instructionsInput.value}`;
    }

    // For split transforms, add explicit bucket structure instructions
    if (transformType === 'split') {
      const bucketKeys = this.inferSplitBucketKeys(step);
      if (bucketKeys.length > 0) {
        const outputKey = Object.keys(step.outputs || {}).find(k => k !== 'next_step') || 'buckets';
        prompt = `${prompt}\n\nGroup the input items into the following categories: ${bucketKeys.join(', ')}.\nReturn an object with "${outputKey}" containing these keys: { ${bucketKeys.map(k => `"${k}": [...]`).join(', ')} }`;
      }
    }

    if (downstreamFields && downstreamFields.length > 0) {
      const fieldsList = downstreamFields
        .map(f => `- ${f.field}: ${f.description}`)
        .join('\n');
      prompt = `${prompt}\n\nFor each item, compute these fields needed by downstream steps:\n${fieldsList}`;
    }

    // Add output format instructions - prefer detailed schema if available
    if (hasDetailedSchema) {
      const schemaStr = JSON.stringify(stepAny.output_schema, null, 2);
      prompt = `${prompt}\n\nOUTPUT FORMAT:\nReturn ONLY valid JSON matching this exact schema:\n${schemaStr}\n\nDo not include any explanations or markdown code blocks, just the raw JSON.`;
    } else {
      const outputFormatInstructions = this.buildOutputFormatInstructions(step.outputs, transformType, step);
      if (outputFormatInstructions) {
        prompt = `${prompt}${outputFormatInstructions}`;
      }
    }

    // Build params with ALL from_step inputs (not just the primary one)
    // This ensures multi-input steps (e.g., deduplication needing both new items AND existing sheet data)
    // have all their data available to the LLM
    const params: Record<string, string> = {};
    if (dataInput) {
      params.data = dataInput;
    }
    for (const [key, input] of Object.entries(step.inputs || {})) {
      if (input.source === 'from_step') {
        const resolved = this.resolveInput(input);
        // Add all from_step inputs with their original key names
        // This preserves semantic meaning (e.g., 'existing_sheet_values', 'new_action_items')
        if (resolved && resolved !== params.data) {
          params[key] = resolved;
        } else if (resolved && key !== 'data') {
          // Same resolved value but different key - still include for semantic clarity
          params[key] = resolved;
        }
      }
    }

    const result: AIProcessingStep & { outputs?: Record<string, any>; output_schema?: any } = {
      id: step.id,
      type: 'ai_processing',
      name: this.truncate(step.description, 100),
      description: step.description,
      intent: 'extract',  // Explicit intent to ensure ExtractHandler is used (parses JSON output properly)
      prompt,
      params,
      ...(outputs && { outputs })
    };

    // Pass through output_schema for runtime validation
    if (hasDetailedSchema) {
      result.output_schema = stepAny.output_schema;
    } else {
      // Phase 5: Warn if ai_processing step has downstream field dependencies but no output_schema
      // This helps catch cases where the LLM output structure isn't explicitly defined
      const downstreamFieldDeps = this.findDownstreamFieldDependencies(step.id);
      if (downstreamFieldDeps.length > 0) {
        this.addWarning(
          step.id,
          'missing_input',
          `AI processing step produces structured output used by downstream steps but lacks output_schema. ` +
          `Fields used downstream: ${downstreamFieldDeps.join(', ')}`,
          { downstreamFields: downstreamFieldDeps, suggestion: 'Add output_schema to Phase 4 Reviewer output' }
        );
      }
    }

    return result;
  }

  /**
   * Find downstream steps that depend on specific fields from this step's output
   * Checks both filter fields and Handlebars template field references
   */
  private findDownstreamFieldDependencies(stepId: string): string[] {
    const fields = new Set<string>();

    // Get filter field requirements (already exists)
    const filterFields = this.findDownstreamFieldRequirements(stepId);
    for (const f of filterFields) {
      fields.add(f.field);
    }

    // Find format template field references
    const templateFields = this.findDownstreamTemplateFieldDependencies(stepId);
    for (const f of templateFields) {
      fields.add(f);
    }

    return Array.from(fields);
  }

  /**
   * Find fields used in downstream Handlebars templates that iterate over this step's output
   * e.g., {{#each data}}...{{sender}}...{{/each}} -> ['sender', 'subject', ...]
   */
  private findDownstreamTemplateFieldDependencies(stepId: string): string[] {
    const fields = new Set<string>();

    // Find the output key of this step
    const currentStep = this.workflowSteps.find(s => s.id === stepId);
    if (!currentStep) return [];

    const outputKeys = Object.keys(currentStep.outputs || {}).filter(k => k !== 'next_step');
    if (outputKeys.length === 0) return [];

    // Walk the workflow to find steps that use this step's output in templates
    const checkStep = (step: TechnicalWorkflowStep) => {
      const inputs = (step as any).inputs || {};

      // Check template input
      const templateInput = inputs['template'];
      if (templateInput?.source === 'constant' && typeof templateInput.value === 'string') {
        const template = templateInput.value;

        // Check if this step's input references our step's output
        const dataInput = inputs['data'] || inputs['collection'] || inputs['items'];
        const dataRef = dataInput?.source === 'from_step' ? dataInput.ref : '';

        const referencesOurStep = outputKeys.some(key =>
          dataRef === `${stepId}.${key}` || dataRef.startsWith(`${stepId}.`)
        );

        if (referencesOurStep && (template.includes('{{#each') || template.includes('{{#with'))) {
          // Extract field references inside the Handlebars block
          // Pattern: {{fieldName}} where fieldName is a simple identifier (not step reference)
          const fieldPattern = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
          let match;
          while ((match = fieldPattern.exec(template)) !== null) {
            const field = match[1];
            // Skip Handlebars helpers and special words
            if (!['else', 'this', 'each', 'with', 'if', 'unless'].includes(field)) {
              fields.add(field);
            }
          }
        }
      }

      // Check nested steps
      if ((step as any).steps) {
        for (const nested of (step as any).steps) {
          checkStep(nested);
        }
      }
      if ((step as any).else_steps) {
        for (const nested of (step as any).else_steps) {
          checkStep(nested);
        }
      }
    };

    for (const step of this.workflowSteps) {
      checkStep(step);
    }

    return Array.from(fields);
  }

  /**
   * Infer bucket keys for split transforms by looking at downstream step templates
   * Returns array of bucket key names (e.g., ['action_required', 'fyi'])
   */
  private inferSplitBucketKeys(step: TransformStep): string[] {
    const bucketKeys: string[] = [];
    const stepId = step.id;

    // Look at downstream steps that reference this step's output
    // Use workflowSteps (the original technical workflow) to find templates
    for (const otherStep of this.workflowSteps) {
      // Check if this step has a template input that references our split step
      const otherStepAny = otherStep as any;
      const templateInput = otherStepAny.inputs?.['template'];

      if (templateInput?.source === 'constant' && typeof templateInput.value === 'string') {
        const template = templateInput.value;

        // Check if this template references our step
        if (template.includes(`${stepId}.data.`) || template.includes(`${stepId}.`)) {
          // Extract {{#each KEY}} patterns to find expected bucket keys
          const eachMatches = template.matchAll(/\{\{#each\s+(\w+)\}\}/g);
          for (const match of eachMatches) {
            const key = match[1];
            // Skip common loop variables that aren't bucket keys
            if (!['item', 'items', 'this', 'index'].includes(key) && !bucketKeys.includes(key)) {
              bucketKeys.push(key);
            }
          }
        }
      }
    }

    // If no downstream hints, try to infer from description
    if (bucketKeys.length === 0) {
      const desc = step.description.toLowerCase();
      if (desc.includes('action') && desc.includes('fyi')) {
        bucketKeys.push('action_required', 'fyi');
      } else if (desc.includes('yes') && desc.includes('no')) {
        bucketKeys.push('yes', 'no');
      } else if (desc.includes('pass') && desc.includes('fail')) {
        bucketKeys.push('pass', 'fail');
      }
    }

    return bucketKeys;
  }

  /**
   * Build output format instructions for ai_processing prompts
   *
   * This tells the LLM exactly what format to return, ensuring:
   * 1. Consistent JSON output that can be parsed
   * 2. Downstream steps can reliably reference the output
   * 3. The output matches the step's defined output type
   */
  private buildOutputFormatInstructions(
    outputs: Record<string, any> | undefined,
    originalTransformType?: string,
    step?: TransformStep
  ): string {
    if (!outputs || Object.keys(outputs).length === 0) {
      // Default: return as JSON object
      return `\n\nOUTPUT FORMAT:
Return ONLY valid JSON. No explanations, no markdown code blocks, just the raw JSON.`;
    }

    const outputKeys = Object.keys(outputs).filter(k => k !== 'next_step');
    const firstOutputKey = outputKeys[0] || 'result';
    const firstOutput = outputs[firstOutputKey];
    const outputType = typeof firstOutput === 'string' ? firstOutput : (firstOutput?.type || 'object');

    // For split transforms with inferred bucket keys, provide explicit structure
    if (originalTransformType === 'split' && step) {
      const bucketKeys = this.inferSplitBucketKeys(step);
      if (bucketKeys.length > 0) {
        const bucketExample = bucketKeys.map(k => `"${k}": [...]`).join(', ');
        return `\n\nOUTPUT FORMAT:
Return ONLY a valid JSON object with "${firstOutputKey}" containing the categorized items.
Do not include any explanations or markdown code blocks, just the raw JSON.
Example format:
{"${firstOutputKey}": {${bucketExample}}}`;
      }
    }

    // Determine if output should be an array based on type annotation
    const isArrayOutput = outputType.includes('[]') ||
                          outputType === 'array' ||
                          originalTransformType === 'map' ||
                          originalTransformType === 'filter';

    if (isArrayOutput) {
      // For array outputs (object[], T[], string[], etc.)
      // Use the declared output key name from the technical workflow
      return `\n\nOUTPUT FORMAT:
Return ONLY a valid JSON object with a "${firstOutputKey}" array containing the processed data.
Do not include any explanations or markdown code blocks, just the raw JSON.
Example format:
{"${firstOutputKey}": [{"field1": "value1", ...}, {"field2": "value2", ...}]}`;
    }

    // For single object outputs - use the declared output key name
    return `\n\nOUTPUT FORMAT:
Return ONLY a valid JSON object with "${firstOutputKey}" as the key.
Do not include any explanations or markdown code blocks, just the raw JSON.
Example format:
{"${firstOutputKey}": <your_output_here>}`;
  }

  /**
   * Build TransformConfig based on operation type
   */
  private buildTransformConfig(
    transformType: string,
    inputs: Record<string, StepInput>,
    stepId: string,
    outputs?: Record<string, any>
  ): TransformConfig {
    switch (transformType) {
      case 'filter':
        return this.buildFilterConfig(inputs, stepId);
      case 'sort':
        return this.buildSortConfig(inputs, stepId);
      case 'group_by':
        return this.buildGroupByConfig(inputs, stepId);
      case 'aggregate':
        return this.buildAggregateConfig(inputs, stepId);
      case 'deduplicate':
        return this.buildDeduplicateConfig(inputs, stepId);
      case 'split':
        return this.buildSplitConfig(inputs, stepId);
      case 'format':
      case 'map':
      case 'pick_fields':
      case 'merge':
      case 'convert':
      case 'flatten':
      default:
        return this.buildMappingConfig(inputs, stepId, outputs);
    }
  }

  private buildFilterConfig(inputs: Record<string, StepInput>, stepId: string): TransformConfig {
    // Use pattern matching to find field and value inputs
    const fieldInput = this.findFieldInput(inputs, stepId);
    const valueInput = this.findValueInput(inputs, stepId);

    let field = this.resolveInput(fieldInput);
    const operator = this.resolveInput(inputs['operator']) || 'equals';
    const value = this.resolveInput(valueInput);

    // Normalize field name to use item. prefix for filter context
    // The executor sets each array item as 'item' variable during filtering
    if (typeof field === 'string') {
      // Extract plain field name first
      let plainField = field;

      if (field.startsWith('{{item.')) {
        // Already has item. prefix with template syntax - normalize to item.fieldName
        plainField = field.replace(/^\{\{item\./, '').replace(/\}\}$/, '');
      } else if (field.startsWith('{{') && field.endsWith('}}')) {
        // Has template syntax - extract inner value
        plainField = field.slice(2, -2);
        if (plainField.startsWith('item.')) {
          plainField = plainField.slice(5);
        }
      } else if (field.startsWith('item.')) {
        // Has item. prefix without template syntax
        plainField = field.slice(5);
      }

      // Add item. prefix for filter context (executor resolves item.fieldName)
      field = `item.${plainField}`;
    }

    // Warn if critical inputs are missing
    if (!fieldInput) {
      this.addWarning(stepId, 'missing_input', 'Filter step missing field input', { availableInputs: Object.keys(inputs) });
    }
    if (!valueInput) {
      this.addWarning(stepId, 'missing_input', 'Filter step missing value input', { availableInputs: Object.keys(inputs) });
    }

    return {
      condition: {
        conditionType: 'simple',
        field: field || '',  // Explicit item.fieldName for filter context
        operator: this.normalizeOperator(operator),
        value
      }
    };
  }

  private buildSortConfig(inputs: Record<string, StepInput>, stepId: string): TransformConfig {
    // Use pattern matching to find field input
    const fieldInput = this.findFieldInput(inputs, stepId);

    if (!fieldInput) {
      this.addWarning(stepId, 'missing_input', 'Sort step missing field input', { availableInputs: Object.keys(inputs) });
    }

    return {
      field: this.resolveInput(fieldInput),
      order: this.resolveInput(inputs['order'] || inputs['sort_order']) || 'asc'
    };
  }

  private buildGroupByConfig(inputs: Record<string, StepInput>, stepId: string): TransformConfig {
    // Use pattern matching to find field input
    const fieldInput = this.findFieldInput(inputs, stepId);

    if (!fieldInput) {
      this.addWarning(stepId, 'missing_input', 'Group by step missing field input', { availableInputs: Object.keys(inputs) });
    }

    return {
      field: this.resolveInput(fieldInput)
    };
  }

  private buildAggregateConfig(inputs: Record<string, StepInput>, stepId: string): TransformConfig {
    if (!inputs['aggregations']) {
      this.addWarning(stepId, 'missing_input', 'Aggregate step missing aggregations input', { availableInputs: Object.keys(inputs) });
    }

    return {
      aggregations: this.resolveInput(inputs['aggregations']) || []
    };
  }

  /**
   * Build config for deduplicate transform
   * Requires: field (the field to check for duplicates)
   * Optional:
   *   - keep ('first' | 'last') - which duplicate to keep (default: 'first')
   *   - sort_field - field to sort by before deduplication (determines which is first/last)
   *
   * Phase 5 Enhancement: Added sort_field support for deterministic deduplication
   */
  private buildDeduplicateConfig(inputs: Record<string, StepInput>, stepId: string): TransformConfig {
    const fieldInput = this.findFieldInput(inputs, stepId);

    if (!fieldInput) {
      this.addWarning(stepId, 'missing_input', 'Deduplicate step missing field input - required to identify duplicates', { availableInputs: Object.keys(inputs) });
    }

    const config: TransformConfig = {
      field: this.resolveInput(fieldInput)
    };

    // Optional: keep strategy (first, last)
    if (inputs['keep']) {
      config.keep = this.resolveInput(inputs['keep']);
    }

    // Phase 5: Optional sort_field for deterministic deduplication
    // e.g., sort_field: 'created_at' with keep: 'last' = keep most recent
    if (inputs['sort_field']) {
      config.sort_field = this.resolveInput(inputs['sort_field']);
    }

    return config;
  }

  /**
   * Build config for split transform
   * Requires: field (the field to group/split by)
   * The transform groups items into buckets based on the field value
   */
  private buildSplitConfig(inputs: Record<string, StepInput>, stepId: string): TransformConfig {
    const fieldInput = this.findFieldInput(inputs, stepId);

    if (!fieldInput) {
      this.addWarning(stepId, 'missing_input', 'Split step missing field input - required to group items into buckets', { availableInputs: Object.keys(inputs) });
    }

    return {
      field: this.resolveInput(fieldInput)
    };
  }

  private buildMappingConfig(
    inputs: Record<string, StepInput>,
    stepId: string,
    outputs?: Record<string, any>
  ): TransformConfig {
    const mapping: Record<string, any> = {};

    // Build a map of input key names to their resolved references
    // This allows us to replace {{keyName}} placeholders in templates
    const inputKeyToResolved: Record<string, string> = {};
    const primaryInputKeys = ['data', 'collection', 'items', 'input'];

    for (const [key, input] of Object.entries(inputs)) {
      if (primaryInputKeys.includes(key) || input.source === 'from_step') {
        const resolved = this.resolveInput(input);
        if (typeof resolved === 'string') {
          inputKeyToResolved[key] = resolved;
        }
      }
    }

    for (const [key, input] of Object.entries(inputs)) {
      if (!primaryInputKeys.includes(key)) {
        mapping[key] = this.resolveInput(input);
      }
    }

    if (Object.keys(mapping).length === 0) {
      this.addWarning(stepId, 'empty_config', 'Mapping step has no configuration inputs', { availableInputs: Object.keys(inputs) });
    }

    // Phase 5 Fix: Replace {{inputKey}} placeholders in templates with resolved references
    // The Reviewer uses {{data}}, {{collection}}, etc. as placeholders meaning "the input data to this step"
    // The executor expects full step references like {{step5_1.data}}
    let template = mapping['template'];
    if (typeof template === 'string') {
      for (const [inputKey, resolvedRef] of Object.entries(inputKeyToResolved)) {
        // Replace {{inputKey}} with the resolved reference
        const keyPattern = new RegExp(`\\{\\{${inputKey}\\}\\}`, 'g');
        template = template.replace(keyPattern, resolvedRef);

        // Replace {{inputKey.field}} with {{resolvedRef.field}}
        const fieldPattern = new RegExp(`\\{\\{${inputKey}\\.([^}]+)\\}\\}`, 'g');
        template = template.replace(fieldPattern, (_match: string, field: string) => {
          // {{data.field}} → {{step5_1.data.field}}
          const baseRef = resolvedRef.replace(/\}\}$/, '');
          return `${baseRef}.${field}}}`;
        });
      }
      mapping['template'] = template;
    }

    // Phase 5 Fix: Expand unresolved table-row placeholders using columns config
    // When a format step has columns config + data input, any unresolved simple placeholder
    // (like {{rows}}, {{table_rows}}, {{items_html}}) is assumed to be a table row directive
    // and expanded to Handlebars iteration at build time
    const columnsInput = inputs['columns'];
    const hasColumnsConfig = columnsInput?.source === 'constant' && Array.isArray(columnsInput.value);
    const dataRef = inputKeyToResolved['data'];

    if (hasColumnsConfig && dataRef && typeof mapping['template'] === 'string') {
      const columns: string[] = columnsInput.value;

      // Find simple placeholders that aren't step refs, loop vars, or special prefixes
      const simplePlaceholderPattern = /\{\{([a-z_][a-z0-9_]*)\}\}/gi;
      const knownPrefixes = ['step', 'input', 'var', 'item', 'this', 'each', 'if', 'unless', 'else', 'with', 'lookup'];

      let match;
      const templateStr = mapping['template'] as string;
      while ((match = simplePlaceholderPattern.exec(templateStr)) !== null) {
        const placeholder = match[1].toLowerCase();
        const isKnown = knownPrefixes.some(prefix => placeholder.startsWith(prefix) || placeholder === prefix);

        if (!isKnown && !inputKeyToResolved[placeholder]) {
          // This is an unresolved simple placeholder - expand it to row iteration
          const cellsHtml = columns.map(col => `<td>{{${col}}}</td>`).join('');
          const rowTemplate = `<tr>${cellsHtml}</tr>`;
          const dataPath = dataRef.replace(/^\{\{|\}\}$/g, '');
          const expandedRows = `{{#each ${dataPath}}}${rowTemplate}{{/each}}`;

          mapping['template'] = (mapping['template'] as string).replace(match[0], expandedRows);

          this.addWarning(
            stepId,
            'template_expanded',
            `Expanded {{${match[1]}}} placeholder to Handlebars iteration using ${columns.length} columns`,
            { placeholder: match[1], columns, expandedTo: this.truncate(expandedRows, 200) }
          );
          break; // Only expand the first unresolved placeholder
        }
      }
    }

    // Detect JSON templates and add json_escape flag for proper value escaping
    // JSON templates: start with { or [ and contain step references
    if (typeof template === 'string') {
      const trimmed = template.trim();
      const looksLikeJson = (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
                           (trimmed.startsWith('[') && trimmed.endsWith(']'));
      const hasStepRefs = /\{\{step\d+/.test(template);

      if (looksLikeJson && hasStepRefs) {
        // Mark this as a JSON template - the executor should JSON-escape interpolated values
        mapping['json_escape'] = true;

        // Also add a warning about potential escaping issues
        this.addWarning(
          stepId,
          'json_template',
          'Format template produces JSON with step references - values will be JSON-escaped at runtime',
          { template: this.truncate(template, 100) }
        );
      }
    }

    // Phase 5: Extract structured output schema from output declarations
    // When the output declares structured fields (e.g., { content: { subject: "string", html_body: "string" } }),
    // embed the output_schema in the config so the runtime knows the expected structure
    const outputSchema = this.extractStructuredOutputSchema(outputs);
    if (outputSchema) {
      mapping['output_schema'] = outputSchema;
    }

    return { mapping };
  }

  /**
   * Extract structured output schema from Phase 4 output declarations
   * Returns the schema if outputs contain nested object declarations, null otherwise
   */
  private extractStructuredOutputSchema(outputs?: Record<string, any>): Record<string, string> | null {
    if (!outputs) return null;

    // Find the first non-metadata output key that has a structured declaration
    for (const [key, value] of Object.entries(outputs)) {
      // Skip metadata keys
      if (key === 'next_step' || key === 'is_last_step') continue;

      // Check if the value is a structured declaration (object with field types)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Check if it looks like a type schema (has string values representing types)
        const isTypeSchema = Object.values(value).every(v =>
          typeof v === 'string' && ['string', 'integer', 'number', 'boolean', 'object', 'array', 'any'].includes(v as string)
        );

        if (isTypeSchema && Object.keys(value).length > 0) {
          return value as Record<string, string>;
        }
      }
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Control Step Builders
  // --------------------------------------------------------------------------

  /**
   * Build ScatterGatherStep from for_each control
   */
  private buildScatterGatherStep(step: ControlStep): ScatterGatherStep {
    const nestedSteps = (step.steps || []).map(s => this.convertStep(s));
    const control = step.control;

    if (!control) {
      throw new Error(`Control step ${step.id} is missing control configuration`);
    }

    if (!control.collection_ref) {
      throw new Error(`Control step ${step.id} (for_each) is missing collection_ref`);
    }

    // Resolve the scatter input using the same logic as other step inputs
    // collection_ref is like "step7.to_log" - need to resolve to actual data path
    const scatterInput = this.resolveScatterInput(control.collection_ref);

    return {
      id: step.id,
      type: 'scatter_gather',
      name: this.truncate(step.description, 100),
      description: step.description,
      scatter: {
        input: scatterInput,
        itemVariable: control.item_name,
        steps: nestedSteps
      },
      gather: {
        operation: 'collect',
        outputKey: step.id
      }
    };
  }

  /**
   * Resolve scatter input reference to actual data path
   *
   * collection_ref format: "stepId.outputKey" (e.g., "step7.to_log")
   *
   * For ai_processing steps: returns {{stepId.data.outputKey}}
   * For filter transforms: returns {{stepId.data.items}}
   * For map transforms: returns {{stepId.data}}
   * For action steps: returns {{stepId.data.outputKey}}
   */
  private resolveScatterInput(collectionRef: string): string {
    // Parse the collection reference (e.g., "step7.to_log")
    const parts = collectionRef.split('.');
    if (parts.length < 2) {
      // Simple reference without field - wrap as-is
      return `{{${collectionRef}}}`;
    }

    const stepId = parts[0];
    const fieldName = parts.slice(1).join('.');

    // Use resolveInput with from_step source type
    return this.resolveInput({
      source: 'from_step',
      ref: collectionRef
    });
  }

  /**
   * Build ConditionalStep from if control
   */
  private buildConditionalStep(step: ControlStep): ConditionalStep {
    const thenSteps = (step.steps || []).map(s => this.convertStep(s));
    const elseSteps = (step.else_steps || []).map(s => this.convertStep(s));
    const control = step.control;

    return {
      id: step.id,
      type: 'conditional',
      name: this.truncate(step.description, 100),
      description: step.description,
      condition: this.parseCondition(control?.condition),
      then_steps: thenSteps,
      else_steps: elseSteps.length > 0 ? elseSteps : undefined
    };
  }

  // --------------------------------------------------------------------------
  // Input Resolution
  // --------------------------------------------------------------------------

  /**
   * Find an input by exact key match or suffix pattern
   * Supports: field|*_field|*_column, value|*_value, collection|*_collection|*_list|*_items
   * Returns { input, matchedKey, usedFallback }
   */
  private findInputByPattern(
    inputs: Record<string, StepInput>,
    exactKeys: string[],
    suffixes: string[]
  ): { input: StepInput | undefined; matchedKey: string | undefined; usedFallback: boolean } {
    // 1. Try exact matches first (priority order)
    for (const key of exactKeys) {
      if (inputs[key]) {
        return { input: inputs[key], matchedKey: key, usedFallback: false };
      }
    }

    // 2. Fallback to suffix matching
    for (const key of Object.keys(inputs)) {
      for (const suffix of suffixes) {
        if (key.endsWith(suffix)) {
          return { input: inputs[key], matchedKey: key, usedFallback: true };
        }
      }
    }

    return { input: undefined, matchedKey: undefined, usedFallback: false };
  }

  /**
   * Find field/column input with fallback to suffix matching
   */
  private findFieldInput(inputs: Record<string, StepInput>, stepId?: string): StepInput | undefined {
    const result = this.findInputByPattern(
      inputs,
      ['field', 'column'],
      ['_field', '_column']
    );

    if (result.usedFallback && stepId) {
      this.addWarning(
        stepId,
        'fallback_used',
        `Field input found via suffix matching: '${result.matchedKey}' (expected 'field' or 'column')`,
        { matchedKey: result.matchedKey, expectedKeys: ['field', 'column'] }
      );
      this.stats.fallbacksUsed++;
    }

    return result.input;
  }

  /**
   * Find value input with fallback to suffix matching
   */
  private findValueInput(inputs: Record<string, StepInput>, stepId?: string): StepInput | undefined {
    const result = this.findInputByPattern(
      inputs,
      ['value'],
      ['_value']
    );

    if (result.usedFallback && stepId) {
      this.addWarning(
        stepId,
        'fallback_used',
        `Value input found via suffix matching: '${result.matchedKey}' (expected 'value')`,
        { matchedKey: result.matchedKey, expectedKeys: ['value'] }
      );
      this.stats.fallbacksUsed++;
    }

    return result.input;
  }

  /**
   * Find collection/data input with fallback to suffix matching
   */
  private findCollectionInput(inputs: Record<string, StepInput>, stepId?: string): StepInput | undefined {
    const result = this.findInputByPattern(
      inputs,
      ['collection', 'data', 'items', 'list', 'input'],
      ['_collection', '_list', '_items', '_data', '_leads', '_records', '_rows']
    );

    if (result.usedFallback && stepId) {
      this.addWarning(
        stepId,
        'fallback_used',
        `Collection input found via suffix matching: '${result.matchedKey}'`,
        { matchedKey: result.matchedKey, expectedKeys: ['collection', 'data', 'items', 'list', 'input'] }
      );
      this.stats.fallbacksUsed++;
    }

    return result.input;
  }

  /**
   * Resolve all inputs to their runtime values
   */
  private resolveInputs(inputs: Record<string, StepInput>): Record<string, any> {
    const resolved: Record<string, any> = {};

    for (const [key, input] of Object.entries(inputs)) {
      resolved[key] = this.resolveInput(input);
    }

    return resolved;
  }

  /**
   * Resolve a single StepInput based on its source
   *
   * Uses step registry for smart reference resolution:
   * - action steps: {{stepX.data.fieldName}} (executor stores result.fieldName in data)
   * - map transforms: {{stepX.data}} (executor stores raw array in data)
   * - filter transforms: {{stepX.data.fieldName}} (uses declared output key from Phase 4)
   * - ai_processing: {{stepX.data.fieldName}} (uses declared output key from technical workflow)
   */
  private resolveInput(input: StepInput | undefined): any {
    if (!input) return undefined;

    switch (input.source) {
      case 'constant':
        return input.value;
      case 'from_step':
        // Smart reference resolution based on source step type
        const ref = input.ref || '';

        // Check if it's a step reference (e.g., "step2.normalized_emails")
        const stepMatch = ref.match(/^(step\d+(_\d+)?)\.(.*)/);
        if (stepMatch) {
          const [, stepId, , fieldName] = stepMatch;
          const stepInfo = this.stepRegistry.get(stepId);

          if (stepInfo) {
            // Determine the correct data path based on step type
            if (stepInfo.kind === 'transform') {
              const operation = stepInfo.operation || stepInfo.type;

              if (operation === 'map') {
                // Map transforms wrap output under declared key (e.g., { rows: [[...]] })
                // If there's a single declared output key, auto-append it
                // E.g., step5 with outputs: { rows: "string[][]" } → "{{step5.data.rows}}"
                const outputKeys = stepInfo.outputKeys || [];
                if (outputKeys.length === 1) {
                  return `{{${stepId}.data.${outputKeys[0]}}}`;
                }
                // Fallback: if fieldName provided and not generic, use it
                if (fieldName && fieldName !== 'data') {
                  return `{{${stepId}.data.${fieldName}}}`;
                }
                return `{{${stepId}.data}}`;
              }

              if (operation === 'filter') {
                // Filter transforms store output using the declared key from Phase 4
                // E.g., step4.action_rows → {{step4.data.action_rows}}
                return `{{${stepId}.data.${fieldName}}}`;
              }

              if (operation === 'aggregate') {
                // Aggregate transforms return results directly at .data level
                // E.g., { to_log_count: 0 } is stored at step9.data, not step9.data.run_summary
                return `{{${stepId}.data}}`;
              }

              if (operation === 'ai_processing' || stepInfo.type === 'ai_processing') {
                // Transform that fell back to ai_processing
                // Use the declared output key name from the technical workflow
                // (e.g., step2.threads → {{step2.data.threads}})
                return `{{${stepId}.data.${fieldName}}}`;
              }

              // Other transforms (sort, etc.) - keep field name
              return `{{${stepId}.data.${fieldName}}}`;
            }

            // Phase 5 Fix: Handle control/conditional step references
            // Conditional steps use 'lastBranchOutput' to reference the output from whichever branch executed
            if (stepInfo.kind === 'control') {
              // For conditional steps, preserve the full path including lastBranchOutput
              // The executor will resolve this at runtime based on which branch was taken
              // E.g., step5.lastBranchOutput.content → {{step5.data.lastBranchOutput.content}}
              return `{{${stepId}.data.${fieldName}}}`;
            }

            // Native ai_processing steps (not fallback) - keep field name
            if (stepInfo.type === 'ai_processing') {
              return `{{${stepId}.data.${fieldName}}}`;
            }

            // action steps - keep field name
            return `{{${stepId}.data.${fieldName}}}`;
          }

          // Step not in registry (shouldn't happen) - use safe default with field name
          return `{{${stepId}.data.${fieldName}}}`;
        }

        // Check for simple step reference without field (e.g., "step2")
        if (ref.match(/^step\d+(_\d+)?$/)) {
          return `{{${ref}.data}}`;
        }

        // Loop variables like "email.body" - preserve as-is
        return `{{${ref}}}`;

      case 'user_input':
        return `{{input.${input.key}}}`;
      case 'env':
        return `{{env.${input.key}}}`;
      case 'plugin_config':
        return `{{config.${input.plugin}.${input.key}}}`;
      default:
        return (input as any).value;
    }
  }

  /**
   * Find the primary input (usually the collection/data being processed)
   */
  private findPrimaryInput(inputs: Record<string, StepInput>, stepId?: string): string {
    // 1. Use pattern matching to find collection input
    const collectionInput = this.findCollectionInput(inputs, stepId);
    if (collectionInput) {
      return this.resolveInput(collectionInput);
    }

    // 2. Try domain-specific exact keys
    const domainKeys = [
      'leads', 'emails', 'values', 'rows', 'records', 'entries',
      'high_qualified_leads', 'normalized_leads', 'filtered_leads'
    ];
    for (const key of domainKeys) {
      if (inputs[key]) {
        if (stepId) {
          this.addWarning(
            stepId,
            'fallback_used',
            `Primary input found via domain-specific key: '${key}'`,
            { matchedKey: key }
          );
          this.stats.fallbacksUsed++;
        }
        return this.resolveInput(inputs[key]);
      }
    }

    // 3. Fallback: find first from_step input
    for (const [key, input] of Object.entries(inputs)) {
      if (input.source === 'from_step') {
        if (stepId) {
          this.addWarning(
            stepId,
            'fallback_used',
            `Primary input found via first from_step reference: '${key}'`,
            { matchedKey: key }
          );
          this.stats.fallbacksUsed++;
        }
        return this.resolveInput(input);
      }
    }

    // 4. For format transforms: extract first step reference from template constant
    // This handles cases where the template uses inline {{stepX.data.Y}} references
    // or Handlebars block helpers like {{#each stepX.data.Y}}
    // instead of a separate 'data' input
    const templateInput = inputs['template'];
    if (templateInput?.source === 'constant' && typeof templateInput.value === 'string') {
      // Match both direct refs {{step4.data.X}} and block helpers {{#each step4.data.X}}
      const stepRefMatch = templateInput.value.match(/\{\{#?(?:each\s+)?(step\d+(?:_\d+)?\.data\.[^\s}]+)\}\}/);
      if (stepRefMatch) {
        const firstRef = stepRefMatch[1];
        // Extract just the step.data.outputKey part (not nested properties)
        const refParts = firstRef.split('.');
        const primaryRef = refParts.slice(0, 3).join('.'); // step4.data.buckets
        if (stepId) {
          this.addWarning(
            stepId,
            'fallback_used',
            `Primary input extracted from template reference: '${primaryRef}'`,
            { fullRef: firstRef, extractedRef: primaryRef }
          );
          this.stats.fallbacksUsed++;
        }
        return `{{${primaryRef}}}`;
      }
    }

    // 5. No primary input found
    if (stepId) {
      this.addWarning(
        stepId,
        'missing_input',
        'No primary input found for step',
        { availableInputs: Object.keys(inputs) }
      );
    }

    return '';
  }

  // --------------------------------------------------------------------------
  // Condition Parsing
  // --------------------------------------------------------------------------

  /**
   * Parse condition string into structured Condition object
   * Uses smart reference resolution to add proper .data. prefix for step references
   */
  private parseCondition(conditionStr: string | undefined): Condition {
    if (!conditionStr) {
      return { conditionType: 'simple', field: '', operator: 'exists', value: true };
    }

    // Pattern: ref.length > 0 or ref.length == 0
    const lengthMatch = conditionStr.match(/^(.+)\.length\s*(>|==|>=|<|<=|!=)\s*(\d+)$/);
    if (lengthMatch) {
      const [, ref, op, num] = lengthMatch;
      // Use smart reference resolution for the field
      const resolvedField = this.resolveConditionFieldRef(ref);
      if (op === '>' && num === '0') {
        return { conditionType: 'simple', field: resolvedField, operator: 'is_not_empty', value: '' };
      }
      if ((op === '==' || op === '===') && num === '0') {
        return { conditionType: 'simple', field: resolvedField, operator: 'is_empty', value: '' };
      }
    }

    // Pattern: ref == 'value' or ref == value
    const equalsMatch = conditionStr.match(/^(.+?)\s*(==|===|!=|!==)\s*['"]?(.+?)['"]?$/);
    if (equalsMatch) {
      const [, field, op, value] = equalsMatch;
      const resolvedField = this.resolveConditionFieldRef(field.trim());
      return {
        conditionType: 'simple',
        field: resolvedField,
        operator: op.includes('!') ? 'not_equals' : 'equals',
        value: this.parseValue(value)
      };
    }

    // Pattern: ref > N, ref >= N, ref < N, ref <= N
    const comparisonMatch = conditionStr.match(/^(.+?)\s*(>=|<=|>|<)\s*(.+)$/);
    if (comparisonMatch) {
      const [, field, op, value] = comparisonMatch;
      const resolvedField = this.resolveConditionFieldRef(field.trim());
      const operatorMap: Record<string, string> = {
        '>': 'greater_than',
        '>=': 'greater_than_or_equal',
        '<': 'less_than',
        '<=': 'less_than_or_equal'
      };
      return {
        conditionType: 'simple',
        field: resolvedField,
        operator: operatorMap[op] as ComparisonOperator,
        value: this.parseValue(value)
      };
    }

    // Fallback: treat as field exists check
    const resolvedField = this.resolveConditionFieldRef(conditionStr);
    return {
      conditionType: 'simple',
      field: resolvedField,
      operator: 'exists',
      value: true
    };
  }

  /**
   * Resolve a condition field reference using smart step resolution
   * Converts "step4.action_rows" to "{{step4.data.action_rows}}"
   */
  private resolveConditionFieldRef(ref: string): string {
    // Check if it's a step reference (e.g., "step4.action_rows")
    const stepMatch = ref.match(/^(step\d+(_\d+)?)\.(.*)/);
    if (stepMatch) {
      // Use resolveInput to get proper path with .data. prefix
      const resolved = this.resolveInput({ source: 'from_step', ref });
      if (typeof resolved === 'string') {
        return resolved;
      }
    }
    // Not a step reference, wrap as-is
    return `{{${ref}}}`;
  }

  private parseValue(value: string): any {
    const trimmed = value.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    const num = Number(trimmed);
    if (!isNaN(num)) return num;
    return trimmed;
  }

  // --------------------------------------------------------------------------
  // Required Inputs Conversion
  // --------------------------------------------------------------------------

  /**
   * Convert Phase 4 technical_inputs_required to PILOT DSL InputFields
   * Also auto-extracts any {{input.*}} references not already declared
   */
  private convertRequiredInputs(inputs: TechnicalInputRequired[], workflowSteps: WorkflowStep[]): InputField[] {
    // Start with declared inputs
    const declaredInputs = inputs.map(input => ({
      name: input.key,
      type: this.inferInputType(input.key),
      label: this.generateLabel(input.key),
      required: true,
      description: input.description || '',
      placeholder: `Enter ${input.key.replace(/_/g, ' ')}`,
      reasoning: input.plugin ? `Required by ${input.plugin} plugin` : 'Required input'
    }));

    // Extract {{input.*}} references from workflow steps
    const extractedKeys = this.extractInputReferences(workflowSteps);
    const declaredKeys = new Set(declaredInputs.map(i => i.name));

    // Add any undeclared inputs found in workflow
    const autoExtractedInputs: InputField[] = [];
    for (const key of Array.from(extractedKeys)) {
      if (!declaredKeys.has(key)) {
        autoExtractedInputs.push({
          name: key,
          type: this.inferInputType(key),
          label: this.generateLabel(key),
          required: true,
          description: `Auto-extracted from workflow references`,
          placeholder: `Enter ${key.replace(/_/g, ' ')}`,
          reasoning: 'Auto-detected from {{input.*}} reference in workflow'
        });
        this.addWarning(
          'global',
          'missing_input',
          `Input '${key}' referenced in workflow but not declared in technical_inputs_required`,
          { key, source: 'auto-extracted' }
        );
      }
    }

    return [...declaredInputs, ...autoExtractedInputs];
  }

  /**
   * Recursively extract all {{input.*}} references from workflow steps
   */
  private extractInputReferences(steps: WorkflowStep[]): Set<string> {
    const inputRefs = new Set<string>();
    const inputPattern = /\{\{input\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

    const scanValue = (value: any): void => {
      if (typeof value === 'string') {
        let match;
        while ((match = inputPattern.exec(value)) !== null) {
          inputRefs.add(match[1]);
        }
        // Reset regex state
        inputPattern.lastIndex = 0;
      } else if (Array.isArray(value)) {
        value.forEach(scanValue);
      } else if (value && typeof value === 'object') {
        Object.values(value).forEach(scanValue);
      }
    };

    const scanStep = (step: WorkflowStep): void => {
      // Scan params for action steps
      if (step.type === 'action') {
        scanValue((step as ActionStep).params);
      }
      // Scan config for transform steps
      if (step.type === 'transform') {
        scanValue((step as PilotTransformStep).config);
        scanValue((step as PilotTransformStep).input);
      }
      // Scan params for ai_processing steps
      if (step.type === 'ai_processing') {
        scanValue((step as AIProcessingStep).params);
      }
      // Scan nested steps in scatter_gather
      if (step.type === 'scatter_gather') {
        const sg = step as ScatterGatherStep;
        scanValue(sg.scatter.input);
        if (sg.scatter.steps) {
          sg.scatter.steps.forEach(scanStep);
        }
      }
      // Scan nested steps in conditional
      if (step.type === 'conditional') {
        const cond = step as ConditionalStep;
        if (cond.then_steps) {
          cond.then_steps.forEach(scanStep);
        }
        if (cond.else_steps) {
          cond.else_steps.forEach(scanStep);
        }
      }
    };

    steps.forEach(scanStep);
    return inputRefs;
  }

  private inferInputType(key: string): InputField['type'] {
    const lower = key.toLowerCase();
    if (lower.includes('email')) return 'email';
    if (lower.includes('url') || lower.includes('link')) return 'url';
    if (lower.includes('date') || lower.includes('time')) return 'date';
    if (lower.includes('number') || lower.includes('count') || lower.includes('amount')) return 'number';
    if (lower.includes('message') || lower.includes('description') || lower.includes('content')) return 'textarea';
    return 'text';
  }

  private generateLabel(key: string): string {
    return key
      .split(/[_-]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // --------------------------------------------------------------------------
  // Step Output Contracts
  // --------------------------------------------------------------------------

  /**
   * Build output definitions for a step based on Phase4 outputs and operation type
   * Provides explicit output contracts to eliminate heuristic inference
   *
   * Phase 5 Enhancement: For split transforms, generates explicit bucket keys
   * instead of generic "object" output.
   */
  private buildStepOutputs(
    phase4Outputs: Record<string, any> | undefined,
    stepId: string,
    stepType: 'action' | 'transform' | 'ai_processing',
    operation?: string,
    splitBucketKeys?: string[]  // Phase 5: Explicit bucket keys for split transforms
  ): Record<string, { type: string; description?: string }> | undefined {
    if (!phase4Outputs) return undefined;

    const outputs: Record<string, { type: string; description?: string }> = {};

    // Get the contract for this operation type
    const contract = operation ? TRANSFORM_OUTPUT_CONTRACTS[operation] : undefined;

    for (const [key, typeOrValue] of Object.entries(phase4Outputs)) {
      // Skip routing fields (next_step, iteration_next_step, etc.)
      if (key === 'next_step' || key.includes('next_step')) continue;

      // Determine the type
      let outputType = 'any';
      let description: string | undefined;

      if (typeof typeOrValue === 'string') {
        // Phase4 outputs use type strings like "string[][]", "object[]", "string"
        outputType = typeOrValue;
      }

      // Apply contract-based type if available
      if (contract) {
        // For group operation, items output gets the contract shape
        if (operation === 'group' && key.includes('grouped')) {
          outputType = contract.shape;
          description = contract.description;
        }
        // For filter, the output array uses the contract
        else if (operation === 'filter') {
          outputType = contract.shape;
          description = contract.description;
        }
        // For split/partition, apply the partition contract
        else if (operation === 'map' && (key.includes('with_') || key.includes('missing_'))) {
          outputType = 'T[]';
          description = 'Partitioned array subset';
        }
      }

      // Phase 5: For split transforms with explicit bucket keys, expand the output type
      if (splitBucketKeys && splitBucketKeys.length > 0) {
        outputType = `{ ${splitBucketKeys.map(k => `${k}: T[]`).join(', ')} }`;
        description = `Split buckets: ${splitBucketKeys.join(', ')}`;
      }

      outputs[key] = { type: outputType, ...(description && { description }) };
    }

    // Phase 5: Add explicit bucket keys as sub-outputs for downstream reference validation
    if (splitBucketKeys && splitBucketKeys.length > 0) {
      for (const bucketKey of splitBucketKeys) {
        if (!outputs[bucketKey]) {
          outputs[bucketKey] = { type: 'T[]', description: `Items in "${bucketKey}" bucket` };
        }
      }
    }

    // Only return if we have meaningful outputs
    return Object.keys(outputs).length > 0 ? outputs : undefined;
  }

  // --------------------------------------------------------------------------
  // Workflow Type Determination
  // --------------------------------------------------------------------------

  private determineWorkflowType(steps: WorkflowStep[]): 'pure_ai' | 'data_retrieval_ai' | 'ai_external_actions' {
    const hasAction = steps.some(s => s.type === 'action');
    const hasAIProcessing = steps.some(s => s.type === 'ai_processing');
    const hasTransform = steps.some(s => s.type === 'transform');

    // Type for accumulator in nested checks
    type StepFlags = { hasAction: boolean; hasAI: boolean };

    // Check nested steps in scatter_gather and conditional
    const checkNested = (step: WorkflowStep): StepFlags => {
      if (step.type === 'scatter_gather') {
        const nested = (step as ScatterGatherStep).scatter.steps || [];
        return nested.reduce<StepFlags>((acc, s) => {
          const result = checkNested(s);
          return { hasAction: acc.hasAction || result.hasAction, hasAI: acc.hasAI || result.hasAI };
        }, { hasAction: false, hasAI: false });
      }
      if (step.type === 'conditional') {
        const thenSteps = (step as ConditionalStep).then_steps || [];
        const elseSteps = (step as ConditionalStep).else_steps || [];
        const allNested = [...thenSteps, ...elseSteps];
        return allNested.reduce<StepFlags>((acc, s) => {
          const result = checkNested(s);
          return { hasAction: acc.hasAction || result.hasAction, hasAI: acc.hasAI || result.hasAI };
        }, { hasAction: false, hasAI: false });
      }
      return { hasAction: step.type === 'action', hasAI: step.type === 'ai_processing' };
    };

    const nestedCheck = steps.reduce<StepFlags>((acc, s) => {
      const result = checkNested(s);
      return { hasAction: acc.hasAction || result.hasAction, hasAI: acc.hasAI || result.hasAI };
    }, { hasAction: hasAction, hasAI: hasAIProcessing });

    if (nestedCheck.hasAction && nestedCheck.hasAI) return 'ai_external_actions';
    if (nestedCheck.hasAction) return 'ai_external_actions';
    if (nestedCheck.hasAI) return 'data_retrieval_ai';
    if (hasTransform) return 'pure_ai';
    return 'pure_ai';
  }

  // --------------------------------------------------------------------------
  // Helper Methods
  // --------------------------------------------------------------------------

  private isLLMTransformType(type: string): boolean {
    return type?.endsWith('_with_llm') || (LLM_TRANSFORM_TYPES as readonly string[]).includes(type);
  }

  private inferTransformType(description: string): string {
    const lower = (description || '').toLowerCase();

    // Deterministic patterns
    if (lower.includes('filter') || lower.includes('remove') || lower.includes('keep only')) return 'filter';
    if (lower.includes('sort') || lower.includes('order by')) return 'sort';
    if (lower.includes('group by') || lower.includes('group ')) return 'group_by';
    if (lower.includes('aggregate') || lower.includes('sum') || lower.includes('count') || lower.includes('average')) return 'aggregate';
    if (lower.includes('deduplicate') || lower.includes('remove duplicate')) return 'deduplicate';
    if (lower.includes('flatten')) return 'flatten';
    if (lower.includes('format') || lower.includes('build html') || lower.includes('render')) return 'format';
    if (lower.includes('convert') || lower.includes('reshape') || lower.includes('transform')) return 'map';
    if (lower.includes('merge') || lower.includes('combine')) return 'merge';
    if (lower.includes('split') || lower.includes('partition')) return 'split';
    if (lower.includes('pick') || lower.includes('select field')) return 'pick_fields';

    // LLM patterns
    if (lower.includes('summarize') || lower.includes('summary')) return 'summarize_with_llm';
    if (lower.includes('classify') || lower.includes('categorize')) return 'classify_with_llm';
    if (lower.includes('extract')) return 'extract_with_llm';
    if (lower.includes('analyze') || lower.includes('analysis')) return 'analyze_with_llm';
    if (lower.includes('generate')) return 'generate_with_llm';
    if (lower.includes('translate')) return 'translate_with_llm';
    if (lower.includes('enrich')) return 'enrich_with_llm';

    // Default to ai_processing (safer fallback)
    return 'summarize_with_llm';
  }

  private normalizeOperator(operator: string): ComparisonOperator {
    const operatorMap: Record<string, ComparisonOperator> = {
      '==': 'equals',
      '===': 'equals',
      '!=': 'not_equals',
      '!==': 'not_equals',
      '>': 'greater_than',
      '>=': 'greater_than_or_equal',
      '<': 'less_than',
      '<=': 'less_than_or_equal',
      'contains': 'contains',
      'not_contains': 'not_contains',
      'in': 'in',
      'not_in': 'not_in',
      'exists': 'exists',
      'not_exists': 'not_exists',
      'is_empty': 'is_empty',
      'is_not_empty': 'is_not_empty',
      'matches': 'matches',
      'starts_with': 'starts_with',
      'ends_with': 'ends_with',
      'equals': 'equals',
      'not_equals': 'not_equals',
      'greater_than': 'greater_than',
      'greater_than_or_equal': 'greater_than_or_equal',
      'less_than': 'less_than',
      'less_than_or_equal': 'less_than_or_equal'
    };
    return operatorMap[operator] || 'equals';
  }

  private truncate(str: string | undefined, maxLength: number): string {
    if (!str) return '';
    return str.length > maxLength ? str.slice(0, maxLength - 3) + '...' : str;
  }

  private generateDefaultOutputs(): PILOT_DSL_SCHEMA['suggested_outputs'] {
    return [{
      name: 'workflow_result',
      type: 'SummaryBlock',
      category: 'human-facing',
      description: 'Result of workflow execution',
      format: 'markdown',
      reasoning: 'Primary output showing workflow results'
    }];
  }

  private generateReasoning(steps: WorkflowStep[]): string {
    const typeCounts: Record<string, number> = {};

    const countTypes = (stepList: WorkflowStep[]) => {
      for (const step of stepList) {
        typeCounts[step.type] = (typeCounts[step.type] || 0) + 1;
        if (step.type === 'scatter_gather') {
          countTypes((step as ScatterGatherStep).scatter.steps || []);
        }
        if (step.type === 'conditional') {
          countTypes((step as ConditionalStep).then_steps || []);
          countTypes((step as ConditionalStep).else_steps || []);
        }
      }
    };

    countTypes(steps);

    const parts = Object.entries(typeCounts).map(([type, count]) => `${count} ${type}`);
    return `Generated workflow from technical workflow with ${steps.length} top-level steps (${parts.join(', ')}).`;
  }

  // --------------------------------------------------------------------------
  // Phase 5: Schema-Driven Action Parameter Validation
  // --------------------------------------------------------------------------

  /**
   * Validate and fix action step parameters against plugin schemas.
   *
   * When a format step's output feeds into an action parameter that expects
   * an object structure, this method wraps the format template to produce
   * the correct structure.
   *
   * Example: send_email expects content: {subject, html_body}
   * If format step produces raw HTML string, wrap it as:
   * {"subject": "Agent Name", "html_body": "<raw template>"}
   */
  private async validateAndFixActionParams(steps: WorkflowStep[], agentName?: string): Promise<WorkflowStep[]> {
    // Build step map for lookups
    const stepMap = new Map<string, WorkflowStep>();
    const collectSteps = (stepList: WorkflowStep[]) => {
      for (const step of stepList) {
        stepMap.set(step.id, step);
        if (step.type === 'conditional') {
          const condStep = step as ConditionalStep;
          collectSteps(condStep.then_steps || []);
          collectSteps(condStep.else_steps || []);
        }
        if (step.type === 'scatter_gather') {
          const sgStep = step as ScatterGatherStep;
          collectSteps(sgStep.scatter.steps || []);
        }
      }
    };
    collectSteps(steps);

    // Phase 5E-1: Fix format steps that are meant to join array outputs
    // This must happen before action param validation, as it fixes the intermediate
    // format steps that feed into the final format step that builds email content
    this.fixArrayJoinFormatSteps(steps, stepMap);

    // Get plugin manager instance once
    const pluginManager = await PluginManagerV2.getInstance();

    // Phase 5E-2: Process all action steps and validate params against plugin schemas
    const processSteps = (stepList: WorkflowStep[]): WorkflowStep[] => {
      return stepList.map(step => {
        if (step.type === 'action') {
          this.validateActionStepParams(step as ActionStep, stepMap, agentName, pluginManager);
        }
        if (step.type === 'conditional') {
          const condStep = step as ConditionalStep;
          return {
            ...condStep,
            then_steps: processSteps(condStep.then_steps || []),
            else_steps: processSteps(condStep.else_steps || [])
          };
        }
        if (step.type === 'scatter_gather') {
          const sgStep = step as ScatterGatherStep;
          return {
            ...sgStep,
            scatter: {
              ...sgStep.scatter,
              steps: processSteps(sgStep.scatter.steps || [])
            }
          };
        }
        return step;
      });
    };

    return processSteps(steps);
  }

  /**
   * Validate a single action step's parameters against plugin schema
   */
  private validateActionStepParams(
    actionStep: ActionStep,
    stepMap: Map<string, WorkflowStep>,
    agentName: string | undefined,
    pluginManager: PluginManagerV2
  ): void {
    if (!actionStep.plugin || !actionStep.action || !actionStep.params) return;

    // Get plugin action schema
    const actionDef = pluginManager.getActionDefinition(actionStep.plugin, actionStep.action);
    if (!actionDef?.parameters?.properties) return;

    // Check each param that references another step
    for (const [paramName, paramValue] of Object.entries(actionStep.params)) {
      if (typeof paramValue !== 'string') continue;

      // Check if it's a step reference like {{stepX.data.content}}
      const refMatch = paramValue.match(/^\{\{(step[\w_]+)\.data\.(\w+)\}\}$/);
      if (!refMatch) continue;

      const [, sourceStepId, outputKey] = refMatch;
      const sourceStep = stepMap.get(sourceStepId);

      // Only process format transform steps
      if (!sourceStep || sourceStep.type !== 'transform') continue;
      const transformStep = sourceStep as PilotTransformStep;
      if (transformStep.operation !== 'format') continue;

      // Get expected param schema
      const paramSchema = actionDef.parameters.properties[paramName];
      if (!paramSchema || paramSchema.type !== 'object') continue;

      // Check if format step produces string but param expects object
      const mapping = transformStep.config?.mapping || transformStep.config || {};
      const template = mapping.template;
      if (typeof template !== 'string') continue;

      // If template doesn't start with { it produces a string, not JSON
      const trimmedTemplate = template.trim();
      if (!trimmedTemplate.startsWith('{')) {
        this.wrapFormatStepForSchema(transformStep, paramSchema, paramName, agentName);
      }
    }
  }

  /**
   * Wrap a format step's string template to match expected object schema.
   *
   * Transforms a raw template string into a JSON template that produces
   * the expected object structure for the action parameter.
   */
  private wrapFormatStepForSchema(
    formatStep: PilotTransformStep,
    paramSchema: any,
    paramName: string,
    agentName?: string
  ): void {
    const properties = paramSchema.properties || {};
    const required = paramSchema.required || [];
    const mapping = formatStep.config?.mapping || formatStep.config || {};
    const originalTemplate = mapping.template;

    if (typeof originalTemplate !== 'string') return;

    // Check if template looks like HTML (contains HTML tags)
    const looksLikeHtml = /<[a-z][\s\S]*>/i.test(originalTemplate);

    // Find body-like field, prioritizing html_body for HTML content
    const schemaKeys = Object.keys(properties).map(k => k.toLowerCase());
    let bodyField: string | undefined;

    if (looksLikeHtml && schemaKeys.includes('html_body')) {
      // HTML content should use html_body field
      bodyField = Object.keys(properties).find(k => k.toLowerCase() === 'html_body');
    } else {
      // Fall back to first matching body-like field
      bodyField = Object.keys(properties).find(k =>
        ['html_body', 'body', 'content', 'html', 'text'].includes(k.toLowerCase())
      );
    }

    // Find subject-like field
    const subjectField = Object.keys(properties).find(k =>
      ['subject', 'title', 'heading'].includes(k.toLowerCase())
    );

    // Build the wrapper object parts
    const wrapperParts: string[] = [];

    // Add subject if required and found
    if (subjectField && required.includes(subjectField)) {
      // Use agent name as subject, falling back to generic message
      const subject = agentName && agentName !== 'Untitled Agent'
        ? agentName
        : 'AgentsPilot Default Email Notification';
      wrapperParts.push(`"${subjectField}": "${this.escapeJsonString(subject)}"`);
    }

    // Add body field with the original template content
    if (bodyField) {
      // Escape the template for JSON embedding
      const escapedTemplate = this.escapeJsonString(originalTemplate);
      wrapperParts.push(`"${bodyField}": "${escapedTemplate}"`);
    }

    if (wrapperParts.length === 0) {
      // No recognizable fields to wrap, skip
      return;
    }

    // Create JSON wrapper template
    const newTemplate = `{${wrapperParts.join(', ')}}`;

    // Update format step config
    if (!formatStep.config) {
      formatStep.config = { mapping: {} };
    }
    if (!formatStep.config.mapping) {
      formatStep.config.mapping = {};
    }

    formatStep.config.mapping.template = newTemplate;
    formatStep.config.mapping.json_escape = true;

    // Change input to empty object to prevent array iteration
    // The wrapped template uses step references (e.g., {{step8.data.totals.total_open_items}}), not item fields
    // An empty object ensures transformFormat runs once (not per array item) while step refs still resolve via context
    formatStep.input = '{}';

    // Phase 5E: Update output declaration to be explicit about schema contract
    // Instead of `content: type: any`, declare exact type matching downstream action's expected input
    // This enables compile-time validation and makes the contract explicit
    const outputFields = wrapperParts.map(p => p.split(':')[0].replace(/"/g, '').trim());
    const outputTypeSchema: Record<string, string> = {};
    for (const field of outputFields) {
      // Get type from plugin schema properties
      const fieldSchema = properties[field];
      outputTypeSchema[field] = fieldSchema?.type || 'string';
    }

    // Update the format step's output declaration with explicit schema
    if (!formatStep.outputs) {
      formatStep.outputs = {};
    }
    // Find the output key that feeds into the action (typically 'content')
    const outputKey = Object.keys(formatStep.outputs)[0] || paramName;
    formatStep.outputs[outputKey] = {
      type: `{ ${outputFields.map(f => `${f}: ${outputTypeSchema[f]}`).join(', ')} }`,
      description: `Schema-validated output for ${paramName} parameter`
    };

    // Also store the output_schema in config for runtime validation
    formatStep.config.mapping.output_schema = outputTypeSchema;

    this.addWarning(
      formatStep.id,
      'format_wrapped_for_action_schema',
      `Wrapped format output to match ${paramName} schema: {${outputFields.join(', ')}}`,
      {
        paramName,
        selectedBodyField: bodyField,
        outputSchema: outputTypeSchema,
        originalTemplatePreview: originalTemplate.substring(0, 100)
      }
    );
  }

  /**
   * Escape a string for safe embedding in JSON
   */
  private escapeJsonString(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  /**
   * Phase 5E: Fix format steps that are meant to join array outputs from map steps
   *
   * Problem: Phase 4 LLM generates format steps like:
   *   input: "{{step5_1.data}}"
   *   template: "{{step5_1.data}}"
   *
   * But step5_1.data is { rows_html_list: [...] }, an object, not an array.
   * transformFormat doesn't iterate objects, so the output is wrong.
   *
   * Fix: Change to:
   *   input: "{{step5_1.data.rows_html_list}}" (the array)
   *   template: "{{item}}" (pass through each string)
   *
   * This makes transformFormat iterate the array and join with newlines.
   */
  private fixArrayJoinFormatSteps(
    steps: WorkflowStep[],
    stepMap: Map<string, WorkflowStep>
  ): void {
    const processSteps = (stepList: WorkflowStep[]): void => {
      for (const step of stepList) {
        if (step.type === 'transform') {
          const transformStep = step as PilotTransformStep;
          if (transformStep.operation === 'format') {
            this.fixArrayJoinFormat(transformStep, stepMap);
          }
        } else if (step.type === 'conditional') {
          const condStep = step as ConditionalStep;
          if (condStep.then_steps) processSteps(condStep.then_steps);
          if (condStep.else_steps) processSteps(condStep.else_steps);
        } else if (step.type === 'scatter_gather') {
          const sgStep = step as ScatterGatherStep;
          if (sgStep.scatter?.steps) processSteps(sgStep.scatter.steps);
        }
      }
    };

    processSteps(steps);
  }

  /**
   * Fix a single format step if it's meant to join array output
   */
  private fixArrayJoinFormat(
    formatStep: PilotTransformStep,
    stepMap: Map<string, WorkflowStep>
  ): void {
    const input = formatStep.input;
    const template = formatStep.config?.mapping?.template;

    if (!input || !template) return;

    // Check if input references a step's data (e.g., "{{step5_1.data}}")
    const inputMatch = input.match(/^\{\{(step[\w_]+)\.data\}\}$/);
    if (!inputMatch) return;

    const sourceStepId = inputMatch[1];
    const sourceStep = stepMap.get(sourceStepId);
    if (!sourceStep) return;

    // Check if source step is a map transform with array output
    if (sourceStep.type !== 'transform') return;
    const sourceTransform = sourceStep as PilotTransformStep;
    if (sourceTransform.operation !== 'map') return;

    // Find the output array field from the source step
    const outputs = sourceTransform.outputs;
    if (!outputs) return;

    const outputKeys = Object.keys(outputs).filter(k => k !== 'next_step');
    if (outputKeys.length !== 1) return;

    const arrayField = outputKeys[0];
    const outputType = outputs[arrayField]?.type;

    // Check if output is array type (ends with [] or is array-like)
    if (!outputType || (!outputType.endsWith('[]') && !outputType.includes('array'))) return;

    // Check if template is a passthrough (just references the source step)
    // Pattern: "{{stepX.data}}" or "{{stepX.data.field}}"
    const templateMatch = template.match(/^\{\{(step[\w_]+)\.(data(?:\.\w+)?)\}\}$/);
    if (!templateMatch) return;

    const templateStepId = templateMatch[1];
    if (templateStepId !== sourceStepId) return;

    // Fix the format step to properly join the array
    const newInput = `{{${sourceStepId}.data.${arrayField}}}`;
    const newTemplate = '{{item}}';

    formatStep.input = newInput;
    if (!formatStep.config.mapping) {
      formatStep.config.mapping = {};
    }
    formatStep.config.mapping.template = newTemplate;

    this.addWarning(
      formatStep.id,
      'format_fixed_for_array_join',
      `Fixed format step to join array: input changed to ${newInput}, template to {{item}}`,
      {
        originalInput: input,
        originalTemplate: template,
        sourceStepId,
        arrayField
      }
    );
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default Phase4DSLBuilder;
