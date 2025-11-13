import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/components/UserProvider';
import { Message, ProjectState, ClarificationQuestion, ClarityAnalysis, RequirementItem, PromptRequestPayload, PromptResponsePayload, ClarificationQuestionRequestPayload, EnhancedPromptRequestPayload } from './types';
import { useProjectState } from './useProjectState';
import { useMessageHandlers } from './useMessageHandlers';
import { useThreadBasedAgentCreation } from '@/lib/utils/featureFlags';
import type { ProcessMessageRequest, ProcessMessageResponse } from '@/components/agent-creation/types/agent-prompt-threads';

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

  // Feature flag: Check if thread-based agent creation is enabled
  const useThreadFlow = useThreadBasedAgentCreation();
  const threadId = useRef<string | null>(null);

  console.log('🎛️ Feature flag - useThreadFlow:', useThreadFlow);

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
  const analyzePromptClarity = async (originalPrompt: string): Promise<PromptResponsePayload> => {
    if (!user?.id || !originalPrompt?.trim()) {
      throw new Error('Invalid parameters for analysis');
    }

    const requestPayload: PromptRequestPayload ={
      prompt: originalPrompt.trim(),
      userId: user.id,
      sessionId: sessionId.current,
      agentId: agentId.current,
      connectedPlugins: [],
      bypassPluginValidation: false,
    };

    console.log('🚀 STEP 1: Making analysis API call with CONSISTENT agentId:', {
      endpoint: '/api/analyze-prompt-clarity',
      userId: user.id,
      sessionId: sessionId.current,
      agentId: agentId.current,
    });

    try {
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

      const result = await response.json() as PromptResponsePayload;
      console.log('✅ STEP 1: Analysis API success');
      return result;
    }
    catch (err) { 
      console.error('Analysis API call error:', err);
      throw err;
    }    
  };

  // STEP 2: Generate clarification questions
  const generateClarificationQuestions = async (originalPrompt: string, analyzeResponsePayload: PromptResponsePayload): Promise<PromptResponsePayload> => {
    console.log('🚀 STEP 2: Making clarification questions API call');
    try {      
      const analysisResult: ClarityAnalysis = analyzeResponsePayload.analysis;
      const response = await fetch('/api/generate-clarification-questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user?.id || 'anonymous',
          'x-session-id': sessionId.current,
          'x-agent-id': agentId.current,
        },
        body: JSON.stringify({
          prompt: originalPrompt,
          agentName: `Agent for: ${originalPrompt.slice(0, 50)}...`,
          description: `Automated agent based on: ${originalPrompt}`,
          connectedPlugins: analyzeResponsePayload.connectedPlugins || [],
          connectedPluginsData: analyzeResponsePayload.connectedPluginsData || [],
          userId: user?.id,
          agentId: agentId.current,
          sessionId: sessionId.current,
          analysis: analysisResult,
        } as ClarificationQuestionRequestPayload),
      });

      if (!response.ok) {
        throw new Error(`Clarification questions API failed: ${response.status}`);
      }

      const result = await response.json() as PromptResponsePayload;
      console.log('✅ STEP 2: Clarification Questions API success:', result);
      return result;
    }
    catch (err) { 
      console.error('Clarification Questions API call error:', err);
      throw err;
    }
  };

  // ============================================
  // THREAD-BASED FLOW HELPER FUNCTIONS
  // ============================================

  /**
   * Initialize a new OpenAI thread with system prompt injected once
   */
  const initializeThread = async (): Promise<string> => {
    try {
      const response = await fetch('/api/agent-creation/init-thread', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to initialize thread');
      }

      const result = await response.json();
      console.log('✅ Thread initialized:', result.thread_id);
      return result.thread_id;
    } catch (err) {
      console.error('❌ Failed to initialize thread:', err);
      throw err;
    }
  };

  /**
   * Process a message in the thread (Phase 1, 2, or 3)
   */
  const processMessageInThread = async (
    phase: 1 | 2 | 3,
    userPrompt: string,
    clarificationAnswers?: Record<string, string>
  ): Promise<any> => {
    try {
      if (!threadId.current) {
        throw new Error('No thread ID available');
      }

      const requestBody: ProcessMessageRequest = {
        thread_id: threadId.current,
        phase,
        user_prompt: userPrompt,
        user_context: {
          full_name: user?.user_metadata?.full_name || '',
          email: user?.email || ''
        },
        analysis: null,
        connected_services: (projectState.connectedPluginsData || []).map(p => p.key)
      };

      if (phase === 3 && clarificationAnswers) {
        requestBody.clarification_answers = clarificationAnswers;
      }

      console.log(`🚀 Phase ${phase}: Sending message to thread`);

      const response = await fetch('/api/agent-creation/process-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Phase ${phase} failed`);
      }

      const result: ProcessMessageResponse = await response.json();
      console.log(`✅ Phase ${phase} complete:`, result);
      return result;
    } catch (err) {
      console.error(`❌ Phase ${phase} error:`, err);
      throw err;
    }
  };

  /**
   * Main thread-based orchestration function (replaces 3-API sequence)
   */
  const processWithThreads = useCallback(async (prompt: string) => {
    try {
      console.log('🆕 Starting thread-based flow');

      // Step 1: Initialize thread with system prompt
      const newThreadId = await initializeThread();
      threadId.current = newThreadId;
      console.log('✅ Thread initialized:', newThreadId);

      // Step 2: Phase 1 - Analysis
      console.log('🚀 Phase 1: Analyzing prompt clarity');
      const phase1Result = await processMessageInThread(1, prompt);

      // Handle plugin warnings from analysis
      if (phase1Result.pluginWarning) {
        console.log('Adding plugin warning message from analysis:', phase1Result.pluginWarning.message);
        addMessage(phase1Result.pluginWarning.message, 'ai');
        setProjectState((prev) => ({
          ...prev,
          missingPlugins: phase1Result.pluginWarning?.missingPlugins || [],
          pluginWarning: phase1Result.pluginWarning
        }));
      }

      console.log('🚀 Phase 1 Result:', phase1Result);

      // Update state with Phase 1 results and requirements
      setProjectState((prev) => {
        const connected_plugins = prev.connectedPlugins || projectState.connectedPlugins || [];
        const connected_pluginsData = prev.connectedPluginsData || projectState.connectedPluginsData || [];
        // Update requirements from Phase 1 analysis
        updateRequirementsFromAnalysis({
          analysis: phase1Result.analysis || {},
          connectedPlugins: connected_plugins,
          connectedPluginsData: connected_pluginsData
        } as PromptResponsePayload);

        return {
          ...prev,
          clarityScore: phase1Result.clarityScore || 50,
          connectedPlugins: connected_plugins
        };
      });

      // Step 3: Decide whether to ask questions or enhance directly
      if (phase1Result.needsClarification && (phase1Result.clarityScore || 0) < 90) {
        console.log('🚀 Phase 2: Generating clarification questions');

        // Phase 2: Get clarification questions
        const phase2Result = await processMessageInThread(2, prompt);

        console.log('🚀 Phase 2 Result:', phase2Result);

        const questionsSequence = phase2Result.questionsSequence || [];
        if (questionsSequence.length > 0) {
          const validQuestions = questionsSequence.filter((q: ClarificationQuestion) =>
            q?.id && q?.question && q?.type
          );

          if (validQuestions.length > 0) {
            const firstId = validQuestions[0]?.id;
            const initialVisible = new Set<string>();
            if (firstId) initialVisible.add(firstId);

            setProjectState((prev) => {
              const connected_plugins = prev.connectedPlugins || projectState.connectedPlugins || [];
              const connected_pluginsData = prev.connectedPluginsData || projectState.connectedPluginsData || [];
              // Update requirements from Phase 2 analysis
              updateRequirementsFromAnalysis({
                analysis: phase2Result.analysis || phase1Result.analysis || {},
                connectedPlugins: connected_plugins,
                connectedPluginsData: connected_pluginsData
              } as PromptResponsePayload);

              return {
                ...prev,
                questionsSequence: validQuestions,
                currentQuestionIndex: 0,
                isProcessingQuestion: false,
                questionsWithVisibleOptions: initialVisible,
                clarityScore: phase2Result.clarityScore || phase1Result.clarityScore || 50,
                connectedPlugins: connected_plugins,
                connectedPluginsData: connected_pluginsData
              };
            });

            console.log('🎯 Thread-based flow: Questions setup complete. User can now answer questions.');
          } else {
            // No valid questions, enhance directly
            addMessage('I need more details, but let me enhance your request directly...', 'ai');
            setTimeout(() => startEnhancementWithThread(prompt, {}), 1000);
          }
        } else {
          // No questions generated, enhance directly
          addMessage('Let me enhance your request directly...', 'ai');
          setTimeout(() => startEnhancementWithThread(prompt, {}), 1000);
        }
      } else {
        // High clarity score, skip questions
        console.log('✅ High clarity score, skipping questions');
        addMessage('Your request is very clear. Let me enhance it...', 'ai');
        setTimeout(() => startEnhancementWithThread(prompt, {}), 1000);
      }

    } catch (err) {
      console.error('❌ Thread-based processing error:', err);
      addMessage('I encountered an error with the new flow. Let me try the standard approach...', 'ai');
      // Could fallback to legacy flow here if needed
      throw err;
    }
  }, [projectState, user, addMessage, updateRequirementsFromAnalysis, setProjectState]);

  /**
   * Enhancement using thread-based flow (Phase 3)
   * Note: Forward reference to startEnhancement is okay because it's only called at runtime
   */
  const startEnhancementWithThread = useCallback(
    async (originalPrompt: string, finalAnswers: Record<string, string>) => {
      if (!threadId.current) {
        console.warn('⚠️ No thread ID, falling back to legacy enhancement');
        // Forward reference - startEnhancement is defined later but will be available at runtime
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        return startEnhancement(originalPrompt, finalAnswers);
      }

      console.log('🚀 STEP 3 (Thread): Enhancement with thread:', threadId.current);

      // Validation checks (same as legacy)
      if (enhancementStarted.current && projectState.enhancementComplete) {
        console.log('Enhancement blocked - already completed');
        return;
      }

      if (projectState.conversationCompleted || projectState.planApproved) {
        console.log('Enhancement blocked - work already completed');
        return;
      }

      if (!originalPrompt?.trim() || !user?.id) {
        addMessage('I encountered an error. Please try again.', 'ai');
        return;
      }

      setIsProcessing(true);
      isCurrentlyProcessing.current = true;
      addMessage('Creating your detailed automation plan...', 'ai');

      try {
        // Phase 3: Enhancement via thread
        const phase3Result = await processMessageInThread(3, originalPrompt, finalAnswers);

        console.log('🚀 Phase 3 Result:', phase3Result);

        // Extract and format enhanced prompt from result
        const formatEnhancedPrompt = (enhancedPrompt: any): string => {
          // If it's already a string, return it
          if (typeof enhancedPrompt === 'string') {
            return enhancedPrompt;
          }

          // If it's the structured object from Phase 3, format it nicely
          if (enhancedPrompt && typeof enhancedPrompt === 'object') {
            const sections = enhancedPrompt.sections || {};
            const specifics = enhancedPrompt.specifics || {};

            let formatted = '';

            // Add plan description
            if (enhancedPrompt.plan_description) {
              formatted += `${enhancedPrompt.plan_description}\n\n`;
            }

            // Add data section
            if (sections.data) {
              formatted += `**Data Source:**\n${sections.data}\n\n`;
            }

            // Add processing steps
            if (sections.processing_steps && Array.isArray(sections.processing_steps)) {
              formatted += `**Processing Steps:**\n`;
              sections.processing_steps.forEach((step: string, index: number) => {
                formatted += `${index + 1}. ${step}\n`;
              });
              formatted += '\n';
            }

            // Add output
            if (sections.output) {
              formatted += `**Output:**\n${sections.output}\n\n`;
            }

            // Add delivery
            if (sections.delivery) {
              formatted += `**Delivery:**\n${sections.delivery}\n\n`;
            }

            // Add services involved
            if (specifics.services_involved && Array.isArray(specifics.services_involved)) {
              formatted += `**Services Used:**\n${specifics.services_involved.join(', ')}\n\n`;
            }

            // Add error handling
            if (sections.error_handling) {
              formatted += `**Error Handling:**\n${sections.error_handling}`;
            }

            return formatted.trim();
          }

          return 'Enhanced automation plan created';
        };

        const enhancedPromptText = formatEnhancedPrompt(phase3Result.enhanced_prompt);

        // Update project state with enhancement results
        setProjectState((prev) => {
          // Update requirements from Phase 3 analysis
          if (phase3Result.analysis) {
            console.log('🔄 Updating requirements from Phase 3 analysis');
            
            const connected_plugins = prev.connectedPlugins || projectState.connectedPlugins || [];
            const connected_pluginsData = prev.connectedPluginsData || projectState.connectedPluginsData || [];
              
            updateRequirementsFromAnalysis({
              analysis: phase3Result.analysis,
              connectedPlugins: connected_plugins,
              connectedPluginsData: connected_pluginsData
            } as PromptResponsePayload);
          }

          return {
            ...prev,
            enhancedPrompt: enhancedPromptText,
            enhancementComplete: true,
            conversationCompleted: true,
            clarificationAnswers: finalAnswers,
            workflowPhase: 'approval',
            clarityScore: phase3Result.clarityScore || prev.clarityScore
          };
        });

        const message = `Perfect! I've created a detailed plan for your automation:

**Your Automation Plan:**
${enhancedPromptText}

This plan explains step-by-step what your agent will do. You can approve this plan or make changes to it.`;

        addMessage(message, 'ai');
        console.log('✅ STEP 3 (Thread): Enhancement completed');

      } catch (err) {
        console.error('❌ Thread enhancement error:', err);
        addMessage('I encountered an error creating your plan. Please try again.', 'ai');
      } finally {
        setIsProcessing(false);
        isCurrentlyProcessing.current = false;
        enhancementStarted.current = true;
      }
    },
    [projectState, user, threadId, addMessage, setProjectState, enhancementStarted, isCurrentlyProcessing, setIsProcessing]
  );

  // STEP 3: Enhancement logic
  const startEnhancement = useCallback(
    async (originalPrompt: string, finalAnswers: Record<string, string>) => {
      console.log('🚀 STEP 3: Starting enhancement with CONSISTENT agent ID:', agentId.current);

      const conPlugins = projectState.connectedPlugins || [];
      const conPluginsData = projectState.connectedPluginsData || [];
      if (conPlugins) {        
        console.log('Received Connected Plugins from Clarification Step:', conPlugins);
        console.log('Received Connected Plugins Data from Clarification Step:', conPluginsData);
      }      

      // Validation checks
      if (enhancementStarted.current && projectState.enhancementComplete) {
        console.log('Enhancement blocked - already completed');
        return;
      }

      if (projectState.conversationCompleted || projectState.planApproved) {
        console.log('Enhancement blocked - work already completed');
        return;
      }

      if (!originalPrompt?.trim() || !user?.id) {
        addMessage('I encountered an error. Please try again.', 'ai');
        return;
      }

      setIsProcessing(true);
      isCurrentlyProcessing.current = true;
      
      // FIXED: Single enhancement message - removed duplicate
      addMessage('Creating your detailed automation plan...', 'ai');

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
            prompt: originalPrompt.trim(),
            clarificationAnswers: finalAnswers,
            userId: user.id,
            sessionId: sessionId.current,
            agentId: agentId.current,
            connectedPlugins: conPlugins,
            connectedPluginsData: conPluginsData,
            missingPlugins: projectState.missingPlugins || [],
            pluginWarning: projectState.pluginWarning,
          } as EnhancedPromptRequestPayload),
        });

        if (!response.ok) {
          throw new Error(`Enhancement failed: ${response.status}`);
        }

        const result = await response.json();
        console.log('Enhanced Prompt Response: ', result);
        
        // Update project state with enhancement results
        const connectedServiceKeys = getConnectedServiceKeys(result.metadata.connectedPlugins || []);
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

        // FIXED: Updated message format for consistency
        const message = `Perfect! I've created a detailed plan for your automation:

**Your Automation Plan:**
${result.enhancedPrompt}

This plan explains step-by-step what your agent will do. You can approve this plan or make changes to it.`;

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
    console.log('🎯 [QUESTION-RENDER] Question rendering useEffect triggered', {
      isInReviewMode: projectState.isInReviewMode,
      currentQuestionIndex: projectState.currentQuestionIndex,
      totalQuestions: projectState.questionsSequence.length,
      hasCurrentQuestion: !!projectState.questionsSequence[projectState.currentQuestionIndex]
    });

    // Don't show new questions in review mode
    if (projectState.isInReviewMode) {
      console.log('⏭️ [QUESTION-SKIP] In review mode, not showing questions');
      return;
    }

    const currentQuestion = projectState.questionsSequence[projectState.currentQuestionIndex];
    if (currentQuestion && projectState.currentQuestionIndex >= 0) {
      console.log('📝 [QUESTION-DISPLAY] Scheduling question display', {
        questionId: currentQuestion.id,
        questionText: currentQuestion.question?.substring(0, 50),
        questionIndex: projectState.currentQuestionIndex
      });

      const timer = setTimeout(() => {
        console.log('💬 [QUESTION-DISPLAY] Adding AI message for question');
        addMessage(currentQuestion.question, 'ai');

        // Add question component
        const questionMessage: Message = {
          id: `question-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: 'system',
          content: JSON.stringify(currentQuestion),
          timestamp: new Date(),
          questionId: currentQuestion.id,
        };
        console.log('📋 [QUESTION-DISPLAY] Adding question message component');
        setMessages((prev) => [...prev, questionMessage]);
      }, 500);

      return () => clearTimeout(timer);
    } else {
      console.log('⏭️ [QUESTION-SKIP] No current question to display', {
        hasCurrentQuestion: !!currentQuestion,
        currentQuestionIndex: projectState.currentQuestionIndex
      });
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
      
      // FIXED: Removed duplicate message - only one enhancement message now
      const fullPrompt = `${projectState.originalPrompt}\n\nAdditional details:\n${Object.entries(projectState.clarificationAnswers)
        .map(([qid, ans]) => {
          const q = projectState.questionsSequence.find((qq) => qq.id === qid);
          const dim = q?.dimension || qid;
          return `${dim}: ${ans}`;
        })
        .join('\n')}`;

      setTimeout(() => {
        // Choose enhancement method based on feature flag
        if (useThreadFlow && threadId.current) {
          console.log('🚀 Auto-enhancement: Using thread-based flow');
          startEnhancementWithThread(fullPrompt, projectState.clarificationAnswers);
        } else {
          console.log('🚀 Auto-enhancement: Using legacy flow');
          startEnhancement(fullPrompt, projectState.clarificationAnswers);
        }
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
    startEnhancementWithThread,
    setProjectState,
    useThreadFlow,
    threadId
  ]);

  // Initial prompt processing with 3-API sequence
  useEffect(() => {
    console.log('🔍 [FLOW-START] Initial prompt processing useEffect triggered', {
      hasProcessedInitialPrompt: hasProcessedInitialPrompt.current,
      isCurrentlyProcessing: isCurrentlyProcessing.current,
      initialPrompt: initialPrompt?.substring(0, 50),
      projectStateOriginalPrompt: projectState.originalPrompt?.substring(0, 50),
      conversationCompleted: projectState.conversationCompleted,
      isInReviewMode: projectState.isInReviewMode,
      hasRestoredState: !!restoredState,
      restoredStateWorkflowPhase: restoredState?.workflowPhase,
      useThreadFlow
    });

    // IMPORTANT: Check refs FIRST before calling any functions
    // This prevents the effect from running multiple times
    if (hasProcessedInitialPrompt.current) {
      console.log('⏭️ [FLOW-SKIP] Already processed initial prompt');
      return; // Silent skip - already processed
    }
    if (isCurrentlyProcessing.current) {
      console.log('⏭️ [FLOW-SKIP] Currently processing');
      return; // Silent skip - currently processing
    }

    if (!initialPrompt) {
      console.log('⏭️ [FLOW-SKIP] No initial prompt');
      return;
    }
    if (shouldSkipAIProcessing()) {
      console.log('⏭️ [FLOW-SKIP] AI processing blocked by shouldSkipAIProcessing()');
      return;
    }
    if (projectState.originalPrompt) {
      console.log('⏭️ [FLOW-SKIP] Original prompt already set:', projectState.originalPrompt.substring(0, 50));
      return;
    }
    if (projectState.conversationCompleted) {
      console.log('⏭️ [FLOW-SKIP] Conversation completed');
      return;
    }
    if (projectState.isInReviewMode) {
      console.log('⏭️ [FLOW-SKIP] In review mode');
      return;
    }

    // Skip if restored state has completed work
    if (restoredState && (
        restoredState.enhancementComplete ||
        restoredState.planApproved ||
        restoredState.conversationCompleted ||
        restoredState.workflowPhase === 'completed' ||
        restoredState.workflowPhase === 'approval'
      )) {
      console.log('⏭️ [FLOW-SKIP] Restored state has completed work', {
        enhancementComplete: restoredState.enhancementComplete,
        planApproved: restoredState.planApproved,
        conversationCompleted: restoredState.conversationCompleted,
        workflowPhase: restoredState.workflowPhase
      });
      return;
    }

    console.log('✅ [FLOW-PROCEED] All checks passed - will process initial prompt in 500ms');
    console.log('🎯 [FLOW-PROCEED] Processing initial prompt with 3-API sequence');

    // CRITICAL FIX: Don't set hasProcessedInitialPrompt until processPrompt actually starts
    // Only set isCurrentlyProcessing to prevent duplicate triggers
    isCurrentlyProcessing.current = true;
    const prompt = initialPrompt.trim();

    const processPrompt = async () => {
      // NOW set hasProcessedInitialPrompt when we actually start processing
      hasProcessedInitialPrompt.current = true;
      isInitialized.current = true;

      console.log('🚀 [FLOW-PROCESS] Starting processPrompt function', {
        prompt: prompt.substring(0, 50),
        useThreadFlow,
        userId: user?.id
      });

      try {
        console.log('📝 [FLOW-PROCESS] Setting isProcessing=true and adding user message');
        setIsProcessing(true);
        addMessage(prompt, 'user');

        console.log('📝 [FLOW-PROCESS] Updating project state with original prompt');
        setProjectState((prev) => ({
          ...prev,
          originalPrompt: prompt,
          hasProcessedInitial: true,
          isInitialized: true,
          workflowPhase: 'questions'
        }));

        // ===== FEATURE FLAG BRANCHING =====
        if (useThreadFlow) {
          console.log('🆕 [FLOW-THREAD] Using thread-based flow');
          await processWithThreads(prompt);
          console.log('✅ [FLOW-THREAD] processWithThreads completed');
          return; // Exit early - processWithThreads handles everything
        }

        // ===== LEGACY 3-API FLOW =====
        console.log('📜 [FLOW-LEGACY] Using legacy 3-API flow');

        // Step 1: Analyze prompt clarity
        console.log('📞 [FLOW-API-1] Calling analyzePromptClarity API');
        const responsePromptClarity = await analyzePromptClarity(prompt);
        console.log('✅ [FLOW-API-1] analyzePromptClarity completed', {
          clarityScore: responsePromptClarity.analysis?.clarityScore,
          needsClarification: responsePromptClarity.analysis?.needsClarification
        });
        const analysisPromptClarity = responsePromptClarity.analysis;
        
        // FIXED: Handle plugin warnings from analysis
        if (analysisPromptClarity.pluginWarning) {
          console.log('Adding plugin warning message from analysis:', analysisPromptClarity.pluginWarning.message);
          addMessage(analysisPromptClarity.pluginWarning.message, 'ai');
          setProjectState((prev) => ({
            ...prev,
            missingPlugins: analysisPromptClarity.pluginWarning?.missingPlugins || [],
            pluginWarning: analysisPromptClarity.pluginWarning
          }));
        }
        
        console.log('📊 [FLOW-UPDATE] Updating requirements from analysis');
        updateRequirementsFromAnalysis(responsePromptClarity);

        // Step 2 & 3: Questions or direct enhancement
        console.log('🔀 [FLOW-DECISION] Determining next step based on clarity score', {
          needsClarification: analysisPromptClarity.needsClarification,
          clarityScore: analysisPromptClarity.clarityScore
        });

        if (analysisPromptClarity.needsClarification && analysisPromptClarity.clarityScore < 90) {
          console.log('📞 [FLOW-API-2] Calling generateClarificationQuestions API');
          const resClarification = await generateClarificationQuestions(prompt, responsePromptClarity);
          console.log('✅ [FLOW-API-2] generateClarificationQuestions completed', {
            hasAnalysis: !!resClarification.analysis,
            questionsCount: resClarification.analysis?.questionsSequence?.length || 0
          });

          const analysis = resClarification.analysis;
          const questionsSequence = analysis ? analysis.questionsSequence : [];
          console.log('🔍 [FLOW-QUESTIONS] Processing questions sequence', {
            totalQuestions: questionsSequence?.length || 0,
            hasQuestions: !!questionsSequence && questionsSequence.length > 0
          });

          if (questionsSequence && questionsSequence.length > 0) {
            const validQuestions = questionsSequence.filter((q: ClarificationQuestion) =>
              q?.id && q?.question && q?.type
            );

            console.log('✅ [FLOW-QUESTIONS] Filtered valid questions', {
              totalQuestions: questionsSequence.length,
              validQuestions: validQuestions.length
            });

            if (validQuestions.length > 0) {
              const firstId = validQuestions[0]?.id;
              const initialVisible = new Set<string>();
              if (firstId) initialVisible.add(firstId);

              console.log('📝 [FLOW-STATE] Setting up questions in project state');
              setProjectState((prev) => ({
                ...prev,
                questionsSequence: validQuestions,
                currentQuestionIndex: 0,
                isProcessingQuestion: false,
                questionsWithVisibleOptions: initialVisible,
                clarityScore: analysis.clarityScore || 50,
                connectedPlugins: resClarification.connectedPlugins || [],
                connectedPluginsData: resClarification.connectedPluginsData || [],
              }));

              console.log('🎯 [FLOW-COMPLETE] 3-API sequence: Questions setup complete. User can now answer questions.');
            } else {
              console.log('⚠️ [FLOW-FALLBACK] No valid questions, enhancing directly');
              addMessage('I need more details, but let me enhance your request directly...', 'ai');
              setTimeout(() => startEnhancement(prompt, {}), 1000);
            }
          } else {
            console.log('⚠️ [FLOW-FALLBACK] No questions returned, enhancing directly');
            addMessage('Let me enhance your request directly...', 'ai');
            setTimeout(() => startEnhancement(initialPrompt.trim(), {}), 1000);
          }
        } else {
          console.log('✨ [FLOW-DIRECT] High clarity score, skipping questions and enhancing directly');
          addMessage('Your request is very clear. Let me enhance it...', 'ai');
          setTimeout(() => startEnhancement(prompt, {}), 1000);
        }
        
      } catch (err) {
        console.error('❌ [FLOW-ERROR] Processing error:', err);
        console.error('❌ [FLOW-ERROR] Error stack:', err instanceof Error ? err.stack : 'No stack trace');
        addMessage('I encountered an error. Please try again.', 'ai');

        // Fallback to legacy if thread-based fails
        if (useThreadFlow) {
          console.log('⚠️ [FLOW-FALLBACK] Thread flow failed, falling back to legacy');
          try {
            // Try legacy flow as fallback
            const responsePromptClarity = await analyzePromptClarity(prompt);
            updateRequirementsFromAnalysis(responsePromptClarity);
            // Continue with legacy flow...
            addMessage('Switched to standard processing...', 'ai');
            setTimeout(() => startEnhancement(prompt, {}), 1000);
          } catch (legacyErr) {
            console.error('❌ [FLOW-ERROR] Legacy fallback also failed:', legacyErr);
            addMessage('Unable to process your request. Please try again.', 'ai');
          }
        } else {
          console.log('⚠️ [FLOW-FALLBACK] Legacy flow error - trying direct enhancement');
          // Legacy flow error - try direct enhancement
          setTimeout(() => startEnhancement(prompt, {}), 1000);
        }
      } finally {
        console.log('🏁 [FLOW-FINALLY] Processing complete, resetting flags');
        setIsProcessing(false);
        isCurrentlyProcessing.current = false;
      }
    };

    const timeoutId = setTimeout(processPrompt, 500);

    // Cleanup function to cancel the timeout if component unmounts or dependencies change
    return () => {
      console.log('🧹 [FLOW-CLEANUP] Cleanup triggered', {
        timeoutCleared: true,
        hasProcessedInitialPrompt: hasProcessedInitialPrompt.current,
        isCurrentlyProcessing: isCurrentlyProcessing.current
      });
      clearTimeout(timeoutId);
      // ONLY reset flags if we haven't actually started processing yet
      // If hasProcessedInitialPrompt is true, we've already started and shouldn't reset
      if (!hasProcessedInitialPrompt.current) {
        console.log('🧹 [FLOW-CLEANUP] Resetting flags - processing never started');
        isCurrentlyProcessing.current = false;
        isInitialized.current = false;
      } else {
        console.log('🧹 [FLOW-CLEANUP] Keeping flags - processing already started');
      }
    };
  }, [
    // Only include values that should trigger a re-run, not functions
    initialPrompt,
    projectState.originalPrompt,
    projectState.conversationCompleted,
    projectState.isInReviewMode,
    useThreadFlow
    // Note: Removed function dependencies (shouldSkipAIProcessing, addMessage, etc.)
    // These change on every render and cause infinite loops
    // The functions are captured in the closure and remain stable within the async execution
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
      "I've updated your plan. Please review and let me know if you'd like to use it or make more changes.",
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