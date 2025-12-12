/**
 * Self-Healing Repair Loop
 *
 * When a workflow step fails validation, this module:
 * 1. Identifies the specific error
 * 2. Sends targeted correction request to Sonnet 4
 * 3. Regenerates ONLY the broken step
 * 4. Retries validation
 * 5. Repeats up to MAX_RETRIES times
 *
 * This creates a self-repair mechanism that automatically resolves workflow generation errors.
 */

import Anthropic from '@anthropic-ai/sdk';
import { PluginManagerV2 } from '../server/plugin-manager-v2';

const MAX_REPAIR_RETRIES = 3;

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY,
});

/**
 * Context needed to repair a broken step
 */
export interface RepairContext {
  brokenStep: any;
  stepIndex: number;
  errorMessage: string;
  validActions?: string[];
  pluginSchema?: any;
  workflowContext: any[];  // Surrounding steps for context
  userPrompt: string;      // Original user request
}

/**
 * Result of repair attempt
 */
export interface RepairResult {
  repaired: boolean;
  fixedStep?: any;
  attempts: number;
  finalError?: string;
}

/**
 * Attempt to repair a single invalid workflow step
 */
export async function repairInvalidStep(
  context: RepairContext
): Promise<RepairResult> {

  let attempts = 0;
  let lastError = context.errorMessage;

  while (attempts < MAX_REPAIR_RETRIES) {
    attempts++;

    console.log(`🔧 [Repair Loop] Attempt ${attempts}/${MAX_REPAIR_RETRIES} to fix step "${context.brokenStep.id}"`);

    try {
      // Build focused correction prompt
      const repairPrompt = buildRepairPrompt(context, lastError);

      // Ask Sonnet 4 to fix ONLY this step
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        temperature: 0.1, // Low temperature for precise fixes
        messages: [{
          role: 'user',
          content: repairPrompt
        }],
        tools: [{
          name: 'fix_workflow_step',
          description: 'Fix the invalid workflow step',
          input_schema: buildRepairToolSchema()
        }],
        tool_choice: {
          type: 'tool',
          name: 'fix_workflow_step'
        }
      });

      // Extract repaired step
      const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock =>
        block.type === 'tool_use' && block.name === 'fix_workflow_step'
      );

      if (!toolUse) {
        console.warn(`⚠️ [Repair Loop] No fix returned on attempt ${attempts}`);
        lastError = 'LLM did not return a fixed step';
        continue;
      }

      const repairedStep = toolUse.input as any;

      // Validate the repaired step
      const validation = await validateSingleStep(repairedStep, context);

      if (validation.isValid) {
        console.log(`✅ [Repair Loop] Successfully repaired step "${context.brokenStep.id}" after ${attempts} attempt(s)`);
        return { repaired: true, fixedStep: repairedStep, attempts };
      }

      console.warn(`⚠️ [Repair Loop] Repaired step still invalid: ${validation.error}`);
      lastError = validation.error || 'Step still invalid after repair';

    } catch (error: any) {
      console.error(`❌ [Repair Loop] Error during attempt ${attempts}:`, error.message);
      lastError = error.message;
    }
  }

  console.error(`❌ [Repair Loop] Failed to repair step "${context.brokenStep.id}" after ${MAX_REPAIR_RETRIES} attempts`);
  return { repaired: false, attempts, finalError: lastError };
}

/**
 * Build a focused repair prompt for Sonnet 4
 */
