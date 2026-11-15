// lib/repositories/RefundRequestRepository.ts
//
// A client asking for their money back, and the owner's decision about it.
//
// ─────────────────────────────────────────────────────────────────────────────
// IT NEVER MOVES MONEY, AND MUST NEVER LEARN HOW.
//
// Every figure here is a REQUEST. The refund itself is
// `lib/payments/RefundService.ts`, which owns the guards that make one safe:
// the over-refund check under a row lock, the cross-currency refusal, two
// layers of idempotency, the ledger row written before Stripe is called. A
// method on this class that called it would put a second, unguarded path
// beside that one.
//
// `amount_requested` is what was ASKED. What came back is in `payment_refunds`
// and nowhere else. Keeping the ask is what lets a card say "they asked for
// ₪5,000" beside "you returned ₪6,750".
// ─────────────────────────────────────────────────────────────────────────────
//
// Shape follows PaymentProcessorRepository: constructor DI with a
// supabaseServer default, module-level Pino logger, { data, error } results, a
// singleton export, direct-path import.
//
// ─────────────────────────────────────────────────────────────────────────────
// FOUR METHODS, AND EACH IS SOMETHING NOTHING ELSE CAN DO.
//
//   decide            record the owner's answer
//   openForBooking    find the open request a refund has just settled
//   recordAssessment  write what the agent concluded
//   listForContact    the whole history, for the contact drawer
//
// It briefly had a claim/reap pair as well, written for a cron drain that
// assessed requests. The assessment is an AGENT now and reads and writes
// through the catalogue like every other agent does, so those had no callers.
// The queue columns and RPCs added by 20261123 are unused for the same reason,
// and are left in place rather than dropped: a migration to remove an unused
// column is churn with its own risk.
//
// `recordAssessment` came back for the agent, which needs a write that stamps
// `assessed_at` server-side — a plan is static JSON and cannot know the time.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'RefundRequestRepository' });

/**
 * Where a request got to. The same spellings as the CHECK constraint in
 * `20261121_a_client_can_ask_for_their_money_back.sql`.
 */
export type RefundRequestStatus =
  | 'submitted'
  | 'assessing'
  | 'awaiting_owner'
  | 'refunded'
  | 'declined'
  /**
   * The owner dealt with it themselves — a transfer, a phone call, something
   * agreed off the record. The platform deliberately does not claim to know
   * which, which is why it is its own status and not a second spelling of
   * `refunded`.
   *
   * ADDED BY 20261124 AND MISSING FROM THIS UNION UNTIL NOW. The database
   * accepted it and the type did not, so `Extract<RefundRequestStatus,
   * 'handled'>` silently resolved to nothing and the decide route's call site
   * was an error nobody saw — `next.config.js` ignores type errors.
   *
   * Nothing in the UI writes it today: the card's "mark as handled" button was
   * removed because it called the same endpoint as "decline", closed the same
   * request and told the client the same nothing. A refund returned by hand
   * belongs in the refund dialog, which records it properly. The status stays
   * because the database has it and the chat may still reach it.
   */
  | 'handled'
  | 'withdrawn'
  | 'superseded';

/**
 * The three statuses that mean "nobody has answered this yet".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE SPELLING, THREE READERS.
 *
 * The partial unique index decides whether a second request may be inserted,
 * `refundableBookingsFor` decides whether a booking is offered to the client,
 * and the `refund_requested` gap decides whether a card renders. All three mean
 * the same thing by "open", and when they disagree the client is shown a
 * booking that the insert then refuses.
 *
 * Exported so the other two can import it instead of retyping it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const OPEN_REFUND_REQUEST_STATUSES: readonly RefundRequestStatus[] = [
  'submitted',
  /* Being looked at by the agent. Still open: the client is still waiting, and
     a booking already being assessed must not be offered to them again. */
  'assessing',
  'awaiting_owner',
];

