// lib/email/templates/intake-received.ts
// Confirmation sent to the client once they have completed their intake form.

/**
 * The receipt for an intake.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A client was asked personal questions by a business, typed answers into a
 * page they had never seen before, pressed Submit, and then heard nothing. The
 * page said thank you and that was the end of it — no record in their inbox
 * that it arrived, nothing to show they had done what was asked, and no way to
 * tell a submission that landed from one that failed on the way.
 *
 * This closes that loop. It is deliberately the quietest email the platform
 * sends: past tense throughout, no call to action, no button. The next move
 * belongs to the business, and telling the client to do something else here
 * would undo the point of it.
 *
 * NOT EVERY BOOKING HAS A TIME.
 *
 * A course, a product, a service sold without a slot — `start_time` is null and
 * there is no appointment to prepare for. Those get the order wording and no
 * date block, rather than an email promising to read their answers "before your
 * appointment" that does not exist. The same distinction the booking
 * confirmation and the journey timeline already make.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { Locale } from '@/lib/i18n/config';
import {
  wrapInBrandedTemplate,
  emailOutlineButton,
  emailDetailRow,
  emailDetailsTable,
  emailNoticeBox,
  formatEmailDate,
  type BrandingData
} from './base-template';
import { emailTranslations } from './translations';

export interface IntakeReceivedData {
  clientName: string;
  serviceName: string;
  /** Null for a booking with no slot — a product, or a service sold without one. */
  dateTime: Date | null;
  timezone: string;
  /** When the client submitted. Shown so the email is a dated receipt. */
  completedAt: Date;
  rescheduleUrl?: string;
  cancelUrl?: string;
  branding: BrandingData;
  /** Locale for email content (defaults to 'en') */
  locale?: Locale;
}

export function generateIntakeReceivedEmail(data: IntakeReceivedData): {
  subject: string;
  html: string;
} {
  const {
    clientName,
    serviceName,
    dateTime,
    timezone,
    completedAt,
    rescheduleUrl,
    cancelUrl,
    branding,
    locale = 'en'
  } = data;

  const firstName = clientName.split(' ')[0] || clientName;
  const t = emailTranslations.intakeReceived;
  const isScheduled = dateTime !== null;

  // Set locale on branding for RTL support
  const brandingWithLocale = { ...branding, locale };

  // Split date and time the same way the request email does, so the two read
  // alike in every locale.
  const formattedDate = dateTime ? formatEmailDate(dateTime, timezone, { locale }) : '';
  const dateParts = formattedDate.split(locale === 'he' ? ' בשעה ' : ' at ');
  const dateStr = dateParts[0] || formattedDate;
  const timeStr = dateParts[1] || '';

  const formattedCompleted = formatEmailDate(completedAt, timezone, { locale });

  /*
   * Reschedule and cancel are offered only when there is a time to change.
   * On an unscheduled order those links lead to pages about a slot that does
   * not exist.
   */
  const showManageLinks = isScheduled && (rescheduleUrl || cancelUrl);

  const content = `
    <!-- Greeting -->
    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: #1a1a1a;">
      ${t.greeting[locale]}
    </h2>
    <p style="margin: 0 0 24px; font-size: 15px; color: #666666; line-height: 1.6;">
      ${
        isScheduled
          ? t.introScheduled[locale](firstName, branding.businessName)
          : t.introUnscheduled[locale](firstName, branding.businessName)
      }
    </p>

    <!-- Received Notice -->
    ${emailNoticeBox(t.receivedNotice[locale], 'success')}

    <!-- Details Card -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0; background-color: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
      <tr>
        <td style="padding: 24px;">
          <p style="margin: 0 0 12px; font-size: 12px; font-weight: 600; color: ${branding.primaryColor}; text-transform: uppercase; letter-spacing: 0.5px;">
            ${isScheduled ? t.appointmentDetails[locale] : t.orderDetails[locale]}
          </p>
          <h3 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: #1a1a1a;">
            ${serviceName}
          </h3>

          ${emailDetailsTable([
            isScheduled ? emailDetailRow(t.dateLabel[locale], dateStr) : '',
            isScheduled && timeStr ? emailDetailRow(t.timeLabel[locale], timeStr) : '',
            emailDetailRow(t.submittedLabel[locale], formattedCompleted)
          ].filter(Boolean))}
        </td>
      </tr>
    </table>

    ${showManageLinks ? `
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
