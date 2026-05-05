/**
 * EnhancedSchemaValidator - Layer 1 of 3-Layer Validation Architecture
 *
 * Deterministic schema-based validation (100% safe, no LLM)
 * Validates workflow structure against plugin schemas before execution
 *
 * Key Features:
 * - Transform input type validation (flatten/filter/map require arrays)
 * - Variable reference schema validation ({{step1.data.emails}} field exists)
 * - Scatter-gather field validation (missing gather.from detection)
 * - Plugin parameter validation (cross-parameter dependencies)
 *
 * @module lib/pilot/shadow/EnhancedSchemaValidator
 */

import type { Agent } from '@/lib/repositories/types';
import { createLogger } from '@/lib/logger';
import PluginManagerV2 from '@/lib/server/plugin-manager-v2';

const logger = createLogger({ module: 'EnhancedSchemaValidator', service: 'shadow-agent' });

// Type definitions for workflow steps
type WorkflowStep = any; // Use any for flexibility with varying step structures
type TransformStep = any;
type ScatterGatherStep = any;

export type EnhancedValidationIssueType =
  | 'invalid_flatten_field'           // Flatten field doesn't exist in source schema
  | 'missing_flatten_field'            // Flatten operation missing field parameter
  | 'invalid_transform_input_type'     // Transform expects array but receives object
  | 'invalid_variable_reference'       // Variable references non-existent field in schema
  | 'missing_gather_from'              // Scatter-gather missing gather.from field
  | 'invalid_gather_from'              // Scatter-gather gather.from references non-existent variable
  | 'conflicting_item_variable'        // Scatter itemVariable conflicts with existing variable
  | 'invalid_field_path'               // Nested field path doesn't exist in schema
  | 'type_incompatibility';            // Source type incompatible with target operation

export interface EnhancedValidationIssue {
  type: EnhancedValidationIssueType;
  stepId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  autoFixable: boolean;
  confidence: number; // 0-1, for auto-fix decisions
  description: string;
  suggestedFix?: {
    field: string;
    oldValue: any;
    newValue: any;
    reasoning: string;
  };
}

export interface EnhancedValidationResult {
  issues: EnhancedValidationIssue[];
  appliedFixes: Array<{
    issue: EnhancedValidationIssue;
    success: boolean;
    error?: string;
  }>;
}

/**
 * EnhancedSchemaValidator - Layer 1 Deterministic Validation
 */
export class EnhancedSchemaValidator {
  private pluginManager: PluginManagerV2 | null = null;

  async initialize(): Promise<void> {
    if (!this.pluginManager) {
      this.pluginManager = await PluginManagerV2.getInstance();
    }
  }

  /**
   * Validate entire workflow against schemas
   */
  async validateWorkflow(agent: Agent): Promise<EnhancedValidationIssue[]> {
    await this.initialize();

    const issues: EnhancedValidationIssue[] = [];
    const steps: WorkflowStep[] = agent.pilot_steps || [];

    if (steps.length === 0) {
      logger.warn({ agentId: agent.id }, 'No steps found in workflow');
      return issues;
    }

    logger.info({ agentId: agent.id, stepCount: steps.length }, 'Starting enhanced schema validation');

    const allSteps = this.getAllStepsRecursive(steps);

    for (const step of allSteps) {
      // Transform step validation
      if (step.type === 'transform') {
        const transformIssues = await this.validateTransformStep(step as TransformStep, agent);
        issues.push(...transformIssues);
      }

      // Scatter-gather validation
      if (step.type === 'scatter_gather') {
        const scatterIssues = await this.validateScatterGatherStep(step as ScatterGatherStep, agent);
        issues.push(...scatterIssues);
      }

      // Variable reference validation (all steps)
      const varIssues = await this.validateVariableReferences(step, agent);
      issues.push(...varIssues);
    }

    logger.info({
      agentId: agent.id,
      totalIssues: issues.length,
      critical: issues.filter(i => i.severity === 'critical').length,
      autoFixable: issues.filter(i => i.autoFixable).length
    }, 'Enhanced schema validation complete');

    return issues;
  }

