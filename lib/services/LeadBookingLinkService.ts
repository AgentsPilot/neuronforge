/**
 * Send somebody who enquired a link they can book themselves in with.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * A lead arrives, and the fastest useful reply is nearly always the same: here
 * is where you book. Today the owner does that by hand — read the enquiry, open
 * a mail client, find their own booking link, write a message — for every lead,
 * before any work can begin. The platform already holds all three pieces.
 *
 * WHAT IT REFUSES TO DO
 *
 * Send a link whose journey cannot run. `journeyGaps` answers whether a service
 * can actually be booked — working hours set, a payment processor connected
 * where money is taken — and a booking link that lands on a dead end is worse
 * than no reply at all: the client has now seen the business fail at the one
 * thing it asked them to do.
 *
 * CLAIM FIRST, THEN EVERYTHING VISIBLE
 *
 * `ProposalSendService`'s doctrine, for the same reason: the send is the thing
 * that cannot be taken back. Here the claim is an activity row written before
 * the mail goes out, so a double-click or a retried request cannot send the
 * same person two invitations.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/services/LeadBookingLinkService
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import { sendEmail } from '@/lib/notifications/emailTransport';
import { resolveEmailBranding } from '@/lib/email/branding';
import { resolveBookingUrl } from '@/lib/branding/platformSite';
import { generateBookingInviteEmail } from '@/lib/email/templates/booking-invite';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { schedulingServiceRepository, type SchedulingService } from '@/lib/repositories/SchedulingRepository';
import { journeyGaps, describeJourneyGaps } from '@/lib/business-os/journeyReadiness';
import { isQuoted } from '@/lib/business-os/clientJourney';
import { activitySentence } from '@/lib/business-os/activityText';
import { defaultLocale, isValidLocale, type Locale } from '@/lib/i18n/config';

const logger = createLogger({ service: 'LeadBookingLinkService' });

/** The activity type that records this send — and doubles as the claim. */
export const BOOKING_LINK_ACTIVITY = 'booking_link_sent';

export type SendBookingLinkOutcome =
  | { ok: true; alreadySent: boolean; bookingUrl: string; serviceName?: string }
  | {
      ok: false;
      reason: 'not_found' | 'no_contact_email' | 'no_booking_url' | 'journey_not_ready' | 'send_failed';
      /** Something the owner can act on, where there is one. */
      detail?: string;
    };

export interface SendBookingLinkOptions {
  /** Point the link at one service. Ownership is checked here, never assumed. */
  serviceId?: string | null;
  /** The two-day chase rather than the first invitation. */
  reminder?: boolean;
  /**
   * Who decided to send this. Required, because the same email is two different
   * things depending on the answer.
   *
   * `owner` — a person clicked Send in the CRM, in reply to an enquiry. That is
   * a solicited response and it is transactional.
   *
   * `automated` — the lead-response queue sent it on a timer. Nobody asked for
   * it at the moment it went out, so it is a solicitation and needs consent.
   *
   * There is a real argument that an automated invite minutes after someone
   * submitted an enquiry is still a reply to THEM — they asked to be contacted.
   * The two-day chase to someone who ignored it is much weaker ground. Both are
   * gated here, which is the strict reading; loosening the invite is a
   * one-line change at the caller if that is ever the decision.
   */
  trigger: 'owner' | 'automated';
}

function normaliseLocale(value: unknown): Locale | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return isValidLocale(trimmed) ? (trimmed as Locale) : null;
}

