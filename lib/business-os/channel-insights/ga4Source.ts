/**
 * Translates GA4's `sessionSource` into the project's channel vocabulary.
 *
 * A normalizer, deliberately not a second taxonomy: everything defers to
 * `resolveChannel`, so GA4 traffic, lead attribution and connector data all
 * speak the same language and can share a row in the same table.
 */

import { resolveChannel, type ChannelAttribution } from './channelFromReferrer';

/**
 * GA4's placeholders for "no source". These are not hostnames and not tags —
 * they mean the visitor arrived with nothing to identify them.
 *
 * This guard is load-bearing. `resolveChannel('(direct)')` would otherwise
 * return `referral`, because `(direct)` is a truthy string that matches no
 * known host — so direct traffic would be silently misfiled as a referral from
 * a site called "(direct)".
 */
const GA4_NO_SOURCE = new Set(['(direct)', '(none)', '(not set)', 'direct', '']);

/**
 * `sessionSource` mixes two shapes in one field: a referrer host
 * (`l.instagram.com`, `m.facebook.com`) when the visit came from a link, and a
 * bare UTM token (`google`, `newsletter`, `ig`) when the link was tagged.
 *
 * The value is therefore offered to `resolveChannel` as BOTH arguments —
 * whichever path recognises it wins, and neither can produce a false positive
 * because both matchers are exact.
 */
export function ga4SourceToChannel(sessionSource: string | null | undefined): ChannelAttribution {
  const value = (sessionSource || '').trim().toLowerCase();

  if (GA4_NO_SOURCE.has(value)) {
    return resolveChannel(null, null); // -> direct
  }

  return resolveChannel(value, value);
}

/**
 * Whether a GA4 property measures a host AgentPilot also tracks itself.
 *
 * When it does, our own page views for that day are suppressed in favour of
 * GA4's — otherwise the same visit is counted twice, once by each collector.
 * Compared on the bare hostname so `www.` and casing differences don't produce
 * a false negative and quietly double the numbers.
 */
export function ga4CoversHost(measuredHosts: string[], hostedHosts: string[]): boolean {
  const normalize = (host: string) => host.trim().toLowerCase().replace(/^www\./, '');
  const measured = new Set(measuredHosts.map(normalize).filter(Boolean));
  return hostedHosts.map(normalize).some(host => host && measured.has(host));
}
