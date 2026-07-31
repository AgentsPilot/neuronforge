// lib/email/templates/booking-confirmation.ts
// Booking confirmation email template with calendar invite generation

import type { Locale } from '@/lib/i18n/config';
import {
  wrapInBrandedTemplate,
  emailButton,
  emailOutlineButton,
  emailDetailRow,
  emailDetailsTable,
  emailNoticeBox,
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
  paymentStatus?: 'pending' | 'paid' | 'not_required';
  paymentUrl?: string;
  rescheduleUrl: string;
  cancelUrl: string;
  bookingId: string;
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
 * Generate .ics file content for calendar invite
 */
export function generateICSContent(data: BookingConfirmationData): string {
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
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escape(data.serviceName)}`,
    `DESCRIPTION:${escape(`Appointment with ${data.branding.businessName}`)}`,
    data.location ? `LOCATION:${escape(data.location)}` : '',
    `ORGANIZER;CN=${escape(data.branding.businessName)}:mailto:noreply@neuronforge.app`,
    `ATTENDEE;CN=${escape(data.clientName)};RSVP=TRUE:mailto:${data.clientEmail}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:Reminder: ${escape(data.serviceName)} in 1 hour`,
    'END:VALARM',
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
export function generateBookingConfirmationEmail(data: BookingConfirmationData): {
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

  // Split date and time (handle different locale formats)
  const dateParts = formattedDate.split(locale === 'he' ? ' בשעה ' : ' at ');
  const dateStr = dateParts[0] || formattedDate;
  const timeStr = dateParts[1] || '';

  // Build the email content
  const content = `
    <!-- Greeting -->
    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: #1a1a1a;">
      ${t.greeting[locale]}
    </h2>
    <p style="margin: 0 0 24px; font-size: 15px; color: #666666;">
      ${t.intro[locale](data.clientName, data.branding.businessName)}
    </p>

    <!-- Appointment Details Card -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px; background-color: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
      <tr>
        <td style="padding: 24px;">
          <h3 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: ${data.branding.primaryColor};">
            ${data.serviceName}
          </h3>

          ${emailDetailsTable([
            emailDetailRow(tIntake.dateLabel[locale], dateStr),
            timeStr ? emailDetailRow(tIntake.timeLabel[locale], timeStr) : '',
            emailDetailRow(tIntake.durationLabel[locale], `${data.duration} ${tIntake.minutes[locale]}`),
            data.location ? emailDetailRow(tIntake.locationLabel[locale], data.location) : '',
            data.price && data.price > 0 ? emailDetailRow(t.priceLabel[locale], formatCurrency(data.price, data.currency || 'USD')) : ''
          ].filter(Boolean))}
        </td>
      </tr>
    </table>

    ${hasPendingPayment ? `
    <!-- Payment Pending Notice -->
    ${emailNoticeBox(t.paymentRequired[locale](formatCurrency(data.price!, data.currency || 'USD')), 'warning')}
    ${data.paymentUrl ? emailButton(t.payNow[locale], data.paymentUrl, { backgroundColor: data.branding.primaryColor }) : ''}
    ` : ''}

    <!-- Add to Calendar -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0;">
      <tr>
        <td>
          <p style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #1a1a1a;">
            ${t.addToCalendar[locale]}
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding-${locale === 'he' ? 'left' : 'right'}: 8px;">
                <a href="${calendarLinks.google}" target="_blank" style="display: inline-block; padding: 10px 16px; font-size: 13px; font-weight: 500; color: #4285F4; text-decoration: none; border: 1px solid #4285F4; border-radius: 6px;">
                  ${t.googleCalendar[locale]}
                </a>
              </td>
              <td>
                <a href="${calendarLinks.outlook}" target="_blank" style="display: inline-block; padding: 10px 16px; font-size: 13px; font-weight: 500; color: #0078D4; text-decoration: none; border: 1px solid #0078D4; border-radius: 6px;">
                  ${t.outlookCalendar[locale]}
                </a>
              </td>
            </tr>
          </table>
          <p style="margin: 12px 0 0; font-size: 12px; color: #888888;">
            ${t.icsNote[locale]}
          </p>
        </td>
      </tr>
    </table>

    <!-- Manage Booking Section -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0; padding-top: 24px; border-top: 1px solid #e5e5e5;">
      <tr>
        <td>
          <p style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #1a1a1a;">
            ${t.needChanges[locale]}
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding-${locale === 'he' ? 'left' : 'right'}: 8px;">
                ${emailOutlineButton(tIntake.reschedule[locale], data.rescheduleUrl, { color: data.branding.primaryColor })}
              </td>
              <td>
                ${emailOutlineButton(tIntake.cancel[locale], data.cancelUrl, { color: '#DC2626' })}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Final Note -->
    <p style="margin: 24px 0 0; font-size: 13px; color: #888888; line-height: 1.5;">
      ${t.questions[locale](data.branding.businessName)}
    </p>
  `;

  return {
    subject: t.subject[locale](data.serviceName),
    html: wrapInBrandedTemplate(content, brandingWithLocale),
    icsContent: generateICSContent(data)
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

  // Split date and time
  const dateParts = formattedDate.split(locale === 'he' ? ' בשעה ' : ' at ');
  const dateStr = dateParts[0] || formattedDate;
  const timeStr = dateParts[1] || '';

  const content = `
    <!-- Greeting -->
    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: #1a1a1a;">
      ${t.greeting[locale]}
    </h2>
    <p style="margin: 0 0 24px; font-size: 15px; color: #666666;">
      ${t.intro[locale](data.clientName)}
    </p>

    <!-- Cancelled Appointment Details -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px; background-color: #fef2f2; border-radius: 12px; border: 1px solid #fecaca;">
      <tr>
        <td style="padding: 24px;">
          <h3 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: #991b1b; text-decoration: line-through;">
            ${data.serviceName}
          </h3>

          ${emailDetailsTable([
            emailDetailRow(tIntake.dateLabel[locale], dateStr),
            timeStr ? emailDetailRow(tIntake.timeLabel[locale], timeStr) : '',
            data.reason ? emailDetailRow(t.reasonLabel[locale], data.reason) : ''
          ].filter(Boolean))}
        </td>
      </tr>
    </table>

    ${data.bookAgainUrl ? `
    <!-- Book Again -->
    <p style="margin: 0 0 16px; font-size: 14px; color: #666666;">
      ${t.bookAgainPrompt[locale]}
    </p>
    ${emailButton(t.bookAgain[locale], data.bookAgainUrl, { backgroundColor: data.branding.primaryColor })}
    ` : ''}

    <!-- Final Note -->
    <p style="margin: 24px 0 0; font-size: 13px; color: #888888; line-height: 1.5;">
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
}): {
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
    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: #1a1a1a;">
      ${t.greeting[locale]}
    </h2>
    <p style="margin: 0 0 24px; font-size: 15px; color: #666666;">
      ${t.intro[locale](data.clientName, data.branding.businessName)}
    </p>

    <!-- Previous Time (struck through) -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 16px; background-color: #fef2f2; border-radius: 8px; border: 1px solid #fecaca;">
      <tr>
        <td style="padding: 16px;">
          <p style="margin: 0; font-size: 12px; font-weight: 600; color: #991b1b; text-transform: uppercase;">
            ${t.previousTime[locale]}
          </p>
          <p style="margin: 8px 0 0; font-size: 15px; color: #666666; text-decoration: line-through;">
            ${oldFormattedDate}
          </p>
        </td>
      </tr>
    </table>

    <!-- New Appointment Details -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px; background-color: #f0fdf4; border-radius: 12px; border: 1px solid #bbf7d0;">
      <tr>
        <td style="padding: 24px;">
          <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; color: #166534; text-transform: uppercase;">
            ${t.newTime[locale]}
          </p>
          <h3 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: ${data.branding.primaryColor};">
            ${data.serviceName}
          </h3>

          ${emailDetailsTable([
            emailDetailRow(tIntake.dateLabel[locale], newDateStr),
            newTimeStr ? emailDetailRow(tIntake.timeLabel[locale], newTimeStr) : '',
            emailDetailRow(tIntake.durationLabel[locale], `${data.duration} ${tIntake.minutes[locale]}`),
            data.location ? emailDetailRow(tIntake.locationLabel[locale], data.location) : ''
          ].filter(Boolean))}
        </td>
      </tr>
    </table>

    <!-- Add to Calendar -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0;">
      <tr>
        <td>
          <p style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #1a1a1a;">
            ${t.updateCalendar[locale]}
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding-${locale === 'he' ? 'left' : 'right'}: 8px;">
                <a href="${calendarLinks.google}" target="_blank" style="display: inline-block; padding: 10px 16px; font-size: 13px; font-weight: 500; color: #4285F4; text-decoration: none; border: 1px solid #4285F4; border-radius: 6px;">
                  ${tConfirm.googleCalendar[locale]}
                </a>
              </td>
              <td>
                <a href="${calendarLinks.outlook}" target="_blank" style="display: inline-block; padding: 10px 16px; font-size: 13px; font-weight: 500; color: #0078D4; text-decoration: none; border: 1px solid #0078D4; border-radius: 6px;">
                  ${tConfirm.outlookCalendar[locale]}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Manage Booking Section -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0; padding-top: 24px; border-top: 1px solid #e5e5e5;">
      <tr>
        <td>
          <p style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #1a1a1a;">
            ${t.needMoreChanges[locale]}
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding-${locale === 'he' ? 'left' : 'right'}: 8px;">
                ${emailOutlineButton(t.rescheduleAgain[locale], data.rescheduleUrl, { color: data.branding.primaryColor })}
              </td>
              <td>
                ${emailOutlineButton(tIntake.cancel[locale], data.cancelUrl, { color: '#DC2626' })}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Final Note -->
    <p style="margin: 24px 0 0; font-size: 13px; color: #888888; line-height: 1.5;">
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
    } as BookingConfirmationData)
  };
}
