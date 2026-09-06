// lib/email/templates/base-template.ts
// Branded HTML email wrapper that pulls from business profile

import type { Locale } from '@/lib/i18n/config';
import { isRTL } from '@/lib/i18n/config';

export interface BrandingData {
  businessName: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  websiteUrl?: string;
  /** Locale for email content (defaults to 'en') */
  locale?: Locale;
  /**
   * Typography from the user's website theme (`website_pages.theme.fonts`).
   *
   * Optional on purpose: every caller that predates this renders exactly as it
   * did before, on the system stack below. When present the name is prepended
   * to that same stack, so a client without the face still falls back to a
   * readable default rather than to a serif nobody chose.
   */
  headingFont?: string;
  bodyFont?: string;
}

/**
 * The stack every email fell back to before themes were wired in. Kept as the
 * tail of every font-family so an unavailable web font degrades to the previous
 * appearance instead of to the client's default.
 */
const FALLBACK_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** Quote a font name for CSS only when it needs it, then append the fallbacks. */
function fontStack(name?: string): string {
  if (!name) return FALLBACK_FONT_STACK;
  const trimmed = name.trim();
  if (!trimmed) return FALLBACK_FONT_STACK;
  const quoted = /^[A-Za-z0-9-]+$/.test(trimmed) ? trimmed : `'${trimmed.replace(/'/g, '')}'`;
  return `${quoted}, ${FALLBACK_FONT_STACK}`;
}

/**
 * Ask the client to load the theme's web fonts.
 *
 * Many clients strip this, which is why it is additive only — the fallback
 * chain above is what guarantees the email stays readable either way.
 */
function fontLink(headingFont?: string, bodyFont?: string): string {
  const families = [...new Set([headingFont, bodyFont].filter(Boolean) as string[])];
  if (families.length === 0) return '';
  const query = families
    .map((f) => `family=${encodeURIComponent(f.trim()).replace(/%20/g, '+')}:wght@400;600;700`)
    .join('&');
  return `\n  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${query}&display=swap">`;
}

/**
 * Wrap email content in a branded HTML template
 * Uses inline styles for maximum email client compatibility
 */
