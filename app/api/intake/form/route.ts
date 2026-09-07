/**
 * The business's intake form — read it, and save edits to the draft.
 *
 *   GET /api/intake/form   what the review screen opens with
 *   PUT /api/intake/form   replace the draft's questions
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GET returns the draft, the published form and the settings together, because
 * the screen needs all three to say anything true. "Draft · not yet sent to
 * clients" versus "Published" is not a property of either row on its own — it
 * is the relationship between them — and a screen that fetched them separately
 * would render one of its states wrongly while the second request was in
 * flight.
 *
 * PUT takes the WHOLE question list rather than a patch. Every editing action
 * on that screen — relabel, reorder, require, delete — is the same write, and a
 * per-action endpoint would be five routes that can disagree about ordering.
 * The list is small and the owner is one person; there is nothing here worth
 * the complexity of a diff.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module app/api/intake/form
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { intakeFormRepository } from '@/lib/repositories/IntakeFormRepository';
import { intakeRepository } from '@/lib/repositories/IntakeRepository';
import { INTAKE_QUESTION_TYPES } from '@/lib/business-os/intake/types';
import { intakeBlockReason } from '@/lib/business-os/intakeReach';

const logger = createLogger({ module: 'IntakeFormAPI' });

const OptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(200),
});

const QuestionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(300),
  help: z.string().max(500).optional(),
  type: z.enum(INTAKE_QUESTION_TYPES),
  required: z.boolean(),
  options: z.array(OptionSchema).max(20).optional(),
  maxFiles: z.number().int().positive().max(10).optional(),
  showIf: z
    .object({
      questionId: z.string().min(1),
      equals: z.union([z.string(), z.boolean()]),
    })
    .optional(),
});

const SaveSchema = z.object({
  // Empty is allowed while editing — the owner may delete everything and start
  // again. It is `publish` that refuses an empty form, because that is the
  // point at which emptiness would reach a client.
  questions: z.array(QuestionSchema).max(30),
});

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const [draft, published, settings] = await Promise.all([
      intakeFormRepository.getDraft(user.id),
      intakeFormRepository.getPublished(user.id),
      intakeRepository.getSettings(user.id),
    ]);

    if (draft.error || published.error) {
      requestLogger.error(
        { err: draft.error || published.error, userId: user.id },
        'Failed to read the intake form'
      );
      return NextResponse.json(
        { success: false, error: 'Failed to read the intake form' },
        { status: 500 }
      );
    }

    const reach = {
      is_enabled: settings.data?.is_enabled ?? false,
      send_after_booking: settings.data?.send_after_booking ?? false,
      hasPublishedForm: !!published.data,
    };

    return NextResponse.json({
      success: true,
      data: {
        draft: draft.data,
        published: published.data,
        settings: reach,
        /*
         * Whether the owner has edits nobody has received yet. The publish
         * button turns on this, so it is computed once here rather than
         * inferred on the client from two timestamps.
         */
        hasUnpublishedChanges: !!draft.data,
        // Why intake is not reaching anyone, if it is not. Null when nothing is
        // in the way, so the screen can say something specific instead of
        // leaving the owner to work it out.
        blockedBecause: intakeBlockReason(reach, { forClient: true }),
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
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

    const parsed = SaveSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid intake form',
          details: process.env.NODE_ENV === 'development' ? parsed.error.errors : undefined,
        },
        { status: 400 }
      );
    }

    const { questions } = parsed.data;

    /*
     * A condition may only point at a question that exists and comes EARLIER.
     *
     * Checked here rather than trusted, because the client sends the whole list
     * and a reorder is the easy way to end up with a question revealed by one
     * that has not been asked yet. That question could never be shown, and
     * nothing downstream would report it — it would simply never appear.
     */
    const seen = new Set<string>();
    for (const question of questions) {
      if (question.showIf && !seen.has(question.showIf.questionId)) {
        return NextResponse.json(
          {
            success: false,
            error: 'A follow-up question has to come after the question it depends on',
            questionId: question.id,
          },
          { status: 400 }
        );
      }
      seen.add(question.id);
    }

    if (seen.size !== questions.length) {
      // Duplicate ids would make answers collide silently.
      return NextResponse.json(
        { success: false, error: 'Every question needs its own id' },
        { status: 400 }
      );
    }

    /*
     * Edits always land on a DRAFT. Editing a published form opens a draft from
     * it first, so the version clients are answering right now is never altered
     * underneath them — the whole reason publishing is a separate act.
     */
    const existingDraft = await intakeFormRepository.getDraft(user.id);
    if (!existingDraft.data) {
      const opened = await intakeFormRepository.editPublished(user.id);
      if (opened.error) {
        return NextResponse.json(
          { success: false, error: 'No intake form to edit' },
          { status: 404 }
        );
      }
    }

    const saved = await intakeFormRepository.updateDraftQuestions(user.id, questions);

    if (saved.error) {
      requestLogger.error({ err: saved.error, userId: user.id }, 'Failed to save the intake draft');
      return NextResponse.json(
        { success: false, error: 'Failed to save the intake form' },
        { status: 500 }
      );
    }

    requestLogger.info(
      { userId: user.id, formId: saved.data!.id, questions: questions.length },
      'Intake draft saved'
    );

    return NextResponse.json({ success: true, data: saved.data });
  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
