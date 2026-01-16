/**
 * Post-Compilation Workflow Validator
 *
 * Validates and auto-fixes common issues in LLM-generated workflows.
 * This reduces reliance on perfect prompt engineering by catching issues
 * systematically using schema knowledge.
 */

// Simple types for validation - we only need the workflow array structure
export interface ValidationWorkflow {
  workflow: any[]; // Array of workflow steps
}

export interface ValidationIssue {
  stepId: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
  suggestion?: string;
  autoFixable: boolean;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  autoFixed: boolean;
  fixedWorkflow?: ValidationWorkflow;
}

export class WorkflowPostValidator {
  constructor(
    private pluginSchemas: Record<string, any> // Plugin definitions from PluginManager
  ) {}

  /**
   * Validate workflow and optionally auto-fix issues
   */
  validate(workflow: ValidationWorkflow, autoFix: boolean = true): ValidationResult {
    const issues: ValidationIssue[] = [];
    let fixedWorkflow = workflow;
    let autoFixed = false;

    console.log('[WorkflowPostValidator] Validating workflow with', workflow.workflow?.length || 0, 'steps');

    // Run all validation checks
    this.checkValidStepTypes(fixedWorkflow, issues);
    this.checkConditionalStepFields(fixedWorkflow, issues);
    this.checkTransformBeforeAction(fixedWorkflow, issues);
    this.checkTransformInputFields(fixedWorkflow, issues);
    this.checkVariableReferences(fixedWorkflow, issues);
    this.checkPluginParamTypes(fixedWorkflow, issues);
    this.checkDependencies(fixedWorkflow, issues);
    this.checkScatterStepVariableScoping(fixedWorkflow, issues);
    this.checkMapOperationLogic(fixedWorkflow, issues);

    console.log('[WorkflowPostValidator] Found', issues.length, 'issues:', issues.map(i => i.code));

    // Apply auto-fixes if enabled
    if (autoFix && issues.some(i => i.autoFixable)) {
      const fixResult = this.applyAutoFixes(workflow, issues);
      fixedWorkflow = fixResult.workflow;
      autoFixed = fixResult.applied;
    }

    return {
      valid: issues.filter(i => i.severity === 'error').length === 0,
      issues,
      autoFixed,
      fixedWorkflow: autoFixed ? fixedWorkflow : undefined
    };
  }

  /**
   * Rule 0: Valid Step Types
   *
   * Ensures all steps use valid step types from the PILOT DSL schema.
   *
   * Valid types (from pilot-dsl-schema.ts):
   * - action: Execute plugin actions
   * - ai_processing: AI/LLM processing operations
   * - llm_decision: LLM-based decision making
   * - transform: Data transformation operations
   * - scatter_gather: Parallel execution with gather
   * - conditional: Conditional branching
   * - loop: Iteration over collections
   * - parallel_group: Parallel execution
   * - switch: Multi-branch conditional
   * - delay: Time-based delays
   * - enrichment: Data enrichment
   * - validation: Data validation
   * - comparison: Data comparison
   * - sub_workflow: Nested workflows
   * - human_approval: Human-in-the-loop approval
   *
   * Common LLM mistakes:
   * - "ai_call" (use ai_processing or llm_decision instead)
   * - "api_call" (use action instead)
   * - "query" (use action instead)
   */
  private checkValidStepTypes(workflow: ValidationWorkflow, issues: ValidationIssue[]): void {
    const VALID_STEP_TYPES = [
      'action',
      'ai_processing',
      'llm_decision',
      'conditional',
      'loop',
      'parallel_group',
      'switch',
      'scatter_gather',
      'transform',
      'delay',
      'enrichment',
      'validation',
      'comparison',
      'sub_workflow',
      'human_approval'
    ];

    // Check both top-level steps and nested scatter steps
    const allSteps: any[] = [...workflow.workflow];

    for (const step of workflow.workflow) {
      if (step.type === 'scatter_gather') {
        const scatterStep = step as any;
        if (scatterStep.scatter?.steps) {
          allSteps.push(...scatterStep.scatter.steps);
        }
      }
    }

    for (const step of allSteps) {
      if (!step.type) {
        issues.push({
          stepId: step.id,
          severity: 'error',
          code: 'MISSING_STEP_TYPE',
          message: 'Step is missing required "type" field.',
          suggestion: `Add "type" field with one of: ${VALID_STEP_TYPES.join(', ')}`,
          autoFixable: false
        });
        continue;
      }

      if (!VALID_STEP_TYPES.includes(step.type)) {
        let suggestion = `Valid step types are: ${VALID_STEP_TYPES.join(', ')}`;

        // Provide specific suggestions for common mistakes
        if (step.type === 'ai_call') {
          suggestion = 'Use "ai_processing" for AI/LLM operations or "llm_decision" for LLM-based decisions. The DSL does not have "ai_call" - use the appropriate AI step type.';
        } else if (step.type === 'api_call') {
          suggestion = 'Use "action" type with an appropriate plugin for API calls.';
        } else if (step.type === 'query') {
          suggestion = 'Use "action" type with an appropriate plugin for queries.';
        }

        issues.push({
          stepId: step.id,
          severity: 'error',
          code: 'INVALID_STEP_TYPE',
          message: `Invalid step type "${step.type}". ${suggestion}`,
          suggestion: suggestion,
          autoFixable: false
        });
      }
    }
  }

