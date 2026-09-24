/**
 * A write that named a row the user has to choose between.
 *
 * The third sibling of ConfirmationStore and PendingFillStore. That one parks a
 * write the user must APPROVE; the other parks one they must FINISH; this one
 * parks a write that does not yet know WHICH ROW it acts on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS — the bug it replaces
 *
 * Asking which row was stateless. The route resolved "David" to three contacts,
 * rendered them, and returned `choice` keeping NOTHING — so the reply ("the
 * second one") arrived as a brand new request and was PLANNED, not applied to
 * the write already in flight. The planner then had to reconstruct the entire
 * command from three words plus a list of remembered rows.
 *
 * This is the same bug PendingFillStore's header describes for missing VALUES,
 * one field over. The fix is the same shape, and it has to be, because the
 * failure is the same: mid-write, the next message is an ANSWER. That is a fact
 * about the conversation's state, not something to re-infer from the words.
 *
 * Note what this does NOT fix. Ambiguity never wrote the wrong row — several
 * matches has always been a question rather than a guess. What it fixes is that
 * the question used to cost the write: a second model call that could plan a
 * different action or a different value, and then apply it with no confirmation
 * card at all for any action whose risk is low enough not to need one.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PERSISTENCE. `command_sessions`, like both siblings, distinguished by
 * `capability_id` + `status` so a `take()` of the wrong kind sees nothing. The
 * whole payload goes in `resolved_params` as ONE jsonb bag.
 *
 * Deliberately NOT the `pending_choices` column, whose name makes it look like
 * the right home. Its type carries an id, a label and an entity — not the slot,
 * not the frozen steps, not the names, not the language — so using it would
 * split one object across two columns and two non-transactional writes, and
 * `take()` would have to read both and reconcile them. The column belongs to the
 * v1 flow. It is a trap; leave it alone.
 *
 * @module lib/business-os/bizql/mutate
 */

import { randomUUID } from 'crypto';
import { createLogger } from '@/lib/logger';
import { commandSessionRepository } from '@/lib/repositories/CommandSessionRepository';
import { fingerprint } from './fingerprint';
import type { WriteStep } from './ConfirmationStore';
import type { ChoiceSlot, ResolvedCandidate, StepNames } from './resolveWrites';
import type { FindQuery } from '../types';

const logger = createLogger({ module: 'BizQLPendingChoice' });

/** Marker stored in `capability_id`, so these are distinguishable from the siblings. */
const CAPABILITY = 'bizql.pending_choice';

/**
 * Unmatched free-text replies before the choice is abandoned.
 *
 * The two existing rules disagree, and both are wrong on their own here.
 * PendingFill stays parked until an explicit cancel — safest for the write, but
 * a user who changed the subject is trapped. ConfirmationStore drops out to the
 * planner on anything it does not recognise — which is exactly the discard this
 * file exists to prevent, and it would fire on a phrasing the matcher merely
 * failed to parse ("the one from Tuesday").
 *
 * So: re-ask once, then let go. The trap is capped at two turns and a reply that
 * was a real attempt to choose gets a second chance.
 */
const MAX_ATTEMPTS = 2;

/** One row the user can pick, already labelled in their language. */
export type ChoiceCandidate = ResolvedCandidate;

export interface PendingChoice {
  choiceId: string;
  /** The entity the CANDIDATES belong to — not always the step's own entity. */
  entity: string;
  kind: 'none' | 'ambiguous';
  total: number;
  candidates: ChoiceCandidate[];
  slot: ChoiceSlot;
  /**
   * The write, frozen. Steps before the slot are fully pinned; the step at the
   * slot is pinned except for the slot itself.
   *
   * Frozen for the reason ConfirmationStore freezes: the user is choosing from
   * rows that were read at a moment in time, and re-deriving the write from the
   * original sentence on the next turn is the time-of-check/time-of-use bug one
   * layer up.
   */
  steps: WriteStep[];
  /** Positionally aligned with `steps`. Carried, never re-queried. */
  names: StepNames[];
  /**
   * The find steps any `for_each.over` names.
   *
   * A resume turn has no plan to look them up in, and the preview stage needs
   * them to freeze a fan-out's recipients.
   */
  sources: FindQuery[];
  /** The planner's own answer sentence, for the confirmation card on resume. */
  answerText?: string;
  /** Accumulates, same rule as PendingFill: it grounds required text values. */
  utterance: string;
  language: string;
  /** Unmatched free-text replies so far. */
  attempts: number;
}

