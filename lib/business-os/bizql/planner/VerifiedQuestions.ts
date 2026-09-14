/**
 * A business teaching the planner its own words.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY LABELS COULD NOT CLOSE THIS
 *
 * "Quotes that are still open" arrives as "פתוחות", "טרם נענו", "ממתינות
 * להחלטה", "תלוי באוויר". Measured across four phrasings of two intents, one of
 * each planned correctly — and the fix that worked for one phrasing ("שלחתי"
 * added to a label) did nothing for the other three conjugations. Bounded work
 * against unbounded phrasing loses, and it loses quietly: the test that found
 * the failure goes green while the product does not move.
 *
 * The phrasings are therefore not enumerated. They are LEARNED. Every time a
 * user taps a correction chip they produce a labelled pair — this question,
 * that plan — and a few of those, retrieved by similarity and shown as
 * examples, teach the mapping for wordings nobody wrote down. It is how the
 * semantic-layer products handle the same problem, and it compounds with use
 * instead of accreting prose that is paid for on every turn.
 *
 * NOT A CACHE. `PlanCache` serves a stored plan for an exact question, and its
 * semantic layer is deliberately switched off because a 0.9 match there ANSWERS
 * a different question. Nothing here is ever served: the examples go into the
 * prompt and the model still plans the question in front of it. That is why a
 * looser threshold is safe here and was not there.
 *
 * PER TENANT. Two Hebrew-speaking businesses phrase the same intent
 * differently, and a plan carries literals — a client's name — that must never
 * reach another tenant's prompt. Scoping to `user_id` removes the question
 * rather than answering it carefully.
 *
 * Everything degrades to nothing: no table, no embeddings, no API key, and the
 * planner runs exactly as it did before.
 *
 * @module lib/business-os/bizql/planner
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { EmbeddingService } from '@/lib/services/EmbeddingService';
import type { Query } from '../types';

const logger = createLogger({ module: 'BizQLVerifiedQuestions' });

const TABLE = 'business_chat_verified_questions';

/** Enough to teach a mapping; few enough to stay cheap. */
const MAX_EXAMPLES = 3;

/** Set once the table is known to be missing, so a migration gap costs one query. */
let unavailable = false;

export interface VerifiedExample {
  question: string;
  steps: Query[];
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || /does not exist|schema cache/i.test(error.message ?? '');
}

/**
 * The question, stripped for de-duplication only.
 *
 * Deliberately cruder than the plan cache's normalisation: this one is not a
 * lookup key, just a way of noticing that the same question has been verified
 * twice.
 */
function normalize(question: string): string {
  return question.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 400);
}

async function embed(
  text: string,
  userId: string,
  turnId?: string
): Promise<number[] | null> {
  try {
    const service = new EmbeddingService(process.env.OPENAI_API_KEY!, supabaseServer);
    const { embedding } = await service.generateEmbedding(text, {
      userId,
      feature: 'business-os-chat',
      turnId,
    });

    return embedding;
  } catch (err) {
    logger.warn({ err }, 'Could not embed; verified questions are unavailable for this turn');
    return null;
  }
}

export class VerifiedQuestions {
  /**
   * Does this tenant have anything to teach yet?
   *
   * Asked before embedding, because the embedding is the only cost on this path
   * and a business that has never corrected anything must not pay it. One
   * counting query against an indexed column, and a `head` request at that.
   */
  async has(userId: string): Promise<boolean> {
    if (unavailable) return false;

    try {
      const { count, error } = await supabaseServer
        .from(TABLE)
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (isMissingTable(error)) {
        unavailable = true;
        logger.warn(
          { table: TABLE },
          'Verified questions table not found — the planner will run without examples. ' +
            'Apply supabase/migrations/20260922_verified_questions.sql.'
        );
        return false;
      }

      return (count ?? 0) > 0;
    } catch {
      return false;
    }
  }

