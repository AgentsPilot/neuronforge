/**
 * The search chips obey one parser, and the client's name opens the CRM.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * (a) TWO PARSERS. The field draws a chip per recognised term and the route
 *     filters by them. If either grew its own reading of the typed string, the
 *     page would show a chip saying "October" over rows that are not filtered
 *     to October — a UI explaining a filter it is not applying, which is worse
 *     than no filter at all, because the explanation is believed.
 *
 * (b) A PARALLEL CHIP LIST. The typed string is the only state. A `useState`
 *     array of chips beside it would drift from the text on paste, undo, or any
 *     edit the input made that the array did not see, and then the chips and
 *     the box would disagree about the same search.
 *
 * (c) A DEAD LINK. The name links only where there is a contact to open. A
 *     standalone invoice typed for a walk-in has a name and no record behind
 *     it, and a link that goes nowhere is worse than plain text.
 *
 * (d) A CLICK THAT OPENS THE WRONG THING. The row already opens the order
 *     drawer. Without `stopPropagation` the name would open both, and the row
 *     would win.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The parsing itself is tested for real in `moneySearchTerms.test` — 49 cases
 * over amounts, periods, three languages and the matcher. This pins the wiring
 * those cases cannot see.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import { dictionarySource } from '@/tests/helpers/dictionarySource';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const field = read('components/payments/MoneySearchField.tsx');
const view = read('components/payments/PaymentsView.tsx');
const row = read('components/payments/MoneyRow.tsx');
const list = read('components/payments/MoneyList.tsx');
const route = read('app/api/payments/money/route.ts');
const copy = dictionarySource();

describe('one parser, both sides', () => {
  it('the field parses with it', () => {
    expect(field).toMatch(/parseMoneySearch\(value, today\)/);
  });

  it('the route parses with the same function', () => {
    expect(route).toMatch(/parseMoneySearch\(search \?\? '', businessDayFor\(new Date\(\), timezone\)\.date\)/);
  });

  it('the route filters by the parsed terms, not by a substring', () => {
    expect(route).toMatch(/matchesTerms\(terms, \{/);
    expect(route).not.toMatch(/haystack\.includes\(needle\)/);
  });
});

describe('the typed string is the only state', () => {
  it('the field holds no chip list of its own', () => {
    /*
     * The chips are derived. A `useState` of terms here is the bug this design
     * exists to make impossible.
     */
    expect(field).not.toMatch(/useState<MoneySearchTerm/);
    expect(field).not.toMatch(/setChips/);
  });

  it('removing a chip edits the text', () => {
    expect(field).toMatch(/onChange\(removeTerm\(value, term\)\)/);
  });

  it('typing keeps the chips rather than appending blindly', () => {
    /*
     * Editing the free text rebuilds the string as "chips + what is now typed".
     * Appending to the raw value instead sent the caret to the end on every
     * keystroke.
     */
    expect(field).toMatch(/const kept = chips\.map\(term => term\.raw\)\.join\(' '\)/);
  });

  it('backspace only eats a chip from the start of the input', () => {
    /*
     * Unguarded, it would delete a chip while the user was still deleting their
     * own typing.
     */
    expect(field).toMatch(/input\.selectionStart === 0 && input\.selectionEnd === 0/);
    expect(field).toMatch(/if \(!atStart \|\| chips\.length === 0\) return/);
  });
});

