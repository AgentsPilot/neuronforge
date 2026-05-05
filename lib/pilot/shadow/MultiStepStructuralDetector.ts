/**
 * Multi-Step Structural Detector
 *
 * Detects structural workflow issues that require multi-step fixes:
 * - Missing intermediate transformation steps (nested flattens)
 * - Missing aggregation steps (scatter-gather summaries)
 * - Missing data conversion steps (type mismatches)
 * - Incorrect step ordering (dependency violations)
 * - Schema-structure mismatches (declared vs actual output)
 *
 * This is a generic, plugin-agnostic system that works by analyzing:
 * 1. Schema structures (what operations actually produce)
 * 2. Semantic intent (what steps describe they should do)
 * 3. Data flow graphs (how data flows between steps)
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'MultiStepStructuralDetector' });

// Type definitions
type WorkflowStep = any;
type Agent = any;

/**
 * Structural issue types that require multi-step fixes
 */
export const STRUCTURAL_ISSUE_TYPES = [
  'missing_intermediate_flatten_step',      // Nested arrays need second flatten
  'missing_aggregation_step',               // Scatter-gather needs reduce/summary
  'missing_data_conversion_step',           // Type conversion needed
  'incorrect_step_order',                   // Dependencies not satisfied
  'missing_conditional_branch',             // No handling for empty/error cases
  'schema_structure_mismatch',              // Declared schema doesn't match operation
  'missing_join_step',                      // Multiple data sources not merged
  'missing_deduplication_step',             // Duplicate items not handled
] as const;

export type StructuralIssueType = typeof STRUCTURAL_ISSUE_TYPES[number];

/**
 * Detected structural issue
 */
export interface StructuralIssue {
  type: StructuralIssueType;
  stepId: string;
  confidence: number;
  description: string;

  // Type-specific fields
  targetField?: string;              // For missing_intermediate_flatten_step
  missingTransformation?: string;    // For transformation issues
  aggregationType?: string;          // For missing_aggregation_step
  fromType?: string;                 // For type conversion
  toType?: string;                   // For type conversion
  extractField?: string;             // For data conversion
  dependencyId?: string;             // For ordering issues
  actualSchema?: any;                // For schema mismatches
  declaredSchema?: any;              // For schema mismatches
}

/**
 * Multi-step fix action
 */
export interface MultiStepFix {
  action: 'insert_step' | 'reorder_steps' | 'update_step';
  affectedSteps: string[];
  insertions?: StepInsertion[];
  updates?: StepUpdate[];
  reorderings?: StepReordering[];
  verified: boolean;
  confidence: number;
  reasoning: string;
}

export interface StepInsertion {
  newStepId: string;
  insertPosition: 'before' | 'after';
  targetStepId: string;
  newStep: WorkflowStep;
  updateDownstreamReferences?: StepUpdate[];
}

export interface StepUpdate {
  stepId: string;
  changes: Partial<WorkflowStep>;
}

export interface StepReordering {
  stepId: string;
  fromIndex: number;
  toIndex: number;
  reason: string;
}

/**
 * Semantic intent extracted from step descriptions
 */
interface SemanticIntent {
  type: 'extract_nested' | 'aggregate' | 'filter_conditional' | 'transform_structure' | 'deduplicate' | 'join_data' | 'unknown';
  summary: string;
  keywords: string[];
}

/**
 * Multi-Step Structural Detector
 *
 * Core detection engine for structural workflow issues
 */
export class MultiStepStructuralDetector {

  /**
   * Main entry point: Detect all structural issues in a workflow
   */
  async detectStructuralIssues(agent: Agent): Promise<StructuralIssue[]> {
    const issues: StructuralIssue[] = [];

    logger.info({ agentId: agent.id }, '[MultiStepDetector] Starting structural analysis');

    // Detection Pattern 1: Schema-Output Mismatch
    const schemaIssues = this.detectSchemaOutputMismatches(agent);
    issues.push(...schemaIssues);

    logger.info({
      agentId: agent.id,
      schemaIssues: schemaIssues.length
    }, '[MultiStepDetector] Schema-output mismatch detection complete');

    // Detection Pattern 2: Intent-Structure Alignment (future)
    // const intentIssues = this.detectIntentStructureMismatches(agent);
    // issues.push(...intentIssues);

    // Detection Pattern 3: Data Flow Validation (future)
    // const dataFlowIssues = this.validateDataFlow(agent);
    // issues.push(...dataFlowIssues);

    logger.info({
      agentId: agent.id,
      totalIssues: issues.length,
      byType: this.groupIssuesByType(issues)
    }, '[MultiStepDetector] Structural analysis complete');

    return issues;
  }

