/**
 * Shadow Agent Types
 *
 * Type definitions for the Shadow Agent system (System 1).
 * The Shadow Agent monitors agent executions during calibration,
 * classifies failures, and tracks agent lifecycle state.
 *
 * PRIVACY CONSTRAINT: No client data (emails, CRM records, file contents)
 * is ever stored. Only metadata, counts, field names, and category labels.
 *
 * @module lib/pilot/shadow/types
 */

// === Failure Categories (7 types) ===

export type FailureCategory =
  | 'execution_error'       // Plugin failed, API error, timeout
  | 'missing_step'          // Workflow missing required step
  | 'invalid_step_order'    // Dependencies not met
  | 'capability_mismatch'   // Plugin can't do requested action
  | 'logic_error'           // Conditional logic broken
  | 'data_shape_mismatch'   // Expected array, got object (or vice versa)
  | 'data_unavailable';     // Empty results, missing fields

// === Failure Sub-Types ===

export type ExecutionErrorSubType =
  | 'retryable'    // Transient: timeout, rate limit, network
  | 'auth'         // Authentication/authorization failure
  | 'api_error'    // Plugin API returned error
  | 'unknown';     // Unclassified execution error

// === Classification Result ===

export interface FailureClassification {
  category: FailureCategory;
  sub_type?: string;
  is_auto_retryable: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

// === Step Context (metadata only, NO client data) ===

export interface StepFailureContext {
  stepId: string;
  stepName: string;
  stepType: string;
  plugin?: string;
  action?: string;
  /** Keys only from context.variables — NO values */
  availableVariableKeys: string[];
  /** IDs of steps that completed before this failure */
  completedSteps: string[];
  /** Number of retries attempted by ErrorRecovery before failure */
  retryCount: number;
}

// === Failure Snapshot (stored in DB -- NO client data) ===

export interface FailureSnapshot {
  id: string;
  execution_id: string;
  agent_id: string;
  user_id: string;
  // Step that failed
  failed_step_id: string;
  failed_step_name: string;
  step_type: string;
  // Classification
  failure_category: FailureCategory;
  failure_sub_type?: string;
  severity: string;
  // Error info (message only, no stack traces containing data)
  error_message: string;
  error_code?: string;
  // Execution state (metadata only)
  completed_steps: string[];
  failed_steps: string[];
  // Diagnostics
  retry_count: number;
  tokens_used_before_failure: number;
  execution_time_before_failure_ms: number;
  // Timestamps
  failed_at: string;
  captured_at: string;
}

/** Insert shape (omits DB-generated `id`) */
export type FailureSnapshotInsert = Omit<FailureSnapshot, 'id'>;

// === Agent Lifecycle ===

export type AgentLifecycleState = 'calibrating' | 'production';

/** Summary returned after capturing a failure */
export interface CaptureResult {
  snapshotId: string | null;
  classification: FailureClassification;
}

// === Repair Types (Phase 2) ===

/** What kind of data shape repair to apply */
export type RepairActionType =
  | 'extract_single_array'     // Object with single array field → extract it
  | 'wrap_in_array'            // Single object → wrap in [object]
  | 'extract_named_array'      // Object with multiple arrays → extract best-match
  | 'none';                    // No repair possible

/** What happened after attempting repair */
export type RepairOutcome =
  | 'auto_fixed'               // Repair applied, re-execution succeeded
  | 'auto_fix_failed'          // Repair applied, re-execution still failed
  | 'not_fixable';             // Cannot repair this failure type

/** A proposed repair action before it's applied */
export interface RepairProposal {
  action: RepairActionType;
  description: string;
  confidence: number;           // 0-1
  targetStepId: string;         // Upstream step whose output to modify
  extractField?: string;        // Field name to extract (for extract actions)
  risk: 'low' | 'medium' | 'high';
}

/** Result after attempting a repair */
export interface RepairResult {
  outcome: RepairOutcome;
  proposal: RepairProposal;
  dataModified: boolean;
  repairError?: string;
}

// === Resume Types (Phase 2: Repair & Resume) ===

/** What the ResumeOrchestrator decides to do after a step failure */
export type ResumeAction =
  | 'retry_step'              // Re-execute the failed step (after repair applied)
  | 'skip_step'               // Skip this step and continue execution
  | 'stop_execution'          // Stop execution (non-recoverable failure)
  | 'continue_with_fallback'  // Continue with empty/default output for this step
  | 'pause_for_decision';     // Pause execution and wait for user decision (Phase 4)

/** Decision returned by ResumeOrchestrator.handleStepFailure() */
export interface ResumeDecision {
  action: ResumeAction;
  /** Human-readable reason for the decision */
  reason: string;
  /** Whether a repair was applied to in-memory data before this decision */
  repairApplied: boolean;
  /** Details of the repair attempt (if any) */
  repairDetails?: RepairResult;
  /** Classification of the failure that triggered this decision */
  classification: FailureClassification;
}

// === Checkpoint Types (Phase 2: In-Memory Checkpoints) ===

/** Checkpoint granularity level */
export type CheckpointLevel = 'step' | 'batch' | 'validation';

/** In-memory checkpoint snapshot (metadata only — NO client data) */
export interface InMemoryCheckpoint {
  checkpointId: string;
  executionId: string;
  timestamp: number;
  level: CheckpointLevel;
  // Metadata only — no step output data
  completedStepIds: string[];
  failedStepIds: string[];
  skippedStepIds: string[];
  currentStepId: string | null;
  tokensUsed: number;
  executionTimeMs: number;
  /** Step or batch that triggered this checkpoint */
  triggerStepId: string;
}

// === Execution Protection Types (Phase 3) ===

/** Configuration for calibration guard rails */
export interface ExecutionProtectionConfig {
  /** Stop workflow on first non-recoverable, non-fixable failure */
  earlyStopOnNonRecoverable: boolean;
  /** Max repair attempts per individual step */
  maxRepairsPerStep: number;
  /** Max total repair attempts across entire execution */
  maxTotalRepairs: number;
  /** Skip repair if same step+category failed in previous run */
  checkIdenticalFailures: boolean;
}

// === Data Decision Types (Phase 4) ===

/** Context for a data decision request (metadata only — NO client data) */
export interface DataDecisionContext {
  stepId: string;
  stepName: string;
  plugin: string;
  action: string;
  dataField: string; // e.g. 'emails', 'contacts'
  operator: 'empty' | 'missing' | 'null';
}

/** Result returned by DataDecisionHandler */
export interface DataDecisionResult {
  decision: 'continue' | 'stop' | 'skip' | 'fallback';
  ruleApplied: boolean;
  ruleId?: string;
}

/** Data decision request stored in database */
export interface DataDecisionRequest {
  id: string;
  execution_id: string;
  agent_id: string;
  user_id: string;
  step_id: string;
  step_name: string;
  failure_category: 'data_unavailable';
  decision_context: {
    plugin: string;
    action: string;
    dataField: string;
    operator: 'empty' | 'missing' | 'null';
  };
  status: 'pending' | 'responded' | 'timeout';
  user_decision?: {
    action: 'continue' | 'stop' | 'skip';
    remember: boolean;
  };
  created_at: string;
  responded_at?: string;
  expires_at: string;
}

/** Insert shape for data_decision_requests table */
export type DataDecisionRequestInsert = Omit<DataDecisionRequest, 'id' | 'created_at'>;

/** Behavior rule for automatic data handling */
export interface BehaviorRule {
  id: string;
  user_id: string;
  agent_id?: string | null; // NULL = global rule
  rule_type: 'skip_on_empty' | 'data_fallback' | 'auto_retry';
  trigger_condition: {
    step_pattern?: string; // e.g. "gmail_search_*" (Phase 5 will add pattern matching)
    data_pattern?: {
      field: string;
      operator: 'empty' | 'missing' | 'null' | 'malformed';
    };
  };
  action: {
    type: 'continue' | 'stop' | 'skip' | 'fallback';
    params?: any;
  };
  name?: string;
  description?: string;
  created_from_decision_id?: string;
  created_from_snapshot_id?: string;
  status: 'active' | 'inactive' | 'expired';
  applied_count: number;
  last_applied_at?: string;
  created_at: string;
  updated_at: string;
  expires_at?: string;
}

/** Insert shape for behavior_rules table */
export type BehaviorRuleInsert = Omit<BehaviorRule, 'id' | 'created_at' | 'updated_at'>;
