/**
 * A form field on a phone is 16px, and the keyboard resizes the page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EDITING WAS IMPOSSIBLE ON A PHONE, WHILE EVERYTHING LOOKED FINE
 *
 * Two browser behaviours, each harmless alone, compounding inside a dialog that
 * is `position: fixed` at `100dvh`:
 *
 *   1. iOS Safari ZOOMS the page when focus lands on a control whose font is
 *      under 16px. Every field in the services editor was under it — `text-sm`
 *      (14px) for the name, description and durations, 15px for the price, 13px
 *      for the selects. On an ordinary page the reader pinches back out; inside
 *      a fixed full-height dialog the zoomed layer cannot be panned back to the
 *      field, and Save goes off-screen with it.
 *
 *   2. The on-screen keyboard OVERLAYS the page by default. The visual viewport
 *      shrinks, the layout viewport does not, and `100dvh` keeps reporting the
 *      whole screen — so the dialog stays full height behind the keyboard, the
 *      focused field can sit under it, and the panel's scroll container has no
 *      idea anything moved.
 *
 * The owner's report was "I can't update services on mobile". Both halves are
 * invisible to jsdom, which has no viewport, no keyboard and no zoom, so no
 * render test of any component can see either one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS
 *
 * The two rules, where they live. Not a sweep over components: the point of
 * fixing it in `globals.css` and the viewport export is that no component has
 * to remember, and a guard that demanded `text-base sm:text-sm` on every input
 * in the codebase would be enforcing the fix that was deliberately not chosen.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const css = read('app/globals.css');
const layout = read('app/layout.tsx');

/**
 * Code only.
 *
 * The note beside the viewport export explains why `maximumScale` and
 * `userScalable` are deliberately absent — by naming them. A guard that read
 * the comments would fail on the very file it is protecting, which is how this
 * test failed the first time it ran.
 */
const layoutCode = layout.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('form controls do not trigger zoom on a phone', () => {
  it('raises every text-bearing control to 16px below the sm breakpoint', () => {
    const block = css.slice(css.indexOf('@media (max-width: 639.98px)'));
    expect(block).toBeTruthy();

    const rule = block.slice(0, block.indexOf('}', block.indexOf('font-size: 16px')));
    expect(rule).toContain('input');
    expect(rule).toContain('select');
    expect(rule).toContain('textarea');
    expect(rule).toContain('font-size: 16px');
  });

  it('leaves the controls that render no text alone', () => {
    // Sizing a checkbox by its font would change the control, not its label.
    const block = css.slice(css.indexOf('@media (max-width: 639.98px)'));
    expect(block).toContain(":not([type='checkbox'])");
    expect(block).toContain(":not([type='radio'])");
  });

  it('does not reach above the sm breakpoint', () => {
    // Desktop density is deliberate and must not move.
    expect(css).toContain('@media (max-width: 639.98px)');
    expect(css).not.toContain('@media (min-width: 639.98px)');
  });
});

describe('the keyboard resizes the page rather than covering it', () => {
  it('strips comments before matching, or it fails on its own explanation', () => {
    expect(layout).toContain('maximumScale');
    expect(layoutCode).not.toContain('maximumScale');
  });

  it('states the viewport instead of accepting the default', () => {
    expect(layout).toMatch(/export const viewport = \{/);
    expect(layout).toContain("width: 'device-width'");
    expect(layout).toContain('initialScale: 1');
  });

  it('asks the keyboard to resize the content', () => {
    // Without this, `100dvh` keeps reporting the full screen while the keyboard
    // covers half of it, and a fixed dialog cannot scroll the focused field
    // back into view.
    expect(layout).toContain("interactiveWidget: 'resizes-content'");
  });

  it('never disables zoom, which would be the wrong fix and an accessibility fault', () => {
    /*
     * Capping the scale also suppresses the focus zoom, which is why it is a
     * tempting one-liner. It takes zoom away from every reader who needs it,
     * and leaves the 14px fields that caused the problem in place.
     */
    expect(layoutCode).not.toMatch(/maximumScale/);
    expect(layoutCode).not.toMatch(/userScalable/);
  });
});
