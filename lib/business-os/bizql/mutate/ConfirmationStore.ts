/**
 * Pending-write confirmation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE POINT OF THIS FILE IS THAT THE PLAN IS FROZEN, NOT RE-DERIVED.
 *
 * The naive confirmation flow stores the user's QUESTION and re-plans it after
 * they say yes. That is a time-of-check/time-of-use bug: between "this will
 * cancel 3 bookings — confirm?" and "yes", the underlying data can change, and
 * the user ends up approving one thing and executing another.
 *
 * So what is stored is the RESOLVED plan — concrete ids, concrete values — and
 * confirming replays exactly that. If the world moved on, the write fails on the
 * specific row rather than silently widening.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Persistence reuses `command_sessions`, which already exists with the right
 * shape (`awaiting_confirmation`, a JSONB param bag, and an expiry). No new
 * table, and the TTL means an abandoned confirmation cannot be resurrected days
 * later by someone typing "yes" into an unrelated conversation.
 *
 * @module lib/business-os/bizql/mutate
 */

import { createHash, randomUUID } from 'crypto';
import { createLogger } from '@/lib/logger';
import { commandSessionRepository } from '@/lib/repositories/CommandSessionRepository';
import type { ForEachQuery, MutateQuery, QueryRow } from '../types';

/** A step that changes something. Both kinds can be parked for confirmation. */
export type WriteStep = MutateQuery | ForEachQuery;

const logger = createLogger({ module: 'BizQLConfirmation' });

/** Marker stored in `capability_id` so these sessions are identifiable. */
const CAPABILITY = 'bizql.pending_write';

export interface PendingWrite {
  confirmationId: string;
  /** The frozen, fully-resolved write. Replayed verbatim on confirm. */
  steps: WriteStep[];
  /**
   * For a fan-out: the exact rows resolved at preview time, keyed by step id.
   *
   * This is the whole point of freezing. Re-running the query on confirm is how
   * a user approves "12 recipients" and, because 28 contacts were imported in
   * the meantime, emails 40 people.
   */
  frozenRows?: Record<string, QueryRow[]>;
  /** What the user was shown. Re-displayed so they confirm what they saw. */
  preview: string[];
  /** The question that produced it, for the audit trail. */
  utterance: string;
  language: string;
}

/**
 * Stable JSON: object keys sorted, recursively.
 *
 * Required because the fingerprint below is computed before storage and checked
 * after reading back, and the round trip goes through Postgres `jsonb` — which
 * does NOT preserve key order. Plain JSON.stringify therefore produces a
 * different string for a semantically identical object, the fingerprint never
 * matches, and every confirmation is silently rejected.
 *
 * That is precisely what happened: park() succeeded, take() always returned
 * null, and no unit test caught it because they mocked the store.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);

  return `{${entries.join(',')}}`;
}

/**
 * Fingerprint of the exact writes the user approved.
 *
 * Stored alongside the plan and re-checked on confirm, so a bug that mutated the
 * stored plan between turns cannot cause an unapproved write to execute.
 */
function fingerprint(steps: WriteStep[]): string {
  return createHash('sha256').update(stableStringify(steps)).digest('hex').slice(0, 16);
}

export class ConfirmationStore {
  /** Park a write and return the id the user's "yes" will refer to. */
  async park(args: {
    userId: string;
    steps: WriteStep[];
    preview: string[];
    utterance: string;
    language: string;
    frozenRows?: Record<string, QueryRow[]>;
  }): Promise<PendingWrite> {
    const confirmationId = randomUUID();

    const pending: PendingWrite = {
      confirmationId,
      steps: args.steps,
      frozenRows: args.frozenRows,
      preview: args.preview,
      utterance: args.utterance,
      language: args.language,
    };

    // One pending write at a time. An older confirmation left lying around is
    // how "yes" ends up applying to the wrong thing.
    await this.clear(args.userId);

    const { data: session, error } = await commandSessionRepository.create(
      args.userId,
      CAPABILITY,
      {
        confirmation_id: confirmationId,
        steps: args.steps,
        // Only the ids and the fields a fan-out actually reads are kept, so an
        // abandoned confirmation does not park a copy of the user's contact list
        // in a session row.
        frozen_rows: args.frozenRows,
        preview: args.preview,
        utterance: args.utterance,
        language: args.language,
        fingerprint: fingerprint(args.steps),
      },
      []
    );

    if (error || !session) {
      logger.error({ err: error }, 'Could not park pending write');
      throw error ?? new Error('Could not park pending write');
    }

    // The repository creates sessions in its default status, so move it to
    // awaiting_confirmation explicitly — `take()` refuses anything else, and a
    // parked write that cannot be taken is a silently broken confirmation.
    await commandSessionRepository.update(session.id, args.userId, {
      status: 'awaiting_confirmation',
    } as never);

    logger.info(
      { userId: args.userId, confirmationId, steps: args.steps.length },
      'Write parked awaiting confirmation'
    );

    return pending;
  }