export class PendingChoiceStore {
  /** Park a write that is waiting on a pick, and return it. */
  async park(args: Omit<PendingChoice, 'choiceId' | 'attempts'> & {
    userId: string;
    attempts?: number;
  }): Promise<PendingChoice> {
    // A parked state the user cannot leave except by cancelling is worse than no
    // state at all — the same guard, for the same reason, as a fill with nothing
    // left to ask for.
    if (args.candidates.length === 0) {
      throw new Error('Refusing to park a choice with no candidates to pick from.');
    }

    const choiceId = randomUUID();

    const pending: PendingChoice = {
      choiceId,
      entity: args.entity,
      kind: args.kind,
      total: args.total,
      candidates: args.candidates,
      slot: args.slot,
      steps: args.steps,
      names: args.names,
      sources: args.sources,
      answerText: args.answerText,
      utterance: args.utterance,
      language: args.language,
      attempts: args.attempts ?? 0,
    };

    // One at a time, like both siblings. A stale question lying around is how
    // the next answer lands on the wrong write.
    await this.clear(args.userId);

    const { data: session, error } = await commandSessionRepository.create(
      args.userId,
      CAPABILITY,
      {
        choice_id: choiceId,
        entity: args.entity,
        kind: args.kind,
        total: args.total,
        candidates: args.candidates,
        slot: args.slot,
        steps: args.steps,
        names: args.names,
        sources: args.sources,
        answer_text: args.answerText,
        utterance: args.utterance,
        language: args.language,
        attempts: pending.attempts,
        fingerprint: fingerprint({
          steps: args.steps,
          slot: args.slot,
          candidateIds: args.candidates.map((c) => c.id),
        }),
      },
      []
    );

    if (error || !session) {
      logger.error({ err: error }, 'Could not park pending choice');
      throw error ?? new Error('Could not park pending choice');
    }

    // The repository derives status from the pending-param list, which is empty
    // here, so move it explicitly. `take()` refuses anything else, and a parked
    // choice that cannot be taken is a silently broken question.
    await commandSessionRepository.update(session.id, args.userId, {
      status: 'awaiting_choice',
    } as never);

    logger.info(
      {
        userId: args.userId,
        choiceId,
        entity: args.entity,
        slot: args.slot.kind,
        candidates: args.candidates.length,
        attempts: pending.attempts,
      },
      'Write parked awaiting a choice of row'
    );

    return pending;
  }

  /** The choice in progress, or null if there is none. */
  async take(userId: string): Promise<PendingChoice | null> {
    const { data: session, error } = await commandSessionRepository.getActiveSession(userId);

    if (error || !session) return null;
    if (session.capability_id !== CAPABILITY) return null;
    if (session.status !== 'awaiting_choice') return null;

    const params = session.resolved_params as Record<string, unknown>;
    const steps = params.steps as WriteStep[] | undefined;
    const candidates = params.candidates as ChoiceCandidate[] | undefined;
    const slot = params.slot as ChoiceSlot | undefined;

    if (!Array.isArray(steps) || steps.length === 0) return null;
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    if (!slot) return null;

    if (
      params.fingerprint !==
      fingerprint({ steps, slot, candidateIds: candidates.map((c) => c.id) })
    ) {
      // The stored write does not match the question that was asked. Refuse
      // rather than pin a row into something the user never saw.
      logger.error({ userId, sessionId: session.id }, 'Pending choice failed its fingerprint');
      await this.clear(userId);
      return null;
    }

    return {
      choiceId: String(params.choice_id ?? session.id),
      entity: String(params.entity ?? ''),
      kind: (params.kind as PendingChoice['kind']) ?? 'ambiguous',
      total: Number(params.total ?? candidates.length),
      candidates,
      slot,
      steps,
      names: (params.names as StepNames[]) ?? [],
      sources: (params.sources as FindQuery[]) ?? [],
      answerText: params.answer_text ? String(params.answer_text) : undefined,
      utterance: String(params.utterance ?? ''),
      language: String(params.language ?? 'en'),
      attempts: Number(params.attempts ?? 0),
    };
  }

  /** Drop it — picked, cancelled, given up on, or superseded. */
  async clear(userId: string): Promise<void> {
    try {
      const { data: session } = await commandSessionRepository.getActiveSession(userId);
      if (session) {
        await commandSessionRepository.terminate(session.id, userId, 'completed');
      }
    } catch (err) {
      logger.debug({ err }, 'Could not clear pending choice (non-blocking)');
    }
  }
}

let singleton: PendingChoiceStore | null = null;

export function getPendingChoiceStore(): PendingChoiceStore {
  if (!singleton) singleton = new PendingChoiceStore();
  return singleton;
}

/** Has this reply used up its second chance? */
export function shouldGiveUp(attempts: number): boolean {
  return attempts + 1 >= MAX_ATTEMPTS;
}

