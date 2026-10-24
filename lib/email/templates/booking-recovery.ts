/**
 * The booking somebody started and did not finish.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS ITS OWN TEMPLATE
 *
 * Every other booking email describes something that HAPPENED — a booking, a
 * move, a cancellation. This one describes something that did not, and the
 * difference shows: there is no booking to lay out, no money to account for,
 * and nothing the client has to act on.
 *
 * What it has instead is one link back to the page they left, which is why
 * `page_url` is stored on the attempt rather than rebuilt from the service. A
 * booking page can be reached by subdomain, custom domain, landing page or
 * smart link, and a reconstructed address drops whichever of those brought
 * them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  wrapInBrandedTemplate,
  emailButton,
  emailPalette,
  formatEmailDate,
  type BrandingData,
} from './base-template';
import { emailTranslations } from './translations';
import { escapeHtml } from '@/lib/email/escapeHtml';

export function generateBookingRecoveryEmail(data: {
  clientName: string;
  serviceName: string;
  /** Null for a product or any service with no slot. */
  startTime: Date | null;
  timezone: string | null;
  /** The page they were on. Absent only for very old attempts. */
  bookAgainUrl: string | null;
  /**
   * The service they were choosing, appended to the link.
   *
   * The stored page is `/c/<code>/book` — the right PAGE and no service, so
   * the button landed them on the list and made them find the course again.
   * `?service=` is read by that page (`initialServiceId`) and opens straight
   * on it, which is what the sibling cancellation email already does for its
   * own "book again".
   */
  serviceId?: string | null;
  branding: BrandingData;
  locale?: 'en' | 'es' | 'he';
}): { subject: string; html: string } {
  const locale = data.locale || 'en';
  const t = emailTranslations.bookingRecovery;

  const brandingWithLocale = { ...data.branding, locale };
  const c = emailPalette(brandingWithLocale);

  /* Same shape as `bookAgainHref` in the cancellation template: respect a
     query string the stored address already carries, rather than assuming a
     bare path — a smart link arrives with `_sid` on it. */
  const bookAgainHref = (() => {
    if (!data.bookAgainUrl || !data.serviceId) return data.bookAgainUrl;
    const joiner = data.bookAgainUrl.includes('?') ? '&' : '?';
    return `${data.bookAgainUrl}${joiner}service=${encodeURIComponent(data.serviceId)}`;
  })();

  const when = data.startTime
    ? formatEmailDate(data.startTime, data.timezone || 'UTC', { locale })
    : null;

  const content = `
    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: ${c.ink};">
      ${t.greeting[locale]}
    </h2>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${c.inkMuted};">
      ${t.intro[locale](escapeHtml(data.clientName))}
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 20px; background-color: ${c.mutedSurface}; border-radius: ${c.radius}; border: 1px solid ${c.line};">
      <tr>
        <td style="padding: 20px;">
          <h3 style="margin: 0 0 ${when ? '8px' : '0'}; font-size: 18px; font-weight: 600; color: ${c.ink};">
            ${escapeHtml(data.serviceName)}
          </h3>
          ${
            when
              ? `<div style="font-size: 14px; color: ${c.inkMuted};">${escapeHtml(when)}</div>`
              : ''
          }
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 16px; font-size: 14px; color: ${c.inkMuted};">
      ${/* Said plainly: nothing was reserved, because reserving it would have
           kept the hour from everybody else while this client was away. */ ''}
      ${when ? t.stillFree[locale] : t.noTime[locale]}
    </p>

    ${bookAgainHref ? emailButton(t.button[locale], bookAgainHref, { branding: brandingWithLocale }) : ''}
  `;

  return {
    subject: t.subject[locale](data.serviceName),
    html: wrapInBrandedTemplate(content, brandingWithLocale),
  };
}
