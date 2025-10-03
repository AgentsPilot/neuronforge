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
 * OPTIMAL VERSION: Uses proper data flow from UserProvider with fallback to API metadata
 * Database → API → UserProvider → Frontend (with API response fallback)
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

  // Session tracking
  const sessionId = useRef(
    restoredState?.sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  );
  const initialMessageId = useRef(`initial-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  
  // AI Prevention flags
  const hasProcessedInitialPrompt = useRef(false);
  const isCurrentlyProcessing = useRef(false);
  const isInitialized = useRef(false);
  const enhancementStarted = useRef(false);

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
      customInputQuestionId: null,
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
      
      // Completion tracking
      conversationCompleted: false,
      planApproved: false,
      workflowPhase: 'initial',
      isInReviewMode: false,
      allowNavigation: false,
    };

    if (restoredState) {
      console.log('Restoring project state:', {
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
        enhancementStarted.current = true;
      }
      
      return {
        ...defaultState,
        ...restoredState,
        sessionId: sessionId.current,
        questionsWithVisibleOptions: new Set(restoredState.questionsSequence?.map((q) => q.id) || []),
        isInitialized: true,
      };
    } else {
      enhancementStarted.current = false;
    }
    
    return defaultState;
  });

  // OPTIMAL: Utility to get plugin display names with proper fallback hierarchy
  const getServiceDisplayNames = useCallback((pluginKeys: string[], apiPluginData?: any[]): string[] => {
    return pluginKeys.map(key => {
      // Priority 1: API response plugin metadata (when available)
      if (apiPluginData && apiPluginData.length > 0) {
        const apiPlugin = apiPluginData.find(p => p.key === key);
        if (apiPlugin && (apiPlugin.displayName || apiPlugin.label)) {
          return apiPlugin.displayName || apiPlugin.label;
        }
      }
      
      // Priority 2: UserProvider plugin data (primary source)
      if (user?.connectedPlugins && user.connectedPlugins[key]) {
        const userPlugin = user.connectedPlugins[key];
        if (userPlugin.displayName) return userPlugin.displayName;
        if (userPlugin.name) return userPlugin.name;
        if (userPlugin.label) return userPlugin.label;
      }
      
      // Priority 3: Format the key nicely (last resort)
      return key.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    });
  }, [user?.connectedPlugins]);

  // OPTIMAL: Get connected service keys with proper fallback
  const getConnectedServiceKeys = useCallback((apiResponse?: any): string[] => {
    // Priority 1: API response data (most up-to-date)
    if (apiResponse?.connectedPluginData && Array.isArray(apiResponse.connectedPluginData)) {
      return apiResponse.connectedPluginData.map(p => p.key);
    }
    
    // Priority 2: UserProvider data (should be primary source after auth)
    if (user?.connectedPlugins && Object.keys(user.connectedPlugins).length > 0) {
      return Object.keys(user.connectedPlugins);
    }
    
    // Priority 3: Empty array (no connections)
    return [];
  }, [user?.connectedPlugins]);

  // Wait for user context to be loaded before processing
  const shouldWaitForUserContext = !userLoading && !user?.connectedPlugins && user;

  // AI Prevention - Enhanced with completion checks and user loading
  const shouldSkipAIProcessing = useCallback(() => {
    const skipReasons = [];
    
    // Check 0: Wait for user context to load
    if (userLoading) skipReasons.push('user_loading');
    if (shouldWaitForUserContext) skipReasons.push('waiting_for_plugins');
    
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

    if (skipReasons.length > 0) {
      console.log('AI Processing BLOCKED - Reasons:', skipReasons);
      return true;
    }
    
    console.log('AI Processing ALLOWED - No blocking conditions');
    return false;
  }, [projectState, restoredState, enhancementStarted.current, userLoading, shouldWaitForUserContext]);

  // Utility to ensure timestamps are Date objects
  const ensureDateTimestamp = useCallback((message: Message): Message => {
    return {
      ...message,
      timestamp: message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp)
    };
  }, []);

  // Messages with proper restoration
  const [messages, setMessages] = useState<Message[]>(() => {
    console.log('Initializing messages:', {
      hasRestoredState: !!restoredState,
      isInReviewMode: restoredState?.isInReviewMode,
      restoredMessages: restoredState?.messages?.length || 0,
      hasInitialPrompt: !!initialPrompt,
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

  // Always persist messages in state
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
        console.log('Message blocked - in review mode');
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

  // OPTIMAL: Enhanced enhancement logic using proper plugin metadata hierarchy
  const startEnhancement = useCallback(
    async (prompt: string, finalAnswers: Record<string, string>) => {
      console.log('startEnhancement called with state:', {
        enhancementStarted: enhancementStarted.current,
        enhancementComplete: projectState.enhancementComplete,
        conversationCompleted: projectState.conversationCompleted,
        isProcessing,
        isCurrentlyProcessing: isCurrentlyProcessing.current,
        hasPrompt: !!prompt?.trim(),
        hasUserId: !!user?.id,
        hasConnectedPlugins: !!(user?.connectedPlugins && Object.keys(user.connectedPlugins).length > 0)
      });

      // Only check ref-based flag if NOT in active enhancement process
      if (enhancementStarted.current && projectState.enhancementComplete) {
        console.log('Enhancement blocked - already completed');
        return;
      }

      // Simplified checks during active enhancement
      if (projectState.conversationCompleted || projectState.planApproved) {
        console.log('Enhancement blocked - work already completed');
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

      console.log('Starting enhancement API call');
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
            connected_plugins: user?.connectedPlugins || {},
            missingPlugins: projectState.missingPlugins || [],
            pluginWarning: projectState.pluginWarning ? {
              missingServices: projectState.missingPlugins || [],
              message: `Note: Your request mentions services that aren't connected.`
            } : undefined
          }),
        });

        if (!response.ok) {
          throw new Error(`Enhancement failed: ${response.status}`);
        }

        const result = await response.json();

        // OPTIMAL: Use proper plugin metadata hierarchy
        const connectedServiceKeys = getConnectedServiceKeys(result);
        const serviceDisplayNames = getServiceDisplayNames(connectedServiceKeys, result.connectedPluginData);
        
        console.log('Enhancement completed with plugin metadata:', {
          connectedServiceKeys,
          serviceDisplayNames,
          hasApiPluginData: !!(result.connectedPluginData && result.connectedPluginData.length > 0),
          hasUserPluginData: !!(user?.connectedPlugins && Object.keys(user.connectedPlugins).length > 0)
        });

        setProjectState((prev) => ({
          ...prev,
          enhancedPrompt: result.enhancedPrompt,
          enhancementComplete: true,
          conversationCompleted: true,
          clarificationAnswers: finalAnswers,
          workflowPhase: 'approval',
          // OPTIMAL: Update requirements with correct actions based on proper metadata
          requirements: prev.requirements.map(req => {
            if (req.id === 'actions') {
              const rebuiltActions = connectedServiceKeys.length > 0
                ? `Summarize and save to ${serviceDisplayNames.join(', ')}`
                : 'Actions require service connections';
              
              console.log('Updating actions requirement using optimal metadata:', {
                old: req.detected,
                new: rebuiltActions,
                connectedServiceKeys,
                serviceDisplayNames,
                hasConnectedServices: connectedServiceKeys.length > 0
              });
              
              return {
                ...req,
                status: connectedServiceKeys.length > 0 ? 'clear' : 'missing',
                detected: rebuiltActions
              };
            }
            return req;
          })
        }));

        let message = `Here's your enhanced automation plan:

**Enhanced Plan:**
${result.enhancedPrompt}

This breaks down exactly what your agent will do. Would you like to use this enhanced version, edit it, or stick with your original request?`;

        addMessage(message, 'ai');
        console.log('Enhancement completed');
        
      } catch (err) {
        console.error('Enhancement error:', err);
        addMessage('I encountered an error enhancing your plan. Please try again.', 'ai');
        
        // Reset flags on error so user can try again
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
    [projectState, isProcessing, user?.id, user?.connectedPlugins, addMessage, getServiceDisplayNames, getConnectedServiceKeys]
  );

  // OPTIMAL: Enhanced API Functions with proper plugin metadata support
  const analyzePromptClarity = async (prompt: string): Promise<ClarityAnalysis> => {
    if (!user?.id || !prompt?.trim()) {
      console.error('Invalid parameters for analysis:', { hasUserId: !!user?.id, hasPrompt: !!prompt?.trim() });
      throw new Error('Invalid parameters for analysis');
    }

    const requestPayload = {
      prompt: prompt.trim(),
      userId: user.id,
      sessionId: sessionId.current,
      connected_plugins: user?.connectedPlugins || {},
      bypassPluginValidation: false,
    };

    console.log('Making analysis API call:', {
      endpoint: '/api/analyze-prompt-clarity',
      userId: user.id,
      sessionId: sessionId.current,
      promptLength: prompt.trim().length,
      hasConnectedPlugins: !!(user?.connectedPlugins && Object.keys(user?.connectedPlugins).length > 0),
      connectedPluginsCount: Object.keys(user?.connectedPlugins || {}).length
    });

    try {
      const response = await fetch('/api/analyze-prompt-clarity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
          'x-session-id': sessionId.current,
        },
        body: JSON.stringify(requestPayload),
      });

      console.log('API Response received:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: {
          contentType: response.headers.get('content-type'),
          contentLength: response.headers.get('content-length')
        }
      });

      if (!response.ok) {
        // Enhanced error handling - try to get detailed error information
        let errorDetails = { message: 'Unknown error', details: '', error: '' };
        
        try {
          const contentType = response.headers.get('content-type');
          
          if (contentType && contentType.includes('application/json')) {
            const errorData = await response.json();
            errorDetails = errorData;
            console.error('API returned JSON error:', errorData);
          } else {
            const errorText = await response.text();
            errorDetails.details = errorText;
            errorDetails.error = errorText;
            console.error('API returned text error:', errorText.slice(0, 500));
          }
        } catch (parseError) {
          console.error('Could not parse error response:', parseError);
        }

        console.error(`Analysis API error: ${response.status} - ${JSON.stringify(errorDetails)}`);
        
        // OPTIMAL: Return smart fallback analysis using proper plugin metadata
        const connectedServiceKeys = getConnectedServiceKeys(errorDetails);
        const serviceNames = getServiceDisplayNames(connectedServiceKeys, errorDetails.connectedPluginData);
        const hasServices = connectedServiceKeys.length > 0;
        
        let fallbackActions = 'No actions possible - connect services first';
        if (hasServices) {
          fallbackActions = `Summarize and save to ${serviceNames.join(', ')}`;
        }
        
        console.log('Using fallback with optimal plugin metadata:', { connectedServiceKeys, serviceNames });
        
        return {
          clarityScore: hasServices ? 55 : 25,
          questionsCount: 3,
          needsClarification: true,
          aiValidationFailed: true,
          bypassedPluginValidation: false,
          hadPluginWarning: false,
          analysis: {
            data: { status: "partial", detected: "Gmail processing" },
            timing: { status: "missing", detected: "" },
            output: { status: "partial", detected: "Content processing" },
            actions: { status: hasServices ? "partial" : "missing", detected: fallbackActions },
            delivery: { status: "partial", detected: hasServices ? serviceNames.join(', ') : '' },
            error_handling: { status: "missing", detected: "" }
          },
          error: `API Error ${response.status}: ${errorDetails.message || errorDetails.details || errorDetails.error || 'Server error'}`,
          serverError: true,
          questionsSequence: [
            {
              id: 'email_processing_criteria',
              question: "Which emails should I process for you?",
              dimension: 'data',
              type: 'single_choice',
              options: [
                { value: "recent_emails", label: "Recent emails from today", description: "Process emails received in the last 24 hours" },
                { value: "unread_emails", label: "All unread emails", description: "Focus on emails you haven't read yet" },
                { value: "specific_senders", label: "Emails from specific people/companies", description: "Target emails from particular senders" },
                { value: "subject_keywords", label: "Emails with certain keywords", description: "Look for specific words in the subject line" },
                { value: "custom", label: "Other criteria", description: "Let me specify different search criteria" }
              ],
              allowCustom: true
            },
            {
              id: 'content_organization',
              question: "How should I organize the summarized content?",
              dimension: 'delivery',
              type: 'single_choice',
              options: [
                { value: "single_summary", label: "Create one combined summary", description: "Merge all email content into a single document" },
                { value: "separate_summaries", label: "Keep separate summaries per email", description: "Create individual summaries for each email" },
                { value: "categorized_summary", label: "Group by topic or sender", description: "Organize summaries by categories or themes" },
                { value: "custom_format", label: "Specific format", description: "Let me specify how to organize the content" }
              ],
              allowCustom: true
            },
            {
              id: 'automation_schedule',
              question: "When should this automation run?",
              dimension: 'timing',
              type: 'single_choice',
              options: [
                { value: 'immediate', label: 'Run once right now', description: 'Process current emails immediately' },
                { value: 'daily_morning', label: 'Daily at 9:00 AM', description: 'Regular daily processing' },
                { value: 'twice_daily', label: 'Morning (9 AM) and evening (5 PM)', description: 'Two checks per day' },
                { value: 'weekly', label: 'Weekly on Monday mornings', description: 'Once per week summary' },
                { value: 'manual_trigger', label: 'Only when I manually trigger it', description: 'Run on-demand when needed' }
              ],
              allowCustom: false
            }
          ]
        };
      }

      const result = await response.json();
      
      console.log('Analysis API success:', {
        clarityScore: result.clarityScore,
        questionsCount: result.questionsSequence?.length || 0,
        needsClarification: result.needsClarification,
        hasPluginWarning: !!result.pluginWarning,
        hasPluginMetadata: !!(result.connectedPluginData && result.connectedPluginData.length > 0)
      });
      
      if (result.pluginWarning) {
        console.log('API Response contains plugin warning:', {
          message: result.pluginWarning.message,
          missingServices: result.pluginWarning.missingServices
        });
      }
      
      if (typeof result.clarityScore !== 'number') {
        throw new Error('Invalid analysis response structure');
      }
      
      return result;
    } catch (error: any) {
      console.error('Analysis request failed:', error);
      
      // OPTIMAL: Return comprehensive fallback analysis using proper plugin metadata
      const connectedServiceKeys = getConnectedServiceKeys();
      const serviceNames = getServiceDisplayNames(connectedServiceKeys);
      const hasServices = connectedServiceKeys.length > 0;
      
      let fallbackActions = 'No actions possible - connect services first';
      if (hasServices) {
        fallbackActions = `Summarize and save to ${serviceNames.join(', ')}`;
      }
      
      return {
        clarityScore: hasServices ? 50 : 25,
        questionsCount: 3,
        needsClarification: true,
        aiValidationFailed: true,
        bypassedPluginValidation: false,
        hadPluginWarning: false,
        analysis: {
          data: { status: "partial", detected: "Gmail processing" },
          timing: { status: "missing", detected: "" },
          output: { status: "partial", detected: "Content processing" },
          actions: { status: hasServices ? "partial" : "missing", detected: fallbackActions },
          delivery: { status: "partial", detected: hasServices ? serviceNames.join(', ') : '' },
          error_handling: { status: "missing", detected: "" }
        },
        error: error instanceof Error ? error.message : 'Network error',
        networkError: true,
        questionsSequence: [
          {
            id: 'content_identification',
            question: "What type of content should I focus on in your emails?",
            dimension: 'data',
            type: 'single_choice',
            options: [
              { value: "all_emails", label: "All recent emails", description: "Process all emails from the last few days" },
              { value: "unread_only", label: "Only unread emails", description: "Focus on emails you haven't read yet" },
              { value: "specific_topics", label: "Emails about specific topics", description: "Filter based on keywords or subjects" },
              { value: "important_emails", label: "Important or priority emails", description: "Focus on high-priority communications" },
              { value: "custom_criteria", label: "Let me specify custom criteria", description: "I'll provide specific search terms or conditions" }
            ],
            allowCustom: true
          },
          {
            id: 'summary_destination', 
            question: "How should I deliver the summarized content?",
            dimension: 'delivery',
            type: 'single_choice',
            options: [
              { value: "drive_document", label: "Create a Google Drive document", description: "Save summary as a document in your Drive" },
              { value: "multiple_platforms", label: "Share across multiple platforms", description: "Distribute to Drive and other connected services" },
              { value: "email_summary", label: "Send summary via email", description: "Email the summary to you or others" },
              { value: "custom_delivery", label: "Specific delivery method", description: "Let me specify how to deliver the results" }
            ],
            allowCustom: true
          },
          {
            id: 'processing_frequency',
            question: "How often should this automation run?",
            dimension: 'timing',
            type: 'single_choice',
            options: [
              { value: 'one_time', label: 'Run once now', description: 'Process current emails immediately' },
              { value: 'daily_check', label: 'Daily processing', description: 'Check for new emails daily' },
              { value: 'regular_schedule', label: 'Regular schedule (morning/evening)', description: 'Multiple checks per day' },
              { value: 'weekly_summary', label: 'Weekly summary', description: 'Once per week processing' },
              { value: 'manual_only', label: 'Only when I trigger it', description: 'Run on-demand when needed' }
            ],
            allowCustom: false
          }
        ]
      };
    }
  };

  // Initial prompt processing - Enhanced with user context waiting
  useEffect(() => {
    // Should we process the initial prompt?
    if (!initialPrompt) return;
    if (shouldSkipAIProcessing()) return;
    if (hasProcessedInitialPrompt.current) return;
    if (isCurrentlyProcessing.current) return;
    if (projectState.originalPrompt) return;
    if (projectState.conversationCompleted) return;
    if (projectState.isInReviewMode) return;

    // Critical check - if we have restored state with existing work, don't process new prompt
    if (restoredState && (
        restoredState.enhancementComplete || 
        restoredState.planApproved || 
        restoredState.conversationCompleted ||
        restoredState.workflowPhase === 'completed' ||
        restoredState.workflowPhase === 'approval'
      )) {
      console.log('Skipping initial prompt processing - restored state has completed work', {
        enhancementComplete: restoredState.enhancementComplete,
        planApproved: restoredState.planApproved,
        conversationCompleted: restoredState.conversationCompleted,
        workflowPhase: restoredState.workflowPhase
      });
      return;
    }

    // Check if prompt matches existing work in restored state - don't reprocess
    if (restoredState?.originalPrompt && 
        restoredState.originalPrompt.trim().toLowerCase() === initialPrompt.trim().toLowerCase()) {
      console.log('Skipping initial prompt processing - same prompt as restored state');
      return;
    }

    console.log('Processing initial prompt:', initialPrompt.slice(0, 50));
    
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
        
        console.log('=== ANALYSIS RESULT RECEIVED ===', {
          analysis,
          needsClarification: analysis.needsClarification,
          hasQuestions: analysis.questionsSequence?.length > 0,
          clarityScore: analysis.clarityScore,
          hasPluginWarning: !!analysis.pluginWarning,
          aiValidationFailed: analysis.aiValidationFailed,
          serverError: analysis.serverError,
          networkError: analysis.networkError
        });
        
        // Handle analysis failure gracefully
        if (analysis.aiValidationFailed || analysis.serverError || analysis.networkError) {
          console.log('Analysis failed, but got fallback questions');
          
          if (analysis.questionsSequence && analysis.questionsSequence.length > 0) {
            // Use the fallback questions from the analysis
            addMessage('I had some trouble with the automatic analysis, but I can still help you! Let me ask a few questions to understand your automation better.', 'ai');
            
            const firstId = analysis.questionsSequence[0]?.id;
            const initialVisible = new Set<string>();
            if (firstId) initialVisible.add(firstId);

            // Use functional update to avoid race condition
            setProjectState((prev) => {
              // Validate the questions have proper structure
              const validatedQuestions = analysis.questionsSequence.filter(q => 
                q && typeof q === 'object' && q.id && q.question && q.options && Array.isArray(q.options)
              );
              
              if (validatedQuestions.length === 0) {
                console.error('No valid questions in fallback analysis');
                return prev;
              }

              return {
                ...prev,
                questionsSequence: validatedQuestions,
                currentQuestionIndex: 0,
                isProcessingQuestion: false,
                questionsWithVisibleOptions: initialVisible,
                clarityScore: analysis.clarityScore || 40,
                // OPTIMAL: Update requirements with fallback analysis data
                requirements: prev.requirements.map(req => {
                  const analysisData = (analysis.analysis as any)?.[req.id];
                  return {
                    ...req,
                    status: analysisData?.status || 'missing',
                    detected: analysisData?.detected || '',
                  };
                })
              };
            });
            return;
          } else {
            // No questions available, go straight to enhancement
            addMessage('I had trouble analyzing your request, but let me enhance it directly...', 'ai');
            setTimeout(() => startEnhancement(initialPrompt.trim(), {}), 1000);
            return;
          }
        }
        
        // OPTIMAL: Process successful analysis - handle plugin warnings and update requirements using proper metadata
        console.log('DEBUG: User object structure:', {
          user,
          hasConnectedPlugins: !!(user?.connectedPlugins && Object.keys(user?.connectedPlugins).length > 0),
          connectedPluginsType: typeof user?.connectedPlugins,
          connectedPluginsKeys: user?.connectedPlugins ? Object.keys(user.connectedPlugins) : 'undefined',
          connectedPluginsCount: user?.connectedPlugins ? Object.keys(user.connectedPlugins).length : 0
        });
        
        if (analysis.pluginWarning) {
          const warningMessage = analysis.pluginWarning.message;
          console.log('Adding warning message:', warningMessage);
          addMessage(warningMessage, 'ai');
          
          // Store plugin warning info in project state
          setProjectState((prev) => ({
            ...prev,
            missingPlugins: analysis.pluginWarning?.missingServices || [],
            pluginWarning: analysis.pluginWarning
          }));
        }
        
        // OPTIMAL: Update requirements with analysis data - use proper plugin metadata hierarchy
        const connectedServiceKeys = getConnectedServiceKeys(analysis);
        
        console.log('Connected services check using optimal metadata:', {
          connectedServiceKeys,
          hasActionsData: !!(analysis.analysis as any)?.actions?.detected,
          hasPluginWarning: !!analysis.pluginWarning?.missingServices,
          hasApiPluginMetadata: !!(analysis.connectedPluginData && analysis.connectedPluginData.length > 0),
          hasUserPluginData: !!(user?.connectedPlugins && Object.keys(user?.connectedPlugins).length > 0),
          willFilterActions: !!((analysis.analysis as any)?.actions?.detected && analysis.pluginWarning?.missingServices)
        });
        
        setProjectState((prev) => ({
          ...prev,
          requirements: prev.requirements.map(req => {
            const analysisData = (analysis.analysis as any)?.[req.id];
            
            console.log(`Processing requirement: ${req.id}`, {
              hasAnalysisData: !!analysisData,
              detected: analysisData?.detected,
              isActions: req.id === 'actions',
              hasPluginWarning: !!analysis.pluginWarning?.missingServices
            });
            
            // SPECIAL HANDLING FOR ACTIONS: Filter out unconnected services using optimal metadata
            if (req.id === 'actions' && analysisData?.detected && analysis.pluginWarning?.missingServices) {
              console.log('Filtering actions during analysis phase using optimal metadata:', {
                originalActions: analysisData.detected,
                missingServices: analysis.pluginWarning.missingServices,
                connectedServiceKeys,
                hasApiPluginMetadata: !!(analysis.connectedPluginData && analysis.connectedPluginData.length > 0)
              });
              
              // OPTIMAL: Use proper plugin metadata hierarchy to get display names
              const serviceDisplayNames = getServiceDisplayNames(connectedServiceKeys, analysis.connectedPluginData);
              
              const filteredActions = connectedServiceKeys.length > 0 
                ? `Summarize and save to ${serviceDisplayNames.join(', ')}`
                : 'Actions require service connections';
              
              console.log('Filtered actions during analysis using optimal metadata:', {
                original: analysisData.detected,
                filtered: filteredActions,
                connectedServices: serviceDisplayNames,
                usedApiMetadata: !!(analysis.connectedPluginData && analysis.connectedPluginData.length > 0),
                usedUserMetadata: !!(user?.connectedPlugins && Object.keys(user?.connectedPlugins).length > 0)
              });
              
              return {
                ...req,
                status: connectedServiceKeys.length > 0 ? 'clear' : 'missing',
                detected: filteredActions,
              };
            }
            
            // For all other requirements, use original analysis data
            return {
              ...req,
              status: analysisData?.status || 'missing',
              detected: analysisData?.detected || '',
            };
          })
        }));

        if (analysis.pluginValidationError) return;

        console.log('=== DECISION POINT ===', {
          needsClarification: analysis.needsClarification,
          hasQuestions: analysis.questionsSequence?.length > 0,
          clarityScore: analysis.clarityScore,
          willShowQuestions: analysis.needsClarification && analysis.questionsSequence?.length > 0,
          willEnhanceDirectly: analysis.clarityScore >= 90
        });

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
        console.error('Initial processing error:', err);
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
    
  }, [
    initialPrompt, 
    shouldSkipAIProcessing, 
    projectState.originalPrompt, 
    projectState.conversationCompleted, 
    projectState.isInReviewMode, 
    restoredState?.enhancementComplete, 
    restoredState?.planApproved, 
    restoredState?.conversationCompleted, 
    restoredState?.originalPrompt,
    restoredState?.workflowPhase,
    addMessage, 
    startEnhancement,
    getServiceDisplayNames,
    getConnectedServiceKeys,
    user?.connectedPlugins
  ]);

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
      console.log('All questions completed - setting currentQuestionIndex to -1');
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
      originalPrompt: !!projectState.originalPrompt
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
      console.log('Starting auto-enhancement - all questions answered');
      
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
    startEnhancement
  ]);

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
    [projectState.isProcessingQuestion, projectState.isInReviewMode, proceedToNextQuestion, addMessage]
  );

  const handleCustomAnswer = useCallback(() => {
    // FIXED: Use customInputQuestionId instead of currentQuestionIndex
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
  ]);

  const handleChangeAnswer = useCallback((questionId: string) => {
    // Don't allow changes in review mode
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
  }, [projectState.isInReviewMode]);

  // FIXED: Simplified custom input handler
  const handleCustomInputChange = useCallback((questionId: string, value: string) => {
    console.log('handleCustomInputChange called:', { questionId, value, isEmpty: value === '' });
    
    if (value === '') {
      // User clicked "Custom Answer" button - open the input
      console.log('Opening custom input for question:', questionId);
      setProjectState((prev) => ({ 
        ...prev, 
        showingCustomInput: true,
        customInputQuestionId: questionId,
        customInputValue: ''
      }));
    } else {
      // User is typing - update the value
      console.log('Updating custom input value:', value);
      setProjectState((prev) => {
        // Only update if this is the currently active custom input
        if (prev.customInputQuestionId === questionId) {
          return { ...prev, customInputValue: value };
        }
        return prev;
      });
    }
  }, []);

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
      planApproved: true,
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
    handleCustomInputChange, // FIXED: New handler

    handleApproveEnhanced,
    handleUseOriginal,
    handleEditEnhanced,
    handleSaveEnhancedEdit,
    handleCancelEnhancedEdit,
  };
}