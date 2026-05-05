/**
 * Action Mismatch Detector
 *
 * Detects when a workflow step uses the wrong plugin action based on parameter mismatch.
 * Example: Using `get_or_create_folder` with file upload parameters instead of `upload_file`.
 *
 * Detection Strategy:
 * 1. Check if step parameters match the selected action's schema
 * 2. If mismatch: analyze parameter names to infer intended action
 * 3. Search plugin definition for actions that match the parameters
 * 4. Propose action replacement with confidence scoring
 */

import { createLogger } from '@/lib/logger';
import type { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

const logger = createLogger({ module: 'ActionMismatchDetector' });

// Type definitions
type WorkflowStep = any;
type Agent = any;
type ActionDefinition = any;
type PluginDefinition = any;

/**
 * Action mismatch issue
 */
export interface ActionMismatchIssue {
  type: 'wrong_action_selected';
  stepId: string;
  confidence: number;
  description: string;

  // Mismatch details
  currentAction: string;
  suggestedAction: string;
  plugin: string;
  mismatchedParams: string[];
  matchingParams: string[];
  reasoning: string;
}

/**
 * Action replacement fix
 */
export interface ActionReplacementFix {
  action: 'replace_action';
  affectedSteps: string[];
  replacements: ActionReplacement[];
  verified: boolean;
  confidence: number;
  reasoning: string;
}

export interface ActionReplacement {
  stepId: string;
  fromAction: string;
  toAction: string;
  plugin: string;
  parameterMapping?: Record<string, string>; // old param name -> new param name
}

/**
 * Parameter match score
 */
interface ParameterMatchScore {
  action: string;
  matchCount: number;
  totalRequired: number;
  matchedParams: string[];
  missingParams: string[];
  extraParams: string[];
  score: number; // 0-1 confidence score
}

export class ActionMismatchDetector {
  private pluginManager: PluginManagerV2;

  constructor(pluginManager: PluginManagerV2) {
    this.pluginManager = pluginManager;
  }

  /**
   * Find a step by ID, including nested steps in scatter_gather and conditional blocks
   */
  private findStepById(steps: any[], stepId: string): any | null {
    for (const step of steps) {
      // Check current step
      if ((step.step_id || step.id) === stepId) {
        return step;
      }

      // Check nested steps in scatter_gather
      if (step.type === 'scatter_gather' && step.scatter?.steps) {
        const found = this.findStepById(step.scatter.steps, stepId);
        if (found) return found;
      }

      // Check nested steps in conditional
      if (step.type === 'conditional' && step.steps) {
        const found = this.findStepById(step.steps, stepId);
        if (found) return found;
      }
    }

    return null;
  }

  /**
   * Detect action mismatches in workflow (with detailed scoring debug)
   */
  async detectActionMismatches(agent: Agent): Promise<ActionMismatchIssue[]> {
    const issues: ActionMismatchIssue[] = [];

    if (!agent.pilot_steps || !Array.isArray(agent.pilot_steps)) {
      return issues;
    }

    logger.info({ agentId: agent.id, totalSteps: agent.pilot_steps.length }, '[ActionMismatchDetector] Starting action mismatch detection');

    // Helper to check a single step
    const checkStep = async (step: any) => {
      if (step.type !== 'action' || !step.plugin || !step.action) {
        return;
      }

      // Debug log for step8
      if (step.step_id === 'step8' || step.id === 'step8') {
        logger.info({
          stepId: step.step_id || step.id,
          action: step.action,
          plugin: step.plugin,
          params: Object.keys(step.params || step.config || {})
        }, '[ActionMismatchDetector] DEBUG: Checking step8');
      }

      try {
        const mismatch = await this.detectStepActionMismatch(step);
        if (mismatch) {
          issues.push(mismatch);
          logger.info({
            stepId: step.step_id || step.id,
            currentAction: step.action,
            suggestedAction: mismatch.suggestedAction,
            confidence: mismatch.confidence
          }, '[ActionMismatchDetector] Detected action mismatch');
        }
      } catch (error) {
        logger.error({
          err: error,
          stepId: step.step_id || step.id
        }, '[ActionMismatchDetector] Error detecting action mismatch');
      }
    };

    // Check all steps including nested scatter_gather and conditional steps
    for (const step of agent.pilot_steps) {
      await checkStep(step);

      // Check scatter_gather nested steps
      if (step.type === 'scatter_gather' && step.scatter?.steps) {
        for (const nestedStep of step.scatter.steps) {
          await checkStep(nestedStep);
        }
      }

      // Check conditional nested steps
      if (step.type === 'conditional' && step.steps) {
        for (const nestedStep of step.steps) {
          await checkStep(nestedStep);
        }
      }
    }

    logger.info({
      agentId: agent.id,
      totalIssues: issues.length
    }, '[ActionMismatchDetector] Action mismatch detection complete');

    return issues;
  }

  /**
   * Detect action mismatch for a single step
   */
  private async detectStepActionMismatch(step: WorkflowStep): Promise<ActionMismatchIssue | null> {
    const stepId = step.step_id || step.id;
    const { plugin: pluginKey, action: actionName, params } = step;

    if (!params || typeof params !== 'object') {
      return null;
    }

    // Get plugin definition
    const pluginDef = await this.pluginManager.getPluginDefinition(pluginKey);
    if (!pluginDef) {
      logger.warn({ stepId, pluginKey }, '[ActionMismatchDetector] Plugin definition not found');
      return null;
    }

    // Get current action definition
    // Note: pluginDef.actions is an object { actionName: actionDef }, not an array
    const currentActionDef = pluginDef.actions?.[actionName];
    if (!currentActionDef) {
      logger.warn({ stepId, pluginKey, actionName }, '[ActionMismatchDetector] Action definition not found');
      return null;
    }

    // Extract step parameter names
    const stepParamNames = Object.keys(params);

    // Check if parameters match current action
    const currentMatch = this.scoreParameterMatch(stepParamNames, currentActionDef);

    // Debug logging for step8
    if (stepId === 'step8') {
      logger.info({
        stepId,
        currentAction: actionName,
        currentScore: currentMatch.score,
        currentMatchedParams: currentMatch.matchedParams,
        currentMissingParams: currentMatch.missingParams,
        currentExtraParams: currentMatch.extraParams
      }, '[ActionMismatchDetector] DEBUG: Current action match score');
    }

    // If current action is a good match (>0.7), no issue
    if (currentMatch.score > 0.7) {
      if (stepId === 'step8') {
        logger.info({ stepId, score: currentMatch.score }, '[ActionMismatchDetector] DEBUG: Skipping - current action score > 0.7');
      }
      return null;
    }

    // Search for better matching actions
    // Convert actions object to array for searching
    const actionsArray = Object.entries(pluginDef.actions || {}).map(([name, def]) => ({ ...def, name }));
    const betterMatch = this.findBestMatchingAction(stepParamNames, actionsArray, actionName);

    // Debug logging for step8
    if (stepId === 'step8') {
      logger.info({
        stepId,
        betterAction: betterMatch?.action,
        betterScore: betterMatch?.score,
        betterMatchedParams: betterMatch?.matchedParams,
        betterMissingParams: betterMatch?.missingParams
      }, '[ActionMismatchDetector] DEBUG: Better action match score');
    }

    // If no better match found or confidence too low, no issue
    if (!betterMatch || betterMatch.score <= currentMatch.score || betterMatch.score < 0.6) {
      if (stepId === 'step8') {
        logger.info({
          stepId,
          reason: !betterMatch ? 'no better match' : betterMatch.score <= currentMatch.score ? 'better score not better than current' : 'better score < 0.6'
        }, '[ActionMismatchDetector] DEBUG: Skipping - no valid better match');
      }
      return null;
    }

    // Calculate confidence (difference between best match and current match)
    const confidence = Math.min(0.95, betterMatch.score);

    return {
      type: 'wrong_action_selected',
      stepId,
      confidence,
      description: `Step uses '${actionName}' but parameters match '${betterMatch.action}' better`,
      currentAction: actionName,
      suggestedAction: betterMatch.action,
      plugin: pluginKey,
      mismatchedParams: currentMatch.missingParams,
      matchingParams: betterMatch.matchedParams,
      reasoning: this.generateReasoning(currentMatch, betterMatch, stepParamNames)
    };
  }

  /**
   * Score how well step parameters match an action's schema
   */
  private scoreParameterMatch(
    stepParams: string[],
    actionDef: any
  ): ParameterMatchScore {
    // Handle JSON Schema structure: parameters.properties contains the actual params
    const paramsSchema = actionDef.parameters || {};
    const actionParams = paramsSchema.properties || paramsSchema;
    const requiredParamsList = paramsSchema.required || [];
    const requiredParams = requiredParamsList;
    const allActionParams = Object.keys(actionParams);

    const matchedParams: string[] = [];
    const missingParams: string[] = [];
    const extraParams: string[] = [];

    // Check which step params match action params
    for (const stepParam of stepParams) {
      if (allActionParams.includes(stepParam)) {
        matchedParams.push(stepParam);
      } else {
        extraParams.push(stepParam);
      }
    }

    // Check which required params are missing
    for (const requiredParam of requiredParams) {
      if (!stepParams.includes(requiredParam)) {
        missingParams.push(requiredParam);
      }
    }

    // Calculate score
    const matchCount = matchedParams.length;
    const totalRequired = requiredParams.length;
    const extraPenalty = extraParams.length * 0.1;
    const missingPenalty = missingParams.length * 0.3;

    // Base score: matched params / total action params
    let score = allActionParams.length > 0 ? matchCount / allActionParams.length : 0;

    // Penalty for missing required params (severe)
    score -= missingPenalty;

    // Penalty for extra params (mild)
    score -= extraPenalty;

    // Bonus if all required params present
    if (totalRequired > 0 && missingParams.length === 0) {
      score += 0.2;
    }

    return {
      action: actionDef.name,
      matchCount,
      totalRequired,
      matchedParams,
      missingParams,
      extraParams,
      score: Math.max(0, Math.min(1, score))
    };
  }

  /**
   * Find the best matching action from available actions
   */
  private findBestMatchingAction(
    stepParams: string[],
    actions: ActionDefinition[],
    excludeAction?: string
  ): ParameterMatchScore | null {
    let bestMatch: ParameterMatchScore | null = null;

    for (const action of actions) {
      // Skip the current action
      if (excludeAction && action.name === excludeAction) {
        continue;
      }

      const match = this.scoreParameterMatch(stepParams, action);

      if (!bestMatch || match.score > bestMatch.score) {
        bestMatch = match;
      }
    }

    return bestMatch;
  }

  /**
   * Generate human-readable reasoning for the mismatch
   */
  private generateReasoning(
    currentMatch: ParameterMatchScore,
    betterMatch: ParameterMatchScore,
    stepParams: string[]
  ): string {
    const parts: string[] = [];

    parts.push(`Step parameters (${stepParams.join(', ')}) match '${betterMatch.action}' action better.`);

    if (currentMatch.missingParams.length > 0) {
      parts.push(`Current action '${currentMatch.action}' requires missing parameters: ${currentMatch.missingParams.join(', ')}.`);
    }

    if (betterMatch.matchedParams.length > 0) {
      parts.push(`Suggested action '${betterMatch.action}' matches all provided parameters.`);
    }

    return parts.join(' ');
  }

  /**
   * Generate fix for action mismatch issues
   */
  async generateActionReplacementFix(
    issue: ActionMismatchIssue,
    agent: Agent
  ): Promise<ActionReplacementFix | null> {
    const step = this.findStepById(agent.pilot_steps, issue.stepId);

    if (!step) {
      logger.warn({ stepId: issue.stepId }, '[ActionMismatchDetector] Step not found for fix generation');
      return null;
    }

    // Check if we need parameter renaming
    const parameterMapping = await this.detectParameterMapping(
      step.params,
      step.plugin,
      issue.currentAction,
      issue.suggestedAction
    );

    const replacement: ActionReplacement = {
      stepId: issue.stepId,
      fromAction: issue.currentAction,
      toAction: issue.suggestedAction,
      plugin: issue.plugin,
      parameterMapping: parameterMapping || undefined
    };

    return {
      action: 'replace_action',
      affectedSteps: [issue.stepId],
      replacements: [replacement],
      verified: issue.confidence > 0.8,
      confidence: issue.confidence,
      reasoning: issue.reasoning
    };
  }

  /**
   * Detect if parameter renaming is needed when changing actions
   */
  private async detectParameterMapping(
    stepParams: Record<string, any>,
    pluginKey: string,
    fromAction: string,
    toAction: string
  ): Promise<Record<string, string> | null> {
    const pluginDef = await this.pluginManager.getPluginDefinition(pluginKey);
    if (!pluginDef) return null;

    const toActionDef = pluginDef.actions?.[toAction];
    if (!toActionDef) return null;

    // Handle JSON Schema structure
    const paramsSchema = toActionDef.parameters || {};
    const actionParams = paramsSchema.properties || paramsSchema;
    const toActionParams = Object.keys(actionParams);
    const stepParamNames = Object.keys(stepParams);

    const mapping: Record<string, string> = {};
    let hasMappings = false;

    // Check if any step params don't exist in new action (need renaming)
    for (const stepParam of stepParamNames) {
      if (!toActionParams.includes(stepParam)) {
        // Try to find a similar param name in new action
        const similar = this.findSimilarParameterName(stepParam, toActionParams);
        if (similar) {
          mapping[stepParam] = similar;
          hasMappings = true;
        }
      }
    }

    return hasMappings ? mapping : null;
  }

  /**
   * Find similar parameter name (simple string similarity)
   */
  private findSimilarParameterName(source: string, candidates: string[]): string | null {
    // Simple heuristic: check for common substrings
    const sourceLower = source.toLowerCase();

    for (const candidate of candidates) {
      const candidateLower = candidate.toLowerCase();

      // Direct match
      if (sourceLower === candidateLower) {
        return candidate;
      }

      // Contains match (e.g., "file_name" -> "filename")
      if (sourceLower.replace(/_/g, '') === candidateLower.replace(/_/g, '')) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Apply action replacement fix to agent
   */
  applyActionReplacementFix(agent: Agent, fix: ActionReplacementFix): boolean {
    if (!agent.pilot_steps || !Array.isArray(agent.pilot_steps)) {
      return false;
    }

    let applied = false;

    for (const replacement of fix.replacements) {
      const step = this.findStepById(agent.pilot_steps, replacement.stepId);

      if (!step) {
        logger.warn({ stepId: replacement.stepId }, '[ActionMismatchDetector] Step not found for replacement');
        continue;
      }

      logger.info({
        stepId: replacement.stepId,
        fromAction: replacement.fromAction,
        toAction: replacement.toAction,
        plugin: replacement.plugin
      }, '[ActionMismatchDetector] Applying action replacement');

      // Replace action name
      step.action = replacement.toAction;

      // Apply parameter mapping if needed
      if (replacement.parameterMapping && step.params) {
        for (const [oldName, newName] of Object.entries(replacement.parameterMapping)) {
          if (step.params[oldName] !== undefined) {
            step.params[newName] = step.params[oldName];
            delete step.params[oldName];

            logger.info({
              stepId: replacement.stepId,
              oldParam: oldName,
              newParam: newName
            }, '[ActionMismatchDetector] Renamed parameter');
          }
        }
      }

      applied = true;
    }

    return applied;
  }
}
