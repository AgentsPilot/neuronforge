/**
 * Business OS Chat V2 API - AI Data Layer
 *
 * New chat endpoint using the AI Data Layer for autonomous data access.
 * The LLM can directly query and mutate data using function calling.
 *
 * Features:
 * - Full autonomy: LLM decides what data to query
 * - Dynamic: No hardcoded capabilities or switch statements
 * - Multi-language: LLM responds in user's language naturally
 * - Safe: All mutations require confirmation
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { createAIDataLayerService } from '@/lib/business-os/ai-data-layer/AIDataLayerService';
import type { ChatMessage } from '@/lib/business-os/ai-data-layer/types';

const logger = createLogger({ module: 'BusinessOSChatV2API' });
const auditTrail = AuditTrailService.getInstance();

// Request validation schema
const chatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.string(),
    tool_calls: z.array(z.object({
      id: z.string(),
      type: z.literal('function'),
      function: z.object({
        name: z.string(),
        arguments: z.string()
      })
    })).optional(),
    tool_call_id: z.string().optional()
  })).optional(),
  pendingConfirmationId: z.string().optional()
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

    // 2. Check feature flag
    const useAIDataLayer = process.env.NEXT_PUBLIC_USE_AI_DATA_LAYER === 'true';
    if (!useAIDataLayer) {
      return NextResponse.json(
        { success: false, error: 'AI Data Layer is not enabled' },
        { status: 400 }
      );
    }

    // 3. Validate input
    const body = await request.json();
    const parseResult = chatRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request',
          details: process.env.NODE_ENV === 'development' ? parseResult.error.errors : undefined
        },
        { status: 400 }
      );
    }

    const { message, conversationHistory, pendingConfirmationId } = parseResult.data;

    requestLogger.info(
      {
        userId: user.id,
        messageLength: message.length,
        historyLength: conversationHistory?.length || 0,
        hasPendingConfirmation: !!pendingConfirmationId
      },
      'Processing chat-v2 request'
    );

    // 4. Create AI Data Layer service and process message
    const aiService = createAIDataLayerService(user.id);

    const response = await aiService.processMessage({
      message,
      conversationHistory: conversationHistory as ChatMessage[],
      pendingConfirmationId
    });

    // 5. Audit log (non-blocking)
    auditTrail.log({
      action: 'BUSINESS_OS_CHAT_V2',
      entityType: 'chat',
      userId: user.id,
      resourceName: 'business-os-chat-v2',
      changes: {
        message: message.substring(0, 100),
        toolCallCount: response.toolCalls?.length || 0,
        hasActions: (response.actions?.length || 0) > 0,
        hasPendingConfirmation: !!response.pendingConfirmation
      },
      request
    }).catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info(
      {
        userId: user.id,
        responseLength: response.message.length,
        toolCalls: response.toolCalls?.length || 0,
        actions: response.actions?.length || 0
      },
      'Chat-v2 request processed'
    );

    // 6. Return response
    return NextResponse.json({
      success: true,
      data: {
        message: response.message,
        actions: response.actions || [],
        pendingConfirmation: response.pendingConfirmation,
        // Only include toolCalls in development for debugging
        toolCalls: process.env.NODE_ENV === 'development' ? response.toolCalls : undefined
      }
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Chat-v2 request failed');

    return NextResponse.json(
      {
        success: false,
        error: 'An error occurred processing your request',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint for health check
 */
export async function GET() {
  const isEnabled = process.env.NEXT_PUBLIC_USE_AI_DATA_LAYER === 'true';

  return NextResponse.json({
    success: true,
    data: {
      service: 'business-os-chat-v2',
      version: '2.0.0',
      enabled: isEnabled,
      description: 'AI Data Layer powered chat with autonomous data access'
    }
  });
}