  /**
   * Rule 1: Conditional Step Required Fields
   *
   * Ensures conditional steps have the required "condition" field.
   * This is a common LLM mistake - using type: "conditional" without providing
   * the condition logic.
   */
  private checkConditionalStepFields(workflow: ValidationWorkflow, issues: ValidationIssue[]): void {
    // Check both top-level steps and nested steps
    const allSteps: any[] = [...workflow.workflow];

    for (const step of workflow.workflow) {
      if (step.type === 'scatter_gather') {
        const scatterStep = step as any;
        if (scatterStep.scatter?.steps) {
          allSteps.push(...scatterStep.scatter.steps);
        }
      }
    }

    for (const step of allSteps) {
      if (step.type === 'conditional') {
        if (!step.condition) {
          issues.push({
            stepId: step.id,
            severity: 'error',
            code: 'MISSING_CONDITIONAL_CONDITION',
            message: 'Conditional step is missing required "condition" field.',
            suggestion: 'Add "condition" field with conditionType and appropriate fields (field, operator, value for simple conditions). For filtering/branching, consider using transform with filter operation instead.',
            autoFixable: false
          });
        }
      }
    }
  }

  /**
   * Rule 2: Transform Before Action Pattern
   *
   * Detect when action params contain config objects (expression, condition)
   * instead of variable references. Auto-fix by splitting into transform + action.
   */
  private checkTransformBeforeAction(workflow: ValidationWorkflow, issues: ValidationIssue[]): void {
    for (const step of workflow.workflow) {
      if (step.type !== 'action') continue;

      const actionStep = step as any;
      const configObjects = this.findConfigObjectsInParams(actionStep.params);

      if (configObjects.length > 0) {
        issues.push({
          stepId: step.id,
          severity: 'error',
          code: 'TRANSFORM_BEFORE_ACTION',
          message: `Action step has config objects in params: ${configObjects.join(', ')}. Plugin params must be variable references, not transform logic.`,
          suggestion: 'Split into separate transform step (for data formatting) and action step (for plugin execution).',
          autoFixable: true
        });
      }
    }
  }

  /**
   * Rule 2: Transform Steps Must Have Input Field
   */
  private checkTransformInputFields(workflow: ValidationWorkflow, issues: ValidationIssue[]): void {
    for (const step of workflow.workflow) {
      if (step.type !== 'transform') continue;

      const transformStep = step as any;
      if (!transformStep.input) {
        issues.push({
          stepId: step.id,
          severity: 'error',
          code: 'MISSING_TRANSFORM_INPUT',
          message: 'Transform step missing required "input" field.',
          suggestion: 'Add input field with variable reference (e.g., "{{step1.data}}" or "{{step1.data.items}}")',
          autoFixable: false // Can't infer where data should come from
        });
      }
    }
  }

