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
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5; -webkit-font-smoothing: antialiased;">
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
                    <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #ffffff; letter-spacing: -0.5px;">
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
      dateOptions.hour12 = locale !== 'he'; // Hebrew typically uses 24h format
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
      hour12: locale !== 'he'
    });
  }
}
