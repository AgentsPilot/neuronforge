// lib/email/templates/invoice.ts
// Invoice email template with payment link

import type { Locale } from '@/lib/i18n/config';
import type { InvoicePaymentOptions } from '@/lib/payments/invoicePaymentOptions';
import {
  wrapInBrandedTemplate,
  emailButton,
  emailPalette,
  emailTone,
  emailDetailsTable,
  emailDetailRow,
  emailPlanSchedule,
  formatCurrency,
  formatEmailDate,
  type BrandingData,
  type EmailPlanPeriod
} from './base-template';
import { emailTranslations } from './translations';
import { escapeHtml } from '@/lib/email/escapeHtml';

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
  /**
   * How this client can actually pay.
   *
   * Replaces a bare `paymentUrl` that was always set and always rendered as a
   * card button — including for businesses collected entirely by transfer,
   * whose bank details reached the client only if they opened the PDF.
   */
  paymentOptions: InvoicePaymentOptions;
  serviceName?: string;
  appointmentDate?: Date;
  timezone?: string;
  branding: BrandingData;
  /**
   * The tax the business says is already inside the amount.
   *
   * Absent for the many businesses that are not registered, and then no line is
   * drawn. Never computed here — the caller derives it from what the business
   * typed, so the email, the PDF and the pay page cannot disagree.
   */
  taxLine?: { amount: number; rate: number; label: string } | null;
  /**
   * What this document is called — "Receipt", "Invoice", "Tax invoice".
   *
   * Resolved by the caller from the business's settings, so the subject line,
   * the body and the attached PDF cannot call the same document three things.
   * Absent falls back to the translated word "Invoice", which is what every
   * email said before businesses could choose.
   */
  documentNoun?: string | null;
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

  /*
   * `payment_invoices.due_date` is a DATE column, so this arrives as midnight
   * UTC. Formatted with no zone it took the SERVER's, and for any zone behind
   * UTC midnight falls on the previous evening: a client was invoiced with a
   * due date one day earlier than the one the owner set. Pinned to UTC, the
   * calendar day is the one that was stored — which is what a date-only value
   * means.
   */
  const formattedDueDate = data.dueDate.toLocaleDateString(intlLocale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  });

  const formattedAppointmentDate = data.appointmentDate && data.timezone
    ? formatEmailDate(data.appointmentDate, data.timezone, { locale })
    : null;

  // Set locale on branding for RTL support
  const brandingWithLocale = { ...data.branding, locale };
  // Ink and panels against THIS business's card, not against a white one.
  const c = emailPalette(brandingWithLocale);
  // The overdue banner, and the note about how to pay.
  const overdue = emailTone('warning', brandingWithLocale);
  const note = emailTone('info', brandingWithLocale);

  // Get translations for the current locale
  // The word for this document, resolved once and used by the subject, the
  // greeting and the number label — three places that used to say "Invoice"
  // independently and would otherwise disagree with the attached PDF.
  const noun = data.documentNoun?.trim() || null;
  const greeting = noun
    ? t.greetingFor[locale](noun, data.branding.businessName)
    : t.greeting[locale](data.branding.businessName);
  const intro = t.intro[locale](data.clientName);
  const invoiceNumberLabel = noun
    ? (locale === 'he' ? `מספר ${noun}`
      : locale === 'es' ? `Número de ${noun.toLowerCase()}`
      : `${noun} number`)
    : t.invoiceNumber[locale];
  const amountDueLabel = t.amountDue[locale];
  const dueDateLabel = t.dueDate[locale];
  const forAppointmentLabel = t.forAppointment[locale];
  const invoiceDetailsLabel = t.invoiceDetails[locale];
  const totalLabel = t.total[locale];
  const includesTaxLabel = t.includesTax[locale];
  const payNowLabel = t.payNow[locale];

  const securePaymentLabel = t.securePayment[locale];
  const options = data.paymentOptions;

  const questionsText = t.questions[locale](data.branding.businessName);
  const serviceLabel = t.service[locale];

  // Build line items HTML
  const lineItemsHtml = data.lineItems.map(item => `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid ${c.line};">
        <p style="margin: 0; font-size: 14px; color: ${c.ink};">
          ${item.description}
        </p>
        ${item.quantity && item.unitPrice ? `
        <p style="margin: 4px 0 0; font-size: 12px; color: ${c.inkFaint};">
          ${item.quantity} × ${formatCurrency(item.unitPrice, data.currency)}
        </p>
        ` : ''}
      </td>
      <td style="padding: 12px 0; border-bottom: 1px solid ${c.line}; text-align: right; font-size: 14px; font-weight: 500; color: ${c.ink};">
        ${formatCurrency(item.amount, data.currency)}
      </td>
    </tr>
  `).join('');

  const content = `
    <!-- Greeting -->
    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: ${c.ink};">
      ${greeting}
    </h2>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${c.inkMuted};">
      ${intro}
    </p>

    <!-- Invoice Header -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px; background-color: ${c.mutedSurface}; border-radius: ${c.radius}; border: 1px solid ${c.line};">
      <tr>
        <td style="padding: 24px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td>
                <p style="margin: 0 0 4px; font-size: 12px; font-weight: 600; color: ${c.inkMuted}; text-transform: uppercase;">
                  ${invoiceNumberLabel}
                </p>
                <p style="margin: 0; font-size: 18px; font-weight: 600; color: ${data.branding.primaryColor};">
                  ${data.invoiceNumber}
                </p>
              </td>
              <td style="text-align: right;">
                <p style="margin: 0 0 4px; font-size: 12px; font-weight: 600; color: ${c.inkMuted}; text-transform: uppercase;">
                  ${amountDueLabel}
                </p>
                <p style="margin: 0; font-size: 24px; font-weight: 700; color: ${c.ink};">
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
        <td style="padding: 16px; background-color: ${overdue.bg}; border-radius: ${c.buttonRadius}; border: 1px solid ${overdue.border};">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td>
                <p style="margin: 0; font-size: 14px; color: ${overdue.text};">
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
        <td style="padding: 16px; background-color: ${note.bg}; border-radius: ${c.buttonRadius}; border: 1px solid ${note.border};">
          <p style="margin: 0; font-size: 14px; color: ${note.text};">
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
          <p style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: ${c.ink};">
            ${invoiceDetailsLabel}
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${c.mutedSurface}; border-radius: ${c.buttonRadius}; padding: 8px 16px;">
            ${lineItemsHtml}
            <!-- Total Row -->
            <tr>
              <td style="padding: 16px 0 8px; font-size: 16px; font-weight: 600; color: ${c.ink};">
                ${totalLabel}
              </td>
              <td style="padding: 16px 0 8px; text-align: right; font-size: 18px; font-weight: 700; color: ${data.branding.primaryColor};">
                ${formatCurrency(data.amount, data.currency)}
              </td>
            </tr>
            ${data.taxLine ? `
            <!-- Under the total, because it is CONTAINED in it. Above, and the
                 reader adds it on — the one misreading that changes what they
                 think they owe. -->
            <tr>
              <td style="padding: 0 0 12px; font-size: 13px; color: ${c.inkMuted};">
                ${includesTaxLabel} ${data.taxLine.label} ${data.taxLine.rate}%
              </td>
              <td style="padding: 0 0 12px; text-align: right; font-size: 13px; color: ${c.inkMuted};">
                ${formatCurrency(data.taxLine.amount, data.currency)}
              </td>
            </tr>` : ''}
          </table>
        </td>
      </tr>
    </table>

    <!-- How to pay. Card, bank, instructions - whichever this business
         actually offers, resolved once in invoicePaymentOptions so the
         email, the PDF and the public page cannot disagree again. -->
    ${options.card && options.cardUrl ? `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0;">
      <tr>
        <td style="text-align: center;">
          ${emailButton(payNowLabel, options.cardUrl, {
            branding: data.branding,
            fullWidth: true
          })}
          <p style="margin: 12px 0 0; font-size: 12px; color: ${c.inkFaint};">
            ${securePaymentLabel}
          </p>
        </td>
      </tr>
    </table>` : ''}

    ${options.bank ? `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0; background-color: ${c.mutedSurface}; border-radius: ${c.buttonRadius};">
      <tr>
        <td style="padding: 16px 20px;">
          <p style="margin: 0 0 10px; font-size: 14px; font-weight: 600; color: ${c.ink};">
            ${t.bankTransferTitle[locale]}
          </p>
          ${options.bankName ? `<p style="margin: 0 0 4px; font-size: 13px; color: ${c.inkMuted};">${t.bankName[locale]}: <strong>${options.bankName}</strong></p>` : ''}
          ${options.bankAccount ? `<p style="margin: 0 0 4px; font-size: 13px; color: ${c.inkMuted};">${t.bankAccount[locale]}: <strong>${options.bankAccount}</strong></p>` : ''}
          ${options.bankRouting ? `<p style="margin: 0 0 4px; font-size: 13px; color: ${c.inkMuted};">${t.bankRouting[locale]}: <strong>${options.bankRouting}</strong></p>` : ''}
          <p style="margin: 10px 0 0; font-size: 12px; color: ${c.inkFaint};">
            ${t.includeInvoiceNumber[locale](data.invoiceNumber)}
          </p>
        </td>
      </tr>
    </table>` : ''}

    ${options.instructions ? `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0; background-color: ${c.mutedSurface}; border-radius: ${c.buttonRadius};">
      <tr>
        <td style="padding: 16px 20px;">
          <p style="margin: 0 0 8px; font-size: 14px; font-weight: 600; color: ${c.ink};">
            ${t.paymentInstructionsTitle[locale]}
          </p>
          <p style="margin: 0; font-size: 13px; color: ${c.inkMuted}; line-height: 1.6; white-space: pre-line;">${options.instructions}</p>
        </td>
      </tr>
    </table>` : ''}

    ${options.none ? `
    <!-- Nothing configured. Saying so beats a bill with a blank space where the
         payment method should be. -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0;">
      <tr>
        <td style="padding: 16px 20px; background-color: ${c.mutedSurface}; border-radius: ${c.buttonRadius};">
          <p style="margin: 0; font-size: 13px; color: ${c.inkMuted};">
            ${t.contactForPayment[locale](data.branding.businessName)}
          </p>
        </td>
      </tr>
    </table>` : ''}

    <!-- Final Note -->
    <p style="margin: 24px 0 0; font-size: 13px; color: ${c.inkFaint}; line-height: 1.5;">
      ${questionsText}
    </p>
  `;

  return {
    subject: noun
      ? t.subjectFor[locale](noun, data.branding.businessName, data.invoiceNumber)
      : t.subject[locale](data.branding.businessName, data.invoiceNumber),
    html: wrapInBrandedTemplate(content, brandingWithLocale)
  };
}

