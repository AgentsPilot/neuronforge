import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/components/UserProvider';
import {
  Message,
  ProjectState,
  ClarificationQuestion,
  ClarityAnalysis,
  RequirementItem,
} from './types';
import { useProjectState } from './useProjectState';
import { useMessageHandlers } from './useMessageHandlers';

/**
 * Main conversational builder hook - orchestrates the 3-API sequence
 * 1. /api/analyze-prompt-clarity - Analyzes initial prompt
 * 2. /api/generate-clarification-questions - Generates questions based on analysis  
 * 3. /api/enhance-prompt - Enhances prompt with answers
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
  const { user, loading: userLoading } = useAuth();

  // Generate proper UUID format for database compatibility
  const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };
  
  // Session and agent tracking
  const sessionId = useRef(restoredState?.sessionId || generateUUID());
  const agentId = useRef(restoredState?.agentId || generateUUID());
  
  console.log('🆔 Agent ID initialized for ENTIRE WORKFLOW:', {
    agentId: agentId.current,
    sessionId: sessionId.current,
    isRestored: !!restoredState?.agentId,
  });

  // AI Prevention flags
  const hasProcessedInitialPrompt = useRef(false);
  const isCurrentlyProcessing = useRef(false);
  const isInitialized = useRef(false);
  const enhancementStarted = useRef(false);

  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Use project state hook
  const {
    projectState,
    setProjectState,
    updateRequirementsFromAnalysis,
    updateRequirementsFromAnswers,
    shouldSkipAIProcessing,
    getServiceDisplayNames,
    getConnectedServiceKeys,
  } = useProjectState({
    restoredState,
    sessionId: sessionId.current,
    agentId: agentId.current,
    user,
    userLoading,
    hasProcessedInitialPrompt,
    isInitialized,
    enhancementStarted,
  });

  // Use message handlers hook
  const {
    messages,
    setMessages,
    messagesEndRef,
    addMessage,
    clearPluginValidationError,
  } = useMessageHandlers({
    projectState,
    restoredState,
    initialPrompt,
    agentId: agentId.current,
    generateUUID,
  });

  // STEP 1: Analyze prompt clarity
  const analyzePromptClarity = async (prompt: string): Promise<ClarityAnalysis> => {
    if (!user?.id || !prompt?.trim()) {
      throw new Error('Invalid parameters for analysis');
    }

    const requestPayload = {
      prompt: prompt.trim(),
      userId: user.id,
      sessionId: sessionId.current,
      agentId: agentId.current,
      connected_plugins: user?.connectedPlugins || {},
      bypassPluginValidation: false,
    };

    console.log('🚀 STEP 1: Making analysis API call with CONSISTENT agentId:', {
      endpoint: '/api/analyze-prompt-clarity',
      userId: user.id,
      sessionId: sessionId.current,
      agentId: agentId.current,
    });

    const response = await fetch('/api/analyze-prompt-clarity', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': user.id,
        'x-session-id': sessionId.current,
        'x-agent-id': agentId.current,
      },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      throw new Error(`Analysis API failed: ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ STEP 1: Analysis API success');
    return result;
  };

  // STEP 2: Generate clarification questions
  const generateClarificationQuestions = async (originalPrompt: string, analysisResult: ClarityAnalysis): Promise<any> => {
    console.log('🚀 STEP 2: Making clarification questions API call');

    const response = await fetch('/api/generate-clarification-questions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': user?.id || 'anonymous',
        'x-session-id': sessionId.current,
        'x-agent-id': agentId.current,
      },
      body: JSON.stringify({
        original_prompt: originalPrompt,
        agent_name: `Agent for: ${originalPrompt.slice(0, 50)}...`,
        description: `Automated agent based on: ${originalPrompt}`,
        connected_plugins: user?.connectedPlugins || {},
        user_id: user?.id,
        agentId: agentId.current,
        sessionId: sessionId.current,
        clarity_analysis: analysisResult,
      }),
    });

    if (!response.ok) {
      throw new Error(`Clarification questions API failed: ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ STEP 2: Clarification Questions API success');
    return result;
  };

  // STEP 3: Enhancement logic
  const startEnhancement = useCallback(
    async (prompt: string, finalAnswers: Record<string, string>) => {
      console.log('🚀 STEP 3: Starting enhancement with CONSISTENT agent ID:', agentId.current);

      // Validation checks
      if (enhancementStarted.current && projectState.enhancementComplete) {
        console.log('Enhancement blocked - already completed');
        return;
      }

      if (projectState.conversationCompleted || projectState.planApproved) {
        console.log('Enhancement blocked - work already completed');
        return;
      }

      if (!prompt?.trim() || !user?.id) {
        addMessage('I encountered an error. Please try again.', 'ai');
        return;
      }

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
            'x-agent-id': agentId.current,
          },
          body: JSON.stringify({
            prompt: prompt.trim(),
            clarificationAnswers: finalAnswers,
            userId: user.id,
            sessionId: sessionId.current,
            agentId: agentId.current,
            connected_plugins: user?.connectedPlugins || {},
            missingPlugins: projectState.missingPlugins || [],
            pluginWarning: projectState.pluginWarning,
          }),
        });

        if (!response.ok) {
          throw new Error(`Enhancement failed: ${response.status}`);
        }

        const result = await response.json();
        
        // Update project state with enhancement results
        const connectedServiceKeys = getConnectedServiceKeys(result);
        const serviceDisplayNames = getServiceDisplayNames(connectedServiceKeys, result.connectedPluginData);
        
        setProjectState((prev) => ({
          ...prev,
          enhancedPrompt: result.enhancedPrompt,
          enhancementComplete: true,
          conversationCompleted: true,
          clarificationAnswers: finalAnswers,
          workflowPhase: 'approval',
          requirements: prev.requirements.map(req => {
            if (req.id === 'actions') {
              const rebuiltActions = connectedServiceKeys.length > 0
                ? `Summarize and save to ${serviceDisplayNames.join(', ')}`
                : 'Actions require service connections';
              return {
                ...req,
                status: connectedServiceKeys.length > 0 ? 'clear' : 'missing',
                detected: rebuiltActions
              };
            }
            return req;
          })
        }));

        const message = `Here's your enhanced automation plan:

**Enhanced Plan:**
${result.enhancedPrompt}

This breaks down exactly what your agent will do. Would you like to use this enhanced version, edit it, or stick with your original request?`;

        addMessage(message, 'ai');
        console.log('✅ STEP 3: Enhancement completed');
        
      } catch (err) {
        console.error('Enhancement error:', err);
        addMessage('I encountered an error enhancing your plan. Please try again.', 'ai');
        
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
    [projectState, user, addMessage, getServiceDisplayNames, getConnectedServiceKeys, setProjectState]
  );

  // Question flow logic
  const proceedToNextQuestion = useCallback(() => {
    // Don't proceed in review mode
    if (projectState.isInReviewMode) {
      console.log('Question progression blocked - in review mode');
      return;
    }

    setProjectState((current) => {
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
  }, [projectState.currentQuestionIndex, projectState.questionsSequence, projectState.isInReviewMode, addMessage, setMessages]);

  // Auto-enhancement when questions are complete
  useEffect(() => {
    console.log('Auto-enhancement useEffect triggered:', {
      conversationCompleted: projectState.conversationCompleted,
      isInReviewMode: projectState.isInReviewMode,
      enhancementStarted: enhancementStarted.current,
      currentQuestionIndex: projectState.currentQuestionIndex,
      questionsCount: projectState.questionsSequence.length,
      answersCount: Object.keys(projectState.clarificationAnswers).length,
      enhancementComplete: projectState.enhancementComplete,
      isProcessing,
      isCurrentlyProcessing: isCurrentlyProcessing.current,
      originalPrompt: !!projectState.originalPrompt,
      agentId: agentId.current
    });

    // Skip if already completed or in review mode
    if (projectState.conversationCompleted || projectState.isInReviewMode) {
      console.log('Auto-enhancement blocked - already completed or in review mode');
      return;
    }

    // Only check enhancementStarted if enhancementComplete is also true
    if (enhancementStarted.current && projectState.enhancementComplete) {
      console.log('Auto-enhancement blocked - already started and completed');
      return;
    }

    // Check if all questions have been answered
    const allQuestionsAnswered = projectState.questionsSequence.length > 0 && 
      projectState.questionsSequence.every(q => projectState.clarificationAnswers[q.id]?.trim());
    
    console.log('Questions analysis:', {
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
      console.log('🚀 Starting auto-enhancement - STEP 3: Enhancement with answers and CONSISTENT agentId:', agentId.current);
      
      // Set refs immediately to prevent duplicate calls
      enhancementStarted.current = true;
      isCurrentlyProcessing.current = true;
      
      // Immediately set enhancementComplete to prevent duplicate calls
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
      console.log('Auto-enhancement conditions not met:', {
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
    startEnhancement,
    setProjectState
  ]);

  // Initial prompt processing with 3-API sequence
  useEffect(() => {
    if (!initialPrompt) return;
    if (shouldSkipAIProcessing()) return;
    if (hasProcessedInitialPrompt.current) return;
    if (isCurrentlyProcessing.current) return;
    if (projectState.originalPrompt) return;
    if (projectState.conversationCompleted) return;
    if (projectState.isInReviewMode) return;

    // Skip if restored state has completed work
    if (restoredState && (
        restoredState.enhancementComplete || 
        restoredState.planApproved || 
        restoredState.conversationCompleted ||
        restoredState.workflowPhase === 'completed' ||
        restoredState.workflowPhase === 'approval'
      )) {
      console.log('Skipping initial prompt processing - restored state has completed work');
      return;
    }

    console.log('🎯 Processing initial prompt with 3-API sequence');
    
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

        // Step 1: Analyze prompt clarity
        const analysis = await analyzePromptClarity(initialPrompt.trim());
        
        // FIXED: Handle plugin warnings from analysis
        if (analysis.pluginWarning) {
          console.log('Adding plugin warning message from analysis:', analysis.pluginWarning.message);
          addMessage(analysis.pluginWarning.message, 'ai');
          setProjectState((prev) => ({
            ...prev,
            missingPlugins: analysis.pluginWarning?.missingServices || [],
            pluginWarning: analysis.pluginWarning
          }));
        }
        
        updateRequirementsFromAnalysis(analysis);

        // Step 2 & 3: Questions or direct enhancement
        if (analysis.needsClarification && analysis.clarityScore < 90) {
          const clarificationResult = await generateClarificationQuestions(initialPrompt.trim(), analysis);
          
          // Handle plugin warnings from clarification API (if different from analysis)
          if (clarificationResult.pluginWarning && !analysis.pluginWarning) {
            console.log('Adding plugin warning message from clarification:', clarificationResult.pluginWarning.message);
            addMessage(clarificationResult.pluginWarning.message, 'ai');
            setProjectState((prev) => ({
              ...prev,
              missingPlugins: clarificationResult.pluginWarning?.missingServices || [],
              pluginWarning: clarificationResult.pluginWarning
            }));
          }
          
          if (clarificationResult.questions && clarificationResult.questions.length > 0) {
            const validQuestions = clarificationResult.questions.filter((q: any) => 
              q?.id && q?.question && q?.type
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
                clarityScore: analysis.clarityScore || 50
              }));

              console.log('🎯 3-API sequence: Questions setup complete. User can now answer questions.');
            } else {
              addMessage('I need more details, but let me enhance your request directly...', 'ai');
              setTimeout(() => startEnhancement(initialPrompt.trim(), {}), 1000);
            }
          } else {
            addMessage('Let me enhance your request directly...', 'ai');
            setTimeout(() => startEnhancement(initialPrompt.trim(), {}), 1000);
          }
        } else {
          addMessage('Your request is very clear. Let me enhance it...', 'ai');
          setTimeout(() => startEnhancement(initialPrompt.trim(), {}), 1000);
        }
        
      } catch (err) {
        console.error('❌ 3-API sequence error:', err);
        addMessage('I encountered an error analyzing your request. Let me try to enhance it directly...', 'ai');
        setTimeout(() => startEnhancement(initialPrompt.trim(), {}), 1000);
      } finally {
        setIsProcessing(false);
        isCurrentlyProcessing.current = false;
      }
    };

    setTimeout(processPrompt, 500);
    
  }, [
    initialPrompt, 
    shouldSkipAIProcessing, 
    projectState.originalPrompt, 
    projectState.conversationCompleted, 
    projectState.isInReviewMode, 
    restoredState,
    addMessage, 
    startEnhancement,
    updateRequirementsFromAnalysis,
    setProjectState
  ]);

  // Persist state changes
  useEffect(() => {
    onStateChange?.({
      ...projectState,
      messages,
      lastUpdated: Date.now(),
      sessionId: sessionId.current,
      agentId: agentId.current
    });
  }, [projectState, messages, onStateChange]);

  // User interaction handlers - Enhanced with review mode checks
  const handleOptionSelect = useCallback(
    (questionId: string, selectedValue: string, selectedLabel: string) => {
      if (projectState.isProcessingQuestion || projectState.isInReviewMode) return;

      if (selectedValue === 'custom') {
        setProjectState((prev) => ({ 
          ...prev, 
          showingCustomInput: true,
          customInputQuestionId: questionId,
          customInputValue: ''
        }));
        return;
      }

      setProjectState((current) => ({
        ...current,
        clarificationAnswers: { ...current.clarificationAnswers, [questionId]: selectedLabel },
        isProcessingQuestion: true,
      }));

      addMessage(selectedLabel, 'user', 'sent', questionId, true);

      setTimeout(() => {
        addMessage('Question answered', 'system', 'sent', questionId);
        setProjectState((prev) => ({ ...prev, isProcessingQuestion: false }));
        setTimeout(proceedToNextQuestion, 200);
      }, 300);
    },
    [projectState.isProcessingQuestion, projectState.isInReviewMode, proceedToNextQuestion, addMessage, setProjectState]
  );

  const handleCustomAnswer = useCallback(() => {
    const questionId = projectState.customInputQuestionId;
    if (!questionId || projectState.isProcessingQuestion || !projectState.customInputValue.trim() || projectState.isInReviewMode) {
      return;
    }

    const customAnswer = projectState.customInputValue.trim();

    setProjectState((current) => ({
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
      setProjectState((prev) => ({ ...prev, isProcessingQuestion: false }));
      setTimeout(proceedToNextQuestion, 200);
    }, 300);
  }, [
    projectState.customInputQuestionId,
    projectState.customInputValue,
    projectState.isProcessingQuestion,
    projectState.isInReviewMode,
    proceedToNextQuestion,
    addMessage,
    setProjectState,
  ]);

  const handleChangeAnswer = useCallback((questionId: string) => {
    if (projectState.isInReviewMode) return;

    setProjectState((prev) => {
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
  }, [projectState.isInReviewMode, setProjectState]);

  const handleCustomInputChange = useCallback((questionId: string, value: string) => {
    console.log('handleCustomInputChange called:', { questionId, value, isEmpty: value === '' });
    
    if (value === '') {
      console.log('Opening custom input for question:', questionId);
      setProjectState((prev) => ({ 
        ...prev, 
        showingCustomInput: true,
        customInputQuestionId: questionId,
        customInputValue: ''
      }));
    } else {
      console.log('Updating input value:', value);
      setProjectState((prev) => {
        if (prev.customInputQuestionId === questionId) {
          return { ...prev, customInputValue: value };
        }
        return { 
          ...prev, 
          clarificationAnswers: { ...prev.clarificationAnswers, [questionId]: value }
        };
      });
    }
  }, [setProjectState]);

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
      planApproved: true,
      workflowPhase: 'completed'
    }));
    addMessage("Excellent! Moving to the smart build phase.", 'ai');

    console.log('🔍 handleApproveEnhanced - Passing agent ID and session ID:', {
      agentId: agentId.current,
      sessionId: sessionId.current,
      clarificationAnswersCount: Object.keys(projectState.clarificationAnswers).length
    });

    onPromptApproved?.({
      prompt: projectState.enhancedPrompt,
      promptType: 'enhanced',
      clarificationAnswers: {
        ...projectState.clarificationAnswers,
        agentId: agentId.current,
        sessionId: sessionId.current
      }
    });
  };

  const handleUseOriginal = () => {
    setProjectState((prev) => ({ 
      ...prev, 
      userApproved: true, 
      isReadyToBuild: true,
      planApproved: true,
      workflowPhase: 'completed'
    }));
    addMessage("Perfect! Using your original request to build your agent.", 'ai');

    console.log('🔍 handleUseOriginal - Passing agent ID and session ID:', {
      agentId: agentId.current,
      sessionId: sessionId.current,
      clarificationAnswersCount: Object.keys(projectState.clarificationAnswers).length
    });

    onPromptApproved?.({
      prompt: projectState.originalPrompt,
      promptType: 'original',
      clarificationAnswers: {
        ...projectState.clarificationAnswers,
        agentId: agentId.current,
        sessionId: sessionId.current
      }
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
    handleCustomInputChange,

    handleApproveEnhanced,
    handleUseOriginal,
    handleEditEnhanced,
    handleSaveEnhancedEdit,
    handleCancelEnhancedEdit,

    // IDs for tracking
    agentId: agentId.current,
    sessionId: sessionId.current,
  };
}