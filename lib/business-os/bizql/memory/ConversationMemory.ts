/**
 * Conversation memory — what makes a second turn possible.
 *
 * Keeps a small rolling window per user: the last few turns, and the last set of
 * rows shown. That is enough to resolve the two things a single-turn planner
 * cannot:
 *
 *   1. PRONOUNS AND ORDINALS — "show him", "mark the first one paid". Meaningless
 *      without knowing what was just displayed.
 *
 *   2. ANSWERS TO CLARIFYING QUESTIONS — asking "which contact?" is only useful
 *      if the reply ("אופיר") can be combined with the original request. Without
 *      that, the chat asks, receives an answer, and asks again.
 *
 * Deliberately NOT a transcript. Chat history is not a system of record, and
 * storing customer conversations indefinitely would be a liability with no
 * matching benefit. Old turns roll off; stale context is ignored on read.
 *
 * Everything here degrades to "no memory". If the table is missing or a read
 * fails, the chat behaves exactly as it did before — single-turn — rather than
 * failing.
 *
 * @module lib/business-os/bizql/memory
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'BizQLConversation' });

const TABLE = 'business_chat_conversation';

/** Turns kept. Enough for a clarification exchange, short enough to stay cheap. */
const MAX_TURNS = 4;

/** Rows remembered from the last result. Enough for "the third one". */
const MAX_ROWS = 10;

/**
 * Context older than this is ignored.
 *
 * A question asked this morning is not context for one asked this afternoon, and
 * silently resolving "him" against a stale result is worse than asking again.
 */
const STALE_AFTER_MINUTES = 30;

export interface RememberedTurn {
  utterance: string;
  /** One-line summary of what was planned, not the whole plan. */
  summary: string;
  at: string;
}

export interface RememberedRows {
  entity: string;
  /**
   * id + label only. Never the full row: this is context, not a data store.
   *
   * `refs` is the exception, and a narrow one: the ids this row POINTS AT, so a
   * follow-up about the person in it has a correct id to use. Without them a
   * booking remembers only its own id while being labelled with its client's
   * name, and "did this customer pay?" filtered contacts by a booking id.
   */
  items: Array<{ id: string; label: string; refs?: Record<string, string> }>;
  at: string;
}

export interface ConversationContext {
  turns: RememberedTurn[];
  lastRows?: RememberedRows;
  /** Set when the previous turn asked something and is awaiting an answer. */
  pendingQuestion?: string;
  /**
   * The plan behind the last answer, so a correction costs no model call.
   *
   * The answer line offers one-tap alternatives ("no-show?", "net?"). Re-running
   * with one substituted must not go back to the planner: that would be a second
   * charge for a question already understood, and the model might plan it
   * differently the second time — the user would tap "no-show" and get a
   * different query, not the same query about no-shows.
   *
   * Server-side rather than round-tripped through the client, because a plan
   * arriving from a browser is a plan we did not write.
   */
  lastPlan?: RememberedPlan;
  /**
   * The plan BEFORE that one.
   *
   * Kept for a single purpose: a question that names its entity but adds no
   * filter, right after a filtered answer about the same entity, is ambiguous —
   * "מה הסך הכולל של ההצעות" after listing four accepted quotes means those
   * four to the person asking and all seven to the planner. Both readings are
   * defensible, so the turn offers the other one as a chip, and applying it
   * needs the filters from the turn before this one.
   */
  priorPlan?: RememberedPlan;
  /**
   * Choices the user has made, so the same question is asked once.
   *
   * Keyed `entity.field` -> the field to aggregate. The gross/net question is
   * the one that has bitten: `transactions.amount` has two defensible totals,
   * and asking on every turn would be as bad as guessing on every turn.
   */
  preferences?: Record<string, string>;
}

export interface RememberedPlan {
  /** The steps as planned. Reads only — a write is never re-run from a tap. */
  steps: unknown[];
  answer?: { text: string; primary_step?: string };
  at: string;
}

const EMPTY: ConversationContext = { turns: [] };

let unavailable = false;

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || /does not exist|schema cache/i.test(error.message ?? '');
}

