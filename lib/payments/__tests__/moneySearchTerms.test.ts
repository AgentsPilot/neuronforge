/**
 * What the orders search understands.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The parser is the whole feature: the chips are a view of what it returns, and
 * the route filters by the same call. A chip that says "October" while the rows
 * ignore it is the one failure that matters here, because the UI would be
 * explaining a filter it is not applying. One parser, tested once.
 *
 * `today` is passed in rather than read from the clock. These tests pin real
 * dates, and a parser that asked `new Date()` would pass in October and fail in
 * November.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  parseMoneySearch,
  removeTerm,
  matchesTerms,
  type MoneySearchTerm,
} from '@/lib/payments/moneySearchTerms';

/** A Wednesday in October, so "december" has to look backwards. */
const TODAY = '2026-10-14';

const parse = (input: string) => parseMoneySearch(input, TODAY);
const kinds = (input: string) => parse(input).map(t => t.kind);
const only = <K extends MoneySearchTerm['kind']>(input: string, kind: K) => {
  const terms = parse(input);
  expect(terms).toHaveLength(1);
  expect(terms[0].kind).toBe(kind);
  return terms[0] as Extract<MoneySearchTerm, { kind: K }>;
};

describe('amounts', () => {
  it('reads a lower bound', () => {
    expect(only('>500', 'amount')).toMatchObject({ min: 500, max: null });
  });

  it('reads an upper bound', () => {
    expect(only('<900', 'amount')).toMatchObject({ min: null, max: 900 });
  });

  it('reads the inclusive forms', () => {
    expect(only('>=500', 'amount')).toMatchObject({ min: 500, max: null });
    expect(only('<=900', 'amount')).toMatchObject({ min: null, max: 900 });
  });

  it('reads a range', () => {
    expect(only('500-900', 'amount')).toMatchObject({ min: 500, max: 900 });
  });

  it('puts a backwards range the right way round', () => {
    // Typing the bigger number first is a slip, not a different question.
    expect(only('900-500', 'amount')).toMatchObject({ min: 500, max: 900 });
  });

  it('reads a currency mark as money', () => {
    expect(only('₪800', 'amount')).toMatchObject({ min: 800, max: 800 });
  });

  it('reads decimals as money', () => {
    expect(only('800.00', 'amount')).toMatchObject({ min: 800, max: 800 });
  });

  it('reads thousands separators', () => {
    expect(only('12,445', 'amount')).toMatchObject({ min: 12445, max: 12445 });
  });

  it('leaves a BARE integer as text', () => {
    /*
     * Deliberate. `28` is an invoice number far more often than ₪28, and
     * invoice search already worked by substring. A bare integer stays text, so
     * it still matches invoice numbers and the amount string exactly as before.
     */
    expect(only('28', 'text')).toMatchObject({ value: '28' });
  });
});

