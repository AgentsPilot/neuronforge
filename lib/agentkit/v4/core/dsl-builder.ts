/**
 * V4 DSL Builder (OpenAI Stage 2)
 *
 * Takes simple text-based step plan from Stage 1 and builds PILOT DSL workflow.
 * This is 100% DETERMINISTIC - no LLM calls.
 *
 * Responsibilities:
 * - Resolve plugin.action names to actual plugin actions
 * - Build parameter structures
 * - Add input schema placeholders
 * - Build conditionals, loops, scatter/gather
 * - Resolve output references
 * - Validate every step
 * - Fix wrong action names, wrong fields, wrong types
 *
 * The LLM NEVER touches this layer.
 */

import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { StepPlan, StepPlanLine } from './step-plan-extractor';
import { IPluginContext } from '@/lib/types/plugin-definition-context';
import { WorkflowStep, ActionStep, AIProcessingStep } from '@/lib/pilot/types';

export interface DSLBuildResult {
  success: boolean;
  workflow?: any;  // PILOT_DSL_SCHEMA
  errors?: string[];
  warnings?: string[];
  ambiguities?: Ambiguity[];  // For Stage 3 repair
}

export interface Ambiguity {
  stepNumber: number;
  issue: string;
  suggestedActions?: string[];
  question: string;
}

export class DSLBuilder {
  private pluginManager: PluginManagerV2;
  private connectedPlugins: IPluginContext[];
  private pluginKeyMap: Map<string, string> = new Map();  // alias → plugin key
  private resolvedInputs: Record<string, string> = {};  // Resolved user inputs from enhanced prompt
  private trackedInputs: Map<string, any> = new Map();  // Track parameters that become {{input.xxx}}

  constructor(
    pluginManager: PluginManagerV2,
    connectedPlugins: IPluginContext[]
  ) {
    this.pluginManager = pluginManager;
    this.connectedPlugins = connectedPlugins;
    this.buildPluginKeyMap();
  }

  /**
   * Build PILOT_DSL_SCHEMA from simple step plan
   * OpenAI Stage 2: Pure deterministic logic
   */
  async buildDSL(stepPlan: StepPlan): Promise<DSLBuildResult> {
    // Validate input
    if (!stepPlan || !stepPlan.steps || stepPlan.steps.length === 0) {
      return {
        success: false,
        errors: ['Step plan is empty or invalid'],
      };
    }

    // Clear tracked inputs from previous builds
    this.trackedInputs.clear();

    // Store resolved inputs for use in parameter building
    this.resolvedInputs = stepPlan.resolvedInputs || {};

    const errors: string[] = [];
    const warnings: string[] = [];
    const ambiguities: Ambiguity[] = [];
    const dslSteps: any[] = [];

    console.log('[DSL Builder] Building DSL from', stepPlan.steps.length, 'steps');
    console.log('[DSL Builder] Resolved inputs:', this.resolvedInputs);

    // Collect all plugins used
    const usedPlugins = new Set<string>();

    for (let i = 0; i < stepPlan.steps.length; i++) {
      const stepLine = stepPlan.steps[i];
      const stepId = `step${i + 1}`;

      try {
        const buildResult = await this.buildStep(stepLine, stepId, dslSteps);

        if (buildResult.ambiguity) {
          ambiguities.push({
            stepNumber: stepLine.stepNumber,
            ...buildResult.ambiguity,
          });
          // Use fallback step for now
          if (buildResult.step) {
            dslSteps.push(buildResult.step);
            if (buildResult.step.plugin) {
              usedPlugins.add(buildResult.step.plugin);
            }
          }
        } else if (buildResult.step) {
          dslSteps.push(buildResult.step);
          if (buildResult.step.plugin) {
            usedPlugins.add(buildResult.step.plugin);
          }
        } else {
          errors.push(`Failed to build step ${stepLine.stepNumber}: ${stepLine.description}`);
        }

        if (buildResult.warnings) {
          warnings.push(...buildResult.warnings);
        }
      } catch (error: any) {
        console.error(`[DSL Builder] Error building step ${stepLine.stepNumber}:`, error);
        errors.push(`Error building step ${stepLine.stepNumber}: ${error.message}`);
      }
    }

    // Detect patterns (scatter-gather, conditionals, etc.)
    let finalSteps;
    try {
      finalSteps = await this.detectAndApplyPatterns(dslSteps);
    } catch (error: any) {
      console.error('[DSL Builder] Error detecting patterns:', error);
      return {
        success: false,
        errors: [`Pattern detection failed: ${error.message}`],
        warnings,
      };
    }

    if (errors.length > 0 && ambiguities.length === 0) {
      return { success: false, errors, warnings };
    }

    // Build complete PILOT_DSL_SCHEMA structure
    const workflow = {
      agent_name: stepPlan.agentName,
      description: stepPlan.description,
      system_prompt: `You are an automation agent. ${stepPlan.description}`,
      workflow_type: this.determineWorkflowType(finalSteps),
      suggested_plugins: Array.from(usedPlugins),
      required_inputs: this.extractRequiredInputs(finalSteps),
      workflow_steps: finalSteps,
      suggested_outputs: this.generateSuggestedOutputs(stepPlan.agentName),
      reasoning: `Generated workflow for ${stepPlan.agentName} using ${finalSteps.length} steps.`,
      confidence: ambiguities.length > 0 ? 0.7 : 0.9,
    };

    return {
      success: true,
      workflow,
      warnings,
      ambiguities: ambiguities.length > 0 ? ambiguities : undefined,
    };
  }

  /**
   * Build a single DSL step from text step
   * @param loopVar - Optional loop variable name if this step is inside a loop
   */
  private async buildStep(
    stepLine: StepPlanLine,
    stepId: string,
    previousSteps: any[],
    loopVar?: string
  ): Promise<{
    step?: any;
    ambiguity?: { issue: string; suggestedActions?: string[]; question: string };
    warnings?: string[];
  }> {
    const warnings: string[] = [];

    // Skip control flow keywords - they're handled by pattern detection
    if (stepLine.controlFlowKeyword === 'if' ||
        stepLine.controlFlowKeyword === 'otherwise' ||
        stepLine.controlFlowKeyword === 'for_each') {
      // Return a placeholder step with metadata
      return {
        step: {
          id: stepId,
          name: stepLine.description,
          type: 'placeholder',
          description: stepLine.description,
          _stepLine: stepLine,
        },
      };
    }

    // Step 1: Check for AI processing first (before trying to resolve plugin)
    if (this.isAIProcessingStep(stepLine)) {
      return {
        step: this.buildAIProcessingStep(stepId, stepLine, previousSteps, loopVar),
      };
    }

    // Step 2: Try to resolve plugin
    const pluginKey = this.resolvePluginKey(stepLine);
    if (!pluginKey) {
      // No plugin found - fall back to AI processing if it looks like an AI task
      const lowerDesc = stepLine.description.toLowerCase();
      const aiIndicators = ['parse', 'extract', 'analyze', 'classify', 'summarize', 'process'];

      if (aiIndicators.some(keyword => lowerDesc.includes(keyword))) {
        warnings.push(
          `No specific plugin action found for "${stepLine.description}", defaulting to AI processing`
        );
        return {
          step: this.buildAIProcessingStep(stepId, stepLine, previousSteps, loopVar),
          warnings,
        };
      }

      // Truly ambiguous - can't determine what to do
      return {
        ambiguity: {
          issue: 'Could not determine which service to use',
          question: `For step "${stepLine.description}", which service should be used? Available: ${this.connectedPlugins.map(p => p.displayName).join(', ')}`,
        },
      };
    }

    // Step 3: Resolve action
    const pluginDef = await this.pluginManager.getPluginDefinition(pluginKey);
    if (!pluginDef) {
      return {
        ambiguity: {
          issue: `Plugin ${pluginKey} not found`,
          question: `Plugin ${pluginKey} is not available. Please check connected services.`,
        },
      };
    }

    const actionResult = this.resolveAction(stepLine, pluginDef.actions);

    if (actionResult.ambiguity) {
      return { ambiguity: actionResult.ambiguity };
    }

    if (!actionResult.actionName) {
      return {
        ambiguity: {
          issue: 'Could not determine action',
          suggestedActions: Object.keys(pluginDef.actions),
          question: `For step "${stepLine.description}", which ${pluginDef.plugin.displayName} action should be used?`,
        },
      };
    }

    // Step 4: Build parameters
    const actionDef = pluginDef.actions[actionResult.actionName];
    const parameters = this.buildParameters(
      stepLine,
      actionDef,
      previousSteps,
      stepId,
      loopVar
    );

    // Step 5: Build DSL step (PILOT_DSL_SCHEMA format)
    return {
      step: {
        id: stepId,
        name: stepLine.description.substring(0, 100),  // Use description as name
        type: 'action',
        description: stepLine.description,
        plugin: pluginKey,
        action: actionResult.actionName,
        params: parameters,
        _stepLine: stepLine,  // Attach metadata for pattern detection
      },
      warnings,
    };
  }

