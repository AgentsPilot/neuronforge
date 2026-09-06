/**
 * The web address a business publishes under.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A subdomain belongs to the BUSINESS, not to one page: every surface it
 * publishes lives under the same one — `{subdomain}.agentspilot.com/{slug}` —
 * and a business does not get a second address by making a second page.
 *
 * It was only ever stored on `website_pages.subdomain`, and only ever read off
 * the HOMEPAGE. So a business with no website had no address anywhere, and:
 *
 *   * a landing page was created with `subdomain: null`;
 *   * publishing it was refused — "This page has no web address yet. Choose a
 *     subdomain before publishing it." — with no way offered to choose one,
 *     because the field that sets it lives in the website's settings;
 *   * a business reaching clients by link alone could therefore never publish
 *     a landing page at all.
 *
 * The address it already has is `business_profiles.user_code` — the same code
 * its smart links are served from (`/c/{userCode}`), and the one the landing
 * page URL was already being displayed with. So there is no new identifier to
 * mint here; there is an existing one that the publish path could not see.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'BusinessSubdomain' });

/**
 * This business's address, or null if it genuinely has none.
 *
 * The homepage's comes first — it is the one a business chose deliberately, in
 * the website wizard — then any other page already published under one, then
 * the business's own code.
 */
export async function resolveBusinessSubdomain(userId: string): Promise<string | null> {
  try {
    // The business's own, where one has been claimed.
    const { data: profile } = await supabaseServer
      .from('business_profiles')
      .select('subdomain, user_code')
      .eq('user_id', userId)
      .maybeSingle();

    const claimed = (profile as { subdomain?: string | null } | null)?.subdomain;
    if (claimed) return claimed;

    const { data: pages } = await supabaseServer
      .from('website_pages')
      .select('subdomain, page_type')
      .eq('user_id', userId)
      .not('subdomain', 'is', null);

    const chosen =
      (pages || []).find(page => page.page_type === 'homepage')?.subdomain ??
      (pages || [])[0]?.subdomain;

    if (chosen) return chosen;

    // Nothing chosen anywhere: the code its smart links are already served
    // from. Not stored as a claim — it is a fallback, and a business that later
    // picks a real address should not find this one already taken by itself.
    return profile?.user_code || null;
  } catch (error) {
    logger.warn({ err: error, userId }, 'Could not resolve the business subdomain');
    return null;
  }
}

/**
 * Record this as the business's address.
 *
 * Called when a surface is published under one for the first time, so that the
 * next thing the business creates — a website, another landing page — inherits
 * it rather than minting its own and splitting the business across two
 * addresses. Never overwrites a claim that is already there: an address in use
 * is one clients may already have been given.
 */
export async function claimBusinessSubdomain(
  userId: string,
  subdomain: string | null | undefined
): Promise<boolean> {
  if (!subdomain) return false;

  const { data: profile } = await supabaseServer
    .from('business_profiles')
    .select('subdomain')
    .eq('user_id', userId)
    .maybeSingle();

  if ((profile as { subdomain?: string | null } | null)?.subdomain) return false;

  const { error } = await supabaseServer
    .from('business_profiles')
    .update({ subdomain, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (error) {
    logger.error({ err: error, userId, subdomain }, 'Could not claim the business subdomain');
    return false;
  }

  logger.info({ userId, subdomain }, 'Business web address claimed');
  return true;
}
