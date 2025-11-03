/**
 * Conversational Agent Builder V2 - Type Definitions
 */

export type MessageType =
  | 'text'
  | 'plugin_warning'
  | 'clarification_question'
  | 'enhanced_prompt_review'
  | 'system_notification'
  | 'transition';

export interface Message {
  id: string;
  timestamp: Date;
  type: 'user' | 'ai' | 'system';
  messageType?: MessageType;
  content?: string;
  data?: any;
  isQuestionAnswer?: boolean;
}

export type ConversationalStage =
  | 'clarity'
  | 'plugins'
  | 'questions'
  | 'review'
  | 'accepted';

export interface ConversationalFlowState {
  // Message history
  messages: Message[];

  // Confidence tracking
  confidenceScore: number; // 0-100

  // Current stage
  currentStage: ConversationalStage;

  // Plugin connection
  missingPlugins: string[];
  connectingPlugin: string | null;
  connectedPlugins: string[];

  // Clarification questions
  questionsSequence: ClarificationQuestion[];
  currentQuestionIndex: number;
  clarificationAnswers: Record<string, string>;

  // Enhanced prompt
  enhancedPrompt: string | null;

  // Processing states
  isProcessing: boolean;

  // Original data
  originalPrompt: string;

  // Thread management
  threadId: string | null;
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  type: 'text' | 'select' | 'multiselect';
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  followUpQuestions?: Record<string, ClarificationQuestion>;
}

export interface ConversationalAgentBuilderProps {
  initialPrompt?: string;
  onPromptApproved: (data: {
    prompt: string;
    promptType: 'original' | 'enhanced';
    clarificationAnswers: Record<string, string>;
  }) => void;
  onCancel?: () => void;
  restoredState?: Partial<ConversationalFlowState>;
  onStateChange?: (state: Partial<ConversationalFlowState>) => void;
}

export interface UseConversationalFlowProps {
  initialPrompt?: string;
  restoredState?: Partial<ConversationalFlowState>;
  onStateChange?: (state: Partial<ConversationalFlowState>) => void;
  onComplete: (data: {
    prompt: string;
    promptType: 'original' | 'enhanced';
    clarificationAnswers: Record<string, string>;
  }) => void;
}

export interface UseConversationalFlowReturn {
  messages: Message[];
  confidenceScore: number;
  currentStage: ConversationalStage;
  isProcessing: boolean;
  missingPlugins: string[];

  handleInitialPrompt: (prompt: string) => Promise<void>;
  handlePluginConnected: (pluginKey: string) => Promise<void>;
  handleAnswerQuestion: (questionId: string, answer: string) => Promise<void>;
  handleAcceptPrompt: () => Promise<void>;
  handleRevisePrompt: () => Promise<void>;
  handleSendMessage: (message: string) => Promise<void>;
}

// Message component props
export interface UserMessageProps {
  message: Message;
}

export interface AIMessageProps {
  message: Message;
  onPluginConnect?: (pluginKey: string) => void;
  onAnswerQuestion?: (questionId: string, answer: string) => void;
  onAcceptPrompt?: () => void;
  onRevisePrompt?: () => void;
}

export interface PluginConnectionCardProps {
  missingPlugins: string[];
  onConnect: (pluginKey: string) => void;
  connectingPlugin?: string | null;
}

export interface QuestionCardProps {
  question: ClarificationQuestion;
  questionNumber: number;
  totalQuestions: number;
  onAnswer: (questionId: string, answer: string) => void;
  isProcessing?: boolean;
}

export interface EnhancedPromptReviewProps {
  plan: string;
  onAccept: () => void;
  onRevise: () => void;
}

export interface ChatInputProps {
  onSubmit: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export interface ConfidenceBarProps {
  score: number;
}

export interface ChatHeaderProps {
  onCancel?: () => void;
}
