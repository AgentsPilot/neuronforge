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
  trigger: AnalysisDimension;
  output: AnalysisDimension;
  actions: AnalysisDimension;
  delivery: AnalysisDimension;
  error_handling: AnalysisDimension;
}

export interface AnalysisDimension {
  status: 'clear' | 'partial' | 'missing';
  confidence: number; // 0-1
  detected: string;
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
  metadata?: {
    declined_plugins?: string[]; // Plugins user explicitly declined to connect
    [key: string]: any; // Allow additional metadata
  };
}

export interface ProcessMessageResponse {
  success: boolean;
  phase: ThreadPhase;
  analysis?: AnalysisObject;
  questionsSequence?: ClarificationQuestion[];
  enhanced_prompt?: EnhancedPrompt;
  requiredServices?: string[];
  needsClarification?: boolean;
  clarityScore?: number;
  suggestions?: string[];
  missingPlugins?: string[];
  pluginWarning?: Record<string, any>;
  connectedPlugins?: string[]; // Phase 1: List of user's connected plugin keys (e.g., ['google-mail', 'slack'])
  conversationalSummary?: string; // All Phases: LLM-generated friendly summary of understanding/progress
  ready_for_generation?: boolean; // Phase 3: True if all plugins connected and ready to create agent
  error?: string; // Phase 3: Error message if workflow impossible (e.g., no alternatives for declined plugin)
  metadata?: {
    all_clarifications_applied?: boolean;
    confirmation_needed?: boolean;
    implicit_services_detected?: string[];
    oauth_required?: boolean;
    oauth_message?: string;
    plugins_adjusted?: string[];
    adjustment_reason?: string;
    declined_plugins_blocking?: string[];
    reason?: string;
    [key: string]: any;
  };
}

export interface ClarificationQuestion {
  id: string;
  dimension: 'data' | 'trigger' | 'output' | 'actions' | 'delivery' | 'error_handling';
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

export interface EnhancedPrompt {
  plan_title: string;
  plan_description: string;
  sections: {
    data: string;
    processing_steps: string[];
    output: string;
    delivery: string;
    error_handling: string;
  };
  specifics: {
    services_involved: string[];
    user_inputs_required: string[];
    trigger_scope: string;
  };
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