export class ConversationMemory {
  async load(userId: string): Promise<ConversationContext> {
    if (unavailable) return EMPTY;

    try {
      const { data, error } = await supabaseServer
        .from(TABLE)
        .select('context, updated_at')
        .eq('user_id', userId)
        .maybeSingle();

      if (isMissingTable(error)) {
        unavailable = true;
        logger.warn(
          { table: TABLE },
          'Conversation memory table not found — the chat will be single-turn. ' +
            'Apply supabase/migrations/20260826_business_chat_conversation.sql.'
        );
        return EMPTY;
      }

      if (error || !data) return EMPTY;

      const ageMinutes = (Date.now() - new Date(data.updated_at as string).getTime()) / 60_000;
      if (ageMinutes > STALE_AFTER_MINUTES) return EMPTY;

      return (data.context as ConversationContext) ?? EMPTY;
    } catch (err) {
      logger.warn({ err }, 'Could not load conversation context; continuing without it');
      return EMPTY;
    }
  }

  async save(userId: string, context: ConversationContext): Promise<void> {
    if (unavailable) return;

    try {
      const trimmed: ConversationContext = {
        turns: context.turns.slice(-MAX_TURNS),
        lastRows: context.lastRows
          ? { ...context.lastRows, items: context.lastRows.items.slice(0, MAX_ROWS) }
          : undefined,
        pendingQuestion: context.pendingQuestion,
        // Only a read plan is worth keeping: an alternative re-runs a query,
        // never a write, and a stored mutate would be a loaded gun.
        lastPlan: context.lastPlan
          ? {
              ...context.lastPlan,
              steps: context.lastPlan.steps.filter(
                (step) => (step as { op?: string }).op !== 'mutate'
              ),
            }
          : undefined,
        priorPlan: context.priorPlan
          ? {
              ...context.priorPlan,
              steps: context.priorPlan.steps.filter(
                (step) => (step as { op?: string }).op !== 'mutate'
              ),
            }
          : undefined,
        preferences: context.preferences,
      };

      const { error } = await supabaseServer.from(TABLE).upsert(
        { user_id: userId, context: trimmed, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );

      if (isMissingTable(error)) unavailable = true;
      else if (error) logger.warn({ err: error }, 'Could not save conversation context');
    } catch (err) {
      logger.warn({ err }, 'Conversation save failed; continuing');
    }
  }

  async clear(userId: string): Promise<void> {
    if (unavailable) return;
    try {
      await supabaseServer.from(TABLE).delete().eq('user_id', userId);
    } catch {
      // Non-blocking: failing to forget is not worth interrupting a turn.
    }
  }
}

/**
 * Render context for the planner prompt.
 *
 * Short by design — this is added to every turn, so it must not undo the token
 * work. Empty string when there is nothing worth saying.
 */
export function renderContextForPrompt(context: ConversationContext): string {
  const parts: string[] = [];

  if (context.pendingQuestion) {
    // The decisive line. Without it the model treats "אופיר" as a brand new
    // request rather than the answer to what it just asked.
    parts.push(
      `You asked the user: "${context.pendingQuestion}"\n` +
        `Their message is almost certainly the ANSWER to that question. Combine the two ` +
        `into one complete request and plan it — do not ask the same thing again.\n` +
        `(Unless they clearly changed the subject, in which case answer the new request.)`
    );
  }

  /*
   * The QUERY behind the last answer, stated exactly.
   *
   * The turn summary says "compute proposals" — the entity and the operation,
   * and nothing about the filter. So a follow-up inherited nothing: asked "how
   * many quotes were accepted" and then "what is their total", the planner
   * summed every current quote (₪45,850) and threw in the service list (₪1,300)
   * for good measure, against a true answer of ₪15,850. "Them" had a precise
   * referent one line earlier and the prompt did not carry it.
   *
   * Rendered by `describePlan`, which is the same sentence shown to the USER
   * next to that answer — so the model and the reader are told the same thing,
   * and there is one implementation of "what did that query do".
   */
  const lastSteps = (context.lastPlan?.steps ?? []) as Array<Record<string, unknown>>;

  if (lastSteps.length > 0) {
    /*
     * The rows the last answer was about, AS JSON to copy.
     *
     * The prose version said "repeat those filters exactly" — and the model
     * repeated the SHAPE instead. Asked for "the total of them" after a
     * two-step "4 of 7, 57%", it produced another two-step X-of-Y: summed every
     * quote, compared it to an unrelated payments figure, and reported 2,042%.
     * It copied the pattern and dropped the filter, which is the opposite of
     * what was asked.
     *
     * So it is handed the thing to copy, in the form it will be copied into.
     * Entity and `where` only — the aggregate is what the new message changes,
     * and including it invites the old one back.
     */
    const rows = lastSteps
      .filter((step) => step.op === 'find' || step.op === 'compute')
      .map((step) => JSON.stringify({ entity: step.entity, where: step.where ?? [] }))
      .join('\n  ');

    if (rows) {
      parts.push(
        `Your last answer was about these rows:\n  ${rows}\n` +
          `A follow-up with no subject of its own — "their total", "and the sum", "how ` +
          `many of those", "show them" — is about THOSE rows: copy the entity and the ` +
          `where VERBATIM and change only the aggregate. Never drop a filter, and never ` +
          `add a step the new message did not ask for.`
      );
    }
  }

  if (context.turns.length > 0) {
    const recent = context.turns
      .slice(-3)
      .map((t) => `  "${t.utterance}" -> ${t.summary}`)
      .join('\n');
    parts.push(`Earlier in this conversation:\n${recent}`);

    /*
     * What the LAST question was about, said plainly.
     *
     * "Them" and "their total" refer to whatever the previous turn was about —
     * and that subject was only ever implied by a one-line summary, while the
     * remembered ROWS below announced themselves as "you last showed these X".
     * Asked "how many refunds were made?" and then "what is their total?", the
     * planner summed transactions: the rows block was still naming services
     * from two turns earlier, and it was the louder signal.
     *
     * A turn that aggregates has no rows to remember but still fixes what the
     * conversation is about, which is exactly what a bare pronoun needs.
     */
    const last = context.turns[context.turns.length - 1];
    const subject = /\b(?:find|compute)\s+(\w+)/.exec(last.summary)?.[1];

    if (subject) {
      parts.push(
        `The last question was about ${subject}. A bare "them", "their", "it" or ` +
          `"the total" with no other subject refers to ${subject} — not to any ` +
          `earlier list.`
      );
    }

    /*
     * A question that RELATED two figures leaves the relationship as the thing
     * being referred to, not just the entities.
     *
     * "חשב לי את האחוז" — work out the percentage — followed a turn that had
     * just compared refunds with revenue, and the planner ignored it entirely:
     * three runs out of three it invented a different percentage, clients out of
     * leads, over an entity nobody had mentioned. Not confusion — a confident
     * answer to a question that was never asked.
     *
     * "The percentage" is a definite reference exactly as "them" is. The subject
     * line above resolves a NOUN back to its entity; this resolves a
     * relationship back to the pair of figures it was between.
     */
    const measures = [...last.summary.matchAll(/\b(?:find|compute)\s+(\w+)/g)].map((m) => m[1]);

    if (measures.length >= 2) {
      parts.push(
        `That question compared ${measures.join(' with ')}. A bare "the percentage", ` +
          `"the ratio", "the difference" or "work it out" with no other subject means ` +
          `THAT comparison — fetch the same figures again and relate them. Do not pick a ` +
          `different pair to compare.`
      );
    }
  }

  if (context.lastRows && context.lastRows.items.length > 0) {
    /*
     * Each row's own id, then the ids it points at, named by what they ARE.
     *
     * A booking is labelled with its client's name, so the list reads as people
     * however clearly the line above calls them bookings. Asked "did this
     * customer pay?", the planner had exactly one id available and used it —
     * against `contacts`, where a booking id matches nothing, and the answer
     * came back "contacts: 0" for a client who had paid.
     */
    const rows = context.lastRows.items
      .map((r, i) => {
        const refs = Object.entries(r.refs ?? {})
          .map(([entity, id]) => `, its ${entity} id ${id}`)
          .join('');
        return `  ${i + 1}. ${r.label} (id ${r.id}${refs})`;
      })
      .join('\n');

    /*
     * Say WHEN these rows were shown.
     *
     * Presented flatly as "you last showed these", a list survived every later
     * turn and kept claiming to be the most recent thing on screen. It is only
     * that if the previous turn produced it.
     */
    const lastTurn = context.turns[context.turns.length - 1];
    const isCurrent =
      !lastTurn || !context.lastRows.at || context.lastRows.at >= lastTurn.at;

    parts.push(
      `${isCurrent ? 'You last showed' : 'Earlier — not in the last question — you showed'}` +
        ` these ${context.lastRows.entity}:\n${rows}\n` +
        `This list exists ONLY to resolve a reference back to it — "it", "him", "her", ` +
        `"that one", "the second one". If the new message does not refer back to these ` +
        `rows, IGNORE this list completely and treat the request as new; re-showing the ` +
        `same rows because they happen to be in context is wrong.\n` +
        (context.lastRows.items.length === 1
          ? /*
             * An instruction to CHANGE something refers back even with no pronoun
             * in it, and saying so is the difference between doing the work and
             * searching for it.
             *
             * The rule above is written for questions, where "does not refer back"
             * means "answer something new". Read literally by a command it says the
             * opposite of what is wanted: "set the priority to urgent" and "סמן את
             * המשימה כבוטלה" contain no "it" and no "that one", so the planner
             * treated them as fresh requests, and a fresh request with nothing to
             * act on becomes a `find`. The user, looking at the one task they just
             * asked about, got it listed back instead of changed.
             *
             * Only when exactly ONE row is remembered. With several, which one is a
             * real question and asking is the correct outcome — that is what the
             * target resolver already does.
             */
            `A command to change, update, mark, set, cancel or delete something, ` +
            `naming no other row, refers to the single row above — act on it by id ` +
            `rather than searching for it again.\n`
          : '') +
        /*
         * Which id, not just which row.
         *
         * Two rules, and the first one is the fix for a real failure: "did this
         * customer pay?" after a booking was listed produced `contacts where id
         * is <booking id>` and answered "contacts: 0" — the client had paid, and
         * the turn before had displayed exactly that.
         */
        `A question about something a row POINTS AT — its customer, its service, ` +
        `its invoice — is a question about THAT entity, and takes the id named ` +
        `for it above. A row's own id only ever matches its own ${context.lastRows.entity}.\n` +
        `If what is being asked is a field you already showed on the row itself — ` +
        `its payment status, its time, its status — answer from ${context.lastRows.entity} ` +
        `rather than looking the related row up at all.\n` +
        `When you do use an id, copy it CHARACTER FOR CHARACTER — a dropped character ` +
        `makes it invalid.`
    );
  }

  /*
   * A choice the user already made, stated as a fact rather than a question.
   *
   * The gross/net ambiguity is the one that produced 56% on one run and 128% on
   * the next. Once they have tapped "net", asking again — or guessing again —
   * is the same failure with extra steps. Two short lines, only present for a
   * user who has actually chosen something, so the common turn pays nothing.
   */
  const preferences = Object.entries(context.preferences ?? {});

  if (preferences.length > 0) {
    parts.push(
      `This user has already settled these:\n` +
        preferences.map(([key, value]) => `  ${key} -> use ${value}`).join('\n') +
        `\nUse that field when the question is about ${preferences
          .map(([key]) => key.split('.')[0])
          .join(', ')} — do not ask again and do not pick the other one.`
    );
  }

  return parts.join('\n\n');
}

let singleton: ConversationMemory | null = null;

export function getConversationMemory(): ConversationMemory {
  if (!singleton) singleton = new ConversationMemory();
  return singleton;
}

/** Test seam. */
export function resetConversationMemory(): void {
  singleton = null;
  unavailable = false;
}
