/**
 * One way back, for the clients who did not finish.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HALF THAT WAS DESIGNED AND NOT WRITTEN
 *
 * `20261071` added `page_url`, `locale` and `recovery_email_sent_at`, plus a
 * partial index on `status = 'abandoned' AND recovery_email_sent_at IS NULL`
 * described as "exactly the condition the sender uses". There was no sender.
 * `create` has been faithfully storing the page and the language "so the email
 * is written in it" into a feature that did not exist.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONCE, AND ONLY ONCE
 *
 * `recovery_email_sent_at` is stamped whether or not the send succeeded, and
 * that is deliberate. A transport failure that left it null would have the next
 * run try again, and the run after that — a client who could not be reached
 * being mailed every half hour is a worse failure than one who never hears
 * from us at all. One attempt, recorded, and the row drops out of the index.
 *
 * Attempts with no email address are stamped too, for the same reason: there is
 * nothing to retry, and leaving them in the index means scanning them for ever.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { sendEmail } from '@/lib/notifications/emailTransport';
import { recordEmailSend } from '@/lib/notifications/recordEmailSend';
import { resolveEmailBranding } from '@/lib/email/branding';
import { generateBookingRecoveryEmail } from '@/lib/email/templates/booking-recovery';
import type { Locale } from '@/lib/i18n/config';
import { emailLikePattern } from '@/lib/utils/emailMatch';

const logger = createLogger({ module: 'abandonedRecovery' });

/** Never mail a cold batch on first deploy. */
const MAX_PER_RUN = 50;

interface RecoverableAttempt {
  id: string;
  user_id: string;
  service_id: string | null;
  first_name: string | null;
  email: string | null;
  start_time: string | null;
  timezone: string | null;
  page_url: string | null;
  locale: string | null;
}

export async function sendAbandonedRecoveries(
  log: typeof logger = logger
): Promise<number> {
  const { data: rows, error } = await supabaseServer
    .from('abandoned_bookings')
    .select('id, user_id, service_id, first_name, email, start_time, timezone, page_url, locale')
    /* The partial index's own condition, so this is an index scan. */
    .eq('status', 'abandoned')
    .is('recovery_email_sent_at', null)
    .order('created_at', { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) {
    log.error({ err: error }, 'Could not read the attempts awaiting recovery');
    return 0;
  }

  const attempts = (rows ?? []) as RecoverableAttempt[];
  if (attempts.length === 0) return 0;

  let sent = 0;

  for (const attempt of attempts) {
    /* Stamped first, so a crash halfway through this loop cannot leave a row
       that gets mailed twice on the next run. */
    await stamp(attempt.id, log);

    if (!attempt.email) continue;

    try {
      const locale = (attempt.locale as Locale) || 'en';
      const branding = await resolveEmailBranding(attempt.user_id, locale);

      const serviceName = await nameOfService(attempt.service_id);

      const { subject, html } = generateBookingRecoveryEmail({
        clientName: attempt.first_name || '',
        serviceName,
        startTime: attempt.start_time ? new Date(attempt.start_time) : null,
        timezone: attempt.timezone,
        bookAgainUrl: attempt.page_url,
        /* So the button opens on the service they were choosing, not the list. */
        serviceId: attempt.service_id,
        branding,
        locale: locale as 'en' | 'es' | 'he',
      });

      const result = await sendEmail({
        to: [attempt.email],
        subject,
        html,
        kind: 'transactional',
        ownerUserId: attempt.user_id,
      });

      /*
       * ── IT HAS TO FIND THE CONTACT, OR IT IS NOT RECORDED AT ALL ────────
       *
       * `recordEmailSend` writes nothing when `contactId` is null — deliberate,
       * because `email_sends.contact_id` is NOT NULL and a trigger on the table
       * inserts a `crm_activities` row whose own contact is NOT NULL too.
       *
       * This passed null on the reasoning that an unconverted attempt has no
       * contact. True in general and wrong whenever the client already exists:
       * a returning client who abandons IS in the CRM, and the message to them
       * vanished — the send happened, the stamp went on the attempt, and the
       * owner had no way to see it. Caught on a real abandonment.
       *
       * Still null for a genuinely new client, and that is correct: there is no
       * contact to attach it to and inventing one would put a stranger in the
       * CRM for walking away.
       *
       * No `bookingId`: there is no booking, which is the entire subject.
       */
      const { data: contact } = await supabaseServer
        .from('crm_contacts')
        .select('id')
        .eq('user_id', attempt.user_id)
        /* Case-insensitive and escaped, like every other contact lookup — an
           address stored as the visitor typed it is otherwise missed, and the
           recovery mail is then filed against no contact at all. */
        .ilike('email', emailLikePattern(attempt.email))
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      await recordEmailSend({
        userId: attempt.user_id,
        contactId: (contact?.id as string) ?? null,
        toEmail: attempt.email,
        subject,
        bodyHtml: html,
        kind: 'booking_recovery',
        result,
      });

      if (result.sent) sent += 1;
    } catch (err) {
      log.error({ err, attemptId: attempt.id }, 'Could not send a recovery email');
    }
  }

  return sent;
}

async function stamp(attemptId: string, log: typeof logger): Promise<void> {
  const { error } = await supabaseServer
    .from('abandoned_bookings')
    .update({ recovery_email_sent_at: new Date().toISOString() })
    .eq('id', attemptId);

  if (error) log.warn({ err: error, attemptId }, 'Could not stamp the recovery send');
}

/** The service's name, or a neutral word. Never an id in front of a client. */
async function nameOfService(serviceId: string | null): Promise<string> {
  if (!serviceId) return '';
  const { data } = await supabaseServer
    .from('scheduling_services')
    .select('service_name')
    .eq('id', serviceId)
    .maybeSingle();
  return (data?.service_name as string) || '';
}
