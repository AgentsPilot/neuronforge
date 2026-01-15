/**
 * DSL Compiler/Validator - Pre-execution validation layer
 *
 * Phase 2 Architectural Redesign:
 * This module validates DSL workflows before execution, catching errors
 * that would otherwise only surface at runtime.
 *
 * Key validations:
 * - Step existence: All referenced stepIds exist in workflow
 * - Output key existence: from_step refs point to declared outputs
 * - Variable reference validation: {{stepX.key}} refs are valid
 * - Routing validation: next_step targets exist
 *
 * @module lib/pilot/dsl-compiler
 */

import { createLogger } from '@/lib/logger';
import { SchemaRegistry, getSchemaRegistry } from './schema-registry';

const logger = createLogger({ module: 'DSLCompiler', service: 'workflow-pilot' });

// ============================================================================
// TYPES
// ============================================================================

/**
 * Compilation error - blocks execution
 */
export interface CompilationError {
  type:
    | 'STEP_NOT_FOUND'
    | 'OUTPUT_KEY_NOT_FOUND'
    | 'INVALID_REFERENCE'
    | 'CIRCULAR_DEPENDENCY'
    | 'MISSING_REQUIRED_INPUT'
    | 'INVALID_ROUTING'
    | 'TYPE_MISMATCH'
    | 'SCHEMA_FIELD_NOT_FOUND'
    | 'UNKNOWN_REFERENCE'
    | 'INVALID_SCHEMA_REF';  // Phase 5: $ref validation
  stepId: string;
  message: string;
  details?: {
    reference?: string;
    expectedKey?: string;
    availableKeys?: string[];
    targetStep?: string;
    plugin?: string;
    action?: string;
    suggestion?: string;
    schemaRef?: string;  // Phase 5: for $ref validation errors
  };
}

/**
 * Compilation warning - execution can proceed but may have issues
 */
export interface CompilationWarning {
  type:
    | 'UNQUALIFIED_REFERENCE'
    | 'MISSING_OUTPUT_DECLARATION'
    | 'DEPRECATED_SYNTAX'
    | 'POTENTIAL_NULL_ACCESS'
    | 'SCHEMA_FIELD_MISMATCH';
  stepId: string;
  message: string;
  suggestion?: string;
}

/**
 * Auto-fix applied during compilation
 */
export interface AutoFix {
  stepId: string;
  type: 'ADD_DATA_PREFIX' | 'NORMALIZE_REF' | 'ADD_OUTPUT_KEY';
  original: string;
  fixed: string;
  location: string;
}

/**
 * Compilation result
 */
export interface CompilationResult {
  valid: boolean;
  errors: CompilationError[];
  warnings: CompilationWarning[];
  autoFixes: AutoFix[];

  /**
   * Normalized DSL with auto-fixes applied
   * Only present if valid or if errors are all auto-fixable
   */
  normalizedDsl?: any;

  /**
   * Step output registry built during compilation
   * Maps stepId -> declared output keys
   */
  outputRegistry: Map<string, string[]>;
}

/**
 * DSL Step (generic structure from Phase 4)
 */
interface DslStep {
  id: string;
  kind?: 'operation' | 'transform' | 'control';
  type?: string;
  description?: string;
  plugin?: string;  // Plugin name for operation steps
  action?: string;  // Action name for operation steps
  inputs?: Record<string, DslInput>;
  outputs?: Record<string, any>;
  control?: {
    type: string;
    item_name?: string;
    collection_ref?: string;
  };
  condition?: string;
  steps?: DslStep[];  // Nested steps for control structures
}

/**
 * DSL Input specification
 */
interface DslInput {
  source: 'constant' | 'from_step' | 'user_input' | 'env' | 'plugin_config';
  value?: any;
  ref?: string;
  key?: string;
}

// ============================================================================
// COMPILER CLASS
// ============================================================================

