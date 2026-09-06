/**
 * POST /api/onboarding/chat/reset
 * Clears old onboarding conversation data for the current user
 *
 * This endpoint is called when starting a fresh onboarding session
 * to prevent stale data from previous onboarding flows causing issues
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'OnboardingChatResetAPI' });

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

    // 2. Delete all old onboarding conversation messages for this user
    const { error: deleteError, count } = await supabaseServer
      .from('onboarding_conversations')
      .delete()
      .eq('user_id', user.id);

    if (deleteError) {
      requestLogger.error({ err: deleteError, userId: user.id }, 'Failed to delete old conversation data');
      return NextResponse.json(
        { success: false, error: 'Failed to reset conversation' },
        { status: 500 }
      );
    }

    requestLogger.info({ userId: user.id, deletedCount: count }, 'Cleared old onboarding conversation data');

    return NextResponse.json({
      success: true,
      message: 'Conversation data cleared',
      deletedCount: count
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Reset request failed');
    return NextResponse.json(
      { success: false, error: 'Failed to reset conversation' },
      { status: 500 }
    );
  }
}
