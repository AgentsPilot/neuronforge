
import { IPluginContext } from '@/lib/types/plugin-definition-context'

// Enhanced types with completion tracking
export interface Message {
  id: string;
  type: 'user' | 'ai' | 'system';
  content: string;
  timestamp: Date | string;
  status?: 'sending' | 'sent' | 'error';
  questionId?: string;
  isQuestionAnswer?: boolean;
}

export interface RequirementItem {
  id: string;
  label: string;
  status: 'missing' | 'partial' | 'clear';
  detected?: string;
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  dimension: string;
  type: string; // e.g., 'text' | 'textarea' | 'select' | 'multiselect' | 'enum' | 'date'
  options?: Array<{
    value: string;
    label: string;
    description?: string
  }> | string[];
  placeholder?: string;
  required?: boolean;
  allowCustom?: boolean;
  followUpQuestions?: Record<string, ClarificationQuestion[]>;
  depends_on?: string[];
}

export interface ClarityAnalysis {
  clarityScore: number;
  questionsCount: number;
  needsClarification: boolean;
  aiValidationFailed: boolean;
  bypassedPluginValidation: boolean;
  hadPluginWarning: boolean;
  questionsSequence?: ClarificationQuestion[];
  pluginValidationError?: boolean;
  missingPlugins?: string[];
  requiredServices?: string[];
  suggestions?: string[];
  pluginWarning?: {
    message: string;
    missingPlugins: string[];
    suggestions: string[];
  };
  analysis?: Record<string, any>;
}

export interface ProjectState {
  originalPrompt: string;
  enhancedPrompt: string;
  requirements: RequirementItem[];
  clarityScore: number;
  isReadyToBuild: boolean;
  enhancementComplete: boolean;
  userApproved: boolean;
  questionsSequence: ClarificationQuestion[];
  currentQuestionIndex: number;
  clarificationAnswers: Record<string, string>;
  showingCustomInput: boolean;
  customInputValue: string;
  customInputQuestionId: string | null; // ✅ ADD THIS LINE
  isInitialized: boolean;
  isProcessingQuestion: boolean;
  isEditingEnhanced: boolean;
  editedEnhancedPrompt: string;
  pluginValidationError?: boolean;
  missingPlugins?: string[];
  requiredServices?: string[];
  suggestions?: string[];
  pluginWarning?: any | null;
  connectedPlugins?: string[]; // Changed to optional and generic object
  connectedPluginsData?: IPluginContext[]; // Changed to optional and generic object
  questionsWithVisibleOptions: Set<string>;
  hasProcessedInitial: boolean;
  sessionId: string;
  messages?: Message[];
  
  // NEW: Enhanced completion tracking
  workflowPhase: 'initial' | 'questions' | 'enhancement' | 'approval' | 'completed' | 'agent_created';
  conversationCompleted: boolean; // Questions + Enhancement completed
  planApproved: boolean; // User approved the final plan
  agentCreated?: boolean; // Agent successfully created
  agentId?: string; // ID of created agent
  
  // Navigation and review states
  isInReviewMode?: boolean; // User is reviewing completed conversation
  allowNavigation?: boolean; // Can navigate between phases
  userExplicitlyChoseConversationalView?: boolean; // NEW: User explicitly chose to stay in conversational view
  isBackNavigation?: boolean; // Legacy - for backward compatibility
  skipAIProcessing?: boolean; // Legacy - for backward compatibility
  preventAIRestart?: boolean; // Legacy - for backward compatibility
  reviewMode?: boolean; // Legacy - for backward compatibility
  
  // Timestamps for tracking
  completedAt?: number;
  approvedAt?: number;
  createdAt?: number;
  lastUpdated?: number;
}

export interface ConversationalAgentBuilderProps {
  initialPrompt?: string;
  onPromptApproved?: (data: {
    prompt: string;
    promptType: 'original' | 'enhanced';
    clarificationAnswers: Record<string, string>;
  }) => void;
  onCancel?: () => void;
  restoredState?: Partial<ProjectState>;
  onStateChange?: (state: ProjectState) => void;
}

export interface PromptPayload {
  prompt: string;
  userId: string;
  sessionId: string;
  agentId?: string;
  connectedPlugins?: string[]; // Changed to optional and generic object
}

// Requests to the API
export interface PromptRequestPayload extends PromptPayload {  
  bypassPluginValidation?: boolean;
}

export interface ClarificationQuestionRequestPayload extends PromptPayload {  
  agentName: string;
  description: string;  
  connectedPluginsData?: IPluginContext[];
  analysis: ClarityAnalysis;
}

export interface EnhancedPromptRequestPayload extends PromptPayload {
  clarificationAnswers: Record<string, string>;
  connectedPluginsData?: IPluginContext[];
  missingPlugins?: string[];
  pluginWarning?: any | null;
}

// Responses from the API
export interface PromptResponsePayload extends PromptPayload {
  connectedPluginsData?: IPluginContext[];
  analysis: ClarityAnalysis;
}
