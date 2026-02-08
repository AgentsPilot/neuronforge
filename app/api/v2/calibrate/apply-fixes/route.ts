/**
 * Apply Fixes API - Apply user fixes to workflow after batch calibration
 *
 * This endpoint takes the fixes provided by the user and applies them to the agent's workflow:
 * - Parameter corrections (replace hardcoded values with corrected values)
 * - Parameterizations (convert hardcoded values to input parameters)
 * - Auto-repairs (apply approved automatic fixes)
 *
 * The original workflow is backed up before modification.
 *
 * @endpoint POST /api/v2/calibrate/apply-fixes
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { CalibrationSessionRepository } from '@/lib/repositories/CalibrationSessionRepository';
import { HardcodeDetector } from '@/lib/pilot/shadow/HardcodeDetector';
import { createLogger } from '@/lib/logger';
import type { WorkflowStep } from '@/lib/pilot/types';

const logger = createLogger({ module: 'ApplyFixesAPI', service: 'api' });

interface ParameterFix {
  issueId: string;
  value: string;
}

interface ParameterizationFix {
  issueId: string;
  approved: boolean;
  paramName?: string;
  defaultValue?: string;
}

interface AutoRepairFix {
  issueId: string;
  approved: boolean;
}

interface LogicFix {
  issueId: string;
  selectedOption: string;
  userInput: Record<string, any>;
}

interface FixesInput {
  sessionId: string;
  parameters?: Record<string, string>; // issueId -> newValue (changed to support per-issue fixes)
  parameterizations?: ParameterizationFix[];
  autoRepairs?: AutoRepairFix[];
  logicFixes?: LogicFix[];
}

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user
    const supabase = await createAuthenticatedServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      logger.warn({ error: authError }, 'Unauthorized apply fixes attempt');
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You must be logged in to apply fixes' },
        { status: 401 }
      );
    }

    // 2. Parse request body
    const { sessionId, parameters, parameterizations, autoRepairs, logicFixes }: FixesInput = await req.json();

    if (!sessionId) {
      logger.warn({ userId: user.id }, 'Missing sessionId in apply fixes request');
      return NextResponse.json(
        { error: 'Missing sessionId', message: 'sessionId is required' },
        { status: 400 }
      );
    }

    logger.info({
      sessionId,
      userId: user.id,
      parameterCount: Object.keys(parameters || {}).length,
      parameterizationCount: parameterizations?.length || 0,
      autoRepairCount: autoRepairs?.length || 0,
      logicFixCount: logicFixes?.length || 0
    }, 'Starting apply fixes');

    // 3. Load calibration session
    const sessionRepo = new CalibrationSessionRepository(supabase);
    const { data: session, error: sessionError } = await sessionRepo.findById(sessionId);

    if (sessionError || !session) {
      logger.error({ sessionId, error: sessionError }, 'Calibration session not found');
      return NextResponse.json(
        { error: 'Session not found', message: 'The requested calibration session does not exist' },
        { status: 404 }
      );
    }

    // 4. Authorization check
    if (session.user_id !== user.id) {
      logger.warn({ sessionId, userId: user.id, ownerId: session.user_id }, 'Unauthorized session access');
      return NextResponse.json(
        { error: 'Forbidden', message: 'You do not have permission to modify this session' },
        { status: 403 }
      );
    }

    // 5. Load agent
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('*')
      .eq('id', session.agent_id)
      .single();

    if (agentError || !agent) {
      logger.error({ agentId: session.agent_id, error: agentError }, 'Agent not found');
      return NextResponse.json(
        { error: 'Agent not found', message: 'The agent associated with this session does not exist' },
        { status: 404 }
      );
    }

    // 6. Clone pilot_steps for modification
    let updatedSteps: WorkflowStep[] = JSON.parse(JSON.stringify(agent.pilot_steps || agent.workflow_steps || []));

    if (updatedSteps.length === 0) {
      logger.warn({ agentId: agent.id }, 'Agent has no workflow steps');
      return NextResponse.json(
        { error: 'No workflow', message: 'This agent has no workflow steps to modify' },
        { status: 400 }
      );
    }

    logger.info({ agentId: agent.id, stepCount: updatedSteps.length }, 'Loaded workflow steps for modification');

    // 7. Apply parameter corrections
    if (parameters && Object.keys(parameters).length > 0) {
      logger.info({ parameterCount: Object.keys(parameters).length }, 'Applying parameter corrections');

      for (const [issueId, newValue] of Object.entries(parameters)) {
        // Look up the issue to get parameter name and affected steps
        const issue = session.issues?.find((i: any) => i.id === issueId);
        if (!issue) {
          logger.warn({ issueId }, 'Issue not found for parameter correction');
          continue;
        }

        const paramName = issue.suggestedFix?.action?.parameterName;
        const affectedSteps = issue.affectedSteps?.map((s: any) => s.stepId) || [];

        if (!paramName) {
          logger.warn({ issueId }, 'Parameter name not found in issue');
          continue;
        }

        if (affectedSteps.length === 0) {
          logger.warn({ issueId, paramName }, 'No affected steps found for parameter correction');
          continue;
        }

        // Replace parameter value only in the affected steps
        updatedSteps = replaceParameterValueInSteps(updatedSteps, affectedSteps, paramName, newValue);
        logger.debug({ issueId, paramName, newValue, stepCount: affectedSteps.length }, 'Parameter corrected');
      }
    }

    // 8. Apply parameterizations (hardcode → input parameter)
    if (parameterizations && parameterizations.length > 0) {
      const approvedParamFixes = parameterizations.filter(fix => fix.approved);
      logger.info({ count: approvedParamFixes.length }, 'Applying parameterizations');

      const detector = new HardcodeDetector();

      // Build selections array for all approved parameterizations
      const selections: Array<{ path: string; param_name: string; value: any }> = [];

      for (const fix of approvedParamFixes) {
        const issue = session.issues?.find((i: any) => i.id === fix.issueId);
        if (!issue) {
          logger.warn({ issueId: fix.issueId }, 'Issue not found for parameterization fix');
          continue;
        }

        const path = issue.suggestedFix?.action?.path;
        const paramName = fix.paramName || issue.suggestedFix?.action?.paramName;
        const defaultValue = fix.defaultValue || issue.suggestedFix?.action?.defaultValue;

        if (!path || !paramName || defaultValue === undefined) {
          logger.warn({
            issueId: fix.issueId,
            path,
            paramName,
            hasDefaultValue: defaultValue !== undefined,
            hasSuggestedFix: !!issue.suggestedFix,
            hasAction: !!issue.suggestedFix?.action,
            actionKeys: issue.suggestedFix?.action ? Object.keys(issue.suggestedFix.action) : []
          }, 'Missing required fields for parameterization - this calibration session may be from an older version. Please run a new calibration.');
          continue;
        }

        selections.push({
          path,
          param_name: paramName,
          value: defaultValue
        });

        logger.debug({ issueId: fix.issueId, path, paramName }, 'Added parameterization selection');
      }

      // Apply all parameterizations in one call
      if (selections.length > 0) {
        updatedSteps = detector.applyParameterization(updatedSteps, selections);
        logger.info({ count: selections.length }, 'All parameterizations applied');
      }
    }

    // 9. Apply auto-repairs
    if (autoRepairs && autoRepairs.length > 0) {
      const approvedRepairs = autoRepairs.filter(fix => fix.approved);
      logger.info({ count: approvedRepairs.length }, 'Applying auto-repairs');

      for (const fix of approvedRepairs) {
        const issue = session.issues?.find((i: any) => i.id === fix.issueId);
        if (!issue || !issue.autoRepairProposal) {
          logger.warn({ issueId: fix.issueId }, 'Issue or auto-repair proposal not found');
          continue;
        }

        const proposal = issue.autoRepairProposal;

        // Apply the auto-repair based on action type
        if (proposal.action === 'wrap_in_array') {
          // Find the step that needs wrapping
          const stepId = proposal.targetStepId;
          const stepIndex = updatedSteps.findIndex(s => s.id === stepId);

          if (stepIndex !== -1) {
            const step = updatedSteps[stepIndex];

            // Add array wrapper to the step's output handling
            // This is a simplified example - actual implementation may vary
            (step as any).outputTransform = {
              type: 'wrap_array',
              description: 'Wrap output in array for downstream compatibility'
            };

            logger.debug({ issueId: fix.issueId, stepId }, 'Auto-repair: wrap_in_array applied');
          }
        } else if (proposal.action === 'extract_first_item') {
          // Similar logic for extracting first item
          const stepId = proposal.targetStepId;
          const stepIndex = updatedSteps.findIndex(s => s.id === stepId);

          if (stepIndex !== -1) {
            const step = updatedSteps[stepIndex];

            (step as any).outputTransform = {
              type: 'extract_first',
              description: 'Extract first item from array'
            };

            logger.debug({ issueId: fix.issueId, stepId }, 'Auto-repair: extract_first_item applied');
          }
        }
      }
    }

    // 9b. Apply logic fixes (insert filter steps for duplicate data routing)
    if (logicFixes && logicFixes.length > 0) {
      logger.info({ count: logicFixes.length }, 'Applying logic fixes');

      for (const fix of logicFixes) {
        const issue = session.issues?.find((i: any) => i.id === fix.issueId);
        if (!issue) {
          logger.warn({ issueId: fix.issueId }, 'Issue not found for logic fix');
          continue;
        }

        const evidence = (issue.suggestedFix as any)?.evidence;
        const affectedSteps = issue.affectedSteps || [];

        if (fix.selectedOption === 'auto_fix' || fix.selectedOption === 'add_filter_suggested' || fix.selectedOption === 'add_filter_custom') {
          // User wants to add filter steps
          const filterField = fix.selectedOption === 'add_filter_custom'
            ? fix.userInput.filter_field
            : fix.userInput.filterField || evidence?.suggestedFilterField || 'classification';

          logger.info({
            issueId: fix.issueId,
            filterField,
            affectedStepCount: affectedSteps.length,
            autoFix: fix.selectedOption === 'auto_fix'
          }, 'Adding filter steps for logic fix');

          // Find the parallel block containing the affected steps
          const parallelStepIndex = updatedSteps.findIndex(s =>
            (s.type as string) === 'parallel' &&
            (s as any).steps?.some((nestedStep: any) =>
              affectedSteps.some((as: any) => as.stepId === nestedStep.id)
            )
          );

          if (parallelStepIndex === -1) {
            logger.warn({ issueId: fix.issueId }, 'Could not find parallel block for logic fix');
            continue;
          }

          const parallelStep = updatedSteps[parallelStepIndex];
          const nestedSteps = ((parallelStep as any).steps as any[]) || [];

          // Auto-detect filter values from step names or destinations using actual data values
          const autoDetectFilterValue = (stepName: string, destination: string): string | null => {
            const lowerName = stepName.toLowerCase();
            const lowerDest = destination.toLowerCase();

            // First, try to match against actual field values from the execution data
            // This is the most accurate approach - use values that actually exist in the data
            const actualFieldValues = evidence?.filterFieldValues || [];

            for (const value of actualFieldValues) {
              const lowerValue = value.toLowerCase();
              // Check if the step name or destination contains this actual value as a whole word
              // Use word boundary regex to avoid matching "invoice" inside "invoices"
              const wordPattern = new RegExp(`\\b${lowerValue}\\b`, 'i');
              if (wordPattern.test(lowerName) || wordPattern.test(lowerDest)) {
                return value; // Return the original cased value from the data
              }
            }

            // Fallback: Extract from destination formats if no match found
            // - "sheet:Invoices!A2:Z" -> "invoices"
            // - "folder:Expense Reports" -> "expense reports"
            // - "table:approved_items" -> "approved"
            const destMatch = destination.match(/(?:sheet|folder|table|database):([^!:]+)/);
            if (destMatch) {
              const extracted = destMatch[1].toLowerCase().trim();

              // Try to match extracted name against actual field values
              for (const value of actualFieldValues) {
                if (extracted.includes(value.toLowerCase())) {
                  return value;
                }
              }

              // If still no match, clean up and use the extracted name as-is
              // Remove special characters and use the first meaningful word
              let cleaned = extracted.replace(/[_\s-]+/g, ' ').trim().split(' ')[0];

              // Normalize plural to singular (common case: sheet named "Invoices" but data has "invoice")
              // This handles cases where destination names are plural but field values are singular
              if (cleaned.endsWith('s') && cleaned.length > 3) {
                const singular = cleaned.slice(0, -1); // Remove trailing 's'
                // Check if singular form exists in actual field values
                for (const value of actualFieldValues) {
                  if (value.toLowerCase() === singular) {
                    return value; // Return the actual field value (correctly cased)
                  }
                }
                // If not found in field values, use singular anyway (better guess than plural)
                cleaned = singular;
              }

              if (cleaned && cleaned.length > 2) {
                return cleaned;
              }
            }

            return null;
          };

          // SOLUTION: Remove parallel block entirely and insert steps at workflow root level
          // This allows WorkflowPilot's dependency resolution to work properly
          const stepsToInsert: any[] = [];

          // Helper function to detect the correct data source for filtering
          // We need a step that outputs an array of objects (not arrays) with the filter field
          const detectFilterableDataSource = (currentDataSource: string): string => {
            // Extract step ID from data source (e.g., "step7.data" -> "step7")
            const match = currentDataSource.match(/^(step\d+)\.data$/);
            if (!match) return currentDataSource;

            const currentStepId = match[1];
            const currentStepIndex = updatedSteps.findIndex(s => s.id === currentStepId);

            if (currentStepIndex === -1) return currentDataSource;

            // Check if the current step itself converts objects to arrays
            const currentStep = updatedSteps[currentStepIndex];

            // If current step is a map/to_tabular that converts objects to arrays,
            // use its input source instead
            if (currentStep.type === 'transform' &&
                ((currentStep as any).operation === 'to_tabular' ||
                 ((currentStep as any).operation === 'map' && (currentStep as any).config?.columns))) {
              // This step converts objects to tabular format, use its input
              const inputMatch = ((currentStep as any).input || '').match(/\{\{(step\d+)\.data\}\}/);
              if (inputMatch) {
                const objectStepId = inputMatch[1];
                logger.info({
                  detectedObjectSource: `${objectStepId}.data`,
                  originalSource: currentDataSource,
                  reason: `Step ${currentStepId} converts objects to arrays, using its input`
                }, 'Detected correct data source for filtering');
                return `${objectStepId}.data`;
              }
            }

            // Walk backwards from current step to find the last step that produces objects
            for (let i = currentStepIndex - 1; i >= 0; i--) {
              const step = updatedSteps[i];

              // Check if this step is a transform that converts to tabular format
              // (objects -> arrays), which means the step BEFORE it has objects
              if (step.type === 'transform' &&
                  ((step as any).operation === 'to_tabular' ||
                   ((step as any).operation === 'map' && (step as any).config?.columns))) {
                // The input to this step should be objects with the filter field
                const inputMatch = ((step as any).input || '').match(/\{\{(step\d+)\.data\}\}/);
                if (inputMatch) {
                  const objectStepId = inputMatch[1];
                  logger.info({
                    detectedObjectSource: `${objectStepId}.data`,
                    originalSource: currentDataSource,
                    reason: 'Found tabular conversion transform, using its input which has objects'
                  }, 'Detected correct data source for filtering');
                  return `${objectStepId}.data`;
                }
              }

              // Check if this step produces objects (AI processing, extraction, etc.)
              if (step.type === 'deterministic_extraction' ||
                  step.type === 'ai_processing' ||
                  step.type === 'transform' && (step as any).operation === 'flatten') {
                // This step likely produces objects
                logger.info({
                  detectedObjectSource: `${step.id}.data`,
                  originalSource: currentDataSource,
                  reason: `Found ${step.type} step that produces objects`
                }, 'Detected correct data source for filtering');
                return `${step.id}.data`;
              }
            }

            logger.warn({
              originalSource: currentDataSource,
              message: 'Could not detect object-based data source, using original'
            }, 'Data source detection fallback');

            return currentDataSource;
          };

          // Find the original tabular conversion step ONCE (before the loop)
          // We'll copy its config for each new map step
          const originalTabularStep = updatedSteps.find(s =>
            s.type === 'transform' &&
            (s as any).operation === 'map' &&
            (s as any).config?.columns
          );

          for (const nestedStep of nestedSteps) {
            if (nestedStep.type !== 'action') continue;

            const affectedStep = affectedSteps.find((as: any) => as.stepId === nestedStep.id);
            if (!affectedStep) continue;

            // Get filter value
            let filterValue = fix.userInput[`step_${affectedStep.stepId}`];

            if (!filterValue && fix.selectedOption === 'auto_fix') {
              const destination = evidence?.differentDestinations?.[affectedSteps.indexOf(affectedStep)] || '';
              filterValue = autoDetectFilterValue(affectedStep.stepName || affectedStep.friendlyName, destination);

              if (!filterValue) {
                logger.warn({ stepId: affectedStep.stepId }, 'Could not auto-detect filter value');
                continue;
              }
            }

            if (!filterValue) continue;

            // Dynamically detect the correct data source for filtering
            // Use evidence from SmartLogicAnalyzer if available, otherwise try to detect from delivery step params
            let originalDataSource = evidence?.sameDataSource;
            if (!originalDataSource) {
              // Fallback: Extract data source from the delivery step's values parameter
              const valuesParam = nestedStep.params?.values;
              if (typeof valuesParam === 'string') {
                const dataSourceMatch = valuesParam.match(/\{\{(step\d+\.data)\}\}/);
                if (dataSourceMatch) {
                  originalDataSource = dataSourceMatch[1];
                  logger.info({
                    stepId: nestedStep.id,
                    detectedDataSource: originalDataSource
                  }, 'Extracted data source from delivery step params');
                }
              }
            }

            if (!originalDataSource) {
              logger.warn({ stepId: nestedStep.id }, 'Could not determine data source for filtering, skipping step');
              continue;
            }

            const dataSource = detectFilterableDataSource(originalDataSource);
            const filterStepId = `${nestedStep.id}_filter`;

            // Create filter step (filters objects)
            const filterStep = {
              id: filterStepId,
              name: `Filter ${filterField}=${filterValue}`,
              type: 'transform',
              operation: 'filter',
              input: `{{${dataSource}}}`,
              config: {
                condition: `item.${filterField} == '${filterValue}'`
              }
            };

            // Create map step to convert filtered objects back to tabular format
            // This is needed because the delivery step expects arrays, not objects
            const mapStepId = `${nestedStep.id}_map`;

            const mapStep = originalTabularStep ? {
              id: mapStepId,
              name: `Convert to tabular format`,
              type: 'transform',
              operation: 'map',
              input: `{{${filterStepId}.data}}`,
              config: {
                ...((originalTabularStep as any).config), // Copy all config from original tabular step
                add_headers: true // Always add headers for filtered data
              }
            } : null;

            // Create delivery step with dependency on map step (or filter if no map needed)
            const finalDataSource = mapStep ? `${mapStepId}.data` : `${filterStepId}.data`;
            const deliveryStep = {
              ...nestedStep,
              dependencies: mapStep ? [mapStepId] : [filterStepId],
              params: {
                ...nestedStep.params,
                values: `{{${finalDataSource}}}`
              }
            };

            // Add steps in order: filter -> map (if needed) -> delivery
            stepsToInsert.push(filterStep);
            if (mapStep) {
              stepsToInsert.push(mapStep);
            }
            stepsToInsert.push(deliveryStep);

            logger.info({
              filterStepId,
              deliveryStepId: nestedStep.id,
              filterValue
            }, 'Created filter and delivery steps with dependency');
          }

          // Replace the parallel step with the new steps
          updatedSteps.splice(parallelStepIndex, 1, ...stepsToInsert);

          // CRITICAL: Remove the original tabular conversion step since we now have individual map steps per filter
          // The tabular step was the common source that sent all data to both destinations
          // Now each filter has its own map step, so the original is no longer needed
          if (originalTabularStep) {
            const tabularStepIndex = updatedSteps.findIndex(s => s.id === originalTabularStep.id);
            if (tabularStepIndex !== -1) {
              updatedSteps.splice(tabularStepIndex, 1);
              logger.info({ removedStep: originalTabularStep.id }, 'Removed original tabular conversion step (replaced by per-filter map steps)');
            }
          }

          logger.info({
            removedParallelStep: parallelStep.id,
            insertedSteps: stepsToInsert.length,
            removedTabularStep: originalTabularStep?.id
          }, 'Replaced parallel block with individual steps');
        } else if (fix.selectedOption === 'no_filter_needed') {
          // User confirmed this is intentional - just log it
          logger.info({ issueId: fix.issueId }, 'User confirmed duplicate routing is intentional');
        }
      }
    }

    // 9c. Apply lost parent context fixes
    if (logicFixes && logicFixes.length > 0) {
      for (const fix of logicFixes) {
        const issue = session.issues?.find((i: any) => i.id === fix.issueId);
        if (!issue || (issue as any).type !== 'lost_parent_context') continue;

        const evidence = (issue.suggestedFix as any)?.evidence;
        const affectedSteps = issue.affectedSteps || [];

        if (fix.selectedOption === 'inherit_parent_classification') {
          // Find the scatter_gather step
          const scatterStepIndex = updatedSteps.findIndex(s =>
            (s.type as string) === 'scatter_gather' &&
            affectedSteps.some((as: any) => as.id === s.id)
          );

          if (scatterStepIndex === -1) {
            logger.warn({ issueId: fix.issueId }, 'Could not find scatter_gather step for lost parent context fix');
            continue;
          }

          const scatterStep = updatedSteps[scatterStepIndex] as any;
          const parentStepId = evidence?.parentStepId;

          if (!parentStepId) {
            logger.warn({ issueId: fix.issueId }, 'No parent step ID found in evidence');
            continue;
          }

          // Add a new step that extracts parent classification BEFORE the scatter_gather
          const extractParentClassificationStepId = `${scatterStep.id}_parent_context`;

          const extractParentStep: any = {
            id: extractParentClassificationStepId,
            name: 'Extract parent classification',
            type: 'transform' as const,
            operation: 'map',
            input: `{{${parentStepId}.data}}`,
            config: {
              expression: `{
                ...item,
                _parentClassification: item.classification || item.type || item.category || item.subject?.toLowerCase().includes('expense') ? 'expense' : item.subject?.toLowerCase().includes('invoice') ? 'invoice' : null
              }`
            }
          };

          // Update scatter_gather to use the new step as input
          if (scatterStep.scatter?.input) {
            scatterStep.scatter.input = `{{${extractParentClassificationStepId}.data}}`;
          } else if (scatterStep.scatter?.over) {
            scatterStep.scatter.over = `{{${extractParentClassificationStepId}.data}}`;
          }

          // Update the extraction step inside scatter_gather to use _parentClassification
          if (scatterStep.scatter?.steps) {
            for (const nestedStep of scatterStep.scatter.steps) {
              if (nestedStep.type === 'deterministic_extraction' || nestedStep.type === 'ai_processing') {
                // Update the instruction to use parent classification
                if (nestedStep.instruction) {
                  nestedStep.instruction = `Use the parent's classification from _parentClassification field. ${nestedStep.instruction}`;
                }

                // Modify output schema to use _parentClassification as the classification value
                if (nestedStep.output_schema?.fields) {
                  const classificationField = nestedStep.output_schema.fields.find(
                    (f: any) => f.name === 'classification' || f.name === 'type' || f.name === 'category'
                  );

                  if (classificationField) {
                    // Update the field description to indicate it should use parent's value
                    classificationField.description = `Use the value from item._parentClassification (inherited from parent). ${classificationField.description || ''}`;
                  }
                }
              }
            }
          }

          // Insert the extract parent step before scatter_gather
          updatedSteps.splice(scatterStepIndex, 0, extractParentStep);

          logger.info({
            issueId: fix.issueId,
            extractParentStepId: extractParentClassificationStepId,
            scatterStepId: scatterStep.id,
            parentStepId
          }, 'Added parent context inheritance step');

        } else if (fix.selectedOption === 'add_parent_context') {
          // Just update the instruction to consider parent context
          const scatterStepIndex = updatedSteps.findIndex(s =>
            (s.type as string) === 'scatter_gather' &&
            affectedSteps.some((as: any) => as.id === s.id)
          );

          if (scatterStepIndex === -1) continue;

          const scatterStep = updatedSteps[scatterStepIndex] as any;

          if (scatterStep.scatter?.steps) {
            for (const nestedStep of scatterStep.scatter.steps) {
              if (nestedStep.type === 'deterministic_extraction' || nestedStep.type === 'ai_processing') {
                if (nestedStep.instruction) {
                  nestedStep.instruction = `IMPORTANT: Consider the parent item's context (available in item._parentId) when classifying. ${nestedStep.instruction}`;
                }
              }
            }
          }

          logger.info({
            issueId: fix.issueId,
            scatterStepId: scatterStep.id
          }, 'Updated extraction instruction to consider parent context');

        } else if (fix.selectedOption === 'no_fix_needed') {
          logger.info({ issueId: fix.issueId }, 'User confirmed child classification is correct');
        }
      }
    }

    // 9d. Apply missing context in flatten fixes
    if (logicFixes && logicFixes.length > 0) {
      for (const fix of logicFixes) {
        const issue = session.issues?.find((i: any) => i.id === fix.issueId);
        if (!issue || (issue as any).type !== 'missing_context_in_flatten') continue;

        const evidence = (issue.suggestedFix as any)?.evidence;
        const affectedSteps = issue.affectedSteps || [];

        if (fix.selectedOption === 'preserve_all_parent_fields' || fix.selectedOption === 'preserve_referenced_fields') {
          // Find the flatten step (it's the first affected step)
          const flattenStepId = (affectedSteps[0] as any)?.id;
          if (!flattenStepId) {
            logger.warn({ issueId: fix.issueId }, 'No flatten step ID in affected steps');
            continue;
          }

          const flattenStepIndex = updatedSteps.findIndex(s => s.id === flattenStepId);

          if (flattenStepIndex === -1) {
            logger.warn({ issueId: fix.issueId }, 'Could not find flatten step for missing context fix');
            continue;
          }

          const flattenStep = updatedSteps[flattenStepIndex] as any;
          const lostFields = evidence?.lostFields || [];
          const downstreamReferences = evidence?.downstreamReferences || [];

          // Determine which fields to preserve
          let fieldsToPreserve: string[];
          if (fix.selectedOption === 'preserve_all_parent_fields') {
            fieldsToPreserve = lostFields;
          } else {
            // Only preserve fields that are referenced downstream
            const referencedFields = new Set(downstreamReferences.map((r: any) => r.field));
            fieldsToPreserve = lostFields.filter((f: string) => referencedFields.has(f));
          }

          if (fieldsToPreserve.length === 0) {
            logger.warn({ issueId: fix.issueId }, 'No fields to preserve');
            continue;
          }

          // Update flatten config to preserve parent fields
          if (!flattenStep.config) {
            flattenStep.config = {};
          }

          // Add preserve_fields config
          flattenStep.config.preserve_fields = fieldsToPreserve;

          logger.info({
            issueId: fix.issueId,
            flattenStepId: flattenStep.id,
            preservedFields: fieldsToPreserve
          }, 'Updated flatten step to preserve parent context fields');

        } else if (fix.selectedOption === 'no_fix_needed') {
          logger.info({ issueId: fix.issueId }, 'User confirmed missing context is not an issue');
        }
      }
    }

    // 9e. Apply missing deduplication fixes
    if (logicFixes && logicFixes.length > 0) {
      for (const fix of logicFixes) {
        const issue = session.issues?.find((i: any) => i.id === fix.issueId);
        if (!issue || (issue as any).type !== 'missing_deduplication') continue;

        const affectedSteps = issue.affectedSteps || [];

        if (fix.selectedOption === 'add_deduplication') {
          // Find the data source and delivery steps
          if (affectedSteps.length < 2) {
            logger.warn({ issueId: fix.issueId }, 'Not enough affected steps for deduplication fix');
            continue;
          }

          const dataSourceStepId = (affectedSteps[0] as any).id;
          const deliveryStepId = (affectedSteps[1] as any).id;

          const dataSourceStepIndex = updatedSteps.findIndex(s => s.id === dataSourceStepId);
          const deliveryStepIndex = updatedSteps.findIndex(s => s.id === deliveryStepId);

          if (dataSourceStepIndex === -1 || deliveryStepIndex === -1) {
            logger.warn({ issueId: fix.issueId }, 'Could not find steps for deduplication fix');
            continue;
          }

          // Add a filter step after the data source to exclude already-processed items
          // This requires a "seen IDs" tracking mechanism
          const filterStepId = `${dataSourceStepId}_dedupe`;

          const filterStep: any = {
            id: filterStepId,
            name: 'Filter out already processed items',
            type: 'transform' as const,
            operation: 'filter',
            input: `{{${dataSourceStepId}.data}}`,
            config: {
              condition: `!item._processed`,
              description: 'REQUIRES SETUP: You need to add a _processed field or track processed IDs in a separate sheet/database'
            }
          };

          // Insert filter step after data source
          updatedSteps.splice(dataSourceStepIndex + 1, 0, filterStep);

          // Update downstream steps to use filtered data
          for (let i = dataSourceStepIndex + 2; i < updatedSteps.length; i++) {
            const laterStep = updatedSteps[i];
            const stepStr = JSON.stringify(laterStep);

            if (stepStr.includes(`${dataSourceStepId}.data`)) {
              // Replace references to use filtered data
              const updated = JSON.parse(
                stepStr.replace(
                  new RegExp(`${dataSourceStepId}\\.data`, 'g'),
                  `${filterStepId}.data`
                )
              );
              updatedSteps[i] = updated;
            }
          }

          logger.info({
            issueId: fix.issueId,
            filterStepId,
            dataSourceStepId
          }, 'Added deduplication filter step');

        } else if (fix.selectedOption === 'runs_once' || fix.selectedOption === 'handled_externally') {
          logger.info({ issueId: fix.issueId, reason: fix.selectedOption }, 'User confirmed deduplication not needed');
        }
      }
    }

    // 10. Backup original pilot_steps
    await sessionRepo.backupPilotSteps(sessionId, agent.pilot_steps || agent.workflow_steps);
    logger.info({ sessionId, agentId: agent.id }, 'Original workflow backed up');

    // 10b. Build FRESH input_schema from parameterizations
    // IMPORTANT: Complete replacement prevents accumulation from multiple calibration runs
    const approvedParamFixes = parameterizations?.filter(fix => fix.approved) || [];

    logger.info({
      sessionId,
      oldSchemaCount: (agent.input_schema || []).length,
      newParamCount: approvedParamFixes.length
    }, 'Replacing input_schema with new parameters from this calibration');

    // Start with empty schema - complete replacement
    const newInputSchema: any[] = [];

    // Collect new parameters to add
    const paramsToAdd: Array<{ name: string; displayName?: string; stepContext?: string; defaultValue: any }> = [];
    const paramNamesBeingAdded = new Set<string>(); // Track params being added to prevent duplicates

    // FIRST: Extract existing parameter references from the workflow
    // These are parameters that were already parameterized in previous calibrations
    // Format: {{input.param_name}}
    const existingParamRefs = new Set<string>();
    const extractParamReferences = (obj: any): void => {
      if (!obj) return;

      if (typeof obj === 'string') {
        // Match {{input.param_name}} pattern
        const regex = /\{\{input\.([^}]+)\}\}/g;
        let match;
        while ((match = regex.exec(obj)) !== null) {
          existingParamRefs.add(match[1]);
        }
      } else if (Array.isArray(obj)) {
        obj.forEach(item => extractParamReferences(item));
      } else if (typeof obj === 'object') {
        Object.values(obj).forEach(value => extractParamReferences(value));
      }
    };

    // Extract from the UPDATED workflow (after applying fixes)
    extractParamReferences(updatedSteps);

    logger.info({
      existingParamCount: existingParamRefs.size,
      existingParams: Array.from(existingParamRefs)
    }, 'Extracted existing parameter references from workflow');

    // Add existing parameters first (preserve them from previous calibrations)
    const existingParamArray = Array.from(existingParamRefs);
    for (const paramName of existingParamArray) {
      // Find if this param exists in old schema to get metadata
      const oldSchemaParam = agent.input_schema?.find((p: any) => p.name === paramName);

      // Extract clean base name for label (remove step prefix)
      let baseName = paramName.replace(/^step\d+_/, '');
      const displayLabel = baseName.split('_').map((word: string) =>
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');

      paramsToAdd.push({
        name: paramName,
        displayName: oldSchemaParam?.label || displayLabel,
        stepContext: oldSchemaParam?.description?.replace('For step: ', '') || undefined,
        defaultValue: oldSchemaParam?.placeholder || ''
      });
      paramNamesBeingAdded.add(paramName);
    }

    for (const fix of approvedParamFixes) {
      const issue = session.issues?.find((i: any) => i.id === fix.issueId);
      if (!issue) continue;

      const paramName = fix.paramName || issue.suggestedFix?.action?.paramName;
      const displayName = issue.suggestedFix?.action?.displayName; // User-friendly name without prefix
      const stepContext = issue.suggestedFix?.action?.stepContext; // Full step name for context
      const defaultValue = fix.defaultValue || issue.suggestedFix?.action?.defaultValue;

      if (!paramName) continue;

      // Check if parameter already exists in schema OR is being added in this batch
      const existsInSchema = newInputSchema.some((field: any) => field.name === paramName);
      const isBeingAdded = paramNamesBeingAdded.has(paramName);

      if (!existsInSchema && !isBeingAdded) {
        paramsToAdd.push({ name: paramName, displayName, stepContext, defaultValue });
        paramNamesBeingAdded.add(paramName); // Mark as being added
        logger.debug({ paramName, issueId: fix.issueId }, 'Adding parameter to schema');
      } else {
        logger.debug({
          paramName,
          issueId: fix.issueId,
          existsInSchema,
          isBeingAdded,
          reason: 'Skipping duplicate parameter'
        }, 'Parameter already exists or is being added');
      }
    }

    // Sort parameters to group related ones together (source_*, target_*, etc.)
    paramsToAdd.sort((a, b) => {
      // Extract prefix and base name
      const getPrefix = (name: string): string => {
        const prefixes = ['source_', 'target_', 'input_', 'output_', 'from_', 'to_'];
        for (const prefix of prefixes) {
          if (name.startsWith(prefix)) return prefix;
        }
        return '';
      };

      const getBaseName = (name: string): string => {
        const prefix = getPrefix(name);
        return prefix ? name.substring(prefix.length) : name;
      };

      const aPrefix = getPrefix(a.name);
      const bPrefix = getPrefix(b.name);
      const aBase = getBaseName(a.name);
      const bBase = getBaseName(b.name);

      // First sort by base name (so spreadsheet_id and range params stay together)
      if (aBase !== bBase) {
        return aBase.localeCompare(bBase);
      }

      // Then sort by prefix (source before target)
      const prefixOrder = { 'source_': 0, 'target_': 1, 'input_': 2, 'output_': 3, 'from_': 4, 'to_': 5, '': 6 };
      return (prefixOrder[aPrefix as keyof typeof prefixOrder] || 6) - (prefixOrder[bPrefix as keyof typeof prefixOrder] || 6);
    });

    // Add sorted parameters to schema
    for (const param of paramsToAdd) {
      // Extract clean base name for label (remove step prefix and format nicely)
      // Example: step8_spreadsheet_id -> Spreadsheet Id
      //          step9_range -> Range
      let baseName = param.name.replace(/^step\d+_/, ''); // Remove step prefix
      const displayLabel = baseName.split('_').map((word: string) =>
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');

      // Build description with step context - this shows WHICH step this parameter is for
      // Example: "For step: Update Invoices spreadsheet"
      const description = param.stepContext ? `For step: ${param.stepContext}` : undefined;

      newInputSchema.push({
        name: param.name, // Backend name with step prefix for uniqueness (e.g., step8_spreadsheet_id)
        label: displayLabel, // Clean label without step prefix (e.g., "Spreadsheet Id", "Range")
        description: description, // Step context so user knows which step this belongs to
        type: 'string',
        required: true,
        placeholder: String(param.defaultValue || '')
      });
      logger.info({
        paramName: param.name,
        displayLabel,
        stepContext: param.stepContext,
        defaultValue: param.defaultValue
      }, 'Added parameter to input_schema with clean label and step context');
    }

    // 11. Update agent with fixed workflow AND updated input_schema
    const { error: updateError } = await supabase
      .from('agents')
      .update({
        pilot_steps: updatedSteps,
        input_schema: newInputSchema,
        updated_at: new Date().toISOString()
      })
      .eq('id', agent.id);

    if (updateError) {
      logger.error({ agentId: agent.id, error: updateError }, 'Failed to update agent workflow');
      return NextResponse.json(
        { error: 'Update failed', message: 'Failed to update agent workflow' },
        { status: 500 }
      );
    }

    logger.info({ agentId: agent.id, stepCount: updatedSteps.length }, 'Agent workflow updated successfully');

    // 12. Store user fixes and mark session as fixes_applied (not completed - needs testing)
    await sessionRepo.storeUserFixes(sessionId, {
      parameters,
      parameterizations,
      autoRepairs,
      logicFixes
    });

    // Calculate applied fixes summary for UI display
    const appliedFixesSummary = {
      parameters: Object.keys(parameters || {}).length,
      parameterizations: parameterizations?.filter(f => f.approved).length || 0,
      autoRepairs: autoRepairs?.filter(f => f.approved).length || 0,
      logicFixes: logicFixes?.length || 0
    };

    // Update session status to 'fixes_applied' instead of 'completed'
    // User needs to test the workflow to verify fixes before we mark as completed
    // Also store applied_fixes summary for session restoration
    await sessionRepo.update(sessionId, {
      status: 'fixes_applied',
      applied_fixes: appliedFixesSummary
    });

    logger.info({ sessionId, agentId: agent.id }, 'Fixes applied successfully (awaiting verification)');

    // 13. Return success response
    return NextResponse.json({
      success: true,
      message: 'Fixes applied successfully',
      agentId: agent.id,
      updatedStepsCount: updatedSteps.length,
      appliedFixes: appliedFixesSummary
    });

  } catch (error: any) {
    logger.error({
      error: error.message,
      stack: error.stack
    }, 'Apply fixes failed with exception');

    return NextResponse.json(
      {
        error: 'Apply fixes failed',
        message: error.message || 'An unexpected error occurred while applying fixes',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

/**
 * Replace a parameter value throughout the workflow
 */
