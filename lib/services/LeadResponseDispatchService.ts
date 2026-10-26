/**
 * Drain the queue of replies owed to people who got in touch.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER MATTERS
 *
 *   reap   → return rows whose runner died, dead-letter the hopeless ones
 *   claim  → take a batch, exclusively, with attempts incremented
 *   send   → one row at a time
 *   close  → sent, or skipped with a reason
 *
 * Reaping FIRST so a row stuck by a dead lambda is eligible in the same run
 * rather than the next one.
 *
 * ON A THROW, THE ROW IS LEFT `processing`.
 *
 * Not marked failed. The reaper owns that decision, because it is the only
 * thing that knows how many attempts have been made and whether the lease has
 * actually expired. Marking it failed here would dead-letter a row on its first
 * transient error.
 *
 * WHO IS NOT WRITTEN TO
 *
 *   already booked     the outcome happened; chasing now is embarrassing
 *   already replied to the owner answered by hand
 *   switched off       the business turned auto-send off after it was queued
 *
 * Each is checked at SEND time rather than at queue time, because all three can
 * become true in the fifteen minutes or two days in between. That window is the
 * whole point of the delay.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/services/LeadResponseDispatchService
 */

import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabaseServer';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { activitySentence, activityMoment } from '@/lib/business-os/activityText';
import { createLogger, type Logger } from '@/lib/logger';
import { leadResponseRepository, type LeadResponse } from '@/lib/repositories/LeadResponseRepository';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { sendBookingLink } from '@/lib/services/LeadBookingLinkService';
import { whenDue } from '@/lib/business-os/gaps/whenDue';
import { OPERATIONAL_AUTOMATIONS } from '@/lib/business-os/gaps/automations';
import { automationApplies } from '@/lib/business-os/gaps/automationApplies';
import { findGaps } from '@/lib/business-os/gaps/findGaps';
import { sendInvoice } from '@/lib/services/InvoiceDeliveryService';
import { sendQuoteReminder } from '@/lib/services/ProposalSendService';
import { BookingEmailService, getBusinessLocale } from '@/lib/services/BookingEmailService';

const logger = createLogger({ service: 'LeadResponseDispatchService' });

/** Must exceed the cron route's maxDuration, or a live row gets reclaimed. */
const LEASE_SECONDS = 90;
const MAX_ATTEMPTS = 3;
const BATCH = 25;

/**
 * What happened to one queued row.
 *
 * `reason` is the small closed set you group by; `detail` is the sentence that
 * explains this one row, present only where there is something to say. See
 * `LeadResponseRepository.markSkipped`.
 */
interface DispatchOutcome {
  sent: boolean;
  reason?: string;
  detail?: string;
}

export interface DispatchResult {
  reaped: number;
  enqueued: number;
  claimed: number;
  sent: number;
  skipped: number;
}


export interface DispatchOptions {
  /**
   * How many rows to claim this run. Defaults to `BATCH`.
   *
   * The owner's "Send now" passes a small number so their click waits for a
   * few rows, not a full batch (BL-7a part 2). Anything that is not a whole
   * number in 1..BATCH falls back to `BATCH`, so no caller can widen a run.
   */
  batch?: number;
  /**
   * Whether to run the approved-chase sweep before claiming. Default true;
   * only an explicit `false` skips the chase sweep. The reaper always runs.
   *
   * The owner's "Send now" passes `false`: the sweep lists every approved
   * business, which is not this owner's work and would lengthen a click that
   * now waits. The cron sweeps every 5 minutes, so nothing relies on the click
   * to enqueue (CR-P2-2).
   */
  sweep?: boolean;
}

function batchSize(requested: number | undefined): number {
  return typeof requested === 'number' && Number.isInteger(requested) && requested >= 1 && requested <= BATCH
    ? requested
    : BATCH;
}

