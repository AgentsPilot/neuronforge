/**
 * The plan card must not promise booking to a business that has none.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * `presenceSummary` tested `mode === 'full_website' || mode === 'website_only'`
 * and returned one sentence for both, ending "That is where clients book you".
 *
 * Those two modes differ by exactly that. `website_only` IS the mode meaning
 * there is no booking surface, and it is what onboarding stores when an owner
 * answers "none" to the services count — a website and a contact form, both
 * feeding the CRM. So the plan promised booking to the one business that had
 * just said it sells nothing, and to every business selling something nobody
 * books a time for.
 *
 * WHY THE PLAN IS THE WORST PLACE FOR IT
 *
 * It is the screen the owner APPROVES, and they approve it before anything
 * exists to contradict it. The same class of mistake on the build page — "Your
 * site is published", about a draft — is recorded in that file as a promise
 * people acted on and then could not understand.
 *
 * WHY A SOURCE-LEVEL GUARD
 *
 * `presenceSummary` is an inline IIFE inside a 2,500-line client component that
 * mounts the whole chat. Rendering it to assert one sentence would cost more
 * than it protects and would break for unrelated reasons. What has to hold is
 * structural and reads fine from the source: the two modes answer separately,
 * and only one of them says "book".
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(join(__dirname, '..', 'page.tsx'), 'utf8');

/** The `presenceSummary` IIFE, from its name to the line that closes it. */
function presenceSummarySource(): string {
  const start = source.indexOf('const presenceSummary = (() => {');
  expect(start).toBeGreaterThan(-1);

  const end = source.indexOf('})();', start);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('guard: the plan tells the truth about what the site does', () => {
  it('answers full_website and website_only separately', () => {
    const body = presenceSummarySource();

    expect(body).toContain("mode === 'full_website'");
    expect(body).toContain("mode === 'website_only'");

    /*
     * The exact shape of the bug: one branch covering both. Written as a
     * regex so re-ordering the operands cannot slip past it.
     */
    expect(body).not.toMatch(/mode === 'full_website'\s*\|\|\s*mode === 'website_only'/);
    expect(body).not.toMatch(/mode === 'website_only'\s*\|\|\s*mode === 'full_website'/);
  });

  it('promises booking only where there is a booking surface', () => {
    const body = presenceSummarySource();

    const websiteOnly = body.slice(body.indexOf("mode === 'website_only'"));
    // Not vacuous: the branch really is the one that answers for this mode.
    expect(websiteOnly.length).toBeGreaterThan(100);
    expect(websiteOnly).toMatch(/ready for you to publish/);

    /*
     * The English sentence for a site with no booking must not say "book".
     * Only the English copy is asserted — it is the fallback every language
     * is translated from, so a regression arrives here first.
     */
    const english = websiteOnly.slice(0, websiteOnly.indexOf('return', websiteOnly.indexOf('selectedLanguage')) + 2000);
    expect(english).not.toMatch(/clients book you/);
  });

  it('still promises booking on the mode that has it', () => {
    // The other half, so this guard cannot be satisfied by removing the claim
    // everywhere — `full_website` genuinely is where clients book.
    const body = presenceSummarySource();
    const fullWebsite = body.slice(
      body.indexOf("mode === 'full_website'"),
      body.indexOf("mode === 'website_only'")
    );

    expect(fullWebsite).toMatch(/clients book you/);
  });
});
