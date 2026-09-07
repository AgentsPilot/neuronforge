/**
 * The address this business publishes under ON THIS PLATFORM, if it has one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A business can reach clients three ways here, and it may change its mind:
 * a site built on this platform, a landing page, or a smart link alone. The
 * question "does it have a site of ours that is actually live" gets asked from
 * several places — email branding, the booking links in booking emails — and
 * each one was answering it differently, or not at all.
 *
 * PUBLISHED, not merely existing. A draft page has a subdomain reserved for it
 * and that subdomain serves nothing: linking to it sends a client to an empty
 * address. `resolveBusinessSubdomain` deliberately answers a different question
 * — "what address does this business own", including drafts and falling back to
 * `user_code` — because it exists to decide what to publish UNDER. This one
 * decides what is safe to LINK TO, so it takes only what is live.
 *
 * THE HOMEPAGE ONLY. A landing page is not a business's website: it is one
 * campaign, written for one offer, and it will be unpublished when that offer
 * ends. Putting it in an email footer as "our website" misrepresents the
 * business to its own clients, and breaks the link the day the campaign closes.
 *
 * The distinction this answers is exactly two-sided — a website WE publish, or
 * the one the business already had — and a landing page is neither. Where a
 * business has only landing pages, the honest answer is null, and the caller
 * falls back to the business's own address or to the smart link.
 *
 * (`resolveBusinessTheme` deliberately does take any published surface: whose
 * COLOURS to wear is a different question from what to call the website.)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'PlatformSite' });

/**
 * The subdomain of this business's LIVE website on this platform, or null.
 *
 * Null means "we do not host their website" — not "they have no website",
 * since they may well have one of their own.
 */
export async function resolvePublishedWebsiteSubdomain(userId: string): Promise<string | null> {
  try {
    const { data: page } = await supabaseServer
      .from('website_pages')
      .select('subdomain')
      .eq('user_id', userId)
      .eq('page_type', 'homepage')
      .eq('status', 'published')
      .not('subdomain', 'is', null)
      .limit(1)
      .maybeSingle();

    return page?.subdomain ?? null;
  } catch (error) {
    // A branding lookup must never be able to stop an email going out.
    logger.warn({ err: error, userId }, 'Could not resolve a published website subdomain');
    return null;
  }
}

/**
 * The business's website on this platform, as an absolute URL, or null.
 *
 * Resolved per call rather than stored, which is the point: the day a business
 * publishes a site with us, every email it sends starts pointing at it, with
 * nothing to migrate and no cache to expire.
 */
export async function resolvePlatformWebsiteUrl(userId: string): Promise<string | null> {
  const subdomain = await resolvePublishedWebsiteSubdomain(userId);
  if (!subdomain) return null;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  return `${appUrl}/site/${subdomain}`;
}