  /**
   * Rule 3: Variable References Must Be Valid
   */
  private checkVariableReferences(workflow: ValidationWorkflow, issues: ValidationIssue[]): void {
    const stepIds = new Set(workflow.workflow.map(s => s.id));

    for (const step of workflow.workflow) {
      // Handle loop steps with nested loopSteps
      if (step.type === 'loop') {
        const loopStep = step as any;

        // Build scope for loop: top-level steps + loop's nested steps + iterator variable
        const loopStepIds = new Set([...stepIds]);

        // Add nested step IDs to scope
        if (loopStep.loopSteps) {
          loopStep.loopSteps.forEach((nestedStep: any) => {
            loopStepIds.add(nestedStep.id);
          });
        }

        // Smart iterator variable detection:
        // 1. Check if loop has explicit itemVariable field
        // 2. Otherwise, infer from variable references in nested steps
        let iteratorVariable = 'item'; // default fallback

        if (loopStep.itemVariable) {
          iteratorVariable = loopStep.itemVariable;
        } else if (loopStep.loopSteps) {
          // Infer iterator from nested step references
          const inferredIterator = this.inferLoopIteratorVariable(loopStep.loopSteps, stepIds);
          if (inferredIterator) {
            iteratorVariable = inferredIterator;
          }
        }

        // Add the detected iterator variable to scope
        loopStepIds.add(iteratorVariable);

        // Check references in nested steps with loop scope
        if (loopStep.loopSteps) {
          for (const nestedStep of loopStep.loopSteps) {
            const refs = this.extractVariableReferences(nestedStep);

            for (const ref of refs) {
              const stepRef = this.parseVariableReference(ref);
              if (stepRef && !loopStepIds.has(stepRef.stepId)) {
                issues.push({
                  stepId: step.id,
                  severity: 'error',
                  code: 'INVALID_VARIABLE_REFERENCE',
                  message: `Variable reference "${ref}" points to non-existent step "${stepRef.stepId}".`,
                  suggestion: `Check step IDs. Available in loop scope: ${Array.from(loopStepIds).join(', ')}`,
                  autoFixable: false
                });
              }
            }
          }
        }
      } else if (step.type === 'transform') {
        // Handle transform steps with map operations
        const transformStep = step as any;
        const refs = this.extractVariableReferences(transformStep);

        // Build scope: global steps + inferred iterator (if map operation)
        const transformStepIds = new Set([...stepIds]);

        // If this is a map/filter operation, infer the iterator variable
        if (transformStep.config?.operation === 'map' || transformStep.config?.operation === 'filter') {
          // Infer iterator from the expression/condition
          const expression = transformStep.config.expression || transformStep.config.condition;
          if (expression) {
            const inferredIterator = this.inferTransformIteratorVariable(expression, stepIds);
            if (inferredIterator) {
              transformStepIds.add(inferredIterator);
            } else {
              // Fallback to 'item' if we can't infer
              transformStepIds.add('item');
            }
          }
        }

        for (const ref of refs) {
          const stepRef = this.parseVariableReference(ref);
          if (stepRef && !transformStepIds.has(stepRef.stepId)) {
            // Only flag as error if it's NOT a function call or complex expression
            // Functions like lower(), upper(), etc. are valid even if they look like step refs
            const isFunctionCall = ref.includes('(') || ref.includes('||') || ref.includes('&&');

            if (!isFunctionCall) {
              issues.push({
                stepId: step.id,
                severity: 'error',
                code: 'INVALID_VARIABLE_REFERENCE',
                message: `Variable reference "${ref}" points to non-existent step "${stepRef.stepId}".`,
                suggestion: `Check step IDs. Available steps: ${Array.from(stepIds).join(', ')}`,
                autoFixable: false
              });
            }
          }
        }
      } else if (step.type === 'scatter_gather') {
        // Handle scatter_gather steps with nested steps and itemVariable
        const scatterStep = step as any;

        if (scatterStep.scatter?.steps) {
          // Build scope for scatter: top-level steps + scatter's nested steps + iterator variable
          const scatterStepIds = new Set([...stepIds]);

          // Add nested step IDs to scope
          scatterStep.scatter.steps.forEach((nestedStep: any) => {
            scatterStepIds.add(nestedStep.id);
          });

          // Smart iterator variable detection for scatter
          let iteratorVariable = 'item'; // default fallback

          if (scatterStep.scatter.itemVariable) {
            iteratorVariable = scatterStep.scatter.itemVariable;
          } else {
            // Infer iterator from nested step references
            const inferredIterator = this.inferLoopIteratorVariable(scatterStep.scatter.steps, stepIds);
            if (inferredIterator) {
              iteratorVariable = inferredIterator;
            }
          }

          // Add the detected iterator variable to scope
          scatterStepIds.add(iteratorVariable);

          // Check references in nested steps with scatter scope
          for (const nestedStep of scatterStep.scatter.steps) {
            const refs = this.extractVariableReferences(nestedStep);

            for (const ref of refs) {
              const stepRef = this.parseVariableReference(ref);
              if (stepRef && !scatterStepIds.has(stepRef.stepId)) {
                issues.push({
                  stepId: nestedStep.id, // Report on the nested step, not parent
                  severity: 'error',
                  code: 'INVALID_VARIABLE_REFERENCE',
                  message: `Variable reference "${ref}" in scatter nested step points to non-existent step "${stepRef.stepId}".`,
                  suggestion: `Available in scatter scope: ${Array.from(scatterStepIds).join(', ')}. Iterator variable is "${iteratorVariable}".`,
                  autoFixable: false
                });
              }
            }
          }
        }
      } else {
        // Regular step - check with global scope
        const refs = this.extractVariableReferences(step);

        for (const ref of refs) {
          // Skip function calls and complex expressions
          const isFunctionOrExpression = ref.includes('(') || ref.includes('||') || ref.includes('&&') ||
                                        ref.includes(' IS ') || ref.includes('CONCAT') || ref.includes('IF(');

          if (isFunctionOrExpression) continue;

          const stepRef = this.parseVariableReference(ref);
          if (stepRef && !stepIds.has(stepRef.stepId)) {
            issues.push({
              stepId: step.id,
              severity: 'error',
              code: 'INVALID_VARIABLE_REFERENCE',
              message: `Variable reference "${ref}" points to non-existent step "${stepRef.stepId}".`,
              suggestion: `Check step IDs. Available steps: ${Array.from(stepIds).join(', ')}`,
              autoFixable: false
            });
          }
        }
      }
    }
  }

