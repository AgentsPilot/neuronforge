/**
 * BookingEmailService
 * Reusable email service for booking-related emails
 *
 * Can be called from:
 * - Booking API routes
 * - Chat commands
 * - Webhooks (Stripe payment confirmation)
 */

import { createLogger } from '@/lib/logger';
import { platformOrigin } from '@/lib/utils/origins';
import { clientFacingCancelReason } from '@/lib/email/templates/translations';
import { splitClientCancellationReason } from '@/lib/services/bookingCancellationReason';
import { REASONS_WITHOUT_REBOOKING } from '@/lib/business-os/cancellationReasons';
import {
  generateMeetingReminderEmail,
  generateOwnerMeetingReminderEmail,
} from '@/lib/email/templates/meeting-reminder';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { activitySentence, activityMoment, activityRecord } from '@/lib/business-os/activityText';
import { BOOKING_LINK_ACTIVITY } from '@/lib/services/LeadBookingLinkService';
import { formatCurrency } from '@/lib/email/templates/base-template';
import { sendEmail, resolveOwnerReplyTo } from '@/lib/notifications/emailTransport';
import { recordEmailSend } from '@/lib/notifications/recordEmailSend';
import { schedulingBookingRepository, schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { safeExternalUrl } from '@/lib/branding/externalUrl';
import { resolvePlatformWebsiteUrl, resolveBookingUrl } from '@/lib/branding/platformSite';
import { emailSendRepository } from '@/lib/repositories/EmailAutomationRepository';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
// The same source `/book/manage/[token]/intake` reads, so the email asking for
// an intake form and the page it links to cannot disagree about whether one exists.
import { intakeRepository } from '@/lib/repositories/IntakeRepository';
import { generateBookingConfirmationEmail, generateBookingCancellationEmail, generateBookingRescheduledEmail, generateMissedAppointmentEmail, generateICSContent, icsSequenceFor } from '@/lib/email/templates/booking-confirmation';
import { resolveIntakeForSending } from '@/lib/business-os/intake/resolveIntake';
import { generateInvoiceEmail } from '@/lib/email/templates/invoice';
import { generatePaymentReceiptEmail } from '@/lib/email/templates/payment-receipt';
import { generateRefundConfirmationEmail } from '@/lib/email/templates/refund-confirmation';
import { generateWelcomeEmail, generateReturningContactEmail } from '@/lib/email/templates/welcome-email';
import { generateIntakeRequestEmail } from '@/lib/email/templates/intake-request';
import { generateIntakeReceivedEmail } from '@/lib/email/templates/intake-received';
import { resolveEmailBranding } from '@/lib/email/branding';
import type { Locale } from '@/lib/i18n/config';
import { isValidLocale, defaultLocale } from '@/lib/i18n/config';
import { supabaseServer } from '@/lib/supabaseServer';
// The payment half of a reschedule email. Each is the SAME rule used elsewhere:
// the settled checks the reminder sender reads, and the card/bank resolver the
// invoice email uses — so no surface can disagree with another about whether
// this client still owes money or may pay by card.
import { isSettledInvoice } from '@/lib/payments/invoiceSettlement';
import { hasBeenRefunded } from '@/lib/payments/invoiceSettlement';
import { resolveInvoicePaymentOptions } from '@/lib/payments/invoicePaymentOptions';
import { resolvePaymentCollectionCapability } from '@/lib/payments/stripeAccountContext';
import { safeTimezone } from '@/lib/scheduling/businessTime';
import * as jwt from 'jsonwebtoken';

const logger = createLogger({ service: 'BookingEmailService' });

/**
 * The platform's own address, for the links a CLIENT receives.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Through `platformOrigin()`, not `process.env.NEXT_PUBLIC_APP_URL`.
 *
 * That variable is one value per environment, and a deployed build hands out
 * whatever it was set to — including `http://localhost:3000`, which is what it
 * holds when it has been copied out of `.env.local`. Every link in this file
 * goes to a client: reschedule, cancel, the intake form, an invoice. A loopback
 * address in any of them is a dead end for everyone except the person who
 * deployed it.
 *
 * `platformOrigin()` refuses a loopback address when it is running on Vercel and
 * falls back to the deployment's own host, so production gets the production
 * domain and a laptop still gets localhost. See lib/utils/origins.ts.
 *
 * A function, not a const: read at call time, because a module-scope read is
 * fixed at import and tests and previews set the environment after that.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const appUrl = (): string => platformOrigin();

/**
 * What signs a booking manage link.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FATAL WHEN UNSET, and read lazily so it is the send that fails rather than
 * the import of this module.
 *
 * It used to end `|| 'fallback-secret-change-in-prod'`. The token IS the
 * authorisation on `/book/manage/[token]` — it is what tells cancel and
 * reschedule which booking the caller may act on — so in any environment where
 * neither variable was set, every one of those links was signed with a string
 * printed in this repository. Anyone reading the source could mint a token for
 * any booking id and cancel a stranger's appointment.
 *
 * A link that cannot be signed is an email that does not go out, which is
 * strictly better than one that anybody can forge. `lib/consent/confirmToken.ts`
 * reached the same conclusion for the same reason; this matches it.
 *
 * `NEXTAUTH_SECRET` remains as a fallback only because it is what production
 * has been signing with — dropping it would invalidate every link already in a
 * client's inbox. It is NOT an auth secret: nothing in this app authenticates
 * with NextAuth, and it survives purely as the value these three token systems
 * inherited. Set `BOOKING_TOKEN_SECRET` explicitly and the fallback stops
 * mattering.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function bookingTokenSecret(): string {
  const configured = process.env.BOOKING_TOKEN_SECRET || process.env.NEXTAUTH_SECRET;

  if (!configured) {
    throw new Error(
      'BOOKING_TOKEN_SECRET (or NEXTAUTH_SECRET) must be set to sign booking management links'
    );
  }

  return configured;
}

// Token expiry for booking management links (30 days)
const TOKEN_EXPIRY_DAYS = 30;

interface EmailResult {
  sent: boolean;
  error?: string;
}

/**
 * Generate a signed token for booking management URLs.
 *
 * Exported because a route that has already verified one token may need to mint
 * a sibling — the package manage page signs each meeting of the block for the
 * same address, which grants nothing the caller did not already hold.
 */
export function generateBookingToken(bookingId: string, email: string): string {
  return jwt.sign(
    { bookingId, email },
    bookingTokenSecret(),
    { expiresIn: `${TOKEN_EXPIRY_DAYS}d` }
  );
}

/**
 * The reschedule link, or nothing at all.
 *
 * Both reasons to have no link are handled here rather than at the call site:
 * no `APP_URL` configured, and no secret to sign with. Neither is a reason to
 * withhold the reminder itself.
 */
function manageUrlFor(
  bookingId: string,
  clientEmail: string,
  log: { warn: (ctx: Record<string, unknown>, msg: string) => void }
): string | null {
  if (!appUrl()) return null;

  try {
    return `${appUrl()}/book/manage/${generateBookingToken(bookingId, clientEmail)}/reschedule`;
  } catch (err) {
    log.warn({ err, bookingId }, 'Could not sign a manage link; sending the reminder without one');
    return null;
  }
}

/**
 * What is still owed on a booking, written in its own currency.
 *
 * Null unless payment is genuinely outstanding AND there is an amount to name.
 * A currency-less number is worse than silence: the owner cannot tell 120
 * shekels from 120 dollars, and the platform holds no exchange rate that could
 * resolve it for them.
 */
function outstandingOnBooking(booking: {
  payment_status?: string | null;
  payment_amount?: unknown;
  payment_currency?: string | null;
}): string | null {
  if (booking.payment_status !== 'pending') return null;

  const amount = Number(booking.payment_amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return formatCurrency(amount, booking.payment_currency || 'USD');
}

/**
 * Verify and decode a booking management token
 */
export function verifyBookingToken(token: string): { bookingId: string; email: string } | null {
  /*
   * Resolved OUTSIDE the try on purpose.
   *
   * A missing secret and a forged token are different failures and must not
   * produce the same answer. Inside the try, the throw would be swallowed and
   * returned as `null` — so a misconfigured deployment would tell every real
   * client their valid link was invalid, and nothing would say why.
   */
  const secret = bookingTokenSecret();

  try {
    const decoded = jwt.verify(token, secret) as { bookingId: string; email: string };
    return decoded;
  } catch {
    return null;
  }
}

// Branding now comes from `resolveEmailBranding` (lib/email/branding.ts), which
// reads the user's website theme. The local builder that used to live here read
// business_profiles.primary_color / .secondary_color / .logo_url — columns that
// do not exist on that table — so it returned the hardcoded fallback for every
// user, every time.

/**
 * Fetch user's preferred language from user_preferences table
 * Used for business owner's internal emails
 */
/**
 * The OWNER's interface language. Not for anything a client reads.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `user_preferences.preferred_language` is a personal setting: which language
 * this person wants the app in. Every client-facing email used to resolve
 * through it, so an owner who switched their own interface to English — to read
 * their pipeline, say — silently changed the language their Hebrew clients were
 * written to. One booking's confirmation went out in English at 16:32 because
 * of exactly that, while every other email that day was Hebrew.
 *
 * What a client should be written in is a fact about the BUSINESS, and it does
 * not change when the owner changes their own screen. So the senders now use
 * `getBusinessLocale`, and this is kept for anything addressed to the owner
 * themselves.
 * ─────────────────────────────────────────────────────────────────────────────
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getUserLocale(userId: string): Promise<Locale> {
  try {
    const { data, error } = await supabaseServer
      .from('user_preferences')
      .select('preferred_language')
      .eq('user_id', userId)
      .single();

    if (error) {
      logger.debug({ userId, err: error }, 'No user_preferences found, falling back to the business language');
      return getBusinessLocale(userId);
    }

    if (data?.preferred_language && isValidLocale(data.preferred_language)) {
      logger.debug({ userId, locale: data.preferred_language }, 'Using user preferred language');
      return data.preferred_language as Locale;
    }

    /*
     * Fall through to the business profile rather than straight to the default.
     *
     * These two columns disagree in practice — `user_preferences` said `he`
     * while `profiles.language` said `en` — and a missing row used to mean
     * English regardless of what the business had configured.
     *
     * One order of precedence, used by every email. When the two sources
     * disagreed AND different emails read different sources, one booking sent
     * the confirmation in Hebrew and the intake request in English.
     */
    logger.debug({ userId, preferredLanguage: data?.preferred_language }, 'No usable preferred_language, falling back to the business language');
    return getBusinessLocale(userId);
  } catch (err) {
    logger.warn({ userId, err }, 'Error fetching user locale');
    return defaultLocale;
  }
}

/**
 * The clock a client-facing email should be written on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT `booking.timezone`
 *
 * Every email here formatted against the row's own `timezone` column, which is
 * stamped once at creation from whatever the caller happened to send. Three
 * things follow, and all three were live:
 *
 *   - A booking made through the dashboard stamped the OWNER'S BROWSER. The
 *     drawer then showed 12:00 AM and the email said 4:00 AM for one instant.
 *   - A booking made before the column was populated is null, and `timeZone:
 *     undefined` means the SERVER's zone — UTC on Vercel, the machine's zone in
 *     development. The same booking mails differently in the two.
 *   - Correcting a business's timezone fixed every screen and left every
 *     already-created booking mailing on the old one, for ever.
 *
 * An appointment happens where the business is. That is the only clock a
 * confirmation, a reschedule or a reminder can be written on and still mean the
 * hour the client should turn up. The stored instant is untouched, as always:
 * this decides only which wall clock it is read against.
 *
 * The row's stamp stays as the fallback, so a booking whose owner has never set
 * a preference reads exactly as it did before rather than jumping to UTC.
 */
