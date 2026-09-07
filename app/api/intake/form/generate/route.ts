/**
 * Write this business an intake form.
 *
 *   POST /api/intake/form/generate   { regenerate?: boolean }
 *
 * Produces a DRAFT. Nothing here reaches a client — publishing is a separate
 * act, and the gate in `intakeReach` is what holds the line.
 *
 * `regenerate` is required to overwrite an existing draft. Opening the review
 * screen calls this without it, so arriving at the screen never throws away
 * edits the owner made last time; asking for a fresh one is a button they press.
 *
 * @module app/api/intake/form/generate
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { intakeGenerationService } from '@/lib/services/IntakeGenerationService';

const logger = createLogger({ module: 'IntakeGenerateAPI' });

/**
 * A model writing a dozen questions takes longer than the default allows, and
 * a timeout here reads to the owner as "the button does nothing".
 */
export const maxDuration = 60;

const BodySchema = z.object({ regenerate: z.boolean().optional().default(false) });

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }

    const result = await intakeGenerationService.generateIntakeForm(user.id, {
      regenerate: parsed.data.regenerate,
    });

    if (!result.success) {
      requestLogger.error({ userId: user.id, error: result.error }, 'Intake generation failed');
      return NextResponse.json(
        { success: false, error: 'Could not write your intake form. Please try again.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        formId: result.formId,
        questionCount: result.questionCount,
        /*
         * The draft itself, so the caller can render it without asking again.
         * The review screen updates from this response; a second GET is a
         * second thing that can fail, and when it did the owner watched their
         * form generate and the screen stay empty.
         */
        form: result.form,
        /*
         * Reported, not hidden. A fallback form is generic — it did not read
         * the business at all — and an owner told "here is your intake" about
         * three stock questions has been misled about what the product did.
         * The screen says so plainly and offers to try again.
         */
        contentSource: result.contentSource,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