function buildRepairPrompt(context: RepairContext, errorMessage: string): string {
  const validActionsStr = context.validActions
    ? `\nVALID ACTIONS FOR THIS PLUGIN:\n${context.validActions.map(action => `- ${action}`).join('\n')}`
    : '';

  const pluginSchemaStr = context.pluginSchema
    ? `\n\nPLUGIN SCHEMA:\n${JSON.stringify(context.pluginSchema, null, 2)}`
    : '';

  return `You generated an INVALID workflow step that failed validation.

ORIGINAL USER REQUEST:
${context.userPrompt}

INVALID STEP (Position ${context.stepIndex + 1}):
${JSON.stringify(context.brokenStep, null, 2)}

VALIDATION ERROR:
${errorMessage}
${validActionsStr}
${pluginSchemaStr}

SURROUNDING WORKFLOW STEPS FOR CONTEXT:
${JSON.stringify(context.workflowContext, null, 2)}

CRITICAL RULES TO FIX:
1. Use ONLY valid actions from the list above
2. Use correct parameter names from the plugin schema
3. Ensure proper data type references (e.g., {{step1.data.values}} not {{step1.data.rows}})
4. For google-sheets: Use "values" field (2D array), not "rows"
5. For transform filter: Use nested config.condition structure
6. For conditionals: Use "trueBranch" and "falseBranch", not "then_step"/"else_step"
7. Reference transform outputs with .items: {{stepN.data.items}}
8. Use == operator for string equality, > only for numbers

TASK:
Fix ONLY this single step. Do not modify anything else about the workflow.
Return the corrected step in valid JSON format with all required fields.`;
}

/**
 * Build tool schema for the repair response
 */
function buildRepairToolSchema(): any {
  return {
    type: 'object',
    required: ['id', 'type', 'name'],
    properties: {
      id: {
        type: 'string',
        description: 'Step ID (must match original step ID)'
      },
      type: {
        type: 'string',
        description: 'Step type',
        enum: ['action', 'ai_processing', 'llm_decision', 'conditional', 'transform', 'loop', 'scatter_gather', 'comparison']
      },
      name: {
        type: 'string',
        description: 'Human-readable step name'
      },
      plugin: {
        type: 'string',
        description: 'Plugin key (required for action steps)'
      },
      action: {
        type: 'string',
        description: 'Action name (required for action steps)'
      },
      params: {
        type: 'object',
        description: 'Action parameters',
        additionalProperties: true
      },
      operation: {
        type: 'string',
        description: 'Operation type for transform/comparison steps'
      },
      input: {
        type: 'string',
        description: 'Input data reference for transform/ai_processing steps'
      },
      config: {
        type: 'object',
        description: 'Configuration for transform steps',
        additionalProperties: true
      },
      condition: {
        type: 'object',
        description: 'Condition for conditional steps'
      },
      trueBranch: {
        type: 'string',
        description: 'Step ID to execute if condition is true'
      },
      falseBranch: {
        type: 'string',
        description: 'Step ID to execute if condition is false'
      },
      prompt: {
        type: 'string',
        description: 'Prompt for ai_processing steps'
      }
    }
  };
}

/**
 * Validate a single repaired step
 */
async function validateSingleStep(
  step: any,
  context: RepairContext
): Promise<{ isValid: boolean; error?: string }> {

  // Check required fields
  if (!step.id || !step.type || !step.name) {
    return {
      isValid: false,
      error: 'Missing required fields: id, type, or name'
    };
  }

  // Validate action steps
  if (step.type === 'action') {
    if (!step.plugin || !step.action) {
      return {
        isValid: false,
        error: 'Action steps must have plugin and action fields'
      };
    }

    // Validate plugin and action exist
    try {
      const pluginManager = await PluginManagerV2.getInstance();
      const allPlugins = pluginManager.getAvailablePlugins();
      const pluginDef = allPlugins[step.plugin];

      if (!pluginDef) {
        return {
          isValid: false,
          error: `Plugin "${step.plugin}" not found`
        };
      }

      const actionDef = pluginDef.actions[step.action];
      if (!actionDef) {
        return {
          isValid: false,
          error: `Action "${step.action}" not found in plugin "${step.plugin}". Valid actions: ${Object.keys(pluginDef.actions).join(', ')}`
        };
      }

      // Check required parameters
      const requiredParams = actionDef.parameters?.required || [];
      const stepParams = step.params || {};

      for (const param of requiredParams) {
        if (stepParams[param] === undefined) {
          return {
            isValid: false,
            error: `Missing required parameter "${param}" for action "${step.plugin}.${step.action}"`
          };
        }
      }
    } catch (error: any) {
      return {
        isValid: false,
        error: `Validation error: ${error.message}`
      };
    }
  }

  // Validate transform steps
  if (step.type === 'transform') {
    if (!step.operation || !step.input) {
      return {
        isValid: false,
        error: 'Transform steps must have operation and input fields'
      };
    }

    // Check filter has nested condition
    if (step.operation === 'filter') {
      if (!step.config?.condition) {
        return {
          isValid: false,
          error: 'Filter transform must have nested config.condition (not flat config)'
        };
      }
    }
  }

  // Validate conditional steps
  if (step.type === 'conditional') {
    if (!step.condition) {
      return {
        isValid: false,
        error: 'Conditional steps must have condition field'
      };
    }

    if (!step.trueBranch && !step.falseBranch) {
      return {
        isValid: false,
        error: 'Conditional steps must have trueBranch or falseBranch'
      };
    }

    // Check for old syntax
    if ((step as any).then_step || (step as any).else_step) {
      return {
        isValid: false,
        error: 'Use trueBranch/falseBranch, not then_step/else_step'
      };
    }
  }

  // Validate ai_processing steps
  if (step.type === 'ai_processing' || step.type === 'llm_decision') {
    if (!step.input || !step.prompt) {
      return {
        isValid: false,
        error: 'AI processing steps must have input and prompt fields'
      };
    }
  }

  return { isValid: true };
}

