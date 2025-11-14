/**
 * AgentPilot Workflow Pilot - Main Exports
 *
 * @module lib/pilot
 */

// Main pilot
export { WorkflowPilot } from './WorkflowPilot';

// Core components
export { WorkflowParser } from './WorkflowParser';
export { ExecutionContext } from './ExecutionContext';
export { StateManager } from './StateManager';
export { StepExecutor } from './StepExecutor';
export { ParallelExecutor } from './ParallelExecutor';
export { ConditionalEvaluator } from './ConditionalEvaluator';
export { ErrorRecovery, CircuitBreaker } from './ErrorRecovery';
export { OutputValidator } from './OutputValidator';
export { ApprovalTracker } from './ApprovalTracker';
export { NotificationService } from './NotificationService';

// Types
export type {
  // Workflow steps
  WorkflowStep,
  WorkflowStepBase,
  ActionStep,
  LLMDecisionStep,
  ConditionalStep,
  LoopStep,
  TransformStep,
  DelayStep,
  ParallelGroupStep,
  SwitchStep,
  ScatterGatherStep,
  EnrichmentStep,
  ValidationStep,
  ComparisonStep,
  SubWorkflowStep,
  HumanApprovalStep,

  // Approvals
  ApprovalRequest,
  ApprovalResponse,

  // Conditions
  Condition,
  SimpleCondition,
  ComplexCondition,
  ComparisonOperator,

  // Execution
  ExecutionContext as ExecutionContextType,
  ExecutionStatus,
  StepOutput,
  StepOutputMetadata,
  ExecutionSummary,
  ExecutionPlan,
  ExecutionStep,
  ParallelGroup,
  ValidationResult,
  WorkflowExecutionResult,

  // Configuration
  RetryPolicy,
  RollbackAction,
  CacheConfig,
  TransformConfig,
  PilotOptions,

  // Agent & Schema
  Agent,
  InputSchema,
  OutputSchema,
  ValidationRule,

  // Memory
  MemoryContext,
  AgentMemorySummary,
  UserMemoryEntry,

  // Database
  WorkflowExecutionRecord,
  ExecutionTrace,
  WorkflowStepExecutionRecord,

  // Utility
  VariableReference,
  StepId,
  PluginKey,
  ActionName,
} from './types';

// Error classes
export {
  WorkflowError,
  ValidationError,
  ExecutionError,
  ConditionError,
  VariableResolutionError,
} from './types';

// Type guards
export {
  isActionStep,
  isLLMDecisionStep,
  isConditionalStep,
  isLoopStep,
  isTransformStep,
  isParallelGroupStep,
  isSwitchStep,
  isScatterGatherStep,
  isEnrichmentStep,
  isValidationStep,
  isComparisonStep,
  isSubWorkflowStep,
  isHumanApprovalStep,
  isSimpleCondition,
  isComplexCondition,
} from './types';
