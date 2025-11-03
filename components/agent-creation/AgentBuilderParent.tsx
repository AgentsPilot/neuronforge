// components/agent-creation/AgentBuilderParent.tsx

import React, { useState, useEffect, useCallback } from 'react';
import ConversationalAgentBuilder from './ConversationalAgentBuilder';
import { ConversationalAgentBuilderV2 } from './conversational';
import SmartAgentBuilder from './SmartAgentBuilder/SmartAgentBuilder';
import { Agent } from './SmartAgentBuilder/types/agent';
import { useNewAgentCreationUI } from '@/lib/utils/featureFlags';

// Enhanced state interfaces with proper completion tracking
interface ConversationalState {
  originalPrompt: string;
  enhancedPrompt: string;
  requirements: any[];
  clarityScore: number;
  isReadyToBuild: boolean;
  enhancementComplete: boolean;
  userApproved: boolean;
  questionsSequence: any[];
  currentQuestionIndex: number;
  clarificationAnswers: Record<string, string>;
  showingCustomInput: boolean;
  customInputValue: string;
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
  messages?: any[];
  
  // NEW: Completion tracking
  workflowPhase: 'initial' | 'questions' | 'enhancement' | 'approval' | 'completed' | 'agent_created';
  conversationCompleted: boolean; // Questions + Enhancement done
  planApproved: boolean; // User approved the final plan
  agentCreated: boolean; // Agent successfully created
  agentId?: string;
  
  // Navigation state
  isInReviewMode?: boolean; // User is reviewing completed conversation
  allowNavigation?: boolean; // Can navigate between phases
  
  // Timestamps for tracking
  completedAt?: number;
  approvedAt?: number;
  createdAt?: number;
  lastUpdated?: number;
}

interface SmartBuilderState {
  agent: Agent | null;
  isEditing: boolean;
  editedAgent: Agent | null;
  sessionId: string;
  agentCreated: boolean;
  agentId?: string;
  lastUpdated?: number;
}

interface AgentBuilderParentProps {
  initialPrompt?: string;
  onComplete?: (agent: Agent) => void;
  onCancel?: () => void;
}