  /**
   * Resolve plugin key from step description
   */
  private resolvePluginKey(stepLine: StepPlanLine): string | null {
    // First, try suggested plugin from LLM
    if (stepLine.suggestedPlugin) {
      const normalized = stepLine.suggestedPlugin.toLowerCase();
      if (this.pluginKeyMap.has(normalized)) {
        return this.pluginKeyMap.get(normalized)!;
      }
    }

    // Search in description for plugin names
    const lowerDesc = stepLine.description.toLowerCase();
    for (const [alias, pluginKey] of this.pluginKeyMap.entries()) {
      if (lowerDesc.includes(alias)) {
        return pluginKey;
      }
    }

    return null;
  }

  /**
   * Check if step requires AI processing
   */
  private isAIProcessingStep(stepLine: StepPlanLine): boolean {
    const lowerDesc = stepLine.description.toLowerCase();

    // FIXED: Check for "using ai_processing" explicitly FIRST
    if (lowerDesc.includes('using ai_processing')) {
      return true;
    }

    // FIXED: Use regex to detect actual "using plugin.action" format (not just any period)
    // This prevents catching periods in sentences like "urgent."
    const pluginActionPattern = /using\s+[a-z0-9_-]+\.[a-z0-9_]+/i;
    if (pluginActionPattern.test(lowerDesc)) {
      return false;
    }

    // If step has a suggested plugin AND action, it's NOT AI processing
    if (stepLine.suggestedPlugin && stepLine.suggestedAction) {
      return false;
    }

    // If suggested plugin is "ai_processing", it IS AI processing
    if (stepLine.suggestedPlugin === 'ai_processing') {
      return true;
    }

    const aiKeywords = [
      'summarize',
      'extract',
      'analyze',
      'generate',
      'classify',
      'categorize',
      'parse',
    ];

    return aiKeywords.some(keyword => lowerDesc.includes(keyword));
  }

  /**
   * Build AI processing step (PILOT_DSL_SCHEMA format)
   * @param loopVar - Optional loop variable name if this step is inside a loop
   */
  private buildAIProcessingStep(
    stepId: string,
    stepLine: StepPlanLine,
    previousSteps: any[],
    loopVar?: string
  ): any {
    // Reference data based on context
    let dataReference: string;

    if (loopVar) {
      // Inside a loop - reference the loop variable
      dataReference = `{{${loopVar}}}`;
    } else {
      // Not in a loop - reference previous step's data (skip placeholder steps)
      const lastRealStep = this.getLastRealStep(previousSteps);
      dataReference = lastRealStep
        ? `{{${lastRealStep.id}.data}}`
        : '{{input.data}}';
    }

    return {
      id: stepId,
      name: stepLine.description.substring(0, 100),
      type: 'ai_processing',
      description: stepLine.description,
      prompt: stepLine.description,
      params: {
        data: dataReference,
      },
      _stepLine: stepLine,  // Attach metadata for pattern detection
    };
  }

