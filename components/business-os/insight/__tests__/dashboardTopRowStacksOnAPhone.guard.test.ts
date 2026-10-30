/**
 * The dashboard's top row collapses to one column on a phone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT LOOKED LIKE
 *
 * Side by side on a phone, with the credits dial taking three quarters and the
 * task list — the card the row exists for — squeezed into the last quarter, a
 * word per line:
 *
 *     ┌────────┐ ┌───────────────────────────┐
 *     │ מחכה   │ │                           │
 *     │ לך  8  │ │          ◯ 99%            │
 *     │ שלמה   │ │                           │
 *     │ המלך   │ │                           │
 *     │ ביטלו  │ └───────────────────────────┘
 *     └────────┘
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A SPECIFICITY TRAP, WHICH IS WHY IT WAS MOBILE-ONLY
 *
 * A media query adds no specificity. The phone rule was `.usage-readiness-row`
 * (0,1,0) and the desktop rule for the needs-you hero is
 * `.usage-readiness-row.ur-hero-tasks` (0,2,0), so the phone rule lost and the
 * row kept `3fr 1fr` — the widest split the desktop ever asks for.
 *
 * The `order` reset in the same block had no competition, so it DID apply, and
 * that is what inverted the cards: back at order 0 they fall into DOM order, so
 * the usage dial took the 3fr track and the task list the 1fr one.
 *
 * It only surfaced when readiness stopped being the hero. Until then
 * `ur-hero-tasks` was rarely on the row, nothing outranked the phone rule, and
 * the collapse worked.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HALF THAT MUST NOT CHANGE
 *
 * The desktop split is deliberate and is asserted here unchanged. The fix is
 * one selector added inside the existing media query; above 900px nothing about
 * this row is different.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(
  join(process.cwd(), 'components/business-os/insight/LiveDashboard.tsx'),
  'utf8'
);

/** The scoped CSS with its comments removed: these rules are about the code. */
const css = source.replace(/\/\*[\s\S]*?\*\//g, '');

/** The phone block, from its `@media` to the brace that closes it. */
function phoneBlock(): string {
  const at = css.indexOf('@media (max-width: 900px)');
  expect(at).toBeGreaterThan(-1);

  // Far enough to hold the block, short enough not to reach the next one.
  const window = css.slice(at, css.indexOf('@media', at + 10));
  expect(window).toContain('usage-readiness-row');

  return window;
}

describe('on a phone', () => {
  it('collapses the row whichever card is the hero', () => {
    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE ONE THAT MATTERS.
     *
     * Both selectors, because the two-class one is what the single-class rule
     * could not beat.
     * ───────────────────────────────────────────────────────────────────────
     */
    const block = phoneBlock();

    expect(block).toMatch(/\.usage-readiness-row,\s*\n\s*\.usage-readiness-row\.ur-hero-tasks\s*\{/);
    expect(block).toMatch(/grid-template-columns:\s*1fr;/);
  });

  it('still puts the glance above the task list', () => {
    // The order reset is what makes DOM order decide once stacked. It was
    // already correct; it is pinned because the fix above depends on it.
    expect(phoneBlock()).toMatch(/\.ur-usage,\s*\n\s*\.ur-hero\s*\{\s*\n\s*order:\s*0;/);
  });
});

describe('above 900px, nothing changed', () => {
  it('keeps the needs-you hero at three quarters', () => {
    const desktop = css.slice(0, css.indexOf('@media (max-width: 900px)'));

    expect(desktop).toMatch(/\.usage-readiness-row\.ur-hero-tasks\s*\{\s*\n\s*grid-template-columns:\s*3fr 1fr;/);
  });

  it('keeps readiness at two thirds', () => {
    const desktop = css.slice(0, css.indexOf('@media (max-width: 900px)'));

    expect(desktop).toMatch(/grid-template-columns:\s*2fr 1fr;/);
  });

  it('keeps the hero in the first track', () => {
    /*
     * `.ur-hero { order: 1 }` is what puts the hero at the start of the line in
     * both directions. Losing it is the desktop half of the same bug: the cards
     * would swap tracks and the task list would take the narrow one.
     */
    const desktop = css.slice(0, css.indexOf('@media (max-width: 900px)'));

    expect(desktop).toMatch(/\.ur-hero\s*\{\s*\n\s*order:\s*1;/);
    expect(desktop).toMatch(/\.ur-usage\s*\{\s*\n\s*order:\s*2;/);
  });
});

describe('the sibling row below it', () => {
  it('has no two-class rule that could repeat the trap', () => {
    /*
     * `.lv-day-week-row` collapses in the same media query and is safe only
     * because nothing overrides it with a second class. If one is ever added,
     * it needs the same treatment, and this is where that is noticed.
     */
    const overrides = css.match(/\.lv-day-week-row\.[a-z-]+\s*\{/g) ?? [];

    expect(overrides).toEqual([]);
  });
});
