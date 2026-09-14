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

/**
 * Where to send a client who wants to book.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A "book again" link has one job, and it was the only thing the old chain did
 * not check: that the destination is somewhere you can actually book.
 *
 * The order matters and is not arbitrary:
 *
 *   1. its WEBSITE on this platform, when we host one — a booking widget
 *   2. its smart link — `/c/{user_code}/book`, which exists for EVERY account
 *      and is the whole answer for a business that never wanted a website
 *
 * A landing page is deliberately not step 1: it is a campaign surface, and the
 * smart link below is purpose-built for booking and never goes stale. The
 * business's own external site is not in the list at all — a homepage is not a
 * booking page, and a button that says "book again" has to land on one.
 *
 * Step 2 was missing entirely. Without it, a business on `booking_only` — one
 * that told onboarding it did not want a site — had no bookable link to offer,
 * so a cancelled client got no button at all. Meanwhile `user_code` was sitting
 * on the profile, populated for every account, pointing at a booking page built
 * for exactly this.
 *
 * `status = 'published'`: an unpublished page's subdomain resolves to nothing.
 * Two of the four call sites did not filter on it. `maybeSingle` rather than
 * `single` for the same reason the filter matters — a business with two pages
 * made `single()` throw, and the error was swallowed into "no link".
 * MOVED HERE FROM BookingEmailService
 *
 * It was module-private there, so the incoming-enquiries feature would have had
 * to copy it — and a second copy of a precedence rule is how the footer and the
 * button above it come to disagree. It belongs beside
 * `resolvePlatformWebsiteUrl`, which answers the neighbouring question and
 * which this calls.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function resolveBookingUrl(
  userId: string,
  profile: { user_code?: string | null } | null | undefined
): Promise<string | undefined> {
  // The same helper the email branding uses, so "do we host their website"
  // cannot be answered one way in the footer and another in the button above it.
  const subdomain = await resolvePublishedWebsiteSubdomain(userId);

  if (subdomain) return `${appUrl()}/site/${subdomain}/book`;
  if (profile?.user_code) return `${appUrl()}/c/${profile.user_code}/book`;
  return undefined;
}

/** Read at call time: tests and previews set it after module load. */
function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || '';
}
