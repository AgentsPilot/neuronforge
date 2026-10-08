/**
 * A client answers their quote without leaving the portal, from one implementation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * The quote had a page at `/proposal/[token]`, in its own route tree, and the
 * portal linked out to it. Nothing was broken — accept and decline were both
 * there — but the client was sent out of the portal to answer, onto a page with
 * none of the section's frame and none of their own meetings beside it. It read
 * as a page from somewhere else because it was one.
 *
 * `/book/manage/[token]/quote` sits under the portal's layout, which mounts the
 * frame and the rail once for the whole section.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REAL RISK IS A SECOND COPY
 *
 * The obvious way to put a quote in the portal is to write a second one. That
 * copy would own its own accept path, its own decline reasons, its own document
 * gate and its own six terminal states — and a duplicated flow that takes money
 * is one that eventually disagrees with itself about what a client agreed to.
 *
 * So what this holds is not "the route exists". It is that BOTH routes mount the
 * SAME component, and that neither has grown logic of its own.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const component = read('components/public/ProposalAnswer.tsx');
const emailRoute = read('app/proposal/[token]/page.tsx');
const portalRoute = read('app/book/manage/[token]/quote/page.tsx');
const portal = read('app/book/manage/[token]/page.tsx');

describe('both surfaces mount one component', () => {
  it.each([
    ['the quote email route', emailRoute],
    ['the portal route', portalRoute],
  ])('%s renders ProposalAnswer', (_name, source) => {
    expect(source).toMatch(/<ProposalAnswer/);
  });

  it('neither route carries the flow itself', () => {
    /*
     * The accept POST, the decline reasons and the document gate belong to the
     * component. A route that grows any of them has started a second copy.
     */
    for (const source of [emailRoute, portalRoute]) {
      expect(source).not.toMatch(/DECLINE_REASONS/);
      expect(source).not.toMatch(/answer: 'accept'/);
      expect(source).not.toMatch(/documentOpened/);
    }
  });

  it('the email route still exists, because every quote email links to it', () => {
    /*
     * `ProposalSendService` builds `${appUrl}/proposal/${token}`, so this is the
     * URL in every quote already sent. It must keep rendering a quote for the
     * case that cannot be redirected.
     */
    expect(emailRoute).toMatch(/<ProposalAnswer token=\{token\} \/>/);
  });

  it('the email link lands in the portal when there is a booking behind it', () => {
    /*
     * Fixing this in the EMAIL would fix the next quote and none of the ones
     * already in people's inboxes. Deciding here fixes both.
     *
     * A server component, so the redirect happens before anything paints — a
     * client is never shown the standalone quote for a moment and then moved.
     */
    expect(emailRoute).not.toMatch(/^'use client'/m);
    expect(emailRoute).toMatch(/redirect\(portalUrl\)/);
    expect(emailRoute).toMatch(/\/book\/manage\/\$\{generateBookingToken\(bookingId, payload\.email\)\}\/quote/);
  });

  it('falls back to standalone for a quote with no booking', () => {
    /*
     * `proposals.booking_id` is nullable — null for quotes raised outside a
     * booking, and for rows predating the column. There is no portal to embed
     * those in and no booking token to sign, so they keep the standalone page.
     */
    expect(emailRoute).toMatch(/if \(!bookingId\) return null;/);
  });

  it('never fails the page over a lookup it could not complete', () => {
    /*
     * A quote that cannot be PLACED is still a quote the client may read and
     * answer. Turning a missing frame into a missing page would be the worse
     * outcome, so both failure paths return null and render standalone.
     */
    expect(emailRoute).toMatch(/showing it standalone/);
  });
});

describe('the embedded copy does not frame itself twice', () => {
  it('the portal route asks for the embedded form', () => {
    expect(portalRoute).toMatch(/<ProposalAnswer token=\{proposalToken\} embedded \/>/);
  });

  it('the component skips its shell when embedded', () => {
    /*
     * The portal layout mounts `PortalShell` once for the section. A second
     * shell inside it would draw the header and the frame twice.
     *
     * Both exits are guarded: the terminal states (accepted, declined, expired…)
     * render a card, and the quote itself renders a body. An early draft guarded
     * only the second, so an already-accepted quote framed itself twice.
     */
    expect(component).toMatch(/if \(embedded\) return card;/);
    expect(component).toMatch(/return embedded \? \(\s*body\s*\) : \(/);
  });
});

describe('the portal sends the client inward', () => {
  it('links to the embedded route, not out to /proposal', () => {
    expect(portal).toMatch(/href=\{`\/book\/manage\/\$\{token\}\/quote`\}/);
    expect(portal).not.toMatch(/href=\{`\/proposal\/\$\{quote\.token\}`\}/);
  });

  it('the embedded route asks the portal API for the quote’s own token', () => {
    /*
     * Two different credentials: the URL carries the BOOKING token, and the
     * quote is addressed by a PROPOSAL token signed against the client's email.
     *
     * Fetched rather than minted here, because that endpoint already proves the
     * caller holds a valid booking token, already takes the newest
     * non-superseded quote, and already refuses to sign a DRAFT — rules a second
     * signing path would have to remember and would eventually forget.
     */
    expect(portalRoute).toMatch(/\/api\/book\/manage\/\$\{token\}/);
    expect(portalRoute).toMatch(/data\?\.quote\?\.token/);
    expect(portalRoute).not.toMatch(/generateProposalToken/);
  });

  it('says so plainly when there is no quote to answer', () => {
    // A draft, or a client with no address to sign a token against. Better than
    // an empty frame.
    expect(portalRoute).toMatch(/if \(!proposalToken\)/);
  });
});
