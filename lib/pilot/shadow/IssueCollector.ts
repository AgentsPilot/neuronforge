/**
 * IssueCollector - Collect and categorize workflow issues during batch calibration
 *
 * This service intercepts errors during step execution in batch calibration mode,
 * classifies them using FailureClassifier, and stores them as CollectedIssue objects
 * for presentation to the user.
 *
 * Key responsibilities:
 * - Convert exceptions to CollectedIssue format
 * - Generate friendly, non-technical error messages
 * - Propose auto-repairs using RepairEngine
 * - Detect hardcoded values using HardcodeDetector
 *
 * PRIVACY: No client data is stored, only metadata and structure information
 *
 * @module lib/pilot/shadow/IssueCollector
 */

import { FailureClassifier } from './FailureClassifier';
import { HardcodeDetector } from './HardcodeDetector';
import { RepairEngine } from './RepairEngine';
import { getFriendlyStepName, getFriendlyError } from './friendlyLanguage';
import type { FailureClassification } from './types';
import type { CollectedIssue, Agent, ExecutionContext, StepOutput } from '../types';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'IssueCollector', service: 'shadow-agent' });

export class IssueCollector {
  private classifier: FailureClassifier;
  private detector: HardcodeDetector;
  private repairEngine: RepairEngine;

  constructor() {
    this.classifier = new FailureClassifier();
    this.detector = new HardcodeDetector();
    this.repairEngine = new RepairEngine();
  }

  /**
   * Collect issue from step execution error
   * Called by StepExecutor when a step fails in batch calibration mode
   */
  collectFromError(
    error: Error & { code?: string },
    stepId: string,
    stepName: string,
    stepType: string,
    context: ExecutionContext
  ): CollectedIssue {
    logger.debug({
      stepId,
      stepName,
      errorCode: error.code,
      errorMessage: error.message
    }, 'Collecting issue from error');

    // Classify the error
    const classification = this.classifier.classify(
      {
        message: error.message,
        code: error.code
      },
      {
        stepId,
        stepName,
        stepType,
        availableVariableKeys: Object.keys(context.variables),
        completedSteps: context.completedSteps,
        retryCount: 0
      }
    );

    // Get step config for parameter detection
    // Need to search both top-level steps AND nested steps (parallel, scatter-gather, etc.)
    const step = this.findStepInWorkflow(context.agent.pilot_steps || context.agent.workflow_steps || [], stepId);

    // Check for parameter errors (configuration issues)
    // Pass step params to detect the actual parameter name from the step config
    const stepParams = (step as any)?.params;

    // Debug logging to help troubleshoot parameter detection
    if (!stepParams) {
      logger.warn({ stepId, stepFound: !!step }, 'No step params found for parameter error detection');
    }

    const parameterError = this.detectParameterError(error.message, stepParams);

    // Generate friendly messages
    const friendlyName = getFriendlyStepName(step || { name: stepName, type: stepType });
    const title = this.generateTitle(classification, stepName);
    const message = this.generateFriendlyMessage(classification, error, parameterError);

    // Determine severity for UI display
    let severity = this.mapSeverityToUI(classification.severity);
    let suggestedFix = undefined;
    let finalCategory = this.mapCategoryForUI(classification.category);

    if (parameterError) {
      // Override category to parameter_error for UI routing
      finalCategory = 'parameter_error';
      // Parameter errors should always be critical (they block execution)
      severity = 'critical';

      // Resolve parameter references for dependent dropdowns
      // When parameters are parameterized (e.g., spreadsheet_id: "{{input.spreadsheet_id}}"),
      // we need to resolve them to actual values so dependent dropdowns can fetch options
      const resolvedStepConfig = this.resolveParameterReferences(
        stepParams,
        context
      );

      // Use the step we already found (which searches nested steps)
      suggestedFix = {
        type: 'parameter_correction' as const,
        action: {
          parameterName: parameterError.parameterName,
          problematicValue: parameterError.problematicValue,
          expectedFormat: parameterError.expectedFormat,
          // Store step metadata for frontend to fetch options
          stepPlugin: (step as any)?.plugin,
          stepAction: (step as any)?.action,
          stepConfig: resolvedStepConfig  // ← Now contains actual values, not {{templates}}
        },
        confidence: 0.95
      };

      logger.info({
        parameterName: parameterError.parameterName,
        problematicValue: parameterError.problematicValue,
        plugin: (step as any)?.plugin,
        hasResolvedParams: Object.keys(resolvedStepConfig).length > 0
      }, 'Parameter error detected in batch calibration');
    }

    // Check if auto-repair is available (for data shape mismatches)
    let autoRepairProposal = null;
    let autoRepairAvailable = false;

    if (classification.category === 'data_shape_mismatch') {
      // Find the upstream step that produced the mismatched data
      const upstreamStepId = this.detectUpstreamStepId(stepId, context);

      if (upstreamStepId) {
        const upstreamOutput = context.stepOutputs.get(upstreamStepId);

        if (upstreamOutput) {
          autoRepairProposal = this.repairEngine.proposeRepair(
            classification,
            stepId,
            upstreamStepId,
            upstreamOutput
          );

          autoRepairAvailable = autoRepairProposal?.action !== 'none';
        }
      }
    }

    // Create the collected issue
    const issue: CollectedIssue = {
      id: crypto.randomUUID(),
      category: finalCategory,
      severity,
      affectedSteps: [{
        stepId,
        stepName,
        friendlyName: `${stepId} - ${friendlyName}` // Show both ID and description
      }],
      title,
      message,
      technicalDetails: `${error.code ? `[${error.code}] ` : ''}${error.message}`,
      suggestedFix,
      autoRepairAvailable,
      autoRepairProposal: autoRepairAvailable ? autoRepairProposal : undefined,
      requiresUserInput: parameterError ? true : !autoRepairAvailable,
      estimatedImpact: this.estimateImpact(classification)
    };

    logger.info({
      issueId: issue.id,
      category: issue.category,
      severity: issue.severity,
      autoRepairAvailable
    }, 'Issue collected from error');

    return issue;
  }

