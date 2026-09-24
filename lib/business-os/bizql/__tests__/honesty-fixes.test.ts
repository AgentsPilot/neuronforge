/**
 * The answers this chat used to state confidently and wrongly.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE FOUR
 *
 * Every case below returned a plausible number or sentence, passed validation,
 * rendered cleanly and reached the user — so none of them could be caught by
 * reading an answer. Production had zero transport failures across 400 calls;
 * the failures were all of this shape.
 *
 * They are grouped because they share a cause: a caveat the system had already
 * computed and then dropped on the floor.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { renderAnswer } from '../render/AnswerRenderer';
import { ALTERNATIVE_KINDS } from '../render/describePlan';
import type { QueryResult } from '../types';

const PROPOSALS = 'proposals';

/** A compute result, shaped as the compiler returns one. */
function compute(over: Partial<Record<string, unknown>> = {}): QueryResult {
  return {
    op: 'compute',
    entity: PROPOSALS,
    value: null,
    agg: { fn: 'avg', field: 'total' },
    approximate: false,
    ...over,
  } as unknown as QueryResult;
}

describe('an aggregate with nothing to reduce', () => {
  /*
   * The compiler returns null here deliberately — "min/max/avg stay null: there
   * is genuinely no smallest invoice when there are no invoices, and answering
   * '0' would invent one". The renderer converted it straight back to '0',
   * eight lines below that comment.
   */
  it('never renders as a measured zero', () => {
    const answer = renderAnswer(
      'הממוצע שלך הוא {s1.value}',
      [{ id: 's1' }],
      [compute()],
      { language: 'he' }
    );

    expect(answer.text).not.toMatch(/\b0(\.00)?\b/);
    expect(answer.text.trim()).not.toBe('');
  });

  it('says so in the reader’s own language, with no hand-written prose', () => {
    const he = renderAnswer(undefined, [{ id: 's1' }], [compute()], { language: 'he' });
    const en = renderAnswer(undefined, [{ id: 's1' }], [compute()], { language: 'en' });

    // The dash is the marker `formatValue` already uses for an absent value, so
    // it needs no translation table and cannot read as a quantity.
    expect(he.text).toContain('—');
    expect(en.text).toContain('—');
    // And the label differs by language, proving it came from the catalog
    // rather than from a literal in the renderer.
    expect(he.text).not.toBe(en.text);
  });

  it('still reports a real zero as zero', () => {
    // A SUM over no rows is genuinely 0 — the compiler says so, and this must
    // not be swept up by the fix above.
    const answer = renderAnswer(
      'סך הכל {s1.value}',
      [{ id: 's1' }],
      [compute({ value: 0, agg: { fn: 'sum', field: 'total' } })],
      { language: 'he' }
    );

    expect(answer.text).toMatch(/0/);
  });
});

describe('values the configuration no longer accounts for', () => {
  /*
   * The compiler has collected these since it was written and every result
   * shape carries them. Nothing read them, so a business that renamed a
   * pipeline stage saw a quietly undercounted answer with no caveat, while the
   * server logged the warning.
   */
  it('reaches the rendered answer instead of being dropped', () => {
    const answer = renderAnswer(
      'יש לך {s1.value}',
      [{ id: 's1' }],
      [compute({ value: 4, agg: { fn: 'count', field: 'id' },
                 unclassified: [{ field: 'status', values: ['in_review'] }] })],
      { language: 'he' }
    );

    expect(answer.unclassified).toEqual([{ field: 'status', values: ['in_review'] }]);
  });

  it('merges the same field reported by several steps, so the reader is told once', () => {
    const answer = renderAnswer(
      '{s1.value} · {s2.value}',
      [{ id: 's1' }, { id: 's2' }],
      [
        compute({ value: 1, agg: { fn: 'count', field: 'id' },
                  unclassified: [{ field: 'status', values: ['in_review'] }] }),
        compute({ value: 2, agg: { fn: 'count', field: 'id' },
                  unclassified: [{ field: 'status', values: ['in_review', 'parked'] }] }),
      ],
      { language: 'he' }
    );

    expect(answer.unclassified).toHaveLength(1);
    expect(answer.unclassified?.[0].values.sort()).toEqual(['in_review', 'parked']);
  });

  it('is absent when every row classified, so no caveat is invented', () => {
    const answer = renderAnswer('{s1.value}', [{ id: 's1' }],
      [compute({ value: 4, agg: { fn: 'count', field: 'id' } })], { language: 'he' });

    expect(answer.unclassified).toBeUndefined();
  });
});

