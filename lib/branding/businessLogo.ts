/**
 * Where the business logo comes from.
 *
 * WHY THIS EXISTS
 *
 * There used to be no answer to that question. The logo sat in
 * `business_profiles.invoice_logo_url` — a column named for invoices that
 * emails, booking pages, intake forms and public smart links all read anyway —
 * while the only place a user could upload one wrote it into a website header
 * block instead. Nothing wrote the column, and saving invoice settings set it
 * back to null. Every surface except the website therefore showed no logo, and
 * no two of them agreed on where a logo would have come from if there were one.
 *
 * Now there is one column and one reader. A surface asks this module for the
 * logo; it never reads the profile itself, and it never stores its own copy.
 *
 * @module lib/branding/businessLogo
 */

import { createLogger } from '@/lib/logger';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';

const logger = createLogger({ module: 'BusinessLogo' });

/** The subset of a business profile this needs, so callers can pass one they already hold. */
export interface LogoBearingProfile {
  logo_url?: string | null;
  show_logo_on_smart_links?: boolean | null;
}

export interface ResolveLogoOptions {
  /**
   * Which surface is asking.
   *
   * `show_logo_on_smart_links` governs the smart-link pages and ONLY those:
   * they render from the conversion config and have no block model to carry a
   * display flag of their own, which is why the column exists. The website and
   * landing pages carry their own `show_logo` on the header block, and the
   * invoice, the booking-management pages and the emails have no opt-out at
   * all — a receipt wears the business's logo.
   *
   * So the flag is applied only when a caller says it is rendering a smart
   * link. It is opt-in rather than the default because every other caller of
   * this function predates it and must not start hiding logos it has always
   * shown.
   */
  surface?: 'smart_link';
}

/**
 * The business's logo, or null when it has none.
 *
 * @param userId  The business owner.
 * @param profile An already-loaded profile, when the caller has one. Passing it
 *                avoids a second query; omitting it is also fine.
 *
 * Never throws. A logo is decoration, and a missing one must never be able to
 * stop an invoice rendering or a receipt going out.
 */
export async function resolveBusinessLogo(
  userId: string,
  profile?: LogoBearingProfile | null,
  options?: ResolveLogoOptions
): Promise<string | null> {
  const hidden = (bearer: LogoBearingProfile | null | undefined) =>
    options?.surface === 'smart_link' && bearer?.show_logo_on_smart_links === false;

  if (profile) return hidden(profile) ? null : profile.logo_url || null;

  try {
    const { data } = await businessProfileRepository.getBranding(userId);
    return hidden(data) ? null : data?.logo_url || null;
  } catch (err) {
    logger.warn({ err, userId }, 'Could not resolve business logo; rendering without one');
    return null;
  }
}
