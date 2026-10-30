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

/**
 * One attempt, by its id, for a caller outside the cron.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The same email the sweep sends, reachable by id so an automation agent can
 * call it. An agent reaches ACTIONS and nothing else, so a capability with no
 * door onto it may as well not exist — the fourth time this has come up, after
 * `contacts.invite`, `proposals.remind` and `invoices.remind`.
 *
 * It does not CREATE `recovery_email_sent_at`. That column is the CRON's claim,
 * the record that the one automatic recovery has been spent, and an agent
 * stamping a null row would tell the sweep it had already run. The agent works
 * the TAIL — attempts the sweep has finished with — and how long it keeps
 * trying is the owner's stop rule in the plan's find.
 *
 * It does REFRESH an existing one, which this comment used to rule out
 * altogether, and that absence was a defect: with nothing written and nothing
 * read about the row in front of it, the agent mailed the same attempt on
 * every run. See `refreshRecoveryStamp` for why moving a stamp that already
 * exists cannot cost the sweep anything, and the cooldown below for what now
 * reads it.
 *
 * Re-reads the attempt first, for the reason every send in this codebase
 * re-reads: between an agent finding a row and reaching here, the person may
 * have come back and booked, and `convertAttempt` would have moved the row to
 * `converted`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function sendOneRecovery(
  attemptId: string,
  userId: string
): Promise<{ sent: boolean; reason?: string }> {
  const log = logger.child({ attemptId, userId });

  const { data: attempt, error } = await supabaseServer
    .from('abandoned_bookings')
    .select(
      'id, user_id, service_id, first_name, email, start_time, timezone, page_url, locale, status, recovery_email_sent_at'
    )
    .eq('id', attemptId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !attempt) return { sent: false, reason: 'attempt no longer exists' };

  /* The check that matters most, at the last moment it can be made. */
  if (attempt.status !== 'abandoned') {
    return { sent: false, reason: `attempt is ${attempt.status}` };
  }

  if (!attempt.email) return { sent: false, reason: 'no email on the attempt' };

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHEN WAS THIS ONE LAST MAILED?
   *
   * The shared address window inside `deliverRecovery` cannot answer it: it
   * excludes this very row, because the sweep stamps before it delivers and
   * would otherwise refuse its own send. So the one row the agent is pointed
   * at was the one row nothing checked, and two things followed.
   *
   * It repeated. `recoverAbandonedCheckouts` finds attempts where
   * `recovery_email_sent_at IS NOT NULL` — the tail the sweep has finished
   * with — and a send changed no value that find reads. The same row came back
   * every run: on a daily cadence, one person told every morning for as long
   * as the owner's stop rule allowed.
   *
   * And it could land behind the sweep. An attempt mailed and stamped an hour
   * earlier was still a candidate, and the stamp proving it was the excluded
   * one.
   *
   * Asked here rather than widening the shared window, because the two callers
   * need opposite answers about this row: the sweep must ignore its own stamp,
   * the agent must respect it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const lastMailed = attempt.recovery_email_sent_at as string | null;

  if (lastMailed && Date.parse(lastMailed) > Date.now() - ONE_PER_ADDRESS_DAYS * 86_400_000) {
    log.info({ lastMailed }, 'Recovery skipped: this attempt was mailed inside the window');
    return { sent: false, reason: `already mailed within ${ONE_PER_ADDRESS_DAYS} days` };
  }

  const sent = await deliverRecovery(attempt as RecoverableAttempt, log);

  if (!sent) return { sent: false, reason: 'send failed' };

  /*
   * Refresh the stamp, so the check above can see this send on the next run.
   *
   * The reason the agent was told not to write this column — that it would
   * tell the sweep a row had already been handled — cannot apply to the rows
   * the agent reaches: its find requires the stamp to be NOT NULL already, and
   * the sweep selects on `IS NULL`. A row the sweep has permanently stopped
   * seeing cannot be hidden from it again.
   *
   * `refreshRecoveryStamp` enforces that rather than trusting it: the update
   * only touches a row whose stamp already exists, so a caller pointed at a
   * never-mailed attempt still leaves the sweep's claim alone.
   */
  await refreshRecoveryStamp(attempt.id as string, userId, log);

  return { sent: true };
}

