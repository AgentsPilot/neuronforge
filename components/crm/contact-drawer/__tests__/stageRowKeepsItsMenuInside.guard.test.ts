/**
 * The payment stage row keeps its ⋯ menu inside the card.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT LOOKED LIKE
 *
 * On a phone, in the booking journey's payment section:
 *
 *     ┌──────────────────────────────────────────┐
 *     │ ● נשלחה חשבונית  לתשלום עד 15 באוק׳ 2026  ₪500 │  ⋯   ← outside
 *     └──────────────────────────────────────────┘
 *
 * The menu sat past the card's border, in the drawer's margin.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY, AND WHY THE EARLIER FIX DID NOT COVER IT
 *
 * A flex item's automatic minimum size is its own content, so an item can only
 * be squeezed if it carries `overflow` of its own. On this line only the label
 * did. The status chip and the ⋯ are `shrink-0` on purpose — a control that is
 * squashed cannot be pressed — and the due date was `whitespace-nowrap` with
 * visible overflow, so it could never give. The row's minimum width was the sum
 * of all of it, roughly 20px past a 340px drawer, and the child that got pushed
 * out was the last one.
 *
 * A fix shipped the same day (`5bf7b463`) addressed the SESSIONS table, a
 * different component with a different cause (a fixed-layout `<td>` too narrow
 * for the pair of controls inside it). Both are "the actions overflow on a
 * phone"; neither fixes the other. That is what this file is named for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HALF THAT MUST NOT CHANGE
 *
 * The year is still printed when it is NOT the current one. A plan running into
 * next year, or a payment being reconciled against an old statement, needs it —
 * that is what `withYear` was added for, and dropping it outright would trade
 * one defect for a worse one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(
  join(process.cwd(), 'components/crm/contact-drawer/BookingsTab.tsx'),
  'utf8'
);

/** Comments out: every rule here is about the code, and the prose quotes it. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the date gives way, so the controls do not', () => {
  it('the due date can shrink', () => {
    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE ONE THAT MATTERS.
     *
     * `truncate` is nowrap + ellipsis + `overflow: hidden`, and that last part
     * is what drops the item's automatic minimum size to zero. The bare
     * `whitespace-nowrap` it replaces looks equivalent and is not.
     * ───────────────────────────────────────────────────────────────────────
     */
    expect(code).toMatch(/className="min-w-0 truncate text-\[11\.5px\] tabular-nums"/);
    expect(code).not.toMatch(/className="text-\[11\.5px\] tabular-nums whitespace-nowrap"/);
  });

  it('the row itself declares no content-based floor', () => {
    expect(code).toContain('<div className="flex min-w-0 items-center gap-2">');
  });

  it('and the menu is still the one thing that cannot be squashed', () => {
    /*
     * The opposite fix — letting the ⋯ shrink — would keep it inside the card
     * and make it unpressable. `StageRowActions` stays `shrink-0`.
     */
    const actions = readFileSync(
      join(process.cwd(), 'components/crm/contact-drawer/StageRowActions.tsx'),
      'utf8'
    );

    expect(actions).toMatch(/className="relative shrink-0"/);
  });
});

describe('the year', () => {
  it('is dropped when it is the current one', () => {
    // Where the width actually came back: about 40px on this line.
    expect(code).toMatch(/withYear && year !== thisYear \? \{ year: 'numeric' \} : \{\}/);
  });

  it('is still printed when it is not', () => {
    /*
     * `withYear` exists for the dates that have to stand on their own: a plan
     * that runs into next year, a refund reconciled against an old statement.
     * The flag is still read; only its meaning narrowed.
     */
    expect(code).toContain('withYear && year !== thisYear');
    expect(code).toMatch(/stageDate\(stage\.dueDate, true\)/);
    expect(code).toMatch(/stageDate\(stage\.paidAt, true\)/);
  });

  it('compares the year on the same clock it prints it', () => {
    /*
     * A date-only value is parsed as UTC midnight and formatted with
     * `timeZone: 'UTC'`. Comparing it against a LOCAL year would, on 31
     * December, decide "not this year" about a date it then prints as this
     * year — a four-character flicker nobody could explain.
     */
    expect(code).toContain("const year = dateOnly ? parsed.getUTCFullYear() : parsed.getFullYear();");
    expect(code).toContain('const thisYear = dateOnly ? now.getUTCFullYear() : now.getFullYear();');
  });

  it('parses the value once', () => {
    // It was parsed inside each branch of the return. A third parse for the
    // year check would be three constructions of one date.
    expect(code).toMatch(/const parsed = dateOnly \? new Date\(`\$\{value\}T00:00:00Z`\) : new Date\(value\);/);
  });
});