export async function dispatchLeadResponses(options: DispatchOptions = {}): Promise<DispatchResult> {
  const batch = batchSize(options.batch);
  const runnerId = randomUUID();
  const result: DispatchResult = { reaped: 0, enqueued: 0, claimed: 0, sent: 0, skipped: 0 };

  result.reaped = await leadResponseRepository.reapStale(LEASE_SECONDS, MAX_ATTEMPTS);

  /*
   * Queue the chases the owner has approved.
   *
   * Enqueue BEFORE claiming, so something that became due this minute goes out
   * on this run rather than the next. Nothing here sends — every row still has
   * to be claimed exclusively below, so a slow enqueue cannot produce a double
   * send.
   */
  if (options.sweep !== false) result.enqueued = await enqueueApprovedChases();

  const rows = await leadResponseRepository.claimDue(runnerId, batch);
  result.claimed = rows.length;

  for (const row of rows) {
    try {
      const outcome = await dispatchOne(row);
      if (outcome.sent) {
        await leadResponseRepository.markSent(row.id);
        result.sent += 1;
      } else {
        await leadResponseRepository.markSkipped(row.id, outcome.reason || 'unknown', outcome.detail);
        result.skipped += 1;
      }
    } catch (err) {
      // Deliberately left `processing`. See the module header.
      logger.error({ err, id: row.id, userId: row.user_id }, 'Lead response threw; leaving it to the reaper');
    }
  }

  return result;
}

async function dispatchOne(row: LeadResponse): Promise<DispatchOutcome> {
  const log = logger.child({ id: row.id, userId: row.user_id, contactId: row.contact_id, kind: row.kind });

  /*
   * Does the owner still permit this KIND of work?
   *
   * Per row rather than once per run, and per kind rather than one switch: a
   * business can withdraw permission in the window between the queue and the
   * send, and "reply to my enquiries" is a different consent from "chase my
   * clients for money".
   */
  /*
   * Which consent covers this row.
   *
   * Read from the same map the enqueuer writes by, so a kind cannot be queued
   * under one automation and checked against another.
   */
  const automation = OPERATIONAL_AUTOMATIONS.find(entry => entry.covers.includes(row.kind));

  if (!automation) return { sent: false, reason: 'unknown_kind' };

  const { data: profile } = await supabaseServer
    .from('business_profiles')
    .select(automation.column)
    .eq('user_id', row.user_id)
    .maybeSingle();

  if (!(profile as Record<string, unknown> | null)?.[automation.column]) {
    return { sent: false, reason: 'not_approved' };
  }

  /*
   * And can it still be done at all?
   *
   * Asked here as well as at enqueue because this is the choke point: a row
   * queued while an intake form was published must not send after it has been
   * withdrawn, and the queue has no idea that happened. Permission and
   * possibility are two different questions and both are asked at the moment of
   * sending.
   */
  if (!(await automationApplies(row.user_id, automation))) {
    return { sent: false, reason: 'no_longer_applicable' };
  }

  if (row.kind === 'invoice_chase') return chaseInvoice(row, log);
  if (row.kind === 'intake_chase') return chaseIntake(row, log);
  if (row.kind === 'meeting_reminder') return remindAboutMeeting(row, log);
  if (row.kind === 'meeting_complete') return completeMeeting(row, log);
  if (row.kind === 'quote_chase') return chaseQuote(row, log);
  return inviteOrChaseLead(row, log);
}


