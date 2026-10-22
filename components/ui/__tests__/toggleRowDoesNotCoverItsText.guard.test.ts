/**
 * A switch beside a sentence must not be ON TOP of the sentence.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHAPE OF THE BUG, which is the same every time it appears
 *
 * The row is `flex … justify-between`: a label-and-description group on one
 * side, a switch on the other. `justify-between` POSITIONS those two, it does
 * not keep them apart — it distributes whatever free space is left, and when
 * the row is narrower than its contents there is none, so the two simply meet.
 *
 * Which of them gives way is decided by one rule: a flex item will not shrink
 * below its min-content width unless `min-w-0` allows it. The switch already
 * declares `flexShrink: 0` and holds its 44px. The text group declared nothing,
 * so it also refused to shrink — and an item that refuses to shrink in a row
 * with no space left simply overflows. On a phone, in Hebrew, that put the
 * closing words of the description underneath the switch.
 *
 * WHY A SOURCE GUARD
 *
 * Overlap is a LAYOUT fact: it needs a viewport width, a font, and real text
 * metrics to occur. jsdom has none of those — every element it lays out is
 * zero by zero — so a render test can assert both the text and the switch are
 * in the document, which they always were, and can never see that one is drawn
 * over the other. The rule that prevents it lives in the class list, so the
 * class list is what is checked.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const bookingModal = readFileSync(
  join(__dirname, '..', '..', 'scheduling', 'SchedulingBookingModal.tsx'),
  'utf8'
);

/** The intake row: from its container to the switch that closes it. */
const intakeRow = bookingModal.slice(
  bookingModal.indexOf("{/* Intake Form Toggle"),
  bookingModal.indexOf('aria-checked={sendIntakeForm}')
);

describe('the "send the client a form" row', () => {
  it('is still a switch opposite its description', () => {
    // If this row is ever restructured the assertions below stop meaning
    // anything, so they are anchored to the shape they are about.
    expect(intakeRow).toContain('justify-between');
    expect(intakeRow).toContain('ClipboardList');
  });

  it('lets the text give way, since the switch will not', () => {
    /*
     * Both levels: the group that holds icon-and-text, and the block that holds
     * the two lines. `min-w-0` on only the outer one leaves the inner block
     * refusing to shrink, and the overflow comes straight back.
     */
    expect(intakeRow).toContain('flex items-center gap-3 min-w-0');
    expect(intakeRow).toMatch(/<div className="min-w-0">/);
  });

  it('keeps the icon square while that happens', () => {
    // Once shrinking is permitted the 40px icon is the next thing to be
    // squeezed, and a squeezed square is an oval.
    expect(intakeRow).toMatch(/w-10 h-10 shrink-0/);
  });

  it('and holds a gap, which justify-between stops providing', () => {
    /*
     * `justify-between` only spaces things while there IS space. Once the text
     * can shrink, the row consumes all of it and the sentence ends flush
     * against the switch unless a real gap is declared.
     */
    expect(intakeRow).toMatch(/justify-between gap-\d/);
  });

  it('and the switch itself still refuses to shrink', () => {
    // The other half of the contract. If the switch ever becomes shrinkable,
    // the control distorts instead of the text wrapping, which is worse.
    const sw = bookingModal.slice(bookingModal.indexOf('aria-checked={sendIntakeForm}'));
    expect(sw.slice(0, 600)).toContain('flexShrink: 0');
  });
});

/**
 * The same dialog's date fields, which failed the same way for the same reason.
 *
 * A `datetime-local` control has a wide intrinsic width — it reserves room for
 * the date, the time, the separators and the picker — so its grid cell has to
 * be allowed to shrink or the field bursts out of its column and runs to the
 * screen edges while every other control stays inset. The row already stacked
 * below `sm`, which is exactly why this looked correct in a narrow desktop
 * window and wrong on a handset.
 */
/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE START AND END TIME FIELDS WERE TESTED HERE, AND NO LONGER EXIST.
 *
 * Two `datetime-local` inputs sat under the slot grid behind "שעה אחרת…", and
 * these two tests guarded their layout on a handset. They were removed on
 * request: the grid offers every hour the working day allows and the gap
 * between appointments permits, so the three warnings those fields needed —
 * this day is closed, that hour is taken, your own clock reads differently —
 * became unreachable rather than unsaid.
 *
 * What went with them is the deliberate off-hours booking. If it comes back it
 * belongs in the GRID as something offered, not as a second way to answer a
 * question the grid has already asked — at which point this guard comes back
 * with it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * And the reason `color-scheme: inherit` on those fields now does something.
 *
 * Several date inputs ask to inherit it. Nothing declared it, so they inherited
 * `normal` and drew their internals light-themed inside a dark dialog. It is
 * declared at the root, keyed to `.dark` rather than to the operating system —
 * the same rule the `dark:` variant follows, so that a public page on a light
 * template keeps light controls for every visitor.
 */
describe('the root tells the browser which palette to draw', () => {
  const css = readFileSync(join(__dirname, '..', '..', '..', 'app', 'globals.css'), 'utf8');

  it('declares it, both ways', () => {
    expect(css).toMatch(/:root\s*\{[\s\S]*?color-scheme:\s*light/);
    expect(css).toMatch(/\.dark\s*\{\s*color-scheme:\s*dark/);
  });

  it('keyed to the class, never to the operating system', () => {
    // A public page must not flip because the visitor's phone is dark.
    expect(css).not.toMatch(/prefers-color-scheme[\s\S]{0,120}color-scheme:\s*dark/);
  });
});
