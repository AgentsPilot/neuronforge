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
  type BrandingData,
} from './base-template';
import { emailTranslations } from './translations';

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

  const greeting = data.clientFirstName
    ? t.greetingNamed[locale].replace('{name}', escapeHtml(data.clientFirstName))
    : t.greeting[locale];

  const validLine = data.validUntil
    ? new Date(`${data.validUntil}T12:00:00Z`).toLocaleDateString(intlLocale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  const rows = [emailDetailRow(t.totalLabel[locale], formatCurrency(data.total, data.currency))];

  if (data.dueOnAccept && data.dueOnAccept > 0 && data.dueOnAccept !== data.total) {
    rows.push(
      emailDetailRow(t.dueOnAcceptLabel[locale], formatCurrency(data.dueOnAccept, data.currency))
    );
  }
  if (validLine) {
    rows.push(emailDetailRow(t.validUntilLabel[locale], escapeHtml(validLine)));
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
    <p style="margin: 22px 0 8px; font-size: 13px; font-weight: 600; color: #131A2B;">
      ${t.stagesTitle[locale]}
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 6px;">
      ${data.stages
        .map(
          stage => `
        <tr>
          <td style="padding: 6px 0; font-size: 14px; color: #3A4256;">${escapeHtml(stage.label)}</td>
          <td style="padding: 6px 0; font-size: 14px; color: #131A2B; text-align: ${locale === 'he' ? 'left' : 'right'}; font-weight: 600;">
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
        <td style="padding: 12px 14px; background: #F6F7FB; border-radius: 8px;">
          <p style="margin: 0; font-size: 14px; color: #3A4256; line-height: 1.5;">
            📎 ${t.attachmentNote[locale]}
            ${data.documentName ? `<strong>${escapeHtml(data.documentName)}</strong>` : ''}
          </p>
        </td>
      </tr>
    </table>`
    : '';

  const content = `
    <h1 style="margin: 0 0 6px; font-size: 21px; font-weight: 600; color: #131A2B;">
      ${greeting}
    </h1>
    <p style="margin: 0 0 18px; font-size: 15px; color: #3A4256; line-height: 1.6;">
      ${data.isRevision ? t.revisedIntro[locale] : t.intro[locale]}
    </p>

    <p style="margin: 0 0 6px; font-size: 16px; font-weight: 600; color: #131A2B;">
      ${escapeHtml(data.title)}
    </p>
    ${
      data.description
        ? `<p style="margin: 0 0 18px; font-size: 14px; color: #555555; line-height: 1.6; white-space: pre-line;">${escapeHtml(
            data.description
          )}</p>`
        : ''
    }

    ${emailDetailsTable(rows)}
    ${stagesBlock}
    ${attachmentBlock}

    <div style="margin-top: 24px;">
      ${emailButton(t.viewCta[locale], data.viewUrl, { backgroundColor: data.branding.primaryColor })}
    </div>

    <p style="margin: 22px 0 0; font-size: 12px; color: #8A91A5;">
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

/** Titles and descriptions are the owner's free text going into HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