/**
 * Mark a meeting that has already happened as completed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONLY DISPATCH THAT SENDS NOTHING.
 *
 * Every other branch here writes to a client. This one changes a status the
 * owner would otherwise have clicked, which is why it is the lowest-risk
 * automation on the board: nobody receives anything, and the worst case is a
 * flag an owner flips back.
 *
 * It routes through `schedulingBookingRepository.complete()` rather than
 * updating the row directly, and that matters for two reasons:
 *
 *   1. `update()` makes the status change an ATOMIC CLAIM
 *      (`.neq('status', target)`), so a booking already completed matches zero
 *      rows. Two concurrent drains cannot both "complete" the same meeting, and
 *      a replayed queue row is a no-op rather than a second event.
 *   2. That same path emits `booking.completed` on the event rail. Writing the
 *      row here would mark the meeting and leave the rail silent, so the
 *      retention metrics would quietly stop seeing completions the moment this
 *      automation was switched on.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/**
 * One reminder on a quote the client has not answered.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERYTHING IS RE-CHECKED, and the window here is the widest of any kind in
 * this file: the gap waits 72 hours before it reports a quote at all, so three
 * days have already passed when this runs. In that time the client can have
 * accepted, declined, or let it expire, and the owner can have withdrawn it or
 * sent a revision.
 *
 * A nudge about a decision somebody has already made is the worst outcome
 * available here — worse than silence, because it tells them nobody was
 * paying attention.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function chaseQuote(
  row: LeadResponse,
  log: Logger
): Promise<DispatchOutcome> {
  if (!row.entity_id) return { sent: false, reason: 'no_proposal' };

  const { data: proposal } = await supabaseServer
    .from('proposals')
    .select('id, status, valid_until')
    .eq('id', row.entity_id)
    .eq('user_id', row.user_id)
    .maybeSingle();

  if (!proposal) return { sent: false, reason: 'proposal_gone' };

  /*
   * Only a quote still waiting. Every other status is an answer: `accepted`
   * and `declined` are the client's, `withdrawn` and `superseded` are the
   * owner's, `expired` is the calendar's.
   */
  const status = (proposal.status ?? '').toLowerCase();
  if (status !== 'sent' && status !== 'viewed') {
    return { sent: false, reason: 'already_answered' };
  }

  /*
   * And one that is still open.
   *
   * `expired` is written by whatever sweeps for it, which may not have run —
   * so the DATE is checked here rather than trusting the status to have caught
   * up. Reminding somebody about a quote that lapsed yesterday invites them to
   * act on a price the business is no longer offering.
   */
  if (proposal.valid_until) {
    const until = Date.parse(`${proposal.valid_until}T23:59:59Z`);
    if (Number.isFinite(until) && until < Date.now()) {
      return { sent: false, reason: 'quote_expired' };
    }
  }

  const outcome = await sendQuoteReminder(row.entity_id, row.user_id);

  if (!outcome.ok) {
    /* Two different things. The guards above are reasons NOT to send and are
       ordinary; a refusal from the sender is a send that was meant to happen
       and did not, and the reason travels with the row. */
    if (outcome.reason === 'already_answered' || outcome.reason === 'no_email') {
      return { sent: false, reason: outcome.reason };
    }
    log.error({ error: outcome.reason, proposalId: row.entity_id }, 'Quote reminder not sent');
    return { sent: false, reason: 'send_failed', detail: outcome.reason };
  }

  return { sent: true };
}

