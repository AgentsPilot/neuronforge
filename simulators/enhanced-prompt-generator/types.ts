/**
 * Types and Zod schemas for the Enhanced Prompt Generator simulator.
 *
 * Scenario files are validated with Zod on load. Output types define
 * the structured JSON saved after each scenario run.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Scenario Schema (validated on load from JSON files)
// ---------------------------------------------------------------------------

export const ScenarioSchema = z.object({
  name: z.string().min(1, 'Scenario name is required'),
  description: z.string().min(1, 'Scenario description is required'),
  user_prompt: z.string().min(1, 'User prompt is required'),
  user_context: z.object({
    full_name: z.string().optional(),
    email: z.string().optional(),
    timezone: z.string().optional(),
    role: z.string().optional(),
    company: z.string().optional(),
    domain: z.string().optional(),
  }).optional(),
  connected_services: z.array(z.string()).optional(),
  clarification_hints: z.record(z.string(), z.string()).optional(),
  expected_services: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  ai_provider: z.string().optional(),
  ai_model: z.string().optional(),
});

export type Scenario = z.infer<typeof ScenarioSchema>;

// ---------------------------------------------------------------------------
// Simulator Config
// ---------------------------------------------------------------------------

export interface SimulatorConfig {
  baseUrl: string;
  verbose: boolean;
  /** LLM provider for answerer/validator (env default, scenario can override) */
  llmProvider: string;
  /** LLM model for answerer/validator (env default, scenario can override) */
  llmModel: string;
}

// ---------------------------------------------------------------------------
// Phase Response Types (matching what the API actually returns)
// ---------------------------------------------------------------------------

export interface InitThreadResponse {
  success: boolean;
  thread_id?: string;
  created_at?: string;
  message?: string;
  error?: string;
  details?: string;
}

export interface Phase1Response {
  success: boolean;
  phase: number;
  clarityScore?: number;
  conversationalSummary?: string;
  analysis?: Record<string, unknown>;
  connectedPlugins?: string[];
  workflow_draft?: string[];
  ambiguities?: string[];
  user_inputs_required?: string[];
  error?: string;
  details?: string;
}

/**
 * A structured clarification question from Phase 2.
 * Supports text, select, and multi_select types.
 */
export interface ClarificationQuestion {
  id: string;
  question: string;
  type: 'text' | 'select' | 'multi_select';
  theme?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
}

export interface Phase2Response {
  success: boolean;
  phase: number;
  questionsSequence?: ClarificationQuestion[];
  conversationalSummary?: string;
  error?: string;
  details?: string;
}

export interface Phase3Response {
  success: boolean;
  phase: number;
  enhanced_prompt?: Record<string, unknown>;
  requiredServices?: string[];
  missingPlugins?: string[];
  conversationalSummary?: string;
  metadata?: Record<string, unknown>;
  error?: string;
  details?: string;
}

// ---------------------------------------------------------------------------
// Clarification Answer Types (V14 union format)
// ---------------------------------------------------------------------------

export type ClarificationAnswer =
  | string
  | { answerType: 'select'; mode: 'selected'; selected: string }
  | { answerType: 'multi_select'; mode: 'selected'; selected: string[] };

// ---------------------------------------------------------------------------
// Validation Result
// ---------------------------------------------------------------------------

export interface ValidationResult {
  pass: boolean;
  reasoning: string;
  issues: string[];
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// Simulator Output (saved to JSON file)
// ---------------------------------------------------------------------------

export interface SimulatorOutput {
  scenario: {
    name: string;
    user_prompt: string;
    file: string;
  };
  run: {
    timestamp: string;
    duration_ms: number;
    simulator_version: string;
    base_url: string;
    ai_provider: string;
    ai_model: string;
  };
  auth: {
    success: boolean;
    user_id: string | null;
    email: string | null;
  };
  phases: {
    phase1: {
      success: boolean;
      duration_ms: number;
      thread_id: string | null;
      request: unknown;
      response: unknown;
      clarification_questions: string[];
    } | null;
    phase2: {
      success: boolean;
      duration_ms: number;
      skipped: boolean;
      questions: ClarificationQuestion[];
      generated_answers: Record<string, ClarificationAnswer>;
      request: unknown;
      response: unknown;
    } | null;
    phase3: {
      success: boolean;
      duration_ms: number;
      request: unknown;
      response: unknown;
      enhanced_prompt: unknown;
      missing_plugins: string[];
    } | null;
  };
  validation: ValidationResult | null;
  status: 'pass' | 'warning' | 'fail' | 'error';
  errors: Array<{ phase: string; message: string; statusCode?: number; rawResponse?: unknown }>;
}