describe('the correction chip', () => {
  /*
   * `previous_filters` was declared on the Alternative type, implemented in
   * applyAlternative, built by the route — and rejected by the route's own Zod
   * schema, which re-listed the union by hand. Every user who tapped the chip
   * got "Invalid request".
   *
   * The wire schema now derives from this list, so the two cannot diverge. This
   * test guards the list itself against a kind being handled and not offered.
   */
  it('offers every kind the handler implements', async () => {
    const source = await import('fs').then((fs) =>
      fs.readFileSync(require.resolve('../render/applyAlternative.ts'), 'utf8')
    );

    const handled = [...source.matchAll(/alternative\.kind === '([a-z_]+)'/g)].map((m) => m[1]);

    expect(handled.length).toBeGreaterThan(0);
    for (const kind of handled) {
      expect(ALTERNATIVE_KINDS).toContain(kind);
    }
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * A TOTAL ACROSS TWO CURRENCIES IS NOT A TOTAL
 *
 * The same shape as the four above: the compiler knew each row's currency and
 * threw it away, then added the amounts. A business pricing US clients in
 * dollars from Israel — the case the whole per-service currency design exists
 * to support — asked "how much did I earn" and was told 300 + 300 = 600, in no
 * currency at all. Plausible, well-formed, and wrong.
 *
 * There is no FX rate anywhere in the platform, so the honest answer is per
 * currency. `value` stays the largest one's own total so every existing caller
 * keeps working; `currencyBreakdown` is what says it is not the whole.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('a money total spanning more than one currency', () => {
  const mixed = (over: Record<string, unknown> = {}): QueryResult =>
    ({
      op: 'compute',
      entity: 'payment_transactions',
      agg: { fn: 'sum', field: 'amount' },
      value: 500,
      currency: 'USD',
      currencyBreakdown: [
        { currency: 'USD', value: 500 },
        { currency: 'ILS', value: 300 },
      ],
      approximate: false,
      ...over,
    }) as unknown as QueryResult;

  it('carries the breakdown to the caller instead of dropping it', () => {
    const answer = renderAnswer('You earned {s1.value}', [{ id: 's1' }], [mixed()], {
      language: 'en',
    });

    expect(answer.currencyBreakdown).toEqual([
      { currency: 'USD', value: 500 },
      { currency: 'ILS', value: 300 },
    ]);
  });

  it('says nothing at all for the ordinary single-currency business', () => {
    // The common path must be untouched — a caveat that fires always is noise,
    // and a caller cannot use its presence as a signal if it is always present.
    const single = mixed({ currencyBreakdown: undefined, currency: 'ILS' });
    const answer = renderAnswer('You earned {s1.value}', [{ id: 's1' }], [single], {
      language: 'en',
    });

    expect(answer.currencyBreakdown).toBeUndefined();
  });

  it('adds same-currency totals across steps, and only those', () => {
    // Two steps over the same mixed set: the reader needs the fact once. USD
    // adds to USD — the one addition that is honest — and ILS stays separate.
    const answer = renderAnswer(
      '{s1.value} and {s2.value}',
      [{ id: 's1' }, { id: 's2' }],
      [
        mixed(),
        mixed({
          currencyBreakdown: [
            { currency: 'USD', value: 100 },
            { currency: 'GBP', value: 50 },
          ],
        }),
      ],
      { language: 'en' }
    );

    expect(answer.currencyBreakdown).toEqual([
      { currency: 'USD', value: 600 },
      { currency: 'ILS', value: 300 },
      { currency: 'GBP', value: 50 },
    ]);
  });
});
