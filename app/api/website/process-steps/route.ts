/**
 * Website Process Steps API
 * GET - Fetch user-defined process steps
 * PUT - Update user-defined process steps
 *
 * Process steps are stored in business_profiles.process_steps
 * and used by the website "How It Works" section.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { BusinessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'ProcessStepsAPI' });

const ProcessStepSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  icon: z.string().optional(),
  number: z.number().optional()
});

const UpdateProcessStepsSchema = z.object({
  steps: z.array(ProcessStepSchema).min(1).max(10)
});

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const profileRepo = new BusinessProfileRepository();
    const result = await profileRepo.getProcessSteps(user.id);

    if (result.error) {
      throw result.error;
    }

    requestLogger.info({ userId: user.id, stepCount: result.data?.length || 0 }, 'Fetched process steps');

    return NextResponse.json({
      success: true,
      steps: result.data || []
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch process steps');
    return NextResponse.json(
      { success: false, error: 'Failed to fetch process steps' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = UpdateProcessStepsSchema.parse(body);

    const profileRepo = new BusinessProfileRepository();
    const result = await profileRepo.updateProcessSteps(user.id, validated.steps);

    if (result.error) {
      throw result.error;
    }

    requestLogger.info({ userId: user.id, stepCount: validated.steps.length }, 'Updated process steps');

    return NextResponse.json({
      success: true,
      steps: result.data
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    requestLogger.error({ err: error, errorMessage }, 'Failed to update process steps');

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update process steps',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      },
      { status: 500 }
    );
  }
}
