// lib/email/templates/booking-confirmation.ts
// Booking confirmation email template with calendar invite generation

import type { Locale } from '@/lib/i18n/config';
import { mix } from '@/lib/branding/color';
import {
  wrapInBrandedTemplate,
  emailButton,
  emailOutlineButton,
  emailDetailRow,
  emailDetailsTable,
  emailNoticeBox,
  emailPalette,
  emailTone,
  formatCurrency,
  formatEmailDate,
  type BrandingData
} from './base-template';
import { emailTranslations } from './translations';

export interface BookingConfirmationData {
  clientName: string;
  clientEmail: string;
  serviceName: string;
  dateTime: Date;
  endTime: Date;
  duration: number;
  timezone: string;
  location?: string;
  price?: number;
  currency?: string;
  /**
   * The booking's payment state, in the booking's own vocabulary.
   *
   * `scheduling_bookings.payment_status` is 'pending' | 'paid' | 'refunded',
   * and this declared 'not_required' instead of 'refunded' — a value nothing in
   * the codebase produces, against a value the table does. So a confirmation
   * re-sent for a refunded booking would not typecheck, for a template that
   * only ever asks whether the status is 'pending'.
   *
   * Only 'pending' shows the payment button; every other state simply does not.
   */
  paymentStatus?: 'pending' | 'paid' | 'refunded' | 'not_required';
  paymentUrl?: string;
  rescheduleUrl: string;
  cancelUrl: string;
  bookingId: string;
  /**
   * Was a time actually booked?
   *
   * Defaults to true, so every existing caller sends the appointment email it
   * always sent. False strips everything that assumes a slot — the date, time
   * and duration rows, the calendar invitation, the whole Manage Booking
   * section — and switches to order wording.
   *
   * The test is the booking's own start time. Nothing else in the data
   * distinguishes a course from a session.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THE MANAGE SECTION GOES ENTIRELY, NOT JUST THE RESCHEDULE BUTTON
   *
   * It used to strip only the reschedule half, so an order for a PRODUCT arrived
   * with a lone Cancel button under a "Need changes?" heading. Both things
   * behind that section are appointment-shaped, and for a product neither
   * worked:
   *
   *   - `cancelUrl` leads to the manage page, which reads `start_time`. That is
   *     null for a product, `new Date(null)` is the Unix epoch, and the client
   *     was shown a 1 January 1970 appointment.
   *   - The page's 24-hours-notice rule then measured against that 1970 date,
   *     found it half a million hours in the past, and refused — telling the
   *     client it was too late to cancel something that has no date at all.
   *
   * An order is cancelled by talking to the business, which is what the closing
   * line of this email already offers. Saying nothing here beats offering a
   * button that leads to a fabricated date and a refusal.
   * ───────────────────────────────────────────────────────────────────────────
   */
  hasSchedule?: boolean;
  branding: BrandingData;
  /** Locale for email content (defaults to 'en') */
  locale?: Locale;
}

interface CalendarLinks {
  google: string;
  outlook: string;
  ics: string;
}

/**
 * Generate Google Calendar add event URL
 */
function generateGoogleCalendarUrl(data: BookingConfirmationData): string {
  const start = formatDateForCalendar(data.dateTime);
  const end = formatDateForCalendar(data.endTime);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: data.serviceName,
    dates: `${start}/${end}`,
    details: `Appointment with ${data.branding.businessName}`,
    location: data.location || '',
    ctz: data.timezone
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Generate Outlook Calendar add event URL
 */
function generateOutlookCalendarUrl(data: BookingConfirmationData): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: data.serviceName,
    startdt: data.dateTime.toISOString(),
    enddt: data.endTime.toISOString(),
    body: `Appointment with ${data.branding.businessName}`,
    location: data.location || ''
  });

  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/**
 * Format date for calendar URL (YYYYMMDDTHHMMSSZ)
 */