export class DslCompiler {
  private errors: CompilationError[] = [];
  private warnings: CompilationWarning[] = [];
  private autoFixes: AutoFix[] = [];
  private outputRegistry: Map<string, string[]> = new Map();
  private stepIndex: Map<string, DslStep> = new Map();
  // Phase 3: Track plugin/action source for each step's output
  private pluginActionRegistry: Map<string, { plugin: string; action: string }> = new Map();
  private schemaRegistry: SchemaRegistry | null = null;
  // P10: Track conditional control steps (for lastBranchOutput validation)
  private conditionalStepIds: Set<string> = new Set();
  // P11: Track current loop item variable names during nested step validation
  private loopItemVariables: Set<string> = new Set();

  /**
   * Compile and validate a DSL workflow
   *
   * Note: For Phase 3 schema validation to work, ensure initializeSchemaRegistry()
   * has been called at application startup. Without it, schema field validation
   * will be skipped gracefully.
   */
  compile(dsl: { technical_workflow?: DslStep[]; steps?: DslStep[] }): CompilationResult {
    // Reset state
    this.errors = [];
    this.warnings = [];
    this.autoFixes = [];
    this.outputRegistry = new Map();
    this.stepIndex = new Map();
    this.pluginActionRegistry = new Map();
    this.conditionalStepIds = new Set();
    this.loopItemVariables = new Set();

    // Phase 3: Get schema registry for field validation
    try {
      this.schemaRegistry = getSchemaRegistry();
    } catch {
      this.schemaRegistry = null;
      logger.debug('Schema registry not available, skipping schema field validation');
    }

    const steps = dsl.technical_workflow || dsl.steps || [];

    if (steps.length === 0) {
      logger.warn('DSL has no steps to compile');
      return {
        valid: true,
        errors: [],
        warnings: [],
        autoFixes: [],
        outputRegistry: this.outputRegistry,
      };
    }

    logger.info({ stepCount: steps.length }, 'Starting DSL compilation');

    // Phase 1: Build step index and output registry
    this.buildStepIndex(steps);

    // Phase 2: Validate all steps
    this.validateSteps(steps);

    // Phase 3: Validate routing/flow
    this.validateRouting(steps);

    const valid = this.errors.length === 0;

    logger.info({
      valid,
      errorCount: this.errors.length,
      warningCount: this.warnings.length,
      autoFixCount: this.autoFixes.length,
    }, 'DSL compilation complete');

    return {
      valid,
      errors: this.errors,
      warnings: this.warnings,
      autoFixes: this.autoFixes,
      outputRegistry: this.outputRegistry,
      normalizedDsl: valid ? dsl : undefined,
    };
  }

  // ==========================================================================
  // PHASE 1: BUILD INDICES
  // ==========================================================================

  /**
   * Build step index and output registry
   */
  private buildStepIndex(steps: DslStep[], parentPath: string = ''): void {
    for (const step of steps) {
      const stepPath = parentPath ? `${parentPath}.${step.id}` : step.id;

      // Index the step
      this.stepIndex.set(step.id, step);

      // Register declared outputs (excluding routing keys)
      const outputKeys = this.extractOutputKeys(step);
      this.outputRegistry.set(step.id, outputKeys);

      // Phase 3: Register plugin/action for operation steps (for schema validation)
      if (step.kind === 'operation' && step.plugin && step.action) {
        this.pluginActionRegistry.set(step.id, {
          plugin: step.plugin,
          action: step.action,
        });
        logger.debug({
          stepId: step.id,
          plugin: step.plugin,
          action: step.action,
        }, 'Registered step plugin/action for schema validation');
      }

      // P10: Track conditional control steps for lastBranchOutput validation
      // Phase 4 format: kind === 'control' && control.type === 'if'
      if (step.kind === 'control' && step.control?.type === 'if') {
        this.conditionalStepIds.add(step.id);
        logger.debug({ stepId: step.id }, 'Registered conditional step for lastBranchOutput validation (Phase 4)');
      }
      // PILOT_DSL format: type === 'conditional'
      if ((step as any).type === 'conditional') {
        this.conditionalStepIds.add(step.id);
        logger.debug({ stepId: step.id }, 'Registered conditional step for lastBranchOutput validation (PILOT_DSL)');
      }

      // PILOT_DSL format: Register plugin/action for action steps
      if ((step as any).type === 'action' && (step as any).plugin && (step as any).action) {
        this.pluginActionRegistry.set(step.id, {
          plugin: (step as any).plugin,
          action: (step as any).action,
        });
      }

      logger.debug({
        stepId: step.id,
        outputKeys,
      }, 'Registered step outputs');

      // Process nested steps (Phase 4 control structures)
      if (step.steps && step.steps.length > 0) {
        this.buildStepIndex(step.steps, stepPath);
      }

      // Process nested steps (PILOT_DSL conditional: then_steps, else_steps)
      if ((step as any).then_steps && (step as any).then_steps.length > 0) {
        this.buildStepIndex((step as any).then_steps, stepPath);
      }
      if ((step as any).else_steps && (step as any).else_steps.length > 0) {
        this.buildStepIndex((step as any).else_steps, stepPath);
      }

      // Process nested steps (PILOT_DSL scatter_gather: scatter.steps)
      if ((step as any).scatter?.steps && (step as any).scatter.steps.length > 0) {
        this.buildStepIndex((step as any).scatter.steps, stepPath);
      }
    }
  }

