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
import { isDarkColor, mix, onColor } from '@/lib/branding/color';
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
     * THE COMPLETED THEME, once the business has chosen anything.
     *
     * This used `raw` — the profile's JSONB verbatim — so that an account which
     * had chosen nothing kept sending exactly the email it always had. The
     * intent was right and the mechanism was wrong, because `raw` is not always
     * a whole theme.
     *
     * The design tab saves only the two colours and two faces it edits. From
     * that moment a business on Lumen has a profile theme with no `background`
     * and no `borderRadius`, while its `template_id` still says `lumen`. Every
     * web surface survives that — `completeTheme` restores Lumen's ground from
     * the template — but reading `raw` here did not, so every receipt, booking
     * confirmation and invoice silently flipped from near-black at 30px to
     * white at 12px while the website it linked to stayed dark.
     *
     * So: the completed theme whenever the business has chosen a template or
     * stored a look, and nothing at all when it has not. The original intent is
     * preserved by the second half of that sentence, not by reading a blob that
     * may be four fields deep.
     */
    const resolved = await resolveBusinessTheme(
      userId,
      (resolvedProfile as { theme?: unknown } | null)?.theme as never,
      (resolvedProfile as { template_id?: string | null } | null)?.template_id ?? null
    );

    const hasChosenALook = Boolean(resolved.templateId || resolved.raw);
    theme = hasChosenALook
      ? (resolved.theme as unknown as { colors?: Record<string, string>; fonts?: Record<string, string> })
      : null;
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
    ...emailTokens(theme),
  };
}

/**
 * The neutrals, derived the same way the web pages derive theirs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY AN EMAIL NEEDS THESE AT ALL
 *
 * The shell got the brand colour and the fonts and hardcoded everything else:
 * `#f5f5f5` behind the card, `#ffffff` for the card, `#e5e5e5` for its borders,
 * `#fafafa` in the footer, `#666666` for muted copy, `12px` and `8px` radii. So
 * a business on a near-black archetype with 30px corners received a white email
 * with 12px corners and a coloured strip at the top — its website and its
 * receipts visibly made by different people.
 *
 * `mix` and `onColor` are the SAME helpers `PublicThemeStyle` uses, so a colour
 * cannot come out one shade on the page and another in the email. Nothing here
 * is a new decision; it is the existing derivation, evaluated on the server and
 * written inline because an email has no custom properties to inherit.
 *
 * WHAT AN EMAIL CANNOT HAVE
 *
 * Web fonts land in Apple Mail and most webmail and are ignored by Outlook on
 * Windows, which is why `fontStack` in the shell always ends in a real system
 * fallback. The colours and the geometry, by contrast, arrive everywhere —
 * which is most of what makes one business's mail look like its own.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function emailTokens(theme: { colors?: Record<string, string>; borderRadius?: string } | null) {
  const colors = theme?.colors;
  const brand = colors?.primary || DEFAULT_EMAIL_BRANDING.primaryColor;
  const background = colors?.background || '#FFFFFF';
  const text = colors?.text || '#1A1A1A';
  const dark = isDarkColor(background);

  const radius = parseFloat(theme?.borderRadius || '') || 12;
  const radiusUnit = (theme?.borderRadius || '').replace(/[\d.]/g, '') || 'px';

  return {
    onBrand: onColor(brand),
    /*
     * The page behind the card. A shade off the business's own ground rather
     * than a fixed grey, so the card reads as lifted on a light palette and as
     * recessed on a dark one.
     */
    pageColor: dark ? mix(background, '#000000', 0.35) : mix(background, text, 0.05),
    surfaceColor: dark ? mix(background, '#FFFFFF', 0.06) : background,
    mutedSurfaceColor: colors?.surface || mix(background, text, 0.03),
    borderColor: mix(background, text, dark ? 0.18 : 0.12),
    textColor: text,
    mutedTextColor: colors?.textSecondary || mix(background, text, 0.55),
    /*
     * The card's corners, and the button's at half.
     *
     * An email cannot use `clamp` or a custom property, so both are resolved
     * here — and both come from the one radius the theme carries, which is how
     * Lumen's 30px reaches a receipt at all.
     */
    radius: `${radius}${radiusUnit}`,
    buttonRadius: `${Math.round(radius / 1.5)}${radiusUnit}`,
  };
}
