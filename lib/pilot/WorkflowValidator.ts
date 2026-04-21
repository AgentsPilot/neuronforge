/**
 * Workflow Pre-Flight Validator
 *
 * Validates workflow structure before execution to catch malformed workflows early.
 * This is Phase 5 of the V6 Architecture Improvements.
 *
 * Validates:
 * 1. Step IDs are sequential (step1, step2, step3, ...)
 * 2. All dependencies reference existing steps
 * 3. No circular dependencies (DAG validation)
 * 4. Step dependencies only reference earlier steps
 *
 * @module lib/pilot/WorkflowValidator
 */

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings?: string[]
}

export class WorkflowValidator {
  /**
   * Validate workflow structure before execution
   *
   * @param workflow - Array of workflow steps (PILOT DSL format)
   * @returns Validation result with errors if invalid
   */
  validatePreFlight(workflow: any[]): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    if (!workflow || !Array.isArray(workflow)) {
      return {
        valid: false,
        errors: ['Workflow must be an array']
      }
    }

    if (workflow.length === 0) {
      return {
        valid: false,
        errors: ['Workflow cannot be empty']
      }
    }

    // 1. Check step IDs exist and are unique (sequential numbering not enforced due to nested steps)
    const stepIds = workflow.map(s => s.step_id || s.id)
    const stepIdSet = new Set<string>()

    stepIds.forEach((stepId, index) => {
      if (!stepId) {
        errors.push(`Step at index ${index} is missing an ID`)
      } else if (stepIdSet.has(stepId)) {
        errors.push(`Duplicate step ID found: '${stepId}'`)
      } else {
        stepIdSet.add(stepId)
      }
    })

    // 2. Check all dependencies reference existing steps (stepIdSet already populated above)
    workflow.forEach((step, index) => {
      const stepId = step.step_id || step.id
      const dependencies = step.dependencies || []

      dependencies.forEach((depId: string) => {
        if (!stepIdSet.has(depId)) {
          errors.push(`Step '${stepId}' depends on non-existent step '${depId}'`)
        }
      })
    })

    // 3. Check dependencies only reference earlier steps (forward dependencies are invalid)
    workflow.forEach((step, index) => {
      const stepId = step.step_id || step.id
      const dependencies = step.dependencies || []

      dependencies.forEach((depId: string) => {
        const depIndex = stepIds.indexOf(depId)
        if (depIndex >= index) {
          errors.push(
            `Step '${stepId}' (index ${index}) depends on later step '${depId}' (index ${depIndex}). ` +
            `Dependencies must reference earlier steps only.`
          )
        }
      })
    })

    // 4. Detect circular dependencies using DFS
    const visited = new Set<string>()
    const recStack = new Set<string>()
    const stepMap = new Map(workflow.map(s => [s.step_id || s.id, s]))

    const hasCycle = (stepId: string, path: string[] = []): boolean => {
      if (recStack.has(stepId)) {
        const cyclePath = [...path, stepId].join(' → ')
        errors.push(`Circular dependency detected: ${cyclePath}`)
        return true
      }

      if (visited.has(stepId)) {
        return false
      }

      visited.add(stepId)
      recStack.add(stepId)

      const step = stepMap.get(stepId)
      const deps = step?.dependencies || []

      for (const depId of deps) {
        if (hasCycle(depId, [...path, stepId])) {
          return true
        }
      }

      recStack.delete(stepId)
      return false
    }

    // Check each step for cycles
    stepIds.forEach(stepId => {
      if (!visited.has(stepId)) {
        hasCycle(stepId)
      }
    })

    // 5. Validate step types are known
    const validStepTypes = [
      'action',
      'transform',
      'filter',
      'scatter_gather',
      'conditional',
      'ai_router',
      'sub_workflow',
      'loop',
      'parallel',
      'aggregate',
      'decision',
      'human_in_loop',
      'delay',
      'webhook',
      'custom',
      'ai_processing'
    ]

    workflow.forEach(step => {
      const stepId = step.step_id || step.id
      const stepType = step.type

      if (!stepType) {
        errors.push(`Step '${stepId}' is missing 'type' field`)
      } else if (!validStepTypes.includes(stepType)) {
        warnings.push(`Step '${stepId}' has unknown type '${stepType}'`)
      }
    })

    // 6. Validate action steps have required fields
    workflow.forEach(step => {
      const stepId = step.step_id || step.id

      if (step.type === 'action') {
        if (!step.plugin) {
          errors.push(`Action step '${stepId}' is missing 'plugin' field`)
        }
        // Accept both 'action' and 'operation' fields for backward compatibility
        if (!step.action && !step.operation) {
          errors.push(`Action step '${stepId}' is missing 'action' field`)
        }
      }
    })

