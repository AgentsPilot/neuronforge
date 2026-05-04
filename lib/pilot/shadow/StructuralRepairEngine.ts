/**
 * StructuralRepairEngine - Auto-fix structural DSL issues during calibration
 *
 * This engine fixes compiler bugs and structural issues in compiled DSL that prevent execution.
 * It addresses issues that are NOT the user's fault and that users cannot fix themselves.
 *
 * Philosophy:
 * - Calibration is the final gate ensuring 100% executability
 * - Minor structural issues (compiler bugs) should be auto-fixed transparently
 * - Major structural problems (invalid workflow logic) require regeneration
 * - User errors (wrong configuration) need user intervention
 *
 * This engine covers ALL structural issues that can be fixed without regeneration:
 * 1. Missing output_variable on scatter-gather steps
 * 2. Missing or invalid step IDs
 * 3. Broken variable references (typos, wrong step names)
 * 4. Missing required fields on conditional steps
 * 5. Invalid loop configurations
 * 6. Broken dependency chains
 * 7. Missing input/output declarations
 * 8. Type mismatches in step connections
 *
 * @module lib/pilot/shadow/StructuralRepairEngine
 */

import type { Agent } from '../types';
import { createLogger } from '@/lib/logger';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

const logger = createLogger({ module: 'StructuralRepairEngine', service: 'shadow-agent' });

export type StructuralIssueType =
  | 'missing_output_variable'      // Scatter-gather missing output_variable field
  | 'invalid_step_id'              // Step ID is null, undefined, or empty
  | 'duplicate_step_id'            // Multiple steps with same ID
  | 'broken_variable_reference'    // Variable reference to non-existent step
  | 'missing_conditional_field'    // Conditional step missing condition/true_step/false_step
  | 'invalid_loop_config'          // Scatter-gather missing scatter/gather config
  | 'broken_dependency_chain'      // Step references dependency that doesn't exist
  | 'missing_input_declaration'    // Step uses variable not in inputs array
  | 'missing_attachment_flag'      // Searches for attachments but doesn't request attachment data
  | 'missing_output_declaration'   // Step produces output not in outputs array
  | 'type_mismatch'                // Step output type incompatible with consumer input type
  | 'orphaned_step'                // Step unreachable from workflow start
  | 'missing_action'               // Action step missing action field
  | 'invalid_config_reference'     // Uses {{config.X}} instead of {{input.X}}
  | 'missing_required_parameter';  // Action missing required parameter

export type StructuralFixAction =
  | 'add_output_variable'          // Add missing output_variable field
  | 'generate_step_id'             // Generate valid unique step ID
  | 'deduplicate_step_id'          // Rename duplicate step IDs
  | 'fix_variable_reference'       // Correct typo in variable reference
  | 'add_conditional_fields'       // Add missing conditional fields with defaults
  | 'fix_loop_config'              // Add missing loop configuration
  | 'rebuild_dependencies'         // Rebuild dependency chain based on variable usage
  | 'infer_inputs'                 // Infer inputs from variable references
  | 'infer_outputs'                // Infer outputs from output_variable/outputKey
  | 'add_type_conversion'          // Insert type conversion step
  | 'remove_orphaned_step'         // Remove unreachable step
  | 'add_attachment_flag'          // Add include_attachments parameter
  | 'infer_action'                 // Infer missing action from step context
  | 'normalize_legacy_fields'      // Normalize operation → action, config → params
  | 'rewrite_config_to_input'      // Rewrite {{config.X}} to {{input.X}}
  | 'add_missing_parameter'        // Add missing required parameter with smart default
  | 'none';                        // No fix possible

export interface StructuralIssue {
  type: StructuralIssueType;
  stepId: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  autoFixable: boolean;
}

export interface StructuralFixProposal {
  action: StructuralFixAction;
  description: string;
  targetStepId: string;
  confidence: number;  // 0-1
  risk: 'low' | 'medium' | 'high';
  fix?: any;           // The actual fix to apply
}

export interface StructuralFixResult {
  fixed: boolean;
  fixApplied?: StructuralFixProposal;
  error?: string;
}

/**
 * StructuralRepairEngine
 *
 * Analyzes compiled DSL for structural issues and auto-fixes them when possible.
 * This is a safety net for compiler bugs - not for user errors.
 */
export class StructuralRepairEngine {
  private pluginManager: PluginManagerV2 | null = null;

  /**
   * Initialize with PluginManager for action inference
   */
  async initialize(): Promise<void> {
    if (!this.pluginManager) {
      this.pluginManager = await PluginManagerV2.getInstance();
      logger.debug('StructuralRepairEngine initialized with PluginManager');
    }
  }

