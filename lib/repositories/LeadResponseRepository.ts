/**
 * The queue of replies owed to people who got in touch.
 *
 * Thin on purpose: every decision about WHAT to send lives in
 * `LeadResponseDispatchService`, and every guarantee about sending it ONCE
 * lives in the database — `lead_responses_one_per_thing` and the claim RPC.
 * This layer only carries rows across.
 *
 * @module lib/repositories/LeadResponseRepository
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';

/**
 * What a queued message is.
 *
 * `invite` and `chase` are the lead conversation — one invitation, one
 * reminder. The rest are about something that is not the lead itself, and are
 * keyed on the invoice or booking rather than the person, because one client
 * can have two of either.
 *
 * Must match the CHECK on `lead_responses.kind`
 * (20260923_meeting_reminder.sql). The constraint is there because a kind no
 * dispatcher recognises would otherwise be stored happily and skipped forever —
 * the same drift that let `scheduling_bookings.status` hold a fifth value for
 * months while eleven declarations said there were four.
 */
export type LeadResponseKind =
  | 'invite'
  | 'chase'
  | 'invoice_chase'
  | 'intake_chase'
  | 'meeting_reminder'
  /**
   * Mark a meeting that has already happened as completed.
   *
   * The first queue kind that SENDS NOTHING. The queue is the record of work
   * the platform did on the owner's behalf, and changing a status they would
   * otherwise have clicked is exactly that -- so it belongs here, with the same
   * consent, the same dedupe and the same visibility as a send.
   */
  | 'meeting_complete'
  /**
   * One reminder on a quote the client has not answered.
   *
   * Asks whether they need more time or more information rather than pressing
   * for a decision — it writes to a PROSPECT, which no other kind here does.
   *
   * One per proposal, ever: `hasRowFor` matches on (kind, contact, entity)
   * with no status filter, so once a row exists for a quote the sweep never
   * queues a second. A sequence would be a sales cadence, which is a different
   * product and a different consent.
   */
  | 'quote_chase';
export type LeadResponseStatus = 'pending' | 'processing' | 'sent' | 'skipped' | 'failed';

export interface LeadResponse {
  id: string;
  user_id: string;
  contact_id: string;
  kind: LeadResponseKind;
  status: LeadResponseStatus;
  recommendation: Record<string, unknown> | null;
  service_id: string | null;
  /** The invoice or booking. Equal to `contact_id` where the contact IS the thing. */
  entity_id: string;
  claimed_by: string | null;
  claimed_at: string | null;
  attempts: number;
  next_attempt_at: string | null;
  skip_reason: string | null;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface LeadResponseResult<T> {
  data: T | null;
  error: Error | null;
}

export class LeadResponseRepository {
  private logger: Logger;

  constructor(private supabase: SupabaseClient = defaultSupabase) {
    this.logger = createLogger({ service: 'LeadResponseRepository' });
  }

