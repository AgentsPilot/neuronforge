/**
 * ResumeOrchestrator — Failure detection, repair proposal, and in-memory
 * step resume during calibration.
 *
 * This is the single entry point for handling step failures during
 * Shadow Agent-monitored executions. It orchestrates:
 *
 * 1. Failure capture and classification (via ShadowAgent)
 * 2. Early stop check (via ExecutionProtection)
 * 3. Repair eligibility check (via ExecutionProtection)
 * 4. Repair attempt (via ShadowAgent → RepairEngine for data_shape_mismatch)
 * 5. Resume decision (retry / skip / stop / fallback)
 *
 * Failure Category → Resume Action mapping:
 *
 * | Category              | Auto-Fix? | Resume Action               |
 * |-----------------------|-----------|-----------------------------|
 * | execution_error       | Partial   | retry (if retryable) / stop |
 * | data_shape_mismatch   | Yes       | retry (after repair)        |
 * | invalid_step_order    | No        | stop                        |
 * | data_unavailable      | No        | stop                        |
 * | capability_mismatch   | No        | stop                        |
 * | logic_error           | No        | stop                        |
 * | missing_step          | No        | stop                        |
 *
 * CRITICAL: Never stores client data. All repairs happen in-memory.
 * All errors within this orchestrator are caught — never blocks main execution.
 *
 * @module lib/pilot/shadow/ResumeOrchestrator
 */

import { ShadowAgent } from './ShadowAgent';
import { CheckpointManager } from './CheckpointManager';
import { ExecutionProtection } from './ExecutionProtection';
import { DataDecisionHandler } from './DataDecisionHandler';
import { MemoryManager } from '../insight/MemoryManager';
import type { ExecutionContext } from '../ExecutionContext';
import type { StepOutput } from '../types';
import type {
  FailureClassification,
  ResumeDecision,
  RepairResult,
  StepFailureContext,
  DataDecisionContext,
} from './types';

/** Step definition shape used by the orchestrator (subset of full step def) */
interface StepDef {
  id: string;
  name: string;
  type?: string;
  dependencies?: string[];
  input?: string;
  params?: Record<string, any>;
  retryPolicy?: any;
}

export class ResumeOrchestrator {
  constructor(
    private shadowAgent: ShadowAgent,
    private checkpointManager: CheckpointManager,
    private executionProtection: ExecutionProtection | null
  ) {}

  /**
   * Sanitize data for logging by truncating large base64 strings and file content
   */
  private sanitizeForLogging(data: any, maxLength: number = 200): any {
    if (!data) return data;

    if (typeof data === 'string') {
      if (data.length > maxLength) {
        return `[String truncated - ${data.length} chars]`;
      }
      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeForLogging(item, maxLength));
    }

    if (typeof data === 'object') {
      const sanitized: any = {};

      for (const [key, value] of Object.entries(data)) {
        // Detect file content fields
        if (key === '_content' && value && typeof value === 'object') {
          const content = value as any;
          sanitized[key] = {
            filename: content.filename,
            mimeType: content.mimeType,
            size: content.size,
            is_image: content.is_image,
            data: content.data ? `[Base64 data - ${content.data.length} bytes]` : undefined,
            extracted_text: content.extracted_text ?
              (content.extracted_text.length > 100 ? content.extracted_text.substring(0, 100) + '...' : content.extracted_text)
              : undefined
          };
        } else if (key === 'data' && typeof value === 'string' && value.length > 1000) {
          sanitized[key] = `[Data truncated - ${value.length} chars]`;
        } else if (key === 'content' && typeof value === 'string' && value.length > 1000) {
          sanitized[key] = `[Content truncated - ${value.length} chars]`;
        } else {
          sanitized[key] = this.sanitizeForLogging(value, maxLength);
        }
      }

      return sanitized;
    }