export interface RefundRequestRow {
  id: string;
  user_id: string;
  contact_id: string | null;
  booking_id: string | null;
  amount_requested: number;
  currency: string;
  reason: string | null;
  note: string | null;
  status: RefundRequestStatus;
  source: 'portal_form' | 'email' | 'owner';
  decided_at: string | null;
  created_at: string;
  updated_at: string;

  /* ── The queue (20261123, §8.1). ── */
  claimed_by: string | null;
  claimed_at: string | null;
  attempts: number;
  next_attempt_at: string | null;

  /* ── What the agent answered, all null until it has. ── */
  recommendation: 'refund_full' | 'refund_partial' | 'decline' | 'needs_owner' | null;
  recommended_amount: number | null;
  reasoning: string | null;
  client_message_draft: string | null;
  assessed_at: string | null;
  /**
   * The payment the refund actually came out of.
   *
   * Written by `decide` at the moment the money moves, because that is the
   * only moment anything knows it for certain — see the parameter's own note.
   * Null on a request that was declined, and on one settled before this
   * existed.
   */
  transaction_id: string | null;

  /**
   * The mail conversation this request came from, where it came from one.
   *
   * Null for a request raised in the portal, which has no conversation. It is
   * what lets a decision settle the thread the client asked in, rather than
   * leaving the owner a card inviting them to answer a question they have just
   * answered. Added by 20261124.
   */
  source_thread_id: string | null;
}

export interface RefundRequestResult<T> {
  data: T | null;
  error: Error | null;
}

export class RefundRequestRepository {
  constructor(private readonly client: SupabaseClient = supabaseServer) {}

  /**
   * Record the owner's decision on one request.
   *
   * `user_id` is filtered on as well as the id (CLAUDE.md rule 4): the id alone
   * is a uuid somebody could hold, and a service-role client has no RLS behind
   * it to catch that. One business may only settle its own requests.
   *
   * Scoped to the OPEN statuses so a decision cannot overwrite a decision. Two
   * presses of the same button, or a decline arriving after a refund has
   * already settled the row, change nothing and say so by returning no row —
   * rather than quietly rewriting what happened.
   *
   * It is also what makes the OWNER win a race with the agent: a row they have
   * marked handled is no longer open, so an assessment landing a second later
   * finds nothing to update.
   */
  async decide(
    requestId: string,
    userId: string,
    status: Extract<RefundRequestStatus, 'refunded' | 'declined' | 'handled' | 'superseded'>,
    /**
     * The payment the money actually came out of, where one did.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * WRITTEN HERE BECAUSE THIS IS THE ONLY MOMENT ANYTHING KNOWS IT.
     *
     * The agent cannot supply it: a request names a BOOKING, because that is
     * what the client was thinking of, and the payment behind a booking may
     * sit one hop away on an invoice. It briefly asked the model to name a
     * transaction id, which was a guess dressed as a fact, and that field was
     * removed.
     *
     * `RefundService` knows it for certain — it has just refunded that exact
     * row — so the link is recorded at the instant it becomes true. Absent on
     * a decline, where no payment was touched and a link would be a lie.
     * ─────────────────────────────────────────────────────────────────────────
     */
    transactionId?: string
  ): Promise<RefundRequestResult<RefundRequestRow>> {
    const { data, error } = await this.client
      .from('refund_requests')
      .update({
        status,
        decided_at: new Date().toISOString(),
        ...(transactionId ? { transaction_id: transactionId } : {}),
      })
      .eq('id', requestId)
      .eq('user_id', userId)
      .in('status', OPEN_REFUND_REQUEST_STATUSES as unknown as string[])
      .select('*')
      .maybeSingle();

    if (error) {
      logger.error({ err: error, requestId, userId, status }, 'Could not record a refund decision');
      return { data: null, error: new Error(error.message) };
    }

    return { data: (data as RefundRequestRow) ?? null, error: null };
  }

