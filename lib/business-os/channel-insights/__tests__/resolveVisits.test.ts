import { resolveVisits, describeVisitsCoverage } from '../resolveVisits';

/**
 * Visitors are counted as people, so the fixtures name them. `p(n)` is a
 * stable fake hash — using the same person across two days is how the tests
 * check that a returning visitor is counted once.
 */
const p = (n: number) => `person-${n}`;
const people = (count: number, from = 1) =>
  Array.from({ length: count }, (_, i) => p(from + i));

const ga4 = (date: string, channel: string, sessions: number, visitors = sessions) => ({
  metric_date: date,
  channel,
  sessions,
  visitors,
});
const site = (
  date: string,
  channel: string,
  visitorIds: string[],
  surface: 'website' | 'landing' = 'website'
) => ({
  metric_date: date,
  channel,
  views: visitorIds.length,
  visitorIds,
  surface,
});
const link = (date: string, channel: string, visitorIds: string[]) => ({
  metric_date: date,
  channel,
  views: visitorIds.length,
  visitorIds,
});

describe('[smoke] resolveVisits', () => {
  it('counts a returning visitor once, not once per day', () => {
    // The whole point of carrying identity: adding daily figures would report
    // two people where one came back.
    const { byChannel, total } = resolveVisits({
      ga4Rows: [],
      siteRows: [
        site('2026-08-24', 'instagram', [p(1), p(2)]),
        site('2026-08-25', 'instagram', [p(1), p(3)]),
      ],
      ga4CoversHostedSite: false,
    });

    expect(byChannel.get('instagram')).toBe(3);
    expect(total).toBe(3);
  });

  it('counts one person once even across surfaces', () => {
    // Someone who reads the site and later follows a booking link is one
    // visitor. The surfaces both show them; the total does not.
    const { total, bySurface } = resolveVisits({
      ga4Rows: [],
      siteRows: [site('2026-08-24', 'direct', [p(1)])],
      smartLinkRows: [link('2026-08-24', 'direct', [p(1)])],
      ga4CoversHostedSite: false,
    });

    expect(total).toBe(1);
    expect(bySurface.get('website')).toBe(1);
    expect(bySurface.get('smart_links')).toBe(1);
  });

  it('takes GA4 users across days, since dailies carry no identity', () => {
    // GA4 gives daily activeUsers with nothing to union on. Summing is the
    // only option available and is documented as running high.
    const { byChannel } = resolveVisits({
      ga4Rows: [ga4('2026-08-24', 'instagram', 12, 10), ga4('2026-08-25', 'instagram', 6, 5)],
      siteRows: [],
      ga4CoversHostedSite: false,
    });

    expect(byChannel.get('instagram')).toBe(15);
  });

  it('counts people, not page loads', () => {
    // Five views from one person is one visitor.
    const { total } = resolveVisits({
      ga4Rows: [],
      siteRows: [site('2026-08-24', 'direct', [p(1), p(1), p(1), p(1), p(1)])],
      ga4CoversHostedSite: false,
    });

    expect(total).toBe(1);
  });

  it('suppresses our own page views when GA4 already measures that page', () => {
    // The same visitor is seen by both collectors. Counting both would report
    // people who do not exist.
    const { byChannel } = resolveVisits({
      ga4Rows: [ga4('2026-08-24', 'instagram', 12, 10)],
      siteRows: [site('2026-08-24', 'instagram', people(20))],
      ga4CoversHostedSite: true,
    });

    expect(byChannel.get('instagram')).toBe(10);
  });

  it('adds both when GA4 measures a different site', () => {
    // A Wix site and an AgentPilot landing page are two different places, so
    // their visitors are two different groups of people.
    const { byChannel } = resolveVisits({
      ga4Rows: [ga4('2026-08-24', 'instagram', 12, 10)],
      siteRows: [site('2026-08-24', 'instagram', people(20))],
      ga4CoversHostedSite: false,
    });

    expect(byChannel.get('instagram')).toBe(30);
  });

  it('falls back to our count on a day GA4 has no data for', () => {
    // Per-day precedence: a GA4 outage, a tag briefly removed, or the period
    // before the property existed degrades to the count we do have rather than
    // leaving a hole.
    const { byChannel } = resolveVisits({
      ga4Rows: [ga4('2026-08-24', 'instagram', 12, 10)],
      siteRows: [
        site('2026-08-24', 'instagram', people(20)),
        site('2026-08-25', 'instagram', people(7, 100)),
      ],
      ga4CoversHostedSite: true,
    });

    expect(byChannel.get('instagram')).toBe(17); // 10 from GA4, 7 from the gap day
  });

  it('leaves a channel absent when no collector reported it', () => {
    // Absent means "we did not measure this", which the UI renders as "—".
    // A zero would claim nobody arrived, which is a different statement.
    const { byChannel } = resolveVisits({
      ga4Rows: [ga4('2026-08-24', 'instagram', 10)],
      siteRows: [],
      ga4CoversHostedSite: false,
    });

    expect(byChannel.has('instagram')).toBe(true);
    expect(byChannel.has('facebook')).toBe(false);
    expect(byChannel.get('facebook')).toBeUndefined();
  });

  it('keeps channels separate rather than pooling them', () => {
    const { byChannel } = resolveVisits({
      ga4Rows: [
        ga4('2026-08-24', 'instagram', 10),
        ga4('2026-08-24', 'google', 4),
        ga4('2026-08-24', 'direct', 6),
      ],
      siteRows: [],
      ga4CoversHostedSite: false,
    });

    expect(byChannel.get('instagram')).toBe(10);
    expect(byChannel.get('google')).toBe(4);
    expect(byChannel.get('direct')).toBe(6);
  });

  it('returns nothing when nothing was measured at all', () => {
    const { byChannel, bySurface, total } = resolveVisits({
      ga4Rows: [],
      siteRows: [],
      ga4CoversHostedSite: false,
    });
    expect(byChannel.size).toBe(0);
    expect(bySurface.size).toBe(0);
    expect(total).toBe(0);
  });

  it('suppresses per day even when GA4 reported zero users that day', () => {
    // A GA4 row of 0 is still a measurement: GA4 looked and saw nobody. Our own
    // count must not be substituted, or a real zero becomes a fabricated number.
    const { byChannel } = resolveVisits({
      ga4Rows: [ga4('2026-08-24', 'instagram', 0, 0)],
      siteRows: [site('2026-08-24', 'instagram', people(20))],
      ga4CoversHostedSite: true,
    });

    expect(byChannel.get('instagram')).toBeUndefined();
  });

  it('ignores arrivals with no identity rather than inventing one', () => {
    // A visit with no hash cannot be attributed to a person. Counting each as
    // its own visitor would inflate the number; collapsing them into one would
    // invent a person. Neither is claimed.
    const { total } = resolveVisits({
      ga4Rows: [],
      siteRows: [site('2026-08-24', 'direct', ['', '', p(1)])],
      ga4CoversHostedSite: false,
    });

    expect(total).toBe(1);
  });
});

