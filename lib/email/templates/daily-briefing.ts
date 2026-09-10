/**
 * The morning briefing, as an email.
 *
 * Same facts and the same narrated lines the dashboard card shows — this is a
 * delivery channel, not a second version of the feature. Anything that changes
 * what the briefing says belongs in BriefingFactsService or BriefingNarrator,
 * never here.
 */

import type { Locale } from '@/lib/i18n/config';
import {
  wrapInBrandedTemplate,
  emailButton,
  type BrandingData,
} from './base-template';
import { emailTranslations } from './translations';

export interface DailyBriefingEmailData {
  /** One fact per entry, already narrated in the recipient's language. */
  lines: string[];
  /** The business's own local date for this briefing, 'YYYY-MM-DD'. */
  date: string;
  timezone: string;
  ownerFirstName?: string;
  dashboardUrl: string;
  /** Deep link to the switch that turns this off. */
  settingsUrl: string;
  branding: BrandingData;
  locale?: Locale;
}

export function generateDailyBriefingEmail(data: DailyBriefingEmailData): {
  subject: string;
  html: string;
} {
  const locale = data.locale || 'en';
  const t = emailTranslations.dailyBriefing;

  const intlLocales: Record<Locale, string> = {
    en: 'en-US',
    es: 'es-ES',
    he: 'he-IL',
  };
  const intlLocale = intlLocales[locale] || 'en-US';

  /*
   * Parsed at UTC noon.
   *
   * `data.date` is a calendar date with no time. Parsing it bare gives local
   * midnight, which renders as the previous day anywhere west of UTC — the
   * briefing would be headed "Sunday" on a Monday morning in Los Angeles.
   */
  const formattedDate = new Date(`${data.date}T12:00:00Z`).toLocaleDateString(intlLocale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  // Set locale on branding for RTL support
  const brandingWithLocale = { ...data.branding, locale };
  const isRTL = locale === 'he';

  const greeting = data.ownerFirstName
    ? t.greetingNamed[locale].replace('{name}', escapeHtml(data.ownerFirstName))
    : t.greeting[locale];

  const items = data.lines
    .map(
      line => `
        <tr>
          <td style="padding: 0 0 10px 0; vertical-align: top; width: 14px;">
            <div style="width: 5px; height: 5px; border-radius: 50%; background: #C3C9D8; margin-top: 8px;"></div>
          </td>
          <td style="padding: 0 0 10px 0; font-size: 15px; line-height: 1.5; color: #3A4256;">
            ${escapeHtml(line)}
          </td>
        </tr>`
    )
    .join('');

  const content = `
    <h1 style="margin: 0 0 4px; font-size: 21px; font-weight: 600; color: #131A2B;">
      ${greeting}
    </h1>
    <p style="margin: 0 0 18px; font-size: 13px; color: #8A91A5;">
      ${escapeHtml(formattedDate)}
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
           style="direction: ${isRTL ? 'rtl' : 'ltr'}; margin-bottom: 22px;">
      ${items}
    </table>

    ${emailButton(t.viewDashboard[locale], data.dashboardUrl, { backgroundColor: data.branding.primaryColor })}

    <p style="margin: 24px 0 0; font-size: 12px; color: #8A91A5;">
      ${t.unsubscribeHint[locale]}
      <a href="${data.settingsUrl}" style="color: #8A91A5;">${t.unsubscribeLink[locale]}</a>
    </p>
  `;

  return {
    subject: t.subject[locale].replace('{date}', formattedDate),
    html: wrapInBrandedTemplate(content, brandingWithLocale),
  };
}

/**
 * Narrated lines carry client names and owner notes — arbitrary user text going
 * into an HTML document. Escaped rather than trusted.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