  /**
   * Extract declared output keys from a step (excluding routing keys)
   */
  private extractOutputKeys(step: DslStep): string[] {
    if (!step.outputs) return [];

    const routingKeys = ['next_step', 'is_last_step', 'iteration_next_step', 'after_loop_next_step'];

    return Object.keys(step.outputs).filter(key => {
      // Skip routing keys
      if (routingKeys.includes(key)) return false;

      // Skip branch outputs that are objects with next_step
      const value = step.outputs![key];
      if (typeof value === 'object' && value !== null && 'next_step' in value) {
        return false;
      }

      return true;
    });
  }

  /**
   * Phase 5: Validate $ref references in output contracts
   * Checks that any $ref in output declarations exists in the schema registry
   */
  private validateOutputSchemaRefs(step: DslStep): void {
    if (!step.outputs || !this.schemaRegistry) return;

    for (const [outputKey, outputValue] of Object.entries(step.outputs)) {
      // Check for output contract with $ref
      if (typeof outputValue === 'object' && outputValue !== null) {
        const $ref = (outputValue as any).$ref;
        if ($ref && typeof $ref === 'string') {
          // Validate the $ref exists in schema registry
          if (!this.schemaRegistry.hasSchemaRef($ref)) {
            this.errors.push({
              type: 'INVALID_SCHEMA_REF',
              stepId: step.id,
              message: `Output "${outputKey}" references unknown schema: "${$ref}"`,
              details: {
                reference: outputKey,
                schemaRef: $ref,
                suggestion: 'Register the schema using SchemaRegistry.registerSchema() or use an inline schema',
              },
            });
          } else {
            logger.debug({
              stepId: step.id,
              outputKey,
              $ref,
            }, 'Validated $ref schema reference');
          }
        }
      }
    }
  }

  // ==========================================================================
  // PHASE 2: VALIDATE STEPS
  // ==========================================================================

  /**
   * Validate all steps
   */
  private validateSteps(steps: DslStep[]): void {
    for (const step of steps) {
      this.validateStep(step);

      // Validate nested steps
      if (step.steps && step.steps.length > 0) {
        // P11: Track loop item variable for for_each control steps
        const itemName = step.control?.type === 'for_each' ? step.control.item_name : undefined;
        if (itemName) {
          this.loopItemVariables.add(itemName);
          logger.debug({ stepId: step.id, itemName }, 'Entering loop scope with item variable');
        }

        this.validateSteps(step.steps);

        // P11: Remove loop item variable after exiting scope
        if (itemName) {
          this.loopItemVariables.delete(itemName);
          logger.debug({ stepId: step.id, itemName }, 'Exiting loop scope');
        }
      }
    }
  }

