/**
 * StructuralRepairEngine — Pre-execution DSL structural auto-repair
 *
 * ⚠ DO NOT CONFUSE WITH `RepairEngine` (separate file in this dir).
 *   • `StructuralRepairEngine` (this file) — workflow-DEFINITION repair.
 *     Runs in `WorkflowPilot.execute()` BEFORE parsing/execution. Fixes compiler-emitted
 *     DSL defects (missing fields, broken refs, etc.). May persist the repaired
 *     `agent.pilot_steps` back to the database (gated by
 *     `pilot_structural_repair_persist_enabled`; see Phase 6 — Tier 3 Fix #12).
 *   • `RepairEngine` (sibling file) — per-failed-step DATA shape repair, used by
 *     `ResumeOrchestrator` for live in-memory data fixes during execution.
 *     Never modifies the agent definition.
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

// Loose alias used in cross-shape casts below. The structural union of every
// scatter_gather variant is too painful to express without a full overhaul of
// the WorkflowStep type, so we keep this permissive.
type ScatterGatherStep = any;

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
  | 'missing_required_parameter'   // Action missing required parameter
  | 'invalid_flatten_field'        // Flatten field doesn't exist in source schema
  | 'itemVariable_shadows_stepId'  // Scatter-gather itemVariable conflicts with step ID
  | 'gather_operation_mismatch';   // Gather operation doesn't match data type

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
  | 'add_missing_input_fields'     // Add missing fields to agent.input_schema
  | 'fix_flatten_field'            // Fix flatten field to match source schema
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
    // CRITICAL: Include BOTH step IDs AND output_variable names as valid variable references
    // This prevents false positives for references like {{sheet_read_result.values}}
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

      // Also add output_variable names as valid references
      // These are alternative names for step outputs (e.g., "sheet_read_result" instead of "step1")
      if (step.output_variable && typeof step.output_variable === 'string') {
        stepIds.add(step.output_variable);
      }

      // Also add outputKey from gather config (for scatter-gather steps)
      if (step.gather?.outputKey && typeof step.gather.outputKey === 'string') {
        stepIds.add(step.gather.outputKey);
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

        // Issue 4: gather.itemVariable shadows step ID
        if (step.gather?.itemVariable) {
          const itemVar = step.gather.itemVariable;
          const conflictingStepId = Array.from(stepIds).find(id => id === itemVar);

          if (conflictingStepId) {
            issues.push({
              type: 'itemVariable_shadows_stepId',
              stepId,
              description: `Scatter-gather gather.itemVariable "${itemVar}" conflicts with step ID "${conflictingStepId}". This causes variable shadowing and breaks variable resolution.`,
              severity: 'high',
              autoFixable: true
            });
          }
        }

        // Issue 5: gather.operation type mismatch
        if (step.gather?.operation === 'flatten') {
          // For flatten operation, we need nested arrays
          // This is a basic check - EnhancedSchemaValidator does deeper validation
          const scatterSteps = step.scatter?.steps || [];
          const hasOutputVariable = scatterSteps.some((s: any) => s.output_variable);

          if (!hasOutputVariable) {
            issues.push({
              type: 'gather_operation_mismatch',
              stepId,
              description: `Scatter-gather uses gather.operation='flatten' but scatter steps don't produce output variables. Flatten requires nested array structure.`,
              severity: 'medium',
              autoFixable: false
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
        // FIXED: Only create this issue if NOT a normalization case (prevents duplicate issues)
        else if (!step.action) {
          issues.push({
            type: 'missing_action',
            stepId,
            description: `Action step missing 'action' field (plugin: ${step.plugin || 'unknown'})`,
            severity: 'critical',
            autoFixable: step.plugin ? true : false // Can only fix if plugin is known
          });
        }
      }

      // Check transform steps for missing operation field
      if (step.type === 'transform') {
        // Transform steps require 'operation' field (e.g., map, filter, flatten)
        // Common issue: operation is in config.type instead of operation field
        if (!step.operation && step.config?.type) {
          logger.info({
            stepId,
            stepName: step.name,
            configType: step.config.type
          }, '[StructuralRepair] Transform step has config.type but missing operation field');

          issues.push({
            type: 'missing_action', // Reuse for normalization
            stepId,
            description: `Transform step uses legacy field name (config.type="${step.config.type}") - needs normalization to operation="${step.config.type}"`,
            severity: 'critical',
            autoFixable: true
          });
        } else if (!step.operation) {
          issues.push({
            type: 'missing_action', // Generic missing operation
            stepId,
            description: `Transform step missing 'operation' field (transform type: ${step.config?.type || 'unknown'})`,
            severity: 'critical',
            autoFixable: false
          });
        }

        // Check for missing input field on transform steps
        // Transform steps need an 'input' field to know what data to transform
        const hasInput = step.input || step.config?.input || step.params?.input;
        if (!hasInput) {
          // Try to infer input from dependencies or previous step
          const stepIndex = allSteps.findIndex(s => (s.step_id || s.id) === stepId);
          const previousStep = stepIndex > 0 ? allSteps[stepIndex - 1] : null;
          const suggestedInput = previousStep?.output_variable ||
            (previousStep?.step_id || previousStep?.id);

          issues.push({
            type: 'missing_input_declaration',
            stepId,
            description: `Transform step missing 'input' field - cannot determine what data to transform${suggestedInput ? `. Suggested: {{${suggestedInput}}}` : ''}`,
            severity: 'critical',
            autoFixable: !!suggestedInput
          });
        }
      }

      // Shared broken reference checks for both action and transform steps
      if (step.type === 'action' || step.type === 'transform') {

        const paramsStr = JSON.stringify(step.params || step.config || {});
        const brokenRefs = this.findBrokenVariableReferences(paramsStr, stepIds, stepId);
        for (const ref of brokenRefs) {
          issues.push({
            type: 'broken_variable_reference',
            stepId,
            description: `Step params reference non-existent variable: ${ref.variable}`,
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

          // DEBUG: Log step14 details
          if (stepId === 'step14') {
            logger.info({
              stepId,
              hasParams: !!step.params,
              hasConfig: !!step.config,
              paramsKeys: step.params ? Object.keys(step.params) : [],
              configKeys: step.config ? Object.keys(step.config) : [],
              missingParamsCount: missingParams.length
            }, '[StructuralRepair] DEBUG step14 structure during scanWorkflow');
          }

          if (missingParams.length > 0) {
            logger.info({
              stepId,
              stepName: step.name,
              plugin: step.plugin,
              action: step.action,
              missingParams: missingParams.map(p => ({ name: p.name, hasSmartDefault: p.hasSmartDefault }))
            }, '[StructuralRepair] Detected missing required parameters');

            // CRITICAL: Check if this is a data transformation case
            // (missing array parameter but alternative object format exists)
            const stepConfig = step.params || step.config || {};
            const providedParams = Object.keys(stepConfig);

            for (const param of missingParams) {
              // Check if missing param is an array type and we have a fields/mapping object
              const isArrayParam = param.schema?.type === 'array' &&
                (param.schema?.items?.type === 'array' || param.schema?.description?.toLowerCase().includes('2d array'));

              const hasFieldsMapping = providedParams.includes('fields') &&
                stepConfig.fields && typeof stepConfig.fields === 'object';

              if (isArrayParam && hasFieldsMapping) {
                // This is a data transformation issue - create auto-repair proposal
                logger.info({
                  stepId,
                  missingParam: param.name,
                  providedParam: 'fields',
                  message: 'Detected fields-to-array transformation needed'
                }, '[StructuralRepair] Creating auto-repair proposal for data transformation');

                issues.push({
                  type: 'missing_required_parameter',
                  stepId,
                  description: `Missing required parameter: ${param.name} (fields object provided, needs transformation to array)`,
                  severity: 'critical',
                  autoFixable: true  // ✅ Now auto-fixable with transformation
                });
              } else {
                // Standard missing parameter issue
                issues.push({
                  type: 'missing_required_parameter',
                  stepId,
                  description: `Missing required parameter: ${param.name}`,
                  severity: 'critical',
                  autoFixable: param.hasSmartDefault
                });
              }
            }
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

      // Check ALL steps for invalid {{config.X}} references (not just transform steps)
      // Serialize the entire step (condition, params, config, etc.) to check for config refs
      const stepStr = JSON.stringify(step);
      const configRefs = this.findConfigReferences(stepStr);

      if (configRefs.length > 0) {
        logger.info({
          stepId,
          stepName: step.name,
          stepType: step.type,
          configRefs,
          stepStr: stepStr.substring(0, 200) // First 200 chars for debugging
        }, '[StructuralRepair] Detected {{config.X}} references');

        issues.push({
          type: 'invalid_config_reference',
          stepId,
          description: `Uses {{config.X}} instead of {{input.X}}: ${configRefs.join(', ')}`,
          severity: 'critical', // Blocks execution
          autoFixable: true
        });
      }

      // Check ALL steps for invalid {{input.X}} references that don't exist in agent.input_schema
      const invalidInputRefs = this.findInvalidInputReferences(stepStr, agent);

      if (invalidInputRefs.length > 0) {
        logger.info({
          stepId,
          stepName: step.name,
          stepType: step.type,
          invalidInputRefs,
          stepStr: stepStr.substring(0, 200) // First 200 chars for debugging
        }, '[StructuralRepair] Detected invalid {{input.X}} references');

        issues.push({
          type: 'broken_variable_reference',
          stepId,
          description: `References non-existent input fields: ${invalidInputRefs.join(', ')}`,
          severity: 'critical', // Blocks execution
          autoFixable: true
        });
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

      // Check transform steps with flatten operation
      if (step.type === 'transform') {
        const operation = step.operation || step.config?.type || step.config?.operation;

        if (operation === 'flatten') {
          const field = step.config?.field;
          const input = step.input || step.config?.input;

          // Validate flatten field exists in source step's output schema
          if (field && input) {
            const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
            const varMatch = inputStr.match(/\{\{(\w+)(?:\.data)?(?:\.(\w+))?\}\}/);

            if (varMatch) {
              const varName = varMatch[1];
              // Find the step that produces this variable
              const sourceStep = allSteps.find(s =>
                (s.output_variable === varName || s.outputKey === varName)
              );

              if (sourceStep?.output_schema) {
                // CRITICAL: Check nesting level based on source schema type
                // If source returns {emails: [...]}, we should flatten "emails" (root level)
                // NOT "attachments" (nested inside emails[])

                // WP-32: When step.input navigates into a sub-field (e.g. "{{var.emails}}"),
                // the value flowing into transformFlatten is the sub-field's value (an array of items),
                // NOT the whole source output. In that case `config.field` is a per-item sub-field
                // extraction (e.g. "attachments" from each email), not a root-level array name.
                // Validate `field` against the array items' properties instead of the root keys.
                const subField = varMatch[2];

                if (
                  subField &&
                  sourceStep.output_schema.type === 'object' &&
                  sourceStep.output_schema.properties?.[subField]?.type === 'array'
                ) {
                  // Input navigates into a sub-array — per-item-nested flatten pattern.
                  const itemProps = sourceStep.output_schema.properties[subField].items?.properties;

                  if (itemProps && typeof itemProps === 'object') {
                    const perItemArrayFields = Object.keys(itemProps).filter(
                      key => itemProps[key]?.type === 'array'
                    );

                    if (perItemArrayFields.includes(field)) {
                      // Valid per-item-nested flatten — do NOT raise an issue.
                    } else if (perItemArrayFields.length > 0) {
                      logger.warn({
                        stepId,
                        field,
                        subField,
                        perItemArrayFields,
                        sourceStep: sourceStep.step_id || sourceStep.id,
                        schemaType: 'object-via-subfield'
                      }, '[StructuralRepair] Flatten field does not exist as per-item array sub-field');

                      issues.push({
                        type: 'invalid_flatten_field',
                        stepId,
                        description: `Flatten field "${field}" does not exist as a per-item array sub-field in ${sourceStep.step_id || sourceStep.id}.${subField}[]. Available per-item array fields: ${perItemArrayFields.join(', ')}. This will cause empty results.`,
                        severity: 'critical',
                        autoFixable: perItemArrayFields.length > 0
                      });
                    }
                    // else: sub-field items have no nested arrays — can't validate meaningfully; skip.
                  }
                  // else: sub-field has no items.properties — can't validate; skip.
                } else if (sourceStep.output_schema.type === 'object' && sourceStep.output_schema.properties) {
                  // Source returns an object and step.input does NOT navigate into a sub-array —
                  // flatten field must be at ROOT level.
                  const rootArrayFields = Object.keys(sourceStep.output_schema.properties).filter(
                    key => sourceStep.output_schema.properties[key].type === 'array'
                  );

                  // Check if the flatten field is a root-level array
                  if (!rootArrayFields.includes(field)) {
                    logger.warn({
                      stepId,
                      field,
                      rootArrayFields,
                      sourceStep: sourceStep.step_id || sourceStep.id,
                      schemaType: 'object'
                    }, '[StructuralRepair] Flatten field is not a root-level array in source schema');

                    issues.push({
                      type: 'invalid_flatten_field',
                      stepId,
                      description: `Flatten field "${field}" is not a root-level array in source step output. Available root-level array fields in ${sourceStep.step_id || sourceStep.id}: ${rootArrayFields.join(', ')}. This will cause empty results.`,
                      severity: 'critical',
                      autoFixable: rootArrayFields.length > 0 // Can fix if there are alternative fields
                    });
                  }
                } else if (sourceStep.output_schema.type === 'array') {
                  // Source returns an array directly - flatten field must be in array items
                  const arraySchema = this.findArraySchemaInOutput(sourceStep.output_schema, varMatch[2]);

                  if (arraySchema?.items?.properties) {
                    const availableFields = Object.keys(arraySchema.items.properties).filter(
                      key => arraySchema.items.properties[key].type === 'array'
                    );

                    // Check if the flatten field exists in the array item schema
                    if (!availableFields.includes(field)) {
                      logger.warn({
                        stepId,
                        field,
                        availableFields,
                        sourceStep: sourceStep.step_id || sourceStep.id,
                        schemaType: 'array'
                      }, '[StructuralRepair] Flatten field does not exist in array items schema');

                      issues.push({
                        type: 'invalid_flatten_field',
                        stepId,
                        description: `Flatten field "${field}" does not exist in array items. Available array fields in ${sourceStep.step_id || sourceStep.id}: ${availableFields.join(', ')}. This will cause empty results.`,
                        severity: 'critical',
                        autoFixable: availableFields.length > 0 // Can fix if there are alternative fields
                      });
                    }
                  }
                }
              }
            }
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
          // Support both old format (then/else) and new format (then_steps/else_steps)
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
          // CRITICAL FIX: Support generic 'steps' array (used by some conditional formats)
          // This catches nested steps that aren't in then/else branches
          if (step.steps && Array.isArray(step.steps)) {
            traverse(step.steps);
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
        // Check if it's an invalid {{input.X}} reference
        const inputMatch = issue.description.match(/References non-existent input fields: (.+)/);
        if (inputMatch) {
          // Parse the invalid input references (e.g., "{{input.digest_recipient}}")
          const invalidRefs = inputMatch[1].split(', ');

          // For each invalid reference, add the field to input_schema
          const fieldsToAdd: string[] = [];
          for (const ref of invalidRefs) {
            const fieldMatch = ref.match(/\{\{input\.([^}]+)\}\}/);
            if (fieldMatch) {
              fieldsToAdd.push(fieldMatch[1]);
            }
          }

          if (fieldsToAdd.length > 0) {
            return {
              action: 'add_missing_input_fields',
              description: `Add missing input fields to schema: ${fieldsToAdd.join(', ')}`,
              targetStepId: issue.stepId,
              confidence: 0.9,
              risk: 'low',
              fix: {
                fieldsToAdd
              }
            };
          }
        }

        // Original logic for step ID references
        const match = issue.description.match(/references non-existent variable: (\S+)/);
        if (!match) return noFix;

        const brokenVar = match[1];
        // Build valid variable names from step IDs, output_variable, and gather.outputKey
        const validVarNames = new Set<string>();
        for (const s of allSteps) {
          if (s.step_id) validVarNames.add(s.step_id);
          if (s.id) validVarNames.add(s.id);
          if (s.output_variable) validVarNames.add(s.output_variable);
          if (s.gather?.outputKey) validVarNames.add(s.gather.outputKey);
        }
        const suggestion = this.suggestVariableCorrection(brokenVar, validVarNames);

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
        if (issue.description.includes('legacy field name')) {
          // Different normalization rules for action vs transform steps
          if (step.type === 'transform') {
            // Transform steps: config.type → operation
            return {
              action: 'normalize_legacy_fields',
              description: `Normalize transform step: config.type="${step.config?.type}" → operation="${step.config?.type}"`,
              targetStepId: issue.stepId,
              confidence: 1.0,
              risk: 'low',
              fix: {
                normalizeTransformOperation: !step.operation && step.config?.type,
                transformOperationType: step.config?.type
              }
            };
          } else {
            // Action steps: operation → action, config → params
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
        }

        // CRITICAL: If step has 'operation' field (legacy), don't infer - it will be normalized
        // Prevents overwriting correct actions from operation field (e.g. upload_file)
        if (step.operation) {
          return {
            ...noFix,
            description: `Step has legacy 'operation' field which will be normalized to 'action'`
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

        if (!paramInfo) {
          return { ...noFix, description: `Cannot find parameter info for: ${paramName}` };
        }

        // CRITICAL: Check if this is a data transformation case
        // (fields object exists when array parameter is missing)
        const stepConfig = step.params || step.config || {};
        const providedParams = Object.keys(stepConfig);

        const isArrayParam = paramInfo.schema?.type === 'array' &&
          (paramInfo.schema?.items?.type === 'array' || paramInfo.schema?.description?.toLowerCase().includes('2d array'));

        const hasFieldsMapping = providedParams.includes('fields') &&
          stepConfig.fields && typeof stepConfig.fields === 'object';

        if (isArrayParam && hasFieldsMapping) {
          // This is a data transformation issue - propose transformation fix
          const fieldNames = Object.keys(stepConfig.fields);

          return {
            action: 'add_missing_parameter',
            description: `Transform fields object to ${paramName} array (fields: ${fieldNames.join(', ')})`,
            targetStepId: issue.stepId,
            confidence: 0.92,
            risk: 'low',
            fix: {
              paramName,
              transformationType: 'fields_to_array',
              sourceParam: 'fields',
              fieldMapping: stepConfig.fields
            }
          };
        }

        // Standard case: generate smart default
        if (!paramInfo.hasSmartDefault) {
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

      case 'invalid_flatten_field': {
        // Extract available fields from description (WP-32: also recognize per-item array fields wording)
        const match = issue.description.match(/Available (?:root-level |per-item )?array fields(?: in \S+| (?:in \S+))?: (.+)\. This will cause empty results/);
        if (!match) return noFix;

        const availableFields = match[1].split(', ');
        if (availableFields.length === 0) {
          return { ...noFix, description: 'No array fields available to flatten' };
        }

        // Choose the best field to flatten with root-level priority:
        // For root-level arrays (from object schema):
        //   1. Prefer "emails" (common for Gmail/email plugins)
        //   2. Then "items" (common generic pattern)
        //   3. Then "files", "results", "data", "records", "rows"
        // For nested arrays (from array items, or per-item sub-arrays — WP-32):
        //   1. Prefer "attachments" (common pattern)
        //   2. Then other array fields

        let bestField = availableFields[0];
        const rootPriority = ['emails', 'items', 'files', 'results', 'data', 'records', 'rows'];
        const nestedPriority = ['attachments', 'items', 'files', 'results', 'data'];

        // Check if this is root-level (from description pattern)
        // WP-32: per-item flatten uses nested priority (attachments-first)
        const isRootLevel = issue.description.includes('root-level');
        const priorityList = isRootLevel ? rootPriority : nestedPriority;

        for (const priority of priorityList) {
          if (availableFields.includes(priority)) {
            bestField = priority;
            break;
          }
        }

        return {
          action: 'fix_flatten_field',
          description: `Fix flatten field to "${bestField}" (available: ${availableFields.join(', ')})`,
          targetStepId: issue.stepId,
          confidence: priorityList.includes(bestField) ? 0.9 : 0.7,
          risk: 'low',
          fix: {
            newField: bestField,
            availableFields
          }
        };
      }

      case 'missing_input_declaration': {
        // Extract suggested input from description if available
        const suggestedMatch = issue.description.match(/Suggested: \{\{([^}]+)\}\}/);
        const suggestedInput = suggestedMatch ? suggestedMatch[1] : null;

        if (!suggestedInput) {
          return { ...noFix, description: 'Cannot determine input for transform step - no previous step found' };
        }

        return {
          action: 'infer_inputs',
          description: `Add input field "{{${suggestedInput}}}" to transform step`,
          targetStepId: issue.stepId,
          confidence: 0.85,
          risk: 'low',
          fix: {
            input: `{{${suggestedInput}}}`
          }
        };
      }

      case 'itemVariable_shadows_stepId': {
        // Extract itemVariable name from description
        const match = issue.description.match(/gather\.itemVariable "([^"]+)" conflicts/);
        if (!match) return noFix;

        const itemVar = match[1];
        const newItemVar = `${itemVar}_item`;

        return {
          action: 'add_output_variable', // Reuse this action type for simplicity
          description: `Rename gather.itemVariable from "${itemVar}" to "${newItemVar}" to avoid shadowing`,
          targetStepId: issue.stepId,
          confidence: 1.0,
          risk: 'low',
          fix: {
            itemVariable: newItemVar,
            oldItemVariable: itemVar
          }
        };
      }

      case 'gather_operation_mismatch': {
        // This is typically a workflow logic error that requires regeneration
        // But we can suggest changing to 'collect' as a safe default
        return {
          action: 'none',
          description: `gather.operation='flatten' may not match data structure. Consider regenerating workflow or changing to 'collect'.`,
          targetStepId: issue.stepId,
          confidence: 0,
          risk: 'high'
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
        // CRITICAL FIX: Support generic 'steps' array (used by some conditional formats)
        if (step.steps && Array.isArray(step.steps)) {
          const found = this.findStepRecursive(step.steps, targetStepId);
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
          // Handle output_variable fix
          if (proposal.fix.output_variable) {
            step.output_variable = proposal.fix.output_variable;

            logger.info({
              stepId: proposal.targetStepId,
              outputVariable: proposal.fix.output_variable
            }, '[StructuralRepair] Added output_variable to scatter-gather step');
          }

          // Handle itemVariable rename fix
          if (proposal.fix.itemVariable) {
            if (!step.gather) {
              step.gather = {};
            }
            step.gather.itemVariable = proposal.fix.itemVariable;

            logger.info({
              stepId: proposal.targetStepId,
              oldItemVariable: proposal.fix.oldItemVariable,
              newItemVariable: proposal.fix.itemVariable
            }, '[StructuralRepair] Renamed gather.itemVariable to avoid shadowing');
          }

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
          // Transform step normalization: config.type → operation
          if (proposal.fix.normalizeTransformOperation && step.type === 'transform') {
            const operationType = proposal.fix.transformOperationType || step.config?.type;
            if (operationType) {
              step.operation = operationType;
              // Don't delete config.type - just add operation field
              logger.info({
                stepId: proposal.targetStepId,
                operation: step.operation,
                configType: step.config?.type
              }, '[StructuralRepair] Normalized transform: config.type → operation');

              return { fixed: true, fixApplied: proposal };
            }
          }

          // Action step normalization: operation → action
          if (proposal.fix.normalizeOperation && step.operation) {
            step.action = step.operation;
            delete step.operation; // Remove legacy field after copying
            logger.debug({
              stepId: proposal.targetStepId,
              action: step.action
            }, '[StructuralRepair] Normalized operation → action (removed operation field)');
          }

          // Normalize config → params
          if (proposal.fix.normalizeConfig && step.config) {
            step.params = step.config;
            delete step.config; // Remove legacy field after copying
            logger.debug({
              stepId: proposal.targetStepId
            }, '[StructuralRepair] Normalized config → params (removed config field)');
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
          // Rewrite all {{config.X}} to {{input.X}} in the entire step object
          // (not just params - transform steps have config refs in condition, etc.)
          const stepStr = JSON.stringify(step);
          const updatedStepStr = stepStr.replace(/\{\{config\./g, '{{input.');
          const updatedStep = JSON.parse(updatedStepStr);

          // Copy all properties from updated step back to original step
          Object.assign(step, updatedStep);

          logger.info({
            stepId: proposal.targetStepId,
            stepType: step.type,
            configRefs: proposal.fix.configRefs
          }, '[StructuralRepair] Rewrote {{config.X}} to {{input.X}} in entire step');

          return { fixed: true, fixApplied: proposal };
        }

        case 'add_missing_parameter': {
          // Ensure params object exists
          if (!step.params) {
            step.params = {};
          }

          // CRITICAL: Check if this is a data transformation fix
          if (proposal.fix.transformationType === 'fields_to_array') {
            // This is a fields-to-array transformation
            // Mark this issue for the calibration system to handle via AI transform step
            // (StructuralRepairEngine doesn't insert new steps, only modifies existing ones)

            logger.info({
              stepId: proposal.targetStepId,
              paramName: proposal.fix.paramName,
              sourceParam: proposal.fix.sourceParam,
              fieldMapping: proposal.fix.fieldMapping,
              message: 'Data transformation needed - will be handled by calibration auto-fix'
            }, '[StructuralRepair] Detected fields-to-array transformation (requires AI transform step insertion)');

            // Return false - this fix needs to be handled by the calibration system
            // which can insert new steps (AI transform)
            return {
              fixed: false,
              error: 'Data transformation requires AI transform step insertion (handled by calibration auto-fix)'
            };
          }

          // Standard case: add parameter with smart default value
          step.params[proposal.fix.paramName] = proposal.fix.paramValue;

          logger.info({
            stepId: proposal.targetStepId,
            paramName: proposal.fix.paramName,
            paramValue: proposal.fix.paramValue
          }, '[StructuralRepair] Added missing required parameter with smart default');

          return { fixed: true, fixApplied: proposal };
        }

        case 'add_missing_input_fields': {
          // Add missing fields to agent.input_schema (which is an array)
          if (!agent.input_schema) {
            agent.input_schema = [];
          }

          const fieldsToAdd = proposal.fix.fieldsToAdd || [];
          for (const fieldName of fieldsToAdd) {
            // Check if field already exists
            const exists = agent.input_schema.some(field => field.name === fieldName);
            if (exists) continue;

            // Infer field type from usage context
            const fieldType = this.inferInputFieldType(fieldName);

            // Add new input field
            agent.input_schema.push({
              name: fieldName,
              type: fieldType,
              required: false, // Auto-generated fields are optional by default
              description: `Auto-generated field for ${fieldName}`
            });

            logger.info({
              fieldName,
              fieldType,
              stepId: proposal.targetStepId
            }, '[StructuralRepair] Added missing input field to schema');
          }

          logger.info({
            stepId: proposal.targetStepId,
            fieldsAdded: fieldsToAdd
          }, '[StructuralRepair] Added missing input fields to agent.input_schema');

          return { fixed: true, fixApplied: proposal };
        }

        case 'fix_flatten_field': {
          // Update the flatten field in config
          const oldField = step.config?.field;
          const newField = proposal.fix.newField;

          if (!step.config) {
            step.config = {};
          }

          step.config.field = newField;

          logger.info({
            stepId: proposal.targetStepId,
            oldField,
            newField,
            availableFields: proposal.fix.availableFields
          }, '[StructuralRepair] Fixed flatten field to match source schema');

          return { fixed: true, fixApplied: proposal };
        }

        case 'infer_inputs': {
          // Add missing input field to transform step
          const inputValue = proposal.fix.input;

          // Set input in the appropriate location (config or params)
          if (step.config) {
            step.config.input = inputValue;
          } else if (step.params) {
            step.params.input = inputValue;
          } else {
            // Create config if neither exists
            step.config = { input: inputValue };
          }

          // Also set at step level for consistency
          step.input = inputValue;

          logger.info({
            stepId: proposal.targetStepId,
            input: inputValue
          }, '[StructuralRepair] Added missing input field to transform step');

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
      const builtins = new Set(['current_item', 'current_email', 'current_row', 'index', 'context', 'input', 'inputs', 'item', 'var']);
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
   * Find {{input.X}} references that don't exist in agent.input_schema
   */
  private findInvalidInputReferences(text: string, agent: Agent): string[] {
    const invalidRefs: string[] = [];
    const regex = /\{\{input\.([^}]+)\}\}/g;
    let match;

    // Get valid input fields from agent.input_schema (which is an array)
    const validInputFields = new Set<string>();
    if (agent.input_schema && Array.isArray(agent.input_schema)) {
      for (const field of agent.input_schema) {
        validInputFields.add(field.name);
      }
    }

    // Check each {{input.X}} reference
    while ((match = regex.exec(text)) !== null) {
      const fieldName = match[1]; // e.g., "digest_recipient" from {{input.digest_recipient}}

      // If this field doesn't exist in input_schema, it's invalid
      if (!validInputFields.has(fieldName)) {
        invalidRefs.push(match[0]); // Full reference like {{input.digest_recipient}}
        logger.debug({
          match: match[0],
          fieldName,
          validInputFields: Array.from(validInputFields)
        }, '[StructuralRepair] Found invalid input reference');
      }
    }

    if (invalidRefs.length > 0) {
      logger.debug({
        invalidRefs,
        validInputFields: Array.from(validInputFields)
      }, '[StructuralRepair] findInvalidInputReferences result');
    }

    return invalidRefs;
  }

  /**
   * Find array schema in output schema
   * Handles both direct array schemas and nested object properties
   *
   * @param outputSchema - The output schema from a step
   * @param specificField - Optional specific field name to look for (e.g., "emails")
   * @returns The array schema with items definition, or null if not found
   */
  private findArraySchemaInOutput(outputSchema: any, specificField?: string): any | null {
    if (!outputSchema) return null;

    // Case 1: Output schema is directly an array
    if (outputSchema.type === 'array' && outputSchema.items) {
      return outputSchema;
    }

    // Case 2: Output schema is an object with properties
    if (outputSchema.type === 'object' && outputSchema.properties) {
      // If specific field requested, return that field's schema
      if (specificField && outputSchema.properties[specificField]) {
        const fieldSchema = outputSchema.properties[specificField];
        if (fieldSchema.type === 'array' && fieldSchema.items) {
          return fieldSchema;
        }
      }

      // Otherwise, find the first array field (common pattern for plugin responses)
      for (const [fieldName, fieldSchema] of Object.entries(outputSchema.properties)) {
        const schema = fieldSchema as any;
        if (schema.type === 'array' && schema.items) {
          return schema;
        }
      }
    }

    return null;
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
      // CRITICAL: Check both params and config (for legacy steps not yet normalized)
      const paramValue = step.params?.[paramName] || step.config?.[paramName];

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

    // 5. For parameter names that match input field names, use input reference
    // This covers email, recipient, IDs, etc. without hardcoding
    if (agent.input_schema?.some(field => field.name === paramName)) {
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
    const currentOutputVar = step.output_variable;

    // Build map of variable name → step ID (for both step_id and output_variable)
    const varToStepId = new Map<string, string>();
    for (const s of allSteps) {
      const sId = s.step_id || s.id;
      if (sId) {
        varToStepId.set(sId, sId);
        if (s.output_variable) varToStepId.set(s.output_variable, sId);
        if (s.gather?.outputKey) varToStepId.set(s.gather.outputKey, sId);
      }
    }

    // Search for {{stepX}} or {{output_variable}} references in step params
    const searchInObject = (obj: any) => {
      if (typeof obj === 'string') {
        const regex = /\{\{([a-zA-Z_]\w*)\b/g;
        let match;
        while ((match = regex.exec(obj)) !== null) {
          const varName = match[1];
          const producingStepId = varToStepId.get(varName);
          // Add dependency if it's a valid step reference and not self-reference
          if (producingStepId && producingStepId !== stepId && varName !== currentOutputVar) {
            dependencies.add(producingStepId);
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

  /**
   * Infer input field type from field name
   */
  private inferInputFieldType(fieldName: string): string {
    // Common patterns to infer type
    const lowerName = fieldName.toLowerCase();

    if (lowerName.includes('email') || lowerName.includes('recipient')) {
      return 'string'; // Email addresses
    }

    if (lowerName.includes('count') || lowerName.includes('number') || lowerName.includes('amount') || lowerName.includes('threshold')) {
      return 'number';
    }

    if (lowerName.includes('enabled') || lowerName.includes('active') || lowerName.startsWith('is_') || lowerName.startsWith('has_')) {
      return 'boolean';
    }

    if (lowerName.includes('date') || lowerName.includes('time')) {
      return 'string'; // Dates as ISO strings
    }

    if (lowerName.includes('list') || lowerName.includes('items') || lowerName.endsWith('s')) {
      return 'array';
    }

    // Default to string for unknown types
    return 'string';
  }
}