  /**
   * DETECTION PATTERN 1: Schema-Output Mismatch
   *
   * Detects when a step's declared output_schema doesn't match what the operation actually produces.
   * This indicates missing intermediate steps are needed.
   */
  private detectSchemaOutputMismatches(agent: Agent): StructuralIssue[] {
    const issues: StructuralIssue[] = [];
    const transformSteps = (agent.pilot_steps || []).filter(
      (s: any) => s.type === 'transform' && ['flatten', 'filter', 'map'].includes(s.operation || s.config?.type)
    );

    logger.info({
      agentId: agent.id,
      totalSteps: agent.pilot_steps?.length || 0,
      transformSteps: transformSteps.length,
      transformStepIds: transformSteps.map((s: any) => s.step_id || s.id)
    }, '[MultiStepDetector] Analyzing transform steps for schema mismatches');

    for (const step of agent.pilot_steps || []) {
      const issue = this.detectSchemaOutputMismatch(step, agent);
      if (issue) {
        issues.push(issue);
      }
    }

    return issues;
  }

  /**
   * Detect schema-output mismatch for a single step
   */
  private detectSchemaOutputMismatch(
    step: WorkflowStep,
    agent: Agent
  ): StructuralIssue | null {

    // Only analyze transform steps with flatten/filter/map operations
    if (step.type !== 'transform') return null;

    const operation = step.operation || step.config?.type;
    if (!operation || !['flatten', 'filter', 'map'].includes(operation)) return null;

    // CRITICAL: Skip steps that already have an intermediate step inserted after them
    // This prevents infinite loop of inserting step2a, step2b, step2c, etc.
    const stepId = step.step_id || step.id;
    const hasIntermediateStep = agent.pilot_steps?.some((s: any) => {
      const sid = s.step_id || s.id;
      // Check if there's a step with ID like "step2a" when current is "step2"
      return sid && sid.startsWith(stepId) && sid.length === stepId.length + 1 && /[a-z]$/.test(sid);
    });

    if (hasIntermediateStep) {
      logger.info({
        stepId,
        reason: 'Already has intermediate step inserted'
      }, '[MultiStepDetector] Skipping step - already fixed with intermediate step');
      return null;
    }

    // CRITICAL: Prefer config.output_schema (user's intended output) over top-level output_schema
    // Top-level output_schema may have been auto-corrected by Layer 1 and contain mixed fields
    const declaredOutputSchema = step.config?.output_schema || step.output_schema;

    // Must have declared output_schema to compare
    if (!declaredOutputSchema) {
      logger.info({
        stepId: step.step_id || step.id,
        hasConfigSchema: !!step.config?.output_schema,
        hasStepSchema: !!step.output_schema
      }, '[MultiStepDetector] Skipping step - no output_schema');
      return null;
    }

    // Get source step to understand actual output
    const sourceStep = this.findSourceStep(step, agent.pilot_steps || []);
    if (!sourceStep?.output_schema) {
      logger.info({
        stepId: step.step_id || step.id,
        sourceStepFound: !!sourceStep
      }, '[MultiStepDetector] Skipping step - source step has no output_schema');
      return null;
    }

    // Infer what this operation ACTUALLY produces
    const actualOutputSchema = this.inferActualOutputSchema(step, sourceStep.output_schema);
    if (!actualOutputSchema) {
      logger.info({
        stepId: step.step_id || step.id,
        operation,
        field: step.config?.field,
        sourceSchemaType: sourceStep.output_schema?.type
      }, '[MultiStepDetector] Skipping step - cannot infer actual output schema');
      return null;
    }

    logger.info({
      stepId: step.step_id || step.id,
      operation,
      field: step.config?.field,
      usingConfigSchema: !!step.config?.output_schema,
      actualFields: Object.keys(actualOutputSchema.items?.properties || {}),
      declaredFields: Object.keys(declaredOutputSchema.items?.properties || {})
    }, '[MultiStepDetector] Comparing schemas for mismatch detection');

    // Check for mismatch
    const mismatch = this.analyzeSchemaMismatch(
      step,
      actualOutputSchema,
      declaredOutputSchema,
      sourceStep,
      agent
    );

    return mismatch;
  }