  /**
   * Rule 4: Plugin Params Must Match Schema Types
   */
  private checkPluginParamTypes(workflow: ValidationWorkflow, issues: ValidationIssue[]): void {
    for (const step of workflow.workflow) {
      if (step.type !== 'action') continue;

      const actionStep = step as any;
      const pluginSchema = this.pluginSchemas[actionStep.plugin];

      if (!pluginSchema) {
        issues.push({
          stepId: step.id,
          severity: 'warning',
          code: 'UNKNOWN_PLUGIN',
          message: `Plugin "${actionStep.plugin}" not found in schemas. Cannot validate params.`,
          autoFixable: false
        });
        continue;
      }

      const actionSchema = pluginSchema.actions[actionStep.action];
      if (!actionSchema) {
        issues.push({
          stepId: step.id,
          severity: 'error',
          code: 'UNKNOWN_ACTION',
          message: `Action "${actionStep.action}" not found in plugin "${actionStep.plugin}".`,
          suggestion: `Available actions: ${Object.keys(pluginSchema.actions).join(', ')}`,
          autoFixable: false
        });
        continue;
      }

      // Validate required params
      for (const [paramName, paramDef] of Object.entries(actionSchema.parameters || {})) {
        const def = paramDef as any;
        if (def.required && !(paramName in actionStep.params)) {
          issues.push({
            stepId: step.id,
            severity: 'error',
            code: 'MISSING_REQUIRED_PARAM',
            message: `Missing required parameter "${paramName}" for action "${actionStep.action}".`,
            suggestion: `Add "${paramName}" to params. Expected type: ${def.type}`,
            autoFixable: false
          });
        }
      }
    }
  }

  /**
   * Rule 5: Scatter Step Variable Scoping
   *
   * Ensures scatter-gather steps define itemVariable and that nested steps
   * reference the correct variable scope.
   */
  private checkScatterStepVariableScoping(workflow: ValidationWorkflow, issues: ValidationIssue[]): void {
    for (const step of workflow.workflow) {
      if (step.type !== 'scatter_gather') continue;

      const scatterStep = step as any; // ScatterGatherStep type

      // Check if scatter step has itemVariable defined
      if (scatterStep.scatter && !scatterStep.scatter.itemVariable) {
        issues.push({
          stepId: step.id,
          severity: 'warning',
          code: 'MISSING_ITEM_VARIABLE',
          message: 'Scatter-gather step missing itemVariable definition.',
          suggestion: 'Add itemVariable (e.g., "item", "email", "customer") to scatter config',
          autoFixable: false
        });
      }
    }
  }

