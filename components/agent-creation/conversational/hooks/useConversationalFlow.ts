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
import { useThreadManagement } from './useThreadManagement';
import { useAuth } from '@/components/UserProvider';
import { getPluginAPIClient } from '@/lib/client/plugin-api-client';

export function useConversationalFlow({
  initialPrompt,
  restoredState,
  onStateChange,
  onComplete
}: UseConversationalFlowProps): UseConversationalFlowReturn {

  // Auth context for user info (needed for OAuth)
  const { user } = useAuth();

  // Thread management
  const { useThreadFlow, initializeThread, processMessageInThread } = useThreadManagement();

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
      // Add AI thinking message
      addMessage({
        type: 'ai',
        messageType: 'text',
        content: 'Got it! Let me analyze your request...'
      });

      // Initialize thread if using thread-based flow
      if (useThreadFlow) {
        await initializeThread();
      }

      // Phase 1: Clarity Analysis
      const phase1Result = useThreadFlow
        ? await processMessageInThread(1, prompt)
        : await fallbackPhase1Analysis(prompt);

      console.log('Phase 1 result:', phase1Result);

      // Update confidence score
      const newConfidence = phase1Result.clarityScore || 45;

      // 🔌 Extract user's existing connected plugins from Phase 1 response
      const existingConnectedPlugins = phase1Result.connectedPlugins || [];
      console.log('✅ Phase 1 - User existing connected plugins:', existingConnectedPlugins);

      // 💬 Add conversational summary from LLM (or fallback)
      if (phase1Result.conversationalSummary) {
        // Use LLM-generated conversational summary
        addMessage({
          type: 'ai',
          messageType: 'text',
          content: phase1Result.conversationalSummary
        });
      } else {
        // Fallback: Build from analysis if LLM didn't provide conversationalSummary
        const analysis = phase1Result.analysis;
        const summaryParts: string[] = [];

        if (analysis?.trigger?.detected && analysis?.actions?.detected) {
          summaryParts.push(analysis.trigger.detected);
          summaryParts.push(`I'll ${analysis.actions.detected.toLowerCase()}`);
        }

        const fallbackSummary = summaryParts.length > 0
          ? `Here's what I understood: ${summaryParts.join(', ')}.`
          : "Let me understand what you need...";

        addMessage({
          type: 'ai',
          messageType: 'text',
          content: fallbackSummary
        });
      }

      // 📊 Add clarity context message
      const questionCount = phase1Result.suggestions?.length || 0;
      let clarityMessage = '';

      if (!phase1Result.needsClarification) {
        clarityMessage = "I'm completely clear on this! Let me create your automation plan... ✨";
      } else if (newConfidence > 70) {
        clarityMessage = `I'm feeling pretty confident (${newConfidence}% clear). Just ${questionCount} quick ${questionCount === 1 ? 'question' : 'questions'} to nail the details! 🎯`;
      } else if (newConfidence > 50) {
        clarityMessage = `I'm about ${newConfidence}% sure I understand. Let me ask ${questionCount} ${questionCount === 1 ? 'question' : 'questions'} to fill in the gaps.`;
      } else {
        clarityMessage = `I want to make sure I get this right. I have ${questionCount} ${questionCount === 1 ? 'question' : 'questions'} to clarify the details.`;
      }

      if (phase1Result.needsClarification) {
        addMessage({
          type: 'ai',
          messageType: 'text',
          content: clarityMessage
        });
      }

      // ⚠️ IMPORTANT: Do NOT show OAuth for Phase 1 missingPlugins!
      // Phase 1 is just a preliminary guess. Only Phase 3 triggers OAuth.
      if (phase1Result.missingPlugins && phase1Result.missingPlugins.length > 0) {
        console.log('ℹ️ Phase 1 detected missing plugins (informational only):', phase1Result.missingPlugins);
        // Store for reference, but don't show OAuth cards
        setState(prev => ({
          ...prev,
          missingPlugins: phase1Result.missingPlugins || [],
          connectedPlugins: existingConnectedPlugins, // Store existing plugins from backend
          confidenceScore: newConfidence,
          isProcessing: false
        }));
      } else {
        setState(prev => ({
          ...prev,
          connectedPlugins: existingConnectedPlugins, // Store existing plugins from backend
          confidenceScore: newConfidence,
          isProcessing: false
        }));
      }

      // Always proceed to questions (Phase 2) after Phase 1
      await handleGenerateQuestions(prompt);

    } catch (error: any) {
      console.error('Error in handleInitialPrompt:', error);
      setState(prev => ({ ...prev, isProcessing: false }));

      addMessage({
        type: 'ai',
        messageType: 'text',
        content: `Sorry, something went wrong: ${error.message}. Please try again.`
      });
    }
  }, [addMessage, useThreadFlow, initializeThread, processMessageInThread]);

  // Fallback for non-thread-based flow
  const fallbackPhase1Analysis = async (_prompt: string) => {
    // Mock response for legacy flow
    return {
      success: true,
      phase: 1 as const,
      clarityScore: 45,
      missingPlugins: ['gmail', 'slack'],
      needsClarification: true,
      connectedPlugins: [], // Mock: no connected plugins in fallback
      suggestions: ['Connect Gmail', 'Connect Slack'],
      conversationalSummary: 'You want to send emails to Slack! Let me help you set this up. 📧💬',
      analysis: {
        trigger: { detected: 'New emails', status: 'detected' as const },
        data: { detected: 'Gmail', status: 'detected' as const },
        actions: { detected: 'Send to Slack', status: 'detected' as const },
        output: { detected: 'Slack message', status: 'detected' as const }
      }
    };
  };

  // ==========================================
  // STAGE 2: PLUGIN CONNECTION
  // ==========================================

  const handlePluginConnected = useCallback(async (pluginKey: string) => {
    if (!user?.id) {
      console.error('❌ No user ID available for OAuth');
      addMessage({
        type: 'ai',
        messageType: 'text',
        content: 'Error: User not authenticated. Please refresh and try again.'
      });
      return;
    }

    console.log('🔌 Starting OAuth flow for plugin:', pluginKey);

    // Set connecting state
    setState(prev => ({
      ...prev,
      connectingPlugin: pluginKey
    }));

    try {
      // Real OAuth flow using PluginAPIClient
      const pluginClient = getPluginAPIClient();
      const result = await pluginClient.connectPlugin(user.id, pluginKey);

      if (!result.success) {
        throw new Error(result.error || 'Failed to connect plugin');
      }

      console.log('✅ OAuth successful for:', pluginKey);

      // Calculate updated values from current state
      let updatedConnectedPlugins: string[] = [];
      let shouldProceedToPhase3 = false;
      let currentAnswers: Record<string, string> = {};
      let currentStage: string = '';

      // Update state with successful connection
      setState(prev => {
        const newMissing = prev.missingPlugins.filter(p => p !== pluginKey);
        const newConnected = [...prev.connectedPlugins, pluginKey];

        // Capture values for use after setState
        updatedConnectedPlugins = newConnected;
        shouldProceedToPhase3 = newMissing.length === 0 && prev.currentStage === 'plugins';
        currentAnswers = prev.clarificationAnswers;
        currentStage = prev.currentStage;

        console.log('🔌 Updated connected plugins:', newConnected);
        console.log('📊 State before connection - connectedPlugins:', prev.connectedPlugins);
        console.log('📊 State after connection - connectedPlugins:', newConnected);

        return {
          ...prev,
          missingPlugins: newMissing,
          connectedPlugins: newConnected,
          connectingPlugin: null,
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
        messageType: 'system_notification',
        content: `${pluginKey.charAt(0).toUpperCase() + pluginKey.slice(1)} connected successfully!`
      });

      // Check if all plugins connected and ready to proceed
      if (shouldProceedToPhase3) {
        console.log('✅ All plugins connected! Current stage:', currentStage);

        addMessage({
          type: 'ai',
          messageType: 'text',
          content: 'Perfect! All services are connected. Let me generate your automation plan...'
        });

        // Re-run Phase 3 with all plugins connected
        console.log('🔌 Re-running Phase 3 with all connected plugins:', updatedConnectedPlugins);
        await handleGenerateEnhancedPrompt(currentAnswers, updatedConnectedPlugins);
      }

    } catch (error: any) {
      console.error('❌ OAuth failed for', pluginKey, ':', error);

      // Reset connecting state
      setState(prev => ({
        ...prev,
        connectingPlugin: null
      }));

      // Show error message
      addMessage({
        type: 'ai',
        messageType: 'text',
        content: `Failed to connect ${pluginKey}: ${error.message}. Please try again or skip this plugin.`
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, addMessage]);

  const handlePluginSkipped = useCallback(async (pluginKey: string) => {
    console.log('⏭️ Plugin skipped:', pluginKey);

    addMessage({
      type: 'ai',
      messageType: 'text',
      content: `I understand you can't connect ${pluginKey} right now. Let me see if I can adjust the plan...`
    });

    // Remove from missing plugins list
    setState(prev => ({
      ...prev,
      missingPlugins: prev.missingPlugins.filter(p => p !== pluginKey),
      isProcessing: true
    }));

    try {
      // Build list of all declined plugins (existing + new one)
      // Note: We could track declined plugins in state, but for now we'll just pass the current one
      const declinedPlugins = [pluginKey];

      // Re-call Phase 3 with declined_plugins metadata
      console.log('🔄 Re-calling Phase 3 with declined plugins:', declinedPlugins);

      await handleGenerateEnhancedPrompt(
        state.clarificationAnswers,
        state.connectedPlugins,
        { declined_plugins: declinedPlugins }
      );

      // The Phase 3 response will handle three scenarios:
      // 1. LLM adjusted workflow (using alternative plugin)
      // 2. LLM says workflow can proceed without it
      // 3. LLM says this plugin is essential (returns error or blocks)

    } catch (error: any) {
      console.error('❌ Error handling skipped plugin:', error);

      setState(prev => ({
        ...prev,
        isProcessing: false
      }));

      addMessage({
        type: 'ai',
        messageType: 'text',
        content: `Sorry, I encountered an error while adjusting the plan: ${error.message}`
      });
    }
  }, [state.clarificationAnswers, state.connectedPlugins, addMessage]);

  // ==========================================
  // STAGE 3: CLARIFICATION QUESTIONS
  // ==========================================

  const handleGenerateQuestions = useCallback(async (prompt?: string) => {
    console.log('❓ Generating clarification questions');

    setState(prev => ({ ...prev, isProcessing: true }));

    try {
      // Phase 2: Generate Questions
      const userPrompt = prompt || state.originalPrompt;
      const phase2Result = useThreadFlow
        ? await processMessageInThread(2, userPrompt, undefined, undefined, state.connectedPlugins)
        : await fallbackPhase2Questions(userPrompt);

      console.log('Phase 2 result:', phase2Result);

      const questions = phase2Result.questionsSequence || [];

      setState(prev => ({
        ...prev,
        currentStage: 'questions',
        questionsSequence: questions,
        currentQuestionIndex: 0,
        confidenceScore: phase2Result.clarityScore || calculateConfidence({
          ...prev,
          questionsSequence: questions
        }),
        isProcessing: false
      }));

      // 💬 Add Phase 2 conversational summary (if provided by LLM)
      if (phase2Result.conversationalSummary) {
        addMessage({
          type: 'ai',
          messageType: 'text',
          content: phase2Result.conversationalSummary
        });
      } else if (questions.length > 0) {
        // Fallback: Create a friendly transition message
        const questionCount = questions.length;
        const fallbackMessage = questionCount === 1
          ? "Just one quick question to clarify..."
          : `I have ${questionCount} quick questions to make sure I get this right...`;

        addMessage({
          type: 'ai',
          messageType: 'text',
          content: fallbackMessage
        });
      }

      // Add first question if any
      if (questions.length > 0) {
        addMessage({
          type: 'ai',
          messageType: 'clarification_question',
          data: {
            question: questions[0],
            questionNumber: 1,
            totalQuestions: questions.length
          }
        });
      } else {
        // No questions needed, go straight to enhancement
        addMessage({
          type: 'ai',
          messageType: 'text',
          content: 'Your request is clear! Let me create your automation plan...'
        });

        await handleGenerateEnhancedPrompt({});
      }

    } catch (error: any) {
      console.error('Error generating questions:', error);
      setState(prev => ({ ...prev, isProcessing: false }));

      addMessage({
        type: 'ai',
        messageType: 'text',
        content: `Failed to generate questions: ${error.message}`
      });
    }
  }, [addMessage, useThreadFlow, processMessageInThread, state.originalPrompt, state.connectedPlugins]);

  // Fallback for non-thread-based flow
  const fallbackPhase2Questions = async (_prompt: string) => {
    // Mock response for legacy flow
    return {
      success: true,
      phase: 2,
      clarityScore: 65,
      conversationalSummary: "Nice! I'm getting a clearer picture. Let me ask you a quick question to nail down the details. 🎯",
      questionsSequence: [
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
      ]
    };
  };

  const handleAnswerQuestion = useCallback(async (questionId: string, answer: string, displayLabel?: string) => {
    console.log('✅ Question answered:', questionId, answer, displayLabel);

    // Save answer (value for backend)
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

    // Add user answer (display label if provided, otherwise use value)
    addMessage({
      type: 'user',
      content: displayLabel || answer,
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

  const handleGenerateEnhancedPrompt = useCallback(async (
    answers: Record<string, string>,
    connectedPluginsList?: string[], // Optional: override with latest connected plugins
    metadata?: { declined_plugins?: string[]; [key: string]: any } // Optional: metadata for declined plugins
  ) => {
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
      // Build full prompt with clarifications
      const fullPrompt = Object.keys(answers).length > 0
        ? `${state.originalPrompt}\n\nClarification details:\n${Object.entries(answers)
            .map(([q, a]) => `- ${q}: ${a}`)
            .join('\n')}`
        : state.originalPrompt;

      // Use provided connectedPluginsList or fall back to state
      const pluginsToUse = connectedPluginsList || state.connectedPlugins;
      console.log('🔌 Connected plugins being sent to Phase 3:', pluginsToUse);

      if (metadata?.declined_plugins) {
        console.log('⏭️ Declined plugins being sent to Phase 3:', metadata.declined_plugins);
      }

      // Phase 3: Generate Enhanced Prompt
      const phase3Result = useThreadFlow
        ? await processMessageInThread(3, fullPrompt, answers, undefined, pluginsToUse, metadata)
        : await fallbackPhase3Enhancement(fullPrompt, answers);

      console.log('Phase 3 result:', phase3Result);

      // ⚠️ CRITICAL: Check for missing plugins (OAuth gate)
      if (phase3Result.missingPlugins && phase3Result.missingPlugins.length > 0) {
        console.log('🔒 Phase 3 OAuth Gate: Missing plugins detected', phase3Result.missingPlugins);

        setState(prev => ({
          ...prev,
          missingPlugins: phase3Result.missingPlugins || [],
          currentStage: 'plugins',
          isProcessing: false
        }));

        // Show OAuth connection cards
        addMessage({
          type: 'ai',
          messageType: 'plugin_connection',
          missingPlugins: phase3Result.missingPlugins
        });

        return; // Stop here, wait for OAuth
      }

      // All plugins connected - proceed with enhanced prompt
      console.log('✅ Phase 3: All plugins connected, showing enhanced prompt');

      // Extract enhanced prompt from response
      const enhancedPromptText = phase3Result.enhanced_prompt?.plan_description ||
                                  phase3Result.enhanced_prompt ||
                                  'Enhanced automation plan created';

      setState(prev => ({
        ...prev,
        enhancedPrompt: enhancedPromptText,
        confidenceScore: 95,
        currentStage: 'review',
        isProcessing: false
      }));

      addMessage({
        type: 'ai',
        messageType: 'enhanced_prompt_review',
        data: {
          enhancedPrompt: phase3Result.enhanced_prompt || {
            plan_title: 'Automation Plan',
            plan_description: enhancedPromptText,
            sections: {
              data: '',
              processing_steps: [],
              output: '',
              delivery: '',
              error_handling: ''
            },
            specifics: {
              services_involved: [],
              user_inputs_required: [],
              trigger_scope: ''
            }
          },
          requiredServices: phase3Result.requiredServices || [],
          connectedPlugins: pluginsToUse || []
        }
      });

    } catch (error: any) {
      console.error('Error generating enhanced prompt:', error);
      setState(prev => ({ ...prev, isProcessing: false }));

      addMessage({
        type: 'ai',
        messageType: 'text',
        content: `Failed to generate plan: ${error.message}`
      });
    }
  }, [addMessage, useThreadFlow, processMessageInThread, state.originalPrompt, state.connectedPlugins]);

  // Fallback for non-thread-based flow
  const fallbackPhase3Enhancement = async (_prompt: string, _answers: Record<string, string>) => {
    // Mock response for legacy flow
    return {
      success: true,
      phase: 3,
      missingPlugins: [], // Mock: no missing plugins in fallback
      requiredServices: ['gmail', 'slack'],
      enhanced_prompt: {
        plan_title: 'Gmail to Slack Email Forwarder',
        plan_description: 'This automation will check your Gmail inbox daily and send the top 3 emails to your Slack channel.',
        sections: {
          data: 'Gmail inbox - unread emails from the last 24 hours',
          processing_steps: [
            'Every morning at 8:00 AM, the system will use Gmail\'s search functionality to retrieve unread emails from the last 24 hours.',
            'The emails will be ranked by importance based on sender priority and urgency keywords. The top 3 will be selected.',
            'A formatted message containing the email sender, subject, and preview will be sent to your Slack channel.'
          ],
          output: 'Formatted Slack message with email details',
          delivery: 'Posted to your designated Slack channel',
          error_handling: 'If Gmail is unavailable, the system will retry once after 5 minutes. If Slack fails, an email notification will be sent to you directly.'
        },
        specifics: {
          services_involved: ['gmail', 'slack'],
          user_inputs_required: ['Slack channel name', 'Email priority settings'],
          trigger_scope: 'Daily at 8:00 AM'
        }
      }
    };
  };

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
    handlePluginSkipped,
    handleAnswerQuestion,
    handleAcceptPrompt,
    handleRevisePrompt,
    handleSendMessage,
  };
}
