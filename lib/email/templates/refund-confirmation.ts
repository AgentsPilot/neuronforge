// lib/email/templates/refund-confirmation.ts
// Refund confirmation email template

import type { Locale } from '@/lib/i18n/config';
import {
  wrapInBrandedTemplate,
  emailButton,
  emailDetailRow,
  emailDetailsTable,
  formatCurrency,
  type BrandingData
} from './base-template';
import { emailTranslations } from './translations';

export interface RefundConfirmationData {
  clientName: string;
  refundAmount: number;
  originalAmount: number;
  currency: string;
  refundType: 'full' | 'partial';
  refundDate: Date;
  serviceName?: string;
  reason?: string;
  isManualRefund?: boolean;  // true if no actual Stripe refund was processed
  bookAgainUrl?: string;
  branding: BrandingData;
  /** Locale for email content (defaults to 'en') */
  locale?: Locale;
}

/**
 * Generate refund confirmation email
 */
export function generateRefundConfirmationEmail(data: RefundConfirmationData): {
  subject: string;
  html: string;
} {
  const locale = data.locale || 'en';
  const t = emailTranslations.refundConfirmation;

  // Map locale to Intl locale codes
  const intlLocales: Record<Locale, string> = {
    en: 'en-US',
    es: 'es-ES',
    he: 'he-IL'
  };
  const intlLocale = intlLocales[locale] || 'en-US';

  const formattedRefundDate = data.refundDate.toLocaleDateString(intlLocale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Set locale on branding for RTL support
  const brandingWithLocale = { ...data.branding, locale };

  // Determine refund type text
  const refundTypeText = data.refundType === 'full'
    ? t.fullRefund[locale]
    : t.partialRefund[locale];

  // Build details rows
  const detailRows = [
    emailDetailRow(t.amountRefunded[locale], formatCurrency(data.refundAmount, data.currency)),
  ];

  // Only show original amount if partial refund
  if (data.refundType === 'partial') {
    detailRows.push(emailDetailRow(t.originalPayment[locale], formatCurrency(data.originalAmount, data.currency)));
  }

  detailRows.push(emailDetailRow(t.refundType[locale], refundTypeText));
  detailRows.push(emailDetailRow(t.refundDate[locale], formattedRefundDate));

  if (data.serviceName) {
    detailRows.push(emailDetailRow(t.serviceLabel[locale], data.serviceName));
  }

  if (data.reason) {
    detailRows.push(emailDetailRow(t.reasonLabel[locale], data.reason));
  }

  // Get the appropriate processing note
  const processingNote = data.isManualRefund
    ? t.manualRefundNote[locale]
    : t.processingNote[locale];

  const content = `
    <!-- Refund Header -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px;">
      <tr>
        <td style="text-align: center;">
          <div style="display: inline-block; width: 64px; height: 64px; background-color: #F97316; border-radius: 50%; line-height: 64px; text-align: center; margin: 0 0 16px;">
            <span style="font-size: 32px; color: #ffffff;">↩</span>
          </div>
          <h2 style="margin: 0 0 8px; font-size: 24px; font-weight: 600; color: #1a1a1a;">
            ${t.greeting[locale]}
          </h2>
          <p style="margin: 0; font-size: 15px; color: #666666;">
            ${t.intro[locale](data.clientName, data.branding.businessName)}
          </p>
        </td>
      </tr>
    </table>

    <!-- Amount Box -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px; background-color: #fff7ed; border-radius: 12px; border: 1px solid #fed7aa;">
      <tr>
        <td style="padding: 24px; text-align: center;">
          <p style="margin: 0 0 4px; font-size: 12px; font-weight: 600; color: #9a3412; text-transform: uppercase;">
            ${t.amountRefunded[locale]}
          </p>
          <p style="margin: 0; font-size: 32px; font-weight: 700; color: #9a3412;">
            ${formatCurrency(data.refundAmount, data.currency)}
          </p>
        </td>
      </tr>
    </table>

    <!-- Refund Details -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px;">
      <tr>
        <td>
          <p style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #1a1a1a;">
            ${t.refundDetails[locale]}
          </p>
          ${emailDetailsTable(detailRows)}
        </td>
      </tr>
    </table>

    <!-- Processing Note -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px;">
      <tr>
        <td style="padding: 16px; background-color: #f0f9ff; border-radius: 8px; border: 1px solid #bae6fd;">
          <p style="margin: 0; font-size: 14px; color: #0369a1; line-height: 1.5;">
            ${processingNote}
          </p>
        </td>
      </tr>
    </table>

    ${data.bookAgainUrl ? `
    <!-- Book Again Section -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px;">
      <tr>
        <td style="text-align: center;">
          <p style="margin: 0 0 16px; font-size: 15px; color: #666666;">
            ${t.bookAgainPrompt[locale]}
          </p>
          ${emailButton(t.bookAgain[locale], data.bookAgainUrl, {
            backgroundColor: data.branding.primaryColor
          })}
        </td>
      </tr>
    </table>
    ` : ''}

    <!-- Questions Note -->
    <p style="margin: 24px 0 0; font-size: 13px; color: #888888; line-height: 1.5;">
      ${t.questions[locale](data.branding.businessName)}
    </p>
  `;

  return {
    subject: t.subject[locale](data.branding.businessName),
    html: wrapInBrandedTemplate(content, brandingWithLocale)
  };
}