  /**
   * Scan workflow for all structural issues (including nested steps)
   */
  async scanWorkflow(agent: Agent): Promise<StructuralIssue[]> {
    console.log('🔍 [StructuralRepairEngine] scanWorkflow() called');
    console.log('🔍 [StructuralRepairEngine] agent.pilot_steps type:', typeof agent.pilot_steps);
    console.log('🔍 [StructuralRepairEngine] agent.pilot_steps length:', Array.isArray(agent.pilot_steps) ? agent.pilot_steps.length : 'N/A');

    // Ensure plugin manager is available for action inference
    await this.initialize();
    const issues: StructuralIssue[] = [];
    const steps: any[] = agent.pilot_steps || [];

    console.log('🔍 [StructuralRepairEngine] steps.length after assignment:', steps.length);

    if (steps.length === 0) {
      console.log('⚠️  [StructuralRepairEngine] No steps found, returning empty issues array');
      return issues;
    }

    console.log('🔍 [StructuralRepairEngine] Starting to scan', steps.length, 'steps...');

    // Build step ID map for reference checking (including nested steps)
    const stepIds = new Set<string>();
    const duplicateIds = new Set<string>();
    const allSteps = this.getAllStepsRecursive(steps);

    for (const step of allSteps) {
      const stepId = step.step_id || step.id;
      if (!stepId || stepId.trim() === '') {
        issues.push({
          type: 'invalid_step_id',
          stepId: stepId || 'unknown',
          description: `Step has invalid or missing step_id`,
          severity: 'critical',
          autoFixable: true
        });
      } else {
        if (stepIds.has(stepId)) {
          duplicateIds.add(stepId);
          issues.push({
            type: 'duplicate_step_id',
            stepId: stepId,
            description: `Duplicate step ID: ${stepId}`,
            severity: 'critical',
            autoFixable: true
          });
        }
        stepIds.add(stepId);
      }
    }

    // Check each step for structural issues (including nested steps)
    for (const step of allSteps) {
      const stepId = step.step_id || step.id;

      // Check scatter-gather steps
      if (step.type === 'scatter_gather') {

        // Issue 1: Missing output_variable (most common compiler bug)
        if (step.gather?.outputKey && !step.output_variable) {
          issues.push({
            type: 'missing_output_variable',
            stepId,
            description: `Scatter-gather step missing output_variable field (has gather.outputKey="${step.gather.outputKey}" but no output_variable)`,
            severity: 'high',
            autoFixable: true
          });
        }

        // Issue 2: Invalid loop configuration
        if (!step.scatter || !step.gather) {
          issues.push({
            type: 'invalid_loop_config',
            stepId,
            description: `Scatter-gather step missing scatter or gather configuration`,
            severity: 'critical',
            autoFixable: false  // This is a major structural problem
          });
        }

        // Issue 3: Broken variable references in scatter.input
        if (step.scatter?.input) {
          const brokenRefs = this.findBrokenVariableReferences(step.scatter.input, stepIds, stepId);
          for (const ref of brokenRefs) {
            issues.push({
              type: 'broken_variable_reference',
              stepId,
              description: `Scatter input references non-existent variable: ${ref.variable}`,
              severity: 'high',
              autoFixable: ref.suggestion ? true : false
            });
          }
        }
      }

      // Check conditional steps
      if (step.type === 'conditional') {

        // Issue 4: Missing conditional fields
        if (!step.condition) {
          issues.push({
            type: 'missing_conditional_field',
            stepId,
            description: `Conditional step missing 'condition' field`,
            severity: 'critical',
            autoFixable: false  // Cannot infer condition logic
          });
        }

        if (!step.then && !step.else && !step.then_steps && !step.else_steps) {
          issues.push({
            type: 'missing_conditional_field',
            stepId,
            description: `Conditional step missing both 'then' and 'else' branches`,
            severity: 'high',
            autoFixable: false  // Cannot infer branching logic
          });
        }

        // Issue 5: Broken variable references in condition
        if (step.condition) {
          const conditionStr = JSON.stringify(step.condition);
          const brokenRefs = this.findBrokenVariableReferences(conditionStr, stepIds, stepId);
          for (const ref of brokenRefs) {
            issues.push({
              type: 'broken_variable_reference',
              stepId,
              description: `Condition references non-existent variable: ${ref.variable}`,
              severity: 'high',
              autoFixable: ref.suggestion ? true : false
            });
          }
        }
      }

      // Check action steps for broken references and missing action
      if (step.type === 'action') {
        // Issue: Field normalization needed (operation → action, config → params)
        const needsFieldNormalization = (!step.action && step.operation) || (!step.params && step.config);

        if (needsFieldNormalization) {
          issues.push({
            type: 'missing_action', // Reuse this type for normalization
            stepId,
            description: `Step uses legacy field names (operation/config) - needs normalization to action/params`,
            severity: 'critical',
            autoFixable: true
          });
        }

        // Issue 6: Missing action field (critical - blocks execution)
        if (!step.action) {
          issues.push({
            type: 'missing_action',
            stepId,
            description: `Action step missing 'action' field (plugin: ${step.plugin || 'unknown'})`,
            severity: 'critical',
            autoFixable: step.plugin ? true : false // Can only fix if plugin is known
          });
        }

        const paramsStr = JSON.stringify(step.params || {});
        const brokenRefs = this.findBrokenVariableReferences(paramsStr, stepIds, stepId);
        for (const ref of brokenRefs) {
          issues.push({
            type: 'broken_variable_reference',
            stepId,
            description: `Action params reference non-existent variable: ${ref.variable}`,
            severity: 'medium',
            autoFixable: ref.suggestion ? true : false
          });
        }

        // Issue 7: Invalid {{config.X}} references (should be {{input.X}})
        const configRefs = this.findConfigReferences(paramsStr);
        if (configRefs.length > 0) {
          logger.info({
            stepId,
            stepName: step.name,
            configRefs,
            paramsStr: paramsStr.substring(0, 200) // First 200 chars for debugging
          }, '[StructuralRepair] Detected {{config.X}} references');

          issues.push({
            type: 'invalid_config_reference',
            stepId,
            description: `Uses {{config.X}} instead of {{input.X}}: ${configRefs.join(', ')}`,
            severity: 'critical', // Blocks execution
            autoFixable: true
          });
        }

        // Issue 8: Missing required parameters
        if (step.plugin && step.action) {
          const missingParams = await this.findMissingRequiredParams(step);
          if (missingParams.length > 0) {
            logger.info({
              stepId,
              stepName: step.name,
              plugin: step.plugin,
              action: step.action,
              missingParams: missingParams.map(p => ({ name: p.name, hasSmartDefault: p.hasSmartDefault }))
            }, '[StructuralRepair] Detected missing required parameters');
          }

          for (const param of missingParams) {
            issues.push({
              type: 'missing_required_parameter',
              stepId,
              description: `Missing required parameter: ${param.name}`,
              severity: 'critical', // Blocks execution
              autoFixable: param.hasSmartDefault
            });
          }
        }

        // Issue 7: Missing attachment flag on Gmail search
        if (step.plugin === 'google-mail' && step.action === 'search_emails') {
          const query = step.params?.query || '';
          const includeAttachments = step.params?.include_attachments;

          // Check if query searches for attachments but doesn't request attachment data
          if (query.includes('has:attachment') && includeAttachments !== true) {
            issues.push({
              type: 'missing_attachment_flag',
              stepId,
              description: `Step searches for emails with attachments but doesn't request attachment data (query: "${query}", include_attachments: ${includeAttachments})`,
              severity: 'high',
              autoFixable: true
            });
          }
        }
      }

      // Check for broken dependency chains
      if (step.dependencies) {
        for (const depId of step.dependencies) {
          if (!stepIds.has(depId)) {
            issues.push({
              type: 'broken_dependency_chain',
              stepId,
              description: `Step depends on non-existent step: ${depId}`,
              severity: 'high',
              autoFixable: true  // Can rebuild from variable references
            });
          }
        }
      }
    }

    return issues;
  }

