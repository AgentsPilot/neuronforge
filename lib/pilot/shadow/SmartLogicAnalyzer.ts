/**
 * SmartLogicAnalyzer - Detect workflow logic issues that won't cause errors
 * but may produce incorrect or suboptimal results.
 *
 * This analyzer runs AFTER execution to compare workflow structure with
 * actual execution results to find logic problems.
 *
 * Issues are presented to the user for decision, not auto-fixed.
 */

import { createLogger } from '@/lib/logger';
import type { WorkflowStep } from '@/lib/pilot/types';

const logger = createLogger({ module: 'SmartLogicAnalyzer', service: 'calibration' });

export interface LogicIssue {
  id: string;
  type:
    // Category 1: Data Routing
    | 'duplicate_data_routing'
    | 'partial_data_loss'
    | 'missing_destination'
    | 'lost_parent_context'
    | 'missing_context_in_flatten'
    | 'missing_deduplication'
    // Category 2: Inefficiency
    | 'sequential_to_parallel'
    | 'redundant_fetching'
    | 'unnecessary_loop'
    // Category 3: Data Quality
    | 'missing_validation'
    | 'data_type_mismatch'
    // Category 4: Conditional Logic
    | 'always_true_condition'
    | 'unreachable_steps'
    // Category 5: Error Handling
    | 'missing_error_handling'
    | 'silent_failures'
    // Category 6: Resource Optimization
    | 'excessive_ai_processing';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  affectedSteps: Array<{ id: string; name: string }>;

  // Evidence for the user (flexible structure)
  evidence: Record<string, any>;

  // Options for user to choose from
  userOptions?: Array<{
    id: string;
    label: string;
    description: string;
    requiresInput?: {
      field: string;
      label: string;
      type: 'select' | 'text';
      options?: string[];
    };
  }>;

  // Estimated impact of fixing
  impact?: {
    timeSaved?: string;
    costSaved?: string;
    dataQualityImprovement?: string;
  };
}

export class SmartLogicAnalyzer {
  /**
   * Analyze workflow for logic issues after execution
   */
  analyze(
    pilotSteps: WorkflowStep[],
    executionTrace: any
  ): LogicIssue[] {
    logger.info({ stepCount: pilotSteps.length }, 'Starting smart logic analysis');

    const issues: LogicIssue[] = [];

    try {
      // Detect duplicate data routing in parallel blocks
      const routingIssues = this.detectDuplicateDataRouting(pilotSteps, executionTrace);
      issues.push(...routingIssues);

      // Detect partial data loss (filters reducing data >80%)
      const dataLossIssues = this.detectPartialDataLoss(pilotSteps, executionTrace);
      issues.push(...dataLossIssues);

      // Detect missing data destinations
      const missingDestinationIssues = this.detectMissingDestination(pilotSteps, executionTrace);
      issues.push(...missingDestinationIssues);

      // Detect sequential operations that could be parallel
      const parallelizationIssues = this.detectSequentialToParallel(pilotSteps, executionTrace);
      issues.push(...parallelizationIssues);

      // Detect missing validation before delivery
      const validationIssues = this.detectMissingValidation(pilotSteps, executionTrace);
      issues.push(...validationIssues);

      // Category 2: Inefficiency
      const redundantFetchingIssues = this.detectRedundantFetching(pilotSteps, executionTrace);
      issues.push(...redundantFetchingIssues);

      const unnecessaryLoopIssues = this.detectUnnecessaryLoops(pilotSteps, executionTrace);
      issues.push(...unnecessaryLoopIssues);

      // Category 3: Data Quality
      const dataTypeMismatchIssues = this.detectDataTypeMismatch(pilotSteps, executionTrace);
      issues.push(...dataTypeMismatchIssues);

      // Category 4: Conditional Logic
      const alwaysTrueConditionIssues = this.detectAlwaysTrueConditions(pilotSteps, executionTrace);
      issues.push(...alwaysTrueConditionIssues);

      const unreachableStepsIssues = this.detectUnreachableSteps(pilotSteps, executionTrace);
      issues.push(...unreachableStepsIssues);

      // Category 5: Error Handling
      const missingErrorHandlingIssues = this.detectMissingErrorHandling(pilotSteps, executionTrace);
      issues.push(...missingErrorHandlingIssues);

      const silentFailuresIssues = this.detectSilentFailures(pilotSteps, executionTrace);
      issues.push(...silentFailuresIssues);

      // Category 6: Resource Optimization
      const excessiveAIProcessingIssues = this.detectExcessiveAIProcessing(pilotSteps, executionTrace);
      issues.push(...excessiveAIProcessingIssues);

      // Category 1: Data Routing - Lost Parent Context
      const lostParentContextIssues = this.detectLostParentContext(pilotSteps, executionTrace);
      issues.push(...lostParentContextIssues);

      // Category 1: Data Routing - Missing Context in Flatten
      const missingContextInFlattenIssues = this.detectMissingContextInFlatten(pilotSteps, executionTrace);
      issues.push(...missingContextInFlattenIssues);

      // Category 1: Data Routing - Missing Deduplication
      const missingDeduplicationIssues = this.detectMissingDeduplication(pilotSteps, executionTrace);
      issues.push(...missingDeduplicationIssues);

      logger.info({ issueCount: issues.length }, 'Smart logic analysis complete');
    } catch (error) {
      logger.error({ error }, 'Smart logic analysis failed');
    }

    return issues;
  }