describe('[smoke] resolveVisits — surfaces', () => {
  it('splits people by where they landed, not where they came from', () => {
    const { byChannel, bySurface } = resolveVisits({
      ga4Rows: [],
      siteRows: [
        site('2026-08-24', 'instagram', people(10), 'website'),
        site('2026-08-24', 'instagram', people(4, 50), 'landing'),
      ],
      smartLinkRows: [link('2026-08-24', 'instagram', people(3, 90))],
      ga4CoversHostedSite: false,
    });

    expect(byChannel.get('instagram')).toBe(17);
    expect(bySurface.get('website')).toBe(10);
    expect(bySurface.get('landing')).toBe(4);
    expect(bySurface.get('smart_links')).toBe(3);
  });

  it('counts GA4 as its own surface rather than as the website', () => {
    // When GA4 covers the hosted page its users REPLACE our count for those
    // days. Filing them under 'website' would credit the page-view tracker
    // with numbers it did not produce.
    const { bySurface } = resolveVisits({
      ga4Rows: [ga4('2026-08-24', 'google', 14, 12)],
      siteRows: [site('2026-08-24', 'google', people(30))],
      ga4CoversHostedSite: true,
    });

    expect(bySurface.get('analytics')).toBe(12);
    expect(bySurface.has('website')).toBe(false);
  });

  it('adds smart link arrivals on top — nothing else records them', () => {
    // Booking and form pages carry no page-view tracker, so a click is the
    // only evidence the arrival happened. GA4 suppresses the site rows, never
    // the links.
    const { total, bySurface } = resolveVisits({
      ga4Rows: [ga4('2026-08-24', 'direct', 5, 5)],
      siteRows: [site('2026-08-24', 'direct', people(5))],
      smartLinkRows: [link('2026-08-24', 'direct', people(2, 200))],
      ga4CoversHostedSite: true,
    });

    expect(total).toBe(7);
    expect(bySurface.get('smart_links')).toBe(2);
  });

  it('leaves out surfaces that reported nothing', () => {
    // An absent surface means nothing measured it. Rendering it as 0 would
    // claim the business has a landing page nobody visited.
    const { bySurface } = resolveVisits({
      ga4Rows: [],
      siteRows: [site('2026-08-24', 'direct', people(3), 'website')],
      ga4CoversHostedSite: false,
    });

    expect(bySurface.has('landing')).toBe(false);
    expect(bySurface.has('smart_links')).toBe(false);
    expect(bySurface.has('analytics')).toBe(false);
  });

  it('does not require the parts to sum to the whole', () => {
    // One person on two surfaces. The breakdown is where people went, not a
    // division of the total, and the UI must not present it as a split.
    const { total, bySurface } = resolveVisits({
      ga4Rows: [],
      siteRows: [site('2026-08-24', 'direct', [p(1)], 'website')],
      smartLinkRows: [link('2026-08-25', 'direct', [p(1)])],
      ga4CoversHostedSite: false,
    });

    const parts = [...bySurface.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(1);
    expect(parts).toBe(2);
  });
});

describe('[smoke] describeVisitsCoverage', () => {
  it('says analytics when GA4 replaced our count', () => {
    expect(
      describeVisitsCoverage({ hasGa4: true, hasSiteViews: true, ga4CoversHostedSite: true })
    ).toBe('analytics');
  });

  it('says both only when two collectors genuinely contributed', () => {
    expect(
      describeVisitsCoverage({ hasGa4: true, hasSiteViews: true, ga4CoversHostedSite: false })
    ).toBe('both');
  });

  it('names the single collector when only one is present', () => {
    expect(
      describeVisitsCoverage({ hasGa4: true, hasSiteViews: false, ga4CoversHostedSite: false })
    ).toBe('analytics');
    expect(
      describeVisitsCoverage({ hasGa4: false, hasSiteViews: true, ga4CoversHostedSite: false })
    ).toBe('agentpilot_page');
  });

  it('counts smart link arrivals as one of our own pages', () => {
    // A business whose only traffic comes through a booking link was told
    // nothing measured visits, while the total beside it said nine.
    expect(
      describeVisitsCoverage({ hasGa4: false, hasSiteViews: false, hasSmartLinks: true, ga4CoversHostedSite: false })
    ).toBe('agentpilot_page');
  });

  it('still says both when GA4 replaced our page count but links did not', () => {
    // GA4 suppresses site rows; it never suppresses smart link arrivals, so
    // two collectors genuinely contributed.
    expect(
      describeVisitsCoverage({ hasGa4: true, hasSiteViews: true, hasSmartLinks: true, ga4CoversHostedSite: true })
    ).toBe('both');
  });

  it('says none when nothing measured visits', () => {
    expect(
      describeVisitsCoverage({ hasGa4: false, hasSiteViews: false, ga4CoversHostedSite: false })
    ).toBe('none');
  });
});
