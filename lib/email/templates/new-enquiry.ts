/**
 * Telling the owner that somebody reached them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE EMAIL THAT WAS SPECIFIED AND NEVER WRITTEN
 *
 * Both contact routes carried the line *"3. Triggers email notification to the
 * business owner"* in their header. No such step existed. Every one of the nine
 * emails in `BookingEmailService` goes to the CLIENT — confirmation, intake
 * request, receipt, cancellation, reschedule — and none to the owner. So a
 * person could fill in a form, or ask what something costs, and the business
 * would find out whenever it next happened to open the CRM.
 *
 * ONE TEMPLATE, TWO EVENTS — AND ONLY TWO
 *
 * An enquiry and a quote request are the same news: somebody is waiting on the
 * owner personally. They differ in one word of the subject and one line
 * underneath, not enough to justify two templates to keep in step.
 *
 * A BOOKING IS NOT ONE OF THEM, deliberately. It has already resolved itself —
 * the client chose a time, paid, and got a confirmation, and it is in the
 * owner's calendar, which sends its own notification. Emailing them a third
 * time is how a practice with six appointments a day learns to filter this
 * sender, taking the two that mattered with it. Bookings are reported in the
 * morning briefing, which is the right cadence for news nobody must act on.
 *
 * This is an OWNER-facing email, which changes three things from the
 * client-facing ones: it goes to the account's own address rather than the
 * public business address, it is written in the OWNER's language rather than
 * the client's, and it is not logged to `email_sends` — those rows appear in
 * the contact's own email timeline, where a notice sent to the owner would read
 * as mail sent to the client. The daily briefing set all three precedents.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { Locale } from '@/lib/i18n/config';
import {
  wrapInBrandedTemplate,
  emailButton,
  emailDetailRow,
  emailDetailsTable,
  type BrandingData,
} from './base-template';
import { emailTranslations } from './translations';

export interface NewEnquiryEmailData {
  /** Which event this is. Decides the subject and the lead-in, nothing else. */
  kind: 'enquiry' | 'quote' | 'cancelled' | 'moved';

  contactName: string;
  contactEmail?: string | null;
  phone?: string | null;

  /** What they wrote. */
  message?: string | null;
  serviceInterest?: string | null;
  referralSource?: string | null;
  pageUrl?: string | null;

  /** Quote only: which service they want a price for. */
  serviceName?: string | null;
  /** The appointment time: the new one for a change, the slot for a quote. */
  whenLocal?: string | null;
  /** A change only: where it used to be, so the owner can picture the move. */
  previousWhenLocal?: string | null;
  /** A cancellation only: what the client said, when they said anything. */
  reason?: string | null;

  /** Deep link to this person in the CRM. */
  contactUrl: string;
  /** Deep link to the switch that turns these off. */
  settingsUrl: string;

  branding: BrandingData;
  locale?: Locale;
}