  /**
   * Infer what a transformation operation actually produces
   */
  private inferActualOutputSchema(step: WorkflowStep, sourceOutputSchema: any): any {
    const operation = step.operation || step.config?.type;
    let field = step.config?.field;

    logger.info({
      stepId: step.step_id || step.id,
      operation,
      hasConfig: !!step.config,
      configKeys: step.config ? Object.keys(step.config) : [],
      field,
      stepKeys: Object.keys(step)
    }, '[MultiStepDetector] Checking step configuration');

    // ENHANCEMENT: If flatten operation has no explicit field, try to infer it
    if (operation === 'flatten' && !field) {
      field = this.inferFlattenField(step, sourceOutputSchema);

      if (field) {
        logger.info({
          stepId: step.step_id || step.id,
          inferredField: field,
          customCode: step.config?.custom_code?.substring(0, 100),
          sourceSchemaType: sourceOutputSchema.type
        }, '[MultiStepDetector] Inferred flatten field from source schema or custom_code');
      }
    }

    if (operation === 'flatten' && field) {
      // Flatten extracts an array field and returns its items
      if (sourceOutputSchema.type === 'object' && sourceOutputSchema.properties?.[field]) {
        // Source is object, flatten extracts array field
        const arraySchema = sourceOutputSchema.properties[field];

        logger.info({
          stepId: step.step_id || step.id,
          operation,
          field,
          fieldSchema: arraySchema,
          hasItems: !!arraySchema.items
        }, '[MultiStepDetector] Checking flatten field in object schema');

        if (arraySchema.type === 'array' && arraySchema.items) {
          return {
            type: 'array',
            items: arraySchema.items
          };
        }
      } else if (sourceOutputSchema.type === 'array' && sourceOutputSchema.items?.properties?.[field]) {
        // Source is array, flatten extracts nested array from each item
        const nestedArraySchema = sourceOutputSchema.items.properties[field];

        logger.info({
          stepId: step.step_id || step.id,
          operation,
          field,
          fieldSchema: nestedArraySchema,
          hasItems: !!nestedArraySchema.items
        }, '[MultiStepDetector] Checking flatten field in array items schema');

        if (nestedArraySchema.type === 'array' && nestedArraySchema.items) {
          return {
            type: 'array',
            items: nestedArraySchema.items
          };
        }
      } else {
        // Field not found in source schema
        logger.info({
          stepId: step.step_id || step.id,
          operation,
          field,
          sourceSchemaType: sourceOutputSchema.type,
          availableFields: sourceOutputSchema.type === 'object'
            ? Object.keys(sourceOutputSchema.properties || {})
            : (sourceOutputSchema.type === 'array' && sourceOutputSchema.items?.properties
                ? Object.keys(sourceOutputSchema.items.properties)
                : [])
        }, '[MultiStepDetector] Flatten field not found in source schema');
      }
    }

    // For other operations or if we can't infer, return null
    return null;
  }