/**
 * Attempt to repair multiple invalid steps in a workflow
 */
export async function repairWorkflow(
  workflowSteps: any[],
  validationErrors: Array<{ stepIndex: number; error: string }>,
  userPrompt: string
): Promise<{ repairedSteps: any[]; successCount: number; failureCount: number; fixes: string[] }> {

  const repairedSteps = [...workflowSteps];
  let successCount = 0;
  let failureCount = 0;
  const fixes: string[] = [];

  console.log(`🔧 [Repair Workflow] Attempting to repair ${validationErrors.length} invalid step(s)`);

  for (const error of validationErrors) {
    const stepIndex = error.stepIndex;
    const brokenStep = workflowSteps[stepIndex];

    if (!brokenStep) {
      console.warn(`⚠️ [Repair Workflow] Step index ${stepIndex} not found`);
      failureCount++;
      continue;
    }

    // Build context for repair
    const context: RepairContext = {
      brokenStep,
      stepIndex,
      errorMessage: error.error,
      workflowContext: getWorkflowContext(workflowSteps, stepIndex),
      userPrompt
    };

    // Try to add plugin schema if it's an action step
    if (brokenStep.plugin) {
      try {
        const pluginManager = await PluginManagerV2.getInstance();
        const allPlugins = pluginManager.getAvailablePlugins();
        const pluginDef = allPlugins[brokenStep.plugin];

        if (pluginDef) {
          context.validActions = Object.keys(pluginDef.actions);
          context.pluginSchema = pluginDef;
        }
      } catch (e) {
        // Continue without plugin schema
      }
    }

    // Attempt repair
    const result = await repairInvalidStep(context);

    if (result.repaired && result.fixedStep) {
      repairedSteps[stepIndex] = result.fixedStep;
      successCount++;
      const fixMsg = `Repaired step ${stepIndex + 1} ("${brokenStep.id}") after ${result.attempts} attempt(s)`;
      fixes.push(fixMsg);
      console.log(`✅ [Repair Workflow] ${fixMsg}`);
    } else {
      failureCount++;
      console.error(`❌ [Repair Workflow] Failed to repair step ${stepIndex + 1} ("${brokenStep.id}"): ${result.finalError}`);
    }
  }

  console.log(`🎯 [Repair Workflow] Results: ${successCount} repaired, ${failureCount} failed`);

  return { repairedSteps, successCount, failureCount, fixes };
}

/**
 * Get surrounding workflow steps for context
 */
function getWorkflowContext(workflowSteps: any[], brokenStepIndex: number): any[] {
  const context: any[] = [];

  // Include previous 2 steps
  for (let i = Math.max(0, brokenStepIndex - 2); i < brokenStepIndex; i++) {
    context.push({
      position: i + 1,
      step: workflowSteps[i]
    });
  }

  // Include next 2 steps
  for (let i = brokenStepIndex + 1; i < Math.min(workflowSteps.length, brokenStepIndex + 3); i++) {
    context.push({
      position: i + 1,
      step: workflowSteps[i]
    });
  }

  return context;
}