async function completeMeeting(
  row: LeadResponse,
  log: Logger
): Promise<DispatchOutcome> {
  if (!row.entity_id) return { sent: false, reason: 'no_booking' };

  const { data: booking } = await supabaseServer
    .from('scheduling_bookings')
    /* `contact_id` and `timezone` are for the marker written below, which a
       completion is not allowed to go ahead without. */
    .select('id, status, start_time, contact_id, timezone')
    .eq('id', row.entity_id)
    .eq('user_id', row.user_id)
    .maybeSingle();

  if (!booking) return { sent: false, reason: 'booking_gone' };

  /*
   * Only a meeting still waiting to be marked.
   *
   * The owner marking it themselves between queueing and draining is the
   * expected case, not an error -- the delay exists to give them that chance.
   * A cancelled meeting must never be completed: it did not happen.
   */
  const status = (booking.status ?? '').toLowerCase();
  if (status !== 'confirmed' && status !== 'pending') {
    return { sent: false, reason: 'already_resolved' };
  }

  /*
   * And only one that is genuinely in the past.
   *
   * `dueAt` already encodes the twelve-hour wait, but a queue row can be
   * drained late, replayed, or written against a booking that was later moved
   * FORWARD. Checking the booking's own clock here means a rescheduled meeting
   * is never completed before it happens.
   */
  const startedAt = booking.start_time ? Date.parse(booking.start_time) : NaN;
  if (Number.isNaN(startedAt) || startedAt > Date.now()) {
    return { sent: false, reason: 'not_yet_past' };
  }

  /*
   * The marker goes down BEFORE the status, and the order is the whole safety.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `completed` is one of three answers — the others are no-show and cancelled
   * — and this can only ever give the first. So every completion it writes has
   * to stay answerable: the triage row on the dashboard reads this activity and
   * offers "was this a no-show?" for a week afterwards.
   *
   * Written first because of what the two failures cost. A marker with no
   * completion is harmless — the triage row requires the booking to actually
   * BE completed, so a stray one is never shown, and the meeting simply stays
   * on the Needs You card as it was. A completion with no marker is the thing
   * worth avoiding: the booking leaves `meeting_unmarked` (it is no longer
   * confirmed or pending), nothing is sent to anyone, and a no-show is silently
   * recorded as attendance with no surface left to correct it on.
   *
   * So a marker that cannot be written stops the completion. The owner keeps
   * the prompt they already had, which is exactly the behaviour before this
   * automation existed.
   * ───────────────────────────────────────────────────────────────────────────
   */
  if (booking.contact_id) {
    /* The owner's own language: this sentence is read in their CRM timeline,
       not by the client, and an English line in a Hebrew timeline is the kind
       of seam `activitySentence` exists to remove. */
    const locale = await getBusinessLocale(row.user_id);
    const when = activityMoment(booking.start_time, locale, booking.timezone || undefined) || '';
    const marker = await crmActivityRepository.create({
      user_id: row.user_id,
      contact_id: booking.contact_id as string,
      activity_type: 'booking_auto_completed',
      title: activitySentence('booking_auto_completed', { date: when }, locale),
      auto_logged: true,
      source_capability: 'scheduling',
      /* The booking this answers for — what the triage row matches on. */
      source_entity_id: booking.id,
    });

    if (marker.error) {
      log.warn(
        { err: marker.error, bookingId: booking.id },
        'Could not record the auto-completion; leaving the meeting for the owner to mark'
      );
      return { sent: false, reason: 'marker_failed' };
    }
  }

  /* `system`: a lead replying auto-completes this. No person pressed anything,
     and recording the owner would attribute a decision they did not make. */
  const { data, error } = await schedulingBookingRepository.complete(
    booking.id,
    row.user_id,
    'system'
  );

  if (error) {
    log.warn({ err: error, bookingId: booking.id }, 'Could not mark the meeting completed');
    return { sent: false, reason: 'complete_failed' };
  }

  /*
   * A null row means the atomic claim found nothing to change: somebody else
   * completed it first. Not a failure, and not a second event either.
   */
  if (!data) return { sent: false, reason: 'already_resolved' };

  log.info({ bookingId: booking.id }, 'Meeting marked completed automatically');
  return { sent: true };
}

