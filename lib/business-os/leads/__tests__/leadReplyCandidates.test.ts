/**
 * What a lead can be sent, and what gets chosen when nothing is guessing.
 *
 * This module is the reason a model cannot invent a booking link: it mints the
 * indexes and holds the URLs, and the model only ever answers with a position.
 * The tests that matter most are the ones about that boundary and about the
 * fallback ladder, because the ladder runs whenever the model does not.
 */

import {
  buildLeadReplyCandidates,
  pickFallbackCandidate,
  candidatesForPrompt,
} from '../leadReplyCandidates';

const BOOKING_URL = 'https://app.example.com/c/abc123/book';

const service = (over: Record<string, unknown> = {}) => ({
  id: 'svc-1',
  service_name: 'Deep tissue massage',
  price: 200,
  is_scheduled: true,
  sale_mode: 'direct',
  ...over,
});

describe('building the candidate list', () => {
  it('offers nothing at all when there is nowhere to book', () => {
    expect(buildLeadReplyCandidates({ services: [service()], bookingUrl: null })).toEqual([]);
  });

  it('always ends with the everything option, so there is a safe answer', () => {
    const candidates = buildLeadReplyCandidates({ services: [service()], bookingUrl: BOOKING_URL });
    expect(candidates[candidates.length - 1].kind).toBe('generic');
    expect(candidates[candidates.length - 1].url).toBe(BOOKING_URL);
  });

  it('mints dense indexes that match position', () => {
    const candidates = buildLeadReplyCandidates({
      services: [service({ id: 'a' }), service({ id: 'b' })],
      bookingUrl: BOOKING_URL,
    });
    expect(candidates.map(c => c.index)).toEqual([0, 1, 2]);
  });

  it('points each service at its own booking link', () => {
    const [first] = buildLeadReplyCandidates({
      services: [service({ id: 'svc-xyz' })],
      bookingUrl: BOOKING_URL,
    });
    expect(first.url).toBe(`${BOOKING_URL}?service=svc-xyz`);
  });

  it('treats a priceless quoted service as quoted, not free', () => {
    /*
     * The bug this prevents: a quoted service has no price YET, so a naive
     * price check reads it as free — and "ask for a quote" becomes "book this
     * for nothing".
     */
    const [quoted] = buildLeadReplyCandidates({
      services: [service({ price: null, sale_mode: 'proposal' })],
      bookingUrl: BOOKING_URL,
    });
    expect(quoted.isQuote).toBe(true);
    expect(quoted.isFree).toBe(false);
  });

  it('marks a genuinely free service free', () => {
    const [free] = buildLeadReplyCandidates({
      services: [service({ price: 0 })],
      bookingUrl: BOOKING_URL,
    });
    expect(free.isFree).toBe(true);
    expect(free.isQuote).toBe(false);
  });
});

describe('what the model is shown', () => {
  it('never carries a URL or an id', () => {
    const candidates = buildLeadReplyCandidates({ services: [service()], bookingUrl: BOOKING_URL });
    const serialised = JSON.stringify(candidatesForPrompt(candidates));

    expect(serialised).not.toContain(BOOKING_URL);
    expect(serialised).not.toContain('svc-1');
    // It does need something to reason about.
    expect(serialised).toContain('Deep tissue massage');
  });
});

describe('the fallback ladder', () => {
  const candidates = () =>
    buildLeadReplyCandidates({
      services: [
        service({ id: 'paid', service_name: 'Deep tissue massage', price: 200 }),
        service({ id: 'intro', service_name: 'Intro call', price: 0 }),
      ],
      bookingUrl: BOOKING_URL,
    });

  it('takes them at their word when they named something', () => {
    const picked = pickFallbackCandidate(candidates(), { serviceInterest: 'Deep tissue massage' });
    expect(picked?.serviceId).toBe('paid');
  });

  it('matches a name loosely, because people type their own way', () => {
    expect(pickFallbackCandidate(candidates(), { serviceInterest: 'deep tissue' })?.serviceId).toBe('paid');
    expect(pickFallbackCandidate(candidates(), { serviceInterest: 'INTRO CALL' })?.serviceId).toBe('intro');
  });

  it('offers the free bookable thing when they named nothing', () => {
    // How most of these relationships actually start.
    expect(pickFallbackCandidate(candidates(), {})?.serviceId).toBe('intro');
  });

  it('falls back to everything when there is no free option', () => {
    const paidOnly = buildLeadReplyCandidates({
      services: [service({ id: 'paid', price: 200 })],
      bookingUrl: BOOKING_URL,
    });
    expect(pickFallbackCandidate(paidOnly, {})?.kind).toBe('generic');
  });

  it('answers null when the business has nothing bookable', () => {
    expect(pickFallbackCandidate([], {})).toBeNull();
  });

  it('never picks a free service that cannot be booked against a time', () => {
    const productOnly = buildLeadReplyCandidates({
      services: [service({ id: 'pdf', service_name: 'Free guide', price: 0, is_scheduled: false })],
      bookingUrl: BOOKING_URL,
    });
    // A downloadable has no hour to offer; sending it as "book a time" is wrong.
    expect(pickFallbackCandidate(productOnly, {})?.kind).toBe('generic');
  });
});