  /**
   * Validate a single step
   */
  private validateStep(step: DslStep): void {
    // Validate Phase 4 format inputs (with source/ref)
    if (step.inputs) {
      this.validateInputs(step);
    }

    // Validate PILOT_DSL format: step.input (template string for transforms)
    if (typeof (step as any).input === 'string') {
      this.validateTemplateReferences(step.id, 'input', (step as any).input);
      this.validateSchemaReferencesInTemplate(step.id, (step as any).input);
    }

    // Validate PILOT_DSL format: step.params (object with template strings)
    if ((step as any).params && typeof (step as any).params === 'object') {
      this.validateParamsObject(step.id, (step as any).params, 'params');
    }

    // Validate PILOT_DSL format: step.config (object with template strings)
    if ((step as any).config && typeof (step as any).config === 'object') {
      this.validateParamsObject(step.id, (step as any).config, 'config');
    }

    // Validate condition references
    if (step.condition) {
      this.validateConditionReferences(step);
    }

    // Validate control structure references (Phase 4 format)
    if (step.control) {
      this.validateControlReferences(step);
    }

    // Validate PILOT_DSL conditional: then_steps and else_steps
    if ((step as any).then_steps) {
      this.validateSteps((step as any).then_steps);
    }
    if ((step as any).else_steps) {
      this.validateSteps((step as any).else_steps);
    }

    // Validate PILOT_DSL scatter_gather: scatter.input and scatter.steps
    if ((step as any).scatter) {
      const scatter = (step as any).scatter;
      // Track the itemVariable as a loop item variable
      if (scatter.itemVariable) {
        this.loopItemVariables.add(scatter.itemVariable);
      }
      // Validate scatter.input
      if (typeof scatter.input === 'string') {
        this.validateTemplateReferences(step.id, 'scatter.input', scatter.input);
      }
      // Validate nested steps
      if (scatter.steps && scatter.steps.length > 0) {
        this.validateSteps(scatter.steps);
      }
      // Remove the loop item variable after scope
      if (scatter.itemVariable) {
        this.loopItemVariables.delete(scatter.itemVariable);
      }
    }

    // Phase 5: Validate $ref references in output contracts
    this.validateOutputSchemaRefs(step);

    // Check for missing output declarations
    if (!step.outputs || this.extractOutputKeys(step).length === 0) {
      // Only warn for transforms that typically produce output
      if (step.kind === 'transform' || step.type === 'transform') {
        this.warnings.push({
          type: 'MISSING_OUTPUT_DECLARATION',
          stepId: step.id,
          message: `Transform step has no declared outputs`,
          suggestion: 'Add outputs declaration to enable downstream reference validation',
        });
      }
    }
  }

  /**
   * Recursively validate params/config objects for template strings
   */
  private validateParamsObject(stepId: string, obj: any, path: string): void {
    for (const [key, value] of Object.entries(obj)) {
      const fullPath = `${path}.${key}`;
      if (typeof value === 'string') {
        this.validateTemplateReferences(stepId, fullPath, value);
        this.validateSchemaReferencesInTemplate(stepId, value);
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.validateParamsObject(stepId, value, fullPath);
      }
    }
  }

  /**
   * Validate step inputs
   */
  private validateInputs(step: DslStep): void {
    for (const [inputName, input] of Object.entries(step.inputs!)) {
      if (input.source === 'from_step' && input.ref) {
        this.validateFromStepRef(step.id, inputName, input.ref);
        // Phase 3: Validate nested field paths against schema
        this.validateSchemaInFromStepRef(step.id, input.ref);
      }

      if (input.source === 'constant' && typeof input.value === 'string') {
        this.validateTemplateReferences(step.id, inputName, input.value);
        // Phase 3: Validate schema field references in templates
        this.validateSchemaReferencesInTemplate(step.id, input.value);
      }
    }
  }