  /**
   * Detect when parallel steps send identical data to different destinations
   */
  private detectDuplicateDataRouting(
    pilotSteps: WorkflowStep[],
    executionTrace: any
  ): LogicIssue[] {
    const issues: LogicIssue[] = [];

    // Find all parallel blocks
    for (const step of pilotSteps) {
      // Type cast to access parallel-specific properties
      if ((step.type as string) !== 'parallel') {
        continue;
      }

      const parallelStep = step as any;
      if (!parallelStep.steps || parallelStep.steps.length < 2) {
        continue;
      }

      // Extract delivery steps from nested structures
      // Handle both direct delivery steps and delivery steps inside sequential branches
      const deliverySteps: any[] = [];

      for (const nestedStep of parallelStep.steps) {
        if (nestedStep.type === 'action' &&
            nestedStep.params?.values &&
            (nestedStep.action?.includes('append') ||
             nestedStep.action?.includes('create') ||
             nestedStep.action?.includes('insert') ||
             nestedStep.action?.includes('write'))) {
          // Direct delivery step
          deliverySteps.push(nestedStep);
        } else if ((nestedStep.type as string) === 'sequential' && nestedStep.steps) {
          // Look for delivery steps inside sequential branch
          const deliveryInBranch = nestedStep.steps.find((s: any) =>
            s.type === 'action' &&
            s.params?.values &&
            (s.action?.includes('append') ||
             s.action?.includes('create') ||
             s.action?.includes('insert') ||
             s.action?.includes('write'))
          );
          if (deliveryInBranch) {
            deliverySteps.push(deliveryInBranch);
          }
        }
      }

      if (deliverySteps.length < 2) continue;

      // Extract data sources for each delivery step
      const dataSources = deliverySteps.map((s: any) =>
        this.extractDataSource(s.params?.values)
      );

      // Check if all use the same data source
      const uniqueSources = Array.from(new Set(dataSources));
      if (uniqueSources.length > 1 || !uniqueSources[0]) {
        continue; // Different sources or no source - not an issue
      }

      const dataSource = uniqueSources[0];

      // Extract destinations for each delivery step
      const destinations = deliverySteps.map((s: any) =>
        this.extractDestination(s)
      );

      // Check if destinations are different
      const uniqueDestinations = Array.from(new Set(destinations));
      if (uniqueDestinations.length <= 1) {
        continue; // Same destination - not an issue
      }

      // FOUND ISSUE: Same data going to different places

      // Get execution stats to confirm data is identical
      const executionStats = this.getExecutionStats(
        executionTrace,
        deliverySteps.map((s: any) => s.id)
      );

      // Find available fields in the data that could be used for filtering
      const availableFields = this.findAvailableFields(
        pilotSteps,
        dataSource,
        executionTrace
      );

      // Suggest a filter field (look for classification-like fields)
      const suggestedFilterField = this.suggestFilterField(availableFields);

      // Extract unique values for the suggested filter field from execution data
      const filterFieldValues = suggestedFilterField
        ? this.extractFieldValues(executionTrace, dataSource, suggestedFilterField)
        : undefined;

      // Create the issue for user decision
      issues.push({
        id: `logic_${parallelStep.id}_duplicate_routing`,
        type: 'duplicate_data_routing',
        severity: 'critical',
        title: 'Duplicate Data Sent to Multiple Destinations',
        description: `The steps "${deliverySteps[0].name}" and "${deliverySteps[1].name}" are both sending the same data (${dataSource}) to different destinations. This may result in duplicate or incorrect data.`,
        affectedSteps: deliverySteps.map((s: any) => ({
          id: s.id,
          name: s.name
        })),
        evidence: {
          sameDataSource: dataSource,
          differentDestinations: destinations,
          availableFields,
          suggestedFilterField,
          filterFieldValues, // Unique values found in the filter field (e.g., ["invoice", "expense"])
          executionStats
        },
        userOptions: this.generateUserOptions(availableFields, suggestedFilterField)
      });
    }

    return issues;
  }