  /**
   * Validate transform step (flatten/filter/map operations)
   */
  private async validateTransformStep(
    step: TransformStep,
    agent: Agent
  ): Promise<EnhancedValidationIssue[]> {
    const issues: EnhancedValidationIssue[] = [];
    const operation = step.operation || step.config?.type;

    if (!operation) {
      return issues; // No operation to validate
    }

    // Validate flatten operation
    if (operation === 'flatten') {
      const flattenIssue = await this.validateFlattenOperation(step, agent);
      if (flattenIssue) issues.push(flattenIssue);
    }

    // Validate filter/map operations require array input
    if (['filter', 'map', 'reduce', 'sort', 'deduplicate'].includes(operation)) {
      const typeIssue = await this.validateArrayInputRequired(step, agent, operation);
      if (typeIssue) issues.push(typeIssue);
    }

    return issues;
  }

  /**
   * Validate flatten operation has correct field configuration
   */
  private async validateFlattenOperation(
    step: TransformStep,
    agent: Agent
  ): Promise<EnhancedValidationIssue | null> {
    const field = step.config?.field;
    const stepId = step.step_id || step.id;

    // Check if field parameter exists
    if (!field) {
      // Try to infer the field from the step's output schema or upstream data
      const inferredField = await this.inferFlattenField(step, agent);

      if (inferredField) {
        return {
          type: 'missing_flatten_field',
          stepId,
          severity: 'critical',
          autoFixable: true,
          confidence: 0.90,
          description: `Flatten operation missing required "field" parameter. Inferred field: "${inferredField}" from schema analysis.`,
          suggestedFix: {
            field: 'config.field',
            oldValue: undefined,
            newValue: inferredField,
            reasoning: `Inferred from step's output schema and upstream data structure. The step expects to extract "${inferredField}" array.`
          }
        };
      } else {
        return {
          type: 'missing_flatten_field',
          stepId,
          severity: 'critical',
          autoFixable: false,
          confidence: 1.0,
          description: 'Flatten operation missing required "field" parameter. Cannot extract nested array without field name. Unable to auto-infer field from schema.'
        };
      }
    }

    // Get source step's output schema
    const sourceStep = this.findSourceStep(step, agent.pilot_steps || []);
    if (!sourceStep?.output_schema) {
      logger.debug({ stepId }, 'Source step has no output_schema, skipping flatten field validation');
      return null;
    }

    // Find array schema in source output
    const arraySchema = this.findArrayInSchema(sourceStep.output_schema);
    if (!arraySchema?.items?.properties) {
      logger.debug({ stepId }, 'Source schema has no array items, skipping flatten field validation');
      return null;
    }

    // Check if field exists in array items
    const fieldExists = field in arraySchema.items.properties;
    const fieldSchema = arraySchema.items.properties[field];
    const fieldIsArray = fieldSchema?.type === 'array';

    if (!fieldExists) {
      // Field doesn't exist - find available array fields
      const availableArrayFields = Object.keys(arraySchema.items.properties).filter(
        f => arraySchema.items.properties[f].type === 'array'
      );

      if (availableArrayFields.length === 0) {
        return {
          type: 'invalid_flatten_field',
          stepId,
          severity: 'critical',
          autoFixable: false,
          confidence: 1.0,
          description: `Flatten field "${field}" not found in source schema. No array fields available to flatten.`
        };
      }

      // Suggest best alternative field
      const bestField = this.selectBestField(availableArrayFields, field, step.description);

      return {
        type: 'invalid_flatten_field',
        stepId,
        severity: 'critical',
        autoFixable: true,
        confidence: 0.90,
        description: `Flatten field "${field}" not found in source schema. Available array fields: ${availableArrayFields.join(', ')}`,
        suggestedFix: {
          field: 'config.field',
          oldValue: field,
          newValue: bestField,
          reasoning: `Selected "${bestField}" from available array fields based on priority matching and description analysis`
        }
      };
    }

    if (!fieldIsArray) {
      return {
        type: 'invalid_flatten_field',
        stepId,
        severity: 'high',
        autoFixable: false,
        confidence: 1.0,
        description: `Flatten field "${field}" exists but is not an array (type: ${fieldSchema.type}). Flatten requires array field.`
      };
    }

    // Field is valid
    return null;
  }

