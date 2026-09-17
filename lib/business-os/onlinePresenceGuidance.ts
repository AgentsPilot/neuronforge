/**
 * What the owner should do next about being findable, in plain words.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The dashboard tells a business "clients cannot find you" and sends it to the
 * Online presence page — which then says nothing at all about why it was
 * opened. The page shows a website card, a list of landing pages and a list of
 * smart links, and leaves the owner to work out which of the three the dashboard
 * meant. Three routes satisfy that step and nothing on screen names them.
 *
 * It is worse for a business that declined a website. Its booking link is the
 * ONLY route it has, that link is created switched off, and the page gives no
 * hint that switching it on is the whole job.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS A PURE FUNCTION
 *
 * The advice depends on five facts that are already on the page. Deciding in
 * one place, from a named state, is what stops the guidance drifting from what
 * the lists below it actually show — and makes each case something you can read
 * and argue with rather than a chain of ternaries inside JSX.
 *
 * @module lib/business-os/onlinePresenceGuidance
 */

export interface OnlinePresenceFacts {
  /** The business asked for a website during onboarding, or later. */
  wantsWebsite: boolean;
  /** A homepage exists at all, published or not. */
  hasWebsite: boolean;
  /** That homepage is live and reachable. */
  websitePublished: boolean;
  /** Landing pages that are live. */
  livePages: number;
  /** Landing pages that exist but are not live. */
  draftPages: number;
  /** The booking link — the one that lists services and takes a booking. */
  bookingLinkActive: boolean;
  bookingLinkExists: boolean;
}

/**
 * Which situation the business is in.
 *
 * Named rather than numbered so a caller reads the case instead of decoding it,
 * and so a missing translation is obvious in the key.
 */
export type GuidanceState =
  /** Reachable. Nothing is required; what remains is optional reach. */
  | 'reachable'
  /** A site exists, is not live, and is the shortest route. */
  | 'publish_website'
  /** They want a site and have none yet. */
  | 'create_website'
  /** A landing page is drafted and could go live. */
  | 'publish_landing'
  /** No site wanted: the booking link is the whole answer, and it is off. */
  | 'activate_link'
  /** No site wanted and no link either — something went wrong upstream. */
  | 'no_route';

export interface Guidance {
  state: GuidanceState;
  /** Whether this is blocking "clients can find you" or merely suggested. */
  urgency: 'required' | 'optional';
  /**
   * There is a second, faster route the owner may not know they have.
   *
   * Three things make a business findable and the notice names the shortest —
   * but "shortest" was measured in steps, not in effort, and reading a whole
   * website before publishing it is a sitting, while switching on a booking
   * link is a click. A business with a drafted site and a dormant link was
   * being told to do the long one and never told the short one existed.
   *
   * Offered rather than substituted: the site is still the better front door,
   * and an owner who wants to publish it today should not be talked out of it.
   * They should simply know they can be reachable before dinner either way.
   */
  alsoActivateLink: boolean;
}

/**
 * The single next thing worth doing.
 *
 * Ordered by what actually makes the business reachable soonest, not by which
 * surface we would rather they used. A drafted website is one review away; a
 * new website is an afternoon. A business that declined a site is never told to
 * build one — that answer was given and this page is not the place to re-ask.
 */
export function onlinePresenceGuidance(facts: OnlinePresenceFacts): Guidance {
  const reachable = facts.websitePublished || facts.livePages > 0 || facts.bookingLinkActive;

  /** The link is a live option whenever it exists and is not already on. */
  const linkAvailable = facts.bookingLinkExists && !facts.bookingLinkActive;

  const guide = (state: GuidanceState, urgency: Guidance['urgency'] = 'required'): Guidance => ({
    state,
    urgency,
    // Never alongside the advice to switch it on — that would be the same
    // sentence twice — and never when nothing is blocking.
    alsoActivateLink: linkAvailable && state !== 'activate_link' && urgency === 'required',
  });

  if (reachable) return guide('reachable', 'optional');

  // Shortest route first: something already written, needing only a decision.
  if (facts.hasWebsite) return guide('publish_website');
  if (facts.draftPages > 0) return guide('publish_landing');

  /*
   * The link comes before "build a website" for a business that never asked
   * for one. Telling somebody to build a site they declined is not guidance,
   * it is an argument — and their booking link is already made, already
   * addressed, and one switch from working.
   */
  if (!facts.wantsWebsite && facts.bookingLinkExists) return guide('activate_link');

  if (facts.wantsWebsite) return guide('create_website');
  if (facts.bookingLinkExists) return guide('activate_link');

  return guide('no_route');
}
