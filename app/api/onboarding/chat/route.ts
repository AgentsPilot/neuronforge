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
import {
  OnboardingConversationManager,
  ONBOARDING_STEPS,
  OnboardingState,
  Language,
} from '@/lib/services/OnboardingConversationManager';
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
        // A step this build does not recognise means the conversation was
        // started by an older version of the flow, and its state cannot be
        // resumed. Read from the state machine rather than a copy kept here:
        // this file used to hold its own list, so adding a question to the
        // conversation silently made every conversation in flight look invalid
        // — the user answered it and was thrown back to the first question, in
        // English, with everything they had said discarded.
        if (!ONBOARDING_STEPS.has(restoredState.currentStep)) {
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
      // The live setup picture, on every turn.
      setup: readSetupSignals(result.updatedState.collectedData, result.updatedState.currentStep),
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
 * What the conversation knows so far, in the shape the setup chain reads.
 *
 * Sent on every turn rather than only at the preview, because the panel beside
 * the chat is the point: the user watches their setup assemble while they
 * answer, instead of being shown a summary card once the questions are over.
 *
 * Every field may be null. A step whose rule depends on an unanswered question
 * is drawn as a ghost — visible as something coming, never claimed either way.
 */
function readSetupSignals(collected: any, currentStep: string) {
  const services: Array<{ price?: number | null; collection?: string | null }> =
    collected?.clientWorkflow?.services || collected?.services || [];

  const hasPricedServices = services.length > 0
    ? services.some(service => (service.price ?? 0) > 0)
    : null;

  /**
   * How money reaches this business, summarised from what its services say.
   *
   * The chat no longer asks — a single answer could not describe a practice
   * that takes a card for a session and invoices for a programme. The panel
   * still wants one word for its money node, so it is read back off the
   * services rather than from an answer nobody gave.
   */
  const collection = ((): string | null => {
    const priced = services.filter(service => (service.price ?? 0) > 0);
    if (priced.length === 0) return services.length > 0 ? 'none' : null;

    const online = priced.some(service => service.collection === 'online');
    const billed = priced.some(service => service.collection !== 'online');
    if (online && billed) return 'mixed';
    if (online) return 'card_online';
    return 'invoice';
  })();

  const presence = collected?.configuration?.online_presence_mode
    ?? (collected?.clientAcquisition?.needs_website === true
      ? 'full_website'
      : collected?.clientAcquisition?.needs_website === false
        ? 'booking_only'
        : null);

  // What the build will create, so the panel can say how much of this the
  // platform does rather than the person.
  const willProvision: string[] = [];
  if (services.length > 0) willProvision.push('services');
  if (collected?.pipelineStages?.length) willProvision.push('clients');
  if (presence) willProvision.push('reach');

  return {
    // What the conversation has actually learned, in the order it asks.
    business: collected?.businessProfile?.company_name || collected?.businessStory?.company_name || null,
    servicesCount: services.length,
    hasPricedServices,
    collection,
    presence,
    tracksClients: collected?.clientTracking?.current_method != null
      || (collected?.pipelineStages?.length || 0) > 0,
    currentStep,
    willProvision,
  };
}

/**
 * Calculate progress percentage based on current step
 * Updated for enhanced onboarding flow with Q4 and Q5 smart questions
 */
function calculateProgress(step: string): number {
  const stepProgress: Record<string, number> = {
    'language_selection': 1,
    'business_name': 2,
    'business_story': 2,
    'client_workflow': 3,
    'service_details': 4,
    'payment_collection': 5,  // How does the money reach you?
    'client_acquisition': 5,  // Q4: How do clients find you?
    'client_tracking': 6,     // Q5: How do you track clients?
    'preview': 7,
    'preview_adjustment': 7,
    'building': 9,
    'complete': 10,
  };

  return stepProgress[step] ?? 0;
}
