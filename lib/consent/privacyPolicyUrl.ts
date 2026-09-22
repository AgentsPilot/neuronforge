/**
 * Where this business's privacy notice lives.
 *
 * The same subdomain-or-user-code problem `resolveBookingUrl` already solves in
 * `lib/branding/platformSite.ts`, and solved the same way — one place, so the
 * link in a consent checkbox cannot point somewhere different from the link in
 * a page footer.
 *
 * Three outcomes, and the caller has to handle all three:
 *   - an external URL, where the business has its own notice
 *   - a hosted URL on their own site or smart link
 *   - null, where they have turned it off
 *
 * Null is not a bug. It is a business that has said it does not publish one,
 * and the consent checkbox must render without a link rather than with a dead
 * one — a checkbox linking to a 404 is worse than a checkbox linking nowhere.
 *
 * @module lib/consent/privacyPolicyUrl
 */

import { resolvePublishedWebsiteSubdomain } from '@/lib/branding/platformSite';

/** Read at call time: tests and previews set it after module load. */
function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || '';
}

export interface PrivacyPolicySettings {
  privacy_policy_mode?: 'hosted' | 'url' | 'none' | null;
  privacy_policy_url?: string | null;
}

export async function resolvePrivacyPolicyUrl(
  userId: string,
  settings: PrivacyPolicySettings | null | undefined,
  profile: { user_code?: string | null } | null | undefined
): Promise<string | null> {
  // No settings row yet means the tenant has never opened the panel, and the
  // hosted default is what they would see there. Defaulting to 'none' would
  // leave every new business with an unlinked checkbox.
  const mode = settings?.privacy_policy_mode ?? 'hosted';

  if (mode === 'none') return null;

  if (mode === 'url') {
    const external = settings?.privacy_policy_url?.trim();
    // A mode of 'url' with no URL is a half-finished setting, not a hosted
    // page. Falling through to the hosted one would publish a notice the
    // business did not write.
    return external || null;
  }

  const subdomain = await resolvePublishedWebsiteSubdomain(userId);
  if (subdomain) return `${appUrl()}/site/${subdomain}/privacy`;
  if (profile?.user_code) return `${appUrl()}/c/${profile.user_code}/privacy`;

  // Nowhere to host it: no live site and no smart link. Rare, and honest.
  return null;
}
