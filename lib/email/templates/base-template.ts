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

  /**
   * The neutrals, derived from the same theme by `lib/email/branding`.
   *
   * All optional, and every one falls back below to the exact value this shell
   * hardcoded before — so a caller that predates this renders byte-identically.
   * An email has no custom properties to inherit, so these arrive already
   * resolved and are written inline.
   */
  /** Black or white, whichever reads on `primaryColor`. */
  onBrand?: string;
  /** Behind the card. */
  pageColor?: string;
  /** The card itself. */
  surfaceColor?: string;
  /** The footer band, and any recessed panel. */
  mutedSurfaceColor?: string;
  borderColor?: string;
  textColor?: string;
  mutedTextColor?: string;
  /** The card's corners; the button's are derived from it. */
  radius?: string;
  buttonRadius?: string;
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

  /*
   * Every fallback is the value this file used to hardcode, so an email sent
   * for a business with no theme is unchanged to the byte.
   */
  const onBrand = branding.onBrand || '#ffffff';
  const page = branding.pageColor || '#f5f5f5';
  const surface = branding.surfaceColor || '#ffffff';
  const mutedSurface = branding.mutedSurfaceColor || '#fafafa';
  const line = branding.borderColor || '#e5e5e5';
  const ink = branding.textColor || '#1a1a1a';
  const inkMuted = branding.mutedTextColor || '#666666';
  const radius = branding.radius || '12px';

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
<body style="margin: 0; padding: 0; font-family: ${bodyStack}; color: ${ink}; background-color: ${page}; -webkit-font-smoothing: antialiased;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${page};">
    <tr>
      <td style="padding: 24px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto;">

          <!--
            THE WORDMARK, QUIET, ON THE PAGE GROUND.

            This was a full-bleed block filled with the brand colour and the
            business name reversed out of it — the standard transactional-SaaS
            header, and the one thing none of the six templates does. Every one
            of them opens with a small wordmark on the page's own ground and
            keeps the brand colour for the single thing the reader is meant to
            do. Stone has no accent colour at all, so an indigo or flame banner
            above its receipt contradicted the design outright.

            The logo where there is one, the name set in the heading face where
            there is not, and a hairline under it instead of a fill.
          -->
          <tr>
            <td style="padding: 4px 4px 18px; text-align: ${textAlign}; direction: ${dir};">
              ${logoUrl ? `
              <img src="${logoUrl}" alt="${businessName}" style="max-height: 34px; max-width: 180px; display: inline-block;" />
              ` : `
              <span style="font-family: ${headingStack}; font-size: 16px; font-weight: 600; color: ${ink}; letter-spacing: -0.02em;">
                ${businessName}
              </span>
              `}
            </td>
          </tr>

          <!-- The message itself, on one panel with a hairline round it. -->
          <tr>
            <td style="padding: 34px 32px; background-color: ${surface}; border: 1px solid ${line}; border-radius: ${radius}; text-align: ${textAlign}; direction: ${dir};">
              ${content}
            </td>
          </tr>

          <!--
            The footer, outside the panel rather than welded to it.

            A second filled block under the first made the whole message read as
            three stacked bars. Every template ends the same way: one rule, the
            name, the address, nothing else.
          -->
          <tr>
            <td style="padding: 18px 4px 4px; text-align: ${textAlign}; direction: ${dir};">
              <p style="margin: 0 0 4px; font-size: 13px; color: ${inkMuted};">
                ${businessName}
              </p>
              ${websiteUrl ? `
              <p style="margin: 0; font-size: 13px;">
                <a href="${websiteUrl}" style="color: ${inkMuted}; text-decoration: none;">${websiteUrl.replace(/^https?:\/\//, '')}</a>
              </p>
              ` : ''}
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
 * The neutrals a helper needs, from a branding object or from the values this
 * file has always hardcoded.
 *
 * The helpers are called from eleven templates and were the last place a
 * business's own colours stopped: every one of them passed
 * `{ backgroundColor: branding.primaryColor }` and then got a `#ffffff` label,
 * an `8px` corner and an `#f0f0f0` rule regardless. Passing the whole branding
 * object instead is what carries the rest — and `onBrand` is the one that
 * matters, because a white label on a pale brand colour is unreadable.
 */
function helperTokens(branding?: BrandingData) {
  return {
    brand: branding?.primaryColor || '#4F46E5',
    onBrand: branding?.onBrand || '#ffffff',
    line: branding?.borderColor || '#f0f0f0',
    ink: branding?.textColor || '#1a1a1a',
    inkMuted: branding?.mutedTextColor || '#666666',
    mutedSurface: branding?.mutedSurfaceColor || '#fafafa',
    radius: branding?.buttonRadius || '8px',
  };
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
    branding?: BrandingData;
  } = {}
): string {
  const tokens = helperTokens(options.branding);
  const {
    color = tokens.onBrand,
    backgroundColor = tokens.brand,
    fullWidth = false
  } = options;

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" ${fullWidth ? 'width="100%"' : ''} style="margin: 16px 0;">
      <tr>
        <td style="border-radius: ${tokens.radius}; background-color: ${backgroundColor};">
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
    branding?: BrandingData;
  } = {}
): string {
  const tokens = helperTokens(options.branding);
  const { color = tokens.brand, fullWidth = false } = options;

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" ${fullWidth ? 'width="100%"' : ''} style="margin: 8px 0;">
      <tr>
        <td style="border-radius: ${tokens.radius}; border: 2px solid ${color}; background-color: transparent;">
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
export function emailDetailRow(label: string, value: string, branding?: BrandingData): string {
  const tokens = helperTokens(branding);
  return `
    <tr>
      <td style="padding: 8px 0; border-bottom: 1px solid ${tokens.line};">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          <tr>
            <td style="font-size: 14px; color: ${tokens.inkMuted}; width: 35%;">${label}</td>
            <td style="font-size: 14px; color: ${tokens.ink}; font-weight: 500;">${value}</td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

/**
 * Generate a details table wrapper
 */
export function emailDetailsTable(rows: string[], branding?: BrandingData): string {
  const tokens = helperTokens(branding);
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 16px 0; background-color: ${tokens.mutedSurface}; border-radius: ${tokens.radius}; padding: 16px;">
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