  /**
   * Detect hardcoded values in the workflow after execution completes
   * Called after batch calibration run finishes
   */
  collectHardcodedValues(
    agent: Agent
  ): CollectedIssue[] {
    logger.debug({ agentId: agent.id }, 'Detecting hardcoded values in workflow');

    const pilotSteps = agent.pilot_steps || agent.workflow_steps || [];

    if (pilotSteps.length === 0) {
      return [];
    }

    // Use HardcodeDetector to find hardcoded values
    const detectionResult = this.detector.detect(pilotSteps);

    // Flatten the categorized detections into a single array
    const allDetections = [
      ...detectionResult.resource_ids,
      ...detectionResult.business_logic,
      ...detectionResult.configuration
    ];

    logger.info({
      agentId: agent.id,
      detectionsCount: allDetections.length,
      byCategory: {
        resource_ids: detectionResult.resource_ids.length,
        business_logic: detectionResult.business_logic.length,
        configuration: detectionResult.configuration.length
      }
    }, 'Hardcode detection completed');

    // Convert each detection to a CollectedIssue
    // NO DEDUPLICATION: Each input in the workflow gets its own unique parameter
    // Even if multiple steps have the same parameter type (e.g., spreadsheet_id),
    // each one should be independent (e.g., step8_spreadsheet_id, step9_spreadsheet_id)
    return allDetections.map((detection, detectionIndex) => {
      // Use the parameter name directly from HardcodeDetector
      // It already includes step prefix (e.g., step8_spreadsheet_id) from extractParamName()
      const uniqueParamName = detection.suggested_param;
      const baseParamName = detection.suggested_param;

      const issue: CollectedIssue = {
        id: crypto.randomUUID(),
        category: 'hardcode_detected',
        severity: this.mapHardcodeSeverity(detection.category),
        affectedSteps: detection.stepIds.map(stepId => ({
          stepId,
          stepName: this.getStepName(agent, stepId),
          friendlyName: this.getStepName(agent, stepId) // Use step name directly
        })),
        title: `Hardcoded ${this.formatHardcodeCategory(detection.category)}: "${detection.value}"`,
        message: this.generateHardcodeMessage(detection),
        technicalDetails: JSON.stringify(detection, null, 2),
        suggestedFix: {
          type: 'parameterization',
          action: {
            path: detection.path,
            paramName: uniqueParamName, // Backend name with step prefix (e.g., step8_spreadsheet_id)
            displayName: detection.label || baseParamName, // Frontend display name without prefix
            stepContext: this.getStepName(agent, detection.stepIds[0]), // Full step name for context
            defaultValue: detection.value,
            description: detection.label || `Convert hardcoded ${detection.category} to input parameter`
          },
          confidence: 0.9
        },
        autoRepairAvailable: false,
        requiresUserInput: true,
        estimatedImpact: detection.category === 'resource_ids' ? 'high' : 'medium'
      };

      return issue;
    });
  }