/**
 * Tell the client a payment request has been withdrawn.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EMAIL HAS TO EXIST
 *
 * Voiding an invoice was entirely silent. The client kept the original invoice
 * in their inbox, the hosted payment page stopped working, and nobody told
 * them why — so the best case was a confused reply and the worst was a client
 * who paid it days earlier from the copy they already had.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT SAYS, AND WHAT IT DELIBERATELY DOES NOT
 *
 * ONE REQUEST, NOT THE WHOLE AGREEMENT. `generateQuoteStoppedEmail` ends the
 * work and accounts for every penny across the job. This ends a single demand
 * while the plan continues, so the client needs the opposite reassurance:
 * nothing is owed on THIS one, and here is exactly what is still coming.
 *
 * THE SCHEDULE IS THE SHARED ONE. `emailPlanSchedule` draws it in the
 * confirmation and the receipt too, so the client sees the same list they have
 * seen before, with the cancelled row struck through and every remaining row
 * where they left it. A bespoke list here would be a second thing to keep in
 * step with the first.
 *
 * NO PAY BUTTON, ANYWHERE. Obvious, and worth stating: this email exists
 * because a payment link should no longer be used.
 *
 * IT ASSUMES THE CANCELLATION MAY HAVE CROSSED A PAYMENT. A client who paid an
 * hour ago is told to reply rather than to ignore it, because "disregard this"
 * to somebody who has already paid is how a refund becomes a dispute.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export interface PaymentRequestCancelledEmailData {
  invoiceNumber: string;
  amount: number;
  currency: string;
  clientFirstName?: string | null;
  /**
   * Every period of the plan this request belonged to, cancelled ones included.
   *
   * Absent for a one-off invoice, and then no schedule is drawn: a single
   * cancelled request has no schedule to show, and an empty table under
   * "your payment schedule" reads as something that failed to load.
   */
  periods?: EmailPlanPeriod[];
  planTotal?: number | null;
  branding: BrandingData;
  locale?: Locale;
}

