/**
 * Asking somebody who enquired to book themselves in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACES
 *
 * The owner reading an enquiry, opening their mail client, finding their own
 * booking link, and writing a message — every time, for every lead, before any
 * work can start. The platform already knows what the business sells, which of
 * those can be booked, and where. So it can write this one.
 *
 * THE VERB IS THE DESIGN
 *
 * A service with `sale_mode: 'proposal'` cannot be bought: `journeySteps` ends
 * it at `request`, with no payment step. Telling that client to "book and pay"
 * lands them on a page that will not let them, and the business looks broken at
 * the moment it was trying to look organised. So `isQuote` switches the
 * subject, the lead-in and the button together — one flag, never three
 * decisions that can drift apart.
 *
 * ONE TEMPLATE, TWO SENDS
 *
 * `reminder` is the chase two days later. It is the same message with one line
 * in front of it, because a follow-up that reads as a different email invites
 * the reader to compare them and notice they are being processed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { Locale } from '@/lib/i18n/config';
import {
  wrapInBrandedTemplate,
  emailButton,
  type BrandingData,
} from './base-template';
import { emailTranslations } from './translations';

export interface BookingInviteEmailData {
  /** Their first name, where we have one. */
  clientName?: string | null;
  /** The business, for the subject line. */
  businessName: string;

  /** Where they go to book or to ask. Already resolved and checked. */
  bookingUrl: string;

  /** The service this invitation is about, when it is about one. */
  serviceName?: string | null;
  /** Quoted work: the journey ends at a request, so the copy must too. */
  isQuote?: boolean;

  /** The two-day chase. Same message, one line in front. */
  reminder?: boolean;

  branding: BrandingData;
  locale?: Locale;
}

export function generateBookingInviteEmail(data: BookingInviteEmailData): {
  subject: string;
  html: string;
} {
  const locale = data.locale || 'en';
  const t = emailTranslations.bookingInvite;
  const isQuote = Boolean(data.isQuote);

  const brandingWithLocale = { ...data.branding, locale };
  const isRTL = locale === 'he';

  // Their first name only. A full name in a greeting reads like a form letter,
  // which is the opposite of what this email is for.
  const firstName = (data.clientName || '').trim().split(/\s+/)[0] || '';
  const greeting = firstName
    ? t.greeting[locale].replace('{name}', escapeHtml(firstName))
    : t.greetingNoName[locale];

  const leadIn = isQuote ? t.leadInQuote[locale] : t.leadInBook[locale];
  const opener = data.reminder ? `${t.reminderPrefix[locale]} ${leadIn}` : leadIn;

  const serviceLine = data.serviceName
    ? `
    <p style="margin: 0 0 18px; font-size: 14px; color: ${
      data.branding.mutedTextColor || '#8A91A5'
    }; direction: ${isRTL ? 'rtl' : 'ltr'};">
      ${t.serviceLabel[locale]}: <strong style="color: ${
        data.branding.textColor || '#3A4256'
      };">${escapeHtml(data.serviceName)}</strong>
    </p>`
    : '';

  const content = `
    <p style="margin: 0 0 12px; font-size: 16px; color: ${data.branding.textColor || '#131A2B'};">
      ${greeting}
    </p>
    <p style="margin: 0 0 18px; font-size: 15px; line-height: 1.55; color: ${
      data.branding.textColor || '#3A4256'
    }; direction: ${isRTL ? 'rtl' : 'ltr'};">
      ${opener}
    </p>

    ${serviceLine}

    ${emailButton(isQuote ? t.ctaQuote[locale] : t.ctaBook[locale], data.bookingUrl, {
      branding: data.branding,
    })}

    <p style="margin: 24px 0 0; font-size: 13px; color: ${
      data.branding.mutedTextColor || '#8A91A5'
    };">
      ${t.signOff[locale]}
    </p>
  `;

  const subject = (isQuote ? t.subjectQuote[locale] : t.subjectBook[locale]).replace(
    '{business}',
    data.businessName
  );

  return {
    subject,
    html: wrapInBrandedTemplate(content, brandingWithLocale),
  };
}

/** Names come from a public form. Escaped rather than trusted. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
