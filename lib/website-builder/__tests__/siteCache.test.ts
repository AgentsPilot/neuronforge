import { readFileSync } from 'fs';
import { join } from 'path';
import { SITE_CACHE_TTL_SECONDS, siteCacheTag, siteFetchOptions } from '../siteCache';

const ROOT = join(__dirname, '..', '..', '..');

const PUBLIC_PAGES = [
  'app/site/[subdomain]/page.tsx',
  'app/site/[subdomain]/[slug]/page.tsx',
];

describe('the public site cache', () => {
  it('tags by the name the block routes already revalidate', () => {
    /*
     * `website-${subdomain}` is not a new convention — it is what
     * app/api/website/pages/[id]/blocks/route.ts:164 and
     * [blockId]/route.ts:134,232 have always passed to revalidateTag. Renaming
     * it would silently un-wire three existing call sites.
     */
    expect(siteCacheTag('acme')).toBe('website-acme');
  });

  it('never caches without tagging', () => {
    // An untagged entry is one nothing can invalidate: a stale site with no way
    // back except waiting out the TTL.
    const options = siteFetchOptions('acme');
    expect(options.next.tags).toEqual(['website-acme']);
    expect(options.next.revalidate).toBe(SITE_CACHE_TTL_SECONDS);
  });

  it.each(PUBLIC_PAGES)('%s declares the same TTL as the shared constant', page => {
    /*
     * Next reads route-segment config by static analysis before any module is
     * evaluated, so `export const revalidate` cannot reference the import — it
     * has to be a literal, and the duplication is forced.
     *
     * This is the thing that stops the two drifting. Without it, changing the
     * constant would move the fetch lifetime and silently leave the page
     * rendering on the old one.
     */
    const source = readFileSync(join(ROOT, page), 'utf-8');
    const declared = /export const revalidate = (\d+)/.exec(source);

    expect(declared).not.toBeNull();
    expect(Number(declared![1])).toBe(SITE_CACHE_TTL_SECONDS);
  });

  it.each(PUBLIC_PAGES)('%s does not opt back out of the cache', page => {
    const source = readFileSync(join(ROOT, page), 'utf-8');

    // Any one of these silently restores the original bug: a fetch that is
    // never cached, and therefore never invalidatable.
    expect(source).not.toMatch(/cache:\s*'no-store'/);
    expect(source).not.toMatch(/export const dynamic\s*=\s*'force-dynamic'/);
  });
});
