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
    locale = 'en'
  } = data;

  const firstName = clientName.split(' ')[0] || clientName;
  const formattedDate = formatEmailDate(dateTime, timezone, { locale });
  const t = emailTranslations.intake;

  // Set locale on branding for RTL support
  const brandingWithLocale = { ...branding, locale };

  // Split date and time (handle different locale formats)
  const dateParts = formattedDate.split(locale === 'he' ? ' בשעה ' : ' at ');
  const dateStr = dateParts[0] || formattedDate;
  const timeStr = dateParts[1] || '';

  const content = `
    <!-- Greeting -->
    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: #1a1a1a;">
      ${t.greeting[locale]}
    </h2>
    <p style="margin: 0 0 24px; font-size: 15px; color: #666666; line-height: 1.6;">
      ${t.intro[locale](firstName, branding.businessName)}
    </p>

    <!-- Important Notice -->
    ${emailNoticeBox(t.importantNotice[locale], 'warning')}

    <!-- Complete Intake Form CTA -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0; text-align: center;">
      <tr>
        <td>
          ${emailButton(t.completeForm[locale], intakeFormUrl, {
            backgroundColor: branding.primaryColor,
            fullWidth: true
          })}
        </td>
      </tr>
    </table>

    <!-- Appointment Details Card -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0; background-color: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
      <tr>
        <td style="padding: 24px;">
          <p style="margin: 0 0 12px; font-size: 12px; font-weight: 600; color: ${branding.primaryColor}; text-transform: uppercase; letter-spacing: 0.5px;">
            ${t.appointmentDetails[locale]}
          </p>
          <h3 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: #1a1a1a;">
            ${serviceName}
          </h3>

          ${emailDetailsTable([
            emailDetailRow(t.dateLabel[locale], dateStr),
            timeStr ? emailDetailRow(t.timeLabel[locale], timeStr) : '',
            emailDetailRow(t.durationLabel[locale], `${duration} ${t.minutes[locale]}`),
            location ? emailDetailRow(t.locationLabel[locale], location) : ''
          ].filter(Boolean))}
        </td>
      </tr>
    </table>

    <!-- What to Expect -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0;">
      <tr>
        <td>
          <h4 style="margin: 0 0 12px; font-size: 15px; font-weight: 600; color: #1a1a1a;">
            ${t.whatsOnForm[locale]}
          </h4>
          <ul style="margin: 0; padding: 0 0 0 20px; font-size: 14px; color: #666666; line-height: 1.8;${locale === 'he' ? ' direction: rtl; text-align: right;' : ''}">
            ${t.formItems[locale].map(item => `<li>${item}</li>`).join('\n            ')}
          </ul>
          <p style="margin: 16px 0 0; font-size: 13px; color: #888888;">
            ${t.formDuration[locale]}
          </p>
        </td>
      </tr>
    </table>

    ${(rescheduleUrl || cancelUrl) ? `
    <!-- Manage Booking Section -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0; padding-top: 24px; border-top: 1px solid #e5e5e5;">
      <tr>
        <td>
          <p style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #1a1a1a;">
            ${t.needChanges[locale]}
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              ${rescheduleUrl ? `
              <td style="padding-${locale === 'he' ? 'left' : 'right'}: 8px;">
                ${emailOutlineButton(t.reschedule[locale], rescheduleUrl, { color: branding.primaryColor })}
              </td>
              ` : ''}
              ${cancelUrl ? `
              <td>
                ${emailOutlineButton(t.cancel[locale], cancelUrl, { color: '#DC2626' })}
              </td>
              ` : ''}
            </tr>
          </table>
        </td>
      </tr>
    </table>
    ` : ''}

    <!-- Final Note -->
    <p style="margin: 24px 0 0; font-size: 13px; color: #888888; line-height: 1.5;">
      ${t.questionsHelp[locale](branding.businessName)}
    </p>
  `;

  return {
    subject: t.subject[locale](serviceName),
    html: wrapInBrandedTemplate(content, brandingWithLocale)
  };
}
