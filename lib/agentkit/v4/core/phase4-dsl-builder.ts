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
  'format': 'map',
  'merge': 'map',
  'split': 'map',
  'convert': 'map'
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

    const { technical_workflow, enhanced_prompt, feasibility, technical_inputs_required } = phase4Response;

    // Track total steps (including nested)
    this.stats.totalSteps = this.countTotalSteps(technical_workflow);

    try {
      // Convert workflow steps
      const workflowSteps = this.convertWorkflowSteps(technical_workflow);

      // Convert required inputs
      const requiredInputs = this.convertRequiredInputs(technical_inputs_required || []);

      // Determine workflow type
      const workflowType = this.determineWorkflowType(workflowSteps);

      // Build output schema
      const workflow: PILOT_DSL_SCHEMA = {
        agent_name: enhanced_prompt?.plan_title || 'Untitled Agent',
        description: enhanced_prompt?.plan_description || '',
        system_prompt: `You are an automation agent. ${enhanced_prompt?.plan_description || ''}`,
        workflow_type: workflowType,
        suggested_plugins: enhanced_prompt?.specifics?.services_involved || [],
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

    // Reduce confidence based on fallbacks
    confidence -= this.stats.fallbacksUsed * 0.01;

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
    return steps.map(step => this.convertStep(step));
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
          this.stats.actionSteps++;
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
          this.addError(step.id, 'invalid_step', `Unknown step kind: ${(step as any).kind}`, { kind: (step as any).kind });
          throw new Error(`Unknown step kind: ${(step as any).kind}`);
      }

      this.stats.convertedSteps++;
      return result;
    } catch (error) {
      this.addError(step.id, 'conversion_failed', `Failed to convert step: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Convert operation step → ActionStep
   */
  private convertOperationStep(step: OperationStep): ActionStep {
    return {
      id: step.id,
      type: 'action',
      name: this.truncate(step.description, 100),
      description: step.description,
      plugin: step.plugin,
      action: step.action,
      params: this.resolveInputs(step.inputs || {})
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
    } else {
      return this.buildTransformStep(step, transformType);
    }
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
  private buildTransformStep(step: TransformStep, transformType: string): PilotTransformStep {
    const operation = TRANSFORM_TYPE_TO_OPERATION[transformType] || 'map';
    const inputRef = this.findPrimaryInput(step.inputs || {}, step.id);
    const config = this.buildTransformConfig(transformType, step.inputs || {}, step.id);

    return {
      id: step.id,
      type: 'transform',
      name: this.truncate(step.description, 100),
      description: step.description,
      operation: operation as PilotTransformStep['operation'],
      input: inputRef,
      config
    };
  }

  /**
   * Build PILOT DSL AIProcessingStep (requires LLM)
   */
  private buildAIProcessingStep(step: TransformStep, transformType: string): AIProcessingStep {
    const dataInput = this.findPrimaryInput(step.inputs || {}, step.id);

    return {
      id: step.id,
      type: 'ai_processing',
      name: this.truncate(step.description, 100),
      description: step.description,
      prompt: step.description,
      params: {
        data: dataInput
      }
    };
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

    const field = this.resolveInput(fieldInput);
    const operator = this.resolveInput(inputs['operator']) || 'equals';
    const value = this.resolveInput(valueInput);

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
        field: field ? `{{item.${field}}}` : '',
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

    return {
      id: step.id,
      type: 'scatter_gather',
      name: this.truncate(step.description, 100),
      description: step.description,
      scatter: {
        input: `{{${control.collection_ref}}}`,
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
   */
  private resolveInput(input: StepInput | undefined): any {
    if (!input) return undefined;

    switch (input.source) {
      case 'constant':
        return input.value;
      case 'from_step':
        return `{{${input.ref}}}`;
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
   */
  private convertRequiredInputs(inputs: TechnicalInputRequired[]): InputField[] {
    return inputs.map(input => ({
      name: input.key,
      type: this.inferInputType(input.key),
      label: this.generateLabel(input.key),
      required: true,
      description: input.description || '',
      placeholder: `Enter ${input.key.replace(/_/g, ' ')}`,
      reasoning: input.plugin ? `Required by ${input.plugin} plugin` : 'Required input'
    }));
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
