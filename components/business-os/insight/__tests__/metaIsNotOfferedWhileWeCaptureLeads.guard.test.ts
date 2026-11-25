/**
 * Meta insights is not offered. Instagram and Facebook attribution still is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner decision 2026-11-10. `meta-insights` is read-only reach — page and
 * profile insights, follower counts, post performance — and produces no
 * contact, no enquiry and nothing an agent can act on. This phase of the
 * product is about CAPTURING leads, so an OAuth the owner must complete in
 * exchange for a number was withdrawn from every surface that offered it.
 *
 * The distinction this guard exists to protect, because it is easy to delete
 * the wrong half: the Instagram and Facebook CHANNELS stay. They resolve from
 * the referrer (`l.instagram.com`, `fb.me`, `messenger.com` and the rest),
 * need nothing connected, and carry identified leads with bookings and revenue
 * against them. That is the half that captures leads.
 *
 * Nor is the provider deleted. `providerOf` falls back to 'meta', so removing
 * the entry would offer to repair an expired Analytics connection through
 * Facebook — the reason the `offered: false` mechanism exists at all.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

const CARD = read('components', 'business-os', 'insight', 'ChannelsCard.tsx');
const PAGE = read('app', 'business-os', 'page.tsx');
const CHAT = read('lib', 'services', 'OnboardingConversationManager.ts');
const REFERRER = read('lib', 'business-os', 'channel-insights', 'channelFromReferrer.ts');

describe('the connect tile', () => {
  it('still lists meta, so an existing connection can be repaired', () => {
    expect(CARD).toContain("provider: 'meta',");
    expect(CARD).toContain("platforms: ['facebook_page', 'instagram'],");
  });

  it('no longer offers it', () => {
    const entry = CARD.slice(CARD.indexOf("provider: 'meta',"), CARD.indexOf("provider: 'google_analytics'"));
    expect(entry).toContain('offered: false,');
  });

  it('withdraws the Google listing too, on the same terms', () => {
    const entry = CARD.slice(CARD.indexOf("provider: 'google_business_profile',"));
    expect(entry.slice(0, 200)).toContain('offered: false,');
  });

  it('leaves NO provider offered, which the chip list survives', () => {
    /* Website, landing page, smart link and mailbox chips are built from their
       own branches, so the card still has things to offer. */
    const offered = [...CARD.matchAll(/provider: '(\w+)',/g)].map(m => m[1]);
    expect(offered).toEqual(expect.arrayContaining(['meta', 'google_analytics', 'google_business_profile']));
    expect((CARD.match(/offered: false,/g) ?? []).length).toBe(3);
    expect(CARD).toContain("if (offered === false) continue;");
    expect(CARD).toContain("key: 'website',");
    expect(CARD).toContain("key: 'smart-links',");
  });
});

describe('readiness', () => {
  it('pushes the meta step only for an account that already has it connected', () => {
    expect(PAGE).toContain('if (metaConnected) {');
    /* The unconditional push is what made it a step with nowhere to go. */
    expect(PAGE).not.toMatch(/completed: metaConnected,\s*\n\s*action: 'connect_channels',/);
  });

  it('keeps the row for those accounts, so a token expiry is still reported', () => {
    /* `brokenConnections` reads this id to decide whether meta-insights is in
       use. No row, no alert, for an account whose connection is live. */
    expect(PAGE).toContain("meta: completed('meta_insights'),");
    expect(PAGE).toContain("id: 'meta_insights',");
  });

  it('gates the Google listing step the same way', () => {
    expect(PAGE).toContain('if (googleConnected) {');
    expect(PAGE).toContain("id: 'google_business',");
    /* The unconditional push, which put a step in front of every owner. */
    expect(PAGE).not.toMatch(/completed: googleConnected,\s*\n\s*action: 'connect_channels',/);
  });

  it('still reports a listing token expiry for accounts that have one', () => {
    expect(PAGE).toContain("listing: completed('google_business'),");
  });
});

describe('the onboarding question', () => {
  it.each([
    ['English', 'Show me where my clients come from'],
    ['Hebrew', 'לראות מאיפה מגיעים הלקוחות שלי'],
    ['Spanish', 'Ver de dónde vienen mis clientes'],
  ])('asks for the answer, not for a connection, in %s', (_language, option) => {
    expect(CHAT).toContain(option);
  });

  it('names no platform to connect, in any language', () => {
    expect(CHAT).not.toContain('Connect Facebook, Instagram or Google');
    expect(CHAT).not.toContain('לחבר פייסבוק, אינסטגרם או גוגל');
    expect(CHAT).not.toContain('Conectar Facebook, Instagram o Google');
    expect(CHAT).not.toContain('Connect your Google listing');
    expect(CHAT).not.toContain('לחבר את הפרופיל העסקי בגוגל');
  });

  it('still understands an owner who says those words themselves', () => {
    /* The option stopped naming them; an owner typing "instagram" still means
       "tell me where clients come from", and the channels card answers it. */
    expect(CHAT).toContain("lowerMsg.includes('instagram')");
    expect(CHAT).toContain("lowerMsg.includes('facebook')");
  });
});

describe('what must NOT have been removed', () => {
  it('instagram and facebook are still resolved from the referrer', () => {
    expect(REFERRER).toContain("{ suffixes: ['instagram.com', 'ig.me'], channel: 'instagram' }");
    expect(REFERRER).toContain("'facebook.com', 'fb.com', 'fb.me', 'messenger.com'");
  });

  it('and are still channels in their own right', () => {
    expect(REFERRER).toContain("| 'instagram'");
    expect(REFERRER).toContain("| 'facebook'");
  });
});