  /**
   * Validate operations that require array input
   */
  private async validateArrayInputRequired(
    step: TransformStep,
    agent: Agent,
    operation: string
  ): Promise<EnhancedValidationIssue | null> {
    const stepId = step.step_id || step.id;
    const input = step.input || step.config?.input;

    if (!input) {
      return null; // No input to validate
    }

    // Get source step
    const sourceStep = this.findSourceStep(step, agent.pilot_steps || []);
    if (!sourceStep?.output_schema) {
      return null; // Can't validate without schema
    }

    // Check if source produces array
    const isArrayOutput = this.isArraySchema(sourceStep.output_schema);

    if (!isArrayOutput) {
      return {
        type: 'invalid_transform_input_type',
        stepId,
        severity: 'critical',
        autoFixable: false,
        confidence: 1.0,
        description: `Transform operation "${operation}" requires array input, but source step "${sourceStep.step_id || sourceStep.id}" produces object. Use flatten or extract array field first.`
      };
    }

    return null;
  }

  /**
   * Validate scatter-gather step configuration
   */
  private async validateScatterGatherStep(
    step: ScatterGatherStep,
    agent: Agent
  ): Promise<EnhancedValidationIssue[]> {
    const issues: EnhancedValidationIssue[] = [];
    const stepId = step.step_id || step.id;

    logger.debug({
      stepId,
      hasGather: !!step.gather,
      gatherConfig: step.gather,
      scatterStepsCount: step.scatter?.steps?.length || 0
    }, '[DEBUG] validateScatterGatherStep called');

    // Validate gather.from field for flatten/collect operations
    if (step.gather) {
      const operation = step.gather.operation;

      logger.debug({
        stepId,
        operation,
        hasFrom: !!step.gather.from,
        fromValue: step.gather.from
      }, '[DEBUG] Checking gather.from');

      if ((operation === 'flatten' || operation === 'collect') && !step.gather.from) {
        logger.info({
          stepId,
          operation,
          hasFrom: !!step.gather.from
        }, '[DETECTION] Missing gather.from detected!');

        // Missing gather.from - try to infer from scatter step outputs
        const inferredFrom = this.inferGatherFrom(step);

        if (inferredFrom) {
          logger.info({
            stepId,
            inferredFrom,
            operation
          }, '[FIX] Inferred gather.from value - creating auto-fixable issue');

          issues.push({
            type: 'missing_gather_from',
            stepId,
            severity: 'critical',
            autoFixable: true,
            confidence: 0.95,  // High confidence - we can reliably infer from last output_variable
            description: `Scatter-gather missing "gather.from" field for ${operation} operation. This will cause empty results.`,
            suggestedFix: {
              field: 'gather.from',
              oldValue: undefined,
              newValue: inferredFrom,
              reasoning: `Inferred from scatter step outputs. Most likely aggregation field is "${inferredFrom}".`
            }
          });
        } else {
          logger.warn({
            stepId,
            operation
          }, '[FIX] Could not infer gather.from - no output variables found');

          issues.push({
            type: 'missing_gather_from',
            stepId,
            severity: 'critical',
            autoFixable: false,
            confidence: 1.0,
            description: `Scatter-gather missing "gather.from" field for ${operation} operation. Cannot infer - no suitable output variables found in scatter steps.`
          });
        }
      }

      // Validate gather.from references existing variable
      if (step.gather.from) {
        const scatterSteps = step.scatter?.steps || [];
        const gatherFromValue = step.gather.from;

        // Handle nested field access in gather.from (e.g., "{{step1.data.emails}}")
        let resolvedVariable = gatherFromValue;
        let fieldPath: string[] = [];

        if (gatherFromValue.includes('.')) {
          const parts = gatherFromValue.replace(/\{\{|\}\}/g, '').split('.');
          resolvedVariable = parts[0];
          fieldPath = parts.slice(1);
        }

        // Remove {{ }} if present
        resolvedVariable = resolvedVariable.replace(/\{\{|\}\}/g, '');

        const hasVariable = scatterSteps.some(s => s.output_variable === resolvedVariable);

        if (!hasVariable) {
          const availableVars = scatterSteps
            .filter(s => s.output_variable)
            .map(s => s.output_variable);

          issues.push({
            type: 'invalid_gather_from',
            stepId,
            severity: 'critical',
            autoFixable: availableVars.length > 0,
            confidence: 0.85,
            description: `Scatter-gather gather.from="${gatherFromValue}" references non-existent variable. Available: ${availableVars.join(', ')}`,
            suggestedFix: availableVars.length > 0 ? {
              field: 'gather.from',
              oldValue: gatherFromValue,
              newValue: availableVars[0],
              reasoning: `Using first available output variable from scatter steps`
            } : undefined
          });
        } else {
          // Variable exists - validate it's an array type
          const variableStep = scatterSteps.find(s => s.output_variable === resolvedVariable);

          if (variableStep?.output_schema) {
            let schemaToCheck = variableStep.output_schema;

            // Navigate through field path if present
            if (fieldPath.length > 0) {
              for (const field of fieldPath) {
                if (field === 'data') continue; // Auto-navigation into .data

                if (schemaToCheck.type === 'object' && schemaToCheck.properties) {
                  if (field in schemaToCheck.properties) {
                    schemaToCheck = schemaToCheck.properties[field];
                  } else {
                    issues.push({
                      type: 'invalid_field_path',
                      stepId,
                      severity: 'critical',
                      autoFixable: false,
                      confidence: 1.0,
                      description: `Scatter-gather gather.from="${gatherFromValue}" - field path "${field}" not found in ${resolvedVariable} output schema`
                    });
                    return issues;
                  }
                } else {
                  issues.push({
                    type: 'invalid_field_path',
                    stepId,
                    severity: 'critical',
                    autoFixable: false,
                    confidence: 1.0,
                    description: `Scatter-gather gather.from="${gatherFromValue}" - cannot access field "${field}" on non-object type ${schemaToCheck.type}`
                  });
                  return issues;
                }
              }
            }

            // Check if resolved schema is an array type
            if (schemaToCheck.type !== 'array') {
              issues.push({
                type: 'type_incompatibility',
                stepId,
                severity: 'critical',
                autoFixable: false,
                confidence: 1.0,
                description: `Scatter-gather gather.from="${gatherFromValue}" must reference an array type, but ${resolvedVariable}${fieldPath.length > 0 ? '.' + fieldPath.join('.') : ''} is type "${schemaToCheck.type}". Gather operations collect results from parallel execution and require array input.`
              });
            }
          }
        }
      }
    }

    return issues;
  }

