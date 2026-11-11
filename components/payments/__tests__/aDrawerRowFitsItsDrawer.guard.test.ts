/**
 * A money row inside the CRM drawer lays itself out for the DRAWER.
 *
 * Reported from two screenshots of the same panel, one English and one Hebrew,
 * which looked like a language bug and was not. `MoneyRow` picks between two
 * grid templates with `sm:`, and `sm:` is a VIEWPORT media query. The container
 * is the CRM drawer at 576px, so on any ordinary desktop the wide template won
 * inside a box that cannot hold it:
 *
 *     fixed tracks   1.25rem + 14rem + 6rem + four 12px gaps  =  388px
 *     left for text  576 − 24 (p-3) − 388                     =  164px
 *     split 1.5fr : 0.85fr                                    ≈  105px | 59px
 *
 * Hence "Sports …", "Nov 11, 2…", "INV1611-…", and a legend needing
 * "Collected $32.50" in 59px printing over the title beside it. The Hebrew shot
 * was taken in a narrow window, where the viewport query finally agreed with
 * the container, which is why only one of them looked broken.
 *
 * `dense` is the drawer telling the row what it cannot measure, the same
 * convention `hideClient` already uses for the same 576px problem. These are
 * source guards: the defect is which CSS class reaches the DOM, and jsdom
 * computes no grid tracks, so a render test would pass while the screen stayed
 * unreadable.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const ROW = readFileSync(join(ROOT, 'components', 'payments', 'MoneyRow.tsx'), 'utf8');
const DRAWER = readFileSync(
  join(ROOT, 'components', 'crm', 'contact-drawer', 'PaymentsSection.tsx'),
  'utf8'
);
const LIST = readFileSync(join(ROOT, 'components', 'payments', 'MoneyList.tsx'), 'utf8');

describe('the drawer asks for the dense layout', () => {
  it('PaymentsSection passes it, beside the other thing it tells the row about itself', () => {
    expect(DRAWER).toMatch(/hideClient[\s\S]{0,800}\n\s*dense\b/);
  });

  it('the orders list does NOT, so the wide page keeps its five columns', () => {
    expect(LIST).not.toMatch(/\bdense\b/);
  });
});

describe('dense keeps every fact', () => {
  it('does not hide the cashflow, it re-places it on a line of its own', () => {
    /* The wide layout still drops it below `sm`; dense must not reuse that. */
    expect(ROW).toContain("? 'col-start-2 col-end-[-1] row-start-2 min-w-0 overflow-hidden'");
    expect(ROW).toContain(": 'hidden min-w-0 overflow-hidden sm:block'");
  });

  it('spans that line to the end of the row, so the legend has the full width', () => {
    expect(ROW).toContain('col-end-[-1]');
  });

  it('keeps the amount and the controls on the first line', () => {
    expect(ROW).toContain("dense ? 'col-start-3 row-start-1' : ''");
    expect(ROW).toMatch(/dense \? 'col-start-4 row-start-1' : ''/);
  });
});

describe('the grid itself', () => {
  it('gives the title a flexible track and the amount an auto one when dense', () => {
    expect(ROW).toContain("'grid-cols-[1.25rem_minmax(0,1fr)_auto_auto]'");
  });

  it('leaves the viewport templates untouched for every other caller', () => {
    expect(ROW).toContain(
      "'grid-cols-[1.25rem_minmax(0,1fr)_7rem_6rem] sm:grid-cols-[1.25rem_minmax(0,1.5fr)_minmax(0,0.85fr)_14rem_6rem]'"
    );
  });

  it('clips the cashflow cell in BOTH layouts, so a nowrap figure can never paint over the title', () => {
    /*
     * Asserted on the two cell class strings themselves rather than by counting
     * matches in the block: `overflow-hidden` also appears on the bar's own
     * rounded clip and in the comment, so a count pins the prose, not the rule.
     */
    const dense = "'col-start-2 col-end-[-1] row-start-2 min-w-0 overflow-hidden'";
    const wide = "'hidden min-w-0 overflow-hidden sm:block'";
    expect(ROW).toContain(dense);
    expect(ROW).toContain(wide);
  });
});