  /**
   * Infer the flatten field from custom_code or source schema
   *
   * Strategy:
   * 1. Check custom_code for field name hints (e.g., "Extract attachments array" → "attachments")
   * 2. If source is object with single array field, use that field
   * 3. If source is array, check for common nested array fields in items
   */
  private inferFlattenField(step: WorkflowStep, sourceOutputSchema: any): string | null {
    const customCode = step.config?.custom_code || step.description || '';

    // Strategy 1: Extract field name from custom_code
    // Patterns: "Extract X array", "Flatten X", "Get X from each"
    const patterns = [
      /extract\s+(\w+)\s+array/i,
      /flatten\s+(\w+)/i,
      /get\s+(\w+)\s+from/i,
      /(\w+)\s+array/i
    ];

    for (const pattern of patterns) {
      const match = customCode.match(pattern);
      if (match && match[1]) {
        const candidateField = match[1].toLowerCase();

        // Verify field exists in source schema
        if (sourceOutputSchema.type === 'object' && sourceOutputSchema.properties?.[candidateField]) {
          if (sourceOutputSchema.properties[candidateField].type === 'array') {
            return candidateField;
          }
        }

        if (sourceOutputSchema.type === 'array' && sourceOutputSchema.items?.properties?.[candidateField]) {
          if (sourceOutputSchema.items.properties[candidateField].type === 'array') {
            return candidateField;
          }
        }
      }
    }

    // Strategy 2: If source is object with exactly one array field, use it
    if (sourceOutputSchema.type === 'object' && sourceOutputSchema.properties) {
      const arrayFields = Object.entries(sourceOutputSchema.properties)
        .filter(([_, schema]: [string, any]) => schema.type === 'array')
        .map(([name]) => name);

      if (arrayFields.length === 1) {
        logger.info({
          stepId: step.step_id || step.id,
          inferredField: arrayFields[0],
          reason: 'only array field in object schema',
          schemaType: 'object'
        }, '[MultiStepDetector] Auto-inferred flatten field from source schema');
        return arrayFields[0];
      }
    }

    // Strategy 3: If source is array, look for common nested array field patterns
    if (sourceOutputSchema.type === 'array' && sourceOutputSchema.items?.properties) {
      const nestedArrayFields = Object.entries(sourceOutputSchema.items.properties)
        .filter(([_, schema]: [string, any]) => schema.type === 'array')
        .map(([name]) => name);

      // Common nested array field names
      const commonNestedFields = ['attachments', 'items', 'files', 'children', 'results', 'data'];

      for (const commonField of commonNestedFields) {
        if (nestedArrayFields.includes(commonField)) {
          logger.info({
            stepId: step.step_id || step.id,
            inferredField: commonField,
            reason: 'common nested array field pattern',
            schemaType: 'array'
          }, '[MultiStepDetector] Auto-inferred flatten field from common patterns');
          return commonField;
        }
      }

      // If only one nested array field, use it
      if (nestedArrayFields.length === 1) {
        logger.info({
          stepId: step.step_id || step.id,
          inferredField: nestedArrayFields[0],
          reason: 'only nested array field in array items',
          schemaType: 'array'
        }, '[MultiStepDetector] Auto-inferred flatten field from source schema');
        return nestedArrayFields[0];
      }
    }

    logger.info({
      stepId: step.step_id || step.id,
      customCode: customCode.substring(0, 100),
      sourceSchemaType: sourceOutputSchema.type,
      availableFields: sourceOutputSchema.type === 'object'
        ? Object.keys(sourceOutputSchema.properties || {})
        : (sourceOutputSchema.type === 'array' && sourceOutputSchema.items?.properties
            ? Object.keys(sourceOutputSchema.items.properties)
            : [])
    }, '[MultiStepDetector] Could not infer flatten field');

    return null;
  }

  /**
   * Analyze schema mismatch to determine issue type and details
   */
  private analyzeSchemaMismatch(
    step: WorkflowStep,
    actual: any,
    declared: any,
    sourceStep: WorkflowStep,
    agent: Agent
  ): StructuralIssue | null {

    // CASE 1: Missing intermediate flatten step
    // Declared schema expects fields from nested array
    const nestedFlattenIssue = this.detectMissingIntermediateFlatten(
      step,
      actual,
      declared,
      sourceStep
    );

    if (nestedFlattenIssue) return nestedFlattenIssue;

    // CASE 2: Missing aggregation step (future)
    // CASE 3: Missing data conversion step (future)

    // CASE 4: Generic schema structure mismatch
    if (!this.schemasMatch(actual, declared)) {
      return {
        type: 'schema_structure_mismatch',
        stepId: step.step_id || step.id,
        actualSchema: actual,
        declaredSchema: declared,
        confidence: 0.70,
        description: `Step output schema mismatch: declared schema doesn't match what operation produces`
      };
    }

    return null;
  }

