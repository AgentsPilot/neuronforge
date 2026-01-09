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
  type: 'missing_input' | 'fallback_used' | 'type_inferred' | 'unknown_transform' | 'empty_config' | 'unsupported_feature';
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
  'deduplicate': 'filter',
  'flatten': 'map',
  'pick_fields': 'map',
  'format': 'format',  // Dedicated format operation for object-to-string formatting
  'merge': 'map',
  'split': 'map',
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
  // Maps stepId → { kind, type, operation } so resolveInput can determine correct data paths
  private stepRegistry: Map<string, { kind: string; type?: string; operation?: string }> = new Map();

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Main entry point: Convert Phase 4 response to PILOT_DSL_SCHEMA
   * Returns a result object with the workflow, warnings, errors, and stats
   */
  public build(phase4Response: Phase4Response): Phase4DSLBuilderResult {
    // Reset state for new build
    this.resetState();

    const { technical_workflow, enhanced_prompt, feasibility, technical_inputs_required, requiredServices } = phase4Response;

    // Track total steps (including nested)
    this.stats.totalSteps = this.countTotalSteps(technical_workflow);

    try {
      // Convert workflow steps
      const workflowSteps = this.convertWorkflowSteps(technical_workflow);

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
    // Store for look-ahead (finding downstream filter dependencies)
    this.workflowSteps = steps;

    // Pre-populate step registry so resolveInput knows step types during conversion
    this.populateStepRegistry(steps);

    return steps.map(step => this.convertStep(step));
  }

  /**
   * Pre-populate step registry with step metadata
   * This allows resolveInput to know step types before conversion completes
   *
   * IMPORTANT: This must predict whether a step will fall back to ai_processing
   * so that resolveInput generates the correct reference pattern.
   */
  private populateStepRegistry(steps: TechnicalWorkflowStep[]): void {
    for (const step of steps) {
      if (step.kind === 'operation') {
        const opStep = step as OperationStep;
        // Check if this is an LLM-based plugin (will become ai_processing)
        if (opStep.plugin && this.LLM_BASED_PLUGINS.includes(opStep.plugin)) {
          this.stepRegistry.set(step.id, { kind: 'operation', type: 'ai_processing' });
        } else {
          this.stepRegistry.set(step.id, { kind: 'operation', type: 'action' });
        }
      } else if (step.kind === 'transform') {
        const transformStep = step as TransformStep;
        const transformType = transformStep.type;

        // Check if this transform will fall back to ai_processing
        const willFallbackToAI = this.willTransformFallbackToAI(transformStep);

        if (willFallbackToAI) {
          // Register as ai_processing since it will fall back
          this.stepRegistry.set(step.id, { kind: 'transform', type: 'ai_processing' });
        } else {
          this.stepRegistry.set(step.id, {
            kind: 'transform',
            type: transformType,
            operation: TRANSFORM_TYPE_TO_OPERATION[transformType || ''] || transformType
          });
        }
      } else if (step.kind === 'control') {
        const controlStep = step as ControlStep;
        this.stepRegistry.set(step.id, { kind: 'control', type: controlStep.control?.type });
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
   * Predict whether a transform step will fall back to ai_processing
   * This mirrors the logic in convertTransformStep but without side effects
   */
  private willTransformFallbackToAI(step: TransformStep): boolean {
    const transformType = step.type;

    // LLM transform types always become ai_processing
    if (this.isLLMTransformType(transformType || '')) {
      return true;
    }

    // Filter with cross-step dependency field falls back
    if (transformType === 'filter') {
      const filterField = this.extractFilterField(step.inputs || {});
      if (filterField && this.isCrossStepDependencyField(filterField)) {
        return true;
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

    // For filter transforms, check if the field is a cross-step dependency
    // Cross-step filters (e.g., "not_in_logged_identifiers") require comparing against another step's output
    // These can't be executed deterministically and need ai_processing
    if (transformType === 'filter') {
      const filterField = this.extractFilterField(step.inputs || {});
      if (filterField && this.isCrossStepDependencyField(filterField)) {
        this.addWarning(
          step.id,
          'fallback_used',
          `Filter field '${filterField}' is a cross-step dependency - falling back to ai_processing`,
          { transformType, field: filterField, reason: 'cross_step_dependency' }
        );
        this.stats.fallbacksUsed++;
        return this.buildAIProcessingStep(step, transformType);
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
    return ['map', 'format', 'pick_fields', 'merge', 'split', 'convert', 'flatten', 'deduplicate'].includes(type);
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

    let hasItemReference = false;

    for (const [key, input] of Object.entries(inputs)) {
      // Skip input source keys
      if (nonConfigKeys.includes(key.toLowerCase())) continue;

      // Check if the value contains {{item.*}} references
      if (input?.source === 'constant' && input?.value !== undefined) {
        const valueStr = typeof input.value === 'string' ? input.value : JSON.stringify(input.value);

        // If it contains {{item.*}} references, it's an actual field mapping
        if (valueStr.includes('{{item.') || valueStr.includes('{{item}}')) {
          hasItemReference = true;
        }
      }

      // Template input with item references is valid
      if (key === 'template' && input?.source === 'constant') {
        const templateStr = typeof input.value === 'string' ? input.value : '';
        if (templateStr.includes('{{item.') || templateStr.includes('{{')) {
          hasItemReference = true;
        }
      }
    }

    // Only return true if we found actual item references
    // Constant-only configs (like user_domain: "gmail.com") should fall back to ai_processing
    return hasItemReference;
  }

  /**
   * Find downstream filter steps that depend on this step's output
   * and extract the computed field requirements from their conditions
   */
  private findDownstreamFieldRequirements(stepId: string): Array<{ field: string; description: string; fromStepId: string }> {
    const fields: Array<{ field: string; description: string; fromStepId: string }> = [];
    const seenFields = new Set<string>();

    // Find the output key of this step
    const currentStep = this.workflowSteps.find(s => s.id === stepId);
    if (!currentStep) return fields;

    const outputKeys = Object.keys(currentStep.outputs || {}).filter(k => k !== 'next_step');
    if (outputKeys.length === 0) return fields;

    // Look for downstream filter steps that reference this step's output
    for (const step of this.workflowSteps) {
      if (step.kind !== 'transform' || (step as TransformStep).type !== 'filter') continue;

      const filterStep = step as TransformStep;
      const inputs = filterStep.inputs || {};

      // Check if this filter step's collection input references our step's output
      const collectionInput = inputs['collection'] || inputs['data'] || inputs['input'];
      if (!collectionInput) continue;

      const inputRef = collectionInput.source === 'from_step' ? collectionInput.ref : null;
      if (!inputRef) continue;

      // Check if it references our step or a downstream step that chains from us
      const referencesOurOutput = outputKeys.some(key =>
        inputRef === `${stepId}.${key}` || inputRef.startsWith(`${stepId}.`)
      );

      // Also check if it references a step that directly follows our output
      const referencesDownstreamOfUs = this.isStepDownstreamOf(inputRef.split('.')[0], stepId);

      if (!referencesOurOutput && !referencesDownstreamOfUs) continue;

      // Extract the field being filtered on
      const fieldInput = inputs['field'];
      if (!fieldInput || fieldInput.source !== 'constant') continue;

      let fieldName = String(fieldInput.value || '');

      // Strip {{item.}} prefix if present
      if (fieldName.startsWith('{{item.')) {
        fieldName = fieldName.replace(/^\{\{item\./, '').replace(/\}\}$/, '');
      }
      if (fieldName.startsWith('{{') || fieldName.includes('.')) continue; // Skip complex references

      // Skip if we've already seen this field
      if (seenFields.has(fieldName)) continue;
      seenFields.add(fieldName);

      // Skip cross-step dependency fields - these can't be computed by upstream step
      // They require data from another step that may not have run yet
      if (this.isCrossStepDependencyField(fieldName)) {
        continue;
      }

      // Extract description from the step's description
      // The description often contains the business logic (e.g., "sender domain != gmail.com")
      const description = filterStep.description || `Boolean field for filtering in ${filterStep.id}`;

      fields.push({
        field: fieldName,
        description: this.extractFieldLogicFromDescription(fieldName, description),
        fromStepId: filterStep.id
      });
    }

    return fields;
  }

  /**
   * Check if a field name suggests a cross-step dependency
   * (i.e., requires comparing against another step's output)
   */
  private isCrossStepDependencyField(fieldName: string): boolean {
    // Patterns that suggest cross-step comparison
    const crossStepPatterns = [
      /_in_/i,           // e.g., "key_in_list", "not_in_logged"
      /_not_in_/i,       // e.g., "dedupe_key_not_in_logged_identifiers"
      /_matches_/i,      // e.g., "id_matches_existing"
      /_exists_in_/i,    // e.g., "email_exists_in_sheet"
      /^in_/i,           // e.g., "in_logged_list"
      /^not_in_/i,       // e.g., "not_in_database"
    ];

    return crossStepPatterns.some(pattern => pattern.test(fieldName));
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
    const config = this.buildTransformConfig(transformType, step.inputs || {}, step.id);
    const outputs = this.buildStepOutputs(step.outputs, step.id, 'transform', operation);

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
   * Build PILOT DSL AIProcessingStep (requires LLM)
   * @param downstreamFields - Optional array of field requirements from downstream filter steps
   */
  private buildAIProcessingStep(
    step: TransformStep,
    transformType: string,
    downstreamFields?: Array<{ field: string; description: string; fromStepId: string }>
  ): AIProcessingStep & { outputs?: Record<string, any> } {
    const dataInput = this.findPrimaryInput(step.inputs || {}, step.id);
    const outputs = this.buildStepOutputs(step.outputs, step.id, 'ai_processing');

    // Build enhanced prompt with downstream field requirements
    let prompt = step.description;
    if (downstreamFields && downstreamFields.length > 0) {
      const fieldsList = downstreamFields
        .map(f => `- ${f.field}: ${f.description}`)
        .join('\n');
      prompt = `${step.description}\n\nFor each item, compute these fields needed by downstream steps:\n${fieldsList}`;
    }

    // Add output format instructions based on expected output type
    const outputFormatInstructions = this.buildOutputFormatInstructions(step.outputs, transformType);
    if (outputFormatInstructions) {
      prompt = `${prompt}${outputFormatInstructions}`;
    }

    return {
      id: step.id,
      type: 'ai_processing',
      name: this.truncate(step.description, 100),
      description: step.description,
      intent: 'extract',  // Explicit intent to ensure ExtractHandler is used (parses JSON output properly)
      prompt,
      params: {
        data: dataInput
      },
      ...(outputs && { outputs })
    };
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
    originalTransformType?: string
  ): string {
    if (!outputs || Object.keys(outputs).length === 0) {
      // Default: return as JSON object
      return `\n\nOUTPUT FORMAT:
Return ONLY valid JSON. No explanations, no markdown code blocks, just the raw JSON.`;
    }

    const outputKeys = Object.keys(outputs);
    const firstOutputKey = outputKeys[0];
    const firstOutput = outputs[firstOutputKey];
    const outputType = firstOutput?.type || 'object';

    // Determine if output should be an array based on type annotation
    const isArrayOutput = outputType.includes('[]') ||
                          outputType === 'array' ||
                          originalTransformType === 'map' ||
                          originalTransformType === 'filter';

    if (isArrayOutput) {
      // For array outputs (object[], T[], string[], etc.)
      // The result should be wrapped in { items: [...] } for consistent downstream access
      return `\n\nOUTPUT FORMAT:
Return ONLY a valid JSON object with an "items" array containing the processed data.
Do not include any explanations or markdown code blocks, just the raw JSON.
Example format:
{"items": [{"field1": "value1", ...}, {"field2": "value2", ...}]}`;
    }

    // For single object outputs
    return `\n\nOUTPUT FORMAT:
Return ONLY a valid JSON object with the result.
Do not include any explanations or markdown code blocks, just the raw JSON.
Example format:
{"result": <your_output_here>}`;
  }

  /**
   * Build TransformConfig based on operation type
   */
  private buildTransformConfig(transformType: string, inputs: Record<string, StepInput>, stepId: string): TransformConfig {
    switch (transformType) {
      case 'filter':
        return this.buildFilterConfig(inputs, stepId);
      case 'sort':
        return this.buildSortConfig(inputs, stepId);
      case 'group_by':
        return this.buildGroupByConfig(inputs, stepId);
      case 'aggregate':
        return this.buildAggregateConfig(inputs, stepId);
      case 'format':
      case 'map':
      case 'pick_fields':
      case 'merge':
      case 'split':
      case 'convert':
      case 'flatten':
      case 'deduplicate':
      default:
        return this.buildMappingConfig(inputs, stepId);
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

  private buildMappingConfig(inputs: Record<string, StepInput>, stepId: string): TransformConfig {
    const mapping: Record<string, any> = {};

    for (const [key, input] of Object.entries(inputs)) {
      if (key !== 'collection' && key !== 'data' && key !== 'items') {
        mapping[key] = this.resolveInput(input);
      }
    }

    if (Object.keys(mapping).length === 0) {
      this.addWarning(stepId, 'empty_config', 'Mapping step has no configuration inputs', { availableInputs: Object.keys(inputs) });
    }

    return { mapping };
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
   * For ai_processing steps: returns {{stepId.data.items}}
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
   * - filter transforms: {{stepX.data.items}} (executor stores {items: [...]} in data)
   * - ai_processing (fallback): {{stepX.data.items}} (LLM returns array in items key)
   * - ai_processing (native): {{stepX.data.fieldName}} (LLM returns structured data with keys)
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
                // Map transforms store raw array directly in .data
                // Drop the field name: "step2.normalized_emails" → "step2.data"
                return `{{${stepId}.data}}`;
              }

              if (operation === 'filter') {
                // Filter transforms store {items: [...], filtered: [...]} in .data
                // Use .data.items for the filtered array
                return `{{${stepId}.data.items}}`;
              }

              if (operation === 'aggregate') {
                // Aggregate transforms return results directly at .data level
                // E.g., { to_log_count: 0 } is stored at step9.data, not step9.data.run_summary
                return `{{${stepId}.data}}`;
              }

              if (operation === 'ai_processing' || stepInfo.type === 'ai_processing') {
                // Transform that fell back to ai_processing
                // The LLM orchestrator returns arrays in .data.items
                return `{{${stepId}.data.items}}`;
              }

              // Other transforms (sort, etc.) - keep field name
              return `{{${stepId}.data.${fieldName}}}`;
            }

            // Native ai_processing steps (not fallback) - keep field name
            if (stepInfo.type === 'ai_processing') {
              return `{{${stepId}.data.items}}`;
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

    // 4. No primary input found
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
   */
  private parseCondition(conditionStr: string | undefined): Condition {
    if (!conditionStr) {
      return { conditionType: 'simple', field: '', operator: 'exists', value: true };
    }

    // Pattern: ref.length > 0 or ref.length == 0
    const lengthMatch = conditionStr.match(/^(.+)\.length\s*(>|==|>=|<|<=|!=)\s*(\d+)$/);
    if (lengthMatch) {
      const [, ref, op, num] = lengthMatch;
      if (op === '>' && num === '0') {
        return { conditionType: 'simple', field: `{{${ref}}}`, operator: 'is_not_empty', value: '' };
      }
      if ((op === '==' || op === '===') && num === '0') {
        return { conditionType: 'simple', field: `{{${ref}}}`, operator: 'is_empty', value: '' };
      }
    }

    // Pattern: ref == 'value' or ref == value
    const equalsMatch = conditionStr.match(/^(.+?)\s*(==|===|!=|!==)\s*['"]?(.+?)['"]?$/);
    if (equalsMatch) {
      const [, field, op, value] = equalsMatch;
      return {
        conditionType: 'simple',
        field: `{{${field.trim()}}}`,
        operator: op.includes('!') ? 'not_equals' : 'equals',
        value: this.parseValue(value)
      };
    }

    // Pattern: ref > N, ref >= N, ref < N, ref <= N
    const comparisonMatch = conditionStr.match(/^(.+?)\s*(>=|<=|>|<)\s*(.+)$/);
    if (comparisonMatch) {
      const [, field, op, value] = comparisonMatch;
      const operatorMap: Record<string, string> = {
        '>': 'greater_than',
        '>=': 'greater_than_or_equal',
        '<': 'less_than',
        '<=': 'less_than_or_equal'
      };
      return {
        conditionType: 'simple',
        field: `{{${field.trim()}}}`,
        operator: operatorMap[op] as ComparisonOperator,
        value: this.parseValue(value)
      };
    }

    // Fallback: treat as field exists check
    return {
      conditionType: 'simple',
      field: `{{${conditionStr}}}`,
      operator: 'exists',
      value: true
    };
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
   */
  private buildStepOutputs(
    phase4Outputs: Record<string, any> | undefined,
    stepId: string,
    stepType: 'action' | 'transform' | 'ai_processing',
    operation?: string
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

      outputs[key] = { type: outputType, ...(description && { description }) };
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
}

// ============================================================================
// EXPORTS
// ============================================================================

export default Phase4DSLBuilder;
