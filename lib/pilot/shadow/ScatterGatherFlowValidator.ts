/**
 * ScatterGatherFlowValidator - Layer 4 Scatter-Gather Flow Validation
 *
 * Dedicated validation of scatter-gather variable flow and schema compatibility.
 * This validator traces how variables flow through scatter steps and ensures that:
 * 1. gather.from points to the correct variable (last created output)
 * 2. Gathered items schema matches downstream step input requirements
 * 3. gather.operation is appropriate for the data type
 *
 * Philosophy:
 * - Trace variable flow through each scatter step execution
 * - Build map of variable name → schema at each step
 * - Validate gather.from selection against expected outputs
 * - Check schema compatibility between gather output and next step input
 *
 * @module lib/pilot/shadow/ScatterGatherFlowValidator
 */

import type { Agent } from '../types';
import { createLogger } from '@/lib/logger';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

const logger = createLogger({ module: 'ScatterGatherFlowValidator', service: 'shadow-agent' });

export type FlowIssueType =
  | 'scatter_gather_wrong_variable'     // gather.from points to wrong variable
  | 'scatter_item_schema_mismatch'      // Gathered items don't match expected schema
  | 'scatter_output_not_array'          // gather.from is not array type
  | 'gather_from_not_last_output'       // gather.from doesn't reference last output_variable
  | 'downstream_schema_incompatible';   // Next step expects different schema

export interface FlowValidationIssue {
  type: FlowIssueType;
  stepId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  autoFixable: boolean;
  confidence: number;
  description: string;
  suggestedFix?: {
    field: string;
    oldValue: any;
    newValue: any;
    reasoning: string;
  };
}

interface VariableFlow {
  variables: Map<string, VariableInfo>;
  executionOrder: string[];
}

interface VariableInfo {
  stepId: string;
  variableName: string;
  schema: any;
  isArray: boolean;
  createdAtIndex: number;
}

/**
 * ScatterGatherFlowValidator
 *
 * Validates variable flow through scatter-gather steps and schema compatibility.
 */
export class ScatterGatherFlowValidator {
  private pluginManager: PluginManagerV2 | null = null;

  async initialize(): Promise<void> {
    if (!this.pluginManager) {
      this.pluginManager = await PluginManagerV2.getInstance();
    }
  }

  /**
   * Validate all scatter-gather steps in workflow
   */
  async validateWorkflow(agent: Agent): Promise<FlowValidationIssue[]> {
    await this.initialize();

    const issues: FlowValidationIssue[] = [];
    const steps: any[] = agent.pilot_steps || [];

    if (steps.length === 0) {
      logger.warn({ agentId: agent.id }, 'No steps found in workflow');
      return issues;
    }

    logger.info({ agentId: agent.id, stepCount: steps.length }, 'Starting scatter-gather flow validation');

    // Find all scatter-gather steps (including nested)
    const scatterSteps = this.findScatterGatherSteps(steps);

    for (const scatterStep of scatterSteps) {
      // Trace variable flow through scatter block
      const variableFlow = this.traceScatterVariableFlow(scatterStep);

      // Validate gather.from points to correct variable
      const gatherFromIssues = this.validateGatherFrom(scatterStep, variableFlow);
      issues.push(...gatherFromIssues);

      // Validate gathered items schema matches next step input
      const schemaCompatIssues = await this.validateDownstreamSchema(scatterStep, steps, agent);
      issues.push(...schemaCompatIssues);

      // Validate gather.operation is correct for data type
      const operationIssues = this.validateGatherOperation(scatterStep, variableFlow);
      issues.push(...operationIssues);
    }

    logger.info({
      agentId: agent.id,
      totalIssues: issues.length,
      critical: issues.filter(i => i.severity === 'critical').length,
      autoFixable: issues.filter(i => i.autoFixable).length
    }, 'Scatter-gather flow validation complete');

    return issues;
  }

  /**
   * Find all scatter-gather steps in workflow (including nested)
   */
  private findScatterGatherSteps(steps: any[]): any[] {
    const scatterSteps: any[] = [];

    for (const step of steps) {
      if (step.type === 'scatter_gather') {
        scatterSteps.push(step);

        // Check for nested scatter-gather in scatter.steps
        if (step.scatter?.steps) {
          scatterSteps.push(...this.findScatterGatherSteps(step.scatter.steps));
        }
      }

      // Check conditional branches
      if (step.type === 'conditional') {
        if (step.then_steps) {
          scatterSteps.push(...this.findScatterGatherSteps(step.then_steps));
        }
        if (step.else_steps) {
          scatterSteps.push(...this.findScatterGatherSteps(step.else_steps));
        }
      }
    }

    return scatterSteps;
  }

