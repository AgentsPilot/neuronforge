/**
 * Runtime Validator for Pilot Workflow Structures
 *
 * Validates workflow steps AFTER LLM generation but BEFORE saving to database.
 * This catches semantic errors that OpenAI's schema validation cannot detect.
 *
 * Validation includes:
 * - Type-specific required fields (e.g., loop must have iterateOver and loopSteps)
 * - Step ID references (dependencies, branch IDs, case step IDs)
 * - Nesting depth limits (≤ 5 levels)
 * - Duplicate step IDs
 * - Recursive structure validation
 *
 * @module lib/pilot/schema/runtime-validator
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate complete workflow structure
 * Called after LLM generation, before saving to database
 *
 * @param steps - Array of workflow steps to validate
 * @returns ValidationResult with errors and warnings
 */
export function validateWorkflowStructure(steps: any[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!steps || !Array.isArray(steps)) {
    return {
      valid: false,
      errors: ['Workflow steps must be an array'],
      warnings: []
    };
  }

  if (steps.length === 0) {
    return {
      valid: false,
      errors: ['Workflow must contain at least one step'],
      warnings: []
    };
  }

  // Collect all step IDs for reference validation
  const allStepIds = new Set<string>();
  collectAllStepIds(steps, allStepIds);

  // Check for duplicate IDs
  const duplicates = findDuplicateIds(steps);
  duplicates.forEach(id => {
    errors.push(`Duplicate step ID found: "${id}"`);
  });

  // Validate each step
  steps.forEach((step, index) => {
    const stepErrors = validateWorkflowStep(step, allStepIds, `workflow_steps[${index}]`);
    errors.push(...stepErrors);
  });

  // Validate nesting depth
  const depthResult = validateNestingDepth(steps, 0);
  errors.push(...depthResult.errors);
  warnings.push(...depthResult.warnings);

  // Validate AI processing patterns (warnings only)
  const aiPatternWarnings = validateAIProcessingPatterns(steps);
  warnings.push(...aiPatternWarnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate a single workflow step based on its type
 *
 * @param step - Step to validate
 * @param allStepIds - Set of all step IDs in the workflow
 * @param path - Path to this step (for error messages)
 * @returns Array of error messages
 */
function validateWorkflowStep(
  step: any,
  allStepIds: Set<string>,
  path: string
): string[] {
  const errors: string[] = [];

  // Universal required fields
  if (!step.type) {
    errors.push(`${path}: Missing required field "type"`);
    return errors; // Can't validate further without type
  }

  if (!step.id) {
    errors.push(`${path}: Missing required field "id"`);
  }

  if (!step.name) {
    errors.push(`${path}: Missing required field "name"`);
  }

  // Validate dependencies
  if (step.dependencies && Array.isArray(step.dependencies)) {
    step.dependencies.forEach((depId: string, idx: number) => {
      if (!allStepIds.has(depId)) {
        errors.push(`${path}.dependencies[${idx}]: References non-existent step "${depId}"`);
      }
    });
  }

  // Validate executeIf condition if present
  if (step.executeIf) {
    const condErrors = validateCondition(step.executeIf, `${path}.executeIf`);
    errors.push(...condErrors);
  }

  // Type-specific validation
  switch (step.type) {
    case 'action':
      if (!step.plugin) errors.push(`${path}: Action step missing required field "plugin"`);
      if (!step.action) errors.push(`${path}: Action step missing required field "action"`);

      // Validate plugin action exists
      if (step.plugin && step.action) {
        const pluginActionErrors = validatePluginAction(step.plugin, step.action);
        errors.push(...pluginActionErrors.map(err => `${path}: ${err}`));
      }
      // params is optional - some actions don't require parameters
      // Validation of required params happens elsewhere
      break;

    case 'ai_processing':
    case 'llm_decision':
      // prompt and params are optional for these types
      break;

    case 'conditional':
      if (!step.condition) {
        errors.push(`${path}: Conditional step missing required field "condition"`);
      } else {
        const condErrors = validateCondition(step.condition, `${path}.condition`);
        errors.push(...condErrors);

        // Validate operator semantics (warnings only)
        const semanticWarnings = validateOperatorSemantics(step.condition);
        // Note: warnings are not added to errors, they would need to be returned separately
      }
      // Validate branch references
      if (step.trueBranch && !allStepIds.has(step.trueBranch)) {
        errors.push(`${path}.trueBranch: References non-existent step "${step.trueBranch}"`);
      }
      if (step.falseBranch && !allStepIds.has(step.falseBranch)) {
        errors.push(`${path}.falseBranch: References non-existent step "${step.falseBranch}"`);
      }
      break;

    case 'loop':
      if (!step.iterateOver) {
        errors.push(`${path}: Loop step missing required field "iterateOver"`);
      }
      if (!step.loopSteps) {
        errors.push(`${path}: Loop step missing required field "loopSteps"`);
      } else if (!Array.isArray(step.loopSteps)) {
        errors.push(`${path}.loopSteps: Must be an array`);
      } else {
        // Recursively validate nested steps
        step.loopSteps.forEach((nestedStep: any, idx: number) => {
          const nestedErrors = validateWorkflowStep(
            nestedStep,
            allStepIds,
            `${path}.loopSteps[${idx}]`
          );
          errors.push(...nestedErrors);
        });
      }
      if (step.maxIterations !== undefined) {
        if (typeof step.maxIterations !== 'number' || step.maxIterations < 1) {
          errors.push(`${path}.maxIterations: Must be a positive number`);
        }
      }
      break;

    case 'parallel_group':
    case 'parallel':
      if (!step.steps) {
        errors.push(`${path}: Parallel step missing required field "steps"`);
      } else if (!Array.isArray(step.steps)) {
        errors.push(`${path}.steps: Must be an array`);
      } else {
        // Recursively validate nested steps
        step.steps.forEach((nestedStep: any, idx: number) => {
          const nestedErrors = validateWorkflowStep(
            nestedStep,
            allStepIds,
            `${path}.steps[${idx}]`
          );
          errors.push(...nestedErrors);
        });
      }
      break;

    case 'switch':
      if (!step.evaluate) {
        errors.push(`${path}: Switch step missing required field "evaluate"`);
      }
      if (!step.cases) {
        errors.push(`${path}: Switch step missing required field "cases"`);
      } else if (typeof step.cases !== 'object') {
        errors.push(`${path}.cases: Must be an object`);
      } else {
        // Validate all case step IDs exist
        Object.entries(step.cases).forEach(([caseValue, stepIds]: [string, any]) => {
          if (!Array.isArray(stepIds)) {
            errors.push(`${path}.cases["${caseValue}"]: Must be an array of step IDs`);
          } else {
            stepIds.forEach((stepId: string, idx: number) => {
              if (typeof stepId !== 'string') {
                errors.push(`${path}.cases["${caseValue}"][${idx}]: Must be a string (step ID)`);
              } else if (!allStepIds.has(stepId)) {
                errors.push(`${path}.cases["${caseValue}"][${idx}]: References non-existent step "${stepId}"`);
              }
            });
          }
        });
      }
      // Validate default case if present
      if (step.default) {
        if (!Array.isArray(step.default)) {
          errors.push(`${path}.default: Must be an array of step IDs`);
        } else {
          step.default.forEach((stepId: string, idx: number) => {
            if (!allStepIds.has(stepId)) {
              errors.push(`${path}.default[${idx}]: References non-existent step "${stepId}"`);
            }
          });
        }
      }
      break;

    case 'scatter_gather':
      if (!step.scatter) {
        errors.push(`${path}: Scatter-gather step missing required field "scatter"`);
      } else {
        if (!step.scatter.input) {
          errors.push(`${path}.scatter: Missing required field "input"`);
        }
        if (!step.scatter.steps) {
          errors.push(`${path}.scatter: Missing required field "steps"`);
        } else if (!Array.isArray(step.scatter.steps)) {
          errors.push(`${path}.scatter.steps: Must be an array`);
        } else {
          // Recursively validate nested steps
          step.scatter.steps.forEach((nestedStep: any, idx: number) => {
            const nestedErrors = validateWorkflowStep(
              nestedStep,
              allStepIds,
              `${path}.scatter.steps[${idx}]`
            );
            errors.push(...nestedErrors);
          });
        }
      }
      if (!step.gather) {
        errors.push(`${path}: Scatter-gather step missing required field "gather"`);
      } else {
        if (!step.gather.operation) {
          errors.push(`${path}.gather: Missing required field "operation"`);
        }
      }
      break;

    case 'transform':
      if (!step.operation) {
        errors.push(`${path}: Transform step missing required field "operation"`);
      } else {
        // Validate transform operation is supported
        const transformErrors = validateTransformOperation(step.operation);
        errors.push(...transformErrors.map(err => `${path}: ${err}`));
      }
      if (!step.config) {
        errors.push(`${path}: Transform step missing required field "config"`);
      }
      break;

    case 'delay':
      if (step.duration === undefined) {
        errors.push(`${path}: Delay step missing required field "duration"`);
      } else if (typeof step.duration !== 'number' || step.duration < 0) {
        errors.push(`${path}.duration: Must be a non-negative number`);
      }
      break;

    case 'enrichment':
      if (!step.sources) {
        errors.push(`${path}: Enrichment step missing required field "sources"`);
      } else if (!Array.isArray(step.sources)) {
        errors.push(`${path}.sources: Must be an array`);
      }
      if (!step.strategy) {
        errors.push(`${path}: Enrichment step missing required field "strategy"`);
      }
      break;

    case 'validation':
      if (!step.input) {
        errors.push(`${path}: Validation step missing required field "input"`);
      }
      // schema and rules are optional, but at least one should be present
      if (!step.schema && !step.rules) {
        errors.push(`${path}: Validation step must have either "schema" or "rules"`);
      }
      break;

    case 'comparison':
      if (!step.left) {
        errors.push(`${path}: Comparison step missing required field "left"`);
      }
      if (!step.right) {
        errors.push(`${path}: Comparison step missing required field "right"`);
      }
      if (!step.operation) {
        errors.push(`${path}: Comparison step missing required field "operation"`);
      }
      break;

    case 'sub_workflow':
      if (!step.workflowId && !step.workflowSteps) {
        errors.push(`${path}: Sub-workflow step must have either "workflowId" or "workflowSteps"`);
      }
      if (step.workflowSteps) {
        if (!Array.isArray(step.workflowSteps)) {
          errors.push(`${path}.workflowSteps: Must be an array`);
        } else {
          // Recursively validate nested steps
          step.workflowSteps.forEach((nestedStep: any, idx: number) => {
            const nestedErrors = validateWorkflowStep(
              nestedStep,
              allStepIds,
              `${path}.workflowSteps[${idx}]`
            );
            errors.push(...nestedErrors);
          });
        }
      }
      if (!step.inputs) {
        errors.push(`${path}: Sub-workflow step missing required field "inputs"`);
      }
      break;

    case 'human_approval':
      if (!step.approvers || !Array.isArray(step.approvers) || step.approvers.length === 0) {
        errors.push(`${path}: Human approval step missing required field "approvers" (must be non-empty array)`);
      }
      if (!step.approvalType) {
        errors.push(`${path}: Human approval step missing required field "approvalType"`);
      }
      if (!step.title) {
        errors.push(`${path}: Human approval step missing required field "title"`);
      }
      break;

    case 'deterministic_extraction':
      // Deterministic extraction step: Extract data from documents without LLM
      // Uses pdf-parse for text PDFs, AWS Textract for scanned documents
      if (!step.input) {
        errors.push(`${path}: Deterministic extraction step missing required field "input"`);
      }
      // output_schema is optional but if present, validate structure
      // Supports three types:
      // - object: output_schema.fields[] (single record per document)
      // - array: output_schema.items.fields[] (multiple items per document)
      // - string: output_schema.description (summary/text output)
      if (step.output_schema) {
        const schemaType = step.output_schema.type || 'object';
        const hasFields = step.output_schema.fields && Array.isArray(step.output_schema.fields);
        const hasItemsFields = step.output_schema.items?.fields && Array.isArray(step.output_schema.items.fields);
        const hasDescription = typeof step.output_schema.description === 'string';

        if (schemaType === 'object' && !hasFields) {
          errors.push(`${path}: output_schema with type "object" must contain a "fields" array`);
        } else if (schemaType === 'array' && !hasItemsFields) {
          errors.push(`${path}: output_schema with type "array" must contain "items.fields" array`);
        } else if (schemaType === 'string' && !hasDescription && !hasFields) {
          // String type can have description or be used for classification with enum
          // No strict validation needed - description is optional
        } else if (!hasFields && !hasItemsFields && !hasDescription) {
          errors.push(`${path}: output_schema must contain "fields" array (for object type), "items.fields" array (for array type), or "description" (for string type)`);
        }
      }
      // document_type is optional, validated by enum in schema
      // ocr_fallback is optional boolean
      break;

    default:
      errors.push(`${path}: Unknown step type "${step.type}"`);
  }

  return errors;
}

/**
 * Validate a condition structure
 *
 * @param condition - Condition to validate
 * @param path - Path to condition (for error messages)
 * @returns Array of error messages
 */
function validateCondition(condition: any, path: string): string[] {
  const errors: string[] = [];

  if (!condition) {
    errors.push(`${path}: Condition is required`);
    return errors;
  }

  if (typeof condition === 'string') {
    // String expression - can't validate syntax, but check it's not empty
    if (condition.trim().length === 0) {
      errors.push(`${path}: String condition cannot be empty`);
    }
    return errors;
  }

  if (typeof condition !== 'object') {
    errors.push(`${path}: Condition must be an object or string`);
    return errors;
  }

  // Check if it's a simple condition (field + operator + value)
  const hasSimpleFields = condition.field || condition.operator || condition.value !== undefined;

  // Check if it's a complex condition (and/or/not)
  const hasComplexFields = condition.and || condition.or || condition.not;

  if (!hasSimpleFields && !hasComplexFields) {
    errors.push(`${path}: Condition must have either (field, operator, value) or (and/or/not)`);
    return errors;
  }

  // Validate simple condition
  if (hasSimpleFields) {
    if (!condition.field) {
      errors.push(`${path}: Simple condition missing "field"`);
    }
    if (!condition.operator) {
      errors.push(`${path}: Simple condition missing "operator"`);
    }
    // value can be anything including undefined for operators like 'exists'
  }

  // Validate complex condition
  if (condition.and) {
    if (!Array.isArray(condition.and)) {
      errors.push(`${path}.and: Must be an array`);
    } else {
      condition.and.forEach((subCondition: any, idx: number) => {
        const subErrors = validateCondition(subCondition, `${path}.and[${idx}]`);
        errors.push(...subErrors);
      });
    }
  }

  if (condition.or) {
    if (!Array.isArray(condition.or)) {
      errors.push(`${path}.or: Must be an array`);
    } else {
      condition.or.forEach((subCondition: any, idx: number) => {
        const subErrors = validateCondition(subCondition, `${path}.or[${idx}]`);
        errors.push(...subErrors);
      });
    }
  }

  if (condition.not) {
    const notErrors = validateCondition(condition.not, `${path}.not`);
    errors.push(...notErrors);
  }

  return errors;
}

/**
 * Collect all step IDs from workflow (including nested steps)
 *
 * @param steps - Array of steps to collect from
 * @param ids - Set to collect IDs into
 */
function collectAllStepIds(steps: any[], ids: Set<string>): void {
  steps.forEach(step => {
    if (step.id) {
      ids.add(step.id);
    }

    // Collect from nested structures
    if (step.loopSteps && Array.isArray(step.loopSteps)) {
      collectAllStepIds(step.loopSteps, ids);
    }
    if (step.steps && Array.isArray(step.steps)) {
      collectAllStepIds(step.steps, ids);
    }
    if (step.scatter?.steps && Array.isArray(step.scatter.steps)) {
      collectAllStepIds(step.scatter.steps, ids);
    }
    if (step.workflowSteps && Array.isArray(step.workflowSteps)) {
      collectAllStepIds(step.workflowSteps, ids);
    }
  });
}

/**
 * Find duplicate step IDs in workflow
 *
 * @param steps - Array of steps to check
 * @returns Array of duplicate IDs
 */
function findDuplicateIds(steps: any[]): string[] {
  const seen = new Map<string, number>();
  const duplicates: string[] = [];

  function checkIds(stepsToCheck: any[]): void {
    stepsToCheck.forEach(step => {
      if (step.id) {
        const count = seen.get(step.id) || 0;
        seen.set(step.id, count + 1);
        if (count === 1) {
          // Second occurrence
          duplicates.push(step.id);
        }
      }

      // Check nested structures
      if (step.loopSteps && Array.isArray(step.loopSteps)) {
        checkIds(step.loopSteps);
      }
      if (step.steps && Array.isArray(step.steps)) {
        checkIds(step.steps);
      }
      if (step.scatter?.steps && Array.isArray(step.scatter.steps)) {
        checkIds(step.scatter.steps);
      }
      if (step.workflowSteps && Array.isArray(step.workflowSteps)) {
        checkIds(step.workflowSteps);
      }
    });
  }

  checkIds(steps);
  return duplicates;
}

/**
 * Validate plugin and action exist (requires PluginManagerV2 - placeholder for now)
 *
 * @param pluginName - Plugin name from step
 * @param actionName - Action name from step
 * @returns Array of error messages
 */
function validatePluginAction(pluginName: string, actionName: string): string[] {
  // TODO: This requires PluginManagerV2 instance to be passed through validation chain
  // For now, return empty array (no validation)
  // Full implementation in Phase 3 will check against actual plugin registry
  return [];
}

/**
 * Validate transform operation is supported
 *
 * @param operation - Transform operation name
 * @returns Array of error messages
 */
function validateTransformOperation(operation: string): string[] {
  const SUPPORTED_OPERATIONS = [
    'set', 'map', 'filter', 'reduce', 'sort',
    'group', 'group_by',  // group_by is alias for group
    'aggregate', 'deduplicate',
    'flatten', 'join', 'pivot', 'split', 'expand',
    'partition',  // Partition data by field value
    'rows_to_objects',  // For converting 2D arrays (like Sheets) to objects
    'map_headers',  // Normalize/rename headers in 2D arrays
    'render_table',  // For rendering data as HTML/formatted tables
    'fetch_content'  // For fetching attachment/file content from plugins
  ];

  if (!SUPPORTED_OPERATIONS.includes(operation)) {
    return [
      `Transform operation '${operation}' not supported. ` +
      `Supported operations: ${SUPPORTED_OPERATIONS.join(', ')}`
    ];
  }

  return [];
}

/**
 * Validate operator semantics (heuristic-based warnings)
 *
 * @param condition - Condition object from step
 * @returns Array of warning messages
 */
function validateOperatorSemantics(condition: any): string[] {
  const warnings: string[] = [];

  if (!condition || !condition.operator || condition.value === undefined) {
    return warnings;
  }

  const STRING_OPS = ['==', '!=', 'contains', 'starts_with', 'ends_with'];
  const NUMBER_OPS = ['>', '>=', '<', '<=', '==', '!='];

  // Heuristic: If value looks numeric, suggest number operators
  const isNumericValue = !isNaN(Number(condition.value)) && condition.value !== '';

  if (isNumericValue && condition.operator === 'contains') {
    warnings.push(
      `Using 'contains' operator with numeric value '${condition.value}'. ` +
      `Consider numeric operators: ${NUMBER_OPS.join(', ')}`
    );
  }

  // Heuristic: If value is string and using > or <, warn
  if (!isNumericValue && ['>', '<', '>=', '<='].includes(condition.operator)) {
    warnings.push(
      `Using '${condition.operator}' operator with string value '${condition.value}'. ` +
      `For strings, consider: ${STRING_OPS.join(', ')}`
    );
  }

  return warnings;
}

/**
 * Detect inefficient AI processing in loops (warning, not error)
 *
 * @param steps - Array of workflow steps
 * @param path - Path to this step (for error messages)
 * @returns Array of warning messages
 */
function validateAIProcessingPatterns(steps: any[], path: string = 'workflow'): string[] {
  const warnings: string[] = [];

  steps.forEach((step, idx) => {
    const stepPath = `${path}[${idx}]`;

    if (step.type === 'loop' && step.loopSteps) {
      const hasAI = step.loopSteps.some((s: any) => s.type === 'ai_processing');
      if (hasAI) {
        warnings.push(
          `${stepPath}.${step.id}: AI processing inside loop is inefficient (50x token cost). ` +
          `Consider processing entire array in single AI call with batch prompt.`
        );
      }

      // Recurse into loop steps
      warnings.push(...validateAIProcessingPatterns(step.loopSteps, `${stepPath}.loopSteps`));
    }

    if (step.type === 'scatter_gather' && step.scatter?.steps) {
      const hasAI = step.scatter.steps.some((s: any) => s.type === 'ai_processing');
      if (hasAI) {
        warnings.push(
          `${stepPath}.${step.id}: AI processing in scatter-gather. ` +
          `This is acceptable for parallel processing but verify it's needed (consider batch processing instead).`
        );
      }

      // Recurse into scatter steps
      warnings.push(...validateAIProcessingPatterns(step.scatter.steps, `${stepPath}.scatter.steps`));
    }

    // Recurse into nested step structures
    if (step.steps && Array.isArray(step.steps)) {
      warnings.push(...validateAIProcessingPatterns(step.steps, `${stepPath}.steps`));
    }
    if (step.workflowSteps && Array.isArray(step.workflowSteps)) {
      warnings.push(...validateAIProcessingPatterns(step.workflowSteps, `${stepPath}.workflowSteps`));
    }
  });

  return warnings;
}

/**
 * Validate nesting depth doesn't exceed maximum
 *
 * @param steps - Array of steps to check
 * @param currentDepth - Current depth level
 * @returns ValidationResult with errors and warnings
 */
function validateNestingDepth(
  steps: any[],
  currentDepth: number
): Pick<ValidationResult, 'errors' | 'warnings'> {
  const MAX_DEPTH = 5;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (currentDepth > MAX_DEPTH) {
    errors.push(`Maximum nesting depth exceeded (${MAX_DEPTH} levels). Current depth: ${currentDepth}`);
    return { errors, warnings };
  }

  if (currentDepth === MAX_DEPTH) {
    warnings.push(`Nesting depth at maximum (${MAX_DEPTH} levels). Consider simplifying workflow.`);
  }

  steps.forEach((step, idx) => {
    // Check loop nesting
    if (step.loopSteps && Array.isArray(step.loopSteps)) {
      const nestedResult = validateNestingDepth(step.loopSteps, currentDepth + 1);
      nestedResult.errors.forEach(err => {
        errors.push(`workflow_steps[${idx}].loopSteps: ${err}`);
      });
      warnings.push(...nestedResult.warnings);
    }

    // Check parallel group nesting
    if (step.steps && Array.isArray(step.steps)) {
      const nestedResult = validateNestingDepth(step.steps, currentDepth + 1);
      nestedResult.errors.forEach(err => {
        errors.push(`workflow_steps[${idx}].steps: ${err}`);
      });
      warnings.push(...nestedResult.warnings);
    }

    // Check scatter-gather nesting
    if (step.scatter?.steps && Array.isArray(step.scatter.steps)) {
      const nestedResult = validateNestingDepth(step.scatter.steps, currentDepth + 1);
      nestedResult.errors.forEach(err => {
        errors.push(`workflow_steps[${idx}].scatter.steps: ${err}`);
      });
      warnings.push(...nestedResult.warnings);
    }

    // Check sub-workflow nesting
    if (step.workflowSteps && Array.isArray(step.workflowSteps)) {
      const nestedResult = validateNestingDepth(step.workflowSteps, currentDepth + 1);
      nestedResult.errors.forEach(err => {
        errors.push(`workflow_steps[${idx}].workflowSteps: ${err}`);
      });
      warnings.push(...nestedResult.warnings);
    }
  });

  return { errors, warnings };
}

/**
 * Validate workflow structure and return user-friendly error message
 *
 * @param steps - Workflow steps to validate
 * @returns Object with validation status and user message
 */
export function validateWorkflowWithUserMessage(steps: any[]): {
  valid: boolean;
  userMessage?: string;
  technicalErrors?: string[];
} {
  const result = validateWorkflowStructure(steps);

  if (result.valid) {
    return { valid: true };
  }

  // Create user-friendly message from first error
  const firstError = result.errors[0] || 'Unknown validation error';
  let userMessage = 'Workflow validation failed. ';

  if (firstError.includes('missing required field')) {
    userMessage += 'Some steps are missing required fields. Please try rephrasing your request.';
  } else if (firstError.includes('References non-existent step')) {
    userMessage += 'Some steps reference other steps that don\'t exist. Please try simplifying your workflow.';
  } else if (firstError.includes('Duplicate step ID')) {
    userMessage += 'Some steps have duplicate IDs. Please try again.';
  } else if (firstError.includes('Maximum nesting depth exceeded')) {
    userMessage += 'Your workflow is too deeply nested. Please simplify it or break it into smaller workflows.';
  } else {
    userMessage += 'Please try simplifying your request or rephrasing it.';
  }

  return {
    valid: false,
    userMessage,
    technicalErrors: result.errors
  };
}
