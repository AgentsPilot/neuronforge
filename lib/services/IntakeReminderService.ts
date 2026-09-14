/**
 * Chase a client who has not filled in their intake form.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The form is emailed when the booking is made, which for an appointment three
 * weeks out means it arrives three weeks early and is forgotten. The owner then
 * discovers it on the day, with a client in front of them and nothing to have
 * read beforehand — which is the whole point of collecting it.
 *
 * So: ONE reminder, a day before, and only while it can still be acted on.
 *
 * ONE, not a sequence. A second chase for a form somebody has already decided
 * not to fill in reads as nagging, and the owner can simply ask in the session.
 * The single stamp on the booking is what makes it one — it is set as the mail
 * goes out, so the next run finds nothing.
 *
 * WHO IS NOT CHASED
 *
 *   answered already          `intake_completed_at`
 *   cancelled, or done        anything but `confirmed`
 *   never asked               no `intake_sent_at` — nothing to remind them of
 *   nothing to prepare for    a quote request, or a service with no slot
 *   the business turned it off `intakeReachesClient` says so now
 *
 * The last one is asked per booking rather than once per run, because a
 * business can switch intake off between the booking and the meeting, and the
 * client should not then be chased for a form nobody is waiting on.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/services/IntakeReminderService
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { intakeAppliesToService } from '@/lib/business-os/intakeReach';

const logger = createLogger({ service: 'IntakeReminderService' });

/**
 * How long before the meeting to chase.
 *
 * A day: long enough that the client has an evening to do it, short enough that
 * the meeting is real to them. The cron runs hourly, so the window below is a
 * band rather than an instant — a booking is chased on the first run that finds
 * it inside the band, and the stamp keeps it from being chased again.
 */
const HOURS_BEFORE = 24;

/** Bookings sooner than this are left alone: a reminder they cannot act on is noise. */
const MIN_HOURS_BEFORE = 2;

export interface IntakeReminderResult {
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
}

interface DueBooking {
  id: string;
  user_id: string;
  start_time: string;
  service: { sale_mode: string | null; is_scheduled: boolean | null } | null;
}

export class IntakeReminderService {
  /**
   * Send the reminders that are due right now.
   *
   * Sequential rather than parallel: these are emails on a shared transport,
   * and a burst is the fastest way to be rate limited. The volume is one per
   * meeting per day, so there is nothing to gain by hurrying.
   */
  async sendDue(limit = 200): Promise<IntakeReminderResult> {
    const now = Date.now();
    const from = new Date(now + MIN_HOURS_BEFORE * 3600 * 1000).toISOString();
    const to = new Date(now + HOURS_BEFORE * 3600 * 1000).toISOString();

    const { data, error } = await supabaseServer
      .from('scheduling_bookings')
      .select('id, user_id, start_time, service:scheduling_services(sale_mode, is_scheduled)')
      .eq('status', 'confirmed')
      .is('intake_completed_at', null)
      .is('intake_reminded_at', null)
      .not('intake_sent_at', 'is', null)
      .gte('start_time', from)
      .lte('start_time', to)
      .order('start_time', { ascending: true })
      .limit(limit);

    if (error) {
      logger.error({ err: error }, 'Could not read bookings due an intake reminder');
      return { considered: 0, sent: 0, skipped: 0, failed: 0 };
    }

    const due = (data || []) as unknown as DueBooking[];
    const result: IntakeReminderResult = { considered: due.length, sent: 0, skipped: 0, failed: 0 };

    for (const booking of due) {
      /*
       * A quote request or a product has no meeting to prepare for. The send
       * path refuses these anyway; asking here keeps a pointless email attempt
       * — and its log line — out of the run entirely.
       */
      if (!intakeAppliesToService(booking.service)) {
        result.skipped++;
        continue;
      }

      try {
        /*
         * `manual: false` — this is the platform chasing on the business's
         * behalf, so it is the automatic path, and it inherits every check that
         * path makes: intake still switched on, a form still published.
         */
        const email = await BookingEmailService.sendIntakeFormRequest(booking.id, booking.user_id, {
          reminder: true,
        });

        if (email.sent) {
          result.sent++;
        } else {
          // Refused rather than broken — intake switched off since the booking,
          // or the form unpublished. Not a failure, and not worth retrying.
          result.skipped++;
          logger.info(
            { bookingId: booking.id, reason: email.error },
            'Intake reminder not applicable'
          );
        }

        /*
         * Stamped either way.
         *
         * A booking that was skipped must not be reconsidered on the next run:
         * the answer will be the same, and an hourly cron would ask it until
         * the meeting. The stamp records that this booking has had its one
         * chance at a reminder, which is what it means.
         */
        await this.stamp(booking.id, booking.user_id);
      } catch (err) {
        result.failed++;
        logger.error({ err, bookingId: booking.id }, 'Intake reminder failed');
        // Deliberately NOT stamped: a thrown error is a transport problem, and
        // the next run should try again while the meeting is still ahead.
      }
    }

    logger.info(result, 'Intake reminders processed');
    return result;
  }

  private async stamp(bookingId: string, userId: string): Promise<void> {
    const { error } = await supabaseServer
      .from('scheduling_bookings')
      .update({ intake_reminded_at: new Date().toISOString() })
      .eq('id', bookingId)
      .eq('user_id', userId);

    if (error) {
      // Worth a warning: without the stamp this booking is chased again next
      // hour, which is the one failure mode this service must not have.
      logger.warn({ err: error, bookingId }, 'Could not stamp intake_reminded_at');
    }
  }
}

export const intakeReminderService = new IntakeReminderService();
