/**
 * An option in an open dropdown has to name its own colour.
 *
 * Reported on the Business Profile settings in DARK MODE: the industry menu
 * opened as near-black text on the dark panel, effectively unreadable, while
 * the labels and the closed trigger beside it were fine.
 *
 * The cause is a colour that was never set rather than one set wrongly. The
 * trigger carries `FIELD_BASE`, which includes `text-[var(--v2-text-primary)]`.
 * The option buttons inside the menu were written separately and carried no
 * text colour at all, so they fell back to the browser's own default for a
 * `<button>` — a dark system colour that happens to be legible on the light
 * theme and invisible on the dark one. Nothing in the file looked wrong,
 * because the defect is an absence.
 *
 * This guard pins the absence closed: every menu item in that section states
 * its colour. It reads the source rather than rendering, because what matters
 * is the class that reaches the DOM, and a render test would assert on jsdom's
 * computed styles, which do not model the UA stylesheet's button colour at all.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SECTION = join(
  process.cwd(),
  'components',
  'business-os',
  'settings',
  'BusinessProfileSection.tsx'
);

const source = readFileSync(SECTION, 'utf8').replace(/\r\n/g, '\n');

/**
 * Every button that is an item inside an open dropdown menu.
 *
 * Matched on the shape those items share — full width, the menu's own hover —
 * rather than on a list of field names, so a fifth dropdown added later is
 * covered without this file being edited.
 */
const MENU_ITEM = /className=\{`w-full px-3 py-2\.5 text-sm([^`]*)hover:bg-\[var\(--v2-bg\)\]/g;

describe('the Business Profile dropdowns', () => {
  const items = [...source.matchAll(MENU_ITEM)];

  it('still has the four menus this was written for', () => {
    expect(items.length).toBeGreaterThanOrEqual(4);
  });

  it('every option states its text colour, so dark mode cannot inherit the UA default', () => {
    const naked = items.filter(match => !match[1].includes('text-[var(--v2-text-primary)]'));
    expect(naked).toHaveLength(0);
  });

  it('uses the same token as the trigger beside it, so the two cannot drift', () => {
    expect(source).toContain('text-[var(--v2-text-primary)]');
    /* FIELD_BASE is what the closed trigger wears. */
    expect(source).toMatch(/const FIELD_BASE\s*=\s*\n?\s*'[^']*text-\[var\(--v2-text-primary\)\]/);
  });

  it('paints the menu surface and border from tokens too, not from a fixed colour', () => {
    const menus = source.match(/absolute z-50 w-full mt-1 bg-\[var\(--v2-surface\)\] border border-\[var\(--v2-border\)\]/g);
    expect(menus?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});
