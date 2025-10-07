import { useState, useCallback, MutableRefObject } from 'react';
import {
  ProjectState,
  ClarityAnalysis,
  ClarificationQuestion,
  RequirementItem,
} from './types';

interface UseProjectStateParams {
  restoredState?: Partial<ProjectState>;
  sessionId: string;
  agentId: string;
  user: any;
  userLoading: boolean;
  hasProcessedInitialPrompt: MutableRefObject<boolean>;
  isInitialized: MutableRefObject<boolean>;
  enhancementStarted: MutableRefObject<boolean>;
}

export function useProjectState({
  restoredState,
  sessionId,
  agentId,
  user,
  userLoading,
  hasProcessedInitialPrompt,
  isInitialized,
  enhancementStarted,
}: UseProjectStateParams) {
  
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
      sessionId: sessionId,
      agentId: agentId,
      
      // Completion tracking
      conversationCompleted: false,
      planApproved: false,
      workflowPhase: 'initial',
      isInReviewMode: false,
      allowNavigation: false,
    };

    if (restoredState) {
      console.log('Restoring project state with CONSISTENT agent ID:', {
        workflowPhase: restoredState.workflowPhase,
        conversationCompleted: restoredState.conversationCompleted,
        planApproved: restoredState.planApproved,
        isInReviewMode: restoredState.isInReviewMode,
        agentId: agentId,
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
        sessionId: sessionId,
        agentId: agentId,
        questionsWithVisibleOptions: new Set(restoredState.questionsSequence?.map((q) => q.id) || []),
        isInitialized: true,
      };
    } else {
      enhancementStarted.current = false;
    }
    
    return defaultState;
  });

  // Utility to get plugin display names with proper fallback hierarchy
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

  // Get connected service keys with proper fallback
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

  // Update requirements from analysis
  const updateRequirementsFromAnalysis = useCallback((analysis: ClarityAnalysis, addMessage?: any) => {
    console.log('🔍 Updating requirements from analysis');

    // Handle plugin warnings from analysis - but DON'T add message here
    // The message should be added by the calling component
    if (analysis.pluginWarning) {
      console.log('Analysis contains plugin warning:', analysis.pluginWarning.message);
      
      setProjectState((prev) => ({
        ...prev,
        missingPlugins: analysis.pluginWarning?.missingServices || [],
        pluginWarning: analysis.pluginWarning
      }));
    }

    // Update requirements with analysis data
    const connectedServiceKeys = getConnectedServiceKeys(analysis);
    setProjectState((prev) => ({
      ...prev,
      requirements: prev.requirements.map(req => {
        const analysisData = (analysis.analysis as any)?.[req.id];
        
        // Special handling for actions: Filter out unconnected services
        if (req.id === 'actions' && analysisData?.detected && analysis.pluginWarning?.missingServices) {
          const serviceDisplayNames = getServiceDisplayNames(connectedServiceKeys, analysis.connectedPluginData);
          const filteredActions = connectedServiceKeys.length > 0 
            ? `Summarize and save to ${serviceDisplayNames.join(', ')}`
            : 'Actions require service connections';
          
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
      }),
      clarityScore: analysis.clarityScore || 50
    }));
  }, [getConnectedServiceKeys, getServiceDisplayNames]);

  // Update requirements from answers
  const updateRequirementsFromAnswers = useCallback(
    (answers: Record<string, string>, questionsSequence: ClarificationQuestion[]) => {
      setProjectState((prev) => {
        console.log('🔄 Updating requirements from answers:', {
          answersCount: Object.keys(answers).length,
          questionsCount: questionsSequence.length,
        });

        const updatedRequirements = prev.requirements.map((req) => {
          // Map question dimensions to requirement IDs
          const dimensionMapping: Record<string, string> = {
            'data_input': 'data',
            'data': 'data',
            'processing_logic': 'output',
            'output': 'output',
            'output_actions': 'delivery',
            'delivery': 'delivery',
            'actions': 'actions',
            'timing': 'timing',
            'scheduling_timing': 'timing',
            'error_handling': 'error_handling'
          };

          // Find questions that map to this requirement
          const relevantAnswers = Object.entries(answers).filter(([questionId, answer]) => {
            const question = questionsSequence.find((q) => q.id === questionId);
            if (!question) return false;
            
            const mappedRequirementId = dimensionMapping[question.dimension || ''] || question.dimension;
            return mappedRequirementId === req.id;
          });

          if (relevantAnswers.length > 0) {
            const answerText = relevantAnswers.map(([_, answer]) => answer).join(', ');
            console.log(`✅ Updated requirement ${req.id} with: ${answerText.slice(0, 100)}`);
            return { ...req, status: 'clear' as const, detected: answerText };
          }

          // Special handling for timing from scheduling questions
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

          // Special mapping for actions requirement based on connected services
          if (req.id === 'actions') {
            const connectedServiceKeys = getConnectedServiceKeys();
            const serviceDisplayNames = getServiceDisplayNames(connectedServiceKeys);
            
            if (serviceDisplayNames.length > 0) {
              const actionsText = `Read emails, Summarize content, Send to manager using ${serviceDisplayNames.join(', ')}`;
              return { ...req, status: 'clear' as const, detected: actionsText };
            }
          }

          return req;
        });

        const newClarityScore = recalculateClarityScore(updatedRequirements);
        
        console.log('📊 Requirements update complete:', {
          clarityScore: newClarityScore
        });
        
        return { 
          ...prev, 
          requirements: updatedRequirements, 
          clarityScore: newClarityScore, 
          isReadyToBuild: newClarityScore >= 80 
        };
      });
    },
    [recalculateClarityScore, getConnectedServiceKeys, getServiceDisplayNames]
  );

  return {
    projectState,
    setProjectState,
    updateRequirementsFromAnalysis,
    updateRequirementsFromAnswers,
    shouldSkipAIProcessing,
    getServiceDisplayNames,
    getConnectedServiceKeys,
  };
}