  /**
   * Rule 6: Map Operation Logic Validation
   *
   * Detects incorrect use of map operations. Map should transform each item,
   * not perform conditional checks on array properties.
   *
   * Common mistakes:
   * - Using item.length in map (item is element, not array)
   * - Using array methods on item (includes, find, etc.)
   * - Conditional expressions that return arrays based on array checks
   */
  private checkMapOperationLogic(workflow: ValidationWorkflow, issues: ValidationIssue[]): void {
    // Check both top-level steps and nested scatter steps
    const allSteps: any[] = [...workflow.workflow];

    for (const step of workflow.workflow) {
      if (step.type === 'scatter_gather') {
        const scatterStep = step as any;
        if (scatterStep.scatter?.steps) {
          console.log('[checkMapOperationLogic] Found scatter-gather step', step.id, 'with', scatterStep.scatter.steps.length, 'nested steps');
          allSteps.push(...scatterStep.scatter.steps);
        }
      }
    }

    console.log('[checkMapOperationLogic] Checking', allSteps.length, 'total steps');

    for (const step of allSteps) {
      if (step.type !== 'transform' || step.operation !== 'map') continue;

      console.log('[checkMapOperationLogic] Checking map operation in step', step.id);

      const config = step.config;
      if (!config?.expression) continue;

      const expression = config.expression;

      // Detect problematic patterns - array methods used on individual items
      const hasItemLength = expression.includes('item.length');
      const hasItemIncludes = expression.includes('item.includes');
      const hasItemFind = expression.includes('item.find');
      const hasItemMap = expression.includes('item.map');
      const hasItemFilter = expression.includes('item.filter');
      const hasItemReduce = expression.includes('item.reduce');
      const hasItemSome = expression.includes('item.some');
      const hasItemEvery = expression.includes('item.every');
      const hasItemSlice = expression.includes('item.slice');
      const hasItemSplice = expression.includes('item.splice');
      const hasItemConcat = expression.includes('item.concat');
      const hasItemJoin = expression.includes('item.join');
      const hasArrayCheck = hasItemLength || hasItemIncludes || hasItemFind || hasItemMap || hasItemFilter || hasItemReduce || hasItemSome || hasItemEvery || hasItemSlice || hasItemSplice || hasItemConcat || hasItemJoin;

      if (hasArrayCheck) {
        issues.push({
          stepId: step.id,
          severity: 'error',
          code: 'INVALID_MAP_LOGIC',
          message: `Map operation uses array methods on 'item', but 'item' is each element, not the whole array. Expression: ${expression}`,
          suggestion: 'Use filter operation to check array properties, or use a different transform operation. Map should only transform individual items.',
          autoFixable: false
        });
      }

      // Detect conditional expressions that return arrays (likely wrong)
      const returnsArray = expression.includes('[') && expression.includes(']') && expression.includes('?');
      if (returnsArray) {
        issues.push({
          stepId: step.id,
          severity: 'warning',
          code: 'MAP_RETURNS_ARRAY',
          message: `Map operation has conditional expression that returns arrays. This is unusual - map should transform items, not conditionally include/exclude them.`,
          suggestion: 'Consider using filter operation instead, or restructure the logic.',
          autoFixable: false
        });
      }
    }
  }

