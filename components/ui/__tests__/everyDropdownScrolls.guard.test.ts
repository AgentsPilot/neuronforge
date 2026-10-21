/**
 * A list longer than the space it has can be scrolled, in every dropdown.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This repo's copy of the shadcn select lost two things upstream ships, and
 * either alone is enough to strand the options past the fold:
 *
 *   max-height        upstream `max-h-96`; this copy had none, and
 *                     `overflow-hidden` with no bound does not scroll — it
 *                     CLIPS at whatever the popover happens to be
 *   scroll buttons    Radix moves its listbox through `ScrollUpButton` and
 *                     `ScrollDownButton`; neither was in the tree
 *
 * It was reported first as "add scroll to the services list", and fixed then
 * by capping that ONE dropdown at its call site — with a test saying the
 * shared wrapper was deliberately left alone, and that if the same clipping
 * turned up elsewhere the fix should be raised there on purpose.
 *
 * It turned up elsewhere: the owner's cancellation dialog lists thirteen
 * reasons and ran off the bottom with no way to reach the last of them. So the
 * bound moved into the wrapper, where it covers all twenty callers, and the
 * local cap came out rather than leaving two opinions about one height.
 *
 * Pinned as source assertions because jsdom performs no layout: it cannot tell
 * a scrollable popover from a clipped one, so the only thing a test can
 * honestly check is that the bound is present and is the right KIND of bound.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const select = read('components/ui/select.tsx');
const modal = read('components/scheduling/SchedulingBookingModal.tsx');

/** The wrapper's own source, comments stripped — a note is not a rule. */
const code = select.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('this guard reads the code, not its own explanation', () => {
  it('strips the comments', () => {
    expect(select).toContain('BOUNDED, SO IT SCROLLS');
    expect(code).not.toContain('BOUNDED, SO IT SCROLLS');
  });
});

describe('the shared select wrapper', () => {
  it('bounds its content, so the list scrolls instead of being cut', () => {
    const content = code.slice(
      code.indexOf('SelectPrimitive.Content'),
      code.indexOf('SelectPrimitive.Viewport')
    );

    expect(content).toMatch(/max-h-/);
    expect(content).toMatch(/overflow-hidden/);
  });

  it('and bounds it in a unit a phone agrees with', () => {
    /*
     * `dvh`, not `vh`: on a phone `vh` is the viewport with the browser chrome
     * hidden, so a 60vh popover can extend past what is actually on screen.
     * The rem cap stops it becoming a full-height column on a desktop.
     */
    expect(code).toMatch(/max-h-\[min\(60dvh,26rem\)\]/);
    expect(code).not.toMatch(/max-h-\[[0-9]+vh\]/);
  });

  it('renders both of the buttons Radix scrolls with', () => {
    /* A bound with nothing to scroll by is a shorter clip. */
    expect(code).toContain('SelectPrimitive.ScrollUpButton');
    expect(code).toContain('SelectPrimitive.ScrollDownButton');
    expect(code).toContain('<SelectScrollUpButton />');
    expect(code).toContain('<SelectScrollDownButton />');
  });

  it('and does not pin the viewport to the height of the trigger', () => {
    /*
     * `--radix-select-trigger-height` is ONE ROW. On the popper path it
     * collapses the whole list to the height of the closed field. The WIDTH
     * still follows the trigger, which is what lines the menu up under it.
     */
    const viewport = code.slice(code.indexOf('SelectPrimitive.Viewport'));

    expect(viewport).not.toContain('h-[var(--radix-select-trigger-height)]');
    expect(viewport).toContain('min-w-[var(--radix-select-trigger-width)]');
  });
});

describe('and no caller caps it again on its own', () => {
  it('the booking dialog inherits the bound rather than repeating it', () => {
    /*
     * Two opinions about one height is how they drift. The services dropdown
     * carried this value at its call site while the wrapper had none; now the
     * wrapper has it and the call site does not.
     */
    const dropdown = modal.slice(modal.indexOf('<SelectContent'), modal.indexOf('</SelectContent>'));

    expect(dropdown).not.toMatch(/max-h-/);
  });
});
