/**
 * Types for agent_prompt_workflow_generation_sessions table
 * Tracks V5 Workflow Generator pipeline stages (System 2)
 * Links to agent_prompt_threads (System 1) via openai_thread_id
 */

import type { ProviderName } from '@/lib/ai/providerFactory';

// ============================================================================
// Session Status & Input Path
// ============================================================================

export type WorkflowGenerationStatus = 'in_progress' | 'completed' | 'failed' | 'blocked';
export type WorkflowInputPath = 'enhanced_prompt' | 'technical_workflow';

// ============================================================================
// Stage Types
// ============================================================================

export type WorkflowGenerationStageName =
  | 'step_plan_extractor'    // Path A: LLM extracts step plan from enhanced prompt
  | 'technical_reviewer'     // Path B: LLM reviews/repairs technical workflow
  | 'dsl_builder'            // Path A: Deterministic DSL build from step plan
  | 'phase4_dsl_builder'     // Path B: Deterministic DSL build from technical workflow
  | 'json_repair'            // JSON repair was needed (jsonrepair library)
  | 'validation';            // Zod schema validation

export type WorkflowGenerationStageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * LLM call metadata for stages that invoke AI
 */
export interface StageLLMCall {
  prompt_template: string;     // e.g., "Workflow-Agent-Technical-Reviewer-SystemPrompt-v3"
  system_prompt_length?: number;
  user_prompt_length?: number;
  input_tokens: number;
  output_tokens: number;
  finish_reason: string;       // 'stop', 'end_turn', 'length', 'max_tokens', etc.
  model: string;               // Actual model used
  provider: ProviderName;
}

/**
 * Validation result for a stage
 */
export interface StageValidation {
  valid: boolean;
  schema_name?: string;        // e.g., "TechnicalReviewerResponseSchema", "Phase4ResponseSchema"
  errors?: string[];           // Zod error messages if validation failed
}

/**
 * JSON repair tracking
 */
export interface StageRepair {
  was_repaired: boolean;
  original_length?: number;
  repaired_length?: number;
  repair_reason?: string;      // e.g., "truncated", "missing_bracket", "trailing_comma"
}

/**
 * A single stage in the workflow generation pipeline
 */
export interface WorkflowGenerationStage {
  stage_name: WorkflowGenerationStageName;
  stage_index: number;         // Order in pipeline (0, 1, 2...)

  // Timing
  started_at: string;          // ISO timestamp
  completed_at?: string;       // ISO timestamp
  duration_ms?: number;

  // Status
  status: WorkflowGenerationStageStatus;
  error?: string;              // Error message if status === 'failed'

  // LLM stages only
  llm_call?: StageLLMCall;

  // Full input/output data (for debugging/replay)
  input_data?: any;            // Full stage input
  output_data?: any;           // Full stage output

  // Brief summaries (always present)
  input_summary?: string;      // e.g., "EnhancedPrompt with 5 sections"
  output_summary?: string;     // e.g., "TechnicalWorkflow with 8 steps"

  // Validation results
  validation?: StageValidation;

  // Repair tracking (if jsonrepair was used)
  repair?: StageRepair;
}

// ============================================================================
// Input Structures
// ============================================================================

/**
 * Input data type for session storage
 *
 * Uses Record<string, any> because:
 * 1. input_data is stored as JSONB in the database
 * 2. The V5 generator uses TechnicalWorkflowStep from phase4-schema.ts
 * 3. This file imports from agent-prompt-threads.ts (slightly different types)
 * 4. Being flexible here avoids type conflicts while preserving full data
 */
export type WorkflowGenerationInputData = Record<string, any>;

// ============================================================================
// Blocking Issues (from feasibility check)
// ============================================================================

export interface WorkflowBlockingIssue {
  type: string;                // e.g., "missing_plugin", "missing_operation", "unsupported_pattern"
  description: string;
}

// ============================================================================
// Main Session Interface
// ============================================================================

export interface WorkflowGenerationSession {
  id: string;                  // UUID
  user_id: string;             // UUID

  // Links to other systems
  openai_thread_id: string | null;  // Link to System 1 (for log correlation)
  agent_id: string | null;          // Link to agents table (set after agent creation)

  // Input tracking
  input_path: WorkflowInputPath;
  input_data: WorkflowGenerationInputData;

  // Pipeline stages (the diary)
  stages: WorkflowGenerationStage[];

  // Final output
  status: WorkflowGenerationStatus;
  output_dsl: Record<string, any> | null;  // PILOT_DSL schema (if successful)
  error: string | null;                     // Error message (if failed)
  blocking_issues: WorkflowBlockingIssue[] | null;  // From feasibility (if blocked)

  // Reviewer provider/model (the main LLM stage)
  // Each stage also tracks its own provider/model in llm_call for detailed tracking
  reviewer_ai_provider: ProviderName;
  reviewer_ai_model: string;

  // Aggregate metrics
  total_input_tokens: number;
  total_output_tokens: number;
  total_duration_ms: number | null;

  // Timestamps
  created_at: string;          // ISO timestamp
  updated_at: string;          // ISO timestamp (auto-updated on every modification)
  completed_at: string | null; // ISO timestamp
}

// ============================================================================
// Database Insert/Update Types
// ============================================================================

export type CreateWorkflowGenerationSession = Omit<
  WorkflowGenerationSession,
  'id' | 'created_at' | 'updated_at' | 'completed_at' | 'stages' | 'status' | 'output_dsl' | 'error' | 'blocking_issues' | 'total_input_tokens' | 'total_output_tokens' | 'total_duration_ms' | 'agent_id'
> & {
  stages?: WorkflowGenerationStage[];
  created_at?: string;
};

export type UpdateWorkflowGenerationSession = Partial<
  Omit<WorkflowGenerationSession, 'id' | 'user_id' | 'created_at' | 'updated_at'>
>;

// ============================================================================
// Helper Types for Stage Creation
// ============================================================================

export interface CreateStageParams {
  stage_name: WorkflowGenerationStageName;
  stage_index?: number;          // Optional - managed by helper in V5WorkflowGenerator
  input_data?: any;
  input_summary?: string;
}

export interface CompleteStageParams {
  output_data?: any;
  output_summary?: string;
  llm_call?: StageLLMCall;
  validation?: StageValidation;
  repair?: StageRepair;
  error?: string;
}