  /**
   * Rule 7: Dependencies Must Form Valid DAG
   */
  private checkDependencies(workflow: ValidationWorkflow, issues: ValidationIssue[]): void {
    const stepIds = new Set(workflow.workflow.map(s => s.id));

    for (const step of workflow.workflow) {
      if (!step.dependencies) {
        issues.push({
          stepId: step.id,
          severity: 'error',
          code: 'MISSING_DEPENDENCIES',
          message: 'Step missing required "dependencies" array.',
          suggestion: 'Add "dependencies" array (empty array [] if no dependencies)',
          autoFixable: true
        });
        continue;
      }

      for (const depId of step.dependencies) {
        if (!stepIds.has(depId)) {
          issues.push({
            stepId: step.id,
            severity: 'error',
            code: 'INVALID_DEPENDENCY',
            message: `Dependency "${depId}" does not exist.`,
            suggestion: `Check step IDs. Available steps: ${Array.from(stepIds).join(', ')}`,
            autoFixable: false
          });
        }
      }
    }

    // Check for cycles (simplified - full cycle detection would use DFS)
    // For now just check that dependencies reference earlier steps
    const stepOrder = new Map(workflow.workflow.map((s, idx) => [s.id, idx]));
    for (const step of workflow.workflow) {
      const stepIdx = stepOrder.get(step.id)!;
      for (const depId of step.dependencies || []) {
        const depIdx = stepOrder.get(depId);
        if (depIdx !== undefined && depIdx >= stepIdx) {
          issues.push({
            stepId: step.id,
            severity: 'warning',
            code: 'FORWARD_DEPENDENCY',
            message: `Step depends on "${depId}" which appears later in workflow. This may cause execution issues.`,
            autoFixable: false
          });
        }
      }
    }
  }

  /**
   * Auto-fix issues where possible
   */
  private applyAutoFixes(workflow: ValidationWorkflow, issues: ValidationIssue[]): { workflow: ValidationWorkflow, applied: boolean } {
    let fixedWorkflow = JSON.parse(JSON.stringify(workflow)); // Deep clone
    let applied = false;

    for (const issue of issues) {
      if (!issue.autoFixable) continue;

      switch (issue.code) {
        case 'TRANSFORM_BEFORE_ACTION':
          fixedWorkflow = this.fixTransformBeforeAction(fixedWorkflow, issue.stepId);
          applied = true;
          break;

        case 'MISSING_DEPENDENCIES':
          const step = fixedWorkflow.workflow.find((s: any) => s.id === issue.stepId);
          if (step) {
            step.dependencies = [];
            applied = true;
          }
          break;
      }
    }

    return { workflow: fixedWorkflow, applied };
  }

  /**
   * Auto-fix: Split action step with config into transform + action
   */
  private fixTransformBeforeAction(workflow: ValidationWorkflow, stepId: string): ValidationWorkflow {
    const stepIdx = workflow.workflow.findIndex(s => s.id === stepId);
    if (stepIdx === -1) return workflow;

    const actionStep = workflow.workflow[stepIdx] as any;
    const configInfo = this.extractConfigFromParams(actionStep.params);

    if (!configInfo) return workflow;

    // Create transform step
    // NOTE: We generate a temporary unique ID that will be renumbered by normalizePilot
    // Using timestamp ensures uniqueness before normalization
    const transformStep: any = {
      id: `step_autofix_${Date.now()}`,
      name: `Format data for ${actionStep.name}`,
      type: 'transform',
      operation: configInfo.operation,
      input: this.inferInputSource(actionStep, workflow),
      config: configInfo.config,
      dependencies: actionStep.dependencies || []
    };

    // Update action step
    const updatedActionStep: any = {
      ...actionStep,
      params: this.replaceConfigWithReference(actionStep.params, configInfo.paramPath, transformStep.id),
      dependencies: [...(actionStep.dependencies || []), transformStep.id]
    };

    // Insert transform step before action step
    workflow.workflow.splice(stepIdx, 1, transformStep, updatedActionStep);

    return workflow;
  }

  /**
   * Helper: Find config objects in params (expression, condition fields)
   */
  private findConfigObjectsInParams(params: any, path: string = ''): string[] {
    const configObjects: string[] = [];

    if (typeof params !== 'object' || params === null) return configObjects;

    for (const [key, value] of Object.entries(params)) {
      const currentPath = path ? `${path}.${key}` : key;

      if (typeof value === 'object' && value !== null) {
        // Check if this object has config-like fields
        if ('expression' in value || 'condition' in value) {
          configObjects.push(currentPath);
        } else {
          // Recurse
          configObjects.push(...this.findConfigObjectsInParams(value, currentPath));
        }
      }
    }

    return configObjects;
  }

