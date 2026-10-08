/**
 * Every public page puts its cards in the same place, in the same order.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * Two mechanisms were used to arrange the portal's cards, and both of them
 * made the page change shape depending on which booking you opened:
 *
 * 1. `grid-flow-row-dense`. Dense placement backfills a gap by pulling a LATER
 *    tile forward into it, so the same card landed in a different cell
 *    depending on which optional cards (intake, a payment plan, a package)
 *    happened to be present. Reported as "every booking the portal looks
 *    different".
 *
 * 2. `order-N` on SOME cards. Position was then decided in two places, so the
 *    order a reader saw in the JSX was not the order that rendered.
 *
 * What replaced them: `items-start`, so no card stretches to a neighbour's
 * height and no gaps open that need backfilling; and `order` on EVERY card, so
 * there is one declared sequence rather than two half-rules. The rail's cards
 * are rendered by the layout and have to interleave with the page's, which DOM
 * order alone cannot express.
 *
 * A third failure is guarded here too: the layout must not choose its
 * arrangement from the URL. `PortalLayout` did, with a regex that matched only
 * the index — and the reminder emails link to `/reschedule`, `/cancel` and
 * `/intake` far more often, so most clients got the other branch entirely.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOTS = ['components/public', 'app/book/manage'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = ROOTS.flatMap(root => walk(join(process.cwd(), root)));

/** Prose about a class is not a class. */
const codeOf = (file: string) =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const rel = (f: string) => f.replace(`${process.cwd()}/`, '');

describe('the public card layer', () => {
  it('has files to check', () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  it('never orders cards with `order-N`', () => {
    /*
     * The portal index is TWO COLUMNS now, each a plain vertical stack, so a
     * card's place is simply where it is written. `order` was needed only
     * while one grid had to interleave cards from two different files, and
     * reintroducing it would put position back in two places.
     *
     * `border-…` contains the substring, so the boundary before it matters.
     */
    const FORBIDDEN = /(?:^|[\s"'`:])(?:sm:|md:|lg:|xl:)?order-(?:\d+|first|last|none)\b/;
    const offenders = FILES.filter(f => FORBIDDEN.test(codeOf(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('builds the index from two independent columns', () => {
    /*
     * The thing that kept going wrong: a grid aligns rows across the whole
     * width, so either every card stretches to the tallest in its row (a
     * three-line payment card became a block of empty brand colour) or a card
     * spanning two rows leaves a hole under it. Both shipped.
     *
     * Columns have no say over each other's heights, so neither can happen.
     */
    const code = codeOf(join(process.cwd(), 'app/book/manage/[token]/page.tsx'));
    expect(code).toMatch(/flex flex-col gap-3 lg:flex-row/);
    expect(code).not.toMatch(/lg:row-span-\d/);
  });

  it('never backfills gaps by reordering', () => {
    const offenders = FILES.filter(f => /grid-flow-(?:row-|col-)?dense/.test(codeOf(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('never chooses a layout from the URL', () => {
    /*
     * `usePathname` is legitimate for a link's active state; branching a
     * LAYOUT on it is what broke. The test is the pairing of the two.
     */
    const offenders = FILES.filter(f => {
      const code = codeOf(f);
      return code.includes('usePathname') && /\/book\\?\/manage/.test(code);
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it('declares the portal grid in exactly one place', () => {
    /*
     * A grid INSIDE a card is nobody's business but that card's — a two-column
     * row of facts, the days of the week in pairs. What must not be restated
     * is the PAGE's track count, which is the thing the rail's `col-span`
     * wrappers are written against: those two disagreeing is how a wrapper
     * built for four tracks ends up on a two-track grid.
     *
     * So the test is positive. The shell and the index both take it from the
     * constant, and the constant is the only place the number lives.
     */
    const container = readFileSync(
      join(process.cwd(), 'lib/business-os/pageContainer.ts'),
      'utf8'
    );
    const grid = container.match(/export const PORTAL_GRID = '([^']+)'/)?.[1] ?? '';
    // One column on a phone, two on a tablet, four on a desktop. The count is
    // pinned because the rail's `col-span` wrappers are written against it:
    // a wrapper asking for two of four is half the page, and two of two is all
    // of it.
    expect(grid).toContain('grid-cols-1');
    expect(grid).toContain('lg:grid-cols-4');
    /*
     * `items-start`, pinned deliberately. Without it the grid stretches every
     * card to the height of the tallest in its row, and a payment card of
     * three lines beside a tall appointment renders as a huge empty block of
     * brand colour. That shipped twice.
     */
    expect(grid).toContain('items-start');

    /*
     * Only the SHELL takes the grid now. It still lays out the `aside` cards
     * the invoice and consent screens pass it; the portal index builds its own
     * two columns and needs no page-level grid at all.
     */
    const shell = codeOf(join(process.cwd(), 'components/public/PortalShell.tsx'));
    expect(shell).toContain('PORTAL_GRID');
    expect(shell).not.toMatch(/grid-cols-1\s+(?:sm|md|lg):grid-cols-/);
  });
});
