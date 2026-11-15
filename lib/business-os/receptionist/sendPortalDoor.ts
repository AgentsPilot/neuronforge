/**
 * Send a client a door, or leave the owner a draft of one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE THING THE RECEPTIONIST MAY SEND.
 *
 * Until now it could send nothing: every outbound step in both variants was
 * `create_draft`, and the owner pressed send. That is safe and it makes the
 * owner the courier for messages they never edit — a draft reading "here is
 * the link to book" costs a Gmail trip and adds nothing.
 *
 * So: send a door, never send an answer.
 *
 *   A DOOR is a page where the CLIENT decides. A booking link does not book,
 *   a reschedule link does not reschedule, a refund form does not refund. If
 *   the agent misread the message, they get a door they do not walk through.
 *
 *   AN ANSWER is a price, a time, an availability, a commitment. Irreversible
 *   the moment it lands. Those stay drafts, whatever this file can do.
 *
 * The agent chooses WHICH door. It cannot choose the words: the copy is a
 * table in `portal-door.ts` with no free-text field, and there must never be
 * one. That is what makes "never send an answer" structural rather than a
 * instruction the model may drift from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO REASONS THIS DECLINES TO SEND, AND NEITHER IS A FAILURE
 *
 *   this door already went   → nothing; they were already asked
 *   there is nothing to open → nothing; no booking means no door
 *
 * There is deliberately no "may this agent send?" switch. Six of the nine
 * catalogue agents already email clients unprompted — the invoice chaser, the
 * three re-engagement agents, the quote chaser, the checkout recovery — and
 * none has one. The control they all share is install and pause, and a second
 * gate on the one agent whose sends are the WEAKEST (a link the client chooses
 * whether to open) would be an inconsistency dressed as caution. An agent
 * exists to take this work off the owner; a door they have to approve is the
 * owner handling the request.
 *
 * Each returns `skipped` with a reason. `remind_invoices` learned this the
 * hard way: it returned an error for every guard that fired, a daily agent
 * that correctly declined to chase reported "all items failed", and the
 * dashboard told the owner the agent was broken. An agent that reports itself
 * broken for doing the right thing gets switched off.
 *
 * Requirement: docs/requirements/BUSINESS_OS_RECEPTIONIST_SENDS_REQUIREMENT.md
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { sendEmail } from '@/lib/notifications/emailTransport';
import { recordEmailSend } from '@/lib/notifications/recordEmailSend';
import { platformOrigin } from '@/lib/utils/origins';
import { generateBookingToken } from '@/lib/services/bookingToken';
import { getBusinessLocale } from '@/lib/services/BookingEmailService';
import { resolveEmailBranding } from '@/lib/email/branding';
import {
  generatePortalDoorEmail,
  DOOR_TASK,
  type PortalDoor,
} from '@/lib/email/templates/portal-door';

const logger = createLogger({ service: 'SendPortalDoor' });

/**
 * One door per thread, ever.
 *
 * Written beside the send and checked before the next one. A client asked
 * twice to do the thing they already did is worse than not being asked: it
 * reads as a business that is not listening.
 */
const DOOR_SENT_ACTIVITY = 'portal_door_sent';

export interface SendPortalDoorInput {
  userId: string;
  contactId: string;
  door: PortalDoor;
  /** The conversation this answers, where there is one. Used for the dedupe. */
  threadId?: string | null;
  /** Which booking the door opens on. Resolved from the contact when absent. */
  bookingId?: string | null;
}

export interface SendPortalDoorResult {
  sent: boolean;
  skipped?: boolean;
  reason?: 'already_sent' | 'no_booking' | 'no_email' | 'send_failed';
}

/**
 * The booking a door should open on.
 *
 * The client's most recent one, because that is what a reply is almost always
 * about. A door opened on the wrong booking is recoverable — the portal shows
 * the whole list and every row carries its own link — but the common case
 * should be right without the client having to correct it.
 */
async function bookingFor(userId: string, contactId: string): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from('scheduling_bookings')
    .select('id, start_time')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .order('start_time', { ascending: false })
    .limit(1);

  if (error) {
    logger.error({ err: error, contactId }, 'Could not find a booking to open the door on');
    return null;
  }

  return (data?.[0]?.id as string) ?? null;
}