export function generateNewEnquiryEmail(data: NewEnquiryEmailData): {
  subject: string;
  html: string;
} {
  const locale = data.locale || 'en';
  const t = emailTranslations.newEnquiry;
  const isQuote = data.kind === 'quote';
  const isCancelled = data.kind === 'cancelled';
  const isMoved = data.kind === 'moved';
  // A change to an existing appointment. Same layout, different verbs.
  const isChange = isCancelled || isMoved;

  // Set locale on branding so the shell renders RTL for Hebrew.
  const brandingWithLocale = { ...data.branding, locale };
  const isRTL = locale === 'he';

  const name = data.contactName?.trim() || data.contactEmail?.trim() || '—';

  /*
   * Every value below is typed by a stranger on a public form and lands in an
   * HTML document. Escaped rather than trusted — `emailDetailRow` interpolates
   * its arguments directly.
   */
  const rows: string[] = [];
  rows.push(emailDetailRow(t.nameLabel[locale], escapeHtml(name), data.branding));

  if (data.contactEmail) {
    rows.push(emailDetailRow(t.emailLabel[locale], escapeHtml(data.contactEmail), data.branding));
  }
  if (data.phone) {
    rows.push(emailDetailRow(t.phoneLabel[locale], escapeHtml(data.phone), data.branding));
  }
  if ((isQuote || isChange) && data.serviceName) {
    rows.push(emailDetailRow(t.serviceLabel[locale], escapeHtml(data.serviceName), data.branding));
  }
  if ((isQuote || isChange) && data.whenLocal) {
    rows.push(emailDetailRow(t.whenLabel[locale], escapeHtml(data.whenLocal), data.branding));
  }
  if (!isQuote && !isChange && data.serviceInterest) {
    rows.push(emailDetailRow(t.interestLabel[locale], escapeHtml(data.serviceInterest), data.branding));
  }
  if (isChange && data.previousWhenLocal) {
    rows.push(emailDetailRow(t.wasLabel[locale], escapeHtml(data.previousWhenLocal), data.branding));
  }
  if (isCancelled && data.reason) {
    rows.push(emailDetailRow(t.reasonLabel[locale], escapeHtml(data.reason), data.branding));
  }
  if (data.referralSource) {
    rows.push(emailDetailRow(t.referralLabel[locale], escapeHtml(data.referralSource), data.branding));
  }
  if (data.pageUrl) {
    rows.push(emailDetailRow(t.pageLabel[locale], escapeHtml(data.pageUrl), data.branding));
  }

  /*
   * The message gets its own block rather than a detail row.
   *
   * It is the only part the owner actually reads to decide what to do, it runs
   * to several lines, and a table cell squeezes it into one. Newlines are
   * converted AFTER escaping, so a message containing markup cannot smuggle a
   * tag through on the back of a line break.
   */
  const messageBlock = data.message
    ? `
    <p style="margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: ${
      data.branding.mutedTextColor || '#8A91A5'
    };">
      ${t.messageLabel[locale]}
    </p>
    <div style="margin: 0 0 20px; padding: 14px 16px; border-radius: ${
      data.branding.radius || '8px'
    }; background: ${data.branding.mutedSurfaceColor || '#F6F7FA'}; font-size: 15px; line-height: 1.55; color: ${
        data.branding.textColor || '#3A4256'
      }; direction: ${isRTL ? 'rtl' : 'ltr'};">
      ${escapeHtml(data.message).replace(/\n/g, '<br />')}
    </div>`
    : '';

  const content = `
    <h1 style="margin: 0 0 4px; font-size: 21px; font-weight: 600; color: ${
      data.branding.textColor || '#131A2B'
    };">
      ${
        isCancelled
          ? t.headingCancelled[locale]
          : isMoved
            ? t.headingMoved[locale]
            : isQuote
              ? t.headingQuote[locale]
              : t.headingEnquiry[locale]
      }
    </h1>
    <p style="margin: 0 0 18px; font-size: 13px; color: ${data.branding.mutedTextColor || '#8A91A5'};">
      ${
        isCancelled
          ? t.leadInCancelled[locale]
          : isMoved
            ? t.leadInMoved[locale]
            : isQuote
              ? t.leadInQuote[locale]
              : t.leadInEnquiry[locale]
      }
    </p>

    ${emailDetailsTable(rows, data.branding)}

    ${messageBlock}

    ${emailButton(t.viewContact[locale], data.contactUrl, { branding: data.branding })}

    <p style="margin: 22px 0 0; font-size: 12px; color: ${data.branding.mutedTextColor || '#8A91A5'};">
      ${t.replyHint[locale]}
    </p>
    <p style="margin: 8px 0 0; font-size: 12px; color: ${data.branding.mutedTextColor || '#8A91A5'};">
      ${t.unsubscribeHint[locale]}
      <a href="${data.settingsUrl}" style="color: ${data.branding.mutedTextColor || '#8A91A5'};">${
        t.unsubscribeLink[locale]
      }</a>
    </p>
  `;

  const subjectTemplate = isCancelled
    ? t.subjectCancelled[locale]
    : isMoved
      ? t.subjectMoved[locale]
      : isQuote
        ? t.subjectQuote[locale]
        : null;

  const subject = subjectTemplate
    ? subjectTemplate
        .replace('{name}', name)
        .replace('{service}', data.serviceName || '')
        .trim()
    : t.subjectEnquiry[locale].replace('{name}', name);

  return {
    subject,
    html: wrapInBrandedTemplate(content, brandingWithLocale),
  };
}

/**
 * Public-form text going into an HTML document. Escaped rather than trusted.
 *
 * Note the subject line is deliberately NOT escaped: a mail subject is not
 * HTML, and `&amp;` there would be shown literally to the reader.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
