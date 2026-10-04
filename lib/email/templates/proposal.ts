/**
 * The proposal, as the client receives it.
 *
 * Carries the total, what the work is, and how it would be paid — then one
 * button to open it and answer. The PDF goes with it: a ₪60,000 quote is a
 * document someone forwards to their partner and holds against a competitor's,
 * and a link alone does not survive that.
 */

import type { Locale } from '@/lib/i18n/config';
import {
  wrapInBrandedTemplate,
  emailButton,
  emailDetailRow,
  emailDetailsTable,
  formatCurrency,
  emailPalette,
  type BrandingData,
} from './base-template';
import { emailTranslations, clientFacingCancelReason } from './translations';
import { escapeHtml } from '@/lib/email/escapeHtml';

export interface ProposalEmailData {
  title: string;
  description?: string | null;
  total: number;
  currency: string;
  /** Named stages, where the money is split. Empty for a single payment. */
  stages?: Array<{ label: string; amount: number }>;
  /** What falls due the moment they accept. */
  dueOnAccept?: number | null;
  validUntil?: string | null;
  viewUrl: string;
  ownerName?: string | null;
  clientFirstName?: string | null;
  branding: BrandingData;
  locale?: Locale;
  /** True when this replaces a previous version they were already sent. */
  isRevision?: boolean;
  /**
   * Days to pay, once an invoice is raised.
   *
   * Shown because it is a TERM of the offer, not a back-office setting: a
   * client agreeing to ₪50,000 is also agreeing to when it falls due, and
   * finding that out from the first invoice is finding out too late.
   */
  termsDays?: number | null;
  /** Whether the full proposal document is attached to this email. */
  hasDocument?: boolean;
  /** Its filename, so the client knows what they are looking for. */
  documentName?: string | null;
}

