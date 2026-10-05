/**
 * The switch thumb must travel the right way in Hebrew.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS PINS
 *
 * The thumb was moved with `data-[state=checked]:translate-x-[20px]` alone.
 * `translate-x` is a PHYSICAL transform — positive is rightwards whatever the
 * writing direction — and the track is an `inline-flex`, so under `dir="rtl"`
 * its main-start edge is the RIGHT one and the unchecked thumb sits flush
 * right. Checking it then pushed the thumb a further 20px right: 20px past the
 * end of a 44px track. Switching anything on in Hebrew threw the thumb clean
 * out of the pill.
 *
 * Twelve components share this primitive, so every switch in the product was
 * broken in Hebrew, and nothing failed — a transform cannot throw.
 *
 * WHY A SOURCE GUARD RATHER THAN A RENDER TEST
 *
 * The defect is which CSS class is emitted, and jsdom computes no transforms
 * from Tailwind classes — there is no stylesheet in the test environment, so a
 * rendered assertion could only re-read the same className this reads, with more
 * machinery in the way. What matters is the INVARIANT: the two distances must be
 * exact negatives of each other, so nobody can retune one and leave the other.
 *
 * Comments are stripped before matching. A guard that reads the prose around the
 * code can pass on an explanation of the fix instead of the fix.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

/** The primitive's source with every comment removed. */
function switchSource(): string {
  const raw = readFileSync(join(__dirname, '..', 'switch.tsx'), 'utf8');
  return raw
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '') // JSX comment blocks
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/.*$/gm, ''); // line comments
}

/** The `className` string on the Thumb, which is the thing under test. */
function thumbClassName(): string {
  const source = switchSource();
  const thumb = source.slice(source.indexOf('SwitchPrimitives.Thumb'));
  const match = thumb.match(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{cn\(([\s\S]*?)\)\})/);
  expect(match).toBeTruthy();
  return (match![1] ?? match![2] ?? match![3] ?? '').replace(/\s+/g, ' ');
}

describe('the switch thumb travels correctly in both directions', () => {
  it('moves the thumb for the checked state at all', () => {
    expect(thumbClassName()).toMatch(/data-\[state=checked\]:translate-x-\[-?\d+px\]/);
  });

  /*
   * `:dir(rtl)` AND NOT Tailwind's `rtl:` VARIANT, which is the whole point.
   *
   * `rtl:` compiles to `&:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *)`. That
   * last clause matches any DESCENDANT of an RTL element and ignores a nearer
   * `dir` — and seven call sites wrap this switch in `dir="ltr"`. Under `rtl:`
   * those were laid out LTR (thumb flush left) while receiving the RTL rule, so
   * the thumb travelled off the LEFT edge: the same defect mirrored, on exactly
   * the screens that had tried to work around it.
   *
   * `:dir(rtl)` resolves against the element's OWN direction, so it follows the
   * nearest `dir` and both arrangements come out right.
   */
  it('scopes the override to the element\'s own direction, not an ancestor\'s', () => {
    const className = thumbClassName();

    expect(className).toMatch(/\[&\[data-state=checked\]:dir\(rtl\)\]:translate-x-\[-?\d+px\]/);
    // The ancestor-matching variant must not come back.
    expect(className).not.toMatch(/(^|\s)rtl:/);
  });

  it('travels the same distance each way, in opposite directions', () => {
    const className = thumbClassName();

    const ltr = className.match(/(?<!:)\bdata-\[state=checked\]:translate-x-\[(-?\d+)px\]/);
    const rtl = className.match(/:dir\(rtl\)\]:translate-x-\[(-?\d+)px\]/);

    expect(ltr).toBeTruthy();
    expect(rtl).toBeTruthy();

    const ltrPx = Number(ltr![1]);
    const rtlPx = Number(rtl![1]);

    // Exact negatives. This is what breaks if somebody retunes the track width
    // and updates only one of the two.
    expect(rtlPx).toBe(-ltrPx);
    expect(ltrPx).not.toBe(0);
  });

  /*
   * The thumb must still fit. Track 44px with 2px borders leaves 40px of content;
   * a 20px thumb therefore travels exactly 20px. A distance larger than
   * `track - 2*border - thumb` puts the thumb outside the pill again — the very
   * symptom this file exists for, reachable in LTR too by a bad number.
   */
  it('does not travel further than the track allows', () => {
    const source = switchSource();

    const track = source.match(/w-\[(\d+)px\]/);
    const border = source.match(/border-(\d+)/);
    const thumb = source.match(/SwitchPrimitives\.Thumb[\s\S]*?w-\[(\d+)px\]/);
    expect(track && border && thumb).toBeTruthy();

    const travel = Math.abs(
      Number(thumbClassName().match(/(?<!:)\bdata-\[state=checked\]:translate-x-\[(-?\d+)px\]/)![1])
    );
    const room = Number(track![1]) - 2 * Number(border![1]) - Number(thumb![1]);

    expect(travel).toBeLessThanOrEqual(room);
  });
});