  /**
   * Trace variable flow through scatter steps
   * Returns map of variable name → schema and execution order
   */
  private traceScatterVariableFlow(scatterStep: any): VariableFlow {
    const variables = new Map<string, VariableInfo>();
    const executionOrder: string[] = [];
    const scatterSteps = scatterStep.scatter?.steps || [];

    for (let i = 0; i < scatterSteps.length; i++) {
      const step = scatterSteps[i];
      executionOrder.push(step.step_id || step.id);

      // Track output_variable if present
      if (step.output_variable && step.output_schema) {
        const isArray = step.output_schema.type === 'array';

        variables.set(step.output_variable, {
          stepId: step.step_id || step.id,
          variableName: step.output_variable,
          schema: step.output_schema,
          isArray,
          createdAtIndex: i
        });

        logger.debug({
          stepId: step.step_id || step.id,
          outputVariable: step.output_variable,
          isArray,
          schemaType: step.output_schema.type
        }, 'Traced scatter step output variable');
      }
    }

    return { variables, executionOrder };
  }

  /**
   * Validate gather.from references the correct variable
   */
  private validateGatherFrom(
    scatterStep: any,
    flow: VariableFlow
  ): FlowValidationIssue[] {
    const issues: FlowValidationIssue[] = [];
    const stepId = scatterStep.step_id || scatterStep.id;

    if (!scatterStep.gather?.from) {
      // Missing gather.from is handled by StructuralRepairEngine
      return issues;
    }

    const gatherFrom = scatterStep.gather.from.replace(/\{\{|\}\}/g, '');
    const varInfo = flow.variables.get(gatherFrom);

    if (!varInfo) {
      // Variable doesn't exist - handled by EnhancedSchemaValidator
      return issues;
    }

    // Check if gather.from is the LAST created variable
    const allVars = Array.from(flow.variables.values());
    const lastVar = allVars.reduce((latest, current) =>
      current.createdAtIndex > latest.createdAtIndex ? current : latest
    , allVars[0]);

    if (lastVar && varInfo.variableName !== lastVar.variableName) {
      // gather.from doesn't point to last output - likely wrong variable
      issues.push({
        type: 'gather_from_not_last_output',
        stepId,
        severity: 'high',
        autoFixable: true,
        confidence: 0.85,
        description: `Scatter-gather gather.from="${gatherFrom}" is not the last created variable. Last output was "${lastVar.variableName}" from step "${lastVar.stepId}". This may cause incorrect data to be gathered.`,
        suggestedFix: {
          field: 'gather.from',
          oldValue: gatherFrom,
          newValue: lastVar.variableName,
          reasoning: `The last created output_variable in scatter is "${lastVar.variableName}", which is typically what should be gathered. Current gather.from="${gatherFrom}" was created at index ${varInfo.createdAtIndex}, but "${lastVar.variableName}" was created at index ${lastVar.createdAtIndex}.`
        }
      });
    }

    // Check if variable is array type
    if (!varInfo.isArray) {
      issues.push({
        type: 'scatter_output_not_array',
        stepId,
        severity: 'critical',
        autoFixable: false,
        confidence: 1.0,
        description: `Scatter-gather gather.from="${gatherFrom}" references variable with schema type "${varInfo.schema.type}", but gather operations require array type. This will cause execution failure.`
      });
    }

    return issues;
  }

  /**
   * Validate gathered items schema matches downstream step input requirements
   */
  private async validateDownstreamSchema(
    scatterStep: any,
    allSteps: any[],
    agent: Agent
  ): Promise<FlowValidationIssue[]> {
    const issues: FlowValidationIssue[] = [];
    const stepId = scatterStep.step_id || scatterStep.id;

    // Find next step after scatter-gather
    const scatterIndex = allSteps.findIndex(s => (s.step_id || s.id) === stepId);
    if (scatterIndex === -1 || scatterIndex === allSteps.length - 1) {
      // No next step or step not found
      return issues;
    }

    const nextStep = allSteps[scatterIndex + 1];
    if (!nextStep) return issues;

    // Get gathered output schema
    const gatherFrom = scatterStep.gather?.from;
    if (!gatherFrom) return issues;

    const gatherFromVar = gatherFrom.replace(/\{\{|\}\}/g, '');
    const scatterSteps = scatterStep.scatter?.steps || [];
    const sourceStep = scatterSteps.find((s: any) => s.output_variable === gatherFromVar);

    if (!sourceStep?.output_schema) {
      // Can't validate without schema
      return issues;
    }

    // Get next step's expected input schema
    const expectedInputSchema = await this.inferNextStepInputSchema(nextStep);
    if (!expectedInputSchema) {
      // Can't validate without knowing expected schema
      return issues;
    }

    // Compare schemas for compatibility
    const incompatibilities = this.findSchemaIncompatibilities(
      sourceStep.output_schema,
      expectedInputSchema,
      nextStep
    );

    for (const incompatibility of incompatibilities) {
      issues.push({
        type: 'scatter_item_schema_mismatch',
        stepId,
        severity: 'critical',
        autoFixable: false,
        confidence: 0.95,
        description: `Scatter-gather output schema incompatible with next step (${nextStep.step_id || nextStep.id}). ${incompatibility.message}. Expected fields: ${incompatibility.expectedFields.join(', ')}. Available fields: ${incompatibility.availableFields.join(', ')}.`
      });
    }

    return issues;
  }

