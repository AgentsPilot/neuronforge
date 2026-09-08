/**
 * A write that is under way but not yet complete.
 *
 * The sibling of ConfirmationStore. That one parks a write the user must
 * APPROVE; this one parks a write the user must still FINISH — it is missing a
 * required value, and the next message supplies it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS — the bug it replaces
 *
 * Asking for a missing field used to be stateless: the route returned `needs`,
 * the client rendered "I need a few more details: title", and the server kept
 * nothing. The user's answer therefore arrived as a brand new request and was
 * PLANNED, not filled.
 *
 *   "הוסף משימה לדויד המלך"      -> which title?
 *   "לוודא שהוחזר הכסף"          -> [a list of refunds]
 *
 * The reply was meant as the task's title. Read on its own it is also a
 * perfectly good question about refunds, so the planner answered that instead.
 *
 * Recording the question as context and asking the model to combine the two was
 * tried first and does not work: across nine runs and three phrasings of the
 * pending question, the planner produced a refunds query every time. This is not
 * a prompt that needs sharpening. Mid-write, the next message is an ANSWER, and
 * that is a fact about the conversation's state — not something to re-infer from
 * the words each turn. Inference is what got it wrong.
 *
 * So the state is stored, and while it is set there is no planning at all: the
 * reply fills the field. The user leaves by cancelling, never by being guessed
 * out of it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql/mutate
 */

import { randomUUID } from 'crypto';
import { createLogger } from '@/lib/logger';
import { commandSessionRepository } from '@/lib/repositories/CommandSessionRepository';
import type { MutateQuery } from '../types';

const logger = createLogger({ module: 'BizQLPendingFill' });

/** Marker stored in `capability_id`, so these are distinguishable from writes awaiting a yes. */
const CAPABILITY = 'bizql.pending_fill';

export interface PendingFill {
  fillId: string;
  /**
   * The write so far: target and references already resolved, data partly
   * filled. Each answer lands in here and the whole thing is re-validated.
   */
  step: MutateQuery;
  /**
   * Field keys still needed, in catalog order, with their display labels.
   *
   * The head of the list is what was just asked for. The executor reports every
   * missing field at once, but a single free-text reply can only answer one of
   * them — so they are filled one per turn rather than split by guesswork.
   *
   * The KEY, not the column: an answer is written into `step.data` under its
   * field key, because `mapWritableData` resolves keys against the catalog and
   * rejects anything else.
   */
  remaining: Array<{ key: string; label: string }>;
  /** The request that started this, kept for the audit trail and the final apply. */
  utterance: string;
  language: string;
  /** Carried so the completed write previews with the same names it resolved. */
  targetName?: string;
  referenceNames?: Record<string, string>;
}

export class PendingFillStore {
  /** Park an incomplete write and return it. */
  async park(args: {
    userId: string;
    step: MutateQuery;
    remaining: PendingFill['remaining'];
    utterance: string;
    language: string;
    targetName?: string;
    referenceNames?: Record<string, string>;
  }): Promise<PendingFill> {
    const fillId = randomUUID();

    const pending: PendingFill = {
      fillId,
      step: args.step,
      remaining: args.remaining,
      utterance: args.utterance,
      language: args.language,
      targetName: args.targetName,
      referenceNames: args.referenceNames,
    };

    // One at a time, for the same reason a confirmation is: a stale half-written
    // task lying around is how the next answer lands on the wrong write.
    await this.clear(args.userId);

    const { data: session, error } = await commandSessionRepository.create(
      args.userId,
      CAPABILITY,
      {
        fill_id: fillId,
        step: args.step,
        remaining: args.remaining,
        utterance: args.utterance,
        language: args.language,
        target_name: args.targetName,
        reference_names: args.referenceNames,
      },
      /*
       * The still-missing keys, which is what `pending_params` is for. Passing
       * them makes the repository open the session as `gathering_params` on its
       * own, so there is no follow-up status write to get wrong.
       *
       * Deliberately NOT `awaiting_confirmation`: nothing here is approved — it
       * is not even complete. Reusing that status would make a half-written task
       * visible to `ConfirmationStore.take()`, where a bare "yes" would execute
       * a write the user never saw in full.
       */
      args.remaining.map((f) => f.key)
    );

    if (error || !session) {
      logger.error({ err: error }, 'Could not park incomplete write');
      throw error ?? new Error('Could not park incomplete write');
    }

    logger.info(
      { userId: args.userId, fillId, entity: args.step.entity, action: args.step.action,
        remaining: args.remaining.map((f) => f.key) },
      'Incomplete write parked awaiting a value'
    );

    return pending;
  }

  /** The write in progress, or null if there is none. */
  async take(userId: string): Promise<PendingFill | null> {
    const { data: session, error } = await commandSessionRepository.getActiveSession(userId);

    if (error || !session) return null;
    if (session.capability_id !== CAPABILITY) return null;
    if (session.status !== 'gathering_params') return null;

    const params = session.resolved_params as Record<string, unknown>;
    const step = params.step as MutateQuery | undefined;
    const remaining = params.remaining as PendingFill['remaining'] | undefined;

    // A parked fill with nothing left to ask is not a fill. Refuse rather than
    // apply a write by way of an empty loop.
    if (!step || !Array.isArray(remaining) || remaining.length === 0) return null;

    return {
      fillId: String(params.fill_id ?? session.id),
      step,
      remaining,
      utterance: String(params.utterance ?? ''),
      language: String(params.language ?? 'en'),
      targetName: params.target_name ? String(params.target_name) : undefined,
      referenceNames: (params.reference_names as Record<string, string>) ?? undefined,
    };
  }

  /** Drop it — completed, cancelled, or superseded. */
  async clear(userId: string): Promise<void> {
    try {
      const { data: session } = await commandSessionRepository.getActiveSession(userId);
      if (session) {
        await commandSessionRepository.terminate(session.id, userId, 'completed');
      }
    } catch (err) {
      logger.debug({ err }, 'Could not clear pending fill (non-blocking)');
    }
  }
}

let singleton: PendingFillStore | null = null;

export function getPendingFillStore(): PendingFillStore {
  if (!singleton) singleton = new PendingFillStore();
  return singleton;
}

// =============================================================================
// LEAVING THE WRITE
// =============================================================================

/*
 * Whole-message match, and that is the entire point of not reusing
 * `readConfirmationReply`.
 *
 * That one matches a PREFIX, which is right for a yes/no prompt where the whole
 * message is the answer. Here the message is free text a user chose, and the
 * prefix rule would read the title "לא לשכוח להתקשר" ("don't forget to call")
 * as a cancellation and silently bin the task. A field value that happens to
 * begin with "no" is a normal thing to write; only a message that is NOTHING but
 * a cancel word means cancel.
 *
 * The cost is that "no, forget it" does not cancel. That is the safe direction
 * to fail: the user is told what is still pending and can say "cancel" alone.
 */
const CANCEL_ONLY =
  /^(cancel|stop|nevermind|never mind|forget it|ביטול|בטל|בטלי|עצור|עזוב|cancelar|olvídalo|olvidalo)[.!]?$/i;

export function isCancelMessage(message: string): boolean {
  return CANCEL_ONLY.test(message.trim());
}