export async function getBusinessTimezone(
  userId: string,
  stampedOnBooking?: string | null
): Promise<string> {
  try {
    const { data, error } = await supabaseServer
      .from('user_preferences')
      .select('timezone')
      .eq('user_id', userId)
      .single();

    if (error) {
      logger.debug({ userId, err: error }, 'No user_preferences row; using the timezone stamped on the booking');
      return safeTimezone(stampedOnBooking);
    }

    if (data?.timezone) return safeTimezone(data.timezone);

    return safeTimezone(stampedOnBooking);
  } catch (err) {
    logger.warn({ userId, err }, 'Error resolving the business timezone');
    return safeTimezone(stampedOnBooking);
  }
}

/**
 * Fetch business profile language
 * Used for client-facing emails (booking confirmations, intake requests, etc.)
 */
export async function getBusinessLocale(userId: string): Promise<Locale> {
  try {
    const profileResult = await businessProfileRepository.findByUserId(userId);
    const language = profileResult.data?.language;

    if (language && isValidLocale(language)) {
      logger.debug({ userId, locale: language }, 'Using business profile language');
      return language as Locale;
    }
    logger.debug({ userId, language }, 'Invalid or missing business language, using default');
    return defaultLocale;
  } catch (err) {
    logger.warn({ userId, err }, 'Error fetching business locale');
    return defaultLocale;
  }
}

/**
 * Log a sent email to the email_sends table for tracking
 * Non-blocking - catches and logs any errors
 */
/**
 * Mark a contact as having been given a booking link.
 *
 * The same row `LeadBookingLinkService` writes, so the gap, the detector and
 * that service's own idempotency claim all agree about one fact. Deliberately
 * the same `activity_type`, because they are the same event: a client was given
 * a way to book.
 *
 * Checked before inserting rather than relying on a constraint — the claim is a
 * plain activity row with no uniqueness on it, and a welcome email re-sent after
 * a retry should not put a second one on the contact's timeline.
 */
async function recordBookingLinkSent(
  userId: string,
  contactId: string,
  bookingUrl: string,
  /** The RECIPIENT's language, as the rest of this send already resolved it. */
  locale: Locale
): Promise<void> {
  const { data: existing } = await supabaseServer
    .from('crm_activities')
    .select('id')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .eq('activity_type', BOOKING_LINK_ACTIVITY)
    .limit(1)
    .maybeSingle();

  if (existing) return;

  const { error } = await supabaseServer.from('crm_activities').insert({
    user_id: userId,
    contact_id: contactId,
    activity_type: BOOKING_LINK_ACTIVITY,
    title: activitySentence(BOOKING_LINK_ACTIVITY, {}, locale),
    description: bookingUrl,
    activity_date: new Date().toISOString(),
    auto_logged: true,
    source_capability: 'website',
  });

  if (error) throw error;
}

/**
 * The cancellation reason as the CLIENT should read it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Three things happen here and each one was a leak.
 *
 * 1. The stored `CLIENT_CANCELLED_PREFIX` is English, and must stay English —
 *    the `booking_cancelled` gap matches it with `.ilike` and
 *    `CashCancelledUnrefundedDetector` with `.startsWith`. It was going out
 *    verbatim, so a Hebrew client read "Cancelled by client" about their own
 *    cancellation. Translated on the way out instead, reusing the client-safe
 *    phrasing for `client_cancelled` rather than a second copy of the sentence.
 *
 * 2. The owner's free text was emailed verbatim, always. It is now withheld when
 *    they asked for it to be.
 *
 * 3. With the note withheld the client used to get nothing. They now get the
 *    reason code's neutral phrasing, so the email still explains itself.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function cancellationReasonForClient(input: {
  /** The stored prose, prefix and all. */
  prose: string | null;
  /** The structured code, where one exists. */
  code: string | null;
  shareNote: boolean;
  locale: 'en' | 'es' | 'he';
}): string | undefined {
  const { byClient, note } = splitClientCancellationReason(input.prose);

  // The client's OWN cancellation: their words, always theirs to read back.
  if (byClient) {
    const label = clientFacingCancelReason('client_cancelled', input.locale);
    if (note) return label ? `${label}: ${note}` : note;
    return label;
  }

  // An owner cancellation. The note only if they shared it, otherwise the
  // code's neutral phrasing — never the code, never nothing.
  if (input.shareNote && note) return note;
  return clientFacingCancelReason(input.code, input.locale);
}