  /**
   * CRITICAL DETECTION: Missing intermediate flatten step for nested arrays
   *
   * Example: Gmail emails → attachments
   * - Step flattens "emails" → returns [{id, subject, attachments: [...]}]
   * - But output_schema expects [{attachment_id, filename, ...}]
   * - Detection: Fields in declared schema exist in nested "attachments" array
   * - Fix: Insert intermediate flatten step for "attachments"
   */
  private detectMissingIntermediateFlatten(
    step: WorkflowStep,
    actual: any,
    declared: any,
    sourceStep: WorkflowStep
  ): StructuralIssue | null {

    // Must be array output
    if (actual.type !== 'array' || !actual.items?.properties) return null;
    if (declared.type !== 'array' || !declared.items?.properties) return null;

    // Get fields that operation actually produces
    const actualFields = Object.keys(actual.items.properties);

    // Get fields that declared schema expects
    const declaredFields = Object.keys(declared.items.properties);

    // Find fields in declared that don't exist in actual
    const missingFields = declaredFields.filter(f => !actualFields.includes(f));

    if (missingFields.length === 0) return null; // No missing fields

    // Check if missing fields exist in a NESTED ARRAY within actual output
    const nestedArrayField = this.findNestedArrayWithFields(
      actual.items.properties,
      missingFields
    );

    if (!nestedArrayField) return null; // Missing fields not in nested array

    // DETECTED: Missing intermediate flatten step
    logger.info({
      stepId: step.step_id || step.id,
      actualFields,
      declaredFields,
      missingFields,
      nestedArrayField
    }, '[MultiStepDetector] Detected missing intermediate flatten step');

    return {
      type: 'missing_intermediate_flatten_step',
      stepId: step.step_id || step.id,
      targetField: nestedArrayField,
      confidence: 0.85,
      description: `Flatten "${step.config?.field}" produces objects with nested "${nestedArrayField}" array, but output schema expects fields from inside that array (${missingFields.join(', ')}). Need intermediate flatten step for "${nestedArrayField}".`
    };
  }

  /**
   * Find nested array field that contains the missing fields
   */
  private findNestedArrayWithFields(
    properties: Record<string, any>,
    missingFields: string[]
  ): string | null {

    // Look for array fields in the properties
    for (const [propName, propSchema] of Object.entries(properties)) {
      if (propSchema.type === 'array' && propSchema.items?.properties) {
        // Check if this nested array contains the missing fields
        const nestedFields = Object.keys(propSchema.items.properties);
        const matchCount = missingFields.filter(f => nestedFields.includes(f)).length;

        // If at least 70% of missing fields exist in this nested array, it's likely the target
        if (matchCount >= missingFields.length * 0.7) {
          logger.debug({
            nestedArrayField: propName,
            nestedFields,
            missingFields,
            matchCount,
            matchPercentage: (matchCount / missingFields.length * 100).toFixed(0) + '%'
          }, 'Found nested array containing missing fields');

          return propName;
        }
      }
    }

    return null;
  }

  /**
   * Check if two schemas match (simplified comparison)
   */
  private schemasMatch(schema1: any, schema2: any): boolean {
    // Simple type check
    if (schema1.type !== schema2.type) return false;

    // For objects, check if properties match
    if (schema1.type === 'object') {
      const props1 = Object.keys(schema1.properties || {});
      const props2 = Object.keys(schema2.properties || {});

      // Check if key sets are similar (allow some difference)
      const commonProps = props1.filter(p => props2.includes(p));
      return commonProps.length >= Math.min(props1.length, props2.length) * 0.7;
    }

    // For arrays, check items schema
    if (schema1.type === 'array') {
      if (!schema1.items || !schema2.items) return false;
      return this.schemasMatch(schema1.items, schema2.items);
    }

    return true; // Primitives match if type matches
  }

