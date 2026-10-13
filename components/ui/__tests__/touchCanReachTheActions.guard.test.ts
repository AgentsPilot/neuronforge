/**
 * An action that only appears on hover does not exist on a phone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REPORT: "there is no way to download or open the document".
 *
 * The documents list showed a row per file — name, type, size, date — with
 * download, open and delete held at `opacity-0` until `group-hover`. A touch
 * screen never produces a hover, so on a phone those three were painted
 * invisible with no way to bring them up. The file was listed and unreachable,
 * which does not read as a hidden control: there is nothing on screen to
 * suggest anything is there, so it reads as a feature that does not work.
 *
 * WHY `hover: hover` AND NOT A BREAKPOINT
 *
 * The question is whether the device can hover, not how wide it is. A touch
 * laptop and a tablet in landscape are both wide and both have no pointer, so a
 * `sm:` breakpoint leaves them exactly as broken while looking like a fix. The
 * media query asks the only question that matters, and the default — visible —
 * is the safe way round for anything it does not match.
 *
 * WHY A SOURCE GUARD
 *
 * jsdom has no pointer, no hover and does not evaluate media queries, and
 * `opacity` is not something a render test reads anyway. The rule lives in the
 * class list, so the class list is what is checked.
 *
 * NOT A SWEEP. Only the places where what is hidden is an ACTION. Most uses of
 * this pattern in the codebase are decorative — an accent bar on a website
 * card, a gradient that comes up under the cursor — and hiding those from touch
 * costs nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

/**
 * Hiding an action behind hover, with no capability query in front of it.
 *
 * `[@media(hover:hover)]:opacity-0` is the corrected form and must not match;
 * a bare `opacity-0 group-hover:opacity-100` must.
 */
const BARE_HOVER_ONLY = /(?<!\)\]:)opacity-0[^"'`]*group-hover:opacity-100/;

describe('the documents list', () => {
  const files = read('components/crm/contact-drawer/FilesTab.tsx');

  it('does not hide its actions from a finger', () => {
    expect(files).not.toMatch(BARE_HOVER_ONLY);
  });

  it('still hides them on a device that can hover', () => {
    // The desktop behaviour is deliberate and worth keeping: three icons on
    // every row is noise when a pointer can summon them.
    expect(files).toContain('[@media(hover:hover)]:opacity-0');
    expect(files).toContain('[@media(hover:hover)]:group-hover:opacity-100');
  });

  it('and reveals them for a keyboard too', () => {
    // Tabbing to a control that is invisible is its own trap.
    expect(files).toContain('[@media(hover:hover)]:group-focus-within:opacity-100');
  });

  it('still offers all three', () => {
    // The fix is about reachability; it must not have dropped a control.
    expect(files).toContain("t('crm.files.download')");
    expect(files).toContain("t('crm.files.open')");
    expect(files).toContain("t('crm.files.delete')");
  });
});

/**
 * Two more of the same shape, found while checking the one that was reported.
 *
 * Both sit INLINE and reserve their space whatever their opacity, so revealing
 * them moves nothing on the page.
 */
describe('the other owner actions that were hover-only', () => {
  it.each([
    ['components/business-os/insight/ChannelsCard.tsx', 'managing a channel'],
    ['components/business-os/insight/OperationalStatusCard.tsx', 'skipping a setup step'],
  ])('%s — %s', file => {
    expect(read(file)).not.toMatch(BARE_HOVER_ONLY);
  });
});

/**
 * DELIBERATELY NOT INCLUDED: the calendar's row actions.
 *
 * `SchedulingCalendarView` floats its quick actions OVER the row, absolutely
 * positioned with a gradient backdrop, precisely so they cost the row no width
 * — that is written down above them. Revealing those on touch would park a
 * permanent gradient and a row of buttons on top of every booking's own text,
 * so it is not the same one-line change and is not pretended to be here. It
 * needs a different affordance on touch, which is a design decision rather than
 * a class list.
 */
describe('the calendar, which is a different problem', () => {
  it('still floats its actions over the row', () => {
    const calendar = read('components/scheduling/SchedulingCalendarView.tsx');

    // If this ever stops being an overlay, the exclusion above stops applying
    // and the row should be brought in line with the others.
    expect(calendar).toMatch(/absolute inset-y-0 end-0[^"]*opacity-0[^"]*group-hover:opacity-100/);
  });
});