  /**
   * Helper: Extract config from params for auto-fix
   */
  private extractConfigFromParams(params: any): { operation: string, config: any, paramPath: string } | null {
    // Look for expression field (map operation)
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'object' && value !== null && 'expression' in value) {
        return {
          operation: 'map',
          config: value,
          paramPath: key
        };
      }
    }

    // Look for condition field (filter operation)
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'object' && value !== null && 'condition' in value) {
        return {
          operation: 'filter',
          config: value,
          paramPath: key
        };
      }
    }

    return null;
  }

  /**
   * Helper: Infer input source for transform step
   */
  private inferInputSource(actionStep: any, workflow: ValidationWorkflow): string {
    // Use the last dependency as input source
    if (actionStep.dependencies && actionStep.dependencies.length > 0) {
      const lastDep = actionStep.dependencies[actionStep.dependencies.length - 1];
      return `{{${lastDep}}}`;
    }

    // Fallback: use previous step
    const stepIdx = workflow.workflow.findIndex(s => s.id === actionStep.id);
    if (stepIdx > 0) {
      return `{{${workflow.workflow[stepIdx - 1].id}}}`;
    }

    return '{{step1}}'; // Default fallback
  }

  /**
   * Helper: Replace config object with variable reference
   */
  private replaceConfigWithReference(params: any, paramPath: string, transformStepId: string): any {
    const newParams = JSON.parse(JSON.stringify(params));
    const keys = paramPath.split('.');

    let current = newParams;
    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]];
    }

    current[keys[keys.length - 1]] = `{{${transformStepId}}}`;

    return newParams;
  }

  /**
   * Helper: Infer iterator variable from transform expression
   *
   * Analyzes a transform expression to find the iterator variable.
   * Example: "item.name" → 'item', "email.subject" → 'email'
   */
  private inferTransformIteratorVariable(expression: string, knownStepIds: Set<string>): string | null {
    // Extract variable references from the expression
    const regex = /\{\{([^}]+)\}\}/g;
    const refs: string[] = [];
    let match;

    while ((match = regex.exec(expression)) !== null) {
      refs.push(match[1]);
    }

    // Find variables that are NOT step IDs
    for (const ref of refs) {
      const parsed = this.parseVariableReference(ref);
      if (parsed && !knownStepIds.has(parsed.stepId)) {
        return parsed.stepId;
      }
    }

    return null;
  }

  /**
   * Helper: Infer loop iterator variable from nested step references
   *
   * Smart detection: Analyze variable references in loop's nested steps
   * to find which variable is NOT a step ID (that's the iterator).
   *
   * Example: If we see {{pdf.message_id}} and 'pdf' is not a step ID,
   * then 'pdf' must be the iterator variable.
   */
  private inferLoopIteratorVariable(loopSteps: any[], knownStepIds: Set<string>): string | null {
    const allRefs = new Set<string>();

    // Collect all variable references from nested steps
    for (const nestedStep of loopSteps) {
      const refs = this.extractVariableReferences(nestedStep);
      for (const ref of refs) {
        const parsed = this.parseVariableReference(ref);
        if (parsed) {
          allRefs.add(parsed.stepId);
        }
      }
    }

    // Find variables that are NOT step IDs - those are likely iterators
    const candidates: string[] = [];
    for (const ref of allRefs) {
      if (!knownStepIds.has(ref)) {
        // Not a step ID - likely an iterator variable
        candidates.push(ref);
      }
    }

    // Return the most common non-step-ID reference (the iterator)
    if (candidates.length > 0) {
      // Count frequency
      const frequency = new Map<string, number>();
      for (const candidate of candidates) {
        frequency.set(candidate, (frequency.get(candidate) || 0) + 1);
      }

      // Return most frequent
      let maxCount = 0;
      let mostFrequent = null;
      for (const [variable, count] of frequency.entries()) {
        if (count > maxCount) {
          maxCount = count;
          mostFrequent = variable;
        }
      }

      return mostFrequent;
    }

    return null;
  }

  /**
   * Helper: Extract all variable references from a step
   */
  private extractVariableReferences(step: any): string[] {
    const refs: string[] = [];
    const stepStr = JSON.stringify(step);
    const regex = /\{\{([^}]+)\}\}/g;
    let match;

    while ((match = regex.exec(stepStr)) !== null) {
      refs.push(match[1]);
    }

    return refs;
  }

  /**
   * Helper: Parse variable reference to extract step ID
   */
  private parseVariableReference(ref: string): { stepId: string, path?: string } | null {
    const parts = ref.trim().split('.');
    if (parts.length === 0) return null;

    return {
      stepId: parts[0],
      path: parts.slice(1).join('.')
    };
  }
}
