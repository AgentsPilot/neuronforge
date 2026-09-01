/**
 * Resolve the branding an outgoing email should wear.
 *
 * WHY THIS EXISTS
 *
 * The templates were already wired correctly — every one of them threads
 * `branding.primaryColor` through its headings and buttons, not just the header
 * bar. What was broken was the SOURCE. `buildBrandingData` read
 * `business_profiles.primary_color` / `.secondary_color` / `.logo_url`, and none
 * of those columns exist on the table. Every read returned undefined, so every
 * email silently fell back to a hardcoded indigo and no logo, for every user.
 *
 * Meanwhile the design the user actually chose lives on their website homepage
 * (`website_pages.theme`) and nothing in the email stack had ever read it.
 *
 * This module is the missing link. It reads the homepage theme, falls back to
 * the exact colours the emails used before when there is no theme, and never
 * throws — a branding lookup must not be able to stop a receipt going out.
 *
 * @module lib/email/branding
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { resolveBusinessLogo } from '@/lib/branding/businessLogo';
import { getWebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import type { Locale } from '@/lib/i18n/config';
import type { BrandingData } from './templates/base-template';

const logger = createLogger({ module: 'EmailBranding' });

/**
 * What emails looked like before themes were wired in.
 *
 * Kept verbatim rather than "improved": a user with no website page must see no
 * change at all from this work.
 */
export const DEFAULT_EMAIL_BRANDING = {
  primaryColor: '#4F46E5',
  secondaryColor: '#818CF8',
} as const;

/** The subset of the business profile branding needs. Loosely typed because the
 *  repository returns the full row and only these fields matter here. */
interface ProfileLike {
  company_name?: string | null;
  invoice_company_name?: string | null;
  website_url?: string | null;
  logo_url?: string | null;
  /** The business look: colours and fonts, shared with every public surface. */
  theme?: { colors?: Record<string, string>; fonts?: Record<string, string> } | null;
}

/**
 * Build branding for a user's outgoing email.
 *
 * @param userId  Owner of the emails — the tenant whose theme is applied.
 * @param locale  Language the email is written in; drives direction and dates.
 * @param profile Already-loaded business profile, when the caller has one.
 *                Passing it avoids a second query; omitting it is also fine.
 */
export async function resolveEmailBranding(
  userId: string,
  locale?: Locale,
  profile?: ProfileLike | null
): Promise<BrandingData> {
  let resolvedProfile: ProfileLike | null = profile ?? null;
  let theme: { colors?: Record<string, string>; fonts?: Record<string, string> } | null = null;

  try {
    // Load only what is missing. Both lookups are independent, so they run
    // together rather than serially in front of a user waiting on a send.
    const [profileResult, pageResult] = await Promise.all([
      resolvedProfile ? Promise.resolve(null) : businessProfileRepository.findByUserId(userId),
      getWebsitePageRepository(supabaseServer).getHomepage(userId),
    ]);

    if (profileResult?.data) resolvedProfile = profileResult.data as ProfileLike;

    // The business's own look first, the homepage second.
    //
    // Reading the homepage alone meant a business without a website — one
    // reaching clients by booking link — sent every receipt in platform
    // colours, with no way to change it. The page theme stays as the fallback
    // for accounts whose look predates the profile column.
    const profileTheme = (resolvedProfile as { theme?: unknown } | null)?.theme;
    if (profileTheme) {
      theme = profileTheme as { colors?: Record<string, string>; fonts?: Record<string, string> };
    } else if (pageResult?.data?.theme) {
      theme = pageResult.data.theme as { colors?: Record<string, string>; fonts?: Record<string, string> };
    }
  } catch (err) {
    // Branding is decoration. A receipt with default colours is a far better
    // outcome than a receipt that never sends, so this degrades and continues.
    logger.warn({ err, userId }, 'Could not resolve email branding; using defaults');
  }

  const p = resolvedProfile ?? {};

  return {
    businessName: p.company_name || p.invoice_company_name || 'Business',
    logoUrl: (await resolveBusinessLogo(userId, p)) || undefined,
    primaryColor: theme?.colors?.primary || DEFAULT_EMAIL_BRANDING.primaryColor,
    secondaryColor: theme?.colors?.secondary || DEFAULT_EMAIL_BRANDING.secondaryColor,
    websiteUrl: p.website_url || undefined,
    headingFont: theme?.fonts?.heading || undefined,
    bodyFont: theme?.fonts?.body || undefined,
    locale,
  };
}
