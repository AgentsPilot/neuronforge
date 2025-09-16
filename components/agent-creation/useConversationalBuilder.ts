import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/components/UserProvider';
import {
  Message,
  ProjectState,
  ClarificationQuestion,
  ClarityAnalysis,
  RequirementItem,
} from './types';

/**
 * FIXED VERSION: Proper completion state handling with AI prevention
 */
export function useConversationalBuilder(params: {
  initialPrompt?: string;
  restoredState?: Partial<ProjectState>;
  onStateChange?: (s: ProjectState) => void;
  onPromptApproved?: (data: {
    prompt: string;
    promptType: 'original' | 'enhanced';
    clarificationAnswers: Record<string, string>;
  }) => void;
  onCancel?: () => void;
}) {
  const { initialPrompt, restoredState, onStateChange, onPromptApproved } = params;
  const { user } = useAuth();

  // Session tracking
  const sessionId = useRef(
    restoredState?.sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  );
  const initialMessageId = useRef(`initial-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  
  // AI Prevention flags
  const hasProcessedInitialPrompt = useRef(false);
  const isCurrentlyProcessing = useRef(false);
  const isInitialized = useRef(false);
  const enhancementStarted = useRef(false); // NEW: Prevent enhancement loops

  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Enhanced project state with completion tracking
  const [projectState, setProjectState] = useState<ProjectState>(() => {
    const defaultState: ProjectState = {
      originalPrompt: '',
      enhancedPrompt: '',
      requirements: [
        { id: 'data', label: 'Data & Tools', status: 'missing' },
        { id: 'timing', label: 'When to Run', status: 'missing' },
        { id: 'output', label: 'What to Create', status: 'missing' },
        { id: 'actions', label: 'Specific Actions', status: 'missing' },
        { id: 'delivery', label: 'How to Deliver', status: 'missing' },
        { id: 'error_handling', label: 'Error Handling', status: 'missing' },
      ],
      clarityScore: 0,
      isReadyToBuild: false,
      enhancementComplete: false,
      userApproved: false,
      questionsSequence: [],
      currentQuestionIndex: -1,
      clarificationAnswers: {},
      showingCustomInput: false,
      customInputValue: '',
      isInitialized: false,
      isProcessingQuestion: false,
      isEditingEnhanced: false,
      editedEnhancedPrompt: '',
      pluginValidationError: false,
      missingPlugins: [],
      requiredServices: [],
      suggestions: [],
      questionsWithVisibleOptions: new Set(),
      hasProcessedInitial: false,
      sessionId: sessionId.current,
      
      // NEW: Completion tracking
      conversationCompleted: false,
      planApproved: false,
      workflowPhase: 'initial',
      isInReviewMode: false,
      allowNavigation: false,
    };

    if (restoredState) {
      console.log('🔄 Restoring project state:', {
        workflowPhase: restoredState.workflowPhase,
        conversationCompleted: restoredState.conversationCompleted,
        planApproved: restoredState.planApproved,
        isInReviewMode: restoredState.isInReviewMode,
        hasMessages: (restoredState.messages?.length || 0)
      });
      
      // Mark as processed if restoring completed work
      if (restoredState.conversationCompleted || restoredState.planApproved) {
        hasProcessedInitialPrompt.current = true;
        isInitialized.current = true;
        enhancementStarted.current = true; // NEW: Mark enhancement as started if completed
      }
      
      return {
        ...defaultState,
        ...restoredState,
        sessionId: sessionId.current,
        questionsWithVisibleOptions: new Set(restoredState.questionsSequence?.map((q) => q.id) || []),
        isInitialized: true,
      };
    } else {
      // NEW: Reset flags for fresh start
      enhancementStarted.current = false;
    }
    
    return defaultState;
  });

  // BULLETPROOF AI Prevention - Enhanced with completion checks
  const shouldSkipAIProcessing = useCallback(() => {
    const skipReasons = [];
    
    // Check 1: Work is already completed
    if (projectState.conversationCompleted) skipReasons.push('conversation_completed');
    if (projectState.planApproved) skipReasons.push('plan_approved');
    if (projectState.workflowPhase === 'completed') skipReasons.push('workflow_completed');
    if (projectState.agentCreated) skipReasons.push('agent_created');
    
    // Check 2: In review mode
    if (projectState.isInReviewMode) skipReasons.push('review_mode');
    if (restoredState?.isInReviewMode) skipReasons.push('restored_review_mode');
    
    // Check 3: Enhancement already done (but NOT during active enhancement process)
    if (projectState.enhancementComplete && projectState.enhancedPrompt && !enhancementStarted.current) {
      skipReasons.push('enhancement_done');
    }
    
    // Check 4: Already initialized with restored state (but NOT for new enhancement)
    if (isInitialized.current && restoredState && !enhancementStarted.current) {
      skipReasons.push('already_initialized');
    }
    
    // NOTE: Removed currently_processing and is_processing checks as they were blocking valid enhancement

    if (skipReasons.length > 0) {
      console.log('🚫 AI Processing BLOCKED - Reasons:', skipReasons);
      return true;
    }
    
    console.log('✅ AI Processing ALLOWED - No blocking conditions');
    return false;
  }, [projectState, restoredState, enhancementStarted.current]);

  // Utility to ensure timestamps are Date objects
  const ensureDateTimestamp = useCallback((message: Message): Message => {
    return {
      ...message,
      timestamp: message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp)
    };
  }, []);

  // Messages with proper restoration
  const [messages, setMessages] = useState<Message[]>(() => {
    console.log('💬 Initializing messages:', {
      hasRestoredState: !!restoredState,
      isInReviewMode: restoredState?.isInReviewMode,
      restoredMessages: restoredState?.messages?.length || 0,
      hasInitialPrompt: !!initialPrompt,
    });

    // PRIORITY 1: Restore from completed work with message history
    if (restoredState?.messages?.length > 0) {
      console.log('✅ Restoring complete message history');
      return restoredState.messages.map(msg => ensureDateTimestamp(msg));
    }

    // PRIORITY 2: Build messages from restored state data (if no message history)
    if (restoredState && (restoredState.originalPrompt || restoredState.questionsSequence?.length > 0)) {
      console.log('🔨 Rebuilding messages from state data');
      
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
              content: '✅ Question answered',
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

  // CRITICAL: Always persist messages in state
  useEffect(() => {
    onStateChange?.({
      ...projectState,
      messages,
      lastUpdated: Date.now(),
      sessionId: sessionId.current
    });
  }, [projectState, messages, onStateChange]);

  // Message utilities
  const messageCounter = useRef(0);
  const addMessage = useCallback(
    (content: string, type: 'user' | 'ai' | 'system', status?: 'sending' | 'sent' | 'error', questionId?: string, isQuestionAnswer?: boolean) => {
      // Don't add messages in review mode unless it's a system message
      if (projectState.isInReviewMode && type !== 'system') {
        console.log('🚫 Message blocked - in review mode');
        return;
      }

      messageCounter.current += 1;
      const newMessage: Message = {
        id: `msg-${messageCounter.current}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type,
        content,
        timestamp: new Date(),
        status,
        questionId,
        isQuestionAnswer,
      };
      setMessages((prev) => [...prev, newMessage]);
      return newMessage.id;
    },
    [projectState.isInReviewMode]
  );

  const clearPluginValidationError = useCallback(() => {
    setProjectState((prev) => ({
      ...prev,
      pluginValidationError: false,
      missingPlugins: [],
      requiredServices: [],
      suggestions: [],
    }));
  }, []);

  // Requirements calculation
  const recalculateClarityScore = useCallback((requirements: RequirementItem[]) => {
    const totalRequirements = requirements.length;
    let score = 0;
    requirements.forEach((req) => {
      if (req.status === 'clear') score += 100;
      else if (req.status === 'partial') score += 60;
    });
    return Math.round(score / totalRequirements);
  }, []);

  const updateRequirementsFromAnswers = useCallback(
    (answers: Record<string, string>, questionsSequence: ClarificationQuestion[]) => {
      setProjectState((prev) => {
        const updatedRequirements = prev.requirements.map((req) => {
          const directAnswers = Object.entries(answers).filter(([questionId, answer]) => {
            const question = questionsSequence.find((q) => q.id === questionId);
            return question?.dimension === req.id;
          });

          if (directAnswers.length > 0) {
            const answerText = directAnswers.map(([_, answer]) => answer).join(', ');
            return { ...req, status: 'clear' as const, detected: answerText };
          }

          // Special handling for timing
          if (req.id === 'timing') {
            const timingKeywords = ['daily', 'weekly', 'monthly', 'hourly', 'every', 'once', 'regularly', 'schedule'];
            const timingAnswers = Object.entries(answers).filter(([_, answer]) => {
              return timingKeywords.some((kw) => answer.toLowerCase().includes(kw));
            });
            if (timingAnswers.length > 0) {
              const timingText = timingAnswers.map(([_, a]) => a).join(', ');
              return { ...req, status: 'clear' as const, detected: timingText };
            }
          }

          return req;
        });

        const newClarityScore = recalculateClarityScore(updatedRequirements);
        return { 
          ...prev, 
          requirements: updatedRequirements, 
          clarityScore: newClarityScore, 
          isReadyToBuild: newClarityScore >= 80 
        };
      });
    },
    [recalculateClarityScore]
  );

  // Enhanced enhancement logic with completion tracking
  const startEnhancement = useCallback(
    async (prompt: string, finalAnswers: Record<string, string>) => {
      console.log('🔍 startEnhancement called with state:', {
        enhancementStarted: enhancementStarted.current,
        enhancementComplete: projectState.enhancementComplete,
        conversationCompleted: projectState.conversationCompleted,
        isProcessing,
        isCurrentlyProcessing: isCurrentlyProcessing.current,
        hasPrompt: !!prompt?.trim(),
        hasUserId: !!user?.id
      });

      // CRITICAL FIX: Only check ref-based flag if NOT in active enhancement process
      if (enhancementStarted.current && projectState.enhancementComplete) {
        console.log('🚫 Enhancement blocked - already completed');
        return;
      }

      // CRITICAL FIX: Simplified checks during active enhancement
      if (projectState.conversationCompleted || projectState.planApproved) {
        console.log('🚫 Enhancement blocked - work already completed');
        return;
      }

      // Validate prerequisites
      if (projectState.questionsSequence.length > 0) {
        const unanswered = projectState.questionsSequence.filter(
          (q) => !finalAnswers.hasOwnProperty(q.id) || !finalAnswers[q.id]?.trim()
        );
        if (unanswered.length > 0) {
          addMessage("I need all questions answered before I can enhance your plan.", 'ai');
          return;
        }
      }

      if (!prompt?.trim() || !user?.id) {
        addMessage('I encountered an error. Please try again.', 'ai');
        return;
      }

      console.log('✅ Starting enhancement API call');
      setIsProcessing(true);
      isCurrentlyProcessing.current = true;
      addMessage('Let me enhance your plan with clear, simple details...', 'ai');

      try {
        const response = await fetch('/api/enhance-prompt', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': user.id,
            'x-session-id': sessionId.current,
          },
          body: JSON.stringify({
            prompt: prompt.trim(),
            clarificationAnswers: finalAnswers,
            userId: user.id,
            sessionId: sessionId.current,
            missingPlugins: projectState.missingPlugins || [],
            pluginValidationError: projectState.pluginValidationError || false,
            suggestions: projectState.suggestions || [],
          }),
        });

        if (!response.ok) {
          throw new Error(`Enhancement failed: ${response.status}`);
        }

        const result = await response.json();

        setProjectState((prev) => ({
          ...prev,
          enhancedPrompt: result.enhancedPrompt,
          enhancementComplete: true,
          conversationCompleted: true, // NEW: Mark conversation as completed
          clarificationAnswers: finalAnswers,
          workflowPhase: 'approval'
        }));

        let message = `Here's your enhanced automation plan:

**Enhanced Plan:**
${result.enhancedPrompt}

This breaks down exactly what your agent will do. Would you like to use this enhanced version, edit it, or stick with your original request?`;

        addMessage(message, 'ai');
        console.log('✅ Enhancement completed');
        
      } catch (err) {
        console.error('❌ Enhancement error:', err);
        addMessage('I encountered an error enhancing your plan. Please try again.', 'ai');
        
        // CRITICAL FIX: Reset flags on error so user can try again
        setProjectState((prev) => ({
          ...prev,
          enhancementComplete: false,
          workflowPhase: 'questions'
        }));
        enhancementStarted.current = false;
      } finally {
        setIsProcessing(false);
        isCurrentlyProcessing.current = false;
      }
    },
    [projectState, isProcessing, user?.id, addMessage]
  );

  // BULLETPROOF initial prompt processing - Enhanced with completion checks
  useEffect(() => {
    // ULTIMATE CHECK: Should we process the initial prompt?
    if (!initialPrompt) return;
    if (shouldSkipAIProcessing()) return;
    if (hasProcessedInitialPrompt.current) return;
    if (isCurrentlyProcessing.current) return;
    if (projectState.originalPrompt) return;
    if (projectState.conversationCompleted) return; // NEW: Don't process if already completed
    if (projectState.isInReviewMode) return; // NEW: Don't process in review mode

    console.log('🚀 Processing initial prompt:', initialPrompt.slice(0, 50));
    
    // Mark as processed immediately to prevent duplicates
    hasProcessedInitialPrompt.current = true;
    isCurrentlyProcessing.current = true;
    isInitialized.current = true;
    
    const processPrompt = async () => {
      try {
        setIsProcessing(true);
        addMessage(initialPrompt, 'user');
        
        setProjectState((prev) => ({ 
          ...prev, 
          originalPrompt: initialPrompt.trim(),
          hasProcessedInitial: true,
          isInitialized: true,
          workflowPhase: 'questions'
        }));

        const analysis = await analyzePromptClarity(initialPrompt.trim());
        
        // Handle analysis failure gracefully
        if (analysis.aiValidationFailed) {
          console.log('⚠️ Analysis failed, proceeding to enhancement');
          addMessage('I had trouble analyzing your request, but let me enhance it directly...', 'ai');
          setTimeout(() => startEnhancement(initialPrompt.trim(), {}), 1000);
          return;
        }
        
        updateRequirementsFromAnalysis(analysis);

        if (analysis.pluginValidationError) return;

        if (analysis.needsClarification && analysis.questionsSequence?.length > 0) {
          const validQuestions = analysis.questionsSequence.filter((q: any) => 
            q?.id && q?.question && q?.options && Array.isArray(q.options)
          );
          
          if (validQuestions.length > 0) {
            const firstId = validQuestions[0]?.id;
            const initialVisible = new Set<string>();
            if (firstId) initialVisible.add(firstId);

            setProjectState((prev) => ({
              ...prev,
              questionsSequence: validQuestions,
              currentQuestionIndex: 0,
              isProcessingQuestion: false,
              questionsWithVisibleOptions: initialVisible,
            }));
          } else {
            addMessage("I need more details. Could you describe what you'd like your agent to do?", 'ai');
          }
        } else if (analysis.clarityScore >= 90) {
          addMessage('Your request is very clear. Let me enhance it...', 'ai');
          setTimeout(() => startEnhancement(initialPrompt.trim(), {}), 1000);
        } else {
          addMessage("I need more information. Could you provide additional details?", 'ai');
        }
        
      } catch (err) {
        console.error('❌ Initial processing error:', err);
        addMessage('I encountered an error analyzing your request. Let me try to enhance it directly...', 'ai');
        
        // Fallback to direct enhancement on any error
        setTimeout(() => startEnhancement(initialPrompt.trim(), {}), 1000);
      } finally {
        setIsProcessing(false);
        isCurrentlyProcessing.current = false;
      }
    };

    // Small delay to ensure state is ready
    setTimeout(processPrompt, 500);
    
  }, [initialPrompt, shouldSkipAIProcessing, projectState.originalPrompt, projectState.conversationCompleted, projectState.isInReviewMode, addMessage, startEnhancement]);

  // Question flow logic
  const proceedToNextQuestion = useCallback(() => {
    // Don't proceed in review mode
    if (projectState.isInReviewMode) {
      console.log('🚫 Question progression blocked - in review mode');
      return;
    }

    setProjectState((current) => {
      console.log('🔄 proceedToNextQuestion called:', {
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
        console.log(`✅ Moving to next question at index ${nextUnansweredIndex}`);
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
        console.log(`↩️ Returning to unanswered question at index ${firstIdx}`);
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
      console.log('🎉 All questions completed - setting currentQuestionIndex to -1');
      return { 
        ...current, 
        currentQuestionIndex: -1, 
        isProcessingQuestion: false,
        workflowPhase: 'enhancement'
      };
    });
  }, [projectState.isInReviewMode]);

  // Ask current question
  useEffect(() => {
    // Don't show new questions in review mode
    if (projectState.isInReviewMode) return;

    const currentQuestion = projectState.questionsSequence[projectState.currentQuestionIndex];
    if (currentQuestion && projectState.currentQuestionIndex >= 0) {
      const timer = setTimeout(() => {
        addMessage(currentQuestion.question, 'ai');
        
        // Add question component
        const questionMessage: Message = {
          id: `question-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: 'system',
          content: JSON.stringify(currentQuestion),
          timestamp: new Date(),
          questionId: currentQuestion.id,
        };
        setMessages((prev) => [...prev, questionMessage]);
      }, 500);
      
      return () => clearTimeout(timer);
    }
  }, [projectState.currentQuestionIndex, projectState.questionsSequence, projectState.isInReviewMode, addMessage]);

  // Auto-enhancement when questions are complete - Enhanced with completion checks
  useEffect(() => {
    console.log('🔍 Auto-enhancement useEffect triggered:', {
      conversationCompleted: projectState.conversationCompleted,
      isInReviewMode: projectState.isInReviewMode,
      enhancementStarted: enhancementStarted.current,
      currentQuestionIndex: projectState.currentQuestionIndex,
      questionsCount: projectState.questionsSequence.length,
      answersCount: Object.keys(projectState.clarificationAnswers).length,
      enhancementComplete: projectState.enhancementComplete,
      isProcessing,
      isCurrentlyProcessing: isCurrentlyProcessing.current,
      originalPrompt: !!projectState.originalPrompt
    });

    // Skip if already completed or in review mode
    if (projectState.conversationCompleted || projectState.isInReviewMode) {
      console.log('🚫 Auto-enhancement blocked - already completed or in review mode');
      return;
    }

    // MODIFIED: Only check enhancementStarted if enhancementComplete is also true
    if (enhancementStarted.current && projectState.enhancementComplete) {
      console.log('🚫 Auto-enhancement blocked - already started and completed');
      return;
    }

    // Check if all questions have been answered
    const allQuestionsAnswered = projectState.questionsSequence.length > 0 && 
      projectState.questionsSequence.every(q => projectState.clarificationAnswers[q.id]?.trim());
    
    console.log('🔍 Questions analysis:', {
      allQuestionsAnswered,
      questionsSequence: projectState.questionsSequence.map(q => ({
        id: q.id,
        hasAnswer: !!projectState.clarificationAnswers[q.id]?.trim(),
        answer: projectState.clarificationAnswers[q.id]
      }))
    });
    
    if (
      projectState.currentQuestionIndex === -1 &&
      allQuestionsAnswered &&
      !projectState.enhancementComplete &&
      !isProcessing &&
      !isCurrentlyProcessing.current &&
      projectState.originalPrompt
    ) {
      console.log('✅ Starting auto-enhancement - all questions answered');
      
      // CRITICAL FIX: Set refs immediately to prevent duplicate calls
      enhancementStarted.current = true;
      isCurrentlyProcessing.current = true;
      
      // CRITICAL FIX: Immediately set enhancementComplete to prevent duplicate calls
      setProjectState((prev) => ({
        ...prev,
        enhancementComplete: true,
        workflowPhase: 'enhancement'
      }));
      
      updateRequirementsFromAnswers(projectState.clarificationAnswers, projectState.questionsSequence);
      addMessage('Perfect! Let me enhance your plan with all these details...', 'ai');

      const fullPrompt = `${projectState.originalPrompt}\n\nAdditional details:\n${Object.entries(projectState.clarificationAnswers)
        .map(([qid, ans]) => {
          const q = projectState.questionsSequence.find((qq) => qq.id === qid);
          const dim = q?.dimension || qid;
          return `${dim}: ${ans}`;
        })
        .join('\n')}`;

      setTimeout(() => {
        startEnhancement(fullPrompt, projectState.clarificationAnswers);
      }, 1000);
    } else {
      console.log('🚫 Auto-enhancement conditions not met:', {
        currentQuestionIndex: projectState.currentQuestionIndex,
        allQuestionsAnswered,
        enhancementComplete: projectState.enhancementComplete,
        isProcessing,
        isCurrentlyProcessing: isCurrentlyProcessing.current,
        hasOriginalPrompt: !!projectState.originalPrompt
      });
    }
  }, [
    projectState.currentQuestionIndex, 
    projectState.clarificationAnswers, 
    projectState.enhancementComplete, 
    projectState.conversationCompleted,
    projectState.isInReviewMode,
    isProcessing, 
    projectState.originalPrompt,
    projectState.questionsSequence,
    updateRequirementsFromAnswers, 
    addMessage, 
    startEnhancement
  ]);

  // API Functions
  const analyzePromptClarity = async (prompt: string): Promise<ClarityAnalysis> => {
    if (!user?.id || !prompt?.trim()) {
      throw new Error('Invalid parameters for analysis');
    }

    try {
      const response = await fetch('/api/analyze-prompt-clarity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
          'x-session-id': sessionId.current,
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          userId: user.id,
          sessionId: sessionId.current,
          bypassPluginValidation: false,
        }),
      });

      if (!response.ok) {
        console.error(`Analysis API error: ${response.status}`);
        
        // Return a fallback analysis instead of throwing
        return {
          clarityScore: 50,
          questionsCount: 0,
          needsClarification: false,
          aiValidationFailed: true,
          bypassedPluginValidation: false,
          hadPluginWarning: false,
          analysis: {}
        };
      }

      const result = await response.json();
      if (typeof result.clarityScore !== 'number') {
        throw new Error('Invalid analysis response');
      }
      
      return result;
    } catch (error) {
      console.error('Analysis error:', error);
      
      // Return fallback analysis on any error
      return {
        clarityScore: 50,
        questionsCount: 0,
        needsClarification: false,
        aiValidationFailed: true,
        bypassedPluginValidation: false,
        hadPluginWarning: false,
        analysis: {}
      };
    }
  };

  const updateRequirementsFromAnalysis = (analysis: ClarityAnalysis) => {
    if (analysis.pluginWarning) {
      addMessage(`💡 FYI: ${analysis.pluginWarning.message}`, 'ai');
    }

    const updatedRequirements = projectState.requirements.map((req) => {
      const analysisData = (analysis.analysis as any)?.[req.id];
      return {
        ...req,
        status: analysisData?.status || 'missing',
        detected: analysisData?.detected || '',
      };
    });

    const newClarityScore = recalculateClarityScore(updatedRequirements);
    setProjectState((prev) => ({ 
      ...prev, 
      requirements: updatedRequirements, 
      clarityScore: newClarityScore 
    }));
  };

  // User interaction handlers - Enhanced with review mode checks
  const handleOptionSelect = useCallback(
    (questionId: string, selectedValue: string, selectedLabel: string) => {
      if (projectState.isProcessingQuestion || projectState.isInReviewMode) return;

      if (selectedValue === 'custom') {
        setProjectState((prev) => ({ ...prev, showingCustomInput: true }));
        return;
      }

      setProjectState((current) => ({
        ...current,
        clarificationAnswers: { ...current.clarificationAnswers, [questionId]: selectedLabel },
        isProcessingQuestion: true,
      }));

      addMessage(selectedLabel, 'user', 'sent', questionId, true);

      setTimeout(() => {
        addMessage('✅ Question answered', 'system', 'sent', questionId);
        setProjectState((prev) => ({ ...prev, isProcessingQuestion: false }));
        setTimeout(proceedToNextQuestion, 200);
      }, 300);
    },
    [projectState.isProcessingQuestion, projectState.isInReviewMode, proceedToNextQuestion, addMessage]
  );

  const handleCustomAnswer = useCallback(() => {
    const currentQuestion = projectState.questionsSequence[projectState.currentQuestionIndex];
    if (!currentQuestion || projectState.isProcessingQuestion || !projectState.customInputValue.trim() || projectState.isInReviewMode) {
      return;
    }

    const customAnswer = projectState.customInputValue.trim();
    const questionId = currentQuestion.id;

    setProjectState((current) => ({
      ...current,
      clarificationAnswers: { ...current.clarificationAnswers, [questionId]: customAnswer },
      showingCustomInput: false,
      customInputValue: '',
      isProcessingQuestion: true,
    }));

    addMessage(customAnswer, 'user', 'sent', questionId, true);

    setTimeout(() => {
      addMessage('✅ Question answered', 'system', 'sent', questionId);
      setProjectState((prev) => ({ ...prev, isProcessingQuestion: false }));
      setTimeout(proceedToNextQuestion, 200);
    }, 300);
  }, [
    projectState.questionsSequence,
    projectState.currentQuestionIndex,
    projectState.customInputValue,
    projectState.isProcessingQuestion,
    projectState.isInReviewMode,
    proceedToNextQuestion,
    addMessage,
  ]);

  const handleChangeAnswer = useCallback((questionId: string) => {
    // Don't allow changes in review mode
    if (projectState.isInReviewMode) return;

    setProjectState((prev) => {
      const newAnswers = { ...prev.clarificationAnswers };
      delete newAnswers[questionId];

      const newVisible = new Set(prev.questionsWithVisibleOptions);
      newVisible.add(questionId);

      return { ...prev, clarificationAnswers: newAnswers, questionsWithVisibleOptions: newVisible };
    });
  }, [projectState.isInReviewMode]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isProcessing || projectState.isInReviewMode) return;

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
  };

  // Enhancement approval handlers
  const handleApproveEnhanced = () => {
    setProjectState((prev) => ({ 
      ...prev, 
      userApproved: true, 
      isReadyToBuild: true,
      planApproved: true, // NEW: Mark plan as approved
      workflowPhase: 'completed'
    }));
    addMessage("Excellent! Moving to the smart build phase.", 'ai');

    onPromptApproved?.({
      prompt: projectState.enhancedPrompt,
      promptType: 'enhanced',
      clarificationAnswers: projectState.clarificationAnswers,
    });
  };

  const handleUseOriginal = () => {
    setProjectState((prev) => ({ 
      ...prev, 
      userApproved: true, 
      isReadyToBuild: true,
      planApproved: true, // NEW: Mark plan as approved
      workflowPhase: 'completed'
    }));
    addMessage("Perfect! Using your original request to build your agent.", 'ai');

    onPromptApproved?.({
      prompt: projectState.originalPrompt,
      promptType: 'original',
      clarificationAnswers: projectState.clarificationAnswers,
    });
  };

  const handleEditEnhanced = () => {
    setProjectState((prev) => ({ 
      ...prev, 
      isEditingEnhanced: true, 
      editedEnhancedPrompt: prev.enhancedPrompt 
    }));
  };

  const handleSaveEnhancedEdit = () => {
    if (!projectState.editedEnhancedPrompt.trim()) return;

    setProjectState((prev) => ({
      ...prev,
      enhancedPrompt: prev.editedEnhancedPrompt.trim(),
      isEditingEnhanced: false,
    }));

    addMessage(
      "I've updated your enhanced plan. Please review and let me know if you'd like to use it or make more changes.",
      'ai'
    );
  };

  const handleCancelEnhancedEdit = () => {
    setProjectState((prev) => ({ 
      ...prev, 
      isEditingEnhanced: false, 
      editedEnhancedPrompt: '' 
    }));
  };

  return {
    // State
    user,
    messages,
    projectState,
    inputValue,
    isProcessing,

    // Setters
    setInputValue,
    setProjectState,

    // Refs
    messagesEndRef,

    // Utilities
    addMessage,
    clearPluginValidationError,

    // Handlers
    handleSendMessage,
    handleOptionSelect,
    handleCustomAnswer,
    handleChangeAnswer,

    handleApproveEnhanced,
    handleUseOriginal,
    handleEditEnhanced,
    handleSaveEnhancedEdit,
    handleCancelEnhancedEdit,
  };
}