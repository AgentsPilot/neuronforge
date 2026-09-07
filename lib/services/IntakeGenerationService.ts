/**
 * Write the business's intake form for them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The platform already knows what this business does. Onboarding captured a
 * vertical, a sub-vertical, a description in the owner's own words, and a list
 * of services with prices and durations. Asking that same owner to then pick a
 * form from a library — or worse, to design one — is asking them to supply
 * information the product already has.
 *
 * So: AI designs the intake, the owner reviews and controls it, deterministic
 * software executes it. This file is the first of those three.
 *
 * WHAT IT PRODUCES IS A DRAFT, ALWAYS.
 *
 * Nothing generated here reaches a client until the owner publishes it. The
 * questions are plausible and they are not yet theirs; a business finding out
 * what it asked from a confused client is the failure this guards against.
 * `IntakeFormRepository.saveDraft` is the only write, and the publish gate in
 * `intakeReach` is what keeps it off the wire.
 *
 * MODELLED ON `WebsiteGenerationService`, which is the one place in this
 * codebase that does prompt → LLM → Zod → typed fallback → draft → review →
 * publish. Four things are copied deliberately: `contentSource` so a silent
 * fallback cannot pass itself off as a success, Zod on the output so a bad
 * shape falls back instead of throwing from somewhere later, planning before
 * prompting so nothing is asked for that the form cannot render, and one shot
 * with no retry.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/services/IntakeGenerationService
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createLogger } from '@/lib/logger';
import { getProviderFactory } from '@/lib/ai/providerFactory';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { intakeFormRepository } from '@/lib/repositories/IntakeFormRepository';
import {
  INTAKE_QUESTION_TYPES,
  isIntakeQuestionType,
  questionTakesOptions,
  type IntakeForm,
  type IntakeQuestion,
  type IntakeQuestionType,
} from '@/lib/business-os/intake/types';
import {
  intakeKnowledgeFor,
  stripForbiddenQuestions,
} from '@/lib/business-os/intake/verticalKnowledge';

const logger = createLogger({ service: 'IntakeGenerationService' });

const MODEL = 'gpt-4o';

/**
 * How many questions a form may have.
 *
 * Twelve is not a technical limit; it is the point past which a client stops
 * answering. The intake exists to make one appointment go well, not to learn
 * everything about a person — a spec requirement, and the difference between
 * this and a form builder.
 */
const MAX_QUESTIONS = 12;

/**
 * Only what gets dereferenced is required.
 *
 * `.passthrough()` and generous defaults on purpose: a model that adds a field
 * nobody reads is harmless, while a schema that rejects the whole form over an
 * unexpected key costs the business its intake. Reject on shapes that cannot be
 * rendered, tolerate everything else.
 */
const GeneratedQuestionSchema = z.object({
  label: z.string().min(1),
  type: z.string().min(1),
  required: z.boolean().default(false),
  help: z.string().optional(),
  options: z.array(z.string().min(1)).default([]),
  maxFiles: z.number().int().positive().optional(),
  // Index into this same array, because the model has no ids to point at. It is
  // resolved to a real question id below, once ids exist.
  showIfIndex: z.number().int().nonnegative().optional(),
  showIfEquals: z.union([z.string(), z.boolean()]).optional(),
});

const GeneratedFormSchema = z
  .object({ questions: z.array(GeneratedQuestionSchema).min(1) })
  .passthrough();

export interface GenerateIntakeResult {
  success: boolean;
  formId?: string;
  questionCount?: number;
  /**
   * The draft that now exists — returned, not just described.
   *
   * The review screen has to show these questions the moment generation
   * finishes. Reporting only an id and a count left it re-reading the form
   * through a second request, and a screen whose correctness depends on a
   * follow-up GET is a screen that is wrong whenever that GET does not land.
   */
  form?: IntakeForm;
  /**
   * Where the questions came from. Reported rather than inferred: a fallback
   * form is a working form and a worse one, and the caller deserves to know
   * which it got.
   */
  contentSource: 'llm' | 'fallback';
  /** Why it fell back, or what was stripped. Shown to nobody; logged for us. */
  warning?: string;
  error?: string;
}