  /**
   * Generate multi-step fix for detected structural issue
   */
  async generateMultiStepFix(
    issue: StructuralIssue,
    agent: Agent
  ): Promise<MultiStepFix | null> {

    switch (issue.type) {
      case 'missing_intermediate_flatten_step':
        return this.generateIntermediateFlattenFix(issue, agent);

      // Future: other fix generators
      // case 'missing_aggregation_step':
      //   return this.generateAggregationStepFix(issue, agent);

      default:
        logger.warn({ issueType: issue.type }, 'No fix generator for issue type');
        return null;
    }
  }

  /**
   * Generate fix for missing intermediate flatten step
   */
  private generateIntermediateFlattenFix(
    issue: StructuralIssue,
    agent: Agent
  ): MultiStepFix | null {

    const step = this.findStep(agent.pilot_steps || [], issue.stepId);
    if (!step) return null;

    // Generate new step ID (insert after current step)
    const newStepId = this.generateStepId(agent.pilot_steps || [], step.id);

    // Find downstream steps that use current step's output
    const downstreamUpdates = this.getDownstreamReferences(step, agent);

    logger.info({
      originalStepId: issue.stepId,
      newStepId,
      targetField: issue.targetField,
      downstreamUpdates: downstreamUpdates.length
    }, '[MultiStepDetector] Generating intermediate flatten step fix');

    // CRITICAL: Use newStepId as the output variable name to ensure uniqueness
    // This prevents multiple inserted steps from having the same output_variable
    // which would cause circular dependency issues in propagateDependencies
    const outputVariable = newStepId.replace(/step(\d+)([a-z])/, 'flattened_$1$2');

    // CRITICAL: Compute the CORRECT output schema for the new flatten step
    // The new step flattens issue.targetField from the original step's ACTUAL output
    // We must use the actual output schema, not the declared schema, to prevent
    // the detector from thinking this new step ALSO needs an intermediate flatten
    const sourceStep = this.findSourceStep(step, agent.pilot_steps || []);
    const actualOutputSchema = sourceStep?.output_schema
      ? this.inferActualOutputSchema(step, sourceStep.output_schema)
      : null;
    const newStepOutputSchema = this.computeNewStepOutputSchema(actualOutputSchema, issue.targetField || '', step.output_schema);

    return {
      action: 'insert_step',
      affectedSteps: [issue.stepId, newStepId, ...downstreamUpdates.map(u => u.stepId)],
      insertions: [{
        newStepId,
        insertPosition: 'after',
        targetStepId: issue.stepId,
        newStep: {
          id: newStepId,
          step_id: newStepId,
          type: 'transform',
          operation: 'flatten',
          input: `{{${step.output_variable}}}`,
          config: {
            type: 'flatten',
            field: issue.targetField,
            input: step.output_variable
          },
          description: `Extract ${issue.targetField} from each item (auto-inserted by calibration)`,
          output_variable: outputVariable, // UNIQUE per step (e.g., flattened_2a, flattened_2b)
          output_schema: newStepOutputSchema, // CORRECT schema based on what this flatten produces
          dependencies: [issue.stepId]
        },
        updateDownstreamReferences: downstreamUpdates
      }],
      updates: [{
        stepId: issue.stepId,
        changes: {
          // Update original step's output_schema to match what it actually produces
          output_schema: this.inferActualOutputSchemaForUpdate(step, agent)
        }
      }],
      verified: true,
      confidence: issue.confidence,
      reasoning: issue.description
    };
  }

  /**
   * Infer actual output schema for step update
   */
  private inferActualOutputSchemaForUpdate(step: WorkflowStep, agent: Agent): any {
    const sourceStep = this.findSourceStep(step, agent.pilot_steps || []);
    if (!sourceStep?.output_schema) return step.output_schema;

    // Try to get field from config, or infer it if missing
    let field = step.config?.field;
    if (!field) {
      field = this.inferFlattenField(step, sourceStep.output_schema);
      if (!field) return step.output_schema;
    }

    // For flatten of root-level array
    if (sourceStep.output_schema.type === 'object' && sourceStep.output_schema.properties?.[field]) {
      const arraySchema = sourceStep.output_schema.properties[field];
      if (arraySchema.type === 'array' && arraySchema.items) {
        return {
          type: 'array',
          items: arraySchema.items
        };
      }
    }

    return step.output_schema;
  }