  /**
   * Queue a reply. Idempotent.
   *
   * The unique key makes a second call a no-op rather than a second email, so
   * callers never have to check first — which is what makes it safe from a
   * retried request.
   */
  async enqueue(params: {
    userId: string;
    contactId: string;
    kind: LeadResponseKind;
    dueAt: Date;
    serviceId?: string | null;
    /** The invoice or booking, for a kind that can repeat per person. */
    entityId?: string | null;
    recommendation?: Record<string, unknown> | null;
  }): Promise<LeadResponseResult<LeadResponse>> {
    try {
      const { data, error } = await this.supabase
        .from('lead_responses')
        .upsert(
          {
            // Set explicitly and last: never spread a caller's object into a
            // row that carries the tenant key.
            contact_id: params.contactId,
            kind: params.kind,
            next_attempt_at: params.dueAt.toISOString(),
            service_id: params.serviceId ?? null,
            /*
             * The contact stands in where a kind is one-per-person.
             *
             * Written rather than left null so the unique key is an ordinary
             * column tuple: a NULL is distinct from every other NULL, which
             * would let the same invitation be queued twice.
             */
            entity_id: params.entityId ?? params.contactId,
            recommendation: params.recommendation ?? null,
            status: 'pending',
            user_id: params.userId,
          },
          // Matches `lead_responses_one_per_thing` exactly, column for column.
          { onConflict: 'kind,contact_id,entity_id', ignoreDuplicates: true }
        )
        .select()
        .maybeSingle();

      if (error) throw error;
      return { data: (data as LeadResponse) ?? null, error: null };
    } catch (error) {
      this.logger.error({ err: error, ...params }, 'Failed to queue a lead response');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Claim a batch of due rows.
   *
   * ⟨unscoped-by-design⟩ — this crosses every tenant, because a queue runner
   * has to. Every read the dispatcher then makes is scoped to `row.user_id`.
   */
  async claimDue(runnerId: string, batch: number): Promise<LeadResponse[]> {
    const { data, error } = await this.supabase.rpc('claim_due_lead_responses', {
      p_runner: runnerId,
      p_batch: batch,
    });

    if (error) {
      this.logger.error({ err: error }, 'Could not claim lead responses');
      return [];
    }
    return (data as LeadResponse[]) || [];
  }

  /** Return rows whose runner died, or dead-letter them once out of attempts. */
  async reapStale(leaseSeconds: number, maxAttempts: number): Promise<number> {
    const { data, error } = await this.supabase.rpc('reap_stale_lead_responses', {
      p_lease_seconds: leaseSeconds,
      p_max_attempts: maxAttempts,
    });

    if (error) {
      this.logger.error({ err: error }, 'Could not reap stale lead responses');
      return 0;
    }
    return ((data as unknown[]) || []).length;
  }

  /**
   * Record that the OWNER did this themselves, so the automation does not.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * THE DUPLICATE THIS CLOSES
   *
   * An owner chasing an intake form by hand and the `chase_intake` automation
   * call the same function with the same arguments. Nothing connected them: the
   * sweep's dedup reads this table and a manual send wrote nothing to it, and
   * the gap only clears when the client RETURNS the form — chasing does not
   * clear it. So the owner chased on Tuesday morning, the sweep came due that
   * night, found the form still outstanding, and sent the same reminder again.
   *
   * It is the shape the registry already documents for invoices: "two invoice
   * chasers... neither path aware of the other, because they dedupe in
   * different tables."
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * WHY A ROW RATHER THAN A CHECK
   *
   * `lead_responses_one_per_thing` is a real UNIQUE (kind, contact_id,
   * entity_id) in the database, so a row written here makes the sweep's enqueue
   * a no-op whether or not anybody remembers to call `hasRowFor` first. The
   * guarantee is the constraint, not the caller.
   *
   * WRITTEN ALREADY CLOSED, which is the part a two-step would get wrong.
   * `enqueue` writes `status: 'pending'`, and a drain between that and
   * `markSent` would claim the row and send the very email this exists to
   * prevent. One insert, `sent` from birth, no window.
   * ─────────────────────────────────────────────────────────────────────────────
   */
  async recordManualSend(params: {
    userId: string;
    contactId: string;
    kind: LeadResponseKind;
    /** The booking or invoice. Falls back to the contact, as `enqueue` does. */
    entityId?: string | null;
  }): Promise<void> {
    const { error } = await this.supabase.from('lead_responses').upsert(
      {
        contact_id: params.contactId,
        kind: params.kind,
        entity_id: params.entityId ?? params.contactId,
        /*
         * Closed on arrival. `next_attempt_at` is in the past so no scan that
         * orders by it can treat this as upcoming work.
         */
        status: 'sent',
        sent_at: new Date().toISOString(),
        next_attempt_at: new Date().toISOString(),
        /* Set explicitly and last: never spread a caller's object into a row
           that carries the tenant key. */
        user_id: params.userId,
      },
      /*
       * Matches the constraint column for column. `ignoreDuplicates` because an
       * owner chasing twice is not an error, and because the automation may
       * legitimately have gone first — in which case its row is the record and
       * this one has nothing to add.
       */
      { onConflict: 'kind,contact_id,entity_id', ignoreDuplicates: true }
    );

    if (error) {
      /*
       * Logged, never thrown. The email has already gone out by the time this
       * runs, so failing the owner's request would report a send that happened
       * as a failure. The cost of this error is one duplicate reminder, which
       * is strictly better than telling an owner their chase did not send.
       */
      this.logger.error(
        { err: error, ...params },
        'Could not record a manual send; the automation may repeat it'
      );
    }
  }

  async markSent(id: string): Promise<void> {
    await this.finish(id, { status: 'sent', sent_at: new Date().toISOString() });
  }

  /**
   * Close a row that was not sent, and say why.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `detail` is separate from `reason` because the two answer different
   * questions. `reason` is one of a handful of known outcomes — already_booked,
   * not_approved, send_failed — and is what you group by. `detail` is the
   * sentence that explains one row, and only some reasons have one.
   *
   * It was missing, and `send_failed` is the reason that needed it most: a
   * chase would record THAT the email did not go out and discard every word of
   * why. One such row sat in this table for two days reading
   * `send_failed / error_message: null`, and nothing on the account or in the
   * logs could say whether the address had bounced, the provider had refused
   * it, or the invoice had no payment route. A skip nobody can diagnose is a
   * silent failure with a row next to it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async markSkipped(id: string, reason: string, detail?: string): Promise<void> {
    await this.finish(id, {
      status: 'skipped',
      skip_reason: reason,
      // Only overwrite when there is something to say; a later reaper message
      // is worth more than an empty string.
      ...(detail ? { error_message: detail.slice(0, 500) } : {}),
    });
  }

  async markFailed(id: string, message: string): Promise<void> {
    await this.finish(id, { status: 'failed', error_message: message });
  }

  private async finish(id: string, patch: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabase
      .from('lead_responses')
      .update({ ...patch, claimed_by: null, claimed_at: null })
      .eq('id', id);

    if (error) this.logger.error({ err: error, id }, 'Could not close a lead response');
  }

  /**
   * Cancel a queued reply, if it has not already been claimed.
   *
   * The row count IS the answer to the race. Zero rows means a runner already
   * took it and the mail is going out, so the caller must say so rather than
   * report a cancellation that did not happen.
   */
  async cancelPending(
    contactId: string,
    kind: LeadResponseKind,
    userId: string
  ): Promise<{ cancelled: boolean }> {
    const { data, error } = await this.supabase
      .from('lead_responses')
      .update({ status: 'skipped', skip_reason: 'cancelled_by_owner' })
      .eq('contact_id', contactId)
      .eq('kind', kind)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .select('id');

    if (error) {
      this.logger.error({ err: error, contactId, kind }, 'Could not cancel a lead response');
      return { cancelled: false };
    }
    return { cancelled: (data || []).length > 0 };
  }

  /** Bring a queued reply forward to now. Same pending-only guard as cancel. */
  async sendNow(
    contactId: string,
    kind: LeadResponseKind,
    userId: string
  ): Promise<{ scheduled: boolean }> {
    const { data, error } = await this.supabase
      .from('lead_responses')
      .update({ next_attempt_at: new Date().toISOString() })
      .eq('contact_id', contactId)
      .eq('kind', kind)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .select('id');

    if (error) {
      this.logger.error({ err: error, contactId, kind }, 'Could not reschedule a lead response');
      return { scheduled: false };
    }
    return { scheduled: (data || []).length > 0 };
  }

  /**
   * Is there already a row of this kind for this thing, in any state?
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Deliberately NOT filtered by status, and named for what it asks rather than
   * for the one caller that first asked it. A `sent` row is the record that the
   * message went out, so "is there a row" answers both questions this is put
   * to: the sweep asking whether to queue again, and the insight path asking
   * whether this booking has already been reminded about by the standing
   * automation.
   *
   * It was called `hasPending`, which described neither — it never looked at
   * `status`, and a reader taking the name at its word would have concluded
   * that a sent reminder no longer counted.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async hasRowFor(
    userId: string,
    kind: LeadResponseKind,
    contactId: string,
    entityId: string | null
  ): Promise<boolean> {
    const query = this.supabase
      .from('lead_responses')
      .select('id')
      .eq('user_id', userId)
      .eq('kind', kind)
      .eq('contact_id', contactId)
      .limit(1);

    // Always a real value — the contact stands in for the lead kinds.
    const { data } = await query.eq('entity_id', entityId ?? contactId);
    return (data || []).length > 0;
  }

  /** What is queued for these contacts, so the dashboard can show it. */
  async listForContacts(userId: string, contactIds: string[]): Promise<LeadResponse[]> {
    if (contactIds.length === 0) return [];

    const { data, error } = await this.supabase
      .from('lead_responses')
      .select('*')
      .eq('user_id', userId)
      .in('contact_id', contactIds);

    if (error) {
      this.logger.warn({ err: error, userId }, 'Could not read queued lead responses');
      return [];
    }
    return (data as LeadResponse[]) || [];
  }
}

export const leadResponseRepository = new LeadResponseRepository();