  /**
   * Infer expected input schema for next step
   */
  private async inferNextStepInputSchema(nextStep: any): Promise<any | null> {
    // For transform steps, infer from operation
    if (nextStep.type === 'transform') {
      const operation = nextStep.operation || nextStep.config?.type;

      if (operation === 'filter') {
        // Filter expects array of objects with fields used in condition
        const condition = nextStep.condition || nextStep.config?.condition;
        if (condition?.field) {
          // Extract field name from condition (e.g., "item.amount" → "amount")
          const fieldName = condition.field.replace(/^item\./, '');
          return {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                [fieldName]: { type: 'number' } // Assume number for comparison operations
              },
              required: [fieldName]
            }
          };
        }
      }

      if (operation === 'map') {
        // Map expects array of objects
        return {
          type: 'array',
          items: { type: 'object' }
        };
      }
    }

    // For action steps, check plugin definition
    if (nextStep.type === 'action' && nextStep.plugin && this.pluginManager) {
      const pluginDef = this.pluginManager.getPluginDefinition(nextStep.plugin);
      const action = nextStep.action || nextStep.operation;

      if (pluginDef && action && pluginDef.actions[action]) {
        // Get input schema from plugin action definition
        return pluginDef.actions[action].input_schema || null;
      }
    }

    return null;
  }

  /**
   * Find schema incompatibilities between gathered output and expected input
   */
  private findSchemaIncompatibilities(
    gatheredSchema: any,
    expectedSchema: any,
    nextStep: any
  ): Array<{ message: string; expectedFields: string[]; availableFields: string[] }> {
    const incompatibilities: Array<{ message: string; expectedFields: string[]; availableFields: string[] }> = [];

    // Check if expected schema requires array
    if (expectedSchema.type === 'array' && gatheredSchema.type !== 'array') {
      incompatibilities.push({
        message: `Next step expects array but gathered output is ${gatheredSchema.type}`,
        expectedFields: ['array'],
        availableFields: [gatheredSchema.type]
      });
      return incompatibilities;
    }

    // Check required fields in expected schema
    if (expectedSchema.type === 'array' && expectedSchema.items?.required) {
      const requiredFields = expectedSchema.items.required;
      const availableFields = gatheredSchema.type === 'array' && gatheredSchema.items?.properties
        ? Object.keys(gatheredSchema.items.properties)
        : Object.keys(gatheredSchema.properties || {});

      const missingFields = requiredFields.filter((f: string) => !availableFields.includes(f));

      if (missingFields.length > 0) {
        incompatibilities.push({
          message: `Missing required fields: ${missingFields.join(', ')}`,
          expectedFields: requiredFields,
          availableFields
        });
      }
    }

    return incompatibilities;
  }

  /**
   * Validate gather.operation is appropriate for data type
   */
  private validateGatherOperation(
    scatterStep: any,
    flow: VariableFlow
  ): FlowValidationIssue[] {
    const issues: FlowValidationIssue[] = [];
    const stepId = scatterStep.step_id || scatterStep.id;
    const operation = scatterStep.gather?.operation;

    if (!operation) {
      // Default operation is 'collect' - no validation needed
      return issues;
    }

    const gatherFrom = scatterStep.gather?.from?.replace(/\{\{|\}\}/g, '');
    if (!gatherFrom) return issues;

    const varInfo = flow.variables.get(gatherFrom);
    if (!varInfo) return issues;

    // Validate 'flatten' operation
    if (operation === 'flatten') {
      // Flatten requires nested array structure
      // Check if variable schema is array of arrays
      const isNestedArray = varInfo.schema.type === 'array' &&
                           varInfo.schema.items?.type === 'array';

      if (!isNestedArray) {
        issues.push({
          type: 'scatter_item_schema_mismatch',
          stepId,
          severity: 'medium',
          autoFixable: true,
          confidence: 0.80,
          description: `Scatter-gather uses gather.operation='flatten' but "${gatherFrom}" is not a nested array. Flatten requires array of arrays. Current type: array of ${varInfo.schema.items?.type || 'unknown'}.`,
          suggestedFix: {
            field: 'gather.operation',
            oldValue: 'flatten',
            newValue: 'collect',
            reasoning: `Variable "${gatherFrom}" is not a nested array, so 'collect' operation is more appropriate than 'flatten'.`
          }
        });
      }
    }

    return issues;
  }
}
