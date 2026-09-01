/**
 * "Nobody by that name" must never render as a number.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS EXISTS FOR
 *
 * Asked "how much does אופיר owe me in total", the chat answered
 * "אופיר חייב לך סך של 0". The true figure was ₪2,050. The filter had matched
 * nothing, `sum` over no rows is 0, and 0 is a perfectly ordinary number — so a
 * confident, false financial statement reached a real user in their own
 * language, indistinguishable from a settled account.
 *
 * The fix is not "return an error". It is to keep two facts apart that arithmetic
 * collapses into one:
 *
 *   there is no such person          →  say so
 *   there is such a person, at zero  →  say zero
 *
 * These tests assert the SENTENCE, not the plumbing, because the sentence is
 * where the lie would have appeared.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { renderAnswer } from '../render/AnswerRenderer';
import type { ComputeResult, FindResult } from '../types';

const steps = [{ id: 's1' }];

function sum(value: number | null, unmatched?: Array<{ entity: string; value: string }>): ComputeResult {
  return {
    op: 'compute',
    entity: 'invoices',
    agg: { fn: 'sum', field: 'amount' },
    value,
    approximate: false,
    ...(unmatched ? { unmatched } : {}),
  } as ComputeResult;
}

describe('an aggregate whose filter named something that does not exist', () => {
  it('says the name matched nothing instead of stating a total', () => {
    const answer = renderAnswer(
      'Gregory Fenwick owes you {s1.value}.',
      steps,
      [sum(0, [{ entity: 'contacts', value: 'Gregory Fenwick' }])],
      { language: 'en' }
    );

    // The planner's sentence substituted cleanly — that is exactly the danger.
    expect(answer.text).not.toContain('owes you');
    expect(answer.text).toBe('No contact found matching "Gregory Fenwick".');
    expect(answer.unmatched).toEqual([{ entity: 'contacts', value: 'Gregory Fenwick' }]);
  });

  it('says it in the language the question was asked in', () => {
    const he = renderAnswer(
      'אופיר חייב לך סך של {s1.value}.',
      steps,
      [sum(0, [{ entity: 'contacts', value: 'אופיר' }])],
      { language: 'he' }
    );
    // Gender-free construction: "אין" does not inflect, so one phrase is correct
    // for every entity noun the catalog might supply.
    expect(he.text).toBe('אין איש קשר בשם "אופיר".');

    const es = renderAnswer(
      'El taller de cerámica ingresó {s1.value}.',
      steps,
      [sum(0, [{ entity: 'services', value: 'taller de cerámica' }])],
      { language: 'es' }
    );
    expect(es.text).toBe('No se encontró servicio: "taller de cerámica".');
  });

  it('overrides the fallback line too, which would tell the same lie in fewer words', () => {
    // With no answer text the renderer falls back to "amount: 0" — still a
    // number, still false.
    const answer = renderAnswer(
      undefined,
      steps,
      [sum(0, [{ entity: 'services', value: 'pottery workshop' }])],
      { language: 'en' }
    );
    expect(answer.text).toBe('No service found matching "pottery workshop".');
    expect(answer.text).not.toMatch(/0/);
  });

  it('reports every unmatched name, not just the first', () => {
    const answer = renderAnswer(
      undefined,
      steps,
      [
        sum(0, [
          { entity: 'contacts', value: 'Gregory Fenwick' },
          { entity: 'services', value: 'pottery workshop' },
        ]),
      ],
      { language: 'en' }
    );
    expect(answer.text).toContain('Gregory Fenwick');
    expect(answer.text).toContain('pottery workshop');
  });
});

describe('a genuine zero', () => {
  it('is still reported as a number', () => {
    // The other half of the distinction, and the reason this cannot simply
    // refuse whenever an aggregate comes back 0: a client who is square with you
    // is a real, useful answer.
    const answer = renderAnswer('Ofir owes you {s1.value}.', steps, [sum(0)], {
      language: 'en',
    });
    // Formatted as money, because summing an amount field is a money answer.
    expect(answer.text).toBe('Ofir owes you $0.00.');
    expect(answer.unmatched).toBeUndefined();
  });

  it('is still reported when there is simply no data', () => {
    const answer = renderAnswer(undefined, steps, [sum(null)], { language: 'en' });
    expect(answer.unmatched).toBeUndefined();
  });
});

describe('a list whose filter named something that does not exist', () => {
  it('says so rather than showing an empty list', () => {
    const find: FindResult = {
      op: 'find',
      entity: 'invoices',
      rows: [],
      truncated: false,
      limit: 50,
      unmatched: [{ entity: 'contacts', value: 'Gregory Fenwick' }],
    };

    const answer = renderAnswer('Invoices for Gregory: {s1.rows}', steps, [find], {
      language: 'en',
    });
    expect(answer.text).toBe('No contact found matching "Gregory Fenwick".');
  });

  it('leaves a genuinely empty list alone', () => {
    const find: FindResult = {
      op: 'find',
      entity: 'invoices',
      rows: [],
      truncated: false,
      limit: 50,
    };

    const answer = renderAnswer('Invoices: {s1.rows}', steps, [find], { language: 'en' });
    // Falls back to the plain localized count, as before.
    expect(answer.text).toBe('invoices: 0');
  });
});

describe('a rate stated as a rate', () => {
  // The last gap in aggregation depth: multi-step plans could already cite two
  // numbers in one sentence ("12 of 40"), but nothing divided them, so a
  // conversion rate could not be expressed as a rate.
  const twoSteps = [{ id: 's1' }, { id: 's2' }];

  const count = (n: number): ComputeResult =>
    ({ op: 'compute', entity: 'contacts', agg: { fn: 'count' }, value: n, approximate: false }) as ComputeResult;

  it('divides one step by another and formats a percentage', () => {
    const answer = renderAnswer(
      '{s1.percent_of.s2} of enquiries became clients.',
      twoSteps,
      [count(12), count(40)],
      { language: 'en' }
    );
    expect(answer.text).toBe('30% of enquiries became clients.');
  });

  it('mixes a count of rows with an aggregate', () => {
    const rows: FindResult = {
      op: 'find', entity: 'contacts', rows: [{ id: 'a' }, { id: 'b' }], truncated: false, limit: 50,
    };
    const answer = renderAnswer('{s1.percent_of.s2}', twoSteps, [rows, count(8)], { language: 'en' });
    expect(answer.text).toBe('25%');
  });

  it('gives no rate rather than NaN when the total is zero', () => {
    // Falls back to the plain line: no rate is better than "NaN%" or "Infinity%".
    const answer = renderAnswer('{s1.percent_of.s2} converted.', twoSteps, [count(5), count(0)], {
      language: 'en',
    });
    expect(answer.text).not.toMatch(/NaN|Infinity/);
    expect(answer.text).not.toContain('converted');
  });

  it('keeps a fraction of a percent legible', () => {
    const answer = renderAnswer('{s1.percent_of.s2}', twoSteps, [count(1), count(300)], {
      language: 'en',
    });
    expect(answer.text).toBe('0.3%');
  });
});