export class BookingEmailService {
  /**
   * Send booking confirmation email with calendar invite
   * Called from: booking API, chat commands
   */
  static async sendBookingConfirmation(
    bookingId: string,
    userId: string,
    options?: {
      skipInvoice?: boolean;
      invoiceId?: string;
      stripeHostedInvoiceUrl?: string;
      /**
       * A PACKAGE's meetings, when this confirmation covers several.
       *
       * Sent for the FIRST meeting of the block with all of its dates attached,
       * rather than through a sender of its own: everything this method does —
       * the branding, the locale, the invoice attachment, the manage links, the
       * calendar file — is wanted unchanged, and only the dates differ. The
       * template then lists them all and the invite carries one event each.
       *
       * The manage links are the first meeting's, which is what they should be:
       * a client rescheduling from this email moves session one, and each later
       * session carries its own links on its own reminder.
       */
      sessions?: Array<{ start: Date; end: Date }>;
    }
  ): Promise<EmailResult> {
    const requestLogger = logger.child({ bookingId, userId, action: 'sendBookingConfirmation' });

    try {
      // Fetch user's preferred language from profile
      const locale = await getBusinessLocale(userId);

      // Fetch booking
      const bookingResult = await schedulingBookingRepository.findById(bookingId, userId);
      if (bookingResult.error || !bookingResult.data) {
        requestLogger.error({ err: bookingResult.error }, 'Booking not found');
        return { sent: false, error: 'Booking not found' };
      }
      const booking = bookingResult.data;

      // Validate client email exists
      /*
       * Resolved once, and narrowed.
       *
       * `client_email` comes from the joined contact and is normalised to `''`
       * when that contact has no address, so its type is `string | undefined`
       * and its value can be empty. Every use below wants a real address —
       * including `generateBookingToken`, which would otherwise mint a token
       * for nobody.
       */
      const clientEmail = booking.client_email?.trim();
      if (!clientEmail) {
        requestLogger.error({ bookingId, contactId: booking.contact_id }, 'Booking contact has no email address');
        return { sent: false, error: 'Client email is missing' };
      }

      // Fetch service
      const serviceResult = await schedulingServiceRepository.findById(booking.service_id, userId);
      if (serviceResult.error || !serviceResult.data) {
        requestLogger.error({ err: serviceResult.error }, 'Service not found');
        return { sent: false, error: 'Service not found' };
      }
      const service = serviceResult.data;

      // Fetch business profile for branding
      const profileResult = await businessProfileRepository.findByUserId(userId);
      const branding = await resolveEmailBranding(userId, locale, profileResult.data);

      // Generate booking management token and URLs
      const token = generateBookingToken(bookingId, clientEmail);
      const rescheduleUrl = `${appUrl()}/book/manage/${token}/reschedule`;
      const cancelUrl = `${appUrl()}/book/manage/${token}/cancel`;

      // Generate payment URL if invoice exists and payment is pending
      let paymentUrl: string | undefined;

      // Normalize payment_status - treat null/undefined as 'pending' for new bookings
      const effectivePaymentStatus = booking.payment_status || 'pending';
      const isPending = effectivePaymentStatus === 'pending';
      const hasPrice = service.price && service.price > 0;
      const hasInvoice = !!options?.invoiceId;

      requestLogger.info({
        invoiceId: options?.invoiceId,
        rawPaymentStatus: booking.payment_status,
        effectivePaymentStatus,
        isPending,
        servicePrice: service.price,
        hasPrice,
        hasInvoice,
        stripeHostedUrl: options?.stripeHostedInvoiceUrl
      }, 'Checking payment URL conditions');

      if (hasInvoice && isPending && hasPrice) {
        // Prefer Stripe hosted invoice URL if available (allows direct payment)
        // Otherwise fall back to local invoice page
        paymentUrl = options?.stripeHostedInvoiceUrl || `${appUrl()}/invoice/${options?.invoiceId}`;
        requestLogger.info({ paymentUrl }, 'Payment URL generated for email');
      } else {
        requestLogger.info({
          reason: !hasInvoice ? 'no invoice' : !isPending ? 'not pending' : !hasPrice ? 'no price' : 'unknown'
        }, 'Payment URL NOT generated');
      }

      // Parse booking datetime
      const startTime = new Date(booking.start_time);
      const endTime = new Date(booking.end_time);
      const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

      // Build email data
      const clientName = [booking.client_first_name, booking.client_last_name].filter(Boolean).join(' ');

      /*
       * The instalment schedule, if this booking has one.
       *
       * Non-fatal by construction: a confirmation that reaches the client
       * without its plan table is a worse email, and one that never arrives
       * because a secondary read failed is a worse outcome. The `?? []` below
       * makes an unreadable schedule indistinguishable from no schedule, which
       * is the safe direction — the email then behaves exactly as it did before
       * plans were shown at all.
       */
      const { data: periodRows } = await supabaseServer
        .from('payment_plan_installments')
        .select('installment_number, amount, due_date, status')
        .eq('booking_id', bookingId)
        .eq('user_id', userId)
        .order('installment_number');

      const bookingPlan = (periodRows ?? []).length
        ? {
            totalAmount: Number(service.price ?? 0),
            periods: (periodRows ?? []).map(row => ({
              number: Number(row.installment_number),
              amount: Number(row.amount),
              dueDate: (row.due_date as string | null) ?? null,
              status: String(row.status),
            })),
          }
        : undefined;

      const emailData = {
        clientName,
        clientEmail,
        serviceName: service.service_name,
        dateTime: startTime,
        endTime,
        duration: durationMinutes,
        timezone: await getBusinessTimezone(userId, booking.timezone),
        location: undefined, // TODO: add location support
        price: service.price || undefined,
        currency: service.currency,
        /*
         * The plan's real periods, so the email asks for the first one.
         *
         * Read from `payment_plan_installments` rather than projected from the
         * service, because those rows are what the money is actually billed
         * from — and because a period already paid must read as paid. Undefined
         * for an ordinary booking, and the template then renders as before.
         */
        plan: bookingPlan,
        paymentStatus: booking.payment_status as 'pending' | 'paid' | 'refunded' | undefined,
        paymentUrl,
        rescheduleUrl,
        cancelUrl,
        bookingId,
        /*
         * Was a time booked, or is this something sold without one?
         *
         * The start time IS the test. `scheduling_services` has no `is_product`
         * column — the drawer's `isProductBooking` consults one too, and that
         * half of the expression has never been anything but undefined — so
         * nothing else in the data distinguishes the two.
         *
         * Without this a client who bought a course was told "your appointment
         * is confirmed", shown a duration in minutes, and offered a calendar
         * invitation and a reschedule link for a meeting that does not exist.
         */
        hasSchedule: Boolean(booking.start_time),
        /*
         * The whole block, for a package. Undefined for an ordinary booking,
         * and the template then renders exactly as it did before.
         */
        sessions: options?.sessions,
        branding,
        locale
      };

      // Log email data for debugging payment link issues
      const hasPendingPayment = booking.payment_status === 'pending' && service.price && service.price > 0;
      requestLogger.info({
        paymentUrl,
        paymentStatus: booking.payment_status,
        servicePrice: service.price,
        hasPendingPayment,
        willShowPaymentButton: hasPendingPayment && !!paymentUrl
      }, 'Email data for booking confirmation');

      /*
       * The calendar invite, at last actually attached.
       *
       * It was being generated and then dropped — the variable was unused and
       * the TODO here said so. Attaching it is what lets a client abroad see
       * the appointment on THEIR OWN clock: the .ics carries the absolute
       * instant (`DTSTART:...Z`), and every calendar renders that in the
       * reader's zone, staying right even if they travel. That is a guarantee
       * no wording inside the email body can make, because the body is
       * rendered once on this server before it is sent.
       */
      const organizerEmail = await resolveOwnerReplyTo(userId);
      const { subject, html, icsContent } = generateBookingConfirmationEmail(emailData, {
        organizerEmail,
        sequence: icsSequenceFor(booking.updated_at),
      });

      /*
       * The invoice itself, when the service bills by one.
       *
       * `options.invoiceId` is set only for an INVOICE sale — a direct-payment
       * service has none, and there is nothing to attach. Until now this mail
       * carried a pay LINK either way, so a client billed by invoice received
       * no document to keep, and a business collecting by bank transfer sent a
       * bill whose account details lived only in a PDF nobody attached.
       *
       * Built through the same builder `sendInvoice` uses, so the file on a
       * booking confirmation and the file on a standalone invoice are the same
       * document with the same branding.
       */
      const attachments: { filename: string; content: Buffer; contentType: string }[] = [];

      /*
       * NEVER gated on `skipInvoice`.
       *
       * That flag means "do not send a SECOND email; the payment link rides with
       * this confirmation" — every real booking flow passes it TOGETHER with an
       * invoice id. Reading it as "do not attach" would suppress the attachment
       * in exactly the cases that need it, which is what a first pass here did.
       */
      /*
       * The invoice is RESOLVED here, not required from the caller.
       *
       * Five call sites send this email and each decides for itself what to pass
       * — the resend route passes no id at all — so requiring `invoiceId` meant
       * the attachment depended on which button was pressed. A booking either
       * has an invoice or it does not; that is a fact about the booking, and it
       * is looked up rather than remembered.
       */
      let invoiceIdToAttach = options?.invoiceId ?? null;

      if (!invoiceIdToAttach) {
        const found = await paymentInvoiceRepository.findByBookingId(booking.id, userId);

        /*
         * A cancelled invoice is not the bill for this appointment.
         *
         * A booking can carry more than one — one voided and replaced, say — and
         * attaching the void would send the client a document asking for money
         * nobody expects them to pay.
         */
        invoiceIdToAttach =
          (found.data ?? []).find(inv => inv.status !== 'cancelled')?.id ?? null;
      }

      if (invoiceIdToAttach) {
        const { buildInvoiceAttachment } = await import('@/lib/services/InvoiceDeliveryService');
        const attachment = await buildInvoiceAttachment(invoiceIdToAttach, userId, locale);

        /*
         * Null when the PDF could not be rendered — and the mail still goes.
         * A confirmation without its attachment is a worse email; a booking
         * whose client never learns it exists is a worse outcome.
         */
        if (attachment) attachments.push(attachment);
      }

      /*
       * The invite rides with the confirmation, not instead of it. A booking
       * with no time (a course, a product) has nothing to put in a calendar.
       */
      if (icsContent && emailData.hasSchedule !== false) {
        attachments.push({
          filename: 'appointment.ics',
          content: Buffer.from(icsContent, 'utf8'),
          contentType: 'text/calendar; method=REQUEST; charset=utf-8',
        });
      }

      // Send email
      const result = await sendEmail({
        kind: 'transactional',
        to: [clientEmail],
        subject,
        html,
        ownerUserId: userId,
        attachments: attachments.length > 0 ? attachments : undefined
      });

      if (result.sent) {
        requestLogger.info({
          provider: result.provider,
          clientEmail,
          invoiceAttached: attachments.length > 0
        }, 'Booking confirmation sent');

        /*
         * The invoice has now reached the client, so it may say so.
         *
         * `createBookingInvoice` writes it as a draft precisely so this line can
         * be the thing that marks it sent — the same order `sendInvoiceEmail`
         * uses, and for the same reason it gives: an invoice marked sent that
         * nobody received is the bug that module exists to prevent.
         *
         * It also decides the COPY watermark. `alreadyWithTheClient` reads the
         * status, so marking it sent BEFORE this point stamped the client's
         * first copy as a duplicate.
         *
         * Non-blocking: the mail is away, and a bookkeeping write must not
         * report that as a failure.
         */
        if (invoiceIdToAttach && attachments.length > 0) {
          const invoiceId = invoiceIdToAttach;
          paymentInvoiceRepository
            .update(invoiceId, userId, {
              status: 'sent',
              sent_at: new Date().toISOString(),
            })
            // The repository reports failure in `error` rather than throwing, so
            // both have to be handled or a stuck draft passes silently.
            .then(({ error }) => {
              if (error) {
                requestLogger.error(
                  { err: error, invoiceId },
                  'Confirmation sent but the invoice was not marked sent'
                );
              }
            })
            .catch(err =>
              requestLogger.error(
                { err, invoiceId },
                'Confirmation sent but the invoice was not marked sent'
              )
            );
        }
      } else {
        requestLogger.warn({ error: result.error }, 'Failed to send booking confirmation');
      }

      // Log email to email_sends table (non-blocking)
      recordEmailSend({
        userId,
        contactId: booking.contact_id,
        toEmail: clientEmail,
        subject,
        bodyHtml: html,
        result
      }).catch(err => requestLogger.warn({ err }, 'Email logging failed (non-blocking)'));

      // Log CRM activity for booking confirmation (non-blocking, HIPAA compliance)
      if (result.sent && booking.contact_id) {
        crmActivityRepository.create({
          user_id: userId,
          contact_id: booking.contact_id,
          activity_type: 'booking_confirmation_sent',
          /*
           * Written in the business's language, now, because this records
           * something that happened rather than labelling a control. The
           * sentence was English regardless of the business; `locale` is
           * already resolved above for the email itself.
           *
           * No date phrase when the booking has no time — a course or a
           * product — which is what rendered every one of them as 12/31/1969.
           */
          title: activitySentence('confirmation_sent', { service: service.service_name }, locale),
          description: JSON.stringify({
            kind: 'booking_confirmation_sent',
            service: service.service_name,
            bookingDate: booking.start_time || undefined,
            /* The business's clock, for the reason set out under WHY NOT
               `booking.timezone` above: that column is whatever the creating
               caller happened to send, so the activity entry and the
               confirmation email could name two different hours for one
               appointment. Already resolved for the email. */
            timeZone: emailData.timezone,
          }),
          auto_logged: true,
          source_capability: 'scheduling',
          source_entity_id: bookingId
        }).catch(err => requestLogger.warn({ err }, 'CRM activity logging failed (non-blocking)'));
      }

      // No invoice email fired from here. It sent a fabricated invoice number
      // and a dead payment link; a booking's real invoice is raised and sent by
      // BookingLifecycleService, which writes an actual row first.

      return { sent: result.sent, error: result.error };
    } catch (error) {
      requestLogger.error({ err: error }, 'Error sending booking confirmation');
      return { sent: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
  /**
   * REMOVED: sendInvoiceForBooking.
   *
   * It emailed a client an invoice that did not exist. The number was
   * fabricated at send time — `INV-${date}-${bookingId.slice(0,4)}` — matching
   * no `payment_invoices` row, so a client who quoted it got a blank look. And
   * its "Pay Now" button pointed at `/pay/{bookingId}`, a route this app has
   * never had: a 404 for every client who clicked it, on the public booking
   * path, whatever the business's Stripe state.
   *
   * `BookingLifecycleService.createBookingInvoice` is the one producer of
   * booking invoices, and it writes a real row with a real number from
   * `getNextInvoiceNumber`. A second, parallel, fictional invoice pipeline was
   * not a thing to repair.
   */

  /**
   * Send payment receipt
   * Called from: Stripe webhook
   */
  /**
   * The plan behind a receipt, and which period it settles.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `settleInvoicePaid` marks the period paid before this email is sent — keyed
   * on `invoice_id`, in the same call — so by now the row genuinely says paid.
   * The period being receipted is therefore the most recently paid one, which
   * is more reliable than matching on amount: two periods of an even split are
   * the same number.
   *
   * Non-fatal throughout. A receipt that reaches the client without its
   * schedule is worse than one with it; a receipt that never arrives because a
   * secondary read failed is worse than both.
   * ───────────────────────────────────────────────────────────────────────────
   */
  private static async planForReceipt(
    userId: string,
    bookingId: string | undefined,
    // Only `warn` is used, and naming the child-logger type here pinned a
    // generic parameter the caller's logger does not satisfy.
    log: { warn: (obj: object, msg: string) => void }
  ) {
    if (!bookingId) return undefined;

    const { data, error } = await supabaseServer
      .from('payment_plan_installments')
      .select('installment_number, amount, due_date, status, paid_at')
      .eq('booking_id', bookingId)
      .eq('user_id', userId)
      .order('installment_number');

    if (error) {
      log.warn({ err: error, bookingId }, 'Receipt sent without its plan schedule');
      return undefined;
    }
    if (!data?.length) return undefined;

    const paidPeriodNumber = [...data]
      .filter(row => row.status === 'paid' && row.paid_at)
      .sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)))[0]?.installment_number;

    return {
      totalAmount: data.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
      paidPeriodNumber: paidPeriodNumber ? Number(paidPeriodNumber) : undefined,
      periods: data.map(row => ({
        number: Number(row.installment_number),
        amount: Number(row.amount),
        dueDate: (row.due_date as string | null) ?? null,
        status: String(row.status),
      })),
    };
  }

