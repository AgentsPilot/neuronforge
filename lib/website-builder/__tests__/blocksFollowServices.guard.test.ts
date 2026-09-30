/**
 * A block that names a service must follow that service — on every page type.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Both routes that assemble blocks used to inject live service data only
 * `if (isLandingPage)`. A pricing or CTA block on an ordinary website page
 * therefore kept the price, name and journey flags it was saved with FOR EVER,
 * while the identical block on a landing page tracked its service. The live list
 * was even fetched for it and then thrown away.
 *
 * This is a source-level guard rather than a behavioural test because the two
 * routes need a Supabase client, a user and a page to say anything at all —
 * and what went wrong was one word in a condition, which is exactly what a
 * reader can check.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROUTES = [
  // The public site.
  join('app', 'api', 'website', 'public', '[subdomain]', 'route.ts'),
  // The editor and the preview, which must agree with it.
  join('app', 'api', 'website', 'pages', '[id]', 'blocks-with-content', 'route.ts'),
];

describe.each(ROUTES)('%s', route => {
  const source = readFileSync(join(process.cwd(), route), 'utf8');

  it('decides from the block, not from the page type', () => {
    expect(source).toContain('const namesAService = Boolean');
    expect(source).toContain('if (isLandingPage || namesAService)');
  });

  it('never gates the injection on the page type alone', () => {
    // The exact line this replaced. A page-type-only gate is the bug.
    expect(source).not.toMatch(/if \(isLandingPage\) \{\s*\n\s*(\/\/|\/\*)?.*PRICING/i);
  });

  it('matches the service by id, never by name', () => {
    // A rename must not silently detach a block from its service.
    expect(source).toContain('liveServices.find(s => s.id === serviceId)');
  });

  it('never lets a page type short-circuit the services block', () => {
    /*
     * The editor route returned landing-page blocks early, BEFORE the services
     * handler — so a landing page's services block kept the snapshot saved when
     * the page was generated: a renamed service at its old price, and free
     * services with no price at all. The published page, which has no such
     * return, showed something different.
     */
    expect(source).not.toContain('if (isLandingPage) return block;');
  });

  it('keeps a hidden service hidden after it is renamed', () => {
    // Keyed by id, with the name only as a fallback for blocks saved before
    // services carried one.
    expect(source).toContain('hiddenById');
    expect(source).toContain('hiddenByName');
  });
});
