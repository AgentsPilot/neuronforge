// lib/email/templates/payment-receipt.ts
// Payment receipt email template

import type { Locale } from '@/lib/i18n/config';
import {
  wrapInBrandedTemplate,
  emailButton,
  emailDetailRow,
  emailDetailsTable,
  formatCurrency,
  formatEmailDate,
  type BrandingData
} from './base-template';
import { emailTranslations } from './translations';

export interface PaymentReceiptData {
  clientName: string;
  amount: number;
  currency: string;
  receiptNumber: string;
  paymentDate: Date;
  paymentMethod?: string;
  serviceName?: string;
  appointmentDate?: Date;
  timezone?: string;
  bookingManageUrl?: string;
  branding: BrandingData;
  /** Locale for email content (defaults to 'en') */
  locale?: Locale;
}

/**
 * Generate payment receipt email
 */
export function generatePaymentReceiptEmail(data: PaymentReceiptData): {
  subject: string;
  html: string;
} {
  const locale = data.locale || 'en';
  const t = emailTranslations.paymentReceipt;

  // Map locale to Intl locale codes
  const intlLocales: Record<Locale, string> = {
    en: 'en-US',
    es: 'es-ES',
    he: 'he-IL'
  };
  const intlLocale = intlLocales[locale] || 'en-US';

  const formattedPaymentDate = data.paymentDate.toLocaleDateString(intlLocale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const formattedAppointmentDate = data.appointmentDate && data.timezone
    ? formatEmailDate(data.appointmentDate, data.timezone, { locale })
    : null;

  // Set locale on branding for RTL support
  const brandingWithLocale = { ...data.branding, locale };

  // Build details rows
  const detailRows = [
    emailDetailRow(t.receiptNumberLabel[locale], data.receiptNumber),
    emailDetailRow(t.amountLabel[locale], formatCurrency(data.amount, data.currency)),
    emailDetailRow(t.paymentDateLabel[locale], formattedPaymentDate),
  ];

  if (data.paymentMethod) {
    detailRows.push(emailDetailRow(t.paymentMethodLabel[locale], data.paymentMethod));
  }

  if (data.serviceName) {
    detailRows.push(emailDetailRow(t.serviceLabel[locale], data.serviceName));
  }

  if (formattedAppointmentDate) {
    detailRows.push(emailDetailRow(t.appointmentLabel[locale], formattedAppointmentDate));
  }

  const content = `
    <!-- Success Header -->\
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px;">
      <tr>
        <td style="text-align: center;">
          <div style="display: inline-block; width: 64px; height: 64px; background-color: #10B981; border-radius: 50%; line-height: 64px; text-align: center; margin: 0 0 16px;">
            <span style="font-size: 32px; color: #ffffff;">✓</span>
          </div>
          <h2 style="margin: 0 0 8px; font-size: 24px; font-weight: 600; color: #1a1a1a;">
            ${t.confirmedTitle[locale]}
          </h2>
          <p style="margin: 0; font-size: 15px; color: #666666;">
            ${t.thankYou[locale](data.clientName)}
          </p>
        </td>
      </tr>
    </table>

    <!-- Amount Box -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px; background-color: #f0fdf4; border-radius: 12px; border: 1px solid #86efac;">
      <tr>
        <td style="padding: 24px; text-align: center;">
          <p style="margin: 0 0 4px; font-size: 12px; font-weight: 600; color: #166534; text-transform: uppercase;">
            ${t.amountLabel[locale]}
          </p>
          <p style="margin: 0; font-size: 32px; font-weight: 700; color: #166534;">
            ${formatCurrency(data.amount, data.currency)}
          </p>
        </td>
      </tr>
    </table>

    <!-- Receipt Details -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px;">
      <tr>
        <td>
          <p style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #1a1a1a;">
            ${t.receiptDetails[locale]}
          </p>
          ${emailDetailsTable(detailRows)}
        </td>
      </tr>
    </table>

    ${formattedAppointmentDate && data.bookingManageUrl ? `
    <!-- Appointment Reminder -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px;">
      <tr>
        <td style="padding: 16px; background-color: #f0f9ff; border-radius: 8px; border: 1px solid #bae6fd;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td>
                <p style="margin: 0 0 8px; font-size: 14px; color: #0369a1;">
                  ${t.appointmentLine[locale](data.serviceName || t.serviceLabel[locale], formattedAppointmentDate)}
                </p>
                <p style="margin: 0; font-size: 13px; color: #0369a1;">
                  ${t.manageNote[locale]}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Manage Booking Button -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px;">
      <tr>
        <td style="text-align: center;">
          ${emailButton(t.viewBooking[locale], data.bookingManageUrl, {
            backgroundColor: data.branding.primaryColor
          })}
        </td>
      </tr>
    </table>
    ` : ''}

    <!-- Final Note -->
    <p style="margin: 24px 0 0; font-size: 13px; color: #888888; line-height: 1.5;">
      ${t.finalNote[locale](data.branding.businessName)}
    </p>
  `;

  return {
    subject: t.subject[locale](data.branding.businessName),
    html: wrapInBrandedTemplate(content, brandingWithLocale)
  };
}