    return {
      valid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined
    }
  }

  /**
   * Validate flatten field selection against step description
   * Detects issues like field:"labels" when description says "extract attachments"
   *
   * @param workflow - Array of workflow steps
   * @returns Array of flatten field issues with auto-fix suggestions
   */
  validateFlattenFields(workflow: any[]): Array<{
    stepId: string;
    currentField: string;
    suggestedField: string;
    confidence: number;
    upstreamStep: string;
    reason: string;
  }> {
    const issues: Array<{
      stepId: string;
      currentField: string;
      suggestedField: string;
      confidence: number;
      upstreamStep: string;
      reason: string;
    }> = [];

    // Recursively collect all steps
    const allSteps: any[] = [];
    const collectSteps = (steps: any[]) => {
      steps.forEach(step => {
        allSteps.push(step);
        if (step.type === 'scatter_gather' && step.scatter?.steps) {
          collectSteps(step.scatter.steps);
        }
        if (step.type === 'conditional') {
          if (step.steps) collectSteps(step.steps);
          if (step.then) collectSteps(Array.isArray(step.then) ? step.then : [step.then]);
          if (step.else) collectSteps(Array.isArray(step.else) ? step.else : [step.else]);
        }
        if (step.type === 'parallel' && step.steps) collectSteps(step.steps);
        if (step.type === 'loop' && step.loopSteps) collectSteps(step.loopSteps);
        if (step.type === 'sub_workflow' && step.steps) collectSteps(step.steps);
      });
    };
    collectSteps(workflow);

    // Build upstream output schemas (index by both step ID and output_variable)
    const stepOutputs = new Map<string, any>();
    allSteps.forEach(step => {
      const stepId = step.step_id || step.id;
      if (step.output_schema) {
        // Index by step ID
        stepOutputs.set(stepId, step.output_schema);
        // Also index by output_variable (for {{variable}} references)
        if (step.output_variable) {
          stepOutputs.set(step.output_variable, step.output_schema);
        }
      }
    });

    // Check flatten operations
    allSteps.forEach(step => {
      if (step.type !== 'transform' || step.operation !== 'flatten') return;

      const stepId = step.step_id || step.id;

      // CRITICAL: Detect MISSING flatten field (not just wrong field)
      if (!step.config?.field) {
        // Parse full input path including nested navigation (e.g., {{matching_emails.emails}})
        const inputMatch = step.input?.match(/\{\{([a-zA-Z_][a-zA-Z0-9_.]*)\}\}/);
        if (!inputMatch) return;

        const fullPath = inputMatch[1]; // e.g., "matching_emails.emails"
        const pathParts = fullPath.split('.');
        const rootVariable = pathParts[0]; // "matching_emails"
        const nestedPath = pathParts.slice(1); // ["emails"]

        // Get root schema and navigate nested path
        let targetSchema = stepOutputs.get(rootVariable);
        if (!targetSchema) return;

        // Navigate through nested path to get the actual schema we're working with
        for (const pathPart of nestedPath) {
          if (targetSchema?.properties?.[pathPart]) {
            targetSchema = targetSchema.properties[pathPart];
          }
          // Handle arrays - get items schema (what's inside the array)
          if (targetSchema?.type === 'array' && targetSchema.items) {
            targetSchema = targetSchema.items;
          }
        }

        // Get all array fields from the RESOLVED schema (not the root)
        // Use includePathPrefixes=false since we've already navigated to the target schema
        // This returns immediate child field names like "attachments" instead of "emails.attachments"
        const arrayFields = this.extractArrayFields(targetSchema, '', false);
        const upstreamStepId = rootVariable; // For error messages
        if (arrayFields.length === 0) return;

        // Suggest best field based on context with enhanced matching
        const description = (step.description || '').toLowerCase();
        const customCode = (step.config?.custom_code || '').toLowerCase();
        const outputSchemaStr = JSON.stringify(step.config?.output_schema || {}).toLowerCase();
        const contextText = `${description} ${customCode} ${outputSchemaStr}`;

        // Score each field and track occurrence count
        const fieldScores = arrayFields.map(field => {
          const fieldLower = field.toLowerCase();
          const fieldWithoutS = fieldLower.replace(/s$/, '');
          // For nested paths like "emails.attachments", extract the last part
          const fieldParts = fieldLower.split('.');
          const lastPart = fieldParts[fieldParts.length - 1];
          const lastPartWithoutS = lastPart.replace(/s$/, '');

          let score = 0;
          let occurrenceCount = 0;
          let inDescription = false;

          // PRIORITY 1: Check description FIRST (highest priority for field matching)
          // Description contains the semantic intent of what field to extract
          if (description.includes(lastPart)) {
            score = 10; // Highest priority - exact match in step description
            inDescription = true;
            occurrenceCount = (description.match(new RegExp(lastPart, 'g')) || []).length;
          } else if (description.includes(lastPartWithoutS)) {
            score = 8; // High priority - singular form in step description
            inDescription = true;
            occurrenceCount = (description.match(new RegExp(lastPartWithoutS, 'g')) || []).length;
          }
          // PRIORITY 2: Check other contexts (schemas, custom code) if not in description
          else if (contextText.includes(lastPart)) {
            score = 3; // Medium priority - field appears in output_schema or custom_code
            occurrenceCount = (contextText.match(new RegExp(lastPart, 'g')) || []).length;
          }
          // Exact match on full path
          else if (contextText.includes(fieldLower)) {
            score = 2;
            occurrenceCount = (contextText.match(new RegExp(fieldLower, 'g')) || []).length;
          }
          // Singular form match on last part
          else if (contextText.includes(lastPartWithoutS)) {
            score = 2;
            occurrenceCount = (contextText.match(new RegExp(lastPartWithoutS, 'g')) || []).length;
          }
          // Singular form match on full path
          else if (contextText.includes(fieldWithoutS)) {
            score = 1;
            occurrenceCount = (contextText.match(new RegExp(fieldWithoutS, 'g')) || []).length;
          }

          // Additional boost if field appears in description (even if already scored above)
          if (inDescription) {
            score += 5; // Extra weight for description presence
          }

          return { field, score, occurrenceCount, inDescription };
        });

        // Sort by: 1) score (higher better), 2) inDescription (true better), 3) occurrenceCount (higher better)
        fieldScores.sort((a, b) => {
          if (a.score !== b.score) return b.score - a.score;
          if (a.inDescription !== b.inDescription) return a.inDescription ? -1 : 1;
          return b.occurrenceCount - a.occurrenceCount;
        });

        let bestMatch: { field: string; score: number } | null = null;
        if (fieldScores.length > 0 && fieldScores[0].score > 0) {
          bestMatch = { field: fieldScores[0].field, score: fieldScores[0].score };
        }

        if (!bestMatch && arrayFields.length > 0) {
          bestMatch = { field: arrayFields[0], score: 0.5 };
        }

        if (bestMatch) {
          issues.push({
            stepId,
            currentField: '(missing)',
            suggestedField: bestMatch.field,
            confidence: bestMatch.score >= 1 ? 0.90 : 0.75,
            upstreamStep: upstreamStepId,
            reason: `Flatten operation is missing required 'field' parameter. Should specify which array field to flatten from ${upstreamStepId}. Available fields: ${arrayFields.join(', ')}`
          });
        }
        return; // Skip rest of validation for this step
      }

      const currentField = step.config.field;
      console.log(`🔍 [WorkflowValidator] Checking flatten step ${stepId} with field="${currentField}"`);

      // Parse full input path including nested navigation (e.g., {{matching_emails.emails}})
      const inputMatch = step.input?.match(/\{\{([a-zA-Z_][a-zA-Z0-9_.]*)\}\}/);
      if (!inputMatch) {
        console.log(`⚠️  [WorkflowValidator] No input match for step ${stepId}, skipping`);
        return;
      }

      const fullPath = inputMatch[1]; // e.g., "matching_emails.emails"
      const pathParts = fullPath.split('.');
      const rootVariable = pathParts[0]; // "matching_emails"
      const nestedPath = pathParts.slice(1); // ["emails"]

      console.log(`🔍 [WorkflowValidator] Input path: ${fullPath}, root: ${rootVariable}, nested: ${nestedPath.join('.')}`);

      // Get root schema and navigate nested path
      let targetSchema = stepOutputs.get(rootVariable);
      if (!targetSchema) {
        console.log(`⚠️  [WorkflowValidator] No schema found for ${rootVariable}, skipping`);
        return;
      }

      console.log(`🔍 [WorkflowValidator] Found root schema for ${rootVariable}`);

      // Navigate through nested path to get the actual schema we're working with
      for (const pathPart of nestedPath) {
        if (targetSchema?.properties?.[pathPart]) {
          targetSchema = targetSchema.properties[pathPart];
          console.log(`🔍 [WorkflowValidator] Navigated to property: ${pathPart}`);
        }
        // Handle arrays - get items schema (what's inside the array)
        if (targetSchema?.type === 'array' && targetSchema.items) {
          targetSchema = targetSchema.items;
          console.log(`🔍 [WorkflowValidator] Unwrapped array items schema`);
        }
      }

      // Get all array fields from the RESOLVED schema (not the root)
      const arrayFields = this.extractArrayFields(targetSchema);
      console.log(`🔍 [WorkflowValidator] Available array fields: ${arrayFields.join(', ')}`);

      // If current field is not in the available top-level array fields, it's definitely wrong
      if (!arrayFields.includes(currentField)) {
        console.log(`❌ [WorkflowValidator] Field "${currentField}" NOT in available fields, suggesting fix...`);

        // Check if there's a better field based on context with enhanced matching
        const description = (step.description || '').toLowerCase();
        const customCode = (step.config?.custom_code || '').toLowerCase();
        const outputSchemaStr = JSON.stringify(step.config?.output_schema || {}).toLowerCase();
        const contextText = `${description} ${customCode} ${outputSchemaStr}`;

        // Score each field and track occurrence count
        // IMPORTANT: Prioritize description matches over schema mentions (same logic as missing field validation)
        const fieldScores = arrayFields.map(fieldName => {
          const fieldLower = fieldName.toLowerCase();
          const fieldBase = fieldLower.replace(/s$/, ''); // Remove plural 's'
          // For nested paths, extract the last part
          const fieldParts = fieldLower.split('.');
          const lastPart = fieldParts[fieldParts.length - 1];
          const lastPartBase = lastPart.replace(/s$/, '');

          let score = 0;
          let occurrenceCount = 0;
          let inDescription = false;

          // PRIORITY 1: Check description FIRST (highest priority)
          if (description.includes(lastPart)) {
            score = 10; // Description exact match
            inDescription = true;
            occurrenceCount = (description.match(new RegExp(lastPart, 'g')) || []).length;
          } else if (description.includes(lastPartBase)) {
            score = 8; // Description singular form
            inDescription = true;
            occurrenceCount = (description.match(new RegExp(lastPartBase, 'g')) || []).length;
          } else if (description.includes(fieldLower)) {
            score = 7; // Description full path
            inDescription = true;
            occurrenceCount = (description.match(new RegExp(fieldLower, 'g')) || []).length;
          } else if (description.includes(fieldBase)) {
            score = 6; // Description base match
            inDescription = true;
            occurrenceCount = (description.match(new RegExp(fieldBase, 'g')) || []).length;
          }
          // PRIORITY 2: Check other contexts if not in description
          else if (contextText.includes(lastPart)) {
            score = 3; // Schema/output mention
            occurrenceCount = (contextText.match(new RegExp(lastPart, 'g')) || []).length;
          } else if (contextText.includes(fieldLower)) {
            score = 2; // Full path in schema
            occurrenceCount = (contextText.match(new RegExp(fieldLower, 'g')) || []).length;
          } else if (contextText.includes(lastPartBase)) {
            score = 2; // Singular in schema
            occurrenceCount = (contextText.match(new RegExp(lastPartBase, 'g')) || []).length;
          } else if (contextText.includes(fieldBase)) {
            score = 1; // Base in schema
            occurrenceCount = (contextText.match(new RegExp(fieldBase, 'g')) || []).length;
          }

          // Additional boost for description presence
          if (inDescription) {
            score += 5; // Total: 15 (description exact) vs 3 (schema mention)
          }

          return { field: fieldName, score, occurrenceCount, inDescription };
        });

        // Sort by: 1) score (higher better), 2) inDescription (true better), 3) occurrenceCount (higher better)
        fieldScores.sort((a, b) => {
          if (a.score !== b.score) return b.score - a.score;
          if (a.inDescription !== b.inDescription) return a.inDescription ? -1 : 1;
          return b.occurrenceCount - a.occurrenceCount;
        });

        let bestMatch: { field: string; score: number } | null = null;
        if (fieldScores.length > 0 && fieldScores[0].score > 0) {
          bestMatch = { field: fieldScores[0].field, score: fieldScores[0].score };
        }

        // If no context match, just suggest the first available field
        if (!bestMatch && arrayFields.length > 0) {
          bestMatch = { field: arrayFields[0], score: 0.5 };
        }

        if (bestMatch) {
          console.log(`✅ [WorkflowValidator] Suggesting field="${bestMatch.field}" with score=${bestMatch.score}`);
          issues.push({
            stepId,
            currentField,
            suggestedField: bestMatch.field,
            confidence: bestMatch.score >= 1 ? 0.90 : 0.70,
            upstreamStep: rootVariable,
            reason: `Flatten field "${currentField}" does not exist in ${fullPath} output. Available array fields: ${arrayFields.join(', ')}`
          });
        }
        return; // Don't continue checking if field doesn't exist
      } else {
        console.log(`✅ [WorkflowValidator] Field "${currentField}" is valid, no fix needed`);
      }

      // If we get here, currentField exists but might not be the best choice
      if (arrayFields.length <= 1) return; // Only one choice, can't suggest better

      // Check if a different field makes more sense given step description with enhanced matching
      const description = (step.description || '').toLowerCase();
      const customCode = (step.config?.custom_code || '').toLowerCase();
      const outputSchemaStr = JSON.stringify(step.config?.output_schema || {}).toLowerCase();
      const contextText = `${description} ${customCode} ${outputSchemaStr}`;

      // Score each field and track occurrence count
      const fieldScores = arrayFields.map(fieldName => {
        const fieldLower = fieldName.toLowerCase();
        const fieldBase = fieldLower.replace(/s$/, ''); // Remove plural 's'
        // For nested paths, extract the last part
        const fieldParts = fieldLower.split('.');
        const lastPart = fieldParts[fieldParts.length - 1];
        const lastPartBase = lastPart.replace(/s$/, '');

        let score = 0;
        let occurrenceCount = 0;
        let inDescription = false;

        // Prioritize matches on the last part of nested paths
        if (contextText.includes(lastPart)) {
          score = 3; // Highest score for matching nested field name
          occurrenceCount = (contextText.match(new RegExp(lastPart, 'g')) || []).length;
        } else if (contextText.includes(fieldLower)) {
          score = 2; // Exact match on full path
          occurrenceCount = (contextText.match(new RegExp(fieldLower, 'g')) || []).length;
        } else if (contextText.includes(lastPartBase)) {
          score = 2; // Singular form of last part
          occurrenceCount = (contextText.match(new RegExp(lastPartBase, 'g')) || []).length;
        } else if (contextText.includes(fieldBase)) {
          score = 1; // Base match on full path
          occurrenceCount = (contextText.match(new RegExp(fieldBase, 'g')) || []).length;
        }

        // Bonus: field appears in description (higher priority than output_schema)
        if (description.includes(lastPart) || description.includes(lastPartBase) ||
            description.includes(fieldLower) || description.includes(fieldBase)) {
          inDescription = true;
        }

        return { field: fieldName, score, occurrenceCount, inDescription };
      });

      // Sort by: 1) score (higher better), 2) inDescription (true better), 3) occurrenceCount (higher better)
      fieldScores.sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        if (a.inDescription !== b.inDescription) return a.inDescription ? -1 : 1;
        return b.occurrenceCount - a.occurrenceCount;
      });

      let bestMatch: { field: string; score: number } | null = null;
      if (fieldScores.length > 0 && fieldScores[0].score > 0) {
        bestMatch = { field: fieldScores[0].field, score: fieldScores[0].score };
      }

      // If we found a better match than the current field
      if (bestMatch && bestMatch.field !== currentField) {
        const currentFieldLower = currentField.toLowerCase();
        const currentFieldInContext = contextText.includes(currentFieldLower) ||
                                       contextText.includes(currentFieldLower.replace(/s$/, ''));

        // Only flag if the suggested field IS in context and current field IS NOT
        if (!currentFieldInContext) {
          issues.push({
            stepId,
            currentField,
            suggestedField: bestMatch.field,
            confidence: bestMatch.score === 2 ? 0.95 : 0.85,
            upstreamStep: rootVariable,
            reason: `Step description mentions "${bestMatch.field}" but flatten is using "${currentField}". Available fields: ${arrayFields.join(', ')}`
          });
        }
      }
    });

    return issues;
  }

  /**
   * Extract array field names from output schema
   */
  /**
   * Extract array fields from schema, including nested arrays
   * Returns both top-level arrays and nested array paths
   * Example: {emails: [{attachments: [...]}]} returns ["emails", "emails.attachments"]
   *
   * @param schema - The schema to extract fields from
   * @param prefix - Path prefix (used for nested recursion)
   * @param includePathPrefixes - If false, returns only immediate child field names without prefixes
   */
  private extractArrayFields(schema: any, prefix: string = '', includePathPrefixes: boolean = true): string[] {
    const fields: string[] = [];

    if (!schema || typeof schema !== 'object') return fields;

    // Handle {type: "object", properties: {...}}
    if (schema.properties && typeof schema.properties === 'object') {
      for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
        const fullPath = includePathPrefixes && prefix ? `${prefix}.${fieldName}` : fieldName;
        const fs = fieldSchema as any;

        if (fs.type === 'array') {
          // This is an array field
          fields.push(fullPath);

          // Recurse into array items to find nested arrays
          if (fs.items && fs.items.properties) {
            fields.push(...this.extractArrayFields(fs.items, fullPath, includePathPrefixes));
          }
        } else if (fs.type === 'object' && fs.properties) {
          // Recurse into nested objects to find arrays
          fields.push(...this.extractArrayFields(fs, fullPath, includePathPrefixes));
        }
      }
    }

    // Handle {type: "array", items: {properties: {...}}}
    if (schema.type === 'array' && schema.items && schema.items.properties) {
      fields.push(...this.extractArrayFields(schema.items, prefix, includePathPrefixes));
    }

    return fields;
  }

  /**
   * Validate parameter field references against upstream output schemas
   * Detects issues like {{step5.content}} when step5 only has .data field
   *
   * @param workflow - Array of workflow steps
   * @returns Array of field reference issues with auto-fix suggestions
   */
  validateFieldReferences(workflow: any[]): Array<{
    stepId: string;
    parameter: string;
    invalidReference: string;
    suggestedFix: string;
    confidence: number;
    upstreamStep: string;
    reason: string;
  }> {
    const issues: Array<{
      stepId: string;
      parameter: string;
      invalidReference: string;
      suggestedFix: string;
      confidence: number;
      upstreamStep: string;
      reason: string;
    }> = [];

    // Recursively collect all steps (including nested ones)
    const allSteps: any[] = [];
    const collectSteps = (steps: any[]) => {
      steps.forEach(step => {
        allSteps.push(step);

        // Recurse into nested structures
        if (step.type === 'scatter_gather' && step.scatter?.steps) {
          collectSteps(step.scatter.steps);
        }
        if (step.type === 'conditional') {
          if (step.steps) collectSteps(step.steps);
          if (step.then) collectSteps(Array.isArray(step.then) ? step.then : [step.then]);
          if (step.else) collectSteps(Array.isArray(step.else) ? step.else : [step.else]);
        }
        if (step.type === 'parallel' && step.steps) {
          collectSteps(step.steps);
        }
        if (step.type === 'loop' && step.loopSteps) {
          collectSteps(step.loopSteps);
        }
        if (step.type === 'sub_workflow' && step.steps) {
          collectSteps(step.steps);
        }
      });
    };
    collectSteps(workflow);

    // Build a map of step outputs (index by both step ID and output_variable)
    const stepOutputs = new Map<string, any>();
    allSteps.forEach(step => {
      const stepId = step.step_id || step.id;
      if (step.output_schema) {
        // Index by step ID
        stepOutputs.set(stepId, step.output_schema);
        // Also index by output_variable (for {{variable}} references)
        if (step.output_variable) {
          stepOutputs.set(step.output_variable, step.output_schema);
        }
      }
    });

    // Check each step's parameters for field references
    allSteps.forEach(step => {
      const stepId = step.step_id || step.id;
      const config = step.config || step.params || {};

      // Extract all variable references from config ({{variable.field}} pattern)
      const allRefs = this.extractVariableReferences(config);

      allRefs.forEach(ref => {
        const { full, variable, field, parameter } = ref;

        // Skip if no field reference (e.g., {{variable}} without .field)
        if (!field) return;

        // Check if the referenced step exists and has output schema
        const upstreamSchema = stepOutputs.get(variable);
        if (!upstreamSchema) return; // Can't validate if no schema

        // Get available fields from upstream schema
        const availableFields = this.extractSchemaFields(upstreamSchema);

        // Check if the referenced field exists
        if (!availableFields.includes(field)) {
          // Find similar field names (fuzzy match)
          const suggestion = this.findSimilarField(field, availableFields);

          if (suggestion) {
            issues.push({
              stepId,
              parameter,
              invalidReference: full,
              suggestedFix: `{{${variable}.${suggestion.field}}}`,
              confidence: suggestion.confidence,
              upstreamStep: variable,
              reason: `Field '${field}' not found in ${variable} output. Available fields: ${availableFields.join(', ')}`
            });
          }
        }
      });
    });

    return issues;
  }

  /**
   * Extract all {{variable.field}} references from config object
   */
  private extractVariableReferences(obj: any): Array<{
    full: string;
    variable: string;
    field: string | null;
    parameter: string;
  }> {
    const refs: Array<{
      full: string;
      variable: string;
      field: string | null;
      parameter: string;
    }> = [];

    const traverse = (value: any, path: string = '') => {
      if (typeof value === 'string') {
        // Match {{variable}} or {{variable.field}} or {{variable.nested.field}}
        const regex = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)(?:\.([a-zA-Z_][a-zA-Z0-9_.]*))?\}\}/g;
        let match;
        while ((match = regex.exec(value)) !== null) {
          refs.push({
            full: match[0],
            variable: match[1],
            field: match[2] || null,
            parameter: path
          });
        }
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => traverse(item, `${path}[${index}]`));
      } else if (typeof value === 'object' && value !== null) {
        Object.entries(value).forEach(([key, val]) => {
          traverse(val, path ? `${path}.${key}` : key);
        });
      }
    };

    traverse(obj);
    return refs;
  }

  /**
   * Extract field names from output schema
   * Now uses nested extraction to handle multi-level schemas
   */
  private extractSchemaFields(schema: any): string[] {
    // Use the new nested extraction method for comprehensive field detection
    return this.extractSchemaFieldsNested(schema);
  }

  /**
   * Find similar field name using fuzzy matching
   */
  private findSimilarField(
    target: string,
    available: string[]
  ): { field: string; confidence: number } | null {
    if (available.length === 0) return null;

    const targetLower = target.toLowerCase();
    let bestMatch: { field: string; confidence: number } | null = null;

    for (const field of available) {
      const fieldLower = field.toLowerCase();

      // Exact match (case-insensitive)
      if (targetLower === fieldLower) {
        return { field, confidence: 1.0 };
      }

      // One contains the other (e.g., "content" matches "file_content" or "data")
      if (fieldLower.includes(targetLower) || targetLower.includes(fieldLower)) {
        const confidence = Math.min(targetLower.length, fieldLower.length) / Math.max(targetLower.length, fieldLower.length);
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { field, confidence };
        }
      }

      // Levenshtein distance for typos (simple version)
      const distance = this.levenshteinDistance(targetLower, fieldLower);
      const maxLen = Math.max(targetLower.length, fieldLower.length);
      const confidence = 1 - (distance / maxLen);

      if (confidence > 0.6 && (!bestMatch || confidence > bestMatch.confidence)) {
        bestMatch = { field, confidence };
      }
    }

    return bestMatch;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Validate raw field names in operation configs (not just {{variable}} patterns)
   * This catches errors like field:"labels" when it should be "emails"
   *
   * Checks:
   * - Filter operations: config.condition.field against input schema
   * - Flatten operations: config.field against upstream array fields
   * - Map operations: config.mapping[].source against input schema
   * - Transform operations: Various field references in configs
   *
   * @param workflow - Array of workflow steps
   * @returns Array of operation field issues with auto-fix suggestions
   */
  validateOperationFields(workflow: any[]): Array<{
    stepId: string;
    operation: string;
    invalidField: string;
    suggestedField: string;
    context: 'filter' | 'flatten' | 'map' | 'transform' | 'action_param';
    confidence: number;
    upstreamStep: string;
    reason: string;
  }> {
    const issues: Array<{
      stepId: string;
      operation: string;
      invalidField: string;
      suggestedField: string;
      context: 'filter' | 'flatten' | 'map' | 'transform' | 'action_param';
      confidence: number;
      upstreamStep: string;
      reason: string;
    }> = [];

    // Recursively collect all steps
    const allSteps: any[] = [];
    const collectSteps = (steps: any[]) => {
      steps.forEach(step => {
        allSteps.push(step);
        if (step.type === 'scatter_gather' && step.scatter?.steps) {
          collectSteps(step.scatter.steps);
        }
        if (step.type === 'conditional') {
          if (step.steps) collectSteps(step.steps);
          if (step.then) collectSteps(Array.isArray(step.then) ? step.then : [step.then]);
          if (step.else) collectSteps(Array.isArray(step.else) ? step.else : [step.else]);
        }
        if (step.type === 'parallel' && step.steps) collectSteps(step.steps);
        if (step.type === 'loop' && step.loopSteps) collectSteps(step.loopSteps);
        if (step.type === 'sub_workflow' && step.steps) collectSteps(step.steps);
      });
    };
    collectSteps(workflow);

    // Build upstream output schemas map (index by both step ID and output_variable)
    const stepOutputs = new Map<string, any>();
    allSteps.forEach(step => {
      const stepId = step.step_id || step.id;
      if (step.output_schema) {
        // Index by step ID
        stepOutputs.set(stepId, step.output_schema);
        // Also index by output_variable (for {{variable}} references)
        if (step.output_variable) {
          stepOutputs.set(step.output_variable, step.output_schema);
        }
      }
    });

    // Helper to get upstream step ID from input pattern
    const getUpstreamStepId = (input: string): string | null => {
      const match = input?.match(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/);
      return match ? match[1] : null;
    };

    // Helper to get all fields (including nested) from schema
    const getAllSchemaFields = (schema: any): string[] => {
      return this.extractSchemaFieldsNested(schema);
    };

    // Check each step for operation-specific field errors
    allSteps.forEach(step => {
      const stepId = step.step_id || step.id;
      const config = step.config || {};

      // 1. FILTER OPERATIONS: Check condition.field (simple) or condition.conditions[].field (complex)
      // Note: Filters can be either type: "filter" OR type: "transform" with operation: "filter"
      const isFilterStep = step.type === 'filter' || (step.type === 'transform' && step.operation === 'filter');
      if (isFilterStep && config.condition) {
        const upstreamStepId = getUpstreamStepId(step.input);

        // Collect all field references from condition
        const fieldRefs: string[] = [];

        // Simple condition: { field: "...", operator: "...", value: "..." }
        if (config.condition.field) {
          fieldRefs.push(config.condition.field);
        }

        // Complex condition: { conditions: [{field: "..."}, ...], conditionType: "complex_and/or" }
        if (config.condition.conditions && Array.isArray(config.condition.conditions)) {
          config.condition.conditions.forEach((cond: any) => {
            if (cond.field) {
              fieldRefs.push(cond.field);
            }
          });
        }

        // Validate each field reference
        fieldRefs.forEach((originalFieldName) => {
          let fieldName = originalFieldName;

          // Handle "item." prefix that shouldn't be there (common generation error)
          let hasItemPrefix = false;
          if (fieldName.startsWith('item.')) {
            hasItemPrefix = true;
            const cleanFieldName = fieldName.substring(5); // Remove "item."

            // Suggest removing the prefix
            issues.push({
              stepId,
              operation: 'filter',
              invalidField: fieldName,
              suggestedField: cleanFieldName,
              context: 'filter',
              confidence: 0.95,
              upstreamStep: upstreamStepId || 'unknown',
              reason: `Filter field "${fieldName}" should not use "item." prefix. In filter conditions, reference fields directly as "${cleanFieldName}"`
            });

            fieldName = cleanFieldName; // Continue validation with clean field name
          }

          if (upstreamStepId) {
            const upstreamSchema = stepOutputs.get(upstreamStepId);
            if (upstreamSchema) {
              const availableFields = getAllSchemaFields(upstreamSchema);

              if (!availableFields.includes(fieldName) && !hasItemPrefix) {
                const suggestion = this.findSimilarField(fieldName, availableFields);
                if (suggestion) {
                  issues.push({
                    stepId,
                    operation: 'filter',
                    invalidField: fieldName,
                    suggestedField: suggestion.field,
                    context: 'filter',
                    confidence: suggestion.confidence,
                    upstreamStep: upstreamStepId,
                    reason: `Filter field "${fieldName}" not found in ${upstreamStepId} output. Available: ${availableFields.join(', ')}`
                  });
                }
              }
            }
          }
        });
      }

      // 2. FLATTEN OPERATIONS: Check config.field (already handled by validateFlattenFields, but add for completeness)
      if (step.type === 'transform' && step.operation === 'flatten' && config.field) {
        const fieldName = config.field;
        const upstreamStepId = getUpstreamStepId(step.input);

        if (upstreamStepId) {
          const upstreamSchema = stepOutputs.get(upstreamStepId);
          if (upstreamSchema) {
            const arrayFields = this.extractArrayFields(upstreamSchema);

            if (!arrayFields.includes(fieldName)) {
              // Try to find best match based on context
              const contextText = [
                step.description || '',
                step.config?.custom_code || '',
                JSON.stringify(step.config?.output_schema || {})
              ].join(' ').toLowerCase();

              let bestMatch: { field: string; score: number } | null = null;
              for (const field of arrayFields) {
                const fieldLower = field.toLowerCase();
                let score = 0;
                if (contextText.includes(fieldLower)) score = 2;
                else if (contextText.includes(fieldLower.replace(/s$/, ''))) score = 1;

                if (score > 0 && (!bestMatch || score > bestMatch.score)) {
                  bestMatch = { field, score };
                }
              }

              if (!bestMatch && arrayFields.length > 0) {
                bestMatch = { field: arrayFields[0], score: 0.5 };
              }

              if (bestMatch) {
                issues.push({
                  stepId,
                  operation: 'flatten',
                  invalidField: fieldName,
                  suggestedField: bestMatch.field,
                  context: 'flatten',
                  confidence: bestMatch.score >= 1 ? 0.90 : 0.70,
                  upstreamStep: upstreamStepId,
                  reason: `Flatten field "${fieldName}" not found in ${upstreamStepId} output. Available: ${arrayFields.join(', ')}`
                });
              }
            }
          }
        }
      }

      // 3. MAP OPERATIONS: Check config.mapping[].source fields
      if (step.type === 'transform' && step.operation === 'map' && config.mapping) {
        const upstreamStepId = getUpstreamStepId(step.input);

        if (upstreamStepId) {
          const upstreamSchema = stepOutputs.get(upstreamStepId);
          if (upstreamSchema) {
            const availableFields = getAllSchemaFields(upstreamSchema);

            config.mapping.forEach((mapEntry: any, index: number) => {
              const sourceField = mapEntry.source;
              if (sourceField && !sourceField.startsWith('{{')) { // Raw field name
                if (!availableFields.includes(sourceField)) {
                  const suggestion = this.findSimilarField(sourceField, availableFields);
                  if (suggestion) {
                    issues.push({
                      stepId,
                      operation: 'map',
                      invalidField: sourceField,
                      suggestedField: suggestion.field,
                      context: 'map',
                      confidence: suggestion.confidence,
                      upstreamStep: upstreamStepId,
                      reason: `Map source field "${sourceField}" (mapping[${index}]) not found in ${upstreamStepId}. Available: ${availableFields.join(', ')}`
                    });
                  }
                }
              }
            });
          }
        }
      }

      // 4. TRANSFORM OPERATIONS: Check various field references in configs
      if (step.type === 'transform' && config.field && step.operation !== 'flatten') {
        const fieldName = config.field;
        const upstreamStepId = getUpstreamStepId(step.input);

        if (upstreamStepId && fieldName && typeof fieldName === 'string' && !fieldName.startsWith('{{')) {
          const upstreamSchema = stepOutputs.get(upstreamStepId);
          if (upstreamSchema) {
            const availableFields = getAllSchemaFields(upstreamSchema);

            if (!availableFields.includes(fieldName)) {
              const suggestion = this.findSimilarField(fieldName, availableFields);
              if (suggestion) {
                issues.push({
                  stepId,
                  operation: step.operation || 'transform',
                  invalidField: fieldName,
                  suggestedField: suggestion.field,
                  context: 'transform',
                  confidence: suggestion.confidence,
                  upstreamStep: upstreamStepId,
                  reason: `Transform field "${fieldName}" not found in ${upstreamStepId} output. Available: ${availableFields.join(', ')}`
                });
              }
            }
          }
        }
      }

      // 5. ACTION PARAMETERS: Check for raw field names in action configs
      // This is more heuristic - look for params that look like field names
      if (step.type === 'action' && (step.config || step.params)) {
        const params = step.config || step.params;
        const upstreamStepId = getUpstreamStepId(step.input);

        if (upstreamStepId) {
          const upstreamSchema = stepOutputs.get(upstreamStepId);
          if (upstreamSchema) {
            const availableFields = getAllSchemaFields(upstreamSchema);

            // Look for params that might be field references (e.g., "field", "source_field", "column", etc.)
            const fieldLikeParams = ['field', 'source_field', 'target_field', 'column', 'key', 'property'];

            fieldLikeParams.forEach(paramName => {
              const paramValue = params[paramName];
              if (paramValue && typeof paramValue === 'string' && !paramValue.startsWith('{{') && !paramValue.includes('/')) {
                // Check if this looks like a field name (simple heuristic)
                if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(paramValue)) {
                  if (!availableFields.includes(paramValue)) {
                    const suggestion = this.findSimilarField(paramValue, availableFields);
                    if (suggestion && suggestion.confidence >= 0.7) {
                      issues.push({
                        stepId,
                        operation: step.action || step.operation || 'action',
                        invalidField: paramValue,
                        suggestedField: suggestion.field,
                        context: 'action_param',
                        confidence: suggestion.confidence * 0.8, // Lower confidence for action params
                        upstreamStep: upstreamStepId,
                        reason: `Action param "${paramName}" value "${paramValue}" may be incorrect. Did you mean "${suggestion.field}"?`
                      });
                    }
                  }
                }
              }
            });
          }
        }
      }
    });

    return issues;
  }

  /**
   * Extract all field names from schema including nested paths
   * Returns both top-level and nested field paths (e.g., ["data", "data.content", "emails", "emails.attachments"])
   */
  private extractSchemaFieldsNested(schema: any, prefix: string = ''): string[] {
    const fields: string[] = [];

    if (!schema || typeof schema !== 'object') return fields;

    // Handle {type: "object", properties: {...}}
    if (schema.properties && typeof schema.properties === 'object') {
      for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
        const fullPath = prefix ? `${prefix}.${fieldName}` : fieldName;
        fields.push(fullPath);

        // Recurse into nested objects
        if ((fieldSchema as any).type === 'object' && (fieldSchema as any).properties) {
          fields.push(...this.extractSchemaFieldsNested(fieldSchema, fullPath));
        }

        // Recurse into array items
        if ((fieldSchema as any).type === 'array' && (fieldSchema as any).items) {
          const itemSchema = (fieldSchema as any).items;
          if (itemSchema.properties) {
            fields.push(...this.extractSchemaFieldsNested(itemSchema, fullPath));
          }
        }
      }
    }

    // Handle {type: "array", items: {properties: {...}}}
    if (schema.type === 'array' && schema.items && schema.items.properties) {
      fields.push(...this.extractSchemaFieldsNested(schema.items, prefix));
    }

    return fields;
  }
}
