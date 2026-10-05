/**
 * No producer of sections may hand out a button without a destination check.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Every generator writes its destinations as literal strings — `#services`,
 * `#booking`, `#contact` — decided from what it knows at the time: how many
 * services the business has, whether the offering is bookable. WHICH SECTIONS
 * THE PAGE ENDS UP WITH is decided somewhere else:
 *
 *   • the website generator's `buildBlocks` emits eleven sections and
 *     `orderByRecipe` then drops the ones this vertical does not get
 *   • the landing route picks its sections from the offering, and spreads
 *     generated content over them that can carry destinations of its own
 *
 * Two authors, one contract. A fragment naming no element is the quietest
 * failure a page can have — no navigation, no scroll, nothing reported — so
 * the button is present, looks right, and does nothing.
 *
 * Source-level because the alternative is running a generator, which needs a
 * model, a profile and a database. What can be checked anywhere is that each
 * producer's final list goes through the shared pass before it is stored or
 * shown. The pass itself is covered by `linkIntegrity.test.ts`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');

/** Everything that assembles sections and then stores or returns them. */
const PRODUCERS = [
  ['the website generator', 'lib/services/WebsiteGenerationService.ts'],
  ['the landing page route', 'app/api/website/landing-pages/route.ts'],
  ['the landing page preview', 'app/api/website/landing-pages/preview/route.ts'],
] as const;

describe('every producer of sections checks its destinations', () => {
  it.each(PRODUCERS)('%s runs the shared pass', (_label, file) => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    expect(source).toContain("from '@/lib/website-builder/linkIntegrity'");
    expect(source).toMatch(/repairBlockLinks\(/);
  });

  /*
   * The website generator has to check AFTER the recipe, not before: the recipe
   * is what drops the sections, so a list validated before it is a list
   * validated against a page that does not exist yet.
   */
  it('the website generator checks after the recipe has dropped sections', () => {
    const source = readFileSync(join(ROOT, 'lib/services/WebsiteGenerationService.ts'), 'utf8');
    const ordered = source.indexOf('orderByRecipe(');
    const checked = source.indexOf('repairBlockLinks(');
    expect(ordered).toBeGreaterThan(-1);
    expect(checked).toBeGreaterThan(ordered);
  });

  it('the landing route checks before it writes, not after', () => {
    const source = readFileSync(join(ROOT, 'app/api/website/landing-pages/route.ts'), 'utf8');
    const checked = source.indexOf('repairBlockLinks(');
    const written = source.indexOf('blockRepo.bulkCreate(');
    expect(checked).toBeGreaterThan(-1);
    expect(written).toBeGreaterThan(checked);
    // ...and writes the checked list, not the raw one.
    expect(source).toContain('bulkCreate(checkedBlocks)');
  });

  it('the preview returns the checked list, so the wizard shows what gets saved', () => {
    const source = readFileSync(join(ROOT, 'app/api/website/landing-pages/preview/route.ts'), 'utf8');
    expect(source).toContain('blocks: checkedBlocks');
  });
});

describe('the anchor table has one home', () => {
  it('the renderer reads it rather than keeping a copy', () => {
    const renderer = readFileSync(
      join(ROOT, 'components/website/blocks/index.tsx'),
      'utf8'
    );
    expect(renderer).toContain("from '@/lib/website-builder/sectionAnchors'");
    // The transcription that used to live here is what let the two drift.
    expect(renderer).not.toMatch(/anchorMap:\s*Partial<Record<BlockType, string>>/);
  });
});
