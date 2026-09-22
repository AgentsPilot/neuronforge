/**
 * Where an owner is about to post a link — and the tag that records it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Attribution falls back to the referrer, which needs nothing from the owner and
 * is right most of the time. It is wrong in exactly the places a small business
 * actually shares links:
 *
 *   WhatsApp   sends no referrer at all — the lead reads as `direct`
 *   A QR code  has no referrer to send — also `direct`
 *   Instagram  opens an in-app browser that strips or rewrites it
 *
 * UTM parameters fix that, and asking an owner to write them does not work: the
 * `source` / `medium` / `campaign` columns have existed on `smart_links` since
 * the table was created and every row in production has them empty, because
 * nothing in the product ever asked.
 *
 * So the question is never asked. The owner clicks "Share", picks WhatsApp
 * because they are about to post it to WhatsApp, and the tag rides an action
 * they wanted anyway. One smart link, several spellings of its URL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SHORT CODE AND NOT THE UTMs THEMSELVES
 *
 * The shared link carries `?v=wa`, not `?utm_source=whatsapp&utm_medium=social`.
 * Three reasons: it survives being pasted into places that truncate long URLs,
 * it does not look like tracking to the person receiving it, and it keeps the
 * mapping in ONE place — change what `wa` means here and every link already in
 * circulation follows, because the translation happens at redirect time.
 *
 * @module lib/business-os/channel-insights/shareDestinations
 */

import type { Channel } from './channelFromReferrer';

/** The code that travels in the URL. Short, opaque, stable once shipped. */
export type ShareVariant = 'wa' | 'ig' | 'fb' | 'em' | 'qr';

export interface ShareDestination {
  variant: ShareVariant;
  /** What the tag resolves to — must exist in `UTM_SOURCES`. */
  utmSource: string;
  /** How it was shared. `social`, `email`, `print` — GA4's vocabulary. */
  utmMedium: string;
  /** The channel row this lands on, for the label the owner will see. */
  channel: Channel;
  /** Translation key for the destination's name in the share menu. */
  labelKey: string;
  /** English fallback, in the house pattern. */
  labelEn: string;
}

/**
 * The list, in menu order.
 *
 * Deliberately five. Every addition is another thing to read before doing the
 * obvious thing, and past the common few the owner is better served by "Just
 * copy the link" — an untagged link is a smaller loss than a menu nobody reads.
 *
 * Paid-versus-organic is NOT here. Separating a Meta ad from a Meta post needs
 * its own variant, and at that point this has become the UTM builder it exists
 * to avoid. If it is ever wanted it belongs in the ad tooling, not here.
 */
export const SHARE_DESTINATIONS: ShareDestination[] = [
  { variant: 'wa', utmSource: 'whatsapp', utmMedium: 'social', channel: 'whatsapp', labelKey: 'share.whatsapp', labelEn: 'WhatsApp' },
  { variant: 'ig', utmSource: 'instagram', utmMedium: 'social', channel: 'instagram', labelKey: 'share.instagram', labelEn: 'Instagram' },
  { variant: 'fb', utmSource: 'facebook', utmMedium: 'social', channel: 'facebook', labelKey: 'share.facebook', labelEn: 'Facebook' },
  { variant: 'em', utmSource: 'email', utmMedium: 'email', channel: 'email', labelKey: 'share.email', labelEn: 'Email' },
  { variant: 'qr', utmSource: 'qr', utmMedium: 'print', channel: 'qr', labelKey: 'share.qr', labelEn: 'QR code for print' },
];

const BY_VARIANT = new Map(SHARE_DESTINATIONS.map(d => [d.variant, d]));

/** A variant code is valid only if it is one we ship. Anything else is ignored. */
export function isShareVariant(value: string | null | undefined): value is ShareVariant {
  return typeof value === 'string' && BY_VARIANT.has(value as ShareVariant);
}

/**
 * The UTM pair a variant stands for, or null when the code means nothing.
 *
 * Null rather than a default: an unrecognised `?v=` is someone's stray query
 * string, and inventing a source for it would put fiction in the channel table.
 * The referrer still answers, as it does for every untagged link.
 */
export function utmForVariant(value: string | null | undefined): { utm_source: string; utm_medium: string } | null {
  if (!isShareVariant(value)) return null;
  const destination = BY_VARIANT.get(value)!;
  return { utm_source: destination.utmSource, utm_medium: destination.utmMedium };
}

/** A smart link's shareable URL. `null` variant gives the plain link. */
export function shareUrlFor(origin: string, code: string, variant: ShareVariant | null): string {
  const base = `${origin}/go/${code}`;
  return variant ? `${base}?v=${variant}` : base;
}

/**
 * The same, for a page the visitor reaches DIRECTLY — a website or a landing
 * page, with no redirect in between.
 *
 * Real `utm_source` / `utm_medium` rather than the short code, because nothing
 * sits in the middle to expand `v`. The page's own tracker and every form on it
 * read those two names off the query string already
 * (`extractUTMParams` in lib/utils/attribution.ts), so this needs no new
 * capture path — only a URL that carries the answer.
 *
 * Longer and uglier in the address bar, which is the cost of not having a
 * redirect to hide it behind.
 */
export function shareUrlForPage(pageUrl: string, variant: ShareVariant | null): string {
  if (!variant) return pageUrl;

  const utm = utmForVariant(variant);
  if (!utm) return pageUrl;

  try {
    const url = new URL(pageUrl);
    // Never overwrite a tag the owner put there deliberately.
    if (!url.searchParams.has('utm_source')) url.searchParams.set('utm_source', utm.utm_source);
    if (!url.searchParams.has('utm_medium')) url.searchParams.set('utm_medium', utm.utm_medium);
    return url.toString();
  } catch {
    const separator = pageUrl.includes('?') ? '&' : '?';
    return `${pageUrl}${separator}utm_source=${encodeURIComponent(utm.utm_source)}&utm_medium=${encodeURIComponent(utm.utm_medium)}`;
  }
}