  /**
   * Recursively collect all steps (including nested steps in scatter.steps, then, else, etc.)
   */
  private getAllStepsRecursive(steps: any[]): any[] {
    const allSteps: any[] = [];

    const traverse = (stepArray: any[]) => {
      for (const step of stepArray) {
        allSteps.push(step);

        // Recursively scan scatter-gather nested steps
        if (step.type === 'scatter_gather' && step.scatter?.steps) {
          traverse(step.scatter.steps);
        }

        // Recursively scan conditional branches
        if (step.type === 'conditional') {
          if (step.then && Array.isArray(step.then)) {
            traverse(step.then);
          }
          if (step.else && Array.isArray(step.else)) {
            traverse(step.else);
          }
          if (step.then_steps && Array.isArray(step.then_steps)) {
            traverse(step.then_steps);
          }
          if (step.else_steps && Array.isArray(step.else_steps)) {
            traverse(step.else_steps);
          }
        }
      }
    };

    traverse(steps);
    return allSteps;
  }

  /**
   * Propose a fix for a structural issue
   */
  async proposeStructuralFix(issue: StructuralIssue, agent: Agent): Promise<StructuralFixProposal> {
    const noFix: StructuralFixProposal = {
      action: 'none',
      description: 'No fix available',
      targetStepId: issue.stepId,
      confidence: 0,
      risk: 'high'
    };

    if (!issue.autoFixable) {
      return { ...noFix, description: `Issue type '${issue.type}' requires workflow regeneration` };
    }

    const steps = agent.pilot_steps || [];
    const allSteps = this.getAllStepsRecursive(steps);
    const step = allSteps.find(s => (s.step_id || s.id) === issue.stepId);

    if (!step) {
      return { ...noFix, description: `Step ${issue.stepId} not found` };
    }

    switch (issue.type) {
      case 'missing_output_variable': {
        const scatterStep = step as ScatterGatherStep;
        const outputKey = scatterStep.gather?.outputKey;

        if (!outputKey) {
          return { ...noFix, description: 'Cannot fix: gather.outputKey is missing' };
        }

        return {
          action: 'add_output_variable',
          description: `Add output_variable="${outputKey}" to scatter-gather step`,
          targetStepId: issue.stepId,
          confidence: 1.0,
          risk: 'low',
          fix: {
            output_variable: outputKey
          }
        };
      }

      case 'invalid_step_id': {
        const newStepId = this.generateUniqueStepId(steps);
        return {
          action: 'generate_step_id',
          description: `Generate new step ID: ${newStepId}`,
          targetStepId: issue.stepId,
          confidence: 0.9,
          risk: 'medium',
          fix: {
            step_id: newStepId
          }
        };
      }

      case 'duplicate_step_id': {
        const newStepId = this.generateUniqueStepId(steps, step.step_id);
        return {
          action: 'deduplicate_step_id',
          description: `Rename duplicate step ID to: ${newStepId}`,
          targetStepId: issue.stepId,
          confidence: 0.9,
          risk: 'medium',
          fix: {
            step_id: newStepId
          }
        };
      }

      case 'missing_attachment_flag': {
        return {
          action: 'add_attachment_flag',
          description: `Add include_attachments=true to search_emails params`,
          targetStepId: issue.stepId,
          confidence: 1.0,
          risk: 'low',
          fix: {
            param_name: 'include_attachments',
            param_value: true
          }
        };
      }

      case 'broken_variable_reference': {
        // Try to find a suggestion
        const stepIds = new Set(steps.map(s => s.step_id));
        const match = issue.description.match(/references non-existent variable: (\S+)/);
        if (!match) return noFix;

        const brokenVar = match[1];
        const suggestion = this.suggestVariableCorrection(brokenVar, stepIds);

        if (!suggestion) {
          return { ...noFix, description: `Cannot suggest correction for variable: ${brokenVar}` };
        }

        return {
          action: 'fix_variable_reference',
          description: `Replace '${brokenVar}' with '${suggestion}'`,
          targetStepId: issue.stepId,
          confidence: 0.8,
          risk: 'medium',
          fix: {
            oldVariable: brokenVar,
            newVariable: suggestion
          }
        };
      }

      case 'broken_dependency_chain': {
        // Rebuild dependencies from variable references
        const dependencies = this.inferDependenciesFromVariables(step, steps);

        return {
          action: 'rebuild_dependencies',
          description: `Rebuild dependencies based on variable usage: [${dependencies.join(', ')}]`,
          targetStepId: issue.stepId,
          confidence: 0.85,
          risk: 'low',
          fix: {
            dependencies
          }
        };
      }

      case 'missing_action': {
        // Check if this is a field normalization issue (legacy format)
        if (issue.description.includes('legacy field names')) {
          return {
            action: 'normalize_legacy_fields',
            description: `Normalize legacy fields: operation → action, config → params`,
            targetStepId: issue.stepId,
            confidence: 1.0, // This is a known transformation
            risk: 'low',
            fix: {
              normalizeOperation: !step.action && step.operation,
              normalizeConfig: !step.params && step.config
            }
          };
        }

        // Otherwise, infer action from step context (name, description, plugin)
        const inferredAction = await this.inferActionFromContext(step);

        if (!inferredAction) {
          return { ...noFix, description: `Cannot infer action for step (plugin: ${step.plugin || 'unknown'})` };
        }

        return {
          action: 'infer_action',
          description: `Infer action "${inferredAction.action}" from step context (confidence: ${Math.round(inferredAction.confidence * 100)}%)`,
          targetStepId: issue.stepId,
          confidence: inferredAction.confidence,
          risk: inferredAction.confidence >= 0.8 ? 'low' : 'medium',
          fix: {
            action: inferredAction.action,
            reasoning: inferredAction.reasoning
          }
        };
      }

      case 'invalid_config_reference': {
        // Extract all {{config.X}} references from the issue description
        const match = issue.description.match(/Uses \{\{config\.X\}\} instead of \{\{input\.X\}\}: (.+)/);
        const configRefs = match ? match[1].split(', ') : [];

        return {
          action: 'rewrite_config_to_input',
          description: `Rewrite ${configRefs.length} {{config.X}} reference(s) to {{input.X}}`,
          targetStepId: issue.stepId,
          confidence: 1.0, // This is a known fix
          risk: 'low',
          fix: {
            configRefs
          }
        };
      }

      case 'missing_required_parameter': {
        // Extract parameter name from description
        const match = issue.description.match(/Missing required parameter: (\w+)/);
        if (!match) return noFix;

        const paramName = match[1];
        const missingParams = await this.findMissingRequiredParams(step);
        const paramInfo = missingParams.find(p => p.name === paramName);

        if (!paramInfo || !paramInfo.hasSmartDefault) {
          return { ...noFix, description: `Cannot generate smart default for parameter: ${paramName}` };
        }

        const defaultValue = this.generateSmartDefault(paramInfo.schema, paramName, step, agent);

        return {
          action: 'add_missing_parameter',
          description: `Add missing parameter "${paramName}" with smart default: ${JSON.stringify(defaultValue)}`,
          targetStepId: issue.stepId,
          confidence: 0.7,
          risk: 'medium',
          fix: {
            paramName,
            paramValue: defaultValue
          }
        };
      }

      default:
        return noFix;
    }
  }