export default function AgentBuilderParent({
  initialPrompt,
  onComplete,
  onCancel
}: AgentBuilderParentProps) {
  // Storage keys
  const STORAGE_KEY_CONVERSATIONAL = 'agent_builder_conversational_state';
  const STORAGE_KEY_SMART = 'agent_builder_smart_state';
  const STORAGE_KEY_PHASE = 'agent_builder_current_phase';

  // Current phase and states
  const [currentPhase, setCurrentPhase] = useState<'conversational' | 'smart'>('conversational');
  const [conversationalState, setConversationalState] = useState<Partial<ConversationalState> | null>(null);
  const [smartBuilderState, setSmartBuilderState] = useState<Partial<SmartBuilderState> | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // FIXED: Add completion state to prevent flash
  const [isCompletingAgent, setIsCompletingAgent] = useState(false);

  // Clear all storage
  const clearAllStorage = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY_CONVERSATIONAL);
      localStorage.removeItem(STORAGE_KEY_SMART);
      localStorage.removeItem(STORAGE_KEY_PHASE);
      localStorage.removeItem('agent_builder_user_view_preference'); // NEW: Clear view preference
      console.log('✅ Cleared all storage');
    } catch (error) {
      console.error('❌ Error clearing storage:', error);
    }
  }, []);

  // Check if work is truly completed (not just in-progress)
  const isWorkCompleted = useCallback((state: Partial<ConversationalState>) => {
    if (!state) return false;
    
    return !!(
      state.conversationCompleted && 
      state.enhancedPrompt && 
      state.planApproved
    );
  }, []);

  // Check if agent is already created
  const isAgentCreated = useCallback((convState: Partial<ConversationalState>, smartState: Partial<SmartBuilderState>) => {
    return !!(
      (convState?.agentCreated && convState?.agentId) ||
      (smartState?.agentCreated && smartState?.agentId) ||
      smartState?.agent?.id
    );
  }, []);

  // Should we use existing work?
  const shouldUseExistingWork = useCallback((
    convState: Partial<ConversationalState>, 
    smartState: Partial<SmartBuilderState>,
    newPrompt?: string
  ) => {
    if (!convState) return false;

    // If different prompt, start fresh
    if (newPrompt && convState.originalPrompt) {
      const isSamePrompt = convState.originalPrompt.trim().toLowerCase() === newPrompt.trim().toLowerCase();
      if (!isSamePrompt) {
        console.log('🆕 Different prompt detected - starting fresh');
        return false;
      }
    }

    // Use existing work if it's completed or agent is created
    const hasCompletedWork = isWorkCompleted(convState);
    const hasCreatedAgent = isAgentCreated(convState, smartState || {});
    
    console.log('🔍 Work assessment:', {
      hasCompletedWork,
      hasCreatedAgent,
      workflowPhase: convState.workflowPhase,
      conversationCompleted: convState.conversationCompleted,
      planApproved: convState.planApproved
    });

    return hasCompletedWork || hasCreatedAgent;
  }, [isWorkCompleted, isAgentCreated]);

  // Initialize on mount
  useEffect(() => {
    if (isInitialized) return;

    console.log('🚀 Initializing AgentBuilderParent');

    try {
      // Load stored states
      const savedConversational = localStorage.getItem(STORAGE_KEY_CONVERSATIONAL);
      const savedSmart = localStorage.getItem(STORAGE_KEY_SMART);
      const savedPhase = localStorage.getItem(STORAGE_KEY_PHASE);

      let parsedConversational: Partial<ConversationalState> | null = null;
      let parsedSmart: Partial<SmartBuilderState> | null = null;

      if (savedConversational) {
        parsedConversational = JSON.parse(savedConversational);
        // Restore Set objects
        if (parsedConversational?.questionsWithVisibleOptions && Array.isArray(parsedConversational.questionsWithVisibleOptions)) {
          parsedConversational.questionsWithVisibleOptions = new Set(parsedConversational.questionsWithVisibleOptions);
        }
      }

      if (savedSmart) {
        parsedSmart = JSON.parse(savedSmart);
      }

      // NEW: Simple session-based fresh start detection
      // If we have stored data but it's from a different browser session, clear it
      const currentSessionKey = `session_${Date.now()}`;
      const lastSessionKey = localStorage.getItem('agent_builder_session_key');
      const sessionTimeout = 30 * 60 * 1000; // 30 minutes
      
      if (parsedConversational?.lastUpdated) {
        const timeSinceLastUpdate = Date.now() - parsedConversational.lastUpdated;
        const isStaleSession = timeSinceLastUpdate > sessionTimeout;
        
        if (isStaleSession && !initialPrompt) {
          console.log('🗑️ Clearing stale session data (older than 30 minutes)');
          clearAllStorage();
          localStorage.setItem('agent_builder_session_key', currentSessionKey);
          setCurrentPhase('conversational');
          setIsInitialized(true);
          return;
        }
      }

      // Clean URL if using existing work
      let finalInitialPrompt = initialPrompt;
      if (typeof window !== 'undefined' && initialPrompt) {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('prompt') && shouldUseExistingWork(parsedConversational, parsedSmart, initialPrompt)) {
          const url = new URL(window.location.href);
          url.searchParams.delete('prompt');
          window.history.replaceState({}, '', url.toString());
          finalInitialPrompt = undefined; // Don't use URL prompt for existing work
          console.log('🧹 Cleaned URL - using existing work');
        }
      }

      // Decision logic
      if (shouldUseExistingWork(parsedConversational, parsedSmart, finalInitialPrompt)) {
        console.log('📋 Using existing completed work');
        
        // CRITICAL FIX: Check user's explicit view preference
        const userViewPreference = localStorage.getItem('agent_builder_user_view_preference');
        const userExplicitlyChoseConversational = parsedConversational?.userExplicitlyChoseConversationalView;
        
        console.log('🔍 View preference check:', {
          userViewPreference,
          userExplicitlyChoseConversational,
          savedPhase,
          shouldRespectConversationalChoice: userViewPreference === 'conversational' || userExplicitlyChoseConversational
        });
        
        // Restore states
        setConversationalState({
          ...parsedConversational,
          isInReviewMode: true,
          allowNavigation: true
        });

        if (parsedSmart) {
          setSmartBuilderState(parsedSmart);
        }

        // Determine phase - RESPECT user's explicit choice to stay in conversational view
        const shouldShowSmart = (
          (savedPhase === 'smart' || 
           parsedConversational?.workflowPhase === 'completed' ||
           parsedConversational?.planApproved ||
           parsedSmart?.agent) &&
          // CRITICAL: Don't auto-switch to smart if user explicitly chose conversational
          userViewPreference !== 'conversational' &&
          !userExplicitlyChoseConversational
        );

        setCurrentPhase(shouldShowSmart ? 'smart' : 'conversational');
        
      } else if (finalInitialPrompt) {
        console.log('🆕 Starting new agent with prompt');
        clearAllStorage();
        setCurrentPhase('conversational');
        
      } else {
        console.log('⏸️ Waiting for user input');
        clearAllStorage();
        setCurrentPhase('conversational');
      }

    } catch (error) {
      console.error('❌ Initialization error:', error);
      clearAllStorage();
      setCurrentPhase('conversational');
    }

    setIsInitialized(true);
  }, [isInitialized, initialPrompt, shouldUseExistingWork, clearAllStorage]);

  // Save conversational state
  const handleConversationalStateChange = useCallback((state: Partial<ConversationalState>) => {
    try {
      const stateToStore = {
        ...state,
        questionsWithVisibleOptions: Array.from(state.questionsWithVisibleOptions || []),
        lastUpdated: Date.now()
      };
      
      localStorage.setItem(STORAGE_KEY_CONVERSATIONAL, JSON.stringify(stateToStore));
      setConversationalState(state);
      
      console.log('💾 Saved conversational state:', {
        workflowPhase: state.workflowPhase,
        conversationCompleted: state.conversationCompleted,
        planApproved: state.planApproved
      });
    } catch (error) {
      console.error('❌ Error saving conversational state:', error);
    }
  }, []);

  // Save smart builder state
  const handleSmartBuilderStateChange = useCallback((state: SmartBuilderState) => {
    try {
      const stateToStore = {
        ...state,
        lastUpdated: Date.now()
      };
      
      localStorage.setItem(STORAGE_KEY_SMART, JSON.stringify(stateToStore));
      setSmartBuilderState(state);
      
      console.log('💾 Saved smart builder state');
    } catch (error) {
      console.error('❌ Error saving smart builder state:', error);
    }
  }, []);

  // Handle prompt approval (transition to Smart Builder)
  const handlePromptApproved = useCallback((data: {
    prompt: string;
    promptType: 'original' | 'enhanced';
    clarificationAnswers: Record<string, string>;
  }) => {
    console.log('🚀 Prompt approved - transitioning to Smart Builder');
    
    try {
      // Update conversational state to mark as completed and approved
      const updatedConversationalState = {
        ...conversationalState,
        conversationCompleted: true,
        planApproved: true,
        userApproved: true,
        isReadyToBuild: true,
        workflowPhase: 'completed' as const,
        approvedAt: Date.now(),
        allowNavigation: true,
        enhancedPrompt: data.prompt,
        clarificationAnswers: data.clarificationAnswers
      };

      handleConversationalStateChange(updatedConversationalState);
      
      // Switch to smart builder
      setCurrentPhase('smart');
      localStorage.setItem(STORAGE_KEY_PHASE, 'smart');
      
    } catch (error) {
      console.error('❌ Error handling prompt approval:', error);
    }
  }, [conversationalState, handleConversationalStateChange]);

  // Handle back to conversational (review mode)
  const handleBackToConversational = useCallback(() => {
    console.log('🔙 Going back to conversational view (review mode)');
    
    setCurrentPhase('conversational');
    localStorage.setItem(STORAGE_KEY_PHASE, 'conversational');
    
    // CRITICAL FIX: Store explicit user preference to stay in conversational view
    localStorage.setItem('agent_builder_user_view_preference', 'conversational');
    
    // Mark as review mode
    if (conversationalState) {
      const reviewState = {
        ...conversationalState,
        isInReviewMode: true,
        allowNavigation: true,
        userExplicitlyChoseConversationalView: true // NEW: Track explicit choice
      };
      handleConversationalStateChange(reviewState);
    }
  }, [conversationalState, handleConversationalStateChange]);

  // Handle return to smart builder
  const handleReturnToSmartBuilder = useCallback(() => {
    console.log('🔄 Returning to Smart Builder');
    
    setCurrentPhase('smart');
    localStorage.setItem(STORAGE_KEY_PHASE, 'smart');
    
    // CRITICAL FIX: Clear the conversational view preference when user chooses to go to Smart Builder
    localStorage.removeItem('agent_builder_user_view_preference');
    
    // Update conversational state to remove conversational preference flags
    if (conversationalState) {
      const updatedState = {
        ...conversationalState,
        isInReviewMode: false,
        allowNavigation: true,
        userExplicitlyChoseConversationalView: false // Clear the flag
      };
      handleConversationalStateChange(updatedState);
    }
  }, [conversationalState, handleConversationalStateChange]);

  // FIXED: Handle agent creation with completion state
  const handleAgentCreated = useCallback((agent: Agent) => {
    console.log('🎉 Agent created successfully');
    
    // FIXED: Set completion flag immediately to prevent flash
    setIsCompletingAgent(true);
    
    try {
      // Mark agent as created in both states
      const finalConversationalState = {
        ...conversationalState,
        agentCreated: true,
        agentId: agent.id || agent.agent_name,
        workflowPhase: 'agent_created' as const,
        createdAt: Date.now()
      };

      const finalSmartState = {
        ...smartBuilderState,
        agentCreated: true,
        agentId: agent.id || agent.agent_name,
        agent
      };

      // Save final states (keep setTimeout for state persistence to support navigation)
      handleConversationalStateChange(finalConversationalState);
      handleSmartBuilderStateChange(finalSmartState);
      
      // Keep the setTimeout but completion flag prevents flash
      setTimeout(() => {
        clearAllStorage();
        setConversationalState(null);
        setSmartBuilderState(null);
        setIsInitialized(false);
        
        if (onComplete) {
          onComplete(agent);
        }
      }, 100);
      
    } catch (error) {
      console.error('❌ Error handling agent creation:', error);
      setIsCompletingAgent(false); // Reset on error
    }
  }, [conversationalState, smartBuilderState, handleConversationalStateChange, handleSmartBuilderStateChange, clearAllStorage, onComplete]);

  // Handle cancellation
  const handleCancel = useCallback(() => {
    console.log('❌ Agent builder cancelled');
    
    clearAllStorage();
    setConversationalState(null);
    setSmartBuilderState(null);
    setIsInitialized(false);
    
    if (onCancel) {
      onCancel();
    }
  }, [clearAllStorage, onCancel]);

  // FIXED: Show completion screen during agent creation
  if (isCompletingAgent) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Agent created successfully! Redirecting...</p>
        </div>
      </div>
    );
  }

  // Wait for initialization
  if (!isInitialized) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading agent builder...</p>
        </div>
      </div>
    );
  }

  // Determine what to show
  const shouldShowSmartBuilder = (
    currentPhase === 'smart' && 
    conversationalState?.planApproved
  );

  console.log('🎯 Rendering decision:', {
    currentPhase,
    shouldShowSmartBuilder,
    planApproved: conversationalState?.planApproved,
    hasAgent: !!smartBuilderState?.agent,
    isInReviewMode: conversationalState?.isInReviewMode,
    isCompletingAgent
  });

  if (shouldShowSmartBuilder) {
    return (
      <SmartAgentBuilder
        prompt={conversationalState?.enhancedPrompt || conversationalState?.originalPrompt || ''}
        promptType="enhanced"
        clarificationAnswers={conversationalState?.clarificationAnswers || {}}
        onAgentCreated={handleAgentCreated}
        onBack={handleBackToConversational}
        onCancel={handleCancel}
        restoredAgent={smartBuilderState?.agent}
        sessionId={smartBuilderState?.sessionId}
        onStateChange={handleSmartBuilderStateChange}
      />
    );
  }

  // Show conversational builder
  const useNewUI = useNewAgentCreationUI();

  return useNewUI ? (
    <ConversationalAgentBuilderV2
      initialPrompt={conversationalState?.isInReviewMode ? undefined : initialPrompt}
      onPromptApproved={handlePromptApproved}
      onCancel={handleCancel}
      restoredState={conversationalState}
      onStateChange={handleConversationalStateChange}
    />
  ) : (
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