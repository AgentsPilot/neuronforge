// lib/email/templates/welcome-email.ts
// Welcome/Thank You email template for contact form submissions

import type { Locale } from '@/lib/i18n/config';
import {
  wrapInBrandedTemplate,
  emailButton,
  emailNoticeBox,
  type BrandingData
} from './base-template';
import { emailTranslations } from './translations';

export interface WelcomeEmailData {
  clientName: string;
  clientEmail: string;
  message?: string;
  serviceInterest?: string;
  websiteUrl?: string;
  bookingUrl?: string;
  branding: BrandingData;
  /** Locale for email content (defaults to 'en') */
  locale?: Locale;
}

/**
 * Generate welcome/thank you email after contact form submission (new contacts)
 */
export function generateWelcomeEmail(data: WelcomeEmailData): {
  subject: string;
  html: string;
} {
  const { clientName, message, serviceInterest, websiteUrl, bookingUrl, branding, locale = 'en' } = data;
  const firstName = clientName.split(' ')[0] || clientName;
  const t = emailTranslations.welcome;

  // Set locale on branding for RTL support
  const brandingWithLocale = { ...branding, locale };

  const content = `
    <!-- Greeting -->
    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: #1a1a1a;">
      ${t.greeting[locale]}
    </h2>
    <p style="margin: 0 0 24px; font-size: 15px; color: #666666; line-height: 1.6;">
      ${t.intro[locale](firstName, branding.businessName)}
    </p>

    ${serviceInterest ? `
    <!-- Service Interest -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px; background-color: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
      <tr>
        <td style="padding: 20px;">
          <p style="margin: 0 0 4px; font-size: 12px; font-weight: 600; color: ${branding.primaryColor}; text-transform: uppercase; letter-spacing: 0.5px;">
            ${t.serviceInterestLabel[locale]}
          </p>
          <p style="margin: 0; font-size: 16px; color: #1a1a1a; font-weight: 500;">
            ${serviceInterest}
          </p>
        </td>
      </tr>
    </table>
    ` : ''}

    ${message ? `
    <!-- Original Message -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px; background-color: #fafafa; border-radius: 8px; border-${locale === 'he' ? 'right' : 'left'}: 4px solid ${branding.primaryColor};">
      <tr>
        <td style="padding: 16px 20px;">
          <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; color: #888888; text-transform: uppercase; letter-spacing: 0.5px;">
            ${t.yourMessageLabel[locale]}
          </p>
          <p style="margin: 0; font-size: 14px; color: #444444; line-height: 1.6; font-style: italic;">
            "${message.length > 300 ? message.substring(0, 300) + '...' : message}"
          </p>
        </td>
      </tr>
    </table>
    ` : ''}

    <!-- What's Next -->
    ${emailNoticeBox(t.whatsNext[locale], 'info')}

    ${bookingUrl ? `
    <!-- Book Now CTA -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0;">
      <tr>
        <td>
          <p style="margin: 0 0 12px; font-size: 15px; color: #1a1a1a;">
            ${t.scheduleNow[locale]}
          </p>
          ${emailButton(t.bookCall[locale], bookingUrl, { backgroundColor: branding.primaryColor })}
        </td>
      </tr>
    </table>
    ` : ''}

    <!-- Final Note -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0; padding-top: 24px; border-top: 1px solid #e5e5e5;">
      <tr>
        <td>
          <p style="margin: 0 0 8px; font-size: 14px; color: #666666; line-height: 1.6;">
            ${t.lookingForward[locale]}
          </p>
          <p style="margin: 0; font-size: 14px; color: #1a1a1a; font-weight: 500;">
            ${t.bestRegards[locale]}<br/>
            ${t.theTeam[locale](branding.businessName)}
          </p>
        </td>
      </tr>
    </table>

    ${websiteUrl ? `
    <p style="margin: 24px 0 0; font-size: 13px; color: #888888;">
      ${emailTranslations.common.footer.visitWebsite[locale]}: <a href="${websiteUrl}" style="color: ${branding.primaryColor}; text-decoration: none;">${websiteUrl.replace(/^https?:\/\//, '')}</a>
    </p>
    ` : ''}
  `;

  return {
    subject: t.subject[locale](branding.businessName),
    html: wrapInBrandedTemplate(content, brandingWithLocale)
  };
}

/**
 * Generate returning contact email after contact form submission (existing contacts)
 */
export function generateReturningContactEmail(data: WelcomeEmailData): {
  subject: string;
  html: string;
} {
  const { clientName, message, serviceInterest, websiteUrl, bookingUrl, branding, locale = 'en' } = data;
  const firstName = clientName.split(' ')[0] || clientName;
  const t = emailTranslations.returningContact;

  // Set locale on branding for RTL support
  const brandingWithLocale = { ...branding, locale };

  const content = `
    <!-- Greeting -->
    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: #1a1a1a;">
      ${t.greeting[locale]}
    </h2>
    <p style="margin: 0 0 24px; font-size: 15px; color: #666666; line-height: 1.6;">
      ${t.intro[locale](firstName, branding.businessName)}
    </p>

    ${serviceInterest ? `
    <!-- Service Interest -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px; background-color: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
      <tr>
        <td style="padding: 20px;">
          <p style="margin: 0 0 4px; font-size: 12px; font-weight: 600; color: ${branding.primaryColor}; text-transform: uppercase; letter-spacing: 0.5px;">
            ${t.serviceInterestLabel[locale]}
          </p>
          <p style="margin: 0; font-size: 16px; color: #1a1a1a; font-weight: 500;">
            ${serviceInterest}
          </p>
        </td>
      </tr>
    </table>
    ` : ''}

    ${message ? `
    <!-- Original Message -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px; background-color: #fafafa; border-radius: 8px; border-${locale === 'he' ? 'right' : 'left'}: 4px solid ${branding.primaryColor};">
      <tr>
        <td style="padding: 16px 20px;">
          <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; color: #888888; text-transform: uppercase; letter-spacing: 0.5px;">
            ${t.yourMessageLabel[locale]}
          </p>
          <p style="margin: 0; font-size: 14px; color: #444444; line-height: 1.6; font-style: italic;">
            "${message.length > 300 ? message.substring(0, 300) + '...' : message}"
          </p>
        </td>
      </tr>
    </table>
    ` : ''}

    <!-- What's Next -->
    ${emailNoticeBox(t.whatsNext[locale], 'info')}

    ${bookingUrl ? `
    <!-- Book Now CTA -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0;">
      <tr>
        <td>
          <p style="margin: 0 0 12px; font-size: 15px; color: #1a1a1a;">
            ${t.scheduleNow[locale]}
          </p>
          ${emailButton(t.bookCall[locale], bookingUrl, { backgroundColor: branding.primaryColor })}
        </td>
      </tr>
    </table>
    ` : ''}

    <!-- Final Note -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 24px 0; padding-top: 24px; border-top: 1px solid #e5e5e5;">
      <tr>
        <td>
          <p style="margin: 0 0 8px; font-size: 14px; color: #666666; line-height: 1.6;">
            ${t.lookingForward[locale]}
          </p>
          <p style="margin: 0; font-size: 14px; color: #1a1a1a; font-weight: 500;">
            ${t.bestRegards[locale]}<br/>
            ${t.theTeam[locale](branding.businessName)}
          </p>
        </td>
      </tr>
    </table>

    ${websiteUrl ? `
    <p style="margin: 24px 0 0; font-size: 13px; color: #888888;">
      ${emailTranslations.common.footer.visitWebsite[locale]}: <a href="${websiteUrl}" style="color: ${branding.primaryColor}; text-decoration: none;">${websiteUrl.replace(/^https?:\/\//, '')}</a>
    </p>
    ` : ''}
  `;

  return {
    subject: t.subject[locale](branding.businessName),
    html: wrapInBrandedTemplate(content, brandingWithLocale)
  };
}
