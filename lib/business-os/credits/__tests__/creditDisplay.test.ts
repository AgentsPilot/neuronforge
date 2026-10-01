/**
 * toDisplayedCredits — the card's rounding (credit deduction slice 6a, D-c).
 *
 * The parts always add up to the displayed used, "left" and "used" always add
 * up to the allowance, and something used is never shown as nothing.
 */

import { toDisplayedCredits, type DisplayedCreditFigure } from '../creditDisplay';

const whole = (value: number): DisplayedCreditFigure => ({ kind: 'whole', value });
const LESS: DisplayedCreditFigure = { kind: 'less_than_one' };

const counted = (f: DisplayedCreditFigure) => (f.kind === 'whole' ? f.value : 1);

describe('toDisplayedCredits', () => {
  it('nothing used: 0, the full allowance left, and the "nothing used" flag', () => {
    expect(toDisplayedCredits({ used: 0, usedByOwner: 0, usedAutomatic: 0, allowanceAmount: 32250 })).toEqual({
      nothingUsed: true,
      used: whole(0),
      byOwner: whole(0),
      automatic: whole(0),
      left: 32250,
    });
  });

  it('less than one credit: "less than 1", counted as 1 — left is the allowance minus 1', () => {
    expect(toDisplayedCredits({ used: 0.4, usedByOwner: 0.4, usedAutomatic: 0, allowanceAmount: 32250 })).toEqual({
      nothingUsed: false,
      used: LESS,
      byOwner: LESS,
      automatic: whole(0),
      left: 32249,
    });
  });

  it('less than one credit: the unit goes to the larger part', () => {
    const shown = toDisplayedCredits({ used: 0.3, usedByOwner: 0.1, usedAutomatic: 0.2, allowanceAmount: null });
    expect(shown.byOwner).toEqual(whole(0));
    expect(shown.automatic).toEqual(LESS);
    expect(shown.left).toBeNull();
  });

  it('the SA example: 62.5 used, 40.6 by you + 21.9 automatic → 63 = 41 + 22', () => {
    const shown = toDisplayedCredits({ used: 62.5, usedByOwner: 40.6, usedAutomatic: 21.9, allowanceAmount: 32250 });
    expect(shown.used).toEqual(whole(63));
    expect(shown.byOwner).toEqual(whole(41));
    expect(shown.automatic).toEqual(whole(22));
    expect(shown.left).toBe(32187);
  });

  it('a small part can show as 0 when used ≥ 1 (the sum rule wins, not a bug)', () => {
    const shown = toDisplayedCredits({ used: 63.08, usedByOwner: 63, usedAutomatic: 0.08, allowanceAmount: 32250 });
    expect(shown.used).toEqual(whole(63));
    expect(shown.byOwner).toEqual(whole(63));
    expect(shown.automatic).toEqual(whole(0));
  });

  it('over the allowance: 0 left, the true figure used', () => {
    const shown = toDisplayedCredits({ used: 32260, usedByOwner: 32000, usedAutomatic: 260, allowanceAmount: 32250 });
    expect(shown.left).toBe(0);
    expect(shown.used).toEqual(whole(32260));
  });

  it('negatives clamp to 0', () => {
    const shown = toDisplayedCredits({ used: -2, usedByOwner: -1, usedAutomatic: -1, allowanceAmount: 100 });
    expect(shown).toEqual({ nothingUsed: true, used: whole(0), byOwner: whole(0), automatic: whole(0), left: 100 });
    const partly = toDisplayedCredits({ used: 5, usedByOwner: 6, usedAutomatic: -1, allowanceAmount: 100 });
    expect(partly.byOwner).toEqual(whole(5));
    expect(partly.automatic).toEqual(whole(0));
  });

  it('the parts always add up to the displayed used, and left + used to the allowance', () => {
    // A deterministic sweep instead of random input, so a failure reproduces.
    for (let owner = 0; owner <= 30; owner += 0.37) {
      for (let automatic = 0; automatic <= 30; automatic += 0.53) {
        const used = owner + automatic;
        const shown = toDisplayedCredits({ used, usedByOwner: owner, usedAutomatic: automatic, allowanceAmount: 2000 });
        if (shown.nothingUsed) continue;
        expect({ owner, automatic, sum: counted(shown.byOwner) + counted(shown.automatic) }).toEqual({
          owner,
          automatic,
          sum: counted(shown.used),
        });
        expect(shown.left! + counted(shown.used)).toBe(2000);
      }
    }
  });
});