function formatDateForCalendar(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Options that decide whether a calendar believes this invite.
 */
export interface ICSOptions {
  /**
   * The address the email is actually sent FROM.
   *
   * An invite whose ORGANIZER is a different address than the sender is
   * treated as spoofed by Gmail and Outlook, and any RSVP goes to whatever
   * address is named here. This used to be hardcoded to a platform mailbox
   * nobody reads, while the mail itself goes out under each owner's own
   * resolved sender.
   */
  organizerEmail?: string;
  /**
   * Which revision of this appointment the invite describes.
   *
   * A calendar keyed on UID ignores an update whose SEQUENCE has not risen —
   * so a reschedule sent as SEQUENCE 0, as every one of them was, left the
   * OLD time sitting in the client's calendar while the email announced the
   * new one. Derive it from the booking's `updated_at`, which only moves
   * forward. See `icsSequenceFor`.
   */
  sequence?: number;
  /**
   * `REQUEST` books or updates; `CANCEL` withdraws.
   *
   * Without the cancel form, an appointment the client cancelled stays in
   * their calendar for ever — which is a problem the moment we start
   * attaching invites at all.
   */
  method?: 'REQUEST' | 'CANCEL';
}

/**
 * A SEQUENCE number from the booking's last-modified time.
 *
 * Must be a non-negative 32-bit integer that never decreases for a given UID.
 * Counted in seconds from 2020 rather than from the Unix epoch, which keeps it
 * far inside the signed-32-bit ceiling instead of a few years short of it.
 */
export function icsSequenceFor(updatedAt: string | Date | null | undefined): number {
  const EPOCH_2020 = Date.UTC(2020, 0, 1);
  const t = updatedAt ? new Date(updatedAt).getTime() : NaN;
  if (Number.isNaN(t) || t <= EPOCH_2020) return 0;
  return Math.floor((t - EPOCH_2020) / 1000);
}

/**
 * Generate .ics file content for calendar invite
 *
 * DTSTART/DTEND are emitted as UTC instants (`...Z`), which is what lets the
 * client's own calendar show the appointment on the client's own clock —
 * including after they travel — without us ever guessing their timezone.
 */
export function generateICSContent(data: BookingConfirmationData, options: ICSOptions = {}): string {
  const { organizerEmail, sequence = 0, method = 'REQUEST' } = options;
  const isCancel = method === 'CANCEL';
  const start = formatDateForCalendar(data.dateTime);
  const end = formatDateForCalendar(data.endTime);
  const now = formatDateForCalendar(new Date());
  const uid = `booking-${data.bookingId}@${data.branding.businessName.toLowerCase().replace(/\s+/g, '')}`;

  // Escape special characters for iCalendar
  const escape = (str: string) => str.replace(/[,;\\]/g, '\\$&').replace(/\n/g, '\\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NeuronForge//Booking//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escape(data.serviceName)}`,
    `DESCRIPTION:${escape(`Appointment with ${data.branding.businessName}`)}`,
    data.location ? `LOCATION:${escape(data.location)}` : '',
    organizerEmail
      ? `ORGANIZER;CN=${escape(data.branding.businessName)}:mailto:${organizerEmail}`
      : '',
    `ATTENDEE;CN=${escape(data.clientName)};RSVP=TRUE:mailto:${data.clientEmail}`,
    isCancel ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
    `SEQUENCE:${sequence}`,
    // No alarm on a withdrawal — it would ring for an appointment that is off.
    ...(isCancel
      ? []
      : [
          'BEGIN:VALARM',
          'TRIGGER:-PT1H',
          'ACTION:DISPLAY',
          `DESCRIPTION:Reminder: ${escape(data.serviceName)} in 1 hour`,
          'END:VALARM',
        ]),
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean);

  return lines.join('\r\n');
}

/**
 * Generate calendar links for the booking
 */
export function generateCalendarLinks(data: BookingConfirmationData): CalendarLinks {
  return {
    google: generateGoogleCalendarUrl(data),
    outlook: generateOutlookCalendarUrl(data),
    ics: '' // Will be handled as attachment
  };
}

/**
 * Generate booking confirmation email
 */
export function generateBookingConfirmationEmail(
  data: BookingConfirmationData,
  icsOptions: ICSOptions = {}
): {
  subject: string;
  html: string;
  icsContent: string;
} {
  const locale = data.locale || 'en';
  const calendarLinks = generateCalendarLinks(data);
  const formattedDate = formatEmailDate(data.dateTime, data.timezone, { locale });
  const hasPendingPayment = data.paymentStatus === 'pending' && data.price && data.price > 0;
  const t = emailTranslations.bookingConfirmation;
  const tIntake = emailTranslations.intake;

  // Set locale on branding for RTL support
  const brandingWithLocale = { ...data.branding, locale };
  // Ink and panels against THIS business's card, not against a white one.
  const c = emailPalette(brandingWithLocale);
  // Google's and Microsoft's own blues, lifted where the card is dark — the
  // hue is the point of these two buttons, the exact shade is not.
  const vendor = (hex: string) => (c.dark ? mix(hex, '#ffffff', 0.35) : hex);

  // Split date and time (handle different locale formats)
  const dateParts = formattedDate.split(locale === 'he' ? ' בשעה ' : ' at ');
  const dateStr = dateParts[0] || formattedDate;
  const timeStr = dateParts[1] || '';

  // Build the email content
  const content = `
    <!-- Greeting -->
    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: ${c.ink};">
      ${data.hasSchedule === false ? t.unscheduledGreeting[locale] : t.greeting[locale]}
    </h2>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${c.inkMuted};">
      ${data.hasSchedule === false
        ? t.unscheduledIntro[locale](data.clientName, data.branding.businessName)
        : t.intro[locale](data.clientName, data.branding.businessName)}
    </p>

    <!-- Appointment Details Card -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px; background-color: ${c.mutedSurface}; border-radius: ${c.radius}; border: 1px solid ${c.line};">
      <tr>
        <td style="padding: 24px;">
          <h3 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: ${data.branding.primaryColor};">
            ${data.serviceName}
          </h3>

          ${emailDetailsTable([
            // Date, time and duration exist only because something was
            // scheduled. On a product they described the moment of purchase as
            // if it were an appointment, with a duration in minutes.
            data.hasSchedule === false ? '' : emailDetailRow(tIntake.dateLabel[locale], dateStr, brandingWithLocale),
            data.hasSchedule !== false && timeStr ? emailDetailRow(tIntake.timeLabel[locale], timeStr, brandingWithLocale) : '',
            data.hasSchedule === false ? '' : emailDetailRow(tIntake.durationLabel[locale], `${data.duration} ${tIntake.minutes[locale]}`, brandingWithLocale),
            data.location ? emailDetailRow(tIntake.locationLabel[locale], data.location, brandingWithLocale) : '',
            data.price && data.price > 0 ? emailDetailRow(t.priceLabel[locale], formatCurrency(data.price, data.currency || 'USD'), brandingWithLocale) : ''
          ].filter(Boolean), brandingWithLocale)}
        </td>
      </tr>
    </table>

    ${hasPendingPayment ? `
    <!-- Payment Pending Notice -->
    ${emailNoticeBox((data.hasSchedule === false ? t.unscheduledPaymentRequired : t.paymentRequired)[locale](formatCurrency(data.price!, data.currency || 'USD')), 'warning', brandingWithLocale)}
    ${data.paymentUrl ? emailButton(t.payNow[locale], data.paymentUrl, { branding: data.branding }) : ''}
    ` : ''}

    ${data.hasSchedule === false ? '' : `
    <!-- Add to Calendar. Omitted with no schedule: there is no time to add,
         and the links would create an event at the moment of purchase. -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0;">
      <tr>
        <td>
          <p style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: ${c.ink};">
            ${t.addToCalendar[locale]}
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding-${locale === 'he' ? 'left' : 'right'}: 8px;">
                <a href="${calendarLinks.google}" target="_blank" style="display: inline-block; padding: 10px 16px; font-size: 13px; font-weight: 500; color: ${vendor('#4285F4')}; text-decoration: none; border: 1px solid ${vendor('#4285F4')}; border-radius: 6px;">
                  ${t.googleCalendar[locale]}
                </a>
              </td>
              <td>
                <a href="${calendarLinks.outlook}" target="_blank" style="display: inline-block; padding: 10px 16px; font-size: 13px; font-weight: 500; color: ${vendor('#0078D4')}; text-decoration: none; border: 1px solid ${vendor('#0078D4')}; border-radius: 6px;">
                  ${t.outlookCalendar[locale]}
                </a>
              </td>
            </tr>
          </table>
          <p style="margin: 12px 0 0; font-size: 12px; color: ${c.inkFaint};">
            ${t.icsNote[locale]}
          </p>
        </td>
      </tr>
    </table>
    `}

    <!-- Manage Booking. Omitted with no schedule: see hasSchedule. -->
    ${data.hasSchedule === false ? '' : `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0; padding-top: 24px; border-top: 1px solid ${c.line};">
      <tr>
        <td>
          <p style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: ${c.ink};">
            ${t.needChanges[locale]}
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding-${locale === 'he' ? 'left' : 'right'}: 8px;">
                ${emailOutlineButton(tIntake.reschedule[locale], data.rescheduleUrl, { branding: data.branding })}
              </td>
              <td>
                ${emailOutlineButton(tIntake.cancel[locale], data.cancelUrl, { color: emailTone('danger', brandingWithLocale).text })}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    `}

    <!-- Final Note -->
    <p style="margin: 24px 0 0; font-size: 13px; color: ${c.inkFaint}; line-height: 1.5;">
      ${t.questions[locale](data.branding.businessName)}
    </p>
  `;

  return {
    subject: (data.hasSchedule === false ? t.unscheduledSubject : t.subject)[locale](data.serviceName),
    html: wrapInBrandedTemplate(content, brandingWithLocale),
    icsContent: generateICSContent(data, icsOptions)
  };
}

/**
 * Generate booking cancellation email
 */
export function generateBookingCancellationEmail(data: {
  clientName: string;
  serviceName: string;
  dateTime: Date;
  timezone: string;
  reason?: string;
  bookAgainUrl?: string;
  /**
   * What the client paid, or agreed to pay.
   *
   * The confirmation email carries this and the cancellation did not, so the one
   * message a client is most likely to check a figure against was the one with no
   * figure on it. On a cancelled ORDER it is the only concrete detail there is:
   * with no date, no time and often no reason, the panel had nothing in it at all.
   */
  price?: number;
  currency?: string;
  /** Where it would have been. Carried for the same reason: the confirmation has it. */
  location?: string;
  /**
   * Money the business is still holding for this booking.
   *
   * Cancelling deliberately does not refund anything - see `cancelBooking`,
   * which reports the figure and leaves the decision to a person. That is the
   * right call, and it left a hole here: the client got a cancellation for a
   * booking they had paid for, with no mention of the payment.
   */
  amountHeld?: number;
  heldCurrency?: string | null;
  /**
   * What was actually collected, before any refund.
   *
   * With `refundedAmount` below this is what lets the email say which of four
   * things happened — nothing paid, paid and held, refunded in full, refunded in
   * part — instead of printing a price and leaving the reader to guess. A price
   * answers neither "am I owed money" nor "do I still owe any".
   */
  paidAmount?: number;
  /** How much of it has gone back. */
  refundedAmount?: number;
  /** The service this was, so "book again" can point at it rather than a list. */
  serviceId?: string | null;
  /**
   * Was a time booked? Defaults to true, so existing callers are unchanged.
   *
   * False switches to order wording and drops the date and time rows, which
   * otherwise printed the moment of purchase as though an appointment had been
   * struck from the calendar.
   */
  hasSchedule?: boolean;
  branding: BrandingData;
  locale?: Locale;
}): {
  subject: string;
  html: string;
} {
  const locale = data.locale || 'en';
  const formattedDate = formatEmailDate(data.dateTime, data.timezone, { locale });
  const t = emailTranslations.bookingCancellation;
  const tIntake = emailTranslations.intake;

  // Set locale on branding for RTL support
  const brandingWithLocale = { ...data.branding, locale };
  // Ink and panels against THIS business's card, not against a white one.
  const c = emailPalette(brandingWithLocale);
  // The appointment that is no longer happening.
  const cancelled = emailTone('danger', brandingWithLocale);

  /*
   * What happened to the money, in the one place that answers it.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * FOUR STATES, NOT A PRICE.
   *
   * The email showed "Price EUR 100" and stopped there. A client who had paid
   * could not tell whether a refund was coming; one who had not could not tell
   * whether they still owed it. Both are the question somebody opens a
   * cancellation to answer, and a price answers neither.
   *
   * Rendered BEFORE the invitation to book again, deliberately: nobody wants to
   * be asked to buy the thing again while the money for the last one is
   * unaccounted for.
   *
   * Nothing here promises a refund that has not happened. Cancelling does not
   * refund, because that is the owner's decision with their policy behind it, so
   * the held cases report the figure and name who will settle it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const money = (amount: number) =>
    formatCurrency(amount, data.heldCurrency || data.currency || 'USD');

  /*
   * Straight back to the thing that was cancelled.
   *
   * `resolveBookingUrl` returns the business's booking page, which lists
   * everything they sell. For somebody whose course was just cancelled that is a
   * haystack: they have to recognise it among the rest. Both booking surfaces
   * already accept `?service=` and pre-select it, so the only thing missing was
   * putting it on the link.
   *
   * Appended defensively rather than with a template: the resolved URL may
   * already carry a query string, and a second `?` silently breaks the whole
   * parameter list.
   */
  const bookAgainHref = (() => {
    if (!data.bookAgainUrl || !data.serviceId) return data.bookAgainUrl;
    const joiner = data.bookAgainUrl.includes('?') ? '&' : '?';
    return `${data.bookAgainUrl}${joiner}service=${encodeURIComponent(data.serviceId)}`;
  })();

  const paid = data.paidAmount ?? 0;
  const refunded = data.refundedAmount ?? 0;
  const held = data.amountHeld ?? 0;

  const moneyNotice =
    paid <= 0 && held <= 0 && refunded <= 0
      ? // Never collected. Worth saying: on a cancelled order carrying a price,
        // silence reads as a bill still owed.
        emailNoticeBox(t.notPaid[locale], 'info', brandingWithLocale)
      : refunded > 0 && held <= 0
        ? emailNoticeBox(t.refundedInFull[locale](money(refunded)), 'success', brandingWithLocale)
        : refunded > 0 && held > 0
          ? emailNoticeBox(
              t.refundedPartly[locale](money(refunded), money(held), data.branding.businessName),
              'warning',
              brandingWithLocale
            )
          : held > 0
            ? emailNoticeBox(
                t.heldNotice[locale](money(held), data.branding.businessName),
                'warning',
                brandingWithLocale
              )
            : '';

  // Split date and time
  const dateParts = formattedDate.split(locale === 'he' ? ' בשעה ' : ' at ');
  const dateStr = dateParts[0] || formattedDate;
  const timeStr = dateParts[1] || '';

  const content = `
    <!-- Greeting -->
    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: ${c.ink};">
      ${data.hasSchedule === false ? t.unscheduledGreeting[locale] : t.greeting[locale]}
    </h2>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${c.inkMuted};">
      ${(data.hasSchedule === false ? t.unscheduledIntro : t.intro)[locale](data.clientName)}
    </p>

    <!-- What was cancelled -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px; background-color: ${cancelled.bg}; border-radius: ${c.radius}; border: 1px solid ${cancelled.border};">
      <tr>
        <td style="padding: 24px;">
          <h3 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: ${cancelled.text}; text-decoration: line-through;">
            ${data.serviceName}
          </h3>

          ${emailDetailsTable([
            // No date or time when none was booked: they would describe the
            // moment of purchase as an appointment that had been struck out.
            data.hasSchedule === false ? '' : emailDetailRow(tIntake.dateLabel[locale], dateStr, brandingWithLocale),
            data.hasSchedule !== false && timeStr ? emailDetailRow(tIntake.timeLabel[locale], timeStr, brandingWithLocale) : '',
            data.location ? emailDetailRow(tIntake.locationLabel[locale], data.location, brandingWithLocale) : '',
            /*
             * The price, as the confirmation shows it.
             *
             * Deliberately the same label and the same formatter, because it is
             * the same number: a client comparing the cancellation against the
             * confirmation that preceded it should not have to work out whether
             * two differently-worded figures mean the same thing.
             *
             * It carries the most weight on an ORDER, which has no date and no
             * time to show and often no reason either.
             */
            data.price && data.price > 0
              ? emailDetailRow(
                  emailTranslations.bookingConfirmation.priceLabel[locale],
                  formatCurrency(data.price, data.currency || 'USD'),
                  brandingWithLocale
                )
              : '',
            data.reason ? emailDetailRow(t.reasonLabel[locale], data.reason, brandingWithLocale) : ''
          ].filter(Boolean), brandingWithLocale)}
        </td>
      </tr>
    </table>

    ${moneyNotice}

    ${data.bookAgainUrl ? `
    <!--
      Book again, in the language of what was actually cancelled.

      A COURSE is not an appointment. "Would you like to book a new appointment?"
      over a cancelled course asked about a meeting that never existed, and the
      button said "find another time" when there was no time to find.

      The prompt also NAMES the thing now. "Book a new appointment" invited the
      client back to a list of everything on offer and left them to find what
      they had lost; the link carries the service id, so the page opens on it.
    -->
    <p style="margin: 0 0 16px; font-size: 14px; color: ${c.inkMuted};">
      ${
        data.hasSchedule === false
          ? t.unscheduledBookAgainPrompt[locale](data.serviceName)
          : t.bookAgainPromptNamed[locale](data.serviceName)
      }
    </p>
    ${emailButton(
      data.hasSchedule === false ? t.unscheduledBookAgain[locale] : t.bookAgain[locale],
      bookAgainHref,
      { branding: data.branding }
    )}
    ` : ''}

    <!-- Final Note -->
    <p style="margin: 24px 0 0; font-size: 13px; color: ${c.inkFaint}; line-height: 1.5;">
      ${t.questions[locale](data.branding.businessName)}
    </p>
  `;

  return {
    subject: (data.hasSchedule === false ? t.unscheduledSubject : t.subject)[locale](data.serviceName),
    html: wrapInBrandedTemplate(content, brandingWithLocale)
  };
}

/**
 * The appointment a client did not attend, and an open door back.
 *
 * Modelled on the cancellation email, with two deliberate differences: the
 * appointment is NOT struck through — nothing was called off, they simply were
 * not there — and it carries no reason row, because the business does not know
 * the reason and guessing at it in writing is the failure this template exists
 * to avoid. See `missedAppointment` in the translations for the tone rules.
 */
export function generateMissedAppointmentEmail(data: {
  clientName: string;
  serviceName: string;
  dateTime: Date;
  timezone: string;
  bookAgainUrl?: string;
  branding: BrandingData;
  locale?: Locale;
}): {
  subject: string;
  html: string;
} {
  const locale = data.locale || 'en';
  const formattedDate = formatEmailDate(data.dateTime, data.timezone, { locale });
  const t = emailTranslations.missedAppointment;
  const tIntake = emailTranslations.intake;

  const brandingWithLocale = { ...data.branding, locale };
  const c = emailPalette(brandingWithLocale);
  /*
   * `info`, not `danger`. The cancellation email uses the alarm palette because
   * something was called off; nothing was, here. Red would say "you did
   * something wrong" in colour, which is exactly what the wording avoids.
   */
  const missed = emailTone('info', brandingWithLocale);

  const dateParts = formattedDate.split(locale === 'he' ? ' בשעה ' : ' at ');
  const dateStr = dateParts[0] || formattedDate;
  const timeStr = dateParts[1] || '';

  const content = `
    <!-- Greeting -->
    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: ${c.ink};">
      ${t.greeting[locale]}
    </h2>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${c.inkMuted};">
      ${t.intro[locale](data.clientName)}
    </p>

    <!-- The appointment. Not struck through: it was not cancelled. -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px; background-color: ${missed.bg}; border-radius: ${c.radius}; border: 1px solid ${missed.border};">
      <tr>
        <td style="padding: 24px;">
          <h3 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: ${missed.text};">
            ${data.serviceName}
          </h3>

          ${emailDetailsTable([
            emailDetailRow(tIntake.dateLabel[locale], dateStr, brandingWithLocale),
            timeStr ? emailDetailRow(tIntake.timeLabel[locale], timeStr, brandingWithLocale) : ''
          ].filter(Boolean), brandingWithLocale)}
        </td>
      </tr>
    </table>

    ${data.bookAgainUrl ? `
    <!-- A way back in -->
    <p style="margin: 0 0 16px; font-size: 14px; color: ${c.inkMuted};">
      ${t.bookAgainPrompt[locale]}
    </p>
    ${emailButton(t.bookAgain[locale], data.bookAgainUrl, { branding: data.branding })}
    ` : ''}

    <!-- An explicit way to say "this was wrong", because it may have been. -->
    <p style="margin: 24px 0 0; font-size: 13px; color: ${c.inkFaint}; line-height: 1.5;">
      ${t.questions[locale](data.branding.businessName)}
    </p>
  `;

  return {
    subject: t.subject[locale](data.serviceName),
    html: wrapInBrandedTemplate(content, brandingWithLocale)
  };
}

/**
 * Generate booking rescheduled email
 */
export function generateBookingRescheduledEmail(data: {
  clientName: string;
  clientEmail: string;
  serviceName: string;
  oldDateTime: Date;
  newDateTime: Date;
  newEndTime: Date;
  duration: number;
  timezone: string;
  location?: string;
  rescheduleUrl: string;
  cancelUrl: string;
  bookingId: string;
  branding: BrandingData;
  locale?: Locale;
}, icsOptions: ICSOptions = {}): {
  subject: string;
  html: string;
  icsContent: string;
} {
  const locale = data.locale || 'en';
  const oldFormattedDate = formatEmailDate(data.oldDateTime, data.timezone, { locale });
  const newFormattedDate = formatEmailDate(data.newDateTime, data.timezone, { locale });
  const t = emailTranslations.bookingRescheduled;
  const tIntake = emailTranslations.intake;
  const tConfirm = emailTranslations.bookingConfirmation;

  // Set locale on branding for RTL support
  const brandingWithLocale = { ...data.branding, locale };
  // Ink and panels against THIS business's card, not against a white one.
  const c = emailPalette(brandingWithLocale);
  // Google's and Microsoft's own blues, lifted where the card is dark — the
  // hue is the point of these two buttons, the exact shade is not.
  const vendor = (hex: string) => (c.dark ? mix(hex, '#ffffff', 0.35) : hex);
  // The appointment that is no longer happening.
  const cancelled = emailTone('danger', brandingWithLocale);
  // And the one that replaces it.
  const confirmed = emailTone('success', brandingWithLocale);

  // Split date and time
  const newDateParts = newFormattedDate.split(locale === 'he' ? ' בשעה ' : ' at ');
  const newDateStr = newDateParts[0] || newFormattedDate;
  const newTimeStr = newDateParts[1] || '';

  const calendarLinks = generateCalendarLinks({
    ...data,
    dateTime: data.newDateTime,
    endTime: data.newEndTime
  } as BookingConfirmationData);

  const content = `
    <!-- Greeting -->
    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: ${c.ink};">
      ${t.greeting[locale]}
    </h2>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${c.inkMuted};">
      ${t.intro[locale](data.clientName, data.branding.businessName)}
    </p>

    <!-- Previous Time (struck through) -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 16px; background-color: ${cancelled.bg}; border-radius: ${c.buttonRadius}; border: 1px solid ${cancelled.border};">
      <tr>
        <td style="padding: 16px;">
          <p style="margin: 0; font-size: 12px; font-weight: 600; color: ${cancelled.text}; text-transform: uppercase;">
            ${t.previousTime[locale]}
          </p>
          <p style="margin: 8px 0 0; font-size: 15px; color: ${c.inkMuted}; text-decoration: line-through;">
            ${oldFormattedDate}
          </p>
        </td>
      </tr>
    </table>

    <!-- New Appointment Details -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px; background-color: ${confirmed.bg}; border-radius: ${c.radius}; border: 1px solid ${confirmed.border};">
      <tr>
        <td style="padding: 24px;">
          <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; color: ${confirmed.text}; text-transform: uppercase;">
            ${t.newTime[locale]}
          </p>
          <h3 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: ${data.branding.primaryColor};">
            ${data.serviceName}
          </h3>

          ${emailDetailsTable([
            emailDetailRow(tIntake.dateLabel[locale], newDateStr, brandingWithLocale),
            newTimeStr ? emailDetailRow(tIntake.timeLabel[locale], newTimeStr, brandingWithLocale) : '',
            emailDetailRow(tIntake.durationLabel[locale], `${data.duration} ${tIntake.minutes[locale]}`, brandingWithLocale),
            data.location ? emailDetailRow(tIntake.locationLabel[locale], data.location, brandingWithLocale) : ''
          ].filter(Boolean), brandingWithLocale)}
        </td>
      </tr>
    </table>

    <!-- Add to Calendar -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0;">
      <tr>
        <td>
          <p style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: ${c.ink};">
            ${t.updateCalendar[locale]}
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding-${locale === 'he' ? 'left' : 'right'}: 8px;">
                <a href="${calendarLinks.google}" target="_blank" style="display: inline-block; padding: 10px 16px; font-size: 13px; font-weight: 500; color: ${vendor('#4285F4')}; text-decoration: none; border: 1px solid ${vendor('#4285F4')}; border-radius: 6px;">
                  ${tConfirm.googleCalendar[locale]}
                </a>
              </td>
              <td>
                <a href="${calendarLinks.outlook}" target="_blank" style="display: inline-block; padding: 10px 16px; font-size: 13px; font-weight: 500; color: ${vendor('#0078D4')}; text-decoration: none; border: 1px solid ${vendor('#0078D4')}; border-radius: 6px;">
                  ${tConfirm.outlookCalendar[locale]}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Manage Booking Section -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0; padding-top: 24px; border-top: 1px solid ${c.line};">
      <tr>
        <td>
          <p style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: ${c.ink};">
            ${t.needMoreChanges[locale]}
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding-${locale === 'he' ? 'left' : 'right'}: 8px;">
                ${emailOutlineButton(t.rescheduleAgain[locale], data.rescheduleUrl, { branding: data.branding })}
              </td>
              <td>
                ${emailOutlineButton(tIntake.cancel[locale], data.cancelUrl, { color: emailTone('danger', brandingWithLocale).text })}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Final Note -->
    <p style="margin: 24px 0 0; font-size: 13px; color: ${c.inkFaint}; line-height: 1.5;">
      ${tConfirm.questions[locale](data.branding.businessName)}
    </p>
  `;

  return {
    subject: t.subject[locale](data.serviceName),
    html: wrapInBrandedTemplate(content, brandingWithLocale),
    icsContent: generateICSContent({
      ...data,
      dateTime: data.newDateTime,
      endTime: data.newEndTime
    } as BookingConfirmationData, icsOptions)
  };
}