  /**
   * Extract data source reference from step params
   */
  private extractDataSource(value: any): string | null {
    if (typeof value !== 'string') return null;

    // Extract {{stepX.data}} pattern
    const match = value.match(/\{\{([^}]+)\}\}/);
    return match ? match[1] : null;
  }

  /**
   * Extract destination identifier from delivery step
   */
  private extractDestination(step: any): string {
    const params = step.params || {};

    // For Google Sheets: range identifies the destination
    if (params.range) {
      // Handle both hardcoded and parameterized ranges
      const range = typeof params.range === 'string' ? params.range : 'unknown';
      const cleanRange = range.replace(/\{\{input\.[^}]+\}\}/, '<parameter>');
      return `sheet:${cleanRange}`;
    }

    // For other actions, use action name + plugin
    return `${step.plugin || 'unknown'}:${step.action || 'unknown'}`;
  }

  /**
   * Get execution statistics for delivery steps
   */
  private getExecutionStats(
    executionTrace: any,
    stepIds: string[]
  ): { step1Count: number; step2Count: number; identical: boolean } | undefined {
    if (!executionTrace?.steps) return undefined;

    const stats = stepIds.map(id => {
      const stepResult = executionTrace.steps[id];
      return stepResult?.itemCount || 0;
    });

    if (stats.length >= 2) {
      return {
        step1Count: stats[0],
        step2Count: stats[1],
        identical: stats[0] === stats[1] && stats[0] > 0
      };
    }

    return undefined;
  }

  /**
   * Find available fields in the data that could be used for filtering
   */
  private findAvailableFields(
    pilotSteps: WorkflowStep[],
    dataSource: string,
    executionTrace: any
  ): string[] {
    const fields: string[] = [];

    // Try to get fields from execution trace first (most accurate)
    if (executionTrace?.steps) {
      const sourceStepId = dataSource.split('.')[0];
      const sourceResult = executionTrace.steps[sourceStepId];

      if (sourceResult?.field_names) {
        fields.push(...sourceResult.field_names);
      }
    }

    // Also check extraction schemas for field definitions
    for (const step of pilotSteps) {
      if (step.type === 'scatter_gather' && (step as any).scatter?.steps) {
        for (const nestedStep of (step as any).scatter.steps) {
          const schema = (nestedStep as any).output_schema;
          if (schema?.fields) {
            const fieldNames = schema.fields.map((f: any) => f.name);
            fields.push(...fieldNames);
          }
        }
      }
    }

    // Remove duplicates
    return Array.from(new Set(fields));
  }

  /**
   * Extract unique values for a specific field from execution data
   */
  private extractFieldValues(
    executionTrace: any,
    dataSource: string,
    fieldName: string
  ): string[] | undefined {
    if (!executionTrace?.steps) return undefined;

    const sourceStepId = dataSource.split('.')[0];
    const sourceResult = executionTrace.steps[sourceStepId];

    if (!sourceResult?.data || !Array.isArray(sourceResult.data)) {
      return undefined;
    }

    const values = new Set<string>();

    for (const item of sourceResult.data) {
      if (item && typeof item === 'object') {
        const value = item[fieldName];
        if (value !== undefined && value !== null) {
          values.add(String(value));
        }
      }
    }

    return values.size > 0 ? Array.from(values) : undefined;
  }

  /**
   * Suggest a field that might be good for filtering
   */
  private suggestFilterField(availableFields: string[]): string | undefined {
    // Look for classification-like field names
    const classificationFields = [
      'classification',
      'type',
      'category',
      'status',
      'group',
      'class'
    ];

    for (const field of classificationFields) {
      if (availableFields.includes(field)) {
        return field;
      }
    }

    return undefined;
  }

  /**
   * Generate user options for handling the issue
   */
  private generateUserOptions(
    availableFields: string[],
    suggestedFilterField?: string
  ): Array<{
    id: string;
    label: string;
    description: string;
    requiresInput?: any;
  }> {
    const options: any[] = [];

    // Option 1: Add filter using suggested field
    if (suggestedFilterField) {
      options.push({
        id: 'add_filter_suggested',
        label: `Filter by '${suggestedFilterField}' field`,
        description: `Add filter steps to route data based on the '${suggestedFilterField}' field value`,
        requiresInput: {
          field: 'filter_values',
          label: 'What values should each step filter for?',
          type: 'text',
          placeholder: 'e.g., invoice, expense'
        }
      });
    }

    // Option 2: Choose different field
    if (availableFields.length > 0) {
      options.push({
        id: 'add_filter_custom',
        label: 'Filter by different field',
        description: 'Choose which field to use for filtering the data',
        requiresInput: {
          field: 'filter_field',
          label: 'Select field to filter by',
          type: 'select',
          options: availableFields
        }
      });
    }

    // Option 3: No filtering needed
    options.push({
      id: 'no_filter_needed',
      label: 'No filtering needed (intentional duplicate)',
      description: 'Both destinations should receive all the data - this is the intended behavior'
    });

    return options;
  }

  /**
   * Detect when filters reduce data by >80% (potential data loss)
   */
  private detectPartialDataLoss(
    pilotSteps: WorkflowStep[],
    executionTrace: any
  ): LogicIssue[] {
    const issues: LogicIssue[] = [];

    if (!executionTrace?.steps) return issues;

    // Find all filter/transform steps
    for (const step of pilotSteps) {
      if (step.type !== 'transform') continue;

      const stepResult = executionTrace.steps[step.id];
      if (!stepResult) continue;

      // Get input and output counts
      const inputCount = stepResult.input_count || stepResult.row_count_before;
      const outputCount = stepResult.output_count || stepResult.row_count || stepResult.row_count_after;

      if (!inputCount || !outputCount || inputCount === 0) continue;

      // Calculate reduction percentage
      const reductionPercent = ((inputCount - outputCount) / inputCount) * 100;

      // Flag if >80% reduction
      if (reductionPercent > 80) {
        issues.push({
          id: `logic_${step.id}_partial_data_loss`,
          type: 'partial_data_loss',
          severity: 'warning',
          title: 'Significant Data Reduction Detected',
          description: `Step "${step.name}" reduced ${inputCount} rows to ${outputCount} rows (${reductionPercent.toFixed(0)}% reduction). This may indicate overly restrictive filtering.`,
          affectedSteps: [{ id: step.id, name: step.name }],
          evidence: {
            inputCount,
            outputCount,
            droppedCount: inputCount - outputCount,
            reductionPercent: Math.round(reductionPercent),
            stepName: step.name,
            operation: (step as any).operation,
            config: (step as any).config
          }
        });
      }
    }

    return issues;
  }

  /**
   * Detect when data is processed but never sent to a destination
   */
  private detectMissingDestination(
    pilotSteps: WorkflowStep[],
    executionTrace: any
  ): LogicIssue[] {
    const issues: LogicIssue[] = [];

    if (!executionTrace?.steps) return issues;

    // Find transform chains that don't end in delivery actions
    const deliveryActions = ['append', 'create', 'insert', 'write', 'send', 'update'];
    const hasDeliveryStep = pilotSteps.some(
      (step) =>
        step.type === 'action' &&
        deliveryActions.some((action) => (step as any).action?.includes(action))
    );

    if (hasDeliveryStep) return issues; // Has delivery, no issue

    // Check if workflow actually processed data
    let processedRows = 0;
    let lastProcessingStep: any = null;

    for (const step of pilotSteps) {
      if (step.type === 'transform' || step.type === 'ai_processing' || step.type === 'deterministic_extraction') {
        const stepResult = executionTrace.steps[step.id];
        const rowCount = stepResult?.output_count || stepResult?.row_count || 0;

        if (rowCount > processedRows) {
          processedRows = rowCount;
          lastProcessingStep = step;
        }
      }
    }

    // If data was processed but no delivery step exists
    if (processedRows > 0 && lastProcessingStep) {
      issues.push({
        id: `logic_workflow_missing_destination`,
        type: 'missing_destination',
        severity: 'warning',
        title: 'Processed Data Not Sent Anywhere',
        description: `Your workflow processed ${processedRows} rows but doesn't send them to any destination (sheets, database, etc.). The processed data will be lost.`,
        affectedSteps: [{ id: lastProcessingStep.id, name: lastProcessingStep.name }],
        evidence: {
          processedRows,
          lastStep: lastProcessingStep.name,
          lastStepId: lastProcessingStep.id,
          hasDelivery: false
        }
      });
    }

    return issues;
  }

  /**
   * Detect sequential operations that could run in parallel
   */
  private detectSequentialToParallel(
    pilotSteps: WorkflowStep[],
    executionTrace: any
  ): LogicIssue[] {
    const issues: LogicIssue[] = [];

    if (!executionTrace?.steps || pilotSteps.length < 3) return issues;

    // Find sequences of 3+ consecutive steps that:
    // 1. Use the same input source
    // 2. Don't depend on each other's output
    // 3. Could execute simultaneously

    for (let i = 0; i < pilotSteps.length - 2; i++) {
      const candidates: any[] = [];
      let sharedInput: string | null = null;

      // Look ahead for potential parallel candidates
      for (let j = i; j < pilotSteps.length && j < i + 5; j++) {
        const step = pilotSteps[j];

        // Skip non-action steps
        if (step.type !== 'action') break;

        // Get input source
        const input = this.extractInputSource(step);
        if (!input) break;

        // First step sets the shared input
        if (sharedInput === null) {
          sharedInput = input;
          candidates.push(step);
          continue;
        }

        // Must use same input
        if (input !== sharedInput) break;

        // Must not reference previous candidates' outputs
        const referencesCandidate = candidates.some((c) =>
          JSON.stringify(step).includes(c.id)
        );
        if (referencesCandidate) break;

        candidates.push(step);
      }

      // Need at least 3 candidates to be worth parallelizing
      if (candidates.length >= 3) {
        // Calculate potential time savings
        const executionTimes = candidates.map((c) => {
          const result = executionTrace.steps[c.id];
          return result?.execution_time_ms || 0;
        });

        const totalSequentialTime = executionTimes.reduce((a, b) => a + b, 0);
        const maxParallelTime = Math.max(...executionTimes);
        const timeSaved = totalSequentialTime - maxParallelTime;

        if (timeSaved > 1000) {
          // Only suggest if saves >1 second
          issues.push({
            id: `logic_parallel_${candidates[0].id}_to_${candidates[candidates.length - 1].id}`,
            type: 'sequential_to_parallel',
            severity: 'info',
            title: 'Sequential Steps Could Run in Parallel',
            description: `Steps ${candidates[0].name} through ${candidates[candidates.length - 1].name} use the same input and could run simultaneously, saving ~${Math.round(timeSaved / 1000)} seconds.`,
            affectedSteps: candidates.map((c) => ({ id: c.id, name: c.name })),
            evidence: {
              sharedInput,
              stepCount: candidates.length,
              totalSequentialTime,
              maxParallelTime,
              timeSaved
            },
            impact: {
              timeSaved: `~${Math.round(timeSaved / 1000)} seconds per run`
            }
          });

          // Skip ahead to avoid overlapping suggestions
          i = i + candidates.length - 1;
        }
      }
    }

    return issues;
  }

  /**
   * Detect missing validation before data delivery
   */
  private detectMissingValidation(
    pilotSteps: WorkflowStep[],
    executionTrace: any
  ): LogicIssue[] {
    const issues: LogicIssue[] = [];

    if (!executionTrace?.steps) return issues;

    // Find AI/extraction steps followed immediately by delivery
    const deliveryActions = ['append', 'create', 'insert', 'write', 'send'];

    for (let i = 0; i < pilotSteps.length - 1; i++) {
      const currentStep = pilotSteps[i];
      const nextStep = pilotSteps[i + 1];

      // Check if current is AI/extraction
      const isExtraction =
        currentStep.type === 'ai_processing' ||
        currentStep.type === 'deterministic_extraction' ||
        (currentStep.type as string) === 'scatter_gather';

      if (!isExtraction) continue;

      // Check if next is delivery
      const isDelivery =
        nextStep.type === 'action' &&
        deliveryActions.some((action) => (nextStep as any).action?.includes(action));

      if (!isDelivery) continue;

      // Check execution trace for data quality issues
      const stepResult = executionTrace.steps[currentStep.id];
      if (!stepResult?.validation_results) continue;

      const totalRows = stepResult.output_count || stepResult.row_count || 0;
      const rowsNeedingReview = stepResult.validation_results?.needs_review_count || 0;
      const missingFieldsCount = stepResult.validation_results?.missing_fields_count || 0;

      if (rowsNeedingReview > 0 || missingFieldsCount > 0) {
        issues.push({
          id: `logic_${currentStep.id}_missing_validation`,
          type: 'missing_validation',
          severity: 'warning',
          title: 'Unvalidated Data Sent to Destination',
          description: `${rowsNeedingReview} out of ${totalRows} extracted rows have missing fields or need review, but are being sent directly without validation.`,
          affectedSteps: [
            { id: currentStep.id, name: currentStep.name },
            { id: nextStep.id, name: nextStep.name }
          ],
          evidence: {
            extractionStep: currentStep.name,
            deliveryStep: nextStep.name,
            totalRows,
            rowsNeedingReview,
            missingFieldsCount,
            validationMissing: true
          }
        });
      }
    }

    return issues;
  }

  /**
   * Extract input source from a step
   */
  private extractInputSource(step: any): string | null {
    // Check common input patterns
    if (step.input) {
      const match = step.input.match(/\{\{([^}]+)\}\}/);
      return match ? match[1] : null;
    }

    if (step.params?.values) {
      const match = step.params.values.match(/\{\{([^}]+)\}\}/);
      return match ? match[1] : null;
    }

    if (step.params?.data) {
      const match = step.params.data.match(/\{\{([^}]+)\}\}/);
      return match ? match[1] : null;
    }

    return null;
  }

  /**
   * Category 2: Inefficiency - Redundant Data Fetching
   */
  private detectRedundantFetching(
    pilotSteps: WorkflowStep[],
    executionTrace: any
  ): LogicIssue[] {
    const issues: LogicIssue[] = [];

    // Track seen action signatures
    const seenActions = new Map<string, any>();

    for (const step of pilotSteps) {
      if (step.type !== 'action') continue;

      // Create signature from plugin + action + params
      const signature = JSON.stringify({
        plugin: (step as any).plugin,
        action: (step as any).action,
        params: (step as any).params
      });

      if (seenActions.has(signature)) {
        const firstStep = seenActions.get(signature);
        issues.push({
          id: `logic_${step.id}_redundant_fetching`,
          type: 'redundant_fetching',
          severity: 'info',
          title: 'Redundant Data Fetching Detected',
          description: `Step "${step.name}" fetches the same data as "${firstStep.name}". You could reuse the data from the first step to save API calls.`,
          affectedSteps: [
            { id: firstStep.id, name: firstStep.name },
            { id: step.id, name: step.name }
          ],
          evidence: {
            firstStep: firstStep.name,
            duplicateStep: step.name,
            action: (step as any).action,
            suggestion: `Use {{${firstStep.id}.data}} instead`
          },
          impact: {
            costSaved: 'Reduces API calls'
          }
        });
      } else {
        seenActions.set(signature, step);
      }
    }

    return issues;
  }

  /**
   * Category 2: Inefficiency - Unnecessary Loops
   */
  private detectUnnecessaryLoops(
    pilotSteps: WorkflowStep[],
    executionTrace: any
  ): LogicIssue[] {
    const issues: LogicIssue[] = [];

    for (const step of pilotSteps) {
      if ((step.type as string) !== 'scatter_gather') continue;

      const scatterConfig = (step as any).scatter;
      if (!scatterConfig?.steps || scatterConfig.steps.length !== 1) continue;

      const nestedStep = scatterConfig.steps[0];
      if (nestedStep.type !== 'action') continue;

      // Check if action has batch alternative
      const action = nestedStep.action || '';
      const batchAlternatives: Record<string, string> = {
        append_row: 'append_rows',
        insert_row: 'insert_rows',
        create_record: 'create_records',
        update_row: 'update_rows'
      };

      const batchAction = batchAlternatives[action];
      if (!batchAction) continue;

      const stepResult = executionTrace?.steps?.[step.id];
      const itemCount = stepResult?.item_count || 0;

      if (itemCount > 10) {
        issues.push({
          id: `logic_${step.id}_unnecessary_loop`,
          type: 'unnecessary_loop',
          severity: 'info',
          title: 'Loop Could Be Replaced with Batch Operation',
          description: `Step "${step.name}" processes ${itemCount} items one-by-one using "${action}". Using "${batchAction}" would be much faster.`,
          affectedSteps: [{ id: step.id, name: step.name }],
          evidence: {
            itemCount,
            singleItemAction: action,
            batchAlternative: batchAction,
            estimatedSpeedup: `${Math.min(itemCount, 20)}x faster`
          },
          impact: {
            timeSaved: `${Math.min(itemCount, 20)}x faster execution`
          }
        });
      }
    }

    return issues;
  }

  /**
   * Category 3: Data Quality - Data Type Mismatches
   */
  private detectDataTypeMismatch(
    pilotSteps: WorkflowStep[],
    executionTrace: any
  ): LogicIssue[] {
    const issues: LogicIssue[] = [];

    // Look for numeric fields that might need formatting
    for (const step of pilotSteps) {
      if (step.type === 'deterministic_extraction' || step.type === 'ai_processing') {
        const schema = (step as any).output_schema;
        if (!schema?.fields) continue;

        const numericFields = schema.fields.filter(
          (f: any) => f.type === 'number' && (f.name.includes('amount') || f.name.includes('price'))
        );

        if (numericFields.length > 0) {
          issues.push({
            id: `logic_${step.id}_data_type_mismatch`,
            type: 'data_type_mismatch',
            severity: 'info',
            title: 'Numeric Fields May Need Formatting',
            description: `Step "${step.name}" outputs numeric fields like "${numericFields[0].name}" which may need currency or number formatting before delivery.`,
            affectedSteps: [{ id: step.id, name: step.name }],
            evidence: {
              numericFields: numericFields.map((f: any) => f.name),
              currentFormat: 'number',
              suggestedFormat: 'currency or formatted number'
            }
          });
        }
      }
    }

    return issues;
  }

  /**
   * Category 4: Conditional Logic - Always-True Conditions
   */
  private detectAlwaysTrueConditions(
    pilotSteps: WorkflowStep[],
    executionTrace: any
  ): LogicIssue[] {
    const issues: LogicIssue[] = [];

    if (!executionTrace?.steps) return issues;

    for (const step of pilotSteps) {
      if (step.type !== 'conditional') continue;

      const stepResult = executionTrace.steps[step.id];
      if (!stepResult?.branch_history) continue;

      const branchHistory = stepResult.branch_history;
      const thenCount = branchHistory.filter((b: string) => b === 'then').length;
      const elseCount = branchHistory.filter((b: string) => b === 'else').length;
      const total = thenCount + elseCount;

      if (total >= 5 && (thenCount === total || elseCount === total)) {
        const alwaysBranch = thenCount === total ? 'then' : 'else';
        issues.push({
          id: `logic_${step.id}_always_true_condition`,
          type: 'always_true_condition',
          severity: 'warning',
          title: 'Conditional Always Takes Same Branch',
          description: `Step "${step.name}" has taken the "${alwaysBranch}" branch ${total} times in a row. The condition may be incorrect or unnecessary.`,
          affectedSteps: [{ id: step.id, name: step.name }],
          evidence: {
            condition: (step as any).condition,
            alwaysBranch,
            thenCount,
            elseCount,
            totalExecutions: total
          }
        });
      }
    }

    return issues;
  }

  /**
   * Category 4: Conditional Logic - Unreachable Steps
   */
  private detectUnreachableSteps(
    pilotSteps: WorkflowStep[],
    executionTrace: any
  ): LogicIssue[] {
    const issues: LogicIssue[] = [];

    if (!executionTrace?.steps) return issues;

    // Find steps that have never been executed across multiple runs
    const executedSteps = new Set(Object.keys(executionTrace.steps));

    for (const step of pilotSteps) {
      if (!executedSteps.has(step.id)) {
        issues.push({
          id: `logic_${step.id}_unreachable`,
          type: 'unreachable_steps',
          severity: 'warning',
          title: 'Step Never Executes',
          description: `Step "${step.name}" has never been executed. It may be in an unreachable branch or after a terminating action.`,
          affectedSteps: [{ id: step.id, name: step.name }],
          evidence: {
            stepName: step.name,
            executionRate: '0%',
            reason: 'Never executed in calibration run'
          }
        });
      }
    }

    return issues;
  }

  /**
   * Category 5: Error Handling - Missing Error Handling for Critical Steps
   */
  private detectMissingErrorHandling(
    pilotSteps: WorkflowStep[],
    executionTrace: any
  ): LogicIssue[] {
    const issues: LogicIssue[] = [];

    if (!executionTrace?.steps) return issues;

    const criticalActions = ['charge', 'payment', 'delete', 'remove', 'transfer'];

    for (const step of pilotSteps) {
      if (step.type !== 'action') continue;

      const action = (step as any).action || '';
      const isCritical = criticalActions.some((ca) => action.includes(ca));

      if (!isCritical) continue;

      // Check if there's error handling around this step
      const stepIndex = pilotSteps.indexOf(step);
      const hasErrorHandling = pilotSteps.some(
        (s, i) => Math.abs(i - stepIndex) <= 2 && (s.type === 'conditional' || (s as any).on_error)
      );

      if (!hasErrorHandling) {
        const stepResult = executionTrace.steps[step.id];
        const failures = stepResult?.failure_count || 0;
        const total = stepResult?.execution_count || 1;

        issues.push({
          id: `logic_${step.id}_missing_error_handling`,
          type: 'missing_error_handling',
          severity: 'warning',
          title: 'Critical Step Lacks Error Handling',
          description: `Step "${step.name}" performs a critical operation (${action}) but has no error handling. Failed ${failures} out of ${total} times.`,
          affectedSteps: [{ id: step.id, name: step.name }],
          evidence: {
            action,
            isCritical: true,
            hasErrorHandling: false,
            failures,
            total,
            failureRate: `${Math.round((failures / total) * 100)}%`
          }
        });
      }
    }

    return issues;
  }

  /**
   * Category 5: Error Handling - Silent Failures
   */
  private detectSilentFailures(
    pilotSteps: WorkflowStep[],
    executionTrace: any
  ): LogicIssue[] {
    const issues: LogicIssue[] = [];

    if (!executionTrace?.steps) return issues;

    for (const step of pilotSteps) {
      const stepResult = executionTrace.steps[step.id];
      if (!stepResult) continue;

      const failures = stepResult.failure_count || 0;
      const total = stepResult.execution_count || 1;
      const failureRate = failures / total;

      if (failureRate > 0.1) {
        // >10% failure rate
        // Check if there's a notification step after this
        const stepIndex = pilotSteps.indexOf(step);
        const hasNotification = pilotSteps
          .slice(stepIndex + 1, stepIndex + 3)
          .some(
            (s) =>
              s.type === 'action' &&
              ((s as any).action?.includes('send') || (s as any).action?.includes('notify'))
          );

        if (!hasNotification) {
          issues.push({
            id: `logic_${step.id}_silent_failures`,
            type: 'silent_failures',
            severity: 'warning',
            title: 'Step Failures Are Not Reported',
            description: `Step "${step.name}" fails ${Math.round(failureRate * 100)}% of the time, but there's no notification or logging when it fails.`,
            affectedSteps: [{ id: step.id, name: step.name }],
            evidence: {
              stepName: step.name,
              failures,
              total,
              failureRate: `${Math.round(failureRate * 100)}%`,
              hasNotification: false
            }
          });
        }
      }
    }

    return issues;
  }

  /**
   * Category 6: Resource Optimization - Excessive AI Processing
   */
  private detectExcessiveAIProcessing(
    pilotSteps: WorkflowStep[],
    executionTrace: any
  ): LogicIssue[] {
    const issues: LogicIssue[] = [];

    if (!executionTrace?.steps) return issues;

    for (const step of pilotSteps) {
      if ((step.type as string) !== 'scatter_gather') continue;

      const scatterConfig = (step as any).scatter;
      if (!scatterConfig?.steps) continue;

      // Check if any nested step is AI processing
      const hasAIProcessing = scatterConfig.steps.some(
        (s: any) => s.type === 'ai_processing' || s.type === 'deterministic_extraction'
      );

      if (!hasAIProcessing) continue;

      const stepResult = executionTrace.steps[step.id];
      const totalItems = stepResult?.item_count || 0;
      const applicableItems = stepResult?.applicable_count || totalItems;
      const wastedCalls = totalItems - applicableItems;
      const wastePercentage = (wastedCalls / totalItems) * 100;

      if (wastePercentage > 50) {
        const costPerCall = 0.01; // Estimate
        const wastedCost = wastedCalls * costPerCall;

        issues.push({
          id: `logic_${step.id}_excessive_ai`,
          type: 'excessive_ai_processing',
          severity: 'warning',
          title: 'AI Processing on Irrelevant Items',
          description: `Step "${step.name}" runs AI on ${totalItems} items but only ${applicableItems} are relevant. ${wastedCalls} items (${Math.round(wastePercentage)}%) are processed unnecessarily.`,
          affectedSteps: [{ id: step.id, name: step.name }],
          evidence: {
            totalItems,
            applicableItems,
            wastedCalls,
            wastePercentage: Math.round(wastePercentage),
            suggestion: 'Add filter step before AI processing'
          },
          impact: {
            costSaved: `~$${wastedCost.toFixed(2)} per run`
          }
        });
      }
    }

    return issues;
  }

  /**
   * Category 1: Data Routing - Lost Parent Context in Scatter-Gather
   *
   * Detects when child items processed in a scatter_gather loop lose important
   * context from their parent item, causing misclassification or incorrect routing.
   *
   * Common scenario: Email with subject "Expense Report" contains attachments
   * that get classified individually by filename instead of inheriting the
   * parent's classification from the email subject.
   *
   * Generic pattern: Parent items have a classification/category field that should
   * be inherited by child items during loop processing.
   */
  private detectLostParentContext(
    pilotSteps: WorkflowStep[],
    executionTrace: any
  ): LogicIssue[] {
    const issues: LogicIssue[] = [];

    if (!executionTrace?.steps) return issues;

    // Find scatter_gather steps that process child items
    for (const step of pilotSteps) {
      if ((step.type as string) !== 'scatter_gather') continue;

      const scatterConfig = (step as any).scatter;
      if (!scatterConfig?.steps) continue;

      // Check if nested steps include extraction/AI that might classify items
      const hasClassification = scatterConfig.steps.some(
        (s: any) =>
          (s.type === 'ai_processing' || s.type === 'deterministic_extraction') &&
          (s.output_schema?.fields?.some((f: any) =>
            f.name === 'classification' || f.name === 'type' || f.name === 'category'
          ))
      );

      if (!hasClassification) continue;

      // Get the scatter_gather execution results
      const stepResult = executionTrace.steps[step.id];
      if (!stepResult?.data || !Array.isArray(stepResult.data)) continue;

      // Check if items have _parentId (indicates parent-child relationship)
      const itemsWithParent = stepResult.data.filter((item: any) => item._parentId);

      if (itemsWithParent.length === 0) continue;

      // Group items by _parentId
      const itemsByParent = new Map<string, any[]>();
      for (const item of itemsWithParent) {
        const parentId = item._parentId;
        if (!itemsByParent.has(parentId)) {
          itemsByParent.set(parentId, []);
        }
        itemsByParent.get(parentId)!.push(item);
      }

      // Check if children from the same parent have different classifications
      // AND if this appears to be incorrect (not intentional)
      let hasConflictingClassifications = false;
      let conflictExample: any = null;
      let conflictCount = 0;

      for (const [parentId, children] of itemsByParent.entries()) {
        if (children.length < 2) continue;

        // Check if all children have the same classification
        const classifications = children
          .map((c: any) => c.classification || c.type || c.category)
          .filter(Boolean);

        const uniqueClassifications = Array.from(new Set(classifications));

        if (uniqueClassifications.length > 1) {
          conflictCount++;
          if (!conflictExample) {
            hasConflictingClassifications = true;
            conflictExample = {
              parentId,
              childCount: children.length,
              classifications: uniqueClassifications,
              children: children.map((c: any) => ({
                filename: c.filename || c.name,
                classification: c.classification || c.type || c.category
              }))
            };
          }
        }
      }

      // Only flag if conflicts are widespread (>30% of parents have conflicts)
      // This prevents false positives for workflows where varying classifications are intentional
      const conflictPercentage = (conflictCount / itemsByParent.size) * 100;

      if (!hasConflictingClassifications || conflictPercentage < 30) {
        continue;
      }

      // Try to find the parent data source to check if parent has classification
      const scatterInput = scatterConfig.input || scatterConfig.over;
      const parentStepId = scatterInput?.match(/\{\{([^.]+)/)?.[1];
      const parentResult = parentStepId ? executionTrace.steps[parentStepId] : null;

      // Check if parent items have classification-like fields
      let parentHasClassification = false;
      if (parentResult?.data && Array.isArray(parentResult.data) && parentResult.data.length > 0) {
        const sampleParent = parentResult.data[0];
        parentHasClassification = !!(
          sampleParent.classification ||
          sampleParent.type ||
          sampleParent.category ||
          sampleParent.subject
        );
      }

      // CRITICAL: Only flag if parent HAS classification that could be inherited
      // If parent doesn't have classification context, children MUST classify independently
      if (!parentHasClassification) {
        continue;
      }

      // FOUND ISSUE: Children have conflicting classifications from same parent
      // AND parent has classification that should be inherited
      issues.push({
        id: `logic_${step.id}_lost_parent_context`,
        type: 'lost_parent_context',
        severity: 'critical',
        title: 'Child Items Lose Parent Classification',
        description: `Items processed from the same parent are being classified differently. This suggests the classification logic is looking at individual items (e.g., filenames) instead of inheriting context from the parent (e.g., email subject).`,
        affectedSteps: [{ id: step.id, name: step.name }],
        evidence: {
          scatterGatherStep: step.name,
          totalParents: itemsByParent.size,
          conflictExample,
          parentHasClassification,
          parentStepId,
          suggestion: parentHasClassification
            ? 'Extract parent classification before loop and pass it to child extraction'
            : 'Add classification field to parent items before scatter_gather'
        },
        userOptions: [
          {
            id: 'inherit_parent_classification',
            label: 'Inherit parent classification',
            description: 'Automatically pass the parent\'s classification to all child items during loop processing'
          },
          {
            id: 'add_parent_context',
            label: 'Add parent context to extraction',
            description: 'Update the extraction instruction to consider parent context when classifying child items'
          },
          {
            id: 'no_fix_needed',
            label: 'Classification is correct',
            description: 'Child items should be classified independently - this behavior is intentional'
          }
        ]
      });
    }

    return issues;
  }

  /**
   * Category 1: Data Routing - Missing Context in Flatten
   *
   * Detects when a flatten operation loses fields from the parent that are
   * later referenced or needed by downstream steps.
   *
   * Detection approach (NO HARDCODING):
   * 1. Compare parent fields BEFORE flatten with child fields AFTER flatten
   * 2. Find which parent fields were dropped
   * 3. Check if downstream steps reference those dropped fields
   * 4. Check if downstream AI extraction has conflicting classifications (signal that context is missing)
   */
  private detectMissingContextInFlatten(
    pilotSteps: WorkflowStep[],
    executionTrace: any
  ): LogicIssue[] {
    const issues: LogicIssue[] = [];

    if (!executionTrace?.steps) return issues;

    // Find flatten steps
    for (let i = 0; i < pilotSteps.length; i++) {
      const step = pilotSteps[i];
      if (step.type !== 'transform' || (step as any).operation !== 'flatten') continue;

      const flattenConfig = (step as any).config;
      if (!flattenConfig?.field) continue;

      // Get the input step to check what fields existed before flatten
      const inputMatch = ((step as any).input || '').match(/\{\{([^.}]+)/);
      if (!inputMatch) continue;

      const inputStepId = inputMatch[1];
      const inputResult = executionTrace.steps[inputStepId];
      const flattenResult = executionTrace.steps[step.id];

      if (!inputResult?.data || !Array.isArray(inputResult.data) || inputResult.data.length === 0) continue;
      if (!flattenResult?.data || !Array.isArray(flattenResult.data) || flattenResult.data.length === 0) continue;

      // Compare parent vs flattened fields
      const sampleParent = inputResult.data[0];
      const sampleFlattened = flattenResult.data[0];

      const parentFields = Object.keys(sampleParent || {});
      const flattenedFields = Object.keys(sampleFlattened || {});

      // Find fields that existed in parent but are missing in flattened output
      const lostFields = parentFields.filter(f =>
        !flattenedFields.includes(f) &&
        f !== flattenConfig.field && // The flattened field itself is expected to be gone
        typeof sampleParent[f] !== 'object' // Only care about primitive fields
      );

      if (lostFields.length === 0) continue;

      // Check if any downstream steps reference these lost fields
      let downstreamReferences: Array<{stepId: string; stepName: string; field: string}> = [];

      for (let j = i + 1; j < pilotSteps.length; j++) {
        const laterStep = pilotSteps[j];
        const stepStr = JSON.stringify(laterStep);

        for (const lostField of lostFields) {
          // Check if step references this field (e.g., item.subject, {{field}}, etc.)
          if (stepStr.includes(lostField)) {
            downstreamReferences.push({
              stepId: laterStep.id,
              stepName: laterStep.name,
              field: lostField
            });
          }
        }
      }

      // Also check if there's downstream AI classification showing conflicts
      // (indirect evidence that context is missing)
      let hasDownstreamClassificationConflicts = false;

      for (let j = i + 1; j < pilotSteps.length; j++) {
        const laterStep = pilotSteps[j];
        if ((laterStep.type as string) !== 'scatter_gather') continue;

        const laterResult = executionTrace.steps[laterStep.id];
        if (!laterResult?.data || !Array.isArray(laterResult.data)) continue;

        // Check if items from same parent have different classifications
        const itemsByParent = new Map<string, any[]>();
        for (const item of laterResult.data) {
          if (!item._parentId) continue;
          if (!itemsByParent.has(item._parentId)) {
            itemsByParent.set(item._parentId, []);
          }
          itemsByParent.get(item._parentId)!.push(item);
        }

        for (const [parentId, children] of itemsByParent.entries()) {
          if (children.length < 2) continue;

          const classifications = children
            .map((c: any) => c.classification || c.type || c.category)
            .filter(Boolean);

          const uniqueClassifications = Array.from(new Set(classifications));
          if (uniqueClassifications.length > 1) {
            hasDownstreamClassificationConflicts = true;
            break;
          }
        }
      }

      // Only flag if there's evidence that lost fields matter
      if (downstreamReferences.length === 0 && !hasDownstreamClassificationConflicts) {
        continue;
      }

      // FOUND ISSUE: Flatten lost fields that are referenced downstream
      issues.push({
        id: `logic_${step.id}_missing_context_in_flatten`,
        type: 'missing_context_in_flatten',
        severity: downstreamReferences.length > 0 ? 'critical' : 'warning',
        title: 'Flatten Loses Fields Needed by Downstream Steps',
        description: downstreamReferences.length > 0
          ? `Step "${step.name}" flattens "${flattenConfig.field}" but drops ${lostFields.length} parent fields (${lostFields.slice(0, 3).join(', ')}). Downstream steps reference these fields: ${downstreamReferences.slice(0, 2).map(r => `${r.stepName} uses ${r.field}`).join(', ')}.`
          : `Step "${step.name}" flattens "${flattenConfig.field}" and drops ${lostFields.length} parent fields. Downstream AI classification shows conflicts, suggesting missing parent context.`,
        affectedSteps: [
          { id: step.id, name: step.name },
          ...downstreamReferences.slice(0, 3).map(r => ({ id: r.stepId, name: r.stepName }))
        ],
        evidence: {
          flattenStep: step.name,
          flattenField: flattenConfig.field,
          lostFields,
          downstreamReferences,
          hasClassificationConflicts: hasDownstreamClassificationConflicts,
          suggestion: `Modify flatten config to preserve parent fields: { ...parentItem, ...flattenedItem }`
        },
        userOptions: [
          {
            id: 'preserve_all_parent_fields',
            label: 'Preserve all parent fields',
            description: `Keep all ${lostFields.length} parent fields when flattening`
          },
          {
            id: 'preserve_referenced_fields',
            label: 'Preserve only referenced fields',
            description: downstreamReferences.length > 0
              ? `Keep only the ${downstreamReferences.length} fields that are used downstream`
              : 'Preserve fields based on usage analysis'
          },
          {
            id: 'no_fix_needed',
            label: 'Fields not needed',
            description: 'These fields are not actually needed - false positive'
          }
        ]
      });
    }

    return issues;
  }

  /**
   * Category 1: Data Routing - Missing Deduplication
   *
   * Detects when a workflow will create duplicate entries if run multiple times.
   *
   * Detection approach (NO HARDCODING):
   * 1. Find delivery steps that append/insert data
   * 2. Trace backwards to find the data source
   * 3. Check if there's ANY filter/check between source and delivery
   * 4. Look for patterns: lookups, "not in" filters, existence checks
   */
  private detectMissingDeduplication(
    pilotSteps: WorkflowStep[],
    executionTrace: any
  ): LogicIssue[] {
    const issues: LogicIssue[] = [];

    if (!executionTrace?.steps) return issues;

    // Find delivery steps (append/insert/create)
    for (let i = 0; i < pilotSteps.length; i++) {
      const step = pilotSteps[i];

      if (step.type !== 'action') continue;

      const action = (step as any).action || '';
      const isDelivery = action.includes('append') || action.includes('insert') ||
                        action.includes('create') || action.includes('write');

      if (!isDelivery) continue;

      // Check if there's ANY kind of deduplication logic before this step
      let hasDeduplication = false;

      for (let j = 0; j < i; j++) {
        const earlierStep = pilotSteps[j];

        // Check for filter steps
        if (earlierStep.type === 'transform' && (earlierStep as any).operation === 'filter') {
          const condition = (earlierStep as any).config?.condition || '';
          // Look for deduplication patterns (not exhaustive, just signals)
          if (condition.includes('not') || condition.includes('!') ||
              condition.includes('exists') || condition.includes('in')) {
            hasDeduplication = true;
            break;
          }
        }

        // Check for lookup/check actions
        if (earlierStep.type === 'action') {
          const earlierAction = (earlierStep as any).action || '';
          if (earlierAction.includes('lookup') || earlierAction.includes('check') ||
              earlierAction.includes('exists') || earlierAction.includes('find') ||
              earlierAction.includes('search')) {
            hasDeduplication = true;
            break;
          }
        }
      }

      if (hasDeduplication) continue;

      // Check if the data source is something that could produce duplicates
      // (e.g., fetch from external source, not from user input)
      let dataSourceStep: any = null;

      for (let j = i - 1; j >= 0; j--) {
        const earlierStep = pilotSteps[j];
        if (earlierStep.type === 'action') {
          const earlierAction = (earlierStep as any).action || '';
          // External data sources
          if (earlierAction.includes('list') || earlierAction.includes('search') ||
              earlierAction.includes('fetch') || earlierAction.includes('get') ||
              earlierAction.includes('query') || earlierAction.includes('read')) {
            dataSourceStep = earlierStep;
            break;
          }
        }
      }

      if (!dataSourceStep) continue;

      // Get item count from execution
      const dataSourceResult = executionTrace.steps[dataSourceStep.id];
      const itemCount = dataSourceResult?.data?.length || dataSourceResult?.itemCount || 0;

      if (itemCount === 0) continue;

      // FOUND ISSUE: No deduplication between external source and delivery
      issues.push({
        id: `logic_${dataSourceStep.id}_missing_deduplication`,
        type: 'missing_deduplication',
        severity: 'warning',
        title: 'No Deduplication - May Create Duplicates',
        description: `Workflow fetches ${itemCount} items from "${dataSourceStep.name}" and delivers to "${step.name}" without checking for duplicates. Running this workflow multiple times on the same data will create duplicate entries.`,
        affectedSteps: [
          { id: dataSourceStep.id, name: dataSourceStep.name },
          { id: step.id, name: step.name }
        ],
        evidence: {
          dataSourceStep: dataSourceStep.name,
          deliveryStep: step.name,
          itemCount,
          noFilterFound: true,
          suggestion: 'Add a filter to exclude already-processed items, or use a unique constraint in the delivery destination'
        },
        userOptions: [
          {
            id: 'add_deduplication',
            label: 'Add deduplication logic',
            description: 'Add a step to filter out items that were already processed'
          },
          {
            id: 'runs_once',
            label: 'Workflow only runs once',
            description: 'This workflow is designed to run only once, not repeatedly'
          },
          {
            id: 'handled_externally',
            label: 'Handled by destination',
            description: 'The destination system prevents duplicates (e.g., unique constraint, idempotent insert)'
          }
        ]
      });
    }

    return issues;
  }
}
