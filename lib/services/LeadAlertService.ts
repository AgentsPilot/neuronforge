/**
 * Tell the owner that somebody reached them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GAP THIS CLOSES
 *
 * Both contact routes claimed in their header docstring to *"trigger email
 * notification to the business owner"*. No such step existed. And every one of
 * the nine emails in `BookingEmailService` goes to the client, so a person
 * could book an hour and pay for it while the business heard nothing.
 *
 * THREE THINGS THAT ARE DIFFERENT ABOUT OWNER MAIL
 *
 *   the address   the ACCOUNT's own, from auth — never `business_profiles.email`,
 *                 which is the public address clients write to and may be
 *                 staffed by somebody who should not read the owner's alerts
 *   the language  the OWNER's, from `user_preferences` then the profile — not
 *                 the client's, which is what every client-facing send uses
 *   the log       none. `email_sends` requires a `contact_id` and its rows are
 *                 rendered in that CONTACT's email timeline, so an owner alert
 *                 recorded there would read as mail sent to the client
 *
 * All three follow `DailyBriefingDispatchService`, which is the only
 * owner-facing mail that existed before this.
 *
 * NEVER THROWS, NEVER BLOCKS
 *
 * Called non-blocking from public routes. A visitor's form submission must not
 * fail because a mail provider is slow, and an owner who misses one alert is
 * better off than a client who could not get through at all.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/services/LeadAlertService
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import { sendEmail } from '@/lib/notifications/emailTransport';
import { resolveEmailBranding } from '@/lib/email/branding';
import { generateNewEnquiryEmail } from '@/lib/email/templates/new-enquiry';
import { formatEmailDate } from '@/lib/email/templates/base-template';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { leadResponseRepository } from '@/lib/repositories/LeadResponseRepository';
import { resolveBookingUrl } from '@/lib/branding/platformSite';
import { buildLeadReplyCandidates } from '@/lib/business-os/leads/leadReplyCandidates';
import { recommendLeadReply } from '@/lib/business-os/leads/LeadReplyRecommender';
import { newBosGroupId } from '@/lib/business-os/llm/callCatalog';
import { automationById } from '@/lib/business-os/gaps/automations';
import { businessEventService } from '@/lib/business-os/insight/events/BusinessEventService';
import { defaultLocale, isValidLocale, type Locale } from '@/lib/i18n/config';

const logger = createLogger({ service: 'LeadAlertService' });

export interface LeadAlertResult {
  sent: boolean;
  reason?: 'disabled' | 'no_owner_email' | 'send_failed' | 'threw';
}

export interface LeadAlertInput {
  ownerId: string;
  contactId: string;
  kind: 'enquiry' | 'quote' | 'cancelled' | 'moved';

  contactName: string;
  contactEmail?: string | null;
  phone?: string | null;

  message?: string | null;
  serviceInterest?: string | null;
  referralSource?: string | null;
  pageUrl?: string | null;

  serviceName?: string | null;
  /** The ISO start time and the business's zone. Formatted here, not by callers. */
  startTime?: string | null;
  timezone?: string | null;
  /** A change only: where the appointment used to be. */
  previousStartTime?: string | null;
  /** A cancellation only: the reason the client gave, if any. */
  reason?: string | null;
}

/**
 * The owner's own language.
 *
 * Their interface preference first, then the business's language. This is the
 * precedence `DailyBriefingDispatchService` implements inline and the one
 * `getUserLocale` documents — deliberately the opposite of a client-facing
 * send, which uses the business's language because the client is reading it.
 */
function normaliseLocale(value: unknown): Locale | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return isValidLocale(trimmed) ? (trimmed as Locale) : null;
}

