/**
 * The note a client receives when their refund request is declined.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS DRAFTED AND NOT TEMPLATED
 *
 * Approving a refund sends a template, and that is right: "$40 refunded" is
 * good news in a predictable shape, and a form of words serves it well.
 *
 * A decline is the opposite. The client asked for their own money back and is
 * being told no, against a reason they chose and words they wrote. A form
 * letter for that reads as contempt — and the one thing that makes it bearable
 * is that it answers what they actually said.
 *
 * So the model writes the first draft and never the last word: the owner reads
 * it, edits it, and presses send. Nothing leaves without a person having seen
 * it. That is also why `templateFallback` for this action is declared
 * `'missing'`: with the call switched off or failing, decline sends nothing at
 * all, which is precisely what it did before this existed. Nobody is left
 * worse off than they were.
 *
 * Attribution follows the Business OS standards: a catalogued call name, the
 * account resolved server-side by the caller, one grouping id per action, the
 * model and temperature from the `payments` area row, and the whole thing
 * wrapped by the caller in `runAiAction`.
 *
 * @module lib/payments/draftRefundDecline
 */

import { ProviderFactory } from '@/lib/ai/providerFactory';
import { buildBosCallContext } from '@/lib/business-os/llm/callCatalog';
import { withModelFallback } from '@/lib/business-os/llm/modelFallback';
import { resolveBosLlmSettings } from '@/lib/business-os/llm/modelSettings';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'draftRefundDecline', service: 'business-os' });

/** What the client asked for, and what the business can see about it. */
export interface RefundDeclineFacts {
  /** The business's own name, as the client knows it. */
  businessName: string;
  /** What to call them. A first name where there is one. */
  clientName: string;
  /** What they asked for, already formatted with its currency. */
  amountAsked: string;
  /** The reason they picked on the form, in their own vocabulary. */
  reason: string | null;
  /** Anything they typed. Their words are the thing worth answering. */
  note: string | null;
  /** What they bought, where it is known. */
  serviceName: string | null;
  /** The language the business writes to its clients in. */
  language: string;
}

/**
 * The draft, or `null` when the area is switched off or the model refuses.
 *
 * Never throws: the caller is in the middle of recording a decision about
 * money, and a drafting failure must not cost them that. It costs them the
 * message, which they can still write themselves.
 */
export async function draftRefundDecline(
  facts: RefundDeclineFacts,
  owner: { userId: string; groupId: string }
): Promise<string | null> {
  const settings = await resolveBosLlmSettings('payments', 'refund_decline_draft');

  if (!settings.enabled) {
    logger.info(
      { userId: owner.userId, reason: 'disabled' },
      'Refund decline drafting is switched off; the owner writes the message'
    );
    return null;
  }

  try {
    const provider = ProviderFactory.getProvider('openai');

    /* Built INSIDE the callback so a retry carries the model that ran, rather
       than re-sending the one that was just refused. */
    const { result: completion } = await withModelFallback(settings, (model) =>
      provider.chatCompletion(
        {
          model,
          messages: [{ role: 'user', content: buildPrompt(facts) }],
          ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
          max_tokens: 260,
        },
        buildBosCallContext(
          {
            userId: owner.userId,
            area: 'payments',
            callName: 'refund_decline_draft',
            groupId: owner.groupId,
          },
          { activity_type: 'draft' }
        )
      )
    );

    const draft = (completion.choices[0]?.message?.content ?? '').trim();

    if (!draft) {
      logger.warn({ userId: owner.userId }, 'Refund decline draft came back empty');
      return null;
    }

    /* Length only. The draft is written FROM what the client typed, so it is
       owner-and-client text and never goes to a logger above debug. */
    logger.info({ userId: owner.userId, length: draft.length }, 'Drafted a refund decline');
    logger.debug({ userId: owner.userId, draft }, 'The refund decline draft');

    return draft;
  } catch (error) {
    logger.error(
      { errName: (error as Error)?.name, userId: owner.userId },
      'Could not draft a refund decline; the owner writes the message'
    );
    return null;
  }
}

/**
 * The prompt.
 *
 * Deliberately short on instructions about tone and long on facts. The model
 * writes a better refusal when it knows what was asked and why than when it is
 * told to be warm.
 */
function buildPrompt(facts: RefundDeclineFacts): string {
  const lines = [
    `You are writing on behalf of ${facts.businessName}.`,
    `${facts.clientName} asked for ${facts.amountAsked} back and the owner has decided not to refund it.`,
    '',
    'WHAT THEY ASKED',
    facts.serviceName ? `  what they bought: ${facts.serviceName}` : null,
    facts.reason ? `  the reason they picked: ${facts.reason}` : null,
    facts.note ? `  what they wrote: "${facts.note}"` : null,
    '',
    'WRITE THE MESSAGE THEY WILL RECEIVE.',
    '',
    '- Answer what they actually said. If they gave a reason, it is the thing',
    '  to respond to; a note that ignores it reads as a form letter.',
    '- Say no plainly, once, near the start. A refusal buried under three',
    '  paragraphs of sympathy is worse than a short one.',
    '- Do not invent a policy, a rule, a deadline, or a reason the owner has',
    '  not given you. If there is no reason to give, say the owner has looked',
    '  at it and cannot refund this one.',
    '- Do not promise anything: no partial refund, no credit, no exception.',
    '- Leave a way to reply. They may know something the owner does not.',
    '- Four sentences at most. No subject line, no greeting block, no sign-off',
    '  name — the message is sent under the business\'s own name.',
    `- Write it in ${facts.language}.`,
  ];

  return lines.filter((line) => line !== null).join('\n');
}
