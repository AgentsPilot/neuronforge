# Conversational Agent Builder V2 - Implementation Plan

## Overview
Create a modern ChatGPT/Claude-style conversational interface for agent creation that integrates with the thread-based API system. This replaces the current sidebar-based UI with a more intuitive chat experience.

---

## Table of Contents
1. [Goals & Requirements](#goals--requirements)
2. [Architecture Overview](#architecture-overview)
3. [Phase-by-Phase Implementation](#phase-by-phase-implementation)
4. [Thread-Based API Integration](#thread-based-api-integration)
5. [Component Structure](#component-structure)
6. [State Management](#state-management)
7. [API Integration](#api-integration)
8. [Testing Strategy](#testing-strategy)
9. [Migration & Rollout](#migration--rollout)
10. [Success Metrics](#success-metrics)

---

## Goals & Requirements

### Primary Goals
1. ✅ Create intuitive chat-style interface for agent creation
2. ✅ Integrate with thread-based API for 35% token savings
3. ✅ Inline plugin connection within conversation flow
4. ✅ One-question-at-a-time clarification approach
5. ✅ Smooth transition to SmartAgentBuilder
6. ✅ Maintain feature parity with current flow

### Key Requirements
- **Performance**: First interaction < 3 seconds
- **Accessibility**: WCAG 2.1 AA compliant
- **Mobile**: Fully responsive design
- **Token Efficiency**: 35% reduction vs legacy flow
- **User Experience**: 85%+ completion rate (up from 65%)

---

## Architecture Overview

### High-Level Flow

```
User Input → Thread Init → Phase 1 (Clarity) → Plugin Connection →
Phase 2 (Questions) → User Answers → Phase 3 (Enhancement) →
Review → Accept → SmartAgentBuilder
```

### Technology Stack
- **Frontend**: React, TypeScript, TailwindCSS
- **State Management**: Custom hooks (useState, useRef, useEffect)
- **API Layer**: Thread-based endpoints + legacy fallback
- **Backend**: Next.js API routes, OpenAI Threads API
- **Database**: Supabase (thread persistence)

### Component Hierarchy

```
ConversationalAgentBuilderV2
├── ChatHeader
├── ChatMessages
│   ├── UserMessage
│   ├── AIMessage (polymorphic)
│   │   ├── TextMessage
│   │   ├── PluginConnectionCard
│   │   ├── QuestionCard
│   │   ├── EnhancedPromptReview
│   │   └── SystemNotification
│   └── TypingIndicator
├── ConfidenceBar (fixed)
└── ChatInput
```

---

## Phase-by-Phase Implementation

### Phase 1: Core Component Structure (Days 1-2)

#### Deliverables
- [ ] Base component file structure
- [ ] TypeScript interfaces and types
- [ ] Basic layout and styling
- [ ] Component skeleton with props

#### File Structure
```
components/agent-creation/conversational/
├── ConversationalAgentBuilderV2.tsx
├── components/
│   ├── ChatHeader.tsx
│   ├── ChatMessages.tsx
│   ├── ChatInput.tsx
│   ├── ConfidenceBar.tsx
│   ├── TypingIndicator.tsx
│   └── messages/
│       ├── UserMessage.tsx
│       ├── AIMessage.tsx
│       ├── PluginConnectionCard.tsx
│       ├── QuestionCard.tsx
│       ├── EnhancedPromptReview.tsx
│       └── SystemNotification.tsx
├── hooks/
│   ├── useConversationalFlow.ts
│   ├── useThreadManagement.ts
│   └── usePluginConnection.ts
├── types.ts
└── utils/
    ├── confidenceCalculator.ts
    └── messageFormatter.ts
```

#### Type Definitions

```typescript
// types.ts

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

export interface ConversationalFlowState {
  // Message history
  messages: Message[];

  // Confidence tracking
  confidenceScore: number; // 0-100

  // Current stage
  currentStage: 'clarity' | 'plugins' | 'questions' | 'review' | 'accepted';

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
```

---

### Phase 2: Chat UI Components (Days 3-4)

#### 2.1 ChatContainer & Layout

**ConversationalAgentBuilderV2.tsx**
```typescript
export default function ConversationalAgentBuilderV2({
  initialPrompt,
  onPromptApproved,
  onCancel,
  restoredState,
  onStateChange
}: ConversationalAgentBuilderProps) {

  const {
    messages,
    confidenceScore,
    currentStage,
    isProcessing,
    handleInitialPrompt,
    handlePluginConnected,
    handleAnswerQuestion,
    handleAcceptPrompt,
  } = useConversationalFlow({
    initialPrompt,
    restoredState,
    onStateChange,
    onComplete: onPromptApproved
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <ChatHeader onCancel={onCancel} />

      <div className="max-w-4xl mx-auto p-4 pb-32">
        <ChatMessages messages={messages} />
        {isProcessing && <TypingIndicator />}
      </div>

      <ConfidenceBar score={confidenceScore} />

      <ChatInput
        onSubmit={handleSendMessage}
        disabled={isProcessing || currentStage === 'plugins'}
        placeholder={getPlaceholder(currentStage)}
      />
    </div>
  );
}
```

#### 2.2 Message Components

**UserMessage.tsx**
```typescript
export function UserMessage({ message }: { message: Message }) {
  return (
    <div className="flex gap-3 justify-end mb-4">
      <div className="max-w-2xl relative">
        <div className={`
          rounded-xl px-4 py-3 shadow-md
          bg-gradient-to-br from-blue-600 to-indigo-700 text-white
          ${message.isQuestionAnswer ? 'ring-2 ring-green-300' : ''}
        `}>
          {message.isQuestionAnswer && (
            <CheckCircle className="absolute -top-1 -right-1 h-4 w-4 text-green-400" />
          )}
          <div className="text-sm leading-relaxed">{message.content}</div>
          <div className="text-xs mt-2 text-blue-100">
            <Clock className="inline h-3 w-3 mr-1" />
            {formatTime(message.timestamp)}
          </div>
        </div>
      </div>

      <div className="w-8 h-8 bg-gradient-to-br from-gray-400 to-gray-600 rounded-lg flex items-center justify-center">
        <User className="h-4 w-4 text-white" />
      </div>
    </div>
  );
}
```

**AIMessage.tsx (Polymorphic)**
```typescript
export function AIMessage({ message, onPluginConnect, onAnswerQuestion, onAcceptPrompt }: AIMessageProps) {
  const renderContent = () => {
    switch (message.messageType) {
      case 'plugin_warning':
        return (
          <PluginConnectionCard
            missingPlugins={message.data.missingPlugins}
            onConnect={onPluginConnect}
          />
        );

      case 'clarification_question':
        return (
          <QuestionCard
            question={message.data.question}
            questionNumber={message.data.questionNumber}
            totalQuestions={message.data.totalQuestions}
            onAnswer={onAnswerQuestion}
          />
        );

      case 'enhanced_prompt_review':
        return (
          <EnhancedPromptReview
            plan={message.data.enhancedPlan}
            onAccept={onAcceptPrompt}
          />
        );

      case 'text':
      default:
        return <TextMessage content={message.content} />;
    }
  };

  return (
    <div className="flex gap-3 justify-start mb-4">
      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
        <Bot className="h-4 w-4 text-white" />
      </div>

      <div className="max-w-2xl flex-1">
        <div className="bg-white/80 backdrop-blur-sm border border-white/30 rounded-xl p-4 shadow-md">
          {renderContent()}
        </div>
        <div className="text-xs mt-1 text-gray-500">
          <Clock className="inline h-3 w-3 mr-1" />
          {formatTime(message.timestamp)}
        </div>
      </div>
    </div>
  );
}
```

#### 2.3 ConfidenceBar Component

**ConfidenceBar.tsx**
```typescript
export function ConfidenceBar({ score }: { score: number }) {
  return (
    <div className="fixed bottom-20 left-0 right-0 bg-white/90 backdrop-blur-xl border-t border-white/20 shadow-lg">
      <div className="max-w-4xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-gray-700">
            🎯 Understanding Your Request
          </span>
          <span className="text-sm font-bold text-purple-600">{score}%</span>
        </div>

        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <div
            className="bg-gradient-to-r from-purple-500 via-pink-500 to-purple-600 h-full rounded-full transition-all duration-500 ease-out"
            style={{ width: `${score}%` }}
          />
        </div>
      </div>
    </div>
  );
}
```

#### 2.4 ChatInput Component

**ChatInput.tsx**
```typescript
export function ChatInput({ onSubmit, disabled, placeholder }: ChatInputProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || disabled) return;

    onSubmit(value);
    setValue('');
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200">
      <form onSubmit={handleSubmit} className="max-w-4xl mx-auto p-4">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />

          <button
            type="submit"
            disabled={!value.trim() || disabled}
            className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </form>
    </div>
  );
}
```

---

### Phase 3: State Management (Days 4-5)

#### 3.1 useConversationalFlow Hook

**hooks/useConversationalFlow.ts**
```typescript
export function useConversationalFlow({
  initialPrompt,
  restoredState,
  onStateChange,
  onComplete
}: UseConversationalFlowProps) {

  // Thread management
  const threadId = useRef<string | null>(null);
  const useThreadFlow = useThreadBasedAgentCreation();

  // State
  const [state, setState] = useState<ConversationalFlowState>({
    messages: restoredState?.messages || [],
    confidenceScore: restoredState?.confidenceScore || 0,
    currentStage: restoredState?.currentStage || 'clarity',
    missingPlugins: restoredState?.missingPlugins || [],
    connectingPlugin: null,
    connectedPlugins: restoredState?.connectedPlugins || [],
    questionsSequence: restoredState?.questionsSequence || [],
    currentQuestionIndex: restoredState?.currentQuestionIndex || 0,
    clarificationAnswers: restoredState?.clarificationAnswers || {},
    enhancedPrompt: restoredState?.enhancedPrompt || null,
    isProcessing: false,
    originalPrompt: restoredState?.originalPrompt || '',
    threadId: restoredState?.threadId || null,
  });

  // Persist state changes
  useEffect(() => {
    if (onStateChange) {
      onStateChange(state);
    }
  }, [state, onStateChange]);

  // Message management
  const addMessage = useCallback((message: Omit<Message, 'id' | 'timestamp'>) => {
    setState(prev => ({
      ...prev,
      messages: [
        ...prev.messages,
        {
          ...message,
          id: generateId(),
          timestamp: new Date()
        }
      ]
    }));
  }, []);

  // Stage handlers
  const handleInitialPrompt = async (prompt: string) => {
    // Implementation in Phase 4
  };

  const handlePluginConnected = async (pluginKey: string) => {
    // Implementation in Phase 4
  };

  const handleAnswerQuestion = async (questionId: string, answer: string) => {
    // Implementation in Phase 5
  };

  const handleAcceptPrompt = async () => {
    // Implementation in Phase 6
  };

  return {
    messages: state.messages,
    confidenceScore: state.confidenceScore,
    currentStage: state.currentStage,
    isProcessing: state.isProcessing,
    missingPlugins: state.missingPlugins,

    handleInitialPrompt,
    handlePluginConnected,
    handleAnswerQuestion,
    handleAcceptPrompt,
  };
}
```

#### 3.2 Confidence Calculation

**utils/confidenceCalculator.ts**
```typescript
export function calculateConfidence(state: ConversationalFlowState): number {
  let score = 45; // Base score from initial analysis

  // Plugins connected (+10% each)
  const totalPluginsNeeded = state.missingPlugins.length + state.connectedPlugins.length;
  const pluginsConnected = state.connectedPlugins.length;
  if (totalPluginsNeeded > 0) {
    score += (pluginsConnected / totalPluginsNeeded) * 20;
  }

  // Questions answered (+10% average each)
  const questionsAnswered = Object.keys(state.clarificationAnswers).length;
  const totalQuestions = state.questionsSequence.length;
  if (totalQuestions > 0) {
    score += (questionsAnswered / totalQuestions) * 30;
  }

  // Enhanced prompt reviewed (+5%)
  if (state.currentStage === 'review' && state.enhancedPrompt) {
    score += 5;
  }

  // Accepted → 100%
  if (state.currentStage === 'accepted') {
    return 100;
  }

  return Math.min(Math.round(score), 100);
}
```

---

### Phase 4: Plugin Connection Flow (Days 5-6)

#### 4.1 PluginConnectionCard Component

**components/messages/PluginConnectionCard.tsx**
```typescript
export function PluginConnectionCard({
  missingPlugins,
  onConnect,
  connectingPlugin
}: PluginConnectionCardProps) {

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-700 mb-4">
        I see you want to work with these services! To make this work, I'll need you to connect:
      </p>

      {missingPlugins.map(plugin => (
        <div
          key={plugin}
          className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                {getPluginIcon(plugin)}
              </div>
              <div>
                <h4 className="font-semibold text-gray-800">{getPluginDisplayName(plugin)}</h4>
                <p className="text-xs text-gray-600">{getPluginDescription(plugin)}</p>
              </div>
            </div>

            <button
              onClick={() => onConnect(plugin)}
              disabled={connectingPlugin === plugin}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
            >
              {connectingPlugin === plugin ? (
                <>
                  <Loader className="inline animate-spin h-4 w-4 mr-2" />
                  Connecting...
                </>
              ) : (
                <>
                  Connect {getPluginDisplayName(plugin)} →
                </>
              )}
            </button>
          </div>
        </div>
      ))}

      <div className="flex items-start gap-2 mt-4 p-3 bg-gray-50 rounded-lg">
        <Info className="h-4 w-4 text-gray-500 mt-0.5" />
        <p className="text-xs text-gray-600">
          These connections are secure and can be removed anytime from your settings.
        </p>
      </div>
    </div>
  );
}
```

#### 4.2 usePluginConnection Hook

**hooks/usePluginConnection.ts**
```typescript
export function usePluginConnection({
  onSuccess,
  onError
}: UsePluginConnectionProps) {

  const [connectingPlugin, setConnectingPlugin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connectPlugin = async (pluginKey: string) => {
    setConnectingPlugin(pluginKey);
    setError(null);

    try {
      // Open OAuth popup
      const popup = window.open(
        `/api/auth/oauth/connect?plugin=${pluginKey}`,
        'Connect Plugin',
        'width=600,height=700'
      );

      // Wait for OAuth completion
      const result = await new Promise((resolve, reject) => {
        const checkPopup = setInterval(() => {
          if (popup?.closed) {
            clearInterval(checkPopup);
            reject(new Error('Connection cancelled'));
          }
        }, 1000);

        window.addEventListener('message', (event) => {
          if (event.data.type === 'oauth-success') {
            clearInterval(checkPopup);
            popup?.close();
            resolve(event.data);
          }
        });
      });

      setConnectingPlugin(null);
      onSuccess(pluginKey);

    } catch (err) {
      setConnectingPlugin(null);
      setError(err.message);
      onError?.(err);
    }
  };

  return {
    connectPlugin,
    connectingPlugin,
    error
  };
}
```

---

### Phase 5: Question Flow (Days 6-7)

#### 5.1 QuestionCard Component

**components/messages/QuestionCard.tsx**
```typescript
export function QuestionCard({
  question,
  questionNumber,
  totalQuestions,
  onAnswer
}: QuestionCardProps) {

  const [customValue, setCustomValue] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const handleOptionSelect = (value: string) => {
    onAnswer(question.id, value);
  };

  const handleCustomSubmit = () => {
    if (customValue.trim()) {
      onAnswer(question.id, customValue);
      setCustomValue('');
      setShowCustomInput(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">
          Question {questionNumber} of {totalQuestions}
        </span>
      </div>

      <h4 className="text-base font-semibold text-gray-800 mb-4">
        {question.question}
      </h4>

      {question.type === 'select' && question.options && (
        <div className="grid grid-cols-2 gap-3">
          {question.options.map(option => (
            <button
              key={option.value}
              onClick={() => handleOptionSelect(option.value)}
              className="px-4 py-3 bg-white border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all text-sm font-medium text-gray-700"
            >
              {option.label}
            </button>
          ))}

          <button
            onClick={() => setShowCustomInput(true)}
            className="px-4 py-3 bg-white border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all text-sm font-medium text-gray-600"
          >
            ✏️ Custom answer
          </button>
        </div>
      )}

      {(question.type === 'text' || showCustomInput) && (
        <div className="space-y-2">
          <input
            type="text"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            placeholder="Type your answer..."
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCustomSubmit();
            }}
          />
          <button
            onClick={handleCustomSubmit}
            disabled={!customValue.trim()}
            className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            Submit Answer
          </button>
        </div>
      )}
    </div>
  );
}
```

#### 5.2 Question Flow Logic

```typescript
// In useConversationalFlow.ts

const handleAnswerQuestion = async (questionId: string, answer: string) => {
  // Save answer
  const newAnswers = {
    ...state.clarificationAnswers,
    [questionId]: answer
  };

  setState(prev => ({
    ...prev,
    clarificationAnswers: newAnswers,
    confidenceScore: calculateConfidence({
      ...prev,
      clarificationAnswers: newAnswers
    })
  }));

  // Add user answer to messages
  addMessage({
    type: 'user',
    content: answer,
    isQuestionAnswer: true
  });

  // Add completion chip
  addMessage({
    type: 'system',
    messageType: 'system_notification',
    content: 'Question answered'
  });

  // Check if more questions
  const nextIndex = state.currentQuestionIndex + 1;
  if (nextIndex < state.questionsSequence.length) {
    // Show next question
    setState(prev => ({ ...prev, currentQuestionIndex: nextIndex }));

    addMessage({
      type: 'ai',
      messageType: 'clarification_question',
      data: {
        question: state.questionsSequence[nextIndex],
        questionNumber: nextIndex + 1,
        totalQuestions: state.questionsSequence.length
      }
    });
  } else {
    // All questions answered, generate enhanced prompt
    await handleGenerateEnhancedPrompt(newAnswers);
  }
};
```

---

### Phase 6: Enhanced Prompt Review (Days 7-8)

#### 6.1 EnhancedPromptReview Component

**components/messages/EnhancedPromptReview.tsx**
```typescript
export function EnhancedPromptReview({
  plan,
  onAccept,
  onRevise
}: EnhancedPromptReviewProps) {

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-6 h-6 bg-purple-500 rounded-lg flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        <h4 className="font-semibold text-gray-800">Your Agent Plan</h4>
      </div>

      <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-200 rounded-lg p-4">
        <div className="prose prose-sm max-w-none">
          <ReactMarkdown>{plan}</ReactMarkdown>
        </div>
      </div>

      <p className="text-sm text-gray-600 mt-4">Does this look right?</p>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <button
          onClick={onAccept}
          className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-lg hover:from-emerald-600 hover:to-green-700 font-semibold flex items-center justify-center gap-2"
        >
          <CheckCircle className="h-5 w-5" />
          Yes, perfect!
        </button>

        <button
          onClick={onRevise}
          className="px-6 py-3 bg-white border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 hover:bg-gray-50 font-semibold flex items-center justify-center gap-2"
        >
          <Edit className="h-5 w-5" />
          Need changes
        </button>
      </div>
    </div>
  );
}
```

#### 6.2 Acceptance Flow

```typescript
// In useConversationalFlow.ts

const handleAcceptPrompt = async () => {
  // Set confidence to 100%
  setState(prev => ({
    ...prev,
    confidenceScore: 100,
    currentStage: 'accepted'
  }));

  // Add transition message
  addMessage({
    type: 'ai',
    messageType: 'transition',
    content: 'Perfect! I have everything I need. 🎉\n\nTaking you to the agent builder now...'
  });

  // Wait for animation
  await new Promise(resolve => setTimeout(resolve, 500));

  // Call completion handler
  onComplete({
    prompt: state.enhancedPrompt!,
    promptType: 'enhanced',
    clarificationAnswers: state.clarificationAnswers
  });
};
```

---

### Phase 7: Thread-Based API Integration (Days 8-10)

#### 7.1 Thread Management Hook

**hooks/useThreadManagement.ts**
```typescript
export function useThreadManagement() {
  const threadId = useRef<string | null>(null);
  const useThreadFlow = useThreadBasedAgentCreation();

  const initializeThread = async () => {
    if (!useThreadFlow) return null;

    try {
      const response = await fetch('/api/agent-creation/init-thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadata: { sessionId: generateSessionId() }
        })
      });

      if (!response.ok) {
        throw new Error('Failed to initialize thread');
      }

      const { thread_id } = await response.json();
      threadId.current = thread_id;

      console.log('✅ Thread initialized:', thread_id);
      return thread_id;

    } catch (error) {
      console.error('❌ Thread initialization failed:', error);
      return null;
    }
  };

  const processMessageInThread = async (
    phase: 1 | 2 | 3,
    prompt: string,
    clarificationAnswers?: Record<string, string>
  ) => {
    if (!threadId.current) {
      throw new Error('Thread not initialized');
    }

    try {
      const response = await fetch('/api/agent-creation/process-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: threadId.current,
          phase,
          user_prompt: prompt,
          clarification_answers: clarificationAnswers
        })
      });

      if (!response.ok) {
        throw new Error(`Phase ${phase} processing failed`);
      }

      const result = await response.json();
      console.log(`✅ Phase ${phase} completed:`, result);

      return result;

    } catch (error) {
      console.error(`❌ Phase ${phase} failed:`, error);
      throw error;
    }
  };

  return {
    threadId: threadId.current,
    initializeThread,
    processMessageInThread,
  };
}
```

#### 7.2 Integration with useConversationalFlow

```typescript
// In useConversationalFlow.ts

export function useConversationalFlow(props: UseConversationalFlowProps) {

  // Use thread management
  const { initializeThread, processMessageInThread } = useThreadManagement();

  // ... existing state

  const handleInitialPrompt = async (prompt: string) => {
    // Add user message
    addMessage({ type: 'user', content: prompt });
    setState(prev => ({
      ...prev,
      isProcessing: true,
      originalPrompt: prompt
    }));

    try {
      // Initialize thread
      await initializeThread();

      // Phase 1: Clarity analysis
      const phase1Result = await processMessageInThread(1, prompt);

      // Update confidence
      setState(prev => ({
        ...prev,
        confidenceScore: phase1Result.clarityScore || 45,
        isProcessing: false
      }));

      // Check for missing plugins
      if (phase1Result.missingPlugins?.length > 0) {
        setState(prev => ({
          ...prev,
          currentStage: 'plugins',
          missingPlugins: phase1Result.missingPlugins
        }));

        // Add plugin connection message
        addMessage({
          type: 'ai',
          messageType: 'plugin_warning',
          data: { missingPlugins: phase1Result.missingPlugins }
        });
      } else {
        // No missing plugins, proceed to questions
        await handleGenerateQuestions(prompt);
      }

    } catch (error) {
      console.error('Error in handleInitialPrompt:', error);
      setState(prev => ({ ...prev, isProcessing: false }));

      // Show error message
      addMessage({
        type: 'ai',
        messageType: 'text',
        content: 'Sorry, something went wrong. Please try again.'
      });
    }
  };

  const handlePluginConnected = async (pluginKey: string) => {
    // Remove from missing list
    setState(prev => {
      const newMissing = prev.missingPlugins.filter(p => p !== pluginKey);
      const newConnected = [...prev.connectedPlugins, pluginKey];

      return {
        ...prev,
        missingPlugins: newMissing,
        connectedPlugins: newConnected,
        confidenceScore: calculateConfidence({
          ...prev,
          missingPlugins: newMissing,
          connectedPlugins: newConnected
        })
      };
    });

    // Add success message
    addMessage({
      type: 'ai',
      messageType: 'text',
      content: `✓ ${getPluginDisplayName(pluginKey)} connected successfully!`
    });

    // Check if all plugins connected
    const remaining = state.missingPlugins.filter(p => p !== pluginKey);
    if (remaining.length === 0) {
      addMessage({
        type: 'ai',
        messageType: 'text',
        content: 'Great! Now let me ask a few questions to make sure I build exactly what you need...'
      });

      // Phase 2: Re-analysis with plugins
      await handleGenerateQuestions(state.originalPrompt);
    }
  };

  const handleGenerateQuestions = async (prompt: string) => {
    setState(prev => ({ ...prev, isProcessing: true }));

    try {
      // Phase 2: Generate questions with plugin context
      const phase2Result = await processMessageInThread(2, prompt);

      // Update state
      setState(prev => ({
        ...prev,
        currentStage: 'questions',
        questionsSequence: phase2Result.questionsSequence || [],
        currentQuestionIndex: 0,
        confidenceScore: phase2Result.clarityScore || prev.confidenceScore + 20,
        isProcessing: false
      }));

      // Add first question
      if (phase2Result.questionsSequence?.length > 0) {
        addMessage({
          type: 'ai',
          messageType: 'clarification_question',
          data: {
            question: phase2Result.questionsSequence[0],
            questionNumber: 1,
            totalQuestions: phase2Result.questionsSequence.length
          }
        });
      }

    } catch (error) {
      console.error('Error generating questions:', error);
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  };

  const handleGenerateEnhancedPrompt = async (answers: Record<string, string>) => {
    setState(prev => ({
      ...prev,
      isProcessing: true,
      currentStage: 'review'
    }));

    addMessage({
      type: 'ai',
      messageType: 'text',
      content: 'Excellent! Let me create your automation plan...'
    });

    try {
      // Build full prompt with clarifications
      const fullPrompt = Object.keys(answers).length > 0
        ? `${state.originalPrompt}\n\nClarification details:\n${Object.entries(answers)
            .map(([q, a]) => `- ${q}: ${a}`)
            .join('\n')}`
        : state.originalPrompt;

      // Phase 3: Generate enhanced prompt
      const phase3Result = await processMessageInThread(3, fullPrompt, answers);

      const enhancedPromptText = phase3Result.enhanced_prompt?.plan_description ||
                                  phase3Result.enhanced_prompt ||
                                  'Enhanced automation plan created';

      setState(prev => ({
        ...prev,
        enhancedPrompt: enhancedPromptText,
        confidenceScore: 95,
        isProcessing: false
      }));

      // Add enhanced prompt review message
      addMessage({
        type: 'ai',
        messageType: 'enhanced_prompt_review',
        data: {
          enhancedPlan: enhancedPromptText
        }
      });

    } catch (error) {
      console.error('Error generating enhanced prompt:', error);
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  };

  // ... rest of implementation
}
```

#### 7.3 Backend Enhancements Required

**File: `app/api/agent-creation/process-message/route.ts`**

Add enrichment after AI response (around line 383):

```typescript
// After parsing AI response
const aiResponse = JSON.parse(assistantMessage.content);

// Enrich response with metadata
const enrichedResponse = {
  ...aiResponse,
  success: true,
  phase,

  // Add structured fields
  prompt: user_prompt,
  userId: user.id,
  sessionId: threadRecord.metadata?.sessionId || threadRecord.id,

  // Fetch and attach plugin metadata
  connectedPlugins: aiResponse.requiredServices || [],
  connectedPluginsData: await fetchPluginMetadata(
    user.id,
    aiResponse.requiredServices || []
  ),

  // Ensure structured analysis
  analysis: {
    ...aiResponse.analysis,
    clarityScore: aiResponse.clarityScore,
    needsClarification: aiResponse.needsClarification,
    questionsSequence: aiResponse.questionsSequence || []
  }
};

return NextResponse.json(enrichedResponse);
```

Add helper function:

```typescript
async function fetchPluginMetadata(
  userId: string,
  pluginKeys: string[]
): Promise<PluginShortContext[]> {
  const pluginRegistry = PluginRegistryFactory.getInstance();
  const connectedPlugins = await pluginRegistry.getConnectedPluginsForUser(userId);

  const pluginDataContexts = await Promise.all(
    connectedPlugins.map(async (plugin) => {
      const pluginDefinition = pluginRegistry.getPluginDefinition(plugin);
      return new PluginDefinitionContext(pluginDefinition, plugin);
    })
  );

  return pluginDataContexts
    .filter(p => pluginKeys.includes(p.key))
    .map(p => p.toShortLLMContext());
}
```

---

### Phase 8: Animations & Polish (Days 9-10)

#### 8.1 Message Animations

```css
/* styles/conversational-ui.css */

@keyframes messageSlideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message-enter {
  animation: messageSlideIn 300ms ease-out;
}

@keyframes confidenceBarGrow {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

.confidence-bar-fill {
  transform-origin: left;
  transition: width 500ms ease-out;
}

@keyframes typingDots {
  0%, 20% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-5px);
  }
  100% {
    transform: translateY(0);
  }
}

.typing-dot {
  animation: typingDots 1.5s infinite;
}

.typing-dot:nth-child(2) {
  animation-delay: 0.15s;
}

.typing-dot:nth-child(3) {
  animation-delay: 0.3s;
}
```

#### 8.2 TypingIndicator Component

```typescript
export function TypingIndicator() {
  return (
    <div className="flex gap-3 justify-start mb-4">
      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
        <Bot className="h-4 w-4 text-white" />
      </div>

      <div className="bg-white/80 backdrop-blur-sm border border-white/30 rounded-xl px-4 py-3 shadow-md">
        <div className="flex items-center gap-2">
          <div className="flex space-x-1">
            <div className="w-2 h-2 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full typing-dot" />
            <div className="w-2 h-2 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full typing-dot" />
            <div className="w-2 h-2 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full typing-dot" />
          </div>
          <span className="text-sm text-gray-600">AI thinking...</span>
        </div>
      </div>
    </div>
  );
}
```

#### 8.3 Responsive Design

```css
/* Mobile: < 768px */
@media (max-width: 767px) {
  .conversational-builder {
    padding: 0 16px;
  }

  .message {
    font-size: 14px;
  }

  .confidence-bar {
    font-size: 11px;
    padding: 8px 16px;
  }

  .chat-input {
    padding: 12px 16px;
  }

  .button-grid {
    grid-template-columns: 1fr;
  }
}

/* Tablet: 768px - 1023px */
@media (min-width: 768px) and (max-width: 1023px) {
  .conversational-builder {
    padding: 0 24px;
  }

  .message {
    font-size: 15px;
  }

  .button-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* Desktop: >= 1024px */
@media (min-width: 1024px) {
  .conversational-builder {
    max-width: 900px;
    margin: 0 auto;
  }

  .message {
    font-size: 16px;
  }
}
```

---

### Phase 9: Integration with AgentBuilderParent (Day 10)

#### 9.1 Feature Flag Integration

**lib/utils/featureFlags.ts**

```typescript
export function useNewAgentCreationUI(): boolean {
  const flag = process.env.NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI;

  console.log("Feature Flag: NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI=", flag || 'none');

  if (!flag || flag.trim() === '') {
    return false;
  }

  const normalizedFlag = flag.trim().toLowerCase();

  if (normalizedFlag === 'false' || normalizedFlag === '0') {
    return false;
  }

  if (normalizedFlag === 'true' || normalizedFlag === '1') {
    return true;
  }

  return false;
}

export function getFeatureFlags() {
  return {
    useThreadBasedAgentCreation: useThreadBasedAgentCreation(),
    useNewAgentCreationUI: useNewAgentCreationUI(),
  };
}
```

#### 9.2 Update AgentBuilderParent

**components/agent-creation/AgentBuilderParent.tsx**

```typescript
import { useNewAgentCreationUI } from '@/lib/utils/featureFlags';
import ConversationalAgentBuilderV2 from './conversational/ConversationalAgentBuilderV2';
import ConversationalAgentBuilder from './ConversationalAgentBuilder'; // Old

export default function AgentBuilderParent(props: AgentBuilderParentProps) {
  const useNewUI = useNewAgentCreationUI();

  // ... existing logic

  // Render conversational builder
  if (currentPhase === 'conversational') {
    return useNewUI
      ? (
        <ConversationalAgentBuilderV2
          initialPrompt={conversationalState?.isInReviewMode ? undefined : initialPrompt}
          onPromptApproved={handlePromptApproved}
          onCancel={handleCancel}
          restoredState={conversationalState}
          onStateChange={handleConversationalStateChange}
        />
      )
      : (
        <ConversationalAgentBuilder
          initialPrompt={conversationalState?.isInReviewMode ? undefined : initialPrompt}
          onPromptApproved={handlePromptApproved}
          onCancel={handleCancel}
          restoredState={conversationalState}
          onStateChange={handleConversationalStateChange}
          onReturnToSmartBuilder={conversationalState?.allowNavigation ? handleReturnToSmartBuilder : undefined}
        />
      );
  }

  // ... rest of component
}
```

---

### Phase 10: Testing & Refinement (Days 11-12)

#### 10.1 Unit Tests

**__tests__/useConversationalFlow.test.ts**

```typescript
import { renderHook, act } from '@testing-library/react-hooks';
import { useConversationalFlow } from '../hooks/useConversationalFlow';

describe('useConversationalFlow', () => {
  it('should initialize with correct default state', () => {
    const { result } = renderHook(() => useConversationalFlow({
      initialPrompt: '',
      onComplete: jest.fn()
    }));

    expect(result.current.messages).toEqual([]);
    expect(result.current.confidenceScore).toBe(0);
    expect(result.current.currentStage).toBe('clarity');
  });

  it('should handle initial prompt submission', async () => {
    const onComplete = jest.fn();
    const { result } = renderHook(() => useConversationalFlow({
      initialPrompt: 'Test prompt',
      onComplete
    }));

    await act(async () => {
      await result.current.handleInitialPrompt('Send emails to Slack');
    });

    expect(result.current.messages.length).toBeGreaterThan(0);
    expect(result.current.confidenceScore).toBeGreaterThan(0);
  });

  it('should update confidence after plugin connection', () => {
    const { result } = renderHook(() => useConversationalFlow({
      initialPrompt: '',
      onComplete: jest.fn()
    }));

    const initialScore = result.current.confidenceScore;

    act(() => {
      result.current.handlePluginConnected('gmail');
    });

    expect(result.current.confidenceScore).toBeGreaterThan(initialScore);
  });

  // Add more tests...
});
```

#### 10.2 Integration Tests

**__tests__/conversational-flow-integration.test.tsx**

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ConversationalAgentBuilderV2 from '../ConversationalAgentBuilderV2';

describe('ConversationalAgentBuilderV2 Integration', () => {
  it('should complete full flow: prompt -> plugins -> questions -> enhancement', async () => {
    const onPromptApproved = jest.fn();

    render(
      <ConversationalAgentBuilderV2
        initialPrompt="Send emails to Slack"
        onPromptApproved={onPromptApproved}
      />
    );

    // Wait for plugin connection prompt
    await waitFor(() => {
      expect(screen.getByText(/connect/i)).toBeInTheDocument();
    });

    // Connect plugins
    fireEvent.click(screen.getByText(/Connect Gmail/i));
    fireEvent.click(screen.getByText(/Connect Slack/i));

    // Wait for questions
    await waitFor(() => {
      expect(screen.getByText(/Question 1 of/i)).toBeInTheDocument();
    });

    // Answer questions
    fireEvent.click(screen.getByText(/#general/i));

    // Wait for enhanced prompt
    await waitFor(() => {
      expect(screen.getByText(/Your Agent Plan/i)).toBeInTheDocument();
    });

    // Accept prompt
    fireEvent.click(screen.getByText(/Yes, perfect!/i));

    // Verify completion
    expect(onPromptApproved).toHaveBeenCalledWith(
      expect.objectContaining({
        promptType: 'enhanced'
      })
    );
  });
});
```

#### 10.3 Accessibility Testing

```typescript
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

describe('Accessibility', () => {
  it('should have no accessibility violations', async () => {
    const { container } = render(
      <ConversationalAgentBuilderV2
        initialPrompt=""
        onPromptApproved={jest.fn()}
      />
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('should support keyboard navigation', () => {
    render(<ConversationalAgentBuilderV2 initialPrompt="" onPromptApproved={jest.fn()} />);

    // Tab through interactive elements
    const input = screen.getByPlaceholderText(/type/i);
    input.focus();
    expect(document.activeElement).toBe(input);

    // Press Enter to submit
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    // Verify submission
  });
});
```

---

## Migration & Rollout

### Rollout Strategy

#### Phase 1: Development & Testing (Weeks 1-3)
- Build all components and features
- Unit and integration testing
- Internal QA testing
- Feature flags: Both false (use legacy)

```bash
NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION=false
NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI=false
```

#### Phase 2: Staged Rollout (Week 4)
- Enable for internal users first
- Monitor metrics and gather feedback
- Fix any critical issues

```bash
# Internal testing
NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION=true
NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI=true
```

#### Phase 3: A/B Testing (Week 5-6)
- 10% of users → New UI
- 90% of users → Legacy UI
- Compare metrics:
  - Completion rates
  - Time to complete
  - Token usage
  - User satisfaction

#### Phase 4: Gradual Increase (Week 7-8)
- 50% → New UI
- 50% → Legacy UI
- Continue monitoring

#### Phase 5: Full Rollout (Week 9+)
- 100% → New UI
- Keep legacy code for 1 month
- Plan deprecation

#### Phase 6: Cleanup (Week 13+)
- Remove legacy conversational builder
- Remove feature flags
- Archive old code

### Environment Configuration

**Development**
```bash
NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION=true
NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI=true
```

**Staging**
```bash
NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION=true
NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI=true
```

**Production (Initial)**
```bash
NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION=true
NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI=false  # Gradual rollout
```

**Production (Final)**
```bash
NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION=true
NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI=true
```

---

## Success Metrics

### Performance Metrics

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| **Token Usage per Agent** | 5,500 | 3,600 | AI Analytics DB |
| **Time to First Question** | 8-10s | 3-5s | Performance monitoring |
| **Plugin Connection Time** | 15-20s | 8-12s | OAuth tracking |
| **User Completion Rate** | ~65% | 85%+ | Analytics funnel |
| **Questions to 100%** | 3-4 | 1-2 | Session tracking |
| **Cost per Agent** | $0.0325 | $0.0255 | Token × pricing |

### Quality Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| **Question Relevance** | 4.5+ / 5 | User feedback |
| **Plugin-Aware Questions** | 80%+ | Question analysis |
| **Prompt Acceptance Rate** | 75%+ | First-view acceptance |
| **Average Iterations** | < 2 | Revision count |

### User Experience Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| **User Satisfaction** | 4.5+ / 5 | Post-creation survey |
| **Perceived Speed** | 4+ / 5 | User feedback |
| **Ease of Use** | 4.5+ / 5 | User feedback |
| **Would Recommend** | 80%+ | NPS score |

### Technical Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| **Error Rate** | < 1% | Error tracking |
| **API Success Rate** | > 99% | API monitoring |
| **Thread Resume Success** | > 95% | DB tracking |
| **Mobile Responsiveness** | 100% | Device testing |
| **Accessibility Score** | 100 | Lighthouse |

---

## Timeline Summary

### Total Duration: 15 Days (3 Weeks)

| Phase | Duration | Key Deliverables |
|-------|----------|------------------|
| **Phase 1: Core Structure** | 2 days | File structure, types, basic components |
| **Phase 2: Chat UI** | 2 days | Message components, layout, styling |
| **Phase 3: State Management** | 1 day | Hooks, state logic, confidence calc |
| **Phase 4: Plugin Flow** | 2 days | Plugin cards, OAuth, connection logic |
| **Phase 5: Question Flow** | 1 day | Question cards, answer handling |
| **Phase 6: Enhanced Review** | 1 day | Review component, acceptance flow |
| **Phase 7: Thread Integration** | 3 days | Thread APIs, backend fixes, integration |
| **Phase 8: Polish** | 1 day | Animations, responsive, accessibility |
| **Phase 9: Parent Integration** | 1 day | Feature flags, parent updates |
| **Phase 10: Testing** | 1 day | Unit tests, integration tests, QA |

**Buffer: +2 days for unexpected issues**

---

## Risk Assessment

### High Risk Items
1. ❗ **Thread API reliability** - Fallback to legacy if fails
2. ❗ **OAuth popup handling** - Cross-browser compatibility issues
3. ❗ **State synchronization** - Between thread and UI

### Medium Risk Items
1. ⚠️ **Mobile experience** - Touch interactions, viewport
2. ⚠️ **Performance** - Large message history handling
3. ⚠️ **Browser compatibility** - Safari, older browsers

### Low Risk Items
1. ℹ️ **Animation performance** - CSS optimizations available
2. ℹ️ **Accessibility** - Standard patterns, well-tested
3. ℹ️ **TypeScript errors** - Gradual typing, strict checking

### Mitigation Strategies

**Thread API Reliability**
- Implement graceful fallback to legacy APIs
- Add retry logic with exponential backoff
- Monitor error rates in production

**OAuth Handling**
- Test across all major browsers
- Provide alternative connection flow
- Clear error messages for blocked popups

**State Sync**
- LocalStorage backup for all state changes
- Resume capability from saved state
- Version state schema for migrations

---

## Appendix

### A. Design Specs

#### Colors
```
Primary AI:     Blue gradient (#4F46E5 → #7C3AED)
User:           Blue gradient (#2563EB → #4F46E5)
Success:        Green (#10B981)
Warning:        Orange (#F59E0B)
Error:          Red (#EF4444)
Progress:       Purple to Pink (#8B5CF6 → #EC4899)
Background:     Gradient (slate-50 → blue-50 → indigo-50)
Text:           Gray-900 (#111827)
```

#### Typography
```
AI/User Message: 16px, line-height 24px, font-weight 400
Buttons:         14px, font-weight 500
Labels:          12px, font-weight 500
Confidence Bar:  13px, font-weight 600
```

#### Spacing
```
Message Gap:     16px
Card Padding:    16px
Button Padding:  12px 24px
Container Max:   900px
```

### B. API Endpoints

#### Thread-Based
- `POST /api/agent-creation/init-thread`
- `POST /api/agent-creation/process-message`

#### Legacy (Fallback)
- `POST /api/analyze-prompt-clarity`
- `POST /api/generate-clarification-questions`
- `POST /api/enhance-prompt`

### C. Database Schema

**agent_prompt_threads table**
```sql
CREATE TABLE agent_prompt_threads (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  openai_thread_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_phase INTEGER,
  agent_id UUID,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  metadata JSONB
);
```

---

## Next Steps

1. ✅ Review and approve this implementation plan
2. ✅ Set up development environment with feature flags
3. ✅ Create initial file structure (Phase 1)
4. ✅ Begin component development (Phase 2)
5. ✅ Implement state management (Phase 3)
6. ✅ Continue with subsequent phases

---

**Document Version:** 1.0
**Last Updated:** 2025-01-04
**Author:** Development Team
**Status:** Ready for Implementation