  /**
   * Get the last real step (skip placeholders)
   */
  private getLastRealStep(steps: any[]): any | null {
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].type !== 'placeholder') {
        return steps[i];
      }
    }
    return null;
  }

  /**
   * Find a step by searching for keywords in its description or name
   * Used for lookup pattern detection (e.g., finding "sheet" step when condition mentions "in sheet")
   */
  private findStepByContent(steps: any[], searchTerm: string): any | null {
    const lowerSearch = searchTerm.toLowerCase();

    // Search backwards (most recent first)
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];

      // Check step name
      if (step.name && step.name.toLowerCase().includes(lowerSearch)) {
        return step;
      }

      // Check step description
      if (step.description && step.description.toLowerCase().includes(lowerSearch)) {
        return step;
      }

      // Check _stepLine description (for debugging)
      if (step._stepLine?.description &&
          step._stepLine.description.toLowerCase().includes(lowerSearch)) {
        return step;
      }
    }

    return null;
  }

  /**
   * Find the most recent AI classification/processing step
   * Used for classification-based conditionals that should reference the AI result
   *
   * Example: Multiple sibling conditionals checking "upgrade_opportunity", "package_mismatch", etc.
   * should all reference the same AI classification step, not create sequential dependencies.
   */
  private findAIClassificationStep(steps: any[]): any | null {
    // Search backwards for AI processing steps that likely perform classification
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];

      // Check if it's an AI processing step
      if (step.type === 'ai_processing') {
        // Check if it's doing classification/categorization
        const name = (step.name || '').toLowerCase();
        const desc = (step.description || '').toLowerCase();
        const stepLineDesc = (step._stepLine?.description || '').toLowerCase();

        const isClassification =
          name.includes('classif') ||
          name.includes('categor') ||
          name.includes('analyz') ||
          name.includes('determin') ||
          desc.includes('classif') ||
          desc.includes('categor') ||
          desc.includes('analyz') ||
          desc.includes('determin') ||
          stepLineDesc.includes('classif') ||
          stepLineDesc.includes('categor') ||
          stepLineDesc.includes('analyz') ||
          stepLineDesc.includes('determin');

        if (isClassification) {
          return step;
        }
      }
    }

    // If no classification step found, return the most recent AI processing step
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].type === 'ai_processing') {
        return steps[i];
      }
    }

    return null;
  }

  /**
   * Resolve action name from step description
   */
  private resolveAction(
    stepLine: StepPlanLine,
    actions: Record<string, any>
  ): {
    actionName?: string;
    ambiguity?: { issue: string; suggestedActions: string[]; question: string };
  } {
    // Try suggested action from LLM
    if (stepLine.suggestedAction) {
      const normalized = stepLine.suggestedAction.toLowerCase();
      const exactMatch = Object.keys(actions).find(
        a => a.toLowerCase() === normalized
      );
      if (exactMatch) {
        return { actionName: exactMatch };
      }
    }

    // Score all actions based on description
    const scores = new Map<string, number>();
    const lowerDesc = stepLine.description.toLowerCase();

    for (const [actionName, actionDef] of Object.entries(actions)) {
      let score = 0;
      const description = actionDef.description?.toLowerCase() || '';
      const usageContext = actionDef.usage_context?.toLowerCase() || '';

      // Extract keywords from step description
      const keywords = lowerDesc
        .replace(/using\s+[a-z0-9_.-]+/gi, '')
        .split(/\s+/)
        .filter(w => w.length > 3);

      for (const keyword of keywords) {
        if (actionName.toLowerCase().includes(keyword)) score += 5;
        if (description.includes(keyword)) score += 3;
        if (usageContext.includes(keyword)) score += 2;
      }

      scores.set(actionName, score);
    }

    // Get top scored action
    const sorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);

    if (sorted.length === 0) {
      return {
        ambiguity: {
          issue: 'No actions available',
          suggestedActions: [],
          question: 'No actions found for this plugin',
        },
      };
    }

    // If top score is 0, we're not confident
    if (sorted[0][1] === 0) {
      return {
        ambiguity: {
          issue: 'Cannot determine correct action',
          suggestedActions: Object.keys(actions),
          question: `For "${stepLine.description}", which action should be used?`,
        },
      };
    }

    // If there's a tie at the top, it's ambiguous
    if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
      return {
        ambiguity: {
          issue: 'Multiple actions match equally',
          suggestedActions: [sorted[0][0], sorted[1][0]],
          question: `For "${stepLine.description}", did you mean ${sorted[0][0]} or ${sorted[1][0]}?`,
        },
      };
    }

    return { actionName: sorted[0][0] };
  }

  /**
   * Build parameters for action
   * @param loopVar - Optional loop variable name if this step is inside a loop
   */
  private buildParameters(
    stepLine: StepPlanLine,
    actionDef: any,
    previousSteps: any[],
    currentStepId: string,
    loopVar?: string
  ): Record<string, any> {
    const parameters: Record<string, any> = {};
    const paramSchema = actionDef.parameters?.properties || {};
    const required = actionDef.parameters?.required || [];

    // Try to extract params from description
    // 1. Check for explicit params: "action(param=value)"
    const paramMatch = stepLine.description.match(/\(([^)]+)\)/);
    let extractedParams: Record<string, string> = {};

    if (paramMatch) {
      const paramStr = paramMatch[1];
      const pairs = paramStr.split(',').map(p => p.trim());
      for (const pair of pairs) {
        const [key, value] = pair.split('=').map(s => s.trim());
        if (key && value) {
          extractedParams[key] = value.replace(/['"]/g, '');
        }
      }
    }

    // 2. Try to extract common patterns from description
    const lowerDesc = stepLine.description.toLowerCase();

    // Extract email addresses (e.g., "send email to user@example.com")
    const emailMatch = stepLine.description.match(/(?:to|email)\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (emailMatch && !extractedParams['recipients'] && !extractedParams['to'] && !extractedParams['email']) {
      extractedParams['recipients'] = emailMatch[1];
      extractedParams['to'] = emailMatch[1];
      extractedParams['email'] = emailMatch[1];
    }

    // Extract subject line (e.g., "with subject 'Hello'")
    const subjectMatch = stepLine.description.match(/(?:with\s+)?subject\s+['"']([^'"]+)['"']/i);
    if (subjectMatch && !extractedParams['subject']) {
      extractedParams['subject'] = subjectMatch[1];
    }

    // Extract message/content (e.g., "message 'Hello world'")
    const messageMatch = stepLine.description.match(/(?:message|content|body)\s+['"']([^'"]+)['"']/i);
    if (messageMatch && !extractedParams['message'] && !extractedParams['content'] && !extractedParams['body']) {
      extractedParams['message'] = messageMatch[1];
      extractedParams['content'] = messageMatch[1];
      extractedParams['body'] = messageMatch[1];
    }

    // NOTE: Removed hardcoding logic that used resolvedInputs
    // The smart fallback logic below will handle ALL parameters correctly:
    // - Config params (spreadsheet_id, channel_id) → {{input.xxx}}
    // - Data params (data, content, values) → {{stepN.data}} or {{loopVar}}

    // First, add all extracted parameters (even if not required)
    for (const [paramName, paramValue] of Object.entries(extractedParams)) {
      const schema = paramSchema[paramName];
      if (schema) {
        // Only add if it's a valid parameter in the schema
        parameters[paramName] = this.coerceType(paramValue, schema?.type);
      }
    }

    // Then, handle required parameters that weren't extracted
    for (const paramName of required) {
      if (parameters[paramName]) {
        // Already set from extracted params
        continue;
      }

      const schema = paramSchema[paramName];

      // Try to infer from parameter name
      const lowerParamName = paramName.toLowerCase();

      if (lowerParamName.includes('data') || lowerParamName.includes('input')) {
        // If inside a loop, reference the loop variable
        if (loopVar) {
          parameters[paramName] = `{{${loopVar}}}`;
        } else {
          // Reference previous step (skip placeholder steps)
          const lastRealStep = this.getLastRealStep(previousSteps);
          if (lastRealStep) {
            parameters[paramName] = `{{${lastRealStep.id}.data}}`;
          } else {
            parameters[paramName] = '{{input.data}}';
          }
        }
      } else if (lowerParamName.includes('value') && loopVar) {
        // IMPORTANT: Check this BEFORE content/body/text to prevent tracking loop variables as inputs!
        // Special case: "values" parameter when inside loop (e.g., Google Sheets append_rows)
        // Reference the loop variable
        parameters[paramName] = `{{${loopVar}}}`;
        console.log(`[DSL Builder] Param "${paramName}" matched value+loop condition, using {{${loopVar}}}`);
      } else if (lowerParamName.includes('content') || lowerParamName.includes('body') || lowerParamName.includes('message') || lowerParamName.includes('text')) {
        // For content/body/message/text fields
        if (loopVar) {
          // Inside a loop - reference the loop variable (e.g., email body, email subject)
          parameters[paramName] = `{{${loopVar}}}`;
        } else {
          // Not in loop - check if previous step is AI processing
          const lastRealStep = this.getLastRealStep(previousSteps);
          if (lastRealStep && lastRealStep.type === 'ai_processing') {
            // Reference AI processing result
            parameters[paramName] = `{{${lastRealStep.id}.data}}`;
          } else if (lastRealStep) {
            // Reference previous step's data
            parameters[paramName] = `{{${lastRealStep.id}.data}}`;
          } else {
            // Use placeholder
            parameters[paramName] = `{{input.${paramName}}}`;

            // Track this parameter for input schema generation
            const schema = paramSchema[paramName];
            this.trackInputParameter(paramName, schema);
          }
        }
      } else {
        // For other parameters, check if we're inside a loop
        if (loopVar) {
          // INSIDE A LOOP: Don't create input parameters for fields that should come from loop variable
          // The LLM should specify field references in descriptions like "send to {item.email}"
          // For now, default to referencing the loop variable directly or skip tracking
          // This prevents creating unnecessary {{input.xxx}} parameters for data flow

          // Don't track this as an input parameter - it should come from the loop data
          console.log(`[DSL Builder] Param "${paramName}" inside loop - skipping input tracking, expecting field reference`);

          // Use placeholder that will be filled by execution context
          parameters[paramName] = `{{input.${paramName}}}`;

          // Do NOT track this parameter (it should not become a user input field)
        } else {
          // NOT IN A LOOP: This is a true user input parameter
          parameters[paramName] = `{{input.${paramName}}}`;

          // Track this parameter for input schema generation
          const shouldSkipTracking = lowerParamName.includes('value') ||
                                     lowerParamName.includes('item') ||
                                     lowerParamName.includes('element');

          if (!shouldSkipTracking) {
            const schema = paramSchema[paramName];
            this.trackInputParameter(paramName, schema);
          }
        }
      }
    }

    return parameters;
  }

  /**
   * Coerce string value to appropriate type
   */
  private coerceType(value: string, type?: string): any {
    if (!type) return value;

    switch (type) {
      case 'number':
      case 'integer':
        return parseInt(value, 10);
      case 'boolean':
        return value.toLowerCase() === 'true';
      case 'array':
        return value.split(',').map(v => v.trim());
      default:
        return value;
    }
  }

  /**
   * Track a parameter that becomes {{input.xxx}} for input schema generation
   */
  private trackInputParameter(name: string, schema: any): void {
    // Avoid duplicates
    if (this.trackedInputs.has(name)) {
      return;
    }

    // Infer UI type from schema type
    const inferType = (schemaType?: string): string => {
      if (!schemaType) return 'text';

      switch (schemaType) {
        case 'number':
        case 'integer':
          return 'number';
        case 'boolean':
          return 'select';  // Could be checkbox, but select is safer
        case 'array':
          return 'textarea';  // For comma-separated values
        default:
          // Check description for hints
          const desc = schema?.description?.toLowerCase() || '';
          if (desc.includes('email')) return 'email';
          if (desc.includes('url') || desc.includes('link')) return 'url';
          if (desc.includes('date')) return 'date';

          // Check parameter name for hints
          const lowerName = name.toLowerCase();
          if (lowerName.includes('email')) return 'email';
          if (lowerName.includes('url') || lowerName.includes('link')) return 'url';
          if (lowerName.includes('date') || lowerName.includes('time')) return 'date';

          return 'text';
      }
    };

    // Generate user-friendly label from parameter name
    const generateLabel = (fieldName: string): string => {
      return fieldName
        .split('_')
        .map(word => {
          // Keep common abbreviations uppercase
          const upper = word.toUpperCase();
          if (['ID', 'URL', 'API', 'PDF', 'HTML', 'CSV', 'JSON', 'XML', 'SQL'].includes(upper)) {
            return upper;
          }
          // Capitalize first letter
          return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(' ');
    };

    this.trackedInputs.set(name, {
      name,
      type: inferType(schema?.type),
      label: generateLabel(name),
      description: schema?.description || `${generateLabel(name)} for this workflow`,
      required: true,
      placeholder: schema?.description || '',
    });

    console.log(`[DSL Builder] Tracked input parameter: ${name} (type: ${inferType(schema?.type)})`);
  }

  /**
   * Build plugin key map for quick lookup
   */
  private buildPluginKeyMap(): void {
    for (const plugin of this.connectedPlugins) {
      // Add exact key
      this.pluginKeyMap.set(plugin.key.toLowerCase(), plugin.key);

      // Add display name
      this.pluginKeyMap.set(plugin.displayName.toLowerCase(), plugin.key);

      // Add words from display name
      const words = plugin.displayName.toLowerCase().split(/[\s-]/);
      for (const word of words) {
        if (word.length > 2 && !this.pluginKeyMap.has(word)) {
          this.pluginKeyMap.set(word, plugin.key);
        }
      }

      // Add key parts
      const keyParts = plugin.key.split('-');
      for (const part of keyParts) {
        if (part.length > 2 && !this.pluginKeyMap.has(part)) {
          this.pluginKeyMap.set(part, plugin.key);
        }
      }
    }
  }

  /**
   * Detect patterns and apply transformations
   * (scatter-gather, conditionals, loops, etc.)
   */
  private async detectAndApplyPatterns(steps: any[]): Promise<any[]> {
    console.log('[DSL Builder] Detecting patterns in', steps.length, 'steps');

    // Build a hierarchical structure based on indentation and control flow keywords
    const structuredSteps = await this.buildHierarchicalStructure(steps);

    console.log('[DSL Builder] Structured steps:', JSON.stringify(structuredSteps, null, 2));

    // Fix data references in conditional branches and loops
    this.fixDataReferences(structuredSteps);

    // Reassign step IDs to be sequential (eliminates gaps from consumed control flow markers)
    this.reassignStepIds(structuredSteps);

    // Clean up metadata
    this.cleanupMetadata(structuredSteps);

    return structuredSteps;
  }

  /**
   * Fix data references in conditional branches and loops
   * After hierarchical grouping, some steps may reference data from sibling branches
   * This method fixes those references to point to the correct preceding steps
   * @param loopVars - Set of loop variable names to preserve
   */
  private fixDataReferences(steps: any[], parentSteps: any[] = [], loopVars: Set<string> = new Set()): void {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Build the context: all steps that definitely execute before this one
      const guaranteedPreviousSteps = [...parentSteps, ...steps.slice(0, i)];

      if (step.type === 'conditional') {
        // Fix references in then_steps
        if (step.then_steps && step.then_steps.length > 0) {
          // then_steps can reference: parent steps + steps before conditional
          this.fixStepDataReferences(step.then_steps, guaranteedPreviousSteps, loopVars);
          this.fixDataReferences(step.then_steps, guaranteedPreviousSteps, loopVars);
        }

        // Fix references in else_steps
        if (step.else_steps && step.else_steps.length > 0) {
          // else_steps can reference: parent steps + steps before conditional (NOT then_steps)
          this.fixStepDataReferences(step.else_steps, guaranteedPreviousSteps, loopVars);
          this.fixDataReferences(step.else_steps, guaranteedPreviousSteps, loopVars);
        }
      } else if (step.type === 'scatter_gather') {
        // Fix references in loop body
        if (step.steps && step.steps.length > 0) {
          // Loop body steps can reference: parent steps + steps before loop + previous siblings in same loop
          // We recursively process the loop body, building up the guaranteed steps as we go
          // Extract the loop variable name from scatter config
          const loopVar = step.scatter?.item_name;
          this.fixLoopBodyReferences(step.steps, guaranteedPreviousSteps, loopVar);
        }
      } else {
        // Fix references in regular steps (action, ai_processing, etc.)
        if (step.params) {
          this.fixParamReferences(step.params, guaranteedPreviousSteps, step.id, loopVars);
        }
      }
    }
  }

  /**
   * Fix data references in loop body steps
   * Each step in the loop can reference steps before the loop AND previous siblings in the same loop
   * @param loopVar - The loop variable name (e.g., "contact", "item") to preserve
   */
  private fixLoopBodyReferences(loopSteps: any[], parentSteps: any[], loopVar?: string): void {
    // Build set of loop variables to preserve
    const loopVars = new Set<string>();
    if (loopVar) {
      loopVars.add(loopVar);
    }

    for (let i = 0; i < loopSteps.length; i++) {
      const step = loopSteps[i];

      // Build context: parent steps + previous siblings in same loop
      const guaranteedPreviousSteps = [...parentSteps, ...loopSteps.slice(0, i)];

      // Fix this step's params (but preserve loop variables)
      if (step.params) {
        this.fixParamReferences(step.params, guaranteedPreviousSteps, step.id, loopVars);
      }

      // Recursively handle nested structures
      if (step.type === 'conditional') {
        if (step.then_steps && step.then_steps.length > 0) {
          this.fixStepDataReferences(step.then_steps, guaranteedPreviousSteps, loopVars);
          this.fixDataReferences(step.then_steps, guaranteedPreviousSteps, loopVars);
        }
        if (step.else_steps && step.else_steps.length > 0) {
          this.fixStepDataReferences(step.else_steps, guaranteedPreviousSteps, loopVars);
          this.fixDataReferences(step.else_steps, guaranteedPreviousSteps, loopVars);
        }
      } else if (step.type === 'scatter_gather') {
        if (step.steps && step.steps.length > 0) {
          // Extract nested loop variable
          const nestedLoopVar = step.scatter?.item_name;
          this.fixLoopBodyReferences(step.steps, guaranteedPreviousSteps, nestedLoopVar);
        }
      }
    }
  }

  /**
   * Fix data references for a specific set of steps
   * Replaces references to steps outside the guaranteed execution path
   * @param loopVars - Set of loop variable names to preserve
   */
  private fixStepDataReferences(steps: any[], guaranteedPreviousSteps: any[], loopVars: Set<string> = new Set()): void {
    for (const step of steps) {
      if (step.params) {
        this.fixParamReferences(step.params, guaranteedPreviousSteps, step.id, loopVars);
      }
    }
  }

  /**
   * Fix parameter references to ensure they only reference guaranteed previous steps
   * @param loopVars - Set of loop variable names that should NOT be "fixed"
   */
  private fixParamReferences(params: any, guaranteedPreviousSteps: any[], currentStepId: string, loopVars: Set<string> = new Set()): void {
    // Collect all valid step IDs (guaranteed previous steps ONLY at top level, not nested inside conditionals)
    const validStepIds = new Set<string>();
    for (const step of guaranteedPreviousSteps) {
      validStepIds.add(step.id);
      // DO NOT add nested step IDs from then_steps/else_steps/loop steps
      // Those are not guaranteed to execute
    }

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
        // Extract step reference (e.g., "{{step6.data}}" -> "step6", "{{contact.id}}" -> "contact")
        const refMatch = value.match(/^\{\{([^.}]+)/);
        if (refMatch) {
          const refStepId = refMatch[1];

          // Check if this is a loop variable (should NOT be "fixed")
          if (loopVars.has(refStepId)) {
            // This is a loop variable, leave it as-is
            continue;
          }

          // Check if this reference is valid (exists in guaranteed previous steps at top level)
          const isValidRef = validStepIds.has(refStepId) || refStepId === 'input';

          if (!isValidRef) {
            // Invalid reference - replace with last guaranteed step
            const lastGuaranteedStep = this.getLastRealStep(guaranteedPreviousSteps);
            if (lastGuaranteedStep) {
              const newRef = value.replace(refStepId, lastGuaranteedStep.id);
              console.log(`[DSL Builder] Fixed invalid reference in ${currentStepId}.params.${key}: ${value} → ${newRef}`);
              params[key] = newRef;
            }
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        // Recursively fix nested objects/arrays
        this.fixParamReferences(value, guaranteedPreviousSteps, currentStepId, loopVars);
      }
    }
  }

  /**
   * Reassign step IDs to be sequential, eliminating gaps from consumed control flow markers
   * This ensures step1, step2, step3, step4 instead of step1, step2, step3, step4, step6
   */
  private reassignStepIds(steps: any[]): void {
    let counter = 1;

    const reassignRecursive = (stepList: any[]): void => {
      for (const step of stepList) {
        // Skip placeholder steps (they should have been filtered out by now)
        if (step.type === 'placeholder') {
          continue;
        }

        // Reassign this step's ID
        const oldId = step.id;
        const newId = `step${counter}`;
        step.id = newId;
        counter++;

        console.log(`[DSL Builder] Reassigning step ID: ${oldId} -> ${newId}`);

        // Recursively reassign nested steps
        if (step.steps) {
          reassignRecursive(step.steps);
        }
        if (step.scatter?.steps) {
          reassignRecursive(step.scatter.steps);
        }
        if (step.then_steps) {
          reassignRecursive(step.then_steps);
        }
        if (step.else_steps) {
          reassignRecursive(step.else_steps);
        }
      }
    };

    reassignRecursive(steps);
    console.log(`[DSL Builder] Reassigned ${counter - 1} step IDs`);
  }

  /**
   * Remove _stepLine metadata recursively from all steps
   */
  private cleanupMetadata(steps: any[]): void {
    for (const step of steps) {
      if (step._stepLine) {
        delete step._stepLine;
      }
      if (step.steps) {
        this.cleanupMetadata(step.steps);
      }
      if (step.then_steps) {
        this.cleanupMetadata(step.then_steps);
      }
      if (step.else_steps) {
        this.cleanupMetadata(step.else_steps);
      }
    }
  }

  /**
   * Build hierarchical structure from flat steps using indentation and control flow
   */
  private async buildHierarchicalStructure(steps: any[]): Promise<any[]> {
    const result: any[] = [];
    const stack: { indent: number; steps: any[] }[] = [{ indent: -1, steps: result }];

    let i = 0;
    while (i < steps.length) {
      const step = steps[i];
      const stepLine = step._stepLine as StepPlanLine | undefined;

      if (!stepLine) {
        // No metadata, add as-is
        result.push(step);
        i++;
        continue;
      }

      const indent = stepLine.indentLevel || 0;

      // Pop stack until we find the right parent level
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      const currentLevel = stack[stack.length - 1].steps;

      // Check for control flow keywords
      if (stepLine.controlFlowKeyword === 'for_each') {
        // Build scatter-gather pattern
        const scatterStep = await this.buildScatterGatherStep(step, steps, i);
        currentLevel.push(scatterStep.step);
        i = scatterStep.nextIndex;
      } else if (stepLine.controlFlowKeyword === 'if') {
        // Build conditional pattern
        const conditionalStep = await this.buildConditionalStep(step, steps, i);
        currentLevel.push(conditionalStep.step);
        i = conditionalStep.nextIndex;
      } else {
        // Regular step
        currentLevel.push(step);
        i++;
      }
    }

    return result;
  }

  /**
   * Build scatter-gather step (for loops)
   */
  private async buildScatterGatherStep(
    loopHeaderStep: any,
    allSteps: any[],
    startIndex: number
  ): Promise<{ step: any; nextIndex: number }> {
    const headerStepLine = loopHeaderStep._stepLine as StepPlanLine;
    const loopIndent = headerStepLine.indentLevel || 0;
    const loopBody: any[] = [];

    // Extract loop variable from description (e.g., "For each email" -> "email")
    const loopVarMatch = headerStepLine.description.match(/for each\s+(\w+)/i);
    const loopVar = loopVarMatch ? loopVarMatch[1] : 'item';

    // Collect all steps that are children of this loop (higher indent level)
    let i = startIndex + 1;
    while (i < allSteps.length) {
      const childStep = allSteps[i];
      const childStepLine = childStep._stepLine as StepPlanLine | undefined;

      if (!childStepLine) {
        break;
      }

      const childIndent = childStepLine.indentLevel || 0;

      // If child has same or lower indent, it's not part of this loop
      if (childIndent <= loopIndent) {
        break;
      }

      // Check if child is a conditional inside the loop
      if (childStepLine.controlFlowKeyword === 'if') {
        const conditionalResult = await this.buildConditionalStep(childStep, allSteps, i, loopVar);
        loopBody.push(conditionalResult.step);
        i = conditionalResult.nextIndex;
      }
      // Check if child is a nested loop inside the current loop
      else if (childStepLine.controlFlowKeyword === 'for_each') {
        const nestedLoopResult = await this.buildScatterGatherStep(childStep, allSteps, i);
        loopBody.push(nestedLoopResult.step);
        i = nestedLoopResult.nextIndex;
      }
      else if (childStepLine.controlFlowKeyword !== 'otherwise') {
        // Regular step inside loop (skip "otherwise" as it's handled by conditional builder)
        // IMPORTANT: Re-build this step with the loop variable context
        const rebuiltStepResult = await this.buildStep(childStepLine, childStep.id, loopBody, loopVar);
        if (rebuiltStepResult.step) {
          loopBody.push(rebuiltStepResult.step);
        } else {
          // Fallback to original step if rebuild failed
          loopBody.push(childStep);
        }
        i++;
      } else {
        i++;
      }
    }

    // Get the data source (previous step's output)
    // IMPORTANT: Use getLastRealStep() to skip nested steps and find the last top-level step
    const previousSteps = allSteps.slice(0, startIndex);
    const prevRealStep = this.getLastRealStep(previousSteps);

    // Reference the previous step's data directly
    // The WorkflowPilot execution engine will handle array iteration
    let dataSource: string;

    if (prevRealStep) {
      // Reference data from previous step
      // No pluralization - let the execution engine find the array in the data structure
      dataSource = `{{${prevRealStep.id}.data}}`;
      console.log(`[DSL Builder] Loop over "${loopVar}" items from: ${dataSource} (step ${prevRealStep.id})`);
    } else {
      // No previous step found - use input
      dataSource = '{{input.data}}';
      console.log(`[DSL Builder] No previous step found for loop. Using: ${dataSource}`);
    }

    // Build scatter-gather DSL structure
    const scatterStep = {
      id: loopHeaderStep.id,
      name: `Process each ${loopVar}`,
      type: 'scatter_gather',
      description: `Iterate over each ${loopVar} and execute nested steps`,
      scatter: {
        items: dataSource,
        item_name: loopVar,
      },
      steps: loopBody,
    };

    return { step: scatterStep, nextIndex: i };
  }

  /**
   * Build conditional step (if/otherwise) with support for nested conditionals
   * @param loopVar - Optional loop variable name if this conditional is inside a loop
   */
  private async buildConditionalStep(
    ifHeaderStep: any,
    allSteps: any[],
    startIndex: number,
    loopVar?: string
  ): Promise<{ step: any; nextIndex: number }> {
    const headerStepLine = ifHeaderStep._stepLine as StepPlanLine;
    const ifIndent = headerStepLine.indentLevel || 0;
    const thenSteps: any[] = [];
    const elseSteps: any[] = [];

    // Extract condition from description (e.g., "If urgent" -> "urgent")
    const conditionMatch = headerStepLine.description.match(/if\s+(.+)/i);
    const condition = conditionMatch ? conditionMatch[1].trim() : 'condition';

    // Collect "then" steps (children of "if") with recursive conditional/loop support
    let i = startIndex + 1;
    while (i < allSteps.length) {
      const childStep = allSteps[i];
      const childStepLine = childStep._stepLine as StepPlanLine | undefined;

      if (!childStepLine) {
        break;
      }

      const childIndent = childStepLine.indentLevel || 0;

      // If we hit "Otherwise" at same indent, switch to else branch
      if (childStepLine.controlFlowKeyword === 'otherwise' && childIndent === ifIndent) {
        i++; // Skip the "Otherwise" header
        break;
      }

      // If child has same or lower indent (and not "otherwise"), end of conditional
      if (childIndent <= ifIndent) {
        break;
      }

      // RECURSIVE: Check if child is a nested conditional
      if (childStepLine.controlFlowKeyword === 'if') {
        const nestedConditional = await this.buildConditionalStep(childStep, allSteps, i, loopVar);
        thenSteps.push(nestedConditional.step);
        i = nestedConditional.nextIndex;
      }
      // RECURSIVE: Check if child is a nested loop
      else if (childStepLine.controlFlowKeyword === 'for_each') {
        const nestedLoop = await this.buildScatterGatherStep(childStep, allSteps, i);
        thenSteps.push(nestedLoop.step);
        i = nestedLoop.nextIndex;
      }
      // Regular step
      else {
        // IMPORTANT: If inside a loop, re-build this step with the loop variable context
        if (loopVar) {
          const rebuiltStepResult = await this.buildStep(childStepLine, childStep.id, thenSteps, loopVar);
          if (rebuiltStepResult.step) {
            thenSteps.push(rebuiltStepResult.step);
          } else {
            // Fallback to original step if rebuild failed
            thenSteps.push(childStep);
          }
        } else {
          thenSteps.push(childStep);
        }
        i++;
      }
    }

    // After collecting then_steps, check if next sibling step is opposite conditional
    // If so, treat it as the else branch instead of a separate conditional
    if (i < allSteps.length) {
      const nextStep = allSteps[i];
      const nextStepLine = nextStep._stepLine as StepPlanLine | undefined;

      if (nextStepLine &&
          nextStepLine.controlFlowKeyword === 'if' &&
          nextStepLine.indentLevel === ifIndent) {

        // Extract condition from next step
        const nextConditionMatch = nextStepLine.description.match(/if\s+(.+)/i);
        const nextCondition = nextConditionMatch ? nextConditionMatch[1].trim() : '';

        // Check if it's the opposite of our current condition
        if (this.areOppositeConditions(condition, nextCondition)) {
          console.log(`[DSL Builder] Detected opposite conditional at same level - converting to else branch`);
          console.log(`  Original: "If ${condition}"`);
          console.log(`  Opposite: "If ${nextCondition}"`);

          // Skip the opposite "If" header (it becomes the else branch)
          i++;
          // The children of this opposite conditional will be collected as else_steps below
        }
      }
    }

    // Collect "else" steps (children of "otherwise") with recursive support
    while (i < allSteps.length) {
      const childStep = allSteps[i];
      const childStepLine = childStep._stepLine as StepPlanLine | undefined;

      if (!childStepLine) {
        break;
      }

      const childIndent = childStepLine.indentLevel || 0;

      // If child has same or lower indent, end of else branch
      if (childIndent <= ifIndent) {
        break;
      }

      // RECURSIVE: Check if child is a nested conditional
      if (childStepLine.controlFlowKeyword === 'if') {
        const nestedConditional = await this.buildConditionalStep(childStep, allSteps, i, loopVar);
        elseSteps.push(nestedConditional.step);
        i = nestedConditional.nextIndex;
      }
      // RECURSIVE: Check if child is a nested loop
      else if (childStepLine.controlFlowKeyword === 'for_each') {
        const nestedLoop = await this.buildScatterGatherStep(childStep, allSteps, i);
        elseSteps.push(nestedLoop.step);
        i = nestedLoop.nextIndex;
      }
      // Regular step
      else {
        // IMPORTANT: If inside a loop, re-build this step with the loop variable context
        if (loopVar) {
          const rebuiltStepResult = await this.buildStep(childStepLine, childStep.id, elseSteps, loopVar);
          if (rebuiltStepResult.step) {
            elseSteps.push(rebuiltStepResult.step);
          } else {
            // Fallback to original step if rebuild failed
            elseSteps.push(childStep);
          }
        } else {
          elseSteps.push(childStep);
        }
        i++;
      }
    }

    // Detect smart operator based on condition text
    const { operator, value, field, lookup } = this.inferConditionOperator(condition);

    // Get the data to check
    let dataToCheck: string;

    if (lookup) {
      // LOOKUP PATTERN: Check if a field exists in a previous data source
      // Example: "customer email not found in sheet data"
      // This should check if the customer's email exists in the sheet data

      // Find the step that contains the lookup source data
      const sourceStep = this.findStepByContent(allSteps.slice(0, startIndex), lookup.source);

      if (sourceStep) {
        // We need to check if a specific field value exists in the source data
        // The field to look up comes from an even earlier step (e.g., input or previous extraction)
        const fieldValueStep = this.getLastRealStep(allSteps.slice(0, startIndex - 1));

        // Build a reference that checks if the field value exists in the source data
        // For now, we'll use a simplified approach: check if source data contains the field value
        // In a real implementation, this would need a special "lookup" step type
        dataToCheck = `{{${sourceStep.id}.data}}`;

        console.log(`[DSL Builder] Lookup pattern detected: checking if ${lookup.field} from previous step exists in ${sourceStep.id}.data`);
      } else {
        // Fallback: use previous step's data
        const prevRealStep = this.getLastRealStep(allSteps.slice(0, startIndex));
        dataToCheck = prevRealStep ? `{{${prevRealStep.id}.data}}` : '{{input.data}}';
      }
    } else if (loopVar && field) {
      // Inside a loop AND field was extracted (e.g., "subject contains 'urgent'")
      // Reference the specific field of the loop item
      dataToCheck = `{{${loopVar}.${field}}}`;
    } else {
      // Check if this is a classification-based condition
      // Pattern: "upgrade_opportunity", "package_mismatch", "billing_risk"
      // These should reference the AI classification step, not just the previous step
      const isClassificationCheck = operator === 'equals' && value.match(/^[a-z_]+$/);

      if (isClassificationCheck) {
        // Find the most recent AI processing step that likely did the classification
        const aiClassificationStep = this.findAIClassificationStep(allSteps.slice(0, startIndex));

        if (aiClassificationStep) {
          dataToCheck = `{{${aiClassificationStep.id}.data}}`;
          console.log(`[DSL Builder] Classification check detected: "${value}" references AI step ${aiClassificationStep.id}`);
        } else {
          // Fallback to previous step
          const prevRealStep = this.getLastRealStep(allSteps.slice(0, startIndex));
          dataToCheck = prevRealStep ? `{{${prevRealStep.id}.data}}` : '{{input.data}}';
        }
      } else {
        // Either not inside a loop, OR no field extracted (e.g., "details extracted successfully")
        // In both cases, reference the previous step's output
        const prevRealStep = this.getLastRealStep(allSteps.slice(0, startIndex));
        dataToCheck = prevRealStep ? `{{${prevRealStep.id}.data}}` : '{{input.data}}';
      }
    }

    // Build conditional DSL structure
    // IMPORTANT: Preserve then_steps/else_steps order for readability
    const conditionalStep: any = {
      id: ifHeaderStep.id,
      name: `Check ${condition}`,
      type: 'conditional',
      description: `Route based on ${condition}`,
      condition: {
        conditionType: 'simple',  // Required for ConditionalEvaluator validation
        field: dataToCheck,
        operator,
        value,
      },
    };

    // Add then_steps first, then else_steps (for JSON ordering)
    conditionalStep.then_steps = thenSteps;
    if (elseSteps.length > 0) {
      conditionalStep.else_steps = elseSteps;
    }

    return { step: conditionalStep, nextIndex: i };
  }

  /**
   * Check if two condition descriptions are logical opposites
   * Examples:
   * - "contact exists in HubSpot" vs "contact not found in HubSpot" → true
   * - "urgency is critical" vs "urgency is not critical" → true
   * - "data differs" vs "data matches" → true
   */
  private areOppositeConditions(condition1: string, condition2: string): boolean {
    const c1 = condition1.toLowerCase().trim();
    const c2 = condition2.toLowerCase().trim();

    // Pattern 1: "X exists/found in Y" vs "X not found/not exists in Y"
    const existsMatch1 = c1.match(/^(.+?)\s+(?:exists|found)\s+in\s+(.+)$/);
    const notFoundMatch2 = c2.match(/^(.+?)\s+not\s+(?:found|exists?)\s+in\s+(.+)$/);
    if (existsMatch1 && notFoundMatch2) {
      return existsMatch1[1] === notFoundMatch2[1] && existsMatch1[2] === notFoundMatch2[2];
    }

    // Pattern 2: "X not found/not exists in Y" vs "X exists/found in Y" (reverse)
    const notFoundMatch1 = c1.match(/^(.+?)\s+not\s+(?:found|exists?)\s+in\s+(.+)$/);
    const existsMatch2 = c2.match(/^(.+?)\s+(?:exists|found)\s+in\s+(.+)$/);
    if (notFoundMatch1 && existsMatch2) {
      return notFoundMatch1[1] === existsMatch2[1] && notFoundMatch1[2] === existsMatch2[2];
    }

    // Pattern 3: "X is Y" vs "X is not Y"
    const isMatch1 = c1.match(/^(.+?)\s+is\s+(.+)$/);
    const isNotMatch2 = c2.match(/^(.+?)\s+is\s+not\s+(.+)$/);
    if (isMatch1 && isNotMatch2) {
      return isMatch1[1] === isNotMatch2[1] && isMatch1[2] === isNotMatch2[2];
    }

    // Pattern 4: "X is not Y" vs "X is Y" (reverse)
    const isNotMatch1 = c1.match(/^(.+?)\s+is\s+not\s+(.+)$/);
    const isMatch2 = c2.match(/^(.+?)\s+is\s+(.+)$/);
    if (isNotMatch1 && isMatch2) {
      return isNotMatch1[1] === isMatch2[1] && isNotMatch1[2] === isMatch2[2];
    }

    // Pattern 5: "X differs/changed/different" vs "X matches/same/equal"
    const differsMatch1 = c1.match(/^(.+?)\s+(?:differs?|changed?|different)$/);
    const matchesMatch2 = c2.match(/^(.+?)\s+(?:matches?|same|equal)$/);
    if (differsMatch1 && matchesMatch2) {
      return differsMatch1[1] === matchesMatch2[1];
    }

    // Pattern 6: "X matches/same/equal" vs "X differs/changed/different" (reverse)
    const matchesMatch1 = c1.match(/^(.+?)\s+(?:matches?|same|equal)$/);
    const differsMatch2 = c2.match(/^(.+?)\s+(?:differs?|changed?|different)$/);
    if (matchesMatch1 && differsMatch2) {
      return matchesMatch1[1] === differsMatch2[1];
    }

    return false;
  }

  /**
   * Infer condition operator from condition text
   * Returns appropriate operator, cleaned value, and field name (if extractable)
   */
  private inferConditionOperator(condition: string): { operator: string; value: string; field?: string; lookup?: { source: string; field: string; } } {
    const lower = condition.toLowerCase().trim();

    // Pattern: "customer email not found in sheet data", "[field] not found in [source]"
    // Simple lookup pattern detection (no AI needed)
    const lookupNotFoundMatch = lower.match(/^(?:customer\s+)?(\w+)\s+not\s+found\s+in\s+(.+?)(?:\s+data)?$/);
    if (lookupNotFoundMatch) {
      const fieldToCheck = lookupNotFoundMatch[1]; // e.g., "email"
      const sourceData = lookupNotFoundMatch[2].trim(); // e.g., "sheet"
      return {
        operator: 'is_null',
        value: '',
        field: fieldToCheck,
        lookup: {
          source: sourceData,
          field: fieldToCheck,
        }
      };
    }

    // Pattern: "customer email found in sheet data", "[field] found in [source]"
    const lookupFoundMatch = lower.match(/^(?:customer\s+)?(\w+)\s+found\s+in\s+(.+?)(?:\s+data)?$/);
    if (lookupFoundMatch) {
      const fieldToCheck = lookupFoundMatch[1];
      const sourceData = lookupFoundMatch[2].trim();
      return {
        operator: 'is_not_null',
        value: '',
        field: fieldToCheck,
        lookup: {
          source: sourceData,
          field: fieldToCheck,
        }
      };
    }

    // Pattern: "[field] exists in [source]", "[field] in [source]"
    const lookupExistsMatch = lower.match(/^(?:customer\s+)?(\w+)\s+(?:exists\s+)?in\s+(.+?)(?:\s+data)?$/);
    if (lookupExistsMatch) {
      const fieldToCheck = lookupExistsMatch[1];
      const sourceData = lookupExistsMatch[2].trim();
      return {
        operator: 'is_not_null',
        value: '',
        field: fieldToCheck,
        lookup: {
          source: sourceData,
          field: fieldToCheck,
        }
      };
    }

    // Pattern: "field contains 'value'" or "field contains value"
    // Also handles "email field contains 'value'" or "item field contains value"
    const containsMatch = lower.match(/^(?:\w+\s+)?(\w+)\s+contains?\s+['"']?(.+?)['"']?$/);
    if (containsMatch) {
      return {
        operator: 'contains',
        value: containsMatch[2].replace(/['"]/g, ''),
        field: containsMatch[1]
      };
    }

    // Pattern: "field equals value" or "field is value"
    const equalsMatch = lower.match(/^(\w+)\s+(?:equals?|is)\s+['"']?(.+?)['"']?$/);
    if (equalsMatch) {
      return {
        operator: 'equals',
        value: equalsMatch[2].replace(/['"]/g, ''),
        field: equalsMatch[1]
      };
    }

    // Pattern: "details extracted successfully", "validation passed", "processing succeeded"
    if (lower.includes('extracted successfully') || lower.includes('validation passed') ||
        lower.includes('processing succeeded') || lower.includes('succeeded') ||
        lower.includes('successful')) {
      return { operator: 'is_not_null', value: '' };
    }

    // Pattern: "extraction failed", "validation failed", "processing failed"
    if (lower.includes('failed') || lower.includes('unsuccessful')) {
      return { operator: 'is_null', value: '' };
    }

    // Pattern: "customer not found", "data not exists", "record missing"
    if (lower.includes('not found') || lower.includes('not exist') || lower.includes('missing') || lower.includes('does not exist')) {
      return { operator: 'is_null', value: '' };
    }

    // Pattern: "customer exists", "data found", "record present"
    if (lower.includes('exists') || lower.includes('found') || lower.includes('present')) {
      return { operator: 'is_not_null', value: '' };
    }

    // Pattern: "has [items]" - e.g., "contact has open deals", "user has permissions"
    // This checks if data is not null/empty (has items)
    if (lower.match(/^(?:\w+\s+)?has\s+/)) {
      return { operator: 'is_not_null', value: '', field: undefined };
    }

    // Pattern: "packages differ", "data differs", "values don't match"
    if (lower.includes('differ') || lower.includes('mismatch') || lower.includes("don't match") || lower.includes('not equal')) {
      return { operator: 'not_equal', value: lower };
    }

    // Pattern: "classified as high_value", "categorized as urgent", "labeled as premium"
    // Extract the classification value for AI classification checks
    const classifiedAsMatch = lower.match(/^(?:classified|categorized|labeled|tagged)\s+as\s+([a-z_]+)$/);
    if (classifiedAsMatch) {
      return {
        operator: 'equals',
        value: classifiedAsMatch[1],  // Just the classification value (e.g., "high_value")
      };
    }

    // Pattern: "urgent", "critical", "high priority" (contains keywords)
    if (lower.match(/^(urgent|critical|high|important|priority|emergency)$/)) {
      return { operator: 'contains', value: condition };
    }

    // Pattern: "upgrade_opportunity", "package_mismatch", "billing_risk" (exact match)
    if (lower.match(/^[a-z_]+$/)) {
      return { operator: 'equals', value: condition };
    }

    // Pattern: "status is active", "type equals premium"
    if (lower.includes(' is ') || lower.includes(' equals ')) {
      const parts = lower.split(/\s+(?:is|equals)\s+/);
      return {
        operator: 'equals',
        value: parts[1] || condition,
        field: parts[0]
      };
    }

    // Pattern: "count > 10", "amount >= 100"
    if (lower.match(/[><]=?/)) {
      return { operator: 'compare', value: condition };
    }

    // Default: contains (for natural language conditions)
    return { operator: 'contains', value: condition };
  }

  /**
   * Generate agent name from goal
   */
  private generateAgentName(goal: string): string {
    // Convert goal to PascalCase agent name
    const words = goal.split(/\s+/);
    const name = words
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
    return name || 'Workflow Agent';
  }

  /**
   * Determine workflow type based on steps
   */
  private determineWorkflowType(
    steps: any[]
  ): 'pure_ai' | 'data_retrieval_ai' | 'ai_external_actions' {
    const hasPluginActions = steps.some(s => s.type === 'action');
    const hasAIProcessing = steps.some(s => s.type === 'ai_processing');

    if (hasPluginActions && hasAIProcessing) {
      return 'ai_external_actions';
    } else if (hasAIProcessing) {
      return 'data_retrieval_ai';
    } else {
      return 'pure_ai';
    }
  }

  /**
   * Extract required inputs from workflow steps
   */
  private extractRequiredInputs(steps: any[]): any[] {
    // Use tracked inputs from buildParameters() calls
    // These were tracked when we created {{input.xxx}} parameters
    const inputs: any[] = [];

    for (const [name, inputDef] of this.trackedInputs.entries()) {
      inputs.push({
        name: inputDef.name,
        type: inputDef.type,
        label: inputDef.label,
        required: inputDef.required,
        description: inputDef.description,
        placeholder: inputDef.placeholder,
        reasoning: `Configuration parameter from plugin action`,
      });
    }

    console.log(`[DSL Builder] Extracted ${inputs.length} required inputs from tracked parameters`);

    return inputs;
  }

  /**
   * Scan object for {{input.xxx}} references
   */
  private scanForInputReferences(obj: any, inputVars: Set<string>): void {
    if (typeof obj === 'string') {
      const matches = obj.matchAll(/\{\{input\.([a-zA-Z0-9_]+)\}\}/g);
      for (const match of matches) {
        inputVars.add(match[1]);
      }
    } else if (Array.isArray(obj)) {
      obj.forEach(item => this.scanForInputReferences(item, inputVars));
    } else if (typeof obj === 'object' && obj !== null) {
      Object.values(obj).forEach(val => this.scanForInputReferences(val, inputVars));
    }
  }

  /**
   * Infer input type from variable name
   */
  private inferInputType(varName: string): string {
    const lower = varName.toLowerCase();
    if (lower.includes('email')) return 'email';
    if (lower.includes('url') || lower.includes('link')) return 'url';
    if (lower.includes('date') || lower.includes('time')) return 'date';
    if (lower.includes('number') || lower.includes('count') || lower.includes('amount'))
      return 'number';
    if (lower.includes('message') || lower.includes('description')) return 'textarea';
    return 'text';
  }

  /**
   * Generate human-readable label for input
   */
  private generateInputLabel(varName: string): string {
    // Convert snake_case or camelCase to Title Case
    return varName
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  }

  /**
   * Generate suggested outputs based on goal
   */
  private generateSuggestedOutputs(goal: string): any[] {
    return [
      {
        name: 'workflow_result',
        type: 'SummaryBlock',
        category: 'human-facing',
        description: `Result of ${goal.toLowerCase()}`,
        format: 'markdown',
        reasoning: 'Primary output showing workflow results',
      },
    ];
  }

  /**
   * Tokenize parameter name into words for fuzzy matching
   * Examples:
   *   "spreadsheet_id" -> ["spreadsheet", "id"]
   *   "google_sheet_id" -> ["google", "sheet", "id"]
   *   "channel_id" -> ["channel", "id"]
   *   "slack_channel" -> ["slack", "channel"]
   */
  private tokenizeParameterName(name: string): string[] {
    return name
      .toLowerCase()
      .split(/[_\-\s]+/)
      .filter(token => token.length > 0);
  }
}