  /**
   * Validate a from_step reference
   */
  private validateFromStepRef(stepId: string, inputName: string, ref: string): void {
    // Parse ref: "stepX.outputKey" or "stepX.outputKey.field"
    const parts = ref.split('.');

    if (parts.length < 2) {
      this.errors.push({
        type: 'INVALID_REFERENCE',
        stepId,
        message: `Invalid from_step reference format: "${ref}"`,
        details: { reference: ref },
      });
      return;
    }

    const [targetStepId, outputKey] = parts;

    // P11: Skip validation if this is a loop item variable reference
    // e.g., "email_payload.recipients" where "email_payload" is the item_name
    if (this.loopItemVariables.has(targetStepId)) {
      logger.debug({
        stepId,
        inputName,
        ref,
        itemVar: targetStepId,
      }, 'Skipping validation for loop item variable reference');
      return;
    }

    // Check if target step exists
    if (!this.stepIndex.has(targetStepId)) {
      this.errors.push({
        type: 'STEP_NOT_FOUND',
        stepId,
        message: `Referenced step "${targetStepId}" does not exist`,
        details: {
          reference: ref,
          targetStep: targetStepId,
          availableKeys: Array.from(this.stepIndex.keys()),
        },
      });
      return;
    }

    // Check if output key exists in target step
    const targetOutputs = this.outputRegistry.get(targetStepId) || [];

    // Special case: 'data' is always valid as it's the wrapper
    // P10: 'lastBranchOutput' is always valid for conditional control steps
    const isLastBranchOutputRef = outputKey === 'lastBranchOutput' && this.conditionalStepIds.has(targetStepId);

    // Phase 5: When outputKey is 'data', validate parts[2] (the actual field)
    if (outputKey === 'data' && parts.length >= 3) {
      const actualField = parts[2];
      if (targetOutputs.length > 0 && !targetOutputs.includes(actualField)) {
        this.errors.push({
          type: 'OUTPUT_KEY_NOT_FOUND',
          stepId,
          message: `Field "${actualField}" not declared in step "${targetStepId}" outputs (via data wrapper)`,
          details: {
            reference: ref,
            expectedKey: actualField,
            availableKeys: targetOutputs,
            suggestion: `Use "{{${targetStepId}.data.${targetOutputs[0]}}}" or declare "${actualField}" in outputs`,
          },
        });
      }
    } else if (outputKey !== 'data' && !isLastBranchOutputRef && !targetOutputs.includes(outputKey)) {
      // Check if it might be accessing nested data
      if (targetOutputs.length > 0) {
        this.errors.push({
          type: 'OUTPUT_KEY_NOT_FOUND',
          stepId,
          message: `Output key "${outputKey}" not declared in step "${targetStepId}"`,
          details: {
            reference: ref,
            expectedKey: outputKey,
            availableKeys: targetOutputs,
          },
        });
      } else {
        // Target step has no declared outputs - warn but don't error
        this.warnings.push({
          type: 'MISSING_OUTPUT_DECLARATION',
          stepId,
          message: `Cannot verify reference "${ref}" - target step has no declared outputs`,
          suggestion: `Add outputs declaration to step "${targetStepId}"`,
        });
      }
    }
  }