export function wrapInBrandedTemplate(
  content: string,
  branding: BrandingData
): string {
  const { businessName, logoUrl, primaryColor, websiteUrl, locale = 'en' } = branding;

  // Determine text direction based on locale
  const rtl = isRTL(locale);
  const dir = rtl ? 'rtl' : 'ltr';
  const textAlign = rtl ? 'right' : 'left';

  const bodyStack = fontStack(branding.bodyFont);
  const headingStack = fontStack(branding.headingFont);

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${businessName}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->${fontLink(branding.headingFont, branding.bodyFont)}
</head>
<body style="margin: 0; padding: 0; font-family: ${bodyStack}; background-color: #f5f5f5; -webkit-font-smoothing: antialiased;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f5f5f5;">
    <tr>
      <td style="padding: 24px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto;">

          <!-- Header with Logo/Business Name -->
          <tr>
            <td style="padding: 24px 32px; background-color: ${primaryColor}; border-radius: 12px 12px 0 0;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="text-align: center;">
                    ${logoUrl ? `
                    <img src="${logoUrl}" alt="${businessName}" style="max-height: 48px; max-width: 200px; display: inline-block;" />
                    ` : `
                    <h1 style="margin: 0; font-family: ${headingStack}; font-size: 24px; font-weight: 600; color: #ffffff; letter-spacing: -0.5px;">
                      ${businessName}
                    </h1>
                    `}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 32px; background-color: #ffffff; border-left: 1px solid #e5e5e5; border-right: 1px solid #e5e5e5; text-align: ${textAlign}; direction: ${dir};">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #fafafa; border: 1px solid #e5e5e5; border-top: none; border-radius: 0 0 12px 12px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="text-align: center;">
                    <p style="margin: 0 0 8px; font-size: 14px; color: #666666;">
                      ${businessName}
                    </p>
                    ${websiteUrl ? `
                    <p style="margin: 0; font-size: 13px;">
                      <a href="${websiteUrl}" style="color: ${primaryColor}; text-decoration: none;">${websiteUrl.replace(/^https?:\/\//, '')}</a>
                    </p>
                    ` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Generate a styled button for email templates
 */
export function emailButton(
  text: string,
  url: string,
  options: {
    color?: string;
    backgroundColor?: string;
    fullWidth?: boolean;
  } = {}
): string {
  const {
    color = '#ffffff',
    backgroundColor = '#4F46E5',
    fullWidth = false
  } = options;

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" ${fullWidth ? 'width="100%"' : ''} style="margin: 16px 0;">
      <tr>
        <td style="border-radius: 8px; background-color: ${backgroundColor};">
          <a href="${url}" target="_blank" style="display: inline-block; padding: 14px 28px; font-size: 15px; font-weight: 600; color: ${color}; text-decoration: none; text-align: center; ${fullWidth ? 'width: 100%; box-sizing: border-box;' : ''}">
            ${text}
          </a>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Generate a secondary/outline button for email templates
 */
export function emailOutlineButton(
  text: string,
  url: string,
  options: {
    color?: string;
    fullWidth?: boolean;
  } = {}
): string {
  const { color = '#4F46E5', fullWidth = false } = options;

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" ${fullWidth ? 'width="100%"' : ''} style="margin: 8px 0;">
      <tr>
        <td style="border-radius: 8px; border: 2px solid ${color}; background-color: transparent;">
          <a href="${url}" target="_blank" style="display: inline-block; padding: 12px 24px; font-size: 14px; font-weight: 600; color: ${color}; text-decoration: none; text-align: center; ${fullWidth ? 'width: 100%; box-sizing: border-box;' : ''}">
            ${text}
          </a>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Generate a detail row (label: value format)
 */
export function emailDetailRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          <tr>
            <td style="font-size: 14px; color: #666666; width: 35%;">${label}</td>
            <td style="font-size: 14px; color: #1a1a1a; font-weight: 500;">${value}</td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

/**
 * Generate a details table wrapper
 */
export function emailDetailsTable(rows: string[]): string {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 16px 0; background-color: #fafafa; border-radius: 8px; padding: 16px;">
      <tbody>
        ${rows.join('')}
      </tbody>
    </table>
  `;
}

/**
 * Generate an info/notice box
 */
export function emailNoticeBox(
  content: string,
  type: 'info' | 'warning' | 'success' = 'info'
): string {
  const colors = {
    info: { bg: '#EFF6FF', border: '#3B82F6', text: '#1E40AF' },
    warning: { bg: '#FFFBEB', border: '#F59E0B', text: '#92400E' },
    success: { bg: '#F0FDF4', border: '#22C55E', text: '#166534' }
  };
  const c = colors[type];

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 16px 0;">
      <tr>
        <td style="padding: 16px; background-color: ${c.bg}; border-left: 4px solid ${c.border}; border-radius: 4px;">
          <p style="margin: 0; font-size: 14px; color: ${c.text};">
            ${content}
          </p>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number, currency: string): string {
  const symbols: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    ILS: '₪',
    CAD: 'CA$',
    AUD: 'A$'
  };
  const symbol = symbols[currency.toUpperCase()] || currency + ' ';
  return `${symbol}${amount.toFixed(2)}`;
}

/**
 * Format date for email display with locale support
 */
export function formatEmailDate(
  date: Date,
  timezone: string,
  options: { includeTime?: boolean; includeYear?: boolean; locale?: Locale } = {}
): string {
  const { includeTime = true, includeYear = true, locale = 'en' } = options;

  // Map our locales to Intl locale codes
  const intlLocales: Record<Locale, string> = {
    en: 'en-US',
    es: 'es-ES',
    he: 'he-IL'
  };
  const intlLocale = intlLocales[locale] || 'en-US';

  try {
    const dateOptions: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: timezone
    };

    if (includeYear) {
      dateOptions.year = 'numeric';
    }

    if (includeTime) {
      dateOptions.hour = 'numeric';
      dateOptions.minute = '2-digit';
      // Always use 12-hour format with AM/PM for client-facing emails
      dateOptions.hour12 = true;
    }

    return new Intl.DateTimeFormat(intlLocale, dateOptions).format(date);
  } catch {
    // Fallback if timezone is invalid
    return date.toLocaleString(intlLocale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: includeYear ? 'numeric' : undefined,
      hour: includeTime ? 'numeric' : undefined,
      minute: includeTime ? '2-digit' : undefined,
      // Always use 12-hour format with AM/PM for client-facing emails
      hour12: true
    });
  }
}