  static async sendPaymentReceipt(
    userId: string,
    paymentData: {
      customerEmail: string;
      customerName: string;
      amount: number;
      currency: string;
      receiptNumber?: string;
      paymentMethod?: string;
      bookingId?: string;
    }
  ): Promise<EmailResult> {
    const requestLogger = logger.child({ userId, bookingId: paymentData.bookingId, action: 'sendPaymentReceipt' });

    try {
      // Fetch user's preferred language from profile
      const locale = await getBusinessLocale(userId);

      // Fetch business profile for branding
      const profileResult = await businessProfileRepository.findByUserId(userId);
      const branding = await resolveEmailBranding(userId, locale, profileResult.data);

      // Get booking and service details if bookingId provided
      let serviceName: string | undefined;
      let appointmentDate: Date | undefined;
      let timezone: string | undefined;
      let bookingManageUrl: string | undefined;
      let contactId: string | null = null;

      if (paymentData.bookingId) {
        const bookingResult = await schedulingBookingRepository.findById(paymentData.bookingId, userId);
        if (bookingResult.data) {
          const booking = bookingResult.data;
          /*
           * A booking with no time slot has NO appointment date.
           *
           * `new Date(null)` is epoch zero, not an invalid date, so a course or
           * product — which never has a `start_time` — printed a receipt line
           * reading "Thursday, 1 January 1970 at 12:00 AM" and an appointment
           * reminder to match. Left undefined, both are omitted, which is what
           * the template already does when there is nothing to show.
           */
          appointmentDate = booking.start_time ? new Date(booking.start_time) : undefined;
          // The business's clock, same as every other booking email. See
          // `getBusinessTimezone`.
          timezone = await getBusinessTimezone(userId, booking.timezone);
          contactId = booking.contact_id;

          // Generate manage URL
          const token = generateBookingToken(paymentData.bookingId, paymentData.customerEmail);
          bookingManageUrl = `${appUrl()}/book/manage/${token}`;

          // Get service name
          const serviceResult = await schedulingServiceRepository.findById(booking.service_id, userId);
          if (serviceResult.data) {
            serviceName = serviceResult.data.service_name;
          }
        }
      }

      // Generate receipt number if not provided
      const receiptNumber = paymentData.receiptNumber || `RCP-${Date.now().toString(36).toUpperCase()}`;

      // Generate email
      const { subject, html } = generatePaymentReceiptEmail({
        clientName: paymentData.customerName,
        amount: paymentData.amount,
        currency: paymentData.currency,
        receiptNumber,
        paymentDate: new Date(),
        paymentMethod: paymentData.paymentMethod,
        serviceName,
        appointmentDate,
        timezone,
        bookingManageUrl,
        /*
         * The schedule this payment belongs to.
         *
         * A receipt saying "₪400.00 paid" is complete about the money and
         * silent about the ₪400 still due — which is the one thing a client
         * paying in instalments wants to know. Read from the plan rows, so a
         * period already settled reads as settled.
         */
        plan: await BookingEmailService.planForReceipt(
          userId,
          paymentData.bookingId,
          requestLogger
        ),
        branding,
        locale
      });

      // Send email
      const result = await sendEmail({
        kind: 'transactional',
        to: [paymentData.customerEmail],
        subject,
        html,
        ownerUserId: userId
      });

      if (result.sent) {
        requestLogger.info({ provider: result.provider, receiptNumber }, 'Payment receipt sent');
      } else {
        requestLogger.warn({ error: result.error }, 'Failed to send payment receipt');
      }

      // Log email to email_sends table (non-blocking)
      recordEmailSend({
        userId,
        contactId,
        toEmail: paymentData.customerEmail,
        subject,
        bodyHtml: html,
        result
      }).catch(err => requestLogger.warn({ err }, 'Email logging failed (non-blocking)'));

      // Log CRM activity for payment received (non-blocking, HIPAA compliance)
      if (result.sent && contactId) {
        crmActivityRepository.create({
          user_id: userId,
          contact_id: contactId,
          activity_type: 'payment_received',
          /*
           * The last activity still written in English, and the currency was
           * printed as a bare code beside the number. `Intl` formats it the way
           * the reader expects — ₪200.00, $200.00 — in the business's language.
           */
          title: activitySentence(
            serviceName ? 'payment_received_for' : 'payment_received',
            {
              amount: new Intl.NumberFormat(
                locale === 'he' ? 'he-IL' : locale === 'es' ? 'es-ES' : 'en-US',
                { style: 'currency', currency: paymentData.currency || 'USD' }
              ).format(Number(paymentData.amount) || 0),
              service: serviceName || '',
            },
            locale
          ),
          description: JSON.stringify({
            kind: 'payment_received',
            amount: paymentData.amount,
            currency: paymentData.currency,
            service: serviceName || undefined,
            receipt: receiptNumber || undefined,
          }),
          auto_logged: true,
          source_capability: 'payments',
          source_entity_id: paymentData.bookingId || undefined
        }).catch(err => requestLogger.warn({ err }, 'CRM activity logging failed (non-blocking)'));
      }

      return { sent: result.sent, error: result.error };
    } catch (error) {
      requestLogger.error({ err: error }, 'Error sending payment receipt');
      return { sent: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Send cancellation email
   * Called from: cancel API, chat commands
   */
  static async sendCancellationEmail(
    bookingId: string,
    userId: string,
    reason?: string,
    options?: {
      /**
       * Whether to invite the client to book again. Defaults to true, which is
       * right for every ordinary cancellation.
       *
       * False when the business itself is closing: "Book Again" contradicts the
       * message and points at a page that is about to stop existing.
       */
      offerRebooking?: boolean;
      /**
       * Whether the owner's free-text note goes to the client.
       *
       * ─────────────────────────────────────────────────────────────────────
       * DEFAULTS TO TRUE, and only an OWNER cancellation may turn it off.
       *
       * When the CLIENT cancels, the note is their own words — there is nothing
       * to withhold, and hiding it would be withholding it from the person who
       * wrote it. The client-facing cancel route never passes this.
       *
       * When the OWNER cancels, the note field reads like somewhere to keep an
       * internal remark and it is emailed verbatim. This is the switch that
       * stops that, leaving the client a neutral phrasing of the reason instead.
       * ─────────────────────────────────────────────────────────────────────
       */
      shareNoteWithClient?: boolean;
      /**
       * A PACKAGE's cancelled meetings, when a whole block is called off.
       *
       * Sent ONCE, from the purchase, with every date listed — rather than one
       * cancellation per meeting, which is six times the alarm for one piece of
       * news. The purchase has no hour of its own, so without this the email
       * would name no date at all.
       */
      sessions?: Date[];
      /** The meetings of that block that already took place. See the template. */
      heldSessions?: Date[];
      /**
       * Money the business is still holding for this booking, if any.
       *
       * Supplied by `cancelBooking`, which has already worked it out from the
       * settled payments and nets the refunds off. Passed in rather than
       * recomputed so the figure the client is told matches the one the owner is
       * being asked about, to the agora.
       *
       * Zero or absent means nothing was paid, or it has all been returned, and
       * the email says nothing about money at all.
       */
      amountHeld?: number;
      heldCurrency?: string | null;
      /** Collected before any refund, and how much of it has gone back. */
      paidAmount?: number;
      refundedAmount?: number;
    }
  ): Promise<EmailResult> {
    const requestLogger = logger.child({ bookingId, userId, action: 'sendCancellationEmail' });

    try {
      // Fetch user's preferred language from profile
      const locale = await getBusinessLocale(userId);
      /*
       * Shared unless the owner said otherwise. `?? true` rather than a truthy
       * check, so an explicit `false` is honoured while an absent option keeps
       * the behaviour every existing caller already has.
       */
      const shareNoteWithClient = options?.shareNoteWithClient ?? true;

      // Fetch booking
      const bookingResult = await schedulingBookingRepository.findById(bookingId, userId);
      if (bookingResult.error || !bookingResult.data) {
        requestLogger.error({ err: bookingResult.error }, 'Booking not found');
        return { sent: false, error: 'Booking not found' };
      }
      const booking = bookingResult.data;

      /*
       * There has to be somebody to send to.
       *
       * `client_email` is derived from the joined contact and normalised to `''`
       * when that contact has no address, so the type is `string | undefined`
       * and the value can be empty. Passing it straight to `sendEmail` meant a
       * send to `['']` — an attempt that fails somewhere in the transport, or
       * worse, a booking token minted for an empty address.
       *
       * Resolved once, refused here, and the narrowed value used below.
       */
      const clientEmail = booking.client_email?.trim();
      if (!clientEmail) {
        requestLogger.warn({ bookingId }, 'No client email on this booking; nothing sent');
        return { sent: false, error: 'No client email' };
      }

      // Fetch service
      const serviceResult = await schedulingServiceRepository.findById(booking.service_id, userId);
      if (serviceResult.error || !serviceResult.data) {
        requestLogger.error({ err: serviceResult.error }, 'Service not found');
        return { sent: false, error: 'Service not found' };
      }
      const service = serviceResult.data;

      // Fetch business profile for branding
      const profileResult = await businessProfileRepository.findByUserId(userId);
      const branding = await resolveEmailBranding(userId, locale, profileResult.data);

      // Somewhere the client can actually book — see `resolveBookingUrl`.
      // Never the business's own site: see the note there.
      const bookAgainUrl =
        options?.offerRebooking === false
          ? undefined
          : await resolveBookingUrl(userId, profileResult.data);

      // Parse booking datetime
      const startTime = new Date(booking.start_time);

      // Build client name
      const clientName = [booking.client_first_name, booking.client_last_name].filter(Boolean).join(' ');

      // Generate email
      const { subject, html } = generateBookingCancellationEmail({
        clientName,
        serviceName: service.service_name,
        dateTime: startTime,
        // The whole block, for a package. Undefined for an ordinary booking,
        // and the template then renders exactly as it did before.
        sessions: options?.sessions,
        heldSessions: options?.heldSessions,
        timezone: await getBusinessTimezone(userId, booking.timezone),
        /*
         * The free text, or ONLY the reason — the owner's choice.
         *
         * ─────────────────────────────────────────────────────────────────────
         * `reason` here is the prose from `cancellation_reason`, which carries
         * whatever the owner typed. That has always been emailed to the client
         * verbatim, and the note field reads like somewhere to keep an internal
         * remark: "not paying, avoid in future" is a reasonable thing to write
         * down and a terrible thing to send.
         *
         * When the owner turns sharing off, the client gets a NEUTRAL phrasing of
         * the reason code instead — never the code itself, and never the note.
         * `client_not_paying` is an accurate record and an accusation to receive.
         *
         * Falls through to no reason line when the code has no client-safe
         * phrasing (`test_booking`, `other`), which is better than either.
         * ─────────────────────────────────────────────────────────────────────
         */
        reason: cancellationReasonForClient({
          prose: reason || booking.cancellation_reason || null,
          code: booking.cancel_reason ?? null,
          shareNote: shareNoteWithClient,
          locale,
        }),
        bookAgainUrl,
        /*
         * The figure and the place, as the confirmation carries them.
         *
         * Both were available here and neither was passed, so the cancellation
         * was the thinner of the two emails about the same booking. On a course
         * or anything else bought without a time it was thinner than empty: no
         * date, no time, usually no reason, and the details panel rendered as a
         * blank strip under a struck-through service name.
         *
         * Priced from the SERVICE, which is where the confirmation reads it too.
         */
        price: service.price ?? undefined,
        currency: service.currency ?? undefined,
        /*
         * What is still held, so the client is not left guessing.
         *
         * The platform deliberately does NOT refund on cancellation: a refund
         * moves real money and belongs to a person. That is right, and it left
         * the client with a cancelled booking, a charge on their card and an
         * email that mentioned neither.
         */
        amountHeld: options?.amountHeld,
        heldCurrency: options?.heldCurrency ?? undefined,
        /*
         * The full picture, not just what is left.
         *
         * `amountHeld` alone cannot distinguish "never paid" from "paid and
         * refunded in full" — both are zero — and those are opposite messages to
         * send somebody. `paidAmount` and `refundedAmount` are what separate them.
         */
        paidAmount: options?.paidAmount,
        refundedAmount: options?.refundedAmount,
        /* So "book again" opens on this service instead of a list of everything. */
        serviceId: booking.service_id,
        location: undefined, // TODO: add location support, as on the confirmation
        // Same test as the confirmation: a booking with no start time was never
        // an appointment, so cancelling it is cancelling an order.
        hasSchedule: Boolean(booking.start_time),
        branding,
        locale
      });

      /*
       * A withdrawal for the client's calendar.
       *
       * The moment a confirmation starts carrying an invite, a cancellation
       * has to carry its retraction — otherwise the appointment the client
       * just cancelled sits in their calendar for ever, alarm and all. Same
       * UID, a risen SEQUENCE and METHOD:CANCEL is what removes it.
       */
      const cancelIcs = booking.start_time && booking.end_time
        ? generateICSContent(
            {
              clientName,
              clientEmail,
              serviceName: service.service_name,
              dateTime: new Date(booking.start_time),
              endTime: new Date(booking.end_time),
              duration: 0,
              timezone: await getBusinessTimezone(userId, booking.timezone),
              rescheduleUrl: '',
              cancelUrl: '',
              bookingId,
              branding,
            } as Parameters<typeof generateICSContent>[0],
            {
              organizerEmail: await resolveOwnerReplyTo(userId),
              sequence: icsSequenceFor(booking.updated_at),
              method: 'CANCEL',
            }
          )
        : null;

      // Send email
      const result = await sendEmail({
        kind: 'transactional',
        to: [clientEmail],
        subject,
        html,
        ownerUserId: userId,
        attachments: cancelIcs
          ? [{
              filename: 'appointment.ics',
              content: Buffer.from(cancelIcs, 'utf8'),
              contentType: 'text/calendar; method=CANCEL; charset=utf-8',
            }]
          : undefined,
      });

      if (result.sent) {
        requestLogger.info({ provider: result.provider }, 'Cancellation email sent');
      } else {
        requestLogger.warn({ error: result.error }, 'Failed to send cancellation email');
      }

      // Log email to email_sends table (non-blocking)
      recordEmailSend({
        userId,
        contactId: booking.contact_id,
        toEmail: clientEmail,
        subject,
        bodyHtml: html,
        result
      }).catch(err => requestLogger.warn({ err }, 'Email logging failed (non-blocking)'));

      return { sent: result.sent, error: result.error };
    } catch (error) {
      requestLogger.error({ err: error }, 'Error sending cancellation email');
      return { sent: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Invite a client back after an appointment they did not attend.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * NEVER SENT AUTOMATICALLY. The no-show route sends this only when the owner
   * ticks the box on the confirmation dialog, because the owner knows what the
   * system cannot: whether the person rang ahead, is unwell, or actually did
   * turn up and the status was a slip.
   *
   * The copy carries no blame and never says "no-show" — that is the owner's
   * internal label, and to the reader it is an accusation. See
   * `missedAppointment` in the email translations.
   * ───────────────────────────────────────────────────────────────────────────
   */
  static async sendMissedAppointmentEmail(
    bookingId: string,
    userId: string
  ): Promise<EmailResult> {
    const requestLogger = logger.child({ bookingId, userId, action: 'sendMissedAppointmentEmail' });

    try {
      const locale = await getBusinessLocale(userId);

      const bookingResult = await schedulingBookingRepository.findById(bookingId, userId);
      if (bookingResult.error || !bookingResult.data) {
        requestLogger.error({ err: bookingResult.error }, 'Booking not found');
        return { sent: false, error: 'Booking not found' };
      }
      const booking = bookingResult.data;

      // Same guard as the cancellation email: `client_email` can be an empty
      // string when the joined contact has no address, and sending to [''] is
      // a failure somewhere in the transport rather than here.
      const clientEmail = booking.client_email?.trim();
      if (!clientEmail) {
        requestLogger.warn({ bookingId }, 'No client email on this booking; nothing sent');
        return { sent: false, error: 'No client email' };
      }

      /*
       * An appointment with no time was never attended or missed — it was an
       * order. "We missed you" about a course purchase is nonsense, so there is
       * nothing to send.
       */
      if (!booking.start_time) {
        requestLogger.info({ bookingId }, 'Booking has no scheduled time; no missed-appointment email');
        return { sent: false, error: 'Booking has no scheduled time' };
      }

      const serviceResult = await schedulingServiceRepository.findById(booking.service_id, userId);
      if (serviceResult.error || !serviceResult.data) {
        requestLogger.error({ err: serviceResult.error }, 'Service not found');
        return { sent: false, error: 'Service not found' };
      }
      const service = serviceResult.data;

      const profileResult = await businessProfileRepository.findByUserId(userId);
      const branding = await resolveEmailBranding(userId, locale, profileResult.data);

      // The whole point of the email. Without somewhere to book, it is only a
      // note telling someone they were absent — so there is nothing to send.
      const bookAgainUrl = await resolveBookingUrl(userId, profileResult.data);
      if (!bookAgainUrl) {
        requestLogger.info({ bookingId }, 'No booking page to point at; no missed-appointment email');
        return { sent: false, error: 'No booking url' };
      }

      const clientName = [booking.client_first_name, booking.client_last_name].filter(Boolean).join(' ');

      const { subject, html } = generateMissedAppointmentEmail({
        clientName,
        serviceName: service.service_name,
        dateTime: new Date(booking.start_time),
        timezone: await getBusinessTimezone(userId, booking.timezone),
        bookAgainUrl,
        branding,
        locale
      });

      /*
       * `transactional`. It concerns an appointment this person booked, and it
       * goes to them whether or not they ever accepted marketing — the same
       * basis as the cancellation email beside it. An invitation to a client
       * who never booked anything would be marketing and would need consent.
       */
      const result = await sendEmail({
        kind: 'transactional',
        to: [clientEmail],
        subject,
        html,
        ownerUserId: userId
      });

      if (result.sent) {
        requestLogger.info({ provider: result.provider }, 'Missed-appointment email sent');
      } else {
        requestLogger.warn({ error: result.error }, 'Failed to send missed-appointment email');
      }

      recordEmailSend({
        userId,
        contactId: booking.contact_id,
        toEmail: clientEmail,
        subject,
        bodyHtml: html,
        result
      }).catch(err => requestLogger.warn({ err }, 'Email logging failed (non-blocking)'));

      return { sent: result.sent, error: result.error };
    } catch (error) {
      requestLogger.error({ err: error }, 'Error sending missed-appointment email');
      return { sent: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Send rescheduled booking email
   * Called from: reschedule API
   */
  static async sendRescheduledEmail(
    bookingId: string,
    userId: string,
    previousDateTime: Date
  ): Promise<EmailResult> {
    const requestLogger = logger.child({ bookingId, userId, action: 'sendRescheduledEmail' });

    try {
      // Fetch user's preferred language from profile
      const locale = await getBusinessLocale(userId);

      // Fetch booking (with new time)
      const bookingResult = await schedulingBookingRepository.findById(bookingId, userId);
      if (bookingResult.error || !bookingResult.data) {
        requestLogger.error({ err: bookingResult.error }, 'Booking not found');
        return { sent: false, error: 'Booking not found' };
      }
      const booking = bookingResult.data;

      /*
       * There has to be somebody to send to.
       *
       * `client_email` is derived from the joined contact and normalised to `''`
       * when that contact has no address, so the type is `string | undefined`
       * and the value can be empty. Passing it straight to `sendEmail` meant a
       * send to `['']` — an attempt that fails somewhere in the transport, or
       * worse, a booking token minted for an empty address.
       *
       * Resolved once, refused here, and the narrowed value used below.
       */
      const clientEmail = booking.client_email?.trim();
      if (!clientEmail) {
        requestLogger.warn({ bookingId }, 'No client email on this booking; nothing sent');
        return { sent: false, error: 'No client email' };
      }

      // Fetch service
      const serviceResult = await schedulingServiceRepository.findById(booking.service_id, userId);
      if (serviceResult.error || !serviceResult.data) {
        requestLogger.error({ err: serviceResult.error }, 'Service not found');
        return { sent: false, error: 'Service not found' };
      }
      const service = serviceResult.data;

      // Fetch business profile for branding
      const profileResult = await businessProfileRepository.findByUserId(userId);
      const branding = await resolveEmailBranding(userId, locale, profileResult.data);

      // Generate booking management token and URLs
      const token = generateBookingToken(bookingId, clientEmail);
      const rescheduleUrl = `${appUrl()}/book/manage/${token}/reschedule`;
      const cancelUrl = `${appUrl()}/book/manage/${token}/cancel`;

      // Parse booking datetime
      const newDateTime = new Date(booking.start_time);
      const endTime = new Date(booking.end_time);
      const durationMinutes = Math.round((endTime.getTime() - newDateTime.getTime()) / 60000);

      // Build client name
      const clientName = [booking.client_first_name, booking.client_last_name].filter(Boolean).join(' ');

      /*
       * ─────────────────────────────────────────────────────────────────────
       * WHAT IS STILL OWED, IF ANYTHING.
       *
       * A reschedule said nothing about money, so a client moving an unpaid
       * appointment got a tidy email with no mention that they had not paid and
       * no way to do it.
       *
       * Read here rather than passed in, because unlike the confirmation there
       * is no caller holding a freshly-created invoice — by now it exists and
       * has to be found by `booking_id`.
       *
       * ENTIRELY NON-FATAL. Every step below falls back to "say nothing": a
       * reschedule that reaches the client without a payment note is a worse
       * email, and one that never arrives because an invoice lookup failed is a
       * worse outcome. The client's appointment moved either way.
       * ─────────────────────────────────────────────────────────────────────
       */
      let price: number | undefined;
      let currency: string | undefined;
      let paymentStatus: 'pending' | 'paid' | 'refunded' | 'not_required' | undefined;
      let paymentUrl: string | undefined;
      let bookingPlan:
        | {
            totalAmount: number;
            periods: Array<{ number: number; amount: number; dueDate: string | null; status: string }>;
          }
        | undefined;

      try {
        const { data: invoice } = await supabaseServer
          .from('payment_invoices')
          .select(
            'id, amount, currency, status, paid_at, refund_status, stripe_hosted_invoice_url, allow_online_payment'
          )
          .eq('booking_id', bookingId)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        /*
         * THE LEDGER DECIDES, NOT `booking.payment_status`.
         *
         * That column is written `paid` for a FREE booking — the create route
         * reads a price of zero as nothing left to collect, which is true and is
         * not the same as money having arrived. It is also trigger-derived for
         * refunds. `isSettledInvoice` and `hasBeenRefunded` are the same two
         * rules the reminder sender uses, so a refunded or settled booking is
         * silent here exactly as it is there.
         */
        const settled = invoice ? isSettledInvoice(invoice) || hasBeenRefunded(invoice) : true;

        if (invoice && !settled) {
          const [{ data: periodRows }, capability] = await Promise.all([
            supabaseServer
              .from('payment_plan_installments')
              .select('installment_number, amount, due_date, status')
              .eq('booking_id', bookingId)
              .eq('user_id', userId)
              .order('installment_number'),
            resolvePaymentCollectionCapability(supabaseServer, userId),
          ]);

          /*
           * The same resolver the invoice email uses, so the two cannot
           * disagree about whether this client may pay by card. It honours the
           * invoice's own "Send via Stripe" tick as well as the business
           * capability — offering a card the pay page will not draw is worse
           * than offering none.
           */
          const options = resolveInvoicePaymentOptions({
            canCollectOnline: capability.canCollect,
            cardUrl:
              invoice.stripe_hosted_invoice_url ||
              `${appUrl()}/api/public/invoice/${invoice.id}/pay`,
            profile: profileResult.data as never,
            allowOnlinePayment: (invoice as { allow_online_payment?: boolean | null })
              .allow_online_payment,
          });

          price = Number(invoice.amount ?? 0) || undefined;
          currency = invoice.currency ?? service.currency ?? undefined;
          paymentStatus = 'pending';
          // Only where a card can actually be taken. Without one the note still
          // says what is owed; it just has no button under it.
          paymentUrl = options.card ? options.cardUrl ?? undefined : undefined;

          bookingPlan = (periodRows ?? []).length
            ? {
                totalAmount: Number(service.price ?? invoice.amount ?? 0),
                periods: (periodRows ?? []).map(row => ({
                  number: Number(row.installment_number),
                  amount: Number(row.amount),
                  dueDate: (row.due_date as string | null) ?? null,
                  status: String(row.status),
                })),
              }
            : undefined;
        }
      } catch (err) {
        requestLogger.warn({ err, bookingId }, 'Could not resolve payment for the reschedule email (non-blocking)');
      }

      // Generate email
      const { subject, html, icsContent } = generateBookingRescheduledEmail({
        clientName,
        clientEmail,
        price,
        currency,
        paymentStatus,
        paymentUrl,
        plan: bookingPlan,
        serviceName: service.service_name,
        oldDateTime: previousDateTime,
        newDateTime,
        newEndTime: endTime,
        duration: durationMinutes,
        timezone: await getBusinessTimezone(userId, booking.timezone),
        rescheduleUrl,
        cancelUrl,
        bookingId,
        branding,
        locale
      }, {
        organizerEmail: await resolveOwnerReplyTo(userId),
        /*
         * A RISING sequence, which is the whole reason a reschedule lands.
         * The UID is unchanged, so a calendar compares sequences and ignores
         * anything that has not moved — every reschedule until now was sent as
         * SEQUENCE 0, so the client's calendar quietly kept the OLD time while
         * the email announced the new one.
         */
        sequence: icsSequenceFor(booking.updated_at),
      });

      // Send email
      const result = await sendEmail({
        kind: 'transactional',
        to: [clientEmail],
        subject,
        html,
        ownerUserId: userId,
        attachments: icsContent
          ? [{
              filename: 'appointment.ics',
              content: Buffer.from(icsContent, 'utf8'),
              contentType: 'text/calendar; method=REQUEST; charset=utf-8',
            }]
          : undefined,
      });

      if (result.sent) {
        requestLogger.info({ provider: result.provider }, 'Rescheduled email sent');
      } else {
        requestLogger.warn({ error: result.error }, 'Failed to send rescheduled email');
      }

      // Log email to email_sends table (non-blocking)
      recordEmailSend({
        userId,
        contactId: booking.contact_id,
        toEmail: clientEmail,
        subject,
        bodyHtml: html,
        result
      }).catch(err => requestLogger.warn({ err }, 'Email logging failed (non-blocking)'));

      return { sent: result.sent, error: result.error };
    } catch (error) {
      requestLogger.error({ err: error }, 'Error sending rescheduled email');
      return { sent: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Send welcome email after contact form submission
   * Called from: /api/website/forms/contact
   */
  static async sendWelcomeEmail(
    contactId: string,
    userId: string,
    formData: {
      name: string;
      email: string;
      message?: string;
      serviceInterest?: string;
    }
  ): Promise<EmailResult> {
    const requestLogger = logger.child({ contactId, userId, action: 'sendWelcomeEmail' });

    try {
      // Fetch user's preferred language from profile
      const locale = await getBusinessLocale(userId);

      // Fetch business profile for branding
      const profileResult = await businessProfileRepository.findByUserId(userId);
      const branding = await resolveEmailBranding(userId, locale, profileResult.data);

      /*
       * Two links with two different jobs, previously tangled into one.
       *
       * `websiteUrl` is the business's own site, rendered as "Visit our
       * website" — a signature, the same thing the email footer carries. An
       * external address is exactly right there: it says who sent this.
       *
       * `bookingUrl` is a call to action, and must land somewhere a client can
       * actually book — so it never points off this platform. See
       * `resolveBookingUrl`.
       *
       * The bug was that the booking lookup sat INSIDE `if (websiteUrl)`,
       * gating a link to THIS platform on the business having an external site
       * — which nothing could record. The block never ran for anyone, so a
       * business with a published page here got no booking link at all.
       *
       * Sanitised because it reaches an href and is owner-typed text.
       */
      /*
       * Ours first, then theirs — the order every other branded surface uses.
       *
       * This read the external address alone, so a business whose website we
       * host had its own site named in `resolveEmailBranding`'s footer and
       * somewhere else entirely in the body of this email. `platformSite`
       * answers published-only and homepage-only, so a draft or a landing page
       * still falls through to the address the business had before us.
       */
      const websiteUrl =
        (await resolvePlatformWebsiteUrl(userId)) ??
        safeExternalUrl(profileResult.data?.website_url) ??
        undefined;
      const bookingUrl = await resolveBookingUrl(userId, profileResult.data);

      // Generate email
      const { subject, html } = generateWelcomeEmail({
        clientName: formData.name,
        clientEmail: formData.email,
        message: formData.message,
        serviceInterest: formData.serviceInterest,
        websiteUrl,
        bookingUrl,
        branding,
        locale
      });

      // Send email
      const result = await sendEmail({
        kind: 'transactional',
        to: [formData.email],
        subject,
        html,
        ownerUserId: userId
      });

      if (result.sent) {
        requestLogger.info({ provider: result.provider, email: formData.email }, 'Welcome email sent');
      } else {
        requestLogger.warn({ error: result.error }, 'Failed to send welcome email');
      }

      /*
       * Record that this client now HAS a way to book.
       *
       * The welcome email carries a "Book a Call" button whenever a booking URL
       * resolves, and until now the only trace was an `email` activity titled
       * with the subject line. Three places ask "has this person been given a
       * booking link", and all three read `booking_link_sent`:
       *
       *  - the `enquiry_unanswered` gap, which kept telling the owner to send a
       *    link the client already had;
       *  - `SalesStalledDetector`, which counted the enquiry as unanswered;
       *  - `LeadBookingLinkService`, which uses the row as its idempotency
       *    claim — so pressing "Send booking link" would send a SECOND one.
       *
       * Written here rather than by widening what counts as an answer: a plain
       * email is not a booking link, and step 1 of the website sequence proves
       * it — same subject line, no link in the body at all.
       *
       * Only when a link actually went out and the send succeeded. Non-blocking,
       * and guarded against a duplicate row the same way the other writer is.
       */
      if (result.sent && bookingUrl && contactId) {
        void recordBookingLinkSent(userId, contactId, bookingUrl, locale).catch(err =>
          requestLogger.warn({ err }, 'Could not record the booking link send (non-blocking)')
        );
      }

      // Log email to email_sends table (non-blocking)
      recordEmailSend({
        userId,
        contactId,
        toEmail: formData.email,
        subject,
        bodyHtml: html,
        result
      }).catch(err => requestLogger.warn({ err }, 'Email logging failed (non-blocking)'));

      return { sent: result.sent, error: result.error };
    } catch (error) {
      requestLogger.error({ err: error }, 'Error sending welcome email');
      return { sent: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Send returning contact email when an existing contact submits the form again
   * Called from: /api/website/forms/contact
   */
  static async sendReturningContactEmail(
    contactId: string,
    userId: string,
    formData: {
      name: string;
      email: string;
      message?: string;
      serviceInterest?: string;
    }
  ): Promise<EmailResult> {
    const requestLogger = logger.child({ contactId, userId, action: 'sendReturningContactEmail' });

    try {
      // Fetch user's preferred language from profile
      const locale = await getBusinessLocale(userId);

      // Fetch business profile for branding
      const profileResult = await businessProfileRepository.findByUserId(userId);
      const branding = await resolveEmailBranding(userId, locale, profileResult.data);

      /*
       * Two links with two different jobs, previously tangled into one.
       *
       * `websiteUrl` is the business's own site, rendered as "Visit our
       * website" — a signature, the same thing the email footer carries. An
       * external address is exactly right there: it says who sent this.
       *
       * `bookingUrl` is a call to action, and must land somewhere a client can
       * actually book — so it never points off this platform. See
       * `resolveBookingUrl`.
       *
       * The bug was that the booking lookup sat INSIDE `if (websiteUrl)`,
       * gating a link to THIS platform on the business having an external site
       * — which nothing could record. The block never ran for anyone, so a
       * business with a published page here got no booking link at all.
       *
       * Sanitised because it reaches an href and is owner-typed text.
       */
      /*
       * Ours first, then theirs — the order every other branded surface uses.
       *
       * This read the external address alone, so a business whose website we
       * host had its own site named in `resolveEmailBranding`'s footer and
       * somewhere else entirely in the body of this email. `platformSite`
       * answers published-only and homepage-only, so a draft or a landing page
       * still falls through to the address the business had before us.
       */
      const websiteUrl =
        (await resolvePlatformWebsiteUrl(userId)) ??
        safeExternalUrl(profileResult.data?.website_url) ??
        undefined;
      const bookingUrl = await resolveBookingUrl(userId, profileResult.data);

      // Generate email
      const { subject, html } = generateReturningContactEmail({
        clientName: formData.name,
        clientEmail: formData.email,
        message: formData.message,
        serviceInterest: formData.serviceInterest,
        websiteUrl,
        bookingUrl,
        branding,
        locale
      });

      // Send email
      const result = await sendEmail({
        kind: 'transactional',
        to: [formData.email],
        subject,
        html,
        ownerUserId: userId
      });

      if (result.sent) {
        requestLogger.info({ provider: result.provider, email: formData.email }, 'Returning contact email sent');
      } else {
        requestLogger.warn({ error: result.error }, 'Failed to send returning contact email');
      }

      // Log email to email_sends table (non-blocking)
      recordEmailSend({
        userId,
        contactId,
        toEmail: formData.email,
        subject,
        bodyHtml: html,
        result
      }).catch(err => requestLogger.warn({ err }, 'Email logging failed (non-blocking)'));

      return { sent: result.sent, error: result.error };
    } catch (error) {
      requestLogger.error({ err: error }, 'Error sending returning contact email');
      return { sent: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }


  /**
   * The reminder before an appointment, to whoever the owner asked for.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Two audiences, sent independently. A client address that bounces must not
   * cost the owner their own heads-up, and an owner with no address on file
   * must not stop the client being reminded — so each is attempted on its own
   * and the result reports `sent: true` if either landed.
   *
   * The owner's copy carries what can still be FIXED before the appointment:
   * an intake form that never came back, and money that has not arrived. Those
   * are the two things a reminder can usefully change, and neither is visible
   * on the client's version.
   * ───────────────────────────────────────────────────────────────────────────
   */
  static async sendMeetingReminder(
    bookingId: string,
    userId: string,
    options: { notifyClient: boolean; notifyOwner: boolean }
  ): Promise<{ sent: boolean; error?: string }> {
    const requestLogger = logger.child({ bookingId, userId, action: 'sendMeetingReminder' });

    try {
      const locale = await getBusinessLocale(userId);

      const bookingResult = await schedulingBookingRepository.findById(bookingId, userId);
      if (bookingResult.error || !bookingResult.data) {
        return { sent: false, error: 'Booking not found' };
      }
      const booking = bookingResult.data;

      const startsAt = booking.start_time ? new Date(booking.start_time) : null;
      if (!startsAt || Number.isNaN(startsAt.getTime())) {
        return { sent: false, error: 'Booking has no start time' };
      }

      const serviceResult = booking.service_id
        ? await schedulingServiceRepository.findById(booking.service_id, userId)
        : { data: null, error: null };

      const profileResult = await businessProfileRepository.findByUserId(userId);
      const branding = await resolveEmailBranding(userId, locale, profileResult.data);

      const profile = profileResult.data as Record<string, unknown> | null;
      const businessName =
        (profile?.company_name as string) || (profile?.invoice_company_name as string) || 'your appointment';
      const serviceName = serviceResult.data?.service_name ?? 'appointment';
      const timezone = (booking as { timezone?: string }).timezone ?? 'UTC';

      /*
       * Who this is about.
       *
       * Built from the fields `findById` DERIVES off the joined contact —
       * `scheduling_bookings` holds no name of its own, only `contact_id`. An
       * earlier version read `booking.client_name`, which is not a column and
       * is not derived either, so it was always undefined: every client
       * reminder opened "Hi there," and the owner's heads-up, whose entire job
       * is to lead with WHO is coming, announced that "there" was booked in.
       */
      const clientEmail = booking.client_email?.trim() || null;
      const clientName =
        [booking.client_first_name, booking.client_last_name].filter(Boolean).join(' ').trim() ||
        clientEmail ||
        'there';

      /*
       * Can the client still act on this reminder?
       *
       * ─────────────────────────────────────────────────────────────────────
       * The reminder has always invited them to reschedule, and the reschedule
       * route refuses anything inside the service's notice window with
       * `too_late` and a 400. Nothing compared the two, so the button was a
       * trap: the client pressed it, waited for a page, and was told they were
       * late — after being invited.
       *
       * It is not an edge case. The lead time comes from `REMINDER_LEADS`
       * ([1, 2, 3, 24, 48] in `InsightAdvisorCard`) and the window defaults to
       * 24 hours, so FOUR of the five choices an owner can make produced a dead
       * button.
       *
       * The owner's lead time is deliberately NOT overridden. Somebody who picks
       * two hours wants a same-day nudge, and sending it a day early because the
       * platform disagrees is worse than the bug. What changes is the email:
       * outside the window it says "confirm or change this", inside it says
       * "don't forget".
       *
       * No margin. The test is exactly "more time left than the window". A
       * draft added an hour for dispatch lag and reading time — an invented
       * constant. The case it hid is 24 hours against a 24-hour window, where
       * the link is valid when sent and dead ten minutes later; that is the
       * owner's to see in the picker, not ours to paper over.
       *
       * The service is already loaded above, so this costs no query.
       * ─────────────────────────────────────────────────────────────────────
       */
      const noticeHours = Number(
        (serviceResult.data as { min_notice_hours?: number | null } | null)?.min_notice_hours ?? 24
      );
      const hoursUntilStart = (startsAt.getTime() - Date.now()) / 3_600_000;
      const canStillChange = hoursUntilStart > noticeHours;

      const results: boolean[] = [];
      const failures: string[] = [];

      if (options.notifyClient) {
        if (!clientEmail) {
          failures.push('no client email');
        } else {
          const { subject, html } = generateMeetingReminderEmail({
            clientName,
            businessName,
            serviceName,
            startsAt,
            timezone,
            /*
             * Minted here, the way every other booking email mints it — there
             * is no `manage_url` column, and reading one meant the reminder
             * carried no reschedule link at all. That link is the reason this
             * email is a service rather than a nag: a client who cannot easily
             * move an appointment does not move it, they miss it.
             *
             * A link that cannot be signed degrades to no link, not to no
             * reminder. `generateBookingToken` is deliberately fatal when the
             * signing secret is missing, and letting that escape would take
             * the OWNER's copy down with the client's — two audiences that are
             * independent everywhere else in this method. The template renders
             * without the button; "you have an appointment tomorrow" is still
             * worth sending.
             */
            /*
             * Null once the notice window has closed — see `canStillChange`.
             * The template renders no button for null and picks a footnote that
             * does not point at one.
             */
            manageUrl: canStillChange
              ? manageUrlFor(booking.id, clientEmail, requestLogger)
              : null,
            branding,
            locale,
          });

          const outcome = await sendEmail({
            to: [clientEmail],
            subject,
            html,
            /*
             * Transactional. A reminder about an appointment the recipient
             * booked themselves is not marketing, and gating it on consent
             * would mean the people most likely to forget are the ones never
             * reminded.
             */
            kind: 'transactional',
            /*
             * WHO IT IS FROM, and where a reply goes.
             *
             * Without this the reminder left as "NeuronForge
             * <notifications@…>" — a company the client has never heard of,
             * about an appointment with their physiotherapist — and a reply
             * reached the platform's own inbox rather than the business.
             * `resolveSender` turns this id into the business's name on the
             * envelope and the owner's address in Reply-To. Every other
             * booking email passes it; these two did not.
             */
            ownerUserId: userId,
          });

          results.push(outcome.sent);
          if (!outcome.sent) failures.push(`client: ${outcome.error ?? outcome.blocked ?? 'not sent'}`);

          /*
           * Recorded, like every other client-facing send.
           *
           * Without this the reminder exists nowhere afterwards: no row in
           * `email_sends`, so no `provider_message_id`, so the delivery webhook
           * has nothing to match an open against. Open tracking would be wired
           * end to end and still report nothing for the one automation it was
           * built to measure.
           */
          recordEmailSend({
            userId,
            contactId: booking.contact_id ?? null,
            toEmail: clientEmail,
            subject,
            bodyHtml: html,
            result: outcome,
          }).catch(err => requestLogger.warn({ err }, 'Email logging failed (non-blocking)'));
        }
      }

      if (options.notifyOwner) {
        /*
         * The owner's account address, the way `LeadAlertService` resolves it.
         * `business_profiles.email` is the business's public contact address
         * and is often a shared inbox nobody watches; the account address is
         * the one they actually read.
         */
        const authUser = await supabaseServer.auth.admin.getUserById(userId);
        const ownerEmail = authUser.data?.user?.email;
        if (!ownerEmail) {
          failures.push('no owner email');
        } else {
          const { subject, html } = generateOwnerMeetingReminderEmail({
            clientName,
            clientEmail: booking.client_email ?? null,
            businessName,
            serviceName,
            startsAt,
            timezone,
            branding,
            locale,
            outstanding: {
              // Both read off the booking itself rather than queried, so the
              // owner's copy costs no extra round trip.

              /*
               * Missing means ASKED FOR AND NOT RETURNED.
               *
               * `intake_completed_at` alone is null for every booking of every
               * business that does not collect intake at all, so flagging on it
               * would have told a barber their client's form had not come back
               * when no form was ever sent. `intake_sent_at` is what makes it
               * an outstanding thing rather than an absent one.
               */
              intakeMissing:
                !!(booking as { intake_sent_at?: string | null }).intake_sent_at &&
                !(booking as { intake_completed_at?: string | null }).intake_completed_at,

              /*
               * With its currency, from the booking's own column.
               *
               * A bare "120 is still outstanding" is the fabrication class this
               * module keeps producing: the platform has no single currency,
               * and a business in Israel may bill a US client in dollars.
               */
              paymentDue: outstandingOnBooking(booking),
            },
          });

          // To the owner's own account address, about their own diary. Still
          // sent as the business, so it sits with the rest of their own mail
          // rather than looking like a notice from a third party.
          const outcome = await sendEmail({
            to: [ownerEmail],
            subject,
            html,
            kind: 'transactional',
            ownerUserId: userId,
          });

          results.push(outcome.sent);
          if (!outcome.sent) failures.push(`owner: ${outcome.error ?? outcome.blocked ?? 'not sent'}`);

          // Logged against the same contact the appointment is with: the row
          // is about that booking, whoever the copy went to.
          recordEmailSend({
            userId,
            contactId: booking.contact_id ?? null,
            toEmail: ownerEmail,
            subject,
            bodyHtml: html,
            result: outcome,
          }).catch(err => requestLogger.warn({ err }, 'Email logging failed (non-blocking)'));
        }
      }

      const sent = results.some(Boolean);
      if (!sent) {
        requestLogger.warn({ failures }, 'Meeting reminder reached nobody');
      }

      return sent ? { sent: true } : { sent: false, error: failures.join('; ') || 'nobody to notify' };
    } catch (error) {
      requestLogger.error({ err: error }, 'Meeting reminder failed');
      return { sent: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Send intake form request after booking confirmation
   * Called from: /api/website/booking/create, /api/scheduling/bookings
   */
  static async sendIntakeFormRequest(
    bookingId: string,
    userId: string,
    options?: {
      /**
       * The owner pressed Send on this booking, rather than a client's own
       * booking triggering it.
       *
       * It no longer decides whether the send is PERMITTED: that is the same
       * question for both, and `send_after_booking` stopped gating it. What it
       * still carries is who asked, which is why the toggle in the booking
       * dialog exists at all — a booking the owner enters is often a phone
       * call, a backfill, or a client of ten years, and none of those should be
       * emailed a questionnaire unprompted.
       */
      manual?: boolean;
      /**
       * A second ask, a day before the meeting.
       *
       * The same form and the same link — only the subject and the opening
       * line change, because a client who ignored the first one should not
       * receive a message that reads as if it were the first one.
       */
      reminder?: boolean;
    }
  ): Promise<EmailResult> {
    const requestLogger = logger.child({ bookingId, userId, action: 'sendIntakeFormRequest' });

    try {
      // Fetch business profile language (client-facing emails use business language)
      const locale = await getBusinessLocale(userId);

      // Fetch booking
      const bookingResult = await schedulingBookingRepository.findById(bookingId, userId);
      if (bookingResult.error || !bookingResult.data) {
        requestLogger.error({ err: bookingResult.error }, 'Booking not found');
        return { sent: false, error: 'Booking not found' };
      }
      const booking = bookingResult.data;

      /*
       * There has to be somebody to send to.
       *
       * `client_email` is derived from the joined contact and normalised to `''`
       * when that contact has no address, so the type is `string | undefined`
       * and the value can be empty. Passing it straight to `sendEmail` meant a
       * send to `['']` — an attempt that fails somewhere in the transport, or
       * worse, a booking token minted for an empty address.
       *
       * Resolved once, refused here, and the narrowed value used below.
       */
      const clientEmail = booking.client_email?.trim();
      if (!clientEmail) {
        requestLogger.warn({ bookingId }, 'No client email on this booking; nothing sent');
        return { sent: false, error: 'No client email' };
      }

      // Fetch service
      const serviceResult = await schedulingServiceRepository.findById(booking.service_id, userId);
      if (serviceResult.error || !serviceResult.data) {
        requestLogger.error({ err: serviceResult.error }, 'Service not found');
        return { sent: false, error: 'Service not found' };
      }
      const service = serviceResult.data;

      // Fetch business profile for branding
      const profileResult = await businessProfileRepository.findByUserId(userId);
      const branding = await resolveEmailBranding(userId, locale, profileResult.data);

      /*
       * Is there an intake form to ask for?
       *
       * This asked whether the business had a WEBSITE — which is not the same
       * question, and the comment it replaces admitted as much ("for now, we'll
       * check if there's an intake form block"). So every booking triggered an
       * intake email, and the link in it opened a page reading "no intake form
       * required. You're all set." An email whose only content is a link to a
       * page saying there was nothing to do.
       *
       * `getEnabledTemplateForUser` is the same call `/book/manage/[token]/intake`
       * uses to decide `hasIntake`, so the email and the page it points at can no
       * longer disagree. It returns null when intake is off, when it is not
       * collected at booking time, or — as here — when it is switched on with no
       * template chosen.
       */
      /*
       * ONE QUESTION, WHOEVER ASKED: does the business have a form to send?
       *
       * This used to pass `forClient: !manual`, on the basis that an automatic
       * send additionally required `send_after_booking`. That has not been true
       * since the flag stopped being a gate, and `intakeBlockReason` never read
       * the argument in any case — so the distinction cost a parameter and
       * bought nothing.
       *
       * `options.manual` still matters, but for WHEN and for what the message
       * says, not for whether it may go: a booking a client made sends on its
       * own, and one the owner entered sends when they ask.
       */
      const { form, blocked } = await resolveIntakeForSending(userId, {
        /*
         * The service decides whether there is anything to ask.
         *
         * A quote request has no occasion for a form — the next thing that
         * client should receive is a price — and a product has no appointment
         * to prepare for. Everything else is asked, free consultations
         * included: costing nothing is not the same as needing nothing.
         */
        service: {
          sale_mode: (service as { sale_mode?: string | null }).sale_mode ?? null,
          is_scheduled: (service as { is_scheduled?: boolean | null }).is_scheduled ?? null,
        },
      });

      if (!form) {
        /*
         * `blocked` says which of three things is in the way, and the caller
         * passes it back to the owner. "No intake form configured" was true of
         * all three and actionable for none — a business one click from working
         * was told the same thing as one that had never switched it on.
         */
        requestLogger.info(
          { manual: !!options?.manual, blocked },
          'Intake not sendable for this business, skipping'
        );
        return {
          sent: false,
          error:
            blocked === 'not_published'
              ? 'Your intake form has not been published yet'
              : blocked === 'not_applicable'
                ? 'This service does not collect an intake form'
                : 'No intake form configured',
        };
      }

      // Generate booking management token and URLs
      const token = generateBookingToken(bookingId, clientEmail);
      const intakeFormUrl = `${appUrl()}/book/manage/${token}/intake`;
      const rescheduleUrl = `${appUrl()}/book/manage/${token}/reschedule`;
      const cancelUrl = `${appUrl()}/book/manage/${token}/cancel`;

      /*
       * Parse booking datetime.
       *
       * `new Date(null)` is epoch zero, not an invalid date, so a course or a
       * product — neither of which has a `start_time` — dated its intake email
       * "1 January 1970" with a duration of zero. The same trap the receipt
       * email fell into.
       *
       * Falls back to when the booking was made, which is a true date about
       * this booking rather than a fabricated one.
       */
      const startTime = booking.start_time
        ? new Date(booking.start_time)
        : new Date(booking.created_at);
      const endTime = booking.end_time ? new Date(booking.end_time) : null;
      const durationMinutes = endTime
        ? Math.round((endTime.getTime() - startTime.getTime()) / 60000)
        : 0;

      // Build client name
      const clientName = [booking.client_first_name, booking.client_last_name].filter(Boolean).join(' ');

      // The business's clock, resolved once and reused by the CRM entry below.
      const businessZone = await getBusinessTimezone(userId, booking.timezone);

      // Generate email
      const { subject, html } = generateIntakeRequestEmail({
        isReminder: !!options?.reminder,
        clientName,
        clientEmail,
        serviceName: service.service_name,
        dateTime: startTime,
        duration: durationMinutes,
        timezone: businessZone,
        location: undefined, // TODO: add location support
        intakeFormUrl,
        rescheduleUrl,
        cancelUrl,
        bookingId,
        branding,
        locale
      });

      // Send email
      const result = await sendEmail({
        kind: 'transactional',
        to: [clientEmail],
        subject,
        html,
        ownerUserId: userId
      });

      if (result.sent) {
        /*
         * Record that it went, on the booking.
         *
         * The column was added with the intake rewrite and nothing ever wrote
         * it — the old code marked "asked" with a sentinel inside
         * `intake_responses` instead. Three states need three answers:
         * never asked, asked, answered. The reminder below reads this, and so
         * does the morning briefing, which was filtering on a column that was
         * always null.
         */
        await schedulingBookingRepository
          .update(bookingId, userId, { intake_sent_at: new Date().toISOString() })
          .catch(err => requestLogger.warn({ err, bookingId }, 'Could not stamp intake_sent_at'));

        requestLogger.info({ provider: result.provider }, 'Intake form request sent');
      } else {
        requestLogger.warn({ error: result.error }, 'Failed to send intake form request');
      }

      // Log email to email_sends table (non-blocking)
      recordEmailSend({
        userId,
        contactId: booking.contact_id,
        toEmail: clientEmail,
        subject,
        bodyHtml: html,
        result
      }).catch(err => requestLogger.warn({ err }, 'Email logging failed (non-blocking)'));

      // Log CRM activity for intake form request (non-blocking, HIPAA compliance)
      if (result.sent && booking.contact_id) {
        crmActivityRepository.create({
          user_id: userId,
          contact_id: booking.contact_id,
          activity_type: 'intake_form_sent',
          // Same shape as the confirmation above.
          title: activitySentence('intake_sent', { service: service.service_name }, locale),
          description: JSON.stringify({
            kind: 'intake_form_sent',
            service: service.service_name,
            bookingDate: booking.start_time || undefined,
            /* Same reasoning as the confirmation entry. */
            timeZone: businessZone,
          }),
          auto_logged: true,
          source_capability: 'scheduling',
          source_entity_id: bookingId
        }).catch(err => requestLogger.warn({ err }, 'CRM activity logging failed (non-blocking)'));
      }

      return { sent: result.sent, error: result.error };
    } catch (error) {
      requestLogger.error({ err: error }, 'Error sending intake form request');
      return { sent: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Tell the client their intake arrived.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The one email in this flow the client had no way to get. They answered
   * personal questions on a page they had never seen, pressed Submit, and the
   * only acknowledgement lived on a screen they were about to close. Nothing in
   * their inbox said it landed, and a submission that failed on the way looked
   * exactly the same.
   *
   * Deliberately NOT gated on `intakeReach`. Those predicates answer "may we
   * ASK this client for an intake" — a question about whether the business
   * collects intake and has published a form. This is the receipt for something
   * that already happened, and refusing to send it because the owner
   * unpublished the form ten minutes later would leave a real submission
   * unacknowledged.
   *
   * Non-blocking at the call site: a submission is saved whether or not this
   * sends. The answers are the thing that matters; the receipt is a courtesy.
   * ───────────────────────────────────────────────────────────────────────────
   *
   * Called from: /api/book/manage/[token]/intake (POST)
   */
  static async sendIntakeReceivedConfirmation(
    bookingId: string,
    userId: string
  ): Promise<EmailResult> {
    const requestLogger = logger.child({
      bookingId,
      userId,
      action: 'sendIntakeReceivedConfirmation'
    });

    try {
      // Client-facing, so it speaks the business's language like the rest.
      const locale = await getBusinessLocale(userId);

      const bookingResult = await schedulingBookingRepository.findById(bookingId, userId);
      if (bookingResult.error || !bookingResult.data) {
        requestLogger.error({ err: bookingResult.error }, 'Booking not found');
        return { sent: false, error: 'Booking not found' };
      }
      const booking = bookingResult.data;

      const clientEmail = booking.client_email?.trim();
      if (!clientEmail) {
        // Nowhere to send it. Not an error worth surfacing — the answers saved.
        return { sent: false, error: 'No client email' };
      }

      const serviceResult = await schedulingServiceRepository.findById(booking.service_id, userId);
      if (serviceResult.error || !serviceResult.data) {
        requestLogger.error({ err: serviceResult.error }, 'Service not found');
        return { sent: false, error: 'Service not found' };
      }
      const service = serviceResult.data;

      const profileResult = await businessProfileRepository.findByUserId(userId);
      const branding = await resolveEmailBranding(userId, locale, profileResult.data);

      /*
       * A fresh token rather than the one they arrived with.
       *
       * The link in their hand may be minutes from expiring, and this email
       * outlives the session that produced it.
       */
      const token = generateBookingToken(bookingId, clientEmail);

      const clientName = [booking.client_first_name, booking.client_last_name]
        .filter(Boolean)
        .join(' ');

      /*
       * `start_time` is null for a product or a service sold without a slot.
       * Passed through as null so the template says "your order" and omits the
       * date, rather than dating the email 1 January 1970 — the trap the receipt
       * and intake-request emails both fell into.
       */
      const { subject, html } = generateIntakeReceivedEmail({
        clientName,
        serviceName: service.service_name,
        dateTime: booking.start_time ? new Date(booking.start_time) : null,
        timezone: await getBusinessTimezone(userId, booking.timezone),
        completedAt: booking.intake_completed_at
          ? new Date(booking.intake_completed_at)
          : new Date(),
        rescheduleUrl: `${appUrl()}/book/manage/${token}/reschedule`,
        cancelUrl: `${appUrl()}/book/manage/${token}/cancel`,
        branding,
        locale
      });

      const result = await sendEmail({
        kind: 'transactional',
        to: [clientEmail],
        subject,
        html,
        ownerUserId: userId
      });

      if (result.sent) {
        requestLogger.info({ provider: result.provider }, 'Intake received confirmation sent');
      } else {
        requestLogger.warn({ error: result.error }, 'Failed to send intake received confirmation');
      }

      // Log email to email_sends table (non-blocking)
      recordEmailSend({
        userId,
        contactId: booking.contact_id,
        toEmail: clientEmail,
        subject,
        bodyHtml: html,
        result
      }).catch(err => requestLogger.warn({ err }, 'Email logging failed (non-blocking)'));

      return { sent: result.sent, error: result.error };
    } catch (error) {
      requestLogger.error({ err: error }, 'Error sending intake received confirmation');
      return { sent: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Send refund confirmation email
   * Called from: /api/scheduling/bookings/[id]/refund
   */
  static async sendRefundConfirmation(
    bookingId: string,
    userId: string,
    refundData: {
      refundAmount: number;
      originalAmount: number;
      currency: string;
      refundType: 'full' | 'partial';
      reason?: string;
      isManualRefund?: boolean;
    }
  ): Promise<EmailResult> {
    const requestLogger = logger.child({ bookingId, userId, action: 'sendRefundConfirmation' });

    try {
      // Fetch user's preferred language from profile
      const locale = await getBusinessLocale(userId);

      // Fetch booking
      const bookingResult = await schedulingBookingRepository.findById(bookingId, userId);
      if (bookingResult.error || !bookingResult.data) {
        requestLogger.error({ err: bookingResult.error }, 'Booking not found');
        return { sent: false, error: 'Booking not found' };
      }
      const booking = bookingResult.data;

      /*
       * There has to be somebody to send to.
       *
       * `client_email` is derived from the joined contact and normalised to `''`
       * when that contact has no address, so the type is `string | undefined`
       * and the value can be empty. Passing it straight to `sendEmail` meant a
       * send to `['']` — an attempt that fails somewhere in the transport, or
       * worse, a booking token minted for an empty address.
       *
       * Resolved once, refused here, and the narrowed value used below.
       */
      const clientEmail = booking.client_email?.trim();
      if (!clientEmail) {
        requestLogger.warn({ bookingId }, 'No client email on this booking; nothing sent');
        return { sent: false, error: 'No client email' };
      }

      // Fetch service
      const serviceResult = await schedulingServiceRepository.findById(booking.service_id, userId);
      const service = serviceResult.data;

      // Fetch business profile for branding
      const profileResult = await businessProfileRepository.findByUserId(userId);
      const branding = await resolveEmailBranding(userId, locale, profileResult.data);

      // Somewhere the client can actually book — see `resolveBookingUrl`.
      // Never the business's own site: see the note there.
      /*
       * Suppressed for the reasons that make it a contradiction — the same rule
       * `cancelBooking` applies to the cancellation email.
       *
       * A refund for a booking cancelled as `service_discontinued` was ending
       * with "would you like to book again?" over a link to the service just
       * withdrawn. The refund email is a second chance to say the same wrong
       * thing, and it was passing the URL unconditionally.
       */
      const bookAgainUrl = REASONS_WITHOUT_REBOOKING.has(booking.cancel_reason ?? '')
        ? undefined
        : await resolveBookingUrl(userId, profileResult.data);

      // Build client name
      const clientName = [booking.client_first_name, booking.client_last_name].filter(Boolean).join(' ');

      // Generate email
      const { subject, html } = generateRefundConfirmationEmail({
        clientName,
        refundAmount: refundData.refundAmount,
        originalAmount: refundData.originalAmount,
        currency: refundData.currency,
        refundType: refundData.refundType,
        refundDate: new Date(),
        timezone: await getBusinessTimezone(userId, booking.timezone),
        serviceName: service?.service_name,
        reason: refundData.reason,
        isManualRefund: refundData.isManualRefund,
        bookAgainUrl,
        branding,
        locale
      });

      // Send email
      const result = await sendEmail({
        kind: 'transactional',
        to: [clientEmail],
        subject,
        html,
        ownerUserId: userId
      });

      if (result.sent) {
        requestLogger.info({ provider: result.provider, refundAmount: refundData.refundAmount }, 'Refund confirmation email sent');
      } else {
        requestLogger.warn({ error: result.error }, 'Failed to send refund confirmation email');
      }

      // Log email to email_sends table (non-blocking)
      recordEmailSend({
        userId,
        contactId: booking.contact_id,
        toEmail: clientEmail,
        subject,
        bodyHtml: html,
        result
      }).catch(err => requestLogger.warn({ err }, 'Email logging failed (non-blocking)'));

      return { sent: result.sent, error: result.error };
    } catch (error) {
      requestLogger.error({ err: error }, 'Error sending refund confirmation email');
      return { sent: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