export class IntakeGenerationService {
  /**
   * Generate a draft intake for a business.
   *
   * Refuses to overwrite an existing draft unless asked: the owner may have
   * edited it, and regeneration is a deliberate act rather than a side effect
   * of opening a screen.
   */
  async generateIntakeForm(
    userId: string,
    opts: { regenerate?: boolean } = {}
  ): Promise<GenerateIntakeResult> {
    try {
      const existing = await intakeFormRepository.getDraft(userId);
      if (existing.data && !opts.regenerate) {
        return {
          success: true,
          formId: existing.data.id,
          questionCount: existing.data.questions.length,
          contentSource: existing.data.generated_from?.source === 'llm' ? 'llm' : 'fallback',
          form: existing.data,
        };
      }

      const { data: profile } = await businessProfileRepository.findByUserId(userId);
      if (!profile) {
        return { success: false, contentSource: 'fallback', error: 'No business profile' };
      }

      const { data: services } = await schedulingServiceRepository.listAll(userId, true);
      const serviceList = services ?? [];

      const generated = await this.callLLM(
        profile as unknown as Record<string, unknown>,
        serviceList as unknown as Record<string, unknown>[]
      );

      /*
       * The filter runs on every path, including the fallback.
       *
       * The prompt already forbids these subjects, and the fallback never
       * proposes them — but "the input was safe" is an assumption, and the cost
       * of it being wrong is a clinical detail collected by a booking tool.
       */
      const { kept, removed } = stripForbiddenQuestions(generated.questions, profile.vertical);

      if (removed.length > 0) {
        logger.warn(
          { userId, vertical: profile.vertical, removed: removed.map(q => q.label) },
          'Generated questions removed by the vertical safety filter'
        );
      }

      const questions = kept.slice(0, MAX_QUESTIONS);

      if (questions.length === 0) {
        // Everything was stripped, which means the model wrote a form entirely
        // out of bounds for this vertical. The deterministic set is safe by
        // construction, so use it rather than leaving the business with nothing.
        const safe = this.fallbackQuestions(profile);
        const saved = await intakeFormRepository.saveDraft(userId, safe, {
          source: 'fallback',
          vertical: profile.vertical,
          subVertical: profile.sub_vertical,
          serviceIds: serviceList.map(service => service.id),
        });

        return saved.error
          ? { success: false, contentSource: 'fallback', error: saved.error.message }
          : {
              success: true,
              formId: saved.data!.id,
              questionCount: safe.length,
              contentSource: 'fallback',
              warning: 'every_generated_question_filtered',
            };
      }

      const saved = await intakeFormRepository.saveDraft(userId, questions, {
        source: generated.source,
        model: generated.source === 'llm' ? MODEL : undefined,
        vertical: profile.vertical,
        subVertical: profile.sub_vertical,
        serviceIds: serviceList.map(service => service.id),
      });

      if (saved.error) {
        return { success: false, contentSource: generated.source, error: saved.error.message };
      }

      logger.info(
        {
          userId,
          formId: saved.data!.id,
          questions: questions.length,
          source: generated.source,
          vertical: profile.vertical,
        },
        'Intake draft generated'
      );

      return {
        success: true,
        formId: saved.data!.id,
        questionCount: questions.length,
        contentSource: generated.source,
        warning: generated.reason ?? (removed.length ? 'questions_filtered' : undefined),
        form: saved.data!,
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Intake generation failed');
      return {
        success: false,
        contentSource: 'fallback',
        error: error instanceof Error ? error.message : 'generation_failed',
      };
    }
  }

  private async callLLM(
    profile: Record<string, unknown>,
    services: ReadonlyArray<Record<string, unknown>>
  ): Promise<{ questions: IntakeQuestion[]; source: 'llm' | 'fallback'; reason?: string }> {
    const language = (profile.language as string) || 'en';

    const systemPrompts: Record<string, string> = {
      en: 'You design short intake forms that a service business sends a client after they book. Write every question in English. Reply with JSON only.',
      he: 'אתה מעצב טפסי קליטה קצרים שעסק שולח ללקוח אחרי שהוא קובע. כתוב כל שאלה בעברית בלבד. החזר JSON בלבד.',
      es: 'Diseñas formularios de admisión breves que un negocio envía a un cliente tras la reserva. Escribe cada pregunta en español. Responde solo con JSON.',
    };

    try {
      const response = await getProviderFactory().complete({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompts[language] || systemPrompts.en },
          { role: 'user', content: this.buildPrompt(profile, services) },
        ],
        response_format: { type: 'json_object' },
        // Lower than the website copywriter's 0.7: this is an operational form,
        // and inventiveness in what a client is asked is not a virtue.
        temperature: 0.3,
      });

      const parsed = GeneratedFormSchema.safeParse(JSON.parse(response.content));

      if (!parsed.success) {
        const issues = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
        logger.error({ issues, language }, 'Model returned an unusable intake shape');
        return {
          questions: this.fallbackQuestions(profile),
          source: 'fallback',
          reason: `invalid_shape: ${issues.slice(0, 3).join('; ')}`,
        };
      }

      return { questions: this.toQuestions(parsed.data.questions), source: 'llm' };
    } catch (error) {
      logger.error({ err: error }, 'Intake generation LLM call failed');
      return {
        questions: this.fallbackQuestions(profile),
        source: 'fallback',
        reason: error instanceof Error ? error.message : 'llm_call_failed',
      };
    }
  }

  /**
   * Turn the model's answer into questions the renderer can draw.
   *
   * Ids are assigned HERE, not asked for. A model inventing ids gives you
   * duplicates and collisions with existing questions, and the ids have to
   * outlive relabelling — which is exactly what the old key-from-label scheme
   * got wrong.
   */
  private toQuestions(
    raw: z.infer<typeof GeneratedFormSchema>['questions']
  ): IntakeQuestion[] {
    const ids = raw.map(() => randomUUID());

    return raw.map((item, index) => {
      const type = this.coerceType(item.type, item.options.length > 0);

      const question: IntakeQuestion = {
        id: ids[index],
        label: item.label.trim(),
        type,
        required: item.required,
      };

      if (item.help?.trim()) question.help = item.help.trim();

      if (questionTakesOptions(type) && item.options.length > 0) {
        question.options = item.options.map(label => ({ id: randomUUID(), label: label.trim() }));
      }

      if (type === 'file' && item.maxFiles) question.maxFiles = item.maxFiles;

      /*
       * A condition may only point BACKWARDS. The model indexes into its own
       * array, and a question conditional on one that comes after it can never
       * be evaluated when the form is answered top to bottom.
       */
      if (
        item.showIfIndex !== undefined &&
        item.showIfIndex < index &&
        item.showIfEquals !== undefined
      ) {
        question.showIf = { questionId: ids[item.showIfIndex], equals: item.showIfEquals };
      }

      return question;
    });
  }

  /**
   * The model's word for a type, mapped onto one we render.
   *
   * It is told the eight names, and it will still occasionally answer `text`,
   * `boolean` or `select`. Guessing sensibly costs nothing; rejecting the whole
   * form over a synonym costs the business its intake.
   */
  private coerceType(raw: string, hasOptions: boolean): IntakeQuestionType {
    const value = raw.toLowerCase().trim().replace(/[\s-]/g, '_');
    if (isIntakeQuestionType(value)) return value;

    const synonyms: Record<string, IntakeQuestionType> = {
      text: 'short_text',
      string: 'short_text',
      textarea: 'long_text',
      paragraph: 'long_text',
      boolean: 'yes_no',
      checkbox: 'yes_no',
      radio: 'single_choice',
      select: 'single_choice',
      dropdown: 'single_choice',
      enum: 'single_choice',
      multiselect: 'multi_choice',
      checkboxes: 'multi_choice',
      upload: 'file',
      image: 'file',
      photo: 'file',
      datetime: 'date',
      integer: 'number',
    };

    if (synonyms[value]) return synonyms[value];
    return hasOptions ? 'single_choice' : 'short_text';
  }

  private buildPrompt(
    profile: Record<string, unknown>,
    services: ReadonlyArray<Record<string, unknown>>
  ): string {
    const vertical = (profile.vertical as string) || 'other';
    const knowledge = intakeKnowledgeFor(vertical);

    const serviceLines = services.length
      ? services
          .map(service => {
            const name = service.service_name as string;
            const description = (service.description as string) || '';
            const scheduled = service.is_scheduled === false ? ' (no appointment time — sold as a product or course)' : '';
            return `- ${name}${scheduled}${description ? `: ${description.slice(0, 200)}` : ''}`;
          })
          .join('\n')
      : '- (no services recorded)';

    const restriction = knowledge.neverAsk.length
      ? `
NEVER ASK ABOUT — this is a hard rule, not a preference:
${knowledge.neverAsk.slice(0, 12).map(term => `- anything concerning "${term}"`).join('\n')}
${knowledge.deferTo ? `\n${knowledge.deferTo}` : ''}
This platform runs the business workflow. It is not the system of record for
clinical, medical or legal files, and a question asked here creates a record in
the wrong place.
`
      : '';

    return `A business has just had a client book with them. Write the short form
the business sends that client afterwards, so the business can prepare.

THE BUSINESS
Trade: ${vertical}${profile.sub_vertical ? ` (${profile.sub_vertical})` : ''}
Name: ${profile.company_name || 'unknown'}
In their words: ${((profile.description as string) || '').slice(0, 900) || '(none given)'}

WHAT THEY SELL
${serviceLines}

WHAT BUSINESSES LIKE THIS USUALLY NEED TO KNOW
${knowledge.concepts.map(concept => `- ${concept}`).join('\n')}

Practical things that often matter: ${knowledge.operationalNeeds.join(', ')}.

Questions of this kind are often useful — as inspiration, not a script:
${knowledge.typicalQuestions.map(question => `- ${question}`).join('\n')}
${restriction}
RULES
- Between 4 and ${MAX_QUESTIONS} questions. Fewer is better. A client who stops
  answering halfway is worse than a shorter form.
- Ask only what this business needs IN ORDER TO PREPARE. This is not a survey
  and not a way to learn everything about the client.
- Do not ask for anything already known from the booking: name, email, phone,
  which service, or when. They booked; the business has all of that.
- Write in the business's own language, and in the words their clients would use.
- Base the questions on what THIS business actually sells. Two businesses in the
  same trade should not get the same form.
- Mark a question required only when the business genuinely cannot prepare
  without it. Most should be optional.
- Use a condition when a question only makes sense given an earlier answer —
  "showIfIndex" pointing at an EARLIER question in the array, plus the answer
  that reveals it. Use this sparingly.

ANSWER TYPES — use exactly these names:
${INTAKE_QUESTION_TYPES.join(', ')}
"options" is only for single_choice and multi_choice. "maxFiles" is only for file.

Reply with JSON in exactly this shape:
{
  "questions": [
    {
      "label": "the question, as the client reads it",
      "type": "one of the names above",
      "required": false,
      "help": "optional one-line clarification",
      "options": ["only for choice questions"],
      "maxFiles": 3,
      "showIfIndex": 0,
      "showIfEquals": true
    }
  ]
}`;
  }

  /**
   * What to ask when the model cannot be reached or answers unusably.
   *
   * Deliberately generic and deliberately short. It is not trying to be a good
   * form for this business — it is trying to be a form the owner can open,
   * recognise as a starting point, and edit. The library that used to serve
   * this purpose is gone, so this has to live in code.
   */
  private fallbackQuestions(profile: Record<string, unknown>): IntakeQuestion[] {
    const language = (profile.language as string) || 'en';

    const copy: Record<string, Array<[string, IntakeQuestionType, boolean]>> = {
      en: [
        ['What would you like to get out of this?', 'long_text', true],
        ['Is there anything we should know before we start?', 'long_text', false],
        ['Is there anything you would like us to prepare?', 'long_text', false],
      ],
      he: [
        ['מה תרצו להשיג מהמפגש?', 'long_text', true],
        ['יש משהו שכדאי שנדע לפני שמתחילים?', 'long_text', false],
        ['יש משהו שתרצו שנכין מראש?', 'long_text', false],
      ],
      es: [
        ['¿Qué te gustaría conseguir?', 'long_text', true],
        ['¿Hay algo que debamos saber antes de empezar?', 'long_text', false],
        ['¿Hay algo que quieras que preparemos?', 'long_text', false],
      ],
    };

    return (copy[language] || copy.en).map(([label, type, required]) => ({
      id: randomUUID(),
      label,
      type,
      required,
    }));
  }
}

export const intakeGenerationService = new IntakeGenerationService();