  /**
   * Validate template variable references in constant values
   */
  private validateTemplateReferences(stepId: string, inputName: string, template: string): void {
    // Check if template contains Handlebars block helpers ({{#each}}, {{#with}}, etc.)
    // Inside these blocks, simple property references like {{sender}} refer to the iteration context
    const hasHandlebarsBlockContext = /\{\{#(each|with|if|unless)\b/.test(template);

    // Find all {{...}} references
    const refPattern = /\{\{([^}]+)\}\}/g;
    let match;

    while ((match = refPattern.exec(template)) !== null) {
      const ref = match[1].trim();

      // Skip Handlebars helpers
      if (ref.startsWith('#') || ref.startsWith('/') || ref === 'else' ||
          ref.startsWith('@') || ref === 'this') {
        continue;
      }

      // Skip special prefixes that are valid
      if (ref.startsWith('input.') || ref.startsWith('env.') ||
          ref.startsWith('item.') || ref.startsWith('current.') ||
          ref.startsWith('config.')) {
        continue;
      }

      // Skip standalone special variables used in array iteration (e.g., {{item}} in format/map transforms)
      if (ref === 'item' || ref === 'current' || ref === 'index') {
        continue;
      }

      // P11: Skip loop item variable references (e.g., "email_payload.field" when item_name is "email_payload")
      const refRoot = ref.split('.')[0];
      if (this.loopItemVariables.has(refRoot)) {
        continue;
      }

      // Parse reference parts
      const parts = ref.split('.');
      const targetStepId = parts[0];

      // Check if this looks like a step reference (starts with 'step' or exists in index)
      const isStepRef = ref.startsWith('step') || this.stepIndex.has(targetStepId);

      if (isStepRef) {
        if (!this.stepIndex.has(targetStepId)) {
          this.errors.push({
            type: 'STEP_NOT_FOUND',
            stepId,
            message: `Template reference to non-existent step: "{{${ref}}}"`,
            details: {
              reference: ref,
              targetStep: targetStepId,
            },
          });
        } else if (parts.length > 1) {
          // Validate output key (skip 'data' as it's the wrapper)
          const outputKey = parts[1];
          const targetOutputs = this.outputRegistry.get(targetStepId) || [];

          if (outputKey === 'data' && parts.length >= 3) {
            // Phase 5: When outputKey is 'data', validate parts[2] (the actual field)
            const actualField = parts[2];
            if (targetOutputs.length > 0 && !targetOutputs.includes(actualField)) {
              this.errors.push({
                type: 'OUTPUT_KEY_NOT_FOUND',
                stepId,
                message: `Template reference to undeclared output field: "{{${ref}}}"`,
                details: {
                  reference: ref,
                  expectedKey: actualField,
                  availableKeys: targetOutputs,
                  suggestion: `Declare "${actualField}" in step "${targetStepId}" outputs`,
                },
              });
            }
          } else if (outputKey !== 'data') {
            // P10: 'lastBranchOutput' is always valid for conditional control steps
            const isLastBranchOutputRef = outputKey === 'lastBranchOutput' && this.conditionalStepIds.has(targetStepId);
            if (isLastBranchOutputRef) {
              // Valid reference to conditional branch output - skip validation
              continue;
            }
            if (targetOutputs.length > 0 && !targetOutputs.includes(outputKey)) {
              this.errors.push({
                type: 'OUTPUT_KEY_NOT_FOUND',
                stepId,
                message: `Template reference to undeclared output: "{{${ref}}}"`,
                details: {
                  reference: ref,
                  expectedKey: outputKey,
                  availableKeys: targetOutputs,
                },
              });
            }
          }
        }
      } else if (hasHandlebarsBlockContext) {
        // Inside a Handlebars block context ({{#each}}, {{#with}}, etc.),
        // simple property references like {{sender}} are valid - they refer to
        // properties of the current iteration item (this.sender)
        logger.debug({
          stepId,
          inputName,
          ref,
        }, 'Skipping validation for Handlebars block context property reference');
        continue;
      } else {
        // Unknown reference - not a step, not a loop variable, not a special prefix,
        // and not inside a Handlebars block context
        // This is an error because the reference won't resolve at runtime
        this.errors.push({
          type: 'UNKNOWN_REFERENCE',
          stepId,
          message: `Unknown template reference: "{{${ref}}}" - not a step, loop variable, or special prefix`,
          details: {
            reference: ref,
            suggestion: `Use "{{stepX.data.${ref}}}" for step output, "{{input.${ref}}}" for user input, or ensure loop variable is in scope`,
          },
        });
      }
    }
  }

  /**
   * Validate condition string references
   */
  private validateConditionReferences(step: DslStep): void {
    const condition = step.condition!;

    // Find all {{...}} references in condition
    const refPattern = /\{\{([^}]+)\}\}/g;
    let match;

    while ((match = refPattern.exec(condition)) !== null) {
      const ref = match[1].trim();

      if (ref.startsWith('step')) {
        const parts = ref.split('.');
        const targetStepId = parts[0];

        if (!this.stepIndex.has(targetStepId)) {
          this.errors.push({
            type: 'STEP_NOT_FOUND',
            stepId: step.id,
            message: `Condition references non-existent step: "${targetStepId}"`,
            details: { reference: ref, targetStep: targetStepId },
          });
        }
      }
    }

    // Phase 3: Validate schema field references in condition
    this.validateSchemaReferencesInTemplate(step.id, condition);
  }

  /**
   * Validate control structure references
   */
  private validateControlReferences(step: DslStep): void {
    const control = step.control!;

    if (control.collection_ref) {
      const parts = control.collection_ref.split('.');
      const targetStepId = parts[0];

      if (!this.stepIndex.has(targetStepId)) {
        this.errors.push({
          type: 'STEP_NOT_FOUND',
          stepId: step.id,
          message: `Control collection_ref references non-existent step: "${targetStepId}"`,
          details: { reference: control.collection_ref, targetStep: targetStepId },
        });
      }

      // Phase 3: Validate collection field against schema
      // collection_ref like "step1.emails" -> validate "emails" against step1's schema
      if (parts.length >= 2 && this.schemaRegistry) {
        const fieldPath = parts.slice(1).join('.');
        this.validateSchemaField(step.id, targetStepId, fieldPath, control.collection_ref);
      }
    }
  }

