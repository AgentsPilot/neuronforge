import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Bot,
  User,
  Sparkles,
  CheckCircle,
  AlertCircle,
  ChevronRight,
  Edit,
  Save,
  X,
  MessageSquare,
  Target,
  CheckSquare,
  Brain,
  Send,
  Eye,
  ArrowRight,
  Clock,
  Zap,
  Settings,
  HelpCircle,
  ChevronDown,
  Info
} from 'lucide-react';
import QuestionRenderer from './QuestionRenderer';
import { useConversationalBuilder } from './useConversationalBuilder';
import { ClarificationQuestion, ConversationalAgentBuilderProps } from './types';

// Enhanced props interface with navigation support
interface EnhancedConversationalAgentBuilderProps extends ConversationalAgentBuilderProps {
  onReturnToSmartBuilder?: () => void;
}

// Memoized Inline Guide Banner Component
const InlineGuideBanner = React.memo(({ currentStep, onDismiss, isVisible }) => {
  const stepGuides = {
    'start': {
      title: 'Welcome! Start by describing your automation',
      message: 'Tell me what you want your agent to do in the chat below. Be as detailed as you like.',
      icon: MessageSquare,
      color: 'blue'
    },
    'questions': {
      title: 'Please answer the questions to clarify your needs',
      message: 'I need a few more details to build the perfect agent for you.',
      icon: HelpCircle,
      color: 'yellow'
    },
    'processing': {
      title: 'Creating your enhanced plan...',
      message: 'Analyzing your responses and building a detailed automation plan.',
      icon: Settings,
      color: 'purple'
    },
    'review': {
      title: 'Review your enhanced plan',
      message: 'Perfect! Check the plan below. You can edit it or approve it.',
      icon: Eye,
      color: 'green'
    },
    'ready': {
      title: 'Ready to build your agent!',
      message: 'Your plan is complete. Click "Continue" in the top-right to start building.',
      icon: Zap,
      color: 'emerald'
    }
  };

  const guide = stepGuides[currentStep];
  if (!guide || !isVisible) return null;

  const Icon = guide.icon;

  return (
    <div className={`mb-4 p-4 rounded-xl border backdrop-blur-sm transition-all duration-300 ${
      guide.color === 'blue' ? 'bg-blue-50/80 border-blue-200 text-blue-800' :
      guide.color === 'yellow' ? 'bg-yellow-50/80 border-yellow-200 text-yellow-800' :
      guide.color === 'purple' ? 'bg-purple-50/80 border-purple-200 text-purple-800' :
      guide.color === 'green' ? 'bg-green-50/80 border-green-200 text-green-800' :
      'bg-emerald-50/80 border-emerald-200 text-emerald-800'
    }`}>
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
          guide.color === 'blue' ? 'bg-blue-500' :
          guide.color === 'yellow' ? 'bg-yellow-500' :
          guide.color === 'purple' ? 'bg-purple-500' :
          guide.color === 'green' ? 'bg-green-500' :
          'bg-emerald-500'
        }`}>
          <Icon className="h-4 w-4 text-white" />
        </div>
        
        <div className="flex-1">
          <h3 className="font-semibold text-sm mb-1">{guide.title}</h3>
          <p className="text-xs leading-relaxed opacity-90">{guide.message}</p>
        </div>
        
        <button
          onClick={onDismiss}
          className="flex-shrink-0 text-current opacity-50 hover:opacity-70 transition-opacity"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
});

// Memoized Progress Indicator Component
const ProgressIndicator = React.memo(({ currentStep, steps }) => {
  return (
    <div className="bg-white/90 backdrop-blur-xl rounded-xl p-3 shadow-lg border border-white/20 mb-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-600">Progress</span>
        <span className="text-xs text-gray-500">{steps.indexOf(currentStep) + 1} of {steps.length}</span>
      </div>
      <div className="flex gap-2">
        {steps.map((step, index) => (
          <div
            key={step}
            className={`flex-1 h-1.5 rounded-full ${
              index <= steps.indexOf(currentStep) 
                ? 'bg-gradient-to-r from-blue-500 to-indigo-500' 
                : 'bg-gray-200'
            }`}
          />
        ))}
      </div>
    </div>
  );
});

// Memoized QuestionRenderer
const MemoizedQuestionRenderer = React.memo(QuestionRenderer, (prevProps, nextProps) => {
  return (
    prevProps.question.id === nextProps.question.id &&
    prevProps.isCurrent === nextProps.isCurrent &&
    prevProps.isProcessing === nextProps.isProcessing &&
    prevProps.readOnly === nextProps.readOnly &&
    JSON.stringify(prevProps.state.clarificationAnswers) === JSON.stringify(nextProps.state.clarificationAnswers) &&
    prevProps.state.showingCustomInput === nextProps.state.showingCustomInput &&
    prevProps.state.customInputQuestionId === nextProps.state.customInputQuestionId &&
    prevProps.state.customInputValue === nextProps.state.customInputValue
  );
});

// Helper function to safely format timestamps
const formatMessageTimestamp = (timestamp: any) => {
  try {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (isNaN(date.getTime())) {
      return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    console.warn('Error formatting timestamp:', error);
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
};

export default function ConversationalAgentBuilder(props: EnhancedConversationalAgentBuilderProps) {
  const {
    initialPrompt,
    onPromptApproved,
    onCancel,
    restoredState,
    onStateChange,
    onReturnToSmartBuilder,
  } = props;

  // Simple ref for messages container
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Guide system state - simplified
  const [showGuide, setShowGuide] = useState(true);
  const guideSteps = ['start', 'questions', 'processing', 'review', 'ready'];
  
  // Stable reference for initialPrompt to avoid useEffect dependency issues
  const hasInitialPrompt = useRef(!!initialPrompt);

  // Edit textarea ref for controlled focus
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const lastFocusTime = useRef(0);

  const {
    user,
    projectState,
    messages,
    inputValue,
    isProcessing,
    setInputValue,
    setProjectState,
    addMessage,
    clearPluginValidationError,

    handleSendMessage,
    handleOptionSelect,
    handleCustomAnswer,
    handleChangeAnswer,
    handleCustomInputChange,

    handleApproveEnhanced,
    handleUseOriginal,
    handleEditEnhanced,
    handleSaveEnhancedEdit,
    handleCancelEnhancedEdit,

    messagesEndRef,
  } = useConversationalBuilder({
    initialPrompt,
    restoredState,
    onStateChange,
    onPromptApproved,
    onCancel,
  });

  // NEW: Add follow-up question handler
  const handleFollowUpQuestion = useCallback((parentQuestionId: string, selectedValue: string, followUpQuestion: ClarificationQuestion) => {
    console.log('Follow-up question triggered:', {
      parentQuestionId,
      selectedValue,
      followUpQuestion: followUpQuestion.id
    });
    
    // Add the follow-up question to the sequence
    setProjectState(prev => {
      const newSequence = [...prev.questionsSequence];
      const parentIndex = newSequence.findIndex(q => q.id === parentQuestionId);
      
      if (parentIndex !== -1) {
        // Insert the follow-up question right after the parent
        newSequence.splice(parentIndex + 1, 0, followUpQuestion);
        
        return {
          ...prev,
          questionsSequence: newSequence,
          questionsWithVisibleOptions: new Set([
            ...prev.questionsWithVisibleOptions,
            followUpQuestion.id
          ])
        };
      }
      
      return prev;
    });
    
    // Add the follow-up question as a system message so it renders
    addMessage(JSON.stringify(followUpQuestion), 'system');
  }, [setProjectState, addMessage]);

  // SIMPLIFIED guide step calculation - only calculate on major state changes
  const currentGuideStep = useMemo(() => {
    if (!showGuide) return 'start';
    
    if (projectState.isReadyToBuild && projectState.allowNavigation) return 'ready';
    if (projectState.enhancedPrompt && !projectState.planApproved) return 'review';
    if (projectState.conversationCompleted && !projectState.enhancedPrompt) return 'processing';
    if (projectState.currentQuestionIndex >= 0) return 'questions';
    if (projectState.originalPrompt && !projectState.conversationCompleted) return 'questions';
    if (!projectState.originalPrompt && !hasInitialPrompt.current) return 'start';
    return 'questions';
  }, [
    showGuide, 
    projectState.isReadyToBuild, 
    projectState.allowNavigation, 
    projectState.enhancedPrompt, 
    projectState.planApproved,
    projectState.conversationCompleted,
    projectState.currentQuestionIndex,
    projectState.originalPrompt
  ]);

  // SIMPLIFIED controlled auto-focus - less aggressive
  useEffect(() => {
    if (projectState.isEditingEnhanced && editTextareaRef.current) {
      const now = Date.now();
      // Only focus if enough time has passed since last focus attempt
      if (now - lastFocusTime.current > 1000) {
        lastFocusTime.current = now;
        setTimeout(() => {
          if (editTextareaRef.current && projectState.isEditingEnhanced) {
            editTextareaRef.current.focus();
          }
        }, 100);
      }
    }
  }, [projectState.isEditingEnhanced]);

  // SIMPLIFIED auto-scroll - only on new messages, no intersection observer
  const lastMessageCount = useRef(messages.length);
  useEffect(() => {
    if (messages.length > lastMessageCount.current) {
      lastMessageCount.current = messages.length;
      // Simple, direct scroll without smooth behavior
      setTimeout(() => {
        if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ block: 'end' });
        }
      }, 100);
    }
  }, [messages.length]);

  const handleDismissGuide = useCallback(() => {
    setShowGuide(false);
  }, []);

  // Enhanced plugin warning detection
  const isPluginWarningMessage = useCallback((content: string) => {
    if (!content || typeof content !== 'string') return false;
    
    const warningPatterns = [
      'MISSING SERVICES:',
      'MISSING PLUGINS:',
      'missing services',
      'missing plugins',
      'services that aren\'t connected',
      'plugins that aren\'t connected',
      'haven\'t connected',
      'not connected',
      'connect services',
      'connect plugins',
      'services are missing',
      'plugins are missing',
      'aren\'t connected',
      'services aren\'t connected',
      'but these services aren\'t connected',
      'mentions.*but.*aren\'t connected',
      'focus on your connected services',
      'Note: Your request mentions'
    ];
    
    const contentLower = content.toLowerCase();
    return warningPatterns.some(pattern => {
      if (pattern.includes('.*')) {
        // Handle regex patterns
        const regex = new RegExp(pattern, 'i');
        return regex.test(content);
      }
      return contentLower.includes(pattern.toLowerCase());
    });
  }, []);

  // SIMPLIFIED message rendering - stable keys, minimal complexity
  const renderMessage = useCallback((message, index) => {
    // System question payload -> render interactive block
    if (message.type === 'system' && message.content.startsWith('{')) {
      try {
        const question = JSON.parse(message.content) as ClarificationQuestion;
        
        return (
          <MemoizedQuestionRenderer
            key={`${message.id}-question`}
            question={question}
            state={projectState}
            isCurrent={projectState.questionsSequence[projectState.currentQuestionIndex]?.id === question.id}
            isProcessing={projectState.isProcessingQuestion}
            onSelect={handleOptionSelect}
            onCustomSubmit={handleCustomAnswer}
            onCustomChange={handleCustomInputChange}
            onChangeAnswer={handleChangeAnswer}
            readOnly={projectState.isInReviewMode}
            onFollowUpQuestion={handleFollowUpQuestion}
          />
        );
      } catch (e) {
        return (
          <div key={`${message.id}-error`} className="flex gap-3 justify-start">
            <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-red-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md">
              <AlertCircle className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 max-w-2xl">
              <div className="bg-gradient-to-br from-red-50 to-red-50 border border-red-200 rounded-lg p-3 shadow-sm">
                <p className="text-red-800 text-sm font-medium">Error loading question. Please try again.</p>
              </div>
            </div>
          </div>
        );
      }
    }

    // System "question answered" chip
    if (message.type === 'system' && message.content.startsWith('Question answered')) {
      return (
        <div key={`${message.id}-system`} className="flex justify-center">
          <div className="inline-flex items-center gap-2 bg-gradient-to-r from-emerald-500/20 to-green-500/20 text-emerald-700 px-3 py-1.5 rounded-lg text-xs font-medium border border-emerald-200/50 backdrop-blur-sm">
            <div className="w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center">
              <CheckCircle className="h-2 w-2 text-white" />
            </div>
            Question Completed
          </div>
        </div>
      );
    }

    // Regular AI/User message bubble
    return (
      <div key={`${message.id}-msg`} className={`flex gap-3 ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
        {message.type === 'ai' && (
          <div className="flex-shrink-0">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shadow-md">
              <Bot className="h-4 w-4 text-white" />
            </div>
          </div>
        )}

        <div className={`max-w-2xl relative ${message.type === 'user' ? 'ml-12' : 'mr-12'}`}>
          <div
            className={`rounded-xl px-3 py-2 shadow-md backdrop-blur-sm relative border text-sm ${
              message.type === 'user'
                ? `bg-gradient-to-br from-blue-600 to-indigo-700 text-white border-blue-600 ${
                    message.isQuestionAnswer ? 'ring-1 ring-green-300 ring-offset-1' : ''
                  }`
                : isPluginWarningMessage(message.content)
                ? 'bg-gradient-to-br from-red-100 to-orange-100 text-red-900 border-2 border-red-400 shadow-lg animate-pulse'
                : 'bg-white/80 text-gray-800 border-white/30 hover:bg-white/90 transition-colors'
            }`}
          >
            {/* Warning icon for plugin warnings */}
            {message.type === 'ai' && isPluginWarningMessage(message.content) && (
              <div className="absolute -top-2 -right-2 w-6 h-6 bg-gradient-to-br from-red-500 to-red-600 rounded-full flex items-center justify-center shadow-lg animate-pulse">
                <AlertCircle className="h-3 w-3 text-white" />
              </div>
            )}

            {message.isQuestionAnswer && (
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-gradient-to-br from-emerald-400 to-green-500 rounded-full flex items-center justify-center shadow-md">
                <CheckCircle className="h-2 w-2 text-white" />
              </div>
            )}

            <div
              className={`whitespace-pre-wrap leading-relaxed ${
                isPluginWarningMessage(message.content) ? 'font-semibold' : ''
              }`}
            >
              {message.content}
            </div>

            <div className={`text-xs mt-2 flex items-center gap-1 ${
              message.type === 'user' 
                ? 'text-blue-100' 
                : isPluginWarningMessage(message.content)
                ? 'text-red-700'
                : 'text-gray-500'
            }`}>
              <Clock className="h-2.5 w-2.5" />
              {formatMessageTimestamp(message.timestamp)}
            </div>

            {/* Enhanced plan controls - FIXED: Updated condition */}
            {message.type === 'ai' &&
              projectState.enhancementComplete &&
              // TO FIXED IMMIDIATLY (BARAK)
              message.content?.includes('Your Automation Plan:') &&
              !projectState.planApproved &&
              !projectState.isInReviewMode && (
                <div className="mt-3 space-y-2">
                  {projectState.isEditingEnhanced ? (
                    <div className="bg-gray-50/90 backdrop-blur-sm rounded-lg p-3 space-y-2 border border-gray-200/50">
                      <div className="flex items-center gap-1.5">
                        <Edit className="h-3 w-3 text-gray-600" />
                        <span className="text-xs font-medium text-gray-700">Edit your plan:</span>
                      </div>
                      <textarea
                        ref={editTextareaRef}
                        value={projectState.editedEnhancedPrompt}
                        onChange={(e) => setProjectState((prev) => ({ ...prev, editedEnhancedPrompt: e.target.value }))}
                        className="w-full px-3 py-2 bg-white/90 text-gray-900 border border-gray-300 rounded-lg focus:ring-1 focus:ring-purple-500 focus:border-transparent min-h-[80px] resize-none text-xs leading-relaxed backdrop-blur-sm"
                        placeholder="Edit your automation plan..."
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveEnhancedEdit}
                          disabled={!projectState.editedEnhancedPrompt.trim()}
                          className="flex-1 bg-gradient-to-r from-purple-600 to-purple-700 text-white px-3 py-2 rounded-lg hover:from-purple-700 hover:to-purple-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-1.5 text-xs font-medium shadow-md"
                        >
                          <Save className="h-3 w-3" />
                          Save Changes
                        </button>
                        <button
                          onClick={handleCancelEnhancedEdit}
                          className="px-3 py-2 bg-gray-100/90 text-gray-700 rounded-lg hover:bg-gray-200/90 transition-colors flex items-center justify-center border border-gray-200"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <button
                        onClick={handleApproveEnhanced}
                        className="w-full group bg-gradient-to-r from-emerald-500 to-green-600 text-white px-4 py-2.5 rounded-lg hover:from-emerald-600 hover:to-green-700 transition-all duration-200 flex items-center justify-center gap-2 font-medium shadow-md transform hover:scale-[1.01] text-sm"
                      >
                        <div className="w-5 h-5 bg-white/20 rounded-lg flex items-center justify-center">
                          <CheckCircle className="h-3 w-3" />
                        </div>
                        Use This Plan
                        <ChevronRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
                      </button>
                      
                      <button
                        onClick={handleEditEnhanced}
                        className="w-full group bg-white text-gray-700 px-4 py-2.5 rounded-lg hover:bg-gray-50 transition-all duration-200 flex items-center justify-center gap-2 font-medium shadow-md border border-gray-200 transform hover:scale-[1.01] text-sm"
                      >
                        <div className="w-5 h-5 bg-gray-100 rounded-lg flex items-center justify-center">
                          <Edit className="h-3 w-3" />
                        </div>
                        Edit Plan
                      </button>
                    </div>
                  )}
                </div>
              )}
          </div>
        </div>

        {message.type === 'user' && (
          <div className="flex-shrink-0">
            <div className="w-8 h-8 bg-gradient-to-br from-gray-400 to-gray-600 rounded-lg flex items-center justify-center shadow-md">
              <User className="h-4 w-4 text-white" />
            </div>
          </div>
        )}
      </div>
    );
  }, [
    projectState.enhancementComplete, 
    projectState.planApproved, 
    projectState.isInReviewMode, 
    projectState.isEditingEnhanced, 
    projectState.editedEnhancedPrompt, 
    projectState.questionsSequence, 
    projectState.currentQuestionIndex, 
    projectState.isProcessingQuestion, 
    isPluginWarningMessage,
    handleOptionSelect, 
    handleCustomAnswer, 
    handleChangeAnswer,
    handleCustomInputChange,
    handleFollowUpQuestion,
    setProjectState, 
    handleSaveEnhancedEdit, 
    handleCancelEnhancedEdit, 
    handleApproveEnhanced, 
    handleEditEnhanced, 
    handleUseOriginal
  ]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Compact Header */}
      <div className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 border-b border-white/20 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-md">
                  <Bot className="h-4 w-4 text-white" />
                </div>
                <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full border border-white"></div>
              </div>
              <div>
                <h1 className="text-lg font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
                  AI Agent Builder
                </h1>
                <p className="text-xs text-gray-500">Conversational Agent Creation</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Help Button */}
              <button
                onClick={() => setShowGuide(true)}
                className="text-gray-500 hover:text-blue-600 transition-colors p-1.5 rounded-lg hover:bg-blue-50"
                title="Show guide"
              >
                <HelpCircle className="h-4 w-4" />
              </button>

              {projectState.enhancementComplete && projectState.enhancedPrompt && (
                <div className="hidden md:flex items-center gap-1.5 px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium animate-pulse">
                  <CheckCircle className="h-3 w-3" />
                  Ready
                </div>
              )}
              {onReturnToSmartBuilder && projectState.allowNavigation && (
                <button 
                  onClick={onReturnToSmartBuilder} 
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-1.5 rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 flex items-center gap-1.5 shadow-md text-xs font-medium animate-pulse ring-2 ring-blue-300"
                >
                  <ArrowRight className="h-3 w-3" />
                  Continue
                </button>
              )}
              {onCancel && (
                <button 
                  onClick={onCancel} 
                  className="text-gray-500 hover:text-gray-700 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/50 text-xs"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Sticky Inline Guide Banner - Part of Header */}
        {showGuide && (
          <div className="border-t border-white/20">
            <div className="max-w-7xl mx-auto px-4">
              <InlineGuideBanner 
                currentStep={currentGuideStep}
                onDismiss={handleDismissGuide}
                isVisible={showGuide}
              />
            </div>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto p-4">
        {/* Progress Indicator */}
        <ProgressIndicator currentStep={currentGuideStep} steps={guideSteps} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          
          {/* Main Chat Area */}
          <div className="lg:col-span-2">
            <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-lg border border-white/20 flex flex-col overflow-hidden h-[calc(100vh-120px)]">
              
              {/* Compact Review Mode Banner */}
              {projectState.isInReviewMode && (
                <div className="flex-shrink-0 m-3 p-3 bg-gradient-to-r from-blue-500/10 via-indigo-500/10 to-purple-500/10 border border-blue-200/50 rounded-xl backdrop-blur-sm">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
                      <Eye className="h-3 w-3 text-white" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-blue-900 mb-1">Review Mode</h4>
                      <p className="text-xs text-blue-800">
                        Questions are read-only. 
                        {projectState.allowNavigation && ' Navigate back to Smart Builder when ready.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Messages Area */}
              <div 
                ref={messagesContainerRef}
                className="flex-1 overflow-y-auto p-3 space-y-4"
              >
                {messages.map((message, index) => {
                  const renderedMessage = renderMessage(message, index);
                  // Filter out null messages (scheduling questions)
                  return renderedMessage;
                }).filter(Boolean)}

                {isProcessing && (
                  <div className="flex gap-3 justify-start">
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-md">
                      <Bot className="h-4 w-4 text-white" />
                    </div>
                    <div className="bg-white/80 backdrop-blur-sm border border-white/30 rounded-lg px-3 py-2 mr-12 shadow-md">
                      <div className="flex items-center gap-3">
                        <div className="flex space-x-1">
                          <div className="w-2 h-2 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="w-2 h-2 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <div className="w-2 h-2 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                        <span className="text-gray-700 text-sm font-medium">AI thinking...</span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>
          </div>

          {/* Compact Sidebar - Simplified to reduce re-renders */}
          <div className="space-y-3">
            
            {/* Progress Card */}
            <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-4 shadow-lg border border-white/20">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                  <Brain className="h-3 w-3 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">Progress</h3>
                  <p className="text-xs text-gray-500">AI comprehension</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600 text-sm font-medium">Clarity</span>
                  <span className="text-lg font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                    {projectState.clarityScore}%
                  </span>
                </div>

                <div className="w-full bg-gray-200/50 rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-purple-500 via-pink-500 to-purple-600 h-full rounded-full transition-all duration-1000 ease-out"
                    style={{ width: `${projectState.clarityScore}%` }}
                  />
                </div>

                {/* Question progress counter */}
                {projectState.questionsSequence.length > 0 && (
                  <div className="text-xs text-gray-600">
                    {(() => {
                      const answeredCount = Object.keys(projectState.clarificationAnswers).length;
                      const totalQuestions = projectState.questionsSequence.length;
                      
                      if (projectState.currentQuestionIndex === -1 || answeredCount === totalQuestions) {
                        return `All ${totalQuestions} questions completed`;
                      } else {
                        const currentQuestion = Math.max(1, projectState.currentQuestionIndex + 1);
                        return `Question ${currentQuestion} of ${totalQuestions}`;
                      }
                    })()}
                    {projectState.isProcessingQuestion && <span className="ml-1 text-blue-600">(processing...)</span>}
                  </div>
                )}

                {projectState.enhancementComplete && projectState.enhancedPrompt && (
                  <div className="flex items-center gap-2 p-2 bg-green-50 rounded-lg border border-green-200">
                    <div className="w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                      <CheckCircle className="h-2 w-2 text-white" />
                    </div>
                    <span className="text-green-700 text-xs font-medium">Ready to build!</span>
                  </div>
                )}
              </div>
            </div>

            {/* Requirements Card - Simplified */}
            <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-4 shadow-lg border border-white/20">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
                    <CheckSquare className="h-3 w-3 text-white" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">Requirements</h3>
                    <p className="text-xs text-gray-500">
                      {projectState.requirements.filter((r) => r.status === 'clear').length} of {projectState.requirements.length} complete
                    </p>
                  </div>
                </div>
                <div className="text-lg font-bold text-blue-600">
                  {Math.round(
                    (projectState.requirements.filter((r) => r.status === 'clear').length / projectState.requirements.length) * 100
                  )}%
                </div>
              </div>

              <div className="space-y-2">
                {projectState.requirements.map((req) => (
                  <div key={req.id} className="group relative">
                    <div
                      className={`rounded-lg border transition-all duration-300 ${
                        req.status === 'clear'
                          ? 'border-green-200 bg-green-50/80'
                          : req.status === 'partial'
                          ? 'border-yellow-200 bg-yellow-50/80'
                          : 'border-gray-200 bg-gray-50/50 group-hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center p-3">
                        <div
                          className={`flex-shrink-0 w-5 h-5 rounded-lg flex items-center justify-center transition-all ${
                            req.status === 'clear'
                              ? 'bg-green-500'
                              : req.status === 'partial'
                              ? 'bg-yellow-500'
                              : 'bg-gray-300 group-hover:bg-gray-400'
                          }`}
                        >
                          {req.status === 'clear' && <CheckCircle className="h-2.5 w-2.5 text-white" />}
                          {req.status === 'partial' && <AlertCircle className="h-2.5 w-2.5 text-white" />}
                          {req.status === 'missing' && <div className="w-2 h-2 bg-white rounded-full" />}
                        </div>

                        <div className="ml-3 flex-1">
                          <div className="flex items-center justify-between mb-0.5">
                            <h4
                              className={`text-sm font-medium ${
                                req.status === 'clear' ? 'text-green-800' : req.status === 'partial' ? 'text-yellow-800' : 'text-gray-700'
                              }`}
                            >
                              {req.label}
                            </h4>
                            <span
                              className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${
                                req.status === 'clear'
                                  ? 'bg-green-100 text-green-700'
                                  : req.status === 'partial'
                                  ? 'bg-yellow-100 text-yellow-700'
                                  : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {req.status === 'clear' ? 'Done' : req.status === 'partial' ? 'Partial' : 'Pending'}
                            </span>
                          </div>

                          {req.detected && (
                            <p
                              className="text-xs text-gray-600 leading-relaxed cursor-help"
                              title={req.detected.length > 50 ? req.detected : undefined}
                            >
                              {req.detected.length > 50 ? `${req.detected.slice(0, 50)}...` : req.detected}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Plugin validation error */}
            {projectState.pluginValidationError && (
              <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-4 shadow-lg border border-red-200/50">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 bg-gradient-to-br from-red-500 to-red-600 rounded-lg flex items-center justify-center">
                    <AlertCircle className="h-3 w-3 text-white" />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-800">Missing Connections</h3>
                </div>

                <div className="space-y-3">
                  <p className="text-xs text-gray-700">Required services:</p>

                  <div className="space-y-1">
                    {projectState.missingPlugins?.map((plugin) => (
                      <div key={plugin} className="flex items-center gap-2 p-2 bg-red-50/80 rounded-lg border border-red-200/50">
                        <div className="w-4 h-4 bg-red-500 rounded-md flex items-center justify-center">
                          <AlertCircle className="h-2 w-2 text-white" />
                        </div>
                        <span className="text-xs font-medium text-red-800 capitalize">{plugin}</span>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-1">
                    {projectState.suggestions?.map((suggestion, index) => (
                      <p key={index} className="text-xs text-gray-600 leading-relaxed">
                        • {suggestion}
                      </p>
                    ))}
                  </div>

                  <div className="grid gap-1.5">
                    <button
                      onClick={() => typeof window !== 'undefined' && window.open('/settings/integrations', '_blank')}
                      className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-3 py-2 rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-colors text-xs font-medium shadow-md"
                    >
                      Connect Services
                    </button>

                    <button
                      onClick={clearPluginValidationError}
                      className="w-full bg-gray-600 text-white px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors text-xs font-medium"
                    >
                      Continue Anyway
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Original Request */}
            {projectState.originalPrompt && (
              <div className="bg-gradient-to-br from-emerald-50/50 to-green-50/50 backdrop-blur-xl rounded-2xl p-4 shadow-lg border border-emerald-200/30">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-5 h-5 bg-gradient-to-br from-emerald-500 to-green-500 rounded-lg flex items-center justify-center">
                    <MessageSquare className="h-2.5 w-2.5 text-white" />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-800">Original Request</h3>
                </div>
                <div className="bg-white/80 backdrop-blur-sm rounded-lg p-3 border border-white/30">
                  <p className="text-gray-700 text-xs leading-relaxed">{projectState.originalPrompt}</p>
                </div>
              </div>
            )}

            {/* Enhanced Plan Preview */}
            {projectState.enhancedPrompt && (
              <div className="bg-gradient-to-br from-purple-50/50 to-indigo-50/50 backdrop-blur-xl rounded-2xl p-4 shadow-lg border border-purple-200/30">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-5 h-5 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-lg flex items-center justify-center">
                    <Sparkles className="h-2.5 w-2.5 text-white" />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-800">Enhanced Plan</h3>
                </div>
                <div className="bg-white/80 backdrop-blur-sm rounded-lg p-3 border border-white/30">
                  <p className="text-gray-700 text-xs leading-relaxed whitespace-pre-wrap">{projectState.enhancedPrompt}</p>
                </div>
              </div>
            )}

            {/* Next Steps - Simplified, UPDATED: removed scheduling references */}
            <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-4 shadow-lg border border-white/20">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
                  <Target className="h-3 w-3 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">Next Steps</h3>
                  <p className="text-xs text-gray-500">What's coming up</p>
                </div>
              </div>

              <div className="space-y-2">
                {projectState.isInReviewMode ? (
                  <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                      <Eye className="h-2 w-2 text-white" />
                    </div>
                    <span className="text-blue-700 text-xs font-medium">Review complete - ready for next step</span>
                  </div>
                ) : (
                  <>
                    {!projectState.originalPrompt && (
                      <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg border border-blue-200">
                        <div className="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center animate-pulse">
                          <Settings className="h-2 w-2 text-white" />
                        </div>
                        <span className="text-blue-700 text-xs font-medium">Describe your automation need</span>
                      </div>
                    )}

                    {projectState.originalPrompt && projectState.currentQuestionIndex >= 0 && !projectState.conversationCompleted && (
                      <div className="flex items-center gap-2 p-2 bg-yellow-50 rounded-lg border border-yellow-200">
                        <div className="w-4 h-4 bg-yellow-500 rounded-full flex items-center justify-center animate-pulse">
                          <MessageSquare className="h-2 w-2 text-white" />
                        </div>
                        <span className="text-yellow-700 text-xs font-medium">
                          Answer question {projectState.currentQuestionIndex + 1}/{projectState.questionsSequence.length}
                        </span>
                      </div>
                    )}

                    {projectState.planApproved && projectState.isReadyToBuild && (
                      <div className="flex items-center gap-2 p-2 bg-green-50 rounded-lg border border-green-200">
                        <div className="w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                          <Zap className="h-2 w-2 text-white" />
                        </div>
                        <span className="text-green-700 text-xs font-medium">Ready for smart build phase</span>
                      </div>
                    )}

                    {isProcessing && (
                      <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg border border-blue-200">
                        <div className="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center animate-pulse">
                          <Settings className="h-2 w-2 text-white" />
                        </div>
                        <span className="text-blue-700 text-xs font-medium">Processing...</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}