  /**
   * Generate a user-friendly title for the issue
   */
  private generateTitle(classification: FailureClassification, stepName: string): string {
    const category = classification.category;

    switch (category) {
      case 'data_shape_mismatch':
        return 'Data format mismatch';

      case 'data_unavailable':
        return 'No data found';

      case 'execution_error':
        if (classification.sub_type === 'auth') {
          return 'Authentication required';
        }
        if (classification.sub_type === 'retryable') {
          return 'Temporary error';
        }
        return 'Step Execution Failed';

      case 'capability_mismatch':
        return 'Action not supported';

      case 'logic_error':
        return 'Logic error';

      case 'missing_step':
        return 'Missing required step';

      case 'invalid_step_order':
        return 'Step dependency error';

      default:
        return 'Step failed';
    }
  }

  /**
   * Generate a friendly, non-technical error message
   */
  private generateFriendlyMessage(classification: FailureClassification, error: Error, parameterError?: { parameterName: string; problematicValue: string } | null): string {
    const category = classification.category;
    const message = error.message.toLowerCase();

    // Handle parameter errors first (configuration issues)
    if (parameterError) {
      const { parameterName, problematicValue } = parameterError;
      return `The "${parameterName}" value "${problematicValue}" could not be found or is invalid. Please select the correct value from the dropdown or enter a valid value.`;
    }

    switch (category) {
      case 'data_shape_mismatch':
        if (message.includes('expected array') && message.includes('got object')) {
          return 'This step needs a list of items, but received a single item instead. The system can automatically fix this.';
        }
        if (message.includes('expected object') && message.includes('got array')) {
          return 'This step needs a single item, but received a list instead. The system can automatically fix this.';
        }
        return 'The data format from the previous step doesn\'t match what this step expects.';

      case 'data_unavailable':
        if (message.includes('empty') || message.includes('no results')) {
          return 'This step didn\'t find any data. This might be normal if there are no items to process.';
        }
        if (message.includes('missing field') || message.includes('undefined')) {
          return 'The data is missing a required field. Check if the previous step is providing all necessary information.';
        }
        return 'No data was available for this step to process.';

      case 'execution_error':
        if (classification.sub_type === 'auth') {
          return 'Authentication failed. Please check that the plugin is properly connected and has valid credentials.';
        }
        if (classification.sub_type === 'retryable') {
          if (message.includes('timeout')) {
            return 'The request timed out. This might be a temporary issue with the service.';
          }
          if (message.includes('rate limit')) {
            return 'Too many requests to the service. This is a temporary limit and the workflow will work after waiting.';
          }
          return 'A temporary error occurred. This is often caused by network issues or service availability.';
        }
        // Return the actual error message directly
        return error.message;

      case 'capability_mismatch':
        return 'The plugin doesn\'t support this action. You may need to use a different plugin or action.';

      case 'logic_error':
        return 'There\'s an error in the workflow logic, such as a missing condition check or invalid data reference.';

      case 'missing_step':
        return 'This workflow is missing a required step. Add the necessary step to fix this.';

      case 'invalid_step_order':
        return 'This step depends on another step that hasn\'t run yet. Check the step dependencies.';

      default:
        return getFriendlyError(category, error.message, classification.sub_type);
    }
  }

  /**
   * Generate friendly message for hardcode detection
   */
  private generateHardcodeMessage(detection: any): string {
    const category = detection.category;
    const value = detection.value;
    const count = detection.stepIds?.length || 1;

    switch (category) {
      case 'resource_ids':
        return `This workflow uses a hardcoded ID "${value}" in ${count} step${count > 1 ? 's' : ''}. Converting this to an input parameter will make your workflow reusable with different resources.`;

      case 'business_logic':
        return `The value "${value}" is hardcoded in ${count} step${count > 1 ? 's' : ''}. Consider making this configurable so you can easily change it without editing the workflow.`;

      case 'configuration':
        return `The configuration value "${value}" is hardcoded. Making this a parameter will allow you to reuse this workflow in different scenarios.`;

      default:
        return `The value "${value}" is hardcoded in your workflow. Converting it to a parameter will make your workflow more flexible and reusable.`;
    }
  }