/**
 * Replace parameter value only in specific steps (by step IDs)
 * Used for parameter error fixes where different steps may need different values
 */
function replaceParameterValueInSteps(
  steps: WorkflowStep[],
  affectedStepIds: string[],
  paramName: string,
  newValue: string
): WorkflowStep[] {
  return steps.map(step => {
    // Only modify if this step is in the affected list
    if (!affectedStepIds.includes(step.id)) {
      return step;
    }

    // Deep clone the step to avoid mutations
    const clonedStep = JSON.parse(JSON.stringify(step));

    // Replace in params
    if (clonedStep.params) {
      replaceInObject(clonedStep.params, paramName, newValue);
    }

    // Replace in config
    if (clonedStep.config) {
      replaceInObject(clonedStep.config, paramName, newValue);
    }

    return clonedStep;
  });
}

/**
 * Replace parameter value in all steps (legacy - kept for backwards compatibility)
 */
function replaceParameterValue(
  steps: WorkflowStep[],
  paramName: string,
  newValue: string
): WorkflowStep[] {
  return steps.map(step => {
    // Deep clone the step to avoid mutations
    const clonedStep = JSON.parse(JSON.stringify(step));

    // Replace in params
    if (clonedStep.params) {
      replaceInObject(clonedStep.params, paramName, newValue);
    }

    // Replace in config
    if (clonedStep.config) {
      replaceInObject(clonedStep.config, paramName, newValue);
    }

    return clonedStep;
  });
}

/**
 * Recursively replace parameter value in an object
 */
function replaceInObject(obj: any, paramName: string, newValue: string): void {
  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      // Check if this is the parameter we're looking for
      if (obj[key] === paramName || key === paramName) {
        obj[key] = newValue;
      }
      // Also check if it's in a template string like {{paramName}}
      obj[key] = obj[key].replace(
        new RegExp(`\\{\\{\\s*${paramName}\\s*\\}\\}`, 'g'),
        newValue
      );
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      replaceInObject(obj[key], paramName, newValue);
    }
  }
}