// =============================================================================
// READING THE PICK
// =============================================================================

/**
 * Ordinal words, whole-message, for the only positions that can exist.
 *
 * `MAX_CANDIDATES` is 5, so this vocabulary is closed rather than a sample — and
 * closed is what keeps it honest. It is not phrase matching: it only ever runs
 * while a numbered list is on screen, and it decides between that list's
 * positions and "I didn't understand", nothing else.
 */
const ORDINALS: Array<{ position: number; pattern: RegExp }> = [
  { position: 1, pattern: /^(the\s+)?(first|1st|הראשון|הראשונה|(el\s+|la\s+)?primer[oa]?)(\s+one)?$/i },
  { position: 2, pattern: /^(the\s+)?(second|2nd|השני|השנייה|השניה|(el\s+|la\s+)?segund[oa])(\s+one)?$/i },
  { position: 3, pattern: /^(the\s+)?(third|3rd|השלישי|השלישית|(el\s+|la\s+)?tercer[oa]?)(\s+one)?$/i },
  { position: 4, pattern: /^(the\s+)?(fourth|4th|הרביעי|הרביעית|(el\s+|la\s+)?cuart[oa])(\s+one)?$/i },
  { position: 5, pattern: /^(the\s+)?(fifth|5th|החמישי|החמישית|(el\s+|la\s+)?quint[oa])(\s+one)?$/i },
];

const LAST = /^(the\s+)?(last|האחרון|האחרונה|(el\s+|la\s+)?últim[oa]|(el\s+|la\s+)?ultim[oa])(\s+one)?$/i;

const DIGITS = /^#?(\d{1,2})[.!]?$/;

/** Hebrew vowel points and cantillation, which a user typing a name will not include. */
const NIQQUD = /[֑-ׇ]/g;

/**
 * One leading Hebrew particle, which attaches to the word rather than standing
 * apart: "לדויד" is "to David", and the record holds "דויד".
 *
 * Only ever DROPPED, and only when what remains still matches — the same rule
 * `widenIfEmpty` follows, and for the same reason: widening at worst asks again,
 * while narrowing would silently pick.
 */
const HEBREW_PREFIX = /^[להבוש]/;

function normalise(text: string): string {
  return text.replace(NIQQUD, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export type ChoiceReply =
  | { kind: 'pick'; id: string }
  | { kind: 'cancel' }
  | { kind: 'none' };

/**
 * Read a reply to "which one?" against the parked candidates ONLY.
 *
 * No model, no lookup, and nothing outside the list the user was shown. A reply
 * that resolves to a row not on screen would be a different bug wearing this
 * function's clothes.
 *
 * Cancellation is left to the caller, which reuses `isCancelMessage` — a
 * whole-message match, because a candidate label may legitimately begin with a
 * negation and the confirmation reader's prefix rule would eat it.
 */
export function readChoiceReply(message: string, candidates: ChoiceCandidate[]): ChoiceReply {
  const text = message.trim();
  if (!text || candidates.length === 0) return { kind: 'none' };

  const at = (position: number): ChoiceReply =>
    position >= 1 && position <= candidates.length
      ? { kind: 'pick', id: candidates[position - 1].id }
      : { kind: 'none' };

  // 1. A bare number. Out of range is NOT a pick — "7" against four candidates
  //    means they are reading something else.
  const digits = DIGITS.exec(text);
  if (digits) return at(Number(digits[1]));

  // 2. An ordinal word. Checked before labels, so a candidate that happens to be
  //    called "Second" cannot shadow the position.
  for (const { position, pattern } of ORDINALS) {
    if (pattern.test(text)) return at(position);
  }
  if (LAST.test(text)) return at(candidates.length);

  // 3. The label itself. Either direction — the user may type more than the
  //    label ("David Cohen please") or less of it ("Cohen").
  const needle = normalise(text);
  const bare = HEBREW_PREFIX.test(needle) ? needle.slice(1) : null;

  const hits = candidates.filter((candidate) => {
    const label = normalise(candidate.label);
    if (!label) return false;

    const matches = (value: string) =>
      value.length > 0 && (label.includes(value) || value.includes(label));

    return matches(needle) || (bare !== null && bare.length > 1 && matches(bare));
  });

  // Exactly one, never the first of several. "David Cohen" against "David Cohen"
  // and "David Cohen Jr" is precisely the ambiguity being resolved, and picking
  // one of them here would re-introduce the guess three layers of this stack
  // exist to refuse.
  return hits.length === 1 ? { kind: 'pick', id: hits[0].id } : { kind: 'none' };
}