  /**
   * Map failure category to UI-friendly category
   */
  private mapCategoryForUI(category: string): CollectedIssue['category'] {
    // Map internal categories to UI categories
    switch (category) {
      case 'execution_error':
      case 'logic_error':
      case 'capability_mismatch':
      case 'missing_step':
      case 'invalid_step_order':
        return 'execution_error';

      case 'data_shape_mismatch':
        return 'data_shape_mismatch';

      case 'data_unavailable':
        return 'data_unavailable';

      default:
        return 'execution_error';
    }
  }

  /**
   * Map failure severity to UI severity
   */
  private mapSeverityToUI(severity: string): 'critical' | 'high' | 'medium' | 'low' {
    return severity as 'critical' | 'high' | 'medium' | 'low';
  }

  /**
   * Map hardcode detection category to severity
   */
  private mapHardcodeSeverity(category: string): 'critical' | 'high' | 'medium' | 'low' {
    switch (category) {
      case 'resource_id':
        return 'high';
      case 'business_logic':
        return 'medium';
      case 'configuration':
        return 'medium';
      default:
        return 'low';
    }
  }

  /**
   * Estimate the impact of fixing this issue
   */
  private estimateImpact(classification: FailureClassification): 'high' | 'medium' | 'low' {
    if (classification.severity === 'critical') {
      return 'high';
    }

    if (classification.category === 'data_shape_mismatch' && classification.severity === 'high') {
      return 'high'; // But auto-repairable
    }

    if (classification.category === 'execution_error' && classification.sub_type === 'auth') {
      return 'high'; // Blocks entire workflow
    }

    if (classification.severity === 'high') {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Format hardcode category for display
   */
  private formatHardcodeCategory(category: string): string {
    switch (category) {
      case 'resource_id':
        return 'Resource ID';
      case 'business_logic':
        return 'Business Logic Value';
      case 'configuration':
        return 'Configuration Value';
      default:
        return 'Value';
    }
  }

  /**
   * Get step name from agent configuration
   */
  private getStepName(agent: Agent, stepId: string): string {
    const steps = agent.pilot_steps || agent.workflow_steps || [];

    // Recursively search for step, including nested steps in parallel/scatter blocks
    const findStep = (stepsArray: any[]): any => {
      for (const step of stepsArray) {
        if (step.id === stepId) {
          return step;
        }

        // Search in nested parallel steps
        if (step.type === 'parallel' && Array.isArray(step.steps)) {
          const found = findStep(step.steps);
          if (found) return found;
        }

        // Search in nested scatter_gather steps
        if (step.type === 'scatter_gather' && step.scatter?.steps) {
          const found = findStep(step.scatter.steps);
          if (found) return found;
        }
      }
      return null;
    };

    const step = findStep(steps);

    if (!step) return stepId;

    // Try multiple fields to get a meaningful name
    let name = step.name;

    // Try accessing other properties safely
    if (!name && 'action' in step) {
      name = step.action;
    }

    if (!name) {
      name = step.type;
    }

    // If we got a meaningful name, return it
    if (name && name !== stepId) {
      return name;
    }

    // Fallback to stepId but make it more readable
    // Convert "step_1" to "Step 1"
    return stepId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * Detect the upstream step that provides input to the failed step
   * Used to identify which step's output needs repair
   */
  private detectUpstreamStepId(failedStepId: string, context: ExecutionContext): string | null {
    const steps = context.agent.pilot_steps || context.agent.workflow_steps || [];
    const failedStep = steps.find(s => s.id === failedStepId);

    if (!failedStep) {
      return null;
    }

    // Check explicit dependencies first
    if (failedStep.dependencies && failedStep.dependencies.length > 0) {
      // Return the last dependency (most likely to be the data source)
      return failedStep.dependencies[failedStep.dependencies.length - 1];
    }

    // Check for variable references in step params
    if ('params' in failedStep && failedStep.params) {
      const paramsStr = JSON.stringify(failedStep.params);

      // Look for {{stepX}} references
      const matches = paramsStr.match(/\{\{step(\d+)[\}\.]|step(\w+)[\}\.]/g);

      if (matches && matches.length > 0) {
        // Extract step ID from first match
        const match = matches[0].match(/step(\w+)/);
        if (match) {
          return `step${match[1]}`;
        }
      }
    }

    return null;
  }

  /**
   * Detect parameter/configuration errors from error messages
   * Extracts the parameter name and problematic value
   *
   * Generic pattern matching - no hardcoded parameter names
   *
   * IMPORTANT: This detects CONFIGURATION errors including:
   * - Wrong range names (Range 'X' not found)
   * - Wrong IDs with permission issues (Permission denied for spreadsheet 'Y')
   * Both indicate incorrect user configuration that needs fixing
   */
  private detectParameterError(errorMessage: string, stepParams?: any): {
    parameterName: string;
    problematicValue: string;
    expectedFormat?: string;
  } | null {
    const errorMsgLower = errorMessage.toLowerCase();

    // Pattern 1: "X not found" or "Unable to parse X: value"
    // Examples:
    // - "Range 'UrgentEmails' not found"
    // - "Unable to parse range: UrgentEmails"
    // - "Column 'Status' not found"
    // - "Spreadsheet 'ABC' not found"

    // Try to match: "ParamName 'value' not found" or "ParamName: value"
    const paramErrorPatterns = [
      // Pattern: "unable to parse X: value"
      /unable to parse\s+(\w+)[:\s]+['"]?([^'"]+)['"]?/i,

      // Pattern: "X 'value' not found" or "X: 'value' not found"
      /(\w+)[:\s]+['"]([^'"]+)['"]\s+not found/i,

      // Pattern: "X not found: value" or "X 'value' not found"
      /(\w+)\s+['"]([^'"]+)['"]\s+not found/i,
    ];

    for (const pattern of paramErrorPatterns) {
      const match = errorMessage.match(pattern);
      if (match) {
        const paramName = match[1].toLowerCase();
        const problematicValue = match[2].trim();

        // Skip if it's a system term (not a user parameter)
        if (['step', 'variable', 'function', 'method', 'class'].includes(paramName)) {
          continue;
        }

        return {
          parameterName: paramName,
          problematicValue,
          expectedFormat: this.getExpectedFormat(paramName)
        };
      }
    }

    // Pattern 2: Generic quoted value errors
    // "Some error about 'problematic_value'"
    // ONLY match if error contains configuration-related keywords
    const configKeywords = ['not found', 'invalid', 'does not exist', 'cannot find', 'permission denied', 'cannot edit', 'access denied'];
    const hasConfigKeyword = configKeywords.some(keyword => errorMsgLower.includes(keyword));

    if (hasConfigKeyword) {
      // Extract ALL quoted values, then filter out common English words
      // This prevents matching "doesn" from "doesn't exist" or "can" from "can't"
      const quotedMatches: RegExpExecArray[] = [];
      const regex = /["']([^"']{2,})["']/g;
      let match;
      while ((match = regex.exec(errorMessage)) !== null) {
        quotedMatches.push(match);
      }

      if (quotedMatches.length > 0) {
        // Filter out common English words/fragments that aren't parameter values
        const commonWords = ['doesn', 't', 's', 'can', 'cannot', 'does', 'not', 'is', 'are', 'was', 'were', 'have', 'has', 'had', 'will', 'would', 'should', 'could', 'the', 'and', 'or'];
        const validMatches = quotedMatches.filter(match => {
          const value = match[1].trim().toLowerCase();
          // Keep values that are NOT common words and are longer than 1 char
          return !commonWords.includes(value) && value.length > 1;
        });

        if (validMatches.length > 0 && !errorMsgLower.includes('step') && !errorMsgLower.includes('variable')) {
          const problematicValue = validMatches[0][1].trim();

          // Try to find the parameter name from step config
          // This works for ANY plugin - no hardcoding
          let paramName = 'value';

          if (stepParams && typeof stepParams === 'object') {
            // Search through step params to find which one contains this value
            // Support multiple matching strategies for flexibility
            for (const [key, value] of Object.entries(stepParams)) {
              // Strategy 1: Exact match
              if (value === problematicValue) {
                paramName = key;
                break;
              }

              // Strategy 2: String contains (for values embedded in larger strings)
              if (typeof value === 'string' && typeof problematicValue === 'string') {
                if (value.includes(problematicValue) || problematicValue.includes(value)) {
                  paramName = key;
                  break;
                }
              }

              // Strategy 3: Check nested object values (for complex params)
              if (value && typeof value === 'object' && !Array.isArray(value)) {
                const nestedMatch = Object.values(value).some(
                  nestedVal => nestedVal === problematicValue
                );
                if (nestedMatch) {
                  paramName = key;
                  break;
                }
              }
            }
          }

          return {
            parameterName: paramName,
            problematicValue,
            expectedFormat: this.getExpectedFormat(paramName)
          };
        }
      }
    }

    return null;
  }

  /**
   * Recursively find a step in the workflow by ID
   * Handles nested steps (parallel, scatter-gather, loop, etc.)
   */
  private findStepInWorkflow(steps: any[], targetStepId: string): any {
    for (const step of steps) {
      // Check if this is the step we're looking for
      if (step.id === targetStepId) {
        return step;
      }

      // Check nested steps in parallel groups
      if (step.type === 'parallel' && step.steps) {
        const found = this.findStepInWorkflow(step.steps, targetStepId);
        if (found) return found;
      }

      // Check nested steps in scatter-gather
      if (step.type === 'scatter_gather' && step.scatter?.steps) {
        const found = this.findStepInWorkflow(step.scatter.steps, targetStepId);
        if (found) return found;
      }

      // Check nested steps in loops
      if (step.type === 'loop' && step.loopSteps) {
        const found = this.findStepInWorkflow(step.loopSteps, targetStepId);
        if (found) return found;
      }

      // Check nested steps in sub-workflows
      if (step.type === 'sub_workflow' && step.steps) {
        const found = this.findStepInWorkflow(step.steps, targetStepId);
        if (found) return found;
      }
    }

    return null;
  }

  /**
   * Get expected format hint based on parameter name
   * Provides user-friendly guidance for common parameter types
   */
  private getExpectedFormat(paramName: string): string {
    // Common patterns - not exhaustive, just helpful hints
    const formatHints: Record<string, string> = {
      'range': 'e.g., Sheet1!A1:B10 or NamedRange1',
      'spreadsheet': 'Google Sheets ID',
      'spreadsheet_id': 'Google Sheets ID',
      'column': 'Exact column name from your data',
      'field': 'Exact field name',
      'file': 'Valid file ID',
      'file_id': 'Valid file ID',
      'folder': 'Valid folder ID',
      'folder_id': 'Valid folder ID',
      'email': 'Valid email address',
      'url': 'Valid URL',
    };

    return formatHints[paramName] || `Valid ${paramName} value`;
  }

  /**
   * Resolve parameter references like {{input.X}} and {{step.Y}} to actual values.
   * This is needed for dependent dropdowns when parameters have been parameterized.
   *
   * Example:
   * Input: { spreadsheet_id: "{{input.spreadsheet_id}}", range: "Invoices" }
   * Output: { spreadsheet_id: "1RHL...actual-id", range: "Invoices" }
   *
   * @param params - Raw parameter values from step config (may contain {{templates}})
   * @param context - Execution context with input values and step outputs
   * @returns Object with resolved parameter values
   */
  private resolveParameterReferences(
    params: Record<string, any>,
    context: import('../types').ExecutionContext
  ): Record<string, any> {
    const resolved: Record<string, any> = {};

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && value.includes('{{')) {
        // Extract variable reference: {{input.X}} or {{stepN.Y}}
        const match = value.match(/\{\{(input|step\d+)\.([^}]+)\}\}/);

        if (match) {
          const [, source, fieldName] = match;

          if (source === 'input') {
            // Resolve from user inputs provided during calibration
            const resolvedValue = context.inputValues?.[fieldName];
            if (resolvedValue !== undefined) {
              resolved[key] = resolvedValue;
              logger.debug({
                key,
                template: value,
                resolved: resolvedValue
              }, 'Resolved input parameter reference');
            } else {
              // Can't resolve - keep original template
              resolved[key] = value;
              logger.warn({
                key,
                template: value,
                fieldName
              }, 'Could not resolve input parameter reference - user input not found');
            }
          } else if (source.startsWith('step')) {
            // Resolve from completed step outputs
            const stepOutput = context.stepOutputs?.get(source);
            const resolvedValue = stepOutput?.data?.[fieldName];
            if (resolvedValue !== undefined) {
              resolved[key] = resolvedValue;
              logger.debug({
                key,
                template: value,
                source,
                fieldName,
                resolved: resolvedValue
              }, 'Resolved step output parameter reference');
            } else {
              // Can't resolve - keep original template
              resolved[key] = value;
              logger.warn({
                key,
                template: value,
                source,
                fieldName
              }, 'Could not resolve step parameter reference - step output not found');
            }
          } else {
            // Unknown source, keep original
            resolved[key] = value;
          }
        } else {
          // Contains {{ but not a valid template format
          resolved[key] = value;
        }
      } else {
        // Not a string or doesn't contain template markers
        resolved[key] = value;
      }
    }

    return resolved;
  }
}