export function generateProposalEmail(data: ProposalEmailData): { subject: string; html: string } {
  const locale = data.locale || 'en';
  const t = emailTranslations.proposal;

  const intlLocales: Record<Locale, string> = { en: 'en-US', es: 'es-ES', he: 'he-IL' };
  const intlLocale = intlLocales[locale] || 'en-US';

  // RTL comes from the branding, as it does for every other template.
  const brandingWithLocale = { ...data.branding, locale };
  // Ink and panels against THIS business's card, not against a white one.
  const c = emailPalette(brandingWithLocale);

  const greeting = data.clientFirstName
    ? t.greetingNamed[locale].replace('{name}', escapeHtml(data.clientFirstName))
    : t.greeting[locale];

  const validLine = data.validUntil
    ? new Date(`${data.validUntil}T12:00:00Z`).toLocaleDateString(intlLocale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        // Read back in the zone it was anchored in, so "valid until" names the
        // stored date rather than the server's view of noon UTC.
        timeZone: 'UTC',
      })
    : null;

  const rows = [emailDetailRow(t.totalLabel[locale], formatCurrency(data.total, data.currency), brandingWithLocale)];

  if (data.dueOnAccept && data.dueOnAccept > 0 && data.dueOnAccept !== data.total) {
    rows.push(
      emailDetailRow(t.dueOnAcceptLabel[locale], formatCurrency(data.dueOnAccept, data.currency), brandingWithLocale)
    );
  }
  if (typeof data.termsDays === 'number') {
    rows.push(
      emailDetailRow(
        t.paymentTermsLabel[locale],
        data.termsDays === 0
          ? t.dueOnReceipt[locale]
          : t.netDays[locale].replace('{days}', String(data.termsDays)), brandingWithLocale)
    );
  }

  if (validLine) {
    rows.push(emailDetailRow(t.validUntilLabel[locale], escapeHtml(validLine), brandingWithLocale));
  }

  /*
   * The stages are listed, not summarised.
   *
   * "Paid in 3" tells a client nothing they can agree to. What they are being
   * asked to accept is a schedule — how much, and against what — so it is
   * spelled out before they click anything.
   */
  const stagesBlock =
    data.stages && data.stages.length > 1
      ? `
    <p style="margin: 22px 0 8px; font-size: 13px; font-weight: 600; color: ${c.ink};">
      ${t.stagesTitle[locale]}
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 6px;">
      ${data.stages
        .map(
          stage => `
        <tr>
          <td style="padding: 6px 0; font-size: 14px; color: ${c.inkMuted};">${escapeHtml(stage.label)}</td>
          <td style="padding: 6px 0; font-size: 14px; color: ${c.ink}; text-align: ${locale === 'he' ? 'left' : 'right'}; font-weight: 600;">
            ${formatCurrency(stage.amount, data.currency)}
          </td>
        </tr>`
        )
        .join('')}
    </table>`
      : '';

  /*
   * Says the document is attached, and names it.
   *
   * Without a line like this the attachment is a paperclip icon the client may
   * never notice — and the page they land on will not let them accept until
   * they have read it, which would be baffling rather than reassuring. Naming
   * the file also tells them what they are looking for in a thread that may
   * already have several.
   */
  const attachmentBlock = data.hasDocument
    ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top: 20px;">
      <tr>
        <td style="padding: 12px 14px; background: ${c.mutedSurface}; border-radius: ${c.buttonRadius};">
          <p style="margin: 0; font-size: 14px; color: ${c.inkMuted}; line-height: 1.5;">
            📎 ${t.attachmentNote[locale]}
            ${data.documentName ? `<strong>${escapeHtml(data.documentName)}</strong>` : ''}
          </p>
        </td>
      </tr>
    </table>`
    : '';

  const content = `
    <h1 style="margin: 0 0 6px; font-size: 21px; font-weight: 600; color: ${c.ink};">
      ${greeting}
    </h1>
    <p style="margin: 0 0 18px; font-size: 15px; color: ${c.inkMuted}; line-height: 1.6;">
      ${data.isRevision ? t.revisedIntro[locale] : t.intro[locale]}
    </p>

    <p style="margin: 0 0 6px; font-size: 16px; font-weight: 600; color: ${c.ink};">
      ${escapeHtml(data.title)}
    </p>
    ${
      data.description
        ? `<p style="margin: 0 0 18px; font-size: 14px; color: ${c.inkMuted}; line-height: 1.6; white-space: pre-line;">${escapeHtml(
            data.description
          )}</p>`
        : ''
    }

    ${emailDetailsTable(rows, brandingWithLocale)}
    ${stagesBlock}
    ${attachmentBlock}

    <div style="margin-top: 24px;">
      ${emailButton(t.viewCta[locale], data.viewUrl, { branding: data.branding })}
    </div>

    <p style="margin: 22px 0 0; font-size: 12px; color: ${c.inkFaint};">
      ${t.footerNote[locale]}
    </p>
  `;

  return {
    subject: (data.isRevision ? t.subjectRevised : t.subject)[locale].replace(
      '{title}',
      data.title
    ),
    html: wrapInBrandedTemplate(content, brandingWithLocale),
  };
}

/**
 * The quote stopped part-way, as the client receives it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS LONG
 *
 * This is the email a client reads twice. They agreed a price, paid part of it,
 * and are being told the work has ended — so every figure they might reach for
 * has to be on the page, or they reply asking for it. It states, in this order:
 *
 *   what the job was            named, not "your recent order"
 *   what was agreed             the original total
 *   what they have paid         so the arithmetic below can be checked
 *   what is now cancelled       invoices voided, stages that will not be billed
 *   the owner's note            when they wrote one
 *   what happens to the money   the ONE thing silence would be worst about
 *
 * THE REASON CODE IS NEVER SHOWN. `client_not_paying` and `owner_cannot_deliver`
 * are the owner's internal vocabulary, and several of the codes would read as an
 * accusation in a client's inbox. The free-text note is the owner's to send.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export interface QuoteStoppedEmailData {
  title: string;
  /** What was originally agreed, so the money below can be checked against it. */
  total: number;
  currency: string;
  /** Collected across every stage, before any refund. */
  paidAmount: number;
  /** Handed back as part of this stop. Zero when nothing was returned. */
  refundedAmount: number;
  /** Invoices voided by the stop — they may be sitting in the client's inbox. */
  invoicesVoided: number;
  /** Stages that had not been invoiced and now never will be. */
  stagesClosed: number;
  /**
   * The owner's own sentence — passed ONLY when they chose to share it.
   *
   * Withholding happens at the caller, not here: a template that decides what to
   * hide is a template someone will forget to check.
   */
  note?: string | null;
  /**
   * The reason code, rendered in its CLIENT-SAFE phrasing.
   *
   * Never printed raw. `client_not_paying` is an accurate record and an
   * accusation to receive, so `clientFacingCancelReason` maps each code to a
   * neutral sentence and returns nothing for the ones that have none
   * (`test_booking`, `other`). That is why the client still learns why the work
   * stopped even when the owner keeps their note private.
   */
  reasonCode?: string | null;
  clientFirstName?: string | null;
  branding: BrandingData;
  locale?: Locale;
}

export function generateQuoteStoppedEmail(
  data: QuoteStoppedEmailData
): { subject: string; html: string } {
  const locale = data.locale || 'en';
  const t = emailTranslations.quoteStopped;
  const c = emailPalette(data.branding);
  const brandingWithLocale = { ...data.branding, locale };
  const money = (n: number) => formatCurrency(n, data.currency);

  const paid = Math.max(0, data.paidAmount);
  const refunded = Math.max(0, data.refundedAmount);
  /*
   * What the client is left out of pocket. Clamped, because a refund can exceed
   * what this platform recorded as collected — returned from the Stripe dashboard
   * against a charge whose transaction was never fully written back — and a
   * negative "kept" would print as a figure the business owes itself.
   */
  const kept = Math.max(0, paid - refunded);

  const reasonForClient = clientFacingCancelReason(data.reasonCode, locale);

  const greeting = data.clientFirstName
    ? t.greeting[locale].replace('{name}', escapeHtml(data.clientFirstName))
    : t.greetingPlain[locale];

  const rows = [emailDetailRow(t.agreedLabel[locale], money(data.total), brandingWithLocale)];
  // Only when there is some: a "Paid so far: ₪0" line on a job nobody was charged
  // for invites the client to wonder what they missed.
  if (paid > 0) {
    rows.push(emailDetailRow(t.paidLabel[locale], money(paid), brandingWithLocale));
  }

  /*
   * Plural handled as two strings rather than one with an "(s)".
   *
   * Hebrew does not pluralise the way English does, and "1 חשבוניות" is wrong in
   * a way a client notices. Each branch has its own sentence per language.
   */
  const cancelledLines: string[] = [];
  if (data.invoicesVoided > 0) {
    cancelledLines.push(
      (data.invoicesVoided === 1 ? t.invoicesVoided : t.invoicesVoidedPlural)[locale].replace(
        '{count}',
        String(data.invoicesVoided)
      )
    );
  }
  if (data.stagesClosed > 0) {
    cancelledLines.push(
      (data.stagesClosed === 1 ? t.stagesClosed : t.stagesClosedPlural)[locale].replace(
        '{count}',
        String(data.stagesClosed)
      )
    );
  }

  /*
   * Four states, and each one says something different about the client's money.
   * Zero held means either "never paid" or "refunded in full", and those are
   * opposite things to tell somebody.
   */
  const moneyLine =
    paid <= 0
      ? t.moneyNone[locale]
      : refunded > 0 && kept <= 0
        ? t.moneyRefundedFull[locale].replace('{amount}', money(refunded))
        : refunded > 0
          ? t.moneyRefundedPartly[locale]
              .replace('{refunded}', money(refunded))
              .replace('{kept}', money(kept))
          : t.moneyKept[locale].replace('{amount}', money(kept));

  const content = `
    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: ${c.ink};">
      ${greeting}
    </h2>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${c.inkMuted};">
      ${t.intro[locale].replace('{title}', escapeHtml(data.title))}
    </p>

    ${emailDetailsTable(rows, brandingWithLocale)}

    ${cancelledLines.length > 0 ? `
    <h3 style="margin: 24px 0 8px; font-size: 16px; font-weight: 600; color: ${c.ink};">
      ${t.stagesHeading[locale]}
    </h3>
    <ul style="margin: 0 0 16px; padding-inline-start: 20px; font-size: 14px; color: ${c.inkMuted};">
      ${cancelledLines.map(line => `<li style="margin: 0 0 6px;">${line}</li>`).join('')}
    </ul>
    ` : ''}

    ${reasonForClient ? `
    <p style="margin: 16px 0 0; font-size: 14px; color: ${c.inkMuted};">
      <strong style="color: ${c.ink};">${t.reasonHeading[locale]}</strong> ${reasonForClient}
    </p>
    ` : ''}

    ${data.note ? `
    <h3 style="margin: 24px 0 8px; font-size: 16px; font-weight: 600; color: ${c.ink};">
      ${t.noteHeading[locale]}
    </h3>
    <p style="margin: 0 0 16px; font-size: 14px; color: ${c.inkMuted}; white-space: pre-wrap;">${escapeHtml(data.note)}</p>
    ` : ''}

    <p style="margin: 24px 0 16px; font-size: 15px; color: ${c.ink};">
      ${moneyLine}
    </p>

    <p style="margin: 0; font-size: 14px; color: ${c.inkMuted};">
      ${t.questions[locale]}
    </p>
  `;

  return {
    subject: t.subject[locale].replace('{title}', data.title),
    html: wrapInBrandedTemplate(content, brandingWithLocale),
  };
}