describe('periods', () => {
  it('reads a month name as that whole month', () => {
    expect(only('october', 'period')).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });

  it('looks BACKWARDS for a month still to come this year', () => {
    /*
     * In October, "december" means the December just gone, which has orders in
     * it, rather than the one eleven months away which cannot.
     */
    expect(only('december', 'period')).toMatchObject({
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });

  it('pairs a month with a year that follows it', () => {
    /*
     * Two tokens. Unpaired, the month would read as the most recent October and
     * the year would become a second period term, ANDed with it — two chips
     * that between them match nothing.
     */
    expect(only('october 2024', 'period')).toMatchObject({
      from: '2024-10-01',
      to: '2024-10-31',
    });
  });

  it('reads short month names', () => {
    expect(only('oct', 'period')).toMatchObject({ from: '2026-10-01' });
  });

  it('reads Hebrew month names', () => {
    // A Hebrew-speaking owner types Hebrew. The row they read it off is Hebrew.
    expect(only('אוקטובר', 'period')).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });

  it('reads a year-month', () => {
    expect(only('2026-02', 'period')).toMatchObject({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('knows February in a leap year', () => {
    expect(only('2028-02', 'period')).toMatchObject({ to: '2028-02-29' });
  });

  it('reads a bare year', () => {
    expect(only('2025', 'period')).toMatchObject({
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });

  it('does not read an implausible year as one', () => {
    /*
     * A service called "1600 metres" would otherwise become a search over the
     * seventeenth century and return nothing.
     */
    expect(only('1600', 'text')).toMatchObject({ value: '1600' });
  });

  it('reads one date', () => {
    expect(only('2026-10-14', 'period')).toMatchObject({
      from: '2026-10-14',
      to: '2026-10-14',
    });
  });

  it('reads a span of dates', () => {
    expect(only('2026-10-01..2026-10-31', 'period')).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });
});

describe('relative phrases', () => {
  it('reads "last 30 days" INCLUSIVE of today', () => {
    // 30 days means 30, not 31.
    expect(only('last 30 days', 'period')).toMatchObject({
      from: '2026-09-15',
      to: '2026-10-14',
    });
  });

  it('reads "this month"', () => {
    expect(only('this month', 'period')).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });

  it('reads "last month"', () => {
    expect(only('last month', 'period')).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('reads "today" and "yesterday"', () => {
    expect(only('today', 'period')).toMatchObject({ from: TODAY, to: TODAY });
    expect(only('yesterday', 'period')).toMatchObject({
      from: '2026-10-13',
      to: '2026-10-13',
    });
  });

  it('reads "this year" and "last year"', () => {
    expect(only('this year', 'period')).toMatchObject({ from: '2026-01-01' });
    expect(only('last year', 'period')).toMatchObject({ from: '2025-01-01' });
  });

  it('keeps a phrase apart from the words around it', () => {
    /*
     * The phrase is lifted out before the string is split, and the placeholder
     * is padded — without the padding it fused with the word before it and the
     * whole thing fell through to text.
     */
    expect(kinds('shlomo last 30 days')).toEqual(['text', 'period']);
    expect(parse('shlomo last 30 days')[0]).toMatchObject({ value: 'shlomo' });
  });
});

describe('text, and mixtures', () => {
  it('keeps unrecognised words as ONE phrase', () => {
    /*
     * Split into two terms they would be ANDed, which is nearly the same
     * question — but the raw text is then no longer what the user typed, and
     * `removeTerm` could not find it again.
     */
    expect(only('shlomo the king', 'text')).toMatchObject({ value: 'shlomo the king' });
  });

  it('reads the mixture from the mockup', () => {
    expect(kinds('shlomo >500 october')).toEqual(['text', 'amount', 'period']);
  });

  it('keeps the typed order', () => {
    expect(kinds('october >500 shlomo')).toEqual(['period', 'amount', 'text']);
  });

  it('returns nothing for an empty box', () => {
    expect(parse('')).toEqual([]);
    expect(parse('   ')).toEqual([]);
  });
});

describe('removing a chip edits the text it came from', () => {
  it('takes the term out and tidies the spacing', () => {
    const input = 'shlomo >500 october';
    const amount = parse(input).find(t => t.kind === 'amount')!;

    expect(removeTerm(input, amount)).toBe('shlomo october');
  });

  it('removes only the first of two identical terms', () => {
    const input = '>500 >500';
    const [first] = parse(input);

    expect(removeTerm(input, first)).toBe('>500');
  });

  it('removes a multi-word phrase whole', () => {
    const input = 'last 30 days shlomo';
    const period = parse(input).find(t => t.kind === 'period')!;

    expect(removeTerm(input, period)).toBe('shlomo');
  });

  it('leaves the string alone when the term is not in it', () => {
    expect(removeTerm('shlomo', { kind: 'text', value: 'x', raw: 'x' })).toBe('shlomo');
  });
});

describe('matching', () => {
  const item = (amount: number, day: string | null, haystack = 'shlomo the king inv-28') => ({
    amount,
    day,
    haystack,
  });

  it('keeps a row inside an amount bound', () => {
    expect(matchesTerms(parse('>500'), item(800, TODAY))).toBe(true);
    expect(matchesTerms(parse('>500'), item(400, TODAY))).toBe(false);
  });

  it('treats a bound as inclusive', () => {
    expect(matchesTerms(parse('>=800'), item(800, TODAY))).toBe(true);
    expect(matchesTerms(parse('<=800'), item(800, TODAY))).toBe(true);
  });

  it('keeps a row inside a period', () => {
    expect(matchesTerms(parse('october'), item(800, '2026-10-14'))).toBe(true);
    expect(matchesTerms(parse('october'), item(800, '2026-09-30'))).toBe(false);
  });

  it('includes both ends of a period', () => {
    expect(matchesTerms(parse('october'), item(800, '2026-10-01'))).toBe(true);
    expect(matchesTerms(parse('october'), item(800, '2026-10-31'))).toBe(true);
  });

  it('ANDs the terms rather than ORing them', () => {
    /*
     * Someone adding a second chip is narrowing, not widening. ORing would make
     * every extra chip return MORE rows, which is the opposite of what the act
     * of adding a filter means.
     */
    const terms = parse('>500 october');

    expect(matchesTerms(terms, item(800, '2026-10-14'))).toBe(true);
    expect(matchesTerms(terms, item(800, '2026-09-14'))).toBe(false);
    expect(matchesTerms(terms, item(100, '2026-10-14'))).toBe(false);
  });

  it('excludes a row with no date from a period', () => {
    /*
     * "October" asked for October. A row not known to be in it is not in it,
     * and including it would put rows in a month they may not belong to.
     */
    expect(matchesTerms(parse('october'), item(800, null))).toBe(false);
  });

  it('still matches a row with no date when no period was asked for', () => {
    expect(matchesTerms(parse('>500'), item(800, null))).toBe(true);
    expect(matchesTerms(parse('shlomo'), item(800, null))).toBe(true);
  });

  it('matches text case-insensitively', () => {
    expect(matchesTerms(parse('SHLOMO'), item(800, TODAY))).toBe(true);
  });

  it('matches an invoice number through the text path', () => {
    // The bare-integer decision pays off here: `28` finds inv-28.
    expect(matchesTerms(parse('28'), item(800, TODAY))).toBe(true);
  });

  it('keeps everything when the box is empty', () => {
    expect(matchesTerms(parse(''), item(1, null))).toBe(true);
  });
});

describe('the languages the product speaks', () => {
  it('reads Hebrew relative phrases', () => {
    /*
     * The hint buttons insert whatever their own label says, so a phrase the
     * parser cannot read in Hebrew means a Hebrew owner clicking a hint and
     * getting nothing. These are the labels those buttons carry.
     */
    expect(only('החודש', 'period')).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(only('החודש שעבר', 'period')).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(only('השנה', 'period')).toMatchObject({ from: '2026-01-01' });
    expect(only('השנה שעברה', 'period')).toMatchObject({ from: '2025-01-01' });
    expect(only('היום', 'period')).toMatchObject({ from: TODAY, to: TODAY });
    expect(only('אתמול', 'period')).toMatchObject({ from: '2026-10-13' });
  });

  it('reads the Hebrew n-days form', () => {
    expect(only('30 הימים האחרונים', 'period')).toMatchObject({
      from: '2026-09-15',
      to: '2026-10-14',
    });
  });

  it('does not let a one-word phrase swallow the two-word one', () => {
    /*
     * 'השנה' is a prefix of 'השנה שעברה'. Lifted in the wrong order it matches
     * first and leaves 'שעברה' behind as stray text, so the chip reads "this
     * year" and an orphan word filters every row away.
     */
    expect(kinds('השנה שעברה')).toEqual(['period']);
    expect(kinds('החודש שעבר')).toEqual(['period']);
  });

  it('reads Spanish relative phrases', () => {
    expect(only('este mes', 'period')).toMatchObject({ from: '2026-10-01' });
    expect(only('el mes pasado', 'period')).toMatchObject({ from: '2026-09-01' });
    expect(only('últimos 7 días', 'period')).toMatchObject({ from: '2026-10-08', to: TODAY });
  });

  it('mixes a Hebrew name with a Hebrew period', () => {
    expect(kinds('שלמה החודש')).toEqual(['text', 'period']);
    expect(parse('שלמה החודש')[0]).toMatchObject({ value: 'שלמה' });
  });
});

/**
 * Every token the picker can offer is a token the parser can read.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE UNFORGIVABLE FAILURE in a suggestion list: the user clicks
 * "Last 90 days", a chip appears saying so, and nothing is filtered. The chip
 * is the product telling them a filter is applied. A dead button is a lie, not
 * a gap.
 *
 * It is a real risk because the two halves are written apart — a label in a
 * picker, a regex in a reader — and a near miss parses as TEXT rather than
 * failing. "last 90 day" would search for the words.
 *
 * So the vocabulary lives in the parser's own module and this walks all of it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  relativePeriods,
  monthCompletions,
  periodCompletions,
  type SearchLanguage,
} from '@/lib/payments/moneySearchTerms';

const LANGUAGES: SearchLanguage[] = ['en', 'es', 'he'];

describe('the picker cannot offer a dead token', () => {
  for (const language of LANGUAGES) {
    describe(language, () => {
      it('every relative span parses to exactly one period', () => {
        const offers = relativePeriods(language);
        expect(offers.length).toBeGreaterThan(0);

        for (const { token } of offers) {
          const terms = parse(token);

          expect({ token, terms }).toMatchObject({
            terms: [{ kind: 'period' }],
          });
        }
      });

      it('every month completion parses to exactly one period', () => {
        /* Two letters is the picker's own threshold, and 'ma' / 'ju' / 'מא'
           are the prefixes that match more than one month. */
        for (const prefix of ['ja', 'ma', 'ju', 'oc', 'de', 'en', 'ag', 'או', 'מר', 'דצ']) {
          for (const { token } of monthCompletions(prefix, language, TODAY)) {
            expect({ token, terms: parse(token) }).toMatchObject({
              terms: [{ kind: 'period' }],
            });
          }
        }
      });

      it('a completion of a relative span parses too', () => {
        for (const { token: full } of relativePeriods(language)) {
          const prefix = full.slice(0, 4);

          for (const { token } of periodCompletions(prefix, language)) {
            expect({ token, terms: parse(token) }).toMatchObject({
              terms: [{ kind: 'period' }],
            });
          }
        }
      });
    });
  }

  it('offers no month on a one-letter prefix', () => {
    /*
     * 'm' matches March and May in English, and a list that appears after one
     * keystroke covers the rows while someone is still typing a name.
     */
    expect(monthCompletions('m', 'en', TODAY)).toEqual([]);
  });

  it('completes a span the user half-typed', () => {
    expect(periodCompletions('last m', 'en').map(s => s.token)).toEqual(['last month']);
  });

  it('offers this year and last for a month name', () => {
    const offers = monthCompletions('octo', 'en', TODAY);

    expect(offers.map(s => s.token)).toEqual(['october', 'october 2025']);
  });
});
