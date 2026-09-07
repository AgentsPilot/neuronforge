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
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { resolveBusinessLogo } from '@/lib/branding/businessLogo';
import { resolveBusinessTheme } from '@/lib/branding/resolveTheme';
import { resolvePlatformWebsiteUrl } from '@/lib/branding/platformSite';
import { safeExternalUrl } from '@/lib/branding/externalUrl';
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
    if (!resolvedProfile) {
      const { data } = await businessProfileRepository.findByUserId(userId);
      if (data) resolvedProfile = data as ProfileLike;
    }

    /*
     * The look comes from the shared resolver rather than from a lookup of this
     * module's own.
     *
     * It reads the business's own theme first and falls back to a published
     * page, which is what this module already did — except the fallback is now
     * "any page that carries a template" rather than the homepage alone. That
     * is the intended rule (whichever surface a business published first
     * establishes its look), and it fixes a business whose only surface is a
     * landing page silently sending platform-coloured receipts.
     *
     * `raw` is used, not the completed theme: the fields below must stay
     * undefined when the business has chosen nothing, so that an account with
     * no theme sends exactly the email it sent before any of this existed.
     */
    const resolved = await resolveBusinessTheme(
      userId,
      (resolvedProfile as { theme?: unknown } | null)?.theme as never,
      (resolvedProfile as { template_id?: string | null } | null)?.template_id ?? null
    );
    theme = resolved.raw as { colors?: Record<string, string>; fonts?: Record<string, string> } | null;
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
    /*
     * OUR website once it is live, the business's own until then.
     *
     * This read `business_profiles.website_url` and nothing else, so the day a
     * business published a website with us its emails went on advertising its old
     * one — or, far more often, carried no address at all, since nothing could
     * write that column. The colours and the logo already followed the platform
     * page; only the address did not, which made the footer disagree with the
     * email around it.
     *
     * Resolved on every send, which is what makes it switch by itself: publish
     * a website today and tonight's receipts point at it, with nothing to
     * migrate. Unpublish it and they fall back to the business's own address.
     *
     * A landing page does not count — see `platformSite`. It is one campaign,
     * not the business's website, and it disappears when the campaign ends.
     *
     * The external one is sanitised — it is owner-typed text on its way into an
     * href — while ours is built from a subdomain we control.
     */
    websiteUrl:
      (await resolvePlatformWebsiteUrl(userId)) ??
      safeExternalUrl(p.website_url) ??
      undefined,
    headingFont: theme?.fonts?.heading || undefined,
    bodyFont: theme?.fonts?.body || undefined,
    locale,
  };
}
