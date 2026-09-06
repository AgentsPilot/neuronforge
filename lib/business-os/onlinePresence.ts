/**
 * Whether the business asked for a website during onboarding.
 *
 * The onboarding chat offers four shapes of online presence and tells the user
 * in plain words what each one is:
 *
 *   full_website   a professional website + online booking
 *   website_only   a professional website
 *   booking_only   a dedicated booking page — NOT a website
 *   none           no website, can add one later
 *
 * So only the first two are a website. `booking_only` is easy to misread as one
 * because it does produce a public page, but what the user agreed to was a
 * booking page; showing them a website builder offers something they declined.
 *
 * The same rule is written inline in `app/api/onboarding/build/route.ts` where
 * it sets `has_website`. Shared here so the interface cannot drift from the
 * promise the chat made.
 */

export type OnlinePresenceMode = 'full_website' | 'booking_only' | 'website_only' | 'none';

/** The two answers that mean "no website". Everything else is one. */
const DECLINED: ReadonlySet<string> = new Set(['booking_only', 'none']);

/**
 * @param mode `business_profiles.online_presence_mode`.
 * @returns false only when the user actively declined. An absent or
 *          unrecognised mode returns true — most accounts predate this column,
 *          and hiding the builder from someone whose choice was never recorded
 *          would take away a feature they may well be using.
 */
export function wantsWebsite(mode: string | null | undefined): boolean {
  if (typeof mode !== 'string') return true;
  return !DECLINED.has(mode.trim().toLowerCase());
}
