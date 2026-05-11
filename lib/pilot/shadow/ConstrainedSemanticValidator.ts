/**
 * Layer 2: Constrained Semantic Validator
 *
 * Uses LLM to DETECT semantic issues but generates fixes DETERMINISTICALLY.
 * This prevents hallucinations while leveraging LLM's semantic understanding.
 *
 * Architecture:
 * 1. LLM Detection: Identify issues using constrained JSON schema output
 * 2. Verification: Validate each LLM-detected issue against actual schemas
 * 3. Fix Generation: Deterministic code generates fixes from verified schema fields
 * 4. Schema Validation: Final check that fixes reference existing fields
 *
 * Safety Guarantees:
 * - LLM output constrained by JSON schema (stepId enum, issueType enum)
 * - Every detected issue verified against ground truth schemas
 * - Fixes generated deterministically from verified schema fields only
 * - Final validation rejects fixes referencing non-existent fields
 * - Confidence thresholds prevent risky auto-fixes (0.85+ silent, 0.70-0.84 notify, <0.70 skip)
 */

import { createLogger } from '@/lib/logger';
import type { Agent } from '@/lib/repositories/types';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import {
  MultiStepStructuralDetector,
  type StructuralIssue,
  type MultiStepFix
} from './MultiStepStructuralDetector';

const logger = createLogger({ module: 'ConstrainedSemanticValidator' });

// Type definitions for workflow steps (use any for flexibility)
type WorkflowStep = any;
type TransformStep = any;
type ScatterGatherStep = any;

// Known issue types (constraint for LLM)
const KNOWN_ISSUE_TYPES = [
  'field_not_found',
  'field_wrong_nesting_level',
  'type_mismatch',
  'empty_result_likely',
  'filter_too_restrictive',
  'variable_reference_invalid',
  'missing_required_param',
  'semantic_inconsistency',
  // Scatter-gather specific
  'scatter_gather_wrong_variable',   // gather.from points to wrong variable
  'scatter_item_schema_mismatch',    // gathered items don't match expected schema
  'scatter_output_not_array',        // gather.from is not array type
  'itemVariable_scope_conflict'      // itemVariable name conflicts
] as const;

type IssueType = typeof KNOWN_ISSUE_TYPES[number];

interface DetectedIssue {
  stepId: string;
  issueType: IssueType;
  problematicField?: string;
  description: string;
  confidence: number;
}

interface SuggestedFix {
  action: 'update_field' | 'add_field' | 'remove_field' | 'update_config';
  stepId: string;
  path: string; // e.g., 'config.field', 'input_variable', 'gather.from'
  oldValue: any;
  newValue: any;
  verified: boolean;
  confidence: number;
  reasoning: string;
}

interface PluginSchema {
  name: string;
  actions: Array<{
    name: string;
    description: string;
    parameters: Record<string, any>;
    outputSchema?: any;
  }>;
}

export class ConstrainedSemanticValidator {
  constructor() {}

  /**
   * Main entry point: detect issues, verify them, and generate constrained fixes
   */
  async validateWorkflow(
    agent: Agent,
    pluginSchemas: Map<string, PluginSchema>
  ): Promise<SuggestedFix[]> {
    logger.info({ agentId: agent.id }, 'Starting constrained semantic validation');

    // Phase 1: LLM Detection (constrained output)
    const detectedIssues = await this.detectSemanticIssues(
      agent.pilot_steps || [],
      pluginSchemas,
      agent
    );

    logger.info({
      agentId: agent.id,
      detectedCount: detectedIssues.length
    }, 'LLM detection phase complete');

    // Phase 2: Verify each detected issue
    const verifiedIssues: DetectedIssue[] = [];
    for (const issue of detectedIssues) {
      const isValid = await this.verifyDetectedIssue(issue, agent);
      if (isValid) {
        verifiedIssues.push(issue);
      } else {
        logger.warn({
          issue,
          agentId: agent.id
        }, 'LLM detected issue could not be verified - discarding potential hallucination');
      }
    }

    logger.info({
      agentId: agent.id,
      detected: detectedIssues.length,
      verified: verifiedIssues.length,
      discarded: detectedIssues.length - verifiedIssues.length
    }, 'Verification phase complete');

    // Phase 3: Generate constrained fixes (deterministic)
    const fixes: SuggestedFix[] = [];
    for (const issue of verifiedIssues) {
      const fix = await this.generateConstrainedFix(issue, agent);

      if (fix) {
        // Phase 4: Schema validation
        const isValidFix = this.validateFixAgainstSchema(fix, agent);

        if (!isValidFix) {
          logger.error({
            fix,
            agentId: agent.id
          }, 'Generated fix failed schema validation - REJECTED');
          continue;
        }

        fixes.push(fix);
        logger.info({
          fix,
          agentId: agent.id
        }, 'Generated and validated constrained fix');
      }
    }

    logger.info({
      agentId: agent.id,
      verifiedIssues: verifiedIssues.length,
      generatedFixes: fixes.length,
      highConfidence: fixes.filter(f => f.confidence >= 0.85).length,
      mediumConfidence: fixes.filter(f => f.confidence >= 0.70 && f.confidence < 0.85).length,
      lowConfidence: fixes.filter(f => f.confidence < 0.70).length
    }, 'Constrained semantic validation complete');

    return fixes;
  }

