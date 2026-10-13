/**
 * No page that renders one client's data is ever cacheable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS WRITTEN BEFORE THE COOKIE WORK, NOT AFTER
 *
 * Right now the booking portal and the invoice page are safe by accident. The
 * credential sits in the PATH, so every client's URL is unique — nothing can
 * serve one client's booking to another even if it decided to cache, because
 * no two clients ever request the same address.
 *
 * Moving the token into a cookie ends that. `/book/manage/<booking id>` becomes
 * one URL rendering different content depending on who is asking, which is
 * precisely the shape a CDN, a reverse proxy, or a Next.js caching default will
 * share between two people.
 *
 * The failure mode is not a broken page. It is client A opening their booking
 * and being shown client B's appointment, address and unpaid bill — a
 * cross-client data leak strictly worse than the address-bar exposure the
 * cookie exists to close. A change made for security would have created a
 * larger hole than it shut.
 *
 * So the rule is declared first and held here, and the cookie work lands on top
 * of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BOTH HALVES ARE REQUIRED
 *
 * The route-segment config tells NEXT not to cache. The response header tells
 * everything BETWEEN us and the client the same thing. Neither covers the
 * other: Next's directives mean nothing to a CDN, and a header means nothing to
 * Next's own full-route cache.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

/** Every surface that renders one identified client's data. */
const PER_CLIENT_SURFACES = [
  'app/book/manage/[token]/layout.tsx',
  'app/invoice/[id]/layout.tsx',
];

describe('the per-client pages opt out of every cache', () => {
  it.each(PER_CLIENT_SURFACES)('%s is force-dynamic', file => {
    expect(read(file)).toMatch(/export const dynamic = 'force-dynamic'/);
  });

  it.each(PER_CLIENT_SURFACES)('%s revalidates never', file => {
    expect(read(file)).toMatch(/export const revalidate = 0/);
  });

  it.each(PER_CLIENT_SURFACES)('%s does not let fetches be cached either', file => {
    /*
     * A page can be dynamic and still serve a stale body if the fetch that
     * loaded the booking was itself cached.
     */
    expect(read(file)).toMatch(/export const fetchCache = 'force-no-store'/);
  });

  it('says it to the proxies as well, not only to Next', () => {
    const mw = read('middleware.ts');
    expect(mw).toMatch(
      /carriesASecretInTheUrl\(pathname\)[\s\S]{0,900}Cache-Control['"],\s*['"]private, no-store/
    );
  });

  it('never marks any of them public or shared', () => {
    // `s-maxage` and `public` are the two words that would undo all of it.
    const mw = read('middleware.ts');
    const block = mw.slice(mw.indexOf('carriesASecretInTheUrl(pathname)'));
    expect(block.slice(0, 900)).not.toMatch(/s-maxage|public,/);
  });
});

describe('the surfaces that must be on the list', () => {
  /*
   * A new per-client public page is the thing that will be added without this
   * declaration, so the list is asserted rather than assumed.
   */
  it('covers the booking portal and the invoice', () => {
    expect(PER_CLIENT_SURFACES).toContain('app/book/manage/[token]/layout.tsx');
    expect(PER_CLIENT_SURFACES).toContain('app/invoice/[id]/layout.tsx');
  });

  it('and every one of them exists', () => {
    for (const file of PER_CLIENT_SURFACES) {
      expect(fs.existsSync(path.join(process.cwd(), file))).toBe(true);
    }
  });
});
