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
import { createLogger, type Logger } from '@/lib/logger';
import { leadResponseRepository, type LeadResponse } from '@/lib/repositories/LeadResponseRepository';
import { sendBookingLink } from '@/lib/services/LeadBookingLinkService';
import { OPERATIONAL_AUTOMATIONS } from '@/lib/business-os/gaps/automations';
import { findGaps } from '@/lib/business-os/gaps/findGaps';
import { sendInvoice } from '@/lib/services/InvoiceDeliveryService';
import { BookingEmailService } from '@/lib/services/BookingEmailService';

const logger = createLogger({ service: 'LeadResponseDispatchService' });

/** Must exceed the cron route's maxDuration, or a live row gets reclaimed. */
const LEASE_SECONDS = 90;
const MAX_ATTEMPTS = 3;
const BATCH = 25;

export interface DispatchResult {
  reaped: number;
  enqueued: number;
  claimed: number;
  sent: number;
  skipped: number;
}

export async function dispatchLeadResponses(): Promise<DispatchResult> {
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
  result.enqueued = await enqueueApprovedChases();

  const rows = await leadResponseRepository.claimDue(runnerId, BATCH);
  result.claimed = rows.length;

  for (const row of rows) {
    try {
      const outcome = await dispatchOne(row);
      if (outcome.sent) {
        await leadResponseRepository.markSent(row.id);
        result.sent += 1;
      } else {
        await leadResponseRepository.markSkipped(row.id, outcome.reason || 'unknown');
        result.skipped += 1;
      }
    } catch (err) {
      // Deliberately left `processing`. See the module header.
      logger.error({ err, id: row.id, userId: row.user_id }, 'Lead response threw; leaving it to the reaper');
    }
  }

  return result;
}

async function dispatchOne(row: LeadResponse): Promise<{ sent: boolean; reason?: string }> {
  const log = logger.child({ id: row.id, userId: row.user_id, contactId: row.contact_id, kind: row.kind });

  /*
   * Does the owner still permit this KIND of work?
   *
   * Per row rather than once per run, and per kind rather than one switch: a
   * business can withdraw permission in the window between the queue and the
   * send, and "reply to my enquiries" is a different consent from "chase my
   * clients for money".
   */
  const automation = OPERATIONAL_AUTOMATIONS.find(entry =>
    row.kind === 'invite' || row.kind === 'chase'
      ? entry.id === 'reply_to_enquiries'
      : row.kind === 'invoice_chase'
        ? entry.id === 'chase_invoices'
        : entry.id === 'chase_intake'
  );

  if (!automation) return { sent: false, reason: 'unknown_kind' };

  const { data: profile } = await supabaseServer
    .from('business_profiles')
    .select(automation.column)
    .eq('user_id', row.user_id)
    .maybeSingle();

  if (!(profile as Record<string, unknown> | null)?.[automation.column]) {
    return { sent: false, reason: 'not_approved' };
  }

  if (row.kind === 'invoice_chase') return chaseInvoice(row, log);
  if (row.kind === 'intake_chase') return chaseIntake(row, log);
  return inviteOrChaseLead(row, log);
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
): Promise<{ sent: boolean; reason?: string }> {
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

  const outcome = await sendBookingLink(row.contact_id, row.user_id, {
    serviceId: row.service_id,
    reminder: row.kind === 'chase',
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
): Promise<{ sent: boolean; reason?: string }> {
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
    log.info({ err: error }, 'Invoice chase not sent');
    return { sent: false, reason: 'send_failed' };
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
): Promise<{ sent: boolean; reason?: string }> {
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
    log.info({ error: outcome.error }, 'Intake chase not sent');
    return { sent: false, reason: 'send_failed' };
  }

  return { sent: true };
}

/**
 * Two days.
 *
 * Long enough that they have had a proper chance to act, short enough that the
 * business is still the one they wrote to. One chase, never a sequence: a
 * second reminder for something somebody has decided against reads as nagging,
 * and the owner can always write themselves. Same doctrine as
 * `IntakeReminderService`.
 */
const CHASE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

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
    // The lead invite is queued by the alert path at the moment the owner is
    // told, so it has its own clock and is not swept for here.
    if (automation.kind === 'invite') continue;

    const { data: approved, error } = await supabaseServer
      .from('business_profiles')
      .select('user_id')
      .eq(automation.column, true)
      .limit(SWEEP_BUSINESSES);

    if (error) {
      logger.warn({ err: error, automation: automation.id }, 'Could not list approved businesses');
      continue;
    }

    for (const row of approved || []) {
      const userId = row.user_id as string;

      try {
        const gaps = await findGaps(userId, { only: [automation.gapId], named: SWEEP_PER_BUSINESS });
        const items = gaps.flatMap(gap => gap.items);

        for (const item of items) {
          /*
           * Only once it has been stuck long enough.
           *
           * The registry's own staleness window answers "is this a gap"; this
           * answers "has the owner had their chance first". An invoice one hour
           * past due is a gap and is nobody's emergency.
           */
          const stuckSince = Date.parse(item.since);
          const dueAt = Number.isNaN(stuckSince)
            ? new Date()
            : new Date(stuckSince + automation.delayHours * 60 * 60 * 1000);

          if (dueAt.getTime() > Date.now()) continue;

          const kind = automation.id === 'chase_invoices' ? 'invoice_chase' : 'intake_chase';

          // The unique index makes a repeat a no-op, but checking first keeps
          // the sweep from writing the same row on every five-minute run.
          if (await leadResponseRepository.hasPending(userId, kind, item.contactId, item.entityId ?? null)) {
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
