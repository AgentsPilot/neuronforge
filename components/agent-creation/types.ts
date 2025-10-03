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
  options: Array<{
    value: string;
    label: string;
  }>;
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