/**
 * Move an EXISTING recovery stamp to now. Never creates one.
 *
 * The `.not(… is null)` condition is the safety argument, not a tidiness: an
 * update that could stamp a NULL row would take that attempt away from the
 * sweep, which is the one thing the agent must not do. Written as a condition
 * so it holds for every future caller, not only the one above.
 *
 * Non-blocking. The email has already gone; a lost refresh risks at most one
 * duplicate a week later, where failing the call invites a retry that sends
 * again now.
 */
async function refreshRecoveryStamp(
  attemptId: string,
  userId: string,
  log: typeof logger
): Promise<void> {
  const { error } = await supabaseServer
    .from('abandoned_bookings')
    .update({ recovery_email_sent_at: new Date().toISOString() })
    .eq('id', attemptId)
    .eq('user_id', userId)
    .not('recovery_email_sent_at', 'is', null);

  if (error) log.warn({ err: error, attemptId }, 'Could not refresh the recovery stamp');
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

    if (await deliverRecovery(attempt, log)) sent += 1;
  }

  return sent;
}

/**
 * Compose and send one recovery email.
 *
 * Extracted so the cron's sweep and `sendOneRecovery` cannot drift. A client
 * must not be able to tell which route reached them: the only thing that
 * differs between the two is who decided to send.
 *
 * Returns whether it went, and never throws. One failed attempt must not stop
 * a sweep of fifty, and the agent reports per person from its own fan-out.
 */
/**
 * At most one recovery per ADDRESS per week, whoever is asking.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The claim this file had was per ATTEMPT: `recovery_email_sent_at` stamped on
 * the row, so each abandoned attempt earned its own email. One person who
 * cannot get through a checkout produces one attempt per try, and the sweep
 * mailed every one of them.
 *
 * Found on a live account: 13 attempts from a single address, EIGHT recovery
 * emails sent to it, and 4 more to another. Nobody is served by being told
 * eight times that they did not finish booking.
 *
 * A week, because that is the shortest interval at which a second message
 * reads as a reminder rather than a pile-on, and because somebody genuinely
 * trying again a fortnight later is a different conversation.
 *
 * Checked HERE rather than in either caller, so the cron and the agent cannot
 * disagree about it — the whole reason this function exists.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const ONE_PER_ADDRESS_DAYS = 7;

async function mailedRecently(attempt: RecoverableAttempt, log: typeof logger): Promise<boolean> {
  const since = new Date(Date.now() - ONE_PER_ADDRESS_DAYS * 86_400_000).toISOString();

  const { data, error } = await supabaseServer
    .from('abandoned_bookings')
    .select('id')
    .eq('user_id', attempt.user_id)
    .ilike('email', emailLikePattern(attempt.email as string))
    /*
     * This attempt itself is excluded, and that is LOAD-BEARING for the sweep:
     * it stamps the row before delivering, so a window that counted the row's
     * own stamp would make the sweep refuse every send it had just claimed.
     *
     * It does leave the agent door unguarded about the row in front of it —
     * the agent neither stamps nor is stopped by its own history. That is
     * answered in `sendOneRecovery`, where the agent re-reads the attempt, and
     * not here, because the two callers need opposite answers about this one
     * row and one query cannot give both.
     */
    .neq('id', attempt.id)
    .gte('recovery_email_sent_at', since)
    .limit(1)
    .maybeSingle();

  if (error) {
    /* Fail CLOSED. A lookup that errors must not become permission to send:
       the cost of a missed recovery is one email nobody reads, and the cost of
       the other mistake is the eight this exists to stop. */
    log.warn({ err: error }, 'Could not check recent recoveries; skipping this one');
    return true;
  }

  return Boolean(data);
}

async function deliverRecovery(
  attempt: RecoverableAttempt,
  log: typeof logger
): Promise<boolean> {
  if (!attempt.email) return false;

  if (await mailedRecently(attempt, log)) {
    log.info({ attemptId: attempt.id }, 'Recovery skipped: this address had one this week');
    return false;
  }

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

    return result.sent;
  } catch (err) {
    log.error({ err, attemptId: attempt.id }, 'Could not send a recovery email');
    return false;
  }
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