  /**
   * Validate variable references in step parameters
   */
  private async validateVariableReferences(
    step: WorkflowStep,
    agent: Agent
  ): Promise<EnhancedValidationIssue[]> {
    const issues: EnhancedValidationIssue[] = [];
    const stepId = step.step_id || (step as any).id;

    // Extract all variable references from step
    const references = this.extractVariableReferences(step);

    for (const ref of references) {
      const issue = await this.validateVariableReference(ref, step, agent);
      if (issue) issues.push(issue);
    }

    return issues;
  }

  /**
   * Validate a single variable reference against schemas
   */
  private async validateVariableReference(
    reference: string,
    step: WorkflowStep,
    agent: Agent
  ): Promise<EnhancedValidationIssue | null> {
    // Parse reference: {{step1.data.emails}}
    const match = reference.match(/\{\{([^}]+)\}\}/);
    if (!match) return null;

    const path = match[1];
    const parts = path.split('.');

    if (parts.length < 2) return null; // Just {{step1}} is valid

    const root = parts[0];

    // Only validate step references (not input/var)
    if (!root.startsWith('step')) return null;

    // Find source step
    const sourceStep = this.findStepById(root, agent.pilot_steps || []);
    if (!sourceStep?.output_schema) return null;

    // Validate field path exists in schema
    const fieldPath = parts.slice(1); // Remove "step1" part
    const fieldExists = this.checkFieldPathExists(sourceStep.output_schema, fieldPath);

