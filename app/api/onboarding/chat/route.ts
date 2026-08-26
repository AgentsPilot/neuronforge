/**
 * Onboarding Chat API
 * POST - Process user messages during onboarding conversation
 *
 * This endpoint:
 * 1. Loads or initializes conversation state from onboarding_conversations table
 * 2. Processes user message using OnboardingConversationManager
 * 3. Persists state snapshots in metadata JSONB for multi-session support
 * 4. Returns AI response with suggestions and updated state
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { OnboardingConversationManager, OnboardingState, Language } from '@/lib/services/OnboardingConversationManager';
import { onboardingConfigurationService } from '@/lib/services/OnboardingConfigurationService';
import { z } from 'zod';

const logger = createLogger({ module: 'OnboardingChatAPI' });

const ChatRequestSchema = z.object({
  message: z.string().min(1, 'Message is required').max(2000),
  conversationId: z.string().uuid().optional(),
  language: z.enum(['en', 'he', 'es']).optional()
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Validate input
    const body = await request.json();
    const validationResult = ChatRequestSchema.safeParse(body);
    if (!validationResult.success) {
      requestLogger.warn({ errors: validationResult.error.flatten() }, 'Validation failed');
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: validationResult.error.flatten() },
        { status: 400 }
      );
    }

    const data = validationResult.data;
    const manager = new OnboardingConversationManager();

    // 3. Load existing conversation state or initialize new
    let currentState: OnboardingState;
    let messageSequence = 0;

    // Valid steps for the enhanced onboarding flow (with Q4 and Q5 smart questions)
    const VALID_STEPS = new Set([
      'language_selection',
      'business_story',
      'client_workflow',
      'service_details',
      'client_acquisition',  // Q4: How do clients find you?
      'client_tracking',     // Q5: How do you track clients?
      'preview',
      'preview_adjustment',
      'building',
      'complete',
    ]);

    // Always check for existing conversation data by user_id (not conversationId)
    // This ensures we pick up where we left off within the same session
    const { data: messages, error: fetchError } = await supabaseServer
      .from('onboarding_conversations')
      .select('message_sequence, metadata')
      .eq('user_id', user.id)
      .order('message_sequence', { ascending: false })
      .limit(1);

    if (fetchError) {
      requestLogger.error({ err: fetchError }, 'Failed to load conversation');
      throw fetchError;
    }

    if (messages && messages.length > 0) {
      const lastMessage = messages[0];
      messageSequence = lastMessage.message_sequence + 1;

      // Restore state from last snapshot
      if (lastMessage.metadata?.state_snapshot) {
        const restoredState = JSON.parse(lastMessage.metadata.state_snapshot);

        // Check if the restored state uses old step names (from previous onboarding flow)
        if (!VALID_STEPS.has(restoredState.currentStep)) {
          requestLogger.warn({
            userId: user.id,
            oldStep: restoredState.currentStep
          }, 'Detected old onboarding flow, clearing and starting fresh');

          // Delete ALL old conversation data and start fresh
          await supabaseServer
            .from('onboarding_conversations')
            .delete()
            .eq('user_id', user.id);

          // Reset message sequence since we cleared everything
          messageSequence = 0;

          // Initialize fresh state with the requested language
          currentState = manager.getInitialState(data.language || 'en');

          requestLogger.info({
            userId: user.id,
            language: currentState.language
          }, 'Starting fresh onboarding after clearing old data');
        } else {
          currentState = restoredState;
          requestLogger.info({
            userId: user.id,
            resumedStep: currentState.currentStep,
            language: currentState.language
          }, 'Resuming conversation');
        }
      } else {
        // Fallback if snapshot missing - use provided language
        currentState = manager.getInitialState(data.language || 'en');
      }
    } else {
      // No existing conversation - start fresh with provided language
      currentState = manager.getInitialState(data.language || 'en');
      requestLogger.info({
        userId: user.id,
        language: currentState.language
      }, 'Starting new onboarding conversation');
    }

    // 4. Store user message
    const { error: userMessageError } = await supabaseServer
      .from('onboarding_conversations')
      .insert({
        user_id: user.id,
        message_sequence: messageSequence,
        role: 'user',
        content: data.message,
        metadata: {
          state_snapshot: JSON.stringify(currentState),
          step: currentState.currentStep,
          language: currentState.language
        }
      });

    if (userMessageError) {
      requestLogger.error({ err: userMessageError }, 'Failed to store user message');
      throw userMessageError;
    }

    // 5. Process message with OnboardingConversationManager
    requestLogger.info({
      userId: user.id,
      currentStep: currentState.currentStep,
      message: data.message
    }, 'Processing onboarding message');

    const result = await manager.processUserMessage(user.id, data.message, currentState);

    // 6. Store assistant response
    const { error: assistantMessageError } = await supabaseServer
      .from('onboarding_conversations')
      .insert({
        user_id: user.id,
        message_sequence: messageSequence + 1,
        role: 'assistant',
        content: result.response,
        metadata: {
          state_snapshot: JSON.stringify(result.updatedState),
          step: result.updatedState.currentStep,
          language: result.updatedState.language,
          suggestions: result.suggestions || []
        }
      });

    if (assistantMessageError) {
      requestLogger.error({ err: assistantMessageError }, 'Failed to store assistant message');
      throw assistantMessageError;
    }

    // 7. Calculate progress (simplified 4-step flow)
    const totalSteps = 10;
    const stepsCompleted = calculateProgress(result.updatedState.currentStep);

    requestLogger.info({
      userId: user.id,
      newStep: result.updatedState.currentStep,
      showPreview: result.showPreview
    }, 'Onboarding message processed');

    // 8. Return response
    return NextResponse.json({
      success: true,
      response: result.response,
      suggestions: result.suggestions,
      multiSelect: result.multiSelect,  // Include multi-select flag for Q4
      currentStep: result.updatedState.currentStep,
      progress: {
        completed: stepsCompleted,
        total: totalSteps
      },
      showPreview: result.showPreview,
      conversationId: user.id, // Use user.id as conversation identifier
      previewData: result.showPreview ? {
        businessProfile: {
          ...result.updatedState.collectedData.businessProfile,
          // Add translated vertical display name for the UI
          verticalDisplayName: result.updatedState.collectedData.businessProfile?.vertical
            ? onboardingConfigurationService.getVerticalDisplayName(
                result.updatedState.collectedData.businessProfile.vertical,
                result.updatedState.language
              )
            : undefined
        },
        pipelineStages: result.updatedState.collectedData.pipelineStages,
        services: result.updatedState.collectedData.services,
        businessDescription: result.updatedState.collectedData.businessDescription,
        // Include full configuration for build API (contains online_presence_mode, payment_mode, etc.)
        configuration: result.updatedState.collectedData.configuration
      } : undefined
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Onboarding chat failed');
    return NextResponse.json(
      { success: false, error: 'Failed to process message' },
      { status: 500 }
    );
  }
}

/**
 * Calculate progress percentage based on current step
 * Updated for enhanced onboarding flow with Q4 and Q5 smart questions
 */
function calculateProgress(step: string): number {
  const stepProgress: Record<string, number> = {
    'language_selection': 1,
    'business_story': 2,
    'client_workflow': 3,
    'service_details': 4,
    'client_acquisition': 5,  // Q4: How do clients find you?
    'client_tracking': 6,     // Q5: How do you track clients?
    'preview': 7,
    'preview_adjustment': 7,
    'building': 9,
    'complete': 10,
  };

  return stepProgress[step] ?? 0;
}
