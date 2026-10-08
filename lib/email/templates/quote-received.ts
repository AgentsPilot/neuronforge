// lib/email/templates/quote-received.ts
// Confirmation sent to the client once they have asked to be quoted.

/**
 * The receipt for asking to be quoted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A client picked a quoted service, typed their details and what they needed,
 * pressed send, and heard nothing. The page said thank you; their inbox said
 * nothing had happened. The owner was told; the person waiting for a price was
 * not, and from their side a silent form is indistinguishable from a broken
 * one.
 *
 * WHERE THIS SITS, AND WHERE IT DOES NOT
 *
 * A quoted service can book a consultation — "come and see it and I'll quote
 * you" — and that case already has an email: the ordinary booking confirmation,
 * with the date, the address and the way to move or cancel it. This is for the
 * other case, where there is no meeting: nothing to confirm, nothing to
 * calendar, only an acknowledgement that the request arrived.
 *
 * Written in the same register as `intake-received`: past tense, no button,
 * nothing to do. The next move is a PRICE and only the business can write one,
 * so an email asking the client to act would be asking them for the single
 * thing they cannot provide.
 *
 * It promises a reply and NOT a deadline. The platform does not know a
 * business's turnaround, and "within 24 hours" in their name would be a
 * commitment they never made.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { Locale } from '@/lib/i18n/config';
import {
  wrapInBrandedTemplate,
  emailDetailRow,
  emailDetailsTable,
  emailNoticeBox,
  formatEmailDate,
  emailPalette,
  type BrandingData
} from './base-template';
import { emailTranslations } from './translations';

export interface QuoteReceivedData {
  clientName: string;
  serviceName: string;
  /** What the client said they needed. Quoted back so they can see what arrived. */
  note?: string | null;
  /** When they sent it, so the email is a dated receipt. */
  submittedAt: Date;
  /** The business's zone: the date is stated as the BUSINESS reckons it. */
  timezone: string;
  branding: BrandingData;
  locale?: Locale;
}

export function generateQuoteReceivedEmail(data: QuoteReceivedData): {
  subject: string;
  html: string;
} {
  const { clientName, serviceName, note, submittedAt, timezone, branding, locale = 'en' } = data;

  const firstName = clientName.split(' ')[0] || clientName;
  const t = emailTranslations.quoteReceived;

  // Set locale on branding for RTL support
  const brandingWithLocale = { ...branding, locale };
  // Ink and panels against THIS business's card, not against a white one.
  const c = emailPalette(brandingWithLocale);

  const formattedSubmitted = formatEmailDate(submittedAt, timezone, { locale });

  /*
   * The client's own words, escaped.
   *
   * This is the one piece of untrusted text in the email, and it is going into
   * an HTML document. A note containing a tag would otherwise be rendered as
   * markup in the sender's own branded template.
   */
  const safeNote = (note ?? '')
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const content = `
    <!-- Greeting -->
    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: ${c.ink};">
      ${t.greeting[locale]}
    </h2>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${c.inkMuted}; line-height: 1.6;">
      ${t.intro[locale](firstName, branding.businessName)}
    </p>

    <!-- Received Notice -->
    ${emailNoticeBox(t.receivedNotice[locale], 'success', brandingWithLocale)}

    <!-- Details Card -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0; background-color: ${c.mutedSurface}; border-radius: ${c.radius}; border: 1px solid ${c.line};">
      <tr>
        <td style="padding: 24px;">
          <p style="margin: 0 0 12px; font-size: 12px; font-weight: 600; color: ${branding.primaryColor}; text-transform: uppercase; letter-spacing: 0.5px;">
            ${t.requestDetails[locale]}
          </p>
          <h3 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: ${c.ink};">
            ${serviceName}
          </h3>

          ${emailDetailsTable([
            emailDetailRow(t.submittedLabel[locale], formattedSubmitted, brandingWithLocale),
            safeNote ? emailDetailRow(t.noteLabel[locale], safeNote, brandingWithLocale) : ''
          ].filter(Boolean), brandingWithLocale)}
        </td>
      </tr>
    </table>

    <!-- Final Note -->
    <p style="margin: 24px 0 0; font-size: 13px; color: ${c.inkFaint}; line-height: 1.5;">
      ${t.questionsHelp[locale](branding.businessName)}
    </p>
  `;

  return {
    subject: t.subject[locale](serviceName),
    html: wrapInBrandedTemplate(content, brandingWithLocale)
  };
}
