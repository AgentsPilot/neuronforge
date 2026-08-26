// lib/email/templates/invoice.ts
// Invoice email template with payment link

import type { Locale } from '@/lib/i18n/config';
import {
  wrapInBrandedTemplate,
  emailButton,
  formatCurrency,
  formatEmailDate,
  type BrandingData
} from './base-template';
import { emailTranslations } from './translations';

export interface InvoiceLineItem {
  description: string;
  quantity?: number;
  unitPrice?: number;
  amount: number;
}

export interface InvoiceEmailData {
  clientName: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  dueDate: Date;
  lineItems: InvoiceLineItem[];
  paymentUrl: string;
  serviceName?: string;
  appointmentDate?: Date;
  timezone?: string;
  branding: BrandingData;
  /** Locale for email content (defaults to 'en') */
  locale?: Locale;
}

/**
 * Generate invoice email
 */
export function generateInvoiceEmail(data: InvoiceEmailData): {
  subject: string;
  html: string;
} {
  const locale = data.locale || 'en';
  const t = emailTranslations.invoice;

  // Map locale to Intl locale codes
  const intlLocales: Record<Locale, string> = {
    en: 'en-US',
    es: 'es-ES',
    he: 'he-IL'
  };
  const intlLocale = intlLocales[locale] || 'en-US';

  const formattedDueDate = data.dueDate.toLocaleDateString(intlLocale, {
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

  // Get translations for the current locale
  const greeting = t.greeting[locale](data.branding.businessName);
  const intro = t.intro[locale](data.clientName);
  const invoiceNumberLabel = t.invoiceNumber[locale];
  const amountDueLabel = t.amountDue[locale];
  const dueDateLabel = t.dueDate[locale];
  const forAppointmentLabel = t.forAppointment[locale];
  const invoiceDetailsLabel = t.invoiceDetails[locale];
  const totalLabel = t.total[locale];
  const payNowLabel = t.payNow[locale];
  const securePaymentLabel = t.securePayment[locale];
  const questionsText = t.questions[locale](data.branding.businessName);
  const serviceLabel = t.service[locale];

  // Build line items HTML
  const lineItemsHtml = data.lineItems.map(item => `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #f0f0f0;">
        <p style="margin: 0; font-size: 14px; color: #1a1a1a;">
          ${item.description}
        </p>
        ${item.quantity && item.unitPrice ? `
        <p style="margin: 4px 0 0; font-size: 12px; color: #888888;">
          ${item.quantity} × ${formatCurrency(item.unitPrice, data.currency)}
        </p>
        ` : ''}
      </td>
      <td style="padding: 12px 0; border-bottom: 1px solid #f0f0f0; text-align: right; font-size: 14px; font-weight: 500; color: #1a1a1a;">
        ${formatCurrency(item.amount, data.currency)}
      </td>
    </tr>
  `).join('');

  const content = `
    <!-- Greeting -->
    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: #1a1a1a;">
      ${greeting}
    </h2>
    <p style="margin: 0 0 24px; font-size: 15px; color: #666666;">
      ${intro}
    </p>

    <!-- Invoice Header -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px; background-color: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
      <tr>
        <td style="padding: 24px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td>
                <p style="margin: 0 0 4px; font-size: 12px; font-weight: 600; color: #666666; text-transform: uppercase;">
                  ${invoiceNumberLabel}
                </p>
                <p style="margin: 0; font-size: 18px; font-weight: 600; color: ${data.branding.primaryColor};">
                  ${data.invoiceNumber}
                </p>
              </td>
              <td style="text-align: right;">
                <p style="margin: 0 0 4px; font-size: 12px; font-weight: 600; color: #666666; text-transform: uppercase;">
                  ${amountDueLabel}
                </p>
                <p style="margin: 0; font-size: 24px; font-weight: 700; color: #1a1a1a;">
                  ${formatCurrency(data.amount, data.currency)}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Due Date -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px;">
      <tr>
        <td style="padding: 16px; background-color: #fffbeb; border-radius: 8px; border: 1px solid #fcd34d;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td>
                <p style="margin: 0; font-size: 14px; color: #92400e;">
                  <strong>📅 ${dueDateLabel}:</strong> ${formattedDueDate}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${formattedAppointmentDate ? `
    <!-- Appointment Info -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px;">
      <tr>
        <td style="padding: 16px; background-color: #f0f9ff; border-radius: 8px; border: 1px solid #bae6fd;">
          <p style="margin: 0; font-size: 14px; color: #0369a1;">
            <strong>📆 ${forAppointmentLabel}:</strong> ${data.serviceName || serviceLabel} on ${formattedAppointmentDate}
          </p>
        </td>
      </tr>
    </table>
    ` : ''}

    <!-- Line Items -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px;">
      <tr>
        <td>
          <p style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #1a1a1a;">
            ${invoiceDetailsLabel}
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #fafafa; border-radius: 8px; padding: 8px 16px;">
            ${lineItemsHtml}
            <!-- Total Row -->
            <tr>
              <td style="padding: 16px 0 8px; font-size: 16px; font-weight: 600; color: #1a1a1a;">
                ${totalLabel}
              </td>
              <td style="padding: 16px 0 8px; text-align: right; font-size: 18px; font-weight: 700; color: ${data.branding.primaryColor};">
                ${formatCurrency(data.amount, data.currency)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Pay Now Button -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0;">
      <tr>
        <td style="text-align: center;">
          ${emailButton(payNowLabel, data.paymentUrl, {
            backgroundColor: data.branding.primaryColor,
            fullWidth: true
          })}
          <p style="margin: 12px 0 0; font-size: 12px; color: #888888;">
            ${securePaymentLabel}
          </p>
        </td>
      </tr>
    </table>

    <!-- Final Note -->
    <p style="margin: 24px 0 0; font-size: 13px; color: #888888; line-height: 1.5;">
      ${questionsText}
    </p>
  `;

  return {
    subject: t.subject[locale](data.branding.businessName, data.invoiceNumber),
    html: wrapInBrandedTemplate(content, brandingWithLocale)
  };
}
