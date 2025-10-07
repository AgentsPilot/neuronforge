import { useState, useEffect, useRef, useCallback } from 'react';
import { Message, ProjectState } from './types';

interface UseMessageHandlersParams {
  projectState: ProjectState;
  restoredState?: Partial<ProjectState>;
  initialPrompt?: string;
  agentId: string;
  generateUUID: () => string;
}

export function useMessageHandlers({
  projectState,
  restoredState,
  initialPrompt,
  agentId,
  generateUUID,
}: UseMessageHandlersParams) {
  
  const initialMessageId = useRef(`initial-${generateUUID()}`);

  // Utility to ensure timestamps are Date objects
  const ensureDateTimestamp = useCallback((message: Message): Message => {
    return {
      ...message,
      timestamp: message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp)
    };
  }, []);

  // Messages with proper restoration
  const [messages, setMessages] = useState<Message[]>(() => {
    console.log('Initializing messages with CONSISTENT agent ID:', {
      hasRestoredState: !!restoredState,
      isInReviewMode: restoredState?.isInReviewMode,
      restoredMessages: restoredState?.messages?.length || 0,
      hasInitialPrompt: !!initialPrompt,
      agentId: agentId
    });

    // PRIORITY 1: Restore from completed work with message history
    if (restoredState?.messages?.length > 0) {
      console.log('Restoring complete message history');
      return restoredState.messages.map(msg => ensureDateTimestamp(msg));
    }

    // PRIORITY 2: Build messages from restored state data (if no message history)
    if (restoredState && (restoredState.originalPrompt || restoredState.questionsSequence?.length > 0)) {
      console.log('Rebuilding messages from state data');
      
      const rebuiltMessages: Message[] = [
        {
          id: initialMessageId.current,
          type: 'ai',
          content: restoredState.originalPrompt
            ? `Hello, I see you want to: "${restoredState.originalPrompt}". Let me help you build an agent for this!`
            : "Hello! I'm here to help you build a custom AI agent.",
          timestamp: new Date(),
        },
      ];

      // Add original user message if exists
      if (restoredState.originalPrompt) {
        rebuiltMessages.push({
          id: `user-original-${Date.now()}`,
          type: 'user',
          content: restoredState.originalPrompt,
          timestamp: new Date(),
        });
      }

      // Rebuild question/answer flow
      if (restoredState.questionsSequence && restoredState.clarificationAnswers) {
        restoredState.questionsSequence.forEach((question, index) => {
          // AI asks question
          rebuiltMessages.push({
            id: `ai-question-${index}`,
            type: 'ai',
            content: question.question,
            timestamp: new Date(),
          });

          // System question component
          rebuiltMessages.push({
            id: `question-${index}`,
            type: 'system',
            content: JSON.stringify(question),
            timestamp: new Date(),
            questionId: question.id,
          });

          // User answer if provided
          const answer = restoredState.clarificationAnswers![question.id];
          if (answer) {
            rebuiltMessages.push({
              id: `user-answer-${index}`,
              type: 'user',
              content: answer,
              timestamp: new Date(),
              questionId: question.id,
              isQuestionAnswer: true,
            });

            rebuiltMessages.push({
              id: `system-complete-${index}`,
              type: 'system',
              content: 'Question answered',
              timestamp: new Date(),
              questionId: question.id,
            });
          }
        });
      }

      // Add enhancement if exists
      if (restoredState.enhancedPrompt) {
        rebuiltMessages.push({
          id: `enhancement-${Date.now()}`,
          type: 'ai',
          content: `Here's your enhanced automation plan:

**Enhanced Plan:**
${restoredState.enhancedPrompt}

${restoredState.isInReviewMode ? 
  'This is your completed plan. You can navigate back to Smart Builder or create a new agent.' :
  'Would you like to use this enhanced version, edit it, or stick with your original request?'}`,
          timestamp: new Date(),
        });
      }

      return rebuiltMessages;
    }

    // PRIORITY 3: Fresh start
    return [
      {
        id: initialMessageId.current,
        type: 'ai',
        content: initialPrompt
          ? `Hello, I see you want to: "${initialPrompt}". Let me help you build an agent for this!`
          : "Hello! I'm here to help you build a custom AI agent. What would you like it to do?",
        timestamp: new Date(),
      },
    ];
  });

  // Auto-scroll
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Message utilities
  const messageCounter = useRef(0);
  
  // Updated addMessage function to support both formats
  const addMessage = useCallback(
    (contentOrMessage: string | Message, type?: 'user' | 'ai' | 'system', status?: 'sending' | 'sent' | 'error', questionId?: string, isQuestionAnswer?: boolean) => {
      // Don't add messages in review mode unless it's a system message
      if (projectState.isInReviewMode && (typeof contentOrMessage === 'string' ? type : contentOrMessage.type) !== 'system') {
        console.log('Message blocked - in review mode');
        return;
      }

      messageCounter.current += 1;
      
      let newMessage: Message;
      
      if (typeof contentOrMessage === 'object') {
        // New format: full Message object passed
        newMessage = {
          ...contentOrMessage,
          timestamp: contentOrMessage.timestamp || new Date(),
        };
      } else {
        // Legacy format: individual parameters
        newMessage = {
          id: `msg-${messageCounter.current}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: type!,
          content: contentOrMessage,
          timestamp: new Date(),
          status,
          questionId,
          isQuestionAnswer,
        };
      }
      
      setMessages((prev) => [...prev, newMessage]);
      return newMessage.id;
    },
    [projectState.isInReviewMode]
  );

  const clearPluginValidationError = useCallback(() => {
    // This would typically update project state, but since we're separating concerns,
    // we'll return a function that the main hook can use
    return {
      pluginValidationError: false,
      missingPlugins: [],
      requiredServices: [],
      suggestions: [],
    };
  }, []);

  // Question flow logic handlers
  const proceedToNextQuestion = useCallback((setProjectState: any) => {
    // Don't proceed in review mode
    if (projectState.isInReviewMode) {
      console.log('Question progression blocked - in review mode');
      return;
    }

    setProjectState((current: ProjectState) => {
      console.log('proceedToNextQuestion called:', {
        currentIndex: current.currentQuestionIndex,
        totalQuestions: current.questionsSequence.length,
        answersCount: Object.keys(current.clarificationAnswers).length,
        isInReviewMode: current.isInReviewMode
      });

      const nextUnansweredIndex = current.questionsSequence.findIndex((q, idx) => {
        const isAfterCurrent = idx > current.currentQuestionIndex;
        const isAnswered = !!(current.clarificationAnswers[q.id]?.trim());
        return isAfterCurrent && !isAnswered;
      });

      if (nextUnansweredIndex >= 0) {
        console.log(`Moving to next question at index ${nextUnansweredIndex}`);
        const nextId = current.questionsSequence[nextUnansweredIndex].id;
        const newVisible = new Set(current.questionsWithVisibleOptions);
        newVisible.add(nextId);
        return { 
          ...current, 
          currentQuestionIndex: nextUnansweredIndex, 
          isProcessingQuestion: false, 
          questionsWithVisibleOptions: newVisible 
        };
      }

      // Check for any remaining unanswered questions
      const unanswered = current.questionsSequence.filter(
        (q) => !current.clarificationAnswers[q.id]?.trim()
      );
      
      if (unanswered.length > 0) {
        const firstIdx = current.questionsSequence.findIndex((q) => q.id === unanswered[0].id);
        console.log(`Returning to unanswered question at index ${firstIdx}`);
        const newVisible = new Set(current.questionsWithVisibleOptions);
        newVisible.add(unanswered[0].id);
        return { 
          ...current, 
          currentQuestionIndex: firstIdx, 
          isProcessingQuestion: false, 
          questionsWithVisibleOptions: newVisible 
        };
      }

      // All questions answered - ready for enhancement
      console.log('🎯 All questions completed - ready for STEP 3: Enhancement');
      return { 
        ...current, 
        currentQuestionIndex: -1, 
        isProcessingQuestion: false,
        workflowPhase: 'enhancement'
      };
    });
  }, [projectState.isInReviewMode]);

  // User interaction handlers
  const handleOptionSelect = useCallback(
    (questionId: string, selectedValue: string, selectedLabel: string, setProjectState: any) => {
      if (projectState.isProcessingQuestion || projectState.isInReviewMode) return;

      if (selectedValue === 'custom') {
        setProjectState((prev: ProjectState) => ({ 
          ...prev, 
          showingCustomInput: true,
          customInputQuestionId: questionId,
          customInputValue: ''
        }));
        return;
      }

      setProjectState((current: ProjectState) => ({
        ...current,
        clarificationAnswers: { ...current.clarificationAnswers, [questionId]: selectedLabel },
        isProcessingQuestion: true,
      }));

      addMessage(selectedLabel, 'user', 'sent', questionId, true);

      setTimeout(() => {
        addMessage('Question answered', 'system', 'sent', questionId);
        setProjectState((prev: ProjectState) => ({ ...prev, isProcessingQuestion: false }));
        setTimeout(() => proceedToNextQuestion(setProjectState), 200);
      }, 300);
    },
    [projectState.isProcessingQuestion, projectState.isInReviewMode, proceedToNextQuestion, addMessage]
  );

  const handleCustomAnswer = useCallback((setProjectState: any) => {
    const questionId = projectState.customInputQuestionId;
    if (!questionId || projectState.isProcessingQuestion || !projectState.customInputValue.trim() || projectState.isInReviewMode) {
      return;
    }

    const customAnswer = projectState.customInputValue.trim();

    setProjectState((current: ProjectState) => ({
      ...current,
      clarificationAnswers: { ...current.clarificationAnswers, [questionId]: customAnswer },
      showingCustomInput: false,
      customInputQuestionId: null,
      customInputValue: '',
      isProcessingQuestion: true,
    }));

    addMessage(customAnswer, 'user', 'sent', questionId, true);

    setTimeout(() => {
      addMessage('Question answered', 'system', 'sent', questionId);
      setProjectState((prev: ProjectState) => ({ ...prev, isProcessingQuestion: false }));
      setTimeout(() => proceedToNextQuestion(setProjectState), 200);
    }, 300);
  }, [
    projectState.customInputQuestionId,
    projectState.customInputValue,
    projectState.isProcessingQuestion,
    projectState.isInReviewMode,
    proceedToNextQuestion,
    addMessage,
  ]);

  const handleChangeAnswer = useCallback((questionId: string, setProjectState: any) => {
    // Don't allow changes in review mode
    if (projectState.isInReviewMode) return;

    setProjectState((prev: ProjectState) => {
      const newAnswers = { ...prev.clarificationAnswers };
      delete newAnswers[questionId];

      const newVisible = new Set(prev.questionsWithVisibleOptions);
      newVisible.add(questionId);

      return { 
        ...prev, 
        clarificationAnswers: newAnswers, 
        questionsWithVisibleOptions: newVisible,
        showingCustomInput: false,
        customInputQuestionId: null,
        customInputValue: ''
      };
    });
  }, [projectState.isInReviewMode]);

  const handleCustomInputChange = useCallback((questionId: string, value: string, setProjectState: any) => {
    console.log('handleCustomInputChange called:', { questionId, value, isEmpty: value === '' });
    
    if (value === '') {
      // User clicked "Custom Answer" button - open the input
      console.log('Opening custom input for question:', questionId);
      setProjectState((prev: ProjectState) => ({ 
        ...prev, 
        showingCustomInput: true,
        customInputQuestionId: questionId,
        customInputValue: ''
      }));
    } else {
      // User is typing - update the value for both custom input AND direct text answers
      console.log('Updating input value:', value);
      setProjectState((prev: ProjectState) => {
        // For custom input mode
        if (prev.customInputQuestionId === questionId) {
          return { ...prev, customInputValue: value };
        }
        // For direct text input questions - update the answer directly
        return { 
          ...prev, 
          clarificationAnswers: { ...prev.clarificationAnswers, [questionId]: value }
        };
      });
    }
  }, []);

  const handleSendMessage = useCallback(async (inputValue: string, setInputValue: any, setIsProcessing: any) => {
    if (!inputValue.trim() || projectState.isInReviewMode) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    addMessage(userMessage, 'user');
    setIsProcessing(true);

    try {
      addMessage("I'm here to help you build your agent. What would you like to know?", 'ai');
    } catch {
      addMessage('I encountered an error. Please try again.', 'ai');
    } finally {
      setIsProcessing(false);
    }
  }, [projectState.isInReviewMode, addMessage]);

  // Enhancement approval handlers
  const handleApproveEnhanced = useCallback((setProjectState: any, onPromptApproved: any, sessionId: string) => {
    setProjectState((prev: ProjectState) => ({ 
      ...prev, 
      userApproved: true, 
      isReadyToBuild: true,
      planApproved: true,
      workflowPhase: 'completed'
    }));
    addMessage("Excellent! Moving to the smart build phase.", 'ai');

    console.log('🔍 handleApproveEnhanced - Passing agent ID and session ID:', {
      agentId: agentId,
      sessionId: sessionId,
      clarificationAnswersCount: Object.keys(projectState.clarificationAnswers).length
    });

    onPromptApproved?.({
      prompt: projectState.enhancedPrompt,
      promptType: 'enhanced',
      clarificationAnswers: {
        ...projectState.clarificationAnswers,
        agentId: agentId,
        sessionId: sessionId
      }
    });
  }, [projectState, agentId, addMessage]);

  const handleUseOriginal = useCallback((setProjectState: any, onPromptApproved: any, sessionId: string) => {
    setProjectState((prev: ProjectState) => ({ 
      ...prev, 
      userApproved: true, 
      isReadyToBuild: true,
      planApproved: true,
      workflowPhase: 'completed'
    }));
    addMessage("Perfect! Using your original request to build your agent.", 'ai');

    onPromptApproved?.({
      prompt: projectState.originalPrompt,
      promptType: 'original',
      clarificationAnswers: {
        ...projectState.clarificationAnswers,
        agentId: agentId,
        sessionId: sessionId
      }
    });
  }, [projectState, agentId, addMessage]);

  const handleEditEnhanced = useCallback((setProjectState: any) => {
    setProjectState((prev: ProjectState) => ({ 
      ...prev, 
      isEditingEnhanced: true, 
      editedEnhancedPrompt: prev.enhancedPrompt 
    }));
  }, []);

  const handleSaveEnhancedEdit = useCallback((setProjectState: any) => {
    if (!projectState.editedEnhancedPrompt.trim()) return;

    setProjectState((prev: ProjectState) => ({
      ...prev,
      enhancedPrompt: prev.editedEnhancedPrompt.trim(),
      isEditingEnhanced: false,
    }));

    addMessage(
      "I've updated your enhanced plan. Please review and let me know if you'd like to use it or make more changes.",
      'ai'
    );
  }, [projectState.editedEnhancedPrompt, addMessage]);

  const handleCancelEnhancedEdit = useCallback((setProjectState: any) => {
    setProjectState((prev: ProjectState) => ({ 
      ...prev, 
      isEditingEnhanced: false, 
      editedEnhancedPrompt: '' 
    }));
  }, []);

  return {
    messages,
    setMessages,
    messagesEndRef,
    addMessage,
    clearPluginValidationError,
    
    // Handlers that need to be connected to setProjectState in main hook
    handleOptionSelect,
    handleCustomAnswer,
    handleChangeAnswer,
    handleCustomInputChange,
    handleSendMessage,
    handleApproveEnhanced,
    handleUseOriginal,
    handleEditEnhanced,
    handleSaveEnhancedEdit,
    handleCancelEnhancedEdit,
    proceedToNextQuestion,
  };
}