/**
 * One reminder before the appointment, to whoever the owner asked for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Two audiences, two switches, and they fail independently: a client address
 * that bounces must not cost the owner their own heads-up, and an owner with no
 * email on file must not stop the client being reminded.
 *
 * EVERYTHING IS RE-CHECKED HERE
 *
 * The row was queued hours ago — a day, for the default lead time — and in that
 * window the appointment can be cancelled, moved, or simply have happened. A
 * reminder about a cancelled appointment is worse than no reminder, and one
 * that arrives after the meeting is noise with the business's name on it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function remindAboutMeeting(
  row: LeadResponse,
  log: Logger
): Promise<DispatchOutcome> {
  if (!row.entity_id) return { sent: false, reason: 'no_booking' };

  const { data: booking } = await supabaseServer
    .from('scheduling_bookings')
    .select('id, status, start_time, contact_id')
    .eq('id', row.entity_id)
    .eq('user_id', row.user_id)
    .maybeSingle();

  if (!booking) return { sent: false, reason: 'booking_gone' };
  if ((booking.status ?? '').toLowerCase() !== 'confirmed') {
    return { sent: false, reason: `booking_${booking.status}` };
  }

  const startsAt = booking.start_time ? Date.parse(String(booking.start_time)) : NaN;
  if (Number.isNaN(startsAt)) return { sent: false, reason: 'no_start_time' };
  if (startsAt < Date.now()) return { sent: false, reason: 'appointment_passed' };

  /*
   * Who the owner asked to be reminded. Read at SEND time, like the approval
   * itself — somebody who switches the owner copy off after the row was queued
   * should not receive one more.
   */
  const { data: profile, error: profileError } = await supabaseServer
    .from('business_profiles')
    .select('meeting_reminder_notify_client, meeting_reminder_notify_owner')
    .eq('user_id', row.user_id)
    .maybeSingle();

  /*
   * Unreadable means both, and says so out loud.
   *
   * The error is bound rather than destructured away so this cannot become one
   * of the silent fall-throughs: where the columns have not been added yet the
   * whole select is rejected, and the defaults below would otherwise be reached
   * with nothing recorded about why. Both-on is the migration's own default and
   * the only safe reading — the owner switched this automation on, so sending
   * the reminder is what they asked for; who receives it is the part in doubt.
   */
  if (profileError) {
    log.warn({ err: profileError }, 'Reminder audience unreadable; reminding both');
  }

  const notifyClient = (profile as Record<string, unknown> | null)?.meeting_reminder_notify_client !== false;
  const notifyOwner = (profile as Record<string, unknown> | null)?.meeting_reminder_notify_owner !== false;

  if (!notifyClient && !notifyOwner) return { sent: false, reason: 'nobody_to_notify' };

  const outcome = await BookingEmailService.sendMeetingReminder(booking.id, row.user_id, {
    notifyClient,
    notifyOwner,
  });

  if (!outcome.sent) {
    // An approved send that failed is an error, and the reason travels with
    // the row rather than being logged and discarded.
    log.error({ error: outcome.error, bookingId: booking.id }, 'Meeting reminder not sent');
    return { sent: false, reason: 'send_failed', detail: outcome.error };
  }

  return { sent: true };
}

/**
 * The lead conversation: send them somewhere they can book.
 *
 * Unchanged from before the other kinds existed — the checks here are about
 * whether this PERSON still needs an answer, which is a different question from
 * whether an invoice is still owed.
 */