  /**
   * Retrieve the frozen write, verifying it is unchanged.
   *
   * Returns null when there is nothing pending or it has expired — in which case
   * a bare "yes" must do nothing at all, rather than guess at intent.
   */
  async take(userId: string): Promise<PendingWrite | null> {
    const { data: session, error } = await commandSessionRepository.getActiveSession(userId);

    if (error || !session) return null;
    if (session.capability_id !== CAPABILITY) return null;
    if (session.status !== 'awaiting_confirmation') return null;

    const params = session.resolved_params as Record<string, unknown>;
    const steps = params.steps as WriteStep[] | undefined;

    if (!Array.isArray(steps) || steps.length === 0) return null;

    if (params.fingerprint !== fingerprint(steps)) {
      // The stored plan does not match what was approved. Refuse rather than
      // execute something the user never saw.
      logger.error({ userId, sessionId: session.id }, 'Pending write failed its fingerprint');
      await this.clear(userId);
      return null;
    }

    return {
      confirmationId: String(params.confirmation_id ?? session.id),
      steps,
      frozenRows: (params.frozen_rows as Record<string, QueryRow[]>) ?? undefined,
      preview: (params.preview as string[]) ?? [],
      utterance: String(params.utterance ?? ''),
      language: String(params.language ?? 'en'),
    };
  }

  /** Drop any pending write — after execution, cancellation, or a new request. */
  async clear(userId: string): Promise<void> {
    try {
      const { data: session } = await commandSessionRepository.getActiveSession(userId);
      if (session) {
        await commandSessionRepository.terminate(session.id, userId, 'completed');
      }
    } catch (err) {
      logger.debug({ err }, 'Could not clear pending write (non-blocking)');
    }
  }
}

let singleton: ConfirmationStore | null = null;

export function getConfirmationStore(): ConfirmationStore {
  if (!singleton) singleton = new ConfirmationStore();
  return singleton;
}

// =============================================================================
// AFFIRMATION DETECTION
// =============================================================================

/**
 * Recognise a bare yes/no reply to a confirmation prompt.
 *
 * This is a short, closed list and it is NOT the return of phrase matching: it
 * only ever runs when a confirmation is already pending, so it decides between
 * exactly three outcomes (proceed / cancel / not an answer) rather than trying
 * to classify open-ended intent. Anything unrecognised falls through to the
 * planner, which is the safe default — an unclear reply must never be read as
 * approval.
 */
// NOTE: `\b` is NOT usable here. JavaScript word boundaries are defined over
// [A-Za-z0-9_], so `\b` after "כן" or "sí" never matches — which silently meant
// Hebrew and Spanish users could not confirm anything. Match an explicit
// terminator instead: end of string, whitespace, or punctuation.
const TERMINATOR = '(?=$|[\\s,.!?…])';

const AFFIRM = new RegExp(
  `^(y|yes|yep|yeah|ok|okay|sure|confirm|do it|go ahead|כן|אישור|בסדר|אשר|si|sí|vale|dale|claro)${TERMINATOR}`,
  'i'
);

const DENY = new RegExp(
  `^(n|no|nope|cancel|stop|don'?t|nevermind|never mind|לא|ביטול|בטל|עצור|cancelar|para)${TERMINATOR}`,
  'i'
);

export type ConfirmationReply = 'confirm' | 'cancel' | 'unrelated';

export function readConfirmationReply(message: string): ConfirmationReply {
  const text = message.trim();
  // Check denial first: "no, cancel" starts with a word that both could match.
  if (DENY.test(text)) return 'cancel';
  if (AFFIRM.test(text)) return 'confirm';
  return 'unrelated';
}
