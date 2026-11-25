/**
 * The hover card opens where the owner can read it, in both directions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER SAW
 *
 * Hovering an appointment near the end of the day showed a card cut off part
 * way down — the client and the hour survived, the price and the contact
 * details did not. Reported on a 16:00 appointment in a diary drawn 08:00 to
 * 17:00, and again after a first fix as "some of them still cutting".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO FIXES WERE WRITTEN BEFORE THIS ONE, AND BOTH WERE WRONG THE SAME WAY
 *
 * The card opened at `top: 0, insetInlineStart: 100%` — its own block's top and
 * trailing edge — and a rule flipped the last two columns back towards the
 * middle. That covered half of one axis.
 *
 *   attempt 1   clamped the card inside `visibleHours * ROW_HEIGHT`, the height
 *               the diary IS. The scroller is capped at `75dvh`, so on a short
 *               window a card sitting legally inside the content still fell
 *               past the fold
 *
 *   attempt 2   measured the box and clamped both axes into it — and was
 *               VISIBLY WORSE, because it mixed coordinate systems: block tops
 *               count from the hours area, `scrollTop` counts from above a
 *               STICKY HEADER, columns are percentages of the grid, and a block
 *               sharing its hour is inset within its column. Any two of those
 *               compared directly are wrong by the offset between them.
 *
 * This component nests four coordinate systems. Arithmetic across them is the
 * failure mode, not an implementation detail — which is why this suite pins the
 * METHOD and not just the result.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE METHOD: ONE SPACE, READ FROM THE ELEMENT
 *
 * `getBoundingClientRect` is already in viewport space whatever is nested above
 * it, and a portal to `document.body` puts the card somewhere nothing clips it.
 * The only box left to stay inside is the window, and the anchor is measured in
 * the same space. There is no origin left to get wrong.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');

const CALENDAR = 'components/scheduling/SchedulingCalendarView.tsx';

/** Source with comments removed, so these notes cannot satisfy a match. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const calendar = code(read(CALENDAR));

describe('the card is placed in viewport space', () => {
  it('the anchor is the appointment’s own rectangle', () => {
    expect(calendar).toContain('setHoverAnchor(element.getBoundingClientRect());');
  });

  it('read when the card opens, not when the pointer arrives', () => {
    /* There is a 200ms delay before the card appears. The owner can scroll in
       it, and a rectangle captured on entry would place the card where the
       appointment no longer is. */
    const handler = calendar.slice(
      calendar.indexOf('const handleBookingMouseEnter'),
      calendar.indexOf('const handleBookingMouseLeave')
    );

    expect(handler).toContain('tooltipTimeoutRef.current = setTimeout(() => {');
    expect(handler.indexOf('setTimeout')).toBeLessThan(handler.indexOf('getBoundingClientRect'));
  });

  it('and the element is handed over by the event', () => {
    expect(calendar).toContain(
      'onMouseEnter={event => handleBookingMouseEnter(booking.id, event.currentTarget)}'
    );
  });

  it('the card is portalled out of everything that clips', () => {
    /*
     * The hour rows, the grid shell and the scroller all carry `overflow`, and
     * the dialog above them is transformed. Nothing positioned inside that
     * stack can be relied on to escape it.
     */
    expect(calendar).toContain('createPortal(');
    expect(calendar).toContain('document.body');
    expect(calendar).toContain("import { createPortal } from 'react-dom';");
  });

  it('and is fixed, so the page does not move it', () => {
    expect(calendar).toMatch(/className="fixed z-\[100\] w-\[240px\]/);
  });

  it('guarded for the server, where there is no document', () => {
    expect(calendar).toContain("typeof document !== 'undefined'");
  });
});

describe('what it is clamped to', () => {
  it('the window, in both directions', () => {
    expect(calendar).toContain('Math.min(preferred, window.innerWidth - width - edge)');
    expect(calendar).toContain('Math.min(hoverAnchor.top, window.innerHeight - height - edge)');
  });

  it('preferring after the appointment, then before it, then wherever fits', () => {
    /*
     * Three cases and the order matters: a card that merely "fits somewhere"
     * can land on top of the appointment it describes. After, before, and only
     * then nudged.
     */
    expect(calendar).toContain('const after = hoverAnchor.right + gap;');
    expect(calendar).toContain('const before = hoverAnchor.left - gap - width;');
    expect(calendar).toMatch(/after \+ width <= window\.innerWidth - edge\s*\?\s*after/);
  });

  it('using physical left and top, NOT logical properties', () => {
    /*
     * The one thing that looks like a regression and is not. Inside the grid
     * the card used `insetInlineStart` so it mirrored in Hebrew. A FIXED box is
     * placed in viewport pixels, and the browser has already mirrored the
     * rectangle it is measured against — so a logical property here would
     * mirror it a second time and throw the card across the screen.
     */
    const card = calendar.slice(
      calendar.indexOf('createPortal('),
      calendar.indexOf('document.body')
    );

    expect(card).toContain('left: `${left}px`');
    expect(card).not.toContain('insetInlineStart');
    expect(card).not.toContain('insetInlineEnd');
  });

  it('and capped so a card taller than the window still shows its top', () => {
    /* It is pointer-transparent, so it cannot be scrolled. The last line is the
       right one to lose; the client's name is at the top. */
    expect(calendar).toContain('maxHeight: `${Math.max(0, window.innerHeight - 2 * edge)}px`');
  });
});