async function inviteOrChaseLead(
  row: LeadResponse,
  log: Logger
): Promise<DispatchOutcome> {
  /*
   * Have they since booked?
   *
   * Every query below is scoped to `row.user_id`. The claim crossed tenants by
   * design; nothing after it is allowed to.
   */
  const { data: bookings } = await supabaseServer
    .from('scheduling_bookings')
    .select('id')
    .eq('user_id', row.user_id)
    .eq('contact_id', row.contact_id)
    .limit(1);

  if (bookings && bookings.length > 0) {
    return { sent: false, reason: 'already_booked' };
  }

  /*
   * Has the owner already answered this person themselves?
   *
   * The header above has always promised this check and never had it: only
   * `already_booked` was enforced. The gap is the likely case rather than the
   * exotic one — an attentive owner sees the alert, writes back within the
   * fifteen-minute window, and the platform then sends its own invitation on
   * top of a real reply the client has already had.
   *
   * `auto_logged = false` is what separates a person writing from the platform
   * writing: every automated touch this codebase makes sets it true, and the
   * manual activity endpoint sets it false.
   */
  const { data: ownerReplies } = await supabaseServer
    .from('crm_activities')
    .select('id')
    .eq('user_id', row.user_id)
    .eq('contact_id', row.contact_id)
    .eq('auto_logged', false)
    .gte('activity_date', row.created_at)
    .limit(1);

  if (ownerReplies && ownerReplies.length > 0) {
    return { sent: false, reason: 'already_replied' };
  }

  /*
   * A chase is only owed to somebody who got the first invitation and did
   * nothing with it. If the invitation never went out there is nothing to chase.
   */
  if (row.kind === 'chase') {
    const { data: invited } = await supabaseServer
      .from('crm_activities')
      .select('id')
      .eq('user_id', row.user_id)
      .eq('contact_id', row.contact_id)
      .eq('activity_type', 'booking_link_sent')
      .limit(1);

    if (!invited || invited.length === 0) {
      return { sent: false, reason: 'never_invited' };
    }
  }

  /*
   * The sentence the client reads, written when the enquiry arrived.
   *
   * On the INVITE only. A chase is a second message about a first one, and
   * opening it by acknowledging what they wrote two days ago reads as though
   * nobody noticed they never replied. The chase keeps the wording it has.
   *
   * Read defensively: rows queued before this existed carry no `opening`, and
   * an absent one simply means the invite reads as it always did.
   */
  const recommendation = (row.recommendation ?? {}) as { opening?: unknown };
  const opening =
    row.kind === 'invite' && typeof recommendation.opening === 'string'
      ? recommendation.opening
      : '';

  const outcome = await sendBookingLink(row.contact_id, row.user_id, {
    serviceId: row.service_id,
    reminder: row.kind === 'chase',
    // A queue sent this, not a person. Solicitation, so it needs consent.
    trigger: 'automated',
    ...(opening ? { opening } : {}),
  });

  if (!outcome.ok) {
    log.info({ reason: outcome.reason }, 'Lead response not sent');
    return { sent: false, reason: outcome.reason };
  }

  /*
   * Queue the single chase, two days out.
   *
   * Only after the invitation actually went — a reminder for a message nobody
   * received reads as nonsense. The unique index makes this a no-op if one
   * already exists, which is what keeps "one chase" true.
   */
  if (row.kind === 'invite' && !outcome.alreadySent) {
    await leadResponseRepository.enqueue({
      userId: row.user_id,
      contactId: row.contact_id,
      kind: 'chase',
      dueAt: new Date(Date.now() + CHASE_AFTER_MS),
      serviceId: row.service_id,
    });
  }

  return { sent: true };
}

/**
 * One reminder for an invoice still unpaid.
 *
 * `sendInvoice` is the same service the owner's own Resend button uses, so a
 * chase is byte-for-byte the message they would have sent by hand — and it
 * refuses a paid or cancelled invoice itself, which is the check that matters
 * most here: money can arrive in the window between the queue and the send.
 */
async function chaseInvoice(
  row: LeadResponse,
  log: Logger
): Promise<DispatchOutcome> {
  if (!row.entity_id) return { sent: false, reason: 'no_invoice' };

  // Scoped re-read: the invoice must still be this business's and still owed.
  const { data: invoice } = await supabaseServer
    .from('payment_invoices')
    .select('id, status')
    .eq('id', row.entity_id)
    .eq('user_id', row.user_id)
    .maybeSingle();

  if (!invoice) return { sent: false, reason: 'invoice_gone' };
  if (!['sent', 'pending', 'overdue'].includes(invoice.status as string)) {
    return { sent: false, reason: 'already_settled' };
  }

  const { error } = await sendInvoice({ invoiceId: row.entity_id, userId: row.user_id });
  if (error) {
    /*
     * `error`, not `info`. A chase the owner approved and the platform then
     * failed to deliver is not routine, and logging it at info put it below the
     * level production keeps.
     */
    log.error({ err: error, invoiceId: row.entity_id }, 'Invoice chase not sent');
    return { sent: false, reason: 'send_failed', detail: error.message };
  }

  return { sent: true };
}