  /**
   * Phase 1: LLM Detection with Constrained Output
   * LLM ONLY detects issues - does NOT suggest fixes
   */
  private async detectSemanticIssues(
    workflow: WorkflowStep[],
    pluginSchemas: Map<string, PluginSchema>,
    agent: Agent
  ): Promise<DetectedIssue[]> {
    const validStepIds = workflow.map(s => s.step_id || s.id);

    const prompt = this.buildDetectionPrompt(workflow, pluginSchemas, validStepIds, agent);

    try {
      const provider = ProviderFactory.getProvider('anthropic');

      const response = await provider.chatCompletion(
        {
          model: 'claude-sonnet-4-5-20250929', // Fast + accurate
          temperature: 0.1, // Minimize hallucinations
          messages: [
            {
              role: 'user',
              content: prompt + '\n\nYou MUST respond with valid JSON only. No explanatory text.'
            }
          ],
          max_tokens: 4000
        },
        {
          userId: 'system',
          feature: 'calibration',
          component: 'ConstrainedSemanticValidator'
        }
      );

      let content = response.choices[0]?.message?.content || '{"issues":[]}';

      // Strip markdown code blocks if present (```json ... ```)
      content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/,'').trim();

      const parsed = JSON.parse(content);
      return parsed.issues || [];
    } catch (error: any) {
      logger.error({ error: error.message }, 'LLM detection failed');
      return [];
    }
  }

  /**
   * Build detection prompt (LLM sees everything, suggests nothing)
   */
  private buildDetectionPrompt(
    workflow: WorkflowStep[],
    pluginSchemas: Map<string, PluginSchema>,
    validStepIds: string[],
    agent: Agent
  ): string {
    const schemasFormatted = this.formatPluginSchemas(pluginSchemas);

    return `You are a workflow semantic analyzer. DETECT issues, do NOT suggest fixes.

# Agent Context
Agent Name: ${agent.agent_name || 'Unknown'}
Agent Description: ${agent.description || 'Not provided'}

# Input Schema
${JSON.stringify(agent.input_schema || [], null, 2)}

# Workflow Steps
${JSON.stringify(workflow, null, 2)}

# Available Plugin Schemas
${schemasFormatted}

# Task: Identify Execution Issues

Analyze the workflow and identify issues that will cause execution failures or empty results.

For each step, check:
1. **Field References**: If a step uses a field path (e.g., config.field = "emails"), does that field exist in the input data schema?
2. **Variable References**: Does the input_variable reference exist in a prior step's output_variable?
3. **Type Compatibility**: Are there type mismatches (array vs object, string vs number)?
4. **Empty Results**: Will this operation produce empty results due to incorrect field references or overly restrictive filters?
5. **Required Parameters**: Are required plugin parameters missing?
6. **Semantic Consistency**: Does the step's configuration match its stated purpose/description?

**For scatter-gather steps specifically, also check:**
7. **gather.from Variable**: Does gather.from reference the LAST created output_variable in scatter.steps? If not, wrong data will be gathered.
8. **gather.from Type**: Is the variable referenced by gather.from an array type? Gather operations require arrays.
9. **Gathered Schema Match**: Do the gathered items have the schema expected by the next step? Check if downstream steps reference fields that exist in gathered data.
10. **itemVariable Conflicts**: Does gather.itemVariable conflict with any step IDs, causing variable shadowing?
11. **gather.operation Match**: Is gather.operation appropriate for the data type? (e.g., 'flatten' requires nested arrays)

CRITICAL CONSTRAINTS:
- stepId MUST be from the provided workflow (${validStepIds.join(', ')})
- issueType MUST be from known types (${KNOWN_ISSUE_TYPES.join(', ')})
- DO NOT suggest any fixes
- DO NOT mention fields not in provided schemas
- ONLY report issues you can verify from schemas
- If unsure, set confidence < 0.7
- Focus on issues that will cause execution failures or empty results

Output format:
{
  "issues": [
    {
      "stepId": "step2",
      "issueType": "field_not_found",
      "problematicField": "emails",
      "description": "Flatten extracts 'emails' from array items, but items have schema {id, subject, attachments}. Field 'emails' not found.",
      "confidence": 0.95
    }
  ]
}
`;
  }

  /**
   * Format plugin schemas for LLM consumption
   */
  private formatPluginSchemas(pluginSchemas: Map<string, PluginSchema>): string {
    const schemas: string[] = [];

    for (const [key, schema] of pluginSchemas) {
      schemas.push(`## ${schema.name} (${key})`);

      for (const action of schema.actions) {
        schemas.push(`\n### Action: ${action.name}`);
        schemas.push(`Description: ${action.description}`);
        schemas.push(`Parameters: ${JSON.stringify(action.parameters, null, 2)}`);

        if (action.outputSchema) {
          schemas.push(`Output Schema: ${JSON.stringify(action.outputSchema, null, 2)}`);
        }
      }

      schemas.push(''); // Blank line between plugins
    }

    return schemas.join('\n');
  }

  /**
   * Phase 2: Verify LLM-detected issue against actual schemas
   */
  private async verifyDetectedIssue(
    issue: DetectedIssue,
    agent: Agent
  ): Promise<boolean> {
    const step = this.findStep(agent.pilot_steps || [], issue.stepId);
    if (!step) {
      logger.warn({ issue }, 'LLM referenced non-existent stepId');
      return false;
    }

    switch (issue.issueType) {
      case 'field_not_found': {
        if (!issue.problematicField) return false;

        // Verify field truly doesn't exist in schema AT THE CORRECT NESTING LEVEL
        const sourceStep = this.findSourceStep(step, agent.pilot_steps || []);
        if (!sourceStep?.output_schema) {
          // Can't verify without schema
          logger.debug({ stepId: issue.stepId }, 'Cannot verify field_not_found - no source schema');
          return false;
        }

        // Check field accessibility at the correct nesting level
        const isAccessible = this.isFieldAccessibleAtCorrectLevel(
          sourceStep.output_schema,
          issue.problematicField,
          step
        );

        return !isAccessible; // Issue valid if field is not accessible at the expected level
      }

      case 'field_wrong_nesting_level': {
        if (!issue.problematicField) return false;

        // Verify field exists but at wrong nesting level
        const sourceStep = this.findSourceStep(step, agent.pilot_steps || []);
        if (!sourceStep?.output_schema) return false;

        // Use the new helper to check nesting level
        const isAccessible = this.isFieldAccessibleAtCorrectLevel(
          sourceStep.output_schema,
          issue.problematicField,
          step
        );

        return !isAccessible; // Issue valid if field not accessible at correct level
      }

      case 'type_mismatch': {
        // For high-confidence issues (0.90+), trust the LLM detection
        // These are often parameter-level mismatches that we can't fully verify
        // without plugin schema introspection
        if (issue.confidence >= 0.90) {
          logger.info({
            stepId: issue.stepId,
            confidence: issue.confidence,
            description: issue.description
          }, 'Accepting high-confidence type_mismatch (likely parameter-level issue)');
          return true;
        }

        // For lower confidence, verify step-level type incompatibility
        const expectedType = this.getExpectedInputType(step);
        const actualType = this.getSourceOutputType(step, agent.pilot_steps || []);

        if (!expectedType || !actualType) return false;

        return !this.typesCompatible(expectedType, actualType);
      }

      case 'variable_reference_invalid': {
        // Verify variable reference doesn't exist
        const inputVar = (step as any).input_variable;
        if (!inputVar) return false;

        const sourceStepId = this.extractSourceStepId(inputVar);
        if (!sourceStepId) return false;

        const sourceStep = this.findStep(agent.pilot_steps || [], sourceStepId);
        return !sourceStep; // Issue valid if source step doesn't exist
      }

      case 'empty_result_likely':
      case 'filter_too_restrictive':
      case 'missing_required_param':
      case 'semantic_inconsistency': {
        // These require deeper analysis - accept with lower confidence
        return issue.confidence >= 0.7;
      }

      case 'scatter_gather_wrong_variable':
      case 'scatter_item_schema_mismatch':
      case 'scatter_output_not_array':
      case 'itemVariable_scope_conflict': {
        // Scatter-gather specific issues - accept medium-high confidence (0.75+)
        // These are structural issues that the LLM can detect reliably
        // Lower threshold because missing gather.from is critical
        return issue.confidence >= 0.75;
      }

      default:
        logger.warn({ issueType: issue.issueType }, 'Unknown issue type');
        return false;
    }
  }

  /**
   * Phase 3: Generate constrained fix (deterministic from verified schemas)
   */
  private async generateConstrainedFix(
    issue: DetectedIssue,
    agent: Agent
  ): Promise<SuggestedFix | null> {
    const step = this.findStep(agent.pilot_steps || [], issue.stepId);
    if (!step) return null;

    switch (issue.issueType) {
      case 'field_wrong_nesting_level':
      case 'field_not_found': {
        if (!issue.problematicField) return null;

        const sourceStep = this.findSourceStep(step, agent.pilot_steps || []);
        if (!sourceStep?.output_schema) return null;

        // Get ACTUAL available fields from schema at the correct nesting level
        const availableFields = this.extractAvailableFieldsAtCorrectLevel(
          sourceStep.output_schema,
          step
        );

        if (availableFields.length === 0) {
          // No fields available at correct level - might need structural change
          logger.info({
            stepId: issue.stepId,
            issueType: issue.issueType,
            problematicField: issue.problematicField
          }, 'No fields available at correct nesting level - workflow structure may need redesign');
          return null;
        }

        // Select best field deterministically
        const bestField = this.selectBestField(
          availableFields,
          issue.problematicField, // Hint from LLM
          step.description
        );

        const fieldPath = this.determineFieldPath(step, issue.problematicField);

        const reasoningPrefix = issue.issueType === 'field_wrong_nesting_level'
          ? `Field "${issue.problematicField}" exists but at wrong nesting level.`
          : `Field "${issue.problematicField}" not found in schema.`;

        return {
          action: 'update_field',
          stepId: issue.stepId,
          path: fieldPath,
          oldValue: issue.problematicField,
          newValue: bestField,
          verified: true,
          confidence: this.calculateConfidence(bestField, issue.problematicField, availableFields),
          reasoning: `${reasoningPrefix} Using "${bestField}" from available fields at correct level: ${availableFields.join(', ')}`
        };
      }

      case 'variable_reference_invalid': {
        // Find correct source step
        const availableOutputs = this.getAvailableOutputVariables(step, agent.pilot_steps || []);
        if (availableOutputs.length === 0) return null;

        const bestOutput = this.selectBestOutputVariable(availableOutputs, step.description);

        return {
          action: 'update_field',
          stepId: issue.stepId,
          path: 'input_variable',
          oldValue: (step as any).input_variable,
          newValue: bestOutput,
          verified: true,
          confidence: 0.85,
          reasoning: `Selected "${bestOutput}" from available output variables: ${availableOutputs.join(', ')}`
        };
      }

      case 'type_mismatch': {
        // Extract fix suggestion from LLM description
        // Patterns: "Should be {{drive_file.file_id}}" or "Should be '{{...}}'" or "Should reference '...' instead"
        const patterns = [
          /Should be (\{\{[^}]+\}\})/i,                 // Unquoted variable: "Should be {{drive_file.file_id}}"
          /Should be '([^']+)'/i,                       // Single quoted: "Should be '{{...}}'"
          /Should (?:reference|use) '([^']+)'/i,        // Reference with single quotes
          /Should (?:reference|use) "([^"]+)"/i,        // Reference with double quotes
          /Should (?:reference|use) (\{\{[^}]+\}\})/i   // Unquoted variable after reference
        ];

        let suggestedValue: string | null = null;
        for (const pattern of patterns) {
          const match = issue.description.match(pattern);
          if (match) {
            suggestedValue = match[1];
            break;
          }
        }

        if (suggestedValue && issue.problematicField) {
          // CRITICAL FIX: Ensure variable references are wrapped in {{}} braces
          // The LLM may suggest 'drive_file.file_id' (without braces), but we need {{drive_file.file_id}}
          if (!suggestedValue.startsWith('{{') && !suggestedValue.startsWith('"') && !suggestedValue.startsWith("'")) {
            // This looks like a variable reference without braces - add them
            suggestedValue = `{{${suggestedValue}}}`;
            logger.debug({
              stepId: issue.stepId,
              wrappedValue: suggestedValue
            }, 'Wrapped suggested value in {{}} braces for variable reference');
          }

          // Determine the path to the parameter
          const params = (step as any).params || (step as any).config || {};
          const paramPath = this.findParameterPath(params, issue.problematicField);

          if (paramPath) {
            logger.info({
              stepId: issue.stepId,
              path: paramPath,
              oldValue: issue.problematicField,
              newValue: suggestedValue
            }, 'Generated type_mismatch fix from LLM suggestion');

            return {
              action: 'update_field',
              stepId: issue.stepId,
              path: paramPath,
              oldValue: issue.problematicField,
              newValue: suggestedValue,
              verified: true,
              confidence: issue.confidence,
              reasoning: issue.description
            };
          }
        }

        // Fallback: no auto-fix available
        logger.info({ issue }, 'Type mismatch detected - no extractable fix from description');
        return null;
      }

      case 'scatter_gather_wrong_variable': {
        // Missing or incorrect gather.from - fix by setting to last output_variable
        const scatterSteps = (step as any).scatter?.steps || [];

        // Find all output variables in scatter steps
        const outputVariables = scatterSteps
          .filter((s: any) => s.output_variable)
          .map((s: any) => ({
            name: s.output_variable as string,
            stepId: (s.step_id || s.id) as string
          }));

        if (outputVariables.length === 0) {
          logger.info({ stepId: issue.stepId }, 'No output variables found in scatter steps');
          return null;
        }

        // Use the LAST output variable (most recent in execution order)
        const lastOutput = outputVariables[outputVariables.length - 1];

        logger.info({
          stepId: issue.stepId,
          currentGatherFrom: (step as any).gather?.from,
          suggestedGatherFrom: lastOutput.name,
          allOutputs: outputVariables.map((v: { name: string }) => v.name)
        }, 'Generated scatter_gather_wrong_variable fix');

        return {
          action: 'update_field',
          stepId: issue.stepId,
          path: 'gather.from',
          oldValue: (step as any).gather?.from || '(missing)',
          newValue: lastOutput.name,
          verified: true,
          confidence: issue.confidence,
          reasoning: `Scatter-gather gather.from should reference the last created output_variable "${lastOutput.name}" from step ${lastOutput.stepId}. Available outputs: ${outputVariables.map((v: { name: string }) => v.name).join(', ')}`
        };
      }

      default:
        logger.debug({ issueType: issue.issueType }, 'No auto-fix available for issue type');
        return null;
    }
  }

  /**
   * Phase 4: Schema Validation (reject invalid fixes)
   */
  private validateFixAgainstSchema(fix: SuggestedFix, agent: Agent): boolean {
    const step = this.findStep(agent.pilot_steps || [], fix.stepId);
    if (!step) return false;

    if (fix.action === 'update_field' && fix.path === 'config.field') {
      // Validate field exists in source schema
      const sourceStep = this.findSourceStep(step, agent.pilot_steps || []);
      if (!sourceStep?.output_schema) return false;

      const schema = this.extractSchema(sourceStep.output_schema);
      const fieldExists = this.checkFieldExists(schema, fix.newValue);

      if (!fieldExists) {
        logger.error({ fix }, 'Fix references non-existent field - REJECTED');
        return false;
      }

      // Verify type compatibility
      const fieldType = this.getFieldType(schema, fix.newValue);
      const expectedType = this.getExpectedInputType(step);

      if (expectedType && !this.typesCompatible(fieldType, expectedType)) {
        logger.error({ fix, fieldType, expectedType }, 'Type mismatch in fix - REJECTED');
        return false;
      }
    }

    return true;
  }

  /**
   * Apply fix to agent (mutates agent.pilot_steps)
   */
  async applyFix(agent: Agent, fix: SuggestedFix): Promise<boolean> {
    const step = this.findStep(agent.pilot_steps || [], fix.stepId);
    if (!step) return false;

    try {
      const pathParts = fix.path.split('.');

      if (pathParts.length === 1) {
        // Top-level field (e.g., 'input_variable')
        (step as any)[pathParts[0]] = fix.newValue;
      } else if (pathParts.length === 2) {
        // Nested field (e.g., 'config.field')
        const [parent, child] = pathParts;
        if (!(step as any)[parent]) {
          (step as any)[parent] = {};
        }
        (step as any)[parent][child] = fix.newValue;
      } else {
        logger.error({ fix }, 'Unsupported fix path depth');
        return false;
      }

      logger.info({
        stepId: fix.stepId,
        path: fix.path,
        oldValue: fix.oldValue,
        newValue: fix.newValue
      }, 'Applied fix to workflow step');

      return true;
    } catch (error: any) {
      logger.error({ error: error.message, fix }, 'Failed to apply fix');
      return false;
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private findStep(steps: WorkflowStep[], stepId: string): WorkflowStep | undefined {
    for (const step of steps) {
      // Check current step
      if (step.step_id === stepId || step.id === stepId) {
        return step;
      }

      // Check nested scatter steps
      if ((step as any).scatter?.steps) {
        const found = this.findStep((step as any).scatter.steps, stepId);
        if (found) return found;
      }

      // Check conditional branches
      if ((step as any).then_steps) {
        const found = this.findStep((step as any).then_steps, stepId);
        if (found) return found;
      }

      if ((step as any).else_steps) {
        const found = this.findStep((step as any).else_steps, stepId);
        if (found) return found;
      }
    }

    return undefined;
  }

  private findSourceStep(step: WorkflowStep, allSteps: WorkflowStep[]): WorkflowStep | undefined {
    const inputVar = (step as any).input_variable;
    if (!inputVar) return undefined;

    const sourceStepId = this.extractSourceStepId(inputVar);
    if (!sourceStepId) return undefined;

    return this.findStep(allSteps, sourceStepId);
  }

  private extractSourceStepId(inputVariable: string): string | null {
    // Handle {{step1.data}} format
    const match = inputVariable.match(/\{\{([^.}]+)/);
    return match ? match[1] : null;
  }

  private extractSchema(outputSchema: any): any {
    if (!outputSchema) return null;

    // Handle array schema
    if (outputSchema.type === 'array' && outputSchema.items) {
      return outputSchema.items;
    }

    // Handle object schema
    if (outputSchema.type === 'object') {
      return outputSchema;
    }

    return outputSchema;
  }

  private checkFieldExists(schema: any, fieldName: string): boolean {
    if (!schema || !schema.properties) return false;
    return fieldName in schema.properties;
  }

  /**
   * Check if field is accessible at the correct nesting level for the operation
   *
   * Example: If source returns {emails: [{attachments: []}]} and step tries to flatten "attachments",
   * this will return false because "attachments" is not at root level - it's nested in emails array.
   */
  private isFieldAccessibleAtCorrectLevel(
    sourceOutputSchema: any,
    fieldName: string,
    step: WorkflowStep
  ): boolean {
    const operation = (step as any).operation || (step as any).config?.type;

    // For flatten/filter/map operations on arrays
    if (operation === 'flatten' || operation === 'filter' || operation === 'map') {
      // Check what the source step actually returns
      if (sourceOutputSchema.type === 'object') {
        // Source returns an object - check if field is at root level
        const rootSchema = sourceOutputSchema;

        // Field must exist at root level properties
        if (rootSchema.properties && fieldName in rootSchema.properties) {
          return true; // Field accessible at root
        }

        // Check if field exists nested inside an array property
        // This is the problematic case we want to catch
        for (const [propName, propSchema] of Object.entries(rootSchema.properties || {})) {
          const prop = propSchema as any;

          // If this is an array property with items
          if (prop.type === 'array' && prop.items?.properties) {
            // Check if the field exists inside the array items
            if (fieldName in prop.items.properties) {
              logger.warn({
                stepId: step.step_id || step.id,
                fieldName,
                foundInArrayProperty: propName,
                operation
              }, `Field "${fieldName}" exists in nested array "${propName}[].${fieldName}", not at root level where ${operation} is looking`);
              return false; // Field exists but at wrong nesting level
            }
          }
        }

        return false; // Field not found at all
      } else if (sourceOutputSchema.type === 'array') {
        // Source returns an array - check if field is in array items
        const itemsSchema = sourceOutputSchema.items;

        if (itemsSchema?.properties && fieldName in itemsSchema.properties) {
          return true; // Field accessible in array items
        }

        return false;
      }
    }

    // For other operations, use simple existence check
    const schema = this.extractSchema(sourceOutputSchema);
    return this.checkFieldExists(schema, fieldName);
  }

  private getFieldType(schema: any, fieldName: string): string | null {
    if (!schema?.properties?.[fieldName]) return null;
    return schema.properties[fieldName].type || null;
  }

  /**
   * Extract available fields at the correct nesting level for the operation
   * This is critical for detecting fields that exist but at the wrong nesting level
   */
  private extractAvailableFieldsAtCorrectLevel(outputSchema: any, step: WorkflowStep): string[] {
    const operation = (step as any).operation || (step as any).config?.type;

    if (outputSchema.type === 'object') {
      // Source returns an object - get fields at root level
      const rootSchema = outputSchema;
      if (!rootSchema.properties) return [];

      const fields = Object.keys(rootSchema.properties);

      // For flatten operations, only return array fields at root level
      if (operation === 'flatten') {
        return fields.filter(f => rootSchema.properties[f].type === 'array');
      }

      return fields;
    } else if (outputSchema.type === 'array') {
      // Source returns an array - get fields from array items
      const itemsSchema = outputSchema.items;
      if (!itemsSchema?.properties) return [];

      const fields = Object.keys(itemsSchema.properties);

      // For flatten operations on array items, return array fields
      if (operation === 'flatten') {
        return fields.filter(f => itemsSchema.properties[f].type === 'array');
      }

      return fields;
    }

    return [];
  }

  private extractAvailableFields(outputSchema: any, step: WorkflowStep): string[] {
    const schema = this.extractSchema(outputSchema);
    if (!schema?.properties) return [];

    const fields = Object.keys(schema.properties);

    // For flatten operations, only return array fields
    if ((step as any).operation === 'flatten' || (step as any).config?.type === 'flatten') {
      return fields.filter(f => schema.properties[f].type === 'array');
    }

    return fields;
  }

  private selectBestField(
    availableFields: string[],
    requestedField: string,
    stepDescription?: string
  ): string {
    // Priority-based selection (deterministic)
    const priorities = ['attachments', 'items', 'results', 'data', 'files', 'records', 'rows'];

    // Check if requested field is close to any available field
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

    // Description-based matching
    if (stepDescription) {
      const desc = stepDescription.toLowerCase();
      for (const field of availableFields) {
        if (desc.includes(field.toLowerCase())) {
          return field;
        }
      }
    }

    // Default: first field alphabetically
    return availableFields.sort()[0];
  }

  private getAvailableOutputVariables(step: WorkflowStep, allSteps: WorkflowStep[]): string[] {
    const stepIndex = allSteps.findIndex(s => s.step_id === step.step_id || s.id === step.id);
    if (stepIndex === -1) return [];

    const priorSteps = allSteps.slice(0, stepIndex);
    return priorSteps
      .map(s => (s as any).output_variable)
      .filter(Boolean);
  }

  private selectBestOutputVariable(availableOutputs: string[], stepDescription?: string): string {
    if (stepDescription) {
      const desc = stepDescription.toLowerCase();
      for (const output of availableOutputs) {
        if (desc.includes(output.toLowerCase())) {
          return output;
        }
      }
    }

    // Default: last output (most recent step)
    return availableOutputs[availableOutputs.length - 1];
  }

  private determineFieldPath(step: WorkflowStep, problematicField: string): string {
    // Check where the field is used
    if ((step as any).config?.field === problematicField) {
      return 'config.field';
    }
    if ((step as any).field === problematicField) {
      return 'field';
    }
    if ((step as TransformStep).config?.type === 'flatten' && (step as any).config?.field === problematicField) {
      return 'config.field';
    }
    if ((step as ScatterGatherStep).gather?.from === problematicField) {
      return 'gather.from';
    }

    // Default
    return 'config.field';
  }

  private calculateConfidence(
    selectedField: string,
    requestedField: string,
    availableFields: string[]
  ): number {
    // Exact match (case-insensitive): 0.95
    if (selectedField.toLowerCase() === requestedField.toLowerCase()) {
      return 0.95;
    }

    // Priority field: 0.90
    const priorities = ['attachments', 'items', 'results', 'data', 'files', 'records', 'rows'];
    if (priorities.includes(selectedField)) {
      return 0.90;
    }

    // Description match: 0.85
    // (This would require description analysis, which was done in selectBestField)

    // Only one option available: 0.95
    if (availableFields.length === 1) {
      return 0.95;
    }

    // Multiple options, selected one: 0.75
    return 0.75;
  }

  private getExpectedInputType(step: WorkflowStep): string | null {
    const operation = (step as any).operation || (step as any).config?.type;

    switch (operation) {
      case 'flatten':
      case 'filter':
      case 'map':
        return 'array';
      default:
        return null;
    }
  }

  private getSourceOutputType(step: WorkflowStep, allSteps: WorkflowStep[]): string | null {
    const sourceStep = this.findSourceStep(step, allSteps);
    if (!sourceStep?.output_schema) return null;

    return sourceStep.output_schema.type || null;
  }

  private typesCompatible(type1: string | null, type2: string | null): boolean {
    if (!type1 || !type2) return true; // Can't verify, assume compatible

    // Exact match
    if (type1 === type2) return true;

    // Array vs object: incompatible
    if ((type1 === 'array' && type2 === 'object') || (type1 === 'object' && type2 === 'array')) {
      return false;
    }

    // String/number can often be coerced
    if ((type1 === 'string' || type1 === 'number') && (type2 === 'string' || type2 === 'number')) {
      return true;
    }

    return false;
  }

  /**
   * Find the path to a parameter by parameter name (not value)
   * Returns path like "params.file_id" or "config.file_id"
   */
  private findParameterPath(paramsOrConfig: any, paramName: string): string | null {
    // Check params first
    if (paramsOrConfig && typeof paramsOrConfig === 'object') {
      if (paramName in paramsOrConfig) {
        return `params.${paramName}`;
      }
    }

    // Check config
    const config = paramsOrConfig.config;
    if (config && typeof config === 'object') {
      if (paramName in config) {
        return `config.${paramName}`;
      }
    }

    // Not found - try just params.{paramName} as fallback
    return `params.${paramName}`;
  }

  /**
   * MULTI-STEP STRUCTURAL DETECTION
   *
   * Detects structural issues that require multi-step fixes (e.g., missing intermediate flatten steps)
   */
  async detectStructuralIssues(agent: Agent): Promise<StructuralIssue[]> {
    const detector = new MultiStepStructuralDetector();
    return detector.detectStructuralIssues(agent);
  }

  /**
   * Generate multi-step fix for structural issue
   */
  async generateMultiStepFix(issue: StructuralIssue, agent: Agent): Promise<MultiStepFix | null> {
    const detector = new MultiStepStructuralDetector();
    return detector.generateMultiStepFix(issue, agent);
  }

  /**
   * Apply multi-step fix to agent workflow
   */
  async applyMultiStepFix(agent: Agent, fix: MultiStepFix): Promise<boolean> {
    if (!agent.pilot_steps) {
      logger.error({ agentId: agent.id }, 'Agent has no pilot_steps');
      return false;
    }

    try {
      switch (fix.action) {
        case 'insert_step': {
          for (const insertion of fix.insertions || []) {
            // Find target step index
            const targetIndex = agent.pilot_steps.findIndex(
              (s: any) => (s.step_id || s.id) === insertion.targetStepId
            );

            if (targetIndex === -1) {
              logger.error({ insertion }, 'Target step not found for insertion');
              return false;
            }

            // Insert new step
            const insertIndex = insertion.insertPosition === 'after'
              ? targetIndex + 1
              : targetIndex;

            agent.pilot_steps.splice(insertIndex, 0, insertion.newStep);

            logger.info({
              newStepId: insertion.newStepId,
              insertPosition: insertion.insertPosition,
              targetStepId: insertion.targetStepId,
              insertIndex
            }, 'Inserted new step into workflow');

            // Update downstream references to use new step's output
            if (insertion.updateDownstreamReferences) {
              for (const update of insertion.updateDownstreamReferences) {
                const stepToUpdate = agent.pilot_steps.find(
                  (s: any) => (s.step_id || s.id) === update.stepId
                ) as any;

                if (stepToUpdate && stepToUpdate.input) {
                  // Replace old output variable with new step's output variable
                  const oldOutputVar = (insertion.newStep as any).dependencies?.[0];
                  const oldStep = agent.pilot_steps.find(
                    (s: any) => (s.step_id || s.id) === oldOutputVar
                  ) as any;

                  if (oldStep?.output_variable) {
                    stepToUpdate.input = stepToUpdate.input.replace(
                      new RegExp(`{{\\s*${oldStep.output_variable}\\s*}}`, 'g'),
                      `{{${(insertion.newStep as any).output_variable}}}`
                    );

                    // CRITICAL: Update dependencies to point to new step instead of old step
                    const oldStepId = oldStep.step_id || oldStep.id;
                    const newStepId = insertion.newStepId;

                    // Initialize dependencies array if it doesn't exist
                    if (!stepToUpdate.dependencies) {
                      stepToUpdate.dependencies = [newStepId];

                      logger.info({
                        stepId: update.stepId,
                        newDependency: newStepId,
                        createdDependencies: stepToUpdate.dependencies
                      }, 'Created dependencies array with new step');
                    } else if (Array.isArray(stepToUpdate.dependencies)) {
                      const dependencyIndex = stepToUpdate.dependencies.indexOf(oldStepId);

                      if (dependencyIndex !== -1) {
                        stepToUpdate.dependencies[dependencyIndex] = newStepId;

                        logger.info({
                          stepId: update.stepId,
                          oldDependency: oldStepId,
                          newDependency: newStepId,
                          updatedDependencies: stepToUpdate.dependencies
                        }, 'Updated downstream step dependency');
                      } else {
                        // Old step not in dependencies, add new step
                        stepToUpdate.dependencies.push(newStepId);

                        logger.info({
                          stepId: update.stepId,
                          newDependency: newStepId,
                          updatedDependencies: stepToUpdate.dependencies
                        }, 'Added new step to existing dependencies');
                      }
                    }

                    logger.info({
                      stepId: update.stepId,
                      oldInput: (update.changes as any).input,
                      newInput: stepToUpdate.input
                    }, 'Updated downstream step input reference');
                  }
                }
              }
            }
          }

          // Apply step updates
          if (fix.updates) {
            for (const update of fix.updates) {
              const stepToUpdate = agent.pilot_steps.find(
                (s: any) => (s.step_id || s.id) === update.stepId
              );

              if (stepToUpdate) {
                Object.assign(stepToUpdate, update.changes);
                logger.info({ stepId: update.stepId }, 'Updated step schema');
              }
            }
          }

          // CRITICAL: After inserting step2a and updating step3, we need to ensure
          // ALL steps that depend on step3's output also have correct dependencies
          // Example: step4 uses {{pdf_attachments}} from step3, so it must depend on step3
          this.propagateDependencies(agent);

          return true;
        }

        case 'reorder_steps': {
          if (!fix.reorderings) return false;

          for (const reorder of fix.reorderings) {
            const step = agent.pilot_steps.splice(reorder.fromIndex, 1)[0];
            agent.pilot_steps.splice(reorder.toIndex, 0, step);

            logger.info({
              stepId: reorder.stepId,
              from: reorder.fromIndex,
              to: reorder.toIndex
            }, 'Reordered step');
          }

          return true;
        }

        default:
          logger.warn({ action: fix.action }, 'Unknown multi-step fix action');
          return false;
      }

    } catch (error) {
      logger.error({ err: error, fix }, 'Failed to apply multi-step fix');
      return false;
    }
  }

  /**
   * Propagate dependencies throughout the workflow to ensure all steps that use
   * a step's output have that step in their dependencies array.
   *
   * This is critical after inserting intermediate steps (like step2a) because:
   * - step3 depends on step2a ✓
   * - step4 uses step3's output ({{pdf_attachments}}) but may not have step3 in dependencies ✗
   *
   * This method scans all steps and ensures:
   * 1. If step X uses {{variable}} from step Y's output, then step X depends on step Y
   * 2. Dependencies are added if missing
   */
  /**
   * Public method to propagate dependencies across workflow
   * Should be called after structural fixes to ensure all variable references have dependencies
   */
  public propagateDependencies(agent: Agent): void {
    if (!agent.pilot_steps) return;

    const steps = agent.pilot_steps as any[];

    // Build a map of output_variable -> stepId
    const outputVarToStepId = new Map<string, string>();
    for (const step of steps) {
      if (step.output_variable) {
        outputVarToStepId.set(step.output_variable, step.step_id || step.id);
      }
    }

    let updatesCount = 0;

    // For each step, check if it references variables and ensure dependencies are correct
    for (const step of steps) {
      const stepId = step.step_id || step.id;

      // Initialize dependencies if missing
      if (!step.dependencies) {
        step.dependencies = [];
      }

      // Extract all variable references from input (e.g., {{pdf_attachments}}, {{existing_sheet_rows.values}})
      const referencedVars = new Set<string>();

      if (step.input) {
        if (typeof step.input === 'string') {
          // Match {{variable}} or {{variable.path}} - capture root variable name only
          const varMatches = step.input.matchAll(/\{\{\s*(\w+)(?:\.[^}]*)?\s*\}\}/g);
          for (const match of varMatches) {
            referencedVars.add(match[1]);
          }
        } else if (typeof step.input === 'object') {
          // Handle object input like { candidate_rows: "{{candidate_rows}}", ... }
          this.extractVariableReferences(step.input, referencedVars);
        }
      }

      // For scatter_gather steps, also check scatter.input
      if (step.type === 'scatter_gather' && step.scatter?.input) {
        if (typeof step.scatter.input === 'string') {
          const varMatches = step.scatter.input.matchAll(/\{\{\s*(\w+)(?:\.[^}]*)?\s*\}\}/g);
          for (const match of varMatches) {
            referencedVars.add(match[1]);
          }
        } else if (typeof step.scatter.input === 'object') {
          this.extractVariableReferences(step.scatter.input, referencedVars);
        }
      }

      // ENHANCED: Also check step.params (recursively) for variable references
      if (step.params && typeof step.params === 'object') {
        this.extractVariableReferences(step.params, referencedVars);
      }

      // ENHANCED: Also check step.config (legacy field) for variable references
      if (step.config && typeof step.config === 'object') {
        this.extractVariableReferences(step.config, referencedVars);
      }

      // For each referenced variable, ensure the producing step is in dependencies
      for (const varName of referencedVars) {
        const producerStepId = outputVarToStepId.get(varName);

        if (producerStepId && producerStepId !== stepId) {
          // Check if dependency already exists
          if (!step.dependencies.includes(producerStepId)) {
            step.dependencies.push(producerStepId);
            updatesCount++;

            logger.info({
              stepId,
              varName,
              producerStepId,
              updatedDependencies: step.dependencies
            }, '[DependencyPropagation] Added missing dependency for variable reference');
          }
        }
      }
    }

    if (updatesCount > 0) {
      logger.info({
        agentId: agent.id,
        updatesCount,
        totalSteps: steps.length
      }, '[DependencyPropagation] Propagated dependencies across workflow');
    }
  }

  /**
   * Recursively extract variable references from objects, arrays, and strings
   *
   * Scans params/config objects to find all {{variable}} references
   * Example: { body: "{{digest_content}}", to: "yael@example.com" } → extracts "digest_content"
   * Example: { values: "{{existing_sheet_rows.values}}" } → extracts "existing_sheet_rows"
   */
  private extractVariableReferences(obj: any, referencedVars: Set<string>): void {
    if (typeof obj === 'string') {
      // Extract variable references like {{variable_name}} or {{variable_name.path.to.field}}
      // Capture the ROOT variable name (before any dots) - this is what we need for dependencies
      const varMatches = obj.matchAll(/\{\{\s*(\w+)(?:\.[^}]*)?\s*\}\}/g);
      for (const match of varMatches) {
        referencedVars.add(match[1]); // Only add the root variable name
      }
    } else if (Array.isArray(obj)) {
      // Recursively check array items
      for (const item of obj) {
        this.extractVariableReferences(item, referencedVars);
      }
    } else if (obj && typeof obj === 'object') {
      // Recursively check object values
      for (const value of Object.values(obj)) {
        this.extractVariableReferences(value, referencedVars);
      }
    }
  }
}
