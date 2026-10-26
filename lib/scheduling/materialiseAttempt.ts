/**
 * Turn a paid attempt into the contact and the booking it earned.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THIS SITS
 *
 * `create` checks everything and, for a service that takes a card, writes only
 * an `abandoned_bookings` row — because the client is about to leave to pay and
 * may never come back. Writing the booking there is what left a `pending` row
 * holding the slot against every other client, permanently.
 *
 * This is the other half: the payment succeeded, so now the booking exists.
 * Called by `finalize` BEFORE its existing work, so everything that follows
 * operates on a real booking row and runs exactly as it did before.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SLOT IS RE-CHECKED, AND THE CONSTRAINT IS THE AUTHORITY
 *
 * Nothing held the slot while the client was paying. Between `create` saying it
 * was free and this running, somebody else may have taken it. The check here is
 * a courtesy — it produces a clean answer instead of a database error — but
 * `scheduling_bookings_no_overlap` is what actually guarantees one booking per
 * slot, and a 23P01 from it is reported as the slot being gone rather than as a
 * fault.
 *
 * The caller must treat `slotTaken` as the one case where money has been taken
 * and no booking exists. It is the only refund in this design.
 *
 * @module lib/scheduling/materialiseAttempt
 */

import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { crmPipelineStagesRepository } from '@/lib/repositories/CRMPipelineStagesRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import { busyMeetings } from '@/lib/scheduling/busyMeetings';
import { convertAttempt } from '@/lib/scheduling/abandonedBookings';
import { emailLikePattern } from '@/lib/utils/emailMatch';

const logger = createLogger({ module: 'MaterialiseAttempt' });

export interface AttemptRow {
  id: string;
  user_id: string;
  service_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  start_time: string | null;
  end_time: string | null;
  timezone: string | null;
  status: string;
  booking_id: string | null;
  /**
   * The Stripe Checkout session this attempt was sent to, where it went that
   * way (20261070, written from `website/checkout` since the verification
   * work).
   *
   * It is how a payment can be confirmed server-side on the hosted path, which
   * returns no PaymentIntent id to the browser — and how a charge is matched
   * back to its attempt when the client never comes back at all.
   */
  checkout_session_id: string | null;
}

export type MaterialiseResult =
  | { ok: true; bookingId: string; contactId: string | null; alreadyDone: boolean }
  | { ok: false; reason: 'not_found' | 'slot_taken' | 'failed'; error?: string };

/**
 * Load an attempt by id.
 *
 * `userId` is optional and is a VERIFICATION, not the lookup: the row carries
 * its own owner, and that is what the booking is written against. The same
 * trust model `finalize` already uses for `booking_id` — a server-generated
 * uuid handed only to the client who started the journey, with no session to
 * authenticate because the client is anonymous. Passing the owner when it is
 * known costs nothing and refuses a mismatched pair.
 */
export async function loadAttempt(
  attemptId: string,
  userId?: string
): Promise<AttemptRow | null> {
  let query = supabaseServer
    .from('abandoned_bookings')
    .select(
      'id, user_id, service_id, first_name, last_name, email, phone, start_time, end_time, timezone, status, booking_id, checkout_session_id'
    )
    .eq('id', attemptId);

  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query.maybeSingle();

  if (error) {
    logger.error({ err: error, attemptId }, 'Could not read the booking attempt');
    return null;
  }

  return (data as AttemptRow) ?? null;
}

/**
 * The contact this attempt belongs to, created if they are new.
 *
 * Mirrors what `create` does for the paths that write a contact: find by email,
 * fill in only the fields that are missing, and NEVER move an existing
 * contact's stage. A new contact gets no stage from here at all — the
 * `promote_contact_on_payment` trigger moves them when money actually arrives
 * — a `payment_transactions` row, `succeeded`, above zero — and not when the
 * booking below is written `confirmed`. That was the dropped
 * `promote_contact_on_confirmed_booking` (20260920). One rule in one place,
 * and it is why a quote request stopped producing a client.
 *
 * A failure is logged and returns null: the booking is worth more than the
 * contact record, and the money has already been taken.
 */
