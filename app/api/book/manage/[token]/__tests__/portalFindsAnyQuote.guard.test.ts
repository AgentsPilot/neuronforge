/**
 * A quote sent to a client is answerable from that client's portal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * The portal looked for a proposal only when the booking's SERVICE was
 * configured `sale_mode: 'proposal'`:
 *
 *     const quotesExpected = service?.sale_mode === 'proposal';
 *     if (quotesExpected) { …look for a quote… }
 *
 * The quote builder has no such restriction. It takes any `bookingId`, and a
 * `serviceId` that may be null — so an owner could raise and send a quote
 * against an ordinary booking, and the client would open the portal to find no
 * quote, no price, and no way to accept or decline. The one screen they were
 * sent to could not show the thing they were sent it for.
 *
 * The accept and decline controls were never missing: they live on
 * `/proposal/[token]`, and the portal links there. What was missing was the
 * link, because the portal never knew the quote existed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DISTINCTION THIS KEEPS
 *
 * "Is a quote expected" and "does a quote exist" are different questions, and
 * only the first depends on the service. `awaitingQuote` — the "a quote is
 * coming" placeholder — must stay gated on `sale_mode`, or an ordinary booking
 * would tell its client to sit tight for a price nobody is writing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const route = fs.readFileSync(
  path.join(process.cwd(), 'app/api/book/manage/[token]/route.ts'),
  'utf8'
);

describe('the portal finds a quote however the service is sold', () => {
  it('does not gate the lookup on sale_mode', () => {
    // The exact shape of the defect.
    expect(route).not.toMatch(/if \(quotesExpected\) \{/);
  });

  it('returns whatever quote was found', () => {
    /*
     * It returned `quotesExpected ? quote : undefined`, so even a quote that
     * HAD been read would have been discarded on the way out.
     */
    expect(route).toMatch(/quote: quote \?\? undefined/);
    expect(route).not.toMatch(/quote: quotesExpected \? quote/);
  });

  it('still only promises a quote where one is actually expected', () => {
    /*
     * The half that must NOT change. `awaitingQuote` is a statement about how
     * the service is sold, and on an ordinary booking it would be an invention.
     */
    expect(route).toMatch(/awaitingQuote: quotesExpected && !quote/);
  });
});

describe('what the client is given to answer with', () => {
  it('signs a link only for a quote that has been sent', () => {
    /*
     * A `draft` gets no token: it has not been sent, and a link would be the
     * business showing work it has not finished.
     */
    expect(route).toMatch(/proposal\.status !== 'draft'/);
  });

  it('signs it only when there is an address to sign it for', () => {
    // The token binds the quote to this client's email; without one there is
    // nothing to bind and no link is offered.
    expect(route).toMatch(/contactEmail && proposal\.status !== 'draft'/);
  });

  it('reads the newest version, never a superseded one', () => {
    // A revised quote replaces the one before it, and showing a client the
    // first of three would quote them a price nobody is offering.
    expect(route).toMatch(/\.neq\('status', 'superseded'\)/);
    expect(route).toMatch(/\.order\('created_at', \{ ascending: false \}\)/);
  });
});