  /**
   * The open request against one booking, if there is one.
   *
   * What settles a request when the owner refunds from somewhere else — the
   * Finance page, the chat, the Stripe dashboard. Without it the client's money
   * comes back and their card sits there still asking for it.
   */
  async openForBooking(
    bookingId: string,
    userId: string
  ): Promise<RefundRequestResult<RefundRequestRow>> {
    const { data, error } = await this.client
      .from('refund_requests')
      .select('*')
      .eq('user_id', userId)
      .eq('booking_id', bookingId)
      .in('status', OPEN_REFUND_REQUEST_STATUSES as unknown as string[])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error({ err: error, bookingId, userId }, 'Could not read a booking\'s refund request');
      return { data: null, error: new Error(error.message) };
    }

    return { data: (data as RefundRequestRow) ?? null, error: null };
  }

  /**
   * What the refund agent concluded, written onto the request.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE AGENT ADVISES. THIS IS THE WHOLE OF WHAT IT CAN DO.
   *
   * Four fields and a status. It cannot move money: `transactions.refund` is
   * `movesMoney`, which `executeMutate` refuses outright on any automation
   * path, so the most this can ever produce is a recommendation sitting on the
   * owner's card next to a button only they can press.
   *
   * `assessed_at` IS STAMPED HERE, NOT PASSED IN. The plan used to write
   * `{{now}}` — the only such token in the catalogue — and the pilot has no
   * `now` variable, so every run died with `Unknown variable reference root:
   * now` AFTER the model had already produced its assessment. A plan is static
   * JSON and cannot know the time. The server can, and does, from the same
   * statement that writes the recommendation, so the stamp and the conclusion
   * can never disagree. This is the shape `decide()` above already uses for
   * `decided_at`.
   *
   * Scoped to the OPEN statuses, for the same reason `decide()` is: an
   * assessment must never overwrite a person's answer. If the owner refunded,
   * declined or marked it handled while the model was thinking, the row is no
   * longer open, this finds nothing, and it returns no row. That is the owner
   * winning the race, and it is by design rather than by luck.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async recordAssessment(
    requestId: string,
    userId: string,
    fields: Record<string, unknown>
  ): Promise<RefundRequestResult<RefundRequestRow>> {
    const { data, error } = await this.client
      .from('refund_requests')
      .update({ ...fields, assessed_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('user_id', userId)
      .in('status', OPEN_REFUND_REQUEST_STATUSES as unknown as string[])
      .select('*')
      .maybeSingle();

    if (error) {
      logger.error({ err: error, requestId, userId }, 'Could not record a refund assessment');
      return { data: null, error: new Error(error.message) };
    }

    return { data: (data as RefundRequestRow) ?? null, error: null };
  }

  /**
   * Every refund this client has ever asked for, answered or not.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE HALF OF THE STORY THE LEDGER CANNOT TELL.
   *
   * `payment_transactions` records that ₪20 went back. It cannot record that
   * the client asked for ₪300, that they said the session never happened, or
   * that the owner returned part of it and closed the matter. Once a request
   * is settled its card disappears, and without this the asking vanishes with
   * it — leaving a partial refund looking like a decision nobody explained.
   *
   * So the drawer reads this beside the money. Asked, said, answered.
   *
   * EVERY status, deliberately, including the terminal ones: a settled request
   * is exactly what somebody opening the drawer three weeks later is trying to
   * understand.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async listForContact(
    contactId: string,
    userId: string,
    limit = 20
  ): Promise<RefundRequestResult<RefundRequestRow[]>> {
    const { data, error } = await this.client
      .from('refund_requests')
      .select('*')
      .eq('user_id', userId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error({ err: error, contactId, userId }, "Could not read a client's refund requests");
      return { data: null, error: new Error(error.message) };
    }

    return { data: (data as RefundRequestRow[]) ?? [], error: null };
  }
}

export const refundRequestRepository = new RefundRequestRepository();
