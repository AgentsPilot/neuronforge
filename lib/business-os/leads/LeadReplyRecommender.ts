/**
 * Which link to send a new lead.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE MODEL IS AND IS NOT FOR
 *
 * It reads what the person actually wrote and picks one of the business's own
 * links. That is all. It does not write the email, does not invent an option,
 * and never sees a URL — it answers with an INDEX into a list this code built,
 * so a fabricated link is structurally impossible rather than merely unlikely.
 * The same discipline as `IntakeGenerationService`, where the model refers to
 * questions by position and our code holds the ids.
 *
 * IT MUST NEVER BE THE REASON NOBODY IS ANSWERED
 *
 * Every failure — switched off, timed out, unparseable, an index out of range —
 * falls through to `pickFallbackCandidate`, the same deterministic ladder that
 * runs when no model is involved at all. The result says which it was, so the
 * dashboard can be honest about whether a person or a pattern chose.
 * `AnalysisService` states the principle: a layer that improves an answer that
 * already exists must leave the turn exactly as it would have been without it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/leads/LeadReplyRecommender
 */

import { z } from 'zod';
import { createLogger } from '@/lib/logger';
import { ProviderFactory, PROVIDERS } from '@/lib/ai/providerFactory';
import { systemConfigRepository } from '@/lib/repositories/SystemConfigRepository';
import {
  candidatesForPrompt,
  pickFallbackCandidate,
  type LeadReplyCandidate,
} from './leadReplyCandidates';

const logger = createLogger({ service: 'LeadReplyRecommender' });

/** Config keys. A kill switch and a model, neither hardcoded. */
const ENABLED_KEY = 'lead_reply_recommender_enabled';
const MODEL_KEY = 'lead_reply_recommender_model';

export interface LeadReplyRecommendation {
  candidate: LeadReplyCandidate;
  /** Why this one, in the business's language. Empty when nothing chose. */
  reason: string;
  /** Which decided: the model, or the deterministic ladder. */
  source: 'llm' | 'fallback';
  /** For a fallback, what made it one. */
  fallbackReason?: string;
}

/*
 * `.passthrough()` and generous defaults, deliberately.
 *
 * A model that adds a field nobody reads is harmless; a schema that rejects the
 * whole answer over an unexpected key costs the business its reply. Only
 * `index` is required, because it is the only part that carries meaning.
 */
const RecommendationSchema = z
  .object({
    index: z.number().int().nonnegative(),
    reason: z.string().max(300).default(''),
  })
  .passthrough();

export interface RecommendInput {
  message?: string | null;
  serviceInterest?: string | null;
  businessType?: string | null;
  language?: string | null;
}

export async function recommendLeadReply(
  candidates: LeadReplyCandidate[],
  input: RecommendInput,
  userId: string
): Promise<LeadReplyRecommendation | null> {
  const fallback = (why: string): LeadReplyRecommendation | null => {
    const candidate = pickFallbackCandidate(candidates, input);
    return candidate ? { candidate, reason: '', source: 'fallback', fallbackReason: why } : null;
  };

  if (candidates.length === 0) return null;

  // Nothing to reason about: no message means the ladder is as good as a model.
  if (!input.message?.trim() && !input.serviceInterest?.trim()) {
    return fallback('nothing_to_read');
  }

  try {
    const enabled = await systemConfigRepository.getBoolean(ENABLED_KEY, true);
    if (!enabled) return fallback('disabled');

    const model = await systemConfigRepository.getString(MODEL_KEY, 'gpt-4o-mini');
    const provider = ProviderFactory.getProvider(PROVIDERS.OPENAI);

    const response = await provider.chatCompletion(
      {
        model,
        temperature: 0.2,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt(input.language) },
          { role: 'user', content: userPrompt(candidates, input) },
        ],
      },
      { userId, feature: 'lead-reply', component: 'LeadReplyRecommender' }
    );

    const raw = response?.content;
    if (!raw) return fallback('empty_response');

    const parsed = RecommendationSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      logger.warn({ userId, issues: parsed.error.issues.slice(0, 3) }, 'Recommender returned an unusable shape');
      return fallback('invalid_shape');
    }

    /*
     * The index is checked against the list WE built. This is the line that
     * makes an invented option impossible: out of range means the model was
     * talking about something that does not exist, and we ignore it.
     */
    const candidate = candidates[parsed.data.index];
    if (!candidate) return fallback('index_out_of_range');

    return { candidate, reason: parsed.data.reason, source: 'llm' };
  } catch (err) {
    logger.warn({ err, userId }, 'Recommender failed; falling back');
    return fallback('threw');
  }
}

function systemPrompt(language?: string | null): string {
  return [
    'You help a small business reply to someone who just got in touch.',
    'Choose exactly ONE option from the numbered list by its index.',
    '',
    'Rules:',
    '- Only ever answer with an index from the list. Never invent an option.',
    '- If the message sounds exploratory — "just wondering", "how much", "do you',
    '  do X" — prefer a free option they can book, if there is one.',
    '- If they named something specific, choose that.',
    '- If nothing fits, choose the option that offers everything.',
    `- Write "reason" as one short sentence${language ? ` in ${language}` : ''}.`,
    '',
    'Answer as JSON: {"index": <number>, "reason": "<one sentence>"}',
  ].join('\n');
}

function userPrompt(candidates: LeadReplyCandidate[], input: RecommendInput): string {
  return JSON.stringify(
    {
      business: input.businessType || undefined,
      theyWrote: input.message?.slice(0, 1500) || undefined,
      theyNamed: input.serviceInterest || undefined,
      options: candidatesForPrompt(candidates),
    },
    null,
    2
  );
}
