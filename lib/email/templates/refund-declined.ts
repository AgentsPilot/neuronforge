/**
 * The owner's own words, in the business's own envelope.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS TEMPLATE HOLDS ALMOST NOTHING
 *
 * Its sibling `refund-confirmation.ts` writes the whole message: an amount, a
 * date, a line about when the money lands. That works because a refund is good
 * news in a predictable shape.
 *
 * A decline is not. What makes it bearable is that it answers what the client
 * actually said, which is why the body here is the owner's text — drafted by
 * the agent, read and edited by a person — and this file only puts it in the
 * business's frame so it does not arrive looking like a stranger's email.
 *
 * So: no figure, no reason, no policy line, no "unfortunately" the owner did
 * not write. Everything this template adds, it adds around the message rather
 * than inside it.
 *
 * The subject names the request rather than the answer. "Refund declined" in a
 * subject line is a refusal delivered in the inbox list, before the client has
 * opened anything the owner took the trouble to write.
 *
 * @module lib/email/templates/refund-declined
 */

import {
  wrapInBrandedTemplate,
  emailPalette,
  emailDetailRow,
  emailDetailsTable,
  formatCurrency,
  type BrandingData,
} from './base-template';
import { emailTranslations } from './translations';
import type { Locale } from '@/lib/i18n/config';
/* The shared escaper the templates use, from its own module: `base-template`
   imports it rather than re-exporting it. */
import { escapeHtml } from '@/lib/email/escapeHtml';

export interface RefundDeclinedEmailData {
  /** The owner's message, as approved. Plain text; newlines become paragraphs. */
  message: string;
  /** What they asked about, where it is known. */
  serviceName?: string | null;
  /**
   * ───────────────────────────────────────────────────────────────────────────
   * WHICH REQUEST THIS ANSWERS.
   *
   * The message alone left the client to work that out. Somebody with two
   * bookings and one refund request in the air received a paragraph saying no
   * — with no amount, no date, and nothing naming what it was about beyond a
   * subject line they may not have read.
   *
   * These are facts already on the record, not an argument: what they asked
   * for, when the appointment was, when they asked. They go UNDER the owner's
   * words, because the answer is the message and this is the file reference.
   * Every one is optional — a request with no booking behind it simply shows
   * fewer rows rather than an empty table.
   * ───────────────────────────────────────────────────────────────────────────
   */
  amountRequested?: number | null;
  currency?: string | null;
  /** When the appointment was, as an ISO instant. */
  bookingAt?: string | null;
  /** When they asked, as an ISO instant. */
  requestedAt?: string | null;
  /** The business's own clock, for both dates. `user_preferences.timezone`. */
  timezone?: string;
  locale?: Locale;
  branding: BrandingData;
}

export function generateRefundDeclinedEmail(data: RefundDeclinedEmailData): {
  subject: string;
  html: string;
} {
  const { message, serviceName, branding } = data;
  const palette = emailPalette(branding);

  /*
   * Paragraphs, from the blank lines the owner typed. Escaped first: this is
   * text a person wrote into a form, and an apostrophe or an ampersand in it
   * must not become markup.
   */
  const paragraphs = message
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${palette.ink};">${escapeHtml(
          block
        ).replace(/\n/g, '<br>')}</p>`
    )
    .join('');

  const subject = serviceName
    ? `About your refund request — ${serviceName}`
    : 'About your refund request';

  /*
   * WHICH REQUEST THIS ANSWERS, under the answer itself.
   *
   * Dates on the BUSINESS's clock (`user_preferences.timezone`, the only
   * authoritative one — see `resolveBusinessTimezone`). Without a zone the
   * date is still named rather than dropped: a day is recognisable even when
   * the hour is a server's, and "Monday 24 November" is what the client is
   * matching against their own memory.
   */
  const locale = data.locale ?? 'en';
  const labels = emailTranslations.refundDeclined;
  const intlLocale = ({ en: 'en-US', es: 'es-ES', he: 'he-IL' } as const)[locale] ?? 'en-US';

  const named = (iso: string, withTime: boolean) => {
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) return null;
    return when.toLocaleString(intlLocale, {
      weekday: withTime ? 'long' : undefined,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
      ...(data.timezone ? { timeZone: data.timezone } : {}),
    });
  };

  const rows: string[] = [];

  if (serviceName) {
    rows.push(emailDetailRow(labels.serviceLabel[locale], serviceName, branding));
  }

  const bookingWhen = data.bookingAt ? named(data.bookingAt, true) : null;
  if (bookingWhen) {
    rows.push(emailDetailRow(labels.bookingAtLabel[locale], bookingWhen, branding));
  }

  if (typeof data.amountRequested === 'number' && data.amountRequested > 0 && data.currency) {
    rows.push(
      emailDetailRow(
        labels.amountLabel[locale],
        formatCurrency(data.amountRequested, data.currency),
        branding
      )
    );
  }

  const askedWhen = data.requestedAt ? named(data.requestedAt, false) : null;
  if (askedWhen) {
    rows.push(emailDetailRow(labels.requestedAtLabel[locale], askedWhen, branding));
  }

  /* No rows, no table. A request with nothing behind it keeps the email it
     had: the owner's words, and nothing standing in for facts we lack. */
  const details = rows.length
    ? `<p style="margin:24px 0 8px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${palette.inkMuted};">${
        labels.detailsTitle[locale]
      }</p>${emailDetailsTable(rows, branding)}`
    : '';

  return {
    subject,
    html: wrapInBrandedTemplate(paragraphs + details, branding),
  };
}