export async function sendPortalDoor(
  input: SendPortalDoorInput
): Promise<SendPortalDoorResult> {
  const { userId, contactId, door } = input;
  const log = logger.child({ userId, contactId, door });

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * ALREADY ASKED? Checked first, because it is the cheapest and because it is
   * true whether or not the business has opted in to sending.
   *
   * Scoped to the thread when there is one. Falling back to the contact would
   * repeat a mistake `client_reply_waiting` already made once: one settled
   * conversation silencing every other message from that person.
   * ───────────────────────────────────────────────────────────────────────────
   */
  if (input.threadId) {
    const { data: already } = await supabaseServer
      .from('crm_activities')
      .select('id')
      .eq('user_id', userId)
      .eq('activity_type', DOOR_SENT_ACTIVITY)
      .eq('source_thread_id', input.threadId)
      .limit(1);

    if (already?.length) {
      log.info({ threadId: input.threadId }, 'That door already went to this conversation');
      return { sent: false, skipped: true, reason: 'already_sent' };
    }
  }

  const bookingId = input.bookingId ?? (await bookingFor(userId, contactId));
  if (!bookingId) {
    /*
     * No booking means no portal, so there is no door to open. `book` is the
     * one that should work without one — a stranger asking about a service —
     * and it is a smart link rather than a portal token. Until that is wired,
     * this is an honest skip rather than a broken link.
     */
    log.info('No booking to open the door on');
    return { sent: false, skipped: true, reason: 'no_booking' };
  }

  const { data: contact } = await supabaseServer
    .from('crm_contacts')
    .select('email, first_name, last_name')
    .eq('id', contactId)
    .eq('user_id', userId)
    .maybeSingle();

  const clientEmail = (contact?.email as string | undefined)?.trim();
  if (!clientEmail) {
    log.warn('Contact has no email address');
    return { sent: false, skipped: true, reason: 'no_email' };
  }

  const { data: profile } = await supabaseServer
    .from('business_profiles')
    .select('business_name')
    .eq('user_id', userId)
    .maybeSingle();

  /*
   * THE CLIENT'S LANGUAGE IS THE BUSINESS'S, which is what every other
   * client-facing email in this codebase uses. Not the owner's UI language
   * and not a guess from the message.
   */
  const locale = await getBusinessLocale(userId);
  const branding = await resolveEmailBranding(userId, locale, profile ?? undefined);

  /*
   * THE RESOLVER, NEVER THE VARIABLE.
   *
   * This read `NEXT_PUBLIC_APP_URL || 'https://app.agentspilot.com'`, which is
   * the exact shape `oneAddressPolicy` exists to stop: a literal fallback that
   * is right wherever it was written and wrong everywhere else. A door is a
   * link a CLIENT clicks — an address that resolves to the wrong host is a
   * dead page for the one person the feature is for.
   *
   * `platformOrigin` knows what this environment actually is: the serving host
   * in a browser, the deployment on Vercel, the configured value otherwise.
   */
  const origin = platformOrigin();
  const token = generateBookingToken(bookingId, clientEmail);
  const url =
    door === 'book'
      ? `${origin}/book/manage/${token}`
      : `${origin}/book/manage/${token}?task=${DOOR_TASK[door]}`;

  const email = generatePortalDoorEmail({
    clientName: [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || null,
    businessName: (profile?.business_name as string) ?? '',
    url,
    door,
    branding,
    locale,
  });

  const result = await sendEmail({
    kind: 'transactional',
    to: [clientEmail],
    subject: email.subject,
    html: email.html,
    text: email.text,
    ownerUserId: userId,
  });

  if (!result.sent) {
    log.warn({ error: result.error }, 'The door did not send');
    return { sent: false, reason: 'send_failed' };
  }

  /* The send log, as every client-facing email does. Non-blocking: a logging
     failure must not make a sent email look unsent. */
  recordEmailSend({
    userId,
    contactId,
    bookingId,
    toEmail: clientEmail,
    subject: email.subject,
    bodyHtml: email.html,
    /* One kind for every door; the subject says which. See `EmailKind`. */
    kind: 'self_service_link',
    result,
  }).catch(err => log.warn({ err }, 'Email logging failed (non-blocking)'));

  /*
   * The dedupe marker, written AFTER the send and only on success. Before
   * would mean a failed send permanently marks the conversation as answered
   * and the client never gets their door.
   */
  await supabaseServer
    .from('crm_activities')
    .insert({
      user_id: userId,
      contact_id: contactId,
      activity_type: DOOR_SENT_ACTIVITY,
      title: email.subject,
      description: door,
      source_thread_id: input.threadId ?? null,
      activity_date: new Date().toISOString(),
    })
    .then(({ error }) => {
      if (error) log.warn({ err: error }, 'Could not record that the door was sent');
    });

  log.info({ bookingId }, 'Sent the client a door');
  return { sent: true };
}