  /**
   * Compute the correct output schema for a newly inserted flatten step
   *
   * The new step flattens targetField from actualOutputSchema (what the parent step produces)
   * and should produce the schema that the original declared schema expected
   *
   * @param actualOutputSchema - What the parent step actually produces (e.g., array of emails with attachments)
   * @param targetField - The field to flatten (e.g., "attachments")
   * @param declaredSchema - What the original step declared it would produce (e.g., array of attachment objects)
   * @returns The schema the new flatten step will produce
   */
  private computeNewStepOutputSchema(
    actualOutputSchema: any,
    targetField: string,
    declaredSchema: any
  ): any {
    // The new step flattens targetField from actualOutputSchema
    // Example: actualOutputSchema is array of emails [{id, subject, attachments: [...]}]
    //          targetField is "attachments"
    //          Result should be array of attachment objects [{filename, mimeType, ...}]

    if (!actualOutputSchema || actualOutputSchema.type !== 'array' || !actualOutputSchema.items?.properties) {
      // Fallback: use declared schema
      return declaredSchema;
    }

    const nestedArraySchema = actualOutputSchema.items.properties[targetField];

    if (nestedArraySchema?.type === 'array' && nestedArraySchema.items) {
      // Return the schema of the nested array items
      return {
        type: 'array',
        items: nestedArraySchema.items
      };
    }

    // Fallback: use declared schema
    return declaredSchema;
  }

  /**
   * Generate unique step ID for inserted step
   */
  private generateStepId(existingSteps: WorkflowStep[], baseStepId: string): string {
    // Try step{N}a, step{N}b, etc.
    const suffixes = ['a', 'b', 'c', 'd', 'e', 'f'];

    for (const suffix of suffixes) {
      const newId = `${baseStepId}${suffix}`;
      const exists = existingSteps.some(s => (s.step_id || s.id) === newId);
      if (!exists) return newId;
    }

    // Fallback: use timestamp
    return `${baseStepId}_${Date.now()}`;
  }

  /**
   * Get downstream steps that reference this step's output
   */
  private getDownstreamReferences(step: WorkflowStep, agent: Agent): StepUpdate[] {
    const updates: StepUpdate[] = [];
    const outputVar = step.output_variable;
    if (!outputVar) return updates;

    const regex = new RegExp(`{{\\s*${outputVar}\\s*}}`, 'g');

    for (const s of agent.pilot_steps || []) {
      const stepId = s.step_id || s.id;
      if (stepId === (step.step_id || step.id)) continue; // Skip self

      // Check input field
      if (s.input && typeof s.input === 'string' && regex.test(s.input)) {
        updates.push({
          stepId,
          changes: {
            input: s.input // Will be updated when fix is applied
          }
        });
      }
    }

    return updates;
  }

  /**
   * Find source step that this step receives input from
   */
  private findSourceStep(step: WorkflowStep, allSteps: WorkflowStep[]): WorkflowStep | null {
    const input = step.input;
    if (!input || typeof input !== 'string') return null;

    // Extract variable name from {{variable}} or {{step.variable}}
    const varMatch = input.match(/\{\{\s*([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_]+))?\s*\}\}/);
    if (!varMatch) return null;

    const varName = varMatch[1];

    // Find step with matching output_variable
    return allSteps.find(s => s.output_variable === varName) || null;
  }

  /**
   * Find step by ID
   */
  private findStep(steps: WorkflowStep[], stepId: string): WorkflowStep | null {
    return steps.find(s => (s.step_id || s.id) === stepId) || null;
  }

  /**
   * Group issues by type for logging
   */
  private groupIssuesByType(issues: StructuralIssue[]): Record<string, number> {
    const grouped: Record<string, number> = {};

    for (const issue of issues) {
      grouped[issue.type] = (grouped[issue.type] || 0) + 1;
    }

    return grouped;
  }
}