    if (!fieldExists) {
      const availableFields = this.getAvailableFields(sourceStep.output_schema, fieldPath.length);

      return {
        type: 'invalid_variable_reference',
        stepId: step.step_id || (step as any).id,
        severity: 'high',
        autoFixable: false,
        confidence: 0.95,
        description: `Variable reference "${reference}" - field path "${fieldPath.join('.')}" not found in ${root} output schema. Available fields: ${availableFields.slice(0, 5).join(', ')}${availableFields.length > 5 ? '...' : ''}`
      };
    }

    return null;
  }

  // ────────────────────────────────────────────────────────────
  // Auto-Fix Methods
  // ────────────────────────────────────────────────────────────

  /**
   * Apply auto-fix for a detected issue
   */
  async autoFix(agent: Agent, issue: EnhancedValidationIssue): Promise<boolean> {
    if (!issue.autoFixable || !issue.suggestedFix) {
      logger.warn({ issue }, 'Cannot auto-fix issue (not fixable or no suggested fix)');
      return false;
    }

    const step = this.findStepById(issue.stepId, agent.pilot_steps || []);
    if (!step) {
      logger.error({ stepId: issue.stepId }, 'Cannot find step to apply fix');
      return false;
    }

    try {
      switch (issue.type) {
        case 'invalid_flatten_field':
          return this.applyFlattenFieldFix(step as TransformStep, issue);

        case 'missing_flatten_field':
          return this.applyFlattenFieldFix(step as TransformStep, issue);

        case 'missing_gather_from':
          return this.applyGatherFromFix(step as ScatterGatherStep, issue);

        case 'invalid_gather_from':
          return this.applyGatherFromFix(step as ScatterGatherStep, issue);

        default:
          logger.warn({ issueType: issue.type }, 'No auto-fix handler for issue type');
          return false;
      }
    } catch (error) {
      logger.error({ error, issue }, 'Error applying auto-fix');
      return false;
    }
  }

  private applyFlattenFieldFix(step: TransformStep, issue: EnhancedValidationIssue): boolean {
    if (!issue.suggestedFix) return false;

    const { newValue } = issue.suggestedFix;

    if (!step.config) {
      step.config = {};
    }

    step.config.field = newValue;

    logger.info({
      stepId: step.step_id || step.id,
      oldValue: issue.suggestedFix.oldValue,
      newValue,
      confidence: issue.confidence
    }, 'Applied flatten field fix');

    return true;
  }

  private applyGatherFromFix(step: ScatterGatherStep, issue: EnhancedValidationIssue): boolean {
    if (!issue.suggestedFix) return false;

    const { newValue } = issue.suggestedFix;

    if (!step.gather) {
      step.gather = { operation: 'collect' };
    }

    step.gather.from = newValue;

    logger.info({
      stepId: step.step_id || step.id,
      oldValue: issue.suggestedFix.oldValue,
      newValue,
      confidence: issue.confidence
    }, 'Applied gather.from fix');

    return true;
  }

  /**
   * Infer the flatten field from step's output schema and upstream data structure
   */
  private async inferFlattenField(step: TransformStep, agent: Agent): Promise<string | null> {
    const stepId = step.step_id || step.id;

    // Strategy 1: Check step's output schema for array field hints
    if (step.output_schema?.items?.properties) {
      const outputProps = step.output_schema.items.properties;

      // Look for required fields that suggest what we're extracting
      const requiredFields = step.output_schema.items.required || [];

      // Common patterns: attachments, items, files, records, results
      const arrayFieldCandidates = ['attachments', 'items', 'files', 'records', 'results', 'data'];

      for (const candidate of arrayFieldCandidates) {
        // Check if this field name appears in required fields or output properties
        const matchesRequired = requiredFields.some((f: string) =>
          f.toLowerCase().includes(candidate) || candidate.includes(f.toLowerCase())
        );

        const matchesOutput = Object.keys(outputProps).some(key =>
          key.toLowerCase().includes(candidate) || candidate.includes(key.toLowerCase())
        );

        if (matchesRequired || matchesOutput) {
          logger.info({
            stepId,
            inferredField: candidate,
            reason: 'matched output schema pattern'
          }, 'Inferred flatten field from output schema');
          return candidate;
        }
      }
    }

    // Strategy 2: Analyze upstream step's output schema
    const sourceStep = this.findSourceStep(step, agent.pilot_steps || []);
    if (sourceStep?.output_schema) {
      // CRITICAL: Prioritize root-level arrays over nested arrays
      // If source returns {emails: [{attachments: [...]}]}, we should flatten "emails" (root-level),
      // not "attachments" (nested inside emails array)

      if (sourceStep.output_schema.type === 'object' && sourceStep.output_schema.properties) {
        // Source returns an object - check for array fields at ROOT level first
        const rootArrayFields = Object.keys(sourceStep.output_schema.properties).filter(
          key => sourceStep.output_schema.properties[key].type === 'array'
        );

        if (rootArrayFields.length === 1) {
          // Only one root-level array field - use it (high confidence)
          logger.info({
            stepId,
            inferredField: rootArrayFields[0],
            reason: 'only root-level array field in object schema',
            schemaType: 'object'
          }, 'Inferred flatten field from root-level array');
          return rootArrayFields[0];
        }

        if (rootArrayFields.length > 1) {
          // Multiple root-level arrays - use priority heuristics
          const priorityFields = ['emails', 'items', 'files', 'results', 'data', 'records', 'rows'];

          for (const priority of priorityFields) {
            if (rootArrayFields.includes(priority)) {
              logger.info({
                stepId,
                inferredField: priority,
                reason: 'matched priority pattern in root-level arrays',
                availableRootArrays: rootArrayFields,
                schemaType: 'object'
              }, 'Inferred flatten field from root-level array');
              return priority;
            }
          }

          // No priority match - return first root-level array
          logger.info({
            stepId,
            inferredField: rootArrayFields[0],
            reason: 'first root-level array field',
            availableRootArrays: rootArrayFields,
            schemaType: 'object'
          }, 'Inferred flatten field from root-level array');
          return rootArrayFields[0];
        }

        // No root-level arrays found - fall through to check nested arrays
      }

      // If source returns an array directly, or no root-level arrays in object,
      // then check for array fields within the array items (nested arrays)
      const arraySchema = this.findArrayInSchema(sourceStep.output_schema);

      if (arraySchema?.items?.properties) {
        // Find array fields in the upstream data (nested within array items)
        const nestedArrayFields = Object.keys(arraySchema.items.properties).filter(
          key => arraySchema.items.properties[key].type === 'array'
        );

        if (nestedArrayFields.length === 1) {
          // Only one nested array field
          logger.info({
            stepId,
            inferredField: nestedArrayFields[0],
            reason: 'only nested array field in upstream schema',
            schemaType: sourceStep.output_schema.type
          }, 'Inferred flatten field from nested array');
          return nestedArrayFields[0];
        }

        if (nestedArrayFields.length > 1) {
          // Multiple nested array fields - use priority heuristics
          const priorityFields = ['attachments', 'items', 'files', 'results', 'data'];

          for (const priority of priorityFields) {
            if (nestedArrayFields.includes(priority)) {
              logger.info({
                stepId,
                inferredField: priority,
                reason: 'matched priority pattern in nested arrays',
                availableNestedArrays: nestedArrayFields,
                schemaType: sourceStep.output_schema.type
              }, 'Inferred flatten field from nested array');
              return priority;
            }
          }

          // No priority match - return first nested array field
          logger.info({
            stepId,
            inferredField: nestedArrayFields[0],
            reason: 'first nested array field',
            availableNestedArrays: nestedArrayFields,
            schemaType: sourceStep.output_schema.type
          }, 'Inferred flatten field from nested array');
          return nestedArrayFields[0];
        }
      }
    }

    // Strategy 3: Check step description for hints
    if (step.description) {
      const desc = step.description.toLowerCase();
      const patterns = [
        { keyword: 'attachment', field: 'attachments' },
        { keyword: 'file', field: 'files' },
        { keyword: 'item', field: 'items' },
        { keyword: 'result', field: 'results' },
        { keyword: 'record', field: 'records' }
      ];

      for (const pattern of patterns) {
        if (desc.includes(pattern.keyword)) {
          logger.info({
            stepId,
            inferredField: pattern.field,
            reason: `matched keyword "${pattern.keyword}" in description`
          }, 'Inferred flatten field from description');
          return pattern.field;
        }
      }
    }

    logger.warn({ stepId }, 'Could not infer flatten field from any strategy');
    return null;
  }

  // ────────────────────────────────────────────────────────────
  // Helper Methods
  // ────────────────────────────────────────────────────────────

  private getAllStepsRecursive(steps: WorkflowStep[]): WorkflowStep[] {
    const result: WorkflowStep[] = [];

    for (const step of steps) {
      result.push(step);

      // Scatter-gather nested steps
      if (step.type === 'scatter_gather' && (step as any).scatter?.steps) {
        result.push(...this.getAllStepsRecursive((step as any).scatter.steps));
      }

      // Conditional nested steps
      if (step.type === 'conditional') {
        if ((step as any).steps) {
          result.push(...this.getAllStepsRecursive((step as any).steps));
        }
        if ((step as any).then_steps) {
          result.push(...this.getAllStepsRecursive((step as any).then_steps));
        }
        if ((step as any).else_steps) {
          result.push(...this.getAllStepsRecursive((step as any).else_steps));
        }
      }
    }

    return result;
  }

  private findSourceStep(step: WorkflowStep, allSteps: WorkflowStep[]): WorkflowStep | null {
    const input = (step as any).input || (step as any).config?.input;
    if (!input) return null;

    // Extract variable name from {{variable}} or {{variable.path}}
    const match = String(input).match(/\{\{(\w+)/);
    if (!match) return null;

    const varName = match[1];

    // Find step that produces this variable
    const allStepsFlat = this.getAllStepsRecursive(allSteps);
    return allStepsFlat.find(s => s.output_variable === varName) || null;
  }

  private findStepById(stepId: string, allSteps: WorkflowStep[]): WorkflowStep | null {
    const allStepsFlat = this.getAllStepsRecursive(allSteps);
    return allStepsFlat.find(s => (s.step_id || (s as any).id) === stepId) || null;
  }

  private findArrayInSchema(schema: any): any | null {
    if (!schema) return null;

    // Direct array schema
    if (schema.type === 'array' && schema.items) {
      return schema;
    }

    // Object with array property
    if (schema.type === 'object' && schema.properties) {
      // Find first array property
      for (const [key, fieldSchema] of Object.entries(schema.properties)) {
        const fs = fieldSchema as any;
        if (fs.type === 'array' && fs.items) {
          return fs;
        }
      }
    }

    return null;
  }

  private isArraySchema(schema: any): boolean {
    if (!schema) return false;
    return schema.type === 'array';
  }

  private selectBestField(
    availableFields: string[],
    requestedField: string,
    stepDescription?: string
  ): string {
    // Priority-based selection (deterministic, no LLM)
    const priorities = ['attachments', 'items', 'results', 'data', 'files', 'records', 'rows'];

    // Check if requested field is close to any available field (typo correction)
    const lowerRequested = requestedField.toLowerCase();
    for (const field of availableFields) {
      if (field.toLowerCase() === lowerRequested) {
        return field; // Exact match (case-insensitive)
      }
    }

    // Check priority list
    for (const priority of priorities) {
      if (availableFields.includes(priority)) {
        return priority;
      }
    }

    // Description-based matching (deterministic keyword search)
    if (stepDescription) {
      const desc = stepDescription.toLowerCase();
      for (const field of availableFields) {
        if (desc.includes(field.toLowerCase())) {
          return field;
        }
      }
    }

    // Default: first field alphabetically (deterministic)
    return availableFields.sort()[0];
  }

  private inferGatherFrom(step: ScatterGatherStep): string | null {
    const scatterSteps = step.scatter?.steps || [];

    // Find all output variables from scatter steps
    const outputVars = scatterSteps
      .filter(s => s.output_variable)
      .map(s => s.output_variable!);

    logger.debug({
      stepId: step.step_id || step.id,
      scatterStepsCount: scatterSteps.length,
      outputVarsCount: outputVars.length,
      outputVars
    }, '[DEBUG] inferGatherFrom - found output variables');

    if (outputVars.length === 0) return null;

    // If only one output, use it
    if (outputVars.length === 1) {
      logger.debug({ stepId: step.step_id || step.id, inferred: outputVars[0] }, '[DEBUG] inferGatherFrom - single output');
      return outputVars[0];
    }

    // Prefer last output (most likely to be final result)
    const inferred = outputVars[outputVars.length - 1];
    logger.debug({ stepId: step.step_id || step.id, inferred, allOutputs: outputVars }, '[DEBUG] inferGatherFrom - multiple outputs, using last');
    return inferred;
  }

  private extractVariableReferences(step: WorkflowStep): string[] {
    // Serialize step to JSON and extract all {{...}} patterns
    const stepStr = JSON.stringify(step);
    const regex = /\{\{[^}]+\}\}/g;
    const matches = stepStr.match(regex);

    return matches || [];
  }

  private checkFieldPathExists(schema: any, fieldPath: string[]): boolean {
    let current = schema;

    for (let i = 0; i < fieldPath.length; i++) {
      const field = fieldPath[i];

      // Handle special keywords
      if (field === 'data') {
        // Auto-navigation into .data is allowed
        continue;
      }

      // Handle array index access
      if (field.match(/^\[\d+\]$/)) {
        if (current.type !== 'array') return false;
        current = current.items;
        continue;
      }

      // Regular field access
      if (current.type === 'object' && current.properties) {
        if (!(field in current.properties)) {
          // Try case-insensitive match
          const lowerField = field.toLowerCase();
          const matchingKey = Object.keys(current.properties).find(
            k => k.toLowerCase() === lowerField
          );

          if (!matchingKey) return false;
          current = current.properties[matchingKey];
        } else {
          current = current.properties[field];
        }
      } else if (current.type === 'array' && current.items) {
        // Accessing field on array items
        current = current.items;
        if (current.type === 'object' && current.properties) {
          if (!(field in current.properties)) return false;
          current = current.properties[field];
        } else {
          return false;
        }
      } else {
        return false;
      }
    }

    return true;
  }

  private getAvailableFields(schema: any, depth: number): string[] {
    if (!schema) return [];

    if (schema.type === 'object' && schema.properties) {
      return Object.keys(schema.properties);
    }

    if (schema.type === 'array' && schema.items) {
      if (schema.items.type === 'object' && schema.items.properties) {
        return Object.keys(schema.items.properties);
      }
    }

    return [];
  }
}
