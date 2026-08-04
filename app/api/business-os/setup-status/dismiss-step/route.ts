/**
 * POST /api/business-os/setup-status/dismiss-step
 * Dismiss a setup step so it won't show again
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';

const logger = createLogger({ module: 'DismissStepAPI' });

const DismissStepSchema = z.object({
  stepId: z.enum(['services', 'availability', 'payments', 'calendar', 'website']),
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
    const { stepId } = DismissStepSchema.parse(body);

    requestLogger.info({ userId: user.id, stepId }, 'Dismissing setup step');

    // 3. Get current dismissed steps and update
    const { data: profile, error: fetchError } = await supabaseServer
      .from('business_profiles')
      .select('id, dismissed_setup_steps')
      .eq('user_id', user.id)
      .maybeSingle();

    if (fetchError) {
      requestLogger.error({ err: fetchError, userId: user.id }, 'Failed to fetch profile');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch profile' },
        { status: 500 }
      );
    }

    if (!profile) {
      requestLogger.warn({ userId: user.id }, 'No business profile found - cannot dismiss step');
      return NextResponse.json(
        { success: false, error: 'No business profile found' },
        { status: 404 }
      );
    }

    // Handle dismissed_setup_steps which might be TEXT[] array or JSON string
    let currentDismissed: string[] = [];
    const rawDismissed = profile.dismissed_setup_steps;
    requestLogger.info({ rawDismissed, type: typeof rawDismissed, isArray: Array.isArray(rawDismissed), profile }, 'Dismiss API: Raw dismissed steps from DB');
    if (rawDismissed) {
      if (Array.isArray(rawDismissed)) {
        currentDismissed = rawDismissed;
      } else if (typeof rawDismissed === 'string') {
        try {
          currentDismissed = JSON.parse(rawDismissed);
        } catch {
          currentDismissed = [];
        }
      }
    }

    if (!currentDismissed.includes(stepId)) {
      const updatedDismissed = [...currentDismissed, stepId];

      const { error: updateError } = await supabaseServer
        .from('business_profiles')
        .update({ dismissed_setup_steps: updatedDismissed })
        .eq('user_id', user.id);

      if (updateError) {
        requestLogger.error({ err: updateError, userId: user.id, stepId }, 'Failed to dismiss step - column may not exist. Run migration: ALTER TABLE business_profiles ADD COLUMN dismissed_setup_steps TEXT[] DEFAULT \'{}\'');
        return NextResponse.json(
          { success: false, error: 'Failed to dismiss step' },
          { status: 500 }
        );
      }

      requestLogger.info({ userId: user.id, stepId, dismissed: updatedDismissed }, 'Setup step dismissed');
    } else {
      requestLogger.info({ userId: user.id, stepId }, 'Step already dismissed');
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid step ID' },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Failed to dismiss setup step');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}