/**
 * One reminder for an intake form still not returned.
 *
 * Refuses once the form is back or the appointment has passed — a request to
 * prepare for something that already happened is worse than saying nothing.
 */
async function chaseIntake(
  row: LeadResponse,
  log: Logger
): Promise<DispatchOutcome> {
  if (!row.entity_id) return { sent: false, reason: 'no_booking' };

  const { data: booking } = await supabaseServer
    .from('scheduling_bookings')
    .select('id, status, start_time, intake_completed_at')
    .eq('id', row.entity_id)
    .eq('user_id', row.user_id)
    .maybeSingle();

  if (!booking) return { sent: false, reason: 'booking_gone' };
  if (booking.intake_completed_at) return { sent: false, reason: 'already_returned' };
  if (booking.status !== 'confirmed') return { sent: false, reason: 'not_confirmed' };
  if (Date.parse(booking.start_time as string) < Date.now()) {
    return { sent: false, reason: 'appointment_passed' };
  }

  const outcome = await BookingEmailService.sendIntakeFormRequest(row.entity_id, row.user_id, {
    reminder: true,
  });

  if (!outcome.sent) {
    // Same as the invoice chase: an approved send that failed is an error, and
    // the reason it failed travels with the row.
    log.error({ error: outcome.error, bookingId: row.entity_id }, 'Intake chase not sent');
    return { sent: false, reason: 'send_failed', detail: outcome.error };
  }

  return { sent: true };
}

/**
 * Two days.
 *
 * FIVE days, not two.
 *
 * Two was too soon. By then the person has already had a welcome email and an
 * invitation, and a third message inside 48 hours reads as pressure from a
 * business they have spoken to once. Five leaves room for somebody who is
 * simply busy, and it spaces the whole sequence: enquiry and invitation on day
 * zero, chase on day five, and the insight nudge — if it comes at all — a week
 * after that rather than on its heels.
 *
 * Long enough that they have had a proper chance to act, short enough that the
 * business is still the one they wrote to. One chase, never a sequence: a
 * second reminder for something somebody has decided against reads as nagging,
 * and the owner can always write themselves. Same doctrine as
 * `IntakeReminderService`.
 */
const CHASE_AFTER_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * Find what the approved automations would act on, and queue it.
 *
 * ⟨unscoped-by-design⟩ on the first query only: it asks which businesses have
 * said yes, which necessarily crosses tenants. Everything after is scoped to
 * that business, and the gap registry is scoped by construction.
 *
 * Cheap because of the partial indexes: a business that has approved nothing is
 * never looked at.
 */
