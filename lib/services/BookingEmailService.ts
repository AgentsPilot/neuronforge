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
import { sendEmail, SendEmailResult } from '@/lib/notifications/emailTransport';
import { schedulingBookingRepository, schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { emailSendRepository } from '@/lib/repositories/EmailAutomationRepository';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { generateBookingConfirmationEmail, generateBookingCancellationEmail, generateBookingRescheduledEmail, generateICSContent } from '@/lib/email/templates/booking-confirmation';
import { generateInvoiceEmail } from '@/lib/email/templates/invoice';
import { generatePaymentReceiptEmail } from '@/lib/email/templates/payment-receipt';
import { generateRefundConfirmationEmail } from '@/lib/email/templates/refund-confirmation';
import { generateWelcomeEmail, generateReturningContactEmail } from '@/lib/email/templates/welcome-email';
import { generateIntakeRequestEmail } from '@/lib/email/templates/intake-request';
import { resolveEmailBranding } from '@/lib/email/branding';
import type { Locale } from '@/lib/i18n/config';
import { isValidLocale, defaultLocale } from '@/lib/i18n/config';
import { supabaseServer } from '@/lib/supabaseServer';
import * as jwt from 'jsonwebtoken';

const logger = createLogger({ service: 'BookingEmailService' });

// JWT secret for booking manage tokens
const BOOKING_TOKEN_SECRET = process.env.BOOKING_TOKEN_SECRET || process.env.NEXTAUTH_SECRET || 'fallback-secret-change-in-prod';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || '';

// Token expiry for booking management links (30 days)
const TOKEN_EXPIRY_DAYS = 30;

interface EmailResult {
  sent: boolean;
  error?: string;
}

/**
 * Generate a signed token for booking management URLs
 */
function generateBookingToken(bookingId: string, email: string): string {
  return jwt.sign(
    { bookingId, email },
    BOOKING_TOKEN_SECRET,
    { expiresIn: `${TOKEN_EXPIRY_DAYS}d` }
  );
}

/**
 * Verify and decode a booking management token
 */
export function verifyBookingToken(token: string): { bookingId: string; email: string } | null {
  try {
    const decoded = jwt.verify(token, BOOKING_TOKEN_SECRET) as { bookingId: string; email: string };
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
 * Fetch business profile language
 * Used for client-facing emails (booking confirmations, intake requests, etc.)
 */
async function getBusinessLocale(userId: string): Promise<Locale> {
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
async function logEmailSend(params: {
  userId: string;
  contactId: string | null;
  toEmail: string;
  subject: string;
  bodyHtml: string;
  result: SendEmailResult;
}): Promise<void> {
  const { userId, contactId, toEmail, subject, bodyHtml, result } = params;

  // Skip logging if no contact_id (can't associate with a contact)
  if (!contactId) {
    logger.debug({ toEmail, subject }, 'Skipping email log - no contact_id');
    return;
  }

  try {
    // Map provider to the expected type (resend or sendgrid)
    // 'gmail' and 'gmail-plugin' are not in the enum so we default to 'resend'
    const provider = result.provider === 'resend' ? 'resend' : 'resend';

    await emailSendRepository.create({
      user_id: userId,
      contact_id: contactId,
      to_email: toEmail,
      subject,
      body_html: bodyHtml,
      status: result.sent ? 'sent' : 'failed',
      sent_at: result.sent ? new Date().toISOString() : null,
      provider,
      provider_message_id: null,
      error_message: result.error || null,
      sequence_id: null,
      sequence_step_id: null,
      campaign_id: null,
      open_count: 0,
      click_count: 0,
      delivered_at: null,
      opened_at: null,
      clicked_at: null
    });

    logger.debug({ contactId, subject, sent: result.sent }, 'Email logged to email_sends');
  } catch (err) {
    // Non-blocking - just log the error
    logger.warn({ err, contactId, subject }, 'Failed to log email to email_sends (non-blocking)');
  }
}

export class BookingEmailService {
  /**
   * Send booking confirmation email with calendar invite
   * Called from: booking API, chat commands
   */
  static async sendBookingConfirmation(
    bookingId: string,
    userId: string,
    options?: { skipInvoice?: boolean; invoiceId?: string; stripeHostedInvoiceUrl?: string }
  ): Promise<EmailResult> {
    const requestLogger = logger.child({ bookingId, userId, action: 'sendBookingConfirmation' });

    try {
      // Fetch user's preferred language from profile
      const locale = await getUserLocale(userId);

      // Fetch booking
      const bookingResult = await schedulingBookingRepository.findById(bookingId, userId);
      if (bookingResult.error || !bookingResult.data) {
        requestLogger.error({ err: bookingResult.error }, 'Booking not found');
        return { sent: false, error: 'Booking not found' };
      }
      const booking = bookingResult.data;

      // Validate client email exists
      if (!booking.client_email) {
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
      const token = generateBookingToken(bookingId, booking.client_email);
      const rescheduleUrl = `${APP_URL}/book/manage/${token}/reschedule`;
      const cancelUrl = `${APP_URL}/book/manage/${token}/cancel`;

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
        paymentUrl = options?.stripeHostedInvoiceUrl || `${APP_URL}/invoice/${options?.invoiceId}`;
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

      const emailData = {
        clientName,
        clientEmail: booking.client_email,
        serviceName: service.service_name,
        dateTime: startTime,
        endTime,
        duration: durationMinutes,
        timezone: booking.timezone,
        location: undefined, // TODO: add location support
        price: service.price || undefined,
        currency: service.currency,
        paymentStatus: booking.payment_status as 'pending' | 'paid' | 'refunded' | undefined,
        paymentUrl,
        rescheduleUrl,
        cancelUrl,
        bookingId,
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

      // Generate email content
      const { subject, html, icsContent } = generateBookingConfirmationEmail(emailData);

      // Note: ICS data is included inline in the email HTML via generateBookingConfirmationEmail
      // TODO: Attach ICS file to email for better calendar integration

      // Send email
      const result = await sendEmail({
        to: [booking.client_email],
        subject,
        html,
        ownerUserId: userId
      });

      if (result.sent) {
        requestLogger.info({ provider: result.provider, clientEmail: booking.client_email }, 'Booking confirmation sent');
      } else {
        requestLogger.warn({ error: result.error }, 'Failed to send booking confirmation');
      }

      // Log email to email_sends table (non-blocking)
      logEmailSend({
        userId,
        contactId: booking.contact_id,
        toEmail: booking.client_email,
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
          title: `Booking Confirmation Sent: ${service.service_name}`,
          description: `Confirmation email sent for booking on ${startTime.toLocaleDateString()}`,
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
      const locale = await getUserLocale(userId);

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
          appointmentDate = new Date(booking.start_time);
          timezone = booking.timezone;
          contactId = booking.contact_id;

          // Generate manage URL
          const token = generateBookingToken(paymentData.bookingId, paymentData.customerEmail);
          bookingManageUrl = `${APP_URL}/book/manage/${token}`;

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
        branding,
        locale
      });

      // Send email
      const result = await sendEmail({
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
      logEmailSend({
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
          title: `Payment Received: ${paymentData.currency} ${paymentData.amount}`,
          description: serviceName ? `Payment for ${serviceName}` : `Receipt: ${receiptNumber}`,
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
    reason?: string
  ): Promise<EmailResult> {
    const requestLogger = logger.child({ bookingId, userId, action: 'sendCancellationEmail' });

    try {
      // Fetch user's preferred language from profile
      const locale = await getUserLocale(userId);

      // Fetch booking
      const bookingResult = await schedulingBookingRepository.findById(bookingId, userId);
      if (bookingResult.error || !bookingResult.data) {
        requestLogger.error({ err: bookingResult.error }, 'Booking not found');
        return { sent: false, error: 'Booking not found' };
      }
      const booking = bookingResult.data;

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

      // Get booking URL from website subdomain
      let bookAgainUrl: string | undefined;
      const { data: websitePage } = await supabaseServer
        .from('website_pages')
        .select('subdomain')
        .eq('user_id', userId)
        .eq('status', 'published')
        .single();

      if (websitePage?.subdomain) {
        bookAgainUrl = `${APP_URL}/site/${websitePage.subdomain}/book`;
      } else if (profileResult.data?.website_url) {
        bookAgainUrl = profileResult.data.website_url;
      }

      // Parse booking datetime
      const startTime = new Date(booking.start_time);

      // Build client name
      const clientName = [booking.client_first_name, booking.client_last_name].filter(Boolean).join(' ');

      // Generate email
      const { subject, html } = generateBookingCancellationEmail({
        clientName,
        serviceName: service.service_name,
        dateTime: startTime,
        timezone: booking.timezone,
        reason: reason || booking.cancellation_reason || undefined,
        bookAgainUrl,
        branding,
        locale
      });

      // Send email
      const result = await sendEmail({
        to: [booking.client_email],
        subject,
        html,
        ownerUserId: userId
      });

      if (result.sent) {
        requestLogger.info({ provider: result.provider }, 'Cancellation email sent');
      } else {
        requestLogger.warn({ error: result.error }, 'Failed to send cancellation email');
      }

      // Log email to email_sends table (non-blocking)
      logEmailSend({
        userId,
        contactId: booking.contact_id,
        toEmail: booking.client_email,
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
      const locale = await getUserLocale(userId);

      // Fetch booking (with new time)
      const bookingResult = await schedulingBookingRepository.findById(bookingId, userId);
      if (bookingResult.error || !bookingResult.data) {
        requestLogger.error({ err: bookingResult.error }, 'Booking not found');
        return { sent: false, error: 'Booking not found' };
      }
      const booking = bookingResult.data;

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
      const token = generateBookingToken(bookingId, booking.client_email);
      const rescheduleUrl = `${APP_URL}/book/manage/${token}/reschedule`;
      const cancelUrl = `${APP_URL}/book/manage/${token}/cancel`;

      // Parse booking datetime
      const newDateTime = new Date(booking.start_time);
      const endTime = new Date(booking.end_time);
      const durationMinutes = Math.round((endTime.getTime() - newDateTime.getTime()) / 60000);

      // Build client name
      const clientName = [booking.client_first_name, booking.client_last_name].filter(Boolean).join(' ');

      // Generate email
      const { subject, html } = generateBookingRescheduledEmail({
        clientName,
        clientEmail: booking.client_email,
        serviceName: service.service_name,
        oldDateTime: previousDateTime,
        newDateTime,
        newEndTime: endTime,
        duration: durationMinutes,
        timezone: booking.timezone,
        rescheduleUrl,
        cancelUrl,
        bookingId,
        branding,
        locale
      });

      // Send email
      const result = await sendEmail({
        to: [booking.client_email],
        subject,
        html,
        ownerUserId: userId
      });

      if (result.sent) {
        requestLogger.info({ provider: result.provider }, 'Rescheduled email sent');
      } else {
        requestLogger.warn({ error: result.error }, 'Failed to send rescheduled email');
      }

      // Log email to email_sends table (non-blocking)
      logEmailSend({
        userId,
        contactId: booking.contact_id,
        toEmail: booking.client_email,
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
      const locale = await getUserLocale(userId);

      // Fetch business profile for branding
      const profileResult = await businessProfileRepository.findByUserId(userId);
      const branding = await resolveEmailBranding(userId, locale, profileResult.data);

      // Get website URL for booking link
      const websiteUrl = profileResult.data?.website_url || undefined;

      // Build booking URL if website has booking enabled
      let bookingUrl: string | undefined;
      if (websiteUrl) {
        // Check if website has booking capability
        const { data: websitePage } = await supabaseServer
          .from('website_pages')
          .select('subdomain')
          .eq('user_id', userId)
          .single();

        if (websitePage?.subdomain) {
          bookingUrl = `${APP_URL}/site/${websitePage.subdomain}/book`;
        }
      }

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

      // Log email to email_sends table (non-blocking)
      logEmailSend({
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
      const locale = await getUserLocale(userId);

      // Fetch business profile for branding
      const profileResult = await businessProfileRepository.findByUserId(userId);
      const branding = await resolveEmailBranding(userId, locale, profileResult.data);

      // Get website URL for booking link
      const websiteUrl = profileResult.data?.website_url || undefined;

      // Build booking URL if website has booking enabled
      let bookingUrl: string | undefined;
      if (websiteUrl) {
        // Check if website has booking capability
        const { data: websitePage } = await supabaseServer
          .from('website_pages')
          .select('subdomain')
          .eq('user_id', userId)
          .single();

        if (websitePage?.subdomain) {
          bookingUrl = `${APP_URL}/site/${websitePage.subdomain}/book`;
        }
      }

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
      logEmailSend({
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
   * Send intake form request after booking confirmation
   * Called from: /api/website/booking/create, /api/scheduling/bookings
   */
  static async sendIntakeFormRequest(
    bookingId: string,
    userId: string
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

      // Check if intake form is enabled for this business
      // This is stored in business_profile or website configuration
      // For now, we'll check if there's an intake form block on the website
      const { data: websitePage } = await supabaseServer
        .from('website_pages')
        .select('id, subdomain')
        .eq('user_id', userId)
        .single();

      if (!websitePage) {
        requestLogger.info('No website found, skipping intake form request');
        return { sent: false, error: 'No website configured' };
      }

      // Generate booking management token and URLs
      const token = generateBookingToken(bookingId, booking.client_email);
      const intakeFormUrl = `${APP_URL}/book/manage/${token}/intake`;
      const rescheduleUrl = `${APP_URL}/book/manage/${token}/reschedule`;
      const cancelUrl = `${APP_URL}/book/manage/${token}/cancel`;

      // Parse booking datetime
      const startTime = new Date(booking.start_time);
      const endTime = new Date(booking.end_time);
      const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

      // Build client name
      const clientName = [booking.client_first_name, booking.client_last_name].filter(Boolean).join(' ');

      // Generate email
      const { subject, html } = generateIntakeRequestEmail({
        clientName,
        clientEmail: booking.client_email,
        serviceName: service.service_name,
        dateTime: startTime,
        duration: durationMinutes,
        timezone: booking.timezone,
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
        to: [booking.client_email],
        subject,
        html,
        ownerUserId: userId
      });

      if (result.sent) {
        requestLogger.info({ provider: result.provider }, 'Intake form request sent');
      } else {
        requestLogger.warn({ error: result.error }, 'Failed to send intake form request');
      }

      // Log email to email_sends table (non-blocking)
      logEmailSend({
        userId,
        contactId: booking.contact_id,
        toEmail: booking.client_email,
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
          title: `Intake Form Sent: ${service.service_name}`,
          description: `Intake form request sent for booking on ${startTime.toLocaleDateString()}`,
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
      const locale = await getUserLocale(userId);

      // Fetch booking
      const bookingResult = await schedulingBookingRepository.findById(bookingId, userId);
      if (bookingResult.error || !bookingResult.data) {
        requestLogger.error({ err: bookingResult.error }, 'Booking not found');
        return { sent: false, error: 'Booking not found' };
      }
      const booking = bookingResult.data;

      // Fetch service
      const serviceResult = await schedulingServiceRepository.findById(booking.service_id, userId);
      const service = serviceResult.data;

      // Fetch business profile for branding
      const profileResult = await businessProfileRepository.findByUserId(userId);
      const branding = await resolveEmailBranding(userId, locale, profileResult.data);

      // Get booking URL from website subdomain
      let bookAgainUrl: string | undefined;
      const { data: websitePage } = await supabaseServer
        .from('website_pages')
        .select('subdomain')
        .eq('user_id', userId)
        .eq('status', 'published')
        .single();

      if (websitePage?.subdomain) {
        bookAgainUrl = `${APP_URL}/site/${websitePage.subdomain}/book`;
      } else if (profileResult.data?.website_url) {
        bookAgainUrl = profileResult.data.website_url;
      }

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
        serviceName: service?.service_name,
        reason: refundData.reason,
        isManualRefund: refundData.isManualRefund,
        bookAgainUrl,
        branding,
        locale
      });

      // Send email
      const result = await sendEmail({
        to: [booking.client_email],
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
      logEmailSend({
        userId,
        contactId: booking.contact_id,
        toEmail: booking.client_email,
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