  /** The nearest questions this business has already had answered correctly. */
  async similar(args: {
    userId: string;
    question: string;
    language: string;
    turnId?: string;
  }): Promise<VerifiedExample[]> {
    if (!(await this.has(args.userId))) return [];

    const embedding = await embed(args.question, args.userId, args.turnId);
    if (!embedding) return [];

    try {
      const { data, error } = await supabaseServer.rpc('match_verified_questions', {
        query_embedding: JSON.stringify(embedding),
        p_user_id: args.userId,
        p_language: args.language,
        result_limit: MAX_EXAMPLES,
      });

      if (error) throw error;

      const rows = (data ?? []) as Array<{ id: string; question: string; steps: Query[] }>;

      // Fire and forget: a use count is for pruning later, never for this turn.
      if (rows.length > 0) {
        void supabaseServer
          .rpc('increment_verified_question_uses', { p_ids: rows.map((r) => r.id) })
          .then(undefined, () => {});
      }

      return rows.map((row) => ({ question: row.question, steps: row.steps }));
    } catch (err) {
      logger.warn({ err }, 'Verified question lookup failed; planning without examples');
      return [];
    }
  }

  /**
   * Record a question and the plan that answered it.
   *
   * @param source `correction` when the user tapped an alternative — them
   *   saying "that one, not the one you chose", which is the strongest signal
   *   available. `accepted` for an answer that simply stood.
   */
  async remember(args: {
    userId: string;
    question: string;
    language: string;
    steps: Query[];
    source: 'correction' | 'accepted';
    turnId?: string;
  }): Promise<void> {
    if (unavailable) return;

    /*
     * Reads only, and only steps that filter something.
     *
     * A write is not a lookup to be generalised from, and an example with no
     * `where` teaches nothing — the interesting part of a plan is which rows it
     * chose, and a plan that chose all of them has made no choice.
     */
    const steps = args.steps.filter(
      (step) =>
        (step.op === 'find' || step.op === 'compute') &&
        ((step as { where?: unknown[] }).where?.length ?? 0) > 0
    );

    if (steps.length === 0) return;

    const embedding = await embed(args.question, args.userId, args.turnId);
    if (!embedding) return;

    try {
      const { error } = await supabaseServer.from(TABLE).upsert(
        {
          user_id: args.userId,
          question: args.question.slice(0, 2000),
          question_normalized: normalize(args.question),
          language: args.language,
          embedding: JSON.stringify(embedding),
          // The answer sentence is deliberately not stored: the example teaches
          // which rows to fetch, and the wording belongs to the turn asking.
          steps,
          source: args.source,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,question_normalized,language' }
      );

      if (isMissingTable(error)) unavailable = true;
      else if (error) logger.warn({ err: error }, 'Could not store a verified question');
      else logger.info({ userId: args.userId, source: args.source }, 'Verified question stored');
    } catch (err) {
      logger.warn({ err }, 'Verified question store failed; continuing');
    }
  }
}

let singleton: VerifiedQuestions | null = null;

export function getVerifiedQuestions(): VerifiedQuestions {
  if (!singleton) singleton = new VerifiedQuestions();
  return singleton;
}

/** Test seam. */
export function resetVerifiedQuestions(): void {
  singleton = null;
  unavailable = false;
}

/**
 * Render examples for the prompt.
 *
 * Compact on purpose: the entity, the aggregate and the filters, which is the
 * whole of what an example teaches. Empty string when there are none, so a
 * business that has corrected nothing pays not a single token.
 */
export function renderExamplesForPrompt(examples: VerifiedExample[]): string {
  if (examples.length === 0) return '';

  const lines = examples.map((example) => {
    const steps = example.steps.map((step) => {
      // `Query` is a union and an analyse step has no entity; these are all
      // reads by construction, and the cast says so once rather than per field.
      const read = step as { entity: string; op: string; agg?: unknown; where?: unknown };

      return {
        entity: read.entity,
        ...(read.op === 'compute' ? { agg: read.agg } : { op: 'find' }),
        where: read.where,
      };
    });

    return `  "${example.question}" -> ${JSON.stringify(steps)}`;
  });

  return (
    `ANSWERED CORRECTLY FOR THIS BUSINESS BEFORE — same words, same meaning:\n${lines.join('\n')}\n` +
    `These are how THIS user says things. Match the wording of the request against them: a ` +
    `question phrased like one of these wants the same entity and the same filters, with only ` +
    `what the new message changes. They are examples, not answers — plan the request in front ` +
    `of you.`
  );
}