async function enqueueApprovedChases(): Promise<number> {
  let queued = 0;

  for (const automation of OPERATIONAL_AUTOMATIONS) {
    // Nothing for the sweep to queue: the lead invite is written by the alert
    // path at the moment the owner is told, so it has its own clock.
    if (!automation.sweepQueues) continue;

    /*
     * Somebody else sends this one.
     *
     * The invoice chase is carried out by `PaymentReminderService` on its own
     * schedule; this registry holds only the owner's answer. Queuing here as
     * well is what produced two emails on day three past due.
     */
    if (automation.carriedOutBy) continue;

    /*
     * The lead time travels with the approval.
     *
     * A `before_event` automation needs the owner's own number of hours, and
     * reading it per business inside the loop would be a query per account for
     * a value that arrives free with the row we are already selecting.
     */
    const columns = automation.leadHoursColumn
      ? `user_id, ${automation.leadHoursColumn}`
      : 'user_id';

    const { data: approved, error } = await supabaseServer
      .from('business_profiles')
      .select(columns)
      .eq(automation.column, true)
      .limit(SWEEP_BUSINESSES);

    if (error) {
      logger.warn({ err: error, automation: automation.id }, 'Could not list approved businesses');
      continue;
    }

    for (const row of (approved || []) as unknown as Array<Record<string, unknown>>) {
      const userId = row.user_id as string;

      try {
        /*
         * Said yes once is not the same as still able to.
         *
         * An owner can approve the intake chase and later unpublish the form,
         * and the column would still say yes. Asking again here means the
         * sweep stops writing to clients about a form that no longer reaches
         * them, without anyone having to remember to clear the column.
         */
        if (!(await automationApplies(userId, automation))) continue;

        const gaps = await findGaps(userId, { only: [automation.gapId], named: SWEEP_PER_BUSINESS });
        const items = gaps.flatMap(gap => gap.items);

        for (const item of items) {
          const dueAt = whenDue(automation, item, row);

          /*
           * Not yet. Two different "not yet"s, depending on the clock:
           *
           *   after_gap     it has not been stuck long enough, and the owner
           *                 still has their chance to handle it themselves
           *   before_event  the appointment is further away than the owner's
           *                 lead time, so the reminder would arrive early
           *
           * Either way the sweep runs again in five minutes and will pick it up
           * the moment it is due.
           */
          if (dueAt === null || dueAt.getTime() > Date.now()) continue;

          /*
           * A reminder whose moment has passed is not sent late.
           *
           * An appointment starting in ten minutes does not need a
           * twenty-four-hour reminder, and one that has already started needs
           * nothing at all. `after_gap` work has no equivalent — a chase is
           * still worth sending a week late.
           */
          if (automation.timing === 'before_event') {
            const eventAt = item.eventAt ? Date.parse(item.eventAt) : NaN;
            if (Number.isNaN(eventAt) || eventAt < Date.now()) continue;
          }

          /*
           * AND SOME WORK IS TOO OLD TO TAKE OVER AT ALL.
           *
           * ───────────────────────────────────────────────────────────────────
           * The comment above says a chase is still worth sending a week late,
           * and that is true of a chase. It is not true of
           * `auto_complete_meetings`, which does not send anything — it records
           * an answer. Recording that a meeting from two months ago went ahead
           * is not catching up, it is writing history the owner was never asked
           * about, and it includes every no-show nobody marked.
           *
           * That is exactly what used to happen the FIRST time the switch was
           * turned on: the gap behind it looks back ninety days, so saying yes
           * swept up to two hundred past meetings and closed every one.
           *
           * In steady state this changes nothing — the automation becomes due
           * twelve hours after a meeting and the sweep runs every five minutes,
           * so what it sees is always hours old, never days. All this excludes
           * is the backlog, which is the part nobody agreed to.
           *
           * A bound here rather than a column recording when the switch flipped:
           * the two answer the same question for this automation, and one of
           * them needs no migration and has no "enabled before we started
           * recording that" case to get wrong.
           * ───────────────────────────────────────────────────────────────────
           */
          if (automation.actsWithinHours !== undefined) {
            const lateBy = Date.now() - dueAt.getTime();
            if (lateBy > automation.actsWithinHours * 60 * 60 * 1000) continue;
          }

          // From the registry, which is also where the consent check reads it.
          const kind = automation.sweepQueues;

          // The unique index makes a repeat a no-op, but checking first keeps
          // the sweep from writing the same row on every five-minute run.
          if (await leadResponseRepository.hasRowFor(userId, kind, item.contactId, item.entityId ?? null)) {
            continue;
          }

          const { data } = await leadResponseRepository.enqueue({
            userId,
            contactId: item.contactId,
            kind,
            dueAt,
            entityId: item.entityId ?? null,
          });

          if (data) queued += 1;
        }
      } catch (err) {
        // One business failing must not stop the sweep for the rest.
        logger.warn({ err, userId, automation: automation.id }, 'Could not queue chases for a business');
      }
    }
  }

  return queued;
}

/** How many opted-in businesses one run looks at, and how deep into each. */
const SWEEP_BUSINESSES = 200;
const SWEEP_PER_BUSINESS = 20;