export async function notifyOwnerOfLead(input: LeadAlertInput): Promise<LeadAlertResult> {
  const log = logger.child({ ownerId: input.ownerId, contactId: input.contactId, kind: input.kind });

  try {
    /*
     * The switch, read on its own.
     *
     * Postgres rejects an entire select for one unknown column, so folding a
     * freshly-migrated column into a wider read would take the alert down
     * everywhere the migration has not run yet. Its own read fails alone, and
     * an unreadable switch is treated as ON — the whole point of this feature
     * is that silence is the failure.
     */
    const { data: toggle } = await supabaseServer
      .from('business_profiles')
      .select('lead_alert_email_enabled')
      .eq('user_id', input.ownerId)
      .maybeSingle();

    if (toggle && toggle.lead_alert_email_enabled === false) {
      return { sent: false, reason: 'disabled' };
    }

    const [profileResult, preferencesResult, authUser] = await Promise.all([
      businessProfileRepository.findByUserId(input.ownerId),
      supabaseServer
        .from('user_preferences')
        .select('preferred_language')
        .eq('user_id', input.ownerId)
        .maybeSingle(),
      supabaseServer.auth.admin.getUserById(input.ownerId),
    ]);

    const ownerEmail = authUser.data?.user?.email;
    if (!ownerEmail) {
      log.warn('No account address for this owner; cannot send the alert');
      return { sent: false, reason: 'no_owner_email' };
    }

    const profile = profileResult.data;
    const locale =
      normaliseLocale(preferencesResult.data?.preferred_language) ??
      normaliseLocale(profile?.language) ??
      defaultLocale;

    const branding = await resolveEmailBranding(input.ownerId, locale, profile);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    const { subject, html } = generateNewEnquiryEmail({
      kind: input.kind,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      phone: input.phone,
      message: input.message,
      serviceInterest: input.serviceInterest,
      referralSource: input.referralSource,
      pageUrl: input.pageUrl,
      serviceName: input.serviceName,
      /*
       * Formatted here rather than in the route, because the right format
       * depends on the OWNER's locale — which the route has no reason to know
       * and this service has already resolved.
       */
      whenLocal:
        input.startTime
          ? formatEmailDate(new Date(input.startTime), input.timezone || 'UTC', {
              includeTime: true,
              locale,
            })
          : null,
      previousWhenLocal:
        input.previousStartTime
          ? formatEmailDate(new Date(input.previousStartTime), input.timezone || 'UTC', {
              includeTime: true,
              locale,
            })
          : null,
      reason: input.reason,
      contactUrl: `${appUrl}/business-os/crm?contact=${input.contactId}`,
      settingsUrl: `${appUrl}/business-os/settings?section=preferences`,
      branding,
      locale,
    });

    /*
     * `ownerUserId` makes the business the visible sender. Harmless here — the
     * owner is also the recipient — but it keeps the From name consistent with
     * every other message the platform sends on their behalf, and it costs a
     * lookup that is already warm.
     */
    const result = await sendEmail({
      to: [ownerEmail],
      subject,
      html,
      ownerUserId: input.ownerId,
    });

    if (!result.sent) {
      log.warn({ error: result.error, provider: result.provider }, 'Owner alert failed to send');
      return { sent: false, reason: 'send_failed' };
    }

    log.info({ provider: result.provider }, 'Owner alerted');

    /*
     * Queue the reply, and start the owner's window HERE.
     *
     * Fifteen minutes measured from the moment they were actually told, not
     * from when the form arrived — a transport retry must not eat the window
     * they are supposed to have to change or cancel it.
     *
     * Only for an enquiry: a booking has already booked, so there is nothing
     * to invite them to.
     */
    if (input.kind === 'enquiry') {
      // Only an enquiry. A quote request is answered with a PRICE, which
      // nobody but the owner can write — sending them a booking link would
      // duck the question they actually asked.
      await queueLeadReply(input, profile, locale).catch(err =>
        log.warn({ err }, 'Could not queue the reply (non-blocking)')
      );
    }

    /*
     * Record it on the event rail.
     *
     * `business_events` has a schema, a service and four detectors reading it,
     * and — until this line — no producer anywhere in the codebase. Writing the
     * row costs almost nothing and makes the acquisition funnel real.
     *
     * Nothing DEPENDS on it. `BusinessEventService`'s subscribers live in a
     * module-global array, so on Vercel the lambda that handled the form is
     * never the one running a cron, and a feature built on in-process
     * subscription would work in development and silently never fire in
     * production. The durable queue above is the delivery mechanism; this is a
     * record. Swallowed entirely, because an unmigrated table must never cost a
     * visitor their submission.
     */
    /*
     * An enquiry is recorded TWICE, under two names, and deliberately so.
     *
     * `form.submitted` is the website fact — a form on a page was filled in —
     * and two acquisition detectors count it to judge how that page converts.
     * `enquiry.received` is the sales fact: somebody asked us something, by
     * whatever route. `SalesReplySlowDetector` reads the second and has never
     * matched a row, because only the first was ever written.
     *
     * They are different questions at different levels, no detector counts
     * both, and collapsing them would break whichever one lost its name.
     */
    if (input.kind === 'enquiry') {
      void businessEventService
        .emit(input.ownerId, {
          eventType: 'enquiry.received',
          category: 'sales',
          entityType: 'contact',
          entityId: input.contactId,
          contactId: input.contactId,
          sourceCapability: 'website',
        } as Parameters<typeof businessEventService.emit>[1])
        .catch(err => log.debug({ err }, 'Enquiry event write skipped'));
    }

    void businessEventService
      .emit(input.ownerId, {
        eventType:
          input.kind === 'enquiry'
            ? 'form.submitted'
            : input.kind === 'quote'
              ? 'quote.requested'
              : `booking.${input.kind}`,
        category: 'acquisition',
        entityType: 'contact',
        entityId: input.contactId,
        contactId: input.contactId,
        sourceCapability: 'website',
      } as Parameters<typeof businessEventService.emit>[1])
      .catch(err => log.debug({ err }, 'Event rail write skipped'));

    return { sent: true };
  } catch (err) {
    // Never surfaces to the visitor. See the module header.
    log.warn({ err }, 'Owner alert threw');
    return { sent: false, reason: 'threw' };
  }
}