describe('periods are read on the business clock', () => {
  it('the route resolves the zone from user_preferences', () => {
    /*
     * `business_profiles.timezone` does not exist, and naming it in a select
     * makes PostgREST reject the whole query. `resolveBusinessTimezone` is the
     * one reader.
     */
    expect(route).toMatch(/resolveBusinessTimezone\(\{/);
    expect(route).toMatch(/\.from\('user_preferences'\)/);
  });

  it('compares calendar dates in that zone, not UTC instants', () => {
    /*
     * 01:00 on 1 November in Jerusalem is 23:00 on 31 October in UTC, so a UTC
     * comparison files it under October for a business that has turned the page.
     */
    expect(route).toMatch(/new Intl\.DateTimeFormat\('en-CA', \{ timeZone: timezone \}\)/);
    expect(route).toMatch(/day: businessDate\(item\.date\)/);
  });
});

describe('the chips read in both scripts', () => {
  it('wraps each chip label in bdi', () => {
    /*
     * A chip reading "500 – 900" is two left-to-right runs inside a
     * right-to-left row; left loose, the bidi algorithm reorders the neutrals
     * between them and the range reads backwards.
     */
    expect(field).toMatch(/<bdi className="truncate">\{chipLabel/);
  });

  it('shows amounts without a currency symbol', () => {
    /*
     * The rows can be in more than one currency and there is no FX rate in this
     * platform, so ">500" means 500 of whatever a row is priced in. A "₪" on
     * the chip would claim a currency the filter does not apply.
     */
    expect(field).toMatch(/maximumFractionDigits: 2/);
    expect(field).not.toMatch(/style: 'currency'/);
  });
});

describe('both ways in, and neither invents vocabulary', () => {
  it('the panel offers periods from the parser’s own module', () => {
    /*
     * Not a list written in the component. A phrase the reader cannot read
     * would produce a chip that filters nothing, which is the product
     * asserting a filter it has not applied.
     */
    expect(field).toMatch(/relativePeriods\(language\)/);
  });

  it('the suggestions complete from the same module', () => {
    expect(field).toMatch(/monthCompletions\(typed, language, today\)/);
    expect(field).toMatch(/periodCompletions\(typed, language\)/);
  });

  it('offers TEXT first for a bare number', () => {
    /*
     * `500` is an invoice number more often than ₪500, and the parser reads it
     * as text. The list offers the other readings; it must not reorder them so
     * that Enter changes what the box already means.
     */
    const from = field.indexOf('if (numeric) {');
    expect(from).toBeGreaterThan(-1);

    const block = field.slice(from, from + 900);
    expect(block.indexOf("mark: '⌕'")).toBeLessThan(block.indexOf("mark: '≥'"));
  });

  it('says nothing when there is nothing to read', () => {
    // An empty popover under every keystroke of a client's name is noise.
    expect(field).toMatch(/if \(periods\.length === 0\) return \[\]/);
  });

  it('never shows the list and the panel together', () => {
    // Two popovers under one box, both offering periods, is two answers.
    expect(field).toMatch(/\{listOpen && !panelOpen && \(/);
  });

  it('the panel pills report whether they are already on', () => {
    expect(field).toMatch(/aria-pressed=\{on\}/);
  });

  it('a lit pill removes its own chip rather than adding a second', () => {
    expect(field).toMatch(/if \(existing\) drop\(existing\);\s*\n\s*else add\(pill\.token\)/);
  });

  it('takes a suggestion on mousedown, not click', () => {
    // The input's blur closes the list before a click could ever land.
    expect(field).toMatch(/onMouseDown=\{event => \{/);
  });

  it('the retired hint keys are gone from the copy', () => {
    /* They were a second teaching surface under one input, and the only one
       that could not say what was already applied. */
    expect(copy).not.toMatch(/'payments\.search\.hint_/);
  });

  it('every label the panel renders exists in all three languages', () => {
    for (const key of ['between', 'as_text', 'add_filter', 'group_amount', 'group_period', 'over', 'under']) {
      const hits = copy.match(new RegExp(`'payments\\.search\\.${key}':`, 'g')) ?? [];
      expect({ key, count: hits.length }).toEqual({ key, count: 3 });
    }
    for (const key of ['add', 'remove', 'clear']) {
      const hits = copy.match(new RegExp(`'common\\.${key}':`, 'g')) ?? [];
      expect({ key, count: hits.length }).toEqual({ key, count: 3 });
    }
  });
});

describe('the client name opens the CRM', () => {
  it('links only when there is a contact to open', () => {
    expect(row).toMatch(/item\.contactName && item\.contactId && onOpenContact \?/);
  });

  it('keeps the click off the row, which opens the order instead', () => {
    const from = row.indexOf('THE NAME IS THE WAY INTO THE CRM');
    expect(from).toBeGreaterThan(-1);

    expect(row.slice(from, from + 1800)).toMatch(/event\.stopPropagation\(\)/);
  });

  it('carries the booking so the drawer opens on this order', () => {
    expect(row).toMatch(/onOpenContact\(item\.contactId!, item\.bookingId \?\? null\)/);
  });

  it('is threaded through the list rather than reaching for a router in the row', () => {
    /*
     * `MoneyRow` is also rendered inside the CRM drawer's own list, where this
     * link would lead back to the panel it was clicked in. A callback lets that
     * caller simply not pass one; a `useRouter` in the row could not opt out.
     */
    expect(list).toMatch(/onOpenContact=\{onOpenContact\}/);
    expect(row).not.toMatch(/useRouter/);
  });

  it('opens on Payments & Invoices, with the order expanded', () => {
    expect(view).toMatch(/contact: contactId, section: 'payments'/);
    expect(view).toMatch(/params\.set\('booking', bookingId\)/);
    expect(view).toMatch(/\/business-os\/crm\?\$\{params\.toString\(\)\}/);
  });

  it('has a label in all three languages', () => {
    const hits = copy.match(/'payments\.open_in_crm':/g) ?? [];

    expect(hits).toHaveLength(3);
  });
});
