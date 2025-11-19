/**
 * Types for agent_prompt_threads table
 * Represents OpenAI thread state for agent creation flow (phases 1-3)
 */

export type ThreadStatus = 'active' | 'expired' | 'completed' | 'abandoned';
export type ThreadPhase = 1 | 2 | 3;

export interface AgentPromptThread {
  id: string; // UUID
  user_id: string; // UUID
  openai_thread_id: string;
  status: ThreadStatus;
  current_phase: ThreadPhase;
  agent_id: string | null; // UUID, nullable until agent is created
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
  expires_at: string; // ISO timestamp
  metadata: ThreadMetadata;
}

export interface ThreadMetadata {
  user_prompt?: string;
  analysis?: AnalysisObject;
  connected_services?: string[]; // Simple array of plugin keys
  clarification_answers?: Record<string, any>;
  user_context?: UserContext;
  [key: string]: any; // Allow additional metadata
}

export interface UserContext {
  full_name?: string;
  email?: string;
  role?: string;
  company?: string;
  domain?: string;
}

export interface ConnectedService {
  name: string;
  context: string;
}

export interface AnalysisObject {
  data: AnalysisDimension;
  trigger?: AnalysisDimension; // Optional in Phase 3
  output: AnalysisDimension;
  actions: AnalysisDimension;
  delivery: AnalysisDimension;
  error_handling?: AnalysisDimension; // Optional in Phase 3
}

export type DimensionStatus = 'clear' | 'partial' | 'missing';

export interface AnalysisDimension {
  status: DimensionStatus;
  confidence: number; // 0-1, strictly validated at runtime
  detected: string; // Non-empty string
}

// Database insert/update types (omit generated fields)
export type CreateAgentPromptThread = Omit<
  AgentPromptThread,
  'id' | 'created_at' | 'updated_at'
> & {
  created_at?: string;
  updated_at?: string;
};

export type UpdateAgentPromptThread = Partial<
  Omit<AgentPromptThread, 'id' | 'user_id' | 'openai_thread_id' | 'created_at'>
>;

// API Request/Response types
export interface InitThreadRequest {
  user_id?: string; // Optional, will be extracted from auth session
}

export interface InitThreadResponse {
  success: boolean;
  thread_id: string;
  created_at: string;
  message: string;
}

export interface ProcessMessageRequest {
  thread_id: string;
  phase: ThreadPhase;
  user_prompt: string;
  user_context: UserContext;
  analysis: AnalysisObject | null;
  connected_services: string[]; // Simple array of connected plugin keys
  available_services?: ConnectedService[]; // All plugins available in the system with full context
  clarification_answers?: Record<string, any>;
  enhanced_prompt?: EnhancedPrompt | null; // Phase 2: Previous Phase 3 output for refinement (v8)
  metadata?: {
    declined_plugins?: string[]; // Plugins user explicitly declined to connect
    [key: string]: any; // Allow additional metadata
  };
}

export interface ProcessMessageResponse {
  success: boolean;
  phase: ThreadPhase;

  // Phase 1 & 2 fields
  analysis?: AnalysisObject;
  questionsSequence?: ClarificationQuestion[];
  needsClarification?: boolean;
  clarityScore?: number;
  suggestions?: string[];
  connectedPlugins?: string[]; // Phase 1: List of user's connected plugin keys (e.g., ['google-mail', 'slack'])

  // Phase 3 specific fields
  enhanced_prompt?: EnhancedPrompt;
  requiredServices?: string[];
  missingPlugins?: string[];
  pluginWarning?: Record<string, string>; // Changed from Record<string, any>
  error?: string; // Phase 3: Error message if workflow impossible (e.g., no alternatives for declined plugin)
  // Note: ready_for_generation is ONLY in metadata.ready_for_generation, not at top level

  // All Phases
  conversationalSummary?: string; // LLM-generated friendly summary of understanding/progress

  // Strictly typed metadata (no arbitrary keys)
  metadata?: Phase3Metadata;
}

export interface ClarificationQuestion {
  id: string;
  dimension?: 'data' | 'trigger' | 'output' | 'actions' | 'delivery' | 'error_handling'; // v7 and below
  theme?: string; // v8: Inputs, Processing, Outputs, Delivery
  question: string;
  type: 'select' | 'text' | 'email' | 'number';
  options?: ClarificationOption[];
  allowCustom?: boolean;
  required?: boolean;
  depends_on?: string[];
  placeholder?: string;
}

export interface ClarificationOption {
  value: string;
  label: string;
  description?: string;
}

export interface EnhancedPromptSections {
  data: string[];              // Array of bullet points
  actions: string[];           // Array of bullet points
  output: string[];            // Array of bullet points
  delivery: string[];          // Array of bullet points
  processing_steps?: string[]; // Optional - v7 compatibility
}

export interface EnhancedPromptSpecifics {
  services_involved: string[];
  user_inputs_required: string[];
}

export interface EnhancedPrompt {
  plan_title: string;
  plan_description: string;
  sections: EnhancedPromptSections;
  specifics: EnhancedPromptSpecifics;
}

/**
 * Strict metadata for Phase 3 responses
 * All fields explicitly defined, no arbitrary keys
 */
export interface Phase3Metadata {
  all_clarifications_applied: boolean;
  ready_for_generation: boolean;
  confirmation_needed: boolean;
  implicit_services_detected: string[];
  provenance_checked: boolean;
  resolved_contacts: Record<string, string>; // {"user": "alice@company.com"}
  provenance_note?: string;
  declined_plugins_blocking?: string[];
  oauth_required?: boolean;
  oauth_message?: string;
  plugins_adjusted?: string[];
  adjustment_reason?: string;
  reason?: string;
}

// Thread resume response type
export interface ThreadResumeResponse {
  success: boolean;
  thread: AgentPromptThread;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: number;
  }>;
}

// Error response type
export interface ThreadErrorResponse {
  success: false;
  error: string;
  phase?: ThreadPhase;
  details?: string;
}
