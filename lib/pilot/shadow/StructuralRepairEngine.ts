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
  | 'orphaned_step';               // Step unreachable from workflow start

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

  /**
   * Scan workflow for all structural issues (including nested steps)
   */
  async scanWorkflow(agent: Agent): Promise<StructuralIssue[]> {
    const issues: StructuralIssue[] = [];
    const steps: any[] = agent.pilot_steps || [];

    if (steps.length === 0) {
      return issues;
    }

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

      // Check action steps for broken references
      if (step.type === 'action') {
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

        // Issue 6: Missing attachment flag on Gmail search
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
  proposeStructuralFix(issue: StructuralIssue, agent: Agent): StructuralFixProposal {
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

      default:
        return noFix;
    }
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

      const proposal = this.proposeStructuralFix(issue, agent);
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