async function resolveContact(attempt: AttemptRow): Promise<string | null> {
  if (!attempt.email) return null;

  try {
    const { data: existing } = await supabaseServer
      .from('crm_contacts')
      .select('id, first_name, last_name, phone')
      .eq('user_id', attempt.user_id)
      /* `ilike`, not `eq`: an address stored before this route started
         normalising is whatever the visitor typed, so a case-sensitive match
         misses it and a SECOND contact is created for the same person. The
         insert side is normalised now; this is what finds the rows that
         predate it. No wildcards in the value, so it stays an equality match
         in everything but case. */
      .ilike('email', emailLikePattern(attempt.email))
      .order('created_at', { ascending: true })
      .limit(1);

    const found = existing?.[0];

    if (found) {
      const updates: Record<string, string | null> = {};
      if (!found.first_name && attempt.first_name) updates.first_name = attempt.first_name;
      if (!found.last_name && attempt.last_name) updates.last_name = attempt.last_name;
      if (!found.phone && attempt.phone) updates.phone = attempt.phone;

      if (Object.keys(updates).length > 0) {
        await supabaseServer.from('crm_contacts').update(updates).eq('id', found.id);
      }

      return found.id;
    }

    /*
     * THE START OF THIS OWNER'S BOARD, NAMED EXPLICITLY.
     *
     * This insert omitted `stage` deliberately, to let
     * `promote_contact_on_payment` decide. Omitting it does not leave the
     * column empty: `crm_contacts.stage` is `NOT NULL DEFAULT 'lead'`
     * (20260722_create_crm_tables.sql), so every contact created here landed on
     * the literal 'lead' — a key many pipelines do not contain. This business's
     * stages are inquiry > initial_consultation > family_enrolled > completed,
     * so its clients sat on a stage the board has no column for, and
     * `advance_contact_stage` could not move them either: it resolves
     * `current_type` by joining the stage key to the pipeline, and 'lead'
     * matches no row, so every later promotion was refused too.
     *
     * Resolved through the repository that owns the table, as
     * `website/booking/create` and `/confirm` both already do.
     */
    const { data: firstStage } = await crmPipelineStagesRepository.firstStageKey(attempt.user_id);

    const { data: created, error } = await supabaseServer
      .from('crm_contacts')
      .insert({
        user_id: attempt.user_id,
        first_name: attempt.first_name,
        last_name: attempt.last_name,
        email: attempt.email,
        phone: attempt.phone,
        source: 'website_booking',
        /* Only when it resolved. A board with no stages at all has no first
           stage to name, and the column default is then the honest answer. */
        ...(firstStage ? { stage: firstStage } : {}),
      })
      .select('id')
      .single();

    if (error) throw error;

    return created?.id ?? null;
  } catch (err) {
    logger.warn({ err, attemptId: attempt.id }, 'Could not resolve the contact for a paid attempt');
    return null;
  }
}

/** Is this slot still free? A courtesy check; the constraint is the authority. */
async function slotStillFree(attempt: AttemptRow): Promise<boolean> {
  if (!attempt.start_time || !attempt.end_time) return true;

  const busy = await busyMeetings(
    supabaseServer,
    attempt.user_id,
    attempt.start_time,
    attempt.end_time
  );

  return busy.length === 0;
}

/**
 * Create the booking this attempt paid for.
 *
 * Idempotent on the attempt: if it already carries a `booking_id` the booking
 * is returned untouched. `finalize` can be called twice — the browser retries,
 * and the Stripe webhook may race it — and a second booking for one payment is
 * the worst outcome available here.
 */
