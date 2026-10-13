/**
 * The Google step is the listing, and Analytics is no longer offered.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * (a) THE NAME. The setup step carried the id `google_analytics` while its own
 *     copy read "see who finds you through search and your listing" — the
 *     Business Profile, not Analytics — and its completion accepted either
 *     connection. Three different things under one name, so nobody reading the
 *     id could tell which the row was about.
 *
 * (b) THE OFFER. Analytics was a tile in the connect row. A GA4 property is
 *     something a business either already runs or has never opened, and these
 *     businesses are the second kind, so the tile was a dead end for almost
 *     everyone who pressed it. It also answers the wrong question: GA counts
 *     every visit to the property from every source, which cannot be set
 *     against leads this platform captured itself.
 *
 * (c) THE REPAIR PATH. Deleting the provider entry would have been the obvious
 *     way to stop offering it, and `providerOf` falls back to 'meta' — so an
 *     expired Analytics connection would have offered to reconnect itself
 *     through Facebook. It is listed and not offered, which are separate facts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * `reach.blocked.${item.id}` is assembled at RUNTIME from the step id, so a
 * rename that misses the copy key does not fail to compile and does not throw.
 * It silently falls back to the step title, and the line that explains what the
 * user is missing turns into a repetition of the heading above it. Nothing but
 * a reader would ever notice.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

/*
 * The three dictionaries, which used to be one block inside
 * `LanguageContext.tsx` before that file was split. Read as source, not
 * imported: the assertions are about what the copy SAYS, and importing the
 * component to find out would pull React in.
 */
const copy = ['en', 'es', 'he']
  .map(lang => read(`lib/business-os/translations/${lang}.ts`))
  .join('\n');
const card = read('components/business-os/insight/ChannelsCard.tsx');
const graph = read('lib/business-os/setup/setupGraph.ts');
const page = read('app/business-os/page.tsx');

/** The three locale blocks each declare the key once. */
const LOCALES = 3;

describe('the renamed step keeps the copy that is looked up by its id', () => {
  it('has a blocked line under the new id, in every language', () => {
    const hits = copy.match(/'reach\.blocked\.google_business':/g) ?? [];

    expect(hits).toHaveLength(LOCALES);
  });

  it('left none under the old id', () => {
    expect(copy).not.toMatch(/'reach\.blocked\.google_analytics':/);
  });

  it('has a chain label under the new id, in every language', () => {
    const hits = copy.match(/'checklist\.google':/g) ?? [];

    expect(hits).toHaveLength(LOCALES);
  });

  it('no longer describes it as analytics', () => {
    /*
     * The old line was "You cannot see where your visitors come from", which is
     * what Analytics answers. The listing answers a different question, and the
     * copy had to move with the id rather than only the key.
     */
    expect(copy).not.toMatch(/'checklist\.analytics':/);
  });
});

describe('the id says what the step is', () => {
  it('the graph declares google_business', () => {
    expect(graph).toMatch(/\{ id: 'google_business',/);
    expect(graph).not.toMatch(/id: 'google_analytics'/);
  });

  it('completion means the listing, not a property', () => {
    /*
     * This accepted either connection, so an account with Analytics and no
     * listing read as "Google connected" while being invisible in search.
     */
    expect(page).toMatch(/Boolean\(s\.channels\?\.google_business_profile\)/);
  });
});

describe('neither third-party channel is pressed on a business', () => {
  it('both are flagged, not just the last one', () => {
    /*
     * `suggested` takes the first ready step in graph order, so flagging only
     * the final row moves the problem up by one instead of fixing it.
     */
    expect(graph).toMatch(/id: 'meta_insights'.*neverSuggested: true/);
    expect(graph).toMatch(/id: 'google_business'.*neverSuggested: true/);
  });
});

describe('Analytics is listed but not offered', () => {
  it('is marked unofferable rather than deleted', () => {
    expect(card).toMatch(/provider: 'google_analytics',\s*\n\s*offered: false,/);
  });

  it('the connect row skips it', () => {
    expect(card).toMatch(/if \(offered === false\) continue;/);
  });

  it('is still resolvable, so an expired connection reconnects to Google', () => {
    /*
     * `providerOf` reads this same list and falls back to 'meta'. Remove the
     * entry and an expired GA4 token offers a Facebook login to fix it.
     */
    expect(card).toMatch(/platforms: \['ga4'\]/);
    expect(card).toMatch(/PROVIDERS\.find\(p => p\.platforms\.includes\(platform\)\)/);
  });

  it('the listing is still offered', () => {
    /*
     * The point was to drop Analytics, not Google. A local listing is the
     * Google surface these businesses are actually found through.
     */
    const listing = card.slice(card.indexOf("provider: 'google_business_profile'"));

    expect(listing).not.toMatch(/^[\s\S]{0,200}offered: false/);
  });
});