describe('the height is measured, not assumed', () => {
  it('from the card itself, after it renders', () => {
    /*
     * What the card says varies — a crowded slot carries a "2 of 3" line, a
     * priced service its amount, a contact with a phone another row. A constant
     * is wrong for most of them, and wrong in the direction that clips.
     */
    expect(calendar).toContain('const measured = card.offsetHeight;');
    expect(calendar).toContain('useLayoutEffect(');
  });

  it('without a render loop', () => {
    expect(calendar).toContain('setHoverCardHeight(previous => (previous === measured ? previous : measured));');
  });

  it('and it opens on a sane first guess', () => {
    expect(calendar).toContain('useState(290)');
  });
});

describe('the rule that was retired', () => {
  it('no column index decides which side the card opens on', () => {
    /*
     * `dayIndex >= weekDates.length - 2` was right about the problem and wrong
     * about the fix: the threshold holds at about a thousand pixels and this
     * grid may shrink to `min-w-[500px]`, and it answered only the sideways
     * half. Named here so it cannot return as a simplification.
     */
    expect(calendar).not.toContain('const flipTooltip =');
    expect(calendar).not.toMatch(/dayIndex >= weekDates\.length - 2/);
  });

  it('and the card no longer hangs off its own block', () => {
    expect(calendar).not.toMatch(/borderRadius: '16px',\s*top: '0',/);
  });
});

describe('the placement arithmetic', () => {
  /*
   * Four tokens whose failure is invisible in a render test, reproduced against
   * the real constants and checked at the sizes that were reported.
   */
  const WIDTH = 240;
  const GAP = 12;
  const EDGE = 8;

  const place = (
    rect: { left: number; right: number; top: number },
    viewportWidth: number,
    viewportHeight: number,
    cardHeight: number
  ) => {
    const after = rect.right + GAP;
    const before = rect.left - GAP - WIDTH;
    const preferred =
      after + WIDTH <= viewportWidth - EDGE ? after : before >= EDGE ? before : after;

    const left = Math.max(EDGE, Math.min(preferred, viewportWidth - WIDTH - EDGE));
    const top = Math.max(EDGE, Math.min(rect.top, viewportHeight - cardHeight - EDGE));

    return { left, top };
  };

  const offScreen = (
    rect: { left: number; right: number; top: number },
    viewportWidth: number,
    viewportHeight: number,
    cardHeight: number
  ) => {
    const { left, top } = place(rect, viewportWidth, viewportHeight, cardHeight);

    return (
      Math.max(0, left + WIDTH - viewportWidth) +
      Math.max(0, -left) +
      Math.max(0, top + cardHeight - viewportHeight) +
      Math.max(0, -top)
    );
  };

  it('loses nothing on the reported appointment', () => {
    /* Last column, bottom row, ordinary laptop. */
    expect(offScreen({ left: 980, right: 1110, top: 640 }, 1280, 760, 290)).toBe(0);
  });

  it('nor on a middle column near the bottom', () => {
    expect(offScreen({ left: 500, right: 630, top: 700 }, 1280, 760, 290)).toBe(0);
  });

  it('nor in a window too narrow for either side', () => {
    /* 520px wide, a 62px column: there is no room after OR before, and the
       card is nudged inside rather than left hanging. */
    expect(offScreen({ left: 300, right: 362, top: 400 }, 520, 700, 290)).toBe(0);
  });

  it('and opens AFTER the appointment whenever there is room', () => {
    /* The preference, not just the absence of clipping: a card that merely
       fits can sit on top of the thing it describes. */
    expect(place({ left: 100, right: 230, top: 120 }, 1280, 760, 290).left).toBe(230 + GAP);
  });

  it('switching to before it when there is not', () => {
    expect(place({ left: 980, right: 1110, top: 120 }, 1280, 760, 290).left).toBe(980 - GAP - WIDTH);
  });
});
