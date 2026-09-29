/**
 * Caching for the public websites — the tag, the lifetime, and who busts it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Every public Business OS site rendered uncached on every hit. Three separate
 * layers forced it in `app/site/[subdomain]/page.tsx`: `dynamic =
 * 'force-dynamic'`, `revalidate = 0`, and a `fetch` marked `cache: 'no-store'`.
 * The comment there blamed `revalidateTag` for "not working reliably".
 *
 * That was the consequence, not the cause. A `no-store` fetch is never written
 * to the cache, so there was no entry for a tag to point at — the
 * `revalidateTag` calls in the block routes had been no-ops since they were
 * written. Switching caching off did not work around a broken invalidation; it
 * was what broke it.
 *
 * So: one tag, one lifetime, one helper to bust it, used by every path that can
 * change what a visitor sees.
 *
 * THE TAG NAME IS NOT NEW. `website-${subdomain}` is what the block routes
 * already passed to `revalidateTag`; keeping it means those three call sites
 * start working the moment the fetches are cached, rather than being replaced.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { revalidateTag } from 'next/cache';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'SiteCache' });

/**
 * How long a public page may be served without re-fetching.
 *
 * A ceiling, not a delay: every path that edits a site calls `bustSiteCache`,
 * so an owner's change appears at once. This is only what protects a visitor
 * from a stale page if an invalidation is ever missed — and the reason the
 * whole site is not re-rendered on every hit.
 *
 * Sixty seconds is deliberately short. The cost of being wrong here is a
 * visitor seeing a minute-old page; the cost of `0` is what this replaces.
 */
export const SITE_CACHE_TTL_SECONDS = 60;

/** The cache tag for one business's public site. */
export function siteCacheTag(subdomain: string): string {
  return `website-${subdomain}`;
}

/**
 * Fetch options for anything a public site page reads.
 *
 * Kept as one object so a page cannot cache without tagging — an untagged entry
 * is one nothing can invalidate, which is a stale site with no way back.
 */
export function siteFetchOptions(subdomain: string) {
  return {
    next: {
      revalidate: SITE_CACHE_TTL_SECONDS,
      tags: [siteCacheTag(subdomain)],
    },
  };
}

/**
 * Throw away the cached pages for one site.
 *
 * Call after ANY change a visitor could notice: blocks, page fields, theme,
 * publish, unpublish, template application, reordering.
 *
 * Never throws. A failed invalidation means a page is stale for up to
 * `SITE_CACHE_TTL_SECONDS`; an exception here would fail the owner's edit
 * itself, which is worse than the staleness it is trying to prevent.
 */
export function bustSiteCache(subdomain: string | null | undefined): void {
  if (!subdomain) return;

  try {
    revalidateTag(siteCacheTag(subdomain));
    logger.debug({ subdomain }, 'Public site cache busted');
  } catch (err) {
    logger.warn({ err, subdomain }, 'Could not bust the public site cache');
  }
}

/**
 * Throw away the cached pages of EVERY site this business has.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * For changes that are not about the website at all, but that the website
 * shows: a service's name, price, duration or whether it is still active. The
 * public pages read those live, so the data was already right — and the page
 * still showed the old figure for up to a minute, because nothing told the
 * cache. Every website edit busted it; the edits that most often change what a
 * visitor is quoted did not.
 *
 * A business can have a homepage and several landing pages, so the subdomain is
 * looked up rather than assumed, and duplicates collapse to one call.
 *
 * Never throws, for the same reason `bustSiteCache` does not: a failure here
 * must not fail the owner's edit. It is imported lazily so that this module
 * stays safe to import from anywhere.
 */
export async function bustSitesForUser(userId: string): Promise<void> {
  try {
    const { getWebsitePageRepository } = await import('@/lib/repositories/WebsitePageRepository');
    const { supabaseServer } = await import('@/lib/supabaseServer');
    const pages = await getWebsitePageRepository(supabaseServer).listByUser(userId);
    if (pages.error || !pages.data) return;

    const subdomains = new Set(
      pages.data.map(page => page.subdomain).filter((sub): sub is string => Boolean(sub))
    );
    subdomains.forEach(bustSiteCache);
  } catch (err) {
    logger.warn({ err, userId }, 'Could not bust this business\'s public site caches');
  }
}
