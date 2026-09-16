// lib/email/templates/intake-request.ts
// Intake form request email template sent after booking confirmation

import type { Locale } from '@/lib/i18n/config';
import {
  wrapInBrandedTemplate,
  emailButton,
  emailOutlineButton,
  emailDetailRow,
  emailDetailsTable,
  emailNoticeBox,
  formatEmailDate,
  emailPalette,
  emailTone,
  type BrandingData
} from './base-template';
import { emailTranslations } from './translations';

export interface IntakeRequestData {
  clientName: string;
  clientEmail: string;
  serviceName: string;
  dateTime: Date;
  duration: number;
  timezone: string;
  location?: string;
  intakeFormUrl: string;
  rescheduleUrl?: string;
  cancelUrl?: string;
  bookingId: string;
  branding: BrandingData;
  /** Locale for email content (defaults to 'en') */
  locale?: Locale;
  /**
   * A reminder rather than the first ask.
   *
   * Only the subject and the greeting differ. The body is identical because
   * the thing being asked for is identical — a client who lost the first email
   * needs the same link, not a different letter.
   */
  isReminder?: boolean;
}

/**
 * Generate intake form request email sent after booking
 */
export function generateIntakeRequestEmail(data: IntakeRequestData): {
  subject: string;
  html: string;
} {
  const {
    clientName,
    serviceName,
    dateTime,
    duration,
    timezone,
    location,
    intakeFormUrl,
    rescheduleUrl,
    cancelUrl,
    branding,
    locale = 'en',
    isReminder = false
  } = data;

  const firstName = clientName.split(' ')[0] || clientName;
  const formattedDate = formatEmailDate(dateTime, timezone, { locale });
  const t = emailTranslations.intake;

  // Set locale on branding for RTL support
  const brandingWithLocale = { ...branding, locale };
  // Ink and panels against THIS business's card, not against a white one.
  const c = emailPalette(brandingWithLocale);

  // Split date and time (handle different locale formats)
  const dateParts = formattedDate.split(locale === 'he' ? ' בשעה ' : ' at ');
  const dateStr = dateParts[0] || formattedDate;
  const timeStr = dateParts[1] || '';

  const content = `
    <!-- Greeting -->
    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: ${c.ink};">
      ${isReminder ? t.reminderGreeting[locale] : t.greeting[locale]}
    </h2>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${c.inkMuted}; line-height: 1.6;">
      ${t.intro[locale](firstName, branding.businessName)}
    </p>

    <!-- Important Notice -->
    ${emailNoticeBox(t.importantNotice[locale], 'warning', brandingWithLocale)}

    <!-- Complete Intake Form CTA -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0; text-align: center;">
      <tr>
        <td>
          ${emailButton(t.completeForm[locale], intakeFormUrl, {
            branding: branding,
            fullWidth: true
          })}
        </td>
      </tr>
    </table>

    <!-- Appointment Details Card -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0; background-color: ${c.mutedSurface}; border-radius: ${c.radius}; border: 1px solid ${c.line};">
      <tr>
        <td style="padding: 24px;">
          <p style="margin: 0 0 12px; font-size: 12px; font-weight: 600; color: ${branding.primaryColor}; text-transform: uppercase; letter-spacing: 0.5px;">
            ${t.appointmentDetails[locale]}
          </p>
          <h3 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: ${c.ink};">
            ${serviceName}
          </h3>

          ${emailDetailsTable([
            emailDetailRow(t.dateLabel[locale], dateStr, brandingWithLocale),
            timeStr ? emailDetailRow(t.timeLabel[locale], timeStr, brandingWithLocale) : '',
            emailDetailRow(t.durationLabel[locale], `${duration} ${t.minutes[locale]}`, brandingWithLocale),
            location ? emailDetailRow(t.locationLabel[locale], location, brandingWithLocale) : ''
          ].filter(Boolean), brandingWithLocale)}
        </td>
      </tr>
    </table>

    <!-- What to Expect -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0;">
      <tr>
        <td>
          <h4 style="margin: 0 0 12px; font-size: 15px; font-weight: 600; color: ${c.ink};">
            ${t.whatsOnForm[locale]}
          </h4>
          <ul style="margin: 0; padding: 0 0 0 20px; font-size: 14px; color: ${c.inkMuted}; line-height: 1.8;${locale === 'he' ? ' direction: rtl; text-align: right;' : ''}">
            ${t.formItems[locale].map(item => `<li>${item}</li>`).join('\n            ')}
          </ul>
          <p style="margin: 16px 0 0; font-size: 13px; color: ${c.inkFaint};">
            ${t.formDuration[locale]}
          </p>
        </td>
      </tr>
    </table>

    ${(rescheduleUrl || cancelUrl) ? `
    <!-- Manage Booking Section -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0; padding-top: 24px; border-top: 1px solid ${c.line};">
      <tr>
        <td>
          <p style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: ${c.ink};">
            ${t.needChanges[locale]}
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              ${rescheduleUrl ? `
              <td style="padding-${locale === 'he' ? 'left' : 'right'}: 8px;">
                ${emailOutlineButton(t.reschedule[locale], rescheduleUrl, { branding: branding })}
              </td>
              ` : ''}
              ${cancelUrl ? `
              <td>
                ${emailOutlineButton(t.cancel[locale], cancelUrl, { color: emailTone('danger', brandingWithLocale).text })}
              </td>
              ` : ''}
            </tr>
          </table>
        </td>
      </tr>
    </table>
    ` : ''}

    <!-- Final Note -->
    <p style="margin: 24px 0 0; font-size: 13px; color: ${c.inkFaint}; line-height: 1.5;">
      ${t.questionsHelp[locale](branding.businessName)}
    </p>
  `;

  return {
    subject: isReminder ? t.reminderSubject[locale](serviceName) : t.subject[locale](serviceName),
    html: wrapInBrandedTemplate(content, brandingWithLocale)
  };
}
