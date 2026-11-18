/**
 * Typing a name in capitals finds the same rows as typing it in lower case.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY BOTH HALVES HAVE TO BE PINNED
 *
 * Case-insensitivity here is not one decision, it is two that must agree:
 * `parseMoneySearch` lower-cases a text term's `value`, and the route
 * lower-cases the haystack it is matched against. Either one quietly dropping
 * its `.toLowerCase()` makes "John" find nothing while "john" works, and
 * nothing else in the system would notice — the request succeeds, the list is
 * simply empty, and it reads as "that client has no orders".
 *
 * `raw` is deliberately NOT lower-cased, because it is what the chip shows back
 * to the owner. So a test that only checked `value` would pass while the chip
 * said something else, and a test that only checked the chip would pass while
 * the filter matched nothing.
 *
 * The keyword readers are pinned too. `readWord`, `monthNamed`, `readToken` and
 * `readPhrase` each lower-case their own input, and a word typed at the start
 * of a sentence is exactly how people type: "Paid", "October", "Last 30 days".
 */

import { parseMoneySearch, matchesTerms } from '../moneySearchTerms';

const TODAY = '2026-11-16';

/** The route builds its haystack lower-cased; this mirrors that exactly. */
const row = (text: string, amount = 400, day: string | null = TODAY) => ({
  amount,
  day,
  haystack: text.toLowerCase(),
});

const finds = (typed: string, haystackText: string) =>
  matchesTerms(parseMoneySearch(typed, TODAY), row(haystackText));

describe('a client name, however it is capitalised', () => {
  it.each([
    ['john doe', 'all lower case'],
    ['John Doe', 'as a person writes a name'],
    ['JOHN DOE', 'shouted'],
    ['JoHn DoE', 'however it came out'],
  ])('%s finds the row (%s)', typed => {
    expect(finds(typed, 'INV-00042 John Doe john@example.com 400')).toBe(true);
  });

  it('still does not find a client who is not there', () => {
    expect(finds('Jane Doe', 'INV-00042 John Doe john@example.com 400')).toBe(false);
  });

  it('matches a name stored in capitals from text typed in lower case', () => {
    /* The other direction: the haystack is whatever the record holds, and
       owners do type their clients in lower case. */
    expect(finds('acme', 'INV-00042 ACME HOLDINGS LTD 400')).toBe(true);
  });
});

describe('the chip still says what was typed', () => {
  it('lower-cases the value it matches on, never the words it shows back', () => {
    const [term] = parseMoneySearch('John Doe', TODAY);

    expect(term.kind).toBe('text');
    expect(term.kind === 'text' && term.value).toBe('john doe');
    /* Translating an owner's own words back at them reads as the search
       having understood something else. */
    expect(term.raw).toBe('John Doe');
  });
});

describe('the words the box understands, typed as people type them', () => {
  it('reads a status word capitalised', () => {
    const [term] = parseMoneySearch('Paid', TODAY);
    expect(term.kind).toBe('status');
  });

  it('reads a month capitalised', () => {
    const [term] = parseMoneySearch('October', TODAY);
    expect(term.kind).toBe('period');
  });

  it('reads a phrase capitalised', () => {
    const [term] = parseMoneySearch('Last 30 Days', TODAY);
    expect(term.kind).toBe('period');
  });

  it('reads a month and year capitalised', () => {
    const [term] = parseMoneySearch('October 2026', TODAY);
    expect(term.kind).toBe('period');
    expect(term.kind === 'period' && term.from).toBe('2026-10-01');
  });
});