export function generatePaymentRequestCancelledEmail(
  data: PaymentRequestCancelledEmailData
): { subject: string; html: string } {
  const locale = data.locale || 'en';
  const t = emailTranslations.paymentRequestCancelled;
  const brandingWithLocale = { ...data.branding, locale };
  const c = emailPalette(brandingWithLocale);
  const money = (n: number) => formatCurrency(n, data.currency);

  const greeting = data.clientFirstName
    ? t.greeting[locale].replace('{name}', escapeHtml(data.clientFirstName))
    : t.greetingPlain[locale];

  const periods = data.periods ?? [];

  /*
   * What is genuinely still coming: not paid, not cancelled. This is the figure
   * the client actually wants, and deriving it here rather than taking it from
   * the caller keeps it in step with the list drawn directly below it.
   */
  const remaining = periods.filter(
    p => p.status !== 'paid' && p.status !== 'cancelled' && p.status !== 'refunded'
  );
  const remainingTotal = remaining.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const nextDue = remaining.map(p => p.dueDate).filter(Boolean).sort()[0] ?? null;

  const intlLocale = locale === 'he' ? 'he-IL' : locale === 'es' ? 'es-ES' : 'en-US';
  const nextDueText = nextDue
    ? new Date(`${nextDue}T00:00:00Z`).toLocaleDateString(intlLocale, {
        timeZone: 'UTC',
        day: 'numeric',
        month: 'long',
      })
    : '';

  /*
   * Singular and plural as separate sentences, per language. Hebrew does not
   * pluralise the way English does and "1 תשלומים" is wrong in a way a client
   * notices — the same reasoning the stopped-quote email records.
   */
  const remainingLine = remaining.length === 0
    ? t.nothingRemaining[locale]
    : (remaining.length === 1 ? t.remainingOne : t.remainingMany)[locale]
        .replace('{count}', String(remaining.length))
        .replace('{amount}', money(remainingTotal))
        .replace('{date}', nextDueText);

  const content = `
    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: ${c.ink};">
      ${greeting}
    </h2>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${c.inkMuted};">
      ${t.intro[locale].replace('{amount}', money(data.amount))}
    </p>

    ${emailDetailsTable(
      [
        emailDetailRow(t.invoiceLabel[locale], escapeHtml(data.invoiceNumber), brandingWithLocale),
        emailDetailRow(t.amountLabel[locale], money(data.amount), brandingWithLocale),
      ],
      brandingWithLocale
    )}

    ${periods.length
      ? emailPlanSchedule({
          periods,
          totalAmount: Number(data.planTotal ?? 0),
          currency: data.currency,
          branding: brandingWithLocale,
          labels: {
            title: t.scheduleTitle[locale],
            paid: t.schedulePaid[locale],
            highlight: t.scheduleDue[locale],
            cancelled: t.scheduleCancelled[locale],
            total: t.scheduleTotal[locale],
            refunded: t.scheduleRefunded[locale],
          },
          /* The next one genuinely due, so the client's eye lands on what is
             coming rather than on what has just been withdrawn. */
          highlightNumber: remaining[0]?.number,
        })
      : ''}

    <h3 style="margin: 24px 0 8px; font-size: 16px; font-weight: 600; color: ${c.ink};">
      ${t.remainingHeading[locale]}
    </h3>
    <p style="margin: 0 0 16px; font-size: 15px; color: ${c.ink};">
      ${remainingLine}
    </p>

    <p style="margin: 16px 0 0; font-size: 14px; color: ${c.inkMuted};">
      ${t.alreadyPaid[locale]}
    </p>

    <p style="margin: 16px 0 0; font-size: 14px; color: ${c.inkMuted};">
      ${t.questions[locale]}
    </p>
  `;

  return {
    subject: t.subject[locale].replace('{invoiceNumber}', data.invoiceNumber),
    html: wrapInBrandedTemplate(content, brandingWithLocale),
  };
}
