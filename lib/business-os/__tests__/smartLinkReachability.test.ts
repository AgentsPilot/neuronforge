/**
 * "Clients can reach you" must be true before it is said.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The readiness chain marks its website step done on
 * `is_reachable = hasLivePages || hasSmartLinks`, and `hasSmartLinks` counted
 * every active row without looking at where it pointed.
 *
 * A `landing` or `website` link points at one of the business's OWN pages, and
 * a page in draft is not served — so a business whose site was never published,
 * whose only link led to that site, was told clients could reach it while every
 * route in was shut.
 *
 * `journeyReadiness` names this case in a comment and declines it — "a link to
 * an unpublished page is a different problem with a different message" — and
 * the message was never written. The rule is reproduced here so the arithmetic
 * cannot quietly go back to counting rows.
 */

/** The rule as `app/api/business-os/stats/route.ts` applies it. */
const PAGE_BACKED = new Set(['landing', 'website']);

function reachableLinks(
  links: Array<{ destination_type?: string | null }>,
  hasLivePages: boolean
) {
  return links.filter(link =>
    PAGE_BACKED.has(link.destination_type ?? '') ? hasLivePages : true
  );
}

/**
 * `is_reachable` as the stats route computes it.
 *
 * A smart link substitutes for a website ONLY where the business declined one.
 * For a business building a site, the link is one route among several and the
 * site is the thing still to be done — saying "clients can reach you" because a
 * link exists hides that. `wantsWebsite` is true the moment any page exists, so
 * a site in draft keeps the step open until it is published.
 */
const isReachable = (
  links: Array<{ destination_type?: string | null }>,
  hasLivePages: boolean,
  wantsWebsite = false
) => hasLivePages || (!wantsWebsite && reachableLinks(links, hasLivePages).length > 0);

describe('a smart link only counts if it leads somewhere', () => {
  it('does NOT call a business reachable on a link to its own unpublished site', () => {
    // The reported case: a site built, never published, and one active link
    // pointing at it.
    expect(isReachable([{ destination_type: 'website' }], false)).toBe(false);
    expect(isReachable([{ destination_type: 'landing' }], false)).toBe(false);
  });

  it('counts the same link once the site is live', () => {
    expect(isReachable([{ destination_type: 'website' }], true)).toBe(true);
  });

  /*
   * These are served by the platform at `/go/{code}` whether or not the
   * business has a website, so they are a genuine way to be reached and must
   * keep working for a business that declined a site entirely.
   */
  it.each(['booking', 'form', 'payment'])(
    'counts a %s link with no website at all',
    destination_type => {
      expect(isReachable([{ destination_type }], false)).toBe(true);
    }
  );

  it('treats a link with no recorded destination as reachable', () => {
    // Older links predate the column. Calling a business unreachable on a
    // missing value is the worse error.
    expect(isReachable([{ destination_type: null }], false)).toBe(true);
    expect(isReachable([{}], false)).toBe(true);
  });

  it('ignores the dead link when a working one exists beside it', () => {
    expect(isReachable(
      [{ destination_type: 'website' }, { destination_type: 'booking' }],
      false
    )).toBe(true);
  });

  it('is unreachable with no links and no live page', () => {
    expect(isReachable([], false)).toBe(false);
  });
});

describe('a smart link substitutes only for a business that declined a website', () => {
  const BOOKING = [{ destination_type: 'booking' }];

  it('is NOT reachable while a website is being built', () => {
    // The reported case: a site in draft and a working booking link beside it.
    // `wantsWebsite` is true because pages exist, so the step stays open.
    expect(isReachable(BOOKING, false, true)).toBe(false);
  });

  it('is reachable for a business that chose not to have a website', () => {
    expect(isReachable(BOOKING, false, false)).toBe(true);
  });

  it('is reachable once the website is published, either way', () => {
    expect(isReachable(BOOKING, true, true)).toBe(true);
    expect(isReachable([], true, true)).toBe(true);
  });
});
