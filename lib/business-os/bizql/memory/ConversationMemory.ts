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
  /** id + label only. Never the full row: this is context, not a data store. */
  items: Array<{ id: string; label: string }>;
  at: string;
}

export interface ConversationContext {
  turns: RememberedTurn[];
  lastRows?: RememberedRows;
  /** Set when the previous turn asked something and is awaiting an answer. */
  pendingQuestion?: string;
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
  }

  if (context.lastRows && context.lastRows.items.length > 0) {
    const rows = context.lastRows.items
      .map((r, i) => `  ${i + 1}. ${r.label} (id ${r.id})`)
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
        `When you do use an id, copy it CHARACTER FOR CHARACTER — a dropped character ` +
        `makes it invalid.`
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
