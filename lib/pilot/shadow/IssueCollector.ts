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
    const stepParams = (step as any)?.params || (step as any)?.config;

    // Debug logging to help troubleshoot parameter detection
    if (!stepParams) {
      logger.warn({ stepId, stepFound: !!step }, 'No step params found for parameter error detection');
    }

    // Check if this is a missing workflow config issue BEFORE checking parameter errors
    const missingConfigRef = this.detectMissingWorkflowConfig(error.message, stepParams, context);

    // Debug logging for missing config detection
    logger.info({
      stepId,
      errorMessage: error.message,
      stepParams: JSON.stringify(stepParams),
      missingConfigDetected: !!missingConfigRef,
      configKeys: missingConfigRef?.configKeys,
      workflowConfigKeys: Object.keys(context.workflowConfig || {}),
      workflowConfigValues: context.workflowConfig
    }, 'Missing config detection result');

    const parameterError = !missingConfigRef ? this.detectParameterError(error.message, stepParams) : null;

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

    // Handle missing workflow config ({{config.X}} references that couldn't be resolved)
    if (missingConfigRef) {
      finalCategory = 'configuration_missing';
      severity = 'high';
      suggestedFix = {
        type: 'configuration_required' as any,
        action: {
          configKeys: missingConfigRef.configKeys,
          affectedParameters: missingConfigRef.affectedParameters,
          message: `Workflow requires configuration values: ${missingConfigRef.configKeys.join(', ')}`
        },
        confidence: 1.0
      };

      logger.info({
        configKeys: missingConfigRef.configKeys,
        affectedParameters: missingConfigRef.affectedParameters,
        stepId
      }, 'Missing workflow configuration detected');
    }

    // Check if auto-repair is available (for data shape mismatches)
    let autoRepairProposal = null;
    let autoRepairAvailable = false;

    if (classification.category === 'data_shape_mismatch') {
      // Find the upstream step that produced the mismatched data
      const upstreamStepId = this.detectUpstreamStepId(stepId, context);

      // Get all step outputs using public API
      const allStepOutputs = context.getAllStepOutputs();

      logger.info({
        stepId,
        upstreamStepId,
        hasUpstream: !!upstreamStepId,
        availableOutputs: Array.from(allStepOutputs.keys())
      }, 'DEBUG: Detecting upstream for data_shape_mismatch repair');

      if (upstreamStepId) {
        const upstreamOutput = context.getStepOutput(upstreamStepId);

        logger.info({
          stepId,
          upstreamStepId,
          hasOutput: !!upstreamOutput,
          outputData: upstreamOutput ? Object.keys(upstreamOutput.data || {}) : []
        }, 'DEBUG: Found upstream output for repair');

        if (upstreamOutput) {
          autoRepairProposal = this.repairEngine.proposeRepair(
            classification,
            stepId,
            upstreamStepId,
            upstreamOutput,
            step  // Pass the failed step definition for context
          );

          logger.info({
            stepId,
            upstreamStepId,
            proposalAction: autoRepairProposal?.action,
            extractField: autoRepairProposal?.extractField,
            confidence: autoRepairProposal?.confidence,
            stepDescription: step?.description,
            stepConfig: step?.config
          }, 'DEBUG: RepairEngine proposal generated');

          autoRepairAvailable = autoRepairProposal?.action !== 'none';
        } else {
          logger.warn({ stepId, upstreamStepId }, 'DEBUG: No upstream output found in stepOutputs map');
        }
      } else {
        logger.warn({ stepId, completedSteps: context.completedSteps }, 'DEBUG: Could not detect upstream step ID');
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
   * Detect workflow generation bugs by analyzing structure and execution results
   * Called after batch calibration run finishes
   *
   * Detects:
   * 1. Flatten operations missing field parameter (returns wrong data structure)
   * 2. Filter operations using wrong field names (field doesn't exist in data)
   * 3. Parameter references using wrong field names (mismatch with step output schema)
   * 4. Data structure mismatches between connected steps
   *
   * This is what calibration is FOR - catching workflow generation bugs that prevent execution
   */
  collectWorkflowStructureIssues(
    agent: Agent,
    context: ExecutionContext
  ): CollectedIssue[] {
    logger.debug({ agentId: agent.id }, 'Analyzing workflow structure for generation bugs');

    const pilotSteps = agent.pilot_steps || agent.workflow_steps || [];

    if (pilotSteps.length === 0) {
      return [];
    }

    const issues: CollectedIssue[] = [];
    const allSteps = this.flattenSteps(pilotSteps);

    // Get all step outputs for analysis
    const allStepOutputs = context.getAllStepOutputs();

    for (const step of allSteps) {
      const stepId = step.step_id || step.id || 'unknown';

      // Issue 1: Flatten operation missing field parameter
      if (step.type === 'transform' && (step as any).operation === 'flatten') {
        const config = (step as any).config || {};
        const input = (step as any).input;

        // Check if field parameter is missing
        if (!config.field) {
          // Get the step output to verify the bug
          const stepOutput = allStepOutputs.get(stepId);

          if (stepOutput && stepOutput.metadata.success) {
            // Analyze the output structure to determine what field should have been used
            const outputData = stepOutput.data;

            // Check if description mentions extracting a specific field
            const description = step.description || step.name || '';
            const extractFieldMatch = description.match(/extract|flatten|get\s+(\w+)/i);
            const suggestedField = extractFieldMatch ? extractFieldMatch[1] : null;

            // Check if output is an array of objects with nested arrays
            let detectedNestedArrayField: string | null = null;
            if (Array.isArray(outputData) && outputData.length > 0 && typeof outputData[0] === 'object') {
              // Look for array fields in the first object
              for (const [key, value] of Object.entries(outputData[0])) {
                if (Array.isArray(value)) {
                  detectedNestedArrayField = key;
                  break;
                }
              }
            }

            const fieldToExtract = suggestedField || detectedNestedArrayField || 'items';
            const hasHighConfidence = !!(suggestedField || detectedNestedArrayField);

            issues.push({
              id: crypto.randomUUID(),
              category: 'logic_error',
              severity: 'critical',
              affectedSteps: [{
                stepId,
                stepName: step.name || 'Flatten operation',
                friendlyName: this.getStepName(agent, stepId)
              }],
              title: 'Flatten operation missing field parameter',
              message: `This flatten operation is missing the 'field' parameter that specifies which nested array to extract. ${suggestedField ? `Based on the step description, it should extract the '${suggestedField}' field.` : detectedNestedArrayField ? `The data contains a nested '${detectedNestedArrayField}' array that should be extracted.` : 'Without this parameter, the flatten operation returns the input data unchanged.'}`,
              technicalDetails: `Step ${stepId} has operation: "flatten" but config.field is missing. ${input ? `Input: ${input}. ` : ''}${suggestedField ? `Suggested field from description: '${suggestedField}'. ` : ''}${detectedNestedArrayField ? `Detected nested array field: '${detectedNestedArrayField}'.` : ''}`,
              suggestedFix: {
                type: 'workflow_structure' as const,
                action: {
                  changeType: 'add_flatten_field',
                  stepId,
                  field: fieldToExtract,
                  description: `Add field parameter to extract nested array: config.field = "${fieldToExtract}"`
                },
                confidence: hasHighConfidence ? 0.9 : 0.7
              },
              autoRepairAvailable: hasHighConfidence,
              autoRepairProposal: hasHighConfidence ? {
                action: 'add_flatten_field',
                description: `Add config.field = "${fieldToExtract}" to extract nested ${fieldToExtract} array`,
                confidence: 0.9,
                targetStepId: stepId,
                risk: 'low' as const
              } : undefined,
              requiresUserInput: !hasHighConfidence,
              estimatedImpact: 'high'
            });
          }
        }
      }

      // Issue 2: Filter operation using wrong field name
      if (step.type === 'transform' && (step as any).operation === 'filter') {
        const config = (step as any).config || {};
        const condition = config.condition || config.filter_expression;
        const input = (step as any).input;

        if (condition && typeof condition === 'object') {
          const field = condition.field;

          if (field && input) {
            // Try to resolve the input to find the actual step that provides the data
            const inputMatch = input.match(/\{\{(step\w+|\w+)\}\}/);
            if (inputMatch) {
              const sourceStepId = inputMatch[1];
              const sourceOutput = allStepOutputs.get(sourceStepId);

              if (sourceOutput && sourceOutput.data) {
                // Check if the field exists in the source data
                const dataArray = Array.isArray(sourceOutput.data) ? sourceOutput.data : [sourceOutput.data];

                if (dataArray.length > 0) {
                  const firstItem = dataArray[0];
                  const availableFields = typeof firstItem === 'object' ? Object.keys(firstItem) : [];

                  // Check if field exists (case-sensitive and case-insensitive)
                  const fieldExists = availableFields.some(f => f === field);
                  const similarField = availableFields.find(f => f.toLowerCase() === field.toLowerCase());

                  if (!fieldExists) {
                    issues.push({
                      id: crypto.randomUUID(),
                      category: 'logic_error',
                      severity: 'critical',
                      affectedSteps: [{
                        stepId,
                        stepName: step.name || 'Filter operation',
                        friendlyName: this.getStepName(agent, stepId)
                      }],
                      title: `Filter using non-existent field: ${field}`,
                      message: `This filter tries to filter by field '${field}' but the data doesn't have that field. ${similarField ? `The data has '${similarField}' instead (note the different naming convention).` : `Available fields: ${availableFields.join(', ')}`}`,
                      technicalDetails: `Step ${stepId} filters by '${field}' but source step ${sourceStepId} data has fields: ${availableFields.join(', ')}`,
                      suggestedFix: similarField ? {
                        type: 'workflow_structure' as const,
                        action: {
                          changeType: 'fix_field_name',
                          stepId,
                          from: field,
                          to: similarField,
                          description: `Change field name from '${field}' to '${similarField}' to match data schema`
                        },
                        confidence: 0.95
                      } : undefined,
                      autoRepairAvailable: !!similarField,
                      autoRepairProposal: similarField ? {
                        action: 'fix_field_name',
                        description: `Change filter field from '${field}' to '${similarField}'`,
                        confidence: 0.95,
                        targetStepId: stepId,
                        risk: 'low' as const
                      } : undefined,
                      requiresUserInput: !similarField,
                      estimatedImpact: 'high'
                    });
                  }
                }
              }
            }
          }
        }
      }

      // Issue 3: Parameter reference using wrong field name
      if (step.type === 'action') {
        const config = (step as any).config || (step as any).params || {};

        // Recursively check all parameter values for variable references
        const checkParameterRefs = (obj: any, paramPath: string = '') => {
          if (typeof obj === 'string') {
            // Look for {{stepX.fieldName}} patterns
            const varMatch = obj.match(/\{\{(step\w+)\.(\w+)\}\}/);
            if (varMatch) {
              const sourceStepId = varMatch[1];
              const fieldName = varMatch[2];
              const sourceOutput = allStepOutputs.get(sourceStepId);

              if (sourceOutput && sourceOutput.data) {
                // Check if field exists in source output
                const data = sourceOutput.data;
                const availableFields = typeof data === 'object' && data !== null ? Object.keys(data) : [];

                // Check if field exists (case-sensitive)
                const fieldExists = availableFields.includes(fieldName);
                const similarField = availableFields.find(f => f.toLowerCase() === fieldName.toLowerCase());

                if (!fieldExists && availableFields.length > 0) {
                  const currentParamName = paramPath || 'parameter';

                  issues.push({
                    id: crypto.randomUUID(),
                    category: 'logic_error',
                    severity: 'critical',
                    affectedSteps: [{
                      stepId,
                      stepName: step.name || 'Action step',
                      friendlyName: this.getStepName(agent, stepId)
                    }],
                    title: `Parameter references non-existent field: ${fieldName}`,
                    message: `The ${currentParamName} parameter references {{${sourceStepId}.${fieldName}}} but step ${sourceStepId} doesn't output that field. ${similarField ? `It outputs '${similarField}' instead (note the different naming convention).` : `Available fields: ${availableFields.join(', ')}`}`,
                    technicalDetails: `Step ${stepId} ${currentParamName} uses {{${sourceStepId}.${fieldName}}} but source step outputs: ${availableFields.join(', ')}`,
                    suggestedFix: similarField ? {
                      type: 'workflow_structure' as const,
                      action: {
                        changeType: 'fix_parameter_reference',
                        stepId,
                        parameter: currentParamName,
                        from: `{{${sourceStepId}.${fieldName}}}`,
                        to: `{{${sourceStepId}.${similarField}}}`,
                        description: `Change parameter reference from '${fieldName}' to '${similarField}'`
                      },
                      confidence: 0.95
                    } : undefined,
                    autoRepairAvailable: !!similarField,
                    autoRepairProposal: similarField ? {
                      action: 'fix_parameter_reference',
                      description: `Change {{${sourceStepId}.${fieldName}}} to {{${sourceStepId}.${similarField}}}`,
                      confidence: 0.95,
                      targetStepId: stepId,
                      risk: 'low' as const
                    } : undefined,
                    requiresUserInput: !similarField,
                    estimatedImpact: 'high'
                  });
                }
              }
            }
          } else if (typeof obj === 'object' && obj !== null) {
            for (const [key, value] of Object.entries(obj)) {
              checkParameterRefs(value, key);
            }
          } else if (Array.isArray(obj)) {
            obj.forEach((item, idx) => checkParameterRefs(item, `${paramPath}[${idx}]`));
          }
        };

        checkParameterRefs(config);
      }
    }

    logger.info({
      agentId: agent.id,
      issuesFound: issues.length,
      issueTypes: issues.map(i => i.title)
    }, 'Workflow structure analysis completed');

    return issues;
  }

  /**
   * Detect filter operations with missing filter_expression or using wrong operation type
   * Called after batch calibration run finishes
   *
   * Detects:
   * 1. Transform steps with type="filter" but missing filter_expression
   * 2. Transform steps with operation="set" but having condition config (should be filter)
   * 3. Transform steps filtering arrays but using wrong operation type
   */
  collectFilterOperationIssues(
    agent: Agent
  ): CollectedIssue[] {
    logger.debug({ agentId: agent.id }, 'Detecting filter operation issues in workflow');

    const pilotSteps = agent.pilot_steps || agent.workflow_steps || [];

    if (pilotSteps.length === 0) {
      return [];
    }

    const issues: CollectedIssue[] = [];

    // Recursively search all steps (including nested in conditionals, loops, etc.)
    const allSteps = this.flattenSteps(pilotSteps);

    for (const step of allSteps) {
      // Check transform steps
      if (step.type === 'transform') {
        const operation = (step as any).operation;
        const config = (step as any).config;
        const input = (step as any).input;

        // Issue 1: operation="set" but has condition config (should be filter)
        if (operation === 'set' && config?.condition) {
          issues.push({
            id: crypto.randomUUID(),
            category: 'logic_error',
            severity: 'critical',
            affectedSteps: [{
              stepId: step.step_id || step.id || 'unknown',
              stepName: step.name || 'Transform',
              friendlyName: this.getStepName(agent, step.step_id || step.id || '')
            }],
            title: 'Filter operation using wrong operation type',
            message: `This step should filter data but is using operation "set" which passes all data through without filtering. The condition config is being ignored.`,
            technicalDetails: `Step has operation: "set" with condition config. The "set" operation does not apply conditions - it should be changed to operation: "filter" to actually filter the data.`,
            suggestedFix: {
              type: 'workflow_structure' as const,
              action: {
                changeType: 'fix_filter_operation',
                stepId: step.step_id || step.id || '',
                from: { operation: 'set' },
                to: { operation: 'filter' },
                description: 'Change transform operation from "set" to "filter" to apply the condition logic'
              },
              confidence: 0.95
            },
            autoRepairAvailable: true,
            autoRepairProposal: {
              action: 'fix_filter_operation',
              description: 'Change operation from "set" to "filter" to enable condition filtering',
              confidence: 0.95,
              targetStepId: step.step_id || step.id || '',
              risk: 'low' as const
            },
            requiresUserInput: false,
            estimatedImpact: 'high'
          });
        }

        // Issue 2: operation="filter" but missing filter_expression
        if (operation === 'filter' && !config?.filter_expression && !config?.condition) {
          issues.push({
            id: crypto.randomUUID(),
            category: 'logic_error',
            severity: 'critical',
            affectedSteps: [{
              stepId: step.step_id || step.id || 'unknown',
              stepName: step.name || 'Transform',
              friendlyName: this.getStepName(agent, step.step_id || step.id || '')
            }],
            title: 'Filter operation missing filter logic',
            message: `This filter operation is missing the filter_expression that defines what data to keep. All data will be filtered out.`,
            technicalDetails: `Step has operation: "filter" but no filter_expression or condition in config. Filter operations require condition logic to determine which items to keep.`,
            suggestedFix: {
              type: 'workflow_structure' as const,
              action: {
                changeType: 'add_filter_expression',
                stepId: step.step_id || step.id || '',
                description: 'Add filter_expression or condition to define filtering logic'
              },
              confidence: 0.9
            },
            autoRepairAvailable: false,
            requiresUserInput: true,
            estimatedImpact: 'high'
          });
        }
      }
    }

    logger.info({
      agentId: agent.id,
      issuesFound: issues.length
    }, 'Filter operation detection completed');

    return issues;
  }

  /**
   * Flatten nested workflow steps for analysis
   * Handles conditionals, loops, parallel, scatter-gather, etc.
   */
  private flattenSteps(steps: any[]): any[] {
    const flattened: any[] = [];

    for (const step of steps) {
      flattened.push(step);

      // Recursively flatten nested steps
      if (step.type === 'conditional') {
        if (step.then_steps) flattened.push(...this.flattenSteps(step.then_steps));
        if (step.else_steps) flattened.push(...this.flattenSteps(step.else_steps));
        if (step.then && Array.isArray(step.then)) flattened.push(...this.flattenSteps(step.then));
        if (step.else && Array.isArray(step.else)) flattened.push(...this.flattenSteps(step.else));
      } else if (step.type === 'loop' && step.steps) {
        flattened.push(...this.flattenSteps(step.steps));
      } else if (step.type === 'parallel' && step.branches) {
        for (const branch of step.branches) {
          if (branch.steps) flattened.push(...this.flattenSteps(branch.steps));
        }
      } else if (step.type === 'scatter_gather' && step.scatter?.steps) {
        flattened.push(...this.flattenSteps(step.scatter.steps));
      }
    }

    return flattened;
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

    // Check for variable references in top-level input field (most common for transform steps)
    if ('input' in failedStep && typeof failedStep.input === 'string') {
      // Look for {{variable}} or {{stepX}} references
      const matches = failedStep.input.match(/\{\{(step\d+|step\w+|[a-zA-Z_][a-zA-Z0-9_]*)[\}\.]*/g);

      if (matches && matches.length > 0) {
        // Extract variable name from first match
        const match = matches[0].match(/\{\{(step\d+|step\w+|[a-zA-Z_][a-zA-Z0-9_]*)/);
        if (match) {
          const variableName = match[1];

          // If it's a stepX reference, return it directly
          if (variableName.startsWith('step')) {
            return variableName;
          }

          // Otherwise, find the step that outputs this variable
          for (const step of steps) {
            if ('output_variable' in step && step.output_variable === variableName) {
              return step.id;
            }
            // Also check outputVariable (camelCase)
            if ('outputVariable' in step && (step as any).outputVariable === variableName) {
              return step.id;
            }
          }

          // If no match found, try to find by comparing step IDs
          // (sometimes the variable name is derived from step ID)
          const stepIdPattern = new RegExp(`^${variableName}`, 'i');
          const matchingStep = steps.find(s => stepIdPattern.test(s.id));
          if (matchingStep && matchingStep.id !== failedStepId) {
            return matchingStep.id;
          }
        }
      }
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

    // Check for variable references in transform step config (filter, map, etc.)
    if ('config' in failedStep && failedStep.config && typeof failedStep.config === 'object') {
      const configStr = JSON.stringify(failedStep.config);

      // Look for {{stepX}} or {{variable}} references
      const matches = configStr.match(/\{\{(step\d+|step\w+|[a-zA-Z_][a-zA-Z0-9_]*)[\}\.]*/g);

      if (matches && matches.length > 0) {
        // Extract variable name from first match
        const match = matches[0].match(/\{\{(step\d+|step\w+|[a-zA-Z_][a-zA-Z0-9_]*)/);
        if (match) {
          const variableName = match[1];

          // If it's a stepX reference, return it directly
          if (variableName.startsWith('step')) {
            return variableName;
          }

          // Otherwise, find the step that outputs this variable
          for (const step of steps) {
            if ('output_variable' in step && step.output_variable === variableName) {
              return step.id;
            }
            // Also check outputVariable (camelCase)
            if ('outputVariable' in step && (step as any).outputVariable === variableName) {
              return step.id;
            }
          }

          // If no match found, try to find by comparing step IDs
          // (sometimes the variable name is derived from step ID)
          const stepIdPattern = new RegExp(`^${variableName}`, 'i');
          const matchingStep = steps.find(s => stepIdPattern.test(s.id));
          if (matchingStep && matchingStep.id !== failedStepId) {
            return matchingStep.id;
          }
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
   * Detect if error is due to missing workflow configuration values ({{config.key}})
   * This detects when step parameters reference config values that are not populated
   */
  private detectMissingWorkflowConfig(
    errorMessage: string,
    stepParams: any,
    context: ExecutionContext
  ): { configKeys: string[], affectedParameters: string[] } | null {
    if (!stepParams) {
      return null;
    }

    const configKeys: Set<string> = new Set();
    const affectedParameters: Set<string> = new Set();

    // Recursively scan for {{config.X}} patterns in step parameters
    const scanForConfigRefs = (obj: any, path: string = '') => {
      if (typeof obj === 'string') {
        // Look for {{config.key}} patterns
        const configMatches = obj.matchAll(/\{\{config\.(\w+)\}\}/g);
        for (const match of configMatches) {
          const configKey = match[1];

          // Check if this config key exists and has a value
          const configValue = context.workflowConfig?.[configKey];

          if (configValue === undefined || configValue === null || configValue === '') {
            configKeys.add(configKey);
            affectedParameters.add(path || 'value');
          }
        }
      } else if (Array.isArray(obj)) {
        obj.forEach((item, index) => scanForConfigRefs(item, `${path}[${index}]`));
      } else if (obj && typeof obj === 'object') {
        Object.entries(obj).forEach(([key, value]) => {
          const newPath = path ? `${path}.${key}` : key;
          scanForConfigRefs(value, newPath);
        });
      }
    };

    scanForConfigRefs(stepParams);

    if (configKeys.size > 0) {
      return {
        configKeys: Array.from(configKeys),
        affectedParameters: Array.from(affectedParameters)
      };
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
