/**
 * The guard that makes one-click confirmation safe.
 *
 * Confirming on arrival is the right experience, and it is only defensible
 * because of this check. Mail gateways, Outlook Safe Links and antivirus all
 * fetch the URLs in an email before the recipient sees them; without this, one
 * of those would subscribe somebody who never clicked, which is the exact
 * failure double opt-in exists to prevent.
 *
 * `Sec-Fetch-User: ?1` is sent by browsers ONLY for a navigation the user
 * actually triggered. Every case below is about keeping that meaning intact.
 */

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
}));

import { looksLikeHumanClick } from '../confirmConsent';

/** Just the one method the guard uses, case-insensitive like a real Headers. */
function headers(map: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

describe('looksLikeHumanClick', () => {
  it('accepts a real click on a link', () => {
    expect(
      looksLikeHumanClick(
        headers({
          'Sec-Fetch-User': '?1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
        })
      )
    ).toBe(true);
  });

  it('rejects a request with no fetch metadata at all', () => {
    // A scanner, a curl, an old browser. All get the button, which costs a
    // real person one extra click and costs a scanner the confirmation.
    expect(looksLikeHumanClick(headers({ 'User-Agent': 'Mozilla/5.0' }))).toBe(false);
  });

  it('rejects a prefetch, which carries no user activation', () => {
    expect(
      looksLikeHumanClick(headers({ 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate' }))
    ).toBe(false);
  });

  it('rejects a background fetch dressed as a navigation', () => {
    expect(
      looksLikeHumanClick(headers({ 'Sec-Fetch-User': '?1', 'Sec-Fetch-Dest': 'empty' }))
    ).toBe(false);
  });

  it('rejects an image or script fetch of the same URL', () => {
    // Some scanners request the URL as a subresource to see whether it resolves.
    expect(
      looksLikeHumanClick(headers({ 'Sec-Fetch-User': '?1', 'Sec-Fetch-Dest': 'image' }))
    ).toBe(false);
  });

  it('rejects "?0", which is the header explicitly saying NOT user-activated', () => {
    expect(
      looksLikeHumanClick(headers({ 'Sec-Fetch-User': '?0', 'Sec-Fetch-Dest': 'document' }))
    ).toBe(false);
  });

  it('reads headers case-insensitively, as a real request does', () => {
    expect(
      looksLikeHumanClick(headers({ 'SEC-FETCH-USER': '?1', 'SEC-FETCH-DEST': 'document' }))
    ).toBe(true);
  });
});
