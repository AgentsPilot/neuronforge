/**
 * A money state has ONE colour, wherever it is shown.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * Four palettes described the same fact. The summary strip and the cashflow bar
 * coloured money from `REPORTS_COLORS`; the orders row's status chip had its own
 * Tailwind palette; the plan schedule beneath it had a third; the detail drawer
 * a fourth. On one row, an order awaiting payment drew an ORANGE bar beside a
 * BLUE chip, with the same state AMBER in the schedule under it — and clicking
 * the row opened a drawer that said blue again.
 *
 * The strip is also the filter. Clicking its orange "due" cell returned rows
 * badged blue, which defeats the one thing a coloured filter is for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * jsdom computes no colours from a palette constant, and a render test that
 * asserted "the chip has class text-blue-600" would have passed happily
 * throughout — it was the agreement BETWEEN surfaces that was broken, and each
 * surface was internally consistent. So this pins the single source and forbids
 * the shape the copies took.
 *
 * COMMENTS ARE STRIPPED BEFORE MATCHING: the note beside each fix names the
 * colours it replaced, and a guard that matched its own explanation would fail
 * on the code it protects.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

import { REPORTS_COLORS } from '@/lib/business-os/reports/constants';
import { STATUS_INK, STATUS_TONE, chipGround, statusChipStyle } from '@/lib/payments/moneyStatusTone';
import type { MoneyStatus } from '@/lib/payments/moneyItems';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const codeOf = (file: string) =>
  read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Every surface that paints a money state. */
const SURFACES = ['components/payments/MoneyRow.tsx', 'components/payments/MoneyDetailDrawer.tsx'];

/** The shape the four copies took: a Tailwind colour ramp used for a state. */
const TAILWIND_STATUS_COLOUR =
  /\b(?:text|bg)-(?:emerald|amber|orange|blue|red|slate|green|yellow)-\d{2,3}\b/;

/**
 * Colour that describes an ACTION, not a money state.
 *
 * "Stop plan" is red because of what pressing it does, which is a different
 * question from what colour a cancelled plan is — and routing a destructive
 * control through the money palette would make `LOST` mean both "this sale fell
 * through" and "this button is dangerous". Listed rather than pattern-matched
 * so the exception stays countable, in the manner of `oneAddressPolicy.guard`.
 */
const ACTION_COLOURS = [
  'className="mt-2 flex items-center gap-1.5 text-[12px] text-red-600 hover:underline"',
];

describe('the money palette has one source', () => {
  it('strips comments before matching, or it would fail on its own explanation', () => {
    // The module note names the colours it replaced; that must not count.
    expect(read('lib/payments/moneyStatusTone.ts')).toMatch(/ORANGE bar beside a BLUE chip/);
    expect(codeOf('lib/payments/moneyStatusTone.ts')).not.toMatch(/ORANGE bar beside a BLUE chip/);
  });

  it.each(SURFACES)('%s names no status colour of its own', file => {
    const offenders = codeOf(file)
      .split('\n')
      .map(line => line.trim())
      .filter(line => TAILWIND_STATUS_COLOUR.test(line))
      .filter(line => !ACTION_COLOURS.includes(line));

    expect(offenders).toEqual([]);
  });

  it.each(SURFACES)('%s reads the shared map instead', file => {
    expect(codeOf(file)).toContain("from '@/lib/payments/moneyStatusTone'");
  });

  it('every tone is a colour the reports palette already defines', () => {
    // The point of the fix: the chip cannot drift from the bar, because it has
    // no colours of its own to drift to.
    const palette = Object.values(REPORTS_COLORS).filter(value => typeof value === 'string');
    for (const [status, tone] of Object.entries(STATUS_TONE)) {
      expect({ status, inPalette: palette.includes(tone) }).toEqual({ status, inPalette: true });
    }
    for (const tone of Object.values(STATUS_INK)) {
      expect(palette).toContain(tone);
    }
  });
});

describe('the states the bar and the strip also draw', () => {
  /*
   * These three are the ones a reader compares across the row, and the pairings
   * the bug broke. `MoneyRow` builds its bar segments from exactly these
   * constants, so asserting the chip uses the same one is asserting they match.
   */
  it('money waiting is the strip\'s "due" colour, not a separate blue', () => {
    expect(STATUS_TONE.awaiting_payment).toBe(REPORTS_COLORS.WARNING);
    expect(STATUS_TONE.awaiting_payment).not.toBe(STATUS_TONE.overdue);
  });

  it('money collected is the strip\'s "collected" colour', () => {
    expect(STATUS_TONE.paid).toBe(REPORTS_COLORS.PRIMARY);
  });

  it('money being chased is danger, and merely waiting is not', () => {
    // The distinction REPORTS_COLORS itself documents: WARNING waits, DANGER is late.
    expect(STATUS_TONE.overdue).toBe(REPORTS_COLORS.DANGER);
    expect(STATUS_TONE.failed).toBe(REPORTS_COLORS.DANGER);
  });

  it('returned money matches the strip\'s returned-to-clients cell', () => {
    expect(STATUS_TONE.refunded).toBe(REPORTS_COLORS.UNATTRIBUTED);
    expect(STATUS_TONE.partially_refunded).toBe(REPORTS_COLORS.UNATTRIBUTED);
  });
});

describe('the chip', () => {
  it('grounds itself in its own colour, faintly', () => {
    expect(chipGround('#FB923C')).toBe('#FB923C1F');
    expect(statusChipStyle('awaiting_payment')).toEqual({
      color: REPORTS_COLORS.WARNING,
      background: `${REPORTS_COLORS.WARNING}1F`,
    });
  });

  it('keeps cancelled readable without inventing a colour', () => {
    // LOST is a dark brown: right as a dot, unreadable as small text on a dark
    // surface, so the ink falls back to the neutral the palette already has.
    expect(statusChipStyle('cancelled')).toEqual({
      color: REPORTS_COLORS.UNATTRIBUTED,
      background: `${REPORTS_COLORS.LOST}1F`,
    });
  });

  it('gives an unknown state a colour rather than none', () => {
    // A chip with no colour reads as a rendering fault, and `MoneyStatus` grows.
    expect(statusChipStyle('something-new' as MoneyStatus)).toEqual({
      color: REPORTS_COLORS.UNATTRIBUTED,
      background: `${REPORTS_COLORS.UNATTRIBUTED}1F`,
    });
  });
});