export async function sendBookingLink(
  contactId: string,
  userId: string,
  // No default: `trigger` is the whole point, and a default would pick one of
  // the two answers on the caller's behalf.
  options: SendBookingLinkOptions
): Promise<SendBookingLinkOutcome> {
  const log = logger.child({ contactId, userId, reminder: Boolean(options.reminder) });

  /*
   * The contact, scoped to this business.
   *
   * `contactId` arrives from a request, so this read IS the ownership check —
   * `supabaseServer` bypasses RLS and would happily return somebody else's
   * contact. Fails closed on null.
   */
  const { data: contact } = await supabaseServer
    .from('crm_contacts')
    .select('id, first_name, last_name, email')
    .eq('id', contactId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!contact) return { ok: false, reason: 'not_found' };
  if (!contact.email) return { ok: false, reason: 'no_contact_email' };

  /*
   * The service, if one was named — also scoped.
   *
   * A repository scoped on the CONTACT does not protect the SERVICE: these are
   * two separate caller-supplied ids and each needs its own check.
   */
  let service: SchedulingService | null = null;
  if (options.serviceId) {
    const result = await schedulingServiceRepository.findById(options.serviceId, userId);
    if (!result.data) return { ok: false, reason: 'not_found' };
    service = result.data;
  }

  const profileResult = await businessProfileRepository.findByUserId(userId);
  const profile = profileResult.data;

  const bookingUrl = await resolveBookingUrl(userId, profile);
  if (!bookingUrl) {
    // No published site and no user_code — nothing bookable to point at.
    return { ok: false, reason: 'no_booking_url' };
  }

  /*
   * Does the journey this link starts actually run?
   *
   * Checked against the named service where there is one, and against every
   * bookable service otherwise — because a generic link offers all of them, and
   * a client who picks the one with no working hours behind it hits the same
   * dead end.
   */
  const servicesToCheck = service
    ? [service]
    : ((await schedulingServiceRepository.listAll(userId, true)).data ?? []);

  if (servicesToCheck.length > 0) {
    const gaps = await journeyGaps(userId, servicesToCheck);
    if (gaps.length > 0) {
      log.info({ gaps: gaps.map(g => g.kind) }, 'Refusing to send a booking link with a broken journey');
      return { ok: false, reason: 'journey_not_ready', detail: describeJourneyGaps(gaps) };
    }
  }

  /*
   * The claim.
   *
   * Written before the mail, so a retried request finds it and stops. A
   * reminder is allowed to pass an existing invitation — that is the point of a
   * chase — but never a second reminder.
   */
  const claimType = options.reminder ? 'booking_link_chase' : BOOKING_LINK_ACTIVITY;
  const { data: existing } = await supabaseServer
    .from('crm_activities')
    .select('id')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .eq('activity_type', claimType)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return { ok: true, alreadySent: true, bookingUrl, serviceName: service?.service_name };
  }

  /*
   * The RECIPIENT's language, which is the business's — they are writing to a
   * client, not to themselves. The owner-facing alert does the opposite.
   */
  const locale = normaliseLocale(profile?.language) ?? defaultLocale;
  const branding = await resolveEmailBranding(userId, locale, profile);

  const serviceUrl = service ? `${bookingUrl}?service=${encodeURIComponent(service.id)}` : bookingUrl;

  const { subject, html } = generateBookingInviteEmail({
    clientName: contact.first_name,
    businessName: branding.businessName,
    bookingUrl: serviceUrl,
    serviceName: service?.service_name,
    // Quoted work ends at a request, so the copy must not promise a booking.
    isQuote: isQuoted(service?.sale_mode),
    reminder: options.reminder,
    branding,
    locale,
  });

  const result = await sendEmail({
    ...(options.trigger === 'automated'
      ? { kind: 'marketing' as const, ownerUserId: userId, contactId }
      : { kind: 'transactional' as const, ownerUserId: userId }),
    to: [contact.email],
    subject,
    html,
  });

  if (result.blocked) {
    // Not a failure to deliver. Nobody agreed to be solicited on a timer, and
    // trying again tomorrow gets the same answer.
    log.info({ blocked: result.blocked, contactId }, 'Automated booking link withheld');
    return { ok: false, reason: 'send_failed', detail: `not sent: ${result.blocked}` };
  }

  if (!result.sent) {
    log.warn({ error: result.error }, 'Booking link failed to send');
    return { ok: false, reason: 'send_failed', detail: result.error };
  }

  /*
   * Record it on the contact's own timeline. Unlike the owner alert, this email
   * genuinely went TO the client, so it belongs in their history.
   */
  await supabaseServer
    .from('crm_activities')
    .insert({
      user_id: userId,
      contact_id: contactId,
      activity_type: claimType,
      title: activitySentence(claimType, {}, locale),
      description: serviceUrl,
      activity_date: new Date().toISOString(),
      auto_logged: true,
      source_capability: 'website',
    })
    .then(({ error }) => {
      if (error) log.warn({ err: error }, 'Could not log the booking link send (non-blocking)');
    });

  log.info({ provider: result.provider, serviceId: service?.id }, 'Booking link sent');
  return { ok: true, alreadySent: false, bookingUrl: serviceUrl, serviceName: service?.service_name };
}