  /**
   * Infer missing action from step context
   * Uses step name, description, and plugin to match against available actions
   */
  private async inferActionFromContext(step: any): Promise<{
    action: string;
    confidence: number;
    reasoning: string;
  } | null> {
    if (!this.pluginManager || !step.plugin) {
      return null;
    }

    // Get plugin definition
    const pluginDef = this.pluginManager.getPluginDefinition(step.plugin);
    if (!pluginDef) {
      logger.warn({ plugin: step.plugin }, 'Plugin not found for action inference');
      return null;
    }

    const availableActions = Object.keys(pluginDef.actions);
    if (availableActions.length === 0) {
      return null;
    }

    // If there's only one action, use it with high confidence
    if (availableActions.length === 1) {
      return {
        action: availableActions[0],
        confidence: 0.95,
        reasoning: `Only one action available for plugin ${step.plugin}`
      };
    }

    // Analyze step context
    const stepName = (step.name || '').toLowerCase();
    const stepDescription = (step.description || '').toLowerCase();
    const stepContext = `${stepName} ${stepDescription}`.trim();

    if (!stepContext) {
      // No context to infer from - return most common action with low confidence
      return {
        action: availableActions[0],
        confidence: 0.3,
        reasoning: 'No step context available, using first action'
      };
    }

    // Score each action based on context match
    const scores: Array<{ action: string; score: number; matches: string[] }> = [];

    for (const actionName of availableActions) {
      const actionDef = pluginDef.actions[actionName];
      const actionDesc = actionDef.description.toLowerCase();
      const matches: string[] = [];
      let score = 0;

      // Exact action name match in step name
      if (stepName.includes(actionName.replace(/_/g, ' '))) {
        score += 50;
        matches.push('exact name match');
      }

      // Partial action name match
      const actionWords = actionName.split('_');
      for (const word of actionWords) {
        if (stepContext.includes(word)) {
          score += 10;
          matches.push(`word: ${word}`);
        }
      }

      // Keywords from action description
      const keywords = this.extractKeywords(actionDesc);
      for (const keyword of keywords) {
        if (stepContext.includes(keyword)) {
          score += 5;
          matches.push(`keyword: ${keyword}`);
        }
      }

      // Semantic similarity (common action verbs)
      const actionVerbs = {
        search: ['search', 'find', 'query', 'lookup', 'get'],
        create: ['create', 'add', 'new', 'insert', 'make'],
        update: ['update', 'edit', 'modify', 'change'],
        delete: ['delete', 'remove', 'trash'],
        send: ['send', 'deliver', 'forward'],
        list: ['list', 'get', 'fetch', 'retrieve']
      };

      for (const [verb, synonyms] of Object.entries(actionVerbs)) {
        if (actionName.includes(verb)) {
          for (const syn of synonyms) {
            if (stepContext.includes(syn)) {
              score += 15;
              matches.push(`verb: ${verb}→${syn}`);
              break;
            }
          }
        }
      }

      scores.push({ action: actionName, score, matches });
    }

    // Sort by score
    scores.sort((a, b) => b.score - a.score);

    const best = scores[0];
    if (best.score === 0) {
      // No matches - return first action with very low confidence
      return {
        action: availableActions[0],
        confidence: 0.2,
        reasoning: 'No context matches, using default action'
      };
    }

    // Calculate confidence based on score
    const maxScore = 100; // Theoretical max
    const confidence = Math.min(best.score / maxScore, 0.95);

    logger.info({
      stepId: step.id || step.step_id,
      stepName,
      plugin: step.plugin,
      inferredAction: best.action,
      confidence,
      score: best.score,
      matches: best.matches
    }, '[StructuralRepair] Inferred missing action');

    return {
      action: best.action,
      confidence,
      reasoning: `Matched: ${best.matches.join(', ')}`
    };
  }

