/**
 * useConversationalFlow Hook
 *
 * Main state management hook for the conversational agent builder.
 * Handles message flow, plugin connections, questions, and enhancement.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  ConversationalFlowState,
  UseConversationalFlowProps,
  UseConversationalFlowReturn,
  Message
} from '../types';
import { generateMessageId } from '../utils/messageFormatter';
import { calculateConfidence } from '../utils/confidenceCalculator';

export function useConversationalFlow({
  initialPrompt,
  restoredState,
  onStateChange,
  onComplete
}: UseConversationalFlowProps): UseConversationalFlowReturn {

  // Initialize state
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

  // Track if initial prompt has been processed
  const hasProcessedInitial = useRef(false);

  // Persist state changes
  useEffect(() => {
    if (onStateChange) {
      onStateChange(state);
    }
  }, [state, onStateChange]);

  // Auto-process initial prompt on mount
  useEffect(() => {
    if (initialPrompt && !hasProcessedInitial.current && state.messages.length === 0) {
      hasProcessedInitial.current = true;
      handleInitialPrompt(initialPrompt);
    }
  }, [initialPrompt]);

  // Message management
  const addMessage = useCallback((message: Omit<Message, 'id' | 'timestamp'>) => {
    setState(prev => ({
      ...prev,
      messages: [
        ...prev.messages,
        {
          ...message,
          id: generateMessageId(),
          timestamp: new Date()
        }
      ]
    }));
  }, []);

  // Update confidence score
  const updateConfidence = useCallback(() => {
    setState(prev => ({
      ...prev,
      confidenceScore: calculateConfidence(prev)
    }));
  }, []);

  // ==========================================
  // STAGE 1: INITIAL PROMPT & CLARITY ANALYSIS
  // ==========================================

  const handleInitialPrompt = useCallback(async (prompt: string) => {
    console.log('🚀 Starting conversational flow with prompt:', prompt);

    // Add user message
    addMessage({
      type: 'user',
      content: prompt
    });

    setState(prev => ({
      ...prev,
      isProcessing: true,
      originalPrompt: prompt
    }));

    try {
      // TODO: Implement Phase 1 - Clarity Analysis
      // For now, simulate a response
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Add AI response
      addMessage({
        type: 'ai',
        messageType: 'text',
        content: 'Got it! Let me analyze your request...'
      });

      // Simulate detecting missing plugins
      setState(prev => ({
        ...prev,
        currentStage: 'plugins',
        missingPlugins: ['gmail', 'slack'], // TODO: Get from API
        confidenceScore: 45,
        isProcessing: false
      }));

      // Add plugin warning message
      addMessage({
        type: 'ai',
        messageType: 'plugin_warning',
        data: {
          missingPlugins: ['gmail', 'slack']
        }
      });

    } catch (error) {
      console.error('Error in handleInitialPrompt:', error);
      setState(prev => ({ ...prev, isProcessing: false }));

      addMessage({
        type: 'ai',
        messageType: 'text',
        content: 'Sorry, something went wrong. Please try again.'
      });
    }
  }, [addMessage]);

  // ==========================================
  // STAGE 2: PLUGIN CONNECTION
  // ==========================================

  const handlePluginConnected = useCallback(async (pluginKey: string) => {
    console.log('🔌 Plugin connected:', pluginKey);

    // Remove from missing, add to connected
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
      content: `✓ ${pluginKey.charAt(0).toUpperCase() + pluginKey.slice(1)} connected successfully!`
    });

    // Check if all plugins connected
    const remaining = state.missingPlugins.filter(p => p !== pluginKey);
    if (remaining.length === 0) {
      addMessage({
        type: 'ai',
        messageType: 'text',
        content: 'Great! Now let me ask a few questions to make sure I build exactly what you need...'
      });

      // TODO: Trigger Phase 2 - Generate Questions
      await handleGenerateQuestions();
    }
  }, [state.missingPlugins, addMessage]);

  // ==========================================
  // STAGE 3: CLARIFICATION QUESTIONS
  // ==========================================

  const handleGenerateQuestions = useCallback(async () => {
    console.log('❓ Generating clarification questions');

    setState(prev => ({ ...prev, isProcessing: true }));

    try {
      // TODO: Call Phase 2 API
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Simulate questions
      const mockQuestions = [
        {
          id: 'q1',
          question: 'Which Slack channel should I send the emails to?',
          type: 'select' as const,
          options: [
            { value: '#general', label: '#general' },
            { value: '#team-updates', label: '#team-updates' },
            { value: '#engineering', label: '#engineering' }
          ]
        }
      ];

      setState(prev => ({
        ...prev,
        currentStage: 'questions',
        questionsSequence: mockQuestions,
        currentQuestionIndex: 0,
        confidenceScore: calculateConfidence({
          ...prev,
          questionsSequence: mockQuestions
        }),
        isProcessing: false
      }));

      // Add first question
      addMessage({
        type: 'ai',
        messageType: 'clarification_question',
        data: {
          question: mockQuestions[0],
          questionNumber: 1,
          totalQuestions: mockQuestions.length
        }
      });

    } catch (error) {
      console.error('Error generating questions:', error);
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [addMessage]);

  const handleAnswerQuestion = useCallback(async (questionId: string, answer: string) => {
    console.log('✅ Question answered:', questionId, answer);

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

    // Add user answer
    addMessage({
      type: 'user',
      content: answer,
      isQuestionAnswer: true
    });

    // Add completion notification
    addMessage({
      type: 'system',
      messageType: 'system_notification',
      content: 'Question answered'
    });

    // Check if more questions
    const nextIndex = state.currentQuestionIndex + 1;
    if (nextIndex < state.questionsSequence.length) {
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
      // All questions answered
      await handleGenerateEnhancedPrompt(newAnswers);
    }
  }, [state.clarificationAnswers, state.currentQuestionIndex, state.questionsSequence, addMessage]);

  // ==========================================
  // STAGE 4: ENHANCED PROMPT GENERATION
  // ==========================================

  const handleGenerateEnhancedPrompt = useCallback(async (answers: Record<string, string>) => {
    console.log('✨ Generating enhanced prompt');

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
      // TODO: Call Phase 3 API
      await new Promise(resolve => setTimeout(resolve, 1500));

      const mockEnhancedPrompt = `This automation will check your Gmail inbox daily and send the top 3 emails to your Slack #general channel.

**Step 1: Email Collection**
Every morning at 8:00 AM, the system will use Gmail's search functionality to retrieve unread emails from the last 24 hours.

**Step 2: Ranking & Selection**
The emails will be ranked by importance based on sender priority and urgency keywords. The top 3 will be selected.

**Step 3: Slack Notification**
A formatted message containing the email sender, subject, and preview will be sent to your #general Slack channel.

**Error Handling**
If Gmail is unavailable, the system will retry once after 5 minutes. If Slack fails, an email notification will be sent to you directly.`;

      setState(prev => ({
        ...prev,
        enhancedPrompt: mockEnhancedPrompt,
        confidenceScore: 95,
        isProcessing: false
      }));

      addMessage({
        type: 'ai',
        messageType: 'enhanced_prompt_review',
        data: {
          enhancedPlan: mockEnhancedPrompt
        }
      });

    } catch (error) {
      console.error('Error generating enhanced prompt:', error);
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [addMessage]);

  // ==========================================
  // STAGE 5: REVIEW & ACCEPTANCE
  // ==========================================

  const handleAcceptPrompt = useCallback(async () => {
    console.log('🎉 Prompt accepted');

    setState(prev => ({
      ...prev,
      confidenceScore: 100,
      currentStage: 'accepted'
    }));

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
  }, [state.enhancedPrompt, state.clarificationAnswers, addMessage, onComplete]);

  const handleRevisePrompt = useCallback(async () => {
    console.log('🔄 Revising prompt');

    addMessage({
      type: 'ai',
      messageType: 'text',
      content: 'Sure! Please describe what you\'d like to change...'
    });

    setState(prev => ({
      ...prev,
      currentStage: 'questions' // Allow user to provide feedback
    }));
  }, [addMessage]);

  // ==========================================
  // GENERIC MESSAGE HANDLER
  // ==========================================

  const handleSendMessage = useCallback(async (message: string) => {
    console.log('💬 User sent message:', message);

    addMessage({
      type: 'user',
      content: message
    });

    // Handle based on current stage
    if (state.currentStage === 'clarity' && !state.originalPrompt) {
      await handleInitialPrompt(message);
    } else if (state.currentStage === 'review') {
      // Handle revision request
      // TODO: Call revision API
      addMessage({
        type: 'ai',
        messageType: 'text',
        content: 'I understand. Let me update the plan based on your feedback...'
      });
    }
  }, [state.currentStage, state.originalPrompt, addMessage, handleInitialPrompt]);

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
    handleRevisePrompt,
    handleSendMessage,
  };
}