  // ==========================================================================
  // PHASE 3 SCHEMA VALIDATION
  // ==========================================================================

  /**
   * Validate a field path against the plugin output schema
   * Called when we have a reference like {{step1.emails[0].sender}}
   * and need to verify 'sender' is a valid field in step1's plugin output schema
   */
  private validateSchemaField(
    stepId: string,
    targetStepId: string,
    fieldPath: string,
    fullReference: string
  ): void {
    if (!this.schemaRegistry) return;

    const pluginAction = this.pluginActionRegistry.get(targetStepId);
    if (!pluginAction) {
      // Target step is not an operation with known plugin/action (e.g., transform)
      // Can't validate schema, skip silently
      return;
    }

    const { plugin, action } = pluginAction;

    // Remove array indices and brackets for validation
    // e.g., "emails[0].sender" -> "emails.sender" for path validation
    const normalizedPath = fieldPath.replace(/\[\d+\]/g, '[]').replace(/\[\*\]/g, '[]');

    const result = this.schemaRegistry.validateFieldPath(plugin, action, normalizedPath);

    if (!result.valid && result.error) {
      // Check if this is a critical field mismatch (field not found)
      if (result.error.includes('not found')) {
        this.errors.push({
          type: 'SCHEMA_FIELD_NOT_FOUND',
          stepId,
          message: `Field "${fieldPath}" not found in ${plugin}.${action} output schema`,
          details: {
            reference: fullReference,
            expectedKey: fieldPath,
            availableKeys: result.availableFields,
            plugin,
            action,
          },
        });
      }
    }
  }

  /**
   * Extract field paths from a template reference
   * e.g., "step1.emails[0].sender" -> targetStepId: "step1", fieldPath: "emails[0].sender"
   */
  private parseFieldReference(ref: string): { targetStepId: string; fieldPath: string } | null {
    const parts = ref.split('.');
    if (parts.length < 2) return null;

    const targetStepId = parts[0];
    const fieldPath = parts.slice(1).join('.');

    return { targetStepId, fieldPath };
  }

  /**
   * Validate all schema field references in a template string
   */
  private validateSchemaReferencesInTemplate(stepId: string, template: string): void {
    if (!this.schemaRegistry) return;

    // Find all {{...}} references
    const refPattern = /\{\{([^}]+)\}\}/g;
    let match;