/**
 * Work out what to send, write it down, and queue it.
 *
 * The recommendation is computed NOW rather than at send time, because the
 * whole point of the delay is that the owner can see what is about to go out
 * while there is still time to change it. Deciding at send time would make the
 * window useless.
 *
 * Queued regardless of whether automatic sending is on. With it off the row is
 * skipped at dispatch with `autosend_off` — which costs one cheap read and
 * means the dashboard can still show what WOULD have been sent, and the owner
 * can send it with one click.
 */
async function queueLeadReply(
  input: LeadAlertInput,
  profile: { vertical?: string | null; sub_vertical?: string | null; user_code?: string | null } | null,
  locale: Locale
): Promise<void> {
  /*
   * Every exit below says why.
   *
   * These three returns were silent, and the failure they produce is invisible
   * from both ends: the owner has approved "reply to new enquiries", no reply
   * is ever queued, and the dashboard shows the enquiry waiting for a reply
   * with nothing to explain it. A lead arrived, the platform decided not to
   * answer, and said so to nobody.
   *
   * `info`, not `debug`: this is a lead going unanswered, which is the thing
   * the whole feature exists to prevent — it should be findable in production
   * logs without turning debug on after the fact.
   */
  const log = logger.child({ ownerId: input.ownerId, contactId: input.contactId });

  const bookingUrl = await resolveBookingUrl(input.ownerId, profile);
  if (!bookingUrl) {
    // Nothing bookable to point anyone at: no live page, no smart link.
    log.info('No auto-reply queued: this business has no bookable link yet');
    return;
  }

  const services = (await schedulingServiceRepository.listAll(input.ownerId, true)).data ?? [];
  const candidates = buildLeadReplyCandidates({ services, bookingUrl });
  if (candidates.length === 0) {
    log.info(
      { activeServices: services.length },
      'No auto-reply queued: no reply candidate could be built from the active services'
    );
    return;
  }

  // One group per enquiry, not per contact: one person can send several.
  const groupId = newBosGroupId();
  log.debug({ groupId }, 'Lead reply recommendation group');

  const recommendation = await recommendLeadReply(
    candidates,
    {
      message: input.message,
      serviceInterest: input.serviceInterest,
      businessType: profile?.sub_vertical || profile?.vertical,
      language: locale,
    },
    input.ownerId,
    groupId
  );

  if (!recommendation) {
    log.info(
      { candidates: candidates.length },
      'No auto-reply queued: the model returned no recommendation'
    );
    return;
  }

  await leadResponseRepository.enqueue({
    userId: input.ownerId,
    contactId: input.contactId,
    kind: 'invite',
    /*
     * The delay comes from the registry, which is also what the advisor shows
     * the owner when it asks permission. Defined here as well, it would drift —
     * and the product would describe a window it does not honour.
     */
    dueAt: new Date(Date.now() + replyDelayMs()),
    serviceId: recommendation.candidate.serviceId ?? null,
    recommendation: {
      label: recommendation.candidate.label,
      kind: recommendation.candidate.kind,
      reason: recommendation.reason,
      source: recommendation.source,
      fallbackReason: recommendation.fallbackReason,
    },
  });
}

/**
 * How long the owner has to change or cancel before the reply goes.
 *
 * Read from the operational registry rather than restated, so the number the
 * advisor promises and the number the queue honours cannot disagree.
 */
function replyDelayMs(): number {
  const automation = automationById('reply_to_enquiries');
  return (automation?.delayHours ?? 0.25) * 60 * 60 * 1000;
}