export async function materialiseAttempt(attempt: AttemptRow): Promise<MaterialiseResult> {
  /* Already done. The browser retried, or the webhook got here first. */
  if (attempt.booking_id) {
    return { ok: true, bookingId: attempt.booking_id, contactId: null, alreadyDone: true };
  }

  if (!(await slotStillFree(attempt))) {
    logger.warn(
      { attemptId: attempt.id, startTime: attempt.start_time },
      'Slot was taken while the client was paying'
    );
    return { ok: false, reason: 'slot_taken' };
  }

  const contactId = await resolveContact(attempt);

  /*
   * ── THROUGH THE REPOSITORY, NOT AROUND IT ────────────────────────────────
   *
   * This inserted with `supabaseServer` directly. That is the bypass
   * `SchedulingRepository.create()` documents against the owner-side route,
   * and it costs more now than it did: `syncMeeting()` is private to the
   * repository and runs only from its `create()` and `update()`, so a booking
   * written here got no `scheduling_meetings` row.
   *
   * `busyMeetings()` reads that table and nothing else, so a client's paid
   * booking was invisible to every availability surface — the public calendar
   * went on offering the hour it had just sold, and the pre-write checks in
   * `create`, `confirm` and `slotStillFree` above could not see it either.
   * Only the database's own exclusion constraint stood in the way. It also has
   * no journey rail in the contact drawer, for the same reason.
   *
   * Safe to route through: `create()` is an insert plus `syncMeeting` — the
   * `booking.created` event comes from a database trigger, so nothing is
   * emitted twice. And it satisfies CLAUDE.md rule 1.
   */
  const created = await schedulingBookingRepository.create({
    user_id: attempt.user_id,
    service_id: attempt.service_id,
    contact_id: contactId,
    start_time: attempt.start_time,
    end_time: attempt.end_time,
    timezone: attempt.timezone,
    /*
     * `confirmed`, because the money has arrived. This is the whole point of
     * deferring the write: the only booking that exists is one somebody
     * finished paying for.
     */
    status: 'confirmed',
    payment_status: 'paid',
    booking_source: 'website',
  } as Parameters<typeof schedulingBookingRepository.create>[0]);

  const booking = created.data;
  const error = created.error;

  if (error || !booking) {
    /*
     * 23P01 is the overlap constraint. Somebody took the slot between the check
     * above and this insert — the race the check cannot close. Reported as the
     * slot being gone, not as a fault, because that is what happened and the
     * caller has to refund rather than retry.
     */
    /*
     * The repository returns an Error, so the Postgres code travels on it
     * rather than on a PostgrestError. Checked on both shapes: `create()`
     * passes the driver's error through untouched, and the shape it arrives
     * in is not something this file should depend on.
     */
    const taken =
      (error as { code?: string } | null)?.code === '23P01' ||
      String(error?.message ?? '').includes('23P01') ||
      String(error?.message ?? '').includes('scheduling_bookings_no_overlap');

    logger.error(
      { err: error, attemptId: attempt.id, slotTaken: taken },
      taken
        ? 'Lost the slot race after the client had paid'
        : 'Could not create the booking for a paid attempt'
    );

    return taken
      ? { ok: false, reason: 'slot_taken' }
      : { ok: false, reason: 'failed', error: error?.message ?? 'The booking could not be created' };
  }

  await convertAttempt(attempt.id, booking.id);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * AND THE MONEY LEARNS WHICH BOOKING IT WAS FOR.
   *
   * This is the OTHER way a booking comes into existence: the client paid and
   * closed the tab, so the browser never reached `finalize` and the webhook
   * created the booking instead. Both paths have to link, because which one
   * wins is a race — and the one skipped here is precisely the case nobody is
   * watching, where the client is charged and never comes back.
   *
   * The transaction, the subscription and the instalments were written before
   * this booking existed; Stripe's metadata is what names the attempt.
   * Idempotent, so the ordinary case — webhook and browser both arriving —
   * links once.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const { linkPaymentsToBooking } = await import('@/lib/payments/linkPaymentsToBooking');

  await linkPaymentsToBooking({
    attemptId: attempt.id,
    bookingId: booking.id,
    contactId,
    userId: attempt.user_id,
  });

  logger.info(
    { attemptId: attempt.id, bookingId: booking.id, contactId },
    'Payment succeeded — booking and contact created'
  );

  return { ok: true, bookingId: booking.id, contactId, alreadyDone: false };
}