    while ((match = refPattern.exec(template)) !== null) {
      const ref = match[1].trim();

      // Skip Handlebars helpers and special references
      if (ref.startsWith('#') || ref.startsWith('/') || ref === 'else' ||
          ref.startsWith('@') || ref === 'this' ||
          ref.startsWith('input.') || ref.startsWith('env.') ||
          ref.startsWith('item.') || ref.startsWith('current.')) {
        continue;
      }

      // P11: Skip loop item variable references
      const refRoot = ref.split('.')[0];
      if (this.loopItemVariables.has(refRoot)) {
        continue;
      }

      // Only validate step references with field paths
      if (ref.startsWith('step')) {
        const parsed = this.parseFieldReference(ref);
        if (parsed && parsed.fieldPath) {
          // Skip 'data' wrapper - it's synthetic
          if (parsed.fieldPath.startsWith('data.')) {
            const actualFieldPath = parsed.fieldPath.slice(5); // Remove 'data.'
            if (actualFieldPath) {
              this.validateSchemaField(stepId, parsed.targetStepId, actualFieldPath, ref);
            }
          } else {
            this.validateSchemaField(stepId, parsed.targetStepId, parsed.fieldPath, ref);
          }
        }
      }
    }
  }

  /**
   * Validate schema fields in from_step references
   */
  private validateSchemaInFromStepRef(stepId: string, ref: string): void {
    if (!this.schemaRegistry) return;

    const parsed = this.parseFieldReference(ref);
    if (!parsed) return;

    // P11: Skip loop item variable references
    if (this.loopItemVariables.has(parsed.targetStepId)) {
      return;
    }

    // Skip if just referencing the step output key without nested fields
    // e.g., "step1.emails" is fine, but "step1.emails.sender" needs schema validation
    const fieldParts = parsed.fieldPath.split('.');
    if (fieldParts.length < 2) return;

    // Extract nested field path (everything after the first output key)
    const nestedPath = fieldParts.slice(1).join('.');

    if (nestedPath) {
      // Skip 'data' wrapper
      if (nestedPath.startsWith('data.')) {
        const actualPath = nestedPath.slice(5);
        if (actualPath) {
          this.validateSchemaField(stepId, parsed.targetStepId, actualPath, ref);
        }
      } else {
        this.validateSchemaField(stepId, parsed.targetStepId, nestedPath, ref);
      }
    }
  }

  // ==========================================================================
  // PHASE 3: VALIDATE ROUTING
  // ==========================================================================

  /**
   * Validate step routing (next_step, branches)
   */
  private validateRouting(steps: DslStep[]): void {
    for (const step of steps) {
      if (!step.outputs) continue;

      // Check next_step
      if (step.outputs.next_step) {
        const target = step.outputs.next_step;
        if (!this.stepIndex.has(target)) {
          this.errors.push({
            type: 'INVALID_ROUTING',
            stepId: step.id,
            message: `next_step targets non-existent step: "${target}"`,
            details: { targetStep: target },
          });
        }
      }

      // Note: is_last_step is not validated - runtime executes all steps in array order
      // and doesn't use is_last_step to determine completion

      // Check branch outputs
      for (const [key, value] of Object.entries(step.outputs)) {
        if (typeof value === 'object' && value !== null && 'next_step' in value) {
          const target = value.next_step;
          if (target && !this.stepIndex.has(target)) {
            this.errors.push({
              type: 'INVALID_ROUTING',
              stepId: step.id,
              message: `Branch "${key}" targets non-existent step: "${target}"`,
              details: { targetStep: target },
            });
          }
        }
      }

      // Check control flow routing
      if (step.outputs.iteration_next_step) {
        const target = step.outputs.iteration_next_step;
        // For loops, the target might be a nested step
        const allStepIds = new Set([...this.stepIndex.keys()]);
        if (!allStepIds.has(target)) {
          // Check nested steps
          let found = false;
          if (step.steps) {
            for (const nested of step.steps) {
              if (nested.id === target) {
                found = true;
                break;
              }
            }
          }
          if (!found) {
            this.errors.push({
              type: 'INVALID_ROUTING',
              stepId: step.id,
              message: `iteration_next_step targets non-existent step: "${target}"`,
              details: { targetStep: target },
            });
          }
        }
      }

      if (step.outputs.after_loop_next_step) {
        const target = step.outputs.after_loop_next_step;
        if (!this.stepIndex.has(target)) {
          this.errors.push({
            type: 'INVALID_ROUTING',
            stepId: step.id,
            message: `after_loop_next_step targets non-existent step: "${target}"`,
            details: { targetStep: target },
          });
        }
      }

      // Validate nested step routing
      if (step.steps && step.steps.length > 0) {
        this.validateRouting(step.steps);
      }
    }

  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Compile a DSL workflow
 */
export function compileDsl(dsl: any): CompilationResult {
  const compiler = new DslCompiler();
  return compiler.compile(dsl);
}

/**
 * Quick validation check - returns true if valid
 */
export function isDslValid(dsl: any): boolean {
  const result = compileDsl(dsl);
  return result.valid;
}

/**
 * Get human-readable error summary
 */
export function getErrorSummary(result: CompilationResult): string {
  if (result.valid) {
    return 'DSL is valid';
  }

  const lines = ['DSL compilation failed:'];

  for (const error of result.errors) {
    lines.push(`  [${error.type}] ${error.stepId}: ${error.message}`);
  }

  if (result.warnings.length > 0) {
    lines.push('Warnings:');
    for (const warning of result.warnings) {
      lines.push(`  [${warning.type}] ${warning.stepId}: ${warning.message}`);
    }
  }

  return lines.join('\n');
}
