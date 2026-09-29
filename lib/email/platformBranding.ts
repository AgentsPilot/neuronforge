/**
 * The platform's own look for the emails AgentPilot sends as itself: the
 * invitation and the sign-up code (invite-only signup Slice 3a, E-2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PLATFORM EMAILS ONLY
 *
 * Emails a business sends to its clients (bookings, invoices, receipts, intake,
 * proposals, reminders, briefings) carry the business's own logo or name and
 * never this. Nothing stops a template importing it, so a guard test pins who
 * does (`__tests__/platformBranding.test.ts`).
 *
 * THE LOGO URL, AND WHY IT IS NOT `platformUrl()`
 *
 * An email is read on the recipient's device, so the logo must be an absolute
 * https URL that answers. `platformUrl()` falls back to `app.agentspilot.ai`
 * when `NEXT_PUBLIC_APP_URL` is unset, and that host does not answer (SA R-3,
 * checked 2026-09-29). So the variable is read directly, and the logo is used
 * only when it is set and https. Otherwise (unset, `http://localhost:3000`, or
 * anything else) the email shows the text wordmark, which is what it showed
 * before this change.
 *
 * Emails already sent point at this URL for as long as anyone keeps them, so
 * the file must keep answering at `public/images/brand/wordmark.png`, on this
 * host, even if the app later moves (a guard test pins the file).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/email/platformBranding
 */

import type { Locale } from '@/lib/i18n/config';
import { LOGO_HEIGHT, WORDMARK, widthForHeight } from '@/lib/brand/logo';
import type { BrandingData } from '@/lib/email/templates/base-template';

export const PLATFORM_EMAIL_NAME = 'AgentPilot';

/**
 * The wordmark's absolute URL, or `null` when no mail client could fetch it.
 * Read at call time, not at import, so the value in effect is the one used.
 */
export function platformEmailLogoUrl(): string | null {
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim().replace(/\/+$/, '');
  if (!origin.startsWith('https://') || origin.length <= 'https://'.length) return null;
  // WORDMARK.light: dark ink for a light ground, and the email header sits on
  // the page ground (#f5f5f5).
  return `${origin}${WORDMARK.light.src}`;
}

export function platformEmailBranding(locale: Locale): BrandingData {
  const logoUrl = platformEmailLogoUrl();
  const height = LOGO_HEIGHT.header;

  return {
    businessName: PLATFORM_EMAIL_NAME,
    primaryColor: '#0f172a',
    secondaryColor: '#334155',
    locale,
    ...(logoUrl
      ? { logoUrl, logoWidth: widthForHeight(WORDMARK.light, height), logoHeight: height }
      : {}),
  };
}
