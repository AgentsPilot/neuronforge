/**
 * The owner says what they want to know. We work out how to collect it.
 *
 *   POST /api/intake/form/infer-question   { text: "ask if they have a venue" }
 *   → { label, type, options?, required }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the whole of "Add question". The alternative — a field-type dropdown,
 * an options editor, a required checkbox — is a form builder, and the owner
 * would be designing a data structure to ask someone where they live.
 *
 * "Do they already have a venue?" is a yes/no. "How many people are coming?" is
 * a number. "What style do you like?" is a choice with options worth
 * suggesting. The owner knows the question; the type is our problem.
 *
 * Nothing here is trusted blindly: the answer is a SUGGESTION the review screen
 * shows, and the owner can change the type before it is added. `gpt-4o-mini`,
 * following the codebase's convention of the small model for single-field
 * inference and the large one for whole artefacts.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module app/api/intake/form/infer-question
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { getProviderFactory } from '@/lib/ai/providerFactory';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { INTAKE_QUESTION_TYPES, isIntakeQuestionType } from '@/lib/business-os/intake/types';
import { stripForbiddenQuestions } from '@/lib/business-os/intake/verticalKnowledge';

const logger = createLogger({ module: 'IntakeInferQuestionAPI' });

const BodySchema = z.object({ text: z.string().min(2).max(300) });

const InferredSchema = z.object({
  label: z.string().min(1),
  type: z.string().min(1),
  options: z.array(z.string().min(1)).default([]),
  required: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }

    const { text } = parsed.data;
    const { data: profile } = await businessProfileRepository.findByUserId(user.id);
    const language = profile?.language || 'en';

    const inferred = await infer(text, language);

    /*
     * The same filter the generator runs. An owner typing "ask about their
     * medication" for a therapy practice is asking for the thing the platform
     * must not collect, and the rule cannot depend on which door the question
     * came through.
     */
    const { kept } = stripForbiddenQuestions([inferred], profile?.vertical);

    if (kept.length === 0) {
      requestLogger.warn(
        { userId: user.id, vertical: profile?.vertical },
        'Question refused by the vertical safety filter'
      );
      return NextResponse.json(
        {
          success: false,
          error:
            'That belongs in your own clinical or professional system rather than here. You can ask whether the paperwork is done, and link to it.',
          code: 'RESTRICTED_SUBJECT',
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data: kept[0] });
  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Ask the model, and fall back to a plain text question.
 *
 * The fallback matters more than it looks: a failure here would otherwise leave
 * the owner unable to add a question at all. A long-text question with their
 * own words as the label is always a usable question — they typed it, after all.
 */
async function infer(
  text: string,
  language: string
): Promise<{
  id: string;
  label: string;
  type: (typeof INTAKE_QUESTION_TYPES)[number];
  required: boolean;
  options?: { id: string; label: string }[];
}> {
  const fallback = {
    id: randomUUID(),
    label: text.trim(),
    type: 'long_text' as const,
    required: false,
  };

  try {
    const response = await getProviderFactory().complete({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You turn a business owner\'s rough note into one clean intake question. Reply with JSON only.',
        },
        {
          role: 'user',
          content: `The owner wants to ask their client something. Their note:

"${text}"

Write it as one clear question a client would read, in ${language === 'he' ? 'Hebrew' : language === 'es' ? 'Spanish' : 'English'}, and pick how the answer is collected.

Types: ${INTAKE_QUESTION_TYPES.join(', ')}
- yes_no for anything answerable yes or no
- number for counts and quantities
- date for a day
- single_choice / multi_choice when a short list of answers covers it — suggest the options
- file when they are asking for photos or documents
- short_text for a name or a place, long_text for anything open

Only mark it required if the business plainly cannot proceed without it.

{"label": "...", "type": "...", "options": [], "required": false}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const parsed = InferredSchema.safeParse(JSON.parse(response.content));
    if (!parsed.success) return fallback;

    const type = isIntakeQuestionType(parsed.data.type) ? parsed.data.type : 'long_text';
    const takesOptions = type === 'single_choice' || type === 'multi_choice';

    return {
      id: randomUUID(),
      label: parsed.data.label.trim() || text.trim(),
      type,
      required: parsed.data.required,
      ...(takesOptions && parsed.data.options.length
        ? {
            options: parsed.data.options.map(label => ({ id: randomUUID(), label: label.trim() })),
          }
        : {}),
    };
  } catch (error) {
    logger.warn({ err: error }, 'Question inference failed; using the note as written');
    return fallback;
  }
}