  /**
   * Extract keywords from action description
   */
  private extractKeywords(description: string): string[] {
    // Remove common words and extract meaningful keywords
    const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from']);
    const words = description
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !commonWords.has(w));

    return Array.from(new Set(words)).slice(0, 5);
  }

  /**
   * Find a step by ID recursively (including nested steps)
   */
  private findStepRecursive(steps: any[], targetStepId: string): any | null {
    for (const step of steps) {
      const stepId = step.step_id || step.id;
      if (stepId === targetStepId) {
        return step;
      }

      // Search in scatter-gather nested steps
      if (step.type === 'scatter_gather' && step.scatter?.steps) {
        const found = this.findStepRecursive(step.scatter.steps, targetStepId);
        if (found) return found;
      }

      // Search in conditional branches
      if (step.type === 'conditional') {
        if (step.then && Array.isArray(step.then)) {
          const found = this.findStepRecursive(step.then, targetStepId);
          if (found) return found;
        }
        if (step.else && Array.isArray(step.else)) {
          const found = this.findStepRecursive(step.else, targetStepId);
          if (found) return found;
        }
        if (step.then_steps && Array.isArray(step.then_steps)) {
          const found = this.findStepRecursive(step.then_steps, targetStepId);
          if (found) return found;
        }
        if (step.else_steps && Array.isArray(step.else_steps)) {
          const found = this.findStepRecursive(step.else_steps, targetStepId);
          if (found) return found;
        }
      }
    }

    return null;
  }

  /**
   * Apply a structural fix to the workflow (including nested steps)
   */
  async applyStructuralFix(
    proposal: StructuralFixProposal,
    agent: Agent
  ): Promise<StructuralFixResult> {
    if (proposal.action === 'none') {
      return { fixed: false, error: 'No fix to apply' };
    }

    const steps: any[] = agent.pilot_steps || [];
    const step = this.findStepRecursive(steps, proposal.targetStepId);

    if (!step) {
      return { fixed: false, error: `Step ${proposal.targetStepId} not found` };
    }

    try {
      switch (proposal.action) {
        case 'add_output_variable': {
          step.output_variable = proposal.fix.output_variable;

          logger.info({
            stepId: proposal.targetStepId,
            outputVariable: proposal.fix.output_variable
          }, '[StructuralRepair] Added output_variable to scatter-gather step');

          return { fixed: true, fixApplied: proposal };
        }

        case 'add_attachment_flag': {
          // Ensure params object exists
          if (!step.params) {
            step.params = {};
          }

          step.params[proposal.fix.param_name] = proposal.fix.param_value;

          logger.info({
            stepId: proposal.targetStepId,
            paramName: proposal.fix.param_name,
            paramValue: proposal.fix.param_value
          }, '[StructuralRepair] Added include_attachments=true to search_emails');

          return { fixed: true, fixApplied: proposal };
        }

        case 'generate_step_id':
        case 'deduplicate_step_id': {
          const oldStepId = step.step_id || step.id;
          const newStepId = proposal.fix.step_id;

          // Update step ID
          step.step_id = newStepId;
          if (step.id) {
            step.id = newStepId;
          }

          // Update all references to this step in other steps (including nested)
          const allSteps = this.getAllStepsRecursive(steps);
          for (const otherStep of allSteps) {
            // Update dependencies
            if (otherStep.dependencies) {
              otherStep.dependencies = otherStep.dependencies.map((dep: string) =>
                dep === oldStepId ? newStepId : dep
              );
            }

            // Update variable references ({{step1.data}} → {{step2.data}})
            this.updateVariableReferences(otherStep, oldStepId, newStepId);
          }

          logger.info({
            oldStepId,
            newStepId
          }, '[StructuralRepair] Renamed step ID and updated all references');

          return { fixed: true, fixApplied: proposal };
        }

        case 'fix_variable_reference': {
          const { oldVariable, newVariable } = proposal.fix;

          // Replace variable reference in step
          this.replaceVariableReference(step, oldVariable, newVariable);

          logger.info({
            stepId: proposal.targetStepId,
            oldVariable,
            newVariable
          }, '[StructuralRepair] Fixed broken variable reference');

          return { fixed: true, fixApplied: proposal };
        }

        case 'rebuild_dependencies': {
          step.dependencies = proposal.fix.dependencies;

          logger.info({
            stepId: proposal.targetStepId,
            dependencies: proposal.fix.dependencies
          }, '[StructuralRepair] Rebuilt dependency chain');

          return { fixed: true, fixApplied: proposal };
        }

        case 'normalize_legacy_fields': {
          // Normalize operation → action
          if (proposal.fix.normalizeOperation && step.operation) {
            step.action = step.operation;
            logger.debug({
              stepId: proposal.targetStepId,
              operation: step.operation
            }, '[StructuralRepair] Normalized operation → action');
          }

          // Normalize config → params
          if (proposal.fix.normalizeConfig && step.config) {
            step.params = step.config;
            logger.debug({
              stepId: proposal.targetStepId
            }, '[StructuralRepair] Normalized config → params');
          }

          logger.info({
            stepId: proposal.targetStepId,
            normalizedOperation: proposal.fix.normalizeOperation,
            normalizedConfig: proposal.fix.normalizeConfig
          }, '[StructuralRepair] Normalized legacy field names to modern format');

          return { fixed: true, fixApplied: proposal };
        }

        case 'infer_action': {
          step.action = proposal.fix.action;

          logger.info({
            stepId: proposal.targetStepId,
            plugin: step.plugin,
            inferredAction: proposal.fix.action,
            confidence: proposal.confidence,
            reasoning: proposal.fix.reasoning
          }, '[StructuralRepair] Added inferred action to step');

          return { fixed: true, fixApplied: proposal };
        }

        case 'rewrite_config_to_input': {
          // Rewrite all {{config.X}} to {{input.X}} in step params
          const paramsStr = JSON.stringify(step.params || {});
          const updatedParamsStr = paramsStr.replace(/\{\{config\./g, '{{input.');
          step.params = JSON.parse(updatedParamsStr);

          logger.info({
            stepId: proposal.targetStepId,
            configRefs: proposal.fix.configRefs
          }, '[StructuralRepair] Rewrote {{config.X}} to {{input.X}}');

          return { fixed: true, fixApplied: proposal };
        }

        case 'add_missing_parameter': {
          // Ensure params object exists
          if (!step.params) {
            step.params = {};
          }

          step.params[proposal.fix.paramName] = proposal.fix.paramValue;

          logger.info({
            stepId: proposal.targetStepId,
            paramName: proposal.fix.paramName,
            paramValue: proposal.fix.paramValue
          }, '[StructuralRepair] Added missing required parameter with smart default');

          return { fixed: true, fixApplied: proposal };
        }

        default:
          return { fixed: false, error: `Fix action '${proposal.action}' not implemented` };
      }
    } catch (error) {
      logger.error({ err: error, proposal }, '[StructuralRepair] Failed to apply fix');
      return { fixed: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Auto-fix all structural issues in a workflow
   * Returns list of fixes applied
   */
  async autoFixWorkflow(agent: Agent): Promise<StructuralFixResult[]> {
    const issues = await this.scanWorkflow(agent);
    const results: StructuralFixResult[] = [];

    // Sort issues by severity (critical first)
    const sortedIssues = issues.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });

    for (const issue of sortedIssues) {
      if (!issue.autoFixable) {
        results.push({
          fixed: false,
          error: `Issue '${issue.type}' is not auto-fixable`
        });
        continue;
      }

      const proposal = await this.proposeStructuralFix(issue, agent);
      const result = await this.applyStructuralFix(proposal, agent);
      results.push(result);

      // If fix failed, log it but continue with other fixes
      if (!result.fixed) {
        logger.warn({
          issue,
          proposal,
          error: result.error
        }, '[StructuralRepair] Failed to apply fix, continuing with other issues');
      }
    }

    return results;
  }

  // ─── Private Helpers ─────────────────────────────────────

  /**
   * Find broken variable references in a string
   * Returns list of broken references with suggestions
   */
  private findBrokenVariableReferences(
    text: string,
    validStepIds: Set<string>,
    currentStepId: string
  ): Array<{ variable: string; suggestion: string | null }> {
    const brokenRefs: Array<{ variable: string; suggestion: string | null }> = [];

    // Match {{variable}} or {{step.field}}
    const regex = /\{\{([^}]+)\}\}/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const fullRef = match[1].trim();
      const rootVar = fullRef.split('.')[0];

      // Skip if it's a valid step ID
      if (validStepIds.has(rootVar)) continue;

      // Skip if it's the current step (self-reference)
      if (rootVar === currentStepId) continue;

      // Skip known built-in variables
      const builtins = new Set(['current_item', 'current_email', 'current_row', 'index', 'context']);
      if (builtins.has(rootVar)) continue;

      // This is a broken reference - try to suggest a correction
      const suggestion = this.suggestVariableCorrection(rootVar, validStepIds);
      brokenRefs.push({ variable: fullRef, suggestion });
    }

    return brokenRefs;
  }

  /**
   * Suggest a correction for a broken variable reference using fuzzy matching
   */
  private suggestVariableCorrection(
    brokenVar: string,
    validStepIds: Set<string>
  ): string | null {
    const validIds = Array.from(validStepIds);

    // Exact match (case-insensitive)
    const exactMatch = validIds.find(id => id.toLowerCase() === brokenVar.toLowerCase());
    if (exactMatch) return exactMatch;

    // Levenshtein distance (find closest match)
    let bestMatch: string | null = null;
    let bestDistance = Infinity;

    for (const validId of validIds) {
      const distance = this.levenshteinDistance(brokenVar.toLowerCase(), validId.toLowerCase());

      // Only suggest if distance is small (likely a typo)
      if (distance < bestDistance && distance <= 2) {
        bestDistance = distance;
        bestMatch = validId;
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
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Find {{config.X}} references that should be {{input.X}}
   */
  private findConfigReferences(text: string): string[] {
    const configRefs: string[] = [];
    const regex = /\{\{config\.([^}]+)\}\}/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      configRefs.push(match[0]); // Full reference like {{config.email}}
      logger.debug({ match: match[0], fullText: text.substring(0, 100) }, '[StructuralRepair] Found config reference');
    }

    if (configRefs.length > 0) {
      logger.debug({ configRefs, textLength: text.length }, '[StructuralRepair] findConfigReferences result');
    }

    return configRefs;
  }

  /**
   * Find missing required parameters for an action step
   */
  private async findMissingRequiredParams(step: any): Promise<Array<{
    name: string;
    hasSmartDefault: boolean;
    schema?: any;
  }>> {
    if (!this.pluginManager || !step.plugin || !step.action) {
      return [];
    }

    const pluginDef = this.pluginManager.getPluginDefinition(step.plugin);
    if (!pluginDef) return [];

    const actionDef = pluginDef.actions[step.action];
    if (!actionDef) return [];

    const schema = actionDef.parameters;
    if (!schema || !schema.required) return [];

    const missingParams: Array<{ name: string; hasSmartDefault: boolean; schema?: any }> = [];

    for (const paramName of schema.required) {
      // Check if parameter is missing or empty
      const paramValue = step.params?.[paramName];

      if (paramValue === undefined || paramValue === null || paramValue === '') {
        const paramSchema = schema.properties?.[paramName];

        // Check if we can generate a smart default
        const hasSmartDefault = this.canGenerateSmartDefault(paramSchema, paramName, step);

        missingParams.push({
          name: paramName,
          hasSmartDefault,
          schema: paramSchema
        });
      }
    }

    return missingParams;
  }

  /**
   * Check if we can generate a smart default for a parameter
   */
  private canGenerateSmartDefault(schema: any, paramName: string, _step: any): boolean {
    if (!schema) return false;

    // Can generate defaults for:
    // 1. Parameters with default values in schema
    if (schema.default !== undefined) return true;

    // 2. Boolean parameters (default to false)
    if (schema.type === 'boolean') return true;

    // 3. Number parameters with minimum value
    if (schema.type === 'number' && schema.minimum !== undefined) return true;

    // 4. String parameters with enum (use first option)
    if (schema.type === 'string' && schema.enum && schema.enum.length > 0) return true;

    // 5. Common parameter patterns we can infer from agent context
    const inferableParams = new Set([
      'spreadsheet_id',
      'folder_id',
      'channel_id',
      'project_id',
      'board_id'
    ]);
    if (inferableParams.has(paramName)) return true;

    return false;
  }

  /**
   * Generate a smart default value for a parameter
   */
  private generateSmartDefault(schema: any, paramName: string, step: any, agent: Agent): any {
    if (!schema) return null;

    // 1. Use schema default if available
    if (schema.default !== undefined) return schema.default;

    // 2. Boolean parameters default to false
    if (schema.type === 'boolean') return false;

    // 3. Number parameters use minimum or 0
    if (schema.type === 'number') {
      return schema.minimum !== undefined ? schema.minimum : 0;
    }

    // 4. String parameters with enum use first option
    if (schema.type === 'string' && schema.enum && schema.enum.length > 0) {
      return schema.enum[0];
    }

    // 5. Try to infer from agent inputs or workflow config
    // For email parameters, try to extract from agent inputs
    if (paramName === 'to' || paramName === 'recipient' || paramName === 'email') {
      // Check if agent has email input
      const emailInput = agent.input_schema?.properties?.email;
      if (emailInput) {
        return '{{input.email}}';
      }

      // Check if agent has user_email in config
      const userEmail = agent.agent_workflow?.config?.user_email;
      if (userEmail) {
        return userEmail;
      }

      // Fallback: use placeholder
      return '{{input.recipient_email}}';
    }

    // For ID parameters (spreadsheet_id, folder_id, etc.), use input reference
    const idParams = new Set(['spreadsheet_id', 'folder_id', 'channel_id', 'project_id', 'board_id']);
    if (idParams.has(paramName)) {
      return `{{input.${paramName}}}`;
    }

    // 6. Array default
    if (schema.type === 'array') return [];

    // 7. Object default
    if (schema.type === 'object') return {};

    // 8. String default
    if (schema.type === 'string') return '';

    return null;
  }

  /**
   * Infer step dependencies from variable references
   */
  private inferDependenciesFromVariables(
    step: any,
    allSteps: any[]
  ): string[] {
    const dependencies = new Set<string>();
    const stepId = step.step_id || step.id;
    const stepIds = new Set(allSteps.map((s: any) => s.step_id || s.id));

    // Search for {{stepX}} references in step params
    const searchInObject = (obj: any) => {
      if (typeof obj === 'string') {
        const regex = /\{\{([a-zA-Z_]\w*)\b/g;
        let match;
        while ((match = regex.exec(obj)) !== null) {
          const varName = match[1];
          if (stepIds.has(varName) && varName !== stepId) {
            dependencies.add(varName);
          }
        }
      } else if (Array.isArray(obj)) {
        obj.forEach(searchInObject);
      } else if (obj && typeof obj === 'object') {
        Object.values(obj).forEach(searchInObject);
      }
    };

    searchInObject(step);

    return Array.from(dependencies);
  }

  /**
   * Update variable references in a step ({{oldId.data}} → {{newId.data}})
   */
  private updateVariableReferences(
    step: any,
    oldStepId: string,
    newStepId: string
  ): void {
    const replaceInString = (str: string): string => {
      const regex = new RegExp(`\\{\\{${oldStepId}(\\.|\\})`, 'g');
      return str.replace(regex, `{{${newStepId}$1`);
    };

    const replaceInObject = (obj: any): any => {
      if (typeof obj === 'string') {
        return replaceInString(obj);
      } else if (Array.isArray(obj)) {
        return obj.map(replaceInObject);
      } else if (obj && typeof obj === 'object') {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = replaceInObject(value);
        }
        return result;
      }
      return obj;
    };

    // Update all fields
    if (step.params) {
      step.params = replaceInObject(step.params);
    }

    if (step.type === 'scatter_gather') {
      if (step.scatter?.input) {
        step.scatter.input = replaceInString(step.scatter.input);
      }
    }

    if (step.type === 'conditional') {
      if (step.condition) {
        step.condition = replaceInObject(step.condition);
      }
    }
  }

  /**
   * Replace a variable reference in a step
   */
  private replaceVariableReference(
    step: any,
    oldVariable: string,
    newVariable: string
  ): void {
    const replaceInString = (str: string): string => {
      return str.replace(new RegExp(`\\{\\{${this.escapeRegex(oldVariable)}\\}\\}`, 'g'), `{{${newVariable}}}`);
    };

    const replaceInObject = (obj: any): any => {
      if (typeof obj === 'string') {
        return replaceInString(obj);
      } else if (Array.isArray(obj)) {
        return obj.map(replaceInObject);
      } else if (obj && typeof obj === 'object') {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = replaceInObject(value);
        }
        return result;
      }
      return obj;
    };

    // Update all fields
    if (step.params) {
      step.params = replaceInObject(step.params);
    }

    if (step.type === 'scatter_gather') {
      if (step.scatter?.input) {
        step.scatter.input = replaceInString(step.scatter.input);
      }
    }

    if (step.type === 'conditional') {
      if (step.condition) {
        step.condition = replaceInObject(step.condition);
      }
    }
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Generate a unique step ID
   */
  private generateUniqueStepId(steps: any[], baseName: string = 'step'): string {
    const existingIds = new Set(steps.map((s: any) => s.step_id || s.id));

    // If baseName is already a stepN format, extract the number
    const match = baseName.match(/^step(\d+)$/);
    let counter = match ? parseInt(match[1], 10) : 1;

    let newId = `step${counter}`;
    while (existingIds.has(newId)) {
      counter++;
      newId = `step${counter}`;
    }

    return newId;
  }
}