    return data;
  }

  /**
   * Handle a step failure: capture, classify, attempt repair, decide resume action.
   *
   * This is the single entry point called by WorkflowPilot when a step fails
   * during a Shadow Agent-monitored execution.
   *
   * @param executionId - The current execution ID
   * @param stepDef - The step definition that failed
   * @param error - The error from step execution
   * @param context - Live ExecutionContext (in-memory step data accessible)
   * @param stepOutput - The failed step's output (contains error metadata)
   * @returns ResumeDecision telling the caller what to do next
   */
  async handleStepFailure(
    executionId: string,
    stepDef: StepDef,
    error: { message: string; code?: string },
    context: ExecutionContext,
    stepOutput: StepOutput
  ): Promise<ResumeDecision> {
    try {
      // 1. Capture failure and get classification
      const captureResult = await this.shadowAgent.captureFailure(
        executionId,
        error,
        this.buildStepContext(stepDef, stepOutput, context),
        {
          totalTokensUsed: context.totalTokensUsed,
          totalExecutionTimeMs: context.totalExecutionTime,
        }
      );

      const classification = captureResult.classification;

      // 2. Create checkpoint at failure point (metadata only)
      this.checkpointManager.createStepCheckpoint(context, stepDef.id);

      // 3. Check for early stop (non-recoverable failures during calibration)
      if (this.executionProtection?.shouldEarlyStop(classification)) {
        console.log(
          `[ResumeOrchestrator] Early stop: ${classification.category} is non-recoverable`
        );
        return {
          action: 'stop_execution',
          reason: `Non-recoverable failure: ${classification.category}`,
          repairApplied: false,
          classification,
        };
      }

      // 4. Determine resume action based on failure category
      return await this.decideResumeAction(
        classification,
        stepDef,
        context,
        stepOutput,
        executionId
      );
    } catch (err) {
      // ResumeOrchestrator must NEVER block the main execution flow
      console.error('[ResumeOrchestrator] handleStepFailure failed (non-blocking):', err);
      return {
        action: 'stop_execution',
        reason: 'ResumeOrchestrator internal error — falling back to stop',
        repairApplied: false,
        classification: {
          category: 'execution_error',
          is_auto_retryable: false,
          severity: 'high',
        },
      };
    }
  }

  // ─── Private: Decision Logic ──────────────────────────────

  /**
   * Decide the resume action based on failure classification.
   */
  private async decideResumeAction(
    classification: FailureClassification,
    stepDef: StepDef,
    context: ExecutionContext,
    stepOutput: StepOutput,
    executionId: string
  ): Promise<ResumeDecision> {
    switch (classification.category) {
      case 'data_shape_mismatch':
        return this.handleDataShapeMismatch(classification, stepDef, context);

      case 'execution_error':
        return this.handleExecutionError(classification, stepDef, context, stepOutput, executionId);

      case 'data_unavailable':
        // Phase 4: Ask user what to do with empty/missing data
        return this.handleDataUnavailable(classification, stepDef, context, stepOutput, executionId);

      case 'capability_mismatch':
        return {
          action: 'stop_execution',
          reason: `Capability mismatch at step "${stepDef.name}" — plugin cannot perform requested action`,
          repairApplied: false,
          classification,
        };

      case 'logic_error':
        return {
          action: 'stop_execution',
          reason: `Logic error at step "${stepDef.name}" — conditional logic broken`,
          repairApplied: false,
          classification,
        };

      case 'missing_step':
        return {
          action: 'stop_execution',
          reason: `Missing required step detected at "${stepDef.name}"`,
          repairApplied: false,
          classification,
        };

      case 'invalid_step_order':
        return {
          action: 'stop_execution',
          reason: `Invalid step order at "${stepDef.name}" — dependencies not met`,
          repairApplied: false,
          classification,
        };

      default:
        return {
          action: 'stop_execution',
          reason: `Unknown failure category: ${classification.category}`,
          repairApplied: false,
          classification,
        };
    }
  }

  /**
   * Handle data_shape_mismatch: attempt repair via RepairEngine,
   * then decide to retry or stop.
   */
  private async handleDataShapeMismatch(
    classification: FailureClassification,
    stepDef: StepDef,
    context: ExecutionContext
  ): Promise<ResumeDecision> {
    // Check if repair is allowed (limits + identical failure check)
    const canRepair = this.executionProtection
      ? await this.executionProtection.canAttemptRepair(stepDef.id, classification)
      : true;

    if (!canRepair) {
      return {
        action: 'stop_execution',
        reason: `Repair not allowed for step "${stepDef.name}" — limit reached or identical failure`,
        repairApplied: false,
        classification,
      };
    }

    // Attempt repair via ShadowAgent → RepairEngine
    const repairResult = this.shadowAgent.attemptRepair(
      classification,
      stepDef,
      (id) => context.getStepOutput(id),
      (id, out) => context.setStepOutput(id, out),
      [...context.completedSteps]
    );

    // Record the attempt
    this.executionProtection?.recordRepairAttempt(stepDef.id);

    if (repairResult && repairResult.dataModified) {
      console.log(
        `[ResumeOrchestrator] Repair applied: ${repairResult.proposal.action}` +
        ` — recommending retry for step "${stepDef.name}"`
      );
      return {
        action: 'retry_step',
        reason: `Data shape repair applied: ${repairResult.proposal.description}`,
        repairApplied: true,
        repairDetails: repairResult,
        classification,
      };
    }

    // Repair not applicable or failed to modify data
    return {
      action: 'stop_execution',
      reason: repairResult
        ? `Repair not applicable: ${repairResult.proposal.description}`
        : 'No repair available for data shape mismatch',
      repairApplied: false,
      repairDetails: repairResult || undefined,
      classification,
    };
  }

  /**
   * Handle execution_error: retry if transient, stop otherwise.
   */
  private async handleExecutionError(
    classification: FailureClassification,
    stepDef: StepDef,
    context: ExecutionContext,
    stepOutput: StepOutput,
    executionId: string
  ): Promise<ResumeDecision> {
    // Check if this is a parameter error that we can ask the user to fix
    const parameterError = this.detectParameterError(stepOutput);

    if (parameterError) {
      // This is a parameter/configuration error - store metadata for frontend
      console.log(`[ResumeOrchestrator] ✅ Parameter error detected: ${parameterError.parameterName} = ${parameterError.problematicValue}`);

      // Store parameter error details in step output metadata so frontend can show fix UI
      const metadata = stepOutput.metadata as any;
      if (metadata) {
        metadata.parameter_error_details = parameterError;
        metadata.failure_category = 'parameter_error';
        console.log('[ResumeOrchestrator] ✅ Stored parameter_error_details in metadata:', JSON.stringify(metadata.parameter_error_details));
        console.log('[ResumeOrchestrator] ✅ Full metadata after update:', JSON.stringify(metadata, null, 2));
      } else {
        console.log('[ResumeOrchestrator] ❌ WARNING: metadata is null/undefined, cannot store parameter_error_details');
      }

      // Stop execution - user must fix the parameter value
      return {
        action: 'stop_execution',
        reason: `Parameter error: ${parameterError.parameterName} = "${parameterError.problematicValue}" is invalid`,
        repairApplied: false,
        classification,
      };
    }

    // Standard execution error handling
    if (classification.is_auto_retryable) {
      return {
        action: 'retry_step',
        reason: `Retryable execution error at step "${stepDef.name}" (${classification.sub_type || 'transient'})`,
        repairApplied: false,
        classification,
      };
    }

    return {
      action: 'stop_execution',
      reason: `Non-retryable execution error at step "${stepDef.name}" (${classification.sub_type || 'unknown'})`,
      repairApplied: false,
      classification,
    };
  }

  /**
   * Handle data_unavailable: check for existing rule, pause if needed, wait for user.
   * Phase 4: Delegates to DataDecisionHandler for pause-ask-resume flow.
   */
  private async handleDataUnavailable(
    classification: FailureClassification,
    stepDef: StepDef,
    context: ExecutionContext,
    stepOutput: StepOutput,
    executionId: string
  ): Promise<ResumeDecision> {
    try {
      // Extract data field from step output
      const dataField = this.detectDataField(stepOutput);

      // Determine operator based on output
      const operator = this.detectOperator(stepOutput);

      // Get supabase client and user ID from context
      // Note: We need to access these from the ShadowAgent instance
      const supabase = (this.shadowAgent as any).supabase;
      const userId = (this.shadowAgent as any).userId;
      const agentId = (this.shadowAgent as any).agentId;

      if (!supabase || !userId || !agentId) {
        console.error('[ResumeOrchestrator] Missing required context for DataDecisionHandler');
        return {
          action: 'stop_execution',
          reason: `Data unavailable at step "${stepDef.name}" — missing context for decision handler`,
          repairApplied: false,
          classification,
        };
      }

      // Create DataDecisionHandler with MemoryManager
      const memoryManager = new MemoryManager(supabase);
      const decisionHandler = new DataDecisionHandler(supabase, memoryManager);

      // Build decision context (metadata only — NO client data)
      const decisionContext: DataDecisionContext = {
        stepId: stepDef.id,
        stepName: stepDef.name,
        plugin: stepOutput.plugin || 'unknown',
        action: stepOutput.action || 'unknown',
        dataField,
        operator,
      };

      // Call DataDecisionHandler to handle the pause-ask-resume flow
      const result = await decisionHandler.handleDataUnavailable(
        executionId,
        agentId,
        userId,
        decisionContext,
        classification
      );

      // Map DataDecisionResult to ResumeDecision
      let action: ResumeDecision['action'];
      let reason: string;

      switch (result.decision) {
        case 'continue':
          action = 'continue_with_fallback';
          reason = result.ruleApplied
            ? `Behavior rule applied: continue with empty ${dataField}`
            : `User decision: continue with empty ${dataField}`;
          break;
        case 'stop':
          action = 'stop_execution';
          reason = result.ruleApplied
            ? `Behavior rule applied: stop on empty ${dataField}`
            : `User decision: stop on empty ${dataField}`;
          break;
        case 'skip':
          action = 'skip_step';
          reason = result.ruleApplied
            ? `Behavior rule applied: skip remaining steps`
            : `User decision: skip remaining steps`;
          break;
        default:
          action = 'stop_execution';
          reason = `Unknown decision: ${result.decision}`;
      }

      return {
        action,
        reason,
        repairApplied: false,
        classification,
      };
    } catch (err) {
      console.error('[ResumeOrchestrator] handleDataUnavailable failed (non-blocking):', err);
      return {
        action: 'stop_execution',
        reason: `Data unavailable at step "${stepDef.name}" — decision handler error`,
        repairApplied: false,
        classification,
      };
    }
  }

  // ─── Private: Helpers ─────────────────────────────────────

  /**
   * Build StepFailureContext from step definition and execution state.
   * Metadata only — no client data.
   */
  private buildStepContext(
    stepDef: StepDef,
    stepOutput: StepOutput,
    context: ExecutionContext
  ): StepFailureContext {
    return {
      stepId: stepDef.id,
      stepName: stepDef.name,
      stepType: stepDef.type || 'action',
      plugin: stepOutput.plugin,
      action: stepOutput.action,
      availableVariableKeys: Object.keys(context.variables || {}),
      completedSteps: [...context.completedSteps],
      retryCount: 0, // ErrorRecovery retries happen before Shadow Agent
    };
  }

  /**
   * Detect the data field that has the issue from step output.
   * Phase 4: Simple heuristic — look for array/object fields.
   * Phase 5: More sophisticated detection based on expected schema.
   *
   * @private
   */
  private detectDataField(stepOutput: StepOutput): string {
    // Look at step output data structure
    if (stepOutput.data && typeof stepOutput.data === 'object') {
      // Find array fields (most common case for data_unavailable)
      const keys = Object.keys(stepOutput.data);
      for (const key of keys) {
        if (Array.isArray(stepOutput.data[key])) {
          return key; // Return first array field found
        }
      }

      // If no arrays, return first key
      if (keys.length > 0) {
        return keys[0];
      }
    }

    // Fallback
    return 'data';
  }

  /**
   * Detect the operator type (empty/missing/null) from step output.
   * Phase 4: Simple detection based on output structure.
   *
   * @private
   */
  private detectOperator(stepOutput: StepOutput): 'empty' | 'missing' | 'null' {
    if (!stepOutput.data) {
      return 'missing';
    }

    if (stepOutput.data === null) {
      return 'null';
    }

    // If data exists but is an empty array or empty object
    if (Array.isArray(stepOutput.data) && stepOutput.data.length === 0) {
      return 'empty';
    }

    if (typeof stepOutput.data === 'object') {
      const keys = Object.keys(stepOutput.data);
      for (const key of keys) {
        const value = stepOutput.data[key];
        if (Array.isArray(value) && value.length === 0) {
          return 'empty';
        }
      }
    }

    // Default to empty
    return 'empty';
  }

  /**
   * Detect if execution error is a parameter/configuration error that user can fix.
   * Examples: "Range 'X' not found", "Spreadsheet 'Y' not found", "Column 'Z' not found"
   *
   * @private
   */
  private detectParameterError(stepOutput: StepOutput): { parameterName: string; problematicValue: string; errorMessage: string } | null {
    // Get error message from metadata (StepOutputMetadata.error field)
    const errorMsg = stepOutput.metadata?.error || '';
    const errorMsgLower = errorMsg.toLowerCase();

    console.log('=== [ResumeOrchestrator] detectParameterError START ===');
    console.log('[ResumeOrchestrator] Full stepOutput:', JSON.stringify(this.sanitizeForLogging(stepOutput), null, 2));
    console.log('[ResumeOrchestrator] Error message:', errorMsg);
    console.log('[ResumeOrchestrator] Error message (lowercase):', errorMsgLower);

    // Pattern 1: "Range 'UrgentEmails1' not found" or "Unable to parse range: UrgentEmails1"
    if (errorMsgLower.includes('range') && (errorMsgLower.includes('not found') || errorMsgLower.includes('unable to parse'))) {
      const rangeMatch = errorMsg.match(/range[:\s]+['"]?([^'"]+)['"]?/i) || errorMsg.match(/['"]([^'"]+)['"]?\s+not found/i);
      if (rangeMatch) {
        return {
          parameterName: 'range',
          problematicValue: rangeMatch[1].trim(),
          errorMessage: errorMsg,
        };
      }
    }

    // Pattern 2: "Spreadsheet 'xxx' not found"
    if (errorMsgLower.includes('spreadsheet') && errorMsgLower.includes('not found')) {
      const spreadsheetMatch = errorMsg.match(/spreadsheet[:\s]+['"]?([^'"]+)['"]?/i);
      if (spreadsheetMatch) {
        return {
          parameterName: 'spreadsheet_id',
          problematicValue: spreadsheetMatch[1].trim(),
          errorMessage: errorMsg,
        };
      }
    }

    // Pattern 3: "Column 'xxx' not found" or "Field 'xxx' not found"
    if ((errorMsgLower.includes('column') || errorMsgLower.includes('field')) && errorMsgLower.includes('not found')) {
      const columnMatch = errorMsg.match(/(column|field)[:\s]+['"]?([^'"]+)['"]?/i);
      if (columnMatch) {
        return {
          parameterName: columnMatch[1].toLowerCase(),
          problematicValue: columnMatch[2].trim(),
          errorMessage: errorMsg,
        };
      }
    }

    // Pattern 4: "File 'xxx' not found"
    if (errorMsgLower.includes('file') && errorMsgLower.includes('not found')) {
      const fileMatch = errorMsg.match(/file[:\s]+['"]?([^'"]+)['"]?/i);
      if (fileMatch) {
        return {
          parameterName: 'file_id',
          problematicValue: fileMatch[1].trim(),
          errorMessage: errorMsg,
        };
      }
    }

    return null;
  }

}
