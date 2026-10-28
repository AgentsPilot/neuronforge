/**
 * The smart-links row shows a missing count as missing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS (FU-SL-1, FU-SL-2)
 *
 * The row read `link.unique_visitors ?? 0` with `muted: false`. When the count
 * failed, the route sent 0 and this printed a confident, un-muted zero against
 * every link — "nobody came" in place of "we could not count". The two call
 * for opposite responses from a business owner.
 *
 * And at the read's 20,000-row ceiling the figure is a FLOOR. The repository
 * has always logged that; the screen showed the truncated number as exact.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The tile is an inline literal inside a ~5,000-line page with no seam to
 * render one row through, and the thing that must hold is which value the cell
 * chooses — a property of the source. The behaviour either side of it IS
 * tested for real: the repository in `rangeCapTrancheA.paging.test.ts`, the
 * route in `uniqueVisitorsAreNotZero.test.ts`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const page = fs.readFileSync(
  path.join(process.cwd(), 'app/business-os/website/page.tsx'),
  'utf8'
);

/**
 * The smart-link row's unique-visitors tile.
 *
 * Taken as a window AROUND the tile's label rather than by matching braces:
 * the value is a template literal, so the nearest `{` walking backwards is
 * `${link.unique_visitors}` and not the object at all — which is how a first
 * pass here sliced three characters and asserted against nothing. The window
 * reaches past the label too, because `muted` follows it.
 */
const tile = (() => {
  const at = page.indexOf('label: labels.unique_visitors,');
  expect(at).toBeGreaterThan(-1);

  return page.slice(Math.max(0, at - 2000), at + 300);
})();

describe('a count that could not be made', () => {
  it('is shown as absent, not as zero', () => {
    expect(tile).toMatch(/link\.unique_visitors == null\s*\?\s*'—'/);
  });

  it('is muted, like the Rate cell with no reading beside it', () => {
    /* Borrowed rather than invented: the row already says "no reading" this
       way, and reusing it means nothing new to translate. */
    expect(tile).toMatch(/muted: link\.unique_visitors == null/);
  });

  it('no longer coerces a missing figure to zero', () => {
    /* The fault exactly as it was written. */
    expect(tile).not.toMatch(/link\.unique_visitors \?\? 0/);
  });
});

describe('a count that is only a floor', () => {
  it('is marked, so a capped figure is not read as exact', () => {
    expect(tile).toMatch(/link\.unique_visitors_at_least/);
    expect(tile).toMatch(/\$\{link\.unique_visitors\}\+/);
  });
});

describe('a count that is genuinely zero', () => {
  it('still reads 0, and is not muted', () => {
    /*
     * The distinction the whole change exists for. A link nobody visited is a
     * MEASUREMENT and the owner should see it plainly; only a failed count is
     * absent. Both follow from testing `== null` rather than falsiness — `0`
     * is falsy, and `?? `/`|| ` here is exactly how the two came to be
     * confused.
     */
    expect(tile).not.toMatch(/link\.unique_visitors \|\|/);
    expect(tile).toMatch(/== null/);
  });
});

describe('the field admits the absence', () => {
  it('is typed as nullable on the page', () => {
    expect(page).toMatch(/unique_visitors\?: number \| null;/);
  });

  it('and carries the floor flag', () => {
    expect(page).toMatch(/unique_visitors_at_least\?: boolean;/);
  });
});
