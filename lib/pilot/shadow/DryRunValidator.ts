/**
 * DryRunValidator - Layer 3 Context-Aware Validation
 *
 * Executes workflow with REAL user input data to detect runtime issues:
 * - Empty results due to type mismatches (plugin returns object, step expects array)
 * - API errors (permissions, invalid IDs, rate limits)
 * - Workflow execution failures
 *
 * This validator catches issues that schema validation CANNOT detect because they
 * depend on actual runtime data shapes and API responses.
 *
 * @module lib/pilot/shadow/DryRunValidator
 */

import { createLogger } from '@/lib/logger';
import type { Agent as RepoAgent } from '@/lib/repositories/types';
import type { Agent as PilotAgent, WorkflowExecutionResult } from '@/lib/pilot/types';
import { WorkflowPilot } from '@/lib/pilot/WorkflowPilot';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'DryRunValidator', service: 'shadow-agent' });

export interface DryRunIssue {
  type: 'empty_result' | 'execution_failed' | 'steps_failed';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  details?: any;
  suggestedFix?: string;
}

export interface DryRunResult {
  success: boolean;
  finalOutput: any;
  isEmpty: boolean;
  stepsCompleted: number;
  stepsFailed: number;
  issues: DryRunIssue[];
  executionTime: number;
  workflowType?: 'monitoring' | 'alert' | 'data-processing' | 'unknown';
}

/**
 * DryRunValidator - Executes workflow with real user data to detect runtime issues
 */
export class DryRunValidator {

  /**
   * Validate workflow by executing it with real user input data
   *
   * @param agent - Agent with pilot_steps to execute
   * @param inputValues - REAL user input values (Google Drive folder ID, etc.)
   * @param userId - User ID for plugin authentication
   * @returns Dry run results with detected issues
   */
  async validateWithDryRun(
    agent: RepoAgent,
    inputValues: Record<string, any>,
    userId: string
  ): Promise<DryRunResult> {
    const startTime = Date.now();
    const issues: DryRunIssue[] = [];

    logger.info({
      agentId: agent.id,
      agentName: agent.agent_name,
      inputValues
    }, '[Layer 3] Starting dry run with real user data');

    try {
      // Execute workflow with real data in calibration mode
      // This will execute all steps but collect issues instead of throwing errors
      const pilot = new WorkflowPilot(supabaseServer);

      // Cast RepoAgent to PilotAgent (they're compatible at runtime)
      const pilotAgent = agent as any as PilotAgent;

      const executionResult: WorkflowExecutionResult = await pilot.execute(
        pilotAgent,
        userId,
        '', // userInput not needed for validation
        inputValues,
        undefined, // sessionId
        undefined, // stepEmitter
        false, // debugMode
        undefined, // providedDebugRunId
        undefined, // providedExecutionId
        'batch_calibration' // runMode - collects issues, continues on errors
      );

      logger.info({
        agentId: agent.id,
        success: executionResult.success,
        stepsCompleted: executionResult.stepsCompleted,
        stepsFailed: executionResult.stepsFailed,
        output: executionResult.output
      }, '[Layer 3] Workflow execution complete');

      // Analyze execution result
      const isEmpty = this.isEmptyResult(executionResult.output);
      const workflowType = this.classifyWorkflowType(agent);

      // Check if execution succeeded but returned empty results
      if (executionResult.success && isEmpty) {
        const isExpectedEmpty = this.isEmptyExpected(workflowType);

        if (!isExpectedEmpty) {
          issues.push({
            type: 'empty_result',
            severity: 'high',
            description: `Workflow executed successfully but returned empty results. This may indicate a type mismatch (e.g., plugin returns object but next step expects array) or incorrect field references.`,
            details: {
              finalOutput: executionResult.output,
              stepsCompleted: executionResult.stepsCompleted
            },
            suggestedFix: 'Check if transform steps are accessing the correct fields from upstream plugin outputs. Look for object vs array mismatches.'
          });
        }
      }

      // Check if any steps failed
      if (executionResult.stepsFailed > 0) {
        issues.push({
          type: 'steps_failed',
          severity: 'critical',
          description: `${executionResult.stepsFailed} step(s) failed during execution. Check for API errors, permission issues, or invalid input data.`,
          details: {
            failedStepIds: executionResult.failedStepIds,
            stepsCompleted: executionResult.stepsCompleted,
            stepsFailed: executionResult.stepsFailed
          }
        });
      }

      // Check if execution completely failed
      if (!executionResult.success) {
        issues.push({
          type: 'execution_failed',
          severity: 'critical',
          description: `Workflow execution failed. This may be due to API errors, invalid credentials, or missing required data.`,
          details: {
            stepsCompleted: executionResult.stepsCompleted,
            stepsFailed: executionResult.stepsFailed,
            output: executionResult.output
          }
        });
      }

      const executionTime = Date.now() - startTime;

      logger.info({
        agentId: agent.id,
        stepsCompleted: executionResult.stepsCompleted,
        stepsFailed: executionResult.stepsFailed,
        isEmpty,
        issuesFound: issues.length,
        executionTime
      }, '[Layer 3] Dry run validation complete');

      return {
        success: executionResult.success,
        finalOutput: executionResult.output,
        isEmpty,
        stepsCompleted: executionResult.stepsCompleted,
        stepsFailed: executionResult.stepsFailed,
        issues,
        executionTime,
        workflowType
      };

    } catch (error: any) {
      logger.error({
        error: error.message,
        agentId: agent.id
      }, '[Layer 3] Dry run execution failed');

      return {
        success: false,
        finalOutput: null,
        isEmpty: true,
        stepsCompleted: 0,
        stepsFailed: 0,
        issues: [{
          type: 'execution_failed',
          severity: 'critical',
          description: `Dry run execution failed: ${error.message}`,
          details: {
            error: error.message,
            stack: error.stack
          }
        }],
        executionTime: Date.now() - startTime,
        workflowType: 'unknown'
      };
    }
  }

  /**
   * Check if result is empty
   */
  private isEmptyResult(output: any): boolean {
    if (output === null || output === undefined) return true;
    if (Array.isArray(output) && output.length === 0) return true;
    if (typeof output === 'object' && Object.keys(output).length === 0) return true;
    if (typeof output === 'string' && output.trim() === '') return true;
    return false;
  }

  /**
   * Check if empty result is expected for this workflow type
   */
  private isEmptyExpected(workflowType: string): boolean {
    // Monitoring and alert workflows can legitimately return empty (no issues found)
    return workflowType === 'monitoring' || workflowType === 'alert';
  }

  /**
   * Classify workflow type from agent description
   */
  private classifyWorkflowType(agent: RepoAgent): 'monitoring' | 'alert' | 'data-processing' | 'unknown' {
    const description = (agent.description || '').toLowerCase();
    const name = (agent.agent_name || '').toLowerCase();

    if (description.includes('monitor') || description.includes('alert') || description.includes('notify')) {
      return 'monitoring';
    }

    if (description.includes('process') || description.includes('transform') || description.includes('extract')) {
      return 'data-processing';
    }

    if (name.includes('monitor') || name.includes('alert')) {
      return 'alert';
    }

    return 'unknown';
  }
}
