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
import { buildBosCallContext } from '@/lib/business-os/llm/callCatalog';
import { withModelFallback } from '@/lib/business-os/llm/modelFallback';
import { resolveBosLlmSettings } from '@/lib/business-os/llm/modelSettings';
import {
  candidatesForPrompt,
  pickFallbackCandidate,
  type LeadReplyCandidate,
} from './leadReplyCandidates';

const logger = createLogger({ service: 'LeadReplyRecommender' });

/*
 * The kill switch and the model now live in the `leads` area row, read through
 * `resolveBosLlmSettings` (Layer 2 FR-12). The old single-purpose keys
 * `lead_reply_recommender_enabled` / `_model` were copied into that row by the
 * seed migration and are marked superseded; nothing reads them any more.
 */

export interface LeadReplyRecommendation {
  candidate: LeadReplyCandidate;
  /** Why this one, in the business's language. Empty when nothing chose. */
  reason: string;
  /**
   * One sentence TO THE CLIENT, acknowledging what they actually asked.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Not `reason`, which is the opposite audience: that one tells the OWNER why
   * this link was chosen and is shown on their dashboard. This one is read by
   * the person who wrote in, at the top of the invite, so that a reply to "can
   * you help with my son's ADHD" does not open with the same words as a reply
   * to "what do you charge".
   *
   * Empty whenever anything at all goes wrong, and empty is a complete answer:
   * the invite then reads exactly as it reads today. A personal line is an
   * improvement on an email that already works, and `AnalysisService`'s rule
   * applies — a layer that improves an answer that already exists must leave
   * the turn exactly as it would have been without it.
   *
   * It carries no link, no price and no commitment. The model is choosing a
   * link by INDEX a few lines above precisely so it cannot fabricate one;
   * letting it write a URL in prose would hand back what that design refuses,
   * which is why `stripUnsafeOpening` below removes anything URL-shaped rather
   * than trusting the instruction not to produce one.
   * ───────────────────────────────────────────────────────────────────────────
   */
  opening: string;
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
    /* Same contract as `reason`: a default, never a requirement. A model that
       omits it costs the client a nicety, not their reply. */
    opening: z.string().max(300).default(''),
  })
  .passthrough();

/**
 * Take back anything the opening sentence was not allowed to contain.
 *
 * The instruction says no links and no prices. This does not trust it: the
 * sentence is built from text a stranger typed, so it is prompt-injection
 * surface, and the one thing that must never happen is the business's own
 * email carrying a stranger's URL. Structurally impossible beats unlikely —
 * the same reason the model picks a link by index and never sees one.
 *
 * A sentence that loses something this way is dropped rather than patched:
 * half a sentence reads worse than the stock copy it falls back to.
 */
function stripUnsafeOpening(opening: string): string {
  const trimmed = opening.trim();
  if (!trimmed) return '';

  const carriesLink = /https?:\/\/|www\.|<a\s|\[[^\]]*\]\(/i.test(trimmed);
  const carriesMarkup = /<[a-z/][^>]*>/i.test(trimmed);
  if (carriesLink || carriesMarkup) return '';

  /* One sentence was the instruction; anything longer is the model ignoring
     it, and a paragraph above a booking button is not what was designed. */
  if (trimmed.length > 220) return '';

  return trimmed;
}

export interface RecommendInput {
  message?: string | null;
  serviceInterest?: string | null;
  businessType?: string | null;
  language?: string | null;
}

export async function recommendLeadReply(
  candidates: LeadReplyCandidate[],
  input: RecommendInput,
  userId: string,
  /** One id per incoming enquiry, minted by the caller. */
  groupId: string
): Promise<LeadReplyRecommendation | null> {
  const fallback = (why: string): LeadReplyRecommendation | null => {
    const candidate = pickFallbackCandidate(candidates, input);
    return candidate
      ? { candidate, reason: '', opening: '', source: 'fallback', fallbackReason: why }
      : null;
  };

  if (candidates.length === 0) return null;

  // Nothing to reason about: no message means the ladder is as good as a model.
  if (!input.message?.trim() && !input.serviceInterest?.trim()) {
    return fallback('nothing_to_read');
  }

  try {
    const settings = await resolveBosLlmSettings('leads', 'reply_recommendation');
    if (!settings.enabled) return fallback('disabled');

    const provider = ProviderFactory.getProvider(PROVIDERS.OPENAI);

    const { result: response } = await withModelFallback(settings, (model) =>
      provider.chatCompletion(
        {
          model,
          ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
          /* Two short sentences now — the owner's `reason` and the client's
             `opening` — plus the JSON around them. */
          max_tokens: 320,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt(input.language) },
            { role: 'user', content: userPrompt(candidates, input) },
          ],
        },
        buildBosCallContext({ userId, area: 'leads', callName: 'reply_recommendation', groupId })
      )
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

    return {
      candidate,
      reason: parsed.data.reason,
      opening: stripUnsafeOpening(parsed.data.opening),
      source: 'llm',
    };
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
    'You also write ONE sentence that the person themselves will read, at the',
    'top of the reply. It is called "opening".',
    '',
    'Rules for "opening":',
    '- Write it TO them, not about them. "reason" is for the business owner;',
    '  "opening" is for the person who wrote in.',
    '- Acknowledge what they actually asked, in their own terms, so a reply',
    '  about a child\'s sleep does not open like a reply about pricing.',
    '- One sentence. No greeting, no sign-off, no list: the email already has',
    '  those around it.',
    '- Never state a price, a date, an availability or any promise about what',
    '  the business will do. You do not know those.',
    '- Never include a link, a URL or any markup. The booking link is placed by',
    '  the email itself.',
    '- If their message is too vague to acknowledge specifically, return an',
    '  empty string rather than a generic pleasantry.',
    `${language ? `- Write it in ${language}.` : ''}`,
    '',
    'Answer as JSON: {"index": <number>, "reason": "<one sentence>", "opening": "<one sentence or empty>"}',
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
