/**
 * Resolve where a lead came from, without asking the user to do anything.
 *
 * Attribution normally depends on the business owner tagging every link they
 * share with UTM parameters. Non-technical users do not do this, and a feature
 * that requires it reports "unknown" for everything and looks broken.
 *
 * The referrer needs no cooperation: it is recorded automatically for every lead
 * by `buildAttributionFromRequest` in lib/utils/attribution.ts. UTM parameters,
 * when present, are more precise and take priority — but they are a bonus, never
 * a prerequisite.
 */

export type Channel =
  | 'instagram'
  | 'facebook'
  | 'google'
  | 'whatsapp'
  | 'tiktok'
  | 'linkedin'
  | 'youtube'
  | 'email'
  | 'referral'
  | 'direct';

export interface ChannelAttribution {
  channel: Channel;
  /** How we worked it out — surfaced in the UI so a user can judge the number. */
  basis: 'utm' | 'referrer' | 'none';
  /** The raw signal, for display in a details view. */
  detail?: string;
}

/**
 * Referrer hosts, matched against the domain and any subdomain of it.
 *
 * Social apps route outbound links through shim domains — Instagram sends
 * `l.instagram.com`, Facebook `l.facebook.com` and `lm.facebook.com` — so
 * matching only the bare domain would miss most real social traffic.
 */
const REFERRER_DOMAINS: { suffixes: string[]; channel: Channel }[] = [
  { suffixes: ['instagram.com', 'ig.me'], channel: 'instagram' },
  { suffixes: ['facebook.com', 'fb.com', 'fb.me', 'messenger.com'], channel: 'facebook' },
  { suffixes: ['whatsapp.com', 'wa.me'], channel: 'whatsapp' },
  { suffixes: ['tiktok.com'], channel: 'tiktok' },
  { suffixes: ['linkedin.com', 'lnkd.in'], channel: 'linkedin' },
  { suffixes: ['youtube.com', 'youtu.be'], channel: 'youtube' },
  { suffixes: ['mail.google.com', 'outlook.com', 'outlook.live.com', 'mail.yahoo.com'], channel: 'email' },
];

/** utm_source values, normalized, that map onto a known channel. */
const UTM_SOURCES: Record<string, Channel> = {
  instagram: 'instagram',
  ig: 'instagram',
  facebook: 'facebook',
  fb: 'facebook',
  meta: 'facebook',
  google: 'google',
  'google-business': 'google',
  gbp: 'google',
  adwords: 'google',
  whatsapp: 'whatsapp',
  tiktok: 'tiktok',
  linkedin: 'linkedin',
  youtube: 'youtube',
  email: 'email',
  newsletter: 'email',
  mailchimp: 'email',
};

/**
 * Google search and Google Business Profile both refer from a google.* host.
 * Kept separate from REFERRER_DOMAINS because Gmail is also a google host but is
 * email, not search — and it must be checked first.
 */
function isGoogleSearchHost(host: string): boolean {
  return /(^|\.)google\.[a-z.]{2,6}$/.test(host);
}

function normalizeHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split(':')[0];
}

function matchesSuffix(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

/**
 * Resolve a lead's channel from its stored attribution.
 *
 * @param referrerDomain `crm_contacts.referrer_domain`
 * @param utmSource      `crm_contacts.utm_source`
 */
export function resolveChannel(
  referrerDomain?: string | null,
  utmSource?: string | null
): ChannelAttribution {
  // UTM wins when present: the user (or our own smart link) stated it explicitly.
  if (utmSource) {
    const key = utmSource.trim().toLowerCase();
    const channel = UTM_SOURCES[key];
    if (channel) {
      return { channel, basis: 'utm', detail: utmSource };
    }
  }

  if (referrerDomain) {
    const host = normalizeHost(referrerDomain);
    if (host) {
      for (const { suffixes, channel } of REFERRER_DOMAINS) {
        if (suffixes.some(suffix => matchesSuffix(host, suffix))) {
          return { channel, basis: 'referrer', detail: host };
        }
      }

      // After the email check above, a remaining google host is Search or Maps.
      if (isGoogleSearchHost(host)) {
        return { channel: 'google', basis: 'referrer', detail: host };
      }

      // A referrer we don't recognise is still a referral from somewhere real —
      // a directory, a partner site, a forum. Not the same as no referrer.
      return { channel: 'referral', basis: 'referrer', detail: host };
    }
  }

  // No referrer and no tag. Typed the address, used a bookmark, came from an app
  // that strips the referrer, or clicked through from https to http. Reported
  // honestly as direct rather than being assigned to a channel.
  return { channel: 'direct', basis: 'none' };
}

/** Stable display order — biggest acquisition channels first, direct last. */
export const CHANNEL_ORDER: Channel[] = [
  'instagram',
  'facebook',
  'google',
  'whatsapp',
  'tiktok',
  'linkedin',
  'youtube',
  'email',
  'referral',
  'direct',
];

/** Translation key for a channel label; falls back to the English name. */
export function channelLabelKey(channel: Channel): string {
  return `channel.${channel}`;
}
