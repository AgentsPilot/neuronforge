/**
 * Business OS Chat API - AI-powered chat endpoint with intent parsing
 * POST /api/business-os/chat
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { parseIntent } from '@/lib/business-os/IntentParser';
import { executeIntent, ExecutorContext } from '@/lib/business-os/ChatCommandExecutor';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import type { PendingContext } from '@/lib/business-os/DraftManagerTypes';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';

const logger = createLogger({ module: 'BusinessOSChatAPI' });

// Chat message history schema
const chatHistoryMessageSchema = z.object({
  type: z.enum(['user', 'ai']),
  content: z.string(),
});

// Pending context schema for multi-turn conversations
const pendingContextSchema = z.object({
  intent: z.string(),
  entities: z.record(z.any()),
  missingFields: z.array(z.string()),
  awaitingConfirmation: z.boolean().optional(),
  confirmMessage: z.string().optional(),
  entityType: z.string().optional(),
  candidates: z.array(z.object({
    id: z.string(),
    name: z.string(),
    detail: z.string().optional(),
  })).optional(),
});

// Request validation schema
const chatRequestSchema = z.object({
  message: z.string().min(1).max(1000),
  history: z.array(chatHistoryMessageSchema).optional(), // Recent message history for conversation context
  pendingContext: pendingContextSchema.optional(), // Unified pending context for multi-turn
  context: z.object({
    currentPage: z.string().optional(),
    selectedItems: z.array(z.string()).optional(),
    previewContext: z.enum(['services', 'crm', 'reports', 'payments']).optional(),
    pendingAvailabilityDays: z.array(z.string()).optional(), // Legacy: Days from previous availability question
  }).optional(),
});

// Confirmation patterns in multiple languages
const CONFIRMATION_PATTERNS = {
  yes: ['yes', 'כן', 'yeah', 'yep', 'ok', 'okay', 'sure', 'confirm', 'create', 'add', 'book', 'אישור', 'כ', 'בטח', 'בסדר', 'אוקי'],
  no: ['no', 'לא', 'nope', 'cancel', 'never mind', 'ביטול', 'בטל', 'לא רוצה'],
};

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
    const validationResult = chatRequestSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { message, history, context, pendingContext } = validationResult.data;
    requestLogger.info({
      userId: user.id,
      messageLength: message.length,
      historyLength: history?.length || 0,
      hasPendingContext: !!pendingContext,
      awaitingConfirmation: pendingContext?.awaitingConfirmation,
    }, 'Processing chat message');

    // 3. Check if this is a confirmation/cancellation response
    const normalizedMessage = message.trim().toLowerCase();
    const isConfirmation = pendingContext?.awaitingConfirmation &&
      CONFIRMATION_PATTERNS.yes.some(p => normalizedMessage === p || normalizedMessage.startsWith(p + ' '));
    const isCancellation = pendingContext?.awaitingConfirmation &&
      CONFIRMATION_PATTERNS.no.some(p => normalizedMessage === p || normalizedMessage.startsWith(p + ' '));

    // 4. Fetch existing entities for context
    const [servicesResult, contactsResult] = await Promise.all([
      fetchExistingServices(user.id),
      fetchExistingContacts(user.id),
    ]);

    // 5. Handle confirmation/cancellation of pending context
    if (isConfirmation && pendingContext) {
      requestLogger.info({ intent: pendingContext.intent }, 'User confirmed pending action');

      // Execute the confirmed intent
      const confirmedIntent = {
        intent: pendingContext.intent as any,
        entities: { ...pendingContext.entities, _confirmed: true },
        confidence: 1.0,
        confirmRequired: false,
        rawText: message,
        language: pendingContext.entities._language, // Preserve language from pending context
      };

      const executorContext: ExecutorContext = {
        userId: user.id,
        existingServices: servicesResult,
        existingContacts: contactsResult,
        currentPreviewContext: context?.previewContext,
      };

      const result = await executeIntent(confirmedIntent, executorContext);

      return NextResponse.json({
        success: true,
        data: {
          response: result.response,
          suggestions: result.suggestions,
          route: result.route,
          action: result.action || { type: 'clear_pending_context' },
          queryData: result.data,
          intent: { type: pendingContext.intent, confidence: 1.0 },
        },
      });
    }

    if (isCancellation && pendingContext) {
      requestLogger.info({ intent: pendingContext.intent }, 'User cancelled pending action');

      return NextResponse.json({
        success: true,
        data: {
          response: pendingContext.entities._language === 'he' ? 'בוטל.' : 'Cancelled.',
          suggestions: [],
          action: { type: 'clear_pending_context' },
          intent: { type: 'unknown', confidence: 1.0 },
        },
      });
    }

    // 6. Parse intent using LLM (with conversation history for context)
    let parsedIntent = await parseIntent(message, {
      userId: user.id,
      history: history, // Pass message history for multi-turn context
      context: {
        currentPage: context?.currentPage,
        selectedItems: context?.selectedItems,
        existingServices: servicesResult,
        existingContacts: contactsResult,
        pendingAvailabilityDays: context?.pendingAvailabilityDays,
      },
    });

    requestLogger.info(
      { intent: parsedIntent.intent, confidence: parsedIntent.confidence, hasPending: !!pendingContext },
      'Intent parsed'
    );

    // 7. If we have pending context and user provided more info, merge entities
    if (pendingContext && !pendingContext.awaitingConfirmation) {
      // Merge newly parsed entities with pending ones
      parsedIntent = {
        ...parsedIntent,
        intent: pendingContext.intent as any, // Keep the original intent
        entities: { ...pendingContext.entities, ...parsedIntent.entities },
      };
      requestLogger.info({ mergedEntities: parsedIntent.entities }, 'Merged pending context entities');
    }

    // 8. Legacy: Inject pending availability days if this is an availability update
    if (parsedIntent.intent === 'availability.update' && context?.pendingAvailabilityDays?.length) {
      // If LLM didn't extract days (follow-up to "what hours?"), inject pending days
      if (!parsedIntent.entities.days?.length) {
        parsedIntent.entities.days = context.pendingAvailabilityDays;
      }
    }

    // 9. Execute intent deterministically
    const executorContext: ExecutorContext = {
      userId: user.id,
      existingServices: servicesResult,
      existingContacts: contactsResult,
      currentPreviewContext: context?.previewContext,
      pendingContext: pendingContext as PendingContext | undefined,
      language: parsedIntent.language, // Pass detected language to executor
    };

    const result = await executeIntent(parsedIntent, executorContext);

    // 7. Return response
    return NextResponse.json({
      success: true,
      data: {
        response: result.response,
        suggestions: result.suggestions,
        route: result.route,
        action: result.action,
        queryData: result.data, // Query results for contact/task/invoice queries
        intent: {
          type: parsedIntent.intent,
          confidence: parsedIntent.confidence,
        },
      },
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Chat request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process message',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}

// Helper to fetch existing services with full data for context
async function fetchExistingServices(userId: string): Promise<{ id: string; name: string; price?: number; currency?: string; duration?: number }[]> {
  try {
    const { data } = await schedulingServiceRepository.listAll(userId, false);
    return (data || []).map(s => ({
      id: s.id,
      name: s.service_name,
      price: s.price ?? undefined,
      currency: s.currency,
      duration: s.duration_minutes,
    }));
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch services for context');
    return [];
  }
}

// Helper to fetch existing contacts
async function fetchExistingContacts(userId: string): Promise<{ id: string; name: string; first_name?: string; last_name?: string; email?: string }[]> {
  try {
    const { data } = await crmContactRepository.list(userId, { limit: 100 });
    return (data || []).map(c => ({
      id: c.id,
      name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || 'Unknown',
      first_name: c.first_name || undefined,
      last_name: c.last_name || undefined,
      email: c.email || undefined,
    }));
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch contacts for context');
    return [];
  